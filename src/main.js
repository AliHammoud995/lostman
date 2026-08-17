const { app, BrowserWindow, Menu, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const engine = require('./core/engine');

// Keep the userData path ("Lostman") consistent between dev and packaged builds.
app.setName('Lostman');
Menu.setApplicationMenu(null);

// Portable mode: if lostman-data.json sits next to the executable, use it.
function dataLocations() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  const portablePath = path.join(portableDir, 'lostman-data.json');
  const standardPath = path.join(app.getPath('userData'), 'lostman-data.json');
  const portable = fsSync.existsSync(portablePath);
  return { portableDir, portablePath, standardPath, portable };
}
const dataFile = () => {
  const loc = dataLocations();
  return loc.portable ? loc.portablePath : loc.standardPath;
};

app.on('will-quit', () => engine.cleanupTempFiles());

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

function initAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', async (info) => {
      const win = BrowserWindow.getAllWindows()[0];
      const r = await dialog.showMessageBox(win, {
        type: 'info',
        message: `Lostman ${info.version} has been downloaded.`,
        detail: 'Restart the app to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch {
    /* updater unavailable (e.g. portable build) */
  }
}

app.whenReady().then(() => {
  engine.setSystemProxyResolver((urlStr) => session.defaultSession.resolveProxy(urlStr));
  createWindow();
  initAutoUpdate();
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('app:newWindow', () => {
  createWindow();
  return true;
});

/* ---------------- store ---------------- */

ipcMain.handle('store:load', async () => {
  try {
    return JSON.parse(await fs.readFile(dataFile(), 'utf8'));
  } catch {
    return null;
  }
});

// Once per day, snapshot the data file into backups/ and keep the last 7.
function rotateBackups(file) {
  try {
    if (!fsSync.existsSync(file)) return;
    const dir = path.join(path.dirname(file), 'backups');
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `lostman-${stamp}.json`);
    if (fsSync.existsSync(target)) return;
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.copyFileSync(file, target);
    const files = fsSync.readdirSync(dir).filter((f) => /^lostman-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > 7) fsSync.unlinkSync(path.join(dir, files.shift()));
  } catch {
    /* best effort */
  }
}

ipcMain.handle('store:save', async (e, data) => {
  const file = dataFile();
  rotateBackups(file);
  const tmp = file + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('store:changed', data);
  }
  return true;
});

ipcMain.handle('store:info', () => {
  const loc = dataLocations();
  let portableAvailable = true;
  try {
    fsSync.accessSync(loc.portableDir, fsSync.constants.W_OK);
  } catch {
    portableAvailable = false;
  }
  return { path: dataFile(), portable: loc.portable, portableAvailable, portableDir: loc.portableDir };
});

ipcMain.handle('store:setPortable', async (_e, on) => {
  const loc = dataLocations();
  try {
    if (on && !loc.portable) {
      const current = fsSync.existsSync(loc.standardPath) ? loc.standardPath : null;
      if (current) await fs.copyFile(current, loc.portablePath);
      else await fs.writeFile(loc.portablePath, JSON.stringify({ version: 2 }));
    } else if (!on && loc.portable) {
      await fs.mkdir(path.dirname(loc.standardPath), { recursive: true });
      await fs.copyFile(loc.portablePath, loc.standardPath);
      await fs.unlink(loc.portablePath);
    }
    return { ok: true, path: dataFile() };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
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
  await engine.saveResponseTo(bufId, r.filePath, fallbackText);
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

ipcMain.handle('file:saveText', async (e, { defaultName, content }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName || 'export.json', filters: JSON_FILTERS });
  if (r.canceled || !r.filePath) return false;
  await fs.writeFile(r.filePath, content, 'utf8');
  return true;
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

/* ---------------- HTTP + streams (delegated to the shared engine) ---------------- */

ipcMain.handle('http:send', (_e, req) => engine.sendHttp(req));

ipcMain.handle('http:abort', (_e, id) => {
  engine.abort(id);
  return true;
});

ipcMain.handle('stream:open', (e, opts) => {
  const wc = e.sender;
  const emit = (type, data) => {
    try {
      wc.send('stream:event', { id: opts.id, type, data: data ?? '', ts: Date.now() });
    } catch {
      /* window gone */
    }
  };
  return engine.openStream(opts, emit);
});

ipcMain.handle('stream:send', (_e, { id, message }) => {
  engine.streamSend(id, message);
  return true;
});

ipcMain.handle('stream:close', (_e, { id }) => {
  engine.streamClose(id);
  return true;
});
