import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { sumupCloudService } from '@/services/sumupCloudService';
import { useCart } from '@/context/CartContext';
import { calculateCartSubtotal } from '@/lib/cartCalculations';
import { createOrderInDatabase } from '@/lib/createOrder';
import { usePaymentSettings } from '@/hooks/usePaymentSettings';
import { toast } from 'sonner';

// --- MAPPING DES UUID POUR SUPABASE ---
// Cela traduit le texte du localStorage en véritable ID pour la base de données
const ORDER_TYPE_MAPPING: Record<string, string> = {
  'sur-place': '633425b1-f86c-4c17-8cba-b258906ad317',
  'a-emporter': '2cac3f10-73e2-40a5-a7e0-053bd861b4d9',
  'livraison': 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d',
  'SUR PLACE': '633425b1-f86c-4c17-8cba-b258906ad317',
  'EMPORTER': '2cac3f10-73e2-40a5-a7e0-053bd861b4d9'
};

const PaymentMethod = () => {
  const navigate = useNavigate();
  const { state, clearCart } = useCart();
  const { settings } = usePaymentSettings();
  const [isProcessing, setIsProcessing] = useState(false);
  const [sumupPaymentUrl, setSumupPaymentUrl] = useState<string | null>(null);
  const [showSumUpQR, setShowSumUpQR] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<any>(null);

  const subtotal = calculateCartSubtotal(state.items);

  // Récupérer les données de commande temporaires
  useEffect(() => {
    const orderDataStr = sessionStorage.getItem('pendingOrder');
    if (orderDataStr) {
      try {
        const orderData = JSON.parse(orderDataStr);
        setPendingOrder(orderData);
      } catch (e) {
        console.error('Erreur parsing pendingOrder:', e);
      }
    }
  }, []);

  // Fonction pour récupérer l'ID du client fidélité s'il est connecté
  const getFinalUserId = () => {
    try {
      const loyaltyUserStr = localStorage.getItem('loyalty_user');
      if (loyaltyUserStr) {
        const loyaltyUser = JSON.parse(loyaltyUserStr);
        return loyaltyUser.id || null;
      }
    } catch (e) {
      console.error('Erreur lecture loyalty_user:', e);
    }
    return null; // Force null si aucun client n'est scanné
  };

  // Fonction pour sécuriser l'UUID du type de commande
  const getValidOrderTypeId = () => {
    const rawType = localStorage.getItem('orderType') || pendingOrder?.orderType || 'sur-place';
    return ORDER_TYPE_MAPPING[rawType] || ORDER_TYPE_MAPPING['sur-place'];
  };

  const handleCounterPayment = async () => {
    if (isProcessing) return;

    if (!settings.counter_payment_enabled) {
      toast.error('Paiement indisponible', {
        description: 'Le paiement au comptoir est actuellement désactivé',
        duration: 3000,
      });
      return;
    }

    setIsProcessing(true);
    try {
      if (!pendingOrder) {
        toast.error('Erreur', {
          description: 'Données de commande manquantes',
          duration: 3000,
        });
        navigate('/cart');
        return;
      }

      console.log('[PaymentMethod] Création commande paiement comptoir');

      const finalUserId = getFinalUserId();
      const validOrderTypeId = getValidOrderTypeId();

      // Créer la commande en écrasant les mauvaises variables
      const result = await createOrderInDatabase({
        ...pendingOrder,
        user_id: finalUserId,
        orderType: validOrderTypeId,       // On remplace le texte par l'UUID
        order_type_id: validOrderTypeId,   // Sécurité double
        paymentMethod: 'counter'
      });

      if (result.success) {
        clearCart();
        localStorage.removeItem('orderType');
        localStorage.removeItem('orderTypeLabel');
        localStorage.removeItem('deliveryAddress');
        sessionStorage.removeItem('orderTypeAsked');
        navigate('/confirmation');
      } else {
        throw new Error(result.error || 'Échec de création de la commande');
      }
    } catch (error) {
      console.error('[PaymentMethod] Erreur paiement comptoir:', error);
      toast.error('Erreur de paiement', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        duration: 3000,
      });
      setIsProcessing(false);
    } 
  };

  const handleCardPayment = async () => {
    if (isProcessing) return;

    if (!settings.card_payment_enabled) {
      toast.error('Paiement indisponible', {
        description: 'Le paiement par carte est actuellement désactivé',
        duration: 3000,
      });
      return;
    }

    setIsProcessing(true);
    try {
      if (!pendingOrder) {
        toast.error('Erreur', {
          description: 'Données de commande manquantes',
          duration: 3000,
        });
        navigate('/cart');
        return;
      }

      console.log('[SumUp] Création du checkout pour montant:', subtotal);

      const orderTypeLabel = localStorage.getItem('orderTypeLabel') || 'Sur place';

      const response = await sumupCloudService.createCheckout({
        amount: subtotal,
        currency: 'EUR',
        description: `Commande ${orderTypeLabel} - ${state.items.length} article(s)`,
        orderId: `CMD-${Date.now()}`,
      });

      console.log('[SumUp] Checkout créé:', response.checkout.paymentUrl);

      const updatedOrder = {
        ...pendingOrder,
        sumupCheckoutId: response.checkout.id,
        paymentMethod: 'card'
      };
      sessionStorage.setItem('pendingOrder', JSON.stringify(updatedOrder));
      setPendingOrder(updatedOrder);

      setSumupPaymentUrl(response.checkout.paymentUrl);
      setShowSumUpQR(true);

    } catch (error) {
      console.error('[SumUp] Erreur création checkout:', error);
      toast.error('Erreur SumUp', {
        description: error instanceof Error ? error.message : 'Erreur lors de la création du paiement',
        duration: 3000,
      });
      setIsProcessing(false);
    }
  };

  const handlePaymentSuccess = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      console.log('[PaymentMethod] Finalisation commande après paiement');

      const finalUserId = getFinalUserId();
      const validOrderTypeId = getValidOrderTypeId();

      const result = await createOrderInDatabase({
        ...pendingOrder,
        user_id: finalUserId,
        orderType: validOrderTypeId,       // On remplace le texte par l'UUID
        order_type_id: validOrderTypeId    // Sécurité double
      });

      if (result.success) {
        clearCart();
        localStorage.removeItem('orderType');
        localStorage.removeItem('orderTypeLabel');
        localStorage.removeItem('deliveryAddress');
        sessionStorage.removeItem('orderTypeAsked');
        navigate('/confirmation');
      } else {
        throw new Error(result.error || 'Échec de création de la commande');
      }
    } catch (error) {
      console.error('[PaymentMethod] Erreur finalisation:', error);
      toast.error('Erreur de finalisation', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
        duration: 3000,
      });
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-siteBg flex flex-col font-helvetica">
      <div className="bg-secondary py-6 px-6 shadow-md">
        <div className="container mx-auto max-w-4xl">
          <h1 className="text-5xl font-bold text-white text-center uppercase tracking-wide font-helvetica">
            Mode de paiement
          </h1>
        </div>
      </div>

      <div className="flex-1 container mx-auto px-6 py-12 max-w-4xl flex flex-col items-center justify-center">
        <h2 className="text-6xl font-bold text-secondary text-center mb-8 font-dunkin uppercase">
          Vous réglez comment ?
        </h2>

        <div className="grid grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div
            onClick={settings.card_payment_enabled && !isProcessing ? handleCardPayment : undefined}
            className={`relative flex flex-col w-[300px] h-[300px] bg-secondary overflow-hidden rounded-xl shadow-lg transition-all duration-300 ease-in-out mx-auto ${
              settings.card_payment_enabled && !isProcessing
                ? 'hover:scale-105 hover:shadow-2xl cursor-pointer active:scale-95'
                : 'opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-b from-secondary to-secondary/90">
               <div className="bg-white rounded-full p-4 shadow-xl flex items-center justify-center w-36 h-36">
                 <img src="/SVG/ttp.svg" alt="Paiement par carte" className="w-28 h-28 object-contain" />
               </div>
            </div>
            <div className="h-[80px] p-4 bg-secondary border-t border-white/20 flex items-center justify-center">
              <h3 className="text-3xl font-dunkin text-white text-center uppercase">
                {!settings.card_payment_enabled ? 'Indisponible' : isProcessing ? 'Chargement...' : 'Par carte'}
              </h3>
            </div>
          </div>

          <div
            onClick={settings.counter_payment_enabled && !isProcessing ? handleCounterPayment : undefined}
            className={`relative flex flex-col w-[300px] h-[300px] bg-secondary overflow-hidden rounded-xl shadow-lg transition-all duration-300 ease-in-out mx-auto ${
              settings.counter_payment_enabled && !isProcessing
                ? 'hover:scale-105 hover:shadow-2xl cursor-pointer active:scale-95'
                : 'opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-b from-secondary to-secondary/90">
               <div className="bg-white rounded-full p-4 shadow-xl flex items-center justify-center w-36 h-36">
                 <img src="/SVG/comptoir.svg" alt="Paiement au comptoir" className="w-28 h-28 object-contain" />
               </div>
            </div>
            <div className="h-[80px] p-4 bg-secondary border-t border-white/20 flex items-center justify-center">
              <h3 className="text-3xl font-dunkin text-white text-center uppercase">
                {!settings.counter_payment_enabled ? 'Indisponible' : isProcessing ? 'Chargement...' : 'Au comptoir'}
              </h3>
            </div>
          </div>
        </div>
      </div>

      <div className="pb-12 flex justify-center">
        <Button
          variant="outline"
          onClick={() => navigate('/cart')}
          className="border-4 border-gray-400 text-gray-700 hover:bg-gray-100 px-16 py-10 text-4xl font-bold rounded-xl font-helvetica shadow-lg min-h-[90px]"
          disabled={isProcessing}
        >
          Retour
        </Button>
      </div>

      {showSumUpQR && sumupPaymentUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => !isProcessing && setShowSumUpQR(false)}>
          <div className="bg-cream rounded-2xl p-8 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 font-helvetica">Paiement par carte</h2>
            </div>
            <div className="bg-cream p-4 rounded-xl border-2 border-gray-200 mb-6">
              <img
                src={sumupCloudService.getQRCodeUrl(sumupPaymentUrl, 400)}
                alt="QR Code de paiement"
                className="w-full h-auto"
              />
            </div>
            <div className="space-y-4 mb-6">
              <p className="text-center text-gray-700 font-helvetica">
                Scannez ce QR code avec votre téléphone pour effectuer le paiement
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800 text-center font-helvetica">
                  <strong>Montant:</strong> {subtotal.toFixed(2)} €
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <Button
                className={`w-full py-3 text-lg font-semibold rounded-lg font-helvetica ${
                  isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-secondary hover:bg-secondary/90 text-white'
                }`}
                onClick={handlePaymentSuccess}
                disabled={isProcessing}
              >
                {isProcessing ? 'Validation en cours...' : "J'ai payé - Confirmer la commande"}
              </Button>
              <Button
                variant="outline"
                className="w-full border-2 border-gray-300 text-gray-700 hover:bg-gray-50 py-3 text-lg font-semibold rounded-lg font-helvetica"
                onClick={() => setShowSumUpQR(false)}
                disabled={isProcessing}
              >
                Annuler
              </Button>
            </div>
            <p className="text-xs text-gray-500 text-center mt-4 font-helvetica">
              Le paiement sera confirmé automatiquement une fois validé
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentMethod;