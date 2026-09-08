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
    if (len > 30) return 'text-[12px] xl:text-[13px] leading-tight';
    if (len > 18) return 'text-[13.5px] xl:text-[14.5px] leading-snug';
    return 'text-[15px] xl:text-[16px] leading-snug';
  }, [product.name]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      disabled={!isAvailable}
      title={product.name}
      className={`group relative w-full h-[102px] sm:h-[106px] xl:h-[110px] bg-white rounded-2xl p-2.5 sm:p-3 flex items-center gap-3 xl:gap-3.5 text-left transition-all duration-100 select-none shadow-sm border border-gray-100 hover:border-gray-300 hover:shadow-md active:scale-[0.98] overflow-hidden ${
        isAvailable ? 'cursor-pointer' : 'opacity-50 bg-gray-50 cursor-not-allowed'
      }`}
    >
      {/* 🟢 Grande vignette produit (sans fond ni contour) */}
      <div className="relative w-[84px] h-[84px] sm:w-[88px] sm:h-[88px] xl:w-[92px] xl:h-[92px] shrink-0 bg-transparent flex items-center justify-center">
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
            <Utensils size={32} strokeWidth={1.5} />
          </div>
        )}
      </div>

      {/* 🟢 Zone Titre + Prix à droite */}
      <div className="flex-1 flex flex-col justify-between h-full min-w-0 py-1">
        <h3 className={`font-black text-gray-800 tracking-tight transition-colors group-hover:text-primary line-clamp-2 ${titleFontSizeClass}`}>
          {product.name}
        </h3>

        {/* Prix brut sans cadre ni fond */}
        <div className="flex items-center justify-end w-full mt-auto">
          <span className="font-black text-[16px] sm:text-[17px] xl:text-[18px] tracking-tight text-primary leading-none">
            {formattedPrice} €
          </span>
        </div>
      </div>

      {/* Badge Rupture */}
      {!isAvailable && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center z-10">
          <span className="text-red-600 font-black text-[11px] uppercase tracking-wider bg-red-50 px-2 py-0.5 rounded border border-red-100">
            Épuisé
          </span>
        </div>
      )}
    </button>
  );
};

export default ProductCard;