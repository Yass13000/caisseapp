// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Clock, 
  CheckCircle2, 
  Loader2, 
  MoreVertical, 
  Truck, 
  Phone, 
  MapPin, 
  User, 
  CreditCard, 
  Banknote, 
  MessageSquare, 
  ArrowLeftRight,
  Smartphone,
  Store,
  Receipt
} from 'lucide-react';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { getFormattedOrderOptions, fetchOptionGroupMapping } from '@/lib/orderFormatter';
import { toast } from 'sonner';

interface Order {
  id: string | number;
  order_number: string;
  status: string;
  total_price: number;
  created_at: string;
  order_details: any;
  order_type_id: string;
  is_paid?: boolean;
  payment_status?: string;
  payment_method?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  comment?: string;
  delivery_fee?: number;
  order_origin?: string;
}

interface DashboardProps {
  onClose: () => void;
}

const getStatusBadgeStyles = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s === 'nouvelle') return 'bg-red-500 text-white border-red-600';
  if (s === 'en cours') return 'bg-blue-500 text-white border-blue-600';
  if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') return 'bg-[#04B855] text-white border-[#039d48]';
  if (s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee') return 'bg-slate-900 text-white border-slate-800';
  return 'bg-gray-100 text-gray-700 border-gray-200';
};

const getStatusFooterStyles = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s === 'nouvelle') return 'bg-red-500 text-white';
  if (s === 'en cours') return 'bg-blue-600 text-white';
  if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') return 'bg-[#04B855] text-white';
  if (s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee') return 'bg-slate-900 text-white';
  return 'bg-slate-800 text-white';
};

const isOrderClosed = (status: string) => {
  const s = status?.toLowerCase() || '';
  return s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee' || s === 'annulée';
};

const isDeliveryOrder = (order: Order) => {
  const tid = String(order.order_type_id || '').toLowerCase();
  return tid === 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d' || tid === '3' || tid.includes('liv');
};

const parseOrderDetails = (details: any): any[] => {
  if (Array.isArray(details)) return details;
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      return [parsed];
    } catch (e) {
      return [];
    }
  }
  return [];
};

const OrdersDashboardModal = ({ onClose }: DashboardProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'en_cours' | 'livraisons' | 'fermees'>('en_cours');
  const [now, setNow] = useState(new Date());
  
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | number | null>(null);
  const [flippedOrders, setFlippedOrders] = useState<Record<string | number, boolean>>({});
  const [preparedItems, setPreparedItems] = useState<Record<string, boolean>>({});
  
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});
  const [kdsHiddenGroupIds, setKdsHiddenGroupIds] = useState<Set<string>>(new Set());
  const [kdsHiddenGroupNames, setKdsHiddenGroupNames] = useState<Set<string>>(new Set());

  const lastHeaderTapRef = useRef<{ id: string | number; time: number }>({ id: '', time: 0 });

  const activeOrders = orders.filter(o => !isOrderClosed(o.status));
  const closedOrders = orders.filter(o => isOrderClosed(o.status));
  const deliveryOrders = orders.filter(o => isDeliveryOrder(o) && !isOrderClosed(o.status));

  const displayedOrders = activeTab === 'en_cours' 
    ? activeOrders 
    : activeTab === 'livraisons' 
      ? deliveryOrders 
      : closedOrders;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleCloseMenus = () => setActiveMenuOrderId(null);
    window.addEventListener('click', handleCloseMenus);
    return () => window.removeEventListener('click', handleCloseMenus);
  }, []);

  const toggleCustomerView = (orderId: string | number) => {
    setFlippedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const handleHeaderTap = (orderId: string | number) => {
    const currentTime = Date.now();
    if (lastHeaderTapRef.current.id === orderId && currentTime - lastHeaderTapRef.current.time < 350) {
      toggleCustomerView(orderId);
      lastHeaderTapRef.current = { id: '', time: 0 };
    } else {
      lastHeaderTapRef.current = { id: orderId, time: currentTime };
    }
  };

  const togglePrepared = (key: string) => {
    setPreparedItems(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getElapsedMinutes = (dateString: string) => {
    const orderDate = new Date(dateString);
    const diffMs = now.getTime() - orderDate.getTime();
    if (diffMs < 0) return 0;
    return Math.floor(diffMs / 60000);
  };

  const getTimeElapsed = (dateString: string) => {
    const diffMins = getElapsedMinutes(dateString);
    if (diffMins < 1) return "0 min";
    if (diffMins < 60) return `${diffMins} min`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const loadOrders = async () => {
    try {
      const activeRestoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
        || localStorage.getItem('pos_restaurant_id') 
        || RESTAURANT_ID;

      if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') {
        setIsLoading(false);
        return;
      }

      const { data: activeSession } = await supabase
        .from('cash_sessions')
        .select('opened_at')
        .eq('restaurant_id', activeRestoId)
        .eq('status', 'OPEN')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let startTime = activeSession?.opened_at;

      if (!startTime) {
        const { data: lastSession } = await supabase
          .from('cash_sessions')
          .select('opened_at')
          .eq('restaurant_id', activeRestoId)
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        startTime = lastSession?.opened_at || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      }

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', activeRestoId)
        .gte('created_at', startTime)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data as Order[]);
    } catch (error) {
      console.error("Erreur chargement des commandes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadKdsStatus = async () => {
      try {
        const { data: ogData } = await supabase
          .from('option_groups')
          .select('id, name, target_category_name, show_on_kds')
          .eq('show_on_kds', false);

        const ids = new Set<string>();
        const names = new Set<string>();

        if (ogData) {
          ogData.forEach(g => {
            if (g.id != null) ids.add(String(g.id));
            if (g.name) names.add(String(g.name).trim().toLowerCase());
            if (g.target_category_name) names.add(String(g.target_category_name).trim().toLowerCase());
          });
        }

        setKdsHiddenGroupIds(ids);
        setKdsHiddenGroupNames(names);
      } catch (err) {
        console.error("Erreur chargement KDS status:", err);
      }
    };

    loadKdsStatus();
  }, []);

  useEffect(() => {
    const loadMapping = async () => {
      if (orders.length === 0) return;
      
      const activeRestoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
        || localStorage.getItem('pos_restaurant_id') 
        || RESTAURANT_ID;

      const allItems = orders.flatMap(order => parseOrderDetails(order.order_details));
      const mapping = await fetchOptionGroupMapping(allItems, activeRestoId);
      setOptionGroupMapping(mapping);
    };

    loadMapping();
  }, [orders]);

  useEffect(() => {
    loadOrders();
    
    const channel = supabase
      .channel('dashboard_orders_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadOrders)
      .subscribe();

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, []);

  const checkIsKdsHidden = (grp: any, opt: any) => {
    if (!grp && !opt) return false;
    if (opt?.show_on_kds === false || opt?.is_kds_hidden === true || grp?.show_on_kds === false) return true;

    const grpId = String(opt?.option_group_id || opt?.group_id || grp?.id || '').trim();
    if (grpId && kdsHiddenGroupIds.has(grpId)) return true;

    const rawGroupName = String(grp?.originalGroupName || grp?.groupName || grp?.name || opt?.group_name || opt?.option_group_name || '').trim().toLowerCase();
    if (rawGroupName && (kdsHiddenGroupNames.has(rawGroupName) || rawGroupName.includes('boisson') || rawGroupName.includes('drink'))) return true;

    const optName = String(opt?.name || '').trim().toLowerCase();
    const drinkKeywords = ['pepsi', 'fanta', 'coca', 'oasis', 'ice tea', 'eau', '7up', 'sprite', 'red bull', 'schweppes', 'capri', 'tropico'];
    if (drinkKeywords.some(kw => optName.includes(kw))) return true;

    return false;
  };

  const handleUpdateStatus = async (orderId: string | number, newStatus: string) => {
    try {
      const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
      if (error) throw error;
      toast.success(`Statut : ${newStatus}`);
      setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      setActiveMenuOrderId(null);
    } catch (err) {
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const handleCompleteOrder = async (orderId: string | number) => {
    await handleUpdateStatus(orderId, 'Fermé');
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#0f172a] flex flex-col font-helvetica select-none rounded-none text-slate-100">
      
      {/* HEADER AVEC ONGLETS */}
      <div className="bg-[#1e293b] h-[64px] border-b border-slate-700 flex items-center justify-between px-4 flex-shrink-0 shadow-md z-20">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setActiveTab('en_cours')} 
            className={`flex items-center gap-2 px-4 py-2 rounded-none font-black text-xs uppercase transition-all ${
              activeTab === 'en_cours' 
                ? 'bg-amber-500 text-slate-950 shadow-md' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Loader2 size={15} /> En cours ({activeOrders.length})
          </button>
          
          <button 
            onClick={() => setActiveTab('livraisons')} 
            className={`flex items-center gap-2 px-4 py-2 rounded-none font-black text-xs uppercase transition-all ${
              activeTab === 'livraisons' 
                ? 'bg-blue-600 text-white shadow-md' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Truck size={15} /> Livraisons ({deliveryOrders.length})
          </button>

          <button 
            onClick={() => setActiveTab('fermees')} 
            className={`flex items-center gap-2 px-4 py-2 rounded-none font-black text-xs uppercase transition-all ${
              activeTab === 'fermees' 
                ? 'bg-[#04B855] text-white shadow-md' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <CheckCircle2 size={15} /> Terminées ({closedOrders.length})
          </button>
        </div>

        <button 
          onClick={onClose} 
          className="h-9 px-5 bg-red-600 hover:bg-red-500 text-white rounded-none font-black uppercase text-xs tracking-wider transition-colors shadow-sm"
        >
          FERMER
        </button>
      </div>

      {/* ZONE MASONRY COMPACTE */}
      <div className="flex-1 overflow-y-auto p-1.5 custom-scrollbar bg-[#0f172a]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-slate-500 font-bold text-xl uppercase tracking-widest animate-pulse">Chargement des commandes...</span>
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <Receipt className="w-16 h-16 text-slate-700 mb-3" />
            <p className="text-slate-500 font-black text-xl uppercase tracking-widest">Aucune commande dans cet onglet</p>
          </div>
        ) : (
          <div className="columns-2 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-1.5 space-y-1.5 pb-4">
            {displayedOrders.map((order) => {
              const customerName = order.customer_name || "Client Caisse";
              const customerPhone = order.customer_phone || "";
              const customerAddress = order.customer_address || "";
              const isPaid = order.is_paid || order.payment_status === 'paid';
              const items = parseOrderDetails(order.order_details);
              const isFlipped = !!flippedOrders[order.id];

              const s = order.status?.toLowerCase() || '';
              const isPrete = s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret';

              const isLiv = isDeliveryOrder(order);
              const typeAbbr = order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' ? 'EMP' : isLiv ? 'LIV' : 'SP';
              
              let headerBgClass = order.order_type_id === '633425b1-f86c-4c17-8cba-b258906ad317' 
                ? 'bg-[#E65100]' 
                : order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' 
                  ? 'bg-[#A0612D]' 
                  : 'bg-[#1976D2]';

              return (
                <div 
                  key={order.id} 
                  className={`bg-slate-900 border-2 border-slate-700 flex flex-col h-auto overflow-hidden rounded-none shadow-md break-inside-avoid relative transition-all ${
                    isFlipped ? 'ring-2 ring-amber-400' : ''
                  }`}
                >
                  
                  {/* EN-TÊTE DU TICKET */}
                  <div 
                    onClick={() => handleHeaderTap(order.id)}
                    onDoubleClick={() => toggleCustomerView(order.id)}
                    className={`${headerBgClass} px-2 py-1.5 border-b border-black/30 text-white flex justify-between items-center w-full min-w-0 flex-shrink-0 cursor-pointer select-none relative`}
                    title="Double-cliquez pour basculer les coordonnées client"
                  >
                    {/* GAUCHE */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-sm 2xl:text-base font-black text-white truncate leading-none">
                        {order.order_number || `#${order.id.toString().slice(-3)}`}
                      </h3>
                      <span className="px-1 py-0.5 rounded-none text-[8.5px] font-black uppercase bg-white/20 text-white leading-none">
                        {typeAbbr}
                      </span>
                    </div>

                    {/* CENTRE : STATUT PAIEMENT */}
                    <div className="flex items-center justify-center">
                      {isPaid ? (
                        <span className="bg-white/25 text-white px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider leading-none">
                          PAYÉ
                        </span>
                      ) : (
                        <span className="bg-red-600 text-white px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider leading-none animate-pulse border border-white/20">
                          NON PAYÉ
                        </span>
                      )}
                    </div>

                    {/* DROITE : TIMER + MENU */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className="flex items-center gap-0.5 bg-black/25 px-1.5 py-0.5 text-[9px] font-black">
                        <Clock size={10} />
                        <span>{getTimeElapsed(order.created_at)}</span>
                      </div>

                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setActiveMenuOrderId(activeMenuOrderId === order.id ? null : order.id); 
                        }} 
                        className="p-0.5 text-white/80 hover:text-white hover:bg-white/20 transition-colors"
                      >
                        <MoreVertical size={14} />
                      </button>
                    </div>

                    {/* MENU STATUT */}
                    {activeMenuOrderId === order.id && (
                      <div 
                        onClick={(e) => e.stopPropagation()} 
                        className="absolute right-1 top-7 bg-white border border-slate-700 shadow-2xl z-[99] flex flex-col text-[10px] font-black uppercase tracking-wider min-w-[120px] rounded-none overflow-hidden"
                      >
                        {['Nouvelle', 'En cours', 'Prêt', 'Fermé'].map(st => (
                          <button 
                            key={st} 
                            onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, st); }} 
                            className="px-3 py-2 text-slate-800 text-left border-b border-gray-100 hover:bg-gray-100 last:border-0 transition-colors"
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* CORPS : LISTE ARTICLES OU FICHE CLIENT */}
                  {isFlipped ? (
                    /* 👤 FICHE CLIENT */
                    <div className="p-2.5 bg-slate-900 text-white space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-700 pb-1">
                        <span className="text-[10px] font-black uppercase text-amber-400 flex items-center gap-1.5">
                          <User size={12} /> Fiche Client
                        </span>
                        <button 
                          onClick={() => toggleCustomerView(order.id)} 
                          className="text-[9px] font-bold text-slate-400 hover:text-white flex items-center gap-1 uppercase underline"
                        >
                          <ArrowLeftRight size={10} /> Voir articles
                        </button>
                      </div>

                      <div>
                        <div className="text-[8.5px] font-bold uppercase text-slate-400">Nom</div>
                        <div className="text-xs font-black text-white truncate">{customerName}</div>
                      </div>

                      <div>
                        <div className="text-[8.5px] font-bold uppercase text-slate-400">Téléphone</div>
                        {customerPhone ? (
                          <a href={`tel:${customerPhone}`} className="text-xs font-black text-emerald-400 flex items-center gap-1 hover:underline">
                            <Phone size={11} /> {customerPhone}
                          </a>
                        ) : (
                          <div className="text-xs text-slate-500 italic">Non renseigné</div>
                        )}
                      </div>

                      {customerAddress && (
                        <div>
                          <div className="text-[8.5px] font-bold uppercase text-slate-400">Adresse de livraison</div>
                          <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customerAddress)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10.5px] font-bold text-blue-300 flex items-start gap-1 hover:underline leading-tight"
                          >
                            <MapPin size={12} className="text-red-400 shrink-0 mt-0.5" />
                            <span>{customerAddress}</span>
                          </a>
                        </div>
                      )}

                      <div className="pt-1 border-t border-slate-800 grid grid-cols-2 gap-2 text-[9.5px]">
                        <div>
                          <span className="text-slate-400 font-bold block uppercase text-[8px]">Paiement</span>
                          <span className="font-bold flex items-center gap-1 text-slate-200 uppercase truncate">
                            {order.payment_method?.toLowerCase().includes('carte') || order.payment_method?.toLowerCase().includes('cb') 
                              ? <CreditCard size={10} className="text-blue-400" /> 
                              : <Banknote size={10} className="text-emerald-400" />}
                            {order.payment_method || 'Caisse'}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 font-bold block uppercase text-[8px]">Origine</span>
                          <span className="font-bold flex items-center gap-1 text-slate-200 uppercase truncate">
                            {order.order_origin === 'app' ? <Smartphone size={10} className="text-purple-400" /> : <Store size={10} className="text-amber-400" />}
                            {order.order_origin || 'Caisse'}
                          </span>
                        </div>
                      </div>

                      {order.comment && (
                        <div className="p-1.5 bg-slate-800 border border-slate-700 text-[9.5px]">
                          <span className="text-amber-400 font-black block uppercase text-[8px] flex items-center gap-1 mb-0.5">
                            <MessageSquare size={9} /> Note :
                          </span>
                          <span className="text-slate-200 italic">{order.comment}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* 🍔 LISTE DES ARTICLES ET OPTIONS */
                    <div className="p-2 bg-slate-100 text-slate-900 space-y-2">
                      {items.map((item: any, itemIdx: number) => {
                        const itemKey = `${order.id}-item-${itemIdx}`;
                        const qty = item.quantity || 1;
                        const prodName = item.product?.name || item.name || "Produit";
                        const optionGroups = getFormattedOrderOptions(item, optionGroupMapping);

                        return (
                          <div key={itemIdx} className="border-b border-slate-200/80 pb-1.5 last:border-0">
                            
                            {/* 🟢 NOM DU PRODUIT EN BADGE NOIR ÉLÉGANT */}
                            <div 
                              onClick={() => togglePrepared(itemKey)}
                              className={`cursor-pointer transition-all inline-flex items-center gap-1 text-[12px] 2xl:text-[13px] font-black uppercase tracking-wide px-2 py-0.5 border shadow-sm ${
                                preparedItems[itemKey] 
                                  ? '!bg-emerald-400 !text-slate-950 !border-emerald-500' 
                                  : 'bg-black text-white border-slate-900 hover:bg-slate-800'
                              }`}
                            >
                              <span>{qty}x</span> 
                              <span className="truncate">{prodName}</span>
                            </div>

                            {/* TOUTES LES OPTIONS DIRECTEMENT VISIBLES */}
                            {optionGroups.length > 0 && (
                              <div className="pl-2 mt-1 space-y-1">
                                {optionGroups.map((grp, gIdx) => (
                                  <div key={gIdx} className="flex flex-wrap items-baseline gap-1.5 leading-tight">
                                    {grp.items.map((opt, oIdx) => {
                                      const optKey = `${itemKey}-grp-${gIdx}-opt-${oIdx}`;
                                      const isHighlighted = preparedItems[optKey];
                                      const isKdsHidden = checkIsKdsHidden(grp, opt);

                                      // 🟢 OPTIONS VIOLETTES PLUS GROSSES ET MISES EN ÉVIDENCE EN PREMIER SOUS LE PRODUIT
                                      if (isKdsHidden && !opt.isSans) {
                                        return (
                                          <span 
                                            key={oIdx}
                                            onClick={() => togglePrepared(optKey)}
                                            className={`cursor-pointer transition-all inline-flex items-center gap-1 text-[12px] 2xl:text-[13px] font-black uppercase tracking-wide bg-purple-700 text-white px-2.5 py-0.5 border-2 border-purple-900 shadow-sm ${
                                              isHighlighted ? '!bg-emerald-400 !text-slate-950 !border-emerald-500' : ''
                                            }`}
                                          >
                                            {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                            {opt.price > 0 && <span className="text-purple-200 font-bold ml-0.5 text-[10px]">(+{opt.price.toFixed(2)}€)</span>}
                                          </span>
                                        );
                                      }

                                      // OPTIONS STANDARDS & SANS
                                      let textColorClass = opt.isSans 
                                        ? 'text-red-600 font-black uppercase text-[10px]' 
                                        : 'text-blue-700 font-bold uppercase text-[9.5px]';

                                      return (
                                        <span 
                                          key={oIdx} 
                                          onClick={() => togglePrepared(optKey)}
                                          className={`cursor-pointer transition-all ${
                                            isHighlighted 
                                              ? 'bg-emerald-400 text-slate-950 font-black px-0.5 text-[10px]' 
                                              : textColorClass
                                          }`}
                                        >
                                          {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                          {opt.price > 0 && <span className="text-gray-500 font-normal"> (+{opt.price.toFixed(2)}€)</span>}
                                          {oIdx < grp.items.length - 1 ? ', ' : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* FOOTER : NOM DU CLIENT + PRIX TOTAL & ICÔNE CLÔTURER */}
                  <div className={`px-2 py-1.5 flex justify-between items-center z-10 flex-shrink-0 ${getStatusFooterStyles(order.status)}`}>
                    <div className="truncate text-[11px] font-black uppercase text-white flex-1 min-w-0 pr-2 leading-tight">
                      {customerName} <span className="opacity-70">•</span> {order.total_price?.toFixed(2)} €
                    </div>

                    {isPrete && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleCompleteOrder(order.id); }} 
                        className="bg-white text-slate-900 hover:bg-emerald-400 hover:text-slate-950 active:scale-90 p-1 rounded-none transition-all flex items-center justify-center flex-shrink-0"
                        title="Clôturer la commande"
                      >
                        <CheckCircle2 size={16} strokeWidth={3} />
                      </button>
                    )}
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>,
    document.body
  );
};

export default OrdersDashboardModal;