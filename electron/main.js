// @ts-nocheck
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';

import PrinterManager from './printing/PrinterManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

const APP_URL = process.env.VITE_APP_URL || 'https://caisseapp.vercel.app/#/caisse';
const ALLOWED_ORIGIN = 'https://caisseapp.vercel.app';

let retryDelayMs = 3000;
const MAX_RETRY_DELAY_MS = 30000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    show: false,
    kiosk: process.env.NODE_ENV !== 'development',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:caisse_session',
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const targetUrl = process.env.NODE_ENV === 'development' 
    ? 'http://localhost:5173' 
    : APP_URL;

  mainWindow.loadURL(targetUrl).catch((err) => {
    console.warn("🌐 Échec du chargement de l'URL distante, bascule sur le bundle local :", err);
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  });

  // Reconnexion automatique avec backoff plafonné en cas de déconnexion réseau
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (errorCode === -105 || errorCode === -106 || errorCode === -102) {
      console.warn(`[Electron] Échec de chargement (${errorDescription}). Nouvelle tentative dans ${retryDelayMs / 1000}s...`);
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL(targetUrl).catch(() => {
            mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
          });
        }
      }, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    retryDelayMs = 3000;
  });

  // Restreindre la navigation au domaine de confiance uniquement (Sécurité POS Kiosque)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ALLOWED_ORIGIN) && !url.startsWith('http://localhost')) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ALLOWED_ORIGIN) && !url.startsWith('http://localhost')) {
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

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
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================================
// --- GESTION SÉCURISÉE DES RÉGLAGES (FICHIER LOCAL) ---
// ============================================================================

const settingsPath = path.join(app.getPath('userData'), 'caisse-settings.json');
const offlineOrdersPath = path.join(app.getPath('userData'), 'offline-orders.json');

function readSettingsFile() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error("Erreur lecture fichier configuration:", e);
  }
  return {};
}

const ALLOWED_SETTINGS_KEYS = new Set([
  'pos_restaurant_id',
  'pos_pin',
  'auto_print_receipt',
  'print_kitchen_ticket',
  'receipt_width',
  'imprimante_caisse',
  'imprimante_cuisine',
  'imprimante_livraison',
  'imprimante_rapports',
  'receipt_font_size',
  'receipt_margin_type',
  'receipt_copies_client',
  'receipt_copies_kitchen',
  'show_header_info',
  'show_tax_details',
  'show_footer_message',
  'footer_custom_message',
  'show_qr_code',
  'qr_code_type',
  'qr_code_custom_url',
  'kitchen_show_prices',
  'drawer_pin_mode',
  'auto_open_drawer_cash',
  'category_printer_routing'
]);

ipcMain.on('get-setting-sync', (event, key, defaultValue) => {
  const settings = readSettingsFile();
  event.returnValue = settings[key] !== undefined ? settings[key] : defaultValue;
});

ipcMain.on('set-setting-sync', (event, key, value) => {
  if (!ALLOWED_SETTINGS_KEYS.has(key)) {
    console.warn(`⚠️ tentative de modification de clé non autorisée: ${key}`);
    event.returnValue = false;
    return;
  }

  // Validation de type & format selon la clé
  if (key === 'receipt_width') {
    const num = Number(value);
    if (isNaN(num) || num < 40 || num > 120) {
      console.warn(`⚠️ Largeur de reçu invalide: ${value}`);
      event.returnValue = false;
      return;
    }
  }

  if (key === 'qr_code_custom_url' && value) {
    try {
      new URL(String(value));
    } catch (e) {
      console.warn(`⚠️ URL de QR code invalide: ${value}`);
      event.returnValue = false;
      return;
    }
  }

  if (key === 'category_printer_routing' && value) {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (typeof parsed !== 'object' || parsed === null) {
        event.returnValue = false;
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Routage par catégorie invalide: ${value}`);
      event.returnValue = false;
      return;
    }
  }

  if (key === 'receipt_copies_client' || key === 'receipt_copies_kitchen') {
    const num = Number(value);
    if (isNaN(num) || num < 1 || num > 5) {
      event.returnValue = false;
      return;
    }
  }

  if (key === 'drawer_pin_mode') {
    if (!['0', '1', 'both'].includes(String(value))) {
      event.returnValue = false;
      return;
    }
  }

  try {
    const settings = readSettingsFile();
    settings[key] = String(value);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error("Erreur écriture fichier configuration:", e);
  }
  event.returnValue = true;
});

// ============================================================================
// --- ENGINE HORS-LIGNE : COMMANDES LOCALES ---
// ============================================================================

function readOfflineOrdersFile() {
  try {
    if (fs.existsSync(offlineOrdersPath)) {
      return JSON.parse(fs.readFileSync(offlineOrdersPath, 'utf8'));
    }
  } catch (e) {
    console.error("Erreur lecture fichier commandes hors-ligne:", e);
  }
  return [];
}

ipcMain.handle('save-offline-order', async (event, order) => {
  try {
    const orders = readOfflineOrdersFile();
    orders.push(order);
    fs.writeFileSync(offlineOrdersPath, JSON.stringify(orders, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    console.error("Erreur sauvegarde commande offline:", e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-offline-orders', async () => {
  return readOfflineOrdersFile();
});

ipcMain.handle('remove-offline-order', async (event, offlineId) => {
  try {
    const orders = readOfflineOrdersFile();
    const filteredOrders = orders.filter(o => o.offline_id !== offlineId);
    fs.writeFileSync(offlineOrdersPath, JSON.stringify(filteredOrders, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    console.error("Erreur suppression commande offline:", e);
    return { success: false, error: e.message };
  }
});

// ============================================================================
// --- IPC HANDLERS MATÉRIEL (DÉLÉGUÉS À PRINTER MANAGER) ---
// ============================================================================

ipcMain.handle('get-printers', async () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) return await win.webContents.getPrintersAsync();
  return [];
});

ipcMain.handle('print-receipt', async (event, data, printerName) => {
  const win = mainWindow || BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  return await PrinterManager.printReceipt(data, printerName, win);
});

ipcMain.handle('open-drawer', async (event, printerName) => {
  const win = mainWindow || BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  return await PrinterManager.openDrawer(printerName, win);
});

// --- FERMETURE DE L'APPLICATION ---
ipcMain.on('close-app', () => {
  app.quit();
});

// --- EXTINCTION DU PC COMPLET (AVEC CONFIRMATION NATIVE OBLIGATOIRE) ---
ipcMain.on('shutdown-pc', () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const response = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Annuler', 'Éteindre la caisse'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirmation Extinction',
    message: 'Voulez-vous vraiment éteindre la borne de caisse physique ?'
  });

  if (response === 1) {
    const command = process.platform === 'win32' ? 'shutdown /s /t 0' : 'init 0';
    exec(command);
  }
});

// --- REDÉMARRAGE DU PC COMPLET (AVEC CONFIRMATION NATIVE OBLIGATOIRE) ---
ipcMain.on('restart-pc', () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const response = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Annuler', 'Redémarrer'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirmation Redémarrage',
    message: 'Voulez-vous vraiment redémarrer la borne de caisse physique ?'
  });

  if (response === 1) {
    const command = process.platform === 'win32' ? 'shutdown /r /t 0' : 'init 6';
    exec(command);
  }
});

// --- ALIAS IPC NATIVE POS ---
ipcMain.handle('pos:print-receipt', async (event, data) => {
  const win = mainWindow || BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'TIMEOUT_PRINTER_UNREACHABLE' });
    }, 10000);

    const printerName = typeof data === 'object' ? data?.printerName : undefined;

    PrinterManager.printReceipt(data, printerName, win).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }).catch((err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('pos:open-drawer', async (event, printerName) => {
  const win = mainWindow || BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const targetName = typeof printerName === 'string' ? printerName : undefined;
  return await PrinterManager.openDrawer(targetName, win);
});

ipcMain.handle('pos:printer-status', async (event) => {
  const win = mainWindow || BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  return await PrinterManager.checkPrinterStatus(win);
});