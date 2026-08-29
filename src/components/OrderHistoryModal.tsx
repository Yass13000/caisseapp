// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { 
  Calendar, 
  Clock, 
  X, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  ShoppingBag, 
  ChevronLeft, 
  ChevronRight, 
  Printer, 
  ChefHat,
  Filter
} from 'lucide-react';
import { toast } from 'sonner';
import { getFormattedOrderOptions, fetchOptionGroupMapping, buildReceiptPayloadFromOrder, buildKitchenReceiptPayload } from '@/lib/orderFormatter';

interface OrderHistoryModalProps {
  onClose: () => void;
  restaurantName?: string; 
}

const getItemTotal = (item: any, groupMapping: Record<string, string> = {}) => {
  if (!item) return 0;
  if (item.isReward) return 0;

  // 🟢 PRIORITÉ 1 : Utiliser le prix de ligne déjà calculé et stocké dans l'objet de commande
  if (item.total_price !== undefined && item.total_price !== null && !isNaN(Number(item.total_price))) {
    return Number(item.total_price);
  }
  if (item.total !== undefined && item.total !== null && !isNaN(Number(item.total))) {
    return Number(item.total);
  }

  // 🟢 PRIORITÉ 2 : Calcul strict sans double comptage (base_price + options)
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
        console.error("Erreur chargement types de commande:", e);
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
    } catch(e) { return []; }
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
    
    if (order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9') return 'À emporter';
    if (order.order_type_id === 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d') return 'Livraison';
    return 'Sur place';
  }, [orderTypesMap]);

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
        toast.error("Veuillez configurer la caisse (ID manquant)");
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
        .eq('is_paid', true)
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)
        .order('created_at', { ascending: sortOrder === 'asc' });

      if (error) throw error;
      setOrders(data || []);
    } catch (e) {
      toast.error("Erreur lors du chargement de l'historique");
    } finally {
      setIsLoading(false);
    }
  };

  // 🟢 Chargement du mapping des groupes d'options Supabase
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

  // Calcul dynamique des éléments existants (> 0)
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

  // Réinitialisation automatique du filtre si la sélection actuelle n'a pas de commandes
  useEffect(() => {
    if (selectedOrderType !== 'all' && !availableTypeCounts[selectedOrderType]) {
      setSelectedOrderType('all');
    }
    if (selectedOrigin !== 'all' && !availableOriginCounts[selectedOrigin]) {
      setSelectedOrigin('all');
    }
  }, [availableTypeCounts, availableOriginCounts, selectedOrderType, selectedOrigin]);

  // Commandes filtrées
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      if (selectedOrderType !== 'all' && getOrderType(order) !== selectedOrderType) {
        return false;
      }
      if (selectedOrigin !== 'all' && getOrderOrigin(order) !== selectedOrigin) {
        return false;
      }
      return true;
    });
  }, [orders, selectedOrderType, selectedOrigin, getOrderType, getOrderOrigin]);

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

  const getPaymentMethodLabel = (method: string) => {
    if (!method) return 'N/A';
    const m = method.toLowerCase();
    if (m === 'counter' || m === 'espèces') return 'Espèces';
    if (m === 'card' || m === 'carte bancaire') return 'Carte Bancaire';
    return method;
  };

  // --- FONCTION D'IMPRESSION DEPUIS L'HISTORIQUE ---
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

      const result = await (window as any).electronAPI.printReceipt(orderPayloadData);
      if (!result.success) toast.error("Erreur avec l'imprimante !");
      else toast.success("Duplicata imprimé");

    } catch (err) {
        console.error("Erreur impression historique :", err);
        toast.error("Erreur lors de la génération du ticket");
    }
  };

  const handlePrintKitchenOrder = async (order: any) => {
    if (!(window as any).electronAPI) return;

    try {
      const items = extractItemsSafely(order.order_details);
      if (!items || items.length === 0) {
        toast.error("Impossible d'imprimer : détails de commande vides.");
        return;
      }

      const date = new Date(order.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const orderNumber = order.order_number || order.id.toString().slice(0, 4);
      
      let orderType = 'SUR PLACE';
      if (order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9') orderType = 'EMPORTER';
      if (order.order_type_id === 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d') orderType = 'LIVRAISON';

      const printerName = localStorage.getItem('imprimante_cuisine') || undefined;
      const kitchenPayload = buildKitchenReceiptPayload({
        orderNumber,
        orderType,
        items,
        groupMapping: optionGroupMapping,
        orderDate: date
      });

      const result = await (window as any).electronAPI.printReceipt(kitchenPayload, printerName);
      if (!result.success) toast.error("Erreur avec l'imprimante cuisine !");
      else toast.success("Bon cuisine imprimé");
    } catch (err) {
      console.error("Erreur impression cuisine historique :", err);
      toast.error("Erreur lors de l'impression du bon cuisine");
    }
  };

  // --- AFFICHAGE À L'ÉCRAN ---
  const renderOrderDetails = (detailsRaw: any) => {
    try {
      const items = extractItemsSafely(detailsRaw);
      if (!items || items.length === 0) return <p className="text-gray-400 italic">Aucun détail disponible</p>;

      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-2">
          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <ShoppingBag size={14} /> Contenu de la commande
          </h4>
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
      );
    } catch (e) {
      return <p className="text-red-500 text-sm">Détails illisibles</p>;
    }
  };

  const isToday = filterDate === getLocalToday();

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 font-helvetica select-none">
      <div className="bg-[#F3F4F6] w-[1280px] h-[780px] max-w-[96vw] max-h-[96vh] rounded-[1.5rem] shadow-2xl flex flex-col overflow-hidden border border-white/20">
        
        <div className="bg-white border-b border-gray-200 p-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-2xl font-black text-secondary uppercase tracking-tight">Historique des Ventes</h2>
            
            <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200 shadow-inner flex-wrap">
              
              <div className="flex items-center bg-white rounded-lg shadow-sm border border-gray-200 p-1">
                <button 
                  onClick={() => changeDay(-1)} 
                  className="p-1.5 hover:bg-gray-100 rounded-md transition-colors active:scale-95 text-gray-600"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                
                <div className="flex items-center gap-2 px-3 justify-center min-w-[150px]">
                  <Calendar className="text-primary w-4 h-4" />
                  <span className="font-bold text-secondary text-sm capitalize">
                    {getFormattedDateLabel()}
                  </span>
                </div>

                <button 
                  onClick={() => !isToday && changeDay(1)} 
                  disabled={isToday}
                  className={`p-1.5 rounded-md transition-colors ${isToday ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 active:scale-95 text-gray-600'}`}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* TRI CHRONOLOGIQUE */}
              <button 
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-100 border border-gray-200 text-secondary rounded-lg font-bold text-xs active:scale-95 transition-all shadow-sm h-full"
                title="Inverser le tri"
              >
                <Clock className={`w-4 h-4 ${sortOrder === 'desc' ? 'text-primary' : 'text-gray-400'}`} />
                {sortOrder === 'desc' ? 'Plus récents' : 'Plus anciens'}
              </button>

              {/* FILTRE PAR ORDER TYPE (MASQUÉ SI 0 CHOIX) */}
              {Object.keys(availableTypeCounts).length > 0 && (
                <div className="relative flex items-center">
                  <select
                    value={selectedOrderType}
                    onChange={(e) => setSelectedOrderType(e.target.value)}
                    className="bg-white hover:bg-gray-100 border border-gray-200 text-secondary rounded-lg font-bold text-xs px-3 py-2 outline-none cursor-pointer shadow-sm appearance-none pr-7 transition-all h-full"
                  >
                    <option value="all">Tous types ({orders.length})</option>
                    {Object.entries(availableTypeCounts).map(([type, count]) => (
                      <option key={type} value={type}>
                        {type} ({count})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 pointer-events-none" />
                </div>
              )}

              {/* FILTRE PAR CANAL / ORIGINE (MASQUÉ SI 0 CHOIX) */}
              {Object.keys(availableOriginCounts).length > 0 && (
                <div className="relative flex items-center">
                  <select
                    value={selectedOrigin}
                    onChange={(e) => setSelectedOrigin(e.target.value)}
                    className="bg-white hover:bg-gray-100 border border-gray-200 text-secondary rounded-lg font-bold text-xs px-3 py-2 outline-none cursor-pointer shadow-sm appearance-none pr-7 transition-all h-full"
                  >
                    <option value="all">Toutes origines ({orders.length})</option>
                    {Object.entries(availableOriginCounts).map(([orig, count]) => (
                      <option key={orig} value={orig}>
                        {orig} ({count})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 pointer-events-none" />
                </div>
              )}

            </div>
          </div>

          <button onClick={onClose} className="w-10 h-10 bg-red-100 text-red-600 rounded-lg flex items-center justify-center font-black hover:bg-red-200 active:scale-90 transition-all">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
              <p className="text-gray-400 font-bold text-base">Recherche des tickets...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Search size={60} className="mb-4 opacity-20" />
              <p className="text-xl font-bold italic">
                {orders.length === 0 
                  ? `Aucune vente enregistrée pour ${getFormattedDateLabel().toLowerCase()}`
                  : `Aucune vente pour ces critères de filtre`}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-black uppercase text-xs tracking-widest">
                    <th className="p-4 w-[110px]">Heure</th>
                    <th className="p-4 w-[130px]">N° Cmd</th>
                    <th className="p-4 w-[130px]">Type</th>
                    <th className="p-4">Client / Origine</th>
                    <th className="p-4 w-[150px]">Paiement</th>
                    <th className="p-4 text-right w-[130px]">Total</th>
                    <th className="p-4 w-[130px] text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredOrders.map((order) => (
                    <React.Fragment key={order.id}>
                      <tr 
                        onClick={() => toggleExpand(order.id)}
                        className={`transition-colors cursor-pointer ${expandedOrderId === order.id ? 'bg-primary/5' : 'hover:bg-gray-50/80'}`}
                      >
                        <td className="p-4 font-bold text-secondary text-base">
                          {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        
                        <td className="p-4">
                          <span className="bg-white px-2.5 py-1 rounded-lg font-black text-secondary text-sm border border-gray-200 shadow-sm">
                            #{order.order_number || order.id.toString().slice(0, 4)}
                          </span>
                        </td>

                        <td className="p-4">
                          <span className="px-2 py-0.5 bg-gray-100 text-secondary border border-gray-200 rounded text-xs font-bold uppercase tracking-wider">
                            {getOrderType(order)}
                          </span>
                        </td>
                        
                        <td className="p-4">
                          <div className="font-bold text-gray-800 text-base">
                            {order.customer_name || "Client Direct"}
                          </div>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${
                            getOrderOrigin(order) === 'Borne' ? 'bg-blue-100 text-blue-700' :
                            getOrderOrigin(order) === 'App' ? 'bg-purple-100 text-purple-700' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>
                            {getOrderOrigin(order)}
                          </span>
                        </td>
                        
                        <td className="p-4 font-bold text-gray-500 text-sm uppercase">
                          {getPaymentMethodLabel(order.payment_method)}
                        </td>
                        
                        <td className="p-4 text-right font-black text-lg text-[#04B855]">
                          {Number(order.total_price).toFixed(2)} €
                        </td>
                        
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2.5">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePrintPastOrder(order); }}
                              className="p-2 border-2 border-gray-200 text-gray-500 rounded-lg hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50 transition-all active:scale-95"
                              title="Imprimer un duplicata"
                            >
                              <Printer size={16} />
                            </button>

                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePrintKitchenOrder(order); }}
                              className="p-2 border-2 border-gray-200 text-gray-500 rounded-lg hover:border-orange-500 hover:text-orange-500 hover:bg-orange-50 transition-all active:scale-95"
                              title="Imprimer le bon cuisine"
                            >
                              <ChefHat size={16} />
                            </button>
                            
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all shadow-sm inline-flex ${
                              expandedOrderId === order.id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {expandedOrderId === order.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {expandedOrderId === order.id && (
                        <tr className="bg-gray-50/30">
                          <td colSpan={7} className="p-4 border-t border-gray-100">
                            {renderOrderDetails(order.order_details)}
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

        <div className="p-5 bg-white border-t border-gray-200 flex items-center justify-center flex-shrink-0">
            <div className="flex gap-16 items-center bg-gray-50 px-8 py-3.5 rounded-2xl border border-gray-200 shadow-inner">
                <div className="flex flex-col items-center">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">
                      {selectedOrderType !== 'all' || selectedOrigin !== 'all' ? 'Ventes Filtrées' : 'Ventes Finalisées'}
                    </span>
                    <span className="text-2xl font-black text-secondary">{filteredOrders.length}</span>
                </div>
                
                <div className="w-px h-9 bg-gray-300"></div>
                
                <div className="flex flex-col items-center">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Chiffre d'Affaires</span>
                    <span className="text-3xl font-black text-[#04B855]">
                        {filteredOrders.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0).toFixed(2)} €
                    </span>
                </div>
            </div>
        </div>

      </div>
    </div>,
    document.body
  );
};

export default OrderHistoryModal;