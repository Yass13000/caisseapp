/**
 * Transaction Locking System
 * 
 * Prevents race conditions when multiple orders are processed simultaneously
 * Uses advisory locks to ensure atomic transactions on loyalty points
 * 
 * Problem: 2 users can spend points at the same time, leading to overspendin
 * Solution: Lock the user's profile during transaction
 */

import { supabase } from './supabaseClient';

export interface TransactionLockResult {
  locked: boolean;
  error?: string;
  lockId?: string;
}

export interface TransactionReleaseResult {
  released: boolean;
  error?: string;
}

/**
 * Acquire an advisory lock for a specific user's loyalty points
 * Advisory locks in Supabase are managed via PostgreSQL bigint locks
 * We generate a consistent ID based on user ID for deterministic locking
 */
export async function acquireTransactionLock(
  userId: string,
  timeoutMs: number = 5000
): Promise<TransactionLockResult> {
  try {
    if (!userId) {
      return { locked: false, error: 'User ID required' };
    }

    // Generate a consistent lock ID based on user ID
    // Using CRC32-like hash to get a number that won't overflow
    const lockId = generateLockId(userId);

    // Use a timeout to prevent deadlocks
    // In production, use Supabase RPC or direct PostgreSQL connection
    // For now, simulate with a simple in-memory lock mechanism
    const acquiredLock = await acquireMemoryLock(lockId, timeoutMs);

    if (!acquiredLock) {
      return {
        locked: false,
        error: `Could not acquire lock within ${timeoutMs}ms`
      };
    }

    return {
      locked: true,
      lockId: lockId.toString()
    };

  } catch (error: any) {
    console.error('❌ Error acquiring transaction lock:', error);
    return {
      locked: false,
      error: error.message
    };
  }
}

/**
 * Release a previously acquired lock
 */
export async function releaseTransactionLock(
  lockId: string
): Promise<TransactionReleaseResult> {
  try {
    if (!lockId) {
      return { released: false, error: 'Lock ID required' };
    }

    releaseMemoryLock(parseInt(lockId, 10));

    return { released: true };

  } catch (error: any) {
    console.error('❌ Error releasing transaction lock:', error);
    return {
      released: false,
      error: error.message
    };
  }
}

/**
 * Execute an async function within a transaction lock
 * Automatically acquires and releases the lock
 * 
 * Usage:
 * ```typescript
 * await executeWithLock(userId, async () => {
 *   // Spend points
 *   await spendLoyaltyPoints(userId, 100);
 *   // Add points
 *   await addLoyaltyPoints(userId, 50);
 * });
 * ```
 */
export async function executeWithLock<T>(
  userId: string,
  fn: () => Promise<T>,
  timeoutMs: number = 5000
): Promise<T> {
  const lockResult = await acquireTransactionLock(userId, timeoutMs);

  if (!lockResult.locked) {
    throw new Error(`Could not acquire lock: ${lockResult.error}`);
  }

  try {
    // Execute the transaction
    const result = await fn();
    return result;
  } catch (error) {
    console.error('❌ Error during locked transaction:', error);
    throw error;
  } finally {
    // Always release the lock
    if (lockResult.lockId) {
      const releaseResult = await releaseTransactionLock(lockResult.lockId);
      if (!releaseResult.released) {
        console.warn('⚠️ Warning: Could not release transaction lock:', releaseResult.error);
      }
    }
  }
}

/**
 * Alternative: Use Supabase RPC to acquire PostgreSQL advisory lock
 * This is more robust but requires a custom Edge Function
 * 
 * Create this RPC function in Supabase:
 * ```sql
 * CREATE OR REPLACE FUNCTION acquire_user_lock(user_id UUID)
 * RETURNS BOOLEAN AS $$
 * BEGIN
 *   PERFORM pg_advisory_lock(hashtext(user_id::text)::bigint);
 *   RETURN TRUE;
 * EXCEPTION WHEN OTHERS THEN
 *   RETURN FALSE;
 * END;
 * $$ LANGUAGE plpgsql;
 * ```
 */
export async function acquirePostgresAdvisoryLock(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('acquire_user_lock', {
      user_id: userId
    });

    if (error) {
      console.error('❌ Error acquiring advisory lock:', error);
      return false;
    }

    return data === true;
  } catch (error: any) {
    console.error('❌ Exception acquiring advisory lock:', error);
    return false;
  }
}

/**
 * Release PostgreSQL advisory lock
 */
export async function releasePostgresAdvisoryLock(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('release_user_lock', {
      user_id: userId
    });

    if (error) {
      console.error('❌ Error releasing advisory lock:', error);
      return false;
    }

    return data === true;
  } catch (error: any) {
    console.error('❌ Exception releasing advisory lock:', error);
    return false;
  }
}

// ============================================================================
// Internal: In-Memory Lock Implementation
// ============================================================================

// Simple in-memory lock tracker
// In production, use proper locking mechanism (Redis, Database, etc.)
const locks = new Map<number, { acquiredAt: number; timeout: number }>();

/**
 * Generate a consistent numeric lock ID from user ID
 */
function generateLockId(userId: string): number {
  // Simple hash function - converts string to stable number
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Try to acquire an in-memory lock with timeout
 */
async function acquireMemoryLock(lockId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = 50; // Check every 50ms

    const tryLock = () => {
      const now = Date.now();

      // Check if lock exists and is expired
      const existingLock = locks.get(lockId);
      if (existingLock && now < existingLock.acquiredAt + existingLock.timeout) {
        // Lock is still held
        if (now - startTime > timeoutMs) {
          // Timed out waiting for lock
          resolve(false);
        } else {
          // Try again after a short delay
          setTimeout(tryLock, checkInterval);
        }
        return;
      }

      // Lock is free or expired, acquire it
      locks.set(lockId, {
        acquiredAt: now,
        timeout: 30000 // Default 30 second lock timeout
      });

      resolve(true);
    };

    tryLock();
  });
}

/**
 * Release an in-memory lock
 */
function releaseMemoryLock(lockId: number): void {
  locks.delete(lockId);
}
