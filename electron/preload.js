const { contextBridge, ipcRenderer } = require('electron');

// Exposer des API sécurisées au renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Informations sur l'environnement
  platform: process.platform,
  isElectron: true,

  // API pour les fonctionnalités futures (exemple)
  // onNotification: (callback) => ipcRenderer.on('notification', callback),
  // sendPrint: (data) => ipcRenderer.send('print', data),
});

// Log pour confirmer le chargement
console.log('Preload script chargé avec succès');
