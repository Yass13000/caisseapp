// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { useCart } from '@/context/CartContext';
import { toast } from "sonner";
import { 
  Trash2, Plus, Minus, ShoppingBag, Settings, Printer, Lock, 
  ClipboardList, History, Delete, Package, Wifi, WifiOff, 
  UserRound, CalendarDays, LayoutDashboard, AlertTriangle,
  CreditCard, Banknote, CheckCircle2, Store
} from 'lucide-react';

import ProductCard from '@/features/menu/components/ProductCard';
import OptionsModal from '@/features/menu/components/OptionsModal';
import ProductVariantsModal from '@/components/ProductVariantsModal';
import OrderTrackerModal from '@/components/OrderTrackerModal';
import OrderHistoryModal from '@/components/OrderHistoryModal';
import SettingsModal from '@/components/SettingsModal';
import StockModal from '@/components/StockModal';
import OrdersDashboardModal from '@/components/OrdersDashboardModal';
import NewtonsCradleLoader from '@/components/NewtonsCradleLoader';
import { calculateCartSubtotal } from '@/lib/cartCalculations';

export interface Product { id: number; name: string; price: number; category: string; is_available: boolean; }
interface Category { name: string; }

const ORDER_TYPE_IDS = {
  'SUR PLACE': '633425b1-f86c-4c17-8cba-b258906ad317',
  'EMPORTER': '2cac3f10-73e2-40a5-a7e0-053bd861b4d9',
  'LIVRAISON': 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d'
};

const hexToHslString = (hex: string) => {
  if (!hex) return '';
  hex = hex.replace(/^#/, '');
  if(hex.length === 3) hex = hex.split('').map(x=>x+x).join('');
  let r = parseInt(hex.substring(0, 2), 16) / 255, g = parseInt(hex.substring(2, 4), 16) / 255, b = parseInt(hex.substring(4, 6), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

// --- MOTEUR OPTIMISÉ POUR LECTURE DE L'ORDRE ---
const getFormattedOptions = (item: any) => {
  let rawOptions: any[] = [];
  const dynOpts = item.selectedSubOptions || item.selections || item.options || [];

  if (item.boisson) rawOptions.push({ name: item.boisson.name || item.boisson, price: parseFloat(item.boisson.price || 0), _print_order: -2 });
  if (item.accompagnement) rawOptions.push({ name: item.accompagnement.name || item.accompagnement, price: parseFloat(item.accompagnement.price || 0), _print_order: -1 });

  if (Array.isArray(dynOpts)) {
    rawOptions.push(...dynOpts);
  } else if (typeof dynOpts === 'object' && dynOpts !== null) {
    Object.values(dynOpts).forEach((val: any) => {
      if (Array.isArray(val)) rawOptions.push(...val);
      else rawOptions.push(val);
    });
  }

  const formattedList = rawOptions.map((opt, i) => {
    const order = opt._print_order !== undefined ? opt._print_order : i;
    if (typeof opt === 'string') return { name: opt.trim().toLowerCase(), price: 0, order };
    return { 
      name: (opt.name || opt.title || opt.value || "").trim().toLowerCase(), 
      price: parseFloat(opt.price || 0), 
      order 
    };
  }).filter(o => o.name && o.name !== 'option' && o.name !== 'options');

  formattedList.sort((a, b) => a.order - b.order);

  const finalOptions: { name: string, price: number, qty: number }[] = [];
  formattedList.forEach(opt => {
    const existing = finalOptions.find(o => o.name === opt.name);
    if (existing) {
      existing.qty += 1;
      existing.price += opt.price;
    } else {
      finalOptions.push({ name: opt.name, price: opt.price, qty: 1 });
    }
  });

  return finalOptions.map(o => ({
    name: o.qty > 1 ? `${o.qty}x ${o.name}` : o.name,
    price: o.price
  }));
};

const getItemTotal = (item: any) => {
  const basePrice = parseFloat(item.product?.price || item.price || 0);
  const optsPrice = getFormattedOptions(item).reduce((sum, o) => sum + o.price, 0);
  return (basePrice + optsPrice) * (item.quantity || 1);
};

const getActiveRestaurantId = () => localStorage.getItem('pos_restaurant_id');

// --- FONCTION D'IMPRESSION SILENCIEUSE (VIA ELECTRON) ---
const generateAndPrintReceipt = async (orderNumber: string, orderType: string, paymentMethod: string, items: any[], subtotal: number, cashAmount: number) => {
  if (!window.electronAPI) return;

  const date = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isCash = paymentMethod === 'counter';
  const changeDue = Math.max(0, cashAmount - subtotal);

  const itemsHtml = items.map(item => {
    const itemTotal = getItemTotal(item);
    let html = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span class="bold">${item.quantity}x ${item.product?.name || item.name}</span>
        <span class="bold">${itemTotal.toFixed(2)} €</span>
      </div>
    `;
    const options = getFormattedOptions(item);
    if (options.length > 0) {
      options.forEach(opt => {
        html += `
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: #333; padding-left: 10px;">
            <span>- ${opt.name}</span>
            <span>${opt.price > 0 ? '+' + opt.price.toFixed(2) + '€' : ''}</span>
          </div>
        `;
      });
    }
    return html;
  }).join('');

  const receiptHtml = `
    <div style="text-align: center; margin-bottom: 10px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: bold; text-transform: uppercase;">VOTRE RESTAURANT</h2>
      <p style="margin: 2px 0; font-size: 12px;">${date}</p>
      <p style="margin: 5px 0; font-size: 14px; font-weight: bold; padding: 3px; border: 1px solid black;">COMMANDE : ${orderNumber}</p>
      <p style="margin: 5px 0; font-size: 14px; font-weight: bold;">${orderType}</p>
    </div>
    <hr style="border-top: 1px dashed black; margin: 10px 0;" />
    <div style="margin-bottom: 10px;">${itemsHtml}</div>
    <hr style="border-top: 1px dashed black; margin: 10px 0;" />
    <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; margin-bottom: 5px;">
      <span>TOTAL A PAYER</span><span>${subtotal.toFixed(2)} €</span>
    </div>
    ${isCash ? `
      <div style="display: flex; justify-content: space-between; font-size: 12px; color: #555;"><span>Espèces reçues</span><span>${cashAmount.toFixed(2)} €</span></div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; margin-top: 2px;"><span>Monnaie rendue</span><span>${changeDue.toFixed(2)} €</span></div>
    ` : `
      <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;"><span>Payé par</span><span>CARTE BANCAIRE</span></div>
    `}
    <div style="text-align: center; margin-top: 20px; font-size: 12px;">
      <p style="margin: 0;">Merci de votre visite !</p>
      <p style="margin: 2px 0;">A bientot.</p>
    </div>
  `;

  try {
    const result = await window.electronAPI.printReceipt(receiptHtml);
    if (!result.success) toast.error("Erreur avec l'imprimante !");
  } catch (error) { console.error("Erreur API impression :", error); }
};

const PaymentModal = ({ subtotal, themeColors, onClose, onConfirm, isProcessing }) => {
  const [tenderedStr, setTenderedStr] = useState('');
  const roundedSubtotal = parseFloat(subtotal.toFixed(2));
  const tenderedAmount = parseFloat(tenderedStr) || 0;
  const changeDue = Math.max(0, tenderedAmount - roundedSubtotal);
  const isCashValid = tenderedAmount >= roundedSubtotal;

  const handleNumpad = (val: string) => {
    if (val === 'DEL') setTenderedStr(p => p.slice(0, -1));
    else if (val === '.') { if (!tenderedStr.includes('.')) setTenderedStr(p => p + '.'); } 
    else if (val === '00') { if (tenderedStr && !tenderedStr.includes('.')) setTenderedStr(p => p + '00'); } 
    else {
      if (tenderedStr.includes('.') && tenderedStr.split('.')[1]?.length >= 2) return;
      setTenderedStr(p => p + val);
    }
  };

  const handleAddAmount = (amount: number) => {
    setTenderedStr(((parseFloat(tenderedStr) || 0) + amount).toFixed(2).replace(/\.00$/, ''));
  };

  const numpadBtnClass = "h-12 bg-gray-100 hover:bg-gray-200 text-secondary text-xl font-black rounded-xl active:scale-95 transition-all shadow-sm";
  const shortcutBtnClass = "flex-1 bg-white border-2 border-gray-200 text-secondary font-black text-lg rounded-xl hover:border-secondary hover:bg-gray-50 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1 disabled:opacity-50";

  return createPortal(
    <div className="fixed inset-0 z-[9999999] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 font-helvetica select-none">
      <div className="bg-white w-[900px] h-[520px] max-w-[95vw] max-h-[95vh] rounded-[2rem] shadow-2xl flex overflow-hidden border border-white/20 animate-in fade-in zoom-in-95 duration-200">
        
        <div className="w-[30%] bg-gray-50 border-r border-gray-200 flex flex-col p-6 justify-between relative overflow-hidden">
          <div className="absolute top-[-20%] left-[-20%] w-[150%] h-[150%] bg-gradient-to-br from-gray-100 to-gray-50 rounded-full opacity-50 pointer-events-none"></div>
          <div className="relative z-10 flex flex-col items-center text-center mt-2">
            <h3 className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-1">Total à payer</h3>
            <div className="text-5xl font-black text-secondary tracking-tighter mb-8">{roundedSubtotal.toFixed(2)}<span className="text-3xl text-gray-400 ml-1">€</span></div>
            <button onClick={() => onConfirm('carte bancaire', 0)} disabled={isProcessing} className="w-full bg-[#04B855] text-white rounded-2xl p-6 flex flex-col items-center justify-center gap-3 hover:bg-[#039d48] active:scale-95 transition-all shadow-lg disabled:opacity-50 border-4 border-[#04B855] hover:border-white">
              <CreditCard size={48} strokeWidth={2.5} />
              <span className="text-xl font-black uppercase tracking-widest">Carte Bancaire</span>
            </button>
          </div>
          <button onClick={onClose} disabled={isProcessing} className="relative z-10 w-full py-3 rounded-xl border-2 border-gray-200 text-gray-500 font-black uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition-all disabled:opacity-50 text-sm">Retour</button>
        </div>

        <div className="flex-1 bg-white flex flex-col relative">
          <div className="flex items-center gap-3 p-4 border-b border-gray-100">
            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-secondary"><Banknote size={20} /></div>
            <h2 className="text-xl font-black text-secondary uppercase tracking-wider">Espèces</h2>
          </div>
          <div className="flex px-6 py-4 gap-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex-1 bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col justify-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Reçu du client</span>
              <div className={`text-3xl font-black mt-1 ${isCashValid ? 'text-[#04B855]' : 'text-secondary'}`}>{tenderedStr ? `${parseFloat(tenderedStr).toFixed(2)} €` : '0.00 €'}</div>
            </div>
            <div className="flex-1 bg-secondary rounded-xl p-3 shadow-md text-white flex flex-col justify-center">
              <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Monnaie à rendre</span>
              <div className="text-3xl font-black mt-1 text-[#FBBF24]">{changeDue > 0 ? `${changeDue.toFixed(2)} €` : '0.00 €'}</div>
            </div>
          </div>
          <div className="flex-1 flex px-6 py-5 gap-6">
            <div className="w-[35%] flex flex-col gap-2">
              <button disabled={isProcessing} onClick={() => onConfirm('counter', roundedSubtotal)} className="flex-1 bg-white border-2 border-gray-200 text-secondary font-black text-sm rounded-xl hover:border-[#04B855] hover:bg-green-50 hover:text-[#04B855] active:scale-95 transition-all shadow-sm disabled:opacity-50">Compte Exact</button>
              {[5, 10, 20, 50].map(amt => (
                <button key={amt} disabled={isProcessing} onClick={() => handleAddAmount(amt)} className={shortcutBtnClass}><span className="text-gray-400 text-sm font-bold">+</span>{amt} €</button>
              ))}
            </div>
            <div className="w-[65%] flex flex-col justify-between">
              <div className="grid grid-cols-3 gap-2">
                {['1','2','3','4','5','6','7','8','9','0','00','.'].map(key => (
                  <button key={key} onClick={() => handleNumpad(key)} className={numpadBtnClass}>{key}</button>
                ))}
              </div>
              <div className="flex gap-2 h-14 mt-auto">
                <button onClick={() => handleNumpad('DEL')} className="w-16 bg-red-50 text-red-500 font-black rounded-xl hover:bg-red-100 active:scale-95 transition-all border border-red-100 flex items-center justify-center shadow-sm"><Delete size={24} /></button>
                <button disabled={!isCashValid || isProcessing} onClick={() => onConfirm('counter', tenderedAmount)} className="flex-1 bg-secondary text-white rounded-xl font-black uppercase text-lg tracking-wider hover:bg-secondary/90 active:scale-95 transition-all shadow-md disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2">
                  {isProcessing ? 'En cours...' : <><CheckCircle2 size={24} /> VALIDER</>}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>, document.body
  );
};

const Caisse = () => {
  const { state: cartState, addToCart, removeFromCart, updateQuantity, clearCart } = useCart();
  const navigate = useNavigate();

  const [posRestoId, setPosRestoId] = useState<string | null>(localStorage.getItem('pos_restaurant_id') || null);
  const [tempRestoId, setTempRestoId] = useState("");

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinCode, setPinCode] = useState("");
  const [restaurantLogo, setRestaurantLogo] = useState<string | null>(null);
  const [themeColors, setThemeColors] = useState({ primary: '#04B855', secondary: '#1f2937', accent: '#FBBF24' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [menuData, setMenuData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [isOrderTrackerOpen, setIsOrderTrackerOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStockOpen, setIsStockOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  
  const [loadedOrderId, setLoadedOrderId] = useState<string | number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isVariantsModalOpen, setIsVariantsModalOpen] = useState(false);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
  const [orderType, setOrderType] = useState<'SUR PLACE' | 'EMPORTER' | 'LIVRAISON'>('SUR PLACE');

  const customToast = (msg: string, type: 'success' | 'error' = 'success') => toast[type](msg, { style: { backgroundColor: themeColors.secondary, color: '#fff', border: `1px solid ${type === 'error' ? '#ef4444' : themeColors.primary}`, fontWeight: 'bold' }});

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { clearInterval(timer); window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  useEffect(() => {
    if (pinCode.length === 4) {
      if (pinCode === (localStorage.getItem('pos_pin') || '1234')) {
        setIsAuthenticated(true); setPinCode(""); customToast("Caisse déverrouillée", 'success');
      } else {
        customToast("Code incorrect", 'error'); setTimeout(() => setPinCode(""), 300);
      }
    }
  }, [pinCode]);

  const loadMenuData = async (activeRestoId: string) => {
    const { data: productsData } = await supabase.from('product').select('*').eq('restaurant_id', activeRestoId).order('name', { ascending: true });
    if (productsData) {
      setMenuData(productsData as Product[]);
      const uniqueCategories = productsData.reduce((acc: any, p: any) => {
        if (p.category?.toLowerCase() === 'ingredients') return acc;
        if (!acc[p.category]) acc[p.category] = { name: p.category }; return acc;
      }, {});
      const cats = Object.values(uniqueCategories) as Category[];
      const savedOrder = localStorage.getItem('pos_category_order');
      if (savedOrder) {
        try {
          const parsedOrder = JSON.parse(savedOrder);
          cats.sort((a, b) => {
            const iA = parsedOrder.indexOf(a.name), iB = parsedOrder.indexOf(b.name);
            return (iA > -1 ? iA : 999) - (iB > -1 ? iB : 999);
          });
        } catch (e) {}
      }
      setCategories(cats);
      if (!selectedCategory && cats.length > 0) setSelectedCategory(cats[0].name);
    }
  };

  useEffect(() => {
    if (!posRestoId) return; 

    const init = async () => {
      setIsLoading(true);
      try {
        const activeRestoId = getActiveRestaurantId();
        if (!activeRestoId) throw new Error("ID manquant");
        const { data: restoData } = await supabase.from('restaurants').select('logo_url, theme_primary, theme_secondary, theme_accent').eq('id', activeRestoId).single();
        if (restoData) {
          if (restoData.logo_url) setRestaurantLogo(restoData.logo_url);
          setThemeColors({ primary: restoData.theme_primary || '#04B855', secondary: restoData.theme_secondary || '#1f2937', accent: restoData.theme_accent || '#FBBF24' });
          if (restoData.theme_primary) document.documentElement.style.setProperty('--primary', hexToHslString(restoData.theme_primary));
          if (restoData.theme_secondary) document.documentElement.style.setProperty('--secondary', hexToHslString(restoData.theme_secondary));
          if (restoData.theme_accent) document.documentElement.style.setProperty('--accent', hexToHslString(restoData.theme_accent));
        }
        await loadMenuData(activeRestoId);
      } catch (e) { customToast("Erreur de connexion", 'error'); } 
      finally { setIsLoading(false); }
    };
    init();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, [posRestoId]);

  const handleLoadOrderIntoCart = (items: any[], orderId: string | number) => {
    setLoadedOrderId(orderId);
    clearCart(); 
    setTimeout(() => {
      items.forEach((item, idx) => {
        const baseId = item.product?.id || item.id;
        const formattedItem = { 
          ...item, 
          id: `${baseId}-loaded-${idx}`, // ID UNIQUE POUR EVITER FUSION
          product: item.product || { id: item.id, name: item.name, price: item.price }, 
          quantity: item.quantity || 1, 
          _cartKey: `loaded-${orderId}-${idx}-${Math.random()}` 
        };
        addToCart(formattedItem);
      });
      customToast("Commande chargée", 'success');
    }, 150);
  };

  const handleSelectProduct = async (product: Product) => {
    if (!product.is_available) return customToast("Produit indisponible", 'error');
    try {
      const { data: variants } = await supabase.from('product_variants').select('id').eq('product_id', product.id).eq('available', true).limit(1);
      if (variants?.length) { setSelectedProductForVariants(product); setIsVariantsModalOpen(true); return; }
      
      const { data: optionGroups } = await supabase.from('product_option_groups').select('id').eq('product_id', product.id).limit(1);
      if (optionGroups?.length) { setSelectedProduct(product); setIsOptionsModalOpen(true); } 
      else { 
        // PRODUIT SANS OPTION : ID UNIQUE POUR EVITER FUSION
        const uniqueId = `${product.id}-no-opts`;
        addToCart({ id: uniqueId, product, quantity: 1, _cartKey: uniqueId, customKey: uniqueId }); 
      }
    } catch (err) { 
      const uniqueId = `${product.id}-no-opts`;
      addToCart({ id: uniqueId, product, quantity: 1, _cartKey: uniqueId, customKey: uniqueId }); 
    }
  };

  // --- LA MAGIE EST ICI : HASH UNIQUE SUR LES OPTIONS POUR EMPÊCHER LE PANIER DE FUSIONNER A TORT ---
  const handleAddToCartFromModal = (p: Product, selections: any) => {
    const flatOptions: any[] = [];
    let printOrder = 1;

    if (Array.isArray(selections)) {
      selections.forEach(opt => flatOptions.push({ ...opt, _print_order: printOrder++ }));
    } else if (typeof selections === 'object' && selections !== null) {
      const sortedKeys = Object.keys(selections).sort((a, b) => parseInt(a) - parseInt(b));
      sortedKeys.forEach(key => {
        const val = selections[key];
        const arr = Array.isArray(val) ? val : [val];
        arr.forEach((opt: any) => {
          if (typeof opt === 'object') flatOptions.push({ ...opt, _print_order: printOrder++ });
          else if (typeof opt === 'string') flatOptions.push({ name: opt, price: 0, _print_order: printOrder++ });
        });
      });
    }

    // ON GÉNÈRE UN ID BASÉ SUR LE PRODUIT + SES OPTIONS
    const optionsString = flatOptions.map(o => o.name).join('-');
    const optionsHash = btoa(encodeURIComponent(optionsString)).substring(0, 15);
    const uniqueCartKey = `${p.id}-${optionsHash}`;

    addToCart({ 
      id: uniqueCartKey, // On force le panier à voir un produit "différent" si les options changent
      product: p, 
      selectedSubOptions: flatOptions,
      quantity: 1, 
      _cartKey: uniqueCartKey,
      customKey: uniqueCartKey
    });
    
    setIsOptionsModalOpen(false);
    setSelectedProduct(null);
  };

  const subtotal = calculateCartSubtotal(cartState.items);
  const cartItemCount = cartState.items.reduce((sum, item) => sum + (item.quantity || 0), 0);

  const finalizePayment = async (method: 'carte bancaire' | 'counter', cashAmount: number = 0) => {
    if (cartState.items.length === 0) return;
    setIsProcessing(true);
    try { 
      const activeRestoId = getActiveRestaurantId();
      const cleanOrderDetails = JSON.parse(JSON.stringify(cartState.items));
      const currentOrderTypeId = ORDER_TYPE_IDS[orderType];
      
      let targetOrderNumber = '';

      if (loadedOrderId) {
        await supabase.from('orders').update({ is_paid: true, payment_status: 'paid', status: 'En cours', payment_method: method, cash_amount: cashAmount, order_type_id: currentOrderTypeId || undefined }).eq('id', loadedOrderId);
        const { data: orderData } = await supabase.from('orders').select('order_number').eq('id', loadedOrderId).single();
        targetOrderNumber = orderData?.order_number || String(loadedOrderId);
      } else {
        const startOfDay = new Date(new Date().setHours(0,0,0,0)).toISOString(); 
        const { data: lastOrders } = await supabase.from('orders').select('order_number').eq('restaurant_id', activeRestoId).gte('created_at', startOfDay).ilike('order_number', 'C%').order('created_at', { ascending: false }).limit(1);
        let nextNum = 1;
        if (lastOrders?.[0]?.order_number) nextNum = (parseInt(lastOrders[0].order_number.replace(/\D/g, ''), 10) || 0) + 1;
        
        targetOrderNumber = `C${nextNum.toString().padStart(2, '0')}`;
        
        await supabase.from('orders').insert({
          restaurant_id: activeRestoId, total_price: parseFloat(subtotal.toFixed(2)), is_paid: true, payment_status: 'paid',
          status: 'En cours', payment_method: method, cash_amount: cashAmount, order_origin: 'caisse',
          order_type_id: currentOrderTypeId, order_details: cleanOrderDetails, customer_name: 'Client Caisse', order_number: targetOrderNumber
        });
      }
      
      customToast(`Encaissé : ${subtotal.toFixed(2)}€`, 'success'); 
      await generateAndPrintReceipt(targetOrderNumber, orderType, method, cartState.items, subtotal, cashAmount);
      
      clearCart(); setLoadedOrderId(null); setIsPaymentModalOpen(false);
    } 
    catch (e) { customToast("Erreur d'enregistrement BDD", 'error'); } 
    finally { setIsProcessing(false); }
  };

  if (!posRestoId) {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-100 items-center justify-center font-helvetica select-none relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none"></div>
        <div className="relative z-10 bg-white/80 backdrop-blur-xl p-10 rounded-[2.5rem] shadow-[0_20px_80px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center border border-white max-w-[450px] w-full mx-4">
          <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-[2rem] flex items-center justify-center mb-6 shadow-inner border border-blue-100">
            <Store size={40} strokeWidth={2.5} />
          </div>
          <h2 className="text-secondary text-2xl font-black uppercase tracking-widest mb-2 text-center">Configuration</h2>
          <p className="text-gray-400 font-bold text-xs mb-8 uppercase tracking-wider text-center">Liaison de la caisse au restaurant</p>
          
          <input 
            type="text" 
            placeholder="Collez l'ID du restaurant ici..." 
            className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl px-6 py-5 mb-6 text-gray-700 font-bold focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-center shadow-sm"
            value={tempRestoId}
            onChange={(e) => setTempRestoId(e.target.value)}
          />
          
          <button 
            onClick={() => {
              if (tempRestoId.trim().length > 5) {
                localStorage.setItem('pos_restaurant_id', tempRestoId.trim());
                setPosRestoId(tempRestoId.trim());
                toast.success("Caisse liée avec succès !");
              } else {
                toast.error("Veuillez entrer un ID valide.");
              }
            }}
            className="w-full py-5 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-black uppercase text-lg tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-500/30"
          >
            Connecter la caisse
          </button>
        </div>
      </div>
    );
  }

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
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/30 overflow-hidden bg-white border border-gray-100" style={!restaurantLogo ? { backgroundColor: themeColors.primary } : {}}>
            {restaurantLogo ? <img src={restaurantLogo} alt="Logo" className="w-full h-full object-contain p-1.5" /> : <Lock className="text-white w-7 h-7" />}
          </div>
          <h2 className="text-secondary text-xl font-black uppercase tracking-widest mb-1">Caisse Sécurisée</h2>
          <p className="text-gray-400 font-bold text-[10px] mb-6 uppercase tracking-widest">Entrez le code d'accès</p>
          <div className="flex gap-3 mb-6">
            {[0,1,2,3].map(i => <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-inner ${pinCode.length > i ? 'scale-125 shadow-md' : 'bg-gray-200'}`} style={pinCode.length > i ? { backgroundColor: themeColors.primary } : {}} />)}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {['1','2','3','4','5','6','7','8','9'].map(num => <button key={num} onClick={() => setPinCode(p => p.length < 4 ? p + num : p)} className={pinBtnClass}>{num}</button>)}
            <div />
            <button onClick={() => setPinCode(p => p.length < 4 ? p + '0' : p)} className={pinBtnClass}>0</button>
            <button onClick={() => setPinCode(p => p.slice(0, -1))} className="w-16 h-16 bg-red-50 hover:bg-red-100 text-red-500 rounded-2xl font-black flex items-center justify-center active:scale-90 transition-all shadow-sm"><Delete className="w-6 h-6" /></button>
          </div>
          <button onClick={() => navigate('/')} className="mt-6 px-5 py-2 rounded-full bg-gray-100 text-gray-500 font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors text-[9px]">Retour à l'accueil</button>
        </div>
      </div>
    );
  }

  const rightBarBtnClass = "w-full aspect-square flex flex-col items-center justify-center text-primary rounded-xl hover:bg-white/10 active:scale-95 transition-all shadow-sm";
  const ordTypes = ['SUR PLACE', 'EMPORTER', 'LIVRAISON'];

  if (isLoading) return <NewtonsCradleLoader />;

  return (
    <div className="flex flex-col h-screen w-full bg-gray-100 font-helvetica overflow-hidden select-none">
      
      <div className="flex-shrink-0 h-8 text-white/90 flex justify-between items-center px-4 text-[11px] font-bold tracking-widest uppercase z-50 shadow-md" style={{ backgroundColor: themeColors.secondary }}>
        <div className="flex items-center gap-4">
          <div className={isOnline ? 'text-green-400' : 'text-red-500 animate-pulse'}>{isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}</div>
          <div className="w-px h-3 bg-white/20"></div>
          <div className="flex items-center gap-1.5 text-white/80"><UserRound size={14} /><span>Caisse Principale</span></div>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-white font-black text-[13px] tracking-[0.2em]">{currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="flex items-center gap-4"><CalendarDays size={14} /><span>{currentTime.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span></div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        <div className="flex-1 flex flex-col h-full bg-[#F3F4F6] relative min-w-0">
          <div className="bg-white border-b border-gray-200 shadow-sm flex-shrink-0 z-20">
            <div className="flex p-2 gap-2 bg-gray-100">
               {ordTypes.map(type => (
                 <button key={type} onClick={() => setOrderType(type as any)} className={`flex-1 py-3 rounded-xl font-black text-xs uppercase transition-all shadow-sm ${orderType===type ? 'text-white scale-[1.02]' : 'bg-white text-gray-500 hover:bg-gray-50'}`} style={orderType === type ? { backgroundColor: themeColors.secondary } : {}}>
                   {type === 'SUR PLACE' ? 'Sur Place' : type === 'EMPORTER' ? 'À Emporter' : 'Livraison'}
                 </button>
               ))}
            </div>
            <div className="p-4 grid grid-cols-5 gap-3 border-t border-gray-200">
              {categories.map(cat => (
                <button key={cat.name} onClick={() => setSelectedCategory(cat.name)} className={`h-[70px] rounded-xl font-black text-[13px] xl:text-[15px] uppercase tracking-wide transition-all border-4 ${selectedCategory === cat.name ? 'text-white shadow-md scale-[1.02]' : 'bg-gray-50 border-gray-100 hover:border-gray-300'}`} style={selectedCategory === cat.name ? { backgroundColor: themeColors.secondary, borderColor: themeColors.secondary } : { color: themeColors.secondary }}>{cat.name}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-4 gap-4 content-start">
              {menuData.filter(p => p.category === selectedCategory).map(product => <ProductCard key={product.id} product={product} onSelectProduct={handleSelectProduct} />)}
            </div>
          </div>
        </div>

        <div className="w-[260px] bg-white border-l border-gray-200 flex flex-col h-full z-30 shadow-xl flex-shrink-0">
          <div className="p-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex justify-between items-center">
            <span className="font-black text-sm uppercase" style={{ color: themeColors.secondary }}>Ticket {loadedOrderId && "• Borne"}</span>
            <span className="flex items-center gap-1.5 bg-gray-200 px-2.5 py-1 rounded-lg font-black text-xs" style={{ color: themeColors.secondary }}><ShoppingBag size={14} /> {cartItemCount}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 bg-gray-50/50 custom-scrollbar">
            {cartState.items.map((item, index) => {
              const itemKey = item.customKey || item._cartKey || `${item.product?.id || item.id}-${index}`;
              const options = getFormattedOptions(item);
              return (
                <div key={itemKey} className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm relative overflow-hidden">
                  <div className="flex justify-between items-start gap-1">
                    <div className="flex-1 min-w-0 pr-1">
                      <h4 className="font-bold text-gray-800 text-[11px] leading-tight line-clamp-2">{item.product?.name || item.name}</h4>
                      {options.length > 0 && (
                        <div className="mt-0.5 space-y-0.5">
                          {options.map((opt, i) => (
                            <div key={i} className="text-[9px] text-gray-500 flex justify-between font-bold">
                              <span className="truncate pr-1">- {opt.name}</span>
                              {opt.price > 0 && <span className="flex-shrink-0">+{opt.price.toFixed(2)}€</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="font-black text-[12px] whitespace-nowrap" style={{ color: themeColors.secondary }}>{getItemTotal(item).toFixed(2)}€</div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <button onClick={() => removeFromCart(itemKey)} className="p-1 text-red-500 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
                    <div className="flex items-center gap-1.5 bg-gray-100 rounded-full px-1 py-0.5">
                      <button className="w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-xs" onClick={() => updateQuantity(itemKey, item.quantity - 1)}>-</button>
                      <span className="w-4 text-center font-bold text-xs">{item.quantity}</span>
                      <button className="w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-xs" style={{ color: themeColors.primary }} onClick={() => updateQuantity(itemKey, item.quantity + 1)}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t-2 border-gray-200 bg-white flex-shrink-0">
            <div className="flex justify-between items-end mb-3">
              <span className="text-gray-400 font-bold text-xs uppercase tracking-wider">Total</span>
              <span className="text-2xl font-black whitespace-nowrap" style={{ color: themeColors.secondary }}>{subtotal.toFixed(2)} €</span>
            </div>
            <div className="flex gap-2">
              <button disabled={cartItemCount === 0 || isProcessing} onClick={() => setIsPaymentModalOpen(true)} className="flex-1 text-white font-black text-xl py-3 rounded-xl shadow-md active:scale-95 disabled:opacity-50 transition-transform uppercase tracking-wider" style={{ backgroundColor: themeColors.primary }}>PAYER</button>
              <button disabled={cartItemCount === 0 || isProcessing} onClick={() => setShowClearConfirm(true)} className="w-16 bg-red-50 text-red-500 flex items-center justify-center rounded-xl hover:bg-red-100 active:scale-95 disabled:opacity-50 transition-all border border-red-100"><Trash2 size={24} /></button>
            </div>
          </div>
        </div>

        <div className="w-[74px] flex flex-col items-center py-3 z-40 shadow-[-5px_0_15px_rgba(0,0,0,0.2)] flex-shrink-0 justify-between" style={{ backgroundColor: themeColors.secondary }}>
           <div className="flex flex-col gap-2 w-full px-2">
              <button disabled={cartItemCount === 0 || isProcessing} onClick={() => finalizePayment('carte bancaire', 0)} className={`w-full aspect-square flex flex-col items-center justify-center rounded-xl transition-all shadow-sm ${cartItemCount > 0 && !isProcessing ? 'bg-[#04B855] text-white hover:bg-[#039d48] active:scale-95' : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'}`} title="Paiement Rapide CB">
                 <CreditCard size={26} />
                 <span className="text-[9px] font-black uppercase mt-0.5 tracking-wider">Rapide</span>
              </button>

              <button onClick={() => setIsDashboardOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><LayoutDashboard size={26} /></button>
              <button onClick={() => setIsOrderTrackerOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><ClipboardList size={26} /></button>
              <button onClick={() => setIsHistoryOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><History size={26} /></button>
              <button onClick={() => {
                if (cartState.items.length > 0) {
                  generateAndPrintReceipt('TEST', orderType, 'counter', cartState.items, subtotal, subtotal);
                } else {
                  toast.info("Le panier est vide");
                }
              }} className={rightBarBtnClass} style={{ color: themeColors.primary }}><Printer size={26} /></button>
              <button onClick={() => setIsStockOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><Package size={26} /></button>
              <button onClick={() => setIsSettingsOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><Settings size={26} /></button>
           </div>
           <div className="w-full px-2 pb-1">
              <button onClick={() => cartItemCount > 0 ? setShowLogoutConfirm(true) : navigate('/')} className={rightBarBtnClass} style={{ color: themeColors.primary }}>
                 <Lock size={24} className="text-red-400" />
              </button>
           </div>
        </div>
      </div>

      {isPaymentModalOpen && <PaymentModal subtotal={subtotal} themeColors={themeColors} onClose={() => setIsPaymentModalOpen(false)} onConfirm={finalizePayment} isProcessing={isProcessing} />}
      
      {showClearConfirm && (
        <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-red-100 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6"><Trash2 size={40} /></div>
            <h3 className="text-2xl font-black text-secondary uppercase tracking-wide mb-2">Annuler la commande ?</h3>
            <p className="text-gray-500 font-bold mb-8">Tous les articles en cours seront supprimés.</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition-all">Retour</button>
              <button onClick={() => { clearCart(); setLoadedOrderId(null); setShowClearConfirm(false); }} className="flex-1 py-4 bg-red-500 text-white rounded-xl font-black uppercase tracking-wider hover:bg-red-600 active:scale-95 transition-all">Oui, Annuler</button>
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
              <button onClick={() => { clearCart(); navigate('/'); }} className="flex-1 py-4 bg-red-500 text-white rounded-xl font-black uppercase tracking-wider hover:bg-red-600 active:scale-95 transition-all leading-tight">Quitter et annuler</button>
            </div>
          </div>
        </div>
      )}

      {isOptionsModalOpen && selectedProduct && (
        <OptionsModal 
          product={selectedProduct} 
          onClose={() => { setIsOptionsModalOpen(false); setSelectedProduct(null); }} 
          onAddToCart={(p, s) => handleAddToCartFromModal(p, s)} 
        />
      )}
      
      {isVariantsModalOpen && selectedProductForVariants && <ProductVariantsModal product={selectedProductForVariants} isOpen={isVariantsModalOpen} onClose={() => { setIsVariantsModalOpen(false); setSelectedProductForVariants(null); }} onSelectVariant={(v: any) => { setSelectedProductForVariants(null); setIsVariantsModalOpen(false); setSelectedProduct({ ...selectedProductForVariants, price: v.price || selectedProductForVariants.price, name: `${selectedProductForVariants.name} - ${v.variant_name}` }); setIsOptionsModalOpen(true); }} directSubOptions={[]} />}
      {isDashboardOpen && <OrdersDashboardModal onClose={() => setIsDashboardOpen(false)} />}
      {isOrderTrackerOpen && <OrderTrackerModal onClose={() => setIsOrderTrackerOpen(false)} onLoadOrder={handleLoadOrderIntoCart} />}
      {isHistoryOpen && <OrderHistoryModal onClose={() => setIsHistoryOpen(false)} />}
      {isStockOpen && <StockModal onClose={() => { setIsStockOpen(false); loadMenuData(getActiveRestaurantId() || RESTAURANT_ID); }} />}
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} currentCategories={categories.map(c => c.name)} onCategoriesReorder={(newOrder) => { const reorderedCats = [...categories].sort((a, b) => { const iA = newOrder.indexOf(a.name), iB = newOrder.indexOf(b.name); return (iA > -1 ? iA : 999) - (iB > -1 ? iB : 999); }); setCategories(reorderedCats); }} />}
    </div>
  );
};

export default Caisse;