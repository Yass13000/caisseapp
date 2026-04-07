/**
 * Environment Variable Validation
 * 
 * Validates that all required environment variables are present at startup.
 * Prevents runtime errors from missing configuration.
 * 
 * Usage:
 * ```tsx
 * import { validateEnvironment } from '@/lib/envValidation';
 * 
 * validateEnvironment(); // Call in main.tsx before rendering
 * ```
 */

/**
 * Required environment variables for core functionality
 */
interface RequiredEnvVars {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
}

/**
 * Validate required environment variables
 * 
 * @throws Error if any required variable is missing
 * @returns {RequiredEnvVars} The validated environment variables
 * 
 * @example
 * ```tsx
 * try {
 *   const env = validateEnvironment();
 *   console.log('Supabase URL:', env.VITE_SUPABASE_URL);
 * } catch (error) {
 *   console.error('Missing environment variables:', error.message);
 * }
 * ```
 */
export function validateEnvironment(): RequiredEnvVars {
  const required: (keyof RequiredEnvVars)[] = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const missing: string[] = [];

  for (const key of required) {
    const value = import.meta.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}. 
    Please check your .env file or .env.local file.
    See .env.example for required variables.`;
    
    console.error('❌ Environment Validation Error:', message);
    throw new Error(message);
  }

  return {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

/**
 * Get all environment variables (required + optional)
 * 
 * @returns Object with all env variables with defaults
 * 
 * @example
 * ```tsx
 * const env = getEnvironment();
 * console.log('API timeout:', env.apiTimeout); // 30000
 * ```
 */
export function getEnvironment() {
  const validated = validateEnvironment();
  
  return {
    // Required
    supabaseUrl: validated.VITE_SUPABASE_URL,
    supabaseAnonKey: validated.VITE_SUPABASE_ANON_KEY,
    
    // Optional with defaults
    sentryDsn: import.meta.env.VITE_SENTRY_DSN || undefined,
    gaMeasurementId: import.meta.env.VITE_GA_MEASUREMENT_ID || undefined,
    
    // Feature flags
    enableLoyalty: import.meta.env.VITE_ENABLE_LOYALTY !== 'false',
    enableUpsell: import.meta.env.VITE_ENABLE_UPSELL !== 'false',
    enableVariants: import.meta.env.VITE_ENABLE_VARIANTS !== 'false',
    
    // API Configuration
    apiTimeout: parseInt(import.meta.env.VITE_API_TIMEOUT || '30000', 10),
    maxRetries: parseInt(import.meta.env.VITE_MAX_RETRIES || '3', 10),
    retryBackoffMs: parseInt(import.meta.env.VITE_RETRY_BACKOFF_MS || '1000', 10),
  };
}

/**
 * Check if running in development mode
 */
export const isDev = import.meta.env.DEV;

/**
 * Check if running in production mode
 */
export const isProd = import.meta.env.PROD;

/**
 * Get environment name
 */
export const envMode = import.meta.env.MODE; // 'development' or 'production'
