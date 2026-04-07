const { app, BrowserWindow, screen, globalShortcut } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;

// Configuration du mode kiosque
const KIOSK_CONFIG = {
  fullscreen: true,
  kiosk: true,
  autoHideMenuBar: true,
  frame: false,
};

function createWindow() {
  // Récupérer les dimensions de l'écran principal
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  // Créer la fenêtre du navigateur
  mainWindow = new BrowserWindow({
    width,
    height,
    ...KIOSK_CONFIG,
    backgroundColor: '#1a1410', // Couleur de fond pendant le chargement
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      sandbox: true,
      // Optimisations pour les écrans tactiles
      scrollBounce: true,
      // Désactiver le zoom par pincement
      zoomFactor: 1.0,
    },
    // Support des écrans tactiles
    enableLargerThanScreen: false,
    useContentSize: true,
  });

  // Charger l'application
  if (isDev) {
    // En développement, charger depuis le serveur Vite
    mainWindow.loadURL('http://localhost:5173');
    // Ouvrir les DevTools en développement
    mainWindow.webContents.openDevTools();
  } else {
    // En production, charger depuis les fichiers buildés
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Désactiver le zoom
  mainWindow.webContents.setZoomFactor(1.0);
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow.webContents.setZoomFactor(1.0);
  });

  // Empêcher la navigation externe
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = isDev ? 'http://localhost:5173' : 'file://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
    }
  });

  // Gérer la fermeture de la fenêtre
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Logs pour le débogage
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Application chargée avec succès');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Erreur de chargement:', errorCode, errorDescription);
  });
}

// Désactiver les raccourcis clavier dangereux en mode kiosque
function setupKioskShortcuts() {
  // Désactiver tous les raccourcis par défaut
  globalShortcut.register('CommandOrControl+R', () => false); // Rechargement
  globalShortcut.register('F5', () => false); // Rechargement
  globalShortcut.register('CommandOrControl+Shift+R', () => false); // Rechargement forcé
  globalShortcut.register('CommandOrControl+Q', () => false); // Quitter
  globalShortcut.register('CommandOrControl+W', () => false); // Fermer fenêtre
  globalShortcut.register('Alt+F4', () => false); // Fermer (Windows)
  globalShortcut.register('F11', () => false); // Plein écran
  globalShortcut.register('Escape', () => false); // Échap

  // Raccourci secret pour quitter (Ctrl+Shift+Alt+Q)
  globalShortcut.register('CommandOrControl+Shift+Alt+Q', () => {
    app.quit();
  });

  // Raccourci secret pour les DevTools en production (Ctrl+Shift+Alt+D)
  if (!isDev) {
    globalShortcut.register('CommandOrControl+Shift+Alt+D', () => {
      if (mainWindow) {
        mainWindow.webContents.toggleDevTools();
      }
    });
  }
}

// Quand Electron a fini de s'initialiser
app.whenReady().then(() => {
  createWindow();
  setupKioskShortcuts();

  app.on('activate', () => {
    // Sur macOS, recréer une fenêtre quand on clique sur l'icône du dock
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quitter quand toutes les fenêtres sont fermées (sauf sur macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Libérer les raccourcis globaux à la fermeture
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Désactiver le menu de l'application
app.on('browser-window-created', (_, window) => {
  window.setMenu(null);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
  console.error('Erreur non capturée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesse rejetée non gérée:', promise, 'raison:', reason);
});
