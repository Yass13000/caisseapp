// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { 
  Calendar, 
  Clock, 
  X, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight, 
  Printer, 
  ChefHat,
  Layers,
  Banknote,
  Ban,
  Gift,
  Tag,
  ArrowUpDown,
  MessageSquare,
  MapPin,
  Info
} from 'lucide-react';
import { toast } from 'sonner';
import { getFormattedOrderOptions, fetchOptionGroupMapping, buildReceiptPayloadFromOrder, buildKitchenReceiptPayload, flattenTicketComment } from '@/lib/orderFormatter';
import { ORDER_TYPE_ID } from '@/lib/orderTypes';
import { MaskIcon } from '@/components/MaskIcon';

interface OrderHistoryModalProps {
  onClose: () => void;
  restaurantName?: string; 
}

const TYPE_ICONS: Record<string, string> = {
  'Sur place': 'SVG/SP.svg',
  'À emporter': 'SVG/EMP.svg',
  'Livraison': 'SVG/liv.svg'
};

// Abréviations affichées dans la liste des commandes
const TYPE_ABBR: Record<string, string> = {
  'Sur place': 'SP',
  'À emporter': 'EMP',
  'Livraison': 'LIV'
};

const ORIGIN_ICONS: Record<string, string> = {
  'Borne': 'SVG/BORNE.svg',
  'App': 'cmd.svg',
  'Caisse': 'SVG/comptoir.svg'
};

const getItemTotal = (item: any, groupMapping: Record<string, string> = {}) => {
  if (!item) return 0;
  if (item.isReward) return 0;

  if (item.total_price !== undefined && item.total_price !== null && !isNaN(Number(item.total_price))) {
    return Number(item.total_price);
  }
  if (item.total !== undefined && item.total !== null && !isNaN(Number(item.total))) {
    return Number(item.total);
  }

  const basePrice = parseFloat(item.product?.base_price ?? item.base_price ?? item.product?.price ?? item.price ?? 0);
  const groups = getFormattedOrderOptions(item, groupMapping);
  const optsPrice = groups.flatMap(g => g.items).reduce((sum, o) => sum + (Number(o.price) || 0), 0);

  return (basePrice + optsPrice) * (item.quantity || 1);
};

const OrderHistoryModal = ({ onClose, restaurantName = "VOTRE RESTAURANT" }: OrderHistoryModalProps) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | number | null>(null);
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});
  const [orderTypesMap, setOrderTypesMap] = useState<Record<string, string>>({});

  // Filtres
  const [selectedOrderType, setSelectedOrderType] = useState<string>('all');
  const [selectedOrigin, setSelectedOrigin] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const getLocalToday = () => {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    return new Date(today.getTime() - offset).toISOString().split('T')[0];
  };

  const [filterDate, setFilterDate] = useState(getLocalToday());
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // --- CHARGEMENT DE LA TABLE ORDER_TYPE ---
  useEffect(() => {
    const fetchOrderTypes = async () => {
      try {
        const { data } = await supabase.from('order_type').select('id, name');
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((t: any) => { map[t.id] = t.name; });
          setOrderTypesMap(map);
        }
      } catch (e) {
        console.error("Erreur chargement types de commande :", e);
      }
    };
    fetchOrderTypes();
  }, []);

  // --- EXTRACTION SÉCURISÉE DES ITEMS ---
  const extractItemsSafely = (detailsRaw: any) => {
    try {
      let parsed = typeof detailsRaw === 'string' ? JSON.parse(detailsRaw) : detailsRaw;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      if (parsed && parsed.cart && Array.isArray(parsed.cart.items)) return parsed.cart.items;
      if (parsed && parsed.cart && Array.isArray(parsed.cart)) return parsed.cart;
      if (parsed) return [parsed];
      return [];
    } catch { 
      return []; 
    }
  };

  // Helpers de normalisation
  const getOrderType = useCallback((order: any) => {
    if (order.order_type_id && orderTypesMap[order.order_type_id]) {
      const name = orderTypesMap[order.order_type_id];
      const nLower = name.toLowerCase();
      if (nLower.includes('livraison')) return 'Livraison';
      if (nLower.includes('emporter') || nLower.includes('collect')) return 'À emporter';
      if (nLower.includes('place')) return 'Sur place';
      return name;
    }
    const raw = (order.order_type || '').toLowerCase();
    if (raw.includes('livraison')) return 'Livraison';
    if (raw.includes('emporter') || raw.includes('collect')) return 'À emporter';
    if (raw.includes('place')) return 'Sur place';
    
    if (order.order_type_id === ORDER_TYPE_ID.EMPORTER) return 'À emporter';
    if (order.order_type_id === ORDER_TYPE_ID.LIVRAISON) return 'Livraison';
    return 'Sur place';
  }, [orderTypesMap]);

  const isCancelledOrder = (order: any) => String(order?.status || '').toLowerCase().startsWith('annul');

  const getOrderOrigin = useCallback((order: any) => {
    const orig = (order.order_origin || 'Caisse').toLowerCase();
    if (orig === 'borne') return 'Borne';
    if (orig === 'app') return 'App';
    return 'Caisse';
  }, []);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const activeRestoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
        || localStorage.getItem('pos_restaurant_id') 
        || RESTAURANT_ID;
      
      if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') {
        toast.error("Veuillez configurer la caisse (identifiant manquant)");
        setIsLoading(false);
        return;
      }
      
      const [year, month, day] = filterDate.split('-').map(Number);
      const startOfDayLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
      const endOfDayLocal = new Date(year, month - 1, day, 23, 59, 59, 999);

      const startOfDay = startOfDayLocal.toISOString();
      const endOfDay = endOfDayLocal.toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', activeRestoId)
        // Commandes encaissées + commandes annulées (consignées, jamais supprimées)
        .or('is_paid.eq.true,status.eq.Annulée')
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)
        .order('created_at', { ascending: sortOrder === 'asc' });

      if (error) throw error;
      setOrders(data || []);
    } catch {
      toast.error("Erreur lors du chargement de l'historique");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadMapping = async () => {
      if (orders.length === 0) return;

      const activeRestoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
        || localStorage.getItem('pos_restaurant_id') 
        || RESTAURANT_ID;

      const allItems = orders.flatMap(o => extractItemsSafely(o.order_details));
      const mapping = await fetchOptionGroupMapping(allItems, activeRestoId);
      setOptionGroupMapping(mapping);
    };

    loadMapping();
  }, [orders]);

  useEffect(() => {
    fetchHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDate, sortOrder]);

  const availableTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      const t = getOrderType(o);
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [orders, getOrderType]);

  const availableOriginCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      const orig = getOrderOrigin(o);
      counts[orig] = (counts[orig] || 0) + 1;
    });
    return counts;
  }, [orders, getOrderOrigin]);

  useEffect(() => {
    if (selectedOrderType !== 'all' && !availableTypeCounts[selectedOrderType]) {
      setSelectedOrderType('all');
    }
    if (selectedOrigin !== 'all' && !availableOriginCounts[selectedOrigin]) {
      setSelectedOrigin('all');
    }
  }, [availableTypeCounts, availableOriginCounts, selectedOrderType, selectedOrigin]);

  // Recherche sans accents ni majuscules : « creme » trouve « Crème »
  const normalizeSearch = (v: any) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const filteredOrders = useMemo(() => {
    const q = normalizeSearch(searchQuery.trim());
    return orders.filter(order => {
      if (selectedOrderType !== 'all' && getOrderType(order) !== selectedOrderType) {
        return false;
      }
      if (selectedOrigin !== 'all' && getOrderOrigin(order) !== selectedOrigin) {
        return false;
      }
      if (!q) return true;

      // Numéro, client, téléphone
      if ([order.order_number, order.id, order.customer_name, order.customer_phone, order.coupon_title].some(v => normalizeSearch(v).includes(q))) {
        return true;
      }
      // Produits et options de la commande
      const items = extractItemsSafely(order.order_details) || [];
      return items.some((item: any) => {
        const names = [item?.product?.name, item?.name];
        const opts = [item?.selectedSubOptions, item?.flatOptions, item?.options, item?.selections];
        opts.forEach(list => Array.isArray(list) && list.forEach((o: any) => names.push(typeof o === 'string' ? o : o?.name)));
        return names.some(n => normalizeSearch(n).includes(q));
      });
    });
  }, [orders, selectedOrderType, selectedOrigin, getOrderType, getOrderOrigin, searchQuery]);

  const changeDay = (days: number) => {
    const [year, month, day] = filterDate.split('-').map(Number);
    const date = new Date(year, month - 1, day + days);
    const newDateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    
    const localToday = getLocalToday();
    if (newDateString > localToday) return;

    setFilterDate(newDateString);
    setExpandedOrderId(null);
  };

  const getFormattedDateLabel = () => {
    const localToday = getLocalToday();
    if (filterDate === localToday) return "Aujourd'hui";
    
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const yesterday = new Date(today.getTime() - offset - 86400000).toISOString().split('T')[0];
    
    if (filterDate === yesterday) return "Hier";
    
    const [year, month, day] = filterDate.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    return targetDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const toggleExpand = (id: string | number) => {
    setExpandedOrderId(prev => prev === id ? null : id);
  };

  // Glisser pour défiler (écrans tactiles qui envoient des événements souris)
  // et ne jamais déplier une commande à la fin d'un glissement
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startY: 0, startTop: 0, moved: false });
  const DRAG_THRESHOLD = 8;

  const onListPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { active: true, startY: e.clientY, startTop: scrollRef.current?.scrollTop || 0, moved: false };
  };

  const onListPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) > DRAG_THRESHOLD) d.moved = true;
    // Le tactile natif défile tout seul ; on ne pilote le défilement que pour la souris / le stylet
    if (d.moved && e.pointerType !== 'touch' && scrollRef.current) {
      scrollRef.current.scrollTop = d.startTop - dy;
    }
  };

  const onListPointerEnd = () => { dragRef.current.active = false; };

  const onListClickCapture = (e: React.MouseEvent) => {
    if (dragRef.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current.moved = false;
    }
  };

  const getPaymentMethodLabel = (method: string) => {
    if (!method) return 'N/A';
    const m = method.toLowerCase();
    if (m === 'counter' || m === 'espèces' || m === 'especes') return 'Espèces';
    if (m === 'card' || m === 'carte bancaire' || m === 'cb') return 'Carte Bancaire';
    return method;
  };

  // --- ICÔNES ASSOCIÉES (SVG maison) ---
  const renderTypeIcon = (type: string, size = 22) =>
    TYPE_ICONS[type] ? <MaskIcon src={TYPE_ICONS[type]} size={size} title={type} /> : <Layers size={size} aria-label={type} />;

  const renderOriginIcon = (origin: string, size = 22) =>
    <MaskIcon src={ORIGIN_ICONS[origin] || ORIGIN_ICONS.Caisse} size={size} title={origin} />;

  // Carte = sans contact, espèces = billet, fractionné = les deux
  const renderPaymentIcons = (method: string) => {
    const m = String(method || '').toLowerCase();
    const label = getPaymentMethodLabel(method);
    if (m.includes('attente') || m === 'pending') return <Clock size={22} className="text-amber-500" aria-label={label} />;
    if (m.startsWith('offert')) return <Gift size={22} className="text-violet-600" aria-label={method} title={method} />;
    const hasCard = /carte|cb|card/.test(m);
    const hasCash = /esp|cash|counter/.test(m) || (!hasCard && !m.includes('fraction'));
    return (
      <span className="flex items-center gap-2" title={label} aria-label={label}>
        {hasCard && <MaskIcon src="SVG/ttp.svg" size={30} className="text-blue-600" />}
        {hasCash && <Banknote size={24} className="text-emerald-600" />}
      </span>
    );
  };

  // 🟢 IMPRESSION DUPLICATA TICKET CLIENT (AVEC COMMENTAIRE & COMPLÉMENT)
  const handlePrintPastOrder = async (order: any) => {
    if (!window.electronAPI) {
      toast.error("Impression non disponible sur la version Web.");
      return;
    }

    try {
      const items = extractItemsSafely(order.order_details);
      if (!items || items.length === 0) {
        toast.error("Impossible d'imprimer : détails de commande vides.");
        return;
      }

      const orderPayloadData = await buildReceiptPayloadFromOrder(order, optionGroupMapping, 'DUPLICATA');
      
      orderPayloadData.comment = flattenTicketComment(order.comment || order.notes || '');
      orderPayloadData.customer_address_complement = order.customer_address_complement || order.address_complement || '';
      orderPayloadData.customer_address = order.customer_address || order.address || '';
      orderPayloadData.customer_name = order.customer_name || '';
      orderPayloadData.customer_phone = order.customer_phone || '';

      const result = await (window as any).electronAPI.printReceipt(orderPayloadData);
      if (!result.success) toast.error("Erreur avec l'imprimante !");
      else toast.success("Duplicata imprimé");
    } catch (err) {
      console.error("Erreur impression historique :", err);
      toast.error("Erreur lors de la génération du ticket");
    }
  };

  // 🟢 IMPRESSION BON CUISINE HISTORIQUE ÉPURÉE (SANS COORDONNÉES CLIENT)
  const handlePrintKitchenOrder = async (order: any) => {
    if (!(window as any).electronAPI) return;

    try {
      const items = extractItemsSafely(order.order_details);
      if (!items || items.length === 0) {
        toast.error("Impossible d'imprimer : détails de commande vides.");
        return;
      }

      const date = new Date(order.created_at).toLocaleString('fr-FR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      const orderNumber = order.order_number || order.id.toString().slice(0, 4);
      
      let orderType = 'SUR PLACE';
      if (order.order_type_id === ORDER_TYPE_ID.EMPORTER) orderType = 'EMPORTER';
      if (order.order_type_id === ORDER_TYPE_ID.LIVRAISON) orderType = 'LIVRAISON';

      const printerName = ((window as any).electronAPI?.getSetting ? (window as any).electronAPI.getSetting('imprimante_cuisine', undefined) : localStorage.getItem('imprimante_cuisine')) || undefined;
      const kitchenPayload = buildKitchenReceiptPayload({
        orderNumber,
        orderType,
        items,
        groupMapping: optionGroupMapping,
        orderDate: date,
        comment: order.comment || order.notes || ''
      });

      kitchenPayload.comment = flattenTicketComment(order.comment || order.notes || '');

      const result = await (window as any).electronAPI.printReceipt(kitchenPayload, printerName);
      if (!result.success) toast.error("Erreur avec l'imprimante cuisine !");
      else toast.success("Bon cuisine imprimé");
    } catch (err) {
      console.error("Erreur impression cuisine historique :", err);
      toast.error("Erreur lors de l'impression du bon cuisine");
    }
  };

  const renderOrderDetails = (detailsRaw: any, order?: any) => {
    try {
      const items = extractItemsSafely(detailsRaw);
      if (!items || items.length === 0) return <p className="text-gray-400 italic">Aucun détail disponible</p>;

      const orderComment = order?.comment || order?.notes || '';
      const orderAddress = order?.customer_address || '';
      const orderComplement = order?.customer_address_complement || order?.address_complement || '';

      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
          
          {/* INFORMATIONS ADRESSE & COMPLÉMENT (SI LIVRAISON) */}
          {(orderAddress || orderComplement) && (
            <div className="bg-white border border-gray-200 p-2.5 rounded-lg text-xs space-y-1">
              {orderAddress && (
                <div className="font-bold text-gray-700 flex items-start gap-1.5">
                  <MapPin size={13} className="text-red-500 shrink-0 mt-0.5" />
                  <span>{orderAddress}</span>
                </div>
              )}
              {orderComplement && (
                <div className="font-bold text-amber-700 flex items-start gap-1.5 pl-5">
                  <Info size={12} className="text-amber-500 shrink-0 mt-0.5" />
                  <span>{orderComplement}</span>
                </div>
              )}
            </div>
          )}

          {/* COMMENTAIRE / NOTE CLIENT */}
          {orderComment && (
            <div className="p-2.5 bg-amber-50 border-2 border-amber-300 rounded-lg text-slate-950 font-black text-xs uppercase flex items-start gap-1.5 shadow-sm">
              <MessageSquare size={14} className="text-amber-700 shrink-0 mt-0.5" />
              <span>{orderComment}</span>
            </div>
          )}

          <div>
            <ul className="space-y-3">
              {items.map((item: any, idx: number) => {
                const productName = item.product?.name || item.name || 'Produit inconnu';
                const qty = item.quantity || 1;
                const itemTotal = getItemTotal(item, optionGroupMapping);
                const optionGroups = getFormattedOrderOptions(item, optionGroupMapping); 
                
                return (
                  <li key={idx} className="flex flex-col border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                    <div className="flex justify-between items-start text-sm w-full">
                      <div className="font-bold text-gray-700">
                        <span className="text-primary mr-2">{qty}x</span>
                        {productName}
                      </div>
                      <div className="font-black text-secondary">
                        {itemTotal.toFixed(2)} €
                      </div>
                    </div>
                    
                    {optionGroups.length > 0 && (
                      <div className="pl-6 mt-1 space-y-1">
                        {optionGroups.map((grp, gIdx) => (
                          <div key={gIdx} className="flex flex-wrap items-baseline gap-1 text-xs text-gray-500">
                            {grp.groupName ? (
                              <span className="font-bold text-secondary uppercase text-[10px]">{grp.groupName} :</span>
                            ) : null}
                            {grp.items.map((opt, oIdx) => (
                              <span key={oIdx} className="inline">
                                <span className={opt.isSans ? "text-red-500 font-bold" : "font-medium"}>
                                  {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                </span>
                                {opt.price > 0 && <span> (+{opt.price.toFixed(2)} €)</span>}
                                {oIdx < grp.items.length - 1 ? ', ' : ''}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

        </div>
      );
    } catch {
      return <p className="text-red-500 text-sm">Détails illisibles</p>;
    }
  };

  const isToday = filterDate === getLocalToday();

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-0 xl:p-4 font-helvetica select-none">
      <div className="bg-[#F3F4F6] w-full h-full max-w-[1440px] xl:max-h-[900px] rounded-none xl:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* EN-TÊTE PRINCIPAL MODERNISÉ */}
        <div className="bg-white border-b border-gray-200 px-2 py-1.5 flex flex-wrap items-center gap-2 flex-shrink-0">
          
          {/* LIGNE SUPÉRIEURE : TITRE, DATE, TRI ET FERMETURE */}
          <div className="contents">
            <div className="flex items-center gap-2">
              {/* SÉLECTEUR DE DATE */}
              <div className="flex items-center bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                <button 
                  onClick={() => changeDay(-1)} 
                  className="p-1.5 hover:bg-white rounded-lg transition-all active:scale-95 text-gray-600 hover:shadow-sm"
                  title="Jour précédent"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                <div className="flex items-center gap-1.5 px-2 justify-center min-w-[110px]">
                  <Calendar className="text-primary w-3.5 h-3.5" />
                  <span className="font-bold text-secondary text-xs capitalize">
                    {getFormattedDateLabel()}
                  </span>
                </div>

                <button 
                  onClick={() => !isToday && changeDay(1)} 
                  disabled={isToday}
                  className={`p-1.5 rounded-lg transition-all ${isToday ? 'opacity-25 cursor-not-allowed' : 'hover:bg-white hover:shadow-sm active:scale-95 text-gray-600'}`}
                  title="Jour suivant"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* BOUTON TRI CHRONOLOGIQUE */}
              <button 
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className={`w-9 h-9 flex items-center justify-center rounded-xl border transition-all active:scale-95 ${
                  sortOrder === 'desc' 
                    ? 'bg-white border-gray-200 text-secondary' 
                    : 'bg-primary/10 border-primary/30 text-primary'
                }`}
                title={sortOrder === 'desc' ? 'Plus récents en premier' : 'Plus anciens en premier'}
                aria-label="Inverser le tri"
              >
                <ArrowUpDown className={`w-4 h-4 transition-transform ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-2 order-last flex-1 justify-end min-w-[150px]">
            {/* RECHERCHE : n° de commande, nom, téléphone ou produit */}
            <div className="relative flex items-center w-full max-w-[16rem] min-w-0">
              <Search size={16} className="absolute left-3 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher"
                className="w-full h-9 pl-9 pr-9 bg-gray-100 border border-gray-200 focus:border-primary focus:bg-white rounded-xl text-sm font-bold text-secondary placeholder:text-gray-400 outline-none transition-colors"
                style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-secondary"
                  aria-label="Effacer la recherche"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button 
              onClick={onClose} 
              className="w-9 h-9 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white rounded-xl flex items-center justify-center font-black transition-all active:scale-90"
              title="Fermer la fenêtre"
            >
              <X size={20} />
            </button>
            </div>
          </div>

          {/* LIGNE INFÉRIEURE : BARRE DE NAVIGATION PAR ICÔNES */}
          <div className="contents">
            
            {/* SEGMENT 1 : TYPES DE COMMANDE */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedOrderType('all')}
                  title="Tous"
                  className={`h-10 flex items-center gap-1.5 px-3 rounded-lg transition-all active:scale-95 ${
                    selectedOrderType === 'all'
                      ? 'bg-primary text-white shadow-md'
                      : 'text-gray-400 hover:text-gray-700 hover:bg-white/50'
                  }`}
                >
                  <Layers size={20} />
                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                    selectedOrderType === 'all' ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {orders.length}
                  </span>
                </button>

                {Object.entries(availableTypeCounts).map(([type, count]) => {
                  const isSelected = selectedOrderType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSelectedOrderType(type)}
                      title={type}
                      className={`h-10 flex items-center gap-1.5 px-3 rounded-lg transition-all active:scale-95 ${
                        isSelected
                          ? 'bg-primary text-white shadow-md'
                          : 'text-gray-400 hover:text-gray-700 hover:bg-white/50'
                      }`}
                    >
                      {renderTypeIcon(type, 28)}
                      <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                        isSelected ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SEGMENT 2 : CANAUX / ORIGINES */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedOrigin('all')}
                  title="Tous"
                  className={`h-10 flex items-center gap-1.5 px-3 rounded-lg transition-all active:scale-95 ${
                    selectedOrigin === 'all'
                      ? 'bg-secondary text-white shadow-md'
                      : 'text-gray-400 hover:text-gray-700 hover:bg-white/50'
                  }`}
                >
                  <Layers size={20} />
                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                    selectedOrigin === 'all' ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {orders.length}
                  </span>
                </button>

                {Object.entries(availableOriginCounts).map(([orig, count]) => {
                  const isSelected = selectedOrigin === orig;
                  return (
                    <button
                      key={orig}
                      type="button"
                      onClick={() => setSelectedOrigin(orig)}
                      title={orig}
                      className={`h-10 flex items-center gap-1.5 px-3 rounded-lg transition-all active:scale-95 ${
                        isSelected
                          ? 'bg-secondary text-white shadow-md'
                          : 'text-gray-400 hover:text-gray-700 hover:bg-white/50'
                      }`}
                    >
                      {renderOriginIcon(orig, 30)}
                      <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                        isSelected ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* CONTENU PRINCIPAL */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-2 custom-scrollbar"
          onPointerDown={onListPointerDown}
          onPointerMove={onListPointerMove}
          onPointerUp={onListPointerEnd}
          onPointerCancel={onListPointerEnd}
          onPointerLeave={onListPointerEnd}
          onClickCapture={onListClickCapture}
        >
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
              <p className="text-gray-400 font-bold text-base">Recherche des tickets...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Search size={60} className="mb-4 opacity-20" />
              <p className="text-lg font-bold">
                {orders.length === 0 ? 'Aucune vente' : 'Aucun résultat'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <tbody className="divide-y divide-gray-100">
                  {filteredOrders.map((order) => (
                    <React.Fragment key={order.id}>
                      <tr 
                        onClick={() => toggleExpand(order.id)}
                        className={`transition-colors cursor-pointer ${
                          isCancelledOrder(order)
                            ? 'bg-red-50/70 text-red-400'
                            : expandedOrderId === order.id ? 'bg-primary/5' : 'hover:bg-gray-50/80'
                        }`}
                        title={isCancelledOrder(order) ? 'Commande annulée' : undefined}
                      >
                        <td className="px-3 py-1.5 w-[70px] font-bold text-gray-400 text-base tabular-nums">
                          {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        
                        <td className="px-2 py-1.5 w-[80px]">
                          <span className="font-black text-secondary text-lg">
                            {order.order_number || order.id.toString().slice(0, 4)}
                          </span>
                        </td>

                        <td className="px-2 py-1.5 w-[70px]">
                          <span className="inline-block min-w-[52px] text-center px-2 py-1 rounded-lg bg-gray-100 text-secondary text-sm font-black tracking-wide" title={getOrderType(order)}>
                            {TYPE_ABBR[getOrderType(order)] || getOrderType(order)}
                          </span>
                        </td>
                        
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-gray-400">{renderOriginIcon(getOrderOrigin(order), 26)}</span>
                            <span className="font-bold text-gray-800 text-base truncate">
                              {order.customer_name || ''}
                            </span>
                          </div>
                        </td>
                        
                        <td className="px-2 py-1.5 w-[90px]">
                          {renderPaymentIcons(order.payment_method)}
                        </td>
                        
                        <td className={`px-2 py-1.5 w-[100px] text-right font-black text-lg tabular-nums ${isCancelledOrder(order) ? 'text-red-400' : 'text-secondary'}`}>
                          {String(order.payment_method || '').toLowerCase().startsWith('offert') ? (
                            // Commande offerte : 0 € encaissé, montant réel conservé dans discount_amount
                            <span className="text-violet-500 italic" title={`${order.coupon_title || order.payment_method} — non encaissé`}>
                              {Number(order.discount_amount || 0).toFixed(2)} €
                            </span>
                          ) : isCancelledOrder(order) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Ban size={18} className="text-red-500" aria-label="Annulée" />
                              <span className="line-through">{Number(order.total_price).toFixed(2)} €</span>
                            </span>
                          ) : Number(order.discount_amount) > 0 ? (
                            <span className="inline-flex items-center gap-1.5" title={`${order.coupon_title || 'Remise'} : -${Number(order.discount_amount).toFixed(2)} €`}>
                              <Tag size={16} className="text-violet-500" />
                              {Number(order.total_price).toFixed(2)} €
                            </span>
                          ) : (
                            <>{Number(order.total_price).toFixed(2)} €</>
                          )}
                        </td>
                        
                        <td className="px-2 py-1 w-[130px] text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePrintPastOrder(order); }}
                              className="w-11 h-11 flex items-center justify-center text-gray-400 rounded-xl hover:text-blue-600 hover:bg-blue-50 transition-all active:scale-95"
                              title="Imprimer un duplicata"
                              aria-label="Imprimer un duplicata"
                            >
                              <Printer size={22} />
                            </button>

                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePrintKitchenOrder(order); }}
                              className="w-11 h-11 flex items-center justify-center text-gray-400 rounded-xl hover:text-orange-600 hover:bg-orange-50 transition-all active:scale-95"
                              title="Imprimer le bon cuisine"
                              aria-label="Imprimer le bon cuisine"
                            >
                              <ChefHat size={22} />
                            </button>
                            
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all inline-flex ${
                              expandedOrderId === order.id ? 'bg-primary text-white' : 'text-gray-300'
                            }`}>
                              {expandedOrderId === order.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {expandedOrderId === order.id && (
                        <tr className="bg-gray-50/30">
                          <td colSpan={7} className="px-3 py-2 border-t border-gray-100">
                            {renderOrderDetails(order.order_details, order)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
};

export default OrderHistoryModal;