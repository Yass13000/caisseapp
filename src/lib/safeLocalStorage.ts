// src/lib/safeLocalStorage.ts
/**
 * Safe wrapper around localStorage with JSON validation and error handling
 * Prevents crashes from corrupted localStorage data or quota exceeded errors
 */

export interface SafeStorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Safely get and parse JSON from localStorage
 */
export const safeGetJSON = <T = any>(key: string, defaultValue?: T): T | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return defaultValue ?? null;
    }

    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch (error) {

    // Clean up corrupted data
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // localStorage might be full or unavailable
    }

    return defaultValue ?? null;
  }
};

/**
 * Safely set JSON to localStorage
 */
export const safeSetJSON = (key: string, value: any): SafeStorageResult<void> => {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check if quota exceeded
    if (errorMessage.includes('QuotaExceededError') || errorMessage.includes('quota')) {
      return {
        success: false,
        error: 'QUOTA_EXCEEDED'
      };
    }

    return {
      success: false,
      error: errorMessage
    };
  }
};

/**
 * Safely get a string from localStorage
 */
export const safeGetString = (key: string, defaultValue?: string): string | null => {
  try {
    const value = localStorage.getItem(key);
    return value ?? defaultValue ?? null;
  } catch (error) {
    return defaultValue ?? null;
  }
};

/**
 * Safely set a string to localStorage
 */
export const safeSetString = (key: string, value: string): SafeStorageResult<void> => {
  try {
    localStorage.setItem(key, value);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Safely remove a key from localStorage
 */
export const safeRemove = (key: string): SafeStorageResult<void> => {
  try {
    localStorage.removeItem(key);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Check if localStorage is available and working
 */
export const isLocalStorageAvailable = (): boolean => {
  try {
    const testKey = '__test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Get available localStorage quota (if supported by browser)
 */
export const getStorageQuota = async (): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
} | null> => {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

      return { usage, quota, percentUsed };
    } catch (e) {
      return null;
    }
  }
  return null;
};
