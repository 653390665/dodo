const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflow', {
  setTitle: (title) => ipcRenderer.send('set-title', title),
});
