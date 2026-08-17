'use strict';

/* Lostman HTTP engine — pure Node, no Electron imports, shared by the desktop app's main
   process and the VS Code extension host. Covers request execution (proxy, mTLS, Digest,
   AWS SigV4, redirects, streaming decompression), response caching for exact-byte saves,
   and WebSocket / SSE streams. */

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
// Bodies beyond this stay on disk instead of memory; the first chunk is kept as a preview.
const STREAM_THRESHOLD = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 500 * 1024 * 1024;
const MAX_REDIRECTS = 10;

const inflight = new Map();

// Optional hook: the Electron host injects a Chromium-based system proxy resolver.
let systemProxyResolver = null;
function setSystemProxyResolver(fn) {
  systemProxyResolver = fn;
}

/* ---------------- response cache ---------------- */

// Entries are either a Buffer or { file } for streamed bodies.
const respCache = new Map();
function cacheResponse(entry) {
  const id = crypto.randomUUID();
  respCache.set(id, entry);
  while (respCache.size > 8) {
    const k = respCache.keys().next().value;
    const v = respCache.get(k);
    if (v && v.file) {
      try {
        fsSync.unlinkSync(v.file);
      } catch {
        /* already gone */
      }
    }
    respCache.delete(k);
  }
  return id;
}

async function saveResponseTo(bufId, filePath, fallbackText) {
  const entry = respCache.get(bufId);
  if (entry && entry.file) await fs.copyFile(entry.file, filePath);
  else await fs.writeFile(filePath, Buffer.isBuffer(entry) ? entry : Buffer.from(fallbackText ?? '', 'utf8'));
}

function cleanupTempFiles() {
  for (const v of respCache.values()) {
    if (v && v.file) {
      try {
        fsSync.unlinkSync(v.file);
      } catch {
        /* already gone */
      }
    }
  }
}

/* ---------------- multipart & headers ---------------- */

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

/* ---------------- proxy & client certificates ---------------- */

function parseProxyUrl(s) {
  try {
    const u = new URL(String(s).includes('://') ? s : 'http://' + s);
    return {
      host: u.hostname,
      port: parseInt(u.port, 10) || 8080,
      auth: u.username
        ? 'Basic ' + Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password || '')).toString('base64')
        : null,
    };
  } catch {
    return null;
  }
}

function hostInBypass(host, bypass) {
  if (!bypass) return false;
  const h = String(host).toLowerCase();
  return String(bypass)
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .some((b) => b === '*' || h === b || h.endsWith('.' + b));
}

async function resolveProxy(urlStr, proxyCfg) {
  const cfg = proxyCfg || {};
  if (!cfg.mode || cfg.mode === 'none') return null;
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  if (hostInBypass(u.hostname, cfg.bypass)) return null;
  if (cfg.mode === 'manual' && cfg.url) return parseProxyUrl(cfg.url);
  if (cfg.mode === 'system') {
    if (systemProxyResolver) {
      try {
        const r = await systemProxyResolver(urlStr);
        const m = r && r.match(/PROXY\s+([^:;\s]+):(\d+)/i);
        if (m) return { host: m[1], port: parseInt(m[2], 10), auth: null };
        return null;
      } catch {
        return null;
      }
    }
    const envProxy = (u.protocol === 'https:' ? process.env.HTTPS_PROXY : process.env.HTTP_PROXY) || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (envProxy) return parseProxyUrl(envProxy);
  }
  return null;
}

const certFileCache = new Map();
function readFileCached(p) {
  const st = fsSync.statSync(p);
  const key = p + ':' + st.mtimeMs;
  if (!certFileCache.has(key)) {
    certFileCache.set(key, fsSync.readFileSync(p));
    while (certFileCache.size > 16) certFileCache.delete(certFileCache.keys().next().value);
  }
  return certFileCache.get(key);
}

function certFor(hostname, certs) {
  const hn = String(hostname).toLowerCase();
  for (const c of certs || []) {
    const h = String(c.host || '').toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
    if (h && (hn === h || hn.endsWith('.' + h))) return c;
  }
  return null;
}

function applyClientCert(options, hostname, settings) {
  const cc = certFor(hostname, settings.clientCerts);
  if (!cc) return null;
  try {
    if (cc.type === 'pfx' && cc.pfxPath) {
      options.pfx = readFileCached(cc.pfxPath);
    } else {
      if (cc.certPath) options.cert = readFileCached(cc.certPath);
      if (cc.keyPath) options.key = readFileCached(cc.keyPath);
    }
    if (cc.passphrase) options.passphrase = cc.passphrase;
    return null;
  } catch (err) {
    return Object.assign(new Error(`Could not read the client certificate for ${cc.host}: ${err.message}`), {
      code: 'ECLIENTCERT',
    });
  }
}

/* ---------------- request core ---------------- */

function singleRequest(urlStr, method, headersObj, body, settings, cancel, proxy) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return reject(Object.assign(new Error('Invalid URL: ' + urlStr), { code: 'ERR_INVALID_URL' }));
    }
    const isHttps = u.protocol === 'https:';
    if (!isHttps && u.protocol !== 'http:') return reject(new Error('Unsupported protocol: ' + u.protocol));

    const hdrs = { ...headersObj };
    if (body && !('content-length' in hdrs)) hdrs['content-length'] = body.length;

    const options = { method, headers: hdrs, agent: false };
    if (isHttps && settings.verifySsl === false) options.rejectUnauthorized = false;
    if (isHttps) {
      const certErr = applyClientCert(options, u.hostname, settings);
      if (certErr) return reject(certErr);
    }

    let timer = null;
    let reqRef = null;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };

    const onResponse = (res) => {
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc.includes('gzip') || enc.includes('deflate')) {
        stream = res.pipe(zlib.createUnzip());
      } else if (enc.includes('br')) {
        stream = res.pipe(zlib.createBrotliDecompress());
      } else if (enc.includes('zstd') && zlib.createZstdDecompress) {
        stream = res.pipe(zlib.createZstdDecompress());
      }

      const chunks = [];
      let memBytes = 0;
      let total = 0;
      let fileStream = null;
      let tmpPath = null;

      stream.on('data', (c) => {
        total += c.length;
        if (total > MAX_BODY_BYTES) {
          if (reqRef) reqRef.destroy(Object.assign(new Error('Response exceeded the 500 MB limit'), { code: 'ETOOBIG' }));
          return;
        }
        if (memBytes < STREAM_THRESHOLD) {
          chunks.push(c);
          memBytes += c.length;
        } else {
          if (!fileStream) {
            tmpPath = path.join(os.tmpdir(), 'lostman-resp-' + crypto.randomBytes(6).toString('hex') + '.bin');
            fileStream = fsSync.createWriteStream(tmpPath);
            for (const ch of chunks) fileStream.write(ch);
          }
          fileStream.write(c);
        }
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          rawHeaders: res.rawHeaders,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
          totalSize: total,
          tmpFile: tmpPath,
        });
      };
      stream.on('end', () => {
        if (fileStream) fileStream.end(finish);
        else finish();
      });
      const onStreamError = (err) => {
        if (fileStream) {
          try {
            fileStream.destroy();
            fsSync.unlinkSync(tmpPath);
          } catch {
            /* best effort */
          }
        }
        fail(err);
      };
      stream.on('error', onStreamError);
      if (stream !== res) res.on('error', onStreamError);
    };

    const fire = (reqObj) => {
      reqRef = reqObj;
      cancel.destroy = () => reqObj.destroy(Object.assign(new Error('Request cancelled'), { code: 'ABORTED' }));
      if (cancel.aborted) cancel.destroy();
      const timeoutMs = Number(settings.timeoutMs) || 0;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          reqObj.destroy(Object.assign(new Error(`Request timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' }));
        }, timeoutMs);
      }
      reqObj.on('error', fail);
      if (body) reqObj.end(body);
      else reqObj.end();
    };

    if (proxy && !isHttps) {
      fire(
        http.request(
          {
            host: proxy.host,
            port: proxy.port,
            method,
            path: u.href,
            agent: false,
            headers: { ...hdrs, host: u.host, ...(proxy.auth ? { 'proxy-authorization': proxy.auth } : {}) },
          },
          onResponse
        )
      );
    } else if (proxy && isHttps) {
      const targetPort = u.port || 443;
      const creq = http.request({
        host: proxy.host,
        port: proxy.port,
        method: 'CONNECT',
        path: `${u.hostname}:${targetPort}`,
        headers: { host: `${u.hostname}:${targetPort}`, ...(proxy.auth ? { 'proxy-authorization': proxy.auth } : {}) },
      });
      creq.on('connect', (cres, socket) => {
        if (cres.statusCode !== 200) {
          socket.destroy();
          return fail(new Error(`Proxy CONNECT failed: HTTP ${cres.statusCode}`));
        }
        const tlsOpts = { socket, servername: u.hostname };
        if (settings.verifySsl === false) tlsOpts.rejectUnauthorized = false;
        for (const k of ['pfx', 'cert', 'key', 'passphrase']) if (options[k]) tlsOpts[k] = options[k];
        delete options.agent;
        options.createConnection = () => tls.connect(tlsOpts);
        fire(https.request(u, options, onResponse));
      });
      creq.on('error', fail);
      creq.end();
    } else {
      fire((isHttps ? https : http).request(u, options, onResponse));
    }
  });
}

async function requestWithRedirects(urlStr, method, headersObj, body, settings, cancel) {
  let currentUrl = urlStr;
  let currentMethod = method;
  let currentBody = body;
  const hdrs = { ...headersObj };
  let redirects = 0;

  for (;;) {
    const proxy = await resolveProxy(currentUrl, settings.proxy);
    const res = await singleRequest(currentUrl, currentMethod, hdrs, currentBody, settings, cancel, proxy);
    const loc = res.headers.location;
    const isRedirect = res.statusCode >= 300 && res.statusCode < 400 && loc;
    if (!isRedirect || settings.followRedirects === false || redirects >= MAX_REDIRECTS) {
      return { ...res, finalUrl: currentUrl, redirects };
    }
    if (res.tmpFile) {
      try {
        fsSync.unlinkSync(res.tmpFile);
      } catch {
        /* best effort */
      }
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
    ETOOBIG: 'Response exceeded the 500 MB limit',
    ERR_INVALID_URL: 'Invalid URL',
    ECLIENTCERT: 'Could not load the client certificate (check the file paths in Settings)',
    'Z_DATA_ERROR': 'Failed to decompress the response (content-encoding mismatch)',
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

/* ---------------- top-level API ---------------- */

function abort(id) {
  const entry = inflight.get(id);
  if (entry) {
    entry.aborted = true;
    if (entry.destroy) entry.destroy();
  }
}

async function sendHttp(req) {
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
    if (!('user-agent' in headers)) headers['user-agent'] = 'Lostman/1.5';

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
    const fullSize = res.totalSize ?? buf.length;
    const contentType = String(res.headers['content-type'] || '');
    const isImage = /^image\//i.test(contentType) && !/svg/i.test(contentType);

    let bodyText = null;
    let bodyBase64 = null;
    let truncated = false;
    if (isImage && !res.tmpFile) {
      bodyBase64 = buf.toString('base64');
    } else if (isImage && res.tmpFile) {
      bodyText = `[large binary ${contentType} response — use Save to write it to a file]`;
      truncated = true;
    } else if (buf.length > MAX_TEXT_BYTES) {
      bodyText = buf.toString('utf8', 0, MAX_TEXT_BYTES);
      truncated = true;
    } else {
      bodyText = buf.toString('utf8');
      truncated = fullSize > buf.length;
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
      size: fullSize,
      contentType,
      bodyText,
      bodyBase64,
      truncated,
      bufId: cacheResponse(res.tmpFile ? { file: res.tmpFile } : buf),
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
}

/* ---------------- WebSocket / SSE streams ---------------- */

const streams = new Map();

function openStream({ id, kind, url, headers }, emit) {
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
}

function streamSend(id, message) {
  const s = streams.get(id);
  if (s && s.send) s.send(message);
}

function streamClose(id) {
  const s = streams.get(id);
  if (s) s.close();
  streams.delete(id);
}

module.exports = {
  sendHttp,
  abort,
  saveResponseTo,
  cleanupTempFiles,
  openStream,
  streamSend,
  streamClose,
  setSystemProxyResolver,
  // exposed for unit tests
  parseDigestChallenge,
  buildDigestAuth,
  signAwsV4,
  parseProxyUrl,
  hostInBypass,
  certFor,
  headersToObj,
  buildMultipart,
  friendlyError,
};
