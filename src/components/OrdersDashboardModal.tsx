// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Receipt,
  Bell,
  Search,
  ShoppingBag,
  ChevronRight
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
  called_at?: string;
}

interface DashboardProps {
  onClose: () => void;
}

const isOrderClosed = (status: string) => {
  const s = status?.toLowerCase() || '';
  return s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee' || s === 'annulée';
};

const isDeliveryOrder = (order: Order) => {
  const tid = String(order.order_type_id || '').toLowerCase();
  return tid === 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d' || tid === '3' || tid.includes('liv');
};

const getOrderTypeDetails = (order: Order) => {
  const tid = String(order.order_type_id || '').toLowerCase();
  if (tid === 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d' || tid === '3' || tid.includes('liv')) {
    return { label: 'LIVRAISON', abbr: 'LIV', bgClass: 'bg-[#1976D2]', borderClass: 'border-blue-500', Icon: Truck };
  }
  if (tid === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' || tid === '2' || tid.includes('emp')) {
    return { label: 'À EMPORTER', abbr: 'EMP', bgClass: 'bg-[#A0612D]', borderClass: 'border-amber-700', Icon: ShoppingBag };
  }
  return { label: 'SUR PLACE', abbr: 'SP', bgClass: 'bg-[#E65100]', borderClass: 'border-orange-600', Icon: Store };
};

const getStatusFooterStyles = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s === 'nouvelle') return 'bg-red-600 text-white';
  if (s === 'en cours') return 'bg-blue-600 text-white';
  if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') return 'bg-[#04B855] text-white';
  if (s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee') return 'bg-slate-900 text-white';
  return 'bg-slate-800 text-white';
};

const parseOrderDetails = (details: any): any[] => {
  if (Array.isArray(details)) return details;
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      return [parsed];
    } catch {
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
  const [searchQuery, setSearchQuery] = useState('');
  
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | number | null>(null);
  const [flippedOrders, setFlippedOrders] = useState<Record<string | number, boolean>>({});
  const [preparedItems, setPreparedItems] = useState<Record<string, boolean>>({});
  const [recalledOrderIds, setRecalledOrderIds] = useState<Record<string | number, boolean>>({});
  
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});
  const [kdsHiddenGroupIds, setKdsHiddenGroupIds] = useState<Set<string>>(new Set());
  const [kdsHiddenGroupNames, setKdsHiddenGroupNames] = useState<Set<string>>(new Set());

  // Nombre de colonnes responsive dynamique
  const [colCount, setColCount] = useState(4);

  useEffect(() => {
    const updateColCount = () => {
      const w = window.innerWidth;
      if (w >= 1600) setColCount(6);
      else if (w >= 1300) setColCount(5);
      else if (w >= 980) setColCount(4);
      else if (w >= 640) setColCount(3);
      else setColCount(2);
    };

    updateColCount();
    window.addEventListener('resize', updateColCount);
    return () => window.removeEventListener('resize', updateColCount);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleCloseMenus = () => setActiveMenuOrderId(null);
    window.addEventListener('click', handleCloseMenus);
    window.addEventListener('touchstart', handleCloseMenus, { passive: true });
    return () => {
      window.removeEventListener('click', handleCloseMenus);
      window.removeEventListener('touchstart', handleCloseMenus);
    };
  }, []);

  const toggleCustomerView = (orderId: string | number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFlippedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
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

  const getTimerBadgeClass = (dateString: string, isClosed: boolean) => {
    if (isClosed) return 'bg-black/30 text-slate-300 border-black/40';
    const diffMins = getElapsedMinutes(dateString);
    if (diffMins < 10) {
      return 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50';
    }
    if (diffMins < 20) {
      return 'bg-amber-400 text-slate-950 font-black border-amber-300 shadow-sm';
    }
    return 'bg-rose-600 text-white font-black border-rose-400 animate-pulse shadow-md';
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
    } catch {
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const handleRecallOrder = async (orderId: string | number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setRecalledOrderIds(prev => ({ ...prev, [orderId]: true }));
      const { error } = await supabase
        .from('orders')
        .update({ called_at: new Date().toISOString() })
        .eq('id', orderId);

      if (error) throw error;
      toast.success("Rappel sonore envoyé à l'écran !");
      setTimeout(() => {
        setRecalledOrderIds(prev => ({ ...prev, [orderId]: false }));
      }, 2500);
    } catch (err) {
      console.error("Erreur rappel:", err);
      toast.error("Impossible de faire sonner la commande");
      setRecalledOrderIds(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const getNextStatusAction = (status: string) => {
    const s = status?.trim().toLowerCase() || '';
    if (s === 'nouvelle' || s === 'nouveau') {
      return { next: 'En cours', label: 'PREP', bgClass: 'bg-blue-600 hover:bg-blue-500 text-white' };
    }
    if (s === 'en cours' || s === 'preparation' || s === 'en préparation' || s === 'en cours de préparation') {
      return { next: 'Prêt', label: 'PRÊT', bgClass: 'bg-[#04B855] hover:bg-emerald-400 text-slate-950 font-black' };
    }
    if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') {
      return { next: 'Fermé', label: 'CLÔTURER', bgClass: 'bg-white hover:bg-emerald-400 text-slate-900 font-black' };
    }
    return null;
  };

  const activeOrders = useMemo(() => orders.filter(o => !isOrderClosed(o.status)), [orders]);
  const deliveryOrders = useMemo(() => orders.filter(o => isDeliveryOrder(o) && !isOrderClosed(o.status)), [orders]);
  const closedOrders = useMemo(() => orders.filter(o => isOrderClosed(o.status)), [orders]);

  const displayedOrders = useMemo(() => {
    let list = activeTab === 'en_cours' 
      ? activeOrders 
      : activeTab === 'livraisons' 
        ? deliveryOrders 
        : closedOrders.slice(0, 60);

    if (!searchQuery.trim()) return list;

    const q = searchQuery.trim().toLowerCase();
    return list.filter(o => {
      const num = String(o.order_number || o.id || '').toLowerCase();
      const name = String(o.customer_name || '').toLowerCase();
      const phone = String(o.customer_phone || '').toLowerCase();
      return num.includes(q) || name.includes(q) || phone.includes(q);
    });
  }, [activeTab, activeOrders, deliveryOrders, closedOrders, searchQuery]);

  // Répartition équilibrée par colonnes verticales indépendantes (comble les trous sans saut de carte)
  const columns = useMemo(() => {
    const cols: Order[][] = Array.from({ length: colCount }, () => []);
    displayedOrders.forEach((order, idx) => {
      cols[idx % colCount].push(order);
    });
    return cols;
  }, [displayedOrders, colCount]);

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#0f172a] flex flex-col font-helvetica select-none rounded-none text-slate-100">
      
      {/* HEADER AVEC ONGLETS + RECHERCHE COMPACTE */}
      <div className="bg-[#1e293b] h-[64px] border-b border-slate-700 flex items-center justify-between px-3 sm:px-4 flex-shrink-0 shadow-md z-20 gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-1">
          <button 
            type="button"
            onClick={() => setActiveTab('en_cours')} 
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-none font-black text-xs uppercase transition-all shrink-0 active:scale-95 ${
              activeTab === 'en_cours' 
                ? 'bg-amber-500 text-slate-950 shadow-md' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Loader2 size={15} /> En cours ({activeOrders.length})
          </button>
          
          <button 
            type="button"
            onClick={() => setActiveTab('livraisons')} 
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-none font-black text-xs uppercase transition-all shrink-0 active:scale-95 ${
              activeTab === 'livraisons' 
                ? 'bg-blue-600 text-white shadow-md' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Truck size={15} /> Livraisons ({deliveryOrders.length})
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('fermees')} 
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-none font-black text-xs uppercase transition-all shrink-0 active:scale-95 ${
              activeTab === 'fermees' 
                ? 'bg-[#04B855] text-white shadow-md' 
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <CheckCircle2 size={15} /> Terminées ({closedOrders.length})
          </button>
        </div>

        {/* BARRE DE RECHERCHE + BOUTON FERMER */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center w-36 sm:w-56">
            <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="N° ou Nom..."
              className="w-full bg-slate-900 border border-slate-700 focus:border-amber-400 text-white placeholder:text-slate-500 text-xs pl-8 pr-7 py-1.5 rounded-none outline-none font-bold transition-colors"
            />
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <button 
            type="button"
            onClick={onClose} 
            className="h-9 px-4 sm:px-5 bg-red-600 hover:bg-red-500 active:scale-95 text-white rounded-none font-black uppercase text-xs tracking-wider transition-all shadow-sm cursor-pointer"
          >
            FERMER
          </button>
        </div>
      </div>

      {/* ZONE PRINCIPALE : COLONNES COMPACTÉES VERTICALEMENT SANS AUCUN TROU */}
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar bg-[#0f172a]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-slate-500 font-bold text-xl uppercase tracking-widest animate-pulse">
              Chargement des commandes...
            </span>
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <Receipt className="w-16 h-16 text-slate-700 mb-3" />
            <p className="text-slate-500 font-black text-xl uppercase tracking-widest">
              {searchQuery ? 'Aucune commande trouvée' : 'Aucune commande dans cet onglet'}
            </p>
          </div>
        ) : (
          <div className="flex gap-2 items-start pb-6">
            {columns.map((colOrders, colIdx) => (
              <div key={colIdx} className="flex-1 flex flex-col gap-2 min-w-0">
                {colOrders.map((order) => {
                  const customerName = order.customer_name || "Client Caisse";
                  const customerPhone = order.customer_phone || "";
                  const customerAddress = order.customer_address || "";
                  const isPaid = order.is_paid || order.payment_status === 'paid';
                  const items = parseOrderDetails(order.order_details);
                  const isFlipped = !!flippedOrders[order.id];
                  const isClosed = isOrderClosed(order.status);
                  const isRecalled = !!recalledOrderIds[order.id];

                  const typeInfo = getOrderTypeDetails(order);
                  const TypeIcon = typeInfo.Icon;
                  const nextStatusAction = getNextStatusAction(order.status);

                  // Nettoyage et sécurisation du numéro de commande pour qu'il soit toujours visible
                  const orderNum = (order.order_number && String(order.order_number).toLowerCase() !== 'nan' && String(order.order_number).trim() !== '')
                    ? String(order.order_number).trim()
                    : `#${String(order.id).slice(-3)}`;

                  return (
                    <div 
                      key={order.id} 
                      className={`bg-slate-900 border-2 border-slate-700 flex flex-col h-auto overflow-visible rounded-none shadow-md relative transition-all ${
                        isFlipped ? 'ring-2 ring-amber-400' : ''
                      }`}
                    >
                      
                      {/* EN-TÊTE DU TICKET */}
                      <div 
                        className={`${typeInfo.bgClass} px-2 py-1.5 border-b border-black/30 text-white flex justify-between items-center w-full min-w-0 flex-shrink-0 relative select-none gap-1`}
                      >
                        {/* GAUCHE : Numéro (JAMAIS RÉDUIT) + Type + Paiement */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <h3 
                            onClick={(e) => toggleCustomerView(order.id, e)}
                            className="text-sm sm:text-base font-black text-white shrink-0 leading-none cursor-pointer hover:underline tracking-tight"
                            title="Toucher pour basculer les infos client"
                          >
                            {orderNum}
                          </h3>
                          <span className="px-1 py-0.5 text-[8px] font-black uppercase bg-white/20 text-white leading-none shrink-0 flex items-center gap-0.5">
                            <TypeIcon size={9} />
                            {typeInfo.abbr}
                          </span>
                          {isPaid ? (
                            <span className="bg-white/25 text-white px-1 py-0.5 text-[7.5px] font-black uppercase tracking-wider leading-none shrink-0">
                              PAYÉ
                            </span>
                          ) : (
                            <span className="bg-red-600 text-white px-1 py-0.5 text-[7.5px] font-black uppercase tracking-wider leading-none shrink-0 animate-pulse border border-white/20">
                              NON PAYÉ
                            </span>
                          )}
                        </div>

                        {/* DROITE : Actions + Timer + Menu */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          {/* Fiche Client (1 tap) */}
                          <button
                            type="button"
                            onClick={(e) => toggleCustomerView(order.id, e)}
                            className={`p-1 flex items-center justify-center transition-all active:scale-95 ${
                              isFlipped ? 'bg-amber-400 text-slate-950 shadow' : 'bg-black/25 text-white hover:bg-white/20'
                            }`}
                            title="Fiche client"
                          >
                            <User size={13} />
                          </button>

                          {/* Rappeler TV */}
                          <button
                            type="button"
                            onClick={(e) => handleRecallOrder(order.id, e)}
                            className={`p-1 flex items-center justify-center transition-all active:scale-95 ${
                              isRecalled 
                                ? 'bg-amber-400 text-slate-950 animate-pulse ring-2 ring-amber-300' 
                                : 'bg-black/25 text-white hover:bg-amber-500 hover:text-slate-950'
                            }`}
                            title="Faire sonner la commande"
                          >
                            <Bell size={13} />
                          </button>

                          {/* Timer */}
                          <div className={`px-1 py-0.5 border flex items-center gap-0.5 text-[8.5px] font-black leading-none shrink-0 ${getTimerBadgeClass(order.created_at, isClosed)}`}>
                            <Clock size={9} />
                            <span>{getTimeElapsed(order.created_at)}</span>
                          </div>

                          {/* Menu 3 points */}
                          <div className="relative">
                            <button 
                              type="button"
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setActiveMenuOrderId(activeMenuOrderId === order.id ? null : order.id); 
                              }} 
                              className="p-1 text-white hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
                              title="Changer statut"
                            >
                              <MoreVertical size={14} />
                            </button>

                            {activeMenuOrderId === order.id && (
                              <div 
                                onClick={(e) => e.stopPropagation()} 
                                className="absolute right-0 top-full mt-1 bg-white border-2 border-slate-700 shadow-2xl z-[200] flex flex-col text-[10px] font-black uppercase tracking-wider min-w-[120px] rounded-none overflow-hidden"
                              >
                                {['Nouvelle', 'En cours', 'Prêt', 'Fermé'].map(st => (
                                  <button 
                                    key={st} 
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, st); }} 
                                    className="px-3 py-2 text-slate-900 text-left border-b border-gray-100 hover:bg-slate-100 last:border-0 transition-colors"
                                  >
                                    {st}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* CORPS DU TICKET : LISTE ARTICLES OU FICHE CLIENT */}
                      {isFlipped ? (
                        /* 👤 FICHE CLIENT */
                        <div className="p-2.5 bg-slate-900 text-white space-y-2">
                          <div className="flex items-center justify-between border-b border-slate-700 pb-1">
                            <span className="text-[10px] font-black uppercase text-amber-400 flex items-center gap-1.5">
                              <User size={12} /> Fiche Client
                            </span>
                            <button 
                              type="button"
                              onClick={(e) => toggleCustomerView(order.id, e)} 
                              className="text-[9.5px] font-bold text-slate-400 hover:text-white flex items-center gap-1 uppercase underline"
                            >
                              <ArrowLeftRight size={11} /> Voir articles
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
                                  ? <CreditCard size={11} className="text-blue-400" /> 
                                  : <Banknote size={11} className="text-emerald-400" />}
                                {order.payment_method || 'Caisse'}
                              </span>
                            </div>

                            <div>
                              <span className="text-slate-400 font-bold block uppercase text-[8px]">Origine</span>
                              <span className="font-bold flex items-center gap-1 text-slate-200 uppercase truncate">
                                {order.order_origin === 'app' ? <Smartphone size={11} className="text-purple-400" /> : <Store size={11} className="text-amber-400" />}
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
                                
                                <div 
                                  onClick={() => togglePrepared(itemKey)}
                                  className={`cursor-pointer transition-all inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wide px-2 py-0.5 border shadow-sm ${
                                    preparedItems[itemKey] 
                                      ? '!bg-emerald-400 !text-slate-950 !border-emerald-500' 
                                      : 'bg-black text-white border-slate-900 hover:bg-slate-800'
                                  }`}
                                >
                                  <span>{qty}x</span> 
                                  <span className="truncate">{prodName}</span>
                                </div>

                                {optionGroups.length > 0 && (
                                  <div className="pl-1 mt-1 space-y-1">
                                    {optionGroups.map((grp, gIdx) => (
                                      <div key={gIdx} className="flex flex-wrap items-baseline gap-1.5 leading-tight">
                                        {grp.items.map((opt, oIdx) => {
                                          const optKey = `${itemKey}-grp-${gIdx}-opt-${oIdx}`;
                                          const isHighlighted = preparedItems[optKey];
                                          const isKdsHidden = checkIsKdsHidden(grp, opt);

                                          if (isKdsHidden && !opt.isSans) {
                                            return (
                                              <span 
                                                key={oIdx}
                                                onClick={() => togglePrepared(optKey)}
                                                className={`cursor-pointer transition-all inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wide bg-purple-700 text-white px-2.5 py-0.5 border border-purple-900 shadow-sm ${
                                                  isHighlighted ? '!bg-emerald-400 !text-slate-950 !border-emerald-500' : ''
                                                }`}
                                              >
                                                {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                                {opt.price > 0 && <span className="text-purple-200 font-bold ml-0.5 text-[10px]">(+{opt.price.toFixed(2)}€)</span>}
                                              </span>
                                            );
                                          }

                                          return (
                                            <span 
                                              key={oIdx} 
                                              onClick={() => togglePrepared(optKey)}
                                              className={`cursor-pointer transition-all ${
                                                isHighlighted 
                                                  ? 'bg-emerald-400 text-slate-950 font-black px-1 text-[10px]' 
                                                  : opt.isSans 
                                                    ? 'bg-red-50 text-red-700 border border-red-200 font-black uppercase px-1 text-[10px]' 
                                                    : 'text-slate-900 font-extrabold uppercase text-[10px]'
                                              }`}
                                            >
                                              {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                              {opt.price > 0 && <span className="text-slate-500 font-normal"> (+{opt.price.toFixed(2)}€)</span>}
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

                      {/* PIED DU TICKET */}
                      <div className={`px-2 py-1.5 flex justify-between items-center z-10 flex-shrink-0 gap-2 ${getStatusFooterStyles(order.status)}`}>
                        <div className="truncate text-[11px] font-black uppercase text-white flex-1 min-w-0 leading-tight">
                          {customerName} <span className="opacity-70">•</span> {order.total_price?.toFixed(2)} €
                        </div>

                        {nextStatusAction && (
                          <button 
                            type="button"
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              handleUpdateStatus(order.id, nextStatusAction.next); 
                            }} 
                            className={`h-7 px-2.5 rounded-none text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1 shadow active:scale-95 shrink-0 ${nextStatusAction.bgClass}`}
                            title={`Passer à : ${nextStatusAction.next}`}
                          >
                            {nextStatusAction.next === 'Fermé' ? (
                              <>
                                <CheckCircle2 size={13} strokeWidth={3} />
                                <span>CLÔTURER</span>
                              </>
                            ) : (
                              <>
                                <span>{nextStatusAction.label}</span>
                                <ChevronRight size={13} strokeWidth={3} />
                              </>
                            )}
                          </button>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>,
    document.body
  );
};

export default OrdersDashboardModal;