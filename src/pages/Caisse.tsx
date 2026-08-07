// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { useCart } from '@/context/CartContext';
import { toast } from "sonner";
import { getFormattedOrderOptions, fetchOptionGroupMapping } from '@/lib/orderFormatter';
import { 
  Trash2, Delete, ShoppingBag, Settings, Lock, 
  ClipboardList, History, Package, Wifi, WifiOff,
  UserRound, CalendarDays, LayoutDashboard, AlertTriangle,
  CreditCard, Banknote, CheckCircle2, Store, ArchiveRestore,
  Calculator, Hourglass, Plus, RotateCcw, RotateCw
} from 'lucide-react';

// Composants
import ProductCard from '@/features/menu/components/ProductCard';
import OptionsModal from '@/features/menu/components/OptionsModal';
import ProductVariantsModal from '@/components/ProductVariantsModal';
import OrderTrackerModal  from '@/components/OrderTrackerModal';
import OrderHistoryModal from '@/components/OrderHistoryModal';
import SettingsModal from '@/components/SettingsModal';
import StockModal from '@/components/StockModal';
import OrdersDashboardModal from '@/components/OrdersDashboardModal';
import NewtonsCradleLoader from '@/components/NewtonsCradleLoader';
import CashSessionModal from '@/components/CashSessionModal';

import { DeliveryModalCaisse } from '@/components/DeliveryModalCaisse'; 

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  is_available: boolean;
  hide_on_kiosk?: boolean;
}

interface Category {
  name: string;
}

const ORDER_TYPE_IDS = {
  'SUR PLACE': '633425b1-f86c-4c17-8cba-b258906ad317',
  'EMPORTER': '2cac3f10-73e2-40a5-a7e0-053bd861b4d9',
  'LIVRAISON': 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d'
};

const getSecureSetting = (key: string, defaultValue: any) => {
  if ((window as any).electronAPI?.getSetting) {
    return (window as any).electronAPI.getSetting(key, defaultValue);
  }
  const local = localStorage.getItem(key);
  if (local === null || local === undefined) return defaultValue;
  return local;
};

const setSecureSetting = (key: string, value: any) => {
  localStorage.setItem(key, String(value));
  if ((window as any).electronAPI?.setSetting) {
    (window as any).electronAPI.setSetting(key, value);
  }
};

const hexToHslString = (hex: string) => {
  if (!hex) return hex;
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  let r = parseInt(hex.substring(0, 2), 16) / 255, g = parseInt(hex.substring(2, 4), 16) / 255, b = parseInt(hex.substring(4, 6), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

const getItemTotal = (item: any, groupMapping: Record<string, string> = {}) => {
  const basePrice = parseFloat(item.product?.price || item.price || 0);
  const groups = getFormattedOrderOptions(item, groupMapping);
  const optsPrice = groups.flatMap(g => g.items).reduce((sum, o) => sum + o.price, 0);
  return (basePrice + optsPrice) * (item.quantity || 1);
};

const getActiveRestaurantId = () => getSecureSetting('pos_restaurant_id', null);

const openCashDrawer = async () => {
  if (!(window as any).electronAPI?.openDrawer) { toast.error("Non disponible sur la version Web."); return; }
  try {
    const printerName = getSecureSetting('imprimante_caisse', undefined) || undefined;
    const result = await (window as any).electronAPI.openDrawer(printerName);
    if (!result?.success) {
      toast.error("Impossible de communiquer avec l'imprimante.");
    } else {
      toast.success("Tiroir ouvert", { duration: 800 });
    }
  } catch (error) { 
    console.error("Erreur ouverture tiroir :", error); 
  }
};

const generateAndPrintReceipt = async (restaurantInfo: { name: string; address: string | null; phone: string | null; tva: number }, orderNumber: string, orderType: string, paymentMethod: string, items: any[], subtotal: number, deliveryFee: number, finalTotal: number, cashAmount: number, clientInfo?: { name?: string; phone?: string; address?: string; notes?: string; additionalInfo?: string } | null, groupMapping: Record<string, string> = {}) => {
  if (!(window as any).electronAPI) return;
  const printerName = getSecureSetting('imprimante_caisse', undefined) || undefined;
  const receiptWidth = getSecureSetting('receipt_width', '72');
  
  const date = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isCash = paymentMethod === 'counter' || paymentMethod.toLowerCase().includes('espèces') || paymentMethod.toLowerCase().includes('especes');
  const isPending = paymentMethod === 'en attente' || paymentMethod.toLowerCase().includes('attente');
  const changeDue = Math.max(0, cashAmount - finalTotal);

  const tvaRate = restaurantInfo.tva || 10;
  const totalHT = finalTotal / (1 + tvaRate / 100);

  const formattedItems = items.map(item => {
    const optionGroups = getFormattedOrderOptions(item, groupMapping);
    const notes = optionGroups.flatMap(grp => grp.items.map(opt => ({
      name: (grp.groupName ? `${grp.groupName}: ` : '') + (opt.qty > 1 ? `${opt.qty}x ` : '') + opt.name,
      isSans: opt.isSans
    })));
    return {
      qty: item.quantity || 1,
      name: item.product?.name || item.name || 'Produit',
      unitPrice: item.price || item.product?.price || 0,
      notes
    };
  });

  const orderPayloadData = {
    orderType,
    orderNumber,
    orderDate: date,
    restaurantName: restaurantInfo.name,
    restaurantAddress: restaurantInfo.address,
    restaurantPhone: restaurantInfo.phone,
    items: formattedItems,
    total: finalTotal,
    delivery: (orderType.toUpperCase().includes('LIVRAISON') || orderType === '3') && clientInfo ? {
      customerName: clientInfo.name,
      address: clientInfo.address,
      phone: clientInfo.phone,
      deliveryNotes: clientInfo.notes || clientInfo.additionalInfo
    } : undefined
  };

  try {
    const result = await (window as any).electronAPI.printReceipt(orderPayloadData, printerName);
    if (!result.success) toast.error("Erreur avec l'imprimante caisse !");
  } catch (error) { console.error("Erreur API impression :", error); }
};

const generateAndPrintKitchenTicket = async (orderNumber: string, orderType: string, items: any[], groupMapping: Record<string, string> = {}) => {
  if (!(window as any).electronAPI) return;
  const printerName = getSecureSetting('imprimante_cuisine', undefined) || undefined;
  const date = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const formattedItems = items.map(item => {
    const optionGroups = getFormattedOrderOptions(item, groupMapping);
    const notes = optionGroups.flatMap(grp => grp.items.map(opt => ({
      name: (grp.groupName ? `${grp.groupName}: ` : '') + (opt.qty > 1 ? `${opt.qty}x ` : '') + opt.name,
      isSans: opt.isSans
    })));
    return {
      qty: item.quantity || 1,
      name: item.product?.name || item.name || 'Produit',
      unitPrice: 0,
      notes
    };
  });

  const kitchenPayloadData = {
    orderType: `CUISINE - ${orderType}`,
    orderNumber,
    orderDate: date,
    restaurantName: 'CUISINE (SAC)',
    items: formattedItems,
    total: 0
  };

  try {
    const result = await (window as any).electronAPI.printReceipt(kitchenPayloadData, printerName);
    if (!result.success) toast.error("Erreur avec l'imprimante cuisine !");
  } catch (error) { console.error("Erreur API impression cuisine :", error); }
};

const PaymentModal = ({ subtotal, themeColors, onClose, onConfirm, isProcessing }: any) => {
  const roundedSubtotal = parseFloat(subtotal.toFixed(2));
  const [remaining, setRemaining] = useState(roundedSubtotal);
  const [tenderedStr, setTenderedStr] = useState("");
  const [lines, setLines] = useState<any[]>([]);

  const inputAmount = parseFloat(tenderedStr) || 0;
  const changeDue = Math.max(0, inputAmount - remaining);

  const handleNumpad = (val: string) => {
    if (val === 'DEL') setTenderedStr(p => p.slice(0, -1));
    else if (val === '.') { if (!tenderedStr.includes('.')) setTenderedStr(p => p + '.'); }
    else if (val === '00') { if (tenderedStr && !tenderedStr.includes('.')) setTenderedStr(p => p + '00'); }
    else { if (tenderedStr.includes('.') && tenderedStr.split('.')[1]?.length >= 2) return; setTenderedStr(p => p + val); }
  };

  const handleAddAmount = (amount: number) => {
    const current = parseFloat(tenderedStr) || 0;
    setTenderedStr((current + amount).toFixed(2).replace(/\.00$/, ''));
  };

  const addPaymentLine = (method: 'CB' | 'Espèces') => {
    let amt = inputAmount;
    if (amt === 0 || (amt > remaining && method === 'CB')) {
      amt = remaining;
    }

    const newLine = { method, amount: parseFloat(amt.toFixed(2)) };
    const nextRemaining = parseFloat((remaining - newLine.amount).toFixed(2));
    
    const updatedLines = [...lines, newLine];
    setLines(updatedLines);
    setTenderedStr("");

    if (nextRemaining <= 0) {
      const finalMethod = updatedLines.map(l => `${l.method}: ${l.amount}€`).join(' + ');
      const totalCash = updatedLines.filter(l => l.method === 'Espèces').reduce((sum, l) => sum + l.amount, 0);
      onConfirm(updatedLines.length > 1 ? `Fractionné (${finalMethod})` : (method === 'CB' ? 'carte bancaire' : 'counter'), totalCash);
    } else {
      setRemaining(nextRemaining);
    }
  };

  const handleExactCount = () => {
    setTenderedStr(remaining.toFixed(2).replace(/\.00$/, ''));
  };

  const resetSplit = () => {
    setRemaining(roundedSubtotal);
    setLines([]);
    setTenderedStr("");
  };

  return createPortal(
    <motion.div 
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999999] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 font-helvetica select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "linear" }}
      style={{ willChange: 'opacity' }}
    >
      <motion.div 
        className="bg-[#F3F4F6] w-[1000px] h-[580px] max-w-[95vw] max-h-[95vh] rounded-[2.5rem] shadow-2xl flex overflow-hidden border border-white/20"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 400, mass: 0.5 }}
        style={{ willChange: 'transform, opacity', transform: 'translateZ(0)' }}
        onClick={(e) => e.stopPropagation()}
      >
        
        <div className="w-[35%] bg-white border-r border-gray-200 flex flex-col p-6 justify-between">
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-3xl font-black text-secondary tracking-tight">{roundedSubtotal.toFixed(2)} €</div>
                <div className="text-[10px] font-black uppercase text-gray-400 tracking-wider mt-1">Total Ticket</div>
              </div>
              {lines.length > 0 && (
                <button onClick={resetSplit} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all active:scale-95 text-gray-500">
                  <RotateCcw size={18} />
                </button>
              )}
            </div>

            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 shadow-inner min-h-[140px] flex flex-col justify-center text-center">
              <div className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">Reste à percevoir</div>
              <div className={`text-4xl font-black tracking-tight ${remaining === 0 ? 'text-primary' : 'text-orange-500'}`}>{remaining.toFixed(2)} €</div>
            </div>

            {lines.length > 0 && (
              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-gray-50 border border-gray-100 px-4 py-3 rounded-xl">
                    <span className="font-black text-xs uppercase text-gray-500 flex items-center gap-2">
                      {line.method === 'CB' ? <CreditCard size={14} className="text-blue-500" /> : <Banknote size={14} className="text-primary" />}
                      {line.method}
                    </span>
                    <span className="font-black text-secondary text-sm">-{line.amount.toFixed(2)} €</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={onClose} disabled={isProcessing} className="w-full py-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 font-black uppercase tracking-wider active:scale-95 transition-all text-xs">
            Retour
          </button>
        </div>

        <div className="flex-1 flex flex-col p-6 gap-4">
          
          <div className="grid grid-cols-2 gap-4 flex-shrink-0">
            <button onClick={() => addPaymentLine('CB')} disabled={isProcessing} className="h-20 bg-blue-600 text-white rounded-2xl flex flex-col items-center justify-center gap-1 hover:bg-blue-700 active:scale-95 transition-all shadow-md">
              <CreditCard size={28} />
              <span className="text-[10px] font-black uppercase tracking-widest">Carte Bancaire</span>
            </button>
            <button onClick={() => addPaymentLine('Espèces')} disabled={isProcessing || (inputAmount < remaining && inputAmount === 0)} className="h-20 bg-primary text-white rounded-2xl flex flex-col items-center justify-center gap-1 hover:bg-primary/90 active:scale-95 transition-all shadow-md disabled:opacity-50">
              <Banknote size={28} />
              <span className="text-[10px] font-black uppercase tracking-widest">Valider Espèces</span>
            </button>
          </div>

          <div className="flex gap-4 items-center bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex-shrink-0 h-20">
            <div className="flex-1">
              <div className="text-2xl font-black text-secondary">{tenderedStr || '0.00'} <span className="text-sm text-gray-400">€</span></div>
            </div>
            {changeDue > 0 && (
              <div className="bg-amber-500 text-white px-4 py-2 rounded-xl font-black text-sm">
                Rendu: {changeDue.toFixed(2)} €
              </div>
            )}
          </div>

          <div className="flex-1 flex gap-4 min-h-0">
            <div className="w-[30%] flex flex-col gap-2">
              <button onClick={handleExactCount} className="flex-1 bg-white border border-gray-200 hover:border-secondary text-secondary font-black text-sm rounded-xl active:scale-95 transition-all shadow-sm">
                Compte Exact
              </button>
              {[5, 10, 20, 50].map(amt => (
                <button key={amt} onClick={() => handleAddAmount(amt)} className="flex-1 bg-white border border-gray-200 hover:border-secondary text-secondary font-black text-sm rounded-xl active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1">
                  <Plus size={12} className="text-gray-400" /> {amt} €
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-2 flex-1">
                {['1','2','3','4','5','6','7','8','9','0','00','.'].map(key => (
                  <button key={key} onClick={() => handleNumpad(key)} className="bg-white border border-gray-200 hover:border-secondary text-secondary text-lg font-black rounded-xl active:scale-95 transition-all shadow-sm flex items-center justify-center">
                    {key}
                  </button>
                ))}
              </div>
              <div className="h-14 flex-shrink-0">
                <button onClick={() => handleNumpad('DEL')} className="w-full h-full bg-red-50 hover:bg-red-100 text-red-500 font-black rounded-xl active:scale-95 transition-all border border-red-100 flex items-center justify-center shadow-sm">
                  <Delete size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>

      </motion.div>
    </motion.div>,
    document.body
  );
};

const Caisse = () => {
  const { state: cartState, addToCart, removeFromCart, updateQuantity, clearCart } = useCart();
  const navigate = useNavigate();

  const [posRestoId, setPosRestoId] = useState<string | null>(getSecureSetting('pos_restaurant_id', null));
  const [tempRestoId, setTempRestoId] = useState("");
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinCode, setPinCode] = useState("");

  const [restaurantLogo, setRestaurantLogo] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState<string>("VOTRE RESTAURANT");
  const [restaurantInfo, setRestaurantInfo] = useState<{ name: string; address: string | null; phone: string | null; tva: number }>({
    name: 'VOTRE RESTAURANT',
    address: null,
    phone: null,
    tva: 10,
  });
  const [themeColors, setThemeColors] = useState({ primary: '#04B855', secondary: '#1f2937', accent: '#FBBF24' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [menuData, setMenuData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [isOrderTrackerOpen, setIsOrderTrackerOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStockOpen, setIsStockOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [loadedOrderId, setLoadedOrderId] = useState<string | number | null>(null);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isVariantsModalOpen, setIsVariantsModalOpen] = useState(false);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
  
  const [initialSelections, setInitialSelections] = useState<any>(null);

  const [orderType, setOrderType] = useState<'SUR PLACE' | 'EMPORTER' | 'LIVRAISON'>('SUR PLACE');
  const [activeOrderTypes, setActiveOrderTypes] = useState<string[]>(['SUR PLACE', 'EMPORTER', 'LIVRAISON']);
  
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [clientInfo, setClientInfo] = useState<{name: string, phone: string, address: string, additionalInfo: string, fee: number} | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);

  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const lastClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});

  const customToast = (msg: string, type: 'success' | 'error' = 'success', options = {}) => 
  toast[type](msg, { duration: 800, ...options });

  // 🟢 Chargement dynamique du mapping pour la caisse
  useEffect(() => {
    const loadMapping = async () => {
      if (cartState.items && cartState.items.length > 0) {
        const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;
        const mapping = await fetchOptionGroupMapping(cartState.items, activeRestoId);
        setOptionGroupMapping(mapping);
      }
    };
    loadMapping();
  }, [cartState.items]);

  const subtotal = cartState.items.reduce((total, item) => total + getItemTotal(item, optionGroupMapping), 0);
  const cartItemCount = cartState.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const activeDeliveryFee = orderType === 'LIVRAISON' ? (parseFloat(deliveryFee) || 0) : 0;
  const finalTotal = subtotal + activeDeliveryFee;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOffline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { clearInterval(timer); window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  const syncOfflineOrders = async () => {
    if (!(window as any).electronAPI?.getOfflineOrders) return;
    try {
      const offlineOrders = await (window as any).electronAPI.getOfflineOrders();
      if (!offlineOrders || offlineOrders.length === 0) return;

      customToast(`Sync de ${offlineOrders.length} ticket(s) local...`, "success");

      for (const order of offlineOrders) {
        const { offline_id, is_update, target_id, ...supabasePayload } = order;
        let error = null;

        if (is_update && target_id) {
          const { error: err } = await supabase
            .from('orders')
            .update(supabasePayload)
            .eq('id', target_id);
          error = err;
        } else {
          const { error: err } = await supabase
            .from('orders')
            .insert([supabasePayload]);
          error = err;
        }

        if (!error) {
          await (window as any).electronAPI.removeOfflineOrder(offline_id);
        }
      }
      customToast("Caisse synchronisée !", "success");
    } catch (err) {
      console.error("Échec boucle sync:", err);
    }
  };

  useEffect(() => {
    if (isOnline && isAuthenticated && posRestoId) {
      syncOfflineOrders();
    }
  }, [isOnline, isAuthenticated, posRestoId]);

  useEffect(() => {
    if (pinCode.length === 4) {
      if (pinCode === (getSecureSetting('pos_pin', '1234'))) {
        setIsAuthenticated(true);
        setPinCode("");

        if (cartState.items.length > 0) {
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
        }

        customToast("Caisse déverrouillée", "success", { duration: 800 });
      } else {
        customToast("Code incorrect", "error");
        setTimeout(() => setPinCode(""), 300);
      }
    }
  }, [pinCode]);

  useEffect(() => {
    if (isAuthenticated && posRestoId) {
      const checkCashSession = async () => {
        try {
          const { data, error } = await supabase
            .from('cash_sessions')
            .select('id')
            .eq('status', 'OPEN')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (data) {
            setCurrentSessionId(data.id);
          } else {
            setIsCashSessionModalOpen(true);
          }
        } catch (e) {
          setIsCashSessionModalOpen(true);
        }
      };
      checkCashSession();
    }
  }, [isAuthenticated, posRestoId, currentSessionId]);

  const loadMenuData = async (activeRestoId: string) => {
    if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') return;
    const [categoriesResponse, productsResponse] = await Promise.all([
      supabase.from('categories').select('*').eq('restaurant_id', activeRestoId).order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true }),
      supabase.from('product').select('*').eq('restaurant_id', activeRestoId).order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true })
    ]);

    if (productsResponse.data) {
      setMenuData(productsResponse.data as Product[]);
      
      const visibleProducts = productsResponse.data.filter((p: any) => p.hide_on_kiosk !== true && p.category?.toLowerCase() !== 'ingredients');
      const activeCategoryNames = new Set<string>();
      
      visibleProducts.forEach((p: any) => {
        if (p.category) activeCategoryNames.add(p.category.trim().toLowerCase());
      });

      let finalCategories: Category[] = [];

      if (categoriesResponse.data && categoriesResponse.data.length > 0) {
        finalCategories = categoriesResponse.data
          .filter((cat: any) => {
            const lowerName = cat.name?.trim().toLowerCase();
            return lowerName !== 'ingredients' && activeCategoryNames.has(lowerName);
          })
          .map((cat: any) => ({ name: cat.name }));
      } else {
        const uniqueCatNames = Array.from(activeCategoryNames);
        finalCategories = uniqueCatNames.map(name => ({ name }));
      }

      setCategories(finalCategories);
      if (!selectedCategory && finalCategories.length > 0) setSelectedCategory(finalCategories[0].name);
    }
  };

  const handleRefreshData = async () => {
    const activeRestoId = getActiveRestaurantId();
    if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') return;
    setIsRefreshing(true);
    try {
      await loadMenuData(activeRestoId);
      customToast("Données actualisées", "success");
    } catch (e) {
      customToast("Erreur d'actualisation", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const activeRestoId = getActiveRestaurantId();
    if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') return;

    const init = async () => {
      setIsLoading(true);
      try {
        if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') throw new Error("ID manquant");
        
        const { data: restoData } = await supabase.from('restaurants').select('name, address, phone, tva, logo_url, theme_primary, theme_secondary, theme_accent, allow_dine_in, allow_takeaway, allow_delivery').eq('id', activeRestoId).single();
        if (restoData) {
          if (restoData.name) setRestaurantName(restoData.name);
          if (restoData.logo_url) setRestaurantLogo(restoData.logo_url);
          const tvaRate = (restoData.tva !== null && restoData.tva !== undefined) ? Number(restoData.tva) : 10;
          setRestaurantInfo({
            name: restoData.name || 'VOTRE RESTAURANT',
            address: restoData.address || null,
            phone: restoData.phone || null,
            tva: tvaRate,
          });
          setThemeColors({
            primary: restoData.theme_primary || '#04B855',
            secondary: restoData.theme_secondary || '#1f2937',
            accent: restoData.theme_accent || '#FBBF24'
          });
          
          if (restoData.theme_primary) document.documentElement.style.setProperty('--primary', hexToHslString(restoData.theme_primary));
          if (restoData.theme_secondary) document.documentElement.style.setProperty('--secondary', hexToHslString(restoData.theme_secondary));
          if (restoData.theme_accent) document.documentElement.style.setProperty('--accent', hexToHslString(restoData.theme_accent));

          const types: string[] = [];
          if (restoData.allow_dine_in !== false) types.push('SUR PLACE');
          if (restoData.allow_takeaway !== false) types.push('EMPORTER');
          if (restoData.allow_delivery !== false) types.push('LIVRAISON');
          
          if (types.length === 0) types.push('SUR PLACE');
          
          setActiveOrderTypes(types);
          setOrderType(types[0] as any);
        }

        await loadMenuData(activeRestoId);
      } catch (e) {
        customToast("Erreur de connexion", "error");
      } finally {
        setIsLoading(false);
      }
    };
    init();

    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, [posRestoId]);

  const [previousOrderType, setPreviousOrderType] = useState<'SUR PLACE' | 'EMPORTER' | 'LIVRAISON'>('SUR PLACE');

  const handleOrderTypeChange = (type: any) => {
    if (type === 'LIVRAISON') {
      if (orderType !== 'LIVRAISON') {
        setPreviousOrderType(orderType);
      }
      setOrderType('LIVRAISON');
      setIsDeliveryModalOpen(true);
    } else {
      setOrderType(type);
      setDeliveryFee(0);
    }
  };

  const handleClientConfirm = (data: any) => {
    setClientInfo(data);
    const fee = parseFloat(data?.fee ?? data?.delivery_fee ?? data?.deliveryFee ?? data?.frais_livraison ?? 0);
    setDeliveryFee(isNaN(fee) ? 0 : fee);
    setIsDeliveryModalOpen(false);
    toast.success(`Client ${data?.name || ''} enregistré !`);
  };

  const handleDeliveryModalClose = () => {
    setIsDeliveryModalOpen(false);
  };

  const handleLoadOrderIntoCart = (items: any[], orderId: string | number, loadedOrderType?: string, loadedClientInfo?: any) => {
    setLoadedOrderId(orderId);
    clearCart();
    setDeliveryFee(0);
    setClientInfo(null);
    
    if (loadedOrderType && activeOrderTypes.includes(loadedOrderType)) {
      setOrderType(loadedOrderType as any);
    }

    if (loadedClientInfo && Object.keys(loadedClientInfo).length > 0) {
      setClientInfo(loadedClientInfo);
      if (loadedClientInfo.fee || loadedClientInfo.delivery_fee) {
        setDeliveryFee(parseFloat(loadedClientInfo.fee || loadedClientInfo.delivery_fee) || 0);
      }
    }

    setTimeout(() => {
      items.forEach((item, idx) => {
        const baseId = item.product?.id || item.id;
        const formattedItem = {
          ...item,
          id: `${baseId}-loaded-${idx}`,
          product: { id: item.id, name: item.name, price: item.price },
          quantity: item.quantity || 1,
          cartKey: `loaded-${orderId}-${idx}-${Math.random()}`
        };
        addToCart(formattedItem);
      });
      customToast(`Commande #${orderId} chargée (${loadedOrderType || 'SUR PLACE'})`, "success");
    }, 150);
  };

  const handleSelectProduct = async (product: Product) => {
    if (!product.is_available) { customToast("Produit indisponible", "error"); return; }
    try {
      const { data: variants } = await supabase.from('product_variants').select('id').eq('product_id', product.id).eq('available', true).limit(1);
      if (variants?.length) {
        setSelectedProductForVariants(product);
        setIsVariantsModalOpen(true);
        return;
      }

      const { data: optionGroups } = await supabase.from('product_option_groups').select('id').eq('product_id', product.id).limit(1);
      if (optionGroups?.length) {
        setSelectedProduct(product);
        setIsOptionsModalOpen(true);
      } else {
        const uniqueId = `${product.id}-no-opts`;
        addToCart({ id: uniqueId, product, quantity: 1, cartKey: uniqueId, customKey: uniqueId } as any);
      }
    } catch (err) {
      const uniqueId = `${product.id}-no-opts`;
      addToCart({ id: uniqueId, product, quantity: 1, cartKey: uniqueId, customKey: uniqueId } as any);
    }
  };

  const handleAddToCartFromModal = (p: Product, incomingData: any) => {
    let finalFlatOptions: any[] = [];
    let finalRawSelections: any = null;
    let removedIngredientsList: any[] = [];

    if (incomingData && incomingData.flatOptions && incomingData.rawSelections) {
      finalFlatOptions = incomingData.flatOptions;
      finalRawSelections = incomingData.rawSelections;
      removedIngredientsList = incomingData.removedIngredients || [];
    } 
    else {
      if (Array.isArray(incomingData)) {
        incomingData.forEach(opt => { finalFlatOptions.push({ ...opt, print_order: 1 }); });
        removedIngredientsList = incomingData.removedIngredients || [];
      } else if (typeof incomingData === 'object' && incomingData !== null) {
        const sortedKeys = Object.keys(incomingData).sort((a, b) => parseInt(a) - parseInt(b));
        sortedKeys.forEach(key => {
          const val = incomingData[key];
          const arr = Array.isArray(val) ? val : [val];
          arr.forEach((opt: any) => {
            if (typeof opt === 'object') finalFlatOptions.push({ ...opt, print_order: 1 });
            else if (typeof opt === 'string') finalFlatOptions.push({ name: opt, price: 0, print_order: 1 });
          });
        });
        removedIngredientsList = incomingData.removedIngredients || [];
      }
      finalRawSelections = incomingData;
    }

    const optionsString = finalFlatOptions.map(o => `${o.group_name || o.option_group_name || 'Opt'}:${o.name}`).join('-');
    const removedString = removedIngredientsList.map((i: any) => i.name || i.id).join('-');
    const optionsHash = btoa(encodeURIComponent(`${optionsString}_${removedString}`)).substring(0, 15);
    const uniqueCartKey = `${p.id}-${optionsHash}`;

    let originalQty = 1;
    if (editingItemKey) {
      const found = cartState.items.find((item: any) => (item.customKey || item.cartKey || item.id) === editingItemKey);
      if (found) originalQty = found.quantity || 1;
      removeFromCart(editingItemKey);
      setEditingItemKey(null);
    }

    addToCart({
      id: uniqueCartKey,
      product: p,
      selectedSubOptions: finalFlatOptions,
      rawSelections: finalRawSelections,
      removedIngredients: removedIngredientsList,
      quantity: originalQty,
      cartKey: uniqueCartKey,
      customKey: uniqueCartKey
    } as any);

    setIsOptionsModalOpen(false);
    setSelectedProduct(null);
    setInitialSelections(null);
  };

  const finalizePayment = async (method: 'carte bancaire' | 'counter' | string, cashAmount: number = 0) => {
    if (cartState.items.length === 0) return;
    
    if (!currentSessionId) {
      customToast("Veuillez ouvrir la caisse d'abord !", "error");
      setIsCashSessionModalOpen(true);
      setIsPaymentModalOpen(false);
      return;
    }

    setIsProcessing(true);
    
    const activeRestoId = getActiveRestaurantId();
    const cleanOrderDetails = JSON.parse(JSON.stringify(cartState.items));
    const currentOrderTypeId = ORDER_TYPE_IDS[orderType];
    let targetOrderNumber = `C${String(Date.now()).slice(-4)}`;

    const offlineId = `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const orderPayload = {
      offline_id: offlineId,
      is_update: !!loadedOrderId,
      target_id: loadedOrderId || null,
      restaurant_id: activeRestoId,
      total_price: parseFloat(finalTotal.toFixed(2)),
      delivery_fee: activeDeliveryFee, 
      is_paid: true,
      payment_status: 'paid',
      status: 'En cours',
      payment_method: method,
      cash_amount: cashAmount,
      order_origin: 'caisse',
      order_type_id: currentOrderTypeId,
      order_details: cleanOrderDetails,
      customer_name: clientInfo?.name || 'Client Caisse',
      customer_phone: clientInfo?.phone || null,
      customer_address: clientInfo ? `${clientInfo.address} ${clientInfo.additionalInfo ? `- ${clientInfo.additionalInfo}` : ''}`.trim() : null,
      order_number: targetOrderNumber,
      session_id: currentSessionId 
    };

    if (!isOnline) {
      if ((window as any).electronAPI?.saveOfflineOrder) {
        await (window as any).electronAPI.saveOfflineOrder(orderPayload);
        customToast(`Encaissé (Hors-ligne) ${finalTotal.toFixed(2)}€`, "success");
        await generateAndPrintReceipt(restaurantInfo, targetOrderNumber, orderType, method, cartState.items, subtotal, activeDeliveryFee, finalTotal, cashAmount, clientInfo, optionGroupMapping);
        
        const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
        if (isKitchenTicketEnabled && !loadedOrderId) {
          setTimeout(async () => {
            await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping);
          }, 500);
        }

        clearCart();
        setLoadedOrderId(null);
        setDeliveryFee(0);
        setClientInfo(null);
        setIsPaymentModalOpen(false);
      } else {
        customToast("Erreur : Mode hors-ligne impossible sur le Web", "error");
      }
      setIsProcessing(false);
      return;
    }

    try {
      if (loadedOrderId) {
        const { error } = await supabase
          .from('orders')
          .update({ 
            is_paid: true, 
            payment_status: 'paid', 
            status: 'En cours', 
            payment_method: method, 
            cash_amount: cashAmount, 
            order_type_id: currentOrderTypeId || undefined,
            order_details: cleanOrderDetails,
            total_price: parseFloat(finalTotal.toFixed(2)),
            delivery_fee: activeDeliveryFee,
            session_id: currentSessionId 
          })
          .eq('id', loadedOrderId);
        if (error) throw error;

        const { data: orderData } = await supabase.from('orders').select('order_number').eq('id', loadedOrderId).single();
        if (orderData?.order_number) targetOrderNumber = orderData.order_number;
      } else {
        try {
          const { data: nextNum, error: rpcError } = await supabase.rpc('get_next_order_number', { prefix: 'C' });
          if (!rpcError && nextNum) targetOrderNumber = nextNum;
        } catch (err) {}

        orderPayload.order_number = targetOrderNumber;
        const { offline_id, is_update, target_id, ...insertPayload } = orderPayload;

        const { error } = await supabase.from('orders').insert([insertPayload]);
        if (error) throw error;
      }

      customToast(`Encaissé ${finalTotal.toFixed(2)}€`, "success");

      const isAutoPrintReceiptEnabled = getSecureSetting('auto_print_receipt', 'false') === 'true';
      if (isAutoPrintReceiptEnabled) {
        await generateAndPrintReceipt(restaurantInfo, targetOrderNumber, orderType, method, cartState.items, subtotal, activeDeliveryFee, finalTotal, cashAmount, clientInfo, optionGroupMapping);
      }
      
      const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
      if (isKitchenTicketEnabled && !loadedOrderId) {
        setTimeout(async () => {
          await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping);
        }, 500);
      }

      clearCart();
      setLoadedOrderId(null);
      setDeliveryFee(0);
      setClientInfo(null);
      setIsPaymentModalOpen(false);

    } catch (e) {
      console.error("Crash réseau inattendu, bascule de secours locale :", e);
      if ((window as any).electronAPI?.saveOfflineOrder) {
        orderPayload.order_number = targetOrderNumber;
        await (window as any).electronAPI.saveOfflineOrder(orderPayload);
        customToast(`Encaissé (Local de secours) ${finalTotal.toFixed(2)}€`, "success");
        await generateAndPrintReceipt(restaurantInfo, targetOrderNumber, orderType, method, cartState.items, subtotal, activeDeliveryFee, finalTotal, cashAmount, clientInfo, optionGroupMapping);
        
        clearCart();
        setLoadedOrderId(null);
        setDeliveryFee(0);
        setClientInfo(null);
        setIsPaymentModalOpen(false);
      } else {
        customToast("Erreur d'enregistrement BDD", "error");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const processPendingOrder = async () => {
    if (cartState.items.length === 0) return;
    
    if (!currentSessionId) {
      customToast("Veuillez ouvrir la caisse d'abord !", "error");
      setIsCashSessionModalOpen(true);
      return;
    }

    setIsProcessing(true);
    
    const activeRestoId = getActiveRestaurantId();
    const cleanOrderDetails = JSON.parse(JSON.stringify(cartState.items));
    const currentOrderTypeId = ORDER_TYPE_IDS[orderType];
    let targetOrderNumber = `C${String(Date.now()).slice(-4)}`;

    const offlineId = `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const orderPayload = {
      offline_id: offlineId,
      is_update: !!loadedOrderId,
      target_id: loadedOrderId || null,
      restaurant_id: activeRestoId,
      total_price: parseFloat(finalTotal.toFixed(2)),
      delivery_fee: activeDeliveryFee, 
      is_paid: false,
      payment_status: 'pending',
      status: 'En cours',
      payment_method: 'en attente',
      cash_amount: 0,
      order_origin: 'caisse',
      order_type_id: currentOrderTypeId,
      order_details: cleanOrderDetails,
      customer_name: clientInfo?.name || 'Client Caisse',
      customer_phone: clientInfo?.phone || null,
      customer_address: clientInfo ? `${clientInfo.address} ${clientInfo.additionalInfo ? `- ${clientInfo.additionalInfo}` : ''}`.trim() : null,
      order_number: targetOrderNumber,
      session_id: currentSessionId 
    };

    if (!isOnline) {
      if ((window as any).electronAPI?.saveOfflineOrder) {
        await (window as any).electronAPI.saveOfflineOrder(orderPayload);
        customToast(`En attente (Hors-ligne) ${finalTotal.toFixed(2)}€`, "success");
        
        const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
        if (isKitchenTicketEnabled && !loadedOrderId) {
          setTimeout(async () => {
            await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping);
          }, 500);
        }

        clearCart();
        setLoadedOrderId(null);
        setDeliveryFee(0);
        setClientInfo(null);
      } else {
        customToast("Erreur : Mode hors-ligne impossible sur le Web", "error");
      }
      setIsProcessing(false);
      return;
    }

    try {
      if (loadedOrderId) {
        const { error } = await supabase
          .from('orders')
          .update({ 
            is_paid: false, 
            payment_status: 'pending', 
            status: 'En cours', 
            payment_method: 'en attente', 
            cash_amount: 0, 
            order_type_id: currentOrderTypeId || undefined,
            order_details: cleanOrderDetails,
            total_price: parseFloat(finalTotal.toFixed(2)),
            delivery_fee: activeDeliveryFee, 
            session_id: currentSessionId 
          })
          .eq('id', loadedOrderId);
        if (error) throw error;

        const { data: orderData } = await supabase.from('orders').select('order_number').eq('id', loadedOrderId).single();
        if (orderData?.order_number) targetOrderNumber = orderData.order_number;
      } else {
        try {
          const { data: nextNum, error: rpcError } = await supabase.rpc('get_next_order_number', { prefix: 'C' });
          if (!rpcError && nextNum) targetOrderNumber = nextNum;
        } catch (err) {}

        orderPayload.order_number = targetOrderNumber;
        const { offline_id, is_update, target_id, ...insertPayload } = orderPayload;

        const { error } = await supabase.from('orders').insert([insertPayload]);
        if (error) throw error;
      }

      customToast(`Commande en attente de ${finalTotal.toFixed(2)}€`, "success");
      
      const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
      if (isKitchenTicketEnabled && !loadedOrderId) {
        setTimeout(async () => {
          await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping);
        }, 500);
      }

      clearCart();
      setLoadedOrderId(null);
      setDeliveryFee(0);
      setClientInfo(null);

    } catch (e) {
      console.error("Crash réseau inattendu, bascule de secours locale :", e);
      if ((window as any).electronAPI?.saveOfflineOrder) {
        orderPayload.order_number = targetOrderNumber;
        await (window as any).electronAPI.saveOfflineOrder(orderPayload);
        customToast(`En attente (Sauvegardé localement) ${finalTotal.toFixed(2)}€`, "success");
        
        clearCart();
        setLoadedOrderId(null);
        setDeliveryFee(0);
        setClientInfo(null);
      } else {
        customToast("Erreur d'enregistrement BDD", "error");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const rightBarBtnClass = "w-[56px] h-[56px] flex flex-col items-center justify-center text-primary rounded-xl hover:bg-white/10 active:scale-95 transition-all shadow-sm mx-auto";

  if (!posRestoId) {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-100 items-center justify-center font-helvetica select-none relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none"></div>
        <div className="relative z-10 bg-white/80 backdrop-blur-xl p-10 rounded-[2.5rem] shadow-[0_20px_80px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center border border-white max-w-[450px] w-full mx-4">
          <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-[2rem] flex items-center justify-center mb-6 shadow-inner border border-blue-100"><Store size={40} strokeWidth={2.5} /></div>
          <h2 className="text-secondary text-2xl font-black uppercase tracking-widest mb-2 text-center">Configuration</h2>
          <p className="text-gray-400 font-bold text-xs mb-8 uppercase tracking-wider text-center">Liaison de la caisse au restaurant</p>
          
          <input type="text" placeholder="Collez l'ID du restaurant ici..." className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl px-6 py-5 mb-6 text-gray-700 font-bold focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-center shadow-sm" value={tempRestoId} onChange={(e) => setTempRestoId(e.target.value)} />
          
          <button onClick={async () => {
            const trimmed = tempRestoId.trim();
            if (trimmed.length > 5) {
              setIsLoading(true);
              try {
                const { data, error } = await supabase.from('restaurants').select('id, name').eq('id', trimmed).single();
                if (error || !data) {
                  toast.error("Cet ID Restaurant n'existe pas en ligne ! Enregistrement annulé.");
                } else {
                  setSecureSetting('pos_restaurant_id', trimmed);
                  setPosRestoId(trimmed);
                  toast.success(`Caisse liée avec succès à ${data.name} !`);
                }
              } catch(e) {
                toast.error("Erreur de connexion lors de la vérification");
              } finally {
                setIsLoading(false);
              }
            } else toast.error("Veuillez entrer un ID valide.");
          }} className="w-full py-5 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-black uppercase text-lg tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-500/30">
            Connecter la caisse
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) return <NewtonsCradleLoader />;

  if (!isAuthenticated) {
    const pinBtnClass = "w-16 h-16 bg-white hover:bg-gray-100 rounded-2xl text-secondary font-black text-2xl active:scale-90 transition-all shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] border border-gray-100 flex items-center justify-center group";
    
    return (
      <div className="flex flex-col h-screen w-full bg-background items-center justify-center font-helvetica select-none relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center text-secondary/50 font-bold z-20">
          <span className={isOnline ? 'text-secondary/50' : 'text-red-500 animate-pulse'}>{isOnline ? <Wifi size={24} /> : <WifiOff size={24} />}</span>
          <span className="text-xl tracking-wider">{currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-primary/10 blur-[100px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-[0_20px_80px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center border border-white max-w-[300px] w-full mx-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/30 overflow-hidden bg-white border border-gray-100" style={{ backgroundColor: !restaurantLogo ? themeColors.primary : undefined }}>
            {restaurantLogo ? <img src={restaurantLogo} alt="Logo" className="w-full h-full object-contain p-1.5" /> : <Lock className="text-white w-7 h-7" />}
          </div>
          
          <h2 className="text-secondary text-xl font-black uppercase tracking-widest mb-1">Caisse Sécurisée</h2>
          <p className="text-gray-400 font-bold text-[10px] mb-6 uppercase tracking-widest">Entrez le code d'accès</p>
          
          <div className="flex gap-3 mb-6">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-inner ${pinCode.length > i ? 'scale-125 shadow-md bg-gray-200' : ''}`} style={pinCode.length > i ? { backgroundColor: themeColors.primary } : undefined}></div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[1,2,3,4,5,6,7,8,9].map(num => (
              <button key={num} onClick={() => setPinCode(p => p.length < 4 ? p + num : p)} className={pinBtnClass}>{num}</button>
            ))}
            <button onClick={() => setPinCode(p => p.length < 4 ? p + '0' : p)} className={pinBtnClass}>0</button>
            <button onClick={() => setPinCode(p => p.slice(0, -1))} className="w-16 h-16 bg-red-50 hover:bg-red-100 text-red-500 rounded-2xl font-black flex items-center justify-center active:scale-90 transition-all shadow-sm"><Delete size={24} /></button>
          </div>

          <button onClick={() => navigate('/')} className="mt-6 px-5 py-2 rounded-full bg-gray-100 text-gray-500 font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors text-[9px]">Retour à l'accueil</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-gray-100 font-helvetica overflow-hidden select-none">
      
      <div className="flex-shrink-0 h-8 text-white/90 flex justify-between items-center px-4 text-[11px] font-bold tracking-widest uppercase z-50 shadow-md" style={{ backgroundColor: themeColors.secondary }}>
        <div className="flex items-center gap-4">
          <div className={isOnline ? 'text-green-400' : 'text-red-500 animate-pulse'}>{isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}</div>
          <div className="w-px h-3 bg-white/20"></div>
          <div className="flex items-center gap-1.5 text-white/80"><UserRound size={14} /> <span>Caisse Principale</span></div>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-white font-black text-[13px] tracking-[0.2em]">{currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="flex items-center gap-4">
          <CalendarDays size={14} /> <span>{currentTime.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
          <div className="w-px h-3 bg-white/20"></div>
          <button 
            onClick={handleRefreshData} 
            disabled={isRefreshing}
            className="flex items-center gap-1.5 hover:text-white text-white/80 transition-colors active:scale-95 disabled:opacity-50"
            title="Actualiser les données"
          >
            <RotateCw size={14} className={isRefreshing ? 'animate-spin text-primary' : ''} />
            <span>Actualiser</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        <div className="flex-1 flex flex-col h-full bg-[#F3F4F6] relative min-w-0">
          
          <div className="bg-white border-b border-gray-200 shadow-sm flex-shrink-0 z-20">
            {activeOrderTypes.length > 0 && (
              <div className="flex p-2 gap-2 bg-gray-100">
                {activeOrderTypes.map(type => (
                  <button key={type} onClick={() => handleOrderTypeChange(type as any)} className={`flex-1 py-3 rounded-xl font-black text-xs uppercase transition-all shadow-sm ${orderType === type ? 'text-white scale-[1.02]' : 'bg-white text-gray-500 hover:bg-gray-50'}`} style={orderType === type ? { backgroundColor: themeColors.secondary } : undefined}>
                    {type === 'SUR PLACE' ? 'Sur Place' : type === 'EMPORTER' ? 'À Emporter' : 'Livraison'}
                  </button>
                ))}
              </div>
            )}

            <div className="p-4 grid grid-cols-5 gap-3 border-t border-gray-200">
              {categories.map(cat => (
                <button key={cat.name} onClick={() => setSelectedCategory(cat.name)} className={`h-[70px] rounded-xl font-black text-[13px] xl:text-[15px] uppercase tracking-wide transition-all border-4`} style={{ backgroundColor: selectedCategory === cat.name ? themeColors.secondary : '#f9fafb', borderColor: selectedCategory === cat.name ? themeColors.secondary : '#f3f4f6', color: selectedCategory === cat.name ? '#ffffff' : themeColors.secondary }}>
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-4 gap-4 content-start">
              {menuData.filter(p => p.category === selectedCategory).map(product => (
                <ProductCard key={product.id} product={product as any} onSelectProduct={handleSelectProduct as any} />
              ))}
            </div>
          </div>
        </div>

        {/* 🟢 PANNEAU DU TICKET DE CAISSE DE DROITE AVEC ORDER FORMATTER */}
        <div className="w-[260px] bg-white border-l border-gray-200 flex flex-col h-full z-30 shadow-xl flex-shrink-0">
          
          <div className="p-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex justify-between items-center">
            <div className="flex flex-col">
              <span className="font-black text-sm uppercase" style={{ color: themeColors.secondary }}>Ticket {loadedOrderId && `Borne`}</span>
              {clientInfo?.name && (
                <button onClick={() => setIsDeliveryModalOpen(true)} className="text-[10px] text-primary font-bold text-left hover:underline">
                  👤 {clientInfo.name}
                </button>
              )}
            </div>
            <span className="flex items-center gap-1.5 bg-gray-200 px-2.5 py-1 rounded-lg font-black text-xs" style={{ color: themeColors.secondary }}><ShoppingBag size={14} /> {cartItemCount}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 bg-gray-50/50 custom-scrollbar">
            {cartState.items.map((item: any, index: number) => {
              const itemKey = item.customKey || item.cartKey || item.id || String(item.product?.id);
              const optionGroups = getFormattedOrderOptions(item, optionGroupMapping);

              return (
                <div 
                  key={`${itemKey}-${index}`} 
                  className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm relative overflow-hidden cursor-pointer select-none"
                  onClick={() => {
                    const now = Date.now();
                    if (lastClickRef.current.id === itemKey && now - lastClickRef.current.time < 300) {
                      const fullProduct = menuData.find(p => p.id === (item.product?.id || item.id)) || item.product || item;
                      setEditingItemKey(itemKey);
                      setSelectedProduct(fullProduct);
                      
                      setInitialSelections(item.rawSelections || null);
                      
                      setIsOptionsModalOpen(true);
                      lastClickRef.current = { id: '', time: 0 };
                    } else {
                      lastClickRef.current = { id: itemKey, time: now };
                    }
                  }}
                >
                  <div className="flex justify-between items-start gap-1">
                    <div className="flex-1 min-w-0 pr-1">
                      <h4 className="font-bold text-gray-800 text-[11px] leading-tight line-clamp-2">{item.product?.name || item.name}</h4>
                      
                      {/* 🟢 AFFICHAGE UNIFIÉ DES OPTIONS PAR GROUPE */}
                      {optionGroups.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-[9px]">
                          {optionGroups.map((grp, gIdx) => (
                            <div key={gIdx} className="flex flex-wrap items-baseline gap-0.5 leading-tight">
                              {grp.groupName ? (
                                <span className="font-bold text-slate-500 uppercase text-[8px] tracking-wider">
                                  {grp.groupName} :
                                </span>
                              ) : null}
                              {grp.items.map((opt, oIdx) => (
                                <span key={oIdx} className="inline">
                                  <span className={opt.isSans ? "text-red-500 font-bold" : "text-gray-600 font-medium"}>
                                    {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                  </span>
                                  {opt.price > 0 && <span className="text-gray-400"> (+{opt.price.toFixed(2)}€)</span>}
                                  {oIdx < grp.items.length - 1 ? ', ' : ''}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                    </div>
                    <div className="font-black text-[12px] whitespace-nowrap" style={{ color: themeColors.secondary }}>{getItemTotal(item, optionGroupMapping).toFixed(2)}€</div>
                  </div>
                  
                  <div className="mt-1.5 flex items-center justify-between">
                    <button onClick={(e) => { e.stopPropagation(); removeFromCart(itemKey); }} className="p-1 text-red-500 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
                    <div className="flex items-center gap-1.5 bg-gray-100 rounded-full px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                      <button className="w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-xs" onClick={() => updateQuantity(itemKey, (item.quantity || 1) - 1)}>-</button>
                      <span className="w-4 text-center font-bold text-xs">{item.quantity || 1}</span>
                      <button className="w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-xs" style={{ color: themeColors.primary }} onClick={() => updateQuantity(itemKey, (item.quantity || 1) + 1)}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t-2 border-gray-200 bg-white flex-shrink-0">
            {orderType === 'LIVRAISON' && (
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 font-bold text-xs uppercase tracking-wider">Frais Livraison</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={deliveryFee || ''}
                    onChange={e => setDeliveryFee(parseFloat(e.target.value) || 0)}
                    className="w-16 text-right font-black text-secondary bg-gray-100 border border-gray-200 rounded px-2 py-1 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                  <span className="text-gray-400 font-bold text-xs">€</span>
                </div>
              </div>
            )}

            <div className="flex justify-between items-end mb-3">
              <span className="text-gray-400 font-bold text-xs uppercase tracking-wider">Total</span>
              <span className="text-2xl font-black whitespace-nowrap" style={{ color: themeColors.secondary }}>{finalTotal.toFixed(2)} €</span>
            </div>
            
            <div className="flex gap-2">
              <button 
                disabled={cartItemCount === 0 || isProcessing} 
                onClick={processPendingOrder} 
                className="w-16 bg-orange-50 text-orange-500 flex items-center justify-center rounded-xl hover:bg-orange-100 active:scale-95 disabled:opacity-50 transition-all border border-orange-100" 
                title="Mettre en attente de paiement"
              >
                <Hourglass size={24} />
              </button>
              
              <button 
                disabled={cartItemCount === 0 || isProcessing} 
                onClick={() => setIsPaymentModalOpen(true)} 
                className="flex-1 text-white font-black text-xl py-3 rounded-xl shadow-md active:scale-95 disabled:opacity-50 transition-transform uppercase tracking-wider" 
                style={{ backgroundColor: themeColors.primary }}
              >
                PAYER
              </button>

              <button 
                disabled={cartItemCount === 0 || isProcessing} 
                onClick={() => setShowClearConfirm(true)} 
                className="w-16 bg-red-50 text-red-500 flex items-center justify-center rounded-xl hover:bg-red-100 active:scale-95 disabled:opacity-50 transition-all border border-red-100"
              >
                <Trash2 size={24} />
              </button>
            </div>
          </div>
        </div>

        <div className="w-[74px] flex flex-col items-center py-3 z-40 shadow-[-5px_0_15px_rgba(0,0,0,0.2)] flex-shrink-0 justify-between" style={{ backgroundColor: themeColors.secondary }}>
          <div className="flex flex-col gap-1.5 w-full px-2 items-center">
            
            <button disabled={cartItemCount === 0 || isProcessing} onClick={() => finalizePayment('carte bancaire', 0)} className={`w-[56px] h-[56px] mx-auto flex flex-col items-center justify-center rounded-xl transition-all shadow-sm ${cartItemCount > 0 && !isProcessing ? 'bg-[#04B855] text-white hover:bg-[#039d48] active:scale-95' : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'}`} title="Paiement Rapide CB">
              <CreditCard size={24} />
              <span className="text-[8px] font-black uppercase mt-0.5 tracking-wider">Rapide</span>
            </button>
            <div className="w-full h-px bg-white/10 my-1"></div>
            
            <button onClick={() => setIsDashboardOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><LayoutDashboard size={24} /></button>
            <button onClick={() => setIsOrderTrackerOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><ClipboardList size={24} /></button>
            <button onClick={() => setIsHistoryOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><History size={24} /></button>
            <button onClick={openCashDrawer} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Ouvrir le tiroir caisse"><ArchiveRestore size={24} /></button>
            
            <button onClick={() => setIsCashSessionModalOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Gestion Caisse (Ticket X/Z)"><Calculator size={24} /></button>
            
            <button onClick={() => setIsStockOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Gérer les stocks"><Package size={24} /></button>
            <button onClick={() => setIsSettingsOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><Settings size={24} /></button>
          </div>
          
          <div className="w-full px-2 pb-1">
            <button onClick={() => { if (cartItemCount > 0) { setShowClearConfirm(true); } else { setIsAuthenticated(false); } }} className={rightBarBtnClass} style={{ color: themeColors.primary }}><Lock size={24} className="text-red-400" /></button>
          </div>
        </div>

      </div>

      {isDeliveryModalOpen && (
        <DeliveryModalCaisse 
          isOpen={isDeliveryModalOpen}
          onClose={handleDeliveryModalClose}
          onConfirm={handleClientConfirm}
          initialData={clientInfo} 
        />
      )}

      <AnimatePresence>
        {isPaymentModalOpen && (
          <PaymentModal subtotal={finalTotal} themeColors={themeColors} onClose={() => setIsPaymentModalOpen(false)} onConfirm={finalizePayment} isProcessing={isProcessing} />
        )}
      </AnimatePresence>

      {isCashSessionModalOpen && (
        <CashSessionModal 
          onClose={(isSuccess?: boolean) => {
            if (!currentSessionId && isSuccess !== true) {
              customToast("Attention : Caisse non ouverte !", "error");
            }
            setIsCashSessionModalOpen(false);
          }} 
          currentSessionId={currentSessionId}
          onSessionOpened={(id: string) => setCurrentSessionId(id)}
          onSessionClosed={() => setCurrentSessionId(null)}
          themeColors={themeColors}
        />
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-red-100 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6"><Trash2 size={40} /></div>
            <h3 className="text-2xl font-black text-secondary uppercase tracking-wide mb-2">Annuler la commande ?</h3>
            <p className="text-gray-500 font-bold mb-8">Tous les articles en cours seront supprimés.</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition-all">Retour</button>
              <button onClick={() => { clearCart(); setLoadedOrderId(null); setDeliveryFee(0); setClientInfo(null); setShowClearConfirm(false); setIsAuthenticated(false); }} className="flex-1 py-4 bg-red-500 text-white rounded-xl font-black uppercase tracking-wider hover:bg-red-600 active:scale-95 transition-all">Oui, Annuler</button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-red-100 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6"><AlertTriangle size={40} /></div>
            <h3 className="text-2xl font-black text-secondary uppercase tracking-wide mb-2">Commande en cours</h3>
            <p className="text-gray-500 font-bold mb-8">Attention, une commande est en cours. Voulez-vous l'annuler et quitter ?</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setShowLogoutConfirm(false)} className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition-all">Rester</button>
              <button onClick={() => { clearCart(); setIsAuthenticated(false); setDeliveryFee(0); setClientInfo(null); setShowLogoutConfirm(false); navigate('/'); }} className="flex-1 py-4 bg-red-500 text-white rounded-xl font-black uppercase tracking-wider hover:bg-red-600 active:scale-95 transition-all leading-tight">Quitter et annuler</button>
            </div>
          </div>
        </div>
      )}

      {isOptionsModalOpen && selectedProduct && (
        <OptionsModal 
          product={selectedProduct} 
          initialSelections={initialSelections}
          onClose={() => { 
            setIsOptionsModalOpen(false); 
            setSelectedProduct(null); 
            setEditingItemKey(null); 
            setInitialSelections(null); 
          }} 
          onAddToCart={(p, s) => handleAddToCartFromModal(p, s)} 
        />
      )}

      {isVariantsModalOpen && selectedProductForVariants && (
        <ProductVariantsModal 
          product={selectedProductForVariants as any} 
          isOpen={isVariantsModalOpen} 
          onClose={() => { setIsVariantsModalOpen(false); setSelectedProductForVariants(null); }} 
          onSelectVariant={(v: any) => { 
            const rawVariantName = v.variant_name || v.name || '';
            const cleanVariantName = rawVariantName.replace(/\s*pi[èe]ces?/gi, '').trim();
            
            const finalName = cleanVariantName ? `${selectedProductForVariants.name} (${cleanVariantName})` : selectedProductForVariants.name;

            setSelectedProductForVariants(null); 
            setIsVariantsModalOpen(false); 
            setSelectedProduct({ 
              ...selectedProductForVariants, 
              price: v.price || v.price_supplement || selectedProductForVariants.price, 
              name: finalName 
            }); 
            setIsOptionsModalOpen(true); 
          }} 
          directSubOptions={[]} 
        />
      )}

      {isDashboardOpen && <OrdersDashboardModal onClose={() => setIsDashboardOpen(false)} />}
      {isOrderTrackerOpen && <OrderTrackerModal onClose={() => setIsOrderTrackerOpen(false)} onLoadOrder={handleLoadOrderIntoCart} />}
      {isHistoryOpen && <OrderHistoryModal onClose={() => setIsHistoryOpen(false)} />}
      {isStockOpen && (
        <StockModal 
          onClose={() => {
            setIsStockOpen(false);
            const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;
            if (activeRestoId) loadMenuData(activeRestoId);
          }} 
        />
      )}
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

    </div>
  );
};

export default Caisse;