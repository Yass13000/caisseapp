// @ts-nocheck
import React, { useState, useEffect } from 'react';
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
  ExternalLink, 
  Eye, 
  EyeOff 
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
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
}

interface DashboardProps {
  onClose: () => void;
}

const getStatusBadgeStyles = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s === 'nouvelle') return 'bg-red-500 text-white border-red-600';
  if (s === 'en cours') return 'bg-blue-500 text-white border-blue-600';
  if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') return 'bg-[#04B855] text-white border-[#039d48]';
  if (s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee') return 'bg-gray-900 text-white border-gray-800';
  return 'bg-gray-100 text-gray-700 border-gray-200';
};

const getStatusFooterStyles = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s === 'nouvelle') return 'bg-red-500 text-white';
  if (s === 'en cours') return 'bg-blue-500 text-white';
  if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') return 'bg-[#04B855] text-white';
  if (s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee') return 'bg-gray-900 text-white';
  return 'bg-gray-100 text-gray-700';
};

const isOrderClosed = (status: string) => {
  const s = status?.toLowerCase() || '';
  return s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee';
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
  const [expandedDeliveryOrderId, setExpandedDeliveryOrderId] = useState<string | number | null>(null);
  const [preparedItems, setPreparedItems] = useState<Record<string, boolean>>({});
  
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});
  
  // 🟢 SETS D'IDENTIFIANTS ET NOMS DE GROUPES HORS CUISINE (show_on_kds = false)
  const [kdsHiddenGroupIds, setKdsHiddenGroupIds] = useState<Set<string>>(new Set());
  const [kdsHiddenGroupNames, setKdsHiddenGroupNames] = useState<Set<string>>(new Set());

  // FILTRAGE DES COMMANDES
  const activeOrders = orders.filter(o => !isOrderClosed(o.status));
  const closedOrders = orders.filter(o => isOrderClosed(o.status));
  const deliveryOrders = orders.filter(o => isDeliveryOrder(o) && !isOrderClosed(o.status));

  const displayedOrders = activeTab === 'en_cours' 
    ? activeOrders 
    : activeTab === 'livraisons' 
      ? deliveryOrders 
      : closedOrders;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleCloseMenus = () => setActiveMenuOrderId(null);
    window.addEventListener('click', handleCloseMenus);
    return () => window.removeEventListener('click', handleCloseMenus);
  }, []);

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
    if (diffMins < 1) return "À l'instant";
    if (diffMins < 60) return `${diffMins} min`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // 🟢 CHARGEMENT DES COMMANDES DE LA SESSION ACTIVE
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

  // 🟢 CHARGEMENT MULTI-NIVEAUX DES GROUPES HORS CUISINE (show_on_kds = false)
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

  // 🟢 CHARGEMENT DU MAPPING DE NOMS D'OPTIONS
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
      .channel('dashboard_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadOrders)
      .subscribe();

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, []);

  // 🟢 VÉRIFICATION ULTRA-SÉCURISÉE DES OPTIONS HORS CUISINE (BDD + MOTS-CLÉS DYNAMIQUES)
  const checkIsKdsHidden = (grp: any, opt: any) => {
    if (!grp && !opt) return false;

    // 1. Détection via propriétés directes de l'objet
    if (opt?.show_on_kds === false || opt?.is_kds_hidden === true || grp?.show_on_kds === false) {
      return true;
    }

    // 2. Détection via ID de groupe (option_group_id)
    const grpId = String(opt?.option_group_id || opt?.group_id || grp?.id || '').trim();
    if (grpId && kdsHiddenGroupIds.has(grpId)) {
      return true;
    }

    // 3. Détection via Nom de groupe (originalGroupName / groupName)
    const rawGroupName = String(grp?.originalGroupName || grp?.groupName || grp?.name || opt?.group_name || opt?.option_group_name || '').trim().toLowerCase();
    if (rawGroupName && kdsHiddenGroupNames.has(rawGroupName)) {
      return true;
    }

    // 4. Détection par mot-clé sur le nom du groupe (ex: boisson / drinks)
    if (rawGroupName.includes('boisson') || rawGroupName.includes('drink')) {
      return true;
    }

    // 5. Détection automatique par mot-clé produit (boissons dynamiques)
    const optName = String(opt?.name || '').trim().toLowerCase();
    const drinkKeywords = [
      'pepsi', 'fanta', 'coca', 'oasis', 'ice tea', 'eau', '7up', 'sprite',
      'perrier', 'tropico', 'red bull', 'schweppes', 'capri', 'dr pepper',
      'ayran', 'cristaline', 'san pellegrino', 'fuze tea', 'orangina', 'hawaii', 'poms'
    ];

    if (drinkKeywords.some(kw => optName.includes(kw))) {
      return true;
    }

    return false;
  };

  const handleUpdateStatus = async (orderId: string | number, newStatus: string) => {
    try {
      const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
      if (error) throw error;
      toast.success(`Statut mis à jour : ${newStatus}`);
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
    <div className="fixed inset-0 z-[99999] bg-[#F3F4F6] flex flex-col font-helvetica select-none rounded-none">
      
      {/* HEADER AVEC LES ONGLETS */}
      <div className="bg-white h-[75px] border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0 shadow-sm z-10 rounded-none">
        <div className="flex gap-3">
          <button 
            onClick={() => setActiveTab('en_cours')} 
            className={`flex items-center gap-2 px-5 py-2.5 rounded-none font-black text-sm uppercase transition-all ${activeTab === 'en_cours' ? 'bg-secondary text-white shadow-md scale-[1.01]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >
            <Loader2 size={16} /> En cours ({activeOrders.length})
          </button>
          
          <button 
            onClick={() => setActiveTab('livraisons')} 
            className={`flex items-center gap-2 px-5 py-2.5 rounded-none font-black text-sm uppercase transition-all ${activeTab === 'livraisons' ? 'bg-green-600 text-white shadow-md scale-[1.01]' : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'}`}
          >
            <Truck size={16} /> Livraisons ({deliveryOrders.length})
          </button>

          <button 
            onClick={() => setActiveTab('fermees')} 
            className={`flex items-center gap-2 px-5 py-2.5 rounded-none font-black text-sm uppercase transition-all ${activeTab === 'fermees' ? 'bg-[#04B855] text-white shadow-md scale-[1.01]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >
            <CheckCircle2 size={16} /> Terminées ({closedOrders.length})
          </button>
        </div>

        <button onClick={onClose} className="h-10 px-6 bg-red-50 text-red-600 rounded-none font-black border border-red-100 hover:bg-red-100">FERMER</button>
      </div>

      <div className="flex-1 overflow-y-auto px-0 py-0 custom-scrollbar rounded-none">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-gray-400 font-bold text-xl uppercase tracking-widest animate-pulse">Chargement...</span>
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-gray-400 font-bold text-2xl uppercase tracking-widest">Aucune commande dans cet onglet</p>
          </div>
        ) : (
          <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-0 pb-10 rounded-none border-t border-l border-slate-700">
            {displayedOrders.map((order) => {
              const orderTime = new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const customerName = order.customer_name || "Client Caisse";
              const customerPhone = order.customer_phone || "Non renseigné";
              const isPaid = order.is_paid || order.payment_status === 'paid';
              const items = parseOrderDetails(order.order_details);

              // 🟢 RENDU SPÉCIFIQUE POUR L'ONGLET LIVRAISONS
              if (activeTab === 'livraisons') {
                const customerAddress = order.customer_address || "Adresse non spécifiée";
                const isExpanded = expandedDeliveryOrderId === order.id;
                const elapsedMins = getElapsedMinutes(order.created_at);

                let timerBadgeClass = 'bg-green-800/50 text-green-100';
                if (elapsedMins >= 35) {
                  timerBadgeClass = 'bg-red-600 text-white font-black animate-pulse px-1.5 py-0.5 rounded-none';
                } else if (elapsedMins >= 20) {
                  timerBadgeClass = 'bg-amber-500 text-white font-black px-1.5 py-0.5 rounded-none';
                }

                return (
                  <div key={order.id} className="bg-white rounded-none border-r border-b border-slate-700 flex flex-col h-auto overflow-hidden break-inside-avoid w-full relative shadow-sm">
                    
                    {/* EN-TÊTE CARTE LIVRAISON EN VERT */}
                    <div className="p-2.5 border-b border-slate-700/30 bg-green-600 text-white flex justify-between items-center w-full min-w-0 rounded-none relative">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h3 className="text-sm font-black text-white truncate leading-none">
                          {order.order_number || `#${order.id.toString().slice(-4)}`}
                        </h3>
                        <span className="px-1 py-0.5 rounded-none text-[8px] font-black uppercase bg-white/20 text-white leading-none flex-shrink-0">
                          LIV
                        </span>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0 relative">
                        {isPaid ? (
                          <span className="bg-white text-green-700 border border-white px-1.5 py-0.5 rounded-none text-[8px] font-black uppercase tracking-wider leading-none">
                            PAYÉ
                          </span>
                        ) : (
                          <span className="bg-red-500 text-white border border-red-600 px-1.5 py-0.5 rounded-none text-[8px] font-black uppercase tracking-wider leading-none animate-pulse">
                            NON PAYÉ
                          </span>
                        )}

                        <button 
                          onClick={(e) => { e.stopPropagation(); setActiveMenuOrderId(activeMenuOrderId === order.id ? null : order.id); }} 
                          className="p-0.5 text-white/80 hover:text-white hover:bg-white/20 transition-colors"
                        >
                          <MoreVertical size={16} />
                        </button>
                        
                        {activeMenuOrderId === order.id && (
                          <div className="absolute right-0 top-6 bg-white border border-slate-700 shadow-xl z-[99] flex flex-col text-[10px] font-black uppercase tracking-wider min-w-[115px]">
                            {['Nouvelle', 'En cours', 'Prêt', 'Fermé'].map(st => (
                              <button 
                                key={st} 
                                onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, st); }} 
                                className="px-2.5 py-2 text-slate-700 text-left border-b hover:bg-gray-100 last:border-0"
                              >
                                {st}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CORPS DE CARTE CLIENT & ADRESSE */}
                    <div className="bg-white p-3 space-y-2 flex-1">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-wider text-gray-400">Client</div>
                        <div className="text-xs font-black text-slate-900 truncate">
                          {customerName}
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] font-black uppercase tracking-wider text-gray-400">Téléphone</div>
                        <div className="text-xs font-bold text-green-700 flex items-center gap-1">
                          <Phone size={12} className="shrink-0" />
                          <a href={`tel:${customerPhone}`} className="hover:underline">
                            {customerPhone}
                          </a>
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] font-black uppercase tracking-wider text-gray-400">Adresse de livraison</div>
                        <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customerAddress)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-bold text-slate-800 hover:text-blue-600 line-clamp-3 leading-tight flex items-start gap-1 group transition-colors"
                          title="Ouvrir dans Google Maps"
                        >
                          <MapPin size={13} className="shrink-0 mt-0.5 text-red-500 group-hover:scale-110 transition-transform" />
                          <span className="underline decoration-dotted underline-offset-2">{customerAddress}</span>
                        </a>
                      </div>

                      {/* CONTENU PANIER */}
                      <div className="pt-1">
                        <button 
                          onClick={() => setExpandedDeliveryOrderId(isExpanded ? null : order.id)}
                          className="w-full flex items-center justify-between py-1 px-2 bg-gray-100 hover:bg-gray-200 rounded-none text-[10px] font-bold text-slate-700 transition-colors"
                        >
                          <span className="flex items-center gap-1">
                            {isExpanded ? <EyeOff size={12} /> : <Eye size={12} />}
                            {isExpanded ? 'Masquer contenu' : 'Voir contenu'}
                          </span>
                          <span className="bg-gray-300 text-slate-800 px-1 py-0.2 font-black text-[9px]">
                            {items.length} art.
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="mt-1 p-2 bg-slate-50 border border-slate-200 text-[10px] space-y-2 max-h-48 overflow-y-auto">
                            {items.map((item: any, idx: number) => {
                              const optionGroups = getFormattedOrderOptions(item, optionGroupMapping);
                              const qty = item.quantity || 1;
                              const prodName = item.product?.name || item.name || "Produit";

                              return (
                                <div key={idx} className="border-b border-gray-200 pb-1 last:border-0">
                                  <span className="font-black text-secondary mr-1">{qty}x</span>
                                  <span className="font-bold text-slate-800">{prodName}</span>
                                  
                                  {optionGroups.length > 0 && (
                                    <div className="pl-3 mt-0.5 space-y-0.5">
                                      {optionGroups.map((grp, gIdx) => {
                                        return (
                                          <div key={gIdx} className="flex flex-wrap items-baseline gap-1 text-[9px]">
                                            {grp.items.map((opt, oIdx) => {
                                              const isKdsHidden = checkIsKdsHidden(grp, opt);

                                              let textColor = opt.isSans ? "text-red-500 font-bold" : "text-blue-600 font-bold";
                                              if (isKdsHidden && !opt.isSans) textColor = "text-purple-600 font-black uppercase";

                                              return (
                                                <span key={oIdx} className={textColor}>
                                                  {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                                  {opt.price > 0 && <span className="text-gray-400 font-normal"> (+{opt.price.toFixed(2)}€)</span>}
                                                  {oIdx < grp.items.length - 1 ? ', ' : ''}
                                                </span>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* TIMING & PRIX TOTAL */}
                    <div className="px-2.5 py-1.5 bg-green-800 text-white flex justify-between items-center z-10 border-t border-green-900">
                      <div className="truncate text-[11px] font-black uppercase text-white">
                        {order.total_price?.toFixed(2)} €
                      </div>
                      <div className={`text-[9px] font-bold flex items-center gap-1 ${timerBadgeClass}`}>
                        <Clock size={11} />
                        <span>{getTimeElapsed(order.created_at)}</span>
                        <span className="text-white/60">({orderTime})</span>
                      </div>
                    </div>

                    <button 
                      onClick={(e) => { e.stopPropagation(); handleCompleteOrder(order.id); }}
                      className="w-full py-2 bg-[#04B855] hover:bg-green-600 text-white font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors border-t border-green-700 active:scale-[0.99]"
                      title="Marquer comme livrée et fermer"
                    >
                      <CheckCircle2 size={14} strokeWidth={3} />
                      TERMINER LA LIVRAISON
                    </button>

                  </div>
                );
              }

              // 🟢 RENDU DES ONGLETS EN COURS ET TERMINÉES
              const s = order.status?.toLowerCase() || '';
              const isPrete = s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret';

              let typeAbbr = order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' ? 'EMP' : isDeliveryOrder(order) ? 'LIV' : 'SP';
              let headerBgClass = order.order_type_id === '633425b1-f86c-4c17-8cba-b258906ad317' ? 'bg-orange-500' : order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' ? 'bg-[#b07d50]' : 'bg-blue-400';
              let headerTextClass = 'text-white';
              let dotColorClass = 'text-white/80 hover:text-white hover:bg-white/20';

              return (
                <div key={order.id} className="bg-white rounded-none border-r border-b border-slate-700 flex flex-col h-auto overflow-hidden break-inside-avoid w-full relative">
                  
                  {/* EN-TÊTE STANDARD */}
                  <div className={`p-2 border-b border-slate-700/30 ${headerBgClass} flex justify-between items-center w-full min-w-0 rounded-none relative`}>
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <h3 className={`text-sm font-black ${headerTextClass} truncate leading-none`}>{order.order_number || `#${order.id.toString().slice(-4)}`}</h3>
                      <span className={`px-1 py-0.5 rounded-none text-[8px] font-black uppercase bg-white/20 ${headerTextClass} leading-none flex-shrink-0`}>{typeAbbr}</span>
                      {!isPaid && (
                        <span className="bg-red-100 text-red-600 border border-red-200 px-1 py-0.5 rounded-none text-[8px] font-black uppercase tracking-widest leading-none flex-shrink-0 animate-pulse">N.P</span>
                      )}
                      <div className="flex items-center gap-0.5 text-[9px] font-bold text-white/90 flex-shrink-0">
                        <span className={`${headerTextClass} font-black`}>{getTimeElapsed(order.created_at)}</span>
                        <span className={headerTextClass === 'text-white' ? 'text-white/70' : 'text-gray-400'}>({orderTime})</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 flex-shrink-0 relative">
                      <div className={`px-1.5 py-0.5 rounded-none border-b font-black text-[8px] uppercase tracking-wider text-center ${getStatusBadgeStyles(order.status)}`}>{order.status || 'Nouvelle'}</div>
                      <button onClick={(e) => { e.stopPropagation(); setActiveMenuOrderId(activeMenuOrderId === order.id ? null : order.id); }} className={`p-0.5 transition-colors ${dotColorClass}`}><MoreVertical size={16} /></button>
                      
                      {activeMenuOrderId === order.id && (
                        <div className="absolute right-0 top-6 bg-white border border-slate-700 shadow-xl z-[99] flex flex-col text-[10px] font-black uppercase tracking-wider min-w-[115px]">
                          {['Nouvelle', 'En cours', 'Prêt', 'Fermé'].map(st => (
                            <button key={st} onClick={(e) => { e.stopPropagation(); handleUpdateStatus(order.id, st); }} className="px-2.5 py-2 text-slate-700 text-left border-b hover:bg-gray-100 last:border-0">{st}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CORPS DU TICKET AVEC COULEUR SPÉCIFIQUE (VIOLET) POUR LES OPTIONS HORS CUISINE */}
                  <div className="bg-white rounded-none p-3 w-full space-y-2">
                    {items.map((item: any, itemIdx: number) => {
                      const itemKey = `${order.id}-item-${itemIdx}`;
                      const qty = item.quantity || 1;
                      const prodName = item.product?.name || item.name || "Produit";
                      const optionGroups = getFormattedOrderOptions(item, optionGroupMapping);

                      return (
                        <div key={itemIdx} className="border-b border-gray-100 pb-1.5 last:border-0">
                          {/* Nom du produit */}
                          <div 
                            onClick={() => togglePrepared(itemKey)}
                            aria-hidden="true"
                            className={`text-xs flex items-start truncate leading-tight cursor-pointer transition-all ${preparedItems[itemKey] ? 'bg-lime-400 text-black font-black' : ''}`}
                          >
                            <span className={`mr-1.5 font-black flex-shrink-0 ${preparedItems[itemKey] ? 'text-black' : 'text-secondary'}`}>{qty}x</span> 
                            <span className={`truncate font-bold ${preparedItems[itemKey] ? 'text-black' : 'text-slate-800'}`}>
                              {prodName}
                            </span>
                          </div>

                          {/* Groupes d'options */}
                          {optionGroups.length > 0 && (
                            <div className="pl-4 mt-0.5 space-y-0.5">
                              {optionGroups.map((grp, gIdx) => {
                                const grpKey = `${itemKey}-grp-${gIdx}`;

                                return (
                                  <div key={gIdx} className="flex flex-wrap items-baseline gap-1 text-[10px] font-bold">
                                    {grp.items.map((opt, oIdx) => {
                                      const optKey = `${grpKey}-opt-${oIdx}`;
                                      const isHighlighted = preparedItems[optKey];
                                      
                                      // 🟣 DÉTECTION ET VIOLET DE SECOURS POUR LES OPTIONS HORS CUISINE
                                      const isKdsHidden = checkIsKdsHidden(grp, opt);

                                      let textColorClass = opt.isSans ? 'text-red-600 font-black uppercase' : 'text-blue-600 font-bold uppercase';
                                      if (isKdsHidden && !opt.isSans) {
                                        textColorClass = 'text-purple-600 font-black uppercase';
                                      }

                                      return (
                                        <span 
                                          key={oIdx} 
                                          onClick={() => togglePrepared(optKey)}
                                          className={`cursor-pointer transition-all ${
                                            isHighlighted 
                                              ? 'bg-lime-400 text-black font-black px-0.5' 
                                              : textColorClass
                                          }`}
                                        >
                                          {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                          {opt.price > 0 && <span className="text-gray-400 font-normal"> (+{opt.price.toFixed(2)}€)</span>}
                                          {oIdx < grp.items.length - 1 ? ', ' : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* FOOTER STANDARD */}
                  <div className={`p-2 mt-auto flex justify-between items-center z-10 rounded-none ${getStatusFooterStyles(order.status)}`}>
                    <div className="truncate text-[10px] font-black uppercase text-white flex-1 min-w-0 pr-2">
                      {customerName} • {order.total_price?.toFixed(2)}€
                    </div>
                    {isPrete && (
                      <button onClick={(e) => { e.stopPropagation(); handleCompleteOrder(order.id); }} className="text-white hover:scale-110 active:scale-95 transition-all flex-shrink-0">
                        <CheckCircle2 size={18} strokeWidth={3} />
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