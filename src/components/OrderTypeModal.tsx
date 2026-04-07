import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OrderTypeModalProps {
  onClose: () => void;
  onSelectType: (type: string) => void;
  openingHours?: string;
}

/**
 * Modal pour sélectionner le type de commande (Sur place, À emporter, Livraison)
 */
export default function OrderTypeModal({ onClose, onSelectType, openingHours }: OrderTypeModalProps) {
  const orderTypes = [
    { id: 'place', label: 'Sur place', icon: '🪑', variant: 'default' as const },
    { id: 'emporter', label: 'À emporter', icon: '🛍️', variant: 'secondary' as const },
    { id: 'livraison', label: 'Livraison', icon: '🚗', variant: 'default' as const }
  ];

  const handleSelectType = (type: string) => {
    onSelectType(type);
    onClose();
  };

  return createPortal(
    <motion.div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-cream rounded-lg shadow-xl max-w-md w-full mx-4"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Type de commande</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Fermer"
          >
            <X size={24} className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {orderTypes.map((type) => (
            <motion.div
              key={type.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button
                onClick={() => handleSelectType(type.label)}
                variant={type.variant}
                size="lg"
                className="w-full text-lg"
              >
                <span className="text-2xl">{type.icon}</span>
                {type.label}
              </Button>
            </motion.div>
          ))}
        </div>

        {/* Footer */}
        {openingHours && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
            <p className="text-sm text-gray-600">
              <span className="font-semibold">Horaires :</span> {openingHours}
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}
