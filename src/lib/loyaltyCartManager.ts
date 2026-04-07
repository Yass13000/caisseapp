import { CartItem } from '@/types';
import { supabase } from './supabaseClient';
import { syncProfileLoyaltyPoints } from './loyaltyPoints';

/**
 * Gestionnaire de points de fidélité pour le panier
 * Gère la recréditation des points quand un produit fidélité est retiré
 */

/**
 * Recrédite les points de fidélité quand un produit récompense est retiré du panier
 * IMPORTANT: Avec le nouveau système, les points ne sont jamais déduits lors de l'ajout au panier,
 * donc cette fonction sert uniquement à rafraîchir l'affichage (pas de modification DB nécessaire)
 */
export const refundRewardPoints = async (item: CartItem): Promise<{ success: boolean; error?: string }> => {
  if (!item.isReward || !item.rewardPoints) {
    return { success: true }; // Pas un produit fidélité, rien à faire
  }

  try {
    // Récupérer l'ID utilisateur depuis le localStorage (mode borne)
    const loyaltyCode = localStorage.getItem('loyaltyCode');
    const storedUserId = localStorage.getItem('loyaltyUserId');

    if (!loyaltyCode && !storedUserId) {
      return { success: true };
    }

    let userId = storedUserId;

    // Si on n'a pas le userId mais qu'on a le code, le chercher
    if (!userId && loyaltyCode) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('loyalty_code', loyaltyCode)
        .single();

      if (profileError || !profileData) {
        return { success: false, error: 'Profil non trouvé' };
      }
      userId = profileData.id;
    }

    if (!userId) {
      return { success: true };
    }

    // ✅ NOUVELLE LOGIQUE: Pas de transaction DB car les points n'ont jamais été déduits
    // On rafraîchit simplement l'affichage en déclenchant un événement de mise à jour

    // Récupérer le solde réel depuis Supabase
    const { data: currentProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('loyalty_points')
      .eq('id', userId)
      .single();

    if (fetchError || !currentProfile) {
      return { success: false, error: 'Erreur lecture profil' };
    }

    const currentBalance = currentProfile.loyalty_points || 0;
    localStorage.setItem('loyaltyPoints', currentBalance.toString());

    // Déclencher un événement personnalisé pour notifier les autres composants
    window.dispatchEvent(new CustomEvent('loyaltyPointsUpdated', {
      detail: { newBalance: currentBalance }
    }));

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erreur inconnue' };
  }
};

/**
 * Recrédite les points pour tous les produits fidélité du panier
 * Utile lors du vidage du panier
 * IMPORTANT: Avec le nouveau système, les points ne sont jamais déduits lors de l'ajout au panier,
 * donc cette fonction sert uniquement à rafraîchir l'affichage (pas de modification DB nécessaire)
 */
export const refundAllRewardPoints = async (items: CartItem[]): Promise<void> => {
  const rewardItems = items.filter(item => item.isReward && item.rewardPoints);

  if (rewardItems.length === 0) {
    return;
  }

  try {
    // Récupérer l'ID utilisateur depuis le localStorage (mode borne)
    const loyaltyCode = localStorage.getItem('loyaltyCode');
    const storedUserId = localStorage.getItem('loyaltyUserId');

    if (!loyaltyCode && !storedUserId) {
      return;
    }

    let userId = storedUserId;

    // Si on n'a pas le userId mais qu'on a le code, le chercher
    if (!userId && loyaltyCode) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('loyalty_code', loyaltyCode)
        .single();

      if (profileError || !profileData) {
        return;
      }
      userId = profileData.id;
    }

    if (!userId) {
      return;
    }

    // ✅ NOUVELLE LOGIQUE: Pas de transaction DB car les points n'ont jamais été déduits
    // On rafraîchit simplement l'affichage en déclenchant un événement de mise à jour

    // Récupérer le solde réel depuis Supabase
    const { data: currentProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('loyalty_points')
      .eq('id', userId)
      .single();

    if (fetchError || !currentProfile) {
      return;
    }

    const currentBalance = currentProfile.loyalty_points || 0;
    localStorage.setItem('loyaltyPoints', currentBalance.toString());

    // Déclencher un événement personnalisé pour notifier les autres composants
    window.dispatchEvent(new CustomEvent('loyaltyPointsUpdated', {
      detail: { newBalance: currentBalance }
    }));

  } catch (error) {
    // Erreur silencieuse
  }
};
