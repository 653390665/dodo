const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflow', {
  setTitle: (title) => ipcRenderer.send('set-title', title),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
});
