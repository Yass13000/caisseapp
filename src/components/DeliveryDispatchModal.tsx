// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Bike, MapPin, CheckCircle2, RefreshCw, Send, DollarSign, 
  AlertCircle, Clock, Compass, AlertTriangle, Phone, Printer, 
  Layers, CheckSquare, Square, Coins, X, History, Navigation
} from 'lucide-react';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface DriverProfile {
  id: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_driver: boolean;
  is_driver_online: boolean;
  latitude?: number | null;
  longitude?: number | null;
  heading?: number | null;
  speed?: number | null;
  location_updated_at?: string | null;
  cash_float?: number | null;
}

interface DeliveryOrder {
  id: string | number;
  order_number: string;
  total_price: number;
  total_amount?: number;
  status: string;
  delivery_status: 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'failed' | 'cancelled' | null;
  driver_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_address_complement?: string | null;
  comment?: string | null;
  is_paid: boolean;
  payment_method: string | null;
  created_at: string;
  scheduled_time?: string | null;
  global_prep_time?: number | null;
  additional_prep_time?: number | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  is_settled?: boolean;
  settled_at?: string | null;
}

interface DriverShiftHistory {
  id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  total_deliveries: number;
  total_cash_collected: number;
}

const DELIVERY_ORDER_TYPE_ID = 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d';
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

const extractZone = (address: string | null) => {
  if (!address) return null;
  const m = address.match(/\b([0-9]{5})\b/);
  return m ? m[1] : null;
};

const formatGpsAge = (updatedAt?: string | null, nowMs?: number) => {
  if (!updatedAt) return 'Aucun signal';
  const diffSec = Math.max(0, Math.floor(((nowMs || Date.now()) - new Date(updatedAt).getTime()) / 1000));
  if (diffSec < 60) return 'En direct';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `Il y a ${mins} min`;
  return `Il y a ${Math.floor(mins / 60)}h`;
};

const OrderDeliveryTimerBadge = React.memo(({ order, now, defaultPrepTime }: { order: DeliveryOrder; now: number; defaultPrepTime: number }) => {
  const targetMs = order.scheduled_time 
    ? new Date(order.scheduled_time).getTime() 
    : new Date(order.created_at).getTime() + (Number(order.global_prep_time ?? defaultPrepTime ?? 40) + Number(order.additional_prep_time ?? 0)) * 60000;

  const diffMs = targetMs - now;
  const isLate = diffMs < 0;
  const mins = Math.floor(Math.abs(diffMs) / 60000);
  const secs = Math.floor((Math.abs(diffMs) % 60000) / 1000);
  const fmt = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const targetStr = new Date(targetMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-[11px] font-black bg-slate-950 px-2 py-0.5 rounded-lg text-slate-300 border border-slate-700">
        {targetStr}
      </span>
      <span className={`flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-lg ${
        isLate ? 'bg-red-600 text-white animate-pulse' : mins < 8 ? 'bg-amber-500 text-slate-950 animate-pulse' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
      }`}>
        {isLate ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
        <span>{isLate ? `+${fmt}` : fmt}</span>
      </span>
    </div>
  );
});

export const DeliveryDispatchModal: React.FC<{ searchQuery?: string }> = ({ searchQuery = '' }) => {
  const [subTab, setSubTab] = useState<'dispatch' | 'map' | 'settlement'>('dispatch');
  const [settlementView, setSettlementView] = useState<'pending' | 'history'>('pending');
  const [filterType, setFilterType] = useState<'all' | 'late' | 'cash' | 'failed'>('all');
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [pastShifts, setPastShifts] = useState<DriverShiftHistory[]>([]);
  
  const [selectedDriverIdForSettlement, setSelectedDriverIdForSettlement] = useState<string | null>(null);
  const [activeDriverIdForMap, setActiveDriverIdForMap] = useState<string | null>(null);
  const [driverForCashReload, setDriverForCashReload] = useState<DriverProfile | null>(null);
  const [reloadAmount, setReloadAmount] = useState<number>(20);

  const [selectedOrderIdsForBatch, setSelectedOrderIdsForBatch] = useState<(string | number)[]>([]);
  const [showBatchAssignModal, setShowBatchAssignModal] = useState<boolean>(false);
  const [assigningOrderId, setAssigningOrderId] = useState<string | number | null>(null);
  const [defaultPrepTime, setDefaultPrepTime] = useState<number>(40);
  const [now, setNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState<boolean>(true);
  const [receivedCashStr, setReceivedCashStr] = useState<string>('');

  const activeRestoId = useMemo(() => {
    const raw = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null)
      || localStorage.getItem('pos_restaurant_id')
      || localStorage.getItem('admin_override_restaurant_id')
      || RESTAURANT_ID;
    return raw && raw !== 'undefined' && raw !== 'null' ? String(raw).trim() : RESTAURANT_ID;
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fusion intelligente de profiles + driver_locations (aucun livreur oublié)
  const mergeDriversAndLocations = useCallback((profilesList: any[], locationsList: any[]): DriverProfile[] => {
    const map = new Map<string, DriverProfile>();

    (profilesList || []).forEach((p: any) => {
      if (!p?.id) return;
      map.set(String(p.id), {
        id: String(p.id),
        customer_name: p.customer_name || p.email || 'Livreur',
        email: p.email || null,
        phone: p.phone || null,
        role: p.role || 'driver',
        is_driver: true,
        is_driver_online: Boolean(p.is_driver_online),
        latitude: null,
        longitude: null,
        heading: null,
        speed: null,
        location_updated_at: null,
        cash_float: Number(p.cash_float || 0)
      });
    });

    (locationsList || []).forEach((loc: any) => {
      const dId = loc?.driver_id ? String(loc.driver_id) : null;
      if (!dId) return;

      const lat = loc.latitude !== null && loc.latitude !== undefined ? Number(loc.latitude) : null;
      const lng = loc.longitude !== null && loc.longitude !== undefined ? Number(loc.longitude) : null;
      const validCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

      const isRecent = loc.updated_at 
        ? (Date.now() - new Date(loc.updated_at).getTime()) < 2 * 60 * 60 * 1000 
        : false;

      if (map.has(dId)) {
        const existing = map.get(dId)!;
        map.set(dId, {
          ...existing,
          customer_name: existing.customer_name || loc.driver_name || 'Livreur',
          is_driver_online: existing.is_driver_online || isRecent,
          latitude: validCoords ? lat : existing.latitude,
          longitude: validCoords ? lng : existing.longitude,
          heading: loc.heading !== null && loc.heading !== undefined ? Number(loc.heading) : existing.heading,
          speed: loc.speed !== null && loc.speed !== undefined ? Number(loc.speed) : existing.speed,
          location_updated_at: loc.updated_at || existing.location_updated_at
        });
      } else {
        // Livreur présent dans driver_locations mais non tagué dans profiles
        map.set(dId, {
          id: dId,
          customer_name: loc.driver_name || 'Livreur',
          email: null,
          phone: null,
          role: 'driver',
          is_driver: true,
          is_driver_online: isRecent || validCoords,
          latitude: validCoords ? lat : null,
          longitude: validCoords ? lng : null,
          heading: loc.heading !== null && loc.heading !== undefined ? Number(loc.heading) : null,
          speed: loc.speed !== null && loc.speed !== undefined ? Number(loc.speed) : null,
          location_updated_at: loc.updated_at || null,
          cash_float: 0
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.is_driver_online !== b.is_driver_online) return a.is_driver_online ? -1 : 1;
      return String(a.customer_name || '').localeCompare(String(b.customer_name || ''));
    });
  }, []);

  // ── CHARGEMENT INITIAL (STRICTEMENT < 4 HEURES) ──
  const loadInitialData = useCallback(async () => {
    if (!activeRestoId) return;
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const fourHoursAgo = new Date(Date.now() - FOUR_HOURS_MS);
      const cutoffIso = (fourHoursAgo > todayStart ? fourHoursAgo : todayStart).toISOString();

      const [pRes, lRes, rRes, oRes, shiftRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, customer_name, email, phone, role, is_driver, is_driver_online, cash_float')
          .eq('restaurant_id', activeRestoId)
          .or('is_driver.eq.true,role.eq.driver,role.eq.livreur'),
        supabase
          .from('driver_locations')
          .select('*')
          .eq('restaurant_id', activeRestoId),
        supabase
          .from('restaurants')
          .select('prep_time_delivery')
          .eq('id', activeRestoId)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', activeRestoId)
          .eq('order_type_id', DELIVERY_ORDER_TYPE_ID)
          .gte('created_at', cutoffIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('driver_shifts')
          .select('id, driver_id, started_at, ended_at, total_deliveries, total_cash_collected')
          .eq('restaurant_id', activeRestoId)
          .eq('is_active', false)
          .gte('ended_at', todayStart.toISOString())
          .order('ended_at', { ascending: false })
      ]);

      if (rRes.data?.prep_time_delivery) {
        setDefaultPrepTime(Number(rRes.data.prep_time_delivery));
      }

      const mergedDrivers = mergeDriversAndLocations(pRes.data || [], lRes.data || []);
      setDrivers(mergedDrivers);
      setOrders((oRes.data as DeliveryOrder[]) || []);
      setPastShifts((shiftRes.data as DriverShiftHistory[]) || []);
    } catch (err) {
      console.error('Erreur chargement Dispatch :', err);
    } finally {
      setLoading(false);
    }
  }, [activeRestoId, mergeDriversAndLocations]);

  useEffect(() => { 
    loadInitialData(); 
  }, [loadInitialData]);

  // Rafraîchissement automatique GPS toutes les 4s
  useEffect(() => {
    if (!activeRestoId) return;
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('driver_locations')
        .select('*')
        .eq('restaurant_id', activeRestoId);

      if (data && data.length > 0) {
        setDrivers(prev => mergeDriversAndLocations(prev, data));
      }
    }, 4000);

    return () => clearInterval(poll);
  }, [activeRestoId, mergeDriversAndLocations]);

  // ── FLUX TEMPS RÉEL SYNCHRONE (BROADCAST + POSTGRES) ──
  useEffect(() => {
    if (!activeRestoId) return;

    const channel = supabase.channel(`dispatch_realtime_${activeRestoId}`)
      // 1. Broadcast direct livreur (< 100ms)
      .on('broadcast', { event: 'driver_location' }, ({ payload }) => {
        if (!payload?.driver_id) return;
        setDrivers(prev => mergeDriversAndLocations(prev, [{
          driver_id: payload.driver_id,
          driver_name: payload.driver_name,
          latitude: payload.lat ?? payload.latitude,
          longitude: payload.lng ?? payload.longitude,
          heading: payload.heading,
          speed: payload.speed,
          updated_at: payload.updated_at || new Date().toISOString()
        }]));
      })

      // 2. Table driver_locations (INSERT / UPDATE)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'driver_locations', 
        filter: `restaurant_id=eq.${activeRestoId}` 
      }, (payload) => {
        if (!payload.new) return;
        setDrivers(prev => mergeDriversAndLocations(prev, [payload.new]));
      })

      // 3. Profils livreurs (En ligne & Sacoche)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'profiles', 
        filter: `restaurant_id=eq.${activeRestoId}` 
      }, (payload) => {
        const r = payload.new as any;
        if (!r?.id) return;
        setDrivers(list => list.map(d => d.id === String(r.id) ? { 
          ...d, 
          customer_name: r.customer_name || d.customer_name,
          phone: r.phone || d.phone,
          is_driver_online: Boolean(r.is_driver_online),
          cash_float: Number(r.cash_float ?? d.cash_float ?? 0) 
        } : d));
      })

      // 4. Commandes en direct (< 4h strict)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders', 
        filter: `restaurant_id=eq.${activeRestoId}` 
      }, (payload) => {
        const newOrder = payload.new as DeliveryOrder;
        const oldOrder = payload.old as DeliveryOrder;

        if (payload.eventType === 'INSERT') {
          if (newOrder.order_type_id === DELIVERY_ORDER_TYPE_ID) {
            const ageMs = Date.now() - new Date(newOrder.created_at).getTime();
            if (ageMs <= FOUR_HOURS_MS) {
              setOrders(prev => [newOrder, ...prev.filter(o => String(o.id) !== String(newOrder.id))]);
            }
          }
        } else if (payload.eventType === 'UPDATE') {
          if (newOrder.order_type_id === DELIVERY_ORDER_TYPE_ID) {
            setOrders(prev => prev.map(o => String(o.id) === String(newOrder.id) ? { ...o, ...newOrder } : o));
          } else {
            setOrders(prev => prev.filter(o => String(o.id) !== String(newOrder.id)));
          }
        } else if (payload.eventType === 'DELETE') {
          setOrders(prev => prev.filter(o => String(o.id) !== String(oldOrder.id)));
        }
      })

      // 5. Clôtures de shift
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'driver_shifts', 
        filter: `restaurant_id=eq.${activeRestoId}` 
      }, () => {
        loadInitialData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRestoId, loadInitialData, mergeDriversAndLocations]);

  // ── FILTRE DYNAMIQUE STRICT : ÉVICTION > 4 HEURES ──
  const liveActiveOrders = useMemo(() => {
    const todayStartMs = new Date().setHours(0, 0, 0, 0);
    const minTimestamp = Math.max(todayStartMs, now - FOUR_HOURS_MS);

    return orders.filter(o => {
      const orderMs = new Date(o.created_at).getTime();
      return orderMs >= minTimestamp;
    });
  }, [orders, now]);

  const filteredOrders = useMemo(() => {
    let list = liveActiveOrders;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(o => 
        String(o.order_number || o.id).toLowerCase().includes(q) || 
        String(o.customer_name || '').toLowerCase().includes(q) || 
        String(o.customer_address || '').toLowerCase().includes(q)
      );
    }
    if (filterType === 'late') {
      list = list.filter(o => (new Date(o.created_at).getTime() + Number(o.global_prep_time ?? defaultPrepTime ?? 40) * 60000) < now && o.delivery_status !== 'delivered');
    } else if (filterType === 'cash') {
      list = list.filter(o => (o.payment_method || '').toLowerCase().includes('esp') || !o.is_paid);
    } else if (filterType === 'failed') {
      list = list.filter(o => o.delivery_status === 'failed');
    }
    return list;
  }, [liveActiveOrders, searchQuery, filterType, defaultPrepTime, now]);

  const unassignedOrders = useMemo(() => filteredOrders.filter(o => 
    (!o.driver_id || o.delivery_status === 'pending' || o.delivery_status === 'failed') && 
    o.delivery_status !== 'delivered' && 
    o.status !== 'Fermé' && 
    o.status !== 'Annulée'
  ), [filteredOrders]);

  const inTransitOrders = useMemo(() => filteredOrders.filter(o => 
    (o.delivery_status === 'in_transit' || o.delivery_status === 'assigned') && 
    o.driver_id && 
    o.status !== 'Fermé'
  ), [filteredOrders]);

  const onlineDrivers = useMemo(() => drivers.filter(d => d.is_driver_online || (d.latitude && d.longitude)), [drivers]);

  const getDriverOverview = useCallback((driverId: string) => {
    const dOrders = liveActiveOrders.filter(o => String(o.driver_id) === String(driverId));
    const inTransit = dOrders.filter(o => (o.delivery_status === 'in_transit' || o.delivery_status === 'assigned') && o.status !== 'Fermé');
    const delivered = dOrders.filter(o => o.delivery_status === 'delivered' || o.status === 'Fermé');
    return {
      currentOrder: inTransit[0] || null,
      inTransitCount: inTransit.length,
      deliveredCount: delivered.length,
      totalCount: dOrders.length,
      isReturning: inTransit.length === 0 && delivered.length > 0
    };
  }, [liveActiveOrders]);

  const getFinancials = useCallback((driverId: string) => {
    const driver = drivers.find(d => String(d.id) === String(driverId));
    const inTransit = liveActiveOrders.filter(o => String(o.driver_id) === String(driverId) && (o.delivery_status === 'in_transit' || o.delivery_status === 'assigned'));
    
    const delivered = liveActiveOrders.filter(o => 
      String(o.driver_id) === String(driverId) && 
      (o.delivery_status === 'delivered' || o.status === 'Fermé') &&
      !o.is_settled
    );

    const cash = delivered
      .filter(o => (o.payment_method || '').toLowerCase().includes('esp') || (o.payment_method || '').toLowerCase().includes('cash'))
      .reduce((s, o) => s + Number(o.total_price ?? o.total_amount ?? 0), 0);

    const cb = delivered
      .filter(o => !(o.payment_method || '').toLowerCase().includes('esp') && !(o.payment_method || '').toLowerCase().includes('cash'))
      .reduce((s, o) => s + Number(o.total_price ?? o.total_amount ?? 0), 0);

    const floatVal = Number(driver?.cash_float || 0);

    return {
      count: delivered.length,
      inTransitCount: inTransit.length,
      cash: cash.toFixed(2),
      cb: cb.toFixed(2),
      total: (cash + cb).toFixed(2),
      float: floatVal.toFixed(2),
      due: (cash + floatVal).toFixed(2),
      delivered
    };
  }, [drivers, liveActiveOrders]);

  const settlementDrivers = useMemo(() => {
    return drivers.filter(d => {
      const stats = getFinancials(d.id);
      return d.is_driver_online || parseFloat(stats.due) > 0 || stats.count > 0;
    });
  }, [drivers, getFinancials]);

  const selectedDriverForSettlement = useMemo(() => {
    return drivers.find(d => String(d.id) === String(selectedDriverIdForSettlement)) || null;
  }, [drivers, selectedDriverIdForSettlement]);

  // ── ACTIONS SUPABASE ──
  const handleAssignSingle = async (orderId: string | number, driverId: string) => {
    const iso = new Date().toISOString();
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso } : o));
    setAssigningOrderId(null);
    await supabase.from('orders').update({ driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso }).eq('id', orderId);
    toast.success("Course assignée");
  };

  const handleAssignBatchTour = async (driverId: string) => {
    if (selectedOrderIdsForBatch.length === 0) return;
    const iso = new Date().toISOString();
    setOrders(prev => prev.map(o => selectedOrderIdsForBatch.includes(o.id) ? { ...o, driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso } : o));
    await supabase.from('orders').update({ driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso }).in('id', selectedOrderIdsForBatch);
    toast.success(`Tournée lancée (${selectedOrderIdsForBatch.length})`);
    setSelectedOrderIdsForBatch([]);
    setShowBatchAssignModal(false);
  };

  const handleUnassignDriver = async (orderId: string | number) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: null, delivery_status: 'pending', picked_up_at: null } : o));
    await supabase.from('orders').update({ driver_id: null, delivery_status: 'pending', picked_up_at: null }).eq('id', orderId);
    toast.info("Remise en attente");
  };

  const handleUpdateCashFloat = async (driver: DriverProfile, amt: number) => {
    const newFloat = Math.max(0, Number(driver.cash_float || 0) + amt);
    setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, cash_float: newFloat } : d));
    await supabase.from('profiles').update({ cash_float: newFloat }).eq('id', driver.id);
    toast.success(`Sacoche : ${newFloat.toFixed(2)} €`);
    setDriverForCashReload(null);
  };

  const handleSettleAndLogout = async (driver: DriverProfile) => {
    const fin = getFinancials(driver.id);
    const driverName = driver.customer_name || driver.email || 'Livreur';
    
    if (fin.inTransitCount > 0) {
      toast.error(`${driverName} a ${fin.inTransitCount} course(s) en cours`);
      return;
    }

    if (!window.confirm(`Encaisser ${fin.due} € et clôturer ${driverName} ?`)) return;

    const nowIso = new Date().toISOString();
    const deliveredOrderIds = fin.delivered.map(o => o.id);
    const collectedAmt = parseFloat(receivedCashStr) || parseFloat(fin.due);

    try {
      if (deliveredOrderIds.length > 0) {
        await supabase
          .from('orders')
          .update({ is_settled: true, settled_at: nowIso })
          .in('id', deliveredOrderIds);
      }

      await supabase
        .from('driver_shifts')
        .update({
          is_active: false,
          ended_at: nowIso,
          total_deliveries: fin.count,
          total_cash_collected: parseFloat(fin.cash)
        })
        .eq('driver_id', driver.id)
        .eq('is_active', true);

      await supabase
        .from('profiles')
        .update({ is_driver_online: false, cash_float: 0 })
        .eq('id', driver.id);

      setOrders(prev => prev.map(o => deliveredOrderIds.includes(o.id) ? { ...o, is_settled: true, settled_at: nowIso } : o));
      setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, is_driver_online: false, cash_float: 0 } : d));

      if ((window as any).electronAPI?.printReceipt) {
        (window as any).electronAPI.printReceipt({
          title: "CLÔTURE LIVREUR",
          driverName: driverName,
          date: new Date().toLocaleString('fr-FR'),
          totalCourses: fin.count,
          cashOrders: fin.cash,
          cashFloat: fin.float,
          expectedTotal: fin.due,
          collectedTotal: collectedAmt.toFixed(2),
          cbTotal: fin.cb
        });
      }

      toast.success(`Clôturé : ${driverName}`);
      setSelectedDriverIdForSettlement(null);
      setReceivedCashStr('');
      loadInitialData();
    } catch (err: any) {
      toast.error("Erreur clôture");
    }
  };

  const handlePrintPastShift = (shift: DriverShiftHistory) => {
    if (!(window as any).electronAPI?.printReceipt) {
      toast.error("Uniquement sur Caisse");
      return;
    }
    const driver = drivers.find(d => d.id === shift.driver_id);
    (window as any).electronAPI.printReceipt({
      title: "DUPLICATA CLÔTURE LIVREUR",
      driverName: driver?.customer_name || driver?.email || 'Livreur',
      date: new Date(shift.ended_at || shift.started_at).toLocaleString('fr-FR'),
      totalCourses: shift.total_deliveries || 0,
      cashOrders: Number(shift.total_cash_collected || 0).toFixed(2),
      expectedTotal: Number(shift.total_cash_collected || 0).toFixed(2)
    });
    toast.success("Duplicata imprimé");
  };

  // Sélection réactive du livreur sur la carte (se met à jour en direct quand ses coordonnées bougent)
  const targetedMapDriver = useMemo(() => {
    if (activeDriverIdForMap) {
      const found = drivers.find(d => String(d.id) === String(activeDriverIdForMap));
      if (found) return found;
    }
    return drivers.find(d => d.is_driver_online && d.latitude && d.longitude)
      || drivers.find(d => d.latitude && d.longitude)
      || drivers[0]
      || null;
  }, [activeDriverIdForMap, drivers]);

  const targetedOverview = useMemo(() => {
    return targetedMapDriver ? getDriverOverview(targetedMapDriver.id) : null;
  }, [targetedMapDriver, getDriverOverview]);

  const mapEmbedUrl = useMemo(() => {
    if (!targetedMapDriver?.latitude || !targetedMapDriver?.longitude) return '';
    const lat = Number(targetedMapDriver.latitude);
    const lng = Number(targetedMapDriver.longitude);
    if (isNaN(lat) || isNaN(lng)) return '';

    if (targetedOverview?.currentOrder?.customer_address) {
      return `https://maps.google.com/maps?saddr=${lat},${lng}&daddr=${encodeURIComponent(targetedOverview.currentOrder.customer_address)}&output=embed&hl=fr`;
    }
    return `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=16&hl=fr&output=embed`;
  }, [targetedMapDriver?.latitude, targetedMapDriver?.longitude, targetedOverview?.currentOrder?.customer_address]);

  const changeDue = useMemo(() => {
    if (!selectedDriverForSettlement) return 0;
    const needed = parseFloat(getFinancials(selectedDriverForSettlement.id).due) || 0;
    return Math.max(0, (parseFloat(receivedCashStr) || 0) - needed);
  }, [selectedDriverForSettlement, receivedCashStr, getFinancials]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0f172a] text-slate-100 font-helvetica select-none">
      
      {/* ── TOPBAR TACTILE ── */}
      <div className="bg-[#0b1329] px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0 gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSubTab('dispatch')} className={`h-11 px-4 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all active:scale-95 ${subTab === 'dispatch' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-900 text-slate-400 hover:text-white'}`}>
            <Send className="w-4 h-4" /> <span>DISPATCH ({unassignedOrders.length})</span>
          </button>
          <button onClick={() => setSubTab('map')} className={`h-11 px-4 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all active:scale-95 ${subTab === 'map' ? 'bg-amber-500 text-slate-950 shadow-md' : 'bg-slate-900 text-slate-400 hover:text-white'}`}>
            <Compass className="w-4 h-4" /> <span>CARTE ({onlineDrivers.length})</span>
          </button>
          <button onClick={() => setSubTab('settlement')} className={`h-11 px-4 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all active:scale-95 ${subTab === 'settlement' ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-900 text-slate-400 hover:text-white'}`}>
            <DollarSign className="w-4 h-4" /> <span>CAISSE ({settlementDrivers.length})</span>
          </button>
        </div>

        {subTab === 'dispatch' && (
          <div className="flex items-center gap-2">
            {selectedOrderIdsForBatch.length > 0 && (
              <button onClick={() => setShowBatchAssignModal(true)} className="h-9 px-3.5 bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase rounded-xl flex items-center gap-1.5 shadow-lg animate-pulse">
                <Layers className="w-4 h-4" /> <span>Tournée ({selectedOrderIdsForBatch.length})</span>
              </button>
            )}
            <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
              {['all', 'late', 'cash', 'failed'].map((type) => (
                <button key={type} onClick={() => setFilterType(type as any)} className={`h-8 px-2.5 rounded-lg text-[10.5px] font-black uppercase ${filterType === type ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
                  {type === 'all' ? 'Toutes' : type === 'late' ? 'Retard' : type === 'cash' ? 'Espèces' : 'Incidents'}
                </button>
              ))}
            </div>
          </div>
        )}

        {subTab === 'settlement' && (
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button 
              onClick={() => setSettlementView('pending')}
              className={`h-8 px-3 rounded-lg text-[10.5px] font-black uppercase flex items-center gap-1.5 ${settlementView === 'pending' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
            >
              <DollarSign className="w-3.5 h-3.5" /> À Régler ({settlementDrivers.length})
            </button>
            <button 
              onClick={() => setSettlementView('history')}
              className={`h-8 px-3 rounded-lg text-[10.5px] font-black uppercase flex items-center gap-1.5 ${settlementView === 'history' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
            >
              <History className="w-3.5 h-3.5" /> Clôturés ({pastShifts.length})
            </button>
          </div>
        )}

        <button onClick={loadInitialData} className="h-11 w-11 rounded-xl bg-slate-800 text-slate-200 flex items-center justify-center active:scale-95 transition-all">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
        </button>
      </div>

      {/* ── CORPS PRINCIPAL ── */}
      <div className="flex-1 overflow-hidden p-3">
        {loading ? (
          <div className="h-full flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-500" /></div>
        ) : subTab === 'dispatch' ? (

          /* 1. DISPATCH DUAL */
          <div className="h-full grid grid-cols-2 gap-3.5">
            {/* À Assigner (< 4h) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 shrink-0">
                <span className="text-xs font-black uppercase text-amber-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> À assigner ({unassignedOrders.length})
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pt-2.5 pr-1 custom-scrollbar">
                {unassignedOrders.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold py-16">Aucune commande en attente</div>
                ) : (
                  unassignedOrders.map(order => {
                    const isSel = assigningOrderId === order.id;
                    const zone = extractZone(order.customer_address);
                    const isChecked = selectedOrderIdsForBatch.includes(order.id);
                    const isIncident = order.delivery_status === 'failed';

                    return (
                      <div key={order.id} className={`bg-slate-800/90 border rounded-xl p-3 space-y-2 ${isIncident ? 'border-red-500 bg-red-950/20' : isChecked ? 'border-purple-400 bg-purple-950/20' : isSel ? 'border-amber-400' : 'border-slate-700'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setSelectedOrderIdsForBatch(prev => prev.includes(order.id) ? prev.filter(x => x !== order.id) : [...prev, order.id])} className="text-slate-400 hover:text-white">
                              {isChecked ? <CheckSquare className="w-4 h-4 text-purple-400" /> : <Square className="w-4 h-4" />}
                            </button>
                            <span className="text-xs font-black bg-blue-600 text-white px-2 py-0.5 rounded-md">#{order.order_number || String(order.id).slice(-4)}</span>
                            <span className="text-sm font-black text-white">{Number(order.total_price ?? order.total_amount ?? 0).toFixed(2)} €</span>
                            {zone && <span className="text-[10px] font-black bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-md">{zone}</span>}
                            {isIncident && <span className="text-[10px] font-black bg-red-600 text-white px-2 py-0.5 rounded animate-pulse">INCIDENT</span>}
                          </div>
                          <OrderDeliveryTimerBadge order={order} now={now} defaultPrepTime={defaultPrepTime} />
                        </div>

                        <div className="text-xs font-bold text-slate-300">
                          <p className="text-white font-black">{order.customer_name || 'Client'}</p>
                          <p className="text-slate-400 truncate flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-red-400 shrink-0" />{order.customer_address || "Adresse manquante"}</p>
                          {order.customer_address_complement && (
                            <p className="text-amber-400 text-[11px] font-semibold pl-4">{order.customer_address_complement}</p>
                          )}
                          {order.comment && (
                            <p className="text-amber-300 text-[11px] font-bold bg-amber-500/10 p-1.5 rounded mt-1">{order.comment}</p>
                          )}
                        </div>

                        {isSel ? (
                          <div className="pt-2 border-t border-slate-700 space-y-2">
                            <div className="flex items-center justify-between text-[11px] font-black uppercase text-amber-400">
                              <span>Livreur :</span>
                              <button onClick={() => setAssigningOrderId(null)} className="text-slate-400 underline">Annuler</button>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                              {drivers.map(d => (
                                <button key={d.id} onClick={() => handleAssignSingle(order.id, d.id)} className="h-11 px-2.5 bg-slate-900 hover:bg-blue-600 rounded-lg text-left text-xs font-bold text-white flex items-center justify-between border border-slate-700 active:scale-95">
                                  <span className="truncate">{d.customer_name || d.email}</span>
                                  <span className={`w-2 h-2 rounded-full ${d.is_driver_online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setAssigningOrderId(order.id)} className="w-full h-10 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs uppercase rounded-xl flex items-center justify-center gap-1.5">
                            <Send className="w-3.5 h-3.5" /> <span>{isIncident ? 'RÉASSIGNER' : 'ASSIGNER'}</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* En cours (< 4h) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 shrink-0">
                <span className="text-xs font-black uppercase text-blue-400 flex items-center gap-2">
                  <Bike className="w-4 h-4" /> En route ({inTransitOrders.length})
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pt-2.5 pr-1 custom-scrollbar">
                {inTransitOrders.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold py-16">Aucun livreur en route</div>
                ) : (
                  inTransitOrders.map(order => {
                    const assignedDriver = drivers.find(d => String(d.id) === String(order.driver_id));
                    return (
                      <div key={order.id} className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black bg-emerald-600 text-white px-2 py-0.5 rounded-md">#{order.order_number || String(order.id).slice(-4)}</span>
                          <span className="text-sm font-black text-white">{Number(order.total_price ?? order.total_amount ?? 0).toFixed(2)} €</span>
                          <OrderDeliveryTimerBadge order={order} now={now} defaultPrepTime={defaultPrepTime} />
                        </div>

                        <div className="text-xs font-bold text-slate-300">
                          <p className="text-white font-black">{order.customer_name || 'Client'}</p>
                          <p className="text-slate-400 truncate">{order.customer_address}</p>
                        </div>

                        <div className="pt-2 border-t border-slate-700 flex items-center justify-between gap-1.5">
                          <span className="text-xs font-black text-amber-300 bg-amber-500/10 px-2 py-1 rounded-lg truncate max-w-[140px]">
                            🛵 {assignedDriver?.customer_name || 'Livreur'}
                          </span>
                          <div className="flex items-center gap-1">
                            {order.customer_phone && (
                              <button onClick={() => window.open(`sms:${order.customer_phone}?body=${encodeURIComponent('Votre livreur arrive !')}`, '_blank')} className="h-8 px-2 bg-blue-600 text-white rounded-lg text-[10px] font-black">SMS</button>
                            )}
                            {assignedDriver?.phone && (
                              <a href={`tel:${assignedDriver.phone}`} className="h-8 px-2 bg-green-600 text-white rounded-lg text-[10px] font-black flex items-center gap-1"><Phone className="w-3 h-3" /></a>
                            )}
                            <button onClick={() => handleUnassignDriver(order.id)} className="h-8 px-2 bg-red-600/20 text-red-300 rounded-lg text-[10px] font-black">Retirer</button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        ) : subTab === 'map' ? (

          /* 2. CARTE DIRECTE FLOTTE */
          <div className="h-full grid grid-cols-3 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col overflow-hidden">
              <span className="text-xs font-black uppercase text-slate-400 pb-2 border-b border-slate-800">Flotte ({drivers.length})</span>
              <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1 custom-scrollbar">
                {drivers.map(d => {
                  const ov = getDriverOverview(d.id);
                  const isSel = targetedMapDriver?.id === d.id;
                  const hasGps = d.latitude !== null && d.longitude !== null;
                  return (
                    <div key={d.id} onClick={() => setActiveDriverIdForMap(d.id)} className={`p-3 rounded-xl border cursor-pointer transition-all ${isSel ? 'bg-blue-600/20 border-blue-500' : 'bg-slate-800/80 border-slate-700'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${hasGps ? 'bg-emerald-400 animate-pulse' : d.is_driver_online ? 'bg-amber-400' : 'bg-slate-600'}`} />
                          <span className="font-black text-sm text-white truncate">{d.customer_name || d.email}</span>
                        </div>
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-950 text-slate-400">
                          {formatGpsAge(d.location_updated_at, now)}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-between text-[11px] text-slate-400 font-bold border-t border-slate-700/50 pt-1.5">
                        <span>{ov.inTransitCount} en route</span>
                        <span className="text-purple-300 font-black">Sac: {Number(d.cash_float || 0).toFixed(2)}€</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="col-span-2 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col relative">
              {targetedMapDriver && (
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bike className="w-5 h-5 text-blue-400 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-black text-sm text-white block truncate">{targetedMapDriver.customer_name || targetedMapDriver.email}</span>
                      <p className="text-[11px] text-amber-300 font-bold truncate">
                        {targetedOverview?.currentOrder 
                          ? `#${targetedOverview.currentOrder.order_number} • ${targetedOverview.currentOrder.customer_address || ''}` 
                          : 'Libre'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {targetedMapDriver.latitude && targetedMapDriver.longitude && (
                      <a
                        href={`https://www.google.com/maps?q=${targetedMapDriver.latitude},${targetedMapDriver.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black flex items-center gap-1 active:scale-95"
                      >
                        <Navigation className="w-3.5 h-3.5 text-blue-400" /> <span>Maps</span>
                      </a>
                    )}
                    <button onClick={() => setDriverForCashReload(targetedMapDriver)} className="h-9 px-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1 active:scale-95">
                      <Coins className="w-3.5 h-3.5" /> <span>+ Monnaie</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="flex-1 w-full h-full">
                {mapEmbedUrl ? (
                  <iframe key={mapEmbedUrl} title="Maps" width="100%" height="100%" style={{ border: 0 }} src={mapEmbedUrl} />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs font-bold gap-2">
                    <Compass className="w-6 h-6 animate-spin text-slate-600" />
                    <span>Aucun signal GPS reçu pour ce livreur</span>
                  </div>
                )}
              </div>
            </div>
          </div>

        ) : (

          /* 3. CAISSE LIVREURS / HISTORIQUE */
          settlementView === 'pending' ? (
            <div className="h-full grid grid-cols-3 gap-3.5">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden">
                <span className="text-xs font-black uppercase text-slate-400 pb-2 border-b border-slate-800">
                  À solder ({settlementDrivers.length})
                </span>
                <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1 custom-scrollbar">
                  {settlementDrivers.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold text-center py-16">
                      Aucun compte à régler
                    </div>
                  ) : (
                    settlementDrivers.map(d => {
                      const fin = getFinancials(d.id);
                      const isSel = selectedDriverForSettlement?.id === d.id;
                      return (
                        <div key={d.id} onClick={() => { setSelectedDriverIdForSettlement(d.id); setReceivedCashStr(fin.due); }} className={`p-3 rounded-xl border cursor-pointer ${isSel ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800/80 border-slate-700'}`}>
                          <div className="flex justify-between font-black text-sm">
                            <span className="truncate">{d.customer_name || d.email}</span>
                            <span className="text-amber-400 shrink-0">{fin.due} €</span>
                          </div>
                          <div className="text-[11px] opacity-80 mt-0.5">Esp: {fin.cash}€ • Sac: {fin.float}€ ({fin.count})</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between overflow-hidden">
                {selectedDriverForSettlement ? (
                  (() => {
                    const fin = getFinancials(selectedDriverForSettlement.id);
                    return (
                      <div className="h-full flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                            <h3 className="text-xl font-black text-white">{selectedDriverForSettlement.customer_name || selectedDriverForSettlement.email}</h3>
                            <button onClick={() => setDriverForCashReload(selectedDriverForSettlement)} className="h-9 px-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-black">+ Monnaie</button>
                          </div>

                          <div className="grid grid-cols-4 gap-2.5 my-3.5">
                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
                              <span className="text-[10px] font-black uppercase text-red-400 block">Espèces</span>
                              <span className="text-xl font-black text-red-500">{fin.cash} €</span>
                            </div>
                            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 text-center">
                              <span className="text-[10px] font-black uppercase text-purple-400 block">Sacoche</span>
                              <span className="text-xl font-black text-purple-400">{fin.float} €</span>
                            </div>
                            <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-xl p-3 text-center">
                              <span className="text-[10px] font-black uppercase text-emerald-400 block">Total Dû</span>
                              <span className="text-xl font-black text-emerald-400">{fin.due} €</span>
                            </div>
                            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-center">
                              <span className="text-[10px] font-black uppercase text-slate-400 block">Total Livré</span>
                              <span className="text-xl font-black text-white">{fin.total} €</span>
                            </div>
                          </div>

                          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 mb-3 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black uppercase text-slate-400">Reçu du livreur :</span>
                              {changeDue > 0 && <span className="bg-emerald-500 text-slate-950 text-xs font-black px-2.5 py-0.5 rounded-lg">RENDRE : {changeDue.toFixed(2)} €</span>}
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={receivedCashStr}
                                  onChange={e => setReceivedCashStr(e.target.value)}
                                  placeholder={fin.due}
                                  className="w-full h-11 bg-slate-900 border border-slate-700 rounded-xl px-3 font-black text-lg text-white outline-none focus:border-emerald-500"
                                />
                                <span className="absolute right-3 top-2.5 text-slate-400 font-bold">€</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {[20, 50, 100].map(amt => (
                                  <button key={amt} onClick={() => setReceivedCashStr(String(amt))} className="h-11 px-3 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs rounded-xl active:scale-95">{amt}€</button>
                                ))}
                                <button onClick={() => setReceivedCashStr(fin.due)} className="h-11 px-3 bg-blue-600 text-white font-black text-xs rounded-xl active:scale-95">Exact</button>
                                <button onClick={() => setReceivedCashStr('')} className="h-11 px-2.5 bg-red-600/20 text-red-300 rounded-xl text-xs font-black">X</button>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                            {fin.delivered.map(o => (
                              <div key={o.id} className="bg-slate-800/80 px-3 py-1.5 rounded-lg flex justify-between text-xs font-bold">
                                <span>#{o.order_number} ({o.customer_name})</span>
                                <span className={(o.payment_method || '').toLowerCase().includes('esp') ? 'text-amber-400' : 'text-slate-300'}>
                                  {Number(o.total_price ?? o.total_amount ?? 0).toFixed(2)} € ({o.payment_method || 'CB'})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <button 
                          onClick={() => handleSettleAndLogout(selectedDriverForSettlement)} 
                          disabled={fin.inTransitCount > 0}
                          className={`w-full h-14 font-black text-sm uppercase rounded-xl flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all ${fin.inTransitCount > 0 ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'}`}
                        >
                          <CheckCircle2 className="w-5 h-5" /> 
                          <span>{fin.inTransitCount > 0 ? `EN ROUTE (${fin.inTransitCount})` : `ENCAISSER ${fin.due} € & CLÔTURER`}</span>
                        </button>
                      </div>
                    );
                  })()
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold">Sélectionnez un livreur</div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col overflow-hidden">
              <div className="flex justify-between items-center pb-3 border-b border-slate-800 shrink-0">
                <span className="text-xs font-black uppercase text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" /> Services clôturés ({pastShifts.length})
                </span>
                <span className="text-xs text-slate-400 font-bold">Total : {pastShifts.reduce((s, sh) => s + Number(sh.total_cash_collected || 0), 0).toFixed(2)} €</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pt-3 pr-1 custom-scrollbar">
                {pastShifts.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold py-16">
                    Aucune clôture aujourd'hui
                  </div>
                ) : (
                  pastShifts.map(shift => {
                    const driver = drivers.find(d => String(d.id) === String(shift.driver_id));
                    return (
                      <div key={shift.id} className="bg-slate-800 border border-slate-700 rounded-xl p-3.5 flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm text-white">{driver?.customer_name || driver?.email || 'Livreur'}</span>
                            <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded text-slate-400 font-bold">
                              {shift.ended_at ? new Date(shift.ended_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Terminé'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            {shift.total_deliveries || 0} course(s) • <strong className="text-amber-400">{Number(shift.total_cash_collected || 0).toFixed(2)} €</strong>
                          </p>
                        </div>

                        <button 
                          onClick={() => handlePrintPastShift(shift)}
                          className="h-10 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 active:scale-95"
                        >
                          <Printer className="w-4 h-4" /> <span>Ticket</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )

        )}
      </div>

      {/* ── MODALE APPOINT MONNAIE SACOCHE ── */}
      {driverForCashReload && (
        <div className="fixed inset-0 z-[999999] bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-amber-500 w-[400px] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
              <span className="font-black text-sm text-white">Sacoche : {driverForCashReload.customer_name || 'Livreur'}</span>
              <button onClick={() => setDriverForCashReload(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[10, 20, 30, 50].map(amt => (
                <button key={amt} onClick={() => setReloadAmount(amt)} className={`h-12 rounded-xl font-black text-sm border ${reloadAmount === amt ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-white border-slate-700'}`}>
                  +{amt}€
                </button>
              ))}
            </div>
            <button onClick={() => handleUpdateCashFloat(driverForCashReload, reloadAmount)} className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm uppercase rounded-xl flex items-center justify-center gap-1.5 active:scale-95">
              <CheckCircle2 className="w-4 h-4" /> <span>Ajouter +{reloadAmount} €</span>
            </button>
          </div>
        </div>
      )}

      {/* ── MODALE TOURNÉE GROUPÉE ── */}
      {showBatchAssignModal && (
        <div className="fixed inset-0 z-[999999] bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-purple-500 w-[420px] rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-black text-sm text-white">Tournée ({selectedOrderIdsForBatch.length})</span>
              <button onClick={() => setShowBatchAssignModal(false)} className="text-slate-400">✕</button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {drivers.map(d => (
                <button key={d.id} onClick={() => handleAssignBatchTour(d.id)} className="w-full h-12 px-3 bg-slate-800 hover:bg-purple-600 rounded-xl flex justify-between items-center text-xs font-black text-white active:scale-95">
                  <span>{d.customer_name || d.email}</span>
                  <span className={`w-2 h-2 rounded-full ${d.is_driver_online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default DeliveryDispatchModal;