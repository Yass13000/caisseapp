import electron from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import { exec } from 'child_process';
import QRCode from 'qrcode';

const { BrowserWindow, app } = electron;

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

async function getCachedLogoDataUrl(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return '';

  const cacheDir = app.getPath('userData');
  const logoPath = path.join(cacheDir, 'logo-cache.png');
  const metaPath = path.join(cacheDir, 'logo-cache-meta.json');

  let cachedUrl = '';
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      cachedUrl = meta.url || '';
    }
  } catch (e) {}

  if (cachedUrl === logoUrl && fs.existsSync(logoPath)) {
    try {
      const buf = fs.readFileSync(logoPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (e) {}
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
      if (cachedUrl === logoUrl && fs.existsSync(logoPath)) {
        try {
          const buf = fs.readFileSync(logoPath);
          safeResolve(`data:image/png;base64,${buf.toString('base64')}`);
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
      res.on('error', (err) => {
        console.warn("[PrinterManager] Erreur réseau logo (res):", err?.message);
        fallbackResolve();
      });

      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      const isValidType = contentType.includes('image/png') || contentType.includes('image/jpeg') || contentType.includes('image/jpg');

      if (res.statusCode !== 200 || !isValidType) {
        res.destroy();
        fallbackResolve();
        return;
      }

      const data = [];
      let totalBytes = 0;
      const MAX_BYTES = 2 * 1024 * 1024;

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

          if (!isPng && !isJpeg) {
            fallbackResolve();
            return;
          }

          fs.writeFileSync(logoPath, buffer);
          fs.writeFileSync(metaPath, JSON.stringify({ url: logoUrl, date: new Date().toISOString() }), 'utf8');
          safeResolve(`data:image/png;base64,${buffer.toString('base64')}`);
        } catch (e) {
          fallbackResolve();
        }
      });
    });

    req.on('error', (err) => {
      console.warn("[PrinterManager] Erreur réseau requète logo (req):", err?.message);
      fallbackResolve();
    });
  });
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
      fs.unlink(scriptPath, () => {});
      const output = stdout.trim().toLowerCase();
      const isSuccess = !error && output === 'true';
      resolve(isSuccess);
    });
  });
}

async function buildReceiptHtml(orderData, widthMm = '72') {
  const settings = readSettingsFile();

  const is58mm = Number(widthMm) <= 60;
  const bodyWidth = `${widthMm}mm`;
  
  let fontSize = is58mm ? '11px' : '13px';
  let headerFontSize = is58mm ? '16px' : '18px';
  if (settings.receipt_font_size === 'small') {
    fontSize = '10px'; headerFontSize = '14px';
  } else if (settings.receipt_font_size === 'large') {
    fontSize = '14px'; headerFontSize = '20px';
  }

  const bodyPadding = settings.receipt_margin_type === 'standard' ? '12px 8px' : '4px 2px';

  const showHeaderInfo = settings.show_header_info !== 'false';
  const showTaxDetails = settings.show_tax_details === 'true';
  const showFooterMessage = settings.show_footer_message !== 'false';
  const footerMessage = escapeHtml(settings.footer_custom_message || 'Merci de votre visite !\nA bientôt.');
  const showQrCode = settings.show_qr_code === 'true';
  const isKitchenTicket = String(orderData.orderType || '').toUpperCase().includes('CUISINE');
  const kitchenShowPrices = settings.kitchen_show_prices !== 'false';

  const logoDataUrl = (!isKitchenTicket && orderData.restaurantLogoUrl) 
    ? await getCachedLogoDataUrl(orderData.restaurantLogoUrl) 
    : '';
  const logoHtml = logoDataUrl 
    ? `<div style="text-align: center; margin-bottom: 6px;"><img src="${logoDataUrl}" style="max-width: 60%; max-height: 80px; filter: grayscale(100%);" /></div>` 
    : '';

  const restaurantName = escapeHtml(orderData.restaurantName || 'VOTRE RESTAURANT');
  const restaurantAddress = escapeHtml(orderData.restaurantAddress || '');
  const restaurantPhone = escapeHtml(orderData.restaurantPhone || '');
  
  const orderNumber = escapeHtml(orderData.orderNumber || '001');
  const orderDate = escapeHtml(orderData.orderDate || new Date().toLocaleString('fr-FR'));
  
  let orderTypeLabel = 'SUR PLACE';
  const rawType = String(orderData.orderType || '').toLowerCase();
  if (rawType.includes('emporte') || rawType.includes('takeaway')) orderTypeLabel = 'A EMPORTER';
  if (rawType.includes('livraison') || rawType.includes('delivery')) orderTypeLabel = 'LIVRAISON';
  if (isKitchenTicket) orderTypeLabel = escapeHtml(orderData.orderType);

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  const totalNum = Number(orderData.total || 0);
  const total = totalNum.toFixed(2);

  const hidePriceOnKitchen = isKitchenTicket && !kitchenShowPrices;

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
          ${hidePriceOnKitchen ? '' : `<span>${itemTotal} €</span>`}
        </div>
        ${notesHtml}
      </div>
    `;
  }).join('');

  let deliveryBlockHtml = '';
  if (orderTypeLabel.includes('LIVRAISON') && orderData.delivery) {
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

  let taxDetailsHtml = '';
  if (showTaxDetails && totalNum > 0) {
    const ht = (totalNum / 1.1).toFixed(2);
    const tva = (totalNum - totalNum / 1.1).toFixed(2);
    taxDetailsHtml = `
      <div style="font-size: 10px; margin-top: 4px;">
        <div style="display: flex; justify-content: space-between;"><span>Sous-total HT:</span><span>${ht} €</span></div>
        <div style="display: flex; justify-content: space-between;"><span>TVA (10%):</span><span>${tva} €</span></div>
      </div>
    `;
  }

  let qrCodeHtml = '';
  if (showQrCode) {
    let qrUrl = settings.qr_code_custom_url || 'https://google.com';
    if (settings.qr_code_type === 'tracking') qrUrl = `https://caisseapp.vercel.app/#/track/${orderNumber}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 110 });
      qrCodeHtml = `
        <div style="text-align: center; margin-top: 10px;">
          <img src="${qrDataUrl}" style="width: 100px; height: 100px;" />
        </div>
      `;
    } catch (e) {
      console.error("[PrinterManager] Erreur génération QR local:", e);
    }
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: monospace; font-size: ${fontSize}; margin: 0; padding: ${bodyPadding}; width: ${bodyWidth}; color: black; line-height: 1.2; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          hr { border: none; border-top: 1px dashed black; margin: 6px 0; }
        </style>
      </head>
      <body>
        ${logoHtml}

        <div class="center">
          <div style="font-size: ${headerFontSize}; font-weight: 900; text-transform: uppercase;">${restaurantName}</div>
          ${showHeaderInfo && restaurantAddress ? `<div style="font-size: 11px;">${restaurantAddress}</div>` : ''}
          ${showHeaderInfo && restaurantPhone ? `<div style="font-size: 11px;">Tél: ${restaurantPhone}</div>` : ''}
        </div>

        <hr />

        <div class="center">
          <div style="font-size: 16px; font-weight: 900;">CMD #${orderNumber}</div>
          <div style="font-size: 11px;">${orderDate}</div>
          <div style="font-size: 13px; font-weight: bold; margin-top: 2px;">*** ${orderTypeLabel} ***</div>
        </div>

        <hr />

        <div>${itemsHtml}</div>

        ${deliveryBlockHtml}

        ${hidePriceOnKitchen ? '' : `
          <hr />
          ${taxDetailsHtml}
          <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 900; margin: 4px 0;">
            <span>TOTAL TTC</span>
            <span>${total} €</span>
          </div>
        `}

        ${(showFooterMessage || showQrCode) ? '<hr />' : ''}

        ${showFooterMessage ? `
          <div class="center" style="font-size: 11px; margin-top: 6px; white-space: pre-wrap;">
            ${footerMessage}
          </div>
        ` : ''}

        ${qrCodeHtml}
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
    const isKitchen = String(orderData.orderType || '').toUpperCase().includes('CUISINE');
    let routingConfig = {};
    try {
      if (settings.category_printer_routing) {
        routingConfig = typeof settings.category_printer_routing === 'string'
          ? JSON.parse(settings.category_printer_routing)
          : settings.category_printer_routing;
      }
    } catch (e) {}

    if (isKitchen && routingConfig && Object.keys(routingConfig).length > 0 && Array.isArray(orderData.items)) {
      const itemsByPrinterName = {};

      for (const item of orderData.items) {
        const cat = String(item.categoryName || item.category || '').trim();
        const assignedRole = cat && routingConfig[cat] ? routingConfig[cat] : null;
        
        let targetPrinterRoleName = undefined;
        if (assignedRole) {
          targetPrinterRoleName = settings[`imprimante_${assignedRole}`] || settings.imprimante_cuisine;
        } else {
          targetPrinterRoleName = desiredPrinterName || settings.imprimante_cuisine;
        }

        const resolvedPrinter = await getTargetPrinter(targetPrinterRoleName, mainWindow);
        const physicalPrinterName = resolvedPrinter ? resolvedPrinter.name : 'DEFAULT_PRINTER';

        if (!itemsByPrinterName[physicalPrinterName]) {
          itemsByPrinterName[physicalPrinterName] = {
            printerObj: resolvedPrinter,
            printerName: targetPrinterRoleName,
            items: []
          };
        }
        itemsByPrinterName[physicalPrinterName].items.push(item);
      }

      const printedPrinters = [];
      const failedPrinters = [];

      for (const [physName, groupInfo] of Object.entries(itemsByPrinterName)) {
        const groupOrderData = {
          ...orderData,
          items: groupInfo.items
        };

        try {
          const res = await PrinterManager._printSingleWindow(groupOrderData, groupInfo.printerName, mainWindow);
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

    return await PrinterManager._printSingleWindow(orderData, desiredPrinterName, mainWindow);
  },

  async _printSingleWindow(orderData, desiredPrinterName, mainWindow) {
    const settings = readSettingsFile();
    const widthMm = settings.receipt_width || '72';
    const htmlContent = await buildReceiptHtml(orderData, widthMm);

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
        const settings = readSettingsFile();
        const pinMode = settings.drawer_pin_mode || 'both';

        let kickCode = "27, 112, 0, 25, 250, 27, 112, 1, 25, 250";
        if (pinMode === '0') kickCode = "27, 112, 0, 25, 250";
        else if (pinMode === '1') kickCode = "27, 112, 1, 25, 250";

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

export default PrinterManager;
export { PrinterManager };