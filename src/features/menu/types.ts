import { Product as CoreProduct, Category as CoreCategory } from '@/types';
/**
 * Menu Feature Types
 * Centralized view-model and customization related types for the menu domain.
 * Recent consolidation: OptionSubChoice + related maps moved here to remove
 * duplicate interface declarations previously found in Menu.tsx, OptionsModal.tsx, and CartContext.tsx.
 * All future option/sub-choice related shapes should be added here to keep a single source of truth.
 */

// ViewModel simplifié pour les cartes produits (évite d'exposer tout l'objet complet si lourd)
export interface ProductCardVM {
  id: string | number; // source hétérogène
  name: string;
  price: number;
  image_url?: string;
  image?: string; // legacy fallback
  is_available: boolean;
  category_id?: string;
}

export interface CategoryCardVM {
  id?: string;
  name: string;
  description?: string;
  image?: string;
}

// Helpers de transformation depuis le core model vers ViewModel
export function toProductCardVM(p: any): ProductCardVM {
  return {
    id: p.id,
    name: p.name,
    price: typeof p.price === 'number' ? p.price : parseFloat(p.price) || 0,
    image_url: p.image_url,
    image: p.image,
    is_available: typeof p.is_available === 'boolean' ? p.is_available : true,
    category_id: p.category_id || p.category,
  };
}

export function toCategoryCardVM(raw: any): CategoryCardVM {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    image: raw.image,
  };
}

// ---- Options & Customization Types (centralized) ----
export interface OptionSubChoice {
  id: number;
  parent_option_id: number;
  name: string;
  price: number;
  image?: string;
  is_default: boolean;
  quantity?: number; // Quantité sélectionnée (pour le système de sauces)
}

// Maps for sub choices (optionId -> array of sub choices)
export type SubChoicesDataMap = { [optionId: number]: OptionSubChoice[] };
// Selected sub choices per option
export type SelectedSubChoicesMap = { [optionId: number]: OptionSubChoice[] };
// Direct linked sub options (if you later normalize this)
export type ProductSubOptionsMap = { [productId: number]: number[] };

