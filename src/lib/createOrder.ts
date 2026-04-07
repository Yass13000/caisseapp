// @ts-nocheck
import { supabase, RESTAURANT_ID } from './supabaseClient';
import { insertOrder } from './secureOrderInsert';
import { addLoyaltyPoints, spendLoyaltyPoints } from './loyaltyPoints';
import { registerPlugin } from '@capacitor/core';

// --- INITIALISATION DU PLUGIN EPSON ---
const EpsonPrinter = registerPlugin<any>('EpsonPrinter');

// Polyfill pour crypto.randomUUID si non disponible
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

interface OrderItem {
  product: any;
  quantity: number;
  boisson?: any;
  accompagnement?: any;
  boissonSubChoices?: any[];
  accompagnementSubChoices?: any[];
  isReward?: boolean;
  rewardPoints?: number;
}

interface OrderData {
  items: OrderItem[];
  total: number;
  orderType: string;
  points: number;
  userId?: string | null;
  sumupTransactionId?: string;
  sumupCheckoutId?: string;
  paymentMethod?: 'card' | 'counter';
  order_origin?: string;
  machine_id?: string;
}

export async function createOrderInDatabase(orderData: OrderData) {
  try {
    const activeRestoId = localStorage.getItem('admin_override_restaurant_id') || RESTAURANT_ID;

    // --- GÉNÉRATION DU NUMÉRO SÉQUENTIEL SÉCURISÉ (ANTI-CONFLIT 409) ---
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const { data: todayOrders, error: fetchError } = await supabase
        .from('orders')
        .select('order_number')
        .eq('restaurant_id', activeRestoId)
        .gte('created_at', todayStart.toISOString());
    
    if (fetchError) {
      console.error('Erreur lors de la récupération des commandes', fetchError);
    }
    
    let maxNum = 0;
    if (todayOrders && todayOrders.length > 0) {
      todayOrders.forEach(order => {
        if (order.order_number && order.order_number.startsWith('B')) {
          const num = parseInt(order.order_number.replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      });
    }
    
    const shortOrderNumber = `B${(maxNum + 1).toString().padStart(2, '0')}`;
    // ------------------------------------------------------------------

    const loyaltyUserId = localStorage.getItem('loyaltyUserId');
    const orderTypeLabel = orderData.orderType || localStorage.getItem('orderTypeLabel') || 'Sur place';

    let orderId: string | null = null;

    if (orderData.userId) {
      const orderPayload: any = {
        user_id: orderData.userId,
        restaurant_id: activeRestoId,
        order_details: JSON.stringify(orderData.items),
        total_price: orderData.total,
        status: 'Nouvelle',
        order_number: shortOrderNumber,
        payment_method: orderData.paymentMethod || 'counter',
        payment_status: orderData.paymentMethod === 'card' ? 'paid' : 'pending',
        is_paid: orderData.paymentMethod === 'card',
        order_origin: orderData.order_origin || 'borne',
        machine_id: orderData.machine_id || null,
      };

      if (orderData.sumupTransactionId) orderPayload.sumup_transaction_id = orderData.sumupTransactionId;
      if (orderData.sumupCheckoutId) orderPayload.sumup_checkout_id = orderData.sumupCheckoutId;

      try {
        const orderTypeId = window.localStorage.getItem('orderType');
        if (orderTypeId) orderPayload.order_type_id = orderTypeId;
      } catch (e) {}

      try {
        const deliveryAddress = window.localStorage.getItem('deliveryAddress');
        if (deliveryAddress && orderTypeLabel?.toLowerCase().includes('livraison')) {
          const parsedAddress = JSON.parse(deliveryAddress);
          if (parsedAddress?.address) orderPayload.customer_address = parsedAddress.address;
        }
      } catch (e) {}

      const { data, error } = await supabase.from('orders').insert(orderPayload).select().single();

      if (error) throw new Error(`Échec de création de la commande: ${error.message}`);

      if (data) {
        orderId = data.id;
        // Exécution en asynchrone (Fire and forget) pour ne pas bloquer l'UI
        if (orderData.points > 0) {
          addLoyaltyPoints(orderData.userId, orderData.points, data.id, 'Points gagnés sur commande').catch(e => console.error('❌ Erreur ajout points:', e));
        }
      }
    } else {
      const anonymousOrderPayload: any = {
        order_details: JSON.stringify(orderData.items),
        restaurant_id: activeRestoId,
        total_price: orderData.total,
        status: 'Nouvelle',
        user_id: null,
        order_number: shortOrderNumber,
        payment_method: orderData.paymentMethod || 'counter',
        payment_status: orderData.paymentMethod === 'card' ? 'paid' : 'pending',
        is_paid: orderData.paymentMethod === 'card',
        order_origin: orderData.order_origin || 'borne',
        machine_id: orderData.machine_id || null,
      };

      if (orderData.sumupTransactionId) anonymousOrderPayload.sumup_transaction_id = orderData.sumupTransactionId;
      if (orderData.sumupCheckoutId) anonymousOrderPayload.sumup_checkout_id = orderData.sumupCheckoutId;

      try {
        const orderTypeId = window.localStorage.getItem('orderType');
        if (orderTypeId) anonymousOrderPayload.order_type_id = orderTypeId;
      } catch (e) {}

      try {
        const deliveryAddress = window.localStorage.getItem('deliveryAddress');
        if (deliveryAddress && orderTypeLabel?.toLowerCase().includes('livraison')) {
          const parsedAddress = JSON.parse(deliveryAddress);
          if (parsedAddress?.address) anonymousOrderPayload.customer_address = parsedAddress.address;
        }
      } catch (e) {}

      const result = await insertOrder(anonymousOrderPayload);

      if (result.error) throw new Error(`Échec de création de la commande anonyme: ${result.error.message || 'Erreur 409'}`);

      // Exécution en asynchrone (Fire and forget) pour les points de fidélité
      if (loyaltyUserId) {
        (async () => {
          try {
            const rewardItems = orderData.items.filter((item: OrderItem) => item.isReward && item.rewardPoints);
            if (rewardItems.length > 0) {
              const totalRewardPoints = rewardItems.reduce((sum: number, item: OrderItem) =>
                sum + ((item.rewardPoints || 0) * item.quantity), 0
              );
              const spendResult = await spendLoyaltyPoints(
                loyaltyUserId,
                totalRewardPoints,
                `Récompenses utilisées dans commande #${shortOrderNumber}`
              );
              if (spendResult.success) {
                const currentPoints = parseInt(localStorage.getItem('loyaltyPoints') || '0');
                const newPoints = Math.max(0, currentPoints - totalRewardPoints);
                localStorage.setItem('loyaltyPoints', newPoints.toString());
              }
            }
            if (orderData.points > 0) {
              await addLoyaltyPoints(loyaltyUserId, orderData.points, undefined, 'Points gagnés sur commande');
            }
          } catch (pointsError) {
            console.error('❌ Erreur gestion points fidélité:', pointsError);
          }
        })();
      }
    }

    localStorage.setItem('lastOrderNumber', shortOrderNumber);
    if (orderData.paymentMethod) localStorage.setItem('lastPaymentMethod', orderData.paymentMethod);

    if (loyaltyUserId && orderData.points > 0) {
      try {
        const currentPoints = parseInt(localStorage.getItem('loyaltyPoints') || '0');
        const newPoints = currentPoints + orderData.points;
        localStorage.setItem('loyaltyPoints', newPoints.toString());
        window.dispatchEvent(new CustomEvent('loyaltyPointsUpdated', {
          detail: { newPoints, earnedPoints: orderData.points }
        }));
      } catch (e) {
        console.error('❌ Erreur mise à jour points localStorage:', e);
      }
    }

    sessionStorage.removeItem('pendingOrder');

    // EXÉCUTION EN ARRIÈRE-PLAN POUR L'IMPRIMANTE (Suppression du await bloquant)
    try {
      const currentPrinterIp = localStorage.getItem('printerIp') || '192.168.1.26';
      const statusPaiement = orderData.paymentMethod === 'card' ? 'PAYÉ' : 'NON PAYÉ';
      
      EpsonPrinter.printOrder({
        ip: currentPrinterIp,
        orderId: shortOrderNumber,
        total: orderData.total.toFixed(2),
        items: JSON.stringify(orderData.items),
        paymentStatus: statusPaiement
      }).catch((e: any) => console.error('Erreur silencieuse imprimante', e));
    } catch (printError) {
      // Impression silencieuse
    }

    // Le return se fait instantanément sans attendre que l'imprimante ait fini ou timeout !
    return {
      success: true,
      orderNumber: shortOrderNumber,
      orderId
    };
  } catch (error) {
    console.error('❌ [createOrder] Erreur:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue'
    };
  }
}