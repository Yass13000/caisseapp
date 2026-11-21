/**
 * Temps de préparation = de l'ARRIVÉE de la commande (created_at) jusqu'au passage en « Prêt ».
 * Jamais jusqu'à la clôture (« Fermé ») : c'est la même règle que le KDS.
 *
 * Renvoie les champs à ajouter à la mise à jour du statut :
 *  • passage en Prêt  → prepared_at + actual_prep_time_seconds (sauf si déjà enregistrés)
 *  • retour en Nouvelle / En cours → chronométrage effacé (la commande repart en cuisine)
 *  • autre statut (Fermé, Annulée…) → rien, l'heure « prêt » éventuelle est conservée
 */
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const isReadyStatus = (status: unknown) => norm(status).startsWith('pret');
const isBackInKitchen = (status: unknown) => {
  const s = norm(status);
  return s === 'nouvelle' || s === 'nouveau' || s === 'en cours' || s.includes('preparation');
};

export const prepTimingPatch = (
  newStatus: string,
  order: { created_at?: string | null; prepared_at?: string | null } | null | undefined,
  now: Date = new Date()
): Record<string, any> => {
  if (isReadyStatus(newStatus)) {
    if (order?.prepared_at) return {};
    const patch: Record<string, any> = { prepared_at: now.toISOString() };
    const created = order?.created_at ? new Date(order.created_at).getTime() : NaN;
    if (!isNaN(created)) patch.actual_prep_time_seconds = Math.max(0, Math.floor((now.getTime() - created) / 1000));
    return patch;
  }
  if (isBackInKitchen(newStatus)) return { prepared_at: null, actual_prep_time_seconds: null };
  return {};
};
