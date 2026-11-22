// TPE SumUp Solo pilotés par internet (Cloud API).
// La caisse ne parle jamais à SumUp directement : elle passe par le serveur (/api/sumup-readers),
// qui garde la clé SumUp du restaurant. Ici : réglages locaux de cette caisse + appels au serveur.

export interface SoloReader {
  id: string;
  name: string;
  pairing: 'paired' | 'processing' | 'expired' | 'unknown';
  model: string | null;
  serial: string | null;
  online: boolean;
  state: string | null;
  battery: number | null;
  connection: string | null;
  firmware: string | null;
}

export type SoloResult = 'pending' | 'successful' | 'failed' | 'cancelled';

export interface SoloStatus {
  result: SoloResult;
  reader: { online: boolean; state: string | null; battery: number | null };
  transaction: { code: string | null; amount: number | null; card_type: string | null; last4: string | null } | null;
}

const KEYS = {
  url: 'sumup_solo_api_url',
  key: 'sumup_solo_pos_key',
  reader: 'sumup_solo_reader_id',
  readerName: 'sumup_solo_reader_name',
} as const;

const api = () => (window as any).electronAPI;

const getSetting = (key: string): string => {
  try {
    const fromExe = api()?.getSetting ? api().getSetting(key, '') : null;
    return String(fromExe || localStorage.getItem(key) || '');
  } catch {
    return '';
  }
};

const setSetting = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* sans effet */ }
  try { api()?.setSetting?.(key, value); } catch { /* sans effet */ }
};

const restaurantId = (): string =>
  getSetting('pos_restaurant_id') || String(localStorage.getItem('admin_override_restaurant_id') || '');

// Serveur des TPE : hébergé avec la borne en ligne. Rien à saisir sur l'appareil ;
// l'adresse et la clé ne se changent que dans « Avancé » (installation particulière).
const DEFAULT_API_URL = 'https://borne1313.vercel.app';

/** Adresse du serveur, sans barre finale */
export const getSoloApiUrl = (): string =>
  (getSetting(KEYS.url) || String(import.meta.env.VITE_POS_API_URL || '') || DEFAULT_API_URL).trim().replace(/\/+$/, '');

/** Clé d'appareil : vide sauf si le serveur en exige une */
export const getSoloPosKey = (): string =>
  (getSetting(KEYS.key) || String(import.meta.env.VITE_POS_API_KEY || '')).trim();

export const saveSoloServer = (url: string, key: string) => {
  let clean = url.trim().replace(/\/+$/, '');
  if (clean && !/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
  setSetting(KEYS.url, clean === DEFAULT_API_URL ? '' : clean);
  setSetting(KEYS.key, key.trim());
};

/** TPE utilisé par CETTE caisse pour les paiements par carte ('' = encaissement manuel comme avant) */
export const getSelectedReader = (): { id: string; name: string } | null => {
  const id = getSetting(KEYS.reader);
  return id ? { id, name: getSetting(KEYS.readerName) || 'TPE' } : null;
};

export const selectReader = (reader: { id: string; name: string } | null) => {
  setSetting(KEYS.reader, reader?.id || '');
  setSetting(KEYS.readerName, reader?.name || '');
};

/** Vrai si un paiement carte doit partir sur un Solo */
export const isSoloEnabled = (): boolean => Boolean(getSelectedReader());

export class SoloError extends Error {
  /** true : la requête n'est pas arrivée (réseau) → on ne sait pas ce que le serveur a fait */
  network: boolean;
  constructor(message: string, network = false) { super(message); this.network = network; }
}

const call = async <T,>(action: string, payload: Record<string, unknown> = {}, timeoutMs = 20000): Promise<T> => {
  const url = getSoloApiUrl();
  const key = getSoloPosKey();
  const resto = restaurantId();
  if (!resto) throw new SoloError('Caisse non reliée à un restaurant.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${url}/api/sumup-readers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, restaurant_id: resto, ...(key ? { pos_key: key } : {}), ...payload }),
      signal: controller.signal,
    });
  } catch {
    throw new SoloError('Serveur injoignable : vérifiez la connexion internet de la caisse.', true);
  } finally {
    clearTimeout(timer);
  }

  let data: any = null;
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (!res.ok) {
    throw new SoloError(data?.error || `Erreur serveur (${res.status}).`, res.status >= 500 && !data?.error);
  }
  return data as T;
};

export const listReaders = () => call<{ readers: SoloReader[]; affiliate_ready: boolean }>('list');

export const pairReader = (pairingCode: string, name: string) =>
  call<{ reader: SoloReader }>('pair', { pairing_code: pairingCode, name });

export const renameReader = (readerId: string, name: string) =>
  call<{ reader: SoloReader }>('rename', { reader_id: readerId, name });

export const unpairReader = (readerId: string) => call<{ success: boolean }>('unpair', { reader_id: readerId });

export const startSoloCheckout = (readerId: string, amountCents: number, description: string, reference: string) =>
  call<{ client_transaction_id: string }>('checkout', {
    reader_id: readerId,
    amount_cents: amountCents,
    description,
    reference,
  });

export const getSoloStatus = (readerId: string, clientTransactionId: string) =>
  call<SoloStatus>('status', { reader_id: readerId, client_transaction_id: clientTransactionId }, 12000);

export const terminateSoloCheckout = (readerId: string) =>
  call<{ success: boolean; accepted: boolean }>('terminate', { reader_id: readerId });

/** Libellé court de l'état du TPE pour l'écran de paiement */
export const readerStateLabel = (state: string | null, online: boolean): string => {
  if (!online) return 'TPE hors ligne';
  switch (state) {
    case 'WAITING_FOR_CARD': return 'Présentez la carte sur le TPE';
    case 'WAITING_FOR_PIN': return 'Saisie du code en cours';
    case 'WAITING_FOR_SIGNATURE': return 'Signature en cours';
    case 'SELECTING_TIP': return 'Choix du pourboire';
    case 'UPDATING_FIRMWARE': return 'Mise à jour du TPE en cours';
    default: return 'Envoi au TPE…';
  }
};
