// electron/printing/PrinterManager.js
const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

async function getTargetPrinter(desiredPrinterName, mainWindow) {
  if (!mainWindow) return null;
  const printers = await mainWindow.webContents.getPrintersAsync();
  
  if (desiredPrinterName) {
    const specificPrinter = printers.find(p => p.name === desiredPrinterName);
    if (specificPrinter) return specificPrinter;
  }

  const settings = readSettingsFile();
  const configuredName = settings.imprimante_caisse || settings.imprimante_cuisine;
  if (configuredName) {
    const configuredPrinter = printers.find(p => p.name === configuredName);
    if (configuredPrinter) return configuredPrinter;
  }

  let targetPrinter = printers.find(p => p.isDefault);
  if (!targetPrinter) targetPrinter = printers.find(p => p.name.toLowerCase().includes('tm') || p.name.toLowerCase().includes('epson'));
  if (!targetPrinter && printers.length > 0) targetPrinter = printers[0];
  
  return targetPrinter;
}

function sendRawCommandToPrinter(printerName, byteString) {
  if (process.platform !== 'win32') return Promise.resolve(false);

  const safePrinterName = String(printerName || '').replace(/"/g, '`"');
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const scriptPath = path.join(os.tmpdir(), `raw_printer_${uniqueId}.ps1`);

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
[RawPrinterHelper]::SendBytesToPrinter("${safePrinterName}", [byte[]](${byteString}))
`;

  try {
    fs.writeFileSync(scriptPath, psScript, 'utf8');
  } catch (e) {
    console.error("[PrinterManager] Erreur écriture fichier temporaire PS:", e);
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    exec(`powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`, (error, stdout) => {
      // Nettoyage immédiat du fichier temporaire pour éviter toute race condition
      fs.unlink(scriptPath, () => {});
      const output = stdout.trim().toLowerCase();
      const isSuccess = !error && output === 'true';
      resolve(isSuccess);
    });
  });
}

function buildReceiptHtml(orderData, widthMm = '72') {
  const is58mm = Number(widthMm) <= 60;
  const bodyWidth = `${widthMm}mm`;
  const fontSize = is58mm ? '11px' : '13px';
  const headerFontSize = is58mm ? '16px' : '18px';

  const restaurantName = escapeHtml(orderData.restaurantName || 'VOTRE RESTAURANT');
  const restaurantAddress = escapeHtml(orderData.restaurantAddress || '');
  const restaurantPhone = escapeHtml(orderData.restaurantPhone || '');
  
  const orderNumber = escapeHtml(orderData.orderNumber || '001');
  const orderDate = escapeHtml(orderData.orderDate || new Date().toLocaleString('fr-FR'));
  
  let orderTypeLabel = 'SUR PLACE';
  const rawType = String(orderData.orderType || '').toLowerCase();
  if (rawType.includes('emporte') || rawType.includes('takeaway')) orderTypeLabel = 'A EMPORTER';
  if (rawType.includes('livraison') || rawType.includes('delivery')) orderTypeLabel = 'LIVRAISON';

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  const total = Number(orderData.total || 0).toFixed(2);

  const itemsHtml = items.map(item => {
    const qty = Number(item.qty || item.quantity || 1);
    const name = escapeHtml(item.name || item.product?.name || 'Article');
    const unitPrice = Number(item.unitPrice || item.price || 0);
    const itemTotal = (qty * unitPrice).toFixed(2);
    
    let notesHtml = '';
    const notes = Array.isArray(item.notes) ? item.notes : (Array.isArray(item.options) ? item.options : []);
    if (notes.length > 0) {
      notesHtml = notes.map(n => {
        const noteName = typeof n === 'string' ? n : (n.name || '');
        const isSans = typeof n === 'object' && n.isSans;
        const style = isSans ? 'color: red; font-weight: bold;' : 'color: #333;';
        return `<div style="padding-left: 12px; font-size: 11px; ${style}">- ${escapeHtml(noteName)}</div>`;
      }).join('');
    }

    return `
      <div style="margin-bottom: 4px;">
        <div style="display: flex; justify-content: space-between; font-weight: bold;">
          <span style="max-width: 75%; word-break: break-word;">${qty}x ${name}</span>
          <span>${itemTotal} €</span>
        </div>
        ${notesHtml}
      </div>
    `;
  }).join('');

  let deliveryBlockHtml = '';
  if (orderTypeLabel === 'LIVRAISON' && orderData.delivery) {
    const d = orderData.delivery;
    const name = escapeHtml(d.customerName || d.name || '');
    const address = escapeHtml(d.address || '');
    const phone = escapeHtml(d.phone || '');
    const notes = escapeHtml(d.deliveryNotes || d.notes || '');

    deliveryBlockHtml = `
      <div class="delivery-block" style="background-color: black; color: white; font-weight: bold; padding: 6px 8px; margin: 8px 0; border-radius: 2px; -webkit-print-color-adjust: exact;">
        <div style="text-align: center; border-bottom: 1px solid white; padding-bottom: 3px; margin-bottom: 4px; font-size: 12px; text-transform: uppercase;">
          *** FICHE LIVRAISON ***
        </div>
        ${name ? `<div><span style="font-size: 9px; opacity: 0.8;">CLIENT:</span> ${name}</div>` : ''}
        ${address ? `<div style="margin-top: 2px;"><span style="font-size: 9px; opacity: 0.8;">ADRESSE:</span> ${address}</div>` : ''}
        ${phone ? `<div style="margin-top: 2px;"><span style="font-size: 9px; opacity: 0.8;">TÉL:</span> ${phone}</div>` : ''}
        ${notes ? `<div style="margin-top: 2px;"><span style="font-size: 9px; opacity: 0.8;">NOTE:</span> ${notes}</div>` : ''}
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: monospace; font-size: ${fontSize}; margin: 0; padding: 6px; width: ${bodyWidth}; color: black; line-height: 1.2; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          hr { border: none; border-top: 1px dashed black; margin: 6px 0; }
        </style>
      </head>
      <body>
        <div className="center">
          <div style="font-size: ${headerFontSize}; font-weight: 900; text-transform: uppercase;">${restaurantName}</div>
          ${restaurantAddress ? `<div style="font-size: 11px;">${restaurantAddress}</div>` : ''}
          ${restaurantPhone ? `<div style="font-size: 11px;">Tél: ${restaurantPhone}</div>` : ''}
        </div>

        <hr />

        <div className="center">
          <div style="font-size: 16px; font-weight: 900;">CMD #${orderNumber}</div>
          <div style="font-size: 11px;">${orderDate}</div>
          <div style="font-size: 13px; font-weight: bold; margin-top: 2px;">*** ${orderTypeLabel} ***</div>
        </div>

        <hr />

        <div>${itemsHtml}</div>

        ${deliveryBlockHtml}

        <hr />

        <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 900; margin: 4px 0;">
          <span>TOTAL TTC</span>
          <span>${total} €</span>
        </div>

        <hr />

        <div className="center" style="font-size: 11px; margin-top: 8px;">
          Merci de votre visite !<br>A bientôt.
        </div>
      </body>
    </html>
  `;
}

const PrinterManager = {
  async printReceipt(orderData, desiredPrinterName, mainWindow) {
    if (typeof orderData !== 'object' || orderData === null) {
      console.error('[PrinterManager] printReceipt exige des données de commande structurées, type reçu:', typeof orderData);
      return { success: false, error: 'INVALID_ORDER_DATA_FORMAT' };
    }

    const settings = readSettingsFile();
    const widthMm = settings.receipt_width || '72';
    const htmlContent = buildReceiptHtml(orderData, widthMm);

    return new Promise(async (resolve) => {
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

        const targetPrinter = await getTargetPrinter(desiredPrinterName, mainWindow);
        const deviceName = targetPrinter ? targetPrinter.name : '';

        printWindow.shadowWindow = printWindow;

        printWindow.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: deviceName,
          margins: { marginType: 'none' }
        }, async (success, failureReason) => {
          printWindow.destroy();
          printWindow = null;

          if (!success) {
            console.error("[PrinterManager] Erreur d'impression physique:", failureReason);
            resolve({ success: false, error: failureReason });
          } else {
            if (targetPrinter && process.platform === 'win32') {
              await sendRawCommandToPrinter(targetPrinter.name, "29, 86, 66, 0");
            }
            resolve({ success: true });
          }
        });

      } catch (error) {
        console.error('[PrinterManager] Erreur IPC Print critique:', error);
        resolve({ success: false, error: error.message });
      }
    });
  },

  async openDrawer(desiredPrinterName, mainWindow) {
    try {
      const targetPrinter = await getTargetPrinter(desiredPrinterName, mainWindow);
      if (!targetPrinter) return { success: false, error: "Aucune imprimante détectée." };

      if (process.platform === 'win32') {
        const kickCode = "27, 112, 0, 25, 250, 27, 112, 1, 25, 250";
        const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, kickCode);
        return { success: isSuccess };
      } else {
        let kickWindow = new BrowserWindow({ 
          show: false, 
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } 
        });
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
      console.error("[PrinterManager] Erreur Open Drawer:", error);
      return { success: false, error: error.message };
    }
  },

  async cutPaper(desiredPrinterName, mainWindow) {
    const targetPrinter = await getTargetPrinter(desiredPrinterName, mainWindow);
    if (!targetPrinter || process.platform !== 'win32') return { success: false };
    const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, "29, 86, 66, 0");
    return { success: isSuccess };
  },

  async checkPrinterStatus(mainWindow) {
    if (!mainWindow) return { ready: false };
    const printers = await mainWindow.webContents.getPrintersAsync();
    const settings = readSettingsFile();
    const configuredName = settings.imprimante_caisse || settings.imprimante_cuisine;
    const targetPrinter = printers.find(p => configuredName ? p.name === configuredName : (p.isDefault || p.name.toLowerCase().includes('tm') || p.name.toLowerCase().includes('epson')));
    
    return {
      ready: !!targetPrinter && targetPrinter.status !== 1,
      printerName: targetPrinter ? targetPrinter.name : null,
      isDefault: targetPrinter ? targetPrinter.isDefault : false,
      printersCount: printers.length
    };
  },

  getTargetPrinter
};

module.exports = PrinterManager;
