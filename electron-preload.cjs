const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflow', {
  setTitle: (title) => ipcRenderer.send('set-title', title),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
});
