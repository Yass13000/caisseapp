// @ts-nocheck
import React, { createContext, useContext, useReducer, useEffect } from 'react';

const CartContext = createContext<any>(null);

const cartReducer = (state: any, action: any) => {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const payload = action.payload;
      
      // SÉCURITÉ 1 : On ignore totalement si l'objet est vide
      if (!payload) return state;

      // SÉCURITÉ 2 : On récupère l'ID en vérifiant que l'objet product existe bien
      const payloadProductId = payload.product ? payload.product.id : payload.id;
      
      if (payloadProductId === undefined || payloadProductId === null) {
          console.warn("Tentative d'ajout d'un produit sans ID ignorée");
          return state;
      }

      const existingItemIndex = state.items.findIndex((item: any) => {
        if (!item) return false;
        
        const itemProductId = item.product ? item.product.id : item.id;
        
        // Comparaison de l'ID et des options choisies (pour grouper les mêmes articles)
        return itemProductId === payloadProductId && 
               JSON.stringify(item.selections || {}) === JSON.stringify(payload.selections || {});
      });

      if (existingItemIndex > -1) {
        const newItems = [...state.items];
        newItems[existingItemIndex] = {
            ...newItems[existingItemIndex],
            quantity: (newItems[existingItemIndex].quantity || 1) + (payload.quantity || 1)
        };
        return { ...state, items: newItems };
      }

      // Nouvel article
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
            const key1 = item.customKey;
            const key2 = item._cartKey;
            return key1 !== action.payload && key2 !== action.payload;
        }) 
      };
      
    case 'UPDATE_QUANTITY':
      return {
        ...state,
        items: state.items.map((item: any) => {
          if (!item) return item;
          const key1 = item.customKey;
          const key2 = item._cartKey;
          if (key1 === action.payload.key || key2 === action.payload.key) {
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
        
        // SÉCURITÉ 3 : Nettoyage agressif des produits corrompus du localStorage
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
    localStorage.removeItem('cart'); // On vide le cache si le JSON est complètement cassé
  }
  return { items: [] };
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(cartReducer, { items: [] }, initCart);

  // Sauvegarde automatique du panier à chaque changement
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