import React from 'react';

interface UnavailableOverlayProps {
  className?: string;
}

const UnavailableOverlay: React.FC<UnavailableOverlayProps> = ({ className = "" }) => {
  return (
    <div className={`absolute inset-0 flex items-center justify-center ${className}`}>
      {/* Image overlay PNG/SVG */}
      <img 
        src="/images/indisponible-overlay.svg" 
        alt="Produit indisponible" 
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Fallback si l'image ne se charge pas */}
      <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
        <div className="bg-red-500 text-white px-4 py-2 rounded-full text-sm md:text-base font-bold transform -rotate-12">
          INDISPONIBLE
        </div>
      </div>
    </div>
  );
};

export default UnavailableOverlay;
