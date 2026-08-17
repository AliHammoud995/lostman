'use strict';

/* ============================== helpers ============================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const uid = () => crypto.randomUUID();

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n}m ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h ago', { n: Math.floor(s / 3600) });
  return t('{n}d ago', { n: Math.floor(s / 86400) });
}

const basename = (p) => String(p).split(/[\\/]/).pop();

function toast(msg) {
  const node = el('div', 'toast', msg);
  $('#toastRoot').append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, 2200);
}

function splitUrl(url) {
  const i = String(url).indexOf('?');
  return i === -1 ? [String(url), ''] : [String(url).slice(0, i), String(url).slice(i + 1)];
}

function safeDecode(s) {
  try {
    return decodeURIComponent(String(s).replace(/\+/g, ' '));
  } catch {
    return String(s);
  }
}

// Encode for the URL bar but keep {{variables}} readable.
function prettyEncode(s) {
  return encodeURIComponent(String(s)).replace(/%7B/gi, '{').replace(/%7D/gi, '}');
}

function parseQuery(qs) {
  const out = [];
  if (!qs) return out;
  for (const part of qs.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? '' : part.slice(eq + 1);
    out.push({ key: safeDecode(k), value: safeDecode(v) });
  }
  return out;
}

/* ============================== state ============================== */

const METHOD_SHORT = { DELETE: 'DEL', OPTIONS: 'OPT' };
const shortMethod = (m) => METHOD_SHORT[m] || m;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const DEFAULT_SETTINGS = {
  language: 'en',
  theme: 'dark',
  timeoutMs: 0,
  followRedirects: true,
  verifySsl: true,
  codeLang: 'curl',
  cookiesEnabled: true,
  proxy: { mode: 'none', url: '', bypass: '' },
  clientCerts: [],
};

function blankRequest() {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    bodyMode: 'none',
    rawType: 'json',
    rawBody: '',
    formItems: [],
    gqlQuery: '',
    gqlVariables: '',
    preScript: '',
    testScript: '',
    auth: {
      type: 'none',
      token: '',
      username: '',
      password: '',
      keyName: '',
      keyValue: '',
      addTo: 'header',
      grant: 'client_credentials',
      authUrl: '',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      redirectUri: 'http://localhost/lostman-callback',
      clientAuth: 'body',
      accessToken: '',
      tokenType: 'Bearer',
      expiresAt: 0,
      accessKey: '',
      secretKey: '',
      region: '',
      service: '',
      sessionToken: '',
    },
  };
}

function newKvRow() {
  return { id: uid(), key: '', value: '', enabled: true, type: 'text', filePath: '' };
}

function normalizeRequest(r) {
  const base = blankRequest();
  const out = { ...base, ...(r || {}) };
  out.auth = { ...base.auth, ...((r && r.auth) || {}) };
  for (const k of ['params', 'headers', 'formItems']) {
    if (!Array.isArray(out[k])) out[k] = [];
    out[k] = out[k].map((row) => ({
      id: row.id || uid(),
      key: row.key || '',
      value: row.value || '',
      enabled: row.enabled !== false,
      type: row.type === 'file' ? 'file' : 'text',
      filePath: row.filePath || '',
    }));
  }
  // Merge any query pairs embedded in the URL into the params table (pre-sync data).
  const [, qs] = splitUrl(out.url || '');
  for (const pair of parseQuery(qs)) {
    if (!out.params.some((p) => p.key === pair.key && p.value === pair.value)) {
      out.params.push({ ...newKvRow(), key: pair.key, value: pair.value });
    }
  }
  return out;
}

function makeTab(request, name, savedRef) {
  return {
    id: uid(),
    name: name || null,
    savedRef: savedRef || null,
    request: normalizeRequest(request),
    response: null,
    sending: null,
    respTab: 'body',
    respView: 'pretty',
    search: null,
  };
}

const state = {
  tabs: [],
  activeTabId: null,
  collections: [],
  history: [],
  environments: [],
  activeEnvId: null,
  globals: [],
  cookies: [],
  sideView: 'collections',
  sideFilter: '',
  settings: { ...DEFAULT_SETTINGS },
};

const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId);

// Last response per named request, for {{res.Name.body.path}} chaining. In-memory only.
const chainStore = new Map();

/* ============================== persistence ============================== */

function snapshot() {
  return {
    version: 2,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((t) => ({ id: t.id, name: t.name, savedRef: t.savedRef, request: t.request })),
    collections: state.collections,
    history: state.history,
    environments: state.environments,
    activeEnvId: state.activeEnvId,
    globals: state.globals,
    cookies: state.cookies,
    settings: state.settings,
  };
}

const persist = debounce(() => window.lostman.saveStore(snapshot()), 400);

/* ============================== environments ============================== */

function varMap(extra) {
  const m = {};
  for (const v of state.globals) if (v.enabled !== false && v.key) m[v.key] = v.value ?? '';
  const env = state.environments.find((e) => e.id === state.activeEnvId);
  if (env) for (const v of env.vars) if (v.enabled !== false && v.key) m[v.key] = v.value ?? '';
  if (extra) for (const [k, v] of Object.entries(extra)) m[k] = v ?? '';
  return m;
}

const CHAIN_RE = /\{\{\s*res\.([^.{}]+?)\.(status|body|headers)((?:\.[\w[\]-]+)*)\s*\}\}/g;

function resolveChain(str) {
  return String(str).replace(CHAIN_RE, (match, name, kind, pathStr) => {
    const rec = chainStore.get(name.trim());
    if (!rec) return match;
    if (kind === 'status') return String(rec.status);
    if (kind === 'headers') {
      const key = (pathStr || '').replace(/^\./, '').toLowerCase();
      return rec.headers[key] ?? match;
    }
    if (!pathStr) return rec.text;
    let cur = rec.json;
    for (const seg of pathStr.replace(/^\./, '').split('.')) {
      if (cur == null) return match;
      cur = cur[seg.replace(/[[\]]/g, '')];
    }
    if (cur == null) return match;
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  });
}

function setChain(name, res) {
  if (!res || !res.ok) return;
  let json = null;
  try {
    json = JSON.parse(res.bodyText || 'null');
  } catch {
    /* not JSON */
  }
  const rec = {
    status: res.status,
    headers: Object.fromEntries((res.headers || []).map(([k, v]) => [k.toLowerCase(), v])),
    text: res.bodyText || '',
    json,
  };
  if (name) chainStore.set(name, rec);
  chainStore.set('last', rec);
}

function applyEnv(s, extra) {
  if (!s) return s ?? '';
  let out = resolveChain(s);
  const m = varMap(extra);
  out = out.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => (name in m ? m[name] : match));
  return out;
}

function renderEnvSelect() {
  const sel = $('#envSelect');
  sel.innerHTML = '';
  const none = el('option', null, t('No Environment'));
  none.value = '';
  sel.append(none);
  for (const env of state.environments) {
    const o = el('option', null, env.name);
    o.value = env.id;
    sel.append(o);
  }
  sel.value = state.environments.some((e) => e.id === state.activeEnvId) ? state.activeEnvId : '';
}

/* ============================== theme & settings ============================== */

function applyTheme() {
  document.body.classList.toggle('light', state.settings.theme === 'light');
}

function openSettings() {
  const s = state.settings;
  const body = el('div');

  const fLang = el('div', 'form-field');
  fLang.append(el('label', null, t('Language')));
  const langSel = document.createElement('select');
  for (const [v, label] of [['en', 'English'], ['ar', 'العربية'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch']]) {
    const o = el('option', null, label);
    o.value = v;
    langSel.append(o);
  }
  langSel.value = s.language || 'en';
  fLang.append(langSel);

  const fTheme = el('div', 'form-field');
  fTheme.append(el('label', null, t('Theme')));
  const themeSel = document.createElement('select');
  for (const [v, label] of [['dark', t('Dark')], ['light', t('Light')]]) {
    const o = el('option', null, label);
    o.value = v;
    themeSel.append(o);
  }
  themeSel.value = s.theme;
  fTheme.append(themeSel);

  const fTimeout = el('div', 'form-field');
  fTimeout.append(el('label', null, t('Request timeout (milliseconds, 0 = no timeout)')));
  const timeoutInput = document.createElement('input');
  timeoutInput.type = 'number';
  timeoutInput.min = '0';
  timeoutInput.step = '500';
  timeoutInput.value = String(s.timeoutMs);
  fTimeout.append(timeoutInput);

  const cRedir = el('label', 'form-check');
  const redirCb = document.createElement('input');
  redirCb.type = 'checkbox';
  redirCb.checked = s.followRedirects !== false;
  cRedir.append(redirCb, el('span', null, t('Follow redirects automatically')));

  const cSsl = el('label', 'form-check');
  const sslCb = document.createElement('input');
  sslCb.type = 'checkbox';
  sslCb.checked = s.verifySsl !== false;
  cSsl.append(sslCb, el('span', null, t('Verify SSL certificates')));
  const sslNote = el('div', 'form-note', t('Turn off only for local servers with self-signed certificates.'));

  const fProxy = el('div', 'form-field');
  fProxy.append(el('label', null, t('Proxy')));
  const proxySel = document.createElement('select');
  for (const [v, label] of [['none', t('No proxy')], ['system', t('Use system proxy')], ['manual', t('Manual proxy')]]) {
    const o = el('option', null, label);
    o.value = v;
    proxySel.append(o);
  }
  proxySel.value = s.proxy.mode || 'none';
  fProxy.append(proxySel);

  const proxyUrlField = el('div', 'form-field');
  proxyUrlField.append(el('label', null, t('Proxy URL (http://user:pass@host:port)')));
  const proxyUrlInput = document.createElement('input');
  proxyUrlInput.type = 'text';
  proxyUrlInput.spellcheck = false;
  proxyUrlInput.placeholder = 'http://127.0.0.1:8888';
  proxyUrlInput.value = s.proxy.url || '';
  proxyUrlField.append(proxyUrlInput);

  const proxyBypassField = el('div', 'form-field');
  proxyBypassField.append(el('label', null, t('Bypass proxy for (comma-separated hosts)')));
  const proxyBypassInput = document.createElement('input');
  proxyBypassInput.type = 'text';
  proxyBypassInput.spellcheck = false;
  proxyBypassInput.placeholder = 'localhost, 127.0.0.1, .internal.dev';
  proxyBypassInput.value = s.proxy.bypass || '';
  proxyBypassField.append(proxyBypassInput);

  const syncProxyVisibility = () => {
    proxyUrlField.classList.toggle('hidden', proxySel.value !== 'manual');
    proxyBypassField.classList.toggle('hidden', proxySel.value === 'none');
  };
  proxySel.addEventListener('change', syncProxyVisibility);
  syncProxyVisibility();

  const fCerts = el('div', 'form-field');
  fCerts.append(el('label', null, t('Client certificates (mTLS)')));
  const certList = el('div');
  const renderCerts = () => {
    certList.innerHTML = '';
    if (!state.settings.clientCerts.length) {
      certList.append(el('div', 'panel-hint', t('None configured. Certificates are matched by hostname and used automatically.')));
      return;
    }
    for (const c of state.settings.clientCerts) {
      const row = el('div', 'cookie-row');
      row.append(el('span', 'ck-name', c.host), el('span', 'ck-meta', c.type === 'pfx' ? 'PFX/P12' : t('PEM cert + key')));
      const del = el('button', 'kv-del', '✕');
      del.addEventListener('click', () => {
        state.settings.clientCerts = state.settings.clientCerts.filter((x) => x !== c);
        persist();
        renderCerts();
      });
      row.append(del);
      certList.append(row);
    }
  };
  renderCerts();
  const addCertBtn = el('button', null, t('+ Add certificate…'));
  addCertBtn.style.marginTop = '6px';
  addCertBtn.addEventListener('click', () => openCertModal(renderCerts));
  fCerts.append(certList, addCertBtn);

  const fData = el('div', 'form-field');
  fData.append(el('label', null, t('Data')));
  const dataRow = el('div');
  dataRow.style.display = 'flex';
  dataRow.style.gap = '8px';
  const backupBtn = el('button', null, t('Export backup…'));
  backupBtn.title = t('Save all collections, history, environments, tabs and settings to a file');
  backupBtn.addEventListener('click', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const ok = await window.lostman.saveTextFile({
      defaultName: `lostman-backup-${stamp}.json`,
      content: JSON.stringify(snapshot(), null, 2),
    });
    if (ok) toast(t('Backup exported'));
  });
  const restoreBtn = el('button', null, t('Restore backup…'));
  restoreBtn.title = t('Replace all app data with a previously exported backup');
  restoreBtn.addEventListener('click', async () => {
    const f = await window.lostman.openFile();
    if (!f) return;
    if (f.error) {
      toast(f.error);
      return;
    }
    if (importFromJsonText(f.content)) m.close();
  });
  dataRow.append(backupBtn, restoreBtn);
  fData.append(dataRow);

  const dataInfo = el('div', 'panel-hint', t('Data file: {path}', { path: '…' }));
  dataInfo.style.marginTop = '8px';
  const portableBtn = el('button', null, '…');
  portableBtn.style.marginTop = '4px';
  const refreshDataInfo = async () => {
    const info = await window.lostman.storeInfo();
    dataInfo.textContent = t('Data file: {path}', { path: info.path });
    if (info.portable) {
      portableBtn.textContent = t('Switch to standard mode (AppData)');
      portableBtn.disabled = false;
    } else {
      portableBtn.textContent = t('Switch to portable mode (store data next to the app)');
      portableBtn.disabled = !info.portableAvailable;
      portableBtn.title = info.portableAvailable ? '' : t('The app folder is not writable');
    }
  };
  portableBtn.addEventListener('click', async () => {
    const info = await window.lostman.storeInfo();
    const r = await window.lostman.setPortable(!info.portable);
    if (r.ok) {
      persist();
      toast(t('Data location changed'));
    } else {
      toast(r.error || t('Could not change the data location'));
    }
    refreshDataInfo();
  });
  refreshDataInfo();
  fData.append(dataInfo, portableBtn);

  body.append(fLang, fTheme, fTimeout, cRedir, cSsl, sslNote, fProxy, proxyUrlField, proxyBypassField, fCerts, fData);

  const m = modal(t('Settings'), body, [
    { label: t('Cancel') },
    {
      label: t('Save'),
      primary: true,
      onClick: () => {
        const langChanged = (state.settings.language || 'en') !== langSel.value;
        state.settings = {
          ...state.settings,
          language: langSel.value,
          theme: themeSel.value === 'light' ? 'light' : 'dark',
          timeoutMs: Math.max(0, parseInt(timeoutInput.value, 10) || 0),
          followRedirects: redirCb.checked,
          verifySsl: sslCb.checked,
          proxy: {
            mode: proxySel.value,
            url: proxyUrlInput.value.trim(),
            bypass: proxyBypassInput.value.trim(),
          },
        };
        applyTheme();
        if (langChanged) {
          setLocale(state.settings.language);
          renderEnvSelect();
          renderSidebar();
          renderTabsBar();
          loadEditor();
        }
        persist();
        toast(t('Settings saved'));
      },
    },
  ]);
}

function openCertModal(onDone) {
  const body = el('div');

  const fHost = el('div', 'form-field');
  fHost.append(el('label', null, t('Hostname (e.g. api.example.com or *.example.com)')));
  const hostInput = document.createElement('input');
  hostInput.type = 'text';
  hostInput.spellcheck = false;
  fHost.append(hostInput);

  const fType = el('div', 'form-field');
  fType.append(el('label', null, t('Certificate type')));
  const typeSel = document.createElement('select');
  for (const [v, label] of [['pfx', 'PFX / PKCS#12 (.pfx / .p12)'], ['pem', t('PEM certificate + key')]]) {
    const o = el('option', null, label);
    o.value = v;
    typeSel.append(o);
  }
  fType.append(typeSel);

  const mkFilePick = (labelText) => {
    const field = el('div', 'form-field');
    field.append(el('label', null, labelText));
    const btn = el('button', 'kv-file-btn', t('Choose file…'));
    btn.style.width = '100%';
    let filePath = '';
    btn.addEventListener('click', async () => {
      const p = await window.lostman.pickFile();
      if (p) {
        filePath = p;
        btn.textContent = basename(p);
        btn.title = p;
      }
    });
    field.append(btn);
    return { field, get path() { return filePath; } };
  };

  const pfxPick = mkFilePick(t('PFX file'));
  const certPick = mkFilePick(t('Certificate file (.crt / .pem)'));
  const keyPick = mkFilePick(t('Private key file (.key / .pem)'));

  const fPass = el('div', 'form-field');
  fPass.append(el('label', null, t('Passphrase (optional)')));
  const passInput = document.createElement('input');
  passInput.type = 'password';
  fPass.append(passInput);

  const syncType = () => {
    pfxPick.field.classList.toggle('hidden', typeSel.value !== 'pfx');
    certPick.field.classList.toggle('hidden', typeSel.value !== 'pem');
    keyPick.field.classList.toggle('hidden', typeSel.value !== 'pem');
  };
  typeSel.addEventListener('change', syncType);
  syncType();

  body.append(fHost, fType, pfxPick.field, certPick.field, keyPick.field, fPass);

  modal(t('Add Client Certificate'), body, [
    { label: t('Cancel') },
    {
      label: t('Add'),
      primary: true,
      onClick: () => {
        const host = hostInput.value.trim();
        if (!host) {
          toast(t('Enter a hostname'));
          return false;
        }
        if (typeSel.value === 'pfx' && !pfxPick.path) {
          toast(t('Choose a PFX file'));
          return false;
        }
        if (typeSel.value === 'pem' && (!certPick.path || !keyPick.path)) {
          toast(t('Choose both certificate and key files'));
          return false;
        }
        state.settings.clientCerts.push({
          id: uid(),
          host,
          type: typeSel.value,
          pfxPath: pfxPick.path,
          certPath: certPick.path,
          keyPath: keyPick.path,
          passphrase: passInput.value,
        });
        persist();
        if (onDone) onDone();
        toast(t('Client certificate added for {host}', { host }));
      },
    },
  ]);
}

/* ============================== key-value tables ============================== */

function renderKv(container, rowsRef, onChange, opts = {}) {
  container.classList.toggle('kv-file', !!opts.file);
  container.classList.toggle('kv-secret', !!opts.secret);
  const rows = rowsRef();
  const last = rows[rows.length - 1];
  if (!rows.length || (last && (last.key !== '' || last.value !== '' || last.filePath))) rows.push(newKvRow());
  container.innerHTML = '';
  for (const row of rowsRef()) container.appendChild(kvRowEl(container, rowsRef, row, onChange, opts));
}

function kvRowEl(container, rowsRef, row, onChange, opts = {}) {
  const div = el('div', 'kv-row');

  const grow = () => {
    const rows = rowsRef();
    if (rows[rows.length - 1] === row && (row.key !== '' || row.value !== '' || row.filePath)) {
      const nr = newKvRow();
      rows.push(nr);
      container.appendChild(kvRowEl(container, rowsRef, nr, onChange, opts));
    }
  };

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = row.enabled !== false;
  cb.title = 'Enable / disable';
  cb.addEventListener('change', () => {
    row.enabled = cb.checked;
    onChange();
  });

  const mkInput = (prop, ph) => {
    const i = document.createElement('input');
    i.type = prop === 'value' && opts.secret && row.secret ? 'password' : 'text';
    i.placeholder = t(ph);
    i.spellcheck = false;
    i.value = row[prop];
    i.addEventListener('input', () => {
      row[prop] = i.value;
      grow();
      onChange();
    });
    if (opts.ac !== false) attachAC(i);
    return i;
  };

  const cells = [cb, mkInput('key', 'Key')];

  if (opts.file) {
    const typeSel = document.createElement('select');
    for (const [v, label] of [['text', 'Text'], ['file', 'File']]) {
      const o = el('option', null, label);
      o.value = v;
      typeSel.append(o);
    }
    typeSel.value = row.type === 'file' ? 'file' : 'text';
    typeSel.addEventListener('change', () => {
      row.type = typeSel.value;
      renderKv(container, rowsRef, onChange, opts);
      onChange();
    });
    cells.push(typeSel);
  }

  if (opts.file && row.type === 'file') {
    const btn = el('button', 'kv-file-btn', row.filePath ? basename(row.filePath) : t('Choose file…'));
    btn.title = row.filePath || t('Choose a file');
    btn.addEventListener('click', async () => {
      const p = await window.lostman.pickFile();
      if (p) {
        row.filePath = p;
        btn.textContent = basename(p);
        btn.title = p;
        grow();
        onChange();
      }
    });
    cells.push(btn);
  } else {
    cells.push(mkInput('value', 'Value'));
  }

  if (opts.secret) {
    const eye = el('button', 'kv-eye', row.secret ? '🙈' : '👁');
    eye.title = 'Toggle secret masking';
    eye.tabIndex = -1;
    eye.addEventListener('click', () => {
      row.secret = !row.secret;
      renderKv(container, rowsRef, onChange, opts);
      onChange();
    });
    cells.push(eye);
  }

  const del = el('button', 'kv-del', '✕');
  del.title = 'Remove row';
  del.tabIndex = -1;
  del.addEventListener('click', () => {
    const rows = rowsRef();
    const idx = rows.indexOf(row);
    if (idx > -1) rows.splice(idx, 1);
    renderKv(container, rowsRef, onChange, opts);
    onChange();
  });
  cells.push(del);

  div.append(...cells);
  return div;
}

const cleanRows = (rows) => rows.filter((r) => r.key.trim() !== '' || r.value.trim() !== '' || r.filePath);

function cleanRequest(r) {
  const out = structuredClone(r);
  out.params = cleanRows(out.params);
  out.headers = cleanRows(out.headers);
  out.formItems = cleanRows(out.formItems);
  return out;
}

/* ============================== URL <-> params sync ============================== */

function syncParamsFromUrl() {
  const r = activeTab().request;
  const [, qs] = splitUrl(r.url);
  const disabled = r.params.filter((p) => p.enabled === false && (p.key !== '' || p.value !== ''));
  r.params = parseQuery(qs).map((pair) => ({ ...newKvRow(), key: pair.key, value: pair.value }));
  r.params.push(...disabled);
  renderKv($('#kvParams'), () => activeTab().request.params, paramsChanged);
}

function syncUrlFromParams() {
  const r = activeTab().request;
  const [base] = splitUrl(r.url);
  const enabled = r.params.filter((p) => p.enabled !== false && p.key.trim() !== '');
  const qs = enabled.map((p) => prettyEncode(p.key) + '=' + prettyEncode(p.value)).join('&');
  r.url = qs ? `${base}?${qs}` : base;
  $('#url').value = r.url;
}

function paramsChanged() {
  syncUrlFromParams();
  updateEditorMeta();
  renderTabsBar();
  persist();
}

/* ============================== request editor ============================== */

function initEditor() {
  $('#method').addEventListener('change', (e) => {
    activeTab().request.method = e.target.value;
    e.target.className = 'm-' + e.target.value;
    renderTabsBar();
    updateSendButton();
    renderResponse();
    persist();
  });

  $('#url').addEventListener('input', (e) => {
    activeTab().request.url = e.target.value;
    syncParamsFromUrl();
    updateEditorMeta();
    renderTabsBar();
    persist();
  });
  $('#url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendActive();
  });

  $$('.editor-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.editor-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('#panels .panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + b.dataset.panel));
    })
  );

  $$('input[name="bodyMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      activeTab().request.bodyMode = r.value;
      updateBodyUI();
      updateEditorMeta();
      persist();
    })
  );

  $('#rawType').addEventListener('change', (e) => {
    activeTab().request.rawType = e.target.value;
    persist();
  });

  $('#rawBody').addEventListener('input', (e) => {
    activeTab().request.rawBody = e.target.value;
    updateEditorMeta();
    persist();
  });

  $('#btnBeautify').addEventListener('click', () => {
    const ta = $('#rawBody');
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      activeTab().request.rawBody = ta.value;
      persist();
    } catch {
      toast(t('Not valid JSON — cannot beautify'));
    }
  });

  $('#gqlQuery').addEventListener('input', (e) => {
    activeTab().request.gqlQuery = e.target.value;
    updateEditorMeta();
    persist();
  });
  $('#gqlVariables').addEventListener('input', (e) => {
    activeTab().request.gqlVariables = e.target.value;
    persist();
  });
  $('#preScript').addEventListener('input', (e) => {
    activeTab().request.preScript = e.target.value;
    updateEditorMeta();
    persist();
  });
  $('#testScript').addEventListener('input', (e) => {
    activeTab().request.testScript = e.target.value;
    updateEditorMeta();
    persist();
  });

  $('#authType').addEventListener('change', (e) => {
    activeTab().request.auth.type = e.target.value;
    updateAuthUI();
    updateEditorMeta();
    persist();
  });
  const bindAuth = (id, prop) =>
    $(id).addEventListener('input', (e) => {
      activeTab().request.auth[prop] = e.target.value;
      persist();
    });
  bindAuth('#authToken', 'token');
  bindAuth('#authUser', 'username');
  bindAuth('#authPass', 'password');
  bindAuth('#authKeyName', 'keyName');
  bindAuth('#authKeyValue', 'keyValue');
  bindAuth('#digestUser', 'username');
  bindAuth('#digestPass', 'password');
  bindAuth('#oauthAuthUrl', 'authUrl');
  bindAuth('#oauthTokenUrl', 'tokenUrl');
  bindAuth('#oauthClientId', 'clientId');
  bindAuth('#oauthClientSecret', 'clientSecret');
  bindAuth('#oauthScope', 'scope');
  bindAuth('#oauthRedirect', 'redirectUri');
  bindAuth('#awsAccessKey', 'accessKey');
  bindAuth('#awsSecretKey', 'secretKey');
  bindAuth('#awsRegion', 'region');
  bindAuth('#awsService', 'service');
  bindAuth('#awsSession', 'sessionToken');
  $('#authAddTo').addEventListener('change', (e) => {
    activeTab().request.auth.addTo = e.target.value;
    persist();
  });
  $('#oauthGrant').addEventListener('change', (e) => {
    activeTab().request.auth.grant = e.target.value;
    updateAuthUI();
    persist();
  });
  $('#oauthClientAuth').addEventListener('change', (e) => {
    activeTab().request.auth.clientAuth = e.target.value;
    persist();
  });
  $('#btnOauthFetch').addEventListener('click', oauthFetchToken);
  $('#btnOauthClear').addEventListener('click', () => {
    const a = activeTab().request.auth;
    a.accessToken = '';
    a.expiresAt = 0;
    updateAuthUI();
    persist();
    toast('Token cleared');
  });

  for (const id of ['#url', '#authToken', '#authUser', '#authPass', '#authKeyName', '#authKeyValue', '#rawBody', '#gqlQuery', '#gqlVariables', '#oauthTokenUrl', '#oauthAuthUrl', '#oauthScope']) {
    attachAC($(id));
  }

  $('#btnSend').addEventListener('click', sendActive);
  $('#btnSave').addEventListener('click', saveActive);
  $('#btnCode').addEventListener('click', openCodeModal);
}

function updateSendButton() {
  const tab = activeTab();
  if (!tab) return;
  const m = tab.request.method;
  if (m === 'WS' || m === 'SSE') {
    const live = tab.stream && tab.stream.status !== 'closed';
    $('#btnSend').textContent = live ? t('Disconnect') : t('Connect');
  } else {
    $('#btnSend').textContent = t('Send');
  }
}

function loadEditor() {
  const tab = activeTab();
  const r = tab.request;

  $('#method').value = r.method;
  $('#method').className = 'm-' + r.method;
  $('#url').value = r.url;

  const kvChanged = () => {
    updateEditorMeta();
    persist();
  };
  renderKv($('#kvParams'), () => activeTab().request.params, paramsChanged);
  renderKv($('#kvHeaders'), () => activeTab().request.headers, kvChanged);
  renderKv($('#kvForm'), () => activeTab().request.formItems, kvChanged, { file: true });

  const radio = document.querySelector(`input[name="bodyMode"][value="${r.bodyMode}"]`);
  if (radio) radio.checked = true;
  $('#rawType').value = r.rawType;
  $('#rawBody').value = r.rawBody;
  $('#gqlQuery').value = r.gqlQuery;
  $('#gqlVariables').value = r.gqlVariables;
  $('#preScript').value = r.preScript;
  $('#testScript').value = r.testScript;
  updateBodyUI();

  $('#authType').value = r.auth.type;
  syncAuthInputs();
  updateAuthUI();

  updateEditorMeta();
  updateSendButton();
  renderResponse();
}

function syncAuthInputs() {
  const a = activeTab().request.auth;
  $('#authToken').value = a.token;
  $('#authUser').value = a.username;
  $('#authPass').value = a.password;
  $('#authKeyName').value = a.keyName;
  $('#authKeyValue').value = a.keyValue;
  $('#authAddTo').value = a.addTo;
  $('#digestUser').value = a.username;
  $('#digestPass').value = a.password;
  $('#oauthGrant').value = a.grant || 'client_credentials';
  $('#oauthAuthUrl').value = a.authUrl;
  $('#oauthTokenUrl').value = a.tokenUrl;
  $('#oauthClientId').value = a.clientId;
  $('#oauthClientSecret').value = a.clientSecret;
  $('#oauthScope').value = a.scope;
  $('#oauthRedirect').value = a.redirectUri;
  $('#oauthClientAuth').value = a.clientAuth || 'body';
  $('#awsAccessKey').value = a.accessKey;
  $('#awsSecretKey').value = a.secretKey;
  $('#awsRegion').value = a.region;
  $('#awsService').value = a.service;
  $('#awsSession').value = a.sessionToken;
}

function updateBodyUI() {
  const mode = activeTab().request.bodyMode;
  $('#bodyNone').classList.toggle('hidden', mode !== 'none');
  $('#rawBody').classList.toggle('hidden', mode !== 'raw');
  $('#rawType').classList.toggle('hidden', mode !== 'raw');
  $('#btnBeautify').classList.toggle('hidden', mode !== 'raw');
  $('#kvForm').classList.toggle('hidden', mode !== 'formdata' && mode !== 'urlencoded');
  $('#gqlArea').classList.toggle('hidden', mode !== 'graphql');
}

function updateAuthUI() {
  const a = activeTab().request.auth;
  const type = a.type;
  syncAuthInputs();
  $('#auth-bearer').classList.toggle('hidden', type !== 'bearer');
  $('#auth-basic').classList.toggle('hidden', type !== 'basic');
  $('#auth-apikey').classList.toggle('hidden', type !== 'apikey');
  $('#auth-oauth2').classList.toggle('hidden', type !== 'oauth2');
  $('#auth-digest').classList.toggle('hidden', type !== 'digest');
  $('#auth-awsv4').classList.toggle('hidden', type !== 'awsv4');
  if (type === 'oauth2') {
    const acOnly = a.grant === 'auth_code';
    $$('.oauth-ac-only').forEach((n) => n.classList.toggle('hidden', !acOnly));
    const st = $('#oauthStatus');
    if (a.accessToken) {
      const left = a.expiresAt ? Math.round((a.expiresAt - Date.now()) / 60000) : null;
      const suffix = left != null ? (left > 0 ? t('(expires in {n} min)', { n: left }) : t('(expired)')) : '';
      st.textContent = `${t('Token:')} ${a.accessToken.slice(0, 24)}… ${suffix}`;
    } else {
      st.textContent = t('No token fetched yet.');
    }
  }
}

function updateEditorMeta() {
  const r = activeTab().request;
  const count = (rows) => rows.filter((x) => x.enabled !== false && x.key.trim() !== '').length;
  const np = count(r.params);
  const nh = count(r.headers);
  $('#cntParams').textContent = np ? ` (${np})` : '';
  $('#cntHeaders').textContent = nh ? ` (${nh})` : '';
  const hasBody =
    r.bodyMode === 'raw'
      ? r.rawBody.trim() !== ''
      : r.bodyMode === 'graphql'
        ? r.gqlQuery.trim() !== ''
        : r.bodyMode === 'none'
          ? false
          : count(r.formItems) > 0;
  $('#dotBody').classList.toggle('hidden', !hasBody);
  $('#dotAuth').classList.toggle('hidden', r.auth.type === 'none');
  $('#dotScripts').classList.toggle('hidden', r.preScript.trim() === '' && r.testScript.trim() === '');
}

/* ============================== sending ============================== */

function buildPayload(tab) {
  return buildPayloadFromRequest(tab.request, null);
}

function buildPayloadFromRequest(r, extra) {
  const env = (s) => applyEnv(s, extra);
  const [rawBase] = splitUrl(r.url.trim());
  let url = env(rawBase.trim());
  if (!url) return null;
  if (!/^(https?|wss?):\/\//i.test(url)) url = 'http://' + url;

  const qp = r.params.filter((p) => p.enabled !== false && p.key.trim() !== '');
  if (qp.length) {
    url += '?' + qp.map((p) => encodeURIComponent(env(p.key)) + '=' + encodeURIComponent(env(p.value))).join('&');
  }

  const headers = r.headers
    .filter((h) => h.enabled !== false && h.key.trim() !== '')
    .map((h) => ({ key: env(h.key), value: env(h.value) }));
  const hasHeader = (name) => headers.some((h) => h.key.toLowerCase() === name);

  let auth = null;
  const a = r.auth;
  if (a.type === 'bearer' && a.token) {
    headers.push({ key: 'Authorization', value: 'Bearer ' + env(a.token) });
  } else if (a.type === 'basic') {
    let cred;
    try {
      cred = btoa(env(a.username) + ':' + env(a.password));
    } catch {
      cred = btoa(unescape(encodeURIComponent(env(a.username) + ':' + env(a.password))));
    }
    headers.push({ key: 'Authorization', value: 'Basic ' + cred });
  } else if (a.type === 'apikey' && a.keyName) {
    if (a.addTo === 'query') {
      url += (url.includes('?') ? '&' : '?') + encodeURIComponent(env(a.keyName)) + '=' + encodeURIComponent(env(a.keyValue));
    } else {
      headers.push({ key: env(a.keyName), value: env(a.keyValue) });
    }
  } else if (a.type === 'oauth2' && a.accessToken) {
    headers.push({ key: 'Authorization', value: `${a.tokenType || 'Bearer'} ${a.accessToken}` });
  } else if (a.type === 'digest') {
    auth = { type: 'digest', username: env(a.username), password: env(a.password) };
  } else if (a.type === 'awsv4' && a.accessKey) {
    auth = {
      type: 'awsv4',
      accessKey: env(a.accessKey),
      secretKey: env(a.secretKey),
      region: env(a.region) || 'us-east-1',
      service: env(a.service) || 'execute-api',
      sessionToken: env(a.sessionToken),
    };
  }

  let bodyMode = r.bodyMode;
  if (r.method === 'GET' || r.method === 'HEAD' || r.method === 'WS' || r.method === 'SSE') bodyMode = 'none';
  let rawBody = null;
  let formItems = null;
  if (bodyMode === 'raw') {
    rawBody = env(r.rawBody);
    if (!hasHeader('content-type')) {
      headers.push({ key: 'Content-Type', value: r.rawType === 'json' ? 'application/json' : 'text/plain' });
    }
  } else if (bodyMode === 'graphql') {
    let vars = null;
    const varsText = env(r.gqlVariables).trim();
    if (varsText) {
      try {
        vars = JSON.parse(varsText);
      } catch {
        vars = null;
      }
    }
    rawBody = JSON.stringify({ query: env(r.gqlQuery), variables: vars || {} });
    bodyMode = 'raw';
    if (!hasHeader('content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
  } else if (bodyMode === 'urlencoded' || bodyMode === 'formdata') {
    formItems = r.formItems
      .filter((f) => f.enabled !== false && f.key.trim() !== '')
      .map((f) => ({
        key: env(f.key),
        value: env(f.value),
        type: f.type === 'file' ? 'file' : 'text',
        filePath: f.filePath || '',
      }));
    if (bodyMode === 'urlencoded') formItems = formItems.filter((f) => f.type !== 'file');
  }

  if (state.settings.cookiesEnabled && !hasHeader('cookie')) {
    const cookieHeader = cookiesFor(url);
    if (cookieHeader) headers.push({ key: 'Cookie', value: cookieHeader });
  }

  return {
    method: r.method,
    url,
    headers,
    bodyMode,
    rawBody,
    formItems,
    auth,
    settings: {
      timeoutMs: state.settings.timeoutMs,
      followRedirects: state.settings.followRedirects,
      verifySsl: state.settings.verifySsl,
      proxy: state.settings.proxy,
      clientCerts: state.settings.clientCerts,
    },
  };
}

async function sendActive() {
  const tab = activeTab();
  if (!tab || tab.sending) return;
  const r = tab.request;
  if (r.method === 'WS' || r.method === 'SSE') {
    toggleStream(tab);
    return;
  }
  const payload = buildPayload(tab);
  if (!payload) {
    toast(t('Enter a request URL first'));
    return;
  }
  payload.id = uid();

  if (r.preScript.trim()) {
    const pre = runPreScript(r.preScript, payload, null);
    if (!pre.ok) {
      toast(t('Pre-request script error: {error}', { error: pre.error }));
      return;
    }
  }

  tab.sending = payload.id;
  tab.respTab = 'body';
  if (tab === activeTab()) renderResponse();

  const res = await window.lostman.send(payload);

  if (tab.sending !== payload.id) return;
  tab.sending = null;
  tab.response = res;
  if (res.ok) {
    storeCookiesFromResponse(res, payload.url);
    setChain(tab.name, res);
    if (r.testScript.trim()) {
      res.testResults = runTests(r.testScript, res, null);
      const failed = res.testResults.some((t) => !t.ok);
      if (failed) tab.respTab = 'tests';
    }
  }
  if (res.ok && res.bodyBase64) tab.respView = 'preview';
  if (!res.aborted) addHistory(tab.request, res);
  if (tab === activeTab()) renderResponse();
}

function cancelSend(tab) {
  if (tab.sending) window.lostman.abort(tab.sending);
}

function genCurl(p) {
  const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const parts = ['curl'];
  if (p.method !== 'GET') parts.push('-X', p.method);
  parts.push(sq(p.url));
  for (const h of p.headers) parts.push('-H', sq(h.key + ': ' + h.value));
  if (p.bodyMode === 'raw' && p.rawBody) parts.push('--data-raw', sq(p.rawBody));
  if (p.bodyMode === 'urlencoded') {
    for (const f of p.formItems) parts.push('--data-urlencode', sq(f.key + '=' + f.value));
  }
  if (p.bodyMode === 'formdata') {
    for (const f of p.formItems) {
      parts.push('-F', sq(f.type === 'file' ? `${f.key}=@${f.filePath}` : `${f.key}=${f.value}`));
    }
  }
  return parts.join(' ');
}

/* ============================== response rendering ============================== */

function statusClass(s) {
  if (s < 200) return 's-info';
  if (s < 300) return 's-ok';
  if (s < 400) return 's-redir';
  if (s < 500) return 's-clienterr';
  return 's-servererr';
}

const emptyStateHtml = () => `
  <div class="resp-empty">
    <img class="empty-logo" src="assets/logo-badge.png" alt="Lostman">
    <div>${esc(t('Enter a URL and click Send to get a response'))}</div>
    <div style="font-size:11.5px">${esc(t('Ctrl+Enter sends · Ctrl+S saves · Ctrl+T new tab · Ctrl+F finds · Ctrl+K palette'))}</div>
  </div>`;

function renderResponse() {
  const tab = activeTab();
  const box = $('#respContent');
  const toolbar = $('#respToolbar');
  const searchBar = $('#respSearchBar');

  if (tab.request.method === 'WS' || tab.request.method === 'SSE') {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    renderStreamConsole(box, tab);
    return;
  }

  if (tab.sending) {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    box.innerHTML = '';
    const wrap = el('div', 'resp-loading');
    wrap.append(el('div', 'spinner'));
    wrap.append(el('div', null, t('Sending request…')));
    const btn = el('button', null, t('Cancel'));
    btn.addEventListener('click', () => cancelSend(tab));
    wrap.append(btn);
    box.append(wrap);
    return;
  }

  const r = tab.response;
  if (!r) {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    box.innerHTML = emptyStateHtml();
    return;
  }

  if (!r.ok) {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    box.innerHTML = `
      <div class="resp-error">
        <h3>${esc(r.aborted ? t('Request cancelled') : t('Could not send request'))}</h3>
        <p>${esc(r.error || '')}</p>
        ${r.aborted ? '' : `<p class="hint">${esc(t('Check the URL, your connection, and that the server is reachable.'))}</p>`}
      </div>`;
    return;
  }

  toolbar.classList.remove('hidden');
  const pill = $('#respStatus');
  pill.textContent = `${r.status} ${r.statusText || ''}`.trim();
  pill.className = 'pill ' + statusClass(r.status);
  $('#respTime').textContent = formatTime(r.timeMs);
  $('#respSize').textContent = formatBytes(r.size);
  $('#respHdrCount').textContent = r.headers.length ? ` (${r.headers.length})` : '';

  const canPreview = !!r.bodyBase64 || /text\/html/i.test(r.contentType || '');
  $('#btnPreview').classList.toggle('hidden', !canPreview);
  if (tab.respView === 'preview' && !canPreview) tab.respView = 'pretty';
  const canDiff = !!tab.pinned && !r.bodyBase64;
  $('#btnDiff').classList.toggle('hidden', !canDiff);
  if (tab.respView === 'diff' && !canDiff) tab.respView = 'pretty';

  const tr = r.testResults;
  $('#respTestsBtn').classList.toggle('hidden', !tr);
  if (tr) $('#respTestCount').textContent = ` (${tr.filter((t) => t.ok).length}/${tr.length})`;
  if (tab.respTab === 'tests' && !tr) tab.respTab = 'body';

  $$('.resp-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.rtab === tab.respTab));
  $$('.resp-views button').forEach((b) => b.classList.toggle('active', b.dataset.rview === tab.respView));
  $('#respViews').classList.toggle('hidden', tab.respTab !== 'body');

  const searchOn = !!tab.search && tab.respTab === 'body' && !r.bodyBase64;
  searchBar.classList.toggle('hidden', !searchOn);
  if (searchOn) {
    const inp = $('#respSearchInput');
    if (inp.value !== tab.search.q) inp.value = tab.search.q;
    if (tab.search.q === '') $('#respSearchCount').textContent = '';
  }

  box.innerHTML = '';
  if (r.fromHistory) box.append(el('div', 'diff-meta', t('Snapshot from history — {ago}', { ago: timeAgo(r.fromHistory) })));
  if (tab.respTab === 'headers') renderRespHeaders(box, r);
  else if (tab.respTab === 'tests') renderTestResults(box, r);
  else if (searchOn && tab.search.q !== '') renderSearchView(box, r, tab.search);
  else if (tab.respView === 'diff') renderDiffView(box, tab, r);
  else renderRespBody(box, r, tab.respView);
}

function renderTestResults(box, r) {
  const wrap = el('div', 'test-list');
  for (const t of r.testResults || []) {
    const row = el('div', 'test-row ' + (t.ok ? 'pass' : 'fail'));
    row.append(el('span', 't-mark', t.ok ? '✓' : '✗'), el('span', null, t.name));
    if (!t.ok && t.error) row.append(el('span', 't-err', '— ' + t.error));
    wrap.append(row);
  }
  box.append(wrap);
}

function renderRespHeaders(box, r) {
  const table = el('table', 'hdr-table');
  for (const [k, v] of r.headers) {
    const tr = el('tr');
    tr.append(el('td', null, k), el('td', null, v));
    table.append(tr);
  }
  box.append(table);
}

function highlightJSON(json) {
  const safe = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return safe.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'json-num';
      if (match.startsWith('"')) cls = /:$/.test(match) ? 'json-key' : 'json-str';
      else if (match === 'true' || match === 'false') cls = 'json-bool';
      else if (match === 'null') cls = 'json-null';
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function renderRespBody(box, r, view) {
  if (view === 'preview') {
    if (r.bodyBase64) {
      const wrap = el('div', 'resp-preview-img');
      const img = document.createElement('img');
      img.src = `data:${r.contentType.split(';')[0]};base64,${r.bodyBase64}`;
      wrap.append(img);
      box.append(wrap);
    } else {
      const iframe = document.createElement('iframe');
      iframe.className = 'resp-preview';
      iframe.setAttribute('sandbox', '');
      iframe.srcdoc = r.bodyText || '';
      box.append(iframe);
    }
    return;
  }

  if (r.bodyBase64) {
    box.innerHTML = `<div class="resp-empty"><div>${esc(t('Binary image response ({size}) — use Preview', { size: formatBytes(r.size) }))}</div></div>`;
    return;
  }

  const text = r.bodyText ?? '';
  if (text === '') {
    box.innerHTML = `<div class="resp-empty"><div>${esc(t('(empty response body)'))}</div></div>`;
    return;
  }

  const pre = el('pre', 'code');
  if (view === 'pretty' && text.length < 1_000_000) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (parsed !== null || text.trim() === 'null') {
      pre.innerHTML = highlightJSON(JSON.stringify(parsed, null, 2));
    } else {
      pre.textContent = text;
    }
  } else {
    pre.textContent = text;
  }
  box.append(pre);

  if (r.truncated) {
    box.append(el('div', 'trunc-note', t('Response is {size} — showing the first 2 MB (Save exports the full body).', { size: formatBytes(r.size) })));
  }
}

/* ============================== response search ============================== */

function renderSearchView(box, r, search) {
  const text = r.bodyText ?? '';
  const q = search.q;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const matches = [];
  let i = lower.indexOf(ql);
  while (i !== -1 && matches.length < 3000) {
    matches.push(i);
    i = lower.indexOf(ql, i + ql.length);
  }
  const n = matches.length;
  if (search.cur >= n) search.cur = 0;
  if (search.cur < 0) search.cur = Math.max(0, n - 1);
  $('#respSearchCount').textContent = n
    ? t('{cur} of {n}', { cur: search.cur + 1, n: n + (n === 3000 ? '+' : '') })
    : t('No matches');

  const pre = el('pre', 'code');
  if (!n) {
    pre.textContent = text;
    box.append(pre);
    return;
  }
  const parts = [];
  let prev = 0;
  matches.forEach((idx, k) => {
    parts.push(esc(text.slice(prev, idx)));
    parts.push(`<mark${k === search.cur ? ' class="cur"' : ''}>${esc(text.slice(idx, idx + q.length))}</mark>`);
    prev = idx + q.length;
  });
  parts.push(esc(text.slice(prev)));
  pre.innerHTML = parts.join('');
  box.append(pre);
  const curEl = pre.querySelector('mark.cur');
  if (curEl) curEl.scrollIntoView({ block: 'center' });
}

function openRespSearch() {
  const tab = activeTab();
  const r = tab.response;
  if (!r || !r.ok || r.bodyBase64) return;
  tab.respTab = 'body';
  if (!tab.search) tab.search = { q: '', cur: 0 };
  renderResponse();
  const inp = $('#respSearchInput');
  inp.focus();
  inp.select();
}

function closeRespSearch() {
  const tab = activeTab();
  if (tab && tab.search) {
    tab.search = null;
    renderResponse();
  }
}

function initRespSearch() {
  $('#btnFindResp').addEventListener('click', openRespSearch);
  const inp = $('#respSearchInput');
  inp.addEventListener('input', () => {
    const tab = activeTab();
    if (!tab.search) return;
    tab.search.q = inp.value;
    tab.search.cur = 0;
    renderResponse();
  });
  inp.addEventListener('keydown', (e) => {
    const tab = activeTab();
    if (!tab.search) return;
    if (e.key === 'Enter') {
      tab.search.cur += e.shiftKey ? -1 : 1;
      renderResponse();
    } else if (e.key === 'Escape') {
      closeRespSearch();
    }
  });
  $('#btnSearchNext').addEventListener('click', () => {
    const tab = activeTab();
    if (tab.search) {
      tab.search.cur += 1;
      renderResponse();
    }
  });
  $('#btnSearchPrev').addEventListener('click', () => {
    const tab = activeTab();
    if (tab.search) {
      tab.search.cur -= 1;
      renderResponse();
    }
  });
  $('#btnSearchClose').addEventListener('click', closeRespSearch);
}

/* ============================== save / copy response ============================== */

function suggestFilename(r) {
  let name = 'response';
  try {
    const u = new URL(r.finalUrl);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) name = seg;
  } catch {
    /* keep default */
  }
  if (!/\.[a-z0-9]{1,5}$/i.test(name)) {
    const ct = (r.contentType || '').split(';')[0].trim().toLowerCase();
    const extMap = {
      'application/json': '.json', 'text/html': '.html', 'application/xml': '.xml', 'text/xml': '.xml',
      'text/plain': '.txt', 'text/csv': '.csv', 'image/png': '.png', 'image/jpeg': '.jpg',
      'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf',
    };
    name += extMap[ct] ?? '.txt';
  }
  return name;
}

function initRespActions() {
  $('#btnCopyResp').addEventListener('click', () => {
    const r = activeTab().response;
    if (!r || !r.ok) return;
    navigator.clipboard.writeText(r.bodyText ?? '');
    toast(t('Response body copied'));
  });
  $('#btnSaveResp').addEventListener('click', async () => {
    const r = activeTab().response;
    if (!r || !r.ok) return;
    const ok = await window.lostman.saveResponse({
      bufId: r.bufId,
      defaultName: suggestFilename(r),
      fallbackText: r.bodyText ?? '',
    });
    if (ok) toast(t('Response saved to file'));
  });
  $('#btnPinResp').addEventListener('click', () => {
    const tab = activeTab();
    const r = tab.response;
    if (!r || !r.ok || r.bodyBase64) {
      toast(t('Only text responses can be pinned'));
      return;
    }
    tab.pinned = { text: prettyText(r.bodyText ?? ''), label: `${r.status} · ${formatTime(r.timeMs)}`, ts: Date.now() };
    toast(t('Response pinned — send again and use Diff to compare'));
    renderResponse();
  });
}

function prettyText(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push([' ', a[i]]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push(['-', a[i]]);
      i++;
    } else {
      ops.push(['+', b[j]]);
      j++;
    }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

function diffLines(aText, bText) {
  const a = aText.split('\n');
  const b = bText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let ops;
  if (midA.length * midB.length > 2_250_000) {
    ops = [...midA.map((l) => ['-', l]), ...midB.map((l) => ['+', l])];
  } else {
    ops = lcsDiff(midA, midB);
  }
  return { prefix: a.slice(0, start), ops, suffix: a.slice(endA) };
}

function renderDiffView(box, tab, r) {
  const current = prettyText(r.bodyText ?? '');
  const pinnedText = tab.pinned.text;
  if (current.length > 400_000 || pinnedText.length > 400_000) {
    box.append(el('div', 'resp-error', t('Responses are too large to diff.')));
    return;
  }
  box.append(
    el(
      'div',
      'diff-meta',
      t('Comparing pinned ({label}, {ago}) with the current response — red was removed, green was added', {
        label: tab.pinned.label,
        ago: timeAgo(tab.pinned.ts),
      })
    )
  );
  const { prefix, ops, suffix } = diffLines(pinnedText, current);
  const changed = ops.filter(([op]) => op !== ' ').length;
  if (!changed) {
    box.append(el('div', 'diff-meta', t('No differences.')));
  }
  const pre = el('pre', 'code');
  const parts = [];
  const ctx = (lines, tail) => {
    if (lines.length <= 4) return lines.map(esc).join('\n');
    return tail
      ? '…\n' + lines.slice(-3).map(esc).join('\n')
      : lines.slice(0, 3).map(esc).join('\n') + '\n…';
  };
  if (prefix.length) parts.push(ctx(prefix, true));
  for (const [op, line] of ops.slice(0, 5000)) {
    if (op === ' ') parts.push(esc(line));
    else if (op === '-') parts.push(`<span class="d-del">- ${esc(line)}</span>`);
    else parts.push(`<span class="d-add">+ ${esc(line)}</span>`);
  }
  if (ops.length > 5000) parts.push('… (diff truncated)');
  if (suffix.length) parts.push(ctx(suffix, false));
  pre.innerHTML = parts.join('\n');
  box.append(pre);
}

/* ============================== history ============================== */

const SNAPSHOT_MAX = 64 * 1024;

function addHistory(request, res) {
  let snapshot = null;
  if (res.ok) {
    const text = res.bodyBase64 ? '' : res.bodyText ?? '';
    snapshot = {
      status: res.status,
      statusText: res.statusText,
      timeMs: res.timeMs,
      size: res.size,
      contentType: res.contentType,
      headers: res.headers,
      bodyText: res.bodyBase64 ? `[binary ${res.contentType} response — resend to view]` : text.slice(0, SNAPSHOT_MAX),
      truncated: !!res.truncated || text.length > SNAPSHOT_MAX,
    };
  }
  state.history.unshift({
    id: uid(),
    ts: Date.now(),
    request: cleanRequest(request),
    status: res.ok ? res.status : null,
    error: !res.ok,
    snapshot,
  });
  if (state.history.length > 100) state.history.length = 100;
  for (let i = 25; i < state.history.length; i++) if (state.history[i].snapshot) state.history[i].snapshot = null;
  persist();
  if (state.sideView === 'history') renderSidebar();
}

/* ============================== collections model ============================== */

function listFor(colId, folderId) {
  const col = state.collections.find((c) => c.id === colId);
  if (!col) return null;
  if (folderId) {
    const f = (col.folders || []).find((x) => x.id === folderId);
    return f ? f.requests : null;
  }
  return col.requests;
}

function findSaved(ref) {
  if (!ref) return null;
  const col = state.collections.find((c) => c.id === ref.collectionId);
  if (!col) return null;
  const list = listFor(ref.collectionId, ref.folderId || null);
  if (!list) return null;
  const saved = list.find((q) => q.id === ref.requestId);
  return saved ? { col, list, saved } : null;
}

function retargetTabs(reqId, ref) {
  for (const t of state.tabs) {
    if (t.savedRef && t.savedRef.requestId === reqId) t.savedRef = ref ? { ...ref } : null;
  }
}

let dragInfo = null;

function clearDragMarks() {
  $$('.drag-over, .drag-over-top').forEach((n) => n.classList.remove('drag-over', 'drag-over-top'));
}

function moveSaved(from, to) {
  const src = listFor(from.colId, from.folderId);
  if (!src) return;
  const idx = src.findIndex((q) => q.id === from.reqId);
  if (idx === -1) return;
  const [item] = src.splice(idx, 1);
  const dst = listFor(to.colId, to.folderId);
  if (!dst) {
    src.splice(idx, 0, item);
    return;
  }
  let at = to.beforeId ? dst.findIndex((q) => q.id === to.beforeId) : -1;
  if (at === -1) at = dst.length;
  dst.splice(at, 0, item);
  retargetTabs(item.id, { collectionId: to.colId, folderId: to.folderId || null, requestId: item.id });
  persist();
  renderSidebar();
}

/* ============================== sidebar ============================== */

function initSidebar() {
  $$('.side-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.sideView = b.dataset.sideview;
      $$('.side-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#sideSearch').placeholder = state.sideView === 'collections' ? t('Filter collections…') : t('Filter history…');
      renderSidebar();
    })
  );
  $('#sideSearch').addEventListener('input', (e) => {
    state.sideFilter = e.target.value.trim();
    renderSidebar();
  });
  $('#sideSearch').placeholder = t('Filter collections…');
}

const matchesReq = (saved, q) =>
  saved.name.toLowerCase().includes(q) ||
  (saved.request.url || '').toLowerCase().includes(q) ||
  saved.request.method.toLowerCase().includes(q);

function renderSidebar() {
  const actions = $('#sideActions');
  const list = $('#sideList');
  actions.innerHTML = '';
  list.innerHTML = '';
  const q = state.sideFilter.toLowerCase();

  if (state.sideView === 'collections') {
    const add = el('button', null, t('+ New Collection'));
    add.addEventListener('click', () =>
      textPrompt(t('New Collection'), t('Collection name'), '', (name) => {
        state.collections.push({ id: uid(), name, open: true, requests: [], folders: [] });
        persist();
        renderSidebar();
      })
    );
    const imp = el('button', null, t('Import'));
    imp.title = t('Import Postman collection / environment, OpenAPI spec, cURL, or Lostman backup');
    imp.addEventListener('click', openImportModal);
    actions.append(add, imp);

    if (!state.collections.length) {
      list.append(
        Object.assign(el('div', 'side-empty'), {
          innerHTML: t('No collections yet.<br>Click <b>Save</b> on a request<br>to add it to a collection.'),
        })
      );
      return;
    }
    let shown = 0;
    for (const col of state.collections) {
      const node = collectionEl(col, q);
      if (node) {
        list.append(node);
        shown++;
      }
    }
    if (!shown) list.append(el('div', 'side-empty', t('No matches.')));
  } else {
    if (state.history.length) {
      const clear = el('button', null, t('Clear History'));
      clear.addEventListener('click', () => {
        if (confirm(t('Clear all request history?'))) {
          state.history = [];
          persist();
          renderSidebar();
        }
      });
      actions.append(clear);
    }
    const items = q
      ? state.history.filter((h) => (h.request.url || '').toLowerCase().includes(q) || h.request.method.toLowerCase().includes(q))
      : state.history;
    if (!state.history.length) {
      list.append(Object.assign(el('div', 'side-empty'), { innerHTML: t('Requests you send<br>will show up here.') }));
      return;
    }
    if (!items.length) {
      list.append(el('div', 'side-empty', t('No matches.')));
      return;
    }
    for (const h of items) list.append(historyEl(h));
  }
}

function collectionEl(col, q) {
  const colMatch = q && col.name.toLowerCase().includes(q);
  let folderViews;
  let rootReqs;
  if (!q) {
    folderViews = (col.folders || []).map((f) => ({ f, requests: f.requests, forceOpen: false }));
    rootReqs = col.requests;
  } else {
    folderViews = [];
    for (const f of col.folders || []) {
      const fMatch = f.name.toLowerCase().includes(q);
      const reqs = colMatch || fMatch ? f.requests : f.requests.filter((s) => matchesReq(s, q));
      if (reqs.length || fMatch) folderViews.push({ f, requests: reqs, forceOpen: true });
    }
    rootReqs = colMatch ? col.requests : col.requests.filter((s) => matchesReq(s, q));
    if (!colMatch && !folderViews.length && !rootReqs.length) return null;
  }

  const total = (col.folders || []).reduce((n, f) => n + f.requests.length, col.requests.length);
  const wrap = el('div');
  const header = el('div', 'col-header');
  const chev = el('span', 'col-chevron', col.open || q ? '▾' : '▸');
  const name = el('span', 'col-name', col.name);
  const count = el('span', 'col-count', String(total));
  const acts = el('span', 'col-actions');

  const addFolder = el('button', null, '📁+');
  addFolder.title = t('New folder');
  addFolder.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt(t('New Folder'), t('Folder name'), '', (n) => {
      col.folders = col.folders || [];
      col.folders.push({ id: uid(), name: n, open: true, requests: [] });
      col.open = true;
      persist();
      renderSidebar();
    });
  });

  const rename = el('button', null, '✎');
  rename.title = t('Rename collection');
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt(t('Rename Collection'), t('Collection name'), col.name, (n) => {
      col.name = n;
      persist();
      renderSidebar();
    });
  });

  const del = el('button', null, '✕');
  del.title = t('Delete collection');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(t('Delete collection "{name}" and its {n} request(s)?', { name: col.name, n: total }))) return;
    state.collections = state.collections.filter((c) => c !== col);
    for (const t of state.tabs) if (t.savedRef?.collectionId === col.id) t.savedRef = null;
    persist();
    renderSidebar();
  });

  const exp = el('button', null, '⇩');
  exp.title = t('Export as Postman v2.1 collection');
  exp.addEventListener('click', async (e) => {
    e.stopPropagation();
    const safeName = col.name.replace(/[\\/:*?"<>|]/g, '-');
    const ok = await window.lostman.saveTextFile({
      defaultName: `${safeName}.postman_collection.json`,
      content: JSON.stringify(exportPostman(col), null, 2),
    });
    if (ok) toast(t('Exported "{name}"', { name: col.name }));
  });

  const run = el('button', null, '▶');
  run.title = t('Run collection');
  run.addEventListener('click', (e) => {
    e.stopPropagation();
    openRunnerModal(col);
  });

  acts.append(run, addFolder, exp, rename, del);
  header.append(chev, name, count, acts);
  header.addEventListener('click', () => {
    col.open = !col.open;
    persist();
    renderSidebar();
  });
  attachDropTarget(header, () => ({ colId: col.id, folderId: null, beforeId: null }));
  wrap.append(header);

  if (col.open || q) {
    for (const { f, requests, forceOpen } of folderViews) {
      wrap.append(folderEl(col, f, requests, forceOpen));
      if (f.open || forceOpen) for (const saved of requests) wrap.append(reqRowEl(col, f, saved));
    }
    for (const saved of rootReqs) wrap.append(reqRowEl(col, null, saved));
  }
  return wrap;
}

function folderEl(col, f, requests, forceOpen) {
  const header = el('div', 'folder-header');
  const chev = el('span', 'col-chevron', f.open || forceOpen ? '▾' : '▸');
  const icon = el('span', 'folder-icon', '📁');
  const name = el('span', 'col-name', f.name);
  const count = el('span', 'col-count', String(f.requests.length));
  const acts = el('span', 'col-actions');

  const rename = el('button', null, '✎');
  rename.title = t('Rename folder');
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt(t('Rename Folder'), t('Folder name'), f.name, (n) => {
      f.name = n;
      persist();
      renderSidebar();
    });
  });

  const del = el('button', null, '✕');
  del.title = t('Delete folder');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(t('Delete folder "{name}" and its {n} request(s)?', { name: f.name, n: f.requests.length }))) return;
    col.folders = col.folders.filter((x) => x !== f);
    for (const t of state.tabs) if (t.savedRef?.folderId === f.id) t.savedRef = null;
    persist();
    renderSidebar();
  });

  acts.append(rename, del);
  header.append(chev, icon, name, count, acts);
  header.addEventListener('click', () => {
    f.open = !f.open;
    persist();
    renderSidebar();
  });
  attachDropTarget(header, () => ({ colId: col.id, folderId: f.id, beforeId: null }));
  return header;
}

function attachDropTarget(node, getTarget) {
  node.addEventListener('dragover', (e) => {
    if (!dragInfo) return;
    e.preventDefault();
    node.classList.add('drag-over');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drag-over');
    if (!dragInfo) return;
    moveSaved(dragInfo, getTarget());
    dragInfo = null;
  });
}

function reqRowEl(col, folder, saved) {
  const row = el('div', 'req-row' + (folder ? ' in-folder' : ''));
  const chip = el('span', 'method-chip m-' + saved.request.method, shortMethod(saved.request.method));
  const nm = el('span', 'req-name', saved.name);
  const acts = el('span', 'col-actions');

  const rename = el('button', null, '✎');
  rename.title = t('Rename request');
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt(t('Rename Request'), t('Request name'), saved.name, (n) => {
      saved.name = n;
      for (const tb of state.tabs) if (tb.savedRef?.requestId === saved.id) tb.name = n;
      persist();
      renderSidebar();
      renderTabsBar();
    });
  });

  const dup = el('button', null, '⧉');
  dup.title = t('Duplicate request');
  dup.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = folder ? folder.requests : col.requests;
    const idx = list.indexOf(saved);
    list.splice(idx + 1, 0, { id: uid(), name: saved.name + ' ' + t('copy'), request: structuredClone(saved.request) });
    persist();
    renderSidebar();
  });

  const del = el('button', null, '✕');
  del.title = t('Delete request');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(t('Delete request "{name}"?', { name: saved.name }))) return;
    const list = folder ? folder.requests : col.requests;
    const idx = list.indexOf(saved);
    if (idx > -1) list.splice(idx, 1);
    retargetTabs(saved.id, null);
    persist();
    renderSidebar();
  });

  acts.append(rename, dup, del);
  row.append(chip, nm, acts);
  row.addEventListener('click', () => openSavedRequest(col, folder, saved));

  row.draggable = !state.sideFilter;
  row.addEventListener('dragstart', (e) => {
    dragInfo = { colId: col.id, folderId: folder ? folder.id : null, reqId: saved.id };
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', saved.id);
  });
  row.addEventListener('dragend', () => {
    dragInfo = null;
    row.classList.remove('dragging');
    clearDragMarks();
  });
  row.addEventListener('dragover', (e) => {
    if (!dragInfo || dragInfo.reqId === saved.id) return;
    e.preventDefault();
    row.classList.add('drag-over-top');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over-top'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over-top');
    if (!dragInfo || dragInfo.reqId === saved.id) return;
    moveSaved(dragInfo, { colId: col.id, folderId: folder ? folder.id : null, beforeId: saved.id });
    dragInfo = null;
  });

  return row;
}

function openSavedRequest(col, folder, saved) {
  const existing = state.tabs.find((t) => t.savedRef && t.savedRef.requestId === saved.id);
  if (existing) {
    switchTab(existing.id);
    return;
  }
  const tab = makeTab(structuredClone(saved.request), saved.name, {
    collectionId: col.id,
    folderId: folder ? folder.id : null,
    requestId: saved.id,
  });
  state.tabs.push(tab);
  switchTab(tab.id);
}

function historyEl(h) {
  const row = el('div', 'hist-row');
  const chip = el('span', 'method-chip m-' + h.request.method, shortMethod(h.request.method));
  const main = el('div', 'hist-main');
  const url = el('div', 'hist-url', h.request.url || t('(no URL)'));
  const sub = el('div', 'hist-sub');
  sub.append(el('span', null, timeAgo(h.ts)));
  if (h.status) {
    const st = el('span', null, String(h.status));
    st.style.color = h.status < 400 ? 'var(--ok)' : 'var(--err)';
    sub.append(st);
  } else if (h.error) {
    const st = el('span', null, t('failed'));
    st.style.color = 'var(--err)';
    sub.append(st);
  }
  main.append(url, sub);

  const acts = el('span', 'col-actions');
  const del = el('button', null, '✕');
  del.title = t('Remove from history');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    state.history = state.history.filter((x) => x !== h);
    persist();
    renderSidebar();
  });
  acts.append(del);

  row.append(chip, main, acts);
  row.addEventListener('click', () => {
    const tab = makeTab(structuredClone(h.request));
    if (h.snapshot) {
      tab.response = {
        ok: true,
        fromHistory: h.ts,
        bufId: null,
        redirects: 0,
        finalUrl: '',
        bodyBase64: null,
        ...structuredClone(h.snapshot),
      };
    }
    state.tabs.push(tab);
    switchTab(tab.id);
  });
  return row;
}

/* ============================== saving ============================== */

function saveActive() {
  const tab = activeTab();
  if (tab.savedRef) {
    const found = findSaved(tab.savedRef);
    if (found) {
      found.saved.request = cleanRequest(tab.request);
      persist();
      renderSidebar();
      toast(t('Saved to "{name}"', { name: found.col.name }));
      return;
    }
    tab.savedRef = null;
  }
  openSaveModal(tab);
}

function saveAsActive() {
  openSaveModal(activeTab(), true);
}

function defaultRequestName(r) {
  try {
    const u = new URL(applyEnv(splitUrl(r.url)[0]));
    return (u.pathname !== '/' && u.pathname) || u.hostname || t('New Request');
  } catch {
    return splitUrl(r.url)[0] || t('New Request');
  }
}

function openSaveModal(tab, saveAs = false) {
  const body = el('div');

  const f1 = el('div', 'form-field');
  f1.append(el('label', null, t('Request name')));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = (tab.name ? (saveAs ? tab.name + ' ' + t('copy') : tab.name) : defaultRequestName(tab.request));
  f1.append(nameInput);

  const f2 = el('div', 'form-field');
  f2.append(el('label', null, t('Collection')));
  const colSel = document.createElement('select');
  for (const c of state.collections) {
    const o = el('option', null, c.name);
    o.value = c.id;
    colSel.append(o);
  }
  const oNew = el('option', null, t('+ Create new collection'));
  oNew.value = '__new';
  colSel.append(oNew);
  if (!state.collections.length) colSel.value = '__new';
  f2.append(colSel);

  const f3 = el('div', 'form-field');
  f3.append(el('label', null, t('New collection name')));
  const newColInput = document.createElement('input');
  newColInput.type = 'text';
  newColInput.value = t('My Collection');
  f3.append(newColInput);

  const f4 = el('div', 'form-field');
  f4.append(el('label', null, t('Folder')));
  const folderSel = document.createElement('select');
  f4.append(folderSel);

  function refreshDependent() {
    const isNew = colSel.value === '__new';
    f3.classList.toggle('hidden', !isNew);
    const col = state.collections.find((c) => c.id === colSel.value);
    const folders = (!isNew && col && col.folders) || [];
    folderSel.innerHTML = '';
    const root = el('option', null, t('(collection root)'));
    root.value = '';
    folderSel.append(root);
    for (const f of folders) {
      const o = el('option', null, f.name);
      o.value = f.id;
      folderSel.append(o);
    }
    f4.classList.toggle('hidden', isNew || !folders.length);
  }
  colSel.addEventListener('change', refreshDependent);
  refreshDependent();

  body.append(f1, f2, f3, f4);

  const m = modal(saveAs ? t('Save Request As') : t('Save Request'), body, [
    { label: t('Cancel') },
    {
      label: t('Save'),
      primary: true,
      onClick: () => {
        const name = nameInput.value.trim();
        if (!name) {
          toast(t('Enter a request name'));
          return false;
        }
        let col;
        if (colSel.value === '__new') {
          const cn = newColInput.value.trim();
          if (!cn) {
            toast(t('Enter a collection name'));
            return false;
          }
          col = { id: uid(), name: cn, open: true, requests: [], folders: [] };
          state.collections.push(col);
        } else {
          col = state.collections.find((c) => c.id === colSel.value);
        }
        const folderId = colSel.value === '__new' ? null : folderSel.value || null;
        const list = folderId ? col.folders.find((f) => f.id === folderId).requests : col.requests;
        const saved = { id: uid(), name, request: cleanRequest(tab.request) };
        list.push(saved);
        tab.savedRef = { collectionId: col.id, folderId, requestId: saved.id };
        tab.name = name;
        persist();
        renderSidebar();
        renderTabsBar();
        toast(t('Saved to "{name}"', { name: col.name }));
      },
    },
  ]);
  nameInput.focus();
  nameInput.select();
  return m;
}

/* ============================== tabs ============================== */

function tabLabel(tab) {
  if (tab.name) return tab.name;
  const u = tab.request.url.trim();
  if (!u) return t('Untitled Request');
  return u.replace(/^https?:\/\//i, '');
}

function renderTabsBar() {
  const list = $('#tabsList');
  list.innerHTML = '';
  for (const tb of state.tabs) {
    const d = el('div', 'tab' + (tb.id === state.activeTabId ? ' active' : ''));
    d.title = tb.request.url || '';
    const m = el('span', 'tab-method m-' + tb.request.method, shortMethod(tb.request.method));
    const n = el('span', 'tab-name', tabLabel(tb));
    const x = el('button', 'tab-close', '✕');
    x.title = t('Close tab (Ctrl+W)');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tb.id);
    });
    d.append(m, n, x);
    d.addEventListener('click', () => switchTab(tb.id));
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      tabContextMenu(tb, e.clientX, e.clientY);
    });
    list.append(d);
  }
}

function tabContextMenu(tab, x, y) {
  ctxMenu(x, y, [
    {
      label: t('Rename'),
      onClick: () =>
        textPrompt(t('Rename Request'), t('Name'), tab.name || tabLabel(tab), (v) => {
          tab.name = v;
          const found = findSaved(tab.savedRef);
          if (found) {
            found.saved.name = v;
            renderSidebar();
          }
          renderTabsBar();
          persist();
        }),
    },
    {
      label: t('Duplicate'),
      onClick: () => {
        const copy = makeTab(structuredClone(tab.request), tab.name ? tab.name + ' ' + t('copy') : null);
        state.tabs.splice(state.tabs.indexOf(tab) + 1, 0, copy);
        switchTab(copy.id);
      },
    },
    { label: t('Save As…'), onClick: () => openSaveModal(tab, true) },
    '-',
    { label: t('Close'), onClick: () => closeTab(tab.id) },
    {
      label: t('Close Others'),
      danger: true,
      onClick: () => {
        for (const other of state.tabs) if (other !== tab) cancelSend(other);
        state.tabs = [tab];
        state.activeTabId = tab.id;
        renderTabsBar();
        loadEditor();
        persist();
      },
    },
  ]);
}

function switchTab(id) {
  state.activeTabId = id;
  renderTabsBar();
  loadEditor();
  persist();
  const active = $('#tabsList .tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function newTab() {
  const tab = makeTab();
  state.tabs.push(tab);
  switchTab(tab.id);
  $('#url').focus();
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = state.tabs[idx];
  cancelSend(tab);
  if (tab.stream && tab.stream.status !== 'closed') window.lostman.streamClose({ id: tab.stream.id });
  state.tabs.splice(idx, 1);
  if (!state.tabs.length) state.tabs.push(makeTab());
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    state.activeTabId = next.id;
    loadEditor();
  }
  renderTabsBar();
  persist();
}

/* ============================== modals & menus ============================== */

function modal(title, bodyEl, actions) {
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal');
  box.append(el('div', 'modal-title', title));
  const body = el('div', 'modal-body');
  body.append(bodyEl);
  box.append(body);

  const bar = el('div', 'modal-actions');
  for (const a of actions) {
    const b = el('button', a.primary ? 'primary' : null, a.label);
    b.addEventListener('click', () => {
      if (a.onClick && a.onClick() === false) return;
      close();
    });
    bar.append(b);
  }
  box.append(bar);
  overlay.append(box);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  $('#modalRoot').append(overlay);
  return { close };
}

function textPrompt(title, label, initial, onOk) {
  const body = el('div');
  const f = el('div', 'form-field');
  f.append(el('label', null, label));
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  f.append(input);
  body.append(f);
  const m = modal(title, body, [
    { label: t('Cancel') },
    {
      label: t('OK'),
      primary: true,
      onClick: () => {
        const v = input.value.trim();
        if (!v) {
          toast(t('Name cannot be empty'));
          return false;
        }
        onOk(v);
      },
    },
  ]);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = input.value.trim();
      if (v) {
        onOk(v);
        m.close();
      }
    }
  });
  input.focus();
  input.select();
}

function ctxMenu(x, y, items) {
  const root = $('#ctxRoot');
  root.innerHTML = '';
  const m = el('div', 'ctx-menu');

  function close() {
    root.innerHTML = '';
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onDoc(e) {
    if (!m.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  for (const it of items) {
    if (it === '-') {
      m.append(el('div', 'ctx-sep'));
      continue;
    }
    const d = el('div', 'ctx-item' + (it.danger ? ' danger' : ''), it.label);
    d.addEventListener('click', () => {
      close();
      it.onClick();
    });
    m.append(d);
  }
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
  root.append(m);
  m.style.left = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 8)) + 'px';
}

/* ============================== environment manager ============================== */

function parseDotEnv(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out.push({ key: m[1], value: v });
  }
  return out;
}

function openEnvManager() {
  let selId = state.activeEnvId || '__globals';

  const layout = el('div', 'env-layout');
  const left = el('div', 'env-list');
  const right = el('div', 'env-editor');
  layout.append(left, right);

  function refresh() {
    left.innerHTML = '';
    const add = el('button', null, t('+ New'));
    add.style.width = '100%';
    add.style.marginBottom = '8px';
    add.addEventListener('click', () => {
      const env = { id: uid(), name: t('New Environment'), vars: [] };
      state.environments.push(env);
      selId = env.id;
      persist();
      renderEnvSelect();
      refresh();
    });
    left.append(add);

    const gItem = el('div', 'env-list-item' + (selId === '__globals' ? ' sel' : ''), '⚙ ' + t('Globals'));
    gItem.addEventListener('click', () => {
      selId = '__globals';
      refresh();
    });
    left.append(gItem);

    for (const env of state.environments) {
      const item = el('div', 'env-list-item' + (env.id === selId ? ' sel' : ''), env.name);
      item.addEventListener('click', () => {
        selId = env.id;
        refresh();
      });
      left.append(item);
    }

    right.innerHTML = '';
    const isGlobals = selId === '__globals';
    const env = isGlobals ? null : state.environments.find((e) => e.id === selId);
    if (!isGlobals && !env) {
      right.append(
        Object.assign(el('div', 'env-empty'), {
          innerHTML: t('No environment selected.<br>Create one to define <b>{{variables}}</b><br>usable in URLs, headers, bodies and auth.'),
        })
      );
      return;
    }

    if (isGlobals) {
      right.append(el('div', 'panel-hint', t('Global variables are always available; the active environment overrides them.')));
    } else {
      const f = el('div', 'form-field');
      f.append(el('label', null, t('Environment name')));
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = env.name;
      nameInput.addEventListener('input', () => {
        env.name = nameInput.value;
        persist();
        renderEnvSelect();
      });
      f.append(nameInput);
      right.append(f);
    }

    right.append(el('div', 'panel-hint', t('Variables — use them anywhere as {{name}}. The 👁 toggle masks secrets on screen.')));
    const kvBox = el('div', 'kv');
    right.append(kvBox);
    const rowsRef = isGlobals ? () => state.globals : () => env.vars;
    renderKv(kvBox, rowsRef, () => persist(), { ac: false, secret: true });

    const controls = el('div');
    controls.style.marginTop = '14px';
    controls.style.display = 'flex';
    controls.style.gap = '8px';

    if (!isGlobals) {
      const activate = el('button', state.activeEnvId === env.id ? null : 'primary',
        state.activeEnvId === env.id ? t('Active ✓') : t('Set Active'));
      activate.addEventListener('click', () => {
        state.activeEnvId = state.activeEnvId === env.id ? null : env.id;
        persist();
        renderEnvSelect();
        refresh();
      });
      controls.append(activate);
    }

    const imp = el('button', null, t('Import .env…'));
    imp.title = t('Merge KEY=VALUE pairs from a .env file into these variables');
    imp.addEventListener('click', async () => {
      const f = await window.lostman.openFile({ filters: [{ name: 'Env files', extensions: ['env', '*'] }] });
      if (!f) return;
      if (f.error) {
        toast(f.error);
        return;
      }
      const pairs = parseDotEnv(f.content);
      if (!pairs.length) {
        toast(t('No KEY=VALUE pairs found in that file'));
        return;
      }
      const rows = rowsRef();
      for (const p of pairs) {
        const existing = rows.find((v) => v.key === p.key);
        if (existing) existing.value = p.value;
        else rows.push({ ...newKvRow(), key: p.key, value: p.value });
      }
      persist();
      refresh();
      toast(t('Imported {n} variable(s) from {name}', { n: pairs.length, name: f.name }));
    });
    controls.append(imp);

    if (!isGlobals) {
      const del = el('button', null, t('Delete'));
      del.addEventListener('click', () => {
        if (!confirm(t('Delete environment "{name}"?', { name: env.name }))) return;
        state.environments = state.environments.filter((e) => e !== env);
        if (state.activeEnvId === env.id) state.activeEnvId = null;
        selId = '__globals';
        persist();
        renderEnvSelect();
        refresh();
      });
      controls.append(del);
    }

    right.append(controls);
  }

  refresh();
  modal(t('Environments'), layout, [{ label: t('Close'), primary: true }]);
}

/* ============================== response toolbar events ============================== */

function initResponseToolbar() {
  $$('.resp-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      activeTab().respTab = b.dataset.rtab;
      renderResponse();
    })
  );
  $$('.resp-views button').forEach((b) =>
    b.addEventListener('click', () => {
      const tab = activeTab();
      tab.respView = b.dataset.rview;
      if (tab.search) tab.search = null;
      renderResponse();
    })
  );
}

/* ============================== splitter ============================== */

function initSplitter() {
  const splitter = $('#splitter');
  const editor = $('#editor');
  const content = $('#content');
  let dragging = false;

  splitter.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const top = editor.getBoundingClientRect().top;
    const max = content.getBoundingClientRect().bottom - top - 120;
    const h = Math.max(170, Math.min(max, e.clientY - top));
    editor.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

/* ============================== command palette ============================== */

function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const s = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1;
  return score - s.length * 0.01;
}

function paletteItems() {
  const items = [];
  for (const col of state.collections) {
    const addReq = (saved, folder) =>
      items.push({
        label: `${col.name}${folder ? ' / ' + folder.name : ''} / ${saved.name}`,
        method: saved.request.method,
        hint: saved.request.url,
        run: () => openSavedRequest(col, folder, saved),
      });
    for (const f of col.folders || []) for (const saved of f.requests) addReq(saved, f);
    for (const saved of col.requests) addReq(saved, null);
    items.push({ label: t('Run collection: {name}', { name: col.name }), run: () => openRunnerModal(col) });
  }
  for (const tb of state.tabs) {
    if (tb.id !== state.activeTabId)
      items.push({ label: t('Switch to tab: {name}', { name: tabLabel(tb) }), method: tb.request.method, run: () => switchTab(tb.id) });
  }
  items.push(
    { label: t('New Request Tab'), hint: 'Ctrl+T', run: newTab },
    { label: t('New Window'), hint: 'Ctrl+Shift+N', run: () => window.lostman.newWindow() },
    { label: t('Send Request'), hint: 'Ctrl+Enter', run: sendActive },
    { label: t('Save Request'), hint: 'Ctrl+S', run: saveActive },
    { label: t('Generate Code Snippet'), run: openCodeModal },
    { label: t('Import (Postman / OpenAPI / cURL / backup)'), run: openImportModal },
    { label: t('Manage Environments'), run: openEnvManager },
    { label: t('Manage Cookies'), run: openCookieModal },
    { label: t('Open Settings'), run: openSettings },
    {
      label: t('Toggle Light / Dark Theme'),
      run: () => {
        state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
        applyTheme();
        persist();
      },
    }
  );
  return items;
}

function openPalette() {
  const root = $('#modalRoot');
  const overlay = el('div', 'modal-overlay palette-overlay');
  const box = el('div', 'palette');
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.placeholder = t('Search requests, tabs and actions…');
  const list = el('div', 'palette-list');
  box.append(input, list);
  overlay.append(box);

  const all = paletteItems();
  let filtered = all.slice(0, 12);
  let sel = 0;

  function close() {
    overlay.remove();
  }
  function renderList() {
    list.innerHTML = '';
    filtered.forEach((item, i) => {
      const row = el('div', 'palette-item' + (i === sel ? ' sel' : ''));
      if (item.method) row.append(el('span', 'method-chip m-' + item.method, shortMethod(item.method)));
      row.append(el('span', 'palette-label', item.label));
      if (item.hint) row.append(el('span', 'palette-hint', item.hint));
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        close();
        item.run();
      });
      row.addEventListener('mousemove', () => {
        if (sel !== i) {
          sel = i;
          renderList();
        }
      });
      list.append(row);
    });
    if (!filtered.length) list.append(el('div', 'palette-empty', t('No matches')));
  }
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) filtered = all.slice(0, 12);
    else {
      filtered = all
        .map((item) => ({ item, score: fuzzyScore(q, item.label + ' ' + (item.hint || '')) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((x) => x.item);
    }
    sel = 0;
    renderList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length;
      renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[sel];
      if (item) {
        close();
        item.run();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  root.append(overlay);
  renderList();
  input.focus();
}

/* ============================== keyboard shortcuts ============================== */

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'enter') {
      e.preventDefault();
      sendActive();
    } else if (k === 's') {
      e.preventDefault();
      if (e.shiftKey) saveAsActive();
      else saveActive();
    } else if (k === 't') {
      e.preventDefault();
      newTab();
    } else if (k === 'w') {
      e.preventDefault();
      closeTab(state.activeTabId);
    } else if (k === 'f') {
      e.preventDefault();
      openRespSearch();
    } else if (k === 'k' || k === 'p') {
      e.preventDefault();
      openPalette();
    } else if (k === 'n' && e.shiftKey) {
      e.preventDefault();
      window.lostman.newWindow();
    }
  });
}

/* ============================== cookies ============================== */

function parseSetCookie(str, requestUrl) {
  const [nv, ...attrs] = String(str).split(';');
  const eq = nv.indexOf('=');
  if (eq < 0) return null;
  const c = {
    name: nv.slice(0, eq).trim(),
    value: nv.slice(eq + 1).trim(),
    domain: null,
    hostOnly: false,
    path: '/',
    expires: null,
    secure: false,
    httpOnly: false,
  };
  for (const attr of attrs) {
    const ai = attr.indexOf('=');
    const k = (ai === -1 ? attr : attr.slice(0, ai)).trim().toLowerCase();
    const v = ai === -1 ? '' : attr.slice(ai + 1).trim();
    if (k === 'domain' && v) c.domain = v.replace(/^\./, '').toLowerCase();
    else if (k === 'path' && v) c.path = v;
    else if (k === 'expires' && v) {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) c.expires = t;
    } else if (k === 'max-age' && v) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) c.expires = Date.now() + n * 1000;
    } else if (k === 'secure') c.secure = true;
    else if (k === 'httponly') c.httpOnly = true;
  }
  let host;
  try {
    host = new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!c.domain) {
    c.domain = host;
    c.hostOnly = true;
  } else if (host !== c.domain && !host.endsWith('.' + c.domain)) {
    return null;
  }
  return c;
}

function storeCookiesFromResponse(res, url) {
  if (!state.settings.cookiesEnabled) return;
  const setCookies = (res.headers || []).filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);
  if (!setCookies.length) return;
  for (const sc of setCookies) {
    const c = parseSetCookie(sc, url);
    if (!c) continue;
    const idx = state.cookies.findIndex((x) => x.name === c.name && x.domain === c.domain && x.path === c.path);
    if (c.expires !== null && c.expires <= Date.now()) {
      if (idx > -1) state.cookies.splice(idx, 1);
    } else if (idx > -1) {
      state.cookies[idx] = c;
    } else {
      state.cookies.push(c);
    }
  }
  persist();
}

function cookiesFor(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  const host = u.hostname.toLowerCase();
  const isSecure = u.protocol === 'https:' || u.protocol === 'wss:';
  const reqPath = u.pathname || '/';
  return state.cookies
    .filter(
      (c) =>
        (c.expires == null || c.expires > Date.now()) &&
        (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain)) &&
        (reqPath === c.path || reqPath.startsWith(c.path.endsWith('/') ? c.path : c.path + '/') || c.path === '/') &&
        (!c.secure || isSecure)
    )
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function openCookieModal() {
  const body = el('div');
  body.style.minWidth = '520px';

  const toggle = el('label', 'form-check');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.settings.cookiesEnabled !== false;
  cb.addEventListener('change', () => {
    state.settings.cookiesEnabled = cb.checked;
    persist();
  });
  toggle.append(cb, el('span', null, t('Automatically capture Set-Cookie responses and send matching cookies')));
  body.append(toggle);

  const listBox = el('div');
  body.append(listBox);

  function refresh() {
    state.cookies = state.cookies.filter((c) => c.expires == null || c.expires > Date.now());
    listBox.innerHTML = '';
    if (!state.cookies.length) {
      listBox.append(el('div', 'env-empty', t('No cookies stored yet — responses with Set-Cookie headers will appear here.')));
      return;
    }
    const domains = [...new Set(state.cookies.map((c) => c.domain))].sort();
    for (const d of domains) {
      const head = el('div', 'cookie-domain');
      head.append(el('span', null, d));
      const clearBtn = el('button', 'ghost', t('✕ clear'));
      clearBtn.addEventListener('click', () => {
        state.cookies = state.cookies.filter((c) => c.domain !== d);
        persist();
        refresh();
      });
      head.append(clearBtn);
      listBox.append(head);
      for (const c of state.cookies.filter((x) => x.domain === d)) {
        const row = el('div', 'cookie-row');
        row.append(el('span', 'ck-name', c.name), el('span', 'ck-val', '= ' + c.value));
        const meta = [];
        if (c.path !== '/') meta.push(c.path);
        if (c.secure) meta.push('secure');
        meta.push(c.expires ? t('expires {when}', { when: new Date(c.expires).toLocaleString() }) : t('session'));
        row.append(el('span', 'ck-meta', meta.join(' · ')));
        const del = el('button', 'kv-del', '✕');
        del.addEventListener('click', () => {
          state.cookies = state.cookies.filter((x) => x !== c);
          persist();
          refresh();
        });
        row.append(del);
        listBox.append(row);
      }
    }
  }
  refresh();

  modal(t('Cookies'), body, [
    {
      label: t('Clear All'),
      onClick: () => {
        if (!confirm(t('Delete all stored cookies?'))) return false;
        state.cookies = [];
        persist();
        refresh();
        return false;
      },
    },
    { label: t('Close'), primary: true },
  ]);
}

/* ============================== scripts sandbox ============================== */

function makeExpect() {
  return function expect(actual) {
    const fail = (msg) => {
      throw new Error(msg);
    };
    const str = (v) => {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    };
    return {
      toBe: (e) => {
        if (actual !== e) fail(`expected ${str(actual)} to be ${str(e)}`);
      },
      toEqual: (e) => {
        if (JSON.stringify(actual) !== JSON.stringify(e)) fail(`expected ${str(actual)} to equal ${str(e)}`);
      },
      toContain: (e) => {
        const ok = typeof actual === 'string' ? actual.includes(e) : Array.isArray(actual) && actual.includes(e);
        if (!ok) fail(`expected ${str(actual)} to contain ${str(e)}`);
      },
      toBeGreaterThan: (e) => {
        if (!(actual > e)) fail(`expected ${str(actual)} to be greater than ${str(e)}`);
      },
      toBeLessThan: (e) => {
        if (!(actual < e)) fail(`expected ${str(actual)} to be less than ${str(e)}`);
      },
      toBeDefined: () => {
        if (actual === undefined) fail('expected value to be defined');
      },
      toBeTruthy: () => {
        if (!actual) fail(`expected ${str(actual)} to be truthy`);
      },
      toHaveProperty: (p) => {
        let cur = actual;
        for (const seg of String(p).split('.')) {
          if (cur == null || !(seg in Object(cur))) fail(`expected object to have property "${p}"`);
          cur = cur[seg];
        }
      },
      toMatch: (re) => {
        const rx = re instanceof RegExp ? re : new RegExp(re);
        if (!rx.test(String(actual))) fail(`expected ${str(actual)} to match ${rx}`);
      },
    };
  };
}

function scriptVarApi(extra) {
  const setIn = (rows, k, v) => {
    const f = rows.find((r) => r.key === k);
    if (f) f.value = String(v);
    else rows.push({ ...newKvRow(), key: k, value: String(v) });
    persist();
  };
  const activeEnv = () => state.environments.find((e) => e.id === state.activeEnvId);
  return {
    variables: { get: (k) => varMap(extra)[k] },
    environment: {
      get: (k) => varMap(extra)[k],
      set: (k, v) => {
        const env = activeEnv();
        setIn(env ? env.vars : state.globals, k, v);
      },
    },
    globals: {
      get: (k) => varMap(extra)[k],
      set: (k, v) => setIn(state.globals, k, v),
    },
  };
}

function runScript(code, args) {
  try {
    const fn = new Function(...Object.keys(args), '"use strict";\n' + code);
    fn(...Object.values(args));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function runPreScript(code, payload, extra) {
  const findHeader = (k) => payload.headers.find((h) => h.key.toLowerCase() === String(k).toLowerCase());
  const pm = {
    ...scriptVarApi(extra),
    request: {
      get url() {
        return payload.url;
      },
      set url(v) {
        payload.url = String(v);
      },
      get method() {
        return payload.method;
      },
      set method(v) {
        payload.method = String(v).toUpperCase();
      },
      get body() {
        return payload.rawBody;
      },
      set body(v) {
        payload.rawBody = String(v);
        if (payload.bodyMode === 'none') payload.bodyMode = 'raw';
      },
      headers: {
        add: (h) => payload.headers.push({ key: h.key, value: h.value }),
        set: (k, v) => {
          const f = findHeader(k);
          if (f) f.value = String(v);
          else payload.headers.push({ key: k, value: String(v) });
        },
        get: (k) => findHeader(k)?.value ?? null,
        remove: (k) => {
          const i = payload.headers.findIndex((h) => h.key.toLowerCase() === String(k).toLowerCase());
          if (i > -1) payload.headers.splice(i, 1);
        },
      },
    },
  };
  return runScript(code, { pm, expect: makeExpect(), console: { log: () => {} } });
}

function runTests(code, res, extra) {
  const results = [];
  const pm = {
    ...scriptVarApi(extra),
    response: {
      code: res.status,
      status: res.statusText,
      responseTime: res.timeMs,
      size: res.size,
      text: () => res.bodyText || '',
      json: () => JSON.parse(res.bodyText || 'null'),
      headers: {
        get: (k) => {
          const f = (res.headers || []).find(([hk]) => hk.toLowerCase() === String(k).toLowerCase());
          return f ? f[1] : null;
        },
      },
    },
    test: (name, fn) => {
      try {
        fn();
        results.push({ name: String(name), ok: true });
      } catch (err) {
        results.push({ name: String(name), ok: false, error: String((err && err.message) || err) });
      }
    },
  };
  const r = runScript(code, { pm, expect: makeExpect(), console: { log: () => {} } });
  if (!r.ok) results.push({ name: '(script error)', ok: false, error: r.error });
  return results;
}

/* ============================== OAuth 2.0 token fetching ============================== */

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

async function oauthFetchToken() {
  const tab = activeTab();
  const a = tab.request.auth;
  const tokenUrl = applyEnv(a.tokenUrl).trim();
  if (!tokenUrl) {
    toast(t('Enter a Token URL first'));
    return;
  }
  const form = [];
  const headers = [];

  if (a.grant === 'auth_code') {
    const authUrl = applyEnv(a.authUrl).trim();
    if (!authUrl) {
      toast(t('Enter an Auth URL first'));
      return;
    }
    const verifier = randomString(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const stateParam = randomString(16);
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: applyEnv(a.clientId),
      redirect_uri: applyEnv(a.redirectUri),
      state: stateParam,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (a.scope) q.set('scope', applyEnv(a.scope));
    const result = await window.lostman.oauthAuthorize({
      authUrl: authUrl + (authUrl.includes('?') ? '&' : '?') + q.toString(),
      redirectUri: applyEnv(a.redirectUri),
    });
    if (!result || result.error || !result.code) {
      toast(t('Authorization failed: {error}', { error: result?.error || t('no code returned') }));
      return;
    }
    form.push(
      { key: 'grant_type', value: 'authorization_code' },
      { key: 'code', value: result.code },
      { key: 'redirect_uri', value: applyEnv(a.redirectUri) },
      { key: 'client_id', value: applyEnv(a.clientId) },
      { key: 'code_verifier', value: verifier }
    );
    if (a.clientSecret) form.push({ key: 'client_secret', value: applyEnv(a.clientSecret) });
  } else {
    form.push({ key: 'grant_type', value: 'client_credentials' });
    if (a.scope) form.push({ key: 'scope', value: applyEnv(a.scope) });
    if (a.clientAuth === 'basic') {
      headers.push({ key: 'Authorization', value: 'Basic ' + btoa(applyEnv(a.clientId) + ':' + applyEnv(a.clientSecret)) });
    } else {
      form.push({ key: 'client_id', value: applyEnv(a.clientId) }, { key: 'client_secret', value: applyEnv(a.clientSecret) });
    }
  }

  toast(t('Requesting token…'));
  const res = await window.lostman.send({
    id: uid(),
    method: 'POST',
    url: tokenUrl,
    headers: [...headers, { key: 'Accept', value: 'application/json' }],
    bodyMode: 'urlencoded',
    rawBody: null,
    formItems: form.map((f) => ({ ...f, type: 'text', filePath: '' })),
    settings: { timeoutMs: 30000, followRedirects: true, verifySsl: state.settings.verifySsl },
  });

  if (!res.ok) {
    toast(t('Token request failed: {error}', { error: res.error || t('network error') }));
    return;
  }
  let data = null;
  try {
    data = JSON.parse(res.bodyText || '');
  } catch {
    /* not JSON */
  }
  if (res.status >= 400 || !data || !data.access_token) {
    toast(
      t('Token endpoint returned {status}: {error}', {
        status: res.status,
        error: (data && (data.error_description || data.error)) || t('no access_token in response'),
      })
    );
    return;
  }
  a.accessToken = data.access_token;
  a.tokenType = data.token_type || 'Bearer';
  a.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
  persist();
  updateAuthUI();
  toast(t('Access token stored — it will be sent as an Authorization header'));
}

/* ============================== {{variable}} autocomplete ============================== */

let acInput = null;
let acStart = 0;
let acIndex = 0;
let acItems = [];

function hideAC() {
  $('#acRoot').innerHTML = '';
  acInput = null;
  acItems = [];
}

function acCandidates(prefix) {
  const vars = Object.keys(varMap(null));
  const chains = [...chainStore.keys()].map((n) => `res.${n}.body`);
  const all = [...vars, ...chains];
  const p = prefix.toLowerCase();
  return all.filter((n) => n.toLowerCase().startsWith(p) && n !== prefix).slice(0, 8);
}

function showAC(input) {
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const m = before.match(/\{\{\s*([\w.-]*)$/);
  if (!m) {
    hideAC();
    return;
  }
  const items = acCandidates(m[1]);
  if (!items.length) {
    hideAC();
    return;
  }
  acInput = input;
  acStart = pos - m[1].length;
  acItems = items;
  acIndex = 0;
  const root = $('#acRoot');
  root.innerHTML = '';
  const menu = el('div', 'ac-menu');
  const vm = varMap(null);
  items.forEach((name, i) => {
    const item = el('div', 'ac-item' + (i === acIndex ? ' sel' : ''));
    item.textContent = name;
    if (name in vm && vm[name]) {
      const v = el('span', 'ac-val', String(vm[name]).slice(0, 24));
      item.append(v);
    }
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acPick(name);
    });
    menu.append(item);
  });
  root.append(menu);
  const rect = input.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 10) + 'px';
  menu.style.top = Math.min(rect.bottom + 3, window.innerHeight - menu.offsetHeight - 10) + 'px';
}

function acPick(name) {
  if (!acInput) return;
  const input = acInput;
  const pos = input.selectionStart ?? input.value.length;
  const after = input.value.slice(pos);
  const closing = after.startsWith('}}') ? '' : '}}';
  input.value = input.value.slice(0, acStart) + name + closing + after;
  const cursor = acStart + name.length + closing.length;
  input.setSelectionRange(cursor, cursor);
  hideAC();
  input.dispatchEvent(new Event('input', { bubbles: false }));
  input.focus();
}

function attachAC(input) {
  if (!input) return;
  input.addEventListener('input', () => showAC(input));
  input.addEventListener('blur', () => setTimeout(hideAC, 120));
  input.addEventListener('keydown', (e) => {
    if (!acItems.length || acInput !== input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : acItems.length - 1)) % acItems.length;
      $$('.ac-item').forEach((n, i) => n.classList.toggle('sel', i === acIndex));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acPick(acItems[acIndex]);
    } else if (e.key === 'Escape') {
      hideAC();
    }
  });
}

/* ============================== WebSocket / SSE console ============================== */

function toggleStream(tab) {
  if (tab.stream && tab.stream.status !== 'closed') {
    window.lostman.streamClose({ id: tab.stream.id });
    tab.stream.status = 'closed';
    tab.stream.messages.push({ dir: 'sys', text: t('Disconnected'), ts: Date.now() });
    updateSendButton();
    renderResponse();
    return;
  }
  const payload = buildPayloadFromRequest(tab.request, null);
  if (!payload) {
    toast(t('Enter a URL first'));
    return;
  }
  const kind = tab.request.method === 'WS' ? 'ws' : 'sse';
  let url = payload.url;
  if (kind === 'ws') url = url.replace(/^http/i, 'ws');
  else url = url.replace(/^ws(s?):\/\//i, 'http$1://');
  const id = uid();
  tab.stream = { id, kind, status: 'connecting', messages: [{ dir: 'sys', text: t('Connecting to {url}…', { url }), ts: Date.now() }], input: '' };
  updateSendButton();
  renderResponse();
  window.lostman.streamOpen({ id, kind, url, headers: payload.headers });
}

function handleStreamEvent(ev) {
  const tab = state.tabs.find((t) => t.stream && t.stream.id === ev.id);
  if (!tab) return;
  const st = tab.stream;
  if (ev.type === 'open') {
    st.status = 'open';
    st.messages.push({ dir: 'sys', text: t('Connected') + (ev.data ? ' — ' + ev.data : ''), ts: ev.ts });
  } else if (ev.type === 'message') {
    st.messages.push({ dir: 'in', text: ev.data, ts: ev.ts });
  } else if (ev.type === 'error') {
    st.messages.push({ dir: 'sys', text: t('Error: {error}', { error: ev.data }), ts: ev.ts });
  } else if (ev.type === 'close') {
    st.status = 'closed';
    st.messages.push({ dir: 'sys', text: t('Closed') + (ev.data ? ' — ' + ev.data : ''), ts: ev.ts });
  }
  if (st.messages.length > 500) st.messages.splice(0, st.messages.length - 500);
  if (tab === activeTab()) {
    renderResponse();
    updateSendButton();
  }
}

function renderStreamConsole(box, tab) {
  box.innerHTML = '';
  const st = tab.stream;
  const wrap = el('div', 'stream-console');

  const status = el('div', 'stream-status');
  const pill = el('span', 'pill s-' + (st ? st.status : 'closed'), st ? t(st.status) : t('not connected'));
  status.append(pill);
  status.append(el('span', null, tab.request.method === 'WS' ? 'WebSocket' : 'Server-Sent Events'));
  if (st && st.messages.length) {
    const clear = el('button', 'ghost', t('Clear'));
    clear.addEventListener('click', () => {
      st.messages = [];
      renderResponse();
    });
    status.append(clear);
  }
  wrap.append(status);

  const log = el('div', 'stream-log');
  if (!st || !st.messages.length) {
    log.append(
      Object.assign(el('div', 'resp-empty'), {
        innerHTML: `<div>${esc(
          tab.request.method === 'WS' ? t('Enter a ws:// or wss:// URL and click Connect') : t('Enter a URL and click Connect')
        )}</div>`,
      })
    );
  } else {
    for (const msg of st.messages) {
      const row = el('div', 'stream-msg ' + msg.dir);
      row.append(el('span', 'sm-time', new Date(msg.ts).toLocaleTimeString()));
      row.append(el('span', 'sm-dir', msg.dir === 'in' ? '▼' : msg.dir === 'out' ? '▲' : '•'));
      row.append(el('span', 'sm-text', msg.text));
      log.append(row);
    }
  }
  wrap.append(log);

  if (tab.request.method === 'WS') {
    const inputRow = el('div', 'stream-input');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = st && st.status === 'open' ? t('Message to send…') : t('Connect first to send messages');
    input.disabled = !st || st.status !== 'open';
    input.value = (st && st.input) || '';
    input.addEventListener('input', () => {
      if (st) st.input = input.value;
    });
    const sendMsg = () => {
      if (!st || st.status !== 'open' || !input.value) return;
      window.lostman.streamSend({ id: st.id, message: input.value });
      st.messages.push({ dir: 'out', text: input.value, ts: Date.now() });
      st.input = '';
      renderResponse();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMsg();
    });
    const btn = el('button', 'primary', t('Send'));
    btn.disabled = !st || st.status !== 'open';
    btn.addEventListener('click', sendMsg);
    inputRow.append(input, btn);
    wrap.append(inputRow);
  }

  box.append(wrap);
  log.scrollTop = log.scrollHeight;
}

/* ============================== collection runner ============================== */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function openRunnerModal(col) {
  const seq = [];
  for (const f of col.folders || []) for (const s of f.requests) seq.push(s);
  for (const s of col.requests) seq.push(s);
  if (!seq.length) {
    toast(t('This collection has no requests to run'));
    return;
  }

  const body = el('div');
  body.style.minWidth = '540px';
  body.append(
    el(
      'div',
      'panel-hint',
      t("{n} request(s) will run in order. Optionally iterate over a CSV or JSON-array data file — each row's columns become {{variables}}.", { n: seq.length })
    )
  );

  let dataRows = null;
  const fileRow = el('div');
  fileRow.style.display = 'flex';
  fileRow.style.gap = '8px';
  fileRow.style.alignItems = 'center';
  fileRow.style.marginBottom = '10px';
  const fileBtn = el('button', null, t('Choose data file…'));
  const fileLabel = el('span', 'panel-hint', t('no data file (single run)'));
  fileLabel.style.margin = '0';
  fileBtn.addEventListener('click', async () => {
    const f = await window.lostman.openFile({ filters: [{ name: 'Data', extensions: ['csv', 'json'] }, { name: 'All Files', extensions: ['*'] }] });
    if (!f) return;
    if (f.error) {
      toast(f.error);
      return;
    }
    try {
      if (f.content.trim().startsWith('[')) {
        const arr = JSON.parse(f.content);
        dataRows = arr.filter((x) => x && typeof x === 'object');
      } else {
        dataRows = parseCSV(f.content);
      }
    } catch {
      dataRows = null;
    }
    if (!dataRows || !dataRows.length) {
      fileLabel.textContent = t('could not parse that file (expected CSV with a header row, or a JSON array of objects)');
      dataRows = null;
    } else {
      fileLabel.textContent = t('{name} — {n} iteration(s)', { name: f.name, n: dataRows.length });
    }
  });
  fileRow.append(fileBtn, fileLabel);
  body.append(fileRow);

  const delayRow = el('div', 'form-field');
  delayRow.append(el('label', null, t('Delay between requests (ms)')));
  const delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.min = '0';
  delayInput.value = '0';
  delayRow.append(delayInput);
  body.append(delayRow);

  const runBtn = el('button', 'primary', t('Run'));
  body.append(runBtn);

  const results = el('div', 'run-results');
  const summary = el('div', 'run-summary');
  body.append(results, summary);

  const ui = { stopped: false };

  runBtn.addEventListener('click', async () => {
    if (runBtn.dataset.running === '1') {
      ui.stopped = true;
      runBtn.dataset.running = '';
      runBtn.textContent = t('Run');
      return;
    }
    ui.stopped = false;
    runBtn.dataset.running = '1';
    runBtn.textContent = t('Stop');
    results.innerHTML = '';
    summary.textContent = '';
    const rows = dataRows && dataRows.length ? dataRows : [null];
    let okCount = 0;
    let failCount = 0;
    let testPass = 0;
    let testFail = 0;
    const started = Date.now();

    for (let it = 0; it < rows.length; it++) {
      for (const saved of seq) {
        if (ui.stopped || !results.isConnected) break;
        const label = rows.length > 1 ? `[${it + 1}] ${saved.name}` : saved.name;
        const r = saved.request;
        const payload = buildPayloadFromRequest(r, rows[it]);
        const rowEl = el('div', 'run-row');
        rowEl.append(el('span', 'method-chip m-' + r.method, shortMethod(r.method)), el('span', 'rr-name', label));
        results.append(rowEl);
        results.scrollTop = results.scrollHeight;

        if (!payload || r.method === 'WS' || r.method === 'SSE') {
          rowEl.append(el('span', 'rr-status', t('skipped')));
          continue;
        }
        payload.id = uid();
        if (r.preScript && r.preScript.trim()) {
          const pre = runPreScript(r.preScript, payload, rows[it]);
          if (!pre.ok) {
            rowEl.append(Object.assign(el('span', 'rr-status', t('pre-script error')), { style: 'color: var(--err)' }));
            failCount++;
            continue;
          }
        }
        const res = await window.lostman.send(payload);
        if (res.ok) {
          okCount++;
          storeCookiesFromResponse(res, payload.url);
          setChain(saved.name, res);
          const st = el('span', 'rr-status', String(res.status));
          st.style.color = res.status < 400 ? 'var(--ok)' : 'var(--err)';
          rowEl.append(st, el('span', 'ck-meta', formatTime(res.timeMs)));
          if (r.testScript && r.testScript.trim()) {
            const tr = runTests(r.testScript, res, rows[it]);
            const passed = tr.filter((t) => t.ok).length;
            testPass += passed;
            testFail += tr.length - passed;
            const tl = el('span', 'ck-meta', t('tests {a}/{b}', { a: passed, b: tr.length }));
            if (passed < tr.length) tl.style.color = 'var(--err)';
            rowEl.append(tl);
          }
        } else {
          failCount++;
          rowEl.append(Object.assign(el('span', 'rr-status', res.aborted ? t('cancelled') : t('failed')), { style: 'color: var(--err)' }));
          rowEl.append(el('span', 'ck-meta', res.error || ''));
        }
        const delay = Math.max(0, parseInt(delayInput.value, 10) || 0);
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (ui.stopped || !results.isConnected) break;
    }

    runBtn.dataset.running = '';
    runBtn.textContent = t('Run');
    const bits = [t('{n} sent', { n: okCount }), t('{n} failed', { n: failCount })];
    if (testPass + testFail) bits.push(t('tests: {a} passed, {b} failed', { a: testPass, b: testFail }));
    bits.push(t('in {time}', { time: formatTime(Date.now() - started) }));
    summary.textContent = (ui.stopped ? t('Stopped') : t('Done')) + ' — ' + bits.join(' · ');
    renderSidebar();
  });

  modal(t('Run "{name}"', { name: col.name }), body, [{ label: t('Close') }]);
}

/* ============================== import: detection ============================== */

function importFromJsonText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    toast(t('Not valid JSON (YAML specs must be converted to JSON first)'));
    return false;
  }
  if (obj && obj.info && Array.isArray(obj.item)) {
    const { col, env, count } = importPostman(obj);
    state.collections.push(col);
    if (env) {
      state.environments.push(env);
      renderEnvSelect();
    }
    persist();
    renderSidebar();
    toast(t('Imported "{name}" — {n} request(s)', { name: col.name, n: count }) + (env ? ' + ' + t('variables environment') : ''));
    return true;
  }
  if (obj && (obj.openapi || obj.swagger)) {
    const { col, count } = importOpenApi(obj);
    state.collections.push(col);
    persist();
    renderSidebar();
    toast(t('Imported "{name}" — {n} request(s) from the spec', { name: col.name, n: count }));
    return true;
  }
  if (obj && Array.isArray(obj.values) && obj._postman_variable_scope) {
    const env = {
      id: uid(),
      name: obj.name || t('Imported environment'),
      vars: obj.values.filter((v) => v.key).map((v) => ({ ...newKvRow(), key: v.key, value: v.value ?? '', enabled: v.enabled !== false })),
    };
    state.environments.push(env);
    persist();
    renderEnvSelect();
    toast(t('Imported environment "{name}" ({n} variables)', { name: env.name, n: env.vars.length }));
    return true;
  }
  if (obj && Array.isArray(obj.collections) && Array.isArray(obj.tabs)) {
    if (!confirm(t('Restore this Lostman backup? It will REPLACE all current collections, history, environments, tabs and settings.')))
      return false;
    restoreBackup(obj);
    toast(t('Backup restored'));
    return true;
  }
  toast(t('Unrecognized format — expected a Postman collection/environment, OpenAPI JSON spec, or Lostman backup'));
  return false;
}

function openImportModal() {
  const body = el('div');
  body.append(
    el('div', 'panel-hint', t('Import a Postman collection (v2.x) or environment, an OpenAPI 3 / Swagger 2 spec (JSON), or a Lostman backup.'))
  );
  const fileBtn = el('button', 'primary', t('Choose file…'));
  fileBtn.style.marginBottom = '14px';
  body.append(fileBtn);

  body.append(el('div', 'panel-hint', t('Or paste a cURL command to open it as a new request tab:')));
  const ta = document.createElement('textarea');
  ta.rows = 5;
  ta.spellcheck = false;
  ta.style.width = '100%';
  ta.style.fontFamily = 'var(--mono)';
  ta.style.fontSize = '12px';
  ta.placeholder = 'curl https://api.example.com/users -H "Authorization: Bearer {{token}}"';
  body.append(ta);
  const curlBtn = el('button', null, t('Import cURL'));
  curlBtn.style.marginTop = '8px';
  body.append(curlBtn);

  const m = modal(t('Import'), body, [{ label: t('Close') }]);

  fileBtn.addEventListener('click', async () => {
    const f = await window.lostman.openFile();
    if (!f) return;
    if (f.error) {
      toast(f.error);
      return;
    }
    if (importFromJsonText(f.content)) m.close();
  });

  curlBtn.addEventListener('click', () => {
    try {
      const req = parseCurl(ta.value);
      const tab = makeTab(req);
      state.tabs.push(tab);
      m.close();
      switchTab(tab.id);
      toast(t('cURL imported into a new tab'));
    } catch (err) {
      toast(err.message || t('Could not parse the cURL command'));
    }
  });
}

/* ============================== import/export: Postman ============================== */

const pmKV = (list) =>
  (list || []).filter((h) => h && h.key).map((h) => ({ ...newKvRow(), key: h.key, value: h.value ?? '', enabled: h.disabled !== true }));

function pmAuthGet(auth, type, key) {
  const section = auth ? auth[type] : null;
  if (Array.isArray(section)) {
    const f = section.find((x) => x.key === key);
    return f ? f.value ?? '' : '';
  }
  if (section && typeof section === 'object') return section[key] ?? '';
  return '';
}

function convertPostmanRequest(pr) {
  const r = blankRequest();
  if (typeof pr === 'string') {
    r.url = pr;
    return r;
  }
  const method = (pr.method || 'GET').toUpperCase();
  r.method = METHODS.includes(method) ? method : 'GET';

  const u = pr.url;
  if (typeof u === 'string') r.url = u;
  else if (u) {
    r.url = u.raw || '';
    if (!r.url && Array.isArray(u.host)) {
      r.url = (u.protocol ? u.protocol + '://' : '') + u.host.join('.') + (u.port ? ':' + u.port : '') + '/' + (Array.isArray(u.path) ? u.path.join('/') : '');
    }
    if (Array.isArray(u.query) && u.query.length) {
      const [base] = splitUrl(r.url);
      r.params = u.query.map((qp) => ({ ...newKvRow(), key: qp.key || '', value: qp.value ?? '', enabled: qp.disabled !== true }));
      const enabled = r.params.filter((p) => p.enabled && p.key);
      r.url = enabled.length ? base + '?' + enabled.map((p) => prettyEncode(p.key) + '=' + prettyEncode(p.value)).join('&') : base;
    }
  }

  r.headers = pmKV(pr.header);

  const b = pr.body;
  if (b) {
    if (b.mode === 'raw') {
      r.bodyMode = 'raw';
      r.rawBody = b.raw || '';
      const lang = b.options && b.options.raw && b.options.raw.language;
      r.rawType = (lang ? /json/i.test(lang) : /^\s*[[{]/.test(r.rawBody)) ? 'json' : 'text';
    } else if (b.mode === 'urlencoded') {
      r.bodyMode = 'urlencoded';
      r.formItems = pmKV(b.urlencoded);
    } else if (b.mode === 'formdata') {
      r.bodyMode = 'formdata';
      r.formItems = (b.formdata || []).filter((f) => f && f.key).map((f) => ({
        ...newKvRow(),
        key: f.key,
        value: f.value ?? '',
        enabled: f.disabled !== true,
        type: f.type === 'file' ? 'file' : 'text',
        filePath: typeof f.src === 'string' ? f.src : Array.isArray(f.src) ? f.src[0] || '' : '',
      }));
    } else if (b.mode === 'graphql' && b.graphql) {
      r.bodyMode = 'raw';
      r.rawType = 'json';
      let vars = {};
      try {
        vars = typeof b.graphql.variables === 'string' ? JSON.parse(b.graphql.variables) : b.graphql.variables || {};
      } catch {
        vars = {};
      }
      r.rawBody = JSON.stringify({ query: b.graphql.query || '', variables: vars }, null, 2);
    }
  }

  const a = pr.auth;
  if (a && a.type === 'bearer') {
    r.auth.type = 'bearer';
    r.auth.token = pmAuthGet(a, 'bearer', 'token');
  } else if (a && a.type === 'basic') {
    r.auth.type = 'basic';
    r.auth.username = pmAuthGet(a, 'basic', 'username');
    r.auth.password = pmAuthGet(a, 'basic', 'password');
  } else if (a && a.type === 'apikey') {
    r.auth.type = 'apikey';
    r.auth.keyName = pmAuthGet(a, 'apikey', 'key');
    r.auth.keyValue = pmAuthGet(a, 'apikey', 'value');
    r.auth.addTo = pmAuthGet(a, 'apikey', 'in') === 'query' ? 'query' : 'header';
  }
  return r;
}

function importPostman(doc) {
  const col = { id: uid(), name: (doc.info && doc.info.name) || 'Imported Collection', open: true, requests: [], folders: [] };
  let count = 0;
  const walk = (items, folderName) => {
    for (const it of items || []) {
      if (Array.isArray(it.item)) {
        walk(it.item, folderName ? `${folderName} / ${it.name || 'Folder'}` : it.name || 'Folder');
      } else if (it.request) {
        const reqObj = { id: uid(), name: it.name || 'Request', request: convertPostmanRequest(it.request) };
        if (folderName) {
          let f = col.folders.find((x) => x.name === folderName);
          if (!f) {
            f = { id: uid(), name: folderName, open: false, requests: [] };
            col.folders.push(f);
          }
          f.requests.push(reqObj);
        } else {
          col.requests.push(reqObj);
        }
        count++;
      }
    }
  };
  walk(doc.item, null);

  let env = null;
  const vars = (doc.variable || []).filter((v) => v && v.key);
  if (vars.length) {
    env = {
      id: uid(),
      name: `${col.name} variables`,
      vars: vars.map((v) => ({ ...newKvRow(), key: v.key, value: v.value ?? '' })),
    };
  }
  return { col, env, count };
}

function convertToPostmanRequest(r) {
  const out = {
    method: r.method,
    header: r.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, ...(h.enabled === false ? { disabled: true } : {}) })),
  };

  const [base] = splitUrl(r.url);
  const enabled = r.params.filter((p) => p.enabled !== false && p.key);
  const raw = enabled.length ? base + '?' + enabled.map((p) => prettyEncode(p.key) + '=' + prettyEncode(p.value)).join('&') : base;
  const urlObj = { raw };
  const m = base.match(/^(https?):\/\/([^/]+)(\/?.*)$/i);
  if (m) {
    urlObj.protocol = m[1].toLowerCase();
    const hostport = m[2].split(':');
    urlObj.host = hostport[0].split('.');
    if (hostport[1]) urlObj.port = hostport[1];
    const p = m[3].replace(/^\//, '');
    urlObj.path = p ? p.split('/') : [];
  }
  if (r.params.some((p) => p.key)) {
    urlObj.query = r.params.filter((p) => p.key).map((p) => ({ key: p.key, value: p.value, ...(p.enabled === false ? { disabled: true } : {}) }));
  }
  out.url = urlObj;

  if (r.bodyMode === 'raw' && r.rawBody) {
    out.body = { mode: 'raw', raw: r.rawBody, options: { raw: { language: r.rawType === 'json' ? 'json' : 'text' } } };
  } else if (r.bodyMode === 'urlencoded') {
    out.body = {
      mode: 'urlencoded',
      urlencoded: r.formItems.filter((f) => f.key).map((f) => ({ key: f.key, value: f.value, ...(f.enabled === false ? { disabled: true } : {}) })),
    };
  } else if (r.bodyMode === 'formdata') {
    out.body = {
      mode: 'formdata',
      formdata: r.formItems.filter((f) => f.key).map((f) =>
        f.type === 'file'
          ? { key: f.key, type: 'file', src: f.filePath, ...(f.enabled === false ? { disabled: true } : {}) }
          : { key: f.key, type: 'text', value: f.value, ...(f.enabled === false ? { disabled: true } : {}) }
      ),
    };
  }

  if (r.auth.type === 'bearer' && r.auth.token) {
    out.auth = { type: 'bearer', bearer: [{ key: 'token', value: r.auth.token, type: 'string' }] };
  } else if (r.auth.type === 'basic') {
    out.auth = {
      type: 'basic',
      basic: [
        { key: 'username', value: r.auth.username, type: 'string' },
        { key: 'password', value: r.auth.password, type: 'string' },
      ],
    };
  } else if (r.auth.type === 'apikey' && r.auth.keyName) {
    out.auth = {
      type: 'apikey',
      apikey: [
        { key: 'key', value: r.auth.keyName, type: 'string' },
        { key: 'value', value: r.auth.keyValue, type: 'string' },
        { key: 'in', value: r.auth.addTo === 'query' ? 'query' : 'header', type: 'string' },
      ],
    };
  }
  return out;
}

function exportPostman(col) {
  const reqToItem = (s) => ({ name: s.name, request: convertToPostmanRequest(s.request), response: [] });
  const item = [];
  for (const f of col.folders || []) item.push({ name: f.name, item: f.requests.map(reqToItem) });
  for (const s of col.requests) item.push(reqToItem(s));
  return {
    info: {
      _postman_id: col.id,
      name: col.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item,
  };
}

/* ============================== import: OpenAPI / Swagger ============================== */

function importOpenApi(doc) {
  const col = { id: uid(), name: (doc.info && doc.info.title) || 'Imported API', open: true, requests: [], folders: [] };
  const isV3 = !!doc.openapi;
  let base = '';
  if (isV3) {
    base = (doc.servers && doc.servers[0] && doc.servers[0].url) || '';
  } else {
    const scheme = (doc.schemes && doc.schemes[0]) || 'https';
    base = doc.host ? `${scheme}://${doc.host}${doc.basePath || ''}` : doc.basePath || '';
  }
  base = base.replace(/\/$/, '');

  const resolveRef = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
    let cur = doc;
    for (const seg of ref.slice(2).split('/')) {
      cur = cur ? cur[seg.replace(/~1/g, '/').replace(/~0/g, '~')] : null;
    }
    return cur;
  };
  const deref = (s) => {
    const seen = new Set();
    while (s && s.$ref && !seen.has(s.$ref)) {
      seen.add(s.$ref);
      s = resolveRef(s.$ref);
    }
    return s || {};
  };

  function example(schema, depth = 0) {
    schema = deref(schema);
    if (!schema || depth > 3) return null;
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    if (Array.isArray(schema.allOf)) {
      const o = {};
      for (const part of schema.allOf) {
        const v = example(part, depth + 1);
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(o, v);
      }
      return o;
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.length) return example(schema.oneOf[0], depth + 1);
    if (Array.isArray(schema.anyOf) && schema.anyOf.length) return example(schema.anyOf[0], depth + 1);
    const t = schema.type || (schema.properties ? 'object' : null);
    if (t === 'object') {
      const o = {};
      const props = schema.properties || {};
      let i = 0;
      for (const k of Object.keys(props)) {
        if (i++ >= 25) break;
        o[k] = example(props[k], depth + 1);
      }
      return o;
    }
    if (t === 'array') return [example(schema.items, depth + 1)];
    if (t === 'integer' || t === 'number') return 0;
    if (t === 'boolean') return true;
    if (t === 'string') {
      if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (schema.format === 'date') return '2026-01-01';
      return 'string';
    }
    return null;
  }

  let count = 0;
  const OPS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  for (const [p, pathItem0] of Object.entries(doc.paths || {})) {
    const pathItem = deref(pathItem0);
    const commonParams = pathItem.parameters || [];
    for (const meth of OPS) {
      const op = pathItem[meth];
      if (!op) continue;
      const r = blankRequest();
      r.method = meth.toUpperCase();
      r.url = (base + p).replace(/\{([^{}]+)\}/g, '{{$1}}');

      const params = [...commonParams, ...(op.parameters || [])].map(deref);
      for (const prm of params) {
        if (prm.in === 'query') r.params.push({ ...newKvRow(), key: prm.name || '', enabled: prm.required === true });
        else if (prm.in === 'header') r.headers.push({ ...newKvRow(), key: prm.name || '', enabled: prm.required === true });
      }

      if (isV3) {
        const content = op.requestBody ? deref(op.requestBody).content : null;
        if (content) {
          const key =
            ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'].find((k) => content[k]) ||
            Object.keys(content)[0];
          const media = content[key] || {};
          if (/json/i.test(key)) {
            r.bodyMode = 'raw';
            r.rawType = 'json';
            const ex =
              media.example ??
              (media.examples ? Object.values(media.examples)[0]?.value : undefined) ??
              example(media.schema);
            r.rawBody = JSON.stringify(ex ?? {}, null, 2);
          } else {
            const schema = deref(media.schema || {});
            r.bodyMode = /multipart/i.test(key) ? 'formdata' : 'urlencoded';
            for (const k of Object.keys(schema.properties || {})) {
              const ps = deref(schema.properties[k]);
              r.formItems.push({ ...newKvRow(), key: k, type: ps.format === 'binary' ? 'file' : 'text' });
            }
          }
        }
      } else {
        const bodyParam = params.find((x) => x.in === 'body');
        if (bodyParam) {
          r.bodyMode = 'raw';
          r.rawType = 'json';
          r.rawBody = JSON.stringify(example(bodyParam.schema) ?? {}, null, 2);
        }
        const formParams = params.filter((x) => x.in === 'formData');
        if (formParams.length) {
          const multipart = (op.consumes || doc.consumes || []).includes('multipart/form-data');
          r.bodyMode = multipart ? 'formdata' : 'urlencoded';
          for (const fp of formParams) {
            r.formItems.push({ ...newKvRow(), key: fp.name || '', type: fp.type === 'file' ? 'file' : 'text', enabled: fp.required === true });
          }
        }
      }

      const item = { id: uid(), name: op.summary || op.operationId || `${r.method} ${p}`, request: r };
      const tag = (op.tags && op.tags[0]) || null;
      if (tag) {
        let f = col.folders.find((x) => x.name === tag);
        if (!f) {
          f = { id: uid(), name: tag, open: false, requests: [] };
          col.folders.push(f);
        }
        f.requests.push(item);
      } else {
        col.requests.push(item);
      }
      count++;
    }
  }
  return { col, count };
}

/* ============================== import: cURL ============================== */

function tokenizeCurl(s) {
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    let tok = '';
    let consumed = false;
    while (i < n && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === "'" || (c === '$' && s[i + 1] === "'")) {
        if (c === '$') i++;
        i++;
        while (i < n && s[i] !== "'") tok += s[i++];
        i++;
        consumed = true;
      } else if (c === '"') {
        i++;
        while (i < n && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < n && '"\\$`'.includes(s[i + 1])) {
            tok += s[i + 1];
            i += 2;
          } else {
            tok += s[i++];
          }
        }
        i++;
        consumed = true;
      } else if (c === '\\' && i + 1 < n) {
        tok += s[i + 1];
        i += 2;
      } else {
        tok += s[i++];
      }
    }
    if (tok !== '' || consumed) out.push(tok);
  }
  return out;
}

function parseCurl(text) {
  let s = String(text || '').trim();
  if (!/^curl\b/i.test(s)) throw new Error(t('The command must start with "curl"'));
  s = s.replace(/\\\s*\r?\n/g, ' ').replace(/`\s*\r?\n/g, ' ').replace(/\^\s*\r?\n/g, ' ');
  const tokens = tokenizeCurl(s);

  const req = blankRequest();
  let url = '';
  let method = '';
  const dataParts = [];
  const dataUrlencode = [];
  let isForm = false;
  let forceGet = false;

  const SKIP_WITH_ARG = ['-o', '--output', '--connect-timeout', '-m', '--max-time', '--retry', '--cacert', '--capath', '-c', '--cookie-jar', '-w', '--write-out'];
  const SKIP_FLAGS = ['-k', '--insecure', '--compressed', '-s', '--silent', '-L', '--location', '-v', '--verbose', '-i', '--include', '-S', '--show-error', '-g', '--globoff'];

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i] ?? '';
    if (t.startsWith('-X') && t.length > 2) method = t.slice(2).toUpperCase();
    else if (t === '-X' || t === '--request') method = next().toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = next();
      const ci = h.indexOf(':');
      if (ci > -1) req.headers.push({ ...newKvRow(), key: h.slice(0, ci).trim(), value: h.slice(ci + 1).trim() });
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      dataParts.push(next());
    } else if (t === '--data-urlencode') {
      dataUrlencode.push(next());
    } else if (t === '-F' || t === '--form') {
      isForm = true;
      const f = next();
      const eq = f.indexOf('=');
      if (eq > -1) {
        const k = f.slice(0, eq);
        const v = f.slice(eq + 1);
        if (v.startsWith('@')) req.formItems.push({ ...newKvRow(), key: k, type: 'file', filePath: v.slice(1) });
        else req.formItems.push({ ...newKvRow(), key: k, value: v });
      }
    } else if (t === '-u' || t === '--user') {
      const u = next();
      const ci = u.indexOf(':');
      req.auth.type = 'basic';
      req.auth.username = ci > -1 ? u.slice(0, ci) : u;
      req.auth.password = ci > -1 ? u.slice(ci + 1) : '';
    } else if (t === '--url') url = next();
    else if (t === '-G' || t === '--get') forceGet = true;
    else if (t === '-I' || t === '--head') method = method || 'HEAD';
    else if (t === '-A' || t === '--user-agent') req.headers.push({ ...newKvRow(), key: 'User-Agent', value: next() });
    else if (t === '-e' || t === '--referer') req.headers.push({ ...newKvRow(), key: 'Referer', value: next() });
    else if (t === '-b' || t === '--cookie') req.headers.push({ ...newKvRow(), key: 'Cookie', value: next() });
    else if (SKIP_WITH_ARG.includes(t)) next();
    else if (SKIP_FLAGS.includes(t)) {
      /* ignored */
    } else if (!t.startsWith('-') && !url) url = t;
  }

  if (!url) throw new Error(t('No URL found in the cURL command'));

  if (isForm) {
    req.bodyMode = 'formdata';
    method = method || 'POST';
  } else if (dataParts.length || dataUrlencode.length) {
    if (forceGet) {
      const qs = [...dataParts, ...dataUrlencode].join('&');
      url += (url.includes('?') ? '&' : '?') + qs;
      method = method || 'GET';
    } else {
      method = method || 'POST';
      const ctHeader = req.headers.find((h) => h.key.toLowerCase() === 'content-type');
      const looksJson = /^\s*[[{]/.test(dataParts[0] || '');
      if (looksJson || (ctHeader && /json/i.test(ctHeader.value))) {
        req.bodyMode = 'raw';
        req.rawType = 'json';
        req.rawBody = dataParts.join('&');
      } else {
        req.bodyMode = 'urlencoded';
        for (const part of [...dataParts, ...dataUrlencode].join('&').split('&')) {
          if (part === '') continue;
          const eq = part.indexOf('=');
          req.formItems.push({
            ...newKvRow(),
            key: safeDecode(eq === -1 ? part : part.slice(0, eq)),
            value: safeDecode(eq === -1 ? '' : part.slice(eq + 1)),
          });
        }
      }
    }
  }

  req.method = METHODS.includes(method) ? method : 'GET';
  req.url = url;
  return req;
}

/* ============================== code generation ============================== */

const CODE_LANGS = [
  ['curl', 'cURL'],
  ['fetch', 'JavaScript (fetch)'],
  ['axios', 'JavaScript (axios)'],
  ['python', 'Python (requests)'],
  ['powershell', 'PowerShell'],
  ['csharp', 'C# (HttpClient)'],
  ['go', 'Go (net/http)'],
];

const jstr = (s) => JSON.stringify(String(s ?? ''));

function genFetch(p) {
  const lines = [];
  const opts = [`  method: ${jstr(p.method)}`];
  if (p.headers.length) {
    opts.push(`  headers: {\n${p.headers.map((h) => `    ${jstr(h.key)}: ${jstr(h.value)}`).join(',\n')}\n  }`);
  }
  if (p.bodyMode === 'formdata') {
    lines.push('const form = new FormData();');
    for (const f of p.formItems) {
      lines.push(
        f.type === 'file'
          ? `form.append(${jstr(f.key)}, fileInput.files[0]); // ${f.filePath || 'pick a file'}`
          : `form.append(${jstr(f.key)}, ${jstr(f.value)});`
      );
    }
    lines.push('');
    opts.push('  body: form');
  } else if (p.bodyMode === 'urlencoded') {
    opts.push(`  body: new URLSearchParams({\n${p.formItems.map((f) => `    ${jstr(f.key)}: ${jstr(f.value)}`).join(',\n')}\n  })`);
  } else if (p.bodyMode === 'raw' && p.rawBody) {
    opts.push(`  body: ${jstr(p.rawBody)}`);
  }
  lines.push(`const response = await fetch(${jstr(p.url)}, {`, opts.join(',\n'), '});', '', 'const data = await response.text();', 'console.log(data);');
  return lines.join('\n');
}

function genAxios(p) {
  const lines = ["const axios = require('axios');", ''];
  const cfg = [`  method: ${jstr(p.method.toLowerCase())}`, `  url: ${jstr(p.url)}`];
  if (p.headers.length) {
    cfg.push(`  headers: {\n${p.headers.map((h) => `    ${jstr(h.key)}: ${jstr(h.value)}`).join(',\n')}\n  }`);
  }
  if (p.bodyMode === 'raw' && p.rawBody) cfg.push(`  data: ${jstr(p.rawBody)}`);
  else if (p.bodyMode === 'urlencoded') {
    cfg.push(`  data: new URLSearchParams({\n${p.formItems.map((f) => `    ${jstr(f.key)}: ${jstr(f.value)}`).join(',\n')}\n  })`);
  } else if (p.bodyMode === 'formdata') {
    lines.push('const FormData = require("form-data");', 'const form = new FormData();');
    for (const f of p.formItems) {
      lines.push(
        f.type === 'file'
          ? `form.append(${jstr(f.key)}, require('fs').createReadStream(${jstr(f.filePath || 'FILE_PATH')}));`
          : `form.append(${jstr(f.key)}, ${jstr(f.value)});`
      );
    }
    lines.push('');
    cfg.push('  data: form');
  }
  lines.push('axios({', cfg.join(',\n'), '})', '  .then((res) => console.log(res.data))', '  .catch((err) => console.error(err));');
  return lines.join('\n');
}

function genPython(p) {
  const lines = ['import requests', '', `url = ${jstr(p.url)}`];
  if (p.headers.length) {
    lines.push(`headers = {\n${p.headers.map((h) => `    ${jstr(h.key)}: ${jstr(h.value)}`).join(',\n')}\n}`);
  }
  const args = [`"${p.method}"`, 'url'];
  if (p.headers.length) args.push('headers=headers');
  if (p.bodyMode === 'raw' && p.rawBody) {
    if (!p.rawBody.includes('"""') && !p.rawBody.endsWith('\\')) lines.push(`payload = """${p.rawBody}"""`);
    else lines.push(`payload = ${jstr(p.rawBody)}`);
    args.push('data=payload');
  } else if (p.bodyMode === 'urlencoded') {
    lines.push(`payload = {\n${p.formItems.map((f) => `    ${jstr(f.key)}: ${jstr(f.value)}`).join(',\n')}\n}`);
    args.push('data=payload');
  } else if (p.bodyMode === 'formdata') {
    const files = p.formItems.filter((f) => f.type === 'file');
    const fields = p.formItems.filter((f) => f.type !== 'file');
    if (fields.length) {
      lines.push(`payload = {\n${fields.map((f) => `    ${jstr(f.key)}: ${jstr(f.value)}`).join(',\n')}\n}`);
      args.push('data=payload');
    }
    if (files.length) {
      lines.push(`files = {\n${files.map((f) => `    ${jstr(f.key)}: open(r${jstr(f.filePath || 'FILE_PATH')}, "rb")`).join(',\n')}\n}`);
      args.push('files=files');
    }
  }
  lines.push('', `response = requests.request(${args.join(', ')})`, 'print(response.text)');
  return lines.join('\n');
}

function genPowerShell(p) {
  const ps = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
  const lines = [];
  if (p.headers.length) {
    lines.push('$headers = @{');
    for (const h of p.headers) lines.push(`    ${ps(h.key)} = ${ps(h.value)}`);
    lines.push('}');
  }
  const args = [`-Uri ${ps(p.url)}`, `-Method ${p.method.charAt(0) + p.method.slice(1).toLowerCase()}`];
  if (p.headers.length) args.push('-Headers $headers');
  if (p.bodyMode === 'raw' && p.rawBody) {
    lines.push("$body = @'", p.rawBody, "'@");
    args.push('-Body $body');
  } else if (p.bodyMode === 'urlencoded') {
    lines.push('$body = @{');
    for (const f of p.formItems) lines.push(`    ${ps(f.key)} = ${ps(f.value)}`);
    lines.push('}');
    args.push('-Body $body', "-ContentType 'application/x-www-form-urlencoded'");
  } else if (p.bodyMode === 'formdata') {
    lines.push('# -Form requires PowerShell 6+');
    lines.push('$form = @{');
    for (const f of p.formItems) {
      lines.push(f.type === 'file' ? `    ${ps(f.key)} = Get-Item ${ps(f.filePath || 'FILE_PATH')}` : `    ${ps(f.key)} = ${ps(f.value)}`);
    }
    lines.push('}');
    args.push('-Form $form');
  }
  lines.push('', `$response = Invoke-RestMethod ${args.join(' ')}`, '$response | ConvertTo-Json -Depth 10');
  return lines.join('\n');
}

function genCSharp(p) {
  const contentType = (p.headers.find((h) => h.key.toLowerCase() === 'content-type') || {}).value || 'text/plain';
  const plainHeaders = p.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
  const lines = ['using System.Text;', '', 'using var client = new HttpClient();', `using var request = new HttpRequestMessage(new HttpMethod(${jstr(p.method)}), ${jstr(p.url)});`];
  for (const h of plainHeaders) lines.push(`request.Headers.TryAddWithoutValidation(${jstr(h.key)}, ${jstr(h.value)});`);
  if (p.bodyMode === 'raw' && p.rawBody) {
    lines.push(`request.Content = new StringContent(${jstr(p.rawBody)}, Encoding.UTF8, ${jstr(contentType.split(';')[0])});`);
  } else if (p.bodyMode === 'urlencoded') {
    lines.push('request.Content = new FormUrlEncodedContent(new Dictionary<string, string>', '{');
    for (const f of p.formItems) lines.push(`    { ${jstr(f.key)}, ${jstr(f.value)} },`);
    lines.push('});');
  } else if (p.bodyMode === 'formdata') {
    lines.push('var form = new MultipartFormDataContent();');
    for (const f of p.formItems) {
      if (f.type === 'file') {
        lines.push(`form.Add(new ByteArrayContent(File.ReadAllBytes(${jstr(f.filePath || 'FILE_PATH')})), ${jstr(f.key)}, Path.GetFileName(${jstr(f.filePath || 'FILE_PATH')}));`);
      } else {
        lines.push(`form.Add(new StringContent(${jstr(f.value)}), ${jstr(f.key)});`);
      }
    }
    lines.push('request.Content = form;');
  }
  lines.push('', 'var response = await client.SendAsync(request);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  return lines.join('\n');
}

function genGo(p) {
  const goStr = (s) => (String(s).includes('`') ? jstr(s) : '`' + s + '`');
  const hasBody = (p.bodyMode === 'raw' && p.rawBody) || p.bodyMode === 'urlencoded';
  const lines = ['package main', '', 'import (', '\t"fmt"', '\t"io"', '\t"net/http"'];
  if (hasBody) lines.push('\t"strings"');
  if (p.bodyMode === 'urlencoded') lines.push('\t"net/url"');
  lines.push(')', '', 'func main() {');
  if (p.bodyMode === 'raw' && p.rawBody) {
    lines.push(`\tpayload := strings.NewReader(${goStr(p.rawBody)})`);
  } else if (p.bodyMode === 'urlencoded') {
    lines.push('\tform := url.Values{}');
    for (const f of p.formItems) lines.push(`\tform.Set(${jstr(f.key)}, ${jstr(f.value)})`);
    lines.push('\tpayload := strings.NewReader(form.Encode())');
  } else if (p.bodyMode === 'formdata') {
    lines.push('\t// multipart form bodies need mime/multipart — see Go docs; fields:');
    for (const f of p.formItems) lines.push(`\t// ${f.key} = ${f.type === 'file' ? '@' + (f.filePath || 'FILE_PATH') : f.value}`);
  }
  const bodyArg = hasBody ? 'payload' : 'nil';
  lines.push(`\treq, err := http.NewRequest(${jstr(p.method)}, ${jstr(p.url)}, ${bodyArg})`);
  lines.push('\tif err != nil {', '\t\tpanic(err)', '\t}');
  for (const h of p.headers) lines.push(`\treq.Header.Set(${jstr(h.key)}, ${jstr(h.value)})`);
  lines.push('', '\tres, err := http.DefaultClient.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer res.Body.Close()', '', '\tbody, _ := io.ReadAll(res.Body)', '\tfmt.Println(string(body))', '}');
  return lines.join('\n');
}

function genCode(lang, p) {
  switch (lang) {
    case 'fetch': return genFetch(p);
    case 'axios': return genAxios(p);
    case 'python': return genPython(p);
    case 'powershell': return genPowerShell(p);
    case 'csharp': return genCSharp(p);
    case 'go': return genGo(p);
    default: return genCurl(p);
  }
}

function openCodeModal() {
  const payload = buildPayload(activeTab());
  if (!payload) {
    toast(t('Enter a request URL first'));
    return;
  }
  const body = el('div');
  const f = el('div', 'form-field');
  f.append(el('label', null, t('Language')));
  const sel = document.createElement('select');
  for (const [v, label] of CODE_LANGS) {
    const o = el('option', null, label);
    o.value = v;
    sel.append(o);
  }
  sel.value = CODE_LANGS.some(([v]) => v === state.settings.codeLang) ? state.settings.codeLang : 'curl';
  f.append(sel);
  body.append(f);

  const box = el('div', 'code-box');
  const pre = el('pre', 'code');
  box.append(pre);
  body.append(box);

  const render = () => {
    pre.textContent = genCode(sel.value, payload);
  };
  sel.addEventListener('change', () => {
    state.settings.codeLang = sel.value;
    persist();
    render();
  });
  render();

  modal(t('Code Snippet'), body, [
    {
      label: t('Copy'),
      primary: true,
      onClick: () => {
        navigator.clipboard.writeText(pre.textContent);
        toast(t('Snippet copied to clipboard'));
        return false;
      },
    },
    { label: t('Close') },
  ]);
}

/* ============================== init ============================== */

const normSaved = (s) => ({ id: s.id || uid(), name: s.name || 'Request', request: normalizeRequest(s.request) });

function hydrateState(stored) {
  state.collections = (Array.isArray(stored.collections) ? stored.collections : []).map((c) => ({
    id: c.id || uid(),
    name: c.name || 'Collection',
    open: c.open !== false,
    requests: (Array.isArray(c.requests) ? c.requests : []).map(normSaved),
    folders: (Array.isArray(c.folders) ? c.folders : []).map((f) => ({
      id: f.id || uid(),
      name: f.name || 'Folder',
      open: f.open !== false,
      requests: (Array.isArray(f.requests) ? f.requests : []).map(normSaved),
    })),
  }));
  state.history = Array.isArray(stored.history) ? stored.history : [];
  state.environments = Array.isArray(stored.environments) ? stored.environments : [];
  for (const e of state.environments) if (!Array.isArray(e.vars)) e.vars = [];
  state.activeEnvId = stored.activeEnvId || null;
  state.globals = Array.isArray(stored.globals) ? stored.globals : [];
  state.cookies = Array.isArray(stored.cookies) ? stored.cookies : [];
  state.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  state.settings.proxy = { ...DEFAULT_SETTINGS.proxy, ...((stored.settings && stored.settings.proxy) || {}) };
  if (!Array.isArray(state.settings.clientCerts)) state.settings.clientCerts = [];
  state.tabs = (Array.isArray(stored.tabs) ? stored.tabs : [])
    .filter((t) => t && t.request)
    .map((t) => ({ ...makeTab(t.request, t.name, t.savedRef), id: t.id || uid() }));
  state.activeTabId = stored.activeTabId;
  if (!state.tabs.length) state.tabs.push(makeTab());
  if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;
}

function restoreBackup(obj) {
  hydrateState(obj);
  applyTheme();
  renderEnvSelect();
  renderSidebar();
  renderTabsBar();
  loadEditor();
  persist();
}

async function init() {
  let stored = null;
  try {
    stored = await window.lostman.loadStore();
  } catch {
    /* first run */
  }

  if (stored) hydrateState(stored);

  if (!state.tabs.length) state.tabs.push(makeTab());
  if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;

  setLocale(state.settings.language || 'en');
  applyTheme();
  initEditor();
  initSidebar();
  initResponseToolbar();
  initRespSearch();
  initRespActions();
  initSplitter();
  initShortcuts();

  $('#btnNewTab').addEventListener('click', newTab);
  $('#envSelect').addEventListener('change', (e) => {
    state.activeEnvId = e.target.value || null;
    persist();
  });
  $('#btnManageEnv').addEventListener('click', openEnvManager);
  $('#btnCookies').addEventListener('click', openCookieModal);
  $('#btnSettings').addEventListener('click', openSettings);
  window.lostman.onStreamEvent(handleStreamEvent);
  window.lostman.onStoreChanged((data) => {
    // Another window saved: adopt the shared slices, keep this window's tabs and settings.
    if (!data) return;
    state.collections = (Array.isArray(data.collections) ? data.collections : []).map((c) => ({
      ...c,
      folders: Array.isArray(c.folders) ? c.folders : [],
      requests: Array.isArray(c.requests) ? c.requests : [],
    }));
    state.history = Array.isArray(data.history) ? data.history : state.history;
    state.environments = Array.isArray(data.environments) ? data.environments : state.environments;
    for (const e of state.environments) if (!Array.isArray(e.vars)) e.vars = [];
    state.globals = Array.isArray(data.globals) ? data.globals : state.globals;
    state.cookies = Array.isArray(data.cookies) ? data.cookies : state.cookies;
    state.activeEnvId = data.activeEnvId || null;
    renderEnvSelect();
    renderSidebar();
  });

  renderEnvSelect();
  renderSidebar();
  renderTabsBar();
  loadEditor();
}

init();
