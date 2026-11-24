/**
 * Caisse Android (APK) : mêmes impressions que la caisse Windows.
 *
 * L'APK charge la caisse en ligne ; quand son module natif « CaissePrinter » est présent,
 * on installe ici un `window.electronAPI` équivalent à celui de Windows : toute la caisse
 * (tickets client, bons cuisine, Z / X, clôture livreur, tiroir, réglages) fonctionne sans
 * rien changer ailleurs.
 *
 * Imprimantes : recherche intelligente en USB (branchée) et en réseau (Ethernet / Wi-Fi :
 * annonces + balayage du port 9100), nom du modèle lu sur l'imprimante. Les tickets sont le
 * même HTML que sur Windows (electron/printing/ticketTemplates.js), imprimés en image.
 * Si une imprimante réseau a changé d'adresse IP, elle est retrouvée toute seule par son modèle.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  configureTicketTemplates,
  parseOrderItems,
  buildKitchenHtml,
  buildDriverSettlementHtml,
  buildZReportHtml,
  buildReceiptHtml,
} from '../../electron/printing/ticketTemplates.js';

type Found = { id: string; type: 'usb' | 'network'; model?: string; ip?: string; port?: number; permission?: boolean; label: string };
type Result = { success: boolean; error?: string; printerName?: string; [k: string]: unknown };

interface CaissePrinterPlugin {
  discover(o: { network?: boolean; timeoutMs?: number }): Promise<{ printers: Omit<Found, 'label'>[] }>;
  printHtml(o: { target: string; html: string; dots: number; copies: number; cut: boolean }): Promise<Result>;
  sendRaw(o: { target: string; base64: string }): Promise<Result>;
  check(o: { target: string }): Promise<{ ok: boolean }>;
  authorize(o: { target: string }): Promise<{ granted: boolean }>;
  exitApp(): Promise<void>;
}

const Native = registerPlugin<CaissePrinterPlugin>('CaissePrinter');
const FOUND_KEY = 'android_printers_found';
const OFFLINE_KEY = 'android_offline_orders';
const ROLE_KEYS = ['imprimante_caisse', 'imprimante_cuisine', 'imprimante_livraison', 'imprimante_rapports'] as const;

// ─────────────────────────── Réglages (stockés sur l'appareil) ───────────────────────────

const getSetting = (key: string, defaultValue?: unknown) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? defaultValue : v;
  } catch {
    return defaultValue;
  }
};

const setSetting = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''));
    return true;
  } catch {
    return false;
  }
};

/** Réglages lus par les modèles de tickets (mêmes clés que le fichier de réglages Windows) */
const settingsView = (): Record<string, any> =>
  new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? getSetting(k, undefined) : undefined) });

const logoCache = new Map<string, string>();
const getLogo = async (url: string) => {
  if (!url || !/^https?:\/\//.test(url)) return '';
  if (logoCache.has(url)) return logoCache.get(url) as string;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const blob = await fetch(url, { signal: ctrl.signal }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
    clearTimeout(t);
    if (!/^image\//.test(blob.type) || blob.size > 2_000_000) return '';
    const data = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    logoCache.set(url, data);
    return data;
  } catch {
    return '';
  }
};

// ─────────────────────────────── Imprimantes trouvées ───────────────────────────────

/** Nom affiché (et enregistré dans les réglages) : « EPSON TM-m30 · 192.168.1.50 », « EPSON TM-T20III · USB » */
const withLabels = (list: Omit<Found, 'label'>[]): Found[] => {
  const usbNames = new Map<string, number>();
  return list.map((p) => {
    if (p.type === 'network') return { ...p, label: `${p.model || 'Imprimante réseau'} · ${p.ip}` };
    const base = `${p.model || 'Imprimante USB'} · USB`;
    const n = (usbNames.get(base) || 0) + 1;
    usbNames.set(base, n);
    return { ...p, label: n > 1 ? `${base} ${n}` : base };
  });
};

const readFound = (): Found[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FOUND_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

let found: Found[] = readFound();
let scanning: Promise<Found[]> | null = null;

const discover = (network = true): Promise<Found[]> => {
  if (scanning) return scanning;
  scanning = Native.discover({ network, timeoutMs: 3500 })
    .then(({ printers }) => {
      const fresh = withLabels(printers || []);
      // Recherche USB seule : on garde les imprimantes réseau déjà connues
      found = network ? fresh : [...fresh, ...found.filter((p) => p.type === 'network')];
      try { localStorage.setItem(FOUND_KEY, JSON.stringify(found)); } catch { /* sans effet */ }
      return found;
    })
    .catch(() => found)
    .finally(() => { scanning = null; });
  return scanning;
};

const modelOf = (label: string) => label.split(' · ')[0]?.trim().toLowerCase() || '';
const IP_RE = /(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?\s*$/;

/** Retrouve une imprimante par le nom enregistré (même si elle n'a pas encore été vue depuis le démarrage) */
const findByName = (name: unknown): Found | null => {
  if (typeof name !== 'string' || !name.trim()) return null;
  const clean = name.trim();
  const exact = found.find((p) => p.label === clean) || found.find((p) => p.label.toLowerCase() === clean.toLowerCase());
  if (exact) return exact;
  // Imprimante réseau : l'adresse est dans le nom, pas besoin de la retrouver avant d'imprimer
  const ip = clean.match(IP_RE);
  if (ip) return { id: `tcp:${ip[1]}:${ip[2] || 9100}`, type: 'network', ip: ip[1], label: clean, model: clean.split(' · ')[0] };
  // Imprimante USB rebranchée : même modèle
  if (/·\s*USB/i.test(clean)) return found.find((p) => p.type === 'usb' && modelOf(p.label) === modelOf(clean)) || null;
  return null;
};

/** Même logique que Windows : demandée → réglage du rôle → imprimante ticket la plus probable */
const resolveTarget = async (desiredName: unknown, role: string): Promise<Found | null> => {
  const explicit = findByName(desiredName);
  if (explicit) return explicit;

  const s = settingsView();
  const roleName =
    role === 'cuisine' ? s.imprimante_cuisine || s.imprimante_caisse
      : role === 'livraison' ? s.imprimante_livraison || s.imprimante_caisse
        : role === 'rapports' ? s.imprimante_rapports || s.imprimante_caisse || s.imprimante_cuisine
          : s.imprimante_caisse || s.imprimante_cuisine;
  const configured = findByName(roleName);
  if (configured) return configured;

  if (!found.length) await discover(true);
  // USB branchée en priorité, puis une imprimante ticket connue, puis la première trouvée
  return (
    found.find((p) => p.type === 'usb')
    || found.find((p) => /tm|epson|star|pos|80|ticket|receipt|thermal|xprinter|bixolon|citizen/i.test(p.label))
    || found[0]
    || null
  );
};

/** Imprimante réseau qui ne répond plus : on la cherche à nouveau (adresse IP changée) et on met à jour les réglages */
const relocate = async (lost: Found): Promise<Found | null> => {
  await discover(true);
  const model = modelOf(lost.label);
  const same = found.filter((p) => p.type === 'network' && p.id !== lost.id && model && modelOf(p.label) === model);
  const next = same.length === 1 ? same[0] : null;
  if (next) {
    ROLE_KEYS.forEach((k) => { if (getSetting(k) === lost.label) setSetting(k, next.label); });
  }
  return next;
};

const printOn = async (target: Found, html: string, widthMm: string, copies: number): Promise<Result> => {
  const job = (t: Found) => Native.printHtml({ target: t.id, html, dots: Number(widthMm) <= 60 ? 384 : 576, copies, cut: true });
  let res = await job(target).catch((e) => ({ success: false, error: String(e?.message || e) }));
  if (!res.success && target.type === 'network') {
    const moved = await relocate(target);
    if (moved) {
      res = await job(moved).catch((e) => ({ success: false, error: String(e?.message || e) }));
      if (res.success) return { success: true, printerName: moved.label };
    }
  }
  if (!res.success && target.type === 'usb') {
    // Débranchée / rebranchée : nouvelle recherche USB puis un essai
    await discover(false);
    const again = findByName(target.label);
    if (again) res = await job(again).catch((e) => ({ success: false, error: String(e?.message || e) }));
  }
  return res.success ? { success: true, printerName: target.label } : { success: false, error: res.error || 'Impression impossible' };
};

// ─────────────────── Impression (même découpage que PrinterManager Windows) ───────────────────

const printSingle = async (orderData: any, desiredPrinterName?: string, forcedRole?: string | null): Promise<Result> => {
  const settings = settingsView();
  const widthMm = String(settings.receipt_width || '72');
  const rawType = String(orderData.orderType || orderData.type || '').toUpperCase();
  const isKitchen = rawType.includes('CUISINE');
  const isReport = rawType.includes('RAPPORT') || rawType === 'Z' || rawType === 'X'
    || orderData.totalSales !== undefined || orderData.sessionId !== undefined;
  const isDriverSettlement = orderData.type === 'DRIVER_SETTLEMENT' || String(orderData.title || '').toUpperCase().includes('LIVREUR');
  const role = forcedRole || ((isReport || isDriverSettlement) ? 'rapports' : (isKitchen ? 'cuisine' : 'caisse'));

  const html = isDriverSettlement ? buildDriverSettlementHtml(orderData, widthMm)
    : isReport ? buildZReportHtml(orderData, widthMm)
      : isKitchen ? buildKitchenHtml(orderData, widthMm)
        : await buildReceiptHtml(orderData, widthMm);

  const isTestOrder = String(orderData.orderNumber || '').toUpperCase().includes('TEST');
  let copies = 1;
  if (!isReport && !isDriverSettlement && !isTestOrder) {
    const raw = isKitchen ? settings.receipt_copies_kitchen : settings.receipt_copies_client;
    copies = Math.max(1, Math.min(5, Number(raw) || 1));
  }

  const isDeliveryTicket = !isKitchen && !isReport && !isDriverSettlement && rawType.includes('LIVRAISON');
  const deliveryName = isDeliveryTicket ? String(settings.imprimante_livraison || '').trim() : '';
  const target = (deliveryName && (await resolveTarget(deliveryName, 'livraison'))) || (await resolveTarget(desiredPrinterName, role));
  if (!target) return { success: false, error: 'Aucune imprimante trouvée (USB ou réseau)' };
  return printOn(target, html, widthMm, copies);
};

const printReceipt = async (orderData: any, desiredPrinterName?: string): Promise<Result> => {
  if (typeof orderData !== 'object' || orderData === null) return { success: false, error: 'INVALID_ORDER_DATA_FORMAT' };
  const settings = settingsView();
  const rawType = String(orderData.orderType || orderData.type || '').toUpperCase();
  const isKitchen = rawType.includes('CUISINE');

  let routing: Record<string, string> = {};
  try {
    const r = settings.category_printer_routing;
    routing = r ? (typeof r === 'string' ? JSON.parse(r) : r) : {};
  } catch { routing = {}; }

  const items = parseOrderItems(orderData.items || orderData.order_details);

  // Bon cuisine réparti par catégorie (ex. boissons au bar), comme sur Windows
  if (isKitchen && routing && Object.keys(routing).length > 0 && items.length > 0) {
    const groups = new Map<string, { printerName: string; role: string; items: any[] }>();
    for (const item of items) {
      const cat = String(item.categoryName || item.category || '').trim();
      const role = cat && routing[cat] ? routing[cat] : 'cuisine';
      const name = role === 'cuisine'
        ? (desiredPrinterName || settings.imprimante_cuisine || settings.imprimante_caisse)
        : (settings[`imprimante_${role}`] || desiredPrinterName || settings.imprimante_cuisine || settings.imprimante_caisse);
      const printer = await resolveTarget(name, role);
      const key = printer ? printer.id : 'DEFAULT_PRINTER';
      if (!groups.has(key)) groups.set(key, { printerName: printer ? printer.label : name, role, items: [] });
      groups.get(key)!.items.push(item);
    }
    const printedGroups: string[] = [];
    const failedGroups: string[] = [];
    for (const [key, g] of groups) {
      const res = await printSingle({ ...orderData, items: g.items }, g.printerName, g.role).catch(() => ({ success: false }));
      (res.success ? printedGroups : failedGroups).push(key);
    }
    return { success: failedGroups.length === 0, printedGroups, failedGroups };
  }

  if (isKitchen && items.length === 0) return { success: true, message: 'SKIPPED_EMPTY_KITCHEN_ORDER' };
  return printSingle(orderData, desiredPrinterName);
};

const toBase64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

const openDrawer = async (printerName?: string): Promise<Result> => {
  const target = await resolveTarget(printerName, 'caisse');
  if (!target) return { success: false, error: 'Aucune imprimante détectée.' };
  const pin = String(getSetting('drawer_pin_mode', 'both') || 'both');
  const kick = pin === '0' ? [27, 112, 0, 25, 250]
    : pin === '1' ? [27, 112, 1, 25, 250]
      : pin === 'dle' ? [16, 20, 1, 1, 1]
        : [27, 112, 0, 25, 250, 27, 112, 1, 25, 250, 16, 20, 1, 1, 1];
  return Native.sendRaw({ target: target.id, base64: toBase64(kick) }).catch((e) => ({ success: false, error: String(e?.message || e) }));
};

/** Liste pour les réglages : nouvelle recherche USB + réseau ; demande l'accès aux imprimantes USB */
const getPrinters = async () => {
  const list = await discover(true);
  for (const p of list) {
    if (p.type === 'usb' && !p.permission) {
      const r = await Native.authorize({ target: p.id }).catch(() => ({ granted: false }));
      p.permission = r.granted;
    }
  }
  return list.map((p) => ({ name: p.label, displayName: p.label, description: p.type === 'usb' ? 'USB' : `Réseau ${p.ip}`, isDefault: false, status: 0 }));
};

// ─────────────────────────── Commandes hors connexion ───────────────────────────

const readOffline = (): any[] => {
  try {
    const v = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeOffline = (list: any[]) => localStorage.setItem(OFFLINE_KEY, JSON.stringify(list));

// ─────────────────────────────────── Installation ───────────────────────────────────

const install = () => {
  if (typeof window === 'undefined' || (window as any).electronAPI) return;
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('CaissePrinter')) return;

  configureTicketTemplates({ readSettings: settingsView, getLogo });

  (window as any).electronAPI = {
    platform: 'android',
    printReceipt: (data: any, printerName?: string) => printReceipt(data, printerName),
    getPrinters,
    openDrawer,
    getSetting,
    setSetting,
    closeApp: () => { Native.exitApp().catch(() => {}); },
    saveOfflineOrder: async (order: any) => {
      try { writeOffline([...readOffline(), order]); return { success: true }; } catch (e: any) { return { success: false, error: e?.message }; }
    },
    getOfflineOrders: async () => readOffline(),
    removeOfflineOrder: async (offlineId: string) => {
      try { writeOffline(readOffline().filter((o) => o?.offline_id !== offlineId)); return { success: true }; } catch (e: any) { return { success: false, error: e?.message }; }
    },
  };

  // Recherche en arrière-plan au démarrage : la première impression part sans attendre
  setTimeout(() => { discover(true); }, 4000);
};

install();
