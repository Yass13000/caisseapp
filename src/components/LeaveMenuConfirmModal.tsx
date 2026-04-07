import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { XCircle } from 'lucide-react';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

const LeaveMenuConfirmModal: React.FC<Props> = ({ onConfirm, onCancel }) => {
  useEffect(() => {
    lockScroll();
    document.body.classList.add('popup-open');
    return () => {
      unlockScroll();
      document.body.classList.remove('popup-open');
    };
  }, []);

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/60 md:backdrop-blur-sm font-helvetica pt-12 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="relative w-full max-w-5xl bg-cream rounded-3xl shadow-2xl p-12 mt-10 border-t-8 border-[#DC2626]"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -100, opacity: 0 }}
        transition={{ type: 'tween', ease: 'easeOut', duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (top-right) avec le nouveau design */}
        <button 
          type="button" 
          onClick={onCancel} 
          className="absolute top-6 right-6 bg-gray-200 hover:bg-gray-300 rounded-full p-2 transition-colors" 
          aria-label="Fermer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-8 h-8 text-secondary" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Header with red cross and title */}
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="w-32 h-32 bg-red-100/50 rounded-full flex items-center justify-center mb-6 shadow-inner">
            <XCircle className="w-20 h-20 text-[#DC2626]" aria-hidden="true" />
          </div>
          <h3 className="text-5xl font-black text-secondary mb-4 tracking-tight uppercase">
            Annuler la commande
          </h3>
          <p className="text-2xl text-secondary/80 font-medium">
            Votre panier sera supprimé. Voulez-vous continuer ?
          </p>
        </div>

        {/* Actions - Boutons au millimètre avec le nouveau design premium */}
        <div className="grid grid-cols-2 gap-8 mt-12">
          <Button
            variant="outline"
            onClick={onCancel}
            className="w-full border-4 border-gray-300 text-secondary bg-white hover:bg-gray-50 hover:border-gray-400 py-6 text-2xl font-bold rounded-xl shadow-sm transition-all"
          >
            Non
          </Button>
          <Button
            onClick={onConfirm}
            className="w-full border-4 border-[#DC2626] bg-[#DC2626] hover:bg-[#B91C1C] hover:border-[#B91C1C] text-white py-6 text-2xl font-bold rounded-xl shadow-xl transition-all"
          >
            Oui
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
};

export default LeaveMenuConfirmModal;