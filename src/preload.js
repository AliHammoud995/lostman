const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lostman', {
  send: (req) => ipcRenderer.invoke('http:send', req),
  abort: (id) => ipcRenderer.invoke('http:abort', id),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  saveResponse: (opts) => ipcRenderer.invoke('resp:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  saveTextFile: (opts) => ipcRenderer.invoke('file:saveText', opts),
  oauthAuthorize: (opts) => ipcRenderer.invoke('oauth:authorize', opts),
  streamOpen: (opts) => ipcRenderer.invoke('stream:open', opts),
  streamSend: (opts) => ipcRenderer.invoke('stream:send', opts),
  streamClose: (opts) => ipcRenderer.invoke('stream:close', opts),
  onStreamEvent: (cb) => ipcRenderer.on('stream:event', (_e, data) => cb(data)),
});
