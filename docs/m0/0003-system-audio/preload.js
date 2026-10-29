const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('m0', {
  report(payload) {
    ipcRenderer.send('m0:report', payload);
  },
  askMicrophone() {
    return ipcRenderer.invoke('m0:askMicrophone');
  },
});
