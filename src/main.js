const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

// Keep the userData path ("Lostman") consistent between dev and packaged builds.
app.setName('Lostman');
Menu.setApplicationMenu(null);

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const inflight = new Map();
const dataFile = () => path.join(app.getPath('userData'), 'lostman-data.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#17171a',
    title: 'Lostman',
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

ipcMain.handle('http:abort', (_e, id) => {
  inflight.get(id)?.abort();
  return true;
});

function friendlyError(err) {
  if (err && err.name === 'AbortError') return 'Request cancelled';
  const cause = (err && err.cause) || err || {};
  const code = cause.code;
  const known = {
    ENOTFOUND: 'Could not resolve host',
    EAI_AGAIN: 'DNS lookup failed (network down?)',
    ECONNREFUSED: 'Connection refused',
    ECONNRESET: 'Connection reset by the server',
    ETIMEDOUT: 'Connection timed out',
    EHOSTUNREACH: 'Host unreachable',
    ENETUNREACH: 'Network unreachable',
    CERT_HAS_EXPIRED: 'SSL certificate has expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed SSL certificate',
    SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate in chain',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify SSL certificate',
    ERR_TLS_CERT_ALTNAME_INVALID: 'SSL certificate does not match hostname',
  };
  let msg = known[code] || cause.message || (err && err.message) || 'Request failed';
  if (code && !known[code]) msg = `${msg}`;
  if (code) msg += ` (${code})`;
  return msg;
}

ipcMain.handle('http:send', async (_e, req) => {
  const controller = new AbortController();
  inflight.set(req.id, controller);
  const started = Date.now();
  try {
    let body;
    if (req.bodyMode === 'raw') {
      body = req.rawBody ?? '';
    } else if (req.bodyMode === 'urlencoded') {
      const p = new URLSearchParams();
      for (const f of req.formItems || []) p.append(f.key, f.value ?? '');
      body = p;
    } else if (req.bodyMode === 'formdata') {
      const fd = new FormData();
      for (const f of req.formItems || []) fd.append(f.key, f.value ?? '');
      body = fd;
    }

    const res = await fetch(req.url, {
      method: req.method,
      headers: (req.headers || []).map((h) => [h.key, h.value ?? '']),
      body,
      redirect: 'follow',
      signal: controller.signal,
    });

    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
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

    const headers = [];
    const hasGetSetCookie = typeof res.headers.getSetCookie === 'function';
    res.headers.forEach((v, k) => {
      if (!(hasGetSetCookie && k === 'set-cookie')) headers.push([k, v]);
    });
    if (hasGetSetCookie) {
      for (const v of res.headers.getSetCookie()) headers.push(['set-cookie', v]);
    }

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      finalUrl: res.url,
      headers,
      timeMs: Date.now() - started,
      size: buf.length,
      contentType,
      bodyText,
      bodyBase64,
      truncated,
    };
  } catch (err) {
    return {
      ok: false,
      aborted: !!(err && err.name === 'AbortError'),
      error: friendlyError(err),
      timeMs: Date.now() - started,
    };
  } finally {
    inflight.delete(req.id);
  }
});
