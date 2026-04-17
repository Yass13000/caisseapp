import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920, // Format portrait pour une borne
    show: false,
    kiosk: process.env.NODE_ENV !== 'development', // Plein écran bloqué en prod
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // On relie le script douanier
    }
  });

  // Chargement de l'URL de dev ou des fichiers buildés
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 👇 MODIFICATION ICI : On force l'ouverture des DevTools pour débugger l'écran blanc
  mainWindow.webContents.openDevTools();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- LOGIQUE D'IMPRESSION SILENCIEUSE ---
ipcMain.handle('print-receipt', async (event, printContent) => {
  try {
    // 1. Créer une fenêtre cachée spécialement pour l'impression
    let printWindow = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true }
    });

    // 2. Charger le contenu HTML (le ticket de caisse) dans cette fenêtre cachée
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: monospace; font-size: 12px; margin: 0; padding: 10px; width: 80mm; }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: bold; }
            hr { border-top: 1px dashed black; }
          </style>
        </head>
        <body>
          ${printContent}
        </body>
      </html>
    `;

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // 3. Envoyer l'ordre d'impression silencieuse
    printWindow.webContents.print({
      silent: true,
      printBackground: true,
      deviceName: '', // Laisse vide pour utiliser l'imprimante par défaut de Windows, ou mets le nom exact de l'imprimante EPSON/Star
      margins: { marginType: 'none' }
    }, (success, failureReason) => {
      printWindow.close(); // Détruire la fenêtre cachée après l'impression
      if (!success) console.error("Erreur d'impression:", failureReason);
    });

    return { success: true };
  } catch (error) {
    console.error('Erreur IPC Print:', error);
    return { success: false, error: error.message };
  }
});

// Permet au front-end de récupérer la liste des imprimantes installées sur Windows
ipcMain.handle('get-printers', async (event) => {
  if (mainWindow) {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers;
  }
  return [];
});