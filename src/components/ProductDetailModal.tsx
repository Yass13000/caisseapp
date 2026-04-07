import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Product {
  id: number;
  name: string;
  description?: string;
  price: number;
  image?: string;
  is_available?: boolean;
  linked_sub_options?: any[];
}

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
  onOrder: (product: Product) => void;
}

/**
 * Modal optimisé pour afficher les détails d'un produit
 * Positionné en haut de l'écran, sans animations complexes
 */
export default function ProductDetailModal({ product, onClose, onOrder }: ProductDetailModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="bg-cream rounded-3xl shadow-2xl w-[90%] max-w-2xl max-h-[88vh] flex flex-col overflow-hidden font-helvetica"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header avec bouton fermeture */}
        <div className="bg-secondary text-white px-6 py-5 flex items-center justify-between">
          <h2 className="text-2xl font-bold font-dunkin">Description du produit</h2>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 p-2 rounded-full transition-colors"
            aria-label="Fermer"
          >
            <X className="h-7 w-7" />
          </button>
        </div>

        {/* Image du produit */}
        {product.image && (
          <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center" style={{ height: '260px' }}>
            <img
              src={product.image}
              alt={product.name}
              className="max-w-full max-h-full object-contain"
              style={{
                width: 'auto',
                height: 'auto',
                maxWidth: '95%',
                maxHeight: '95%'
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder.svg';
              }}
            />
            {product.is_available === false && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center backdrop-blur-sm">
                <div className="bg-red-600 text-white px-8 py-4 rounded-2xl font-bold text-2xl shadow-2xl">
                  ÉPUISÉ
                </div>
              </div>
            )}
          </div>
        )}

        {/* Contenu scrollable */}
        <div className="flex-1 px-6 py-5 overflow-y-auto">
          {/* Nom et prix */}
          <div className="mb-4">
            <h3 className="text-3xl font-bold text-secondary mb-3 font-dunkin">
              {product.name}
            </h3>
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold text-primary font-dunkin">
                {(product.price || 0).toFixed(2)} €
              </span>
              {product.is_available !== false ? (
                <span className="bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-semibold">
                  ✓ Disponible
                </span>
              ) : (
                <span className="bg-red-100 text-red-800 px-4 py-2 rounded-full text-sm font-semibold">
                  ✗ Épuisé
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div>
              <h4 className="text-lg font-bold text-gray-800 mb-2 font-helvetica">
                Description
              </h4>
              <p className="text-base text-gray-700 leading-relaxed font-helvetica">
                {product.description}
              </p>
            </div>
          )}

          {/* Message d'indisponibilité */}
          {product.is_available === false && (
            <div className="mt-5 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg">
              <div className="flex items-center">
                <div className="mr-3">
                  <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div>
                  <p className="text-red-800 font-semibold">Vous l'avez épuisé</p>
                  <p className="text-red-700 text-sm">Ce produit n'est pas disponible actuellement.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Boutons */}
        <div className="flex gap-4 p-5 border-t-2 border-gray-200 bg-gray-50">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1 py-6 text-xl font-bold text-gray-700 border-3 border-gray-400 bg-cream hover:bg-gray-100 rounded-xl shadow-lg font-helvetica"
          >
            Retour
          </Button>

          {product.is_available !== false && (
            <Button
              onClick={() => {
                onOrder(product);
                onClose();
              }}
              className="flex-1 py-6 text-xl font-bold bg-secondary hover:bg-secondary/90 text-white rounded-xl shadow-xl font-helvetica"
            >
              Ajouter au panier
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
