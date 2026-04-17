const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  // Création de la fenêtre de la caisse
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // On la cache le temps qu'elle charge pour éviter un écran blanc
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // On sécurisera ça à l'étape de l'imprimante
    }
  });

  // En mode développement, on charge le serveur local de React (Vite = 5173, CRA = 3000)
  mainWindow.loadURL('http://localhost:5173');

  // Afficher la fenêtre seulement quand elle est prête
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // mainWindow.maximize(); // Décommente ça si tu veux qu'elle s'ouvre en plein écran sur la borne
  });
}

// Quand Electron est prêt, on crée la fenêtre
app.whenReady().then(createWindow);

// Quitter quand toutes les fenêtres sont fermées
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});