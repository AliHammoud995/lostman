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

function toast(msg) {
  const t = el('div', 'toast', msg);
  $('#toastRoot').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

/* ============================== state ============================== */

const METHOD_SHORT = { DELETE: 'DEL', OPTIONS: 'OPT' };
const shortMethod = (m) => METHOD_SHORT[m] || m;

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

function normalizeRequest(r) {
  const base = blankRequest();
  const out = { ...base, ...(r || {}) };
  out.auth = { ...base.auth, ...((r && r.auth) || {}) };
  for (const k of ['params', 'headers', 'formItems']) {
    if (!Array.isArray(out[k])) out[k] = [];
    out[k] = out[k].map((row) => ({ id: row.id || uid(), key: row.key || '', value: row.value || '', enabled: row.enabled !== false }));
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
};

const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId);

/* ============================== persistence ============================== */

function snapshot() {
  return {
    version: 1,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((t) => ({ id: t.id, name: t.name, savedRef: t.savedRef, request: t.request })),
    collections: state.collections,
    history: state.history,
    environments: state.environments,
    activeEnvId: state.activeEnvId,
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

/* ============================== key-value tables ============================== */

function newKvRow() {
  return { id: uid(), key: '', value: '', enabled: true };
}

function renderKv(container, rowsRef, onChange) {
  const rows = rowsRef();
  const last = rows[rows.length - 1];
  if (!rows.length || (last && (last.key !== '' || last.value !== ''))) rows.push(newKvRow());
  container.innerHTML = '';
  for (const row of rowsRef()) container.appendChild(kvRowEl(container, rowsRef, row, onChange));
}

function kvRowEl(container, rowsRef, row, onChange) {
  const div = el('div', 'kv-row');

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
      const rows = rowsRef();
      if (rows[rows.length - 1] === row && (row.key !== '' || row.value !== '')) {
        const nr = newKvRow();
        rows.push(nr);
        container.appendChild(kvRowEl(container, rowsRef, nr, onChange));
      }
      onChange();
    });
    return i;
  };

  const del = el('button', 'kv-del', '✕');
  del.title = 'Remove row';
  del.tabIndex = -1;
  del.addEventListener('click', () => {
    const rows = rowsRef();
    const idx = rows.indexOf(row);
    if (idx > -1) rows.splice(idx, 1);
    renderKv(container, rowsRef, onChange);
    onChange();
  });

  div.append(cb, mkInput('key', 'Key'), mkInput('value', 'Value'), del);
  return div;
}

const cleanRows = (rows) => rows.filter((r) => r.key.trim() !== '' || r.value.trim() !== '');

function cleanRequest(r) {
  const out = structuredClone(r);
  out.params = cleanRows(out.params);
  out.headers = cleanRows(out.headers);
  out.formItems = cleanRows(out.formItems);
  return out;
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
  renderKv($('#kvParams'), () => activeTab().request.params, kvChanged);
  renderKv($('#kvHeaders'), () => activeTab().request.headers, kvChanged);
  renderKv($('#kvForm'), () => activeTab().request.formItems, kvChanged);

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
  let url = applyEnv(r.url.trim());
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;

  const qp = r.params.filter((p) => p.enabled !== false && p.key.trim() !== '');
  if (qp.length) {
    const hasQ = url.includes('?');
    const sep = !hasQ ? '?' : url.endsWith('?') || url.endsWith('&') ? '' : '&';
    url += sep + qp.map((p) => encodeURIComponent(applyEnv(p.key)) + '=' + encodeURIComponent(applyEnv(p.value))).join('&');
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
      .map((f) => ({ key: applyEnv(f.key), value: applyEnv(f.value) }));
  }

  return { method: r.method, url, headers, bodyMode, rawBody, formItems };
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
  if (payload.bodyMode === 'urlencoded') for (const f of payload.formItems) parts.push('--data-urlencode', sq(f.key + '=' + f.value));
  if (payload.bodyMode === 'formdata') for (const f of payload.formItems) parts.push('-F', sq(f.key + '=' + f.value));
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
    <svg viewBox="0 0 24 24" width="54" height="54">
      <circle cx="12" cy="12" r="10" fill="none" stroke="#9a9aa2" stroke-width="1.5"/>
      <polygon points="12,5 14.2,12 12,19 9.8,12" fill="#9a9aa2"/>
    </svg>
    <div>Enter a URL and click <b>Send</b> to get a response</div>
    <div style="font-size:11.5px">Ctrl+Enter sends &nbsp;&middot;&nbsp; Ctrl+S saves &nbsp;&middot;&nbsp; Ctrl+T new tab</div>
  </div>`;

function renderResponse() {
  const tab = activeTab();
  const box = $('#respContent');
  const toolbar = $('#respToolbar');

  if (tab.sending) {
    toolbar.classList.add('hidden');
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
    box.innerHTML = EMPTY_STATE;
    return;
  }

  if (!r.ok) {
    toolbar.classList.add('hidden');
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

  box.innerHTML = '';
  if (tab.respTab === 'headers') renderRespHeaders(box, r);
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
    box.append(el('div', 'trunc-note', `Response is ${formatBytes(r.size)} — showing the first 2 MB only.`));
  }
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

/* ============================== sidebar ============================== */

function initSidebar() {
  $$('.side-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.sideView = b.dataset.sideview;
      $$('.side-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      renderSidebar();
    })
  );
}

function renderSidebar() {
  const actions = $('#sideActions');
  const list = $('#sideList');
  actions.innerHTML = '';
  list.innerHTML = '';

  if (state.sideView === 'collections') {
    const add = el('button', null, '+ New Collection');
    add.addEventListener('click', () =>
      textPrompt('New Collection', 'Collection name', '', (name) => {
        state.collections.push({ id: uid(), name, open: true, requests: [] });
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
    for (const col of state.collections) list.append(collectionEl(col));
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
    if (!state.history.length) {
      list.append(Object.assign(el('div', 'side-empty'), { innerHTML: 'Requests you send<br>will show up here.' }));
      return;
    }
    for (const h of state.history) list.append(historyEl(h));
  }
}

function collectionEl(col) {
  const wrap = el('div');
  const header = el('div', 'col-header');
  const chev = el('span', 'col-chevron', col.open ? '▾' : '▸');
  const name = el('span', 'col-name', col.name);
  const count = el('span', 'col-count', String(col.requests.length));
  const acts = el('span', 'col-actions');

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
    if (!confirm(`Delete collection "${col.name}" and its ${col.requests.length} request(s)?`)) return;
    state.collections = state.collections.filter((c) => c !== col);
    for (const t of state.tabs) if (t.savedRef?.collectionId === col.id) t.savedRef = null;
    persist();
    renderSidebar();
  });

  acts.append(rename, del);
  header.append(chev, name, count, acts);
  header.addEventListener('click', () => {
    col.open = !col.open;
    persist();
    renderSidebar();
  });
  wrap.append(header);

  if (col.open) {
    for (const saved of col.requests) {
      const row = el('div', 'req-row');
      const chip = el('span', 'method-chip m-' + saved.request.method, shortMethod(saved.request.method));
      const nm = el('span', 'req-name', saved.name);
      const acts2 = el('span', 'col-actions');
      const del2 = el('button', null, '✕');
      del2.title = 'Delete request';
      del2.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete request "${saved.name}"?`)) return;
        col.requests = col.requests.filter((q) => q !== saved);
        for (const t of state.tabs) if (t.savedRef?.requestId === saved.id) t.savedRef = null;
        persist();
        renderSidebar();
      });
      acts2.append(del2);
      row.append(chip, nm, acts2);
      row.addEventListener('click', () => openSavedRequest(col, saved));
      wrap.append(row);
    }
  }
  return wrap;
}

function openSavedRequest(col, saved) {
  const existing = state.tabs.find((t) => t.savedRef && t.savedRef.requestId === saved.id);
  if (existing) {
    switchTab(existing.id);
    return;
  }
  const tab = makeTab(structuredClone(saved.request), saved.name, { collectionId: col.id, requestId: saved.id });
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
    const col = state.collections.find((c) => c.id === tab.savedRef.collectionId);
    const saved = col?.requests.find((q) => q.id === tab.savedRef.requestId);
    if (saved) {
      saved.request = cleanRequest(tab.request);
      persist();
      renderSidebar();
      toast(`Saved to "${col.name}"`);
      return;
    }
    tab.savedRef = null;
  }
  openSaveModal(tab);
}

function defaultRequestName(r) {
  try {
    const u = new URL(applyEnv(r.url));
    return (u.pathname !== '/' && u.pathname) || u.hostname || 'New Request';
  } catch {
    return r.url || 'New Request';
  }
}

function openSaveModal(tab) {
  const body = el('div');

  const f1 = el('div', 'form-field');
  f1.append(el('label', null, 'Request name'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = tab.name || defaultRequestName(tab.request);
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
  f3.classList.toggle('hidden', colSel.value !== '__new');
  colSel.addEventListener('change', () => f3.classList.toggle('hidden', colSel.value !== '__new'));

  body.append(f1, f2, f3);

  const m = modal('Save Request', body, [
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
          col = { id: uid(), name: cn, open: true, requests: [] };
          state.collections.push(col);
        } else {
          col = state.collections.find((c) => c.id === colSel.value);
        }
        const saved = { id: uid(), name, request: cleanRequest(tab.request) };
        col.requests.push(saved);
        tab.savedRef = { collectionId: col.id, requestId: saved.id };
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
    list.append(d);
  }
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

/* ============================== modals ============================== */

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
      activeTab().respView = b.dataset.rview;
      renderResponse();
    })
  );
  $('#btnCopyResp').addEventListener('click', () => {
    const r = activeTab().response;
    if (!r || !r.ok) return;
    navigator.clipboard.writeText(r.bodyText ?? '');
    toast('Response body copied');
  });
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
      saveActive();
    } else if (k === 't') {
      e.preventDefault();
      newTab();
    } else if (k === 'w') {
      e.preventDefault();
      closeTab(state.activeTabId);
    }
  });
}

/* ============================== init ============================== */

async function init() {
  let stored = null;
  try {
    stored = await window.lostman.loadStore();
  } catch {
    /* first run */
  }

  if (stored) {
    state.collections = Array.isArray(stored.collections) ? stored.collections : [];
    state.history = Array.isArray(stored.history) ? stored.history : [];
    state.environments = Array.isArray(stored.environments) ? stored.environments : [];
    for (const e of state.environments) if (!Array.isArray(e.vars)) e.vars = [];
    state.activeEnvId = stored.activeEnvId || null;
    state.tabs = (Array.isArray(stored.tabs) ? stored.tabs : [])
      .filter((t) => t && t.request)
      .map((t) => ({ ...makeTab(t.request, t.name, t.savedRef), id: t.id || uid() }));
    state.activeTabId = stored.activeTabId;
  }

  if (!state.tabs.length) state.tabs.push(makeTab());
  if (!state.tabs.some((t) => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;

  initEditor();
  initSidebar();
  initResponseToolbar();
  initSplitter();
  initShortcuts();

  $('#btnNewTab').addEventListener('click', newTab);
  $('#envSelect').addEventListener('change', (e) => {
    state.activeEnvId = e.target.value || null;
    persist();
  });
  $('#btnManageEnv').addEventListener('click', openEnvManager);

  renderEnvSelect();
  renderSidebar();
  renderTabsBar();
  loadEditor();
}

init();
