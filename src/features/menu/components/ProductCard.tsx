import React, { useRef } from 'react';

interface ProductCardProps {
  product: any;
  onSelectProduct: (product: any, event?: React.MouseEvent, cardElement?: HTMLElement) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onSelectProduct }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isAvailable = product.is_available;

  return (
    <div
      ref={wrapperRef}
      className={`w-full h-[100px] rounded-xl border-2 flex flex-col justify-between p-3 select-none transition-all duration-75 ${
        isAvailable
          ? 'bg-white border-gray-200 shadow-sm cursor-pointer hover:border-primary hover:shadow-md active:bg-gray-50 active:scale-[0.98]'
          : 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed'
      }`}
      onClick={(e) => isAvailable && onSelectProduct(product, e, wrapperRef.current!)}
      style={{ touchAction: 'manipulation' }}
    >
      {/* NOM DU PRODUIT */}
      <h3 className="text-[16px] xl:text-[18px] font-bold text-gray-800 leading-tight line-clamp-2">
        {product.name}
      </h3>

      {/* PRIX & STATUT */}
      <div className="flex items-end justify-between w-full mt-1">
        <span className={`text-[20px] xl:text-[24px] font-black tracking-tight ${isAvailable ? 'text-primary' : 'text-gray-400'}`}>
          {product.price.toFixed(2)} €
        </span>
        
        {!isAvailable && (
          <span className="bg-red-600 text-white text-[11px] font-black px-2 py-1 rounded uppercase tracking-wider">
            Épuisé
          </span>
        )}
      </div>
    </div>
  );
};

export default React.memo(ProductCard);