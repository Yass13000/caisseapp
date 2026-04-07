import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import type { CartItem } from '@/types';
import { calculateItemTotal } from '@/lib/cartCalculations';
import { useNavigate } from 'react-router-dom';

interface OrderDetailPopupProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  subtotal: number;
  onOpenPersonalizeModal?: (item: CartItem) => void;
  onModifyProduct?: (item: CartItem) => void;
}

// Fonction pour grouper les items par catégorie (Identique à OrderConfirmation)
const groupItemsByCategory = (items: CartItem[]): Map<string, CartItem[]> => {
  const grouped = new Map<string, CartItem[]>();

  items.forEach(item => {
    let categoryName = 'Autres';
    
    if ((item as any)?.isReward) {
      categoryName = 'Fidélité';
    } else {
      const rawCat = ((item.product as any)?.category_id || (item.product as any)?.category || '').toString().trim();
      if (rawCat) {
        categoryName = rawCat;
      }
    }

    if (!grouped.has(categoryName)) {
      grouped.set(categoryName, []);
    }
    grouped.get(categoryName)!.push(item);
  });

  return grouped;
};

// Fonction pour regrouper les sauces par nom avec quantité
const groupSaucesByName = (sauces: any[]): { name: string; quantity: number; price: number }[] => {
  const grouped = new Map<string, { quantity: number; price: number }>();

  sauces.forEach(sauce => {
    const name = sauce.name;
    if (grouped.has(name)) {
      const existing = grouped.get(name)!;
      grouped.set(name, {
        quantity: existing.quantity + 1,
        price: existing.price + (sauce.price || 0)
      });
    } else {
      grouped.set(name, { quantity: 1, price: sauce.price || 0 });
    }
  });

  return Array.from(grouped.entries()).map(([name, data]) => ({
    name,
    quantity: data.quantity,
    price: data.price
  }));
};

export const OrderDetailPopup: React.FC<OrderDetailPopupProps> = ({
  isOpen,
  onClose,
  items,
  subtotal,
  onOpenPersonalizeModal,
  onModifyProduct,
}) => {
  const { updateQuantity, removeFromCart } = useCart();
  const navigate = useNavigate();

  if (!isOpen) return null;

  // Grouper les items par catégorie
  const groupedItems = groupItemsByCategory(items);

  const handleIncreaseQuantity = (item: CartItem) => {
    const productId = item.customKey || item.product.id;
    updateQuantity(
      productId,
      item.quantity + 1,
      item.boisson?.id?.toString(),
      item.accompagnement?.id?.toString()
    );
  };

  const handleDecreaseQuantity = (item: CartItem) => {
    if (item.quantity > 1) {
      const productId = item.customKey || item.product.id;
      updateQuantity(
        productId,
        item.quantity - 1,
        item.boisson?.id?.toString(),
        item.accompagnement?.id?.toString()
      );
    }
  };

  const handleRemoveItem = (item: CartItem) => {
    const productId = String(item.product.id);
    const boissonId = item.boisson?.id ? String(item.boisson.id) : undefined;
    const accompagnementId = item.accompagnement?.id ? String(item.accompagnement.id) : undefined;
    removeFromCart(
      item.customKey || productId,
      boissonId,
      accompagnementId
    );
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center">
          {/* Backdrop avec fade */}
          <motion.div
            className="absolute inset-0 bg-black/40 z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={onClose}
          />

          {/* Popup qui slide depuis le bas */}
          <motion.div
            className="bg-background shadow-2xl w-full flex flex-col rounded-t-3xl relative z-10 will-change-transform isolate"
            onClick={(e) => e.stopPropagation()}
            style={{
              height: 'calc(100vh - 170px)',
              maxHeight: 'calc(100vh - 170px)'
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
              mass: 0.8
            }}
          >
            {/* Bouton FERMER en haut au centre */}
            <div className="flex justify-center font-helvetica absolute -top-12 left-0 right-0 z-20">
              <button
                onClick={onClose}
                type="button"
                className="relative rounded-3xl border-3 border-secondary bg-background shadow-lg inline-flex items-center justify-center px-16 py-6 flex-col transition-all duration-300"
              >
                <span className="text-[20px] font-bold uppercase tracking-wide text-secondary mb-1">FERMER</span>
                <motion.div
                  className="absolute -bottom-6 bg-background border-3 border-secondary rounded-full p-2"
                  animate={{ y: [0, 4, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-secondary" aria-hidden="true">
                    <path d="M12 21L22 11H2L12 21Z" />
                  </svg>
                </motion.div>
              </button>
            </div>

            <div className="h-16"></div>

            {/* Zone scrollable des produits */}
            <div className="flex-1 overflow-y-auto px-8 py-6 pb-40 font-helvetica">
              {items.length === 0 ? (
                <p className="text-center text-secondary/60 py-8">Votre panier est vide</p>
              ) : (
                <div className="space-y-8">
                  {Array.from(groupedItems.entries()).map(([category, categoryItems]) => {
                    const displayCategoryName = typeof category === 'string' && category.trim().length > 0
                      ? category.trim().charAt(0).toUpperCase() + category.trim().slice(1)
                      : category;

                    return (
                      <div key={category}>
                        {/* Header de catégorie textuel (sans icône SVG) */}
                        <div className="flex items-center gap-3 mb-4 px-2">
                          <h3 className="text-secondary font-bold uppercase tracking-widest text-lg border-b-2 border-secondary/20 pb-1">
                            {displayCategoryName}
                          </h3>
                        </div>

                        {/* Produits de cette catégorie */}
                        <div className="space-y-4">
                          {categoryItems.map((item, index) => (
                            <div key={index} className="bg-cream rounded-xl p-8 border border-background">
                              {/* Ligne principale: Image + Nom + Prix */}
                              <div className="flex items-stretch gap-6 mb-6">
                                {(item.image_url || (item.product as any)?.image) && (
                                  <img
                                    src={item.image_url || (item.product as any)?.image}
                                    alt={item.name || (item.product as any)?.name}
                                    className="w-28 h-28 object-cover rounded-lg flex-shrink-0"
                                  />
                                )}

                                <div className="flex-1 flex flex-col justify-between">
                                  <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                      <h4 className="font-bold text-2xl text-secondary mb-4">
                                        {item.name || (item.product as any)?.name}
                                      </h4>
                                      {!item.isReward && (
                                        <div className="flex items-center gap-3">
                                          <button
                                            onClick={() => handleDecreaseQuantity(item)}
                                            className="w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#D42438] text-[#D42438] hover:bg-[#D42438] hover:text-white transition-colors"
                                          >
                                            <Minus className="w-5 h-5" />
                                          </button>
                                          <span className="text-xl font-bold text-secondary min-w-[30px] text-center">
                                            {item.quantity}
                                          </span>
                                          <button
                                            onClick={() => handleIncreaseQuantity(item)}
                                            className="w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#D42438] text-[#D42438] hover:bg-[#D42438] hover:text-white transition-colors"
                                          >
                                            <Plus className="w-5 h-5" />
                                          </button>
                                        </div>
                                      )}
                                      {item.isReward && item.quantity > 1 && (
                                        <div className="text-xl font-bold text-secondary">
                                          Quantité: {item.quantity}
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-3xl font-bold text-secondary ml-4">
                                      {(calculateItemTotal(item) * item.quantity).toFixed(2)} €
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Options et sous-options du produit (SANS LES TEXTES D'EN-TÊTE) */}
                              {(item.boisson || item.accompagnement || (item.boissonSubChoices && item.boissonSubChoices.length > 0) || (item.accompagnementSubChoices && item.accompagnementSubChoices.length > 0) || (item.selectedSubOptions && item.selectedSubOptions.length > 0) || ((item as any).directSubOptions && (item as any).directSubOptions.length > 0)) && (
                                <>
                                  <div className="w-full h-[2px] bg-secondary mb-6"></div>
                                  <div className="mb-6 space-y-3 font-helvetica">
                                    {item.boisson && (
                                      <div className="flex justify-between text-lg text-secondary">
                                        <span>1 x {item.boisson.name}</span>
                                        {item.boisson.price > 0 && <span>+ {item.boisson.price.toFixed(2)} €</span>}
                                      </div>
                                    )}
                                    {item.accompagnement && (
                                      <div className="flex justify-between text-lg text-secondary">
                                        <span>1 x {item.accompagnement.name}</span>
                                        {item.accompagnement.price > 0 && <span>+ {item.accompagnement.price.toFixed(2)} €</span>}
                                      </div>
                                    )}

                                    {item.boissonSubChoices && item.boissonSubChoices.length > 0 && (
                                      <div className="space-y-2 pl-6 border-l-2 border-secondary/20">
                                        {groupSaucesByName(item.boissonSubChoices).map((sauce, idx) => (
                                          <div key={idx} className="flex justify-between text-base text-secondary/80">
                                            <span>• {sauce.quantity > 1 ? `${sauce.quantity}x ` : ''}{sauce.name}</span>
                                            {sauce.price > 0 && <span>+ {sauce.price.toFixed(2)} €</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {item.accompagnementSubChoices && item.accompagnementSubChoices.length > 0 && (
                                      <div className="space-y-2 pl-6 border-l-2 border-secondary/20">
                                        {groupSaucesByName(item.accompagnementSubChoices).map((sauce, idx) => (
                                          <div key={idx} className="flex justify-between text-base text-secondary/80">
                                            <span>• {sauce.quantity > 1 ? `${sauce.quantity}x ` : ''}{sauce.name}</span>
                                            {sauce.price > 0 && <span>+ {sauce.price.toFixed(2)} €</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {item.selectedSubOptions && item.selectedSubOptions.length > 0 && (
                                      <div className="space-y-3 pl-6 border-l-2 border-secondary/20">
                                        {item.selectedSubOptions.map((group, groupIdx) => (
                                          <div key={groupIdx} className="space-y-2">
                                            {group.options && group.options.map((option, optIdx) => (
                                              <div key={optIdx} className="flex justify-between text-base text-secondary/80">
                                                <span>• {option.name}</span>
                                                {option.price > 0 && <span>+ {option.price.toFixed(2)} €</span>}
                                              </div>
                                            ))}
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {(item as any).directSubOptions && (item as any).directSubOptions.length > 0 && (
                                      <div className="space-y-2 pl-6 border-l-2 border-secondary/20">
                                        {groupSaucesByName((item as any).directSubOptions).map((sauce, idx) => (
                                          <div key={idx} className="flex justify-between text-base text-secondary/80">
                                            <span>• {sauce.quantity > 1 ? `${sauce.quantity}x ` : ''}{sauce.name}</span>
                                            {sauce.price > 0 && <span>+ {sauce.price.toFixed(2)} €</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}

                              {item.isReward && (
                                <div className="mb-4">
                                  <span className="inline-block px-4 py-2 bg-yellow-100 text-yellow-800 text-sm font-semibold rounded-full">
                                    🎁 Article fidélité (-{item.rewardPoints} pts)
                                  </span>
                                </div>
                              )}

                              {/* Boutons d'action */}
                              <div className="flex gap-2 mt-4 justify-center flex-wrap">
                                {item.isReward ? (
                                  <Button
                                    onClick={() => handleRemoveItem(item)}
                                    variant="outline"
                                    className="min-w-[220px] px-10 py-3 bg-cream border-2 border-[#D42438] text-[#D42438] hover:bg-[#D42438] hover:text-white font-bold rounded-lg text-xl transition-colors"
                                  >
                                    Supprimer
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      onClick={() => handleRemoveItem(item)}
                                      variant="outline"
                                      className="min-w-[220px] px-10 py-3 bg-cream border-2 border-[#D42438] text-[#D42438] hover:bg-[#D42438] hover:text-white font-bold rounded-lg text-xl transition-colors"
                                    >
                                      Supprimer
                                    </Button>

                                    {(item.boisson || item.accompagnement || (item.boissonSubChoices && item.boissonSubChoices.length > 0) || (item.accompagnementSubChoices && item.accompagnementSubChoices.length > 0) || (item.selectedSubOptions && item.selectedSubOptions.length > 0) || ((item as any).directSubOptions && (item as any).directSubOptions.length > 0)) && (
                                      <Button
                                        onClick={() => onOpenPersonalizeModal?.(item)}
                                        className="min-w-[220px] px-10 py-3 bg-cream border-2 border-secondary text-secondary hover:bg-gray-50 font-bold rounded-lg text-xl transition-colors"
                                      >
                                        Personnaliser
                                      </Button>
                                    )}

                                    <Button
                                      onClick={() => {
                                        if (onModifyProduct) {
                                          onModifyProduct(item);
                                        } else {
                                          handleRemoveItem(item);
                                          onClose();
                                          navigate('/menu');
                                        }
                                      }}
                                      className="min-w-[220px] px-10 py-3 bg-cream border-2 border-secondary text-secondary hover:bg-gray-50 font-bold rounded-lg text-xl transition-colors"
                                    >
                                      Modifier
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  <div className="px-6 py-4">
                    <div className="space-y-3">
                      <div className="flex justify-between text-xl text-secondary/70">
                        <span>Sous-total</span>
                        <span className="font-semibold">{subtotal.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between text-3xl font-bold text-secondary">
                        <span>TOTAL</span>
                        <span>{subtotal.toFixed(2)} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-background py-40"></div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default OrderDetailPopup;