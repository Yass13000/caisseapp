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
  escapeHtml,
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

// ─────────────────────────── Écran client (second écran) ───────────────────────────
// Caisses Android à double écran : la page #/ecran-client s'ouvre sur l'écran secondaire
// (module natif CustomerDisplay, présent à partir de l'APK 1.5.0) et reçoit le panier en direct.
interface CustomerDisplayPlugin {
  status(): Promise<{ displays: number; open: boolean }>;
  open(o: { url: string }): Promise<void>;
  close(): Promise<void>;
  update(o: { state: unknown }): Promise<void>;
  configChanged(): Promise<void>;
  refresh(): Promise<void>;
}
const CustomerScreen = registerPlugin<CustomerDisplayPlugin>('CustomerDisplay');
const hasCustomerScreen = () => Capacitor.isPluginAvailable('CustomerDisplay');

const syncCustomerScreen = () => {
  if (!hasCustomerScreen()) return;
  let enabled = true;
  try { enabled = localStorage.getItem('customer_display_enabled') !== 'false'; } catch { /* activé par défaut */ }
  if (enabled) CustomerScreen.open({ url: `${window.location.origin}/#/ecran-client` }).catch(() => {});
  else CustomerScreen.close().catch(() => {});
};

let lastCustomerScreenState: unknown = null;
const customerScreenApi = () => ({
  update: (state: unknown) => {
    lastCustomerScreenState = state;
    CustomerScreen.update({ state }).catch(() => {});
  },
  onState: () => () => {},
  onConfigChanged: () => () => {},
  getState: async () => lastCustomerScreenState,
  getStatus: () => CustomerScreen.status(),
  // Image de fond personnelle : fichier local, disponible sous Windows seulement
  supportsImage: false,
  pickBackground: async () => ({ success: false, canceled: true }),
  getBackground: async () => null,
  clearBackground: async () => ({ success: true }),
  refresh: () => { CustomerScreen.refresh().catch(() => {}); },
});
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
/** Réglages façon borne : erreur de la dernière recherche et recherche déjà faite */
let lastScanError = '';
let scannedOnce = false;

const discover = (network = true): Promise<Found[]> => {
  if (scanning) return scanning;
  scanning = Native.discover({ network, timeoutMs: 3500 })
    .then(({ printers }) => {
      lastScanError = '';
      scannedOnce = true;
      const fresh = withLabels(printers || []);
      // Recherche USB seule : on garde les imprimantes réseau déjà connues
      found = network ? fresh : [...fresh, ...found.filter((p) => p.type === 'network')];
      try { localStorage.setItem(FOUND_KEY, JSON.stringify(found)); } catch { /* sans effet */ }
      return found;
    })
    .catch((e) => {
      lastScanError = String(e?.message || e || 'Recherche impossible');
      return found;
    })
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

// ───────────── Écran de réglages façon borne (lecture seule pour l'impression) ─────────────

/** Dernière impression (affichée dans les réglages, comme sur la borne) */
const lastPrint = { at: null as string | null, ok: null as boolean | null, printer: '', error: '', label: '' };

const ticketLabel = (orderData: any) => {
  const t = String(orderData?.orderType || orderData?.type || '').toUpperCase();
  if (String(orderData?.orderNumber || '').toUpperCase().includes('TEST')) return 'Ticket test';
  if (orderData?.type === 'DRIVER_SETTLEMENT') return 'Clôture livreur';
  if (t.includes('RAPPORT') || t === 'Z' || t === 'X' || orderData?.totalSales !== undefined) return 'Rapport';
  if (t.includes('CUISINE')) return 'Bon cuisine';
  return 'Ticket client';
};

/** Note le résultat sans jamais le modifier */
const recordPrint = (label: string, res: any, fallbackPrinter = '') => {
  try {
    Object.assign(lastPrint, {
      at: new Date().toISOString(),
      ok: !!res?.success,
      printer: String(res?.printerName || fallbackPrinter || ''),
      error: res?.success ? '' : String(res?.error || ''),
      label,
    });
  } catch { /* sans effet */ }
};

/** Réglages consultés pour un rôle, dans le même ordre que resolveTarget */
const roleChain = (role: string): unknown[] => {
  const s = settingsView();
  return role === 'cuisine' ? [s.imprimante_cuisine, s.imprimante_caisse]
    : role === 'livraison' ? [s.imprimante_livraison, s.imprimante_caisse]
      : role === 'rapports' ? [s.imprimante_rapports, s.imprimante_caisse, s.imprimante_cuisine]
        : [s.imprimante_caisse, s.imprimante_cuisine];
};

/** Même choix automatique que resolveTarget : USB, puis imprimante ticket connue, puis la première */
const bestGuess = (): Found | null =>
  found.find((p) => p.type === 'usb')
  || found.find((p) => /tm|epson|star|pos|80|ticket|receipt|thermal|xprinter|bixolon|citizen/i.test(p.label))
  || found[0]
  || null;

type PickReason = 'choisie' | 'automatique' | 'remplacement' | 'aucune';

/** Imprimante qu'utilisera la caisse pour ce rôle (affichage seulement) */
const pickFor = (savedName: string, role: string): { printer: Found | null; reason: PickReason } => {
  const saved = findByName(savedName);
  if (saved) return { printer: saved, reason: 'choisie' };
  if (!savedName) {
    const dependsOn = roleChain(role).slice(1).find((n) => !!n);
    const p = findByName(dependsOn);
    if (p) return { printer: p, reason: 'automatique' };
  }
  const best = bestGuess();
  if (best) return { printer: best, reason: savedName ? 'remplacement' : 'automatique' };
  return { printer: null, reason: 'aucune' };
};

/** Accès USB demandé une seule fois à la fois (4 cartes de réglage ouvertes ensemble) */
let authorizing: Promise<void> | null = null;
const authorizeUsb = (): Promise<void> => {
  if (authorizing) return authorizing;
  authorizing = (async () => {
    for (const p of found) {
      if (p.type === 'usb' && !p.permission) {
        p.permission = (await Native.authorize({ target: p.id }).catch(() => ({ granted: false }))).granted;
      }
    }
  })().finally(() => { authorizing = null; });
  return authorizing;
};

/** Même interface que la borne (TicketPrinterCard) */
const printerAuto = async (savedName = '', refresh = false, role = 'caisse') => {
  if (refresh || !scannedOnce) {
    await discover(true);
    await authorizeUsb();
  }
  const { printer, reason } = pickFor(savedName, role);
  const auto = pickFor('', role).printer;
  return {
    selected: printer ? printer.label : '',
    reason,
    auto: auto ? auto.label : '',
    printers: found.map((p) => ({
      name: p.label,
      port: p.type === 'usb' ? 'USB' : `IP_${p.ip}`,
      driver: p.type === 'usb' ? (p.permission ? 'Imprimante USB' : 'Imprimante USB (accès refusé)') : 'Imprimante réseau (port 9100)',
      score: 50,
      virtual: false,
      isDefault: false,
    })),
    lastPrint: { ...lastPrint },
    appVersion: 'Android',
    errors: lastScanError ? [lastScanError] : [],
  };
};

/** Tests depuis les réglages : petit ticket « TEST CAISSE » ou texte brut ESC/POS (dépannage) */
const printTest = async (printerName = '', mode: 'html' | 'raw' = 'raw', role = 'caisse'): Promise<Result> => {
  const target = await resolveTarget(printerName, role);
  if (!target) return { success: false, error: 'Aucune imprimante trouvée' };
  if (mode === 'html') {
    const html = `<div style="font:700 28px Arial;text-align:center;padding:12px 0">TEST CAISSE</div><div style="font:16px Arial;text-align:center">${escapeHtml(target.label)}<br>${new Date().toLocaleString('fr-FR')}</div>`;
    const res = await printOn(target, html, String(getSetting('receipt_width', '72')), 1);
    recordPrint('Ticket test', res, target.label);
    return res;
  }
  const text = `\x1b@\x1ba\x01TEST CAISSE\n${new Date().toLocaleString('fr-FR')}\n${target.label}\n\n[ GAUCHE                  DROITE ]\n\n\n\n\x1dVB\x00`;
  // Sans accents, octets ESC/POS conservés (ESC, GS, NUL), le reste en « ? »
  const ascii = Array.from(text.normalize('NFD')).filter((c) => !/\p{M}/u.test(c)).map((c) => (c.charCodeAt(0) < 128 ? c : '?')).join('');
  return Native.sendRaw({ target: target.id, base64: btoa(ascii) }).catch((e) => ({ success: false, error: String(e?.message || e) }));
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
    printReceipt: (data: any, printerName?: string) => printReceipt(data, printerName).then((res) => {
      recordPrint(ticketLabel(data), res, printerName);
      return res;
    }),
    getPrinters,
    printerAuto,
    printTest,
    openDrawer,
    getSetting,
    setSetting: (key: string, value: unknown) => {
      const ok = setSetting(key, value);
      // Réglages de l'écran client : affichage ouvert / fermé, fond et pubs relus par l'écran
      if (String(key).startsWith('customer_display_')) {
        if (key === 'customer_display_enabled') syncCustomerScreen();
        else if (hasCustomerScreen()) CustomerScreen.configChanged().catch(() => {});
      }
      return ok;
    },
    ...(hasCustomerScreen() ? { customerDisplay: customerScreenApi() } : {}),
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
  // Écran client : ouvert tout de suite s'il y a un second écran (comme sous Windows)
  syncCustomerScreen();
};

/** Installe le pont si le module natif est prêt (sans effet sur Windows ou déjà installé) */
export const ensureAndroidPrinting = (): boolean => {
  install();
  return typeof window !== 'undefined' && (window as any).electronAPI?.platform === 'android';
};

install();

// Vieilles WebView : le module natif peut répondre après le chargement de la page → nouveaux essais pendant 30 s
if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  let tries = 0;
  const timer = setInterval(() => {
    install();
    if ((window as any).electronAPI || ++tries >= 60) clearInterval(timer);
  }, 500);
}
