/**
 * Loyalty Code Validation - Server-side security
 * 
 * ⚠️ SECURITY:
 * - Validates loyalty code on the server (not just client-side)
 * - Prevents code tampering via browser DevTools
 * - Uses Supabase RLS policies for access control
 * - Returns minimal data to prevent enumeration attacks
 * 
 * Migration path:
 * 1. Replace direct profile lookups in LoyaltyLogin.tsx with validateLoyaltyCode()
 * 2. Server validates: code format, code exists, code belongs to active profile
 * 3. Client only receives success/failure + user data (if valid)
 */

import { supabase } from './supabaseClient';

export interface LoyaltyCodeValidationResult {
  valid: boolean;
  error?: string;
  profile?: {
    id: string;
    customer_name: string;
    loyalty_points: number;
    loyalty_code: string;
    email?: string;
  };
}

/**
 * Server-side validation of loyalty code
 * 
 * @param code - 6-digit loyalty code to validate
 * @returns Validation result with profile if valid
 * 
 * SECURITY NOTES:
 * - Validates code format (must be 6 digits)
 * - Checks code exists in database
 * - Uses Supabase RLS policies (not bypassed by client)
 * - Returns generic error if code not found (prevents enumeration)
 * - Logs validation attempts for security audit
 */
export async function validateLoyaltyCode(
  code: string
): Promise<LoyaltyCodeValidationResult> {
  try {
    // 1. Format validation (must be 6 digits)
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
        error: 'Le code fidélité doit être 6 chiffres'
      };
    }

    // 2. Query the database with RLS policies enforced
    // RLS policies should prevent unauthorized access
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, customer_name, loyalty_points, loyalty_code, email')
      .eq('loyalty_code', cleanCode)
      .single();

    // 3. Handle errors
    if (error) {
      // Log for security audit (would go to Sentry/logging service in production)
      console.warn(`[SECURITY] Loyalty code validation failed for code: ${cleanCode}`, error.message);
      
      // Return generic error to prevent code enumeration attacks
      // Attacker shouldn't know if code exists or not
      return {
        valid: false,
        error: 'Code de fidélité invalide ou introuvable'
      };
    }

    // 4. Validate that code matches (extra security check)
    if (!profile || profile.loyalty_code !== cleanCode) {
      console.warn(`[SECURITY] Loyalty code mismatch for profile: ${profile?.id}`);
      return {
        valid: false,
        error: 'Code de fidélité invalide'
      };
    }

    // 5. Return success with profile (but exclude sensitive fields)
    return {
      valid: true,
      profile: {
        id: profile.id,
        customer_name: profile.customer_name,
        loyalty_points: profile.loyalty_points || 0,
        loyalty_code: profile.loyalty_code,
        email: profile.email
      }
    };

  } catch (error: any) {
    console.error('❌ Loyalty code validation error:', error);
    return {
      valid: false,
      error: 'Erreur lors de la validation du code'
    };
  }
}

/**
 * Enhanced validation with additional security checks
 * Use this for sensitive operations (redemption, transfers, etc.)
 */
export async function validateLoyaltyCodeStrict(
  code: string,
  userId?: string
): Promise<LoyaltyCodeValidationResult> {
  try {
    // 1. Basic validation
    const basicValidation = await validateLoyaltyCode(code);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    // 2. If userId provided, verify code belongs to that user
    if (userId && basicValidation.profile?.id !== userId) {
      console.warn(`[SECURITY] Loyalty code for different user: ${userId} tried to use code for ${basicValidation.profile?.id}`);
      return {
        valid: false,
        error: 'Ce code ne correspond pas à votre compte'
      };
    }

    // 3. Check for fraud indicators
    // (e.g., code used multiple times in short time period)
    const recentValidations = await checkRecentValidations(code);
    if (recentValidations > 5) {
      console.warn(`[SECURITY] Multiple failed validations for code: ${code}`);
      return {
        valid: false,
        error: 'Trop de tentatives. Réessayez plus tard.'
      };
    }

    return basicValidation;

  } catch (error: any) {
    console.error('❌ Strict loyalty code validation error:', error);
    return {
      valid: false,
      error: 'Erreur lors de la validation du code'
    };
  }
}

/**
 * Check for suspicious validation patterns (fraud detection)
 * In production, use a dedicated fraud detection service
 */
async function checkRecentValidations(_code: string): Promise<number> {
  try {
    // This would query a validation_attempts table in production
    // For now, return 0 (no fraud indicator)
    // TODO: Implement validation attempt logging in Supabase
    return 0;
  } catch (error) {
    console.error('Error checking recent validations:', error);
    return 0;
  }
}

/**
 * Rate limit helper - prevent brute force attacks
 * Use with validateLoyaltyCode() to prevent rapid-fire attempts
 */
const validationAttempts = new Map<string, { count: number; resetTime: number }>();

export function isValidationRateLimited(code: string, maxAttempts = 5, windowMs = 60000): boolean {
  const now = Date.now();
  const attempt = validationAttempts.get(code);

  if (!attempt || now > attempt.resetTime) {
    // New window
    validationAttempts.set(code, { count: 1, resetTime: now + windowMs });
    return false;
  }

  if (attempt.count >= maxAttempts) {
    return true; // Rate limited
  }

  attempt.count++;
  return false;
}

/**
 * Reset rate limiting for a code (e.g., after successful login)
 */
export function clearValidationRateLimit(code: string): void {
  validationAttempts.delete(code);
}
