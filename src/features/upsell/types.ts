// Types pour les produits de vente additionnelle (upsell)
// Utilise l'interface Product existante
import { Product } from '@/types';

export type UpsellProduct = Product;

export interface UpsellModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (product: UpsellProduct) => void;
  products: UpsellProduct[];
}
