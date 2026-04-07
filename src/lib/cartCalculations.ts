// src/lib/cartCalculations.ts
/**
 * Centralized cart calculation utilities
 * Eliminates code duplication for price calculations across the app
 * 
 * @module cartCalculations
 * @requires CartItem from @/types
 * @requires Constants: FREE_SAUCES_COUNT, EXTRA_SAUCE_PRICE
 * 
 * All price calculations use this module to ensure consistency.
 * DO NOT implement price calculation logic elsewhere.
 */

import { CartItem } from '@/types';
import { OptionSubChoice } from '@/features/menu/types';
import { FREE_SAUCES_COUNT, EXTRA_SAUCE_PRICE } from '@/lib/constants';

/**
 * Calculate the extra price for sauces based on quantity
 * 
 * Business rule: First FREE_SAUCES_COUNT sauces are free,
 * then EXTRA_SAUCE_PRICE per additional sauce
 * 
 * @param {OptionSubChoice[]} subChoices - Array of sauce choices with quantities
 * @returns {number} Extra price for sauces beyond the free limit
 * 
 * @example
 * // Returns 0.60 (2 sauces * 0.30€, first 2 are free)
 * calculateSaucesPrice([
 *   { name: 'Mayo', quantity: 2 },
 *   { name: 'Ketchup', quantity: 2 }
 * ]);
 */
export const calculateSaucesPrice = (subChoices: OptionSubChoice[]): number => {
  if (!subChoices || !Array.isArray(subChoices)) return 0;

  // Compter le nombre total de sauces en tenant compte des quantités
  const totalSauces = subChoices.reduce(
    (sum, subChoice) => sum + (subChoice.quantity || 1),
    0
  );

  // FREE_SAUCES_COUNT premières sauces gratuites, puis EXTRA_SAUCE_PRICE par sauce supplémentaire
  const extraSauces = Math.max(0, totalSauces - FREE_SAUCES_COUNT);
  return extraSauces * EXTRA_SAUCE_PRICE;
};

/**
 * Calculate the total price for a single cart item (without quantity multiplier)
 * 
 * Includes:
 * - Base product price
 * - Boisson (drink) price
 * - Accompagnement (side) price
 * - All sub-choices (sauces, options, etc.)
 * 
 * @param {CartItem} item - The cart item to calculate price for
 * @returns {number} Total price for one unit of the item
 * 
 * @throws {Error} If item or item.product is undefined
 * 
 * @example
 * const item = {
 *   product: { id: 1, name: 'Burger', price: 10 },
 *   quantity: 2,
 *   boisson: { name: 'Coca', price: 2.5 },
 *   boissonSubChoices: [{ name: 'Mayo', price: 0 }]
 * };
 * 
 * calculateItemTotal(item); // Returns 12.5 (not multiplied by quantity)
 */
export const calculateItemTotal = (item: CartItem): number => {
  // Si c'est un produit fidélité, il est gratuit (payé avec des points)
  if (item.isReward) {
    return 0;
  }

  let itemTotal = item.product.price || 0;

  // Add boisson price
  if (item.boisson) {
    itemTotal += item.boisson.price || 0;
  }

  // Add accompagnement price
  if (item.accompagnement) {
    itemTotal += item.accompagnement.price || 0;
  }

  // Add boisson sub-choices (with sauce pricing logic)
  if (item.boissonSubChoices && Array.isArray(item.boissonSubChoices)) {
    itemTotal += calculateSaucesPrice(item.boissonSubChoices);
  }

  // Add accompagnement sub-choices (with sauce pricing logic)
  if (item.accompagnementSubChoices && Array.isArray(item.accompagnementSubChoices)) {
    itemTotal += calculateSaucesPrice(item.accompagnementSubChoices);
  }

  // Add selectedSubOptions prices (nouveau format groupé)
  if (item.selectedSubOptions && Array.isArray(item.selectedSubOptions)) {
    item.selectedSubOptions.forEach((group: any) => {
      if (group.options && Array.isArray(group.options)) {
        group.options.forEach((option: any) => {
          if (option.price) {
            itemTotal += option.price;
          }
        });
      }
    });
  }

  // Add directSubOptions prices (ancien format legacy)
  if ((item as any).directSubOptions && Array.isArray((item as any).directSubOptions)) {
    (item as any).directSubOptions.forEach((option: any) => {
      if (option.price) {
        itemTotal += option.price;
      }
    });
  }

  return itemTotal;
};

/**
 * Calculate the total price for a cart item including quantity multiplier
 * 
 * @param {CartItem} item - The cart item to calculate price for
 * @returns {number} Total price for the item including quantity
 * 
 * @example
 * const item = {
 *   product: { id: 1, name: 'Burger', price: 10 },
 *   quantity: 2,
 *   boisson: { name: 'Coca', price: 2.5 }
 * };
 * 
 * calculateItemTotalWithQuantity(item); // Returns 25 (12.5 * 2)
 */
export const calculateItemTotalWithQuantity = (item: CartItem): number => {
  const unitPrice = calculateItemTotal(item);
  return unitPrice * (item.quantity || 1);
};

/**
 * Calculate the subtotal for an entire cart
 * 
 * Sums up all item totals including their quantities.
 * This is the amount before delivery fees, taxes, or discounts.
 * 
 * @param {CartItem[]} items - Array of cart items
 * @returns {number} Total subtotal for the entire cart
 * 
 * @example
 * const items = [
 *   { product: { price: 10 }, quantity: 2 },
 *   { product: { price: 5 }, quantity: 1 }
 * ];
 * 
 * calculateCartSubtotal(items); // Returns 25
 */
export const calculateCartSubtotal = (items: CartItem[]): number => {
  return items.reduce((sum, item) => {
    return sum + calculateItemTotalWithQuantity(item);
  }, 0);
};

/**
 * Calculate how many loyalty points are "locked" (spent) in reward items in the cart
 * 
 * Reward items are special items purchased with loyalty points.
 * This function calculates the total points tied up in those items.
 * 
 * @param {CartItem[]} items - Array of cart items
 * @returns {number} Total loyalty points locked in reward items
 * 
 * @example
 * const items = [
 *   { product: { id: 1, price: 5 }, isReward: true, rewardPoints: 100, quantity: 2 }
 * ];
 * 
 * calculateRewardPointsInCart(items); // Returns 200 (100 points * 2 quantity)
 */
export const calculateRewardPointsInCart = (items: CartItem[]): number => {
  return items
    .filter((item) => item?.isReward && item?.rewardPoints)
    .reduce((sum, item) => sum + (item.rewardPoints || 0) * (item.quantity || 1), 0);
};

/**
 * Format a price for display in EUR currency
 * 
 * @param {number} price - Price to format
 * @returns {string} Formatted price string (e.g., "12.50")
 * 
 * @example
 * formatPrice(12); // Returns "12.00"
 * formatPrice(12.5); // Returns "12.50"
 */
export const formatPrice = (price: number): string => {
  return price.toFixed(2);
};

/**
 * Cart statistics snapshot
 * 
 * @typedef {Object} CartStats
 * @property {number} subtotal - Total cart subtotal (before taxes/fees)
 * @property {number} itemCount - Total number of individual items
 * @property {number} rewardPointsLocked - Loyalty points spent on rewards
 * @property {boolean} hasRewardItems - Whether cart contains reward items
 */
export interface CartStats {
  subtotal: number;
  itemCount: number;
  rewardPointsLocked: number;
  hasRewardItems: boolean;
}

/**
 * Calculate comprehensive cart statistics
 * 
 * Useful for displaying cart summary information.
 * 
 * @param {CartItem[]} items - Array of cart items
 * @returns {CartStats} Object containing cart statistics
 * 
 * @example
 * const stats = calculateCartStats(cartItems);
 * console.log(`Total: €${stats.subtotal}, Items: ${stats.itemCount}`);
 */
export const calculateCartStats = (items: CartItem[]): CartStats => {
  const subtotal = calculateCartSubtotal(items);
  const itemCount = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const rewardPointsLocked = calculateRewardPointsInCart(items);
  const hasRewardItems = items.some((item) => item?.isReward);

  return {
    subtotal,
    itemCount,
    rewardPointsLocked,
    hasRewardItems,
  };
};
