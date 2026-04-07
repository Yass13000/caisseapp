import React, { useState, useEffect } from 'react';
import { X, ChevronLeft } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

interface ProductVariant {
  id: string;
  product_id: number;
  variant_name: string;
  price: number;
  available: boolean;
  created_at: string;
  updated_at: string;
}

interface SubOption {
  id: number;
  parent_option_id: number;
  name: string;
  price: number;
  image?: string;
  is_default: boolean;
}

interface ProductVariantsModalProps {
  product: any;
  isOpen: boolean;
  onClose: () => void;
  onSelectVariant: (variant: ProductVariant, selectedSubOptions?: SubOption[]) => void;
  directSubOptions?: SubOption[];
}

const ProductVariantsModal: React.FC<ProductVariantsModalProps> = ({
  product,
  isOpen,
  onClose,
  onSelectVariant,
  directSubOptions = [],
}) => {
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
// selectedSubOptions reserved for future use
  const [selectedSubOptions, setSelectedSubOptions] = useState<SubOption[]>([]);
  const [subOptionQuantities, setSubOptionQuantities] = useState<{[id: number]: number}>({});
  const [showSubOptions, setShowSubOptions] = useState(false);

  useEffect(() => {
    if (isOpen && product) {
      setShowSubOptions(false);
      setSelectedVariant(null);
      setSelectedSubOptions([]);
      setSubOptionQuantities({});
      loadVariants();
    }
  }, [isOpen, product]);

  const loadVariants = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', product.id)
        .eq('available', true)
        .order('price', { ascending: true });

      if (error) {
        setVariants([]);
      } else {
        const variantsList = data || [];
        setVariants(variantsList);
        
        if (variantsList.length === 0 && directSubOptions.length > 0) {
          setShowSubOptions(true);
          setSelectedVariant({
            id: 'direct',
            product_id: product.id,
            variant_name: 'Standard',
            price: product.price,
            available: true,
            created_at: '',
            updated_at: '',
          });
        }
      }
    } catch (err) {
      setVariants([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectVariant = (variant: ProductVariant) => {
    setSelectedVariant(variant);
    
    if (directSubOptions && directSubOptions.length > 0) {
      setShowSubOptions(true);
    } else {
      onSelectVariant(variant, []);
      onClose();
    }
  };

  const incrementSubOption = (subOption: SubOption) => {
    setSubOptionQuantities(prev => ({
      ...prev,
      [subOption.id]: (prev[subOption.id] || 0) + 1
    }));
  };

  const decrementSubOption = (subOption: SubOption) => {
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
    if (totalSauces <= 2) {
      return 0;
    } else {
      return (totalSauces - 2) * 0.30;
    }
  };

  const handleConfirm = () => {
    if (selectedVariant) {
      const subOptionsWithQuantities: SubOption[] = [];
      Object.entries(subOptionQuantities).forEach(([id, quantity]) => {
        const subOption = directSubOptions.find(so => so.id === parseInt(id));
        if (subOption && quantity > 0) {
          for (let i = 0; i < quantity; i++) {
            subOptionsWithQuantities.push(subOption);
          }
        }
      });
      
      onSelectVariant(selectedVariant, subOptionsWithQuantities);
      onClose();
    }
  };

  const handleBackToVariants = () => {
    setShowSubOptions(false);
    setSelectedVariant(null);
    setSelectedSubOptions([]);
  };

  if (!isOpen) return null;

  const imageUrl = product.image_url || product.image || (product as any).image_url || null;
  const subOptionsPrice = calculateSubOptionsPrice();
  const totalPrice = selectedVariant 
    ? selectedVariant.price + subOptionsPrice
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 font-helvetica select-none">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden border border-gray-100">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
          <div>
            <h2 className="text-secondary font-black text-lg uppercase tracking-wide leading-tight">
              {showSubOptions ? 'Options' : 'Variantes'}
            </h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-gray-400 hover:bg-gray-200 hover:text-secondary rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#F3F4F6]">
          
          {/* Header Produit (Compact sans description) */}
          {imageUrl && !showSubOptions && (
            <div className="flex items-center gap-4 mb-4 bg-white p-3 rounded-xl shadow-sm border border-gray-100">
              <div className="w-16 h-16 bg-gray-50 rounded-lg overflow-hidden flex-shrink-0">
                <img src={imageUrl} alt={product.name} className="w-full h-full object-contain" />
              </div>
              <div>
                <h3 className="font-black text-secondary text-base">{product.name}</h3>
              </div>
            </div>
          )}

          {!showSubOptions ? (
            // VUE VARIANTES
            loading ? (
              <div className="flex items-center justify-center h-32">
                <span className="text-sm text-gray-400 font-bold uppercase tracking-widest animate-pulse">Chargement...</span>
              </div>
            ) : variants.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="text-sm text-gray-400 font-bold">Aucune variante disponible</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {variants.map((variant) => (
                  <button
                    key={variant.id}
                    onClick={() => handleSelectVariant(variant)}
                    className="flex flex-col items-center justify-center p-4 bg-white border-2 border-gray-100 rounded-xl hover:border-secondary hover:shadow-md active:scale-95 transition-all group"
                  >
                    <span className="font-black text-secondary text-sm uppercase mb-1 group-hover:text-primary transition-colors text-center">
                      {variant.variant_name}
                    </span>
                    <span className="font-black text-gray-600 text-lg">
                      {variant.price.toFixed(2)}€
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            // VUE SOUS-OPTIONS (Sauces)
            <div className="space-y-4">
              <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center">
                <div>
                  <span className="font-black text-secondary text-sm uppercase block">Sauces</span>
                  <span className="text-xs font-bold text-gray-400">
                    {getTotalSaucesCount()} choisie(s) • {getTotalSaucesCount() <= 2 ? '2 gratuites' : `${getTotalSaucesCount() - 2} payante(s)`}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-black text-secondary text-lg block">{totalPrice.toFixed(2)}€</span>
                  {subOptionsPrice > 0 && <span className="text-[10px] font-bold text-primary uppercase">+{subOptionsPrice.toFixed(2)}€ sauces</span>}
                </div>
              </div>

              <div className="space-y-2">
                {directSubOptions.map((subOption) => {
                  const quantity = subOptionQuantities[subOption.id] || 0;
                  return (
                    <div key={subOption.id} className="bg-white p-2 rounded-xl border border-gray-100 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-3 pl-2">
                        <span className="font-bold text-secondary text-xs uppercase">{subOption.name}</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 bg-gray-50 rounded-full px-1 py-0.5 border border-gray-100">
                        <button
                          onClick={() => decrementSubOption(subOption)}
                          disabled={quantity === 0}
                          className="w-7 h-7 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-sm text-gray-600 active:scale-90 disabled:opacity-50 transition-transform"
                        >
                          -
                        </button>
                        <span className="w-5 text-center font-black text-sm text-secondary">
                          {quantity}
                        </span>
                        <button
                          onClick={() => incrementSubOption(subOption)}
                          className="w-7 h-7 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-sm text-primary active:scale-90 transition-transform"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-white flex gap-3">
          {showSubOptions ? (
            <>
              <button 
                onClick={handleBackToVariants}
                className="flex items-center justify-center w-12 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 active:scale-95 transition-all"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 bg-[#04B855] text-white font-black text-sm py-3 rounded-xl shadow-md hover:bg-[#039d48] active:scale-95 transition-all uppercase tracking-wider"
              >
                Valider • {totalPrice.toFixed(2)}€
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 bg-gray-100 text-gray-500 font-black text-sm py-3 rounded-xl hover:bg-gray-200 active:scale-95 transition-all uppercase tracking-wider"
            >
              Annuler
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

export default ProductVariantsModal;