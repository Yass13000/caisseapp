// @ts-nocheck
import { app, BrowserWindow, ipcMain, dialog, screen, nativeImage, protocol, session, net } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import crypto from 'crypto';
import { Readable } from 'stream';

import PrinterManager from './printing/PrinterManager.js';

// Médias de l'écran client en cache local, servis à la page par caisse-media://ads/<fichier>
// (doit être déclaré avant app.whenReady)
protocol.registerSchemesAsPrivileged([
  { scheme: 'caisse-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

const APP_URL = process.env.VITE_APP_URL || 'https://caisseapp.vercel.app/#/caisse';
const ALLOWED_ORIGIN = 'https://caisseapp.vercel.app';
// Adresse de confiance : comparaison exacte de l'origine (un simple « commence par »
// acceptait aussi https://caisseapp.vercel.app.site-pirate.com). localhost : développement seulement.
const isTrustedUrl = (url) => {
  try {
    const u = new URL(url);
    if (u.origin === ALLOWED_ORIGIN) return true;
    return process.env.NODE_ENV === 'development' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

let retryDelayMs = 3000;
const MAX_RETRY_DELAY_MS = 30000;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Yaiba Caisse',
    width: 1080,
    height: 1920,
    show: false,
    icon: process.platform === 'win32'
      ? path.join(__dirname, '../build/icon.ico')
      : path.join(__dirname, '../build/icon.png'),
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
    if (!isTrustedUrl(url)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedUrl(url)) {
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // L'écran client s'ouvre après la caisse pour ne pas lui voler le focus
    syncCustomerDisplay();
  });

  // Fenêtre principale fermée = application fermée, même si une fenêtre d'impression cachée
  // est restée ouverte (pilote qui ne répond pas) : sinon l'installateur croit l'app ouverte.
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

app.whenReady().then(() => {
  registerCustomerMediaProtocol();
  createWindow();
  // Branchement / débranchement d'un écran : on ouvre ou on ferme l'écran client
  screen.on('display-added', scheduleCustomerDisplaySync);
  screen.on('display-removed', scheduleCustomerDisplaySync);
  screen.on('display-metrics-changed', scheduleCustomerDisplaySync);
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
  'category_printer_routing',
  'default_order_type',
  'highlight_multi_qty',
  'kitchen_font_scale',
  'kitchen_inverted_header',
  'show_logo',
  'customer_display_enabled',
  'customer_display_bg_mode',
  'customer_display_bg_color',
  'customer_display_bg_gradient',
  'customer_display_ad_duration'
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

  if (key === 'default_order_type') {
    if (!['SUR PLACE', 'EMPORTER', 'LIVRAISON'].includes(String(value))) {
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

  if (key === 'customer_display_bg_mode') {
    if (!['theme', 'color', 'gradient', 'image'].includes(String(value))) {
      event.returnValue = false;
      return;
    }
  }

  if (key === 'customer_display_bg_color') {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(value))) {
      event.returnValue = false;
      return;
    }
  }

  if (key === 'customer_display_bg_gradient') {
    if (!/^[a-z0-9-]{1,32}$/.test(String(value))) {
      event.returnValue = false;
      return;
    }
  }

  if (key === 'customer_display_ad_duration') {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 3 || num > 60) {
      event.returnValue = false;
      return;
    }
  }

  writeSetting(key, value);
  if (String(key).startsWith('customer_display_')) onCustomerDisplaySettingsChanged();
  event.returnValue = true;
});

function writeSetting(key, value) {
  try {
    const settings = readSettingsFile();
    settings[key] = String(value);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error("Erreur écriture fichier configuration:", e);
  }
}

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

// ============================================================================
// --- ÉCRAN CLIENT (SECOND ÉCRAN) ---
// ============================================================================
// Une fenêtre plein écran sur le 2e écran affiche #/ecran-client. La caisse lui envoie
// le panier par IPC (customer-display:update) ; le processus principal relaie et garde
// le dernier état pour une fenêtre rechargée. Un seul écran : aucune fenêtre.

let customerWindow = null;
let customerDisplaySyncTimer = null;
let lastCustomerDisplayState = null;

const CUSTOMER_DISPLAY_HASH = '/ecran-client';
const customerDisplayDir = path.join(app.getPath('userData'), 'customer-display');
const customerBackgroundPath = path.join(customerDisplayDir, 'background.jpg');

function getCustomerDisplayUrl() {
  if (process.env.NODE_ENV === 'development') return `http://localhost:5173/#${CUSTOMER_DISPLAY_HASH}`;
  return APP_URL.split('#')[0] + '#' + CUSTOMER_DISPLAY_HASH;
}

function isCustomerDisplayEnabled() {
  return readSettingsFile().customer_display_enabled !== 'false';
}

// Écran qui n'accueille pas la caisse (le premier trouvé)
function findCustomerDisplay() {
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return null;
  const mainDisplay = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  return displays.find(d => d.id !== mainDisplay.id) || null;
}

function scheduleCustomerDisplaySync() {
  clearTimeout(customerDisplaySyncTimer);
  customerDisplaySyncTimer = setTimeout(syncCustomerDisplay, 800);
}

function closeCustomerWindow() {
  if (customerWindow && !customerWindow.isDestroyed()) customerWindow.destroy();
  customerWindow = null;
}

function syncCustomerDisplay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const target = isCustomerDisplayEnabled() ? findCustomerDisplay() : null;
  if (!target) {
    closeCustomerWindow();
    return;
  }
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.setFullScreen(false);
    customerWindow.setBounds(target.bounds);
    customerWindow.setFullScreen(true);
    return;
  }
  createCustomerWindow(target);
}

function createCustomerWindow(display) {
  const { x, y, width, height } = display.bounds;
  customerWindow = new BrowserWindow({
    title: 'Écran client',
    x, y, width, height,
    show: false,
    frame: false,
    fullscreen: true,
    skipTaskbar: true,
    focusable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:caisse_session',
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  });

  const win = customerWindow;
  const loadLocal = () => {
    if (!win.isDestroyed()) win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: CUSTOMER_DISPLAY_HASH });
  };
  win.loadURL(getCustomerDisplayUrl()).catch(loadLocal);

  win.webContents.on('did-fail-load', (event, errorCode) => {
    if (errorCode === -105 || errorCode === -106 || errorCode === -102) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(getCustomerDisplayUrl()).catch(loadLocal);
      }, 15000);
    }
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    win.setFullScreen(true);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });

  win.on('closed', () => {
    if (customerWindow === win) customerWindow = null;
  });
}

function sendToCustomerWindow(channel, payload) {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.webContents.send(channel, payload);
  }
}

function onCustomerDisplaySettingsChanged() {
  scheduleCustomerDisplaySync();
  sendToCustomerWindow('customer-display:config-changed');
}

// Caisse → écran client
ipcMain.on('customer-display:update', (event, state) => {
  if (!state || typeof state !== 'object') return;
  lastCustomerDisplayState = state;
  sendToCustomerWindow('customer-display:state', state);
});

ipcMain.handle('customer-display:get-state', () => lastCustomerDisplayState);

ipcMain.handle('customer-display:status', () => ({
  displays: screen.getAllDisplays().length,
  open: !!(customerWindow && !customerWindow.isDestroyed())
}));

// Import d'une image de fond : redimensionnée et enregistrée en JPEG dans userData
ipcMain.handle('customer-display:pick-background', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(parent, {
    title: 'Image de fond',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return { success: false, canceled: true };

  try {
    let img = nativeImage.createFromPath(result.filePaths[0]);
    if (img.isEmpty()) return { success: false, error: 'IMAGE_ILLISIBLE' };
    const { width } = img.getSize();
    if (width > 2560) img = img.resize({ width: 2560, quality: 'best' });
    fs.mkdirSync(customerDisplayDir, { recursive: true });
    fs.writeFileSync(customerBackgroundPath, img.toJPEG(86));
    writeSetting('customer_display_bg_version', String(Date.now()));
    writeSetting('customer_display_bg_mode', 'image');
    onCustomerDisplaySettingsChanged();
    return { success: true };
  } catch (e) {
    console.error("Erreur import image écran client:", e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('customer-display:get-background', () => {
  try {
    if (!fs.existsSync(customerBackgroundPath)) return null;
    return 'data:image/jpeg;base64,' + fs.readFileSync(customerBackgroundPath).toString('base64');
  } catch (e) {
    return null;
  }
});

ipcMain.handle('customer-display:clear-background', () => {
  try {
    if (fs.existsSync(customerBackgroundPath)) fs.unlinkSync(customerBackgroundPath);
  } catch (e) {
    console.error("Erreur suppression image écran client:", e);
  }
  const settings = readSettingsFile();
  if (settings.customer_display_bg_mode === 'image') writeSetting('customer_display_bg_mode', 'theme');
  writeSetting('customer_display_bg_version', String(Date.now()));
  onCustomerDisplaySettingsChanged();
  return { success: true };
});


// ============================================================================
// --- ÉCRAN CLIENT : PUBS EN CACHE LOCAL ---
// ============================================================================
// La page client lit la liste des pubs dans Supabase et la passe ici : chaque fichier est
// téléchargé une fois dans userData/customer-display/ads, puis servi en local (hors ligne compris).

const adsDir = path.join(customerDisplayDir, 'ads');
const adsManifestPath = path.join(customerDisplayDir, 'ads.json');
const MEDIA_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
let adsSyncPromise = null;

function adFileName(url) {
  let ext = '';
  try { ext = path.extname(new URL(url).pathname).toLowerCase(); } catch (e) { /* url invalide */ }
  if (!MEDIA_TYPES[ext]) ext = '.bin';
  return crypto.createHash('sha1').update(url).digest('hex') + ext;
}

function readAdsManifest() {
  try {
    if (fs.existsSync(adsManifestPath)) return JSON.parse(fs.readFileSync(adsManifestPath, 'utf8'));
  } catch (e) { /* manifeste illisible */ }
  return [];
}

function toPlayableAds(list) {
  return list
    .filter(ad => ad && ad.file && fs.existsSync(path.join(adsDir, ad.file)))
    .map(ad => ({ id: ad.id, type: ad.type, duration: ad.duration, src: `caisse-media://ads/${ad.file}` }));
}

function registerCustomerMediaProtocol() {
  const handler = async (request) => {
    try {
      const { host, pathname } = new URL(request.url);
      const name = path.basename(decodeURIComponent(pathname));
      if (host !== 'ads' || !name || name.startsWith('.')) return new Response(null, { status: 404 });
      const filePath = path.join(adsDir, name);
      if (!fs.existsSync(filePath)) return new Response(null, { status: 404 });
      const size = fs.statSync(filePath).size;
      const type = MEDIA_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
      const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
      // Lecture partielle (vidéos)
      if (range && (range[1] || range[2])) {
        let start = range[1] ? parseInt(range[1], 10) : size - parseInt(range[2], 10);
        let end = range[1] && range[2] ? parseInt(range[2], 10) : size - 1;
        start = Math.max(0, start); end = Math.min(end, size - 1);
        if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
          status: 206,
          headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
        });
      }
      return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
      });
    } catch (e) {
      console.error('Erreur média écran client:', e);
      return new Response(null, { status: 500 });
    }
  };
  session.fromPartition('persist:caisse_session').protocol.handle('caisse-media', handler);
}

// Au-delà, le téléchargement est abandonné (réessayé à la synchro suivante) : sans limite,
// une vidéo bloquée gelait toutes les synchros, et une pub supprimée restait affichée.
const AD_DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;

async function downloadAd(url, file) {
  const target = path.join(adsDir, file);
  if (fs.existsSync(target)) return true;
  const tmp = target + '.part';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AD_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      controller.signal.addEventListener('abort', () => { out.destroy(); reject(new Error('délai dépassé')); });
      Readable.fromWeb(res.body).on('error', reject).pipe(out).on('finish', resolve).on('error', reject);
    });
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.warn(`Pub non téléchargée (${url}):`, e.message);
    try { fs.unlinkSync(tmp); } catch (err) { /* rien à nettoyer */ }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function syncAds(list) {
  fs.mkdirSync(adsDir, { recursive: true });
  const wanted = (Array.isArray(list) ? list : [])
    .filter(ad => ad && typeof ad.url === 'string' && /^https:\/\//.test(ad.url) && (ad.type === 'image' || ad.type === 'video'))
    .slice(0, 50)
    .map(ad => ({ id: String(ad.id), type: ad.type, duration: Math.min(120, Math.max(3, Number(ad.duration) || 8)), url: ad.url, file: adFileName(ad.url) }));

  for (const ad of wanted) await downloadAd(ad.url, ad.file);

  // Fichiers qui ne sont plus dans la liste : supprimés
  const keep = new Set(wanted.map(ad => ad.file));
  for (const f of fs.readdirSync(adsDir)) {
    if (!keep.has(f) && !f.endsWith('.part')) {
      try { fs.unlinkSync(path.join(adsDir, f)); } catch (e) { /* fichier en cours d'utilisation */ }
    }
  }
  fs.writeFileSync(adsManifestPath, JSON.stringify(wanted, null, 2), 'utf8');
  return toPlayableAds(wanted);
}

ipcMain.handle('customer-display:get-cached-ads', () => toPlayableAds(readAdsManifest()));

ipcMain.handle('customer-display:sync-ads', async (event, list) => {
  // Une seule synchro à la fois : la suivante attend la précédente
  const run = async () => syncAds(list);
  adsSyncPromise = (adsSyncPromise || Promise.resolve()).catch(() => {}).then(run);
  try {
    return await adsSyncPromise;
  } catch (e) {
    console.error('Erreur synchro pubs:', e);
    return toPlayableAds(readAdsManifest());
  }
});

// Réglages modifiés sur cette caisse → l'écran client recharge ses pubs tout de suite
ipcMain.on('customer-display:refresh', () => sendToCustomerWindow('customer-display:config-changed'));
