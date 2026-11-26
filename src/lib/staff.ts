// Profils utilisateurs de la caisse (prénom + code personnel + rôle + droits cochés).
// Tables / fonctions Supabase : docs/utilisateurs-caisse.sql
//
// Règle de compatibilité : sans profil créé (ou si Supabase ne répond pas et
// qu'aucune copie locale n'existe), la caisse marche exactement comme avant :
// le code d'accès actuel (pos_pin) ouvre la caisse avec tous les droits.
import { useSyncExternalStore } from 'react';
import { supabase, getActiveRestaurantId } from '@/lib/supabaseClient';

export type PermissionKey =
  | 'encaisser' | 'rouvrir' | 'annuler' | 'remise' | 'tiroir'
  | 'caisse' | 'z' | 'stocks' | 'dispatch' | 'reglages' | 'profils';

export const PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: 'encaisser', label: 'Encaisser' },
  { key: 'rouvrir', label: 'Rouvrir une commande' },
  { key: 'annuler', label: 'Annuler une commande' },
  { key: 'remise', label: 'Faire une remise / offrir' },
  { key: 'tiroir', label: 'Ouvrir le tiroir à la main' },
  { key: 'caisse', label: 'Ouvrir la caisse / ticket X' },
  { key: 'z', label: 'Faire le Z' },
  { key: 'stocks', label: 'Stocks' },
  { key: 'dispatch', label: 'Dispatch livraisons' },
  { key: 'reglages', label: 'Réglages' },
  { key: 'profils', label: 'Gérer les profils' },
];

export type Permissions = Partial<Record<PermissionKey, boolean>>;

const ALL = Object.fromEntries(PERMISSIONS.map(p => [p.key, true])) as Permissions;
const only = (...keys: PermissionKey[]): Permissions =>
  Object.fromEntries(PERMISSIONS.map(p => [p.key, keys.includes(p.key)])) as Permissions;

/** Rôles proposés : choisir un rôle pré-coche ces cases (modifiables ensuite profil par profil). */
export const ROLE_PRESETS: { role: string; permissions: Permissions }[] = [
  { role: 'Gérant', permissions: ALL },
  { role: 'Responsable', permissions: { ...ALL, profils: false } },
  { role: 'Caissier', permissions: only('encaisser', 'rouvrir', 'caisse', 'dispatch') },
  { role: 'Livreur', permissions: only('encaisser', 'dispatch') },
  { role: 'Équipier', permissions: only() },
];

export interface StaffProfile {
  id: string;
  first_name: string;
  role: string;
  pin_salt: string;
  pin_hash: string;
  permissions: Permissions;
  color: string | null;
  active: boolean;
  updated_at?: string;
}

export interface StaffState {
  restaurantId: string;
  staff: StaffProfile[];
  masterCodeDisabled: boolean;
  fetchedAt: number;
}

export interface CurrentUser {
  id: string | null;          // null = profil Standard (code d'accès de la caisse)
  name: string;
  role: string;
  isStandard: boolean;
  permissions: Permissions;
}

// ── SHA-256 (pur JS : marche aussi sur les vieux navigateurs, sans crypto.subtle) ──

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export const sha256Hex = (text: string): string => {
  const bytes = unescape(encodeURIComponent(text)).split('').map(c => c.charCodeAt(0));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  for (let i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 0xff);
  for (let i = 3; i >= 0; i--) bytes.push((bitLen >>> (i * 8)) & 0xff);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h).map(x => x.toString(16).padStart(8, '0')).join('');
};

export const hashPin = (salt: string, pin: string) => sha256Hex(`${salt}:${pin}`);

export const newSalt = (): string => {
  const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(16)))
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return rnd.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ── Copie locale (connexion hors ligne) ──────────────────────────────────────

const CACHE_KEY = 'pos_staff_cache';

export const readStaffCache = (restaurantId: string | null | undefined): StaffState | null => {
  if (!restaurantId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!v || v.restaurantId !== restaurantId || !Array.isArray(v.staff)) return null;
    return v as StaffState;
  } catch {
    return null;
  }
};

const writeStaffCache = (state: StaffState) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* sans effet */ }
};

/** Recharge les profils depuis Supabase. En cas d'échec (hors ligne, script non installé) : la copie locale est gardée. */
export const refreshStaff = async (restaurantId: string | null | undefined): Promise<StaffState | null> => {
  if (!restaurantId) return null;
  try {
    const { data, error } = await supabase.rpc('pos_staff_list', { p_restaurant_id: restaurantId });
    if (error || !data) return readStaffCache(restaurantId);
    const state: StaffState = {
      restaurantId,
      staff: Array.isArray(data.staff) ? data.staff : [],
      masterCodeDisabled: data.master_code_disabled === true,
      fetchedAt: Date.now(),
    };
    writeStaffCache(state);
    return state;
  } catch {
    return readStaffCache(restaurantId);
  }
};

// ── Connexion par code ───────────────────────────────────────────────────────

export const STANDARD_USER: CurrentUser = {
  id: null, name: 'Standard', role: 'Standard', isStandard: true, permissions: ALL,
};

const toCurrentUser = (p: StaffProfile): CurrentUser => ({
  id: p.id, name: p.first_name, role: p.role, isStandard: false, permissions: p.permissions || {},
});

/**
 * Trouve à qui appartient un code. Le code d'accès de la caisse (profil Standard)
 * est essayé en premier, sauf s'il a été supprimé. Renvoie null si code inconnu.
 */
export const resolvePin = (pin: string, masterPin: string, restaurantId: string | null | undefined): CurrentUser | null => {
  const cache = readStaffCache(restaurantId);
  if (!cache?.masterCodeDisabled && pin === String(masterPin)) return STANDARD_USER;
  for (const p of cache?.staff || []) {
    if (p.active && p.pin_salt && p.pin_hash && hashPin(p.pin_salt, pin) === p.pin_hash) return toCurrentUser(p);
  }
  return null;
};

// ── Utilisateur connecté ─────────────────────────────────────────────────────

let current: CurrentUser | null = null;
const listeners = new Set<() => void>();

export const getCurrentUser = () => current;
export const setCurrentUser = (u: CurrentUser | null) => {
  current = u;
  listeners.forEach(l => l());
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useCurrentUser = () => useSyncExternalStore(subscribe, getCurrentUser, getCurrentUser);

/** Droit de l'utilisateur connecté. Profil Standard (ou personne) = tous les droits, comme avant. */
export const can = (perm: PermissionKey): boolean => {
  if (!current || current.isStandard) return true;
  return current.permissions?.[perm] === true;
};

// ── Gestion des profils (Réglages > Utilisateurs) ────────────────────────────

const rpcError = (error: any, fallback: string) =>
  new Error(error?.code === 'PGRST202'
    ? "Profils pas encore installés dans Supabase (docs/utilisateurs-caisse.sql)"
    : (String(error?.message || '') || fallback));

/** Le code est-il déjà pris par un profil actif (autre que exceptId) ? */
export const isPinTakenByStaff = (pin: string, restaurantId: string | null | undefined, exceptId?: string | null): boolean => {
  const cache = readStaffCache(restaurantId);
  return (cache?.staff || []).some(p => p.active && p.id !== exceptId && p.pin_salt && hashPin(p.pin_salt, pin) === p.pin_hash);
};

export interface StaffDraft {
  id: string | null;
  first_name: string;
  role: string;
  permissions: Permissions;
  active: boolean;
  pin?: string | null;          // null / vide = code inchangé (modification)
}

/** Crée ou modifie un profil, puis recharge la liste. Lève une erreur lisible en cas de refus. */
export const saveStaff = async (restaurantId: string, draft: StaffDraft): Promise<StaffState | null> => {
  const salt = draft.pin ? newSalt() : null;
  const { error } = await supabase.rpc('pos_staff_save', {
    p_restaurant_id: restaurantId,
    p_id: draft.id,
    p_first_name: draft.first_name.trim(),
    p_role: draft.role.trim(),
    p_permissions: draft.permissions,
    p_color: null,
    p_active: draft.active,
    p_pin_salt: salt,
    p_pin_hash: salt && draft.pin ? hashPin(salt, draft.pin) : null,
  });
  if (error) throw rpcError(error, "Enregistrement impossible");
  const state = await refreshStaff(restaurantId);
  // Le profil connecté a été modifié : ses droits s'appliquent tout de suite
  const me = getCurrentUser();
  const updated = me?.id ? state?.staff.find(p => p.id === me.id) : null;
  if (me?.id && updated) setCurrentUser(updated.active ? toCurrentUser(updated) : me);
  return state;
};

/** Supprime (true) ou réactive (false) le profil Standard (code d'accès des caisses). */
export const setMasterCodeDisabled = async (restaurantId: string, disabled: boolean): Promise<StaffState | null> => {
  const { error } = await supabase.rpc('pos_set_master_code_disabled', { p_restaurant_id: restaurantId, p_disabled: disabled });
  if (error) throw rpcError(error, "Modification impossible");
  return refreshStaff(restaurantId);
};

/** Code d'accès de CETTE caisse (profil Standard), lu comme le reste de l'appli. */
export const getMasterPin = (): string => {
  try {
    const api = (window as any).electronAPI;
    if (api?.getSetting) return String(api.getSetting('pos_pin', '1234'));
    return localStorage.getItem('pos_pin') ?? '1234';
  } catch {
    return '1234';
  }
};

export const permissionLabel = (perm: PermissionKey) => PERMISSIONS.find(p => p.key === perm)?.label || perm;

// ── Traçabilité ──────────────────────────────────────────────────────────────

/** Champs « qui » à ajouter à une commande. Vide pour le profil Standard : enregistrement identique à avant. */
export const staffOrderFields = (): { staff_id?: string; staff_name?: string } => {
  const u = getCurrentUser();
  return u && !u.isStandard && u.id ? { staff_id: u.id, staff_name: u.name } : {};
};

/** Champs « qui » pour l'ouverture (opened) ou la clôture/Z (closed) d'une session de caisse. */
export const staffSessionFields = (kind: 'opened' | 'closed'): Record<string, string> => {
  const u = getCurrentUser();
  return u && !u.isStandard && u.id ? { [`${kind}_by_id`]: u.id, [`${kind}_by_name`]: u.name } : {};
};

export type AuditAction =
  | 'annulation' | 'remise' | 'offert' | 'tiroir' | 'ouverture_caisse' | 'z' | 'autorisation';

export const AUDIT_LABELS: Record<string, string> = {
  annulation: 'Commande annulée',
  remise: 'Remise',
  offert: 'Offert',
  tiroir: 'Tiroir ouvert à la main',
  ouverture_caisse: 'Ouverture de caisse',
  z: 'Ticket Z',
  autorisation: 'Autorisation d\'un responsable',
};

/** Ajoute une ligne au journal. Ne bloque jamais (erreurs ignorées : hors ligne, script absent…). */
export const logAction = (
  action: AuditAction,
  opts: { orderId?: string | number | null; sessionId?: string | number | null; details?: Record<string, any>; approvedBy?: CurrentUser | null } = {}
) => {
  try {
    const restaurantId = getActiveRestaurantId();
    if (!restaurantId) return;
    const u = getCurrentUser();
    let deviceId: string | null = null;
    try { deviceId = localStorage.getItem('pos_device_id'); } catch { /* sans effet */ }
    void Promise.resolve(supabase.rpc('pos_audit_add', {
      p_restaurant_id: restaurantId,
      p_action: action,
      p_staff_id: u?.id || null,
      p_staff_name: u?.name || 'Standard',
      p_order_id: opts.orderId != null ? String(opts.orderId) : null,
      p_session_id: opts.sessionId != null ? String(opts.sessionId) : null,
      p_device_id: deviceId,
      p_details: opts.details || null,
      p_approved_by_id: opts.approvedBy?.id || null,
      p_approved_by_name: opts.approvedBy ? opts.approvedBy.name : null,
    })).catch(() => { /* jamais bloquant */ });
  } catch { /* jamais bloquant */ }
};

export interface AuditEntry {
  id: number;
  created_at: string;
  action: string;
  staff_name: string | null;
  approved_by_name: string | null;
  order_id: string | null;
  session_id: string | null;
  details: Record<string, any> | null;
}

export const fetchAuditLog = async (restaurantId: string, sinceDays = 7): Promise<AuditEntry[]> => {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data, error } = await supabase.rpc('pos_audit_list', { p_restaurant_id: restaurantId, p_since: since, p_limit: 300 });
  if (error) throw rpcError(error, 'Journal indisponible');
  return (data || []) as AuditEntry[];
};
