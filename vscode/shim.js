'use strict';

/* Webview bridge: implements the same window.lostman API the Electron preload provides,
   but over VS Code's postMessage RPC. Loaded before i18n.js / app.js. */

(function () {
  const vscodeApi = acquireVsCodeApi();
  let seq = 0;
  const pending = new Map();
  let streamCb = null;
  let storeCb = null;

  function rpc(method, args) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      vscodeApi.postMessage({ id, method, args });
    });
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m) return;
    if (m.rpcId && pending.has(m.rpcId)) {
      const resolve = pending.get(m.rpcId);
      pending.delete(m.rpcId);
      resolve(m.result);
    } else if (m.event === 'stream' && streamCb) {
      streamCb(m.data);
    } else if (m.event === 'storeChanged' && storeCb) {
      storeCb(m.data);
    }
  });

  window.lostman = {
    send: (req) => rpc('http:send', req),
    abort: (id) => rpc('http:abort', id),
    loadStore: () => rpc('store:load'),
    saveStore: (data) => rpc('store:save', data),
    pickFile: () => rpc('dialog:pickFile'),
    saveResponse: (opts) => rpc('resp:save', opts),
    openFile: (opts) => rpc('file:open', opts),
    saveTextFile: (opts) => rpc('file:saveText', opts),
    oauthAuthorize: (opts) => rpc('oauth:authorize', opts),
    streamOpen: (opts) => rpc('stream:open', opts),
    streamSend: (opts) => rpc('stream:send', opts),
    streamClose: (opts) => rpc('stream:close', opts),
    newWindow: () => rpc('app:newWindow'),
    storeInfo: () => rpc('store:info'),
    setPortable: (on) => rpc('store:setPortable', on),
    onStreamEvent: (cb) => {
      streamCb = cb;
    },
    onStoreChanged: (cb) => {
      storeCb = cb;
    },
  };
})();
