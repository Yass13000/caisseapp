// @ts-nocheck
import { supabase, RESTAURANT_ID } from './supabaseClient';
import { executeWithLock } from './transactionLock';

export const POINTS_PER_EURO = 2;

export interface LoyaltyTransaction {
  id: string;
  user_id: string;
  points: number;
  type: 'earned' | 'spent';
  order_id?: number;
  description: string;
  created_at: string;
  restaurant_id?: string;
}

export interface UserLoyaltyStats {
  totalPoints: number;
  totalEarned: number;
  totalSpent: number;
  transactions: LoyaltyTransaction[];
}

/**
 * 🟢 Résout de façon sûre l'ID du restaurant actif
 */
export const getActiveRestoId = (restaurantId?: string): string | undefined => {
  if (restaurantId) return restaurantId;
  if (typeof window === 'undefined') return undefined;
  return (
    localStorage.getItem('admin_override_restaurant_id') ||
    localStorage.getItem('device_restaurant_id') ||
    localStorage.getItem('pos_restaurant_id') ||
    (typeof RESTAURANT_ID !== 'undefined' ? RESTAURANT_ID : undefined)
  );
};

/**
 * Récupère le solde STRICTEMENT isolé d'un utilisateur pour le restaurant actif
 */
export const getUserLoyaltyBalance = async (userId: string, restaurantId?: string): Promise<number> => {
  if (!userId) return 0;

  try {
    const activeRestoId = getActiveRestoId(restaurantId);

    let query = supabase
      .from('loyalty_points')
      .select('points, type, restaurant_id')
      .eq('user_id', userId);

    if (activeRestoId) {
      query = query.eq('restaurant_id', activeRestoId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erreur lecture loyalty_points:', error);
      return 0;
    }

    if (!data || data.length === 0) {
      return 0;
    }

    const balance = data.reduce((total, transaction) => {
      const pts = Number(transaction.points) || 0;
      return total + (transaction.type === 'earned' ? pts : -pts);
    }, 0);

    return Math.max(0, balance);
  } catch (error) {
    console.error('Erreur getUserLoyaltyBalance:', error);
    return 0;
  }
};

/**
 * Récupère le solde du profil pour le restaurant actif
 */
export const getProfileLoyaltyPoints = async (userId: string, restaurantId?: string): Promise<number> => {
  const activeRestoId = getActiveRestoId(restaurantId);
  return await getUserLoyaltyBalance(userId, activeRestoId);
};

/**
 * Met à jour profiles et le cache local de la borne
 */
export const syncProfileLoyaltyPoints = async (userId: string, restaurantId?: string): Promise<void> => {
  if (!userId) return;
  const activeRestoId = getActiveRestoId(restaurantId);
  const balance = await getUserLoyaltyBalance(userId, activeRestoId);

  try {
    let query = supabase
      .from('profiles')
      .update({ loyalty_points: balance })
      .eq('id', userId);

    if (activeRestoId) {
      query = query.eq('restaurant_id', activeRestoId);
    }

    await query;

    if (typeof window !== 'undefined') {
      localStorage.setItem('loyaltyPoints', balance.toString());
      window.dispatchEvent(new Event('loyalty-points-updated'));
      window.dispatchEvent(new CustomEvent('loyaltyPointsUpdated', { detail: { newBalance: balance } }));
    }
  } catch (e) {
    console.error('Erreur syncProfileLoyaltyPoints:', e);
  }
};

/**
 * S'assure de la synchronisation des points
 */
export const ensureProfilePointsSynced = async (
  userId: string,
  restaurantId?: string
): Promise<{ synced: boolean; newValue?: number; error?: string }> => {
  try {
    const activeRestoId = getActiveRestoId(restaurantId);
    const balance = await getUserLoyaltyBalance(userId, activeRestoId);

    if (typeof window !== 'undefined') {
      localStorage.setItem('loyaltyPoints', balance.toString());
    }
    return { synced: true, newValue: balance };
  } catch (e: any) {
    return { synced: false, error: e?.message || 'unknown error' };
  }
};

/**
 * Calcule les points gagnés (2 points / euro)
 */
export const calculatePointsFromAmount = (amount: number): number => {
  return Math.floor(amount * POINTS_PER_EURO);
};

/**
 * Ajoute des points pour le restaurant actif
 */
export const addLoyaltyPoints = async (
  userId: string,
  points: number,
  orderId?: number,
  description?: string,
  restaurantId?: string
): Promise<{ success: boolean; error?: string }> => {
  if (!userId || points <= 0) return { success: true };

  try {
    const activeRestoId = getActiveRestoId(restaurantId);

    const payload: any = {
      user_id: userId,
      points: points,
      type: 'earned',
      order_id: orderId || null,
      description: description || 'Points gagnés pour commande',
      created_at: new Date().toISOString()
    };

    if (activeRestoId) {
      payload.restaurant_id = activeRestoId;
    }

    const { error } = await supabase
      .from('loyalty_points')
      .insert(payload);

    if (error) {
      console.error('Erreur insert loyalty_points (earned):', error);
      return { success: false, error: error.message };
    }

    await syncProfileLoyaltyPoints(userId, activeRestoId);
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erreur inconnue' };
  }
};

/**
 * Récupère l'historique filtré par restaurant
 */
export const getUserLoyaltyStats = async (userId: string, restaurantId?: string): Promise<UserLoyaltyStats> => {
  try {
    const activeRestoId = getActiveRestoId(restaurantId);

    let query = supabase
      .from('loyalty_points')
      .select('*')
      .eq('user_id', userId);

    if (activeRestoId) {
      query = query.eq('restaurant_id', activeRestoId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error || !data) {
      return { totalPoints: 0, totalEarned: 0, totalSpent: 0, transactions: [] };
    }

    const totalEarned = data
      .filter((t) => t.type === 'earned')
      .reduce((sum, t) => sum + Number(t.points), 0);

    const totalSpent = data
      .filter((t) => t.type === 'spent')
      .reduce((sum, t) => sum + Number(t.points), 0);

    const totalPoints = Math.max(0, totalEarned - totalSpent);

    return {
      totalPoints,
      totalEarned,
      totalSpent,
      transactions: data
    };
  } catch (error) {
    return { totalPoints: 0, totalEarned: 0, totalSpent: 0, transactions: [] };
  }
};

/**
 * Débite des points pour le restaurant actif
 */
export const spendLoyaltyPoints = async (
  userId: string,
  points: number,
  description: string,
  restaurantId?: string
): Promise<{ success: boolean; error?: string }> => {
  if (!userId || points <= 0) return { success: true };

  try {
    const activeRestoId = getActiveRestoId(restaurantId);
    const currentBalance = await getUserLoyaltyBalance(userId, activeRestoId);

    if (currentBalance < points) {
      return { success: false, error: 'Solde de points insuffisant' };
    }

    const payload: any = {
      user_id: userId,
      points: points,
      type: 'spent',
      description: description || 'Utilisation récompense',
      created_at: new Date().toISOString()
    };

    if (activeRestoId) {
      payload.restaurant_id = activeRestoId;
    }

    const { error } = await supabase
      .from('loyalty_points')
      .insert(payload);

    if (error) {
      console.error('Erreur insert loyalty_points (spent):', error);
      return { success: false, error: error.message };
    }

    await syncProfileLoyaltyPoints(userId, activeRestoId);
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erreur inconnue' };
  }
};

/**
 * THREAD-SAFE : Ajout de points avec verrou
 */
export const addLoyaltyPointsThreadSafe = async (
  userId: string,
  points: number,
  orderId?: number,
  description?: string,
  restaurantId?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    return await executeWithLock(userId, async () => {
      return await addLoyaltyPoints(userId, points, orderId, description, restaurantId);
    });
  } catch (error: any) {
    return { success: false, error: `Transaction failed: ${error.message}` };
  }
};

/**
 * THREAD-SAFE : Débit de points avec verrou
 */
export const spendLoyaltyPointsThreadSafe = async (
  userId: string,
  points: number,
  description: string,
  restaurantId?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    return await executeWithLock(userId, async () => {
      return await spendLoyaltyPoints(userId, points, description, restaurantId);
    });
  } catch (error: any) {
    return { success: false, error: `Transaction failed: ${error.message}` };
  }
};