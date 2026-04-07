import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OptionSubChoice } from '@/features/menu/types';

interface SubOptionsModalProps {
  title: string;
  subOptions: OptionSubChoice[];
  isOpen: boolean;
  onClose: (cancelled?: boolean) => void;
  onSave: (selected: OptionSubChoice[]) => void;
  initialSelected?: OptionSubChoice[];
  imageUrl?: string;
  productName?: string;
}

const SubOptionsModal: React.FC<SubOptionsModalProps> = ({
  title,
  subOptions,
  isOpen,
  onClose,
  onSave,
  initialSelected = [],
  imageUrl,
  productName,
}) => {
  const [subOptionQuantities, setSubOptionQuantities] = useState<{[id: number]: number}>(() => {
    const initial: {[id: number]: number} = {};
    initialSelected.forEach(option => {
      initial[option.id] = (initial[option.id] || 0) + 1;
    });
    return initial;
  });

  const incrementSubOption = (subOption: OptionSubChoice) => {
    setSubOptionQuantities(prev => ({
      ...prev,
      [subOption.id]: (prev[subOption.id] || 0) + 1
    }));
  };

  const decrementSubOption = (subOption: OptionSubChoice) => {
    setSubOptionQuantities(prev => {
      const currentQty = prev[subOption.id] || 0;
      if (currentQty <= 0) return prev;

      const newQuantities = { ...prev };
      if (currentQty === 1) {
        delete newQuantities[subOption.id];
      } else {
        newQuantities[subOption.id] = currentQty - 1;
      }
      return newQuantities;
    });
  };

  const getTotalSaucesCount = () => {
    return Object.values(subOptionQuantities).reduce((sum, qty) => sum + qty, 0);
  };

  const calculateSubOptionsPrice = () => {
    const totalSauces = getTotalSaucesCount();
    // 2 premières sauces gratuites, ensuite 0.30€ par sauce
    if (totalSauces <= 2) {
      return 0;
    } else {
      return (totalSauces - 2) * 0.30;
    }
  };

  const handleConfirm = () => {
    const selectedOptions: OptionSubChoice[] = [];
    Object.entries(subOptionQuantities).forEach(([id, quantity]) => {
      const subOption = subOptions.find(so => so.id === parseInt(id));
      if (subOption && quantity > 0) {
        for (let i = 0; i < quantity; i++) {
          selectedOptions.push(subOption);
        }
      }
    });

    onSave(selectedOptions);
    onClose();
  };

  const handleCancel = () => {
    // Réinitialiser les quantités sélectionnées
    setSubOptionQuantities({});
    // Fermer le modal sans sauvegarder et indiquer que c'est une annulation
    onClose(true);
  };

  const hasSelection = getTotalSaucesCount() > 0;

  if (!isOpen) return null;

  const subOptionsPrice = calculateSubOptionsPrice();

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-16">
      <div className="bg-cream rounded-3xl shadow-2xl w-[90%] max-w-2xl max-h-[85vh] flex flex-col overflow-hidden font-helvetica">
        {/* Header */}
        <div className="bg-secondary text-white px-8 py-6 flex items-center justify-between border-b-4 border-primary">
          <h2 className="text-3xl font-helvetica font-bold">{title}</h2>
          <Button
            variant="ghost"
            onClick={handleCancel}
            className="text-white hover:bg-white/20 p-3 rounded-full transition-colors"
            aria-label="Fermer"
          >
            <X className="h-8 w-8" />
          </Button>
        </div>

        {/* Product name */}
        {productName && (
          <div className="bg-cream px-8 py-4 border-b-2 border-gray-100">
            <h3 className="text-3xl font-helvetica font-bold text-secondary text-center">{productName}</h3>
          </div>
        )}

        {/* Image */}
        {imageUrl && (
          <div className="relative w-full h-64 bg-background overflow-hidden">
            <img
              src={imageUrl}
              alt={productName || title}
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 bg-background">
          <div className="max-w-2xl mx-auto">
            <div className="mb-6 p-4 bg-cream rounded-xl border-2 border-primary/20">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-helvetica font-bold text-secondary">
                    {getTotalSaucesCount()} sauce(s) sélectionnée(s)
                  </h3>
                  <p className="text-gray-500 font-helvetica text-sm mt-1">
                    {getTotalSaucesCount() <= 2 ? ' Gratuites' : ` ${getTotalSaucesCount() - 2} payante(s) à 0,30€`}
                  </p>
                </div>
                {subOptionsPrice > 0 && (
                  <div className="text-right">
                    <div className="text-3xl font-helvetica font-black text-primary">
                      +{subOptionsPrice.toFixed(2)}€
                    </div>
                    <p className="text-sm text-gray-500 font-helvetica">
                      sauces supplémentaires
                    </p>
                  </div>
                )}
              </div>
            </div>

            <h4 className="text-2xl font-helvetica font-bold text-secondary mb-6">
              Choisir une sauce (optionnel)
            </h4>

            <div className="grid grid-cols-1 gap-4">
              {subOptions.map((subOption) => {
                const quantity = subOptionQuantities[subOption.id] || 0;
                return (
                  <div
                    key={subOption.id}
                    className="bg-cream border-3 border-gray-200 rounded-2xl p-6 transition-all duration-300 flex items-center justify-between shadow-lg"
                  >
                    <div className="flex items-center gap-4">
                      {/* Photo de la sauce */}
                      {subOption.image && (
                        <img
                          src={subOption.image}
                          alt={subOption.name}
                          className="w-16 h-16 rounded-xl object-cover shadow-md"
                        />
                      )}
                      <span className="text-2xl font-helvetica font-bold text-secondary">
                        {subOption.name}
                      </span>
                    </div>

                    {/* Contrôles de quantité */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => decrementSubOption(subOption)}
                        disabled={quantity === 0}
                        className={`w-12 h-12 rounded-xl flex items-center justify-center text-3xl font-bold transition-all ${
                          quantity === 0
                            ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                            : 'bg-red-500 text-white hover:bg-red-600 hover:scale-110 active:scale-95'
                        }`}
                      >
                        −
                      </button>

                      <div className="w-16 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
                        <span className="text-3xl font-helvetica font-black text-secondary">
                          {quantity}
                        </span>
                      </div>

                      <button
                        onClick={() => incrementSubOption(subOption)}
                        className="w-12 h-12 rounded-xl bg-primary text-white flex items-center justify-center text-3xl font-bold hover:bg-primary/90 hover:scale-110 active:scale-95 transition-all"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-background px-8 py-4 border-t border-gray-200">
          <div className="flex gap-4">
            <Button
              onClick={() => {
                // Réinitialiser les quantités et confirmer sans sauce
                setSubOptionQuantities({});
                onSave([]);
                onClose();
              }}
              className="flex-1 bg-secondary hover:bg-secondary/90 text-white text-lg py-6 rounded-xl font-helvetica"
            >
              Aucune sauce
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!hasSelection}
              className={`flex-1 text-lg py-6 rounded-xl font-helvetica ${
                !hasSelection
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-primary hover:bg-primary/90 text-white'
              }`}
            >
              Confirmer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubOptionsModal;
