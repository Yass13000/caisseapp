import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isDangerous?: boolean; // Si true, bouton en rouge
  isLoading?: boolean;
}

/**
 * Modal de confirmation réutilisable
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  onConfirm,
  onCancel,
  isDangerous = false,
  isLoading = false,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
    } catch (error) {
      console.error('Erreur confirmation:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-cream rounded-lg p-6 max-w-sm shadow-xl">
        {/* Header avec icône */}
        <div className="flex items-center gap-3 mb-4">
          {isDangerous && (
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
          )}
          <h2 className={`text-lg font-bold ${isDangerous ? 'text-red-600' : 'text-gray-900'}`}>
            {title}
          </h2>
        </div>

        {/* Message */}
        <p className="text-gray-700 mb-6">{message}</p>

        {/* Boutons */}
        <div className="flex gap-3">
          <Button
            onClick={onCancel}
            disabled={isProcessing || isLoading}
            variant="outline"
            className="flex-1"
          >
            {cancelText}
          </Button>

          <Button
            onClick={handleConfirm}
            disabled={isProcessing || isLoading}
            variant={isDangerous ? 'destructive' : 'default'}
            className="flex-1"
          >
            {isProcessing || isLoading ? 'Traitement...' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Hook pour gérer une confirmation modale
 */
export const useConfirm = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<Omit<ConfirmModalProps, 'isOpen'>>({
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => setIsOpen(false),
  });

  const confirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
  }): Promise<boolean> => {
    return new Promise(resolve => {
      setConfig({
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        isDangerous: options.isDangerous,
        onConfirm: () => {
          resolve(true);
          setIsOpen(false);
        },
        onCancel: () => {
          resolve(false);
          setIsOpen(false);
        },
      });
      setIsOpen(true);
    });
  };

  return { confirm, isOpen, config };
};
