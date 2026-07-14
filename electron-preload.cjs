const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflow', {
  setTitle: (title) => ipcRenderer.send('set-title', title),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  onPrepareClose: (callback) => {
    const listener = (_event, attemptId) => { void callback(attemptId); };
    ipcRenderer.on('prepare-close', listener);
    return () => ipcRenderer.removeListener('prepare-close', listener);
  },
  requestClose: () => ipcRenderer.send('request-close'),
  readyToClose: (attemptId) => ipcRenderer.invoke('renderer-ready-to-close', attemptId),
  reportCloseSnapshot: (attemptId, snapshot) => ipcRenderer.send('renderer-close-snapshot', attemptId, snapshot),
  closeSaveFailed: (attemptId, details) => ipcRenderer.send('renderer-close-save-failed', attemptId, details),
});
