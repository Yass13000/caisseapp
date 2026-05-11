// @ts-nocheck
import React, { createContext, useContext, useReducer, useEffect } from 'react';

const CartContext = createContext<any>(null);

// --- GÉNÉRATEUR DE SIGNATURE (ANTI-FUSION) ---
// Cette fonction extrait l'ID produit et TOUS les IDs des options/sous-options
// pour créer une signature infaillible peu importe l'ordre de sélection.
const generateCartKey = (payload: any) => {
    const productId = payload.product ? payload.product.id : payload.id;
    const optIds: string[] = [];

    // Fonction récursive pour trouver tous les champs "id" dans les sélections
    const extractIds = (data: any) => {
        if (!data) return;
        if (Array.isArray(data)) {
            data.forEach(item => {
                // On récupère l'ID de l'option
                if (item && item.id) optIds.push(String(item.id));
                // On fouille au cas où il y a des sous-options imbriquées
                if (item && item.sub_options) extractIds(item.sub_options);
                if (item && item.selectedSubOptions) extractIds(item.selectedSubOptions);
            });
        } else if (typeof data === 'object') {
            Object.values(data).forEach(val => {
                if (Array.isArray(val)) extractIds(val);
            });
        }
    };

    // On scanne tous les champs possibles utilisés pour stocker tes options
    extractIds(payload.selections);
    extractIds(payload.selectedSubOptions);
    extractIds(payload.options);

    // On trie les IDs pour que l'ordre de clic du client ne casse pas la fusion
    optIds.sort();

    return `${productId}_opts_${optIds.join('-')}`;
};

const cartReducer = (state: any, action: any) => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const payload = { ...action.payload };
      
      // SÉCURITÉ 1 : On ignore totalement si l'objet est vide
      if (!payload) return state;

      // SÉCURITÉ 2 : On vérifie que le produit a bien un ID
      const payloadProductId = payload.product ? payload.product.id : payload.id;
      if (payloadProductId === undefined || payloadProductId === null) {
          console.warn("Tentative d'ajout d'un produit sans ID ignorée");
          return state;
      }

      // --- NOUVEAU : LA CLÉ DE PANIER ---
      // On génère la signature exacte du produit + ses sous-options
      const cartKey = generateCartKey(payload);
      
      // On utilise cette signature comme clé absolue
      payload.customKey = cartKey;
      payload._cartKey = cartKey;

      const existingItemIndex = state.items.findIndex((item: any) => {
        if (!item) return false;
        // On compare la signature du nouvel article avec ceux du panier
        const itemKey = item.customKey || item._cartKey || generateCartKey(item);
        return itemKey === cartKey;
      });

      if (existingItemIndex > -1) {
        // FUSION : Mêmes options / Mêmes sous-options exactes -> On additionne la quantité
        const newItems = [...state.items];
        newItems[existingItemIndex] = {
            ...newItems[existingItemIndex],
            quantity: (newItems[existingItemIndex].quantity || 1) + (payload.quantity || 1)
        };
        return { ...state, items: newItems };
      }

      // PAS DE FUSION : Options différentes -> On crée une nouvelle ligne dans le panier
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

// INITIALISATION ET NETTOYAGE DU CACHE
const initCart = () => {
  try {
    const localData = localStorage.getItem('cart');
    if (localData) {
      const parsed = JSON.parse(localData);
      if (parsed && Array.isArray(parsed.items)) {
        
        // Nettoyage agressif des produits corrompus du localStorage
        parsed.items = parsed.items.filter((item: any) => {
            if (!item) return false;
            const pid = item.product ? item.product.id : item.id;
            return pid !== undefined && pid !== null;
        });
        
        return parsed;
      }
    }
  } catch (e) {
    console.error("Erreur de lecture du panier, réinitialisation.", e);
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
        console.error("Erreur de sauvegarde du panier", e);
    }
  }, [state]);

  const addToCart = (item: any) => dispatch({ type: 'ADD_TO_CART', payload: item });
  const removeFromCart = (key: string | number) => dispatch({ type: 'REMOVE_FROM_CART', payload: key });
  const updateQuantity = (key: string | number, quantity: number) => dispatch({ type: 'UPDATE_QUANTITY', payload: { key, quantity } });
  const clearCart = () => dispatch({ type: 'CLEAR_CART' });

  return (
    <CartContext.Provider value={{ state, addToCart, removeFromCart, updateQuantity, clearCart }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
    const context = useContext(CartContext);
    if (!context) throw new Error("useCart doit être utilisé à l'intérieur d'un CartProvider");
    return context;
};