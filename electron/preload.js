// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Envoyer du HTML brut à imprimer (avec l'imprimante cible en option)
  printReceipt: (htmlContent, printerName) => ipcRenderer.invoke('print-receipt', htmlContent, printerName),
  
  // Obtenir la liste des imprimantes Windows
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Fonction pour ouvrir le tiroir-caisse (via l'imprimante caisse)
  openDrawer: (printerName) => ipcRenderer.invoke('open-drawer', printerName),

  // --- GESTION SÉCURISÉE DES PARAMÈTRES LOCAUX ---
  getSetting: (key, defaultValue) => ipcRenderer.sendSync('get-setting-sync', key, defaultValue),
  setSetting: (key, value) => ipcRenderer.sendSync('set-setting-sync', key, value),

  // --- DEMANDER À ELECTRON DE FERMER L'APP ---
  closeApp: () => ipcRenderer.send('close-app'),

  // --- EXTINCTION ET REDÉMARRAGE DU PC ---
  shutdownPC: () => ipcRenderer.send('shutdown-pc'),
  restartPC: () => ipcRenderer.send('restart-pc'),

  // --- ENGINE DE SAUVEGARDE ET SYNC HORS-LIGNE ---
  saveOfflineOrder: (order) => ipcRenderer.invoke('save-offline-order', order),
  getOfflineOrders: () => ipcRenderer.invoke('get-offline-orders'),
  removeOfflineOrder: (offlineId) => ipcRenderer.invoke('remove-offline-order', offlineId)
});

// --- PONT IPC DÉDIÉ NATIVE POS ---
contextBridge.exposeInMainWorld('pos', {
  printReceipt: (data) => ipcRenderer.invoke('pos:print-receipt', data),
  openCashDrawer: (printerName) => ipcRenderer.invoke('pos:open-drawer', printerName),
  getPrinterStatus: () => ipcRenderer.invoke('pos:printer-status')
});