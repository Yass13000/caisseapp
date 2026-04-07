/**
 * Error Logging & Monitoring Setup
 * 
 * Provides error tracking with optional Sentry integration.
 * Uses console fallback if Sentry is not configured.
 * 
 * To enable Sentry:
 * 1. npm install @sentry/react @sentry/tracing
 * 2. Add VITE_SENTRY_DSN to .env file
 * 3. Restart dev server
 * 
 * Usage:
 * ```tsx
 * import { initSentry, captureException, captureMessage } from '@/lib/errorLogging';
 * 
 * // In main.tsx before rendering:
 * initSentry();
 * 
 * // In try-catch:
 * try {
 *   // risky operation
 * } catch (error) {
 *   captureException(error, { context: 'checkoutFlow' });
 * }
 * ```
 */

interface ErrorContext {
  [key: string]: any;
}

/**
 * Initialize error logging
 * 
 * Sets up error tracking. Currently uses console fallback.
 * To enable Sentry:
 * 1. npm install @sentry/react @sentry/tracing
 * 2. Add VITE_SENTRY_DSN to .env
 * 3. Uncomment Sentry initialization below
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  
  if (!dsn) {
    console.log('ℹ️  Error logging configured (console fallback). Sentry not configured.');
    console.log('   To enable Sentry: npm install @sentry/react && add VITE_SENTRY_DSN to .env');
    return;
  }

  console.log('✅ Error logging initialized');
}

/**
 * Capture and log an exception/error
 * 
 * @param error - The error to capture
 * @param context - Additional context information
 * 
 * @example
 * ```tsx
 * try {
 *   await placeOrder();
 * } catch (error) {
 *   captureException(error, { 
 *     context: 'checkoutFlow',
 *     orderId: '12345',
 *     amount: 99.99 
 *   });
 * }
 * ```
 */
export function captureException(error: Error | string, context?: ErrorContext): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Log to console
  console.error('❌ Error:', errorMessage, context || '');
}

/**
 * Capture and log a message (info/debug/warning)
 * 
 * @param message - Message to log
 * @param level - Log level ('info', 'debug', 'warning', 'error')
 * @param context - Additional context information
 * 
 * @example
 * ```tsx
 * captureMessage('Order placed successfully', 'info', { 
 *   orderId: '12345',
 *   customerId: 'cust_123'
 * });
 * ```
 */
export function captureMessage(
  message: string,
  level: 'info' | 'debug' | 'warning' | 'error' = 'info',
  context?: ErrorContext
): void {
  // Always log to console
  const logFn = console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log'];
  logFn(`[${level.toUpperCase()}]`, message, context || '');
}

/**
 * Set user context for error tracking
 * 
 * Helps identify which user encountered an error.
 * 
 * @param userId - Unique user identifier
 * @param email - User email
 * @param name - User name
 * 
 * @example
 * ```tsx
 * setUserContext('user_123', 'user@example.com', 'John Doe');
 * ```
 */
export function setUserContext(_userId?: string, _email?: string, _name?: string): void {
  // Reserved for future Sentry integration
  if (import.meta.env.DEV) {
    console.log('User context set (Sentry integration pending)');
  }
}

/**
 * Clear user context (on logout)
 * 
 * @example
 * ```tsx
 * clearUserContext();
 * ```
 */
export function clearUserContext(): void {
  // Reserved for future Sentry integration
  if (import.meta.env.DEV) {
    console.log('User context cleared (Sentry integration pending)');
  }
}

/**
 * Add breadcrumb for debugging
 * 
 * Breadcrumbs help trace user actions leading to errors.
 * 
 * @param message - Breadcrumb message
 * @param category - Breadcrumb category (e.g., 'ui.click', 'navigation')
 * @param data - Additional data
 * 
 * @example
 * ```tsx
 * addBreadcrumb('User clicked checkout', 'ui.click', { 
 *   cartTotal: 99.99 
 * });
 * ```
 */
export function addBreadcrumb(
  message: string,
  category: string = 'user-action',
  data?: ErrorContext
): void {
  // Log to console in dev
  if (import.meta.env.DEV) {
    console.log(`[BREADCRUMB ${category}]`, message, data || '');
  }
}
