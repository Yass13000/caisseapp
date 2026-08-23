// @ts-nocheck
import { CartItem } from '@/types';
import { supabase, RESTAURANT_ID } from './supabaseClient';
import { getProfileLoyaltyPoints, getActiveRestoId } from './loyaltyPoints';

/**
 * Gestionnaire de points de fidélité pour le panier
 * Gère la recréditation / synchronisation des points quand un produit fidélité est retiré
 */

/**
 * Recrédite/rafraîchit l'affichage des points quand un produit récompense est retiré du panier
 */
export const refundRewardPoints = async (item: CartItem): Promise<{ success: boolean; error?: string }> => {
  if (!item.isReward && !item.rewardPoints) {
    return { success: true };
  }

  try {
    const loyaltyCode = localStorage.getItem('loyaltyCode');
    const storedUserId = localStorage.getItem('loyaltyUserId') || localStorage.getItem('loyalty_user_id');
    const activeRestoId = getActiveRestoId();

    let userId = storedUserId;

    if (!userId && loyaltyCode) {
      let query = supabase
        .from('profiles')
        .select('id')
        .eq('loyalty_code', loyaltyCode);

      if (activeRestoId) {
        query = query.eq('restaurant_id', activeRestoId);
      }

      const { data: profileData } = await query.limit(1).maybeSingle();
      if (profileData) {
        userId = profileData.id;
      }
    }

    if (!userId) {
      return { success: true };
    }

    // Récupération sécurisée du solde propre au restaurant actif
    const currentBalance = await getProfileLoyaltyPoints(userId, activeRestoId);

    if (typeof window !== 'undefined') {
      localStorage.setItem('loyaltyPoints', currentBalance.toString());

      // Émission des deux formats d'événements pour compatibilité totale
      window.dispatchEvent(new CustomEvent('loyaltyPointsUpdated', {
        detail: { newBalance: currentBalance }
      }));
      window.dispatchEvent(new Event('loyalty-points-updated'));
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erreur inconnue' };
  }
};

/**
 * Recrédite les points pour tous les produits fidélité du panier (vidage du panier)
 */
export const refundAllRewardPoints = async (items: CartItem[]): Promise<void> => {
  const rewardItems = (items || []).filter(item => item.isReward || item.rewardPoints);

  if (rewardItems.length === 0) {
    return;
  }

  try {
    const loyaltyCode = localStorage.getItem('loyaltyCode');
    const storedUserId = localStorage.getItem('loyaltyUserId') || localStorage.getItem('loyalty_user_id');
    const activeRestoId = getActiveRestoId();

    let userId = storedUserId;

    if (!userId && loyaltyCode) {
      let query = supabase
        .from('profiles')
        .select('id')
        .eq('loyalty_code', loyaltyCode);

      if (activeRestoId) {
        query = query.eq('restaurant_id', activeRestoId);
      }

      const { data: profileData } = await query.limit(1).maybeSingle();
      if (profileData) {
        userId = profileData.id;
      }
    }

    if (!userId) {
      return;
    }

    const currentBalance = await getProfileLoyaltyPoints(userId, activeRestoId);

    if (typeof window !== 'undefined') {
      localStorage.setItem('loyaltyPoints', currentBalance.toString());

      window.dispatchEvent(new CustomEvent('loyaltyPointsUpdated', {
        detail: { newBalance: currentBalance }
      }));
      window.dispatchEvent(new Event('loyalty-points-updated'));
    }
  } catch (error) {
    // Erreur silencieuse
  }
};