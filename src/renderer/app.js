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
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const basename = (p) => String(p).split(/[\\/]/).pop();

function toast(msg) {
  const t = el('div', 'toast', msg);
  $('#toastRoot').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
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

const DEFAULT_SETTINGS = { theme: 'dark', timeoutMs: 0, followRedirects: true, verifySsl: true };

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
    auth: { type: 'none', token: '', username: '', password: '', keyName: '', keyValue: '', addTo: 'header' },
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
  sideView: 'collections',
  sideFilter: '',
  settings: { ...DEFAULT_SETTINGS },
};

const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId);

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
    settings: state.settings,
  };
}

const persist = debounce(() => window.lostman.saveStore(snapshot()), 400);

/* ============================== environments ============================== */

function envMap() {
  const env = state.environments.find((e) => e.id === state.activeEnvId);
  const m = {};
  if (env) for (const v of env.vars) if (v.enabled !== false && v.key) m[v.key] = v.value ?? '';
  return m;
}

function applyEnv(s) {
  if (!s) return s ?? '';
  const m = envMap();
  return String(s).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => (name in m ? m[name] : match));
}

function renderEnvSelect() {
  const sel = $('#envSelect');
  sel.innerHTML = '';
  const none = el('option', null, 'No Environment');
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

  const fTheme = el('div', 'form-field');
  fTheme.append(el('label', null, 'Theme'));
  const themeSel = document.createElement('select');
  for (const [v, label] of [['dark', 'Dark'], ['light', 'Light']]) {
    const o = el('option', null, label);
    o.value = v;
    themeSel.append(o);
  }
  themeSel.value = s.theme;
  fTheme.append(themeSel);

  const fTimeout = el('div', 'form-field');
  fTimeout.append(el('label', null, 'Request timeout (milliseconds, 0 = no timeout)'));
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
  cRedir.append(redirCb, el('span', null, 'Follow redirects automatically'));

  const cSsl = el('label', 'form-check');
  const sslCb = document.createElement('input');
  sslCb.type = 'checkbox';
  sslCb.checked = s.verifySsl !== false;
  cSsl.append(sslCb, el('span', null, 'Verify SSL certificates'));
  const sslNote = el('div', 'form-note', 'Turn off only for local servers with self-signed certificates.');

  body.append(fTheme, fTimeout, cRedir, cSsl, sslNote);

  modal('Settings', body, [
    { label: 'Cancel' },
    {
      label: 'Save',
      primary: true,
      onClick: () => {
        state.settings = {
          theme: themeSel.value === 'light' ? 'light' : 'dark',
          timeoutMs: Math.max(0, parseInt(timeoutInput.value, 10) || 0),
          followRedirects: redirCb.checked,
          verifySsl: sslCb.checked,
        };
        applyTheme();
        persist();
        toast('Settings saved');
      },
    },
  ]);
}

/* ============================== key-value tables ============================== */

function renderKv(container, rowsRef, onChange, opts = {}) {
  container.classList.toggle('kv-file', !!opts.file);
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
    i.type = 'text';
    i.placeholder = ph;
    i.spellcheck = false;
    i.value = row[prop];
    i.addEventListener('input', () => {
      row[prop] = i.value;
      grow();
      onChange();
    });
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
    const btn = el('button', 'kv-file-btn', row.filePath ? basename(row.filePath) : 'Choose file…');
    btn.title = row.filePath || 'Choose a file';
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
      toast('Not valid JSON — cannot beautify');
    }
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
  $('#authAddTo').addEventListener('change', (e) => {
    activeTab().request.auth.addTo = e.target.value;
    persist();
  });

  $('#btnSend').addEventListener('click', sendActive);
  $('#btnSave').addEventListener('click', saveActive);
  $('#btnCurl').addEventListener('click', copyCurl);
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
  updateBodyUI();

  $('#authType').value = r.auth.type;
  $('#authToken').value = r.auth.token;
  $('#authUser').value = r.auth.username;
  $('#authPass').value = r.auth.password;
  $('#authKeyName').value = r.auth.keyName;
  $('#authKeyValue').value = r.auth.keyValue;
  $('#authAddTo').value = r.auth.addTo;
  updateAuthUI();

  updateEditorMeta();
  renderResponse();
}

function updateBodyUI() {
  const mode = activeTab().request.bodyMode;
  $('#bodyNone').classList.toggle('hidden', mode !== 'none');
  $('#rawBody').classList.toggle('hidden', mode !== 'raw');
  $('#rawType').classList.toggle('hidden', mode !== 'raw');
  $('#btnBeautify').classList.toggle('hidden', mode !== 'raw');
  $('#kvForm').classList.toggle('hidden', mode !== 'formdata' && mode !== 'urlencoded');
}

function updateAuthUI() {
  const type = activeTab().request.auth.type;
  $('#auth-bearer').classList.toggle('hidden', type !== 'bearer');
  $('#auth-basic').classList.toggle('hidden', type !== 'basic');
  $('#auth-apikey').classList.toggle('hidden', type !== 'apikey');
}

function updateEditorMeta() {
  const r = activeTab().request;
  const count = (rows) => rows.filter((x) => x.enabled !== false && x.key.trim() !== '').length;
  const np = count(r.params);
  const nh = count(r.headers);
  $('#cntParams').textContent = np ? ` (${np})` : '';
  $('#cntHeaders').textContent = nh ? ` (${nh})` : '';
  const hasBody =
    r.bodyMode === 'raw' ? r.rawBody.trim() !== '' : r.bodyMode === 'none' ? false : count(r.formItems) > 0;
  $('#dotBody').classList.toggle('hidden', !hasBody);
  $('#dotAuth').classList.toggle('hidden', r.auth.type === 'none');
}

/* ============================== sending ============================== */

function buildPayload(tab) {
  const r = tab.request;
  const [rawBase] = splitUrl(r.url.trim());
  let url = applyEnv(rawBase.trim());
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;

  const qp = r.params.filter((p) => p.enabled !== false && p.key.trim() !== '');
  if (qp.length) {
    url += '?' + qp.map((p) => encodeURIComponent(applyEnv(p.key)) + '=' + encodeURIComponent(applyEnv(p.value))).join('&');
  }

  const headers = r.headers
    .filter((h) => h.enabled !== false && h.key.trim() !== '')
    .map((h) => ({ key: applyEnv(h.key), value: applyEnv(h.value) }));
  const hasHeader = (name) => headers.some((h) => h.key.toLowerCase() === name);

  const a = r.auth;
  if (a.type === 'bearer' && a.token) {
    headers.push({ key: 'Authorization', value: 'Bearer ' + applyEnv(a.token) });
  } else if (a.type === 'basic') {
    let cred;
    try {
      cred = btoa(applyEnv(a.username) + ':' + applyEnv(a.password));
    } catch {
      cred = btoa(unescape(encodeURIComponent(applyEnv(a.username) + ':' + applyEnv(a.password))));
    }
    headers.push({ key: 'Authorization', value: 'Basic ' + cred });
  } else if (a.type === 'apikey' && a.keyName) {
    if (a.addTo === 'query') {
      url += (url.includes('?') ? '&' : '?') + encodeURIComponent(applyEnv(a.keyName)) + '=' + encodeURIComponent(applyEnv(a.keyValue));
    } else {
      headers.push({ key: applyEnv(a.keyName), value: applyEnv(a.keyValue) });
    }
  }

  let bodyMode = r.bodyMode;
  if (r.method === 'GET' || r.method === 'HEAD') bodyMode = 'none';
  let rawBody = null;
  let formItems = null;
  if (bodyMode === 'raw') {
    rawBody = applyEnv(r.rawBody);
    if (!hasHeader('content-type')) {
      headers.push({ key: 'Content-Type', value: r.rawType === 'json' ? 'application/json' : 'text/plain' });
    }
  } else if (bodyMode === 'urlencoded' || bodyMode === 'formdata') {
    formItems = r.formItems
      .filter((f) => f.enabled !== false && f.key.trim() !== '')
      .map((f) => ({
        key: applyEnv(f.key),
        value: applyEnv(f.value),
        type: f.type === 'file' ? 'file' : 'text',
        filePath: f.filePath || '',
      }));
    if (bodyMode === 'urlencoded') formItems = formItems.filter((f) => f.type !== 'file');
  }

  return {
    method: r.method,
    url,
    headers,
    bodyMode,
    rawBody,
    formItems,
    settings: {
      timeoutMs: state.settings.timeoutMs,
      followRedirects: state.settings.followRedirects,
      verifySsl: state.settings.verifySsl,
    },
  };
}

async function sendActive() {
  const tab = activeTab();
  if (!tab || tab.sending) return;
  const payload = buildPayload(tab);
  if (!payload) {
    toast('Enter a request URL first');
    return;
  }
  payload.id = uid();
  tab.sending = payload.id;
  tab.respTab = 'body';
  if (tab === activeTab()) renderResponse();

  const res = await window.lostman.send(payload);

  if (tab.sending !== payload.id) return;
  tab.sending = null;
  tab.response = res;
  if (res.ok && res.bodyBase64) tab.respView = 'preview';
  if (!res.aborted) addHistory(tab.request, res);
  if (tab === activeTab()) renderResponse();
}

function cancelSend(tab) {
  if (tab.sending) window.lostman.abort(tab.sending);
}

function copyCurl() {
  const payload = buildPayload(activeTab());
  if (!payload) {
    toast('Enter a request URL first');
    return;
  }
  const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const parts = ['curl'];
  if (payload.method !== 'GET') parts.push('-X', payload.method);
  parts.push(sq(payload.url));
  for (const h of payload.headers) parts.push('-H', sq(h.key + ': ' + h.value));
  if (payload.bodyMode === 'raw' && payload.rawBody) parts.push('--data-raw', sq(payload.rawBody));
  if (payload.bodyMode === 'urlencoded') {
    for (const f of payload.formItems) parts.push('--data-urlencode', sq(f.key + '=' + f.value));
  }
  if (payload.bodyMode === 'formdata') {
    for (const f of payload.formItems) {
      parts.push('-F', sq(f.type === 'file' ? `${f.key}=@${f.filePath}` : `${f.key}=${f.value}`));
    }
  }
  navigator.clipboard.writeText(parts.join(' '));
  toast('cURL command copied to clipboard');
}

/* ============================== response rendering ============================== */

function statusClass(s) {
  if (s < 200) return 's-info';
  if (s < 300) return 's-ok';
  if (s < 400) return 's-redir';
  if (s < 500) return 's-clienterr';
  return 's-servererr';
}

const EMPTY_STATE = `
  <div class="resp-empty">
    <img class="empty-logo" src="assets/logo-badge.png" alt="Lostman">
    <div>Enter a URL and click <b>Send</b> to get a response</div>
    <div style="font-size:11.5px">Ctrl+Enter sends &nbsp;&middot;&nbsp; Ctrl+S saves &nbsp;&middot;&nbsp; Ctrl+T new tab &nbsp;&middot;&nbsp; Ctrl+F finds</div>
  </div>`;

function renderResponse() {
  const tab = activeTab();
  const box = $('#respContent');
  const toolbar = $('#respToolbar');
  const searchBar = $('#respSearchBar');

  if (tab.sending) {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    box.innerHTML = '';
    const wrap = el('div', 'resp-loading');
    wrap.append(el('div', 'spinner'));
    wrap.append(el('div', null, 'Sending request…'));
    const btn = el('button', null, 'Cancel');
    btn.addEventListener('click', () => cancelSend(tab));
    wrap.append(btn);
    box.append(wrap);
    return;
  }

  const r = tab.response;
  if (!r) {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    box.innerHTML = EMPTY_STATE;
    return;
  }

  if (!r.ok) {
    toolbar.classList.add('hidden');
    searchBar.classList.add('hidden');
    box.innerHTML = `
      <div class="resp-error">
        <h3>${r.aborted ? 'Request cancelled' : 'Could not send request'}</h3>
        <p>${esc(r.error || '')}</p>
        ${r.aborted ? '' : '<p class="hint">Check the URL, your connection, and that the server is reachable.</p>'}
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
  if (tab.respTab === 'headers') renderRespHeaders(box, r);
  else if (searchOn && tab.search.q !== '') renderSearchView(box, r, tab.search);
  else renderRespBody(box, r, tab.respView);
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
    box.innerHTML = `<div class="resp-empty"><div>Binary image response (${formatBytes(r.size)}) &mdash; use <b>Preview</b></div></div>`;
    return;
  }

  const text = r.bodyText ?? '';
  if (text === '') {
    box.innerHTML = '<div class="resp-empty"><div>(empty response body)</div></div>';
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
    box.append(el('div', 'trunc-note', `Response is ${formatBytes(r.size)} — showing the first 2 MB (Save exports the full body).`));
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
  $('#respSearchCount').textContent = n ? `${search.cur + 1} of ${n}${n === 3000 ? '+' : ''}` : 'No matches';

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
    toast('Response body copied');
  });
  $('#btnSaveResp').addEventListener('click', async () => {
    const r = activeTab().response;
    if (!r || !r.ok) return;
    const ok = await window.lostman.saveResponse({
      bufId: r.bufId,
      defaultName: suggestFilename(r),
      fallbackText: r.bodyText ?? '',
    });
    if (ok) toast('Response saved to file');
  });
}

/* ============================== history ============================== */

function addHistory(request, res) {
  state.history.unshift({
    id: uid(),
    ts: Date.now(),
    request: cleanRequest(request),
    status: res.ok ? res.status : null,
    error: !res.ok,
  });
  if (state.history.length > 100) state.history.length = 100;
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
      $('#sideSearch').placeholder = state.sideView === 'collections' ? 'Filter collections…' : 'Filter history…';
      renderSidebar();
    })
  );
  $('#sideSearch').addEventListener('input', (e) => {
    state.sideFilter = e.target.value.trim();
    renderSidebar();
  });
  $('#sideSearch').placeholder = 'Filter collections…';
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
    const add = el('button', null, '+ New Collection');
    add.addEventListener('click', () =>
      textPrompt('New Collection', 'Collection name', '', (name) => {
        state.collections.push({ id: uid(), name, open: true, requests: [], folders: [] });
        persist();
        renderSidebar();
      })
    );
    actions.append(add);

    if (!state.collections.length) {
      list.append(
        Object.assign(el('div', 'side-empty'), {
          innerHTML: 'No collections yet.<br>Click <b>Save</b> on a request<br>to add it to a collection.',
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
    if (!shown) list.append(el('div', 'side-empty', 'No matches.'));
  } else {
    if (state.history.length) {
      const clear = el('button', null, 'Clear History');
      clear.addEventListener('click', () => {
        if (confirm('Clear all request history?')) {
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
      list.append(Object.assign(el('div', 'side-empty'), { innerHTML: 'Requests you send<br>will show up here.' }));
      return;
    }
    if (!items.length) {
      list.append(el('div', 'side-empty', 'No matches.'));
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
  addFolder.title = 'New folder';
  addFolder.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt('New Folder', 'Folder name', '', (n) => {
      col.folders = col.folders || [];
      col.folders.push({ id: uid(), name: n, open: true, requests: [] });
      col.open = true;
      persist();
      renderSidebar();
    });
  });

  const rename = el('button', null, '✎');
  rename.title = 'Rename collection';
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt('Rename Collection', 'Collection name', col.name, (n) => {
      col.name = n;
      persist();
      renderSidebar();
    });
  });

  const del = el('button', null, '✕');
  del.title = 'Delete collection';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Delete collection "${col.name}" and its ${total} request(s)?`)) return;
    state.collections = state.collections.filter((c) => c !== col);
    for (const t of state.tabs) if (t.savedRef?.collectionId === col.id) t.savedRef = null;
    persist();
    renderSidebar();
  });

  acts.append(addFolder, rename, del);
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
  rename.title = 'Rename folder';
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt('Rename Folder', 'Folder name', f.name, (n) => {
      f.name = n;
      persist();
      renderSidebar();
    });
  });

  const del = el('button', null, '✕');
  del.title = 'Delete folder';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Delete folder "${f.name}" and its ${f.requests.length} request(s)?`)) return;
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
  rename.title = 'Rename request';
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    textPrompt('Rename Request', 'Request name', saved.name, (n) => {
      saved.name = n;
      for (const t of state.tabs) if (t.savedRef?.requestId === saved.id) t.name = n;
      persist();
      renderSidebar();
      renderTabsBar();
    });
  });

  const dup = el('button', null, '⧉');
  dup.title = 'Duplicate request';
  dup.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = folder ? folder.requests : col.requests;
    const idx = list.indexOf(saved);
    list.splice(idx + 1, 0, { id: uid(), name: saved.name + ' copy', request: structuredClone(saved.request) });
    persist();
    renderSidebar();
  });

  const del = el('button', null, '✕');
  del.title = 'Delete request';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Delete request "${saved.name}"?`)) return;
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
  const url = el('div', 'hist-url', h.request.url || '(no URL)');
  const sub = el('div', 'hist-sub');
  sub.append(el('span', null, timeAgo(h.ts)));
  if (h.status) {
    const st = el('span', null, String(h.status));
    st.style.color = h.status < 400 ? 'var(--ok)' : 'var(--err)';
    sub.append(st);
  } else if (h.error) {
    const st = el('span', null, 'failed');
    st.style.color = 'var(--err)';
    sub.append(st);
  }
  main.append(url, sub);

  const acts = el('span', 'col-actions');
  const del = el('button', null, '✕');
  del.title = 'Remove from history';
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
      toast(`Saved to "${found.col.name}"`);
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
    return (u.pathname !== '/' && u.pathname) || u.hostname || 'New Request';
  } catch {
    return splitUrl(r.url)[0] || 'New Request';
  }
}

function openSaveModal(tab, saveAs = false) {
  const body = el('div');

  const f1 = el('div', 'form-field');
  f1.append(el('label', null, 'Request name'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = (tab.name ? (saveAs ? tab.name + ' copy' : tab.name) : defaultRequestName(tab.request));
  f1.append(nameInput);

  const f2 = el('div', 'form-field');
  f2.append(el('label', null, 'Collection'));
  const colSel = document.createElement('select');
  for (const c of state.collections) {
    const o = el('option', null, c.name);
    o.value = c.id;
    colSel.append(o);
  }
  const oNew = el('option', null, '+ Create new collection');
  oNew.value = '__new';
  colSel.append(oNew);
  if (!state.collections.length) colSel.value = '__new';
  f2.append(colSel);

  const f3 = el('div', 'form-field');
  f3.append(el('label', null, 'New collection name'));
  const newColInput = document.createElement('input');
  newColInput.type = 'text';
  newColInput.value = 'My Collection';
  f3.append(newColInput);

  const f4 = el('div', 'form-field');
  f4.append(el('label', null, 'Folder'));
  const folderSel = document.createElement('select');
  f4.append(folderSel);

  function refreshDependent() {
    const isNew = colSel.value === '__new';
    f3.classList.toggle('hidden', !isNew);
    const col = state.collections.find((c) => c.id === colSel.value);
    const folders = (!isNew && col && col.folders) || [];
    folderSel.innerHTML = '';
    const root = el('option', null, '(collection root)');
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

  const m = modal(saveAs ? 'Save Request As' : 'Save Request', body, [
    { label: 'Cancel' },
    {
      label: 'Save',
      primary: true,
      onClick: () => {
        const name = nameInput.value.trim();
        if (!name) {
          toast('Enter a request name');
          return false;
        }
        let col;
        if (colSel.value === '__new') {
          const cn = newColInput.value.trim();
          if (!cn) {
            toast('Enter a collection name');
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
        toast(`Saved to "${col.name}"`);
      },
    },
  ]);
  nameInput.focus();
  nameInput.select();
  return m;
}

/* ============================== tabs ============================== */

function tabLabel(t) {
  if (t.name) return t.name;
  const u = t.request.url.trim();
  if (!u) return 'Untitled Request';
  return u.replace(/^https?:\/\//i, '');
}

function renderTabsBar() {
  const list = $('#tabsList');
  list.innerHTML = '';
  for (const t of state.tabs) {
    const d = el('div', 'tab' + (t.id === state.activeTabId ? ' active' : ''));
    d.title = t.request.url || '';
    const m = el('span', 'tab-method m-' + t.request.method, shortMethod(t.request.method));
    const n = el('span', 'tab-name', tabLabel(t));
    const x = el('button', 'tab-close', '✕');
    x.title = 'Close tab (Ctrl+W)';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(t.id);
    });
    d.append(m, n, x);
    d.addEventListener('click', () => switchTab(t.id));
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      tabContextMenu(t, e.clientX, e.clientY);
    });
    list.append(d);
  }
}

function tabContextMenu(t, x, y) {
  ctxMenu(x, y, [
    {
      label: 'Rename',
      onClick: () =>
        textPrompt('Rename Request', 'Name', t.name || tabLabel(t), (v) => {
          t.name = v;
          const found = findSaved(t.savedRef);
          if (found) {
            found.saved.name = v;
            renderSidebar();
          }
          renderTabsBar();
          persist();
        }),
    },
    {
      label: 'Duplicate',
      onClick: () => {
        const copy = makeTab(structuredClone(t.request), t.name ? t.name + ' copy' : null);
        state.tabs.splice(state.tabs.indexOf(t) + 1, 0, copy);
        switchTab(copy.id);
      },
    },
    { label: 'Save As…', onClick: () => openSaveModal(t, true) },
    '-',
    { label: 'Close', onClick: () => closeTab(t.id) },
    {
      label: 'Close Others',
      danger: true,
      onClick: () => {
        for (const other of state.tabs) if (other !== t) cancelSend(other);
        state.tabs = [t];
        state.activeTabId = t.id;
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
    { label: 'Cancel' },
    {
      label: 'OK',
      primary: true,
      onClick: () => {
        const v = input.value.trim();
        if (!v) {
          toast('Name cannot be empty');
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

function openEnvManager() {
  let selId = state.activeEnvId || state.environments[0]?.id || null;

  const layout = el('div', 'env-layout');
  const left = el('div', 'env-list');
  const right = el('div', 'env-editor');
  layout.append(left, right);

  function refresh() {
    left.innerHTML = '';
    const add = el('button', null, '+ New');
    add.style.width = '100%';
    add.style.marginBottom = '8px';
    add.addEventListener('click', () => {
      const env = { id: uid(), name: 'New Environment', vars: [] };
      state.environments.push(env);
      selId = env.id;
      persist();
      renderEnvSelect();
      refresh();
    });
    left.append(add);
    for (const env of state.environments) {
      const item = el('div', 'env-list-item' + (env.id === selId ? ' sel' : ''), env.name);
      item.addEventListener('click', () => {
        selId = env.id;
        refresh();
      });
      left.append(item);
    }

    right.innerHTML = '';
    const env = state.environments.find((e) => e.id === selId);
    if (!env) {
      right.append(
        Object.assign(el('div', 'env-empty'), {
          innerHTML: 'No environment selected.<br>Create one to define <b>{{variables}}</b><br>usable in URLs, headers, bodies and auth.',
        })
      );
      return;
    }

    const f = el('div', 'form-field');
    f.append(el('label', null, 'Environment name'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = env.name;
    nameInput.addEventListener('input', () => {
      env.name = nameInput.value;
      persist();
      renderEnvSelect();
      [...left.querySelectorAll('.env-list-item')].forEach((n, i) => {
        if (state.environments[i]?.id === env.id) n.textContent = env.name;
      });
    });
    f.append(nameInput);
    right.append(f);

    right.append(el('div', 'panel-hint', 'Variables — use them anywhere as {{name}}'));
    const kvBox = el('div', 'kv');
    right.append(kvBox);
    renderKv(kvBox, () => env.vars, () => {
      persist();
    });

    const controls = el('div');
    controls.style.marginTop = '14px';
    controls.style.display = 'flex';
    controls.style.gap = '8px';

    const activate = el('button', state.activeEnvId === env.id ? null : 'primary',
      state.activeEnvId === env.id ? 'Active ✓' : 'Set Active');
    activate.addEventListener('click', () => {
      state.activeEnvId = state.activeEnvId === env.id ? null : env.id;
      persist();
      renderEnvSelect();
      refresh();
    });

    const del = el('button', null, 'Delete');
    del.addEventListener('click', () => {
      if (!confirm(`Delete environment "${env.name}"?`)) return;
      state.environments = state.environments.filter((e) => e !== env);
      if (state.activeEnvId === env.id) state.activeEnvId = null;
      selId = state.environments[0]?.id || null;
      persist();
      renderEnvSelect();
      refresh();
    });

    controls.append(activate, del);
    right.append(controls);
  }

  refresh();
  modal('Environments', layout, [{ label: 'Close', primary: true }]);
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
    }
  });
}

/* ============================== init ============================== */

const normSaved = (s) => ({ id: s.id || uid(), name: s.name || 'Request', request: normalizeRequest(s.request) });

async function init() {
  let stored = null;
  try {
    stored = await window.lostman.loadStore();
  } catch {
    /* first run */
  }

  if (stored) {
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
    state.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    state.tabs = (Array.isArray(stored.tabs) ? stored.tabs : [])
      .filter((t) => t && t.request)
      .map((t) => ({ ...makeTab(t.request, t.name, t.savedRef), id: t.id || uid() }));
    state.activeTabId = stored.activeTabId;
  }

  if (!state.tabs.length) state.tabs.push(makeTab());
  if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;

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
  $('#btnSettings').addEventListener('click', openSettings);

  renderEnvSelect();
  renderSidebar();
  renderTabsBar();
  loadEditor();
}

init();
