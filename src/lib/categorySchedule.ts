/**
 * Plage horaire d'une catégorie (ex. Menu Etudiant : lundi → vendredi, 11:00 → 14:00).
 * Colonnes de `categories` : active_days (jours en français, vide = tous les jours),
 * start_time / end_time (vides = toute la journée). Heure de Paris, plage passant minuit gérée.
 * Même règle dans l'app, la borne, la caisse et le serveur (api/_lib/categorySchedule.ts).
 */

export const WEEK_DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

const normDay = (d: unknown) =>
  String(d ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const hhmm = (t: unknown) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${(m[1] ?? '').padStart(2, '0')}:${m[2] ?? '00'}` : '';
};

export const parisClock = (now: Date = new Date()) => ({
  day: normDay(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long' }).format(now)),
  hm: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
});

export const hasCategorySchedule = (cat: any): boolean => {
  const days = Array.isArray(cat?.active_days) ? cat.active_days.filter(Boolean) : [];
  return days.length > 0 || Boolean(hhmm(cat?.start_time) && hhmm(cat?.end_time));
};

/** Vrai si la catégorie peut être vendue maintenant (sans plage réglée : toujours) */
export const isCategoryOpen = (cat: any, now: Date = new Date()): boolean => {
  if (!cat || !hasCategorySchedule(cat)) return true;
  const { day, hm } = parisClock(now);
  const days = Array.isArray(cat.active_days) ? cat.active_days.map(normDay).filter(Boolean) : [];
  if (days.length > 0 && !days.includes(day)) return false;
  const start = hhmm(cat.start_time);
  const end = hhmm(cat.end_time);
  if (!start || !end || start === end) return true;
  // Fin exclue : 11:00 → 14:00 = commandable jusqu'à 13:59
  return start < end ? hm >= start && hm < end : hm >= start || hm < end;
};

const SHORT: Record<string, string> = { lundi: 'lun', mardi: 'mar', mercredi: 'mer', jeudi: 'jeu', vendredi: 'ven', samedi: 'sam', dimanche: 'dim' };

/** « Lun → ven · 11h00 – 14h00 » (vide si aucune plage) */
export const categoryScheduleLabel = (cat: any): string => {
  if (!hasCategorySchedule(cat)) return '';
  const set = new Set((Array.isArray(cat.active_days) ? cat.active_days : []).map(normDay));
  const picked: string[] = WEEK_DAYS.filter((d) => set.has(d));
  const idx: number[] = picked.map((d) => (WEEK_DAYS as readonly string[]).indexOf(d));
  let days = '';
  if (picked.length > 0 && picked.length < 7) {
    const contiguous = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -2) + 1);
    const first = picked[0] ?? '';
    const last = picked[picked.length - 1] ?? '';
    days = contiguous && picked.length > 2
      ? `${SHORT[first] ?? first} → ${SHORT[last] ?? last}`
      : picked.map((d) => SHORT[d] ?? d).join(', ');
    days = days.charAt(0).toUpperCase() + days.slice(1);
  }
  const start = hhmm(cat.start_time);
  const end = hhmm(cat.end_time);
  const hours = start && end ? `${start.replace(':', 'h')} – ${end.replace(':', 'h')}` : '';
  return [days, hours].filter(Boolean).join(' · ');
};
