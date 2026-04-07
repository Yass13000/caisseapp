import { supabase } from './supabaseClient';
import { spendLoyaltyPoints } from './loyaltyPoints';

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

export const redeemReward = async (userId: string, productId: number, tierId: number, pointsCost: number) => {
  // D'abord déduire les points (fail si solde insuffisant)
  const spend = await spendLoyaltyPoints(userId, pointsCost, `Récompense palier ${pointsCost} pour produit ${productId}`);
  if (!spend.success) {
    return { success: false, error: spend.error || 'Impossible de déduire les points' };
  }
  // Puis enregistrer la rédemption
  const { data, error } = await supabase
    .from('loyalty_redemption')
    .insert({ user_id: userId, product_id: productId, tier_id: tierId, points_spent: pointsCost })
    .select()
    .single();
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, data };
};
