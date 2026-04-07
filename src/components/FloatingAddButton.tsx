import React, { useEffect, useState, useRef } from 'react';
import { Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface FloatingAddButtonProps {
  fromElement: HTMLElement | null;
  toElement: HTMLElement | null;
  animationTrigger: number;
  onComplete?: () => void;
}

export const FloatingAddButton: React.FC<FloatingAddButtonProps> = ({
  fromElement,
  toElement,
  animationTrigger,
  onComplete,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [fromPos, setFromPos] = useState({ x: 0, y: 0 });
  const [toPos, setToPos] = useState({ x: 0, y: 0 });
  
  // NOUVEAU : On stocke la source de l'image du produit cliqué
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const animationKeyRef = useRef(0);

  useEffect(() => {
    if (fromElement && toElement) {
      const fromRect = fromElement.getBoundingClientRect();
      const toRect = toElement.getBoundingClientRect();

      const fromX = fromRect.left + fromRect.width / 2;
      const fromY = fromRect.top + fromRect.height / 2;
      const toX = toRect.left + toRect.width / 2;
      const toY = toRect.top + toRect.height / 2;

      setFromPos({ x: fromX, y: fromY });
      setToPos({ x: toX, y: toY });

      // LA MAGIE : On cherche l'image à l'intérieur de la carte cliquée
      const img = fromElement.querySelector('img');
      if (img && img.src) {
        setImgSrc(img.src);
      } else {
        setImgSrc(null);
      }
      
      animationKeyRef.current += 1;
      setIsVisible(true);
    }
  }, [fromElement, toElement, animationTrigger]);

  // Calcul du "sommet" de la parabole pour que l'image s'envole vers le haut avant de tomber
  const peakY = Math.min(fromPos.y, toPos.y) - 150;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={`floating-add-button-${animationKeyRef.current}`}
          className="fixed pointer-events-none z-[99999]"
          initial={{
            x: fromPos.x,
            y: fromPos.y,
            scale: 0.5,
            opacity: 0,
          }}
          // ANIMATION PARABOLIQUE FAÇON "BURGER KING 2026"
          animate={{
            x: [fromPos.x, fromPos.x + (toPos.x - fromPos.x) / 2, toPos.x], // Glisse vers la cible
            y: [fromPos.y, peakY, toPos.y], // Monte en l'air puis redescend dans le panier
            scale: [0.8, 1.4, 0.15], // Fait "Pop" en grandissant, puis rétrécit pour entrer dans le panier
            opacity: [0, 1, 1, 0], // Apparaît puis disparaît à l'impact
            rotate: [0, 15, -10], // Petit effet de rotation aérodynamique
          }}
          transition={{
            duration: 0.65, // Ultra nerveux (0.65s au lieu de 1.2s)
            times: [0, 0.4, 1], // Le sommet de l'arc est atteint à 40% du temps
            ease: ["easeOut", "easeIn"], // Ralentit en montant, accélère en tombant (gravité)
          }}
          onAnimationComplete={() => {
            setIsVisible(false);
            onComplete?.();
          }}
          style={{
            left: 0,
            top: 0,
            width: 120, // Plus grand pour laisser respirer l'image HD
            height: 120,
            translateX: '-50%',
            translateY: '-50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {imgSrc ? (
            // L'image du burger vole avec une belle ombre lumineuse "Premium"
            <img 
              src={imgSrc} 
              alt="Produit volant" 
              className="w-full h-full object-contain"
              style={{ 
                filter: 'drop-shadow(0px 15px 15px rgba(4,184,85,0.4)) brightness(1.1) contrast(1.1)',
                willChange: 'transform, opacity' // Force l'accélération GPU
              }}
            />
          ) : (
            // Fallback (au cas où il n'y a pas d'image, on affiche un + très stylisé)
            <div className="w-14 h-14 bg-gradient-to-br from-[#04B855] to-[#039349] rounded-full flex items-center justify-center shadow-[0_10px_30px_rgba(4,184,85,0.6)] border-[3px] border-white">
              <Plus className="w-8 h-8 text-white stroke-[3]" />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default React.memo(FloatingAddButton);