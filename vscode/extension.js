'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const engine = require('./media/core/engine.js');

const panels = new Set();

function storeFile(context) {
  return path.join(context.globalStorageUri.fsPath, 'lostman-data.json');
}

function loadStore(context) {
  try {
    return JSON.parse(fs.readFileSync(storeFile(context), 'utf8'));
  } catch {
    return null;
  }
}

// Once per day, snapshot the data file into backups/ and keep the last 7.
function rotateBackups(file) {
  try {
    if (!fs.existsSync(file)) return;
    const dir = path.join(path.dirname(file), 'backups');
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `lostman-${stamp}.json`);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, target);
    const files = fs.readdirSync(dir).filter((f) => /^lostman-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > 7) fs.unlinkSync(path.join(dir, files.shift()));
  } catch {
    /* best effort */
  }
}

function saveStore(context, data) {
  const file = storeFile(context);
  rotateBackups(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function buildHtml(webview, context) {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'renderer');
  let html = fs.readFileSync(path.join(context.extensionUri.fsPath, 'media', 'renderer', 'index.html'), 'utf8');

  html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, '');

  const base = `<base href="${webview.asWebviewUri(mediaRoot)}/">`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:; frame-src data: about:;">`;
  html = html.replace('<title>', `${csp}\n  ${base}\n  <title>`);

  const shimUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'shim.js'));
  html = html.replace('<script src="i18n.js"></script>', `<script src="${shimUri}"></script>\n  <script src="i18n.js"></script>`);
  return html;
}

function oauthAuthorize({ authUrl, redirectUri }) {
  let u;
  try {
    u = new URL(redirectUri);
  } catch {
    return Promise.resolve({ error: 'Invalid redirect URI' });
  }
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    return Promise.resolve({ error: 'In VS Code, use a localhost redirect URI (e.g. http://127.0.0.1:8231/callback)' });
  }
  const port = parseInt(u.port, 10) || 80;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };
    const server = http.createServer((req, res) => {
      const ru = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname !== '/' && ru.pathname !== u.pathname) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif"><h3>Lostman: sign-in complete.</h3>You can close this tab and return to VS Code.</body></html>');
      finish({ code: ru.searchParams.get('code'), state: ru.searchParams.get('state'), error: ru.searchParams.get('error') });
    });
    const timer = setTimeout(() => finish({ error: 'Timed out waiting for the sign-in redirect' }), 180000);
    server.on('error', (err) => finish({ error: 'Could not listen on the redirect port: ' + err.message }));
    server.listen(port, '127.0.0.1', () => {
      vscode.env.openExternal(vscode.Uri.parse(authUrl));
    });
  });
}

async function handleRpc(panel, context, msg, ownStreams) {
  const { id, method, args } = msg || {};
  const reply = (result) => {
    try {
      panel.webview.postMessage({ rpcId: id, result });
    } catch {
      /* panel gone */
    }
  };
  try {
    switch (method) {
      case 'http:send':
        reply(await engine.sendHttp(args));
        break;
      case 'http:abort':
        engine.abort(args);
        reply(true);
        break;
      case 'store:load':
        reply(loadStore(context));
        break;
      case 'store:save':
        saveStore(context, args);
        for (const p of panels) {
          if (p !== panel) {
            try {
              p.webview.postMessage({ event: 'storeChanged', data: args });
            } catch {
              /* panel gone */
            }
          }
        }
        reply(true);
        break;
      case 'store:info':
        reply({ path: storeFile(context), portable: false, portableAvailable: false });
        break;
      case 'store:setPortable':
        reply({ ok: false, error: 'Portable mode is only available in the desktop app' });
        break;
      case 'dialog:pickFile': {
        const r = await vscode.window.showOpenDialog({ canSelectMany: false });
        reply(r && r[0] ? r[0].fsPath : null);
        break;
      }
      case 'resp:save': {
        const r = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(require('os').homedir(), args.defaultName || 'response')),
        });
        if (!r) {
          reply(false);
          break;
        }
        await engine.saveResponseTo(args.bufId, r.fsPath, args.fallbackText);
        reply(true);
        break;
      }
      case 'file:open': {
        const r = await vscode.window.showOpenDialog({ canSelectMany: false });
        if (!r || !r[0]) {
          reply(null);
          break;
        }
        try {
          reply({ name: path.basename(r[0].fsPath), content: fs.readFileSync(r[0].fsPath, 'utf8') });
        } catch (err) {
          reply({ error: String((err && err.message) || err) });
        }
        break;
      }
      case 'file:saveText': {
        const r = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(require('os').homedir(), args.defaultName || 'export.json')),
        });
        if (!r) {
          reply(false);
          break;
        }
        fs.writeFileSync(r.fsPath, args.content, 'utf8');
        reply(true);
        break;
      }
      case 'oauth:authorize':
        reply(await oauthAuthorize(args));
        break;
      case 'stream:open': {
        ownStreams.add(args.id);
        const ok = engine.openStream(args, (type, data) => {
          try {
            panel.webview.postMessage({ event: 'stream', data: { id: args.id, type, data: data ?? '', ts: Date.now() } });
          } catch {
            /* panel gone */
          }
        });
        reply(ok);
        break;
      }
      case 'stream:send':
        engine.streamSend(args.id, args.message);
        reply(true);
        break;
      case 'stream:close':
        engine.streamClose(args.id);
        ownStreams.delete(args.id);
        reply(true);
        break;
      case 'app:newWindow':
        createPanel(context);
        reply(true);
        break;
      default:
        reply(null);
    }
  } catch (err) {
    reply({ ok: false, error: String((err && err.message) || err) });
  }
}

function createPanel(context) {
  const panel = vscode.window.createWebviewPanel('lostman', 'Lostman', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
  });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
  panel.webview.html = buildHtml(panel.webview, context);
  panels.add(panel);
  const ownStreams = new Set();
  panel.webview.onDidReceiveMessage((msg) => handleRpc(panel, context, msg, ownStreams));
  panel.onDidDispose(() => {
    panels.delete(panel);
    for (const sid of ownStreams) engine.streamClose(sid);
  });
  return panel;
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('lostman.open', () => createPanel(context)));
}

function deactivate() {
  engine.cleanupTempFiles();
}

module.exports = { activate, deactivate };
