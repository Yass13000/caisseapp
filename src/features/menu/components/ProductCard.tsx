// @ts-nocheck
import React, { useState, useMemo } from 'react';
import { Utensils } from 'lucide-react';

export interface Product {
  id: number | string;
  name: string;
  price: number;
  category?: string;
  image?: string | null;
  image_url?: string | null;
  solo_image_url?: string | null;
  is_available?: boolean;
}

interface ProductCardProps {
  product: Product;
  onSelectProduct?: (product: Product) => void;
  onSelect?: (product: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onSelectProduct, onSelect }) => {
  const [imgError, setImgError] = useState(false);

  const handleSelect = () => {
    if (product.is_available === false) return;
    if (onSelectProduct) onSelectProduct(product);
    else if (onSelect) onSelect(product);
  };

  const rawImage = product.image || product.image_url || product.solo_image_url;
  const hasImage = Boolean(rawImage) && !imgError;
  const isAvailable = product.is_available !== false;
  const formattedPrice = Number(product.price || 0).toFixed(2);

  const titleFontSizeClass = useMemo(() => {
    const len = (product.name || '').length;
    if (len > 26) return 'text-[11px] leading-tight';
    if (len > 18) return 'text-[12.5px] leading-snug';
    return 'text-[14px] leading-snug';
  }, [product.name]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      disabled={!isAvailable}
      title={product.name}
      className={`group relative w-full h-[88px] sm:h-[92px] bg-white rounded-2xl p-2.5 flex items-center gap-3 text-left transition-all duration-100 select-none shadow-sm border border-gray-100/80 overflow-hidden ${
        isAvailable
          ? 'hover:border-gray-300 hover:shadow active:scale-[0.98] cursor-pointer'
          : 'opacity-50 bg-gray-50 cursor-not-allowed'
      }`}
    >
      {/* Vignette Image : sans fond ni cadre */}
      <div className="relative w-[68px] h-[68px] sm:w-[72px] sm:h-[72px] shrink-0 bg-transparent flex items-center justify-center">
        {hasImage ? (
          <img
            src={rawImage!}
            alt={product.name}
            onError={() => setImgError(true)}
            loading="lazy"
            className="w-full h-full object-contain pointer-events-none transition-transform duration-150 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 bg-transparent">
            <Utensils size={24} strokeWidth={1.5} />
          </div>
        )}
      </div>

      {/* Zone Texte & Prix */}
      <div className="flex-1 flex flex-col justify-between h-full min-w-0 py-0.5">
        <h3 className={`font-black text-gray-800 tracking-tight transition-colors group-hover:text-primary line-clamp-2 ${titleFontSizeClass}`}>
          {product.name}
        </h3>

        {/* Prix brut : sans cadre ni fond */}
        <div className="flex items-center justify-end w-full mt-auto">
          <span className="font-black text-[15px] tracking-tight text-primary">
            {formattedPrice} €
          </span>
        </div>
      </div>

      {/* Overlay rupture */}
      {!isAvailable && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
          <span className="text-red-600 font-black text-[11px] uppercase tracking-wider">
            Épuisé
          </span>
        </div>
      )}
    </button>
  );
};

export default ProductCard;