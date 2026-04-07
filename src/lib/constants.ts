// src/lib/constants.ts
/**
 * Application-wide constants
 */

/**
 * UUID spécial pour les commandes anonymes en mode kiosque
 * Utilisé lorsqu'un utilisateur passe commande sans être connecté
 */
export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Nombre de sauces gratuites incluses dans un menu
 */
export const FREE_SAUCES_COUNT = 2;

/**
 * Prix d'une sauce supplémentaire (au-delà des gratuites)
 */
export const EXTRA_SAUCE_PRICE = 0.30;

/**
 * Limite maximale de quantité pour un produit dans le panier
 */
export const MAX_ITEM_QUANTITY = 99;

/**
 * Intervalle de rafraîchissement du statut restaurant (en millisecondes)
 */
export const RESTAURANT_STATUS_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Intervalle de rafraîchissement des points de fidélité (en millisecondes)
 */
export const LOYALTY_POINTS_REFRESH_INTERVAL = 30 * 1000; // 30 secondes

/**
 * TTL du cache pour adaptable data (en millisecondes)
 */
export const ADAPTABLE_DATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
