// @ts-nocheck
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

async function getTargetPrinter(desiredPrinterName, mainWindow) {
  const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  const printers = await win.webContents.getPrintersAsync();
  
  if (desiredPrinterName && typeof desiredPrinterName === 'string' && desiredPrinterName.trim() !== '') {
    const specificPrinter = printers.find(p => p.name === desiredPrinterName);
    if (specificPrinter) return specificPrinter;
  }

  const settings = readSettingsFile();
  const configuredName = settings.imprimante_caisse || settings.imprimante_cuisine;
  if (configuredName && typeof configuredName === 'string' && configuredName.trim() !== '') {
    const configuredPrinter = printers.find(p => p.name === configuredName);
    if (configuredPrinter) return configuredPrinter;
  }

  let targetPrinter = printers.find(p => p.isDefault);
  if (!targetPrinter) targetPrinter = printers.find(p => p.name.toLowerCase().includes('tm') || p.name.toLowerCase().includes('epson'));
  if (!targetPrinter && printers.length > 0) targetPrinter = printers[0];
  
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

// ----------------------------------------------------------------------------
// 👨‍🍳 TICKET CUISINE (OPTIMISÉ VISIBILITÉ + RÈGLES KDS 100%)
// ----------------------------------------------------------------------------
function buildKitchenHtml(orderData, widthMm = '72') {
  const settings = readSettingsFile();
  const bodyWidth = `${widthMm}mm`;

  // 🎛️ Nouveaux réglages de visibilité (avec valeurs par défaut optimales)
  const fontScale = settings.kitchen_font_scale || 'normal'; // 'normal' | 'large' | 'xlarge'
  const invertedHeader = settings.kitchen_inverted_header !== 'false' && settings.kitchen_inverted_header !== false;
  const highlightMultiQty = settings.highlight_multi_qty !== 'false' && settings.highlight_multi_qty !== false;

  let itemFontSize = '16px';
  let noteFontSize = '14px';
  if (fontScale === 'large') {
    itemFontSize = '18px';
    noteFontSize = '16px';
  } else if (fontScale === 'xlarge') {
    itemFontSize = '20px';
    noteFontSize = '18px';
  }
  
  let orderNumDisplay = String(orderData.orderNumber || orderData.order_number || orderData.number || '001')
    .toUpperCase()
    .replace(/^CMD\s*#?/i, '')
    .trim();

  let orderTime = '';
  if (orderData.orderDate) {
    const parts = String(orderData.orderDate).split(' ');
    orderTime = parts.length > 1 ? parts[1].substring(0, 5) : parts[0].substring(0, 5);
  }
  if (!orderTime) {
    const d = new Date();
    orderTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  let orderTypeLabel = 'SUR PLACE';
  const rawType = String(orderData.orderType || '').toLowerCase();
  if (rawType.includes('emporte') || rawType.includes('takeaway')) orderTypeLabel = 'À EMPORTER';
  if (rawType.includes('livraison') || rawType.includes('delivery')) orderTypeLabel = 'LIVRAISON';

  const items = Array.isArray(orderData.items) ? orderData.items : [];

  // 🟢 1. Tri des produits selon kds_sort_order
  const sortedItems = [...items].sort((a, b) => {
    const orderA = Number(a.kds_sort_order ?? a.product?.kds_sort_order ?? a.sort_order ?? a.product?.sort_order ?? 999);
    const orderB = Number(b.kds_sort_order ?? b.product?.kds_sort_order ?? b.sort_order ?? b.product?.sort_order ?? 999);
    return orderA - orderB;
  });

  // Fonction utilitaire pour extraire name_kds en priorité absolue (sur produit ou option)
  const getKdsOrDefaultName = (obj, fallback = '') => {
    if (!obj) return fallback;
    if (typeof obj === 'string') return obj.trim() || fallback;

    const kdsCandidate = 
      obj.name_kds ?? 
      obj.kds_name ?? 
      obj.option?.name_kds ?? 
      obj.option?.kds_name ?? 
      obj.sub_option?.name_kds ?? 
      obj.subOption?.name_kds ?? 
      obj.product?.name_kds ?? 
      obj.product?.kds_name ??
      obj.item?.name_kds;

    if (kdsCandidate !== null && kdsCandidate !== undefined && String(kdsCandidate).trim() !== '') {
      return String(kdsCandidate).trim();
    }

    const nameCandidate = 
      obj.name ?? 
      obj.option?.name ?? 
      obj.sub_option?.name ?? 
      obj.subOption?.name ?? 
      obj.product?.name ?? 
      obj.item?.name ?? 
      obj.label;

    if (nameCandidate !== null && nameCandidate !== undefined && String(nameCandidate).trim() !== '') {
      return String(nameCandidate).trim();
    }

    return fallback;
  };

  let totalItemsCount = 0;

  const itemsHtml = sortedItems.map((item, idx) => {
    const qty = Number(item.qty || item.quantity || 1);
    totalItemsCount += qty;
    
    // Détection du mode solo
    const isSolo = item.isSolo === true || item.is_solo === true || item.product?.isSolo === true || /\bseul\b/i.test(item.name || item.product?.name || '');

    // 🟢 2. Priorité au nom KDS + suffixe Seul
    const baseName = getKdsOrDefaultName(item, 'Article');
    
    let finalDisplayName = baseName;
    if (isSolo && !/\bseul\b/i.test(finalDisplayName)) {
      finalDisplayName = `${finalDisplayName.replace(/^menu\s+/i, '').trim()} Seul`;
    }
    const name = escapeHtml(finalDisplayName).toUpperCase();

    let notesHtml = '';
    
    // 🟢 3. Priorité aux tableaux d'objets complets (options / selectedSubOptions) plutôt que des strings (notes)
    const candidates = [item.options, item.selectedSubOptions, item.sub_options, item.notes].filter(arr => Array.isArray(arr) && arr.length > 0);
    const rawNotes = candidates.find(arr => typeof arr[0] === 'object' && arr[0] !== null) || candidates[0] || [];
    
    // 🟢 4. Filtrage strict des options hide_if_solo si l'article est en mode solo
    const filteredNotes = rawNotes.filter(n => {
      if (!n) return false;
      if (isSolo && (n.hide_if_solo === true || n.is_hide_if_solo === true || n.group_hide_if_solo === true || n.option?.hide_if_solo === true)) {
        return false;
      }
      return true;
    });

    if (filteredNotes.length > 0) {
      notesHtml = filteredNotes.map(n => {
        const noteName = getKdsOrDefaultName(n, '');
        if (!noteName) return '';

        const isSans = (typeof n === 'object' && (n.isSans || n.is_sans)) || String(noteName).trim().toUpperCase().startsWith('SANS ');
        
        // 🚨 Mise en valeur nette des "SANS" avec encadré pointillé + préfixe [X]
        if (isSans) {
          return `
            <div style="font-size: ${noteFontSize}; font-weight: 900; text-transform: uppercase; margin-top: 4px; padding: 2px 6px; color: #000; border: 2px dashed #000; display: inline-block; width: 100%;">
              [X] ${escapeHtml(noteName)}
            </div>
          `;
        }

        return `
          <div style="font-size: ${noteFontSize}; font-weight: 800; text-transform: uppercase; margin-top: 3px; padding-left: 6px; color: #000;">
            • ${escapeHtml(noteName)}
          </div>
        `;
      }).join('');
    }

    // 🚨 Badge visuel fort si quantité > 1 pour éviter les oublis en plein rush
    let qtyBadgeHtml = `${qty}X`;
    if (highlightMultiQty && qty > 1) {
      if (invertedHeader) {
        qtyBadgeHtml = `<span style="background-color: #fff; color: #000; padding: 1px 6px; margin-right: 4px; font-size: calc(${itemFontSize} + 2px); font-weight: 900; border-radius: 2px; -webkit-print-color-adjust: exact;">${qty}X</span>`;
      } else {
        qtyBadgeHtml = `<span style="background-color: #000; color: #fff; padding: 1px 6px; margin-right: 4px; font-size: calc(${itemFontSize} + 2px); font-weight: 900; border-radius: 2px; -webkit-print-color-adjust: exact;">${qty}X</span>`;
      }
    }

    const headerStyle = invertedHeader
      ? `background-color: #000; color: #fff; font-weight: 900; font-size: ${itemFontSize}; padding: 6px 8px; text-transform: uppercase; letter-spacing: 0.5px; -webkit-print-color-adjust: exact;`
      : `background-color: #fff; color: #000; border: 3px solid #000; font-weight: 900; font-size: ${itemFontSize}; padding: 5px 8px; text-transform: uppercase; letter-spacing: 0.5px;`;

    // Séparateur pointillé entre chaque produit pour bien isoler les sandwichs/menus
    const separatorStyle = idx < sortedItems.length - 1 ? 'border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 10px;' : 'margin-bottom: 6px;';

    return `
      <div style="${separatorStyle}">
        <div style="${headerStyle}">
          ${qtyBadgeHtml} ${name}
        </div>
        <div style="margin-top: 2px;">${notesHtml}</div>
      </div>
    `;
  }).join('');

  // 🟢 5. Affichage du client, de la note encadrée et du compteur total d'articles
  const customerName = escapeHtml(orderData.customer_name || orderData.customerName || (orderData.delivery && orderData.delivery.customerName) || '');
  const comment = escapeHtml(orderData.comment || orderData.notes || (orderData.delivery && orderData.delivery.deliveryNotes) || '');

  let footerHtml = `
    <div style="border-top: 3px solid #000; margin-top: 8px; padding-top: 6px; display: flex; justify-content: space-between; font-size: 15px; font-weight: 900;">
      <span>TOTAL ARTICLES :</span>
      <span style="font-size: 18px;">${totalItemsCount}</span>
    </div>
  `;

  if (customerName || comment) {
    footerHtml += `
      <div style="border: 2px solid #000; margin-top: 8px; padding: 6px; font-size: 14px; font-weight: 900; text-transform: uppercase;">
        ${customerName ? `<div style="margin-bottom: ${comment ? '4px' : '0'};">👤 CLIENT : ${customerName}</div>` : ''}
        ${comment ? `<div style="border-top: ${customerName ? '1px dashed #000' : 'none'}; padding-top: ${customerName ? '4px' : '0'};">⚠️ NOTE : ${comment}</div>` : ''}
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { margin: 0; size: auto; }
          * { box-sizing: border-box; }
          html, body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 4px; width: ${bodyWidth}; height: auto; overflow: hidden; color: #000; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .center { text-align: center; }
        </style>
      </head>
      <body>
        <div style="background-color: #000; color: #fff; text-align: center; font-size: 36px; font-weight: 900; padding: 6px 0; letter-spacing: 1px; -webkit-print-color-adjust: exact;">
          ${orderNumDisplay}
        </div>

        <div style="border: 3px solid #000; border-top: none; padding: 6px 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 900;">${orderTime}</span>
          <span style="font-size: 18px; font-weight: 900; text-transform: uppercase; text-decoration: underline;">${orderTypeLabel}</span>
        </div>

        <div>${itemsHtml}</div>

        ${footerHtml}
      </body>
    </html>
  `;
}

// ----------------------------------------------------------------------------
// 📊 TICKET X / TICKET Z (COMPTABILITÉ CAISSE)
// ----------------------------------------------------------------------------
function buildZReportHtml(reportData, widthMm = '72') {
  const isZ = reportData.type === 'Z' || String(reportData.orderType || '').toUpperCase().includes('Z');
  const title = isZ ? 'RAPPORT Z - CLÔTURE' : 'RAPPORT X - PROVISOIRE';
  const is58mm = Number(widthMm) <= 60;
  const fontSize = is58mm ? '11px' : '12px';

  const restoName = escapeHtml(reportData.name || reportData.restaurantName || reportData.restaurant_name || 'VOTRE RESTAURANT');
  const restoAddress = reportData.restaurantAddress || reportData.address ? escapeHtml(reportData.restaurantAddress || reportData.address) : null;
  const restoPhone = reportData.restaurantPhone || reportData.phone ? escapeHtml(reportData.restaurantPhone || reportData.phone) : null;

  const totalTtc = Number(reportData.totalSales ?? reportData.total ?? 0);
  const rawTva = Number(reportData.tvaRate ?? reportData.tva ?? 10);
  const tvaRate = rawTva > 0 ? rawTva : 10;
  
  const totalHt = totalTtc / (1 + tvaRate / 100);
  const totalTva = totalTtc - totalHt;

  const cashSales = Number(reportData.totalCash || 0);
  const cardSales = Number(reportData.totalCard || 0);
  const ticketRestoSales = Number(reportData.totalTicketResto || 0);

  const openingFloat = Number(reportData.openingFloat || 0);
  const expectedCashTotal = openingFloat + cashSales;
  const actualCashCounted = Number(reportData.closingFloatActual || expectedCashTotal);
  const discrepancy = actualCashCounted - expectedCashTotal;

  const totalOrders = Number(reportData.totalOrders || 0);
  const avgBasket = totalOrders > 0 ? (totalTtc / totalOrders).toFixed(2) : '0.00';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { margin: 0; size: auto; }
          * { box-sizing: border-box; }
          html, body { 
            font-family: 'Lucida Console', Consolas, Arial, sans-serif; 
            font-size: ${fontSize}; 
            margin: 0; 
            padding: 4px; 
            width: ${widthMm}mm; 
            height: auto;
            overflow: hidden;
            color: #000; 
            line-height: 1.25; 
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .center { text-align: center; width: 100%; }
          .bold { font-weight: bold; }
          .row { display: flex; justify-content: space-between; margin: 2px 0; }
          hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
        </style>
      </head>
      <body>
        <div class="center">
          <div style="font-size: 15px; font-weight: 900; text-transform: uppercase;">${restoName}</div>
          ${restoAddress ? `<div style="font-size: 11px;">${restoAddress}</div>` : ''}
          ${restoPhone ? `<div style="font-size: 11px;">Tél: ${restoPhone}</div>` : ''}
          
          <div style="font-size: 13px; font-weight: 900; margin-top: 6px; border: 2px solid #000; padding: 4px;">
            *** ${title} ***
          </div>
          <div style="margin-top: 4px; font-size: 11px;">Session N° : ${reportData.sessionId || 'N/A'}</div>
          <div style="font-size: 11px;">Imprimé le : ${new Date().toLocaleString('fr-FR')}</div>
        </div>

        <hr />

        <div class="bold">DATES DE SESSION</div>
        <div class="row">
          <span>Ouverture :</span>
          <span>${reportData.openedAt ? new Date(reportData.openedAt).toLocaleString('fr-FR') : '-'}</span>
        </div>
        <div class="row">
          <span>Fermeture :</span>
          <span>${reportData.closedAt ? new Date(reportData.closedAt).toLocaleString('fr-FR') : 'EN COURS'}</span>
        </div>

        <hr />

        <div class="bold">CHIFFRE D'AFFAIRES</div>
        <div class="row" style="font-size: 14px; font-weight: 900;">
          <span>TOTAL TTC :</span>
          <span>${totalTtc.toFixed(2)} €</span>
        </div>
        <div class="row">
          <span>Total HT :</span>
          <span>${totalHt.toFixed(2)} €</span>
        </div>
        <div class="row">
          <span>Total TVA (${tvaRate}%) :</span>
          <span>${totalTva.toFixed(2)} €</span>
        </div>

        <hr />

        <div class="bold">VENTILATION PAIEMENTS</div>
        <div class="row">
          <span>ESPÈCES :</span>
          <span>${cashSales.toFixed(2)} €</span>
        </div>
        <div class="row">
          <span>CARTE BANCAIRE :</span>
          <span>${cardSales.toFixed(2)} €</span>
        </div>
        ${ticketRestoSales > 0 ? `
        <div class="row">
          <span>TICKETS RESTO :</span>
          <span>${ticketRestoSales.toFixed(2)} €</span>
        </div>
        ` : ''}

        <hr />

        <div class="bold">STATISTIQUES DE VENTE</div>
        <div class="row">
          <span>Nb Commandes :</span>
          <span>${totalOrders}</span>
        </div>
        <div class="row">
          <span>Panier Moyen :</span>
          <span>${avgBasket} €</span>
        </div>

        <hr />

        <div class="bold">TIROIR ESPÈCES</div>
        <div class="row">
          <span>Fond initial :</span>
          <span>${openingFloat.toFixed(2)} €</span>
        </div>
        <div class="row">
          <span>+ Ventes Espèces :</span>
          <span>${cashSales.toFixed(2)} €</span>
        </div>
        <div class="row bold">
          <span>= Théorique :</span>
          <span>${expectedCashTotal.toFixed(2)} €</span>
        </div>
        ${isZ ? `
        <div class="row">
          <span>Compté réel :</span>
          <span>${actualCashCounted.toFixed(2)} €</span>
        </div>
        <div class="row bold">
          <span>Écart de caisse :</span>
          <span>${discrepancy >= 0 ? '+' : ''}${discrepancy.toFixed(2)} €</span>
        </div>
        ` : ''}

        <hr />

        <div class="center bold" style="margin-top: 6px;">
          --- FIN DU TICKET ${reportData.type || (isZ ? 'Z' : 'X')} ---
        </div>
      </body>
    </html>
  `;
}

// ----------------------------------------------------------------------------
// 📜 TICKET CLIENT (OPTIMISÉ CONTRASTE THERMIQUE NOIR PUR + CALL NUMBER)
// ----------------------------------------------------------------------------
async function buildReceiptHtml(orderData, widthMm = '72') {
  const settings = readSettingsFile();

  const is58mm = Number(widthMm) <= 60;
  const bodyWidth = `${widthMm}mm`;
  const highlightMultiQty = settings.highlight_multi_qty !== 'false' && settings.highlight_multi_qty !== false;
  
  let fontSize = is58mm ? '11px' : '13px';
  let headerFontSize = is58mm ? '16px' : '19px';
  if (settings.receipt_font_size === 'small') {
    fontSize = '11px'; headerFontSize = '15px';
  } else if (settings.receipt_font_size === 'large') {
    fontSize = '14px'; headerFontSize = '21px';
  }

  const bodyPadding = settings.receipt_margin_type === 'standard' ? '10px 6px' : '4px 2px';

  const showHeaderInfo = settings.show_header_info !== 'false';
  const showLogo = settings.show_logo !== 'false';
  const showTaxDetails = settings.show_tax_details !== 'false';
  const showFooterMessage = settings.show_footer_message !== 'false';
  const footerMessage = escapeHtml(settings.footer_custom_message || 'Merci de votre visite !\nÀ bientôt.');
  const showQrCode = settings.show_qr_code === 'true';

  const currentRestaurantId = orderData.restaurant_id || orderData.restaurantId || settings.pos_restaurant_id;

  const logoTargetUrl = (showLogo && (orderData.restaurantLogoUrl || orderData.logo_url)) 
    ? String(orderData.restaurantLogoUrl || orderData.logo_url) 
    : '';

  const logoDataUrl = logoTargetUrl ? await getCachedLogoDataUrl(logoTargetUrl, currentRestaurantId) : '';
  
  const logoHtml = logoDataUrl 
    ? `<div style="text-align: center; width: 100%; margin-bottom: 6px;"><img src="${logoDataUrl}" style="max-width: 40%; max-height: 45px; display: block; margin: 0 auto; filter: grayscale(100%) contrast(150%);" /></div>` 
    : '';

  const restaurantName = escapeHtml(
    orderData.name || 
    orderData.restaurant_name || 
    orderData.restaurantName || 
    settings.restaurant_name || 
    'VOTRE RESTAURANT'
  );
  const restaurantAddress = escapeHtml(orderData.restaurantAddress || orderData.address || '');
  const restaurantPhone = escapeHtml(orderData.restaurantPhone || orderData.phone || '');
  
  const cleanOrderNumber = escapeHtml(
    String(orderData.order_number || orderData.orderNumber || orderData.id || '001')
      .toUpperCase()
      .replace(/^CMD\s*#?/i, '')
      .trim()
  );
  const orderDate = escapeHtml(orderData.orderDate || (orderData.created_at ? new Date(orderData.created_at).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR')));
  
  let orderTypeLabel = 'SUR PLACE';
  const rawType = String(orderData.orderType || '').toLowerCase();
  if (rawType.includes('emporte') || rawType.includes('takeaway')) orderTypeLabel = 'À EMPORTER';
  if (rawType.includes('livraison') || rawType.includes('delivery')) orderTypeLabel = 'LIVRAISON';

  const rawPayment = String(
    orderData.payment_method ?? 
    orderData.paymentMethod ?? 
    orderData.payment_mode ?? 
    'counter'
  ).trim();

  const normalizedStr = rawPayment
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let paymentLabel = 'ESPÈCES';

  if (normalizedStr === 'counter' || normalizedStr.includes('counter') || normalizedStr.includes('espece') || normalizedStr.includes('cash')) {
    paymentLabel = 'ESPÈCES';
  } else if (normalizedStr.includes('carte') || normalizedStr.includes('cb') || normalizedStr.includes('card') || normalizedStr.includes('sumup')) {
    paymentLabel = 'CARTE BANCAIRE';
  } else if (normalizedStr.includes('ticket') || normalizedStr.includes('resto')) {
    paymentLabel = 'TICKET RESTAURANT';
  } else if (normalizedStr.includes('attente') || normalizedStr.includes('pending')) {
    paymentLabel = 'EN ATTENTE';
  } else if (rawPayment !== '') {
    paymentLabel = escapeHtml(rawPayment.toUpperCase());
  }

  const items = Array.isArray(orderData.items) ? orderData.items : (Array.isArray(orderData.order_details) ? orderData.order_details : []);
  const totalNum = Number(orderData.total_price ?? orderData.total ?? 0);
  const total = totalNum.toFixed(2);

  const itemsHtml = items.map(item => {
    const qty = Number(item.qty || item.quantity || 1);
    const name = escapeHtml(item.name || item.product?.name || 'Article');
    let baseUnitPrice = Number(item.unitPrice || item.price || 0);
    
    let optionsTotalPrice = 0;
    let notesHtml = '';
    const notes = Array.isArray(item.notes) ? item.notes : (Array.isArray(item.options) ? item.options : (Array.isArray(item.selectedSubOptions) ? item.selectedSubOptions : []));
    
    if (notes.length > 0) {
      notesHtml = notes.map(n => {
        const noteName = typeof n === 'string' ? n : (n.name || n.name_kds || n.kds_name || '');
        if (!noteName) return '';
        const isSans = (typeof n === 'object' && (n.isSans || n.is_sans)) || String(noteName).trim().toUpperCase().startsWith('SANS ');
        const optPrice = typeof n === 'object' ? Number(n.price || n.effective_price || 0) : 0;
        
        if (optPrice > 0) {
          optionsTotalPrice += optPrice;
        }

        // 🚨 Noir pur (#000) au lieu de rouge ou gris (#333) pour éviter le tramage flou sur thermique
        const style = isSans 
          ? 'color: #000; font-weight: 900; text-decoration: underline;' 
          : 'color: #000; font-weight: 600;';
        const priceLabel = optPrice > 0 ? ` (+${optPrice.toFixed(2)} €)` : '';
        return `<div style="padding-left: 10px; font-size: 11px; margin-top: 1px; ${style}">- ${escapeHtml(noteName)}${priceLabel}</div>`;
      }).join('');
    }

    const effectiveLineUnitPrice = baseUnitPrice + optionsTotalPrice;
    const itemTotal = (qty * effectiveLineUnitPrice).toFixed(2);

    const qtyDisplay = (highlightMultiQty && qty > 1)
      ? `<span style="border: 1.5px solid #000; padding: 0 3px; font-weight: 900;">${qty}x</span>`
      : `${qty}x`;

    return `
      <div style="margin-bottom: 6px;">
        <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: ${fontSize}; color: #000;">
          <span style="max-width: 75%; word-break: break-word;">${qtyDisplay} ${name}</span>
          <span style="white-space: nowrap;">${itemTotal} €</span>
        </div>
        ${notesHtml}
      </div>
    `;
  }).join('');

  let deliveryBlockHtml = '';
  const d = orderData.delivery || {};
  const custName = escapeHtml(d.customerName || d.name || orderData.customer_name || '');
  const custAddress = escapeHtml(d.address || orderData.customer_address || '');
  const custPhone = escapeHtml(d.phone || orderData.customer_phone || '');
  const custNotes = escapeHtml(d.deliveryNotes || d.notes || orderData.comment || '');

  const isLivraison = orderTypeLabel.includes('LIVRAISON') || rawType.includes('livraison') || rawType.includes('delivery');
  const hasClientInfo = !!(custName || custAddress || custPhone);

  if (isLivraison && hasClientInfo) {
    const deliveryFeeNum = Number(d.fee || d.delivery_fee || orderData.delivery_fee || 0);
    deliveryBlockHtml = `
      <div class="delivery-block" style="border: 2px solid #000; color: #000; font-weight: bold; padding: 6px 8px; margin: 8px 0;">
        <div style="background-color: #000; color: #fff; text-align: center; padding: 3px; margin-bottom: 5px; font-size: 12px; font-weight: 900; text-transform: uppercase; -webkit-print-color-adjust: exact;">
          *** FICHE LIVRAISON ***
        </div>
        ${custName ? `<div><span style="font-size: 10px; font-weight: 900;">CLIENT :</span> ${custName}</div>` : ''}
        ${custAddress ? `<div style="margin-top: 2px;"><span style="font-size: 10px; font-weight: 900;">ADRESSE :</span> ${custAddress}</div>` : ''}
        ${custPhone ? `<div style="margin-top: 2px;"><span style="font-size: 10px; font-weight: 900;">TÉL :</span> ${custPhone}</div>` : ''}
        ${custNotes ? `<div style="margin-top: 2px;"><span style="font-size: 10px; font-weight: 900;">NOTE :</span> ${custNotes}</div>` : ''}
        ${deliveryFeeNum > 0 ? `<div style="margin-top: 4px; border-top: 1px dashed #000; padding-top: 3px;"><span style="font-size: 10px; font-weight: 900;">FRAIS DE LIVRAISON :</span> ${deliveryFeeNum.toFixed(2)} €</div>` : ''}
      </div>
    `;
  }

  const rawTva = orderData.tva ?? orderData.restaurant_tva ?? settings.restaurant_tva ?? 10;
  const tvaRate = Number(rawTva) > 0 ? Number(rawTva) : 10;
  
  let taxDetailsHtml = '';
  if (showTaxDetails && totalNum > 0) {
    const divisor = 1 + (tvaRate / 100);
    const ht = (totalNum / divisor).toFixed(2);
    const tvaAmount = (totalNum - totalNum / divisor).toFixed(2);
    taxDetailsHtml = `
      <div style="font-size: 11px; font-weight: 600; margin-top: 4px; color: #000;">
        <div style="display: flex; justify-content: space-between;"><span>Sous-total HT :</span><span>${ht} €</span></div>
        <div style="display: flex; justify-content: space-between;"><span>TVA (${tvaRate}%) :</span><span>${tvaAmount} €</span></div>
      </div>
    `;
  }

  let qrCodeHtml = '';
  if (showQrCode) {
    let qrUrl = settings.qr_code_custom_url || 'https://google.com';
    if (settings.qr_code_type === 'tracking') qrUrl = `https://caisseapp.vercel.app/#/track/${cleanOrderNumber}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 110 });
      qrCodeHtml = `
        <div style="text-align: center; width: 100%; margin: 10px auto 0 auto;">
          <img src="${qrDataUrl}" style="width: 100px; height: 100px; display: block; margin: 0 auto;" />
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
          @page { margin: 0; size: auto; }
          * { box-sizing: border-box; }
          html, body { font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}; margin: 0; padding: ${bodyPadding}; width: ${bodyWidth}; height: auto; overflow: hidden; color: #000; line-height: 1.25; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .center { text-align: center; width: 100%; }
          .bold { font-weight: bold; }
          hr { border: none; border-top: 1.5px dashed #000; margin: 7px 0; }
        </style>
      </head>
      <body>
        ${logoHtml}

        <div class="center">
          <div style="font-size: ${headerFontSize}; font-weight: 900; text-transform: uppercase;">${restaurantName}</div>
          ${showHeaderInfo && restaurantAddress ? `<div style="font-size: 11px; font-weight: 600;">${restaurantAddress}</div>` : ''}
          ${showHeaderInfo && restaurantPhone ? `<div style="font-size: 11px; font-weight: 600;">Tél : ${restaurantPhone}</div>` : ''}
          <div style="font-size: 11px; font-weight: 600; margin-top: 2px;">${orderDate}</div>
        </div>

        <hr />

        <div>${itemsHtml}</div>

        ${deliveryBlockHtml}

        <hr />

        ${taxDetailsHtml}

        <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-top: 3px;">
          <span>Mode de règlement :</span>
          <span>${paymentLabel}</span>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 17px; font-weight: 900; margin-top: 6px; border-top: 2px solid #000; padding-top: 4px;">
          <span>TOTAL TTC</span>
          <span>${total} €</span>
        </div>

        <div style="border: 3px solid #000; text-align: center; width: 100%; margin: 10px auto 4px auto; padding: 6px 4px;">
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase;">VOTRE NUMÉRO DE COMMANDE</div>
          <div style="font-size: 26px; font-weight: 900; letter-spacing: 1px; margin: 2px 0;">${cleanOrderNumber}</div>
          <div style="background-color: #000; color: #fff; font-size: 13px; font-weight: 900; display: inline-block; padding: 2px 10px; margin-top: 2px; -webkit-print-color-adjust: exact;">
            ${orderTypeLabel}
          </div>
        </div>

        ${(showFooterMessage || showQrCode) ? '<hr />' : ''}

        ${showFooterMessage ? `
          <div style="text-align: center; width: 100%; margin: 6px auto 4px auto;">
            <div style="font-size: 11px; font-weight: 700; text-align: center; width: 100%; white-space: pre-wrap; word-break: break-word;">${footerMessage}</div>
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
      if (orderData.items.length === 0) {
        return { success: true, message: 'SKIPPED_EMPTY_KITCHEN_ORDER' };
      }

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
        if (!groupInfo.items || groupInfo.items.length === 0) continue;

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

    if (isKitchen && (!Array.isArray(orderData.items) || orderData.items.length === 0)) {
      return { success: true, message: 'SKIPPED_EMPTY_KITCHEN_ORDER' };
    }

    return await PrinterManager._printSingleWindow(orderData, desiredPrinterName, mainWindow);
  },

  async _printSingleWindow(orderData, desiredPrinterName, mainWindow) {
    const settings = readSettingsFile();
    const widthMm = settings.receipt_width || '72';
    const rawType = String(orderData.orderType || orderData.type || '').toUpperCase();
    const isKitchen = rawType.includes('CUISINE');
    
    // 🟢 DÉTECTION SÉCURISÉE DES RAPPORTS X/Z
    const isReport = rawType.includes('RAPPORT') || 
                     rawType === 'Z' || 
                     rawType === 'X' || 
                     orderData.totalSales !== undefined || 
                     orderData.sessionId !== undefined;

    let htmlContent = '';
    if (isReport) {
      htmlContent = buildZReportHtml(orderData, widthMm);
    } else if (isKitchen) {
      htmlContent = buildKitchenHtml(orderData, widthMm);
    } else {
      htmlContent = await buildReceiptHtml(orderData, widthMm);
    }

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
        }, (success, failureReason) => {
          printWindow.destroy();
          printWindow = null;

          if (!success) {
            console.error("[PrinterManager] Erreur d'impression physique:", failureReason);
            resolve({ success: false, error: failureReason });
          } else {
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

      const settings = readSettingsFile();
      const pinMode = settings.drawer_pin_mode || 'both';

      // Séquence standard d'impulsion solénoïde ESC/POS (50ms pulse ON, 500ms delay OFF)
      // Broche 2 : 27, 112, 0, 25, 250
      // Broche 5 : 27, 112, 1, 25, 250
      // DLE DC4 temps réel : 16, 20, 1, 1, 1
      let kickBytes = [27, 112, 0, 25, 250, 27, 112, 1, 25, 250, 16, 20, 1, 1, 1];
      if (pinMode === '0') kickBytes = [27, 112, 0, 25, 250];
      else if (pinMode === '1') kickBytes = [27, 112, 1, 25, 250];
      else if (pinMode === 'dle') kickBytes = [16, 20, 1, 1, 1];

      if (process.platform === 'win32') {
        const kickCode = kickBytes.join(', ');
        const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, kickCode);
        return { success: isSuccess };
      } else {
        // macOS / Linux : envoi RAW direct via CUPS (lpr -o raw) sans avance papier
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
                // Fallback silencieux sans aucun texte pour ne pas faire d'avance de papier
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
    const targetPrinter = await getTargetPrinter(desiredPrinterName, mainWindow);
    if (!targetPrinter || process.platform !== 'win32') return { success: false };
    const isSuccess = await sendRawCommandToPrinter(targetPrinter.name, "29, 86, 66, 0");
    return { success: isSuccess };
  },

  async checkPrinterStatus(mainWindow) {
    const win = mainWindow || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return { ready: false };
    const printers = await win.webContents.getPrintersAsync();
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