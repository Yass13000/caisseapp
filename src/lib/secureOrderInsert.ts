// src/lib/secureOrderInsert.ts
/**
 * Secure order insertion utility
 *
 * SECURITY NOTE: This file replaces the unsafe supabaseServiceClient approach.
 * Instead of using service role keys in the frontend (DANGEROUS!), we use the
 * regular anon key and rely on properly configured RLS policies in Supabase.
 *
 * To allow anonymous orders, configure this RLS policy in Supabase:
 *
 * Policy name: "Allow anonymous order creation"
 * Table: orders
 * Policy type: INSERT
 * Target roles: anon
 * USING expression: true
 * WITH CHECK expression: true
 *
 * This is the SECURE way to handle kiosk mode orders.
 */

import { supabase } from './supabaseClient';

export interface OrderPayload {
  user_id?: string;
  order_type_id?: string;
  items: any[];
  total_price: number;
  status: string;
  created_at?: string;
  delivery_address?: any;
  points_earned?: number;
  points_spent?: number;
  [key: string]: any;
}

/**
 * Insert an order using the secure anon client
 * Requires proper RLS policies to be configured in Supabase
 */
export const insertOrder = async (orderPayload: OrderPayload) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .insert(orderPayload)
      .select()
      .single();

    if (error) {
      // Check if this is an RLS policy error
      if (error.code === '42501' || error.message.includes('policy')) {
        
      }

      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'UNKNOWN'
      }
    };
  }
};

/**
 * Helper to check if user is anonymous based on user_id
 */
export const isAnonymousUser = (userId: string | undefined | null): boolean => {
  return !userId || userId === '00000000-0000-0000-0000-000000000000';
};
