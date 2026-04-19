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
// --- OUTILS PRO : RECHERCHE D'IMPRIMANTE & ENVOI DE CODES BRUTS ---
// ============================================================================

// 1. Trouve automatiquement l'imprimante Epson/TM ou celle par défaut
async function getTargetPrinter() {
  if (!mainWindow) return null;
  const printers = await mainWindow.webContents.getPrintersAsync();
  let targetPrinter = printers.find(p => p.isDefault);
  if (!targetPrinter) targetPrinter = printers.find(p => p.name.toLowerCase().includes('tm') || p.name.toLowerCase().includes('epson'));
  if (!targetPrinter && printers.length > 0) targetPrinter = printers[0];
  return targetPrinter;
}

// 2. Fonction magique pour envoyer n'importe quel code ESC/POS via Windows Spooler
function sendRawCommandToPrinter(printerName, byteString) {
  if (process.platform !== 'win32') return Promise.resolve(false);

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

// --- LOGIQUE D'IMPRESSION + MASSICOT AUTOMATIQUE ---
ipcMain.handle('print-receipt', async (event, printContent) => {
  try {
    let printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });

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
        <body>${printContent}</body>
      </html>
    `;

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    printWindow.webContents.print({
      silent: true,
      printBackground: true,
      deviceName: '', 
      margins: { marginType: 'none' }
    }, async (success, failureReason) => {
      printWindow.close();
      if (!success) {
        console.error("Erreur d'impression:", failureReason);
      } else {
        // --- LE SECRET DES PROS : LE COUP DE MASSICOT ---
        // Une fois l'HTML envoyé, on envoie la commande de coupe juste derrière !
        const targetPrinter = await getTargetPrinter();
        if (targetPrinter && process.platform === 'win32') {
          console.log("Envoi du code de coupe (Massicot) à :", targetPrinter.name);
          // 29, 86, 66, 0 = Code universel (GS V 66 0) pour couper le papier proprement
          await sendRawCommandToPrinter(targetPrinter.name, "29, 86, 66, 0");
        }
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Erreur IPC Print:', error);
    return { success: false, error: error.message };
  }
});

// --- OUVERTURE DU TIROIR CAISSE ---
ipcMain.handle('open-drawer', async () => {
  try {
    const targetPrinter = await getTargetPrinter();

    if (!targetPrinter) return { success: false, error: "Aucune imprimante détectée." };

    if (process.platform === 'win32') {
      // Code "Passe-Partout" pour le tiroir
      const kickCode = "27, 112, 0, 25, 250, 27, 112, 1, 25, 250, 27, 112, 48, 55, 121";
      const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, kickCode);
      
      if (isSuccess) {
        console.log(`Tiroir ouvert via l'imprimante: ${targetPrinter.name}`);
        return { success: true };
      } else {
        return { success: false, error: "Échec du script PowerShell" };
      }
    } else {
      // Secours pour les tests sur Mac
      let kickWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });
      await kickWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<html><body>.</body></html>')}`);
      
      return new Promise((resolve) => {
        kickWindow.webContents.print({ silent: true, deviceName: targetPrinter.name }, (success) => {
          kickWindow.close();
          resolve({ success });
        });
      });
    }
  } catch (error) {
    console.error("Erreur fatale IPC Open Drawer:", error);
    return { success: false, error: error.message };
  }
});