// @ts-nocheck
/**
 * Loyalty Code Validation - Server-side security
 */

import { supabase, RESTAURANT_ID } from './supabaseClient';
import { getActiveRestoId, getProfileLoyaltyPoints } from './loyaltyPoints';

export interface LoyaltyCodeValidationResult {
  valid: boolean;
  error?: string;
  profile?: {
    id: string;
    customer_name: string;
    loyalty_points: number;
    loyalty_code: string;
    email?: string;
    restaurant_id?: string;
  };
}

/**
 * Validation sécurisée du code fidélité avec isolation par restaurant
 */
export async function validateLoyaltyCode(
  code: string,
  restaurantId?: string
): Promise<LoyaltyCodeValidationResult> {
  try {
    // 1. Validation du format (exactement 6 chiffres)
    if (!code || typeof code !== 'string') {
      return {
        valid: false,
        error: 'Code invalide'
      };
    }

    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      return {
        valid: false,
        error: 'Le code fidélité doit comporter 6 chiffres'
      };
    }

    const activeRestoId = getActiveRestoId(restaurantId);

    // 2. Requête ciblée sur le restaurant actif
    let query = supabase
      .from('profiles')
      .select('id, customer_name, loyalty_points, loyalty_code, email, restaurant_id')
      .eq('loyalty_code', cleanCode);

    if (activeRestoId) {
      query = query.eq('restaurant_id', activeRestoId);
    }

    const { data: profile, error } = await query
      .limit(1)
      .maybeSingle();

    // 3. Gestion des erreurs
    if (error) {
      console.warn(`[SECURITY] Échec validation code fidélité : ${cleanCode}`, error.message);
      return {
        valid: false,
        error: 'Code de fidélité invalide ou introuvable'
      };
    }

    if (!profile || profile.loyalty_code !== cleanCode) {
      return {
        valid: false,
        error: 'Code de fidélité introuvable pour ce restaurant'
      };
    }

    // 4. Récupération du solde exact et isolé pour ce restaurant
    const realBalance = await getProfileLoyaltyPoints(profile.id, activeRestoId);

    return {
      valid: true,
      profile: {
        id: profile.id,
        customer_name: profile.customer_name || 'Client',
        loyalty_points: realBalance,
        loyalty_code: profile.loyalty_code,
        email: profile.email,
        restaurant_id: profile.restaurant_id
      }
    };

  } catch (error: any) {
    console.error('❌ Erreur validation code fidélité :', error);
    return {
      valid: false,
      error: 'Erreur lors de la validation du code'
    };
  }
}

/**
 * Validation stricte avec contrôle d'identité
 */
export async function validateLoyaltyCodeStrict(
  code: string,
  userId?: string,
  restaurantId?: string
): Promise<LoyaltyCodeValidationResult> {
  try {
    const basicValidation = await validateLoyaltyCode(code, restaurantId);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    if (userId && basicValidation.profile?.id !== userId) {
      console.warn(`[SECURITY] Conflit utilisateur : ${userId} a tenté d'utiliser le code de ${basicValidation.profile?.id}`);
      return {
        valid: false,
        error: 'Ce code ne correspond pas à votre compte'
      };
    }

    return basicValidation;

  } catch (error: any) {
    console.error('❌ Erreur validation stricte :', error);
    return {
      valid: false,
      error: 'Erreur lors de la validation du code'
    };
  }
}

/**
 * Limiteur de tentatives (protection anti force brute)
 */
const validationAttempts = new Map<string, { count: number; resetTime: number }>();

export function isValidationRateLimited(code: string, maxAttempts = 5, windowMs = 60000): boolean {
  const now = Date.now();
  const attempt = validationAttempts.get(code);

  if (!attempt || now > attempt.resetTime) {
    validationAttempts.set(code, { count: 1, resetTime: now + windowMs });
    return false;
  }

  if (attempt.count >= maxAttempts) {
    return true;
  }

  attempt.count++;
  return false;
}

export function clearValidationRateLimit(code: string): void {
  validationAttempts.delete(code);
}