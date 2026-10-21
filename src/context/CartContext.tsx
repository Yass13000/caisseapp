// @ts-nocheck
import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { toast } from 'sonner';

const CartContext = createContext<any>(null);

// --- NORMALISATION DES MODES DE RÈGLEMENT ---
const normalizePaymentMethod = (rawMethod?: string): string => {
  if (!rawMethod) return 'Espèces';
  const m = String(rawMethod).trim().toLowerCase();

  // On préserve le détail si le règlement est fractionné ou mixte (ex: CB: 10€, Espèces: 5€)
  if (m.includes('fractionn') || m.includes('mixte')) {
    return String(rawMethod).trim();
  }

  // Normalisation stricte de toutes les variantes cartes
  if (
    m.includes('carte') || 
    m.includes('cb') || 
    m.includes('card') || 
    m.includes('stripe') || 
    m.includes('sumup') ||
    m.includes('terminal') ||
    m.includes('tpe')
  ) {
    return 'Carte bancaire';
  }

  // Normalisation espèces
  if (m.includes('espece') || m.includes('espèces') || m.includes('cash')) {
    return 'Espèces';
  }

  // Normalisation titres restaurant
  if (m.includes('ticket') || m.includes('titre') || m.includes('tr')) {
    return 'Titre restaurant';
  }

  return String(rawMethod).trim();
};

// --- GÉNÉRATEUR DE SIGNATURE (ANTI-FUSION) ---
const generateCartKey = (payload: any) => {
    const productId = payload.product ? payload.product.id : payload.id;
    const optIds: string[] = [];

    const extractIds = (data: any) => {
        if (!data) return;
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item && item.id) optIds.push(String(item.id));
                if (item && item.sub_options) extractIds(item.sub_options);
                if (item && item.selectedSubOptions) extractIds(item.selectedSubOptions);
            });
        } else if (typeof data === 'object') {
            Object.values(data).forEach(val => {
                if (Array.isArray(val)) extractIds(val);
            });
        }
    };

    extractIds(payload.selections);
    extractIds(payload.selectedSubOptions);
    extractIds(payload.options);

    optIds.sort();

    return `${productId}_opts_${optIds.join('-')}`;
};

const cartReducer = (state: any, action: any) => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const payload = { ...action.payload };
      
      if (!payload) return state;

      const payloadProductId = payload.product ? payload.product.id : payload.id;
      if (payloadProductId === undefined || payloadProductId === null) {
          console.warn("Tentative d'ajout d'un produit sans ID ignorée");
          return state;
      }

      const cartKey = generateCartKey(payload);
      payload.customKey = cartKey;
      payload._cartKey = cartKey;

      const existingItemIndex = state.items.findIndex((item: any) => {
        if (!item) return false;
        const itemKey = item.customKey || item._cartKey || generateCartKey(item);
        return itemKey === cartKey;
      });

      if (existingItemIndex > -1) {
        const newItems = [...state.items];
        newItems[existingItemIndex] = {
            ...newItems[existingItemIndex],
            quantity: (newItems[existingItemIndex].quantity || 1) + (payload.quantity || 1)
        };
        return { ...state, items: newItems };
      }

      return { 
          ...state, 
          items: [...state.items, { ...payload, quantity: payload.quantity || 1 }] 
      };
    }
    
    case 'REMOVE_FROM_CART':
      return { 
        ...state, 
        items: state.items.filter((item: any) => {
            if (!item) return false;
            const itemKey = item.customKey || item._cartKey || generateCartKey(item);
            return itemKey !== action.payload;
        }) 
      };
      
    case 'UPDATE_QUANTITY':
      return {
        ...state,
        items: state.items.map((item: any) => {
          if (!item) return item;
          const itemKey = item.customKey || item._cartKey || generateCartKey(item);
          if (itemKey === action.payload.key) {
            return { ...item, quantity: Math.max(1, action.payload.quantity) };
          }
          return item;
        })
      };
      
    case 'CLEAR_CART':
      return { ...state, items: [] };
      
    default:
      return state;
  }
};

const initCart = () => {
  try {
    const localData = localStorage.getItem('cart');
    if (localData) {
      const parsed = JSON.parse(localData);
      if (parsed && Array.isArray(parsed.items)) {
        parsed.items = parsed.items.filter((item: any) => {
            if (!item) return false;
            const pid = item.product ? item.product.id : item.id;
            return pid !== undefined && pid !== null;
        });
        return parsed;
      }
    }
  } catch (e) {
    console.error("Erreur de lecture du panier caisse, réinitialisation.", e);
    localStorage.removeItem('cart');
  }
  return { items: [] };
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(cartReducer, { items: [] }, initCart);

  useEffect(() => {
    try {
        localStorage.setItem('cart', JSON.stringify(state));
    } catch(e) {
        console.error("Erreur de sauvegarde du panier caisse", e);
    }
  }, [state]);

  const addToCart = (item: any) => dispatch({ type: 'ADD_TO_CART', payload: item });
  const removeFromCart = (key: string | number) => dispatch({ type: 'REMOVE_FROM_CART', payload: key });
  const updateQuantity = (key: string | number, quantity: number) => dispatch({ type: 'UPDATE_QUANTITY', payload: { key, quantity } });
  const clearCart = () => dispatch({ type: 'CLEAR_CART' });

  // Encaissement direct sécurisé pour la caisse
  const submitCaisseOrder = async (orderDetails: any): Promise<{ success: boolean; order?: any }> => {
    const itemsToProcess = orderDetails?.order_details || state.items;

    if (!itemsToProcess || itemsToProcess.length === 0) {
      toast.error("Le panier est vide.");
      return { success: false };
    }

    try {
      const activeRestoId = orderDetails?.restaurant_id 
        || localStorage.getItem('pos_restaurant_id') 
        || localStorage.getItem('admin_override_restaurant_id') 
        || RESTAURANT_ID;

      // 1. Récupération de la session active de caisse
      let activeSessionId = orderDetails?.session_id || localStorage.getItem('pos_session_id') || null;
      if (!activeSessionId) {
        try {
          const { data: openSession } = await supabase
            .from('cash_sessions')
            .select('id')
            .eq('restaurant_id', activeRestoId)
            .eq('status', 'OPEN')
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (openSession?.id) {
            activeSessionId = openSession.id;
          }
        } catch (err) {
          console.warn("Session active non trouvée :", err);
        }
      }

      // 2. Nettoyage et normalisation du mode de règlement
      const cleanPaymentMethod = normalizePaymentMethod(
        orderDetails?.payment_method || orderDetails?.paymentMethod
      );

      // 3. Construction du payload
      const orderPayload: any = {
        restaurant_id: activeRestoId,
        session_id: activeSessionId,
        order_origin: orderDetails?.order_origin || orderDetails?.orderOrigin || 'caisse',
        status: orderDetails?.status || 'Fermé',
        is_paid: orderDetails?.is_paid ?? true,
        payment_method: cleanPaymentMethod,
        payment_status: orderDetails?.payment_status || 'paid',
        total_price: Number(orderDetails?.total_price) || 0,
        delivery_fee: Number(orderDetails?.delivery_fee ?? orderDetails?.fee ?? 0),
        order_details: itemsToProcess,
        customer_name: orderDetails?.customer_name || orderDetails?.name || 'Client Caisse',
        customer_phone: orderDetails?.customer_phone || orderDetails?.phone || null,
        customer_address: orderDetails?.customer_address || orderDetails?.address || null,
        customer_address_complement: orderDetails?.customer_address_complement || orderDetails?.address_complement || orderDetails?.additionalInfo || null,
        profile_id: orderDetails?.profile_id || orderDetails?.client_id || null,
        order_type_id: orderDetails?.order_type_id || '633425b1-f86c-4c17-8cba-b258906ad317',
        comment: orderDetails?.comment || orderDetails?.notes || null,
        created_at: new Date().toISOString()
      };

      if (orderDetails?.order_number && !orderDetails.order_number.startsWith('REF-')) {
        orderPayload.order_number = orderDetails.order_number;
      }

      // 4. Insertion Supabase
      const { data: insertedOrder, error } = await supabase
        .from('orders')
        .insert([orderPayload])
        .select('id, order_number')
        .single();

      if (error) throw error;

      if (insertedOrder?.order_number) {
        localStorage.setItem('lastOrderNumber', insertedOrder.order_number);
      }
      if (insertedOrder?.id) {
        localStorage.setItem('lastOrderId', insertedOrder.id.toString());
      }

      clearCart();
      return { success: true, order: insertedOrder };

    } catch (err: any) {
      console.error("❌ Erreur encaissement caisse :", err);
      toast.error("Erreur : " + (err.message || "Échec de l'encaissement"));
      return { success: false };
    }
  };

  return (
    <CartContext.Provider value={{ state, addToCart, removeFromCart, updateQuantity, clearCart, submitCaisseOrder }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
    const context = useContext(CartContext);
    if (!context) throw new Error("useCart doit être utilisé à l'intérieur d'un CartProvider");
    return context;
};