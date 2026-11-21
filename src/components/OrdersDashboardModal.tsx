// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Clock, 
  CheckCircle2, 
  Loader2, 
  CircleEllipsis, 
  Truck, 
  Phone, 
  MapPin, 
  User, 
  CreditCard, 
  Banknote, 
  MessageSquare, 
  Smartphone,
  Store,
  Receipt,
  Bell,
  Search,
  ShoppingBag,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Info,
  Printer,
  ChefHat,
  AlertTriangle
} from 'lucide-react';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { getFormattedOrderOptions, fetchOptionGroupMapping, buildReceiptPayloadFromOrder, buildKitchenReceiptPayload, flattenTicketComment } from '@/lib/orderFormatter';
import { DeliveryDispatchModal } from '@/components/DeliveryDispatchModal';
import { toast } from 'sonner';
import { ORDER_TYPE_ID } from '@/lib/orderTypes';
import { prepTimingPatch } from '@/lib/prepTiming';

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
  customer_address_complement?: string;
  address_complement?: string;
  additionalInfo?: string;
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
  return tid === ORDER_TYPE_ID.LIVRAISON || tid === '3' || tid.includes('liv');
};

const getOrderTypeDetails = (order: Order) => {
  const tid = String(order.order_type_id || '').toLowerCase();
  if (tid === ORDER_TYPE_ID.LIVRAISON || tid === '3' || tid.includes('liv')) {
    return { label: 'LIVRAISON', abbr: 'LIV', bgClass: 'bg-[#1976D2]', borderClass: 'border-blue-500', Icon: Truck };
  }
  if (tid === ORDER_TYPE_ID.EMPORTER || tid === '2' || tid.includes('emp')) {
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

const PREPARED_STORAGE_KEY = 'dashboard_prepared_items';

const OrdersDashboardModal = ({ onClose }: DashboardProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'en_cours' | 'livraisons' | 'fermees'>('en_cours');
  const [now, setNow] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | number | null>(null);
  // Clôture d'une commande NON PAYÉE : 1er toucher = avertissement, 2e toucher = clôture
  const [unpaidCloseArmedId, setUnpaidCloseArmedId] = useState<string | number | null>(null);
  useEffect(() => {
    if (unpaidCloseArmedId === null) return;
    const t = setTimeout(() => setUnpaidCloseArmedId(null), 4000);
    return () => clearTimeout(t);
  }, [unpaidCloseArmedId]);
  // Fiche client et commande en grand : fenêtres au centre de l'écran
  const [customerOrderId, setCustomerOrderId] = useState<string | number | null>(null);
  const [focusedOrderId, setFocusedOrderId] = useState<string | number | null>(null);
  // Articles cochés « prêts » : conservés sur l'appareil (survivent à la fermeture du dashboard)
  const [preparedItems, setPreparedItems] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(PREPARED_STORAGE_KEY);
      return raw ? JSON.parse(raw) || {} : {};
    } catch {
      return {};
    }
  });
  const [recalledOrderIds, setRecalledOrderIds] = useState<Record<string | number, boolean>>({});
  const [expandedClosedIds, setExpandedClosedIds] = useState<Record<string | number, boolean>>({});
  
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});
  const [kdsHiddenGroupIds, setKdsHiddenGroupIds] = useState<Set<string>>(new Set());
  const [kdsHiddenGroupNames, setKdsHiddenGroupNames] = useState<Set<string>>(new Set());

  const [colCount, setColCount] = useState(4);

  useEffect(() => {
    const updateColCount = () => {
      const w = window.innerWidth;
      // ~300 px minimum par carte pour que le bandeau (numéro, alerte, boutons) tienne sur une ligne
      if (w >= 1900) setColCount(6);
      else if (w >= 1580) setColCount(5);
      else if (w >= 1260) setColCount(4);
      else if (w >= 920) setColCount(3);
      else if (w >= 600) setColCount(2);
      else setColCount(1);
    };

    updateColCount();
    window.addEventListener('resize', updateColCount);
    return () => window.removeEventListener('resize', updateColCount);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Le menu de statut est une fenêtre plein écran : il se ferme en touchant le fond
  // (l'ancien écouteur touchstart global le fermait avant que le choix soit pris en compte)
  const toggleClosedExpanded = (orderId: string | number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedClosedIds(prev => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const openCustomerSheet = (orderId: string | number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCustomerOrderId(orderId);
  };

  const toggleFocus = (orderId: string | number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFocusedOrderId(prev => prev === orderId ? null : orderId);
  };

  const togglePrepared = (key: string) => {
    setPreparedItems(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  useEffect(() => {
    try {
      localStorage.setItem(PREPARED_STORAGE_KEY, JSON.stringify(preparedItems));
    } catch {
      // Stockage indisponible : les coches restent valables jusqu'à la fermeture
    }
  }, [preparedItems]);

  // Ménage : on oublie les coches des commandes qui ne sont plus affichées
  useEffect(() => {
    if (isLoading || orders.length === 0) return;
    const ids = new Set(orders.map(o => String(o.id)));
    setPreparedItems(prev => {
      const kept = Object.fromEntries(
        Object.entries(prev).filter(([key]) => ids.has(key.split('-item-')[0]))
      );
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
    });
  }, [orders, isLoading]);

  const getElapsedMinutes = (dateString: string) => {
    const orderDate = new Date(dateString);
    const diffMs = now.getTime() - orderDate.getTime();
    if (diffMs < 0) return 0;
    return Math.floor(diffMs / 60000);
  };

  const getTimeElapsed = (dateString: string) => {
    const diffMins = getElapsedMinutes(dateString);
    // Format court pour tenir dans le bandeau : 7m, 45m, 1h05
    if (diffMins < 60) return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h${String(mins).padStart(2, '0')}`;
  };

  // Couleur du minuteur : vert < 10 min, orange < 20 min, rouge clignotant au-delà
  const getTimerBadgeClass = (dateString: string, isClosed: boolean) => {
    if (isClosed) return 'bg-black/20 text-white/70';
    const diffMins = getElapsedMinutes(dateString);
    if (diffMins < 10) return 'bg-emerald-600 text-white';
    if (diffMins < 20) return 'bg-amber-400 text-slate-950';
    return 'bg-red-600 text-white animate-pulse';
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

    // Uniquement les commandes de CE restaurant (avant : rechargement à chaque commande de tous les restaurants)
    const restoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null)
      || localStorage.getItem('pos_restaurant_id')
      || RESTAURANT_ID;
    if (!restoId || restoId === 'undefined' || restoId === 'null') return;

    const channel = supabase
      .channel(`dashboard_orders_sync_${restoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restoId}` }, loadOrders)
      // Supabase ne filtre pas les suppressions : on les écoute à part, et on ne recharge
      // que si la commande supprimée était affichée ici
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, (payload: any) => {
        const deletedId = payload?.old?.id;
        if (deletedId == null) return;
        setOrders(prev => prev.some(o => String(o.id) === String(deletedId))
          ? prev.filter(o => String(o.id) !== String(deletedId))
          : prev);
      })
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
      // Temps de préparation : de l'arrivée jusqu'à « Prêt » (jamais jusqu'à la clôture)
      const current = orders.find(o => o.id === orderId) as any;
      // Clôturer une commande pas encaissée la fait sortir de l'écran sans paiement (absente du Z) :
      // on demande une confirmation par un 2e toucher.
      const unpaid = current && !(current.is_paid || current.payment_status === 'paid');
      if (newStatus === 'Fermé' && unpaid && unpaidCloseArmedId !== orderId) {
        setUnpaidCloseArmedId(orderId);
        toast.error(`Commande ${current.order_number || ''} NON PAYÉE : touchez encore pour clôturer quand même`);
        return;
      }
      setUnpaidCloseArmedId(null);
      const patch = { status: newStatus, ...prepTimingPatch(newStatus, current) };
      const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
      if (error) throw error;
      toast.success(`Statut : ${newStatus}`);
      setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, ...patch } : o));
      setActiveMenuOrderId(null);
      if (isOrderClosed(newStatus)) setFocusedOrderId(prev => prev === orderId ? null : prev);
    } catch {
      toast.error("Erreur lors de la mise à jour");
    }
  };

  // ── Impression (même fonctionnement que l'historique des commandes) ──
  const handlePrintClientDuplicate = async (order: Order) => {
    if (!(window as any).electronAPI) {
      toast.error("Impression non disponible sur la version Web.");
      return;
    }
    try {
      const items = parseOrderDetails(order.order_details);
      if (items.length === 0) {
        toast.error("Impossible d'imprimer : détails de commande vides.");
        return;
      }
      const payload: any = await buildReceiptPayloadFromOrder(order, optionGroupMapping, 'DUPLICATA');
      payload.comment = flattenTicketComment(order.comment || (order as any).notes || '');
      payload.customer_address_complement = order.customer_address_complement || order.address_complement || '';
      payload.customer_address = order.customer_address || (order as any).address || '';
      payload.customer_name = order.customer_name || '';
      payload.customer_phone = order.customer_phone || '';

      const result = await (window as any).electronAPI.printReceipt(payload);
      if (!result?.success) toast.error("Erreur avec l'imprimante !");
      else toast.success("Ticket caisse imprimé");
    } catch (err) {
      console.error("Erreur impression ticket caisse :", err);
      toast.error("Erreur lors de la génération du ticket");
    }
  };

  const handlePrintKitchen = async (order: Order) => {
    if (!(window as any).electronAPI) {
      toast.error("Impression non disponible sur la version Web.");
      return;
    }
    try {
      const items = parseOrderDetails(order.order_details);
      if (items.length === 0) {
        toast.error("Impossible d'imprimer : détails de commande vides.");
        return;
      }
      const orderDate = new Date(order.created_at).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      let orderType = 'SUR PLACE';
      if (order.order_type_id === ORDER_TYPE_ID.EMPORTER) orderType = 'EMPORTER';
      if (order.order_type_id === ORDER_TYPE_ID.LIVRAISON) orderType = 'LIVRAISON';

      const api = (window as any).electronAPI;
      const printerName = (api?.getSetting ? api.getSetting('imprimante_cuisine', undefined) : localStorage.getItem('imprimante_cuisine')) || undefined;
      const payload: any = buildKitchenReceiptPayload({
        orderNumber: order.order_number || String(order.id).slice(0, 4),
        orderType,
        items,
        groupMapping: optionGroupMapping,
        orderDate,
        comment: order.comment || (order as any).notes || ''
      });
      payload.comment = flattenTicketComment(order.comment || (order as any).notes || '');

      const result = await api.printReceipt(payload, printerName);
      if (!result?.success) toast.error("Erreur avec l'imprimante cuisine !");
      else toast.success("Bon cuisine imprimé");
    } catch (err) {
      console.error("Erreur impression bon cuisine :", err);
      toast.error("Erreur lors de l'impression du bon cuisine");
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

  // Affichage des terminées : les 100 plus récentes, rangées par le chiffre du numéro en ordre
  // décroissant, quelle que soit la lettre (C5, A4, B3, C2, B1…)
  const closedOrdersByNumber = useMemo(() => {
    const label = (o: Order) => String(o.order_number || '').trim();
    const digits = (o: Order) => {
      const m = label(o).match(/\d+/);
      return m ? parseInt(m[0], 10) : -1; // sans numéro : à la fin
    };
    const ts = (o: Order) => new Date((o as any).updated_at || o.created_at).getTime() || 0;
    return [...closedOrders]
      .sort((a, b) => ts(b) - ts(a))
      .slice(0, 100)
      .sort((a, b) => (digits(b) - digits(a)) || label(a).localeCompare(label(b), 'fr', { sensitivity: 'base' }));
  }, [closedOrders]);

  const displayedOrders = useMemo(() => {
    let list = activeTab === 'en_cours' ? activeOrders : closedOrdersByNumber;

    if (!searchQuery.trim()) return list;

    const q = searchQuery.trim().toLowerCase();
    return list.filter(o => {
      const num = String(o.order_number || o.id || '').toLowerCase();
      const name = String(o.customer_name || '').toLowerCase();
      const phone = String(o.customer_phone || '').toLowerCase();
      return num.includes(q) || name.includes(q) || phone.includes(q);
    });
  }, [activeTab, activeOrders, closedOrdersByNumber, searchQuery]);

  const columns = useMemo(() => {
    const cols: Order[][] = Array.from({ length: colCount }, () => []);
    displayedOrders.forEach((order, idx) => {
      cols[idx % colCount].push(order);
    });
    return cols;
  }, [displayedOrders, colCount]);


  const renderOrderCard = (order: Order, inFocus: boolean = false) => {
                const customerName = order.customer_name || "Client Caisse";
                const customerPhone = order.customer_phone || "";
                const customerAddress = order.customer_address || "";
                const addressComplement = order.customer_address_complement || order.address_complement || order.additionalInfo || "";
                const orderComment = order.comment || order.notes || "";
                const isPaid = order.is_paid || order.payment_status === 'paid';
                const items = parseOrderDetails(order.order_details);
                const isCustomerOpen = customerOrderId === order.id;
                const isClosed = isOrderClosed(order.status);
                const isRecalled = !!recalledOrderIds[order.id];
                // Onglet Terminées : seul le bandeau coloré est affiché, un toucher déplie la commande
                const isCollapsed = isClosed && !inFocus && !expandedClosedIds[order.id];

                const typeInfo = getOrderTypeDetails(order);
                const TypeIcon = typeInfo.Icon;
                const nextStatusAction = getNextStatusAction(order.status);

                const orderNum = (order.order_number && String(order.order_number).toLowerCase() !== 'nan' && String(order.order_number).trim() !== '')
                  ? String(order.order_number).trim()
                  : `#${String(order.id).slice(-3)}`;

                return (
                  <div 
                    key={order.id} 
                    className={`bg-slate-900 border-2 flex flex-col h-auto overflow-visible rounded-none shadow-md relative transition-all ${
                      focusedOrderId === order.id && !inFocus ? 'border-amber-400' : 'border-slate-700'
                    }`}
                  >
                    
                    {/* EN-TÊTE DU TICKET */}
                    <div 
                      onClick={isClosed ? (e) => toggleClosedExpanded(order.id, e) : undefined}
                      className={`${typeInfo.bgClass} px-2 py-1.5 border-b border-black/30 text-white flex justify-between items-center w-full min-w-0 flex-shrink-0 relative select-none gap-1 ${isClosed ? 'cursor-pointer min-h-[48px]' : ''}`}
                    >
                      {/* Côté gauche : numéro et alerte non payé, sur toute la hauteur du bandeau */}
                      <div className="flex items-stretch gap-0.5 shrink-0 self-stretch -my-1.5 -ml-2 min-w-0">
                        <h3 
                          onClick={(e) => toggleFocus(order.id, e)}
                          className="min-h-[44px] px-2 flex items-center gap-1.5 text-xl font-black text-white leading-none cursor-pointer tracking-tight shrink-0 active:bg-white/20"
                          title={`${typeInfo.label} — toucher pour ${inFocus ? 'fermer' : 'voir la commande en grand'}`}
                        >
                          <TypeIcon size={16} className="opacity-80" aria-label={typeInfo.label} />
                          {orderNum}
                        </h3>
                        {!isPaid && (
                          <span
                            className="min-w-[44px] flex items-center justify-center bg-red-600 text-white border-x-2 border-white/70 shrink-0 animate-pulse"
                            title="Non payé"
                            aria-label="Non payé"
                            role="img"
                          >
                            <Banknote size={24} strokeWidth={2.5} />
                          </span>
                        )}
                      </div>

                      <div className="flex items-stretch gap-0.5 shrink-0 self-stretch -my-1.5 -mr-2">
                        <button
                          type="button"
                          onClick={(e) => openCustomerSheet(order.id, e)}
                          className={`min-w-[40px] min-h-[44px] flex items-center justify-center transition-all active:scale-95 ${
                            isCustomerOpen ? 'bg-amber-400 text-slate-950 shadow' : 'text-white hover:bg-white/20 active:bg-white/30'
                          }`}
                          title="Fiche client"
                          aria-label="Fiche client"
                        >
                          <User size={22} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => handleRecallOrder(order.id, e)}
                          className={`min-w-[40px] min-h-[44px] flex items-center justify-center transition-all active:scale-95 ${
                            isRecalled 
                              ? 'bg-amber-400 text-slate-950 animate-pulse ring-2 ring-inset ring-amber-300' 
                              : 'text-white hover:bg-amber-500 hover:text-slate-950 active:bg-white/30'
                          }`}
                          title="Faire sonner la commande"
                          aria-label="Faire sonner la commande"
                        >
                          <Bell size={22} />
                        </button>

                        {/* Minuteur bord à bord, couleur selon l'attente */}
                        <div
                          className={`min-w-[48px] px-1 flex items-center justify-center text-lg font-black leading-none tabular-nums shrink-0 transition-colors ${getTimerBadgeClass(order.created_at, isClosed)}`}
                          title="Temps écoulé depuis la commande"
                        >
                          {getTimeElapsed(order.created_at)}
                        </div>

                        <button 
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setActiveMenuOrderId(order.id); }} 
                          className="min-w-[50px] min-h-[44px] text-white hover:bg-white/20 active:bg-white/30 active:scale-95 transition-all flex items-center justify-center"
                          title="Statut et impression"
                          aria-label="Changer le statut ou imprimer"
                        >
                          <CircleEllipsis size={28} strokeWidth={2.25} />
                        </button>

                        {isClosed && !inFocus && (
                          <span className="text-white/80 flex items-center pr-1" aria-hidden>
                            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                          </span>
                        )}
                      </div>
                    </div>

                    {!isCollapsed && (<>
                    {/* CORPS DU TICKET */}
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

                        {/* 🟢 BANDEAU NOTE / COMMENTAIRE VISIBLE DIRECTEMENT SOUS LES ARTICLES */}
                        {orderComment && (
                          <div className="mt-2 p-2 bg-amber-300 border-2 border-amber-600 text-slate-950 font-black text-[11px] uppercase flex items-start gap-1.5 shadow-sm">
                            <MessageSquare size={14} className="text-amber-900 shrink-0 mt-0.5" />
                            <span className="leading-tight">NOTE : {orderComment}</span>
                          </div>
                        )}
                      </div>

                    {/* PIED DU TICKET */}
                    <div className={`flex flex-col z-10 flex-shrink-0 ${getStatusFooterStyles(order.status)}`}>
                      <div className="px-2 py-1.5 truncate text-[11px] font-black uppercase text-white min-w-0 leading-tight">
                        {customerName} <span className="opacity-70">•</span> {order.total_price?.toFixed(2)} €
                      </div>

                      {/* Action principale : un seul gros bouton sur toute la largeur */}
                      {nextStatusAction && (
                        <button 
                          type="button"
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            handleUpdateStatus(order.id, nextStatusAction.next); 
                          }} 
                          className={`w-full h-12 rounded-none text-base font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 border-t border-black/20 active:brightness-90 ${nextStatusAction.next === 'Fermé' && unpaidCloseArmedId === order.id ? 'bg-red-600 text-white' : nextStatusAction.bgClass}`}
                          title={`Passer à : ${nextStatusAction.next}`}
                        >
                          {nextStatusAction.next === 'Fermé' && unpaidCloseArmedId === order.id ? (
                            <>
                              <AlertTriangle size={22} strokeWidth={3} />
                              <span>NON PAYÉE · CONFIRMER</span>
                            </>
                          ) : nextStatusAction.next === 'Fermé' ? (
                            <>
                              <CheckCircle2 size={22} strokeWidth={3} />
                              <span>CLÔTURER</span>
                            </>
                          ) : (
                            <>
                              <span>{nextStatusAction.label}</span>
                              <ChevronRight size={22} strokeWidth={3} />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    </>)}

                  </div>
                );
  };

  const statusMenuOrder = orders.find(o => o.id === activeMenuOrderId) || null;
  const focusedOrder = orders.find(o => o.id === focusedOrderId) || null;
  const customerOrder = orders.find(o => o.id === customerOrderId) || null;

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

      {/* ZONE PRINCIPALE */}
      <div className="flex-1 overflow-hidden bg-[#0f172a] relative">
        {activeTab === 'livraisons' ? (
          <DeliveryDispatchModal searchQuery={searchQuery} />
        ) : (
          <div className="h-full overflow-y-auto p-2 custom-scrollbar">
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
            ) : activeTab === 'fermees' ? (
              <div className="grid gap-2 items-start pb-6" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                {displayedOrders.map(o => renderOrderCard(o))}
              </div>
            ) : (
              <div className="flex gap-2 items-start pb-6">
                {columns.map((colOrders, colIdx) => (
                  <div key={colIdx} className="flex-1 flex flex-col gap-2 min-w-0">
                    {colOrders.map(o => renderOrderCard(o))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* COMMANDE EN GRAND : la même carte, agrandie au centre de l'écran */}
      {focusedOrder && (
        <div
          className="fixed inset-0 z-[100000] bg-black/75 flex items-center justify-center p-4"
          onClick={() => setFocusedOrderId(null)}
        >
          <div
            className="w-[380px] max-w-[60vw] max-h-[58vh] overflow-y-auto custom-scrollbar shadow-2xl"
            style={{ zoom: 1.6 }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderOrderCard(focusedOrder, true)}
          </div>
        </div>
      )}

      {/* FICHE CLIENT */}
      {customerOrder && (() => {
        const typeInfo = getOrderTypeDetails(customerOrder);
        const phone = customerOrder.customer_phone || '';
        const address = customerOrder.customer_address || '';
        const complement = customerOrder.customer_address_complement || customerOrder.address_complement || customerOrder.additionalInfo || '';
        const note = customerOrder.comment || (customerOrder as any).notes || '';
        const method = customerOrder.payment_method || 'Caisse';
        const isCard = /carte|cb/i.test(method);
        const isPaid = customerOrder.is_paid || customerOrder.payment_status === 'paid';
        const num = (customerOrder.order_number && String(customerOrder.order_number).trim()) || `#${String(customerOrder.id).slice(-3)}`;
        return (
          <div
            className="fixed inset-0 z-[100001] bg-black/70 flex items-center justify-center p-4"
            onClick={() => setCustomerOrderId(null)}
          >
            <div
              className="bg-white text-slate-900 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`${typeInfo.bgClass} text-white px-5 py-3 flex items-center justify-between`}>
                <div className="flex items-center gap-2 text-2xl font-black">
                  <typeInfo.Icon size={22} /> {num}
                  <span className="text-sm font-bold opacity-80 ml-1">{typeInfo.label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerOrderId(null)}
                  className="w-12 h-12 -mr-3 flex items-center justify-center active:bg-white/20"
                  aria-label="Fermer"
                >
                  <X size={26} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <div className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5"><User size={14} /> Client</div>
                  <div className="text-2xl font-black">{customerOrder.customer_name || 'Client Caisse'}</div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5"><Phone size={14} /> Téléphone</div>
                  {phone
                    ? <a href={`tel:${phone}`} className="text-2xl font-black text-emerald-700 tracking-wide">{phone}</a>
                    : <div className="text-lg italic text-slate-400">Non renseigné</div>}
                </div>

                {address && (
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5"><MapPin size={14} /> Adresse de livraison</div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xl font-bold text-blue-700 leading-snug block"
                    >
                      {address}
                    </a>
                    {complement && (
                      <div className="mt-2 px-3 py-2 bg-amber-100 border-l-4 border-amber-500 text-lg font-black text-amber-900">
                        {complement}
                      </div>
                    )}
                  </div>
                )}

                {note && (
                  <div className="px-3 py-2 bg-amber-300 border-2 border-amber-600 text-slate-950 font-black text-lg uppercase flex items-start gap-2">
                    <MessageSquare size={20} className="shrink-0 mt-0.5" /> {note}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200">
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-500">Paiement</div>
                    <div className="font-black text-base flex items-center gap-1.5 uppercase">
                      {isCard ? <CreditCard size={18} className="text-blue-600" /> : <Banknote size={18} className="text-emerald-600" />}
                      <span className="truncate">{method}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-500">Origine</div>
                    <div className="font-black text-base flex items-center gap-1.5 uppercase">
                      {customerOrder.order_origin === 'app' ? <Smartphone size={18} className="text-purple-600" /> : <Store size={18} className="text-amber-600" />}
                      {customerOrder.order_origin || 'Caisse'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-500">Total</div>
                    <div className="font-black text-xl">{customerOrder.total_price?.toFixed(2)} €</div>
                    {!isPaid && <div className="text-xs font-black uppercase text-red-600">Non payé</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {statusMenuOrder && (
        <div
          className="fixed inset-0 z-[100002] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setActiveMenuOrderId(null)}
        >
          <div
            className="bg-white w-full max-w-sm shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`${getOrderTypeDetails(statusMenuOrder).bgClass} text-white px-4 py-3 font-black text-lg uppercase flex items-center justify-between`}>
              <span>
                {(statusMenuOrder.order_number && String(statusMenuOrder.order_number).trim()) || `#${String(statusMenuOrder.id).slice(-3)}`}
              </span>
              <button
                type="button"
                onClick={() => setActiveMenuOrderId(null)}
                className="w-11 h-11 -mr-2 flex items-center justify-center bg-black/25 active:scale-95"
                aria-label="Fermer"
              >
                <X size={22} />
              </button>
            </div>
            {/* Impression : mêmes icônes que l'historique des commandes */}
            <div className="grid grid-cols-2 border-b-4 border-slate-200">
              <button
                type="button"
                onClick={() => handlePrintClientDuplicate(statusMenuOrder)}
                className="h-20 flex items-center justify-center text-blue-600 border-r border-slate-200 active:bg-blue-50"
                title="Imprimer le ticket caisse"
                aria-label="Imprimer le ticket caisse"
              >
                <Printer size={34} />
              </button>
              <button
                type="button"
                onClick={() => handlePrintKitchen(statusMenuOrder)}
                className="h-20 flex items-center justify-center text-orange-600 active:bg-orange-50"
                title="Imprimer le bon cuisine"
                aria-label="Imprimer le bon cuisine"
              >
                <ChefHat size={34} />
              </button>
            </div>
            {['Nouvelle', 'En cours', 'Prêt', 'Fermé'].map(st => {
              const isCurrent = String(statusMenuOrder.status || '').toLowerCase() === st.toLowerCase();
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleUpdateStatus(statusMenuOrder.id, st)}
                  className={`h-16 px-5 text-left text-lg font-black uppercase tracking-wide border-b border-gray-200 last:border-0 flex items-center justify-between active:bg-slate-200 ${
                    isCurrent ? 'bg-slate-900 text-white' : 'text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {st}
                  {isCurrent && <CheckCircle2 size={22} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

    </div>,
    document.body
  );
};

export default OrdersDashboardModal;