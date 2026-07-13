const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflow', {
  setTitle: (title) => ipcRenderer.send('set-title', title),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  onPrepareClose: (callback) => {
    const listener = () => { void callback(); };
    ipcRenderer.on('prepare-close', listener);
    return () => ipcRenderer.removeListener('prepare-close', listener);
  },
  requestClose: () => ipcRenderer.send('request-close'),
  readyToClose: () => ipcRenderer.send('renderer-ready-to-close'),
});
