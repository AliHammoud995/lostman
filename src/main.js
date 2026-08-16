const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

// Keep the userData path ("Lostman") consistent between dev and packaged builds.
app.setName('Lostman');
Menu.setApplicationMenu(null);

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 10;

const inflight = new Map();
const dataFile = () => path.join(app.getPath('userData'), 'lostman-data.json');

// Full response bodies are cached here briefly so "Save response" writes exact bytes
// even when the text shown in the UI was truncated.
const respCache = new Map();
function cacheResponse(buf) {
  const id = crypto.randomUUID();
  respCache.set(id, buf);
  while (respCache.size > 8) respCache.delete(respCache.keys().next().value);
  return id;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#17171a',
    title: 'Lostman',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });

  if (!app.isPackaged) {
    win.webContents.on('console-message', (eventOrLevel, _level, message) => {
      const msg = typeof eventOrLevel === 'object' && eventOrLevel !== null && 'message' in eventOrLevel
        ? eventOrLevel.message
        : message;
      console.log('[renderer]', msg);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('[did-fail-load]', code, desc);
    });
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

/* ---------------- store ---------------- */

ipcMain.handle('store:load', async () => {
  try {
    return JSON.parse(await fs.readFile(dataFile(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('store:save', async (_e, data) => {
  const file = dataFile();
  const tmp = file + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
  return true;
});

/* ---------------- dialogs ---------------- */

ipcMain.handle('dialog:pickFile', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('resp:save', async (e, { bufId, defaultName, fallbackText }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName || 'response' });
  if (r.canceled || !r.filePath) return false;
  const buf = respCache.get(bufId);
  await fs.writeFile(r.filePath, buf ?? Buffer.from(fallbackText ?? '', 'utf8'));
  return true;
});

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }];

ipcMain.handle('file:open', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: (opts && opts.filters) || JSON_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    return { name: path.basename(r.filePaths[0]), content: await fs.readFile(r.filePaths[0], 'utf8') };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

/* ---------------- OAuth 2.0 authorization window ---------------- */

ipcMain.handle('oauth:authorize', (e, { authUrl, redirectUri }) => {
  return new Promise((resolve) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const win = new BrowserWindow({
      width: 620,
      height: 760,
      parent,
      title: 'OAuth 2.0 Sign-in',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
      try {
        win.destroy();
      } catch {
        /* already closed */
      }
    };
    const check = (url) => {
      if (!redirectUri || !url.startsWith(redirectUri)) return;
      try {
        const u = new URL(url);
        finish({
          code: u.searchParams.get('code'),
          state: u.searchParams.get('state'),
          error: u.searchParams.get('error'),
        });
      } catch {
        finish({ error: 'Could not parse the redirect URL' });
      }
    };
    win.webContents.on('will-redirect', (_ev, url) => check(url));
    win.webContents.on('will-navigate', (_ev, url) => check(url));
    win.on('closed', () => finish({ error: 'Sign-in window was closed' }));
    win.loadURL(authUrl).catch(() => {
      /* navigation to the redirect URI may abort the load; check() handles it */
    });
  });
});

/* ---------------- WebSocket / SSE streams ---------------- */

const streams = new Map();

ipcMain.handle('stream:open', (e, { id, kind, url, headers }) => {
  const wc = e.sender;
  const emit = (type, data) => {
    try {
      wc.send('stream:event', { id, type, data: data ?? '', ts: Date.now() });
    } catch {
      /* window gone */
    }
  };
  try {
    if (kind === 'ws') {
      if (typeof WebSocket === 'undefined') {
        emit('error', 'WebSocket is not available in this runtime');
        return false;
      }
      const ws = new WebSocket(url);
      ws.onopen = () => emit('open');
      ws.onmessage = (ev) =>
        emit('message', typeof ev.data === 'string' ? ev.data : `[binary frame, ${ev.data.byteLength || 0} bytes]`);
      ws.onerror = () => emit('error', 'WebSocket error (check the URL and server)');
      ws.onclose = (ev) => {
        emit('close', `code ${ev.code}${ev.reason ? ' — ' + ev.reason : ''}`);
        streams.delete(id);
      };
      streams.set(id, {
        send: (msg) => {
          try {
            ws.send(msg);
          } catch (err) {
            emit('error', String((err && err.message) || err));
          }
        },
        close: () => {
          try {
            ws.close();
          } catch {
            /* already closed */
          }
        },
      });
    } else {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const hdrs = { accept: 'text/event-stream', 'cache-control': 'no-cache', ...headersToObj(headers) };
      const req = mod.request(u, { headers: hdrs, agent: false }, (res) => {
        emit('open', `HTTP ${res.statusCode}`);
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk.replace(/\r\n/g, '\n');
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const rawEvent = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = rawEvent.split('\n');
            const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
            const eventLine = lines.find((l) => l.startsWith('event:'));
            if (dataLines.length) emit('message', (eventLine ? `[${eventLine.slice(6).trim()}] ` : '') + dataLines.join('\n'));
          }
        });
        res.on('end', () => {
          emit('close', 'stream ended');
          streams.delete(id);
        });
      });
      req.on('error', (err) => {
        emit('error', String((err && err.message) || err));
        streams.delete(id);
      });
      req.end();
      streams.set(id, {
        close: () => {
          try {
            req.destroy();
          } catch {
            /* already destroyed */
          }
        },
      });
    }
    return true;
  } catch (err) {
    emit('error', String((err && err.message) || err));
    return false;
  }
});

ipcMain.handle('stream:send', (_e, { id, message }) => {
  const s = streams.get(id);
  if (s && s.send) s.send(message);
  return true;
});

ipcMain.handle('stream:close', (_e, { id }) => {
  const s = streams.get(id);
  if (s) s.close();
  streams.delete(id);
  return true;
});

ipcMain.handle('file:saveText', async (e, { defaultName, content }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName || 'export.json', filters: JSON_FILTERS });
  if (r.canceled || !r.filePath) return false;
  await fs.writeFile(r.filePath, content, 'utf8');
  return true;
});

/* ---------------- HTTP client ---------------- */

ipcMain.handle('http:abort', (_e, id) => {
  const entry = inflight.get(id);
  if (entry) {
    entry.aborted = true;
    if (entry.destroy) entry.destroy();
  }
  return true;
});

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.json': 'application/json', '.xml': 'application/xml',
  '.html': 'text/html', '.csv': 'text/csv', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};
const guessMime = (name) => MIME_BY_EXT[path.extname(name).toLowerCase()] || 'application/octet-stream';

function buildMultipart(items) {
  const boundary = '----LostmanForm' + crypto.randomBytes(8).toString('hex');
  const chunks = [];
  const safe = (s) => String(s ?? '').replace(/"/g, '%22').replace(/[\r\n]/g, ' ');
  for (const it of items || []) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (it.type === 'file' && it.filePath) {
      const data = fsSync.readFileSync(it.filePath);
      const fname = path.basename(it.filePath);
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${safe(it.key)}"; filename="${safe(fname)}"\r\n` +
        `Content-Type: ${guessMime(fname)}\r\n\r\n`
      ));
      chunks.push(data, Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${safe(it.key)}"\r\n\r\n${it.value ?? ''}\r\n`
      ));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: 'multipart/form-data; boundary=' + boundary };
}

function headersToObj(list) {
  const o = {};
  for (const h of list || []) {
    const k = String(h.key || '').trim().toLowerCase();
    if (!k) continue;
    const v = h.value ?? '';
    if (k in o) {
      if (Array.isArray(o[k])) o[k].push(v);
      else o[k] = [o[k], v];
    } else {
      o[k] = v;
    }
  }
  return o;
}

function decompress(buf, encoding) {
  try {
    if (!encoding || !buf.length) return buf;
    const enc = String(encoding).toLowerCase();
    if (enc.includes('gzip')) return zlib.gunzipSync(buf);
    if (enc.includes('deflate')) {
      try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); }
    }
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('zstd') && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buf);
    return buf;
  } catch {
    return buf;
  }
}

function singleRequest(urlStr, method, headersObj, body, settings, cancel) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(Object.assign(new Error('Invalid URL: ' + urlStr), { code: 'ERR_INVALID_URL' }));
    }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) return reject(new Error('Unsupported protocol: ' + u.protocol));

    const hdrs = { ...headersObj };
    if (body && !('content-length' in hdrs)) hdrs['content-length'] = body.length;

    const options = { method, headers: hdrs, agent: false };
    if (u.protocol === 'https:' && settings.verifySsl === false) options.rejectUnauthorized = false;

    let timer = null;
    const reqObj = mod.request(u, options, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > MAX_BODY_BYTES) {
          reqObj.destroy(Object.assign(new Error('Response exceeded the 50 MB limit'), { code: 'ETOOBIG' }));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (timer) clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          rawHeaders: res.rawHeaders,
          headers: res.headers,
          buffer: decompress(Buffer.concat(chunks), res.headers['content-encoding']),
        });
      });
    });

    cancel.destroy = () => reqObj.destroy(Object.assign(new Error('Request cancelled'), { code: 'ABORTED' }));
    if (cancel.aborted) cancel.destroy();

    const t = Number(settings.timeoutMs) || 0;
    if (t > 0) {
      timer = setTimeout(() => {
        reqObj.destroy(Object.assign(new Error(`Request timed out after ${t} ms`), { code: 'ETIMEDOUT' }));
      }, t);
    }

    reqObj.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    if (body) reqObj.end(body);
    else reqObj.end();
  });
}

async function requestWithRedirects(urlStr, method, headersObj, body, settings, cancel) {
  let currentUrl = urlStr;
  let currentMethod = method;
  let currentBody = body;
  const hdrs = { ...headersObj };
  let redirects = 0;

  for (;;) {
    const res = await singleRequest(currentUrl, currentMethod, hdrs, currentBody, settings, cancel);
    const loc = res.headers.location;
    const isRedirect = res.statusCode >= 300 && res.statusCode < 400 && loc;
    if (!isRedirect || settings.followRedirects === false || redirects >= MAX_REDIRECTS) {
      return { ...res, finalUrl: currentUrl, redirects };
    }
    redirects++;
    const nextUrl = new URL(loc, currentUrl).toString();
    const dropBody =
      res.statusCode === 303 ||
      ((res.statusCode === 301 || res.statusCode === 302) && currentMethod !== 'GET' && currentMethod !== 'HEAD');
    if (dropBody) {
      currentMethod = currentMethod === 'HEAD' ? 'HEAD' : 'GET';
      currentBody = null;
      delete hdrs['content-type'];
      delete hdrs['content-length'];
    }
    currentUrl = nextUrl;
  }
}

/* ---------------- Digest auth ---------------- */

function parseDigestChallenge(h) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let m;
  while ((m = re.exec(h))) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

function buildDigestAuth(ch, method, urlObj, username, password, cnonceOverride) {
  const algo = ch.algorithm || 'MD5';
  const H = /sha-256/i.test(algo)
    ? (s) => crypto.createHash('sha256').update(s).digest('hex')
    : (s) => crypto.createHash('md5').update(s).digest('hex');
  const uri = urlObj.pathname + (urlObj.search || '');
  const cnonce = cnonceOverride || crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  let ha1 = H(`${username}:${ch.realm || ''}:${password}`);
  if (/-sess$/i.test(algo)) ha1 = H(`${ha1}:${ch.nonce}:${cnonce}`);
  const ha2 = H(`${method}:${uri}`);
  const qop = (ch.qop || '').split(',').map((s) => s.trim()).includes('auth') ? 'auth' : null;
  const response = qop ? H(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${ch.nonce}:${ha2}`);
  let auth = `Digest username="${username}", realm="${ch.realm || ''}", nonce="${ch.nonce || ''}", uri="${uri}", response="${response}"`;
  if (ch.algorithm) auth += `, algorithm=${ch.algorithm}`;
  if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (ch.opaque) auth += `, opaque="${ch.opaque}"`;
  return auth;
}

/* ---------------- AWS Signature v4 ---------------- */

function signAwsV4(req, headers, body) {
  const a = req.auth;
  const u = new URL(req.url);
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const sha256hex = (d) => crypto.createHash('sha256').update(d || '').digest('hex');
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = a.region || 'us-east-1';
  const service = a.service || 'execute-api';
  const payloadHash = sha256hex(body || '');

  headers['host'] = u.host;
  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = payloadHash;
  if (a.sessionToken) headers['x-amz-security-token'] = a.sessionToken;

  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const signedNames = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .filter((k) => k === 'host' || k === 'content-type' || k.startsWith('x-amz-'))
    .sort();
  const canonicalHeaders = signedNames
    .map((k) => `${k}:${String(Array.isArray(headers[k]) ? headers[k][0] : headers[k]).trim()}\n`)
    .join('');
  const canonicalQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1))
    .map((p) => p.join('='))
    .join('&');
  const canonicalUri =
    u.pathname
      .split('/')
      .map((seg) => {
        let d = seg;
        try {
          d = decodeURIComponent(seg);
        } catch {
          /* keep as-is */
        }
        return enc(d);
      })
      .join('/') || '/';

  const canonicalRequest = [req.method, canonicalUri, canonicalQuery, canonicalHeaders, signedNames.join(';'), payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  let key = hmac('AWS4' + (a.secretKey || ''), dateStamp);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, 'aws4_request');
  const signature = Buffer.from(hmac(key, stringToSign)).toString('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${a.accessKey}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;
}

function friendlyError(err) {
  const cause = (err && err.cause) || err || {};
  const code = cause.code || (err && err.code);
  const known = {
    ABORTED: 'Request cancelled',
    ENOTFOUND: 'Could not resolve host',
    EAI_AGAIN: 'DNS lookup failed (network down?)',
    ECONNREFUSED: 'Connection refused',
    ECONNRESET: 'Connection reset by the server',
    ETIMEDOUT: 'Connection timed out',
    EHOSTUNREACH: 'Host unreachable',
    ENETUNREACH: 'Network unreachable',
    ETOOBIG: 'Response exceeded the 50 MB limit',
    ERR_INVALID_URL: 'Invalid URL',
    ERR_INVALID_HTTP_TOKEN: 'A header name contains invalid characters',
    ERR_INVALID_CHAR: 'A header value contains invalid characters',
    CERT_HAS_EXPIRED: 'SSL certificate has expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed SSL certificate (you can disable SSL verification in Settings)',
    SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate in chain (you can disable SSL verification in Settings)',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify SSL certificate (you can disable SSL verification in Settings)',
    ERR_TLS_CERT_ALTNAME_INVALID: 'SSL certificate does not match hostname',
    ENOENT: 'File not found (check form-data file paths)',
  };
  let msg = known[code] || cause.message || (err && err.message) || 'Request failed';
  if (code === 'ETIMEDOUT' && err && err.message && err.message.includes('timed out after')) msg = err.message;
  if (code && !known[code]) msg += ` (${code})`;
  return msg;
}

ipcMain.handle('http:send', async (_e, req) => {
  const started = Date.now();
  const cancel = { aborted: false, destroy: null };
  inflight.set(req.id, cancel);
  const settings = req.settings || {};

  try {
    const headers = headersToObj(req.headers);
    let body = null;

    if (req.bodyMode === 'raw') {
      body = Buffer.from(req.rawBody ?? '', 'utf8');
    } else if (req.bodyMode === 'urlencoded') {
      const p = new URLSearchParams();
      for (const it of req.formItems || []) p.append(it.key, it.value ?? '');
      body = Buffer.from(p.toString(), 'utf8');
      if (!('content-type' in headers)) headers['content-type'] = 'application/x-www-form-urlencoded';
    } else if (req.bodyMode === 'formdata') {
      const mp = buildMultipart(req.formItems);
      body = mp.body;
      headers['content-type'] = mp.contentType;
    }

    if (!('accept' in headers)) headers['accept'] = '*/*';
    if (!('accept-encoding' in headers)) headers['accept-encoding'] = 'gzip, deflate, br';
    if (!('user-agent' in headers)) headers['user-agent'] = 'Lostman/1.3';

    if (req.auth && req.auth.type === 'awsv4') signAwsV4(req, headers, body);

    let res = await requestWithRedirects(req.url, req.method, headers, body, settings, cancel);

    if (req.auth && req.auth.type === 'digest' && res.statusCode === 401) {
      let challenge = null;
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        if (res.rawHeaders[i].toLowerCase() === 'www-authenticate' && /^digest/i.test(res.rawHeaders[i + 1])) {
          challenge = res.rawHeaders[i + 1];
          break;
        }
      }
      if (challenge) {
        headers['authorization'] = buildDigestAuth(
          parseDigestChallenge(challenge),
          req.method,
          new URL(req.url),
          req.auth.username || '',
          req.auth.password || ''
        );
        res = await requestWithRedirects(req.url, req.method, headers, body, settings, cancel);
      }
    }

    const buf = res.buffer;
    const contentType = String(res.headers['content-type'] || '');
    const isImage = /^image\//i.test(contentType) && !/svg/i.test(contentType);

    let bodyText = null;
    let bodyBase64 = null;
    let truncated = false;
    if (isImage) {
      bodyBase64 = buf.toString('base64');
    } else if (buf.length > MAX_TEXT_BYTES) {
      bodyText = buf.toString('utf8', 0, MAX_TEXT_BYTES);
      truncated = true;
    } else {
      bodyText = buf.toString('utf8');
    }

    const headerPairs = [];
    for (let i = 0; i < res.rawHeaders.length; i += 2) headerPairs.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);

    return {
      ok: true,
      status: res.statusCode,
      statusText: res.statusMessage || '',
      finalUrl: res.finalUrl,
      redirects: res.redirects,
      headers: headerPairs,
      timeMs: Date.now() - started,
      size: buf.length,
      contentType,
      bodyText,
      bodyBase64,
      truncated,
      bufId: cacheResponse(buf),
    };
  } catch (err) {
    return {
      ok: false,
      aborted: cancel.aborted || (err && err.code === 'ABORTED'),
      error: friendlyError(err),
      timeMs: Date.now() - started,
    };
  } finally {
    inflight.delete(req.id);
  }
});
