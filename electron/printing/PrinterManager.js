// @ts-nocheck
import electron from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import { exec } from 'child_process';
import { configureTicketTemplates, escapeHtml, parseOrderItems, buildKitchenHtml, buildDriverSettlementHtml, buildZReportHtml, buildReceiptHtml } from './ticketTemplates.js';
import { printHtmlAsImage, VIRTUAL_PRINTER } from './rasterPrint.js';

const { BrowserWindow, app } = electron;

function readSettingsFile() {
  const settingsPath = path.join(app.getPath('userData'), 'caisse-settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error("[PrinterManager] Erreur lecture configuration:", e);
  }
  return {};
}

// ----------------------------------------------------------------------------
// 🛡️ GESTION DU LOGO (CACHE BINAIRE LOCAL)
// ----------------------------------------------------------------------------
async function getCachedLogoDataUrl(logoUrl, restaurantId) {
  if (!logoUrl || typeof logoUrl !== 'string') return '';
  if (!logoUrl.startsWith('http://') && !logoUrl.startsWith('https://')) return '';

  const cacheDir = app.getPath('userData');
  const safeRestoId = restaurantId ? String(restaurantId).replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const logoPath = safeRestoId ? path.join(cacheDir, `logo-cache-${safeRestoId}.bin`) : null;
  const metaPath = safeRestoId ? path.join(cacheDir, `logo-cache-meta-${safeRestoId}.json`) : null;

  let cachedUrl = '';
  let cachedMime = 'image/png';
  if (metaPath && logoPath) {
    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        cachedUrl = meta.url || '';
        cachedMime = meta.mimeType || 'image/png';
      }
    } catch (e) {}

    if (cachedUrl === logoUrl && fs.existsSync(logoPath)) {
      try {
        const buf = fs.readFileSync(logoPath);
        return `data:${cachedMime};base64,${buf.toString('base64')}`;
      } catch (e) {}
    }
  }

  return new Promise((resolve) => {
    let resolved = false;
    let req = null;

    const safeResolve = (val) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      if (req) {
        try { req.destroy(); } catch (e) {}
      }
      resolve(val);
    };

    const fallbackResolve = () => {
      if (safeRestoId && cachedUrl === logoUrl && logoPath && fs.existsSync(logoPath)) {
        try {
          const buf = fs.readFileSync(logoPath);
          safeResolve(`data:${cachedMime};base64,${buf.toString('base64')}`);
          return;
        } catch (e) {}
      }
      safeResolve('');
    };

    const timeoutTimer = setTimeout(() => {
      console.warn("[PrinterManager] Timeout (5s) téléchargement logo");
      fallbackResolve();
    }, 5000);

    const client = logoUrl.startsWith('https') ? https : http;
    req = client.get(logoUrl, (res) => {
      res.on('error', () => fallbackResolve());

      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      const isValidType = contentType.includes('image/png') || 
                          contentType.includes('image/jpeg') || 
                          contentType.includes('image/jpg') || 
                          contentType.includes('image/webp');

      if (res.statusCode !== 200 || !isValidType) {
        res.destroy();
        fallbackResolve();
        return;
      }

      const data = [];
      let totalBytes = 0;
      const MAX_BYTES = 3 * 1024 * 1024;

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          res.destroy();
          fallbackResolve();
        } else {
          data.push(chunk);
        }
      });

      res.on('end', () => {
        if (resolved) return;
        if (totalBytes > MAX_BYTES) {
          fallbackResolve();
          return;
        }

        try {
          const buffer = Buffer.concat(data);

          const isPng = buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
          const isJpeg = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
          const isWebp = buffer.length >= 12 && 
                         buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                         buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

          if (!isPng && !isJpeg && !isWebp) {
            fallbackResolve();
            return;
          }

          let mimeType = 'image/png';
          if (isJpeg) mimeType = 'image/jpeg';
          if (isWebp) mimeType = 'image/webp';

          if (safeRestoId && logoPath && metaPath) {
            fs.writeFileSync(logoPath, buffer);
            fs.writeFileSync(metaPath, JSON.stringify({ url: logoUrl, mimeType, date: new Date().toISOString() }), 'utf8');
          }
          safeResolve(`data:${mimeType};base64,${buffer.toString('base64')}`);
        } catch (e) {
          fallbackResolve();
        }
      });
    });

    req.on('error', () => fallbackResolve());
  });
}

async function getTargetPrinter(desiredPrinterName, mainWindow, role = 'caisse') {
  const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const printers = await win.webContents.getPrintersAsync();
  if (!printers || printers.length === 0) return null;

  const findPrinterByName = (nameToFind) => {
    if (!nameToFind || typeof nameToFind !== 'string' || nameToFind.trim() === '') return null;
    const clean = nameToFind.trim();
    return printers.find(p => p.name === clean) || 
           printers.find(p => p.name.toLowerCase() === clean.toLowerCase());
  };

  const explicitMatch = findPrinterByName(desiredPrinterName);
  if (explicitMatch) return explicitMatch;

  const settings = readSettingsFile();
  let rolePrinterName = '';
  if (role === 'cuisine') {
    rolePrinterName = settings.imprimante_cuisine || settings.imprimante_caisse;
  } else if (role === 'livraison') {
    rolePrinterName = settings.imprimante_livraison || settings.imprimante_caisse;
  } else if (role === 'rapports') {
    rolePrinterName = settings.imprimante_rapports || settings.imprimante_caisse || settings.imprimante_cuisine;
  } else {
    rolePrinterName = settings.imprimante_caisse || settings.imprimante_cuisine;
  }

  const configuredMatch = findPrinterByName(rolePrinterName);
  if (configuredMatch) return configuredMatch;

  let targetPrinter = printers.find(p => p.isDefault);

  if (!targetPrinter) {
    targetPrinter = printers.find(p => {
      const n = p.name.toLowerCase();
      return n.includes('tm') || n.includes('epson') || n.includes('pos') || n.includes('saga') || n.includes('80');
    });
  }

  if (!targetPrinter) targetPrinter = printers[0];
  
  return targetPrinter;
}

function sendRawCommandToPrinter(printerName, byteString) {
  if (process.platform !== 'win32' || !printerName) return Promise.resolve(false);

  const printerNameBase64 = Buffer.from(String(printerName), 'utf8').toString('base64');
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const scriptPath = path.join(os.tmpdir(), `raw_printer_${uniqueId}.ps1`);

  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", ExactSpelling=true, SetLastError=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        bool bSuccess = false;
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOW di = new DOCINFOW();
        di.pDocName = "Signal ESC/POS";
        di.pDataType = "RAW";
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
$printerName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${printerNameBase64}"))
[RawPrinterHelper]::SendBytesToPrinter($printerName, [byte[]](${byteString}))
`;

  try {
    fs.writeFileSync(scriptPath, psScript, 'utf8');
  } catch (e) {
    console.error("[PrinterManager] Erreur écriture fichier PS:", e);
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    exec(`powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`, (error, stdout) => {
      fs.unlink(scriptPath, () => {});
      const output = stdout.trim().toLowerCase();
      resolve(!error && output === 'true');
    });
  });
}


configureTicketTemplates({ readSettings: readSettingsFile, getLogo: getCachedLogoDataUrl });

const PrinterManager = {
  async printReceipt(orderData, desiredPrinterName, mainWindow) {
    if (typeof orderData !== 'object' || orderData === null) {
      console.error('[PrinterManager] printReceipt exige des données structurées, type reçu:', typeof orderData);
      return { success: false, error: 'INVALID_ORDER_DATA_FORMAT' };
    }

    const settings = readSettingsFile();
    const rawType = String(orderData.orderType || orderData.type || '').toUpperCase();
    const isKitchen = rawType.includes('CUISINE');
    
    let routingConfig = {};
    try {
      if (settings.category_printer_routing) {
        routingConfig = typeof settings.category_printer_routing === 'string'
          ? JSON.parse(settings.category_printer_routing)
          : settings.category_printer_routing;
      }
    } catch (e) {}

    const items = parseOrderItems(orderData.items || orderData.order_details);

    if (isKitchen && routingConfig && Object.keys(routingConfig).length > 0 && items.length > 0) {
      const itemsByPrinterName = {};

      for (const item of items) {
        const cat = String(item.categoryName || item.category || '').trim();
        const assignedRole = cat && routingConfig[cat] ? routingConfig[cat] : 'cuisine';
        
        // Rôle "cuisine" : on garde l'imprimante demandée. Autre rôle (caisse, livraison, rapports) :
        // on prend l'imprimante de ce rôle, sinon on retombe sur l'imprimante cuisine.
        let targetPrinterRoleName = assignedRole === 'cuisine'
          ? (desiredPrinterName || settings.imprimante_cuisine || settings.imprimante_caisse)
          : (settings[`imprimante_${assignedRole}`] || desiredPrinterName || settings.imprimante_cuisine || settings.imprimante_caisse);

        const resolvedPrinter = await getTargetPrinter(targetPrinterRoleName, mainWindow, assignedRole);
        const physicalPrinterName = resolvedPrinter ? resolvedPrinter.name : 'DEFAULT_PRINTER';

        if (!itemsByPrinterName[physicalPrinterName]) {
          itemsByPrinterName[physicalPrinterName] = {
            printerName: resolvedPrinter ? resolvedPrinter.name : targetPrinterRoleName,
            role: assignedRole,
            items: []
          };
        }
        itemsByPrinterName[physicalPrinterName].items.push(item);
      }

      const printedPrinters = [];
      const failedPrinters = [];

      for (const [physName, groupInfo] of Object.entries(itemsByPrinterName)) {
        if (!groupInfo.items || groupInfo.items.length === 0) continue;

        const groupOrderData = {
          ...orderData,
          items: groupInfo.items
        };

        try {
          const res = await PrinterManager._printSingleWindow(groupOrderData, groupInfo.printerName, mainWindow, groupInfo.role);
          if (res.success) printedPrinters.push(physName);
          else failedPrinters.push(physName);
        } catch (e) {
          failedPrinters.push(physName);
        }
      }

      return {
        success: failedPrinters.length === 0,
        printedGroups: printedPrinters,
        failedGroups: failedPrinters
      };
    }

    if (isKitchen && items.length === 0) {
      return { success: true, message: 'SKIPPED_EMPTY_KITCHEN_ORDER' };
    }

    return await PrinterManager._printSingleWindow(orderData, desiredPrinterName, mainWindow);
  },

  async _printSingleWindow(orderData, desiredPrinterName, mainWindow, forcedRole = null) {
    const settings = readSettingsFile();
    const widthMm = settings.receipt_width || '72';
    const rawType = String(orderData.orderType || orderData.type || '').toUpperCase();
    const isKitchen = rawType.includes('CUISINE');
    
    const isReport = rawType.includes('RAPPORT') || 
                     rawType === 'Z' || 
                     rawType === 'X' || 
                     orderData.totalSales !== undefined || 
                     orderData.sessionId !== undefined;

    // Clôture livreur (nouveau format type DRIVER_SETTLEMENT, ou ancien format avec un titre "... LIVREUR")
    const isDriverSettlement = orderData.type === 'DRIVER_SETTLEMENT' || String(orderData.title || '').toUpperCase().includes('LIVREUR');

    const role = forcedRole || ((isReport || isDriverSettlement) ? 'rapports' : (isKitchen ? 'cuisine' : 'caisse'));

    let htmlContent = '';
    if (isDriverSettlement) {
      htmlContent = buildDriverSettlementHtml(orderData, widthMm);
    } else if (isReport) {
      htmlContent = buildZReportHtml(orderData, widthMm);
    } else if (isKitchen) {
      htmlContent = buildKitchenHtml(orderData, widthMm);
    } else {
      htmlContent = await buildReceiptHtml(orderData, widthMm);
    }

    const isTestOrder = String(orderData.orderNumber || '').toUpperCase().includes('TEST');
    let copiesCount = 1;
    if (!isReport && !isDriverSettlement && !isTestOrder) {
      const rawCopies = isKitchen ? settings.receipt_copies_kitchen : settings.receipt_copies_client;
      copiesCount = Math.max(1, Math.min(5, Number(rawCopies) || 1));
    }

    // Ticket client d'une livraison : sur l'imprimante livraison si elle est réglée
    const isDeliveryTicket = !isKitchen && !isReport && !isDriverSettlement && rawType.includes('LIVRAISON');
    const deliveryPrinterName = isDeliveryTicket ? String(settings.imprimante_livraison || '').trim() : '';
    const targetPrinter = deliveryPrinterName
      ? ((await getTargetPrinter(deliveryPrinterName, mainWindow, 'livraison')) || (await getTargetPrinter(desiredPrinterName, mainWindow, role)))
      : await getTargetPrinter(desiredPrinterName, mainWindow, role);
    const deviceName = targetPrinter ? targetPrinter.name : '';

    const runSinglePrintJob = () => new Promise(async (resolve) => {
      try {
        let printWindow = new BrowserWindow({ 
          show: false, 
          webPreferences: { 
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true
          } 
        });

        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        try {
          await printWindow.webContents.executeJavaScript(`
            Promise.all(
              Array.from(document.images).map(img => {
                if (img.complete) return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
                return new Promise(res => { img.onload = res; img.onerror = res; });
              })
            )
          `);
        } catch (e) {}

        printWindow.shadowWindow = printWindow;

        // Pilote qui ne répond jamais : on ferme la fenêtre cachée au bout de 30 s
        // (sinon elle garde l'application ouverte en arrière-plan)
        let settled = false;
        const watchdog = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); } catch (e) {}
          printWindow = null;
          resolve({ success: false, error: "Délai dépassé (30 s) : l'imprimante ne répond pas" });
        }, 30000);

        printWindow.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: deviceName,
          margins: { marginType: 'none' }
        }, (success, failureReason) => {
          clearTimeout(watchdog);
          if (settled) return;
          settled = true;
          try {
            if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
            printWindow = null;
          } catch (e) {}

          if (!success) {
            console.error(`[PrinterManager] Erreur impression physique sur "${deviceName}":`, failureReason);
            resolve({ success: false, error: failureReason });
          } else {
            resolve({ success: true, printerName: deviceName });
          }
        });

      } catch (error) {
        console.error('[PrinterManager] Erreur IPC Print critique:', error);
        resolve({ success: false, error: error.message });
      }
    });

    // Impression directe en image (ticket net, rien de coupé), pilote Windows en secours.
    // Réglage « print_mode: driver » pour forcer l'ancien mode si une imprimante ne suit pas.
    if (process.platform === 'win32' && deviceName && !VIRTUAL_PRINTER.test(deviceName) && settings.print_mode !== 'driver') {
      try {
        const direct = await printHtmlAsImage(htmlContent, deviceName, { paperWidthMm: widthMm, copies: copiesCount });
        if (direct.success) return { success: true, printerName: deviceName };
        console.warn(`[PrinterManager] Impression directe impossible sur "${deviceName}", passage par le pilote :`, direct.error);
      } catch (err) {
        console.warn(`[PrinterManager] Impression directe impossible sur "${deviceName}", passage par le pilote :`, err && err.message);
      }
    }

    let lastResult = { success: false };
    for (let i = 0; i < copiesCount; i++) {
      lastResult = await runSinglePrintJob();
      if (!lastResult.success) break;
    }
    return lastResult;
  },

  async openDrawer(desiredPrinterName, mainWindow) {
    try {
      const targetPrinter = await getTargetPrinter(desiredPrinterName, mainWindow, 'caisse');
      if (!targetPrinter) return { success: false, error: "Aucune imprimante détectée." };

      const settings = readSettingsFile();
      const pinMode = settings.drawer_pin_mode || 'both';

      let kickBytes = [27, 112, 0, 25, 250, 27, 112, 1, 25, 250, 16, 20, 1, 1, 1];
      if (pinMode === '0') kickBytes = [27, 112, 0, 25, 250];
      else if (pinMode === '1') kickBytes = [27, 112, 1, 25, 250];
      else if (pinMode === 'dle') kickBytes = [16, 20, 1, 1, 1];

      if (process.platform === 'win32') {
        const kickCode = kickBytes.join(', ');
        const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, kickCode);
        return { success: isSuccess };
      } else {
        return new Promise((resolve) => {
          const kickBuffer = Buffer.from(kickBytes);
          const tempKickFile = path.join(os.tmpdir(), `kick_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
          
          try {
            fs.writeFileSync(tempKickFile, kickBuffer);
            exec(`lpr -P "${targetPrinter.name}" -o raw "${tempKickFile}"`, (err) => {
              try { fs.unlinkSync(tempKickFile); } catch (e) {}
              if (!err) {
                resolve({ success: true });
              } else {
                let kickWindow = new BrowserWindow({ 
                  show: false, 
                  webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } 
                });
                kickWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!DOCTYPE html><html><head><style>@page{margin:0;size:auto;}html,body{margin:0;padding:0;width:0;height:0;overflow:hidden;}</style></head><body></body></html>')}`);
                kickWindow.webContents.print({ silent: true, deviceName: targetPrinter.name, margins: { marginType: 'none' } }, (success) => {
                  kickWindow.destroy();
                  kickWindow = null;
                  resolve({ success });
                });
              }
            });
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        });
      }
    } catch (error) {
      console.error("[PrinterManager] Erreur Open Drawer:", error);
      return { success: false, error: error.message };
    }
  },

  async cutPaper(desiredPrinterName, mainWindow) {
    const targetPrinter = await getTargetPrinter(desiredPrinterName, mainWindow, 'caisse');
    if (!targetPrinter || process.platform !== 'win32') return { success: false };
    const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, "29, 86, 66, 0");
    return { success: isSuccess };
  },

  async checkPrinterStatus(mainWindow) {
    const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { ready: false };
    const printers = await win.webContents.getPrintersAsync();
    const targetPrinter = await getTargetPrinter(null, mainWindow, 'caisse');
    
    return {
      ready: !!targetPrinter && targetPrinter.status !== 1,
      printerName: targetPrinter ? targetPrinter.name : null,
      isDefault: targetPrinter ? targetPrinter.isDefault : false,
      printersCount: printers.length
    };
  },

  getTargetPrinter
};

export default PrinterManager;
export { PrinterManager };export { buildReceiptHtml };
