// @ts-nocheck
// Impression directe des tickets en image (ESC/POS), sans passer par le pilote Windows.
//
// Pourquoi : avec le pilote (ex. Epson TM-T30), Windows place lui-même la page :
// le bord gauche du ticket était coupé (« x Menu » au lieu de « 1x Menu ») et le logo
// sortait gris et baveux. Ici on dessine le ticket (même HTML), on le convertit en noir
// et blanc à la résolution exacte de la tête d'impression, puis on l'envoie tel quel.
// Résultat identique sur toutes les imprimantes ticket ESC/POS (Epson, Star, POS80…).
import electron from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';

const { BrowserWindow, app } = electron;

const DPI = 203; // résolution des imprimantes ticket
const SLICE_H = 1000;
export const VIRTUAL_PRINTER = /pdf|xps|onenote|fax|document writer|send to/i;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Largeur imprimable en points : 80 mm -> 72 mm (576 points) ; 58 mm -> 48 mm (384 points). */
export const printableDots = (paperWidthMm) => (Number(paperWidthMm) <= 60 ? 384 : 576);

// Le ticket de la caisse est conçu pour une colonne de 62 mm (46 mm en 58) collée à gauche :
// en impression directe on la centre sur la largeur imprimable.
const CENTER_CSS = `<style>
  html { width: 100% !important; max-width: none !important; padding: 0 !important; overflow: visible !important; }
  body { margin: 0 auto !important; overflow: visible !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
</style>`;

function withCentering(html) {
  return html.includes('</head>') ? html.replace('</head>', `${CENTER_CSS}</head>`) : CENTER_CSS + html;
}

// Noir et blanc : texte net (seuil), dégradés et logos tramés (diffusion d'erreur).
function toMonoRows(bmp, width, height, dots, rows) {
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const a = bmp[p + 3] / 255;
    const l = 0.114 * bmp[p] + 0.587 * bmp[p + 1] + 0.299 * bmp[p + 2];
    lum[i] = l * a + 255 * (1 - a);
  }
  let black = 0;
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(dots / 8);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = lum[i];
      let isBlack;
      if (old < 70) isBlack = true;
      else if (old > 215) isBlack = false;
      else isBlack = old < 128;
      const err = old - (isBlack ? 0 : 255);
      if (old >= 70 && old <= 215) {
        if (x + 1 < width) lum[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) lum[i + width - 1] += (err * 3) / 16;
          lum[i + width] += (err * 5) / 16;
          if (x + 1 < width) lum[i + width + 1] += err / 16;
        }
      }
      if (isBlack && x < dots) {
        line[x >> 3] |= 0x80 >> (x & 7);
        black++;
      }
    }
    rows.push(line);
  }
  return black;
}

async function renderRows(html, dots, visible) {
  const cssWidth = (dots / DPI) * 96; // largeur imprimable en pixels CSS
  const zoom = dots / cssWidth;
  const win = new BrowserWindow({
    show: false,
    x: -20000,
    y: 0,
    width: dots,
    height: SLICE_H,
    useContentSize: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, zoomFactor: zoom, backgroundThrottling: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withCentering(html))}`);
    win.webContents.setZoomFactor(zoom);
    if (visible) win.showInactive();
    const cssHeight = await win.webContents.executeJavaScript(`
      (async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((img) => img.complete ? (img.decode ? img.decode().catch(() => {}) : null) : new Promise((r) => { img.onload = img.onerror = r; })));
        return Math.ceil(Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().bottom + window.scrollY));
      })()
    `);
    const total = Math.max(1, Math.ceil(cssHeight * zoom));
    const rows = [];
    let black = 0;
    for (let y = 0; y < total; y += SLICE_H) {
      const scrolled = await win.webContents.executeJavaScript(
        `window.scrollTo(0, ${y / zoom}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY))))`
      );
      await wait(60);
      const offset = Math.max(0, Math.round(y - scrolled * zoom));
      const h = Math.min(SLICE_H, total - y, SLICE_H - offset);
      let img = await win.webContents.capturePage({ x: 0, y: offset, width: dots, height: h });
      if (img.isEmpty()) throw new Error('Capture du ticket vide');
      // Écran à 125 % / 150 % : l'image capturée est plus grande, on la ramène à la largeur de la tête
      if (img.getSize().width !== dots) img = img.resize({ width: dots, height: h, quality: 'best' });
      const { width, height } = img.getSize();
      black += toMonoRows(img.toBitmap(), width, height, dots, rows);
    }
    return { rows, black };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Ticket HTML -> lignes noir et blanc ({ rows, black }). */
export async function renderTicketRows(html, paperWidthMm = '72') {
  const dots = printableDots(paperWidthMm);
  let res = await renderRows(html, dots, false);
  // Fenêtre cachée jamais dessinée sur certains PC : on recommence hors de l'écran
  if (res.black === 0) res = await renderRows(html, dots, true);
  return { ...res, dots };
}

/** Lignes noir et blanc -> commandes ESC/POS (image par bandes, avance, coupe). */
export function escPosImage(rows, dots, { cut = true } = {}) {
  const bytesPerRow = dots / 8;
  const parts = [Buffer.from([0x1b, 0x40])];
  for (let start = 0; start < rows.length; start += 256) {
    const band = rows.slice(start, start + 256);
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, band.length & 0xff, band.length >> 8]));
    parts.push(...band);
  }
  parts.push(Buffer.from([0x1b, 0x64, 0x04]));
  if (cut) parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  return Buffer.concat(parts);
}

const RAW_SCRIPT = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$src = @"
using System;
using System.Runtime.InteropServices;
public class CaisseRawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OpenPrinter erreur " + Marshal.GetLastWin32Error();
    try {
      DOCINFOW di = new DOCINFOW(); di.pDocName = "Ticket caisse"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "StartDocPrinter erreur " + Marshal.GetLastWin32Error();
      try {
        StartPagePrinter(h);
        int w;
        bool ok = WritePrinter(h, bytes, bytes.Length, out w);
        EndPagePrinter(h);
        if (!ok) return "WritePrinter erreur " + Marshal.GetLastWin32Error();
        if (w != bytes.Length) return "Ecriture partielle " + w + "/" + bytes.Length;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return "OK";
  }
}
"@
# Code d'impression compilé une seule fois dans une DLL (impressions suivantes plus rapides)
if (-not ('CaisseRawPrn' -as [type])) {
  $dll = $env:CAISSE_RAW_DLL
  try {
    if ($dll -and -not (Test-Path $dll)) { Add-Type -TypeDefinition $src -OutputAssembly $dll -OutputType Library }
    if ($dll -and (Test-Path $dll)) { Add-Type -Path $dll }
  } catch {}
  if (-not ('CaisseRawPrn' -as [type])) { Add-Type -TypeDefinition $src }
}
$bytes = [System.IO.File]::ReadAllBytes($env:CAISSE_RAW_FILE)
Write-Output ([CaisseRawPrn]::Send($env:CAISSE_PRINTER_NAME, $bytes))
`;

/** Envoie des octets bruts à une imprimante Windows. Retourne { success, error }. */
export async function sendRawBytes(printerName, bytes) {
  if (process.platform !== 'win32') return { success: false, error: 'Disponible uniquement sous Windows' };
  if (!printerName) return { success: false, error: 'Aucune imprimante' };
  const file = path.join(os.tmpdir(), `caisse-raw-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  try {
    fs.writeFileSync(file, Buffer.from(bytes));
    const encoded = Buffer.from(RAW_SCRIPT, 'utf16le').toString('base64');
    const out = await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        {
          encoding: 'utf8',
          timeout: 30000,
          windowsHide: true,
          env: {
            ...process.env,
            CAISSE_PRINTER_NAME: String(printerName),
            CAISSE_RAW_FILE: file,
            CAISSE_RAW_DLL: path.join(app.getPath('userData'), 'caisse-rawprn-v1.dll'),
          },
        },
        (err, stdout) => resolve({ err, stdout: String(stdout || '').trim() })
      );
    });
    if (!out.err && out.stdout.endsWith('OK')) return { success: true };
    return { success: false, error: out.stdout || (out.err && out.err.message) || 'Erreur inconnue' };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
}

/** Ticket HTML imprimé en image sur une imprimante ticket. Retourne { success, error }. */
export async function printHtmlAsImage(html, printerName, { paperWidthMm = '72', copies = 1 } = {}) {
  const { rows, black, dots } = await renderTicketRows(html, paperWidthMm);
  if (!black) return { success: false, error: 'Ticket dessiné vide' };
  const one = escPosImage(rows, dots, { cut: true });
  const data = copies > 1 ? Buffer.concat(Array.from({ length: copies }, () => one)) : one;
  return sendRawBytes(printerName, data);
}
