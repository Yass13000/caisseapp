// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { UpsellProduct } from '../types';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

interface UpsellModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (product: UpsellProduct) => void;
  products: UpsellProduct[];
  onShowDescription?: (product: any) => void;
}

const UpsellModal: React.FC<UpsellModalProps> = ({ 
  isOpen, 
  onClose, 
  onAddToCart, 
  products,
  onShowDescription
}) => {
  const [selectedProduct, setSelectedProduct] = useState<UpsellProduct | null>(null);

  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => {
        unlockScroll();
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedProduct(null);
    }
  }, [isOpen]);

  const handleProductClick = (product: UpsellProduct) => {
    setSelectedProduct(product);
    onAddToCart(product);
  };

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-[9998] flex items-start justify-center p-4 pt-16"
          >
            <motion.div 
              role="dialog" 
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="relative bg-backgroundCustom rounded-2xl shadow-2xl max-w-[1200px] max-h-[85vh] w-full flex flex-col overflow-hidden"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            >
              {/* Header avec titre GÉANT mais pas en MAJUSCULES */}
              <div className="relative flex items-center justify-between px-8 py-8 border-b border-gray-200">
                <div className="flex-1"></div>
                <h2 className="text-6xl font-helvetica font-black text-secondary tracking-tight">
                  Un petit extra ?
                </h2>
                <div className="flex-1 flex justify-end">
                  <button
                    onClick={onClose}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    aria-label="Fermer"
                  >
                    <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-3 gap-6 max-w-[1100px] mx-auto mb-10">
                  {products.map((product) => (
                    <motion.div
                      key={product.id}
                      whileHover={{ y: -4 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleProductClick(product)}
                      className={`relative w-full h-[320px] bg-cream overflow-hidden rounded-lg transition-all duration-300 ease-in-out cursor-pointer font-helvetica flex flex-col ${
                        selectedProduct?.id === product.id ? 'ring-4 ring-primary shadow-2xl' : 'hover:shadow-xl'
                      }`}
                    >
                      {/* Header avec nom */}
                      <div className="flex-shrink-0 h-[60px] bg-cream flex items-start justify-between p-4">
                        <h3 className="text-lg font-bold font-helvetica text-secondary flex-1 leading-tight line-clamp-2">
                          {product.name}
                        </h3>
                      </div>

                      {/* Image du produit */}
                      <div className="relative w-full flex-1 overflow-hidden p-4 flex items-center justify-center">
                        {(product.image_url || (product as any).image) ? (
                          <img
                            src={(product.image_url || (product as any).image) as string}
                            alt={product.name}
                            className="max-w-full max-h-full object-contain transition-all duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                            <span className="text-6xl">🍔</span>
                          </div>
                        )}
                      </div>

                      {/* ZONE BAS : OEIL (gauche) + PRIX (droite) */}
                      <div className="absolute bottom-0 left-0 right-0 p-3 flex items-center justify-between pointer-events-none">
                        {/* Bouton Oeil pour description */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onShowDescription?.(product);
                          }}
                          className="pointer-events-auto w-10 h-10 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center shadow-sm hover:bg-white transition-colors"
                        >
                          <svg className="w-6 h-6 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>

                        {/* Prix en bas à droite */}
                        <div className="bg-cream/90 backdrop-blur-sm px-2 py-1 rounded shadow-sm border border-gray-100">
                          <p className="text-lg font-dunkin font-bold text-primary">
                            {(product.price ?? 0).toFixed(2)} €
                          </p>
                        </div>
                      </div>

                      {/* Badge sélection */}
                      {selectedProduct?.id === product.id && (
                        <div className="absolute top-2 right-2 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg z-20">
                          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>

                <div className="flex justify-center mt-4">
                  <button
                    onClick={onClose}
                    className="bg-red-500 border-4 border-red-500 text-white hover:bg-red-600 px-16 py-5 rounded-xl font-helvetica text-2xl font-black uppercase tracking-widest shadow-xl hover:shadow-2xl transition-all"
                  >
                    Non, merci
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
};

export default UpsellModal;