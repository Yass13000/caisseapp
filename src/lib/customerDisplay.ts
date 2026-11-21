// Écran client (second écran) : état partagé entre la caisse et la fenêtre #/ecran-client.
// La caisse publie par IPC Electron (window.electronAPI.customerDisplay.update) ; hors Electron, tout est sans effet.

export type CustomerDisplayPhase = 'idle' | 'cart' | 'payment' | 'thanks';
export type CustomerOrderType = 'SUR PLACE' | 'EMPORTER' | 'LIVRAISON';

export interface CustomerDisplayLine {
  key: string;
  name: string;
  qty: number;
  total: number;
  options: { name: string; sans?: boolean }[];
}

export interface CustomerDisplayBrand {
  /** Restaurant de la caisse : une identité d'un autre restaurant n'est jamais réaffichée */
  id?: string | null;
  name: string;
  logo: string | null;
  primary: string;
  secondary: string;
  accent: string;
}

export interface CustomerDisplayState {
  phase: CustomerDisplayPhase;
  brand: CustomerDisplayBrand | null;
  orderType: CustomerOrderType | null;
  lines: CustomerDisplayLine[];
  count: number;
  deliveryFee: number;
  total: number;
  /** Paiement en cours : déjà réglé, reste dû, monnaie à rendre */
  paid: number;
  remaining: number;
  change: number;
  /** Change à chaque mise à jour, pour animer la dernière ligne ajoutée */
  lastKey: string | null;
}

interface CustomerDisplayAPI {
  update: (state: CustomerDisplayState) => void;
  onState: (cb: (state: CustomerDisplayState) => void) => () => void;
  onConfigChanged: (cb: () => void) => () => void;
  getState: () => Promise<CustomerDisplayState | null>;
  getStatus: () => Promise<{ displays: number; open: boolean }>;
  pickBackground: () => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  getBackground: () => Promise<string | null>;
  clearBackground: () => Promise<{ success: boolean }>;
  getCachedAds?: () => Promise<CustomerAd[]>;
  syncAds?: (list: { id: string; url: string; type: 'image' | 'video'; duration: number }[]) => Promise<CustomerAd[]>;
  refresh?: () => void;
}

/** Pub prête à l'affichage (fichier en cache local) */
export interface CustomerAd {
  id: string;
  type: 'image' | 'video';
  duration: number;
  src: string;
}

// Pubs : table existante restaurant_images (partagée avec la borne et l'app).
//   Borne1..3 → pubs de la borne (gérées depuis la borne)
//   Pub1..2   → promos de l'app (gérées dans l'admin)
//   Caisse1..5 → pubs propres à l'écran client (gérées depuis les réglages de la caisse)
// Les autres lignes (Logo, OrderTypeBg, Presentation…) ne sont pas des pubs.
export const ADS_TABLE = 'restaurant_images';
export const ADS_BUCKET = 'Images';
export const CAISSE_AD_SLOTS = ['Caisse1', 'Caisse2', 'Caisse3', 'Caisse4', 'Caisse5'];

export type AdSource = 'caisse' | 'borne' | 'app';

export interface RestaurantImageRow {
  id: number;
  nom: string;
  image_url: string | null;
  restaurant_id: string | null;
  is_active: boolean | null;
}

export const adSource = (nom: string): AdSource | null => {
  if (/^Caisse[1-5]$/.test(nom)) return 'caisse';
  if (/^Borne[1-3]$/.test(nom)) return 'borne';
  if (/^Pub[1-2]$/.test(nom)) return 'app';
  return null;
};

const SOURCE_ORDER: Record<AdSource, number> = { caisse: 0, borne: 1, app: 2 };

export const mediaTypeFromUrl = (url: string): 'image' | 'video' => {
  try {
    return /\.(mp4|webm|mov|m4v)$/i.test(new URL(url).pathname) ? 'video' : 'image';
  } catch {
    return 'image';
  }
};

/** Lignes restaurant_images → pubs à afficher, dans l'ordre : caisse, borne, app */
export const rowsToAds = (rows: RestaurantImageRow[]) =>
  rows
    .filter(r => r.is_active !== false && !!r.image_url && adSource(r.nom))
    .sort((a, b) => {
      const sa = SOURCE_ORDER[adSource(a.nom)!], sb = SOURCE_ORDER[adSource(b.nom)!];
      return sa - sb || a.nom.localeCompare(b.nom, 'fr', { numeric: true });
    });

export const AD_NAMES = [...CAISSE_AD_SLOTS, 'Borne1', 'Borne2', 'Borne3', 'Pub1', 'Pub2'];

/** Durée d'affichage d'une image (réglage de la caisse) */
export const readAdImageDuration = () => {
  try {
    const api = (window as any).electronAPI;
    const v = Number(api?.getSetting ? api.getSetting('customer_display_ad_duration', '8') : localStorage.getItem('customer_display_ad_duration'));
    return Number.isFinite(v) && v >= 3 && v <= 60 ? v : 8;
  } catch {
    return 8;
  }
};

export const getCustomerDisplayAPI = (): CustomerDisplayAPI | null =>
  ((window as any).electronAPI?.customerDisplay as CustomerDisplayAPI | undefined) || null;

// ---------------------------------------------------------------------------
// Fonds
// ---------------------------------------------------------------------------

export type CustomerBgMode = 'theme' | 'color' | 'gradient' | 'image';

// Tous les fonds sont calculés à partir des couleurs du restaurant en cours.
const mix = (hex: string, target: string, t: number) => {
  const p = (h: string) => {
    const c = h.replace('#', '');
    const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const a = p(hex), b = p(target);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

type BrandColors = Pick<CustomerDisplayBrand, 'primary' | 'secondary' | 'accent'> | null | undefined;

export const BRAND_BACKGROUNDS: { id: string; light: boolean; css: (b: { primary: string; secondary: string; accent: string }) => string }[] = [
  { id: 'theme', light: false, css: ({ primary, secondary }) =>
    `radial-gradient(ellipse at 15% 10%, ${primary}55 0%, transparent 55%), linear-gradient(140deg, ${secondary} 0%, ${mix(secondary, '#000000', 0.75)} 100%)` },
  { id: 'principal', light: false, css: ({ primary }) =>
    `linear-gradient(140deg, ${mix(primary, '#000000', 0.15)} 0%, ${mix(primary, '#000000', 0.6)} 100%)` },
  { id: 'duo', light: false, css: ({ primary, secondary }) =>
    `linear-gradient(135deg, ${mix(secondary, '#000000', 0.4)} 0%, ${mix(primary, '#000000', 0.35)} 100%)` },
  { id: 'nuit', light: false, css: ({ primary, accent }) =>
    `radial-gradient(ellipse at 85% 90%, ${accent}33 0%, transparent 50%), radial-gradient(ellipse at 10% 0%, ${primary}40 0%, transparent 55%), #07090c` },
  { id: 'clair', light: true, css: ({ primary }) =>
    `radial-gradient(ellipse at 15% 10%, ${primary}30 0%, transparent 55%), linear-gradient(140deg, #ffffff 0%, ${mix(primary, '#ffffff', 0.88)} 100%)` },
];

export const DEFAULT_GRADIENT_ID = 'theme';

const brandColors = (brand: BrandColors) => ({
  primary: brand?.primary || '#04B855',
  secondary: brand?.secondary || '#1f2937',
  accent: brand?.accent || '#FBBF24',
});

const findBackground = (id: string) =>
  BRAND_BACKGROUNDS.find(b => b.id === id) || BRAND_BACKGROUNDS[0];

/** Fond en couleurs du restaurant ; tout autre réglage (anciennes couleurs libres) retombe sur le thème. */
export const brandBackground = (mode: CustomerBgMode, variant: string, brand: BrandColors) => {
  const bg = findBackground(mode === 'gradient' ? variant : 'theme');
  return { id: bg.id, css: bg.css(brandColors(brand)), light: bg.light };
};

export const readCustomerDisplaySettings = () => {
  const api = (window as any).electronAPI;
  const get = (k: string, d: string) => {
    try {
      const v = api?.getSetting ? api.getSetting(k, d) : localStorage.getItem(k);
      return v === null || v === undefined || v === '' ? d : String(v);
    } catch {
      return d;
    }
  };
  const mode = get('customer_display_bg_mode', 'theme') as CustomerBgMode;
  return {
    enabled: get('customer_display_enabled', 'true') !== 'false',
    mode: (['theme', 'color', 'gradient', 'image'].includes(mode) ? mode : 'theme') as CustomerBgMode,
    color: get('customer_display_bg_color', '#111827'),
    gradient: get('customer_display_bg_gradient', DEFAULT_GRADIENT_ID),
    version: get('customer_display_bg_version', '0'),
  };
};

// ---------------------------------------------------------------------------
// Publication côté caisse
// ---------------------------------------------------------------------------
// Trois sources : le panier (toujours), le paiement (fenêtre d'encaissement ouverte),
// le « Merci » (quelques secondes après l'encaissement). Le Merci reste affiché tant
// qu'aucune nouvelle commande ne démarre.

const THANKS_DURATION_MS = 7000;

type CartSnapshot = Omit<CustomerDisplayState, 'phase' | 'paid' | 'remaining' | 'change'>;

let cart: CartSnapshot = {
  brand: null, orderType: null, lines: [], count: 0, deliveryFee: 0, total: 0, lastKey: null,
};
let payment: { total: number; paid: number; remaining: number; change: number } | null = null;
let thanks: { total: number; change: number; brand: CustomerDisplayBrand | null; orderType: CustomerOrderType | null } | null = null;
let cartEmptiedSinceThanks = false;
let thanksTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';

const flush = () => {
  const api = getCustomerDisplayAPI();
  if (!api) return;
  let state: CustomerDisplayState;
  if (thanks) {
    state = {
      ...cart, phase: 'thanks', brand: cart.brand || thanks.brand, orderType: thanks.orderType,
      lines: [], count: 0, total: thanks.total, paid: thanks.total, remaining: 0, change: thanks.change,
    };
  } else if (payment && cart.count > 0) {
    state = { ...cart, phase: 'payment', total: payment.total, paid: payment.paid, remaining: payment.remaining, change: payment.change };
  } else {
    state = { ...cart, phase: cart.count > 0 ? 'cart' : 'idle', paid: 0, remaining: cart.total, change: 0 };
  }
  const serialized = JSON.stringify(state);
  if (serialized === lastSent) return;
  lastSent = serialized;
  try {
    api.update(state);
  } catch (e) {
    console.warn('Écran client : envoi impossible', e);
  }
};

let lastBrandJson = '';

export const publishCustomerCart = (snapshot: CartSnapshot) => {
  // Identité gardée localement : écran client avant connexion, aperçu des réglages
  if (snapshot.brand) {
    const json = JSON.stringify(snapshot.brand);
    if (json !== lastBrandJson) {
      lastBrandJson = json;
      try { localStorage.setItem('customer_display_brand', json); } catch { /* sans effet */ }
    }
  }
  const prevKeys = new Set(cart.lines.map(l => `${l.key}:${l.qty}`));
  const changed = snapshot.lines.find(l => !prevKeys.has(`${l.key}:${l.qty}`));
  cart = { ...snapshot, lastKey: changed ? changed.key : (snapshot.count > 0 ? cart.lastKey : null) };
  if (thanks) {
    if (snapshot.count === 0) cartEmptiedSinceThanks = true;
    else if (cartEmptiedSinceThanks) clearThanks(false);
  }
  flush();
};

export const publishCustomerPayment = (p: { total: number; paid: number; remaining: number; change: number } | null) => {
  payment = p;
  flush();
};

const clearThanks = (doFlush = true) => {
  thanks = null;
  if (thanksTimer) clearTimeout(thanksTimer);
  thanksTimer = null;
  if (doFlush) flush();
};

/** À appeler juste après un encaissement réussi (avant de vider le panier). */
export const showCustomerThanks = (total: number) => {
  thanks = { total, change: payment?.change || 0, brand: cart.brand, orderType: cart.orderType };
  cartEmptiedSinceThanks = false;
  payment = null;
  if (thanksTimer) clearTimeout(thanksTimer);
  thanksTimer = setTimeout(() => clearThanks(), THANKS_DURATION_MS);
  flush();
};
