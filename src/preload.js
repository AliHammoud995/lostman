const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lostman', {
  send: (req) => ipcRenderer.invoke('http:send', req),
  abort: (id) => ipcRenderer.invoke('http:abort', id),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
});
