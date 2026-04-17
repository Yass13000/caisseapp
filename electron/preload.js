// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Envoyer du HTML brut à imprimer
  printReceipt: (htmlContent) => ipcRenderer.invoke('print-receipt', htmlContent),
  
  // Obtenir la liste des imprimantes Windows
  getPrinters: () => ipcRenderer.invoke('get-printers')
});  