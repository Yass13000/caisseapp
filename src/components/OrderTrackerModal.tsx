// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  CreditCard, 
  Trash2, 
  Banknote,
  MessageSquare,
  MapPin,
  Info,
  Bike
} from 'lucide-react';
import { toast } from 'sonner';
import { getFormattedOrderOptions, fetchOptionGroupMapping, buildReceiptPayloadFromOrder, buildClientReceiptPayload, buildKitchenReceiptPayload, kitchenCustomerName, stripComplementFromAddress, flattenTicketComment } from '@/lib/orderFormatter';
import { addLoyaltyPointsThreadSafe, getActiveRestoId } from '@/lib/loyaltyPoints';
import { mapOrderItemsForTill, extractOrderItems, orderItemName } from '@/lib/loadedOrderPricing';
import { PaymentModal } from '@/pages/Caisse';
import { ORDER_TYPE_ID } from '@/lib/orderTypes';
import { requirePermission } from '@/components/PermissionGate';
import { staffOrderFields, logAction } from '@/lib/staff';
import SumUpSoloPayment, { type SoloPaymentOutcome } from '@/components/SumUpSoloPayment';
import { getSelectedReader, isSoloEnabled } from '@/services/sumupSolo';

interface OrderTrackerModalProps {
  onClose: () => void;
  onLoadOrder: (orderDetails: any[], orderId: string | number, orderType?: string, clientInfo?: any, isFromCaisse?: boolean) => void;
  restaurantName?: string;
}

// 🟢 CALCUL DU TOTAL DE LIGNE (GARANTI SANS DOUBLE COMPTAGE)
// Lecture des réglages depuis la même source que l'écran Réglages
// (fichier Electron en priorité, localStorage en secours sur le Web)
const getSecureSetting = (key: string, defaultValue: any) => {
  if ((window as any).electronAPI?.getSetting) {
    return (window as any).electronAPI.getSetting(key, defaultValue);
  }
  const local = localStorage.getItem(key);
  if (local === null || local === undefined) return defaultValue;
  return local;
};

const getItemTotal = (item: any, groupMapping: Record<string, string> = {}) => {
  if (!item) return 0;
  if (item.isReward || item.is_reward) return 0;

  const qty = Number(item.quantity) || 1;

  if (item.total_price !== undefined && item.total_price !== null && !isNaN(Number(item.total_price))) {
    return Number(item.total_price);
  }
  if (item.totalPrice !== undefined && item.totalPrice !== null && !isNaN(Number(item.totalPrice))) {
    return Number(item.totalPrice);
  }
  if (item.total !== undefined && item.total !== null && !isNaN(Number(item.total))) {
    return Number(item.total);
  }
  if (item.item_total !== undefined && item.item_total !== null && !isNaN(Number(item.item_total))) {
    return Number(item.item_total);
  }

  const groups = getFormattedOrderOptions(item, groupMapping);
  const optsPrice = groups.flatMap(g => g.items).reduce((sum, o) => sum + (Number(o.price) || 0), 0);

  const directPrice = item.price !== undefined ? parseFloat(item.price) : (item.unit_price !== undefined ? parseFloat(item.unit_price) : undefined);
  const explicitBasePrice = (item.base_price !== undefined && item.base_price !== null) 
    ? parseFloat(item.base_price) 
    : (item.product?.base_price !== undefined && item.product?.base_price !== null)
      ? parseFloat(item.product.base_price)
      : undefined;

  if (directPrice !== undefined && !isNaN(directPrice) && directPrice > 0) {
    if (explicitBasePrice !== undefined && explicitBasePrice < directPrice) {
      return directPrice * qty;
    }
    return directPrice * qty;
  }

  const base = explicitBasePrice ?? parseFloat(item.product?.price ?? 0);
  return (base + optsPrice) * qty;
};

// Lecture des lignes d'une commande : calcul commun de la caisse
const extractItemsSafely = extractOrderItems;
const extractProductName = orderItemName;

// 🟢 Détection des commandes créées depuis la caisse (numéro commençant par C)
const isCaisseOrder = (order: any): boolean => {
  if (!order) return false;
  const num = String(order.order_number || '').trim().toUpperCase();
  if (num.startsWith('C')) return true;
  const origin = String(order.order_origin || '').trim().toLowerCase();
  return origin === 'caisse';
};

const ORDER_TYPE_LABELS = {
  [ORDER_TYPE_ID.SUR_PLACE]: 'SUR PLACE',
  [ORDER_TYPE_ID.EMPORTER]: 'EMPORTER',
  [ORDER_TYPE_ID.LIVRAISON]: 'LIVRAISON'
};

const OrderTrackerModal = ({ onClose, onLoadOrder, restaurantName = "VOTRE RESTAURANT" }: OrderTrackerModalProps) => {
  const [orders, setOrders] = useState<any[]>([]);
  // Onglets : commandes à encaisser au comptoir / livraisons payées au livreur
  const [view, setView] = useState<'encaisser' | 'livraisons'>('encaisser');
  const isDeliveryOrder = (o: any) => String(o?.order_type_id || '') === ORDER_TYPE_ID.LIVRAISON;
  const deliveryOrders = orders.filter(isDeliveryOrder);
  const counterOrders = orders.filter((o) => !isDeliveryOrder(o));
  const visibleOrders = view === 'livraisons' ? deliveryOrders : counterOrders;
  // Ouverture : directement sur « Livraisons » s'il n'y a que des livraisons à régler
  const autoTabDoneRef = useRef(false);
  useEffect(() => {
    if (autoTabDoneRef.current || orders.length === 0) return;
    autoTabDoneRef.current = true;
    if (counterOrders.length === 0 && deliveryOrders.length > 0) setView('livraisons');
  }, [orders, counterOrders.length, deliveryOrders.length]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | number | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<any | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Verrou anti double-appui : empêche de payer (et d'imprimer) deux fois la même commande
  const payingOrderIdsRef = useRef<Set<string>>(new Set());

  // TPE SumUp Solo : même fonctionnement que l'encaissement de la caisse.
  // Sans TPE Solo réglé sur cette caisse, rien ne change (validation directe comme avant).
  const [soloPayment, setSoloPayment] = useState<null | {
    reader: { id: string; name: string };
    amountCents: number;
    resolve: (outcome: SoloPaymentOutcome) => void;
  }>(null);

  /** Part CB d'un mode de paiement (« Carte bancaire » = tout, « Fractionné (CB: 12.50€ + …) » = la part CB) */
  const cardCentsFor = (method: string, total: number) => {
    if (method === 'Carte bancaire') return Math.max(0, Math.round(Number(total || 0) * 100));
    const part = String(method || '').match(/CB: (\d+(?:\.\d+)?)/);
    return part ? Math.round(parseFloat(part[1]) * 100) : 0;
  };

  /**
   * Fait payer la part CB sur le TPE avant de valider la commande.
   * Renvoie null si le paiement n'a pas abouti (rien ne doit être validé),
   * sinon le code de transaction SumUp (ou '' si pas de TPE / pas de part CB).
   */
  const chargeOnTerminal = async (order: any, cardCents: number): Promise<string | null> => {
    const reader = isSoloEnabled() ? getSelectedReader() : null;
    if (!reader || cardCents <= 0) return '';
    // Jamais débiter une commande déjà encaissée ailleurs entre-temps
    const { data: current, error } = await supabase.from('orders').select('is_paid, payment_status, status').eq('id', order.id).maybeSingle();
    if (error) { toast.error("Vérification de la commande impossible : réessayez"); return null; }
    if (!current || current.is_paid || current.payment_status === 'paid' || current.status === 'Annulée') {
      toast.error(!current ? "Commande introuvable" : current.status === 'Annulée' ? "Commande annulée entre-temps" : "Commande déjà encaissée");
      if (current?.is_paid || current?.payment_status === 'paid') setOrders(prev => prev.filter(o => o.id !== order.id));
      return null;
    }
    const outcome = await new Promise<SoloPaymentOutcome>((resolve) => {
      setSoloPayment({ reader, amountCents: cardCents, resolve });
    });
    setSoloPayment(null);
    if (!outcome.ok) return null;
    return outcome.code || '';
  };
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});
  
  const getLocalToday = () => {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    return new Date(today.getTime() - offset).toISOString().split('T')[0];
  };

  const [filterDate, setFilterDate] = useState(getLocalToday());
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const filterDateRef = useRef(filterDate);
  const sortOrderRef = useRef(sortOrder);
  filterDateRef.current = filterDate;
  sortOrderRef.current = sortOrder;

  // Récupération de la session active de caisse
  const resolveActiveSessionId = async (restoId: string): Promise<string | null> => {
    const local = localStorage.getItem('pos_session_id');
    if (local && local !== 'null' && local !== 'undefined') return local;

    try {
      const { data } = await supabase
        .from('cash_sessions')
        .select('id')
        .eq('restaurant_id', restoId)
        .eq('status', 'OPEN')
        .is('closed_at', null)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return data?.id || null;
    } catch {
      return null;
    }
  };

  const fetchPendingOrders = async () => {
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

      const currentDate = filterDateRef.current;
      const [year, month, day] = currentDate.split('-').map(Number);
      const startOfDayLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
      const endOfDayLocal = new Date(year, month - 1, day, 23, 59, 59, 999);

      const startOfDay = startOfDayLocal.toISOString();
      const endOfDay = endOfDayLocal.toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', activeRestoId)
        .eq('is_paid', false) 
        .neq('status', 'Annulée') 
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)
        .order('created_at', { ascending: sortOrderRef.current === 'asc' });

      if (error) throw error;
      setOrders(data || []);
    } catch (e) {
      toast.error("Erreur lors de la récupération des commandes");
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
    fetchPendingOrders(); 
  }, [filterDate, sortOrder]);

  useEffect(() => {
    const activeRestoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
      || localStorage.getItem('pos_restaurant_id') 
      || RESTAURANT_ID;

    // Rafale d'événements → un seul rechargement
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('tracker_orders_realtime_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          ...(activeRestoId ? { filter: `restaurant_id=eq.${activeRestoId}` } : {})
        },
        () => {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => { reloadTimer = null; fetchPendingOrders(); }, 600);
        }
      )
      .subscribe();

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  const changeDay = (days: number) => {
    const [year, month, day] = filterDate.split('-').map(Number);
    const date = new Date(year, month - 1, day + days);
    const newDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const todayStr = getLocalToday();

    if (newDateStr > todayStr) return;
    setFilterDate(newDateStr);
    setExpandedOrderId(null);
  };

  const getFormattedDateLabel = () => {
    const todayStr = getLocalToday();
    if (filterDate === todayStr) return "Aujourd'hui";
    
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    const yesterday = new Date(today.getTime() - offset - 86400000).toISOString().split('T')[0];
    if (filterDate === yesterday) return "Hier";

    const [year, month, day] = filterDate.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    return targetDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const toggleExpand = (id: string | number) => setExpandedOrderId(prev => prev === id ? null : id);

  const handleSelectOrder = async (order: any) => {
    if (!(await requirePermission('rouvrir'))) return;
    let items = [];
    try {
      // Calcul commun (aussi vérifié par « npm run verif:encaissement »)
      items = mapOrderItemsForTill(order, optionGroupMapping);
    } catch (e) {
      toast.error("Format de commande invalide");
      return;
    }
    
    if (items.length === 0) {
      toast.error("La commande est vide ou illisible");
      return;
    }

    const resolvedOrderType = ORDER_TYPE_LABELS[order.order_type_id] || 'SUR PLACE';

    const loadedComplement = order.customer_address_complement || order.address_complement || '';
    const clientInfo = {
      name: order.customer_name || '',
      phone: order.customer_phone || '',
      address: stripComplementFromAddress(order.customer_address || '', loadedComplement),
      additionalInfo: loadedComplement,
      address_complement: loadedComplement,
      customer_address_complement: loadedComplement,
      comment: order.comment || order.notes || '',
      notes: order.comment || order.notes || '',
      fee: order.delivery_fee || 0
    };

    onLoadOrder(items, order.id, resolvedOrderType, clientInfo, isCaisseOrder(order));
    onClose();
  };

  const printOrder = async (order: any, isCash: boolean = false) => {
    if (!(window as any).electronAPI) return;

    try {
      const printerName = getSecureSetting('imprimante_caisse', undefined) || undefined;
      const orderPayloadData = await buildReceiptPayloadFromOrder(order, optionGroupMapping);

      orderPayloadData.comment = flattenTicketComment(order.comment || order.notes || '');
      orderPayloadData.customer_address_complement = order.customer_address_complement || order.address_complement || '';
      orderPayloadData.customer_address = order.customer_address || order.address || '';
      orderPayloadData.customer_name = order.customer_name || '';
      orderPayloadData.customer_phone = order.customer_phone || '';

      await (window as any).electronAPI.printReceipt(orderPayloadData, printerName);
    } catch (err) {
      console.error("Erreur lors de l'impression client :", err);
    }
  };

  // 🟢 Impression ticket cuisine sans coordonnées client (uniquement commande & préparation)
  const printKitchenTicket = async (order: any) => {
    if (!(window as any).electronAPI) return;

    try {
      const items = extractItemsSafely(order.order_details);

      const printerName = getSecureSetting('imprimante_cuisine', undefined) || undefined;
      const date = new Date(order.created_at || Date.now()).toLocaleString('fr-FR', { 
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

      const kitchenPayload = buildKitchenReceiptPayload({
        orderNumber,
        orderType,
        items,
        groupMapping: optionGroupMapping,
        orderDate: date,
        comment: order.comment || order.notes || '',
        customer_name: kitchenCustomerName(order.customer_name)
      });

      kitchenPayload.comment = flattenTicketComment(order.comment || order.notes || '');

      await (window as any).electronAPI.printReceipt(kitchenPayload, printerName);
    } catch (err) {
      console.error("Erreur API impression cuisine :", err);
    }
  };

  /** Mode prévu pour une livraison (« CB à la livraison » / « Espèces à la livraison ») */
  const plannedDeliveryPay = (order: any): 'CB' | 'Espèces' | null => {
    const pm = String(order?.payment_method || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (pm.includes('espece') || pm.includes('cash')) return 'Espèces';
    if (pm.includes('cb') || pm.includes('carte')) return 'CB';
    return null;
  };

  /** Livraison réglée au retour du livreur : rien ne part sur le TPE (la carte a été passée sur celui du livreur) */
  const handleSettleDelivery = async (e: React.MouseEvent, order: any, method: 'CB' | 'Espèces') => {
    e.stopPropagation();
    if (!(await requirePermission('encaisser'))) return;
    const lockKey = String(order.id);
    if (payingOrderIdsRef.current.has(lockKey)) return;
    payingOrderIdsRef.current.add(lockKey);
    try {
      const activeRestoId = getActiveRestoId(order.restaurant_id)
        || (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null)
        || localStorage.getItem('pos_restaurant_id')
        || RESTAURANT_ID;
      const activeSessionId = await resolveActiveSessionId(activeRestoId);
      if (!activeSessionId) {
        toast.error("Veuillez ouvrir la caisse d'abord !");
        return;
      }
      const total = Number(order.total_price) || 0;
      const updatePayload: any = {
        is_paid: true,
        payment_status: 'paid',
        payment_method: method === 'CB' ? 'Carte bancaire' : 'Espèces',
        cash_amount: method === 'Espèces' ? total : 0,
        session_id: activeSessionId,
        ...staffOrderFields(),
      };
      // Jamais deux fois : seulement si elle est encore non payée
      const { data: updated, error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', order.id)
        .eq('is_paid', false)
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        toast.info('Livraison déjà réglée');
      } else {
        const pointsToEarn = Number(order.points_earned) || 0;
        if (order.user_id && order.user_id !== "00000000-0000-0000-0000-000000000000" && pointsToEarn > 0) {
          try {
            await addLoyaltyPointsThreadSafe(order.user_id, pointsToEarn, order.id, `Points gagnés commande #${order.order_number || order.id}`, activeRestoId);
          } catch (loyaltyErr) {
            console.warn("Erreur attribution points fidélité :", loyaltyErr);
          }
        }
        toast.success(`Livraison #${order.order_number || String(order.id).slice(0, 4)} réglée en ${method === 'CB' ? 'CB' : 'espèces'}`);
      }
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } catch (err) {
      toast.error("Erreur lors du règlement de la livraison");
    } finally {
      payingOrderIdsRef.current.delete(lockKey);
    }
  };

  const handleQuickPay = async (e: React.MouseEvent, order: any) => {
    e.stopPropagation();
    if (!(await requirePermission('encaisser'))) return;
    const lockKey = String(order.id);
    if (payingOrderIdsRef.current.has(lockKey)) return;
    payingOrderIdsRef.current.add(lockKey);
    try {
      const activeRestoId = getActiveRestoId(order.restaurant_id) 
        || (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
        || localStorage.getItem('pos_restaurant_id') 
        || RESTAURANT_ID;

      // Le paiement doit compter dans la session OUVERTE (et pas celle où la commande a été créée)
      const activeSessionId = await resolveActiveSessionId(activeRestoId);
      if (!activeSessionId) {
        toast.error("Veuillez ouvrir la caisse d'abord !");
        return;
      }

      // Commande comptoir / borne : le montant part sur le TPE. Une livraison est seulement validée.
      const isDelivery = String(order?.order_type_id || '') === ORDER_TYPE_ID.LIVRAISON;
      const txCode = isDelivery ? '' : await chargeOnTerminal(order, cardCentsFor('Carte bancaire', order.total_price));
      if (txCode === null) return;

      const updatePayload: any = { 
        is_paid: true,
        payment_status: 'paid',
        payment_method: 'Carte bancaire',
        ...(txCode ? { sumup_transaction_id: txCode } : {}),
        ...staffOrderFields(),
      };

      if (activeSessionId) {
        updatePayload.session_id = activeSessionId;
      }

      const { error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', order.id);

      if (error) throw error;

      const pointsToEarn = Number(order.points_earned) || 0;
      if (order.user_id && order.user_id !== "00000000-0000-0000-0000-000000000000" && pointsToEarn > 0) {
        try {
          await addLoyaltyPointsThreadSafe(
            order.user_id,
            pointsToEarn,
            order.id,
            `Points gagnés commande #${order.order_number || order.id}`,
            activeRestoId
          );
        } catch (loyaltyErr) {
          console.warn("Erreur attribution points fidélité :", loyaltyErr);
        }
      }

      toast.success(`Commande #${order.order_number || order.id.toString().slice(0, 4)} encaissée par carte`);
      
      const isAutoPrintReceiptEnabled = getSecureSetting('auto_print_receipt', 'true') !== 'false';
      if (isAutoPrintReceiptEnabled) {
        await printOrder({ ...order, ...updatePayload }, false);
      }

      const isFromCaisse = isCaisseOrder(order);
      const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
      
      if (isKitchenTicketEnabled && !isFromCaisse) {
        setTimeout(async () => {
          await printKitchenTicket({ ...order, ...updatePayload });
        }, 500);
      }

      setOrders(prevOrders => prevOrders.filter(o => o.id !== order.id));
    } catch (err) {
      toast.error("Erreur lors de l'encaissement rapide");
    } finally {
      payingOrderIdsRef.current.delete(lockKey);
    }
  };

  const handleOpenCashPaymentModal = async (e: React.MouseEvent, order: any) => {
    e.stopPropagation();
    if (!(await requirePermission('encaisser'))) return;
    setPaymentOrder(order);
    setIsPaymentModalOpen(true);
  };

  const handleCashPaymentConfirm = async (method: string, cashAmount: number) => {
    if (!paymentOrder) return;
    const lockKey = String(paymentOrder.id);
    if (payingOrderIdsRef.current.has(lockKey)) return;
    payingOrderIdsRef.current.add(lockKey);
    setIsProcessing(true);
    try {
      const activeRestoId = getActiveRestoId(paymentOrder.restaurant_id) 
        || (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) 
        || localStorage.getItem('pos_restaurant_id') 
        || RESTAURANT_ID;

      // Le paiement doit compter dans la session OUVERTE (et pas celle où la commande a été créée)
      const activeSessionId = await resolveActiveSessionId(activeRestoId);
      if (!activeSessionId) {
        toast.error("Veuillez ouvrir la caisse d'abord !");
        return;
      }

      const isDelivery = String(paymentOrder?.order_type_id || '') === ORDER_TYPE_ID.LIVRAISON;
      const txCode = isDelivery ? '' : await chargeOnTerminal(paymentOrder, cardCentsFor(method, paymentOrder.total_price));
      if (txCode === null) return;

      const updatePayload: any = {
        is_paid: true,
        payment_status: 'paid',
        payment_method: method,
        cash_amount: cashAmount,
        ...(txCode ? { sumup_transaction_id: txCode } : {}),
        ...staffOrderFields(),
      };

      if (activeSessionId) {
        updatePayload.session_id = activeSessionId;
      }

      const { error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', paymentOrder.id);

      if (error) throw error;

      const pointsToEarn = Number(paymentOrder.points_earned) || 0;
      if (paymentOrder.user_id && paymentOrder.user_id !== "00000000-0000-0000-0000-000000000000" && pointsToEarn > 0) {
        try {
          await addLoyaltyPointsThreadSafe(
            paymentOrder.user_id,
            pointsToEarn,
            paymentOrder.id,
            `Points gagnés commande #${paymentOrder.order_number || paymentOrder.id}`,
            activeRestoId
          );
        } catch (loyaltyErr) {
          console.warn("Erreur attribution points fidélité :", loyaltyErr);
        }
      }

      toast.success(`Commande #${paymentOrder.order_number || paymentOrder.id.toString().slice(0, 4)} encaissée`);

      const isCashPayment = String(method).toLowerCase().includes('espece') || 
                            String(method).toLowerCase().includes('cash') || 
                            String(method).toLowerCase() === 'counter' || 
                            cashAmount > 0;
      if (isCashPayment && (window as any).electronAPI?.openDrawer) {
        const printerName = getSecureSetting('imprimante_caisse', undefined) || undefined;
        (window as any).electronAPI.openDrawer(printerName);
      }

      const updatedOrder = { ...paymentOrder, ...updatePayload };

      const isAutoPrintReceiptEnabled = getSecureSetting('auto_print_receipt', 'true') !== 'false';
      if (isAutoPrintReceiptEnabled) {
        await printOrder(updatedOrder, false);
      }

      const isFromCaisse = isCaisseOrder(paymentOrder);
      const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
      
      if (isKitchenTicketEnabled && !isFromCaisse) {
        setTimeout(async () => {
          await printKitchenTicket(updatedOrder);
        }, 500);
      }

      setOrders(prevOrders => prevOrders.filter(o => o.id !== paymentOrder.id));
      setIsPaymentModalOpen(false);
      setPaymentOrder(null);
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'enregistrement du paiement");
    } finally {
      payingOrderIdsRef.current.delete(lockKey);
      setIsProcessing(false);
    }
  };

  const handleDeleteOrder = async (e: React.MouseEvent, order: any) => {
    e.stopPropagation();
    if (!(await requirePermission('annuler'))) return;
    const confirmDelete = window.confirm(`Annuler la commande #${order.order_number || order.id.toString().slice(0, 4)} ?\nElle restera consultable dans l'historique des commandes.`);
    if (!confirmDelete) return;

    try {
      // Plus de suppression définitive : la commande est conservée avec le statut « Annulée »
      // (exclue du ticket Z et des listes en cours, visible dans l'historique)
      const { error } = await supabase
        .from('orders')
        .update({ status: 'Annulée' })
        .eq('id', order.id);
      if (error) throw error;
      toast.success("Commande annulée");
      logAction('annulation', { orderId: order.id, details: { numero: order.order_number || null, total: order.total_price ?? null } });
      setOrders(prevOrders => prevOrders.filter(o => o.id !== order.id));
    } catch (err: any) {
      console.error("Annulation refusée :", err?.code, err?.message, err?.details);
      toast.error(`Annulation impossible : ${err?.message || 'erreur inconnue'}`);
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
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-2 space-y-3">
          
          {(orderAddress || orderComplement) && (
            <div className="bg-white border border-gray-200 p-2.5 rounded-lg text-xs space-y-1">
              {orderAddress && (
                <div className="font-bold text-gray-700 flex items-start gap-1.5">
                  <MapPin size={13} className="text-red-500 shrink-0 mt-0.5" />
                  <span>Adresse : {orderAddress}</span>
                </div>
              )}
              {orderComplement && (
                <div className="font-bold text-amber-700 flex items-start gap-1.5 pl-5">
                  <Info size={12} className="text-amber-500 shrink-0 mt-0.5" />
                  <span>Complément : {orderComplement}</span>
                </div>
              )}
            </div>
          )}

          {orderComment && (
            <div className="p-2.5 bg-amber-50 border-2 border-amber-300 rounded-lg text-slate-950 font-black text-xs uppercase flex items-start gap-1.5 shadow-sm">
              <MessageSquare size={14} className="text-amber-700 shrink-0 mt-0.5" />
              <span>NOTE CLIENT : {orderComment}</span>
            </div>
          )}

          <div>
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <ShoppingBag size={14} /> Contenu de la commande
            </h4>
            <ul className="space-y-3">
              {items.map((item: any, idx: number) => {
                const productName = extractProductName(item);
                const qty = item.quantity || 1;
                const itemTotal = getItemTotal(item, optionGroupMapping);
                const optionGroups = getFormattedOrderOptions(item, optionGroupMapping);
                
                return (
                  <li key={idx} className="flex flex-col text-sm border-b border-gray-100 last:border-0 pb-2">
                    <div className="flex justify-between items-start">
                      <div className="font-bold text-gray-700">
                        <span className="text-primary mr-2">{qty}x</span>
                        {productName}
                      </div>
                      <div className="font-black text-secondary">
                        {itemTotal.toFixed(2)} €
                      </div>
                    </div>
                    {optionGroups.length > 0 && (
                      <div className="mt-1 pl-6 space-y-1">
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
    } catch (e) {
      console.error("Erreur de rendu orderDetails :", e);
      return <p className="text-red-500 text-sm">Détails illisibles</p>;
    }
  };

  const isToday = filterDate === getLocalToday();

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 font-helvetica select-none">
      <div className="bg-[#F3F4F6] w-[1200px] h-[750px] max-w-[95vw] max-h-[95vh] rounded-[1.5rem] shadow-2xl flex flex-col overflow-hidden border border-white/20">
        
        {/* EN-TÊTE : Titre et Filtres */}
        <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-black text-secondary uppercase tracking-tight">Suivi Commandes</h2>

            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200">
              {([
                { key: 'encaisser', label: 'À encaisser', count: counterOrders.length, Icon: CreditCard },
                { key: 'livraisons', label: 'Livraisons', count: deliveryOrders.length, Icon: Bike },
              ] as const).map(({ key, label, count, Icon }) => (
                <button
                  key={key}
                  onClick={() => { setView(key); setExpandedOrderId(null); }}
                  className={`h-10 px-4 rounded-lg font-black text-sm uppercase tracking-wide flex items-center gap-2 transition active:scale-95 ${view === key ? 'bg-white text-secondary shadow-sm' : 'text-gray-500 hover:text-secondary'}`}
                >
                  <Icon size={16} /> {label}
                  <span className={`min-w-6 h-6 px-1.5 rounded-full text-xs flex items-center justify-center ${count > 0 ? (key === 'livraisons' ? 'bg-purple-600 text-white' : 'bg-red-600 text-white') : 'bg-gray-200 text-gray-500'}`}>{count}</span>
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-200 shadow-inner">
              
              <div className="flex items-center bg-white rounded-lg shadow-sm border border-gray-200 p-1">
                <button onClick={() => changeDay(-1)} className="p-2 hover:bg-gray-100 rounded-md transition-colors active:scale-95 text-gray-600">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                
                <div className="flex items-center gap-2 px-4 justify-center min-w-[160px]">
                  <Calendar className="text-primary w-5 h-5" />
                  <span className="font-bold text-secondary text-base capitalize">
                    {getFormattedDateLabel()}
                  </span>
                </div>

                <button onClick={() => !isToday && changeDay(1)} disabled={isToday} className={`p-2 rounded-md transition-colors ${isToday ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 active:scale-95 text-gray-600'}`}>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <button onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')} className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-200 text-secondary rounded-lg font-bold text-sm active:scale-95 transition-all shadow-sm h-full">
                <Clock className={`w-5 h-5 ${sortOrder === 'desc' ? 'text-primary' : 'text-gray-400'}`} />
                {sortOrder === 'desc' ? 'Plus récents' : 'Plus anciens'}
              </button>
            </div>
          </div>

          <button onClick={onClose} className="w-10 h-10 bg-red-100 text-red-600 rounded-lg flex items-center justify-center font-black hover:bg-red-200 active:scale-90 transition-all">
            <X size={24} />
          </button>
        </div>

        {/* CORPS : Tableau */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
              <p className="text-gray-400 font-bold text-base">Recherche des commandes...</p>
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Search size={60} className="mb-4 opacity-20" />
              <p className="text-xl font-bold italic">
                {view === 'livraisons' ? 'Aucune livraison à régler' : 'Aucune commande en attente'} pour {getFormattedDateLabel().toLowerCase()}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-black uppercase text-xs tracking-widest">
                    <th className="p-4 w-[100px]">Heure</th>
                    <th className="p-4 w-[120px]">N° Cmd</th>
                    <th className="p-4">Client / Origine</th>
                    <th className="p-4 text-right w-[100px]">Total</th>
                    <th className="p-4 w-[300px] text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visibleOrders.map((order) => {
                    const isApp = order.order_origin?.toLowerCase() === 'app';
                    
                    const hasValidMachineId = order.machine_id && 
                      String(order.machine_id).trim() !== '' && 
                      String(order.machine_id).trim().toUpperCase() !== 'BORNE-NON-CONFIGURÉE' && 
                      String(order.machine_id).trim().toUpperCase() !== 'BORNE-NON-CONFIGUREE';

                    const isCaisse = String(order.order_origin || '').toLowerCase() === 'caisse';
                    const originLabel = hasValidMachineId 
                      ? String(order.machine_id).trim() 
                      : (isApp ? 'App' : isCaisse ? 'Caisse' : 'Borne');

                    const clientLabel = order.customer_name || `Client ${originLabel}`;
                    const typeLabel = ORDER_TYPE_LABELS[order.order_type_id] || 'SUR PLACE';

                    return (
                      <React.Fragment key={order.id}>
                        <tr onClick={() => toggleExpand(order.id)} className={`transition-colors cursor-pointer ${expandedOrderId === order.id ? 'bg-primary/5' : 'hover:bg-gray-50/80'}`}>
                          <td className="p-4 font-bold text-secondary text-base">
                            {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="p-4">
                            <span className="bg-gray-100 px-3 py-1.5 rounded-lg font-black text-secondary text-base border border-gray-200 shadow-sm">
                              #{order.order_number || order.id.toString().slice(0, 4)}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-gray-800 text-base">{clientLabel}</div>
                            <div className="flex gap-1 mt-1">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${isApp ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-700'}`}>
                                {originLabel}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${typeLabel === 'LIVRAISON' ? 'bg-purple-100 text-purple-600' : typeLabel === 'EMPORTER' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                                {typeLabel}
                                </span>
                            </div>
                            {view === 'livraisons' && (() => {
                              const planned = plannedDeliveryPay(order);
                              const total = Number(order.total_price) || 0;
                              const given = Number(order.cash_amount) || 0;
                              const deliveredLabel = order.delivery_status === 'delivered' ? 'Livrée'
                                : order.delivery_status === 'in_transit' ? 'En route'
                                : order.delivery_status === 'assigned' ? 'Assignée'
                                : order.delivery_status === 'failed' ? 'Échec' : null;
                              return (
                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                  <span className={`px-2 py-1 rounded-md text-xs font-black uppercase tracking-wide ${planned === 'CB' ? 'bg-emerald-100 text-emerald-700' : planned === 'Espèces' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {planned ? `${planned} à la livraison` : 'Paiement non précisé'}
                                  </span>
                                  {planned === 'Espèces' && given > total + 0.001 && (
                                    <span className="px-2 py-1 rounded-md text-xs font-black bg-amber-50 text-amber-800 border border-amber-200">
                                      Paie avec {given.toFixed(2)} € · rendre {(given - total).toFixed(2)} €
                                    </span>
                                  )}
                                  {deliveredLabel && (
                                    <span className="px-2 py-1 rounded-md text-xs font-black bg-blue-50 text-blue-700 border border-blue-100">{deliveredLabel}</span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="p-4 text-right font-black text-lg text-secondary">
                            {order.total_price.toFixed(2)} €
                          </td>
                          <td className="p-4 flex items-center justify-end gap-2">
                            <button onClick={(e) => handleDeleteOrder(e, order)} className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 rounded-lg hover:bg-red-200 active:scale-95 transition-all shadow-sm flex-shrink-0" title="Supprimer la commande">
                              <Trash2 size={18} />
                            </button>
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all shadow-sm flex-shrink-0 ${expandedOrderId === order.id ? 'bg-secondary text-white' : 'bg-gray-100 text-gray-400'}`}>
                              {expandedOrderId === order.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleSelectOrder(order); }} className="h-10 px-4 bg-secondary text-white rounded-lg font-black uppercase text-xs hover:bg-secondary/90 active:scale-95 transition-all shadow-sm flex items-center justify-center flex-shrink-0" title="Ouvrir en caisse">
                              Ouvrir
                            </button>
                            {view === 'livraisons' ? (() => {
                              const planned = plannedDeliveryPay(order);
                              const mk = (m: 'CB' | 'Espèces') => {
                                const main = planned ? planned === m : true;
                                return (
                                  <button
                                    key={m}
                                    onClick={(e) => handleSettleDelivery(e, order, m)}
                                    title={`Livraison payée en ${m === 'CB' ? 'CB (TPE du livreur)' : 'espèces'}`}
                                    className={`h-10 rounded-lg font-black uppercase text-xs active:scale-95 transition-all shadow-sm flex items-center gap-1 flex-shrink-0 ${main
                                      ? `px-3 text-white ${m === 'CB' ? 'bg-[#04B855] hover:bg-[#039d48]' : 'bg-amber-500 hover:bg-amber-600'}`
                                      : 'px-2.5 bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                  >
                                    {m === 'CB' ? <CreditCard size={16} /> : <Banknote size={16} />}
                                    {main ? `Payée ${m === 'CB' ? 'CB' : 'espèces'}` : (m === 'CB' ? 'CB' : 'Esp.')}
                                  </button>
                                );
                              };
                              return planned === 'Espèces' ? [mk('Espèces'), mk('CB')] : [mk('CB'), mk('Espèces')];
                            })() : (
                              <>
                                <button onClick={(e) => handleOpenCashPaymentModal(e, order)} className="h-10 px-3 bg-amber-500 text-white rounded-lg font-black uppercase text-xs hover:bg-amber-600 active:scale-95 transition-all shadow-sm flex items-center gap-1 flex-shrink-0" title="Payer en espèces (avec rendu)">
                                  <Banknote size={16} /> Espèces
                                </button>
                                <button onClick={(e) => handleQuickPay(e, order)} className="h-10 px-3 bg-[#04B855] text-white rounded-lg font-black uppercase text-xs hover:bg-[#039d48] active:scale-95 transition-all shadow-sm flex items-center gap-1 flex-shrink-0" title="Payer directement par CB">
                                  <CreditCard size={16} /> CB
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                        {expandedOrderId === order.id && (
                          <tr className="bg-gray-50/30">
                            <td colSpan={5} className="p-4 border-t border-gray-100">
                              {renderOrderDetails(order.order_details, order)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PIED DE PAGE : Statistiques */}
        <div className="p-6 bg-white border-t border-gray-200 flex items-center justify-center flex-shrink-0">
            <div className="flex gap-16 items-center bg-gray-50 px-8 py-4 rounded-2xl border border-gray-200 shadow-inner">
                <div className="flex flex-col items-center">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Commandes en attente</span>
                    <span className="text-2xl font-black text-secondary">{orders.length}</span>
                </div>
                <div className="w-px h-10 bg-gray-300"></div>
                <div className="flex flex-col items-center">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Total à encaisser</span>
                    <span className="text-3xl font-black text-orange-500">
                        {orders.reduce((acc, curr) => acc + curr.total_price, 0).toFixed(2)} €
                    </span>
                </div>
            </div>
        </div>

        {/* MODALE DE PAIEMENT ESPÈCES */}
        <AnimatePresence>
          {isPaymentModalOpen && paymentOrder && (
            <PaymentModal
              subtotal={paymentOrder.total_price}
              themeColors={{ primary: '#04B855', secondary: '#1f2937', accent: '#FBBF24' }}
              onClose={() => {
                setIsPaymentModalOpen(false);
                setPaymentOrder(null);
              }}
              onConfirm={handleCashPaymentConfirm}
              isProcessing={isProcessing}
            />
          )}
        </AnimatePresence>

        {soloPayment && (
          <SumUpSoloPayment
            reader={soloPayment.reader}
            amountCents={soloPayment.amountCents}
            description="Caisse"
            onDone={soloPayment.resolve}
          />
        )}

      </div>
    </div>,
    document.body
  );
};

export default OrderTrackerModal;