/**
 * Improved scroll lock utility with support for nested modals
 * Uses a reference counter to handle multiple lock/unlock calls correctly
 */

let scrollPosition = 0;
let lockCount = 0; // Reference counter for nested modals

/**
 * Lock the scroll - can be called multiple times for nested modals
 * Each lockScroll() call must have a corresponding unlockScroll() call
 */
export const lockScroll = () => {
  lockCount++;

  // Only lock on the first call
  if (lockCount === 1) {
    // Sauvegarder la position de scroll actuelle
    scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

    // Appliquer la classe scroll-locked (simple overflow: hidden)
    document.body.classList.add('scroll-locked');

  } else {
  }
};

/**
 * Unlock the scroll - decrements the reference counter
 * Only actually unlocks when all modals are closed (count reaches 0)
 */
export const unlockScroll = () => {
  if (lockCount <= 0) {
    return;
  }

  lockCount--;

  // Only unlock when no more modals are open
  if (lockCount === 0) {
    // Retirer la classe
    document.body.classList.remove('scroll-locked');

    // Restaurer la position de scroll
    window.scrollTo(0, scrollPosition);

    scrollPosition = 0;
  } else {
  }
};

/**
 * Check if scroll is currently locked
 */
export const isScrollLocked = () => lockCount > 0;

/**
 * Get the current lock count (useful for debugging)
 */
export const getLockCount = () => lockCount;

/**
 * Force unlock scroll (emergency escape hatch)
 * Use only in error recovery scenarios
 */
export const forceUnlockScroll = () => {
  lockCount = 0;
  document.body.classList.remove('scroll-locked');
  scrollPosition = 0;
};

/**
 * Hook-like interface for easier usage in components
 */
export const useScrollLock = () => {
  const lock = () => lockScroll();
  const unlock = () => unlockScroll();

  return {
    lock,
    unlock,
    isLocked: isScrollLocked(),
    lockCount: getLockCount()
  };
};