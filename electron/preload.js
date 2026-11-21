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
  removeOfflineOrder: (offlineId) => ipcRenderer.invoke('remove-offline-order', offlineId),

  // --- ÉCRAN CLIENT (SECOND ÉCRAN) ---
  customerDisplay: {
    // Caisse → écran client
    update: (state) => ipcRenderer.send('customer-display:update', state),
    // Écran client : abonnement à l'état envoyé par la caisse (renvoie la désinscription)
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('customer-display:state', listener);
      return () => ipcRenderer.removeListener('customer-display:state', listener);
    },
    onConfigChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('customer-display:config-changed', listener);
      return () => ipcRenderer.removeListener('customer-display:config-changed', listener);
    },
    getState: () => ipcRenderer.invoke('customer-display:get-state'),
    getStatus: () => ipcRenderer.invoke('customer-display:status'),
    pickBackground: () => ipcRenderer.invoke('customer-display:pick-background'),
    getBackground: () => ipcRenderer.invoke('customer-display:get-background'),
    clearBackground: () => ipcRenderer.invoke('customer-display:clear-background'),
    // Pubs : cache local (hors ligne) et synchronisation depuis la liste Supabase
    getCachedAds: () => ipcRenderer.invoke('customer-display:get-cached-ads'),
    syncAds: (list) => ipcRenderer.invoke('customer-display:sync-ads', list),
    refresh: () => ipcRenderer.send('customer-display:refresh')
  }
});

// --- PONT IPC DÉDIÉ NATIVE POS ---
contextBridge.exposeInMainWorld('pos', {
  printReceipt: (data) => ipcRenderer.invoke('pos:print-receipt', data),
  openCashDrawer: (printerName) => ipcRenderer.invoke('pos:open-drawer', printerName),
  getPrinterStatus: () => ipcRenderer.invoke('pos:printer-status')
});