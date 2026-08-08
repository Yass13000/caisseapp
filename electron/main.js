// @ts-nocheck
import { app, BrowserWindow, ipcMain } from 'electron';
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
// --- OUTILS PRO : RECHERCHE D'IMPRIMANTE & ENVOI DE CODES BRUTS ---
// ============================================================================

async function getTargetPrinter(desiredPrinterName) {
  if (!mainWindow) return null;
  const printers = await mainWindow.webContents.getPrintersAsync();
  
  if (desiredPrinterName) {
    const specificPrinter = printers.find(p => p.name === desiredPrinterName);
    if (specificPrinter) {
      console.log(`[POS Hardware] Imprimante spécifique résolue: ${specificPrinter.name}`);
      return specificPrinter;
    }
  }

  let targetPrinter = printers.find(p => p.isDefault);
  if (!targetPrinter) targetPrinter = printers.find(p => p.name.toLowerCase().includes('tm') || p.name.toLowerCase().includes('epson'));
  if (!targetPrinter && printers.length > 0) targetPrinter = printers[0];
  
  console.log(`[POS Hardware] Imprimante cible résolue (défaut/auto): ${targetPrinter ? targetPrinter.name : 'AUCUNE'}`);
  return targetPrinter;
}

function sendRawCommandToPrinter(printerName, byteString) {
  if (process.platform !== 'win32') return Promise.resolve(false);

  console.log(`[POS Hardware] Envoi commande RAW à "${printerName}" -> Octets: [${byteString}]`);

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        bool bSuccess = false;
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Signal ESC/POS"; di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    int dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        Marshal.FreeCoTaskMem(pUnmanagedBytes); return bSuccess;
    }
}
"@
[RawPrinterHelper]::SendBytesToPrinter("${printerName}", [byte[]](${byteString}))
`;
  
  const scriptPath = path.join(os.tmpdir(), 'raw_printer_signal.ps1');
  fs.writeFileSync(scriptPath, psScript, 'utf8');

  return new Promise((resolve) => {
    exec(`powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`, (error, stdout) => {
      const output = stdout.trim().toLowerCase();
      const isSuccess = !error && output === 'true';
      console.log(`[POS Hardware] Résultat WritePrinter via PowerShell: ${isSuccess} (Output: ${output})`);
      resolve(isSuccess);
    });
  });
}

// ============================================================================
// --- IPC HANDLERS MATÉRIEL (DÉLÉGUÉS À PRINTER MANAGER) ---
// ============================================================================

ipcMain.handle('get-printers', async () => {
  if (mainWindow) return await mainWindow.webContents.getPrintersAsync();
  return [];
});

ipcMain.handle('print-receipt', async (event, data, printerName) => {
  return await PrinterManager.printReceipt(data, printerName, mainWindow);
});

ipcMain.handle('open-drawer', async (event, printerName) => {
  return await PrinterManager.openDrawer(printerName, mainWindow);
});

// --- FERMETURE DE L'APPLICATION ---
ipcMain.on('close-app', () => {
  app.quit();
});

// --- EXTINCTION DU PC COMPLET (AVEC CONFIRMATION NATIVE OBLIGATOIRE) ---
ipcMain.on('shutdown-pc', () => {
  const { dialog } = require('electron');
  const response = dialog.showMessageBoxSync(mainWindow, {
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
  const { dialog } = require('electron');
  const response = dialog.showMessageBoxSync(mainWindow, {
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

// --- ALIAS IPC NATIVE POS (CANAL ALIAS DE COMPATIBILITÉ POUR FUTURS MODULES EXTERNES) ---
// Note de documentation : electronAPI.printReceipt via 'print-receipt' reste le canal principal utilisé par le frontend.
// Les canaux 'pos:print-receipt', 'pos:open-drawer' et 'pos:printer-status' sont conservés comme alias de compatibilité standard POS.
ipcMain.handle('pos:print-receipt', async (event, data) => {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'TIMEOUT_PRINTER_UNREACHABLE' });
    }, 10000);

    const printerName = typeof data === 'object' ? data?.printerName : undefined;

    PrinterManager.printReceipt(data, printerName, mainWindow).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }).catch((err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('pos:open-drawer', async (event, printerName) => {
  const targetName = typeof printerName === 'string' ? printerName : undefined;
  return await PrinterManager.openDrawer(targetName, mainWindow);
});

ipcMain.handle('pos:printer-status', async () => {
  return await PrinterManager.checkPrinterStatus(mainWindow);
});