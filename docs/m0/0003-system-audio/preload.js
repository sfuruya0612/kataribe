const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('m0', {
  report(payload) {
    ipcRenderer.send('m0:report', payload);
  },
});
