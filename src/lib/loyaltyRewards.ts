// @ts-nocheck
import { supabase, RESTAURANT_ID } from './supabaseClient';
import { spendLoyaltyPointsThreadSafe, getActiveRestoId } from './loyaltyPoints';

export interface RewardTier {
  id: number;
  threshold_points: number; // ex: 40, 80, 120, 150, 200
  label?: string | null;
  active?: boolean | null;
}

export interface RewardProductLink {
  id: number;
  tier_id: number;
  product_id: number;
}

export interface ProductRow {
  id: number;
  name: string;
  image_url?: string | null;
  price?: number | null;
  [key: string]: any;
}

export const getRewardTiers = async (): Promise<RewardTier[]> => {
  const { data, error } = await supabase
    .from('loyalty_reward_tier')
    .select('*')
    .order('threshold_points');
  if (error) throw error;
  return (data || []) as RewardTier[];
};

export const createRewardTier = async (threshold_points: number, label?: string) => {
  const { data, error } = await supabase
    .from('loyalty_reward_tier')
    .insert({ threshold_points, label, active: true })
    .select()
    .single();
  if (error) throw error;
  return data as RewardTier;
};

export const deleteRewardTier = async (id: number) => {
  const { error } = await supabase
    .from('loyalty_reward_tier')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

export const listProducts = async (): Promise<ProductRow[]> => {
  const { data, error } = await supabase
    .from('product')
    .select('*')
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []) as ProductRow[];
};

export const getTierProducts = async (tier_id: number): Promise<(RewardProductLink & { product: ProductRow })[]> => {
  const { data, error } = await supabase
    .from('loyalty_reward_product')
    .select('id, tier_id, product_id, product:product(*)')
    .eq('tier_id', tier_id)
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []) as any;
};

export const addProductToTier = async (tier_id: number, product_id: number) => {
  const { data, error } = await supabase
    .from('loyalty_reward_product')
    .insert({ tier_id, product_id })
    .select()
    .single();
  if (error) throw error;
  return data as RewardProductLink;
};

export const removeProductFromTier = async (id: number) => {
  const { error } = await supabase
    .from('loyalty_reward_product')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

export const redeemReward = async (
  userId: string,
  productId: number,
  tierId: number,
  pointsCost: number,
  restaurantId?: string
) => {
  const activeRestoId = getActiveRestoId(restaurantId);

  // 1. Débit des points avec verrou thread-safe et ID restaurant garanti
  const spend = await spendLoyaltyPointsThreadSafe(
    userId,
    pointsCost,
    `Récompense palier ${pointsCost} (Produit #${productId})`,
    activeRestoId
  );

  if (!spend.success) {
    return { success: false, error: spend.error || 'Impossible de déduire les points' };
  }

  // 2. Enregistrement de la rédemption (sans .select().single() pour éviter les blocages RLS)
  try {
    const payload: any = {
      user_id: userId,
      product_id: productId,
      tier_id: tierId,
      points_spent: pointsCost,
      created_at: new Date().toISOString()
    };

    if (activeRestoId) {
      payload.restaurant_id = activeRestoId;
    }

    await supabase
      .from('loyalty_redemption')
      .insert(payload);
  } catch (e) {
    console.warn('Trace loyalty_redemption ignorée:', e);
  }

  return { success: true };
};