import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Utensils } from 'lucide-react';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

interface MenuOrSoloModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: any;
  onSelectChoice: (modifiedProduct: any, isSolo: boolean) => void;
}

export const MenuOrSoloModal: React.FC<MenuOrSoloModalProps> = ({
  isOpen,
  onClose,
  product,
  onSelectChoice
}) => {
  useEffect(() => {
    if (isOpen) {
      lockScroll();
      document.body.classList.add('popup-open');
    } else {
      unlockScroll();
      document.body.classList.remove('popup-open');
    }
    return () => {
      unlockScroll();
      document.body.classList.remove('popup-open');
    };
  }, [isOpen]);

  if (!isOpen || !product) return null;

  // Calcul du nom et du prix pour la version "Seul"
  const baseName = product.name.replace(/^Menu\s+/i, '');
  const soloName = `${baseName} seul`;
  const soloPrice = Math.max(0, product.price - 1.50);

  const handleMenuClick = () => {
    onSelectChoice({ ...product, isSolo: false }, false);
  };

  const handleSoloClick = () => {
    const soloProduct = {
      ...product,
      name: soloName,
      price: soloPrice,
      isSolo: true
    };
    onSelectChoice(soloProduct, true);
  };

  // Récupérer l'image du produit si elle existe
  const productImage = product.image_url || product.image;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/60 md:backdrop-blur-sm font-helvetica pt-12 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative w-full max-w-5xl bg-cream rounded-3xl shadow-2xl p-12 mt-10 border-t-8 border-[#DC2626]"
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ type: 'tween', ease: 'easeOut', duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Bouton de fermeture plus esthétique */}
            <button 
              type="button" 
              onClick={onClose} 
              className="absolute top-6 right-6 bg-gray-200 hover:bg-gray-300 rounded-full p-2 transition-colors" 
              aria-label="Fermer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-8 h-8 text-secondary" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>

            {/* En-tête avec image dynamique du produit */}
            <div className="mb-10 flex flex-col items-center text-center">
              {productImage ? (
                <div className="relative w-44 h-44 mb-6 rounded-2xl bg-white shadow-xl p-2 border-2 border-gray-100 transform -rotate-2">
                  <img src={productImage} alt={baseName} className="w-full h-full object-cover rounded-xl" />
                  <div className="absolute -bottom-4 -right-4 bg-[#FBBF24] text-yellow-900 font-black tracking-wider text-lg px-5 py-1.5 rounded-full shadow-md transform rotate-6 uppercase">
                    Menu
                  </div>
                </div>
              ) : (
                <div className="w-32 h-32 bg-gray-200 rounded-full flex items-center justify-center mb-6 shadow-inner">
                  <Utensils className="w-16 h-16 text-secondary/50" aria-hidden="true" />
                </div>
              )}
              
              <h3 className="text-5xl font-black text-secondary mb-4 tracking-tight uppercase">
                {baseName}
              </h3>
              <p className="text-2xl text-secondary/80 font-medium">
                Souhaitez-vous le menu complet avec accompagnement et boisson ?
              </p>
            </div>

            {/* Actions (Boutons au millimètre comme LeaveMenuConfirmModal, avec design amélioré) */}
            <div className="grid grid-cols-2 gap-8 mt-12">
              <Button
                variant="outline"
                onClick={handleSoloClick}
                className="w-full border-4 border-gray-300 text-secondary bg-white hover:bg-gray-50 hover:border-gray-400 py-6 text-2xl font-bold rounded-xl shadow-sm transition-all"
              >
                Non juste le produit ({soloPrice.toFixed(2)} €)
              </Button>
              <Button
                onClick={handleMenuClick}
                className="w-full border-4 border-[#DC2626] bg-[#DC2626] hover:bg-[#B91C1C] hover:border-[#B91C1C] text-white py-6 text-2xl font-bold rounded-xl shadow-xl transition-all"
              >
                Je veux le menu ({product.price.toFixed(2)} €)
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};