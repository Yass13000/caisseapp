import { supabase } from './supabaseClient';
import { executeWithLock } from './transactionLock';

// @ts-nocheck

export const POINTS_PER_EURO = 2;

export interface LoyaltyTransaction {
  id: string;
  user_id: string;
  points: number;
  type: 'earned' | 'spent';
  order_id?: number; // Changé de string à number pour correspondre à BIGINT
  description: string;
  created_at: string;
}

export interface UserLoyaltyStats {
  totalPoints: number;
  totalEarned: number;
  totalSpent: number;
  transactions: LoyaltyTransaction[];
}

/**
 * Met à jour la colonne profiles.loyalty_points avec le solde courant
 */
export const syncProfileLoyaltyPoints = async (userId: string): Promise<void> => {
  const balance = await getUserLoyaltyBalance(userId);
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ loyalty_points: balance })
      .eq('id', userId);
    if (error) {
    }
  } catch (e) {
  }
};

/**
 * Récupère le solde de points depuis profiles.loyalty_points si présent
 */
export const getProfileLoyaltyPoints = async (userId: string): Promise<number> => {
  try {
    // --- CORRECTION DU BUG DES DOUBLONS ICI ---
    const { data, error } = await supabase
      .from('profiles')
      .select('loyalty_points')
      .eq('id', userId)
      .limit(1)           // Sécurité anti-doublons
      .maybeSingle();     // Remplace .single()

    if (error) {
      return getUserLoyaltyBalance(userId);
    }
    if (typeof data?.loyalty_points === 'number') return data.loyalty_points;
    return getUserLoyaltyBalance(userId);
  } catch (e) {
    return getUserLoyaltyBalance(userId);
  }
};

/**
 * S'assure que profiles.loyalty_points correspond au solde calculé; met à jour si différent
 */
export const ensureProfilePointsSynced = async (userId: string): Promise<{synced: boolean; newValue?: number; error?: string}> => {
  try {
    const [computed, profile] = await Promise.all([
      getUserLoyaltyBalance(userId),
      getProfileLoyaltyPoints(userId)
    ]);
    if (computed !== profile) {
      const { error } = await supabase
        .from('profiles')
        .update({ loyalty_points: computed })
        .eq('id', userId);
      if (error) return { synced: false, error: error.message };
      return { synced: true, newValue: computed };
    }
    return { synced: true, newValue: profile };
  } catch (e: any) {
    return { synced: false, error: e?.message || 'unknown error' };
  }
};

/**
 * Calcule les points gagnés en fonction du montant dépensé
 * @param amount Montant en euros
 * @returns Nombre de points gagnés
 */
export const calculatePointsFromAmount = (amount: number): number => {
  return Math.floor(amount * POINTS_PER_EURO);
};

/**
 * Ajoute des points de fidélité pour un utilisateur
 * @param userId ID de l'utilisateur
 * @param points Nombre de points à ajouter
 * @param orderId ID de la commande (optionnel)
 * @param description Description de la transaction
 */
export const addLoyaltyPoints = async (
  userId: string, 
  points: number, 
  orderId?: number, // Changé de string à number
  description?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    
    const { error } = await supabase
      .from('loyalty_points')
      .insert({
        user_id: userId,
        points: points,
        type: 'earned',
        order_id: orderId,
        description: description || `Points gagnés pour commande`,
        created_at: new Date().toISOString()
      })
      .select()
      .limit(1)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    // Synchroniser IMMÉDIATEMENT le solde dans profiles avec await
    try {
      await syncProfileLoyaltyPoints(userId);
    } catch (syncError) {
    }

    // Forcer un refresh du cache côté client (keep lock to prevent concurrent access)
    await getUserLoyaltyBalance(userId);

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erreur inconnue' };
  }
};

/**
 * Récupère le solde total de points d'un utilisateur
 * @param userId ID de l'utilisateur
 * @returns Solde total de points
 */
export const getUserLoyaltyBalance = async (userId: string): Promise<number> => {
  try {
    const { data, error } = await supabase
      .from('loyalty_points')
      .select('points, type')
      .eq('user_id', userId);

    if (error) {
      return 0;
    }

    const balance = data.reduce((total, transaction) => {
      const newTotal = total + (transaction.type === 'earned' ? transaction.points : -transaction.points);
      return newTotal;
    }, 0);

    return Math.max(0, balance);
  } catch (error) {
    return 0;
  }
};

/**
 * Récupère les statistiques complètes de fidélité d'un utilisateur
 * @param userId ID de l'utilisateur
 * @returns Statistiques de fidélité
 */
export const getUserLoyaltyStats = async (userId: string): Promise<UserLoyaltyStats> => {
  try {
    const { data, error } = await supabase
      .from('loyalty_points')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return {
        totalPoints: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      };
    }

    const totalEarned = data
      .filter(t => t.type === 'earned')
      .reduce((sum, t) => sum + t.points, 0);

    const totalSpent = data
      .filter(t => t.type === 'spent')
      .reduce((sum, t) => sum + t.points, 0);

    const totalPoints = totalEarned - totalSpent;

    return {
      totalPoints: Math.max(0, totalPoints),
      totalEarned,
      totalSpent,
      transactions: data
    };
  } catch (error) {
    return {
      totalPoints: 0,
      totalEarned: 0,
      totalSpent: 0,
      transactions: []
    };
  }
};

/**
 * Utilise des points de fidélité (pour des récompenses futures)
 * @param userId ID de l'utilisateur
 * @param points Nombre de points à utiliser
 * @param description Description de l'utilisation
 */
export const spendLoyaltyPoints = async (
  userId: string, 
  points: number, 
  description: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Vérifier d'abord que l'utilisateur a assez de points
    const currentBalance = await getUserLoyaltyBalance(userId);
    
    if (currentBalance < points) {
      return { success: false, error: 'Solde de points insuffisant' };
    }

    const { error } = await supabase
      .from('loyalty_points')
      .insert({
        user_id: userId,
        points: points,
        type: 'spent',
        description: description,
        created_at: new Date().toISOString()
      });

    if (error) {
      return { success: false, error: error.message };
    }
    // Synchroniser le solde dans profiles
    await syncProfileLoyaltyPoints(userId);
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erreur inconnue' };
  }
};

/**
 * THREAD-SAFE: Add loyalty points with transaction lock
 * Prevents race conditions when multiple orders are processed simultaneously
 */
export const addLoyaltyPointsThreadSafe = async (
  userId: string, 
  points: number, 
  orderId?: number,
  description?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const result = await executeWithLock(userId, async () => {
      return await addLoyaltyPoints(userId, points, orderId, description);
    });
    return result;
  } catch (error: any) {
    return { success: false, error: `Transaction failed: ${error.message}` };
  }
};

/**
 * THREAD-SAFE: Spend loyalty points with transaction lock
 * Prevents race conditions and ensures points aren't double-spent
 */
export const spendLoyaltyPointsThreadSafe = async (
  userId: string, 
  points: number, 
  description: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const result = await executeWithLock(userId, async () => {
      return await spendLoyaltyPoints(userId, points, description);
    });
    return result;
  } catch (error: any) {
    return { success: false, error: `Transaction failed: ${error.message}` };
  }
};