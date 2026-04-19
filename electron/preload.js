// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Envoyer du HTML brut à imprimer (avec l'imprimante cible en option)
  printReceipt: (htmlContent, printerName) => ipcRenderer.invoke('print-receipt', htmlContent, printerName),
  
  // Obtenir la liste des imprimantes Windows
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Fonction pour ouvrir le tiroir-caisse (via l'imprimante caisse)
  openDrawer: (printerName) => ipcRenderer.invoke('open-drawer', printerName)
});