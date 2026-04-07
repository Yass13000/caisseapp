import React from 'react';
import { Button } from '@/components/ui/button';

interface MenuHeaderProps {
  showBack: boolean;
  onBack: () => void;
  showClose?: boolean;
  onClose?: () => void;
  title: string;
  orderTypeIcon?: React.ReactNode;
  onOrderTypeClick?: () => void;
  deliveryAddress?: string | null;
  loyaltyPoints?: number | null;
  onLoyaltyClick?: () => void;
}

const MenuHeader: React.FC<MenuHeaderProps> = ({
  // @ts-expect-error - showBack not used in current implementation
  showBack,
  // @ts-expect-error - onBack not used in current implementation
  onBack,
  // @ts-expect-error - showClose not used in current implementation
  showClose = false,
  // @ts-expect-error - onClose not used in current implementation
  onClose,
  title,
  // @ts-expect-error - orderTypeIcon not used in current implementation
  orderTypeIcon,
  // @ts-expect-error - onOrderTypeClick not used in current implementation
  onOrderTypeClick,
  deliveryAddress,
  loyaltyPoints,
  onLoyaltyClick
}) => {
  return (
    <div className="w-full bg-secondary py-4 flex items-center justify-between px-6" style={{ minHeight: '80px' }}>
      {/* Section gauche - titre déplacé à gauche */}
      <div className="flex-1">
        <h1 className="text-3xl font-helvetica text-primary-foreground text-left">
          {title}
        </h1>
        {deliveryAddress && (
          <p className="text-xs text-primary-foreground/80 mt-1 truncate max-w-xs text-left">
            📍 {deliveryAddress}
          </p>
        )}
      </div>
      
      {/* Section droite - points de fidélité et bouton avantages */}
      <div className="flex items-center gap-4">
        {/* Bouton "Mes Avantages" et points - seulement si utilisateur connecté */}
        {loyaltyPoints !== null && loyaltyPoints !== undefined && (
          <>
            <Button
              onClick={onLoyaltyClick}
              className="bg-transparent hover:bg-white/10 text-white px-8 py-3 rounded-lg font-helvetica font-bold text-lg shadow-none transition-all border-2 border-white"
              style={{
                textShadow: '0 0 0 1px white, 0 0 0 2px white',
                WebkitTextStroke: '0.5px white'
              }}
            >
              Mes Avantages
            </Button>
            
            {/* Affichage des points - seulement si > 0 */}
            {loyaltyPoints > 0 && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-xl font-bold text-white font-dunkin">
                  {loyaltyPoints}
                </span>
                <img src="/point.png" alt="Points" className="w-6 h-6 object-contain" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MenuHeader;
