// @ts-nocheck
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

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
      partition: 'persist:caisse_session',
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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

ipcMain.on('get-setting-sync', (event, key, defaultValue) => {
  const settings = readSettingsFile();
  event.returnValue = settings[key] !== undefined ? settings[key] : defaultValue;
});

ipcMain.on('set-setting-sync', (event, key, value) => {
  try {
    const settings = readSettingsFile();
    settings[key] = value;
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
    if (specificPrinter) return specificPrinter;
  }

  let targetPrinter = printers.find(p => p.isDefault);
  if (!targetPrinter) targetPrinter = printers.find(p => p.name.toLowerCase().includes('tm') || p.name.toLowerCase().includes('epson'));
  if (!targetPrinter && printers.length > 0) targetPrinter = printers[0];
  
  return targetPrinter;
}

function sendRawCommandToPrinter(printerName, byteString) {
  if (process.platform !== 'win32') return Promise.resolve(false);

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=Convention.StdCall)]
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
    exec(`powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`, (error) => {
      resolve(!error);
    });
  });
}

// ============================================================================
// --- IPC HANDLERS (ÉCOUTEURS POUR LE FRONT-END) ---
// ============================================================================

ipcMain.handle('get-printers', async () => {
  if (mainWindow) return await mainWindow.webContents.getPrintersAsync();
  return [];
});

// --- LOGIQUE D'IMPRESSION BLINDÉE (ATTENTE DU RETOUR MATÉRIEL HORS-LIGNE) ---
ipcMain.handle('print-receipt', async (event, printContent, printerName) => {
  const settings = readSettingsFile();
  const width = settings.receipt_width || '72';

  return new Promise(async (resolve) => {
    try {
      let printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });

      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: monospace; font-size: 12px; margin: 0; padding: 10px; width: ${width}mm; }
              .center { text-align: center; }
              .right { text-align: right; }
              .bold { font-weight: bold; }
              hr { border-top: 1px dashed black; }
            </style>
          </head>
          <body>${printContent}</body>
        </html>
      `;

      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

      const targetPrinter = await getTargetPrinter(printerName);
      const deviceName = targetPrinter ? targetPrinter.name : '';

      printWindow.shadowWindow = printWindow; // Protection GC

      printWindow.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: deviceName,
        margins: { marginType: 'none' }
      }, async (success, failureReason) => {
        
        // Destruction propre de la fenêtre pour libérer la RAM
        printWindow.destroy();
        printWindow = null;

        if (!success) {
          console.error("Erreur d'impression physique:", failureReason);
          resolve({ success: false, error: failureReason });
        } else {
          if (targetPrinter && process.platform === 'win32') {
            await sendRawCommandToPrinter(targetPrinter.name, "29, 86, 66, 0");
          }
          resolve({ success: true });
        }
      });

    } catch (error) {
      console.error('Erreur IPC Print critique:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

// --- OUVERTURE DU TIROIR CAISSE ---
ipcMain.handle('open-drawer', async (event, printerName) => {
  try {
    const targetPrinter = await getTargetPrinter(printerName);

    if (!targetPrinter) return { success: false, error: "Aucune imprimante détectée." };

    if (process.platform === 'win32') {
      const kickCode = "27, 112, 0, 25, 250, 27, 112, 1, 25, 250, 27, 112, 48, 55, 121";
      const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, kickCode);
      
      if (isSuccess) {
        console.log(`Tiroir ouvert via l'imprimante: ${targetPrinter.name}`);
        return { success: true };
      } else {
        return { success: false, error: "Échec du script PowerShell" };
      }
    } else {
      let kickWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });
      await kickWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<html><body>.</body></html>')}`);
      
      return new Promise((resolve) => {
        kickWindow.webContents.print({ silent: true, deviceName: targetPrinter.name }, (success) => {
          kickWindow.destroy();
          kickWindow = null;
          resolve({ success });
        });
      });
    }
  } catch (error) {
    console.error("Erreur fatale IPC Open Drawer:", error);
    return { success: false, error: error.message };
  }
});

// --- FERMETURE DE L'APPLICATION ---
ipcMain.on('close-app', () => {
  app.quit();
});

// --- EXTINCTION DU PC COMPLET ---
ipcMain.on('shutdown-pc', () => {
  const command = process.platform === 'win32' ? 'shutdown /s /t 0' : 'init 0';
  exec(command);
});

// --- REDÉMARRAGE DU PC COMPLET ---
ipcMain.on('restart-pc', () => {
  const command = process.platform === 'win32' ? 'shutdown /r /t 0' : 'init 6';
  exec(command);
});