// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Bike, MapPin, CheckCircle2, RefreshCw, Send, Banknote, AlertTriangle, Clock, Compass,
  Phone, Printer, Layers, CheckSquare, Square, Coins, X, History, Navigation, Undo2, Check, Users
} from 'lucide-react';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { ORDER_TYPE_ID } from '@/lib/orderTypes';

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
  payment_status?: string | null;
  payment_method: string | null;
  cash_amount?: number | null;
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

type PayKind = 'cash' | 'card' | 'split' | 'unpaid';

const DELIVERY_ORDER_TYPE_ID = ORDER_TYPE_ID.LIVRAISON;
// Commandes à assigner : on n'affiche que les 4 dernières heures
const DISPATCH_WINDOW_MS = 4 * 60 * 60 * 1000;
// Chargement : 16 h pour ne jamais perdre une course d'un service long (soir + après minuit) au moment de la clôture
const LOOKBACK_MS = 16 * 60 * 60 * 1000;

// ── OUTILS ──────────────────────────────────────────────────────────────────

const norm = (s: any) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const money = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;
const orderTotal = (o: DeliveryOrder) => Number(o.total_price ?? o.total_amount ?? 0);
const orderNum = (o: DeliveryOrder) => o.order_number || String(o.id).slice(-4);

const extractZone = (address: string | null) => {
  if (!address) return null;
  const m = address.match(/\b([0-9]{5})\b/);
  return m ? m[1] : null;
};

const formatGpsAge = (updatedAt?: string | null, nowMs?: number) => {
  if (!updatedAt) return 'Hors ligne';
  const diffSec = Math.max(0, Math.floor(((nowMs || Date.now()) - new Date(updatedAt).getTime()) / 1000));
  if (diffSec < 45) return 'Direct';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h`;
};

const getTargetMs = (o: DeliveryOrder, defaultPrepTime: number) => o.scheduled_time
  ? new Date(o.scheduled_time).getTime()
  : new Date(o.created_at).getTime() + (Number(o.global_prep_time ?? defaultPrepTime ?? 40) + Number(o.additional_prep_time ?? 0)) * 60000;

const isCancelled = (o: DeliveryOrder) => norm(o.status).startsWith('annul');
const isDelivered = (o: DeliveryOrder) => o.delivery_status === 'delivered' || o.status === 'Fermé';
const isEnRoute = (o: DeliveryOrder) => !!o.driver_id && (o.delivery_status === 'in_transit' || o.delivery_status === 'assigned') && !isDelivered(o);

const getPayKind = (o: DeliveryOrder): PayKind => {
  if (!o.is_paid && o.payment_status !== 'paid') return 'unpaid';
  const m = norm(o.payment_method);
  if (m.includes('fractionn') || m.includes('mixte')) return 'split';
  if (m.includes('esp') || m.includes('cash') || m === 'counter') return 'cash';
  return 'card';
};

// Pour une commande non payée : mode d'encaissement proposé par défaut au livreur
const defaultUnpaidChoice = (o: DeliveryOrder): 'cash' | 'card' => {
  const m = norm(o.payment_method);
  return (m.includes('carte') || m.includes('card') || m.includes('cb')) ? 'card' : 'cash';
};

const PAY_BADGE: Record<PayKind, { label: string; cls: string }> = {
  unpaid: { label: 'NON PAYÉ', cls: 'bg-red-600 text-white' },
  cash: { label: 'ESP', cls: 'bg-amber-500 text-slate-950' },
  split: { label: 'MIXTE', cls: 'bg-amber-500/80 text-slate-950' },
  card: { label: 'CB', cls: 'bg-slate-700 text-slate-200' },
};

const PayBadge = ({ order }: { order: DeliveryOrder }) => {
  const b = PAY_BADGE[getPayKind(order)];
  return <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase leading-none ${b.cls}`}>{b.label}</span>;
};

const TimerBadge = React.memo(({ order, now, defaultPrepTime }: { order: DeliveryOrder; now: number; defaultPrepTime: number }) => {
  const targetMs = getTargetMs(order, defaultPrepTime);
  const diffMs = targetMs - now;
  const isLate = diffMs < 0;
  const mins = Math.floor(Math.abs(diffMs) / 60000);
  const targetStr = new Date(targetMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const cls = isLate ? 'bg-red-600 text-white' : mins < 8 ? 'bg-amber-500 text-slate-950' : 'bg-slate-950 text-emerald-400 border border-slate-700';

  return (
    <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-black leading-none tabular-nums shrink-0 ${cls}`} title={`Prévu ${targetStr}`}>
      {isLate ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {isLate ? `+${mins}'` : `${mins}'`}
      <span className="opacity-70 font-bold">{targetStr}</span>
    </span>
  );
});

const Empty = ({ icon: Icon, label }: { icon: any; label: string }) => (
  <div className="h-full min-h-[160px] flex flex-col items-center justify-center gap-2 text-slate-600">
    <Icon className="w-8 h-8" />
    <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
  </div>
);

const ColumnHeader = ({ cls, icon: Icon, label, count, children }: any) => (
  <div className={`${cls} px-3 h-10 flex items-center justify-between shrink-0`}>
    <span className="text-xs font-black uppercase tracking-wide flex items-center gap-2">
      <Icon className="w-4 h-4" /> {label} <span className="opacity-80">({count})</span>
    </span>
    {children}
  </div>
);

// ── COMPOSANT ───────────────────────────────────────────────────────────────

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
  const [unpaidChoice, setUnpaidChoice] = useState<Record<string, 'cash' | 'card'>>({});
  const [isSettling, setIsSettling] = useState(false);
  const settlingRef = useRef(false);

  // Cache d'adresses réelles des livreurs (géocodage inverse : lat,lng -> rue)
  const [driverAddresses, setDriverAddresses] = useState<Record<string, string>>({});
  const reverseGeoCacheRef = useRef<Record<string, string>>({});

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

  // Géocodage inverse : coordonnées GPS du livreur -> nom de rue
  useEffect(() => {
    let isMounted = true;

    const resolveDriverStreets = async () => {
      for (const d of drivers) {
        if (!d.latitude || !d.longitude) continue;
        const coordKey = `${Number(d.latitude).toFixed(4)},${Number(d.longitude).toFixed(4)}`;

        if (reverseGeoCacheRef.current[coordKey]) {
          if (driverAddresses[d.id] !== reverseGeoCacheRef.current[coordKey]) {
            setDriverAddresses(prev => ({ ...prev, [d.id]: reverseGeoCacheRef.current[coordKey] }));
          }
          continue;
        }

        try {
          const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${d.longitude}&lat=${d.latitude}`);
          if (res.ok) {
            const data = await res.json();
            const feat = data?.features?.[0]?.properties;
            if (feat) {
              const streetLabel = feat.name
                ? `${feat.name}${feat.postcode ? ` (${feat.postcode})` : ''}`
                : feat.label || 'En déplacement';
              reverseGeoCacheRef.current[coordKey] = streetLabel;
              if (isMounted) setDriverAddresses(prev => ({ ...prev, [d.id]: streetLabel }));
            }
          }
        } catch {}
      }
    };

    resolveDriverStreets();
    return () => { isMounted = false; };
  }, [drivers]);

  // Fusion profiles + driver_locations
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
        is_driver_online: p.is_driver_online === true,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        heading: p.heading ?? null,
        speed: p.speed ?? null,
        location_updated_at: p.location_updated_at ?? null,
        cash_float: Number(p.cash_float || 0)
      });
    });

    (locationsList || []).forEach((loc: any) => {
      const dId = loc?.driver_id ? String(loc.driver_id) : null;
      if (!dId) return;

      const lat = loc.latitude !== null && loc.latitude !== undefined ? Number(loc.latitude) : null;
      const lng = loc.longitude !== null && loc.longitude !== undefined ? Number(loc.longitude) : null;
      const validCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

      // Sécurité : une position GPS n'est prise en compte que pour un livreur connu (profil livreur du restaurant).
      // Le statut "en ligne" vient UNIQUEMENT du profil, jamais d'un signal GPS.
      if (map.has(dId)) {
        const existing = map.get(dId)!;
        map.set(dId, {
          ...existing,
          customer_name: existing.customer_name || loc.driver_name || 'Livreur',
          latitude: validCoords ? lat : existing.latitude,
          longitude: validCoords ? lng : existing.longitude,
          heading: loc.heading !== null && loc.heading !== undefined ? Number(loc.heading) : existing.heading,
          speed: loc.speed !== null && loc.speed !== undefined ? Number(loc.speed) : existing.speed,
          location_updated_at: loc.updated_at || existing.location_updated_at
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.is_driver_online !== b.is_driver_online) return a.is_driver_online ? -1 : 1;
      return String(a.customer_name || '').localeCompare(String(b.customer_name || ''));
    });
  }, []);

  // ── CHARGEMENT ──
  const loadInitialData = useCallback(async () => {
    if (!activeRestoId) return;
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const cutoffIso = new Date(Date.now() - LOOKBACK_MS).toISOString();

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

      setDrivers(mergeDriversAndLocations(pRes.data || [], lRes.data || []));
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

  // Rafraîchissement GPS toutes les 4 s
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

  // ── TEMPS RÉEL ──
  useEffect(() => {
    if (!activeRestoId) return;

    const channel = supabase.channel(`dispatch_realtime_${activeRestoId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'driver_locations',
        filter: `restaurant_id=eq.${activeRestoId}`
      }, (payload) => {
        if (!payload.new) return;
        setDrivers(prev => mergeDriversAndLocations(prev, [payload.new]));
      })
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
          is_driver_online: r.is_driver_online === true,
          cash_float: Number(r.cash_float ?? d.cash_float ?? 0)
        } : d));
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `restaurant_id=eq.${activeRestoId}`
      }, (payload) => {
        const newOrder = payload.new as any;
        const oldOrder = payload.old as any;

        if (payload.eventType === 'INSERT') {
          if (newOrder.order_type_id === DELIVERY_ORDER_TYPE_ID) {
            const ageMs = Date.now() - new Date(newOrder.created_at).getTime();
            if (ageMs <= LOOKBACK_MS) {
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

  // ── DONNÉES DÉRIVÉES ──
  const isLate = useCallback((o: DeliveryOrder) => !isDelivered(o) && getTargetMs(o, defaultPrepTime) < now, [defaultPrepTime, now]);

  const matchesFilters = useCallback((o: DeliveryOrder) => {
    if (searchQuery.trim()) {
      const q = norm(searchQuery.trim());
      const hay = norm(`${o.order_number || o.id} ${o.customer_name || ''} ${o.customer_address || ''} ${o.customer_address_complement || ''} ${o.customer_phone || ''}`);
      if (!hay.includes(q)) return false;
    }
    if (filterType === 'late') return isLate(o);
    if (filterType === 'cash') return getPayKind(o) !== 'card';
    if (filterType === 'failed') return o.delivery_status === 'failed';
    return true;
  }, [searchQuery, filterType, isLate]);

  // À assigner : fenêtre de 4 h, triées par urgence (incidents d'abord)
  const unassignedOrders = useMemo(() => {
    const minTs = now - DISPATCH_WINDOW_MS;
    return orders
      .filter(o =>
        new Date(o.created_at).getTime() >= minTs &&
        (!o.driver_id || o.delivery_status === 'pending' || o.delivery_status === 'failed') &&
        !isDelivered(o) &&
        !isCancelled(o) &&
        matchesFilters(o)
      )
      .sort((a, b) => {
        const fa = a.delivery_status === 'failed' ? 0 : 1;
        const fb = b.delivery_status === 'failed' ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return getTargetMs(a, defaultPrepTime) - getTargetMs(b, defaultPrepTime);
      });
  }, [orders, now, matchesFilters, defaultPrepTime]);

  const enRouteAll = useMemo(() => orders.filter(isEnRoute), [orders]);
  const enRouteFiltered = useMemo(() => enRouteAll.filter(matchesFilters), [enRouteAll, matchesFilters]);

  const driverLoad = useMemo(() => {
    const m: Record<string, number> = {};
    enRouteAll.forEach(o => { m[String(o.driver_id)] = (m[String(o.driver_id)] || 0) + 1; });
    return m;
  }, [enRouteAll]);

  // Tournées en cours, groupées par livreur
  const tours = useMemo(() => {
    const groups: Record<string, DeliveryOrder[]> = {};
    enRouteFiltered.forEach(o => {
      const k = String(o.driver_id);
      (groups[k] = groups[k] || []).push(o);
    });
    return Object.entries(groups)
      .map(([driverId, list]) => ({
        driverId,
        driver: drivers.find(d => String(d.id) === driverId) || null,
        orders: list.sort((a, b) => getTargetMs(a, defaultPrepTime) - getTargetMs(b, defaultPrepTime))
      }))
      .sort((a, b) => getTargetMs(a.orders[0], defaultPrepTime) - getTargetMs(b.orders[0], defaultPrepTime));
  }, [enRouteFiltered, drivers, defaultPrepTime]);

  // Assignation : UNIQUEMENT les livreurs en ligne, les plus libres d'abord
  const driversForPicker = useMemo(() => drivers
    .filter(d => d.is_driver_online)
    .sort((a, b) => (driverLoad[a.id] || 0) - (driverLoad[b.id] || 0)), [drivers, driverLoad]);

  const onlineDrivers = useMemo(() => drivers.filter(d => d.is_driver_online), [drivers]);
  const freeDriversCount = useMemo(() => onlineDrivers.filter(d => !driverLoad[d.id]).length, [onlineDrivers, driverLoad]);
  const lateCount = useMemo(() => [...orders.filter(o => !o.driver_id || o.delivery_status === 'pending'), ...enRouteAll]
    .filter(o => new Date(o.created_at).getTime() >= now - DISPATCH_WINDOW_MS && !isCancelled(o) && isLate(o)).length, [orders, enRouteAll, now, isLate]);

  // Tournée d'un livreur pour la carte
  const getDriverOverview = useCallback((driverId: string) => {
    const dOrders = orders
      .filter(o => String(o.driver_id) === String(driverId) && (isEnRoute(o) || (isDelivered(o) && !o.is_settled)))
      .sort((a, b) => getTargetMs(a, defaultPrepTime) - getTargetMs(b, defaultPrepTime));

    const inTransit = dOrders.filter(isEnRoute);
    const delivered = dOrders.filter(isDelivered);

    return {
      currentOrder: inTransit[0] || null,
      inTransitOrders: inTransit,
      deliveredOrders: delivered,
      inTransitCount: inTransit.length,
      deliveredCount: delivered.length,
      totalCount: inTransit.length + delivered.length,
      currentStepNumber: delivered.length + (inTransit.length > 0 ? 1 : 0),
      isReturning: inTransit.length === 0 && delivered.length > 0
    };
  }, [orders, defaultPrepTime]);

  // Caisse livreur : ce qu'il doit remettre (espèces encaissées + sacoche de monnaie)
  const getFinancials = useCallback((driverId: string) => {
    const driver = drivers.find(d => String(d.id) === String(driverId));
    const mine = orders.filter(o => String(o.driver_id) === String(driverId));
    const inTransitCount = mine.filter(isEnRoute).length;
    const delivered = mine.filter(o => isDelivered(o) && !o.is_settled);

    let cash = 0;
    let card = 0;
    const unpaid: DeliveryOrder[] = [];

    delivered.forEach(o => {
      const total = orderTotal(o);
      const kind = getPayKind(o);
      let cashPart = 0;
      if (kind === 'cash') cashPart = total;
      else if (kind === 'split') cashPart = Math.min(total, Math.max(0, Number(o.cash_amount || 0)));
      else if (kind === 'unpaid') {
        unpaid.push(o);
        cashPart = (unpaidChoice[String(o.id)] ?? defaultUnpaidChoice(o)) === 'cash' ? total : 0;
      }
      cash += cashPart;
      card += total - cashPart;
    });

    const floatVal = Number(driver?.cash_float || 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return {
      count: delivered.length,
      inTransitCount,
      cash: r2(cash),
      card: r2(card),
      total: r2(cash + card),
      float: r2(floatVal),
      due: r2(cash + floatVal),
      delivered,
      unpaid
    };
  }, [drivers, orders, unpaidChoice]);

  const settlementDrivers = useMemo(() => drivers.filter(d => {
    const f = getFinancials(d.id);
    return d.is_driver_online || f.due > 0 || f.count > 0;
  }), [drivers, getFinancials]);

  const selectedDriverForSettlement = useMemo(
    () => drivers.find(d => String(d.id) === String(selectedDriverIdForSettlement)) || null,
    [drivers, selectedDriverIdForSettlement]
  );

  // ── ACTIONS ──
  const patchOrders = (ids: (string | number)[], patch: Partial<DeliveryOrder>) => {
    const set = new Set(ids.map(String));
    setOrders(prev => prev.map(o => set.has(String(o.id)) ? { ...o, ...patch } : o));
  };

  // Mise à jour optimiste + retour arrière si la base refuse
  const updateOrdersSafely = async (ids: (string | number)[], patch: Partial<DeliveryOrder>, okMsg: string) => {
    const set = new Set(ids.map(String));
    const backup = orders.filter(o => set.has(String(o.id)));
    patchOrders(ids, patch);
    const { error } = await supabase.from('orders').update(patch).in('id', ids);
    if (error) {
      setOrders(prev => prev.map(o => backup.find(b => String(b.id) === String(o.id)) || o));
      toast.error('Échec, réessayez');
      return false;
    }
    toast.success(okMsg);
    return true;
  };

  const handleAssign = async (ids: (string | number)[], driverId: string) => {
    if (ids.length === 0) return;
    setAssigningOrderId(null);
    setShowBatchAssignModal(false);
    const name = drivers.find(d => d.id === driverId)?.customer_name || 'Livreur';

    // 1. Vérification en direct : le livreur est-il toujours en ligne, dans ce restaurant ?
    const { data: live, error: liveErr } = await supabase
      .from('profiles')
      .select('id, is_driver_online')
      .eq('id', driverId)
      .eq('restaurant_id', activeRestoId)
      .maybeSingle();
    if (liveErr || live?.is_driver_online !== true) {
      setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, is_driver_online: false } : d));
      toast.error(`${name} n'est pas en ligne`);
      return;
    }

    // 2. Assignation : seulement les commandes encore libres (pas de vol de course)
    const patch: Partial<DeliveryOrder> = { driver_id: driverId, delivery_status: 'in_transit', picked_up_at: new Date().toISOString() };
    const idSet = new Set(ids.map(String));
    const backup = orders.filter(o => idSet.has(String(o.id)));
    patchOrders(ids, patch);

    const { data: updated, error } = await supabase
      .from('orders')
      .update(patch)
      .in('id', ids)
      .or('driver_id.is.null,delivery_status.eq.pending,delivery_status.eq.failed')
      .select('id');

    const okIds = new Set((updated || []).map((r: any) => String(r.id)));
    const failed = error ? backup : backup.filter(b => !okIds.has(String(b.id)));
    if (failed.length > 0) {
      setOrders(prev => prev.map(o => failed.find(b => String(b.id) === String(o.id)) || o));
    }

    if (error) {
      toast.error(/hors ligne/i.test(error.message || '') ? `${name} n'est pas en ligne` : 'Échec, réessayez');
      return;
    }
    if (failed.length > 0) {
      toast.error(`${failed.length} commande(s) déjà prise(s)`);
      loadInitialData();
    }
    if (okIds.size > 0) {
      toast.success(okIds.size > 1 ? `Tournée ${okIds.size} → ${name}` : `→ ${name}`);
      setSelectedOrderIdsForBatch(prev => prev.filter(id => !okIds.has(String(id))));
    }
  };

  const handleUnassign = (o: DeliveryOrder) =>
    updateOrdersSafely([o.id], { driver_id: null, delivery_status: 'pending', picked_up_at: null }, `#${orderNum(o)} remise en attente`);

  const handleMarkDelivered = (o: DeliveryOrder) =>
    updateOrdersSafely([o.id], { delivery_status: 'delivered', delivered_at: new Date().toISOString() }, `#${orderNum(o)} livrée`);

  const toggleBatch = (id: string | number) =>
    setSelectedOrderIdsForBatch(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Toucher un code postal : sélectionne toutes les commandes de la zone
  const toggleZone = (zone: string) => {
    const zoneIds = unassignedOrders.filter(o => extractZone(o.customer_address) === zone).map(o => o.id);
    const allSelected = zoneIds.every(id => selectedOrderIdsForBatch.includes(id));
    setSelectedOrderIdsForBatch(prev => allSelected
      ? prev.filter(id => !zoneIds.includes(id))
      : [...prev, ...zoneIds.filter(id => !prev.includes(id))]);
  };

  const handleUpdateCashFloat = async (driver: DriverProfile, amt: number) => {
    const before = Number(driver.cash_float || 0);
    const newFloat = Math.max(0, before + amt);
    setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, cash_float: newFloat } : d));
    setDriverForCashReload(null);
    const { error } = await supabase.from('profiles').update({ cash_float: newFloat }).eq('id', driver.id);
    if (error) {
      setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, cash_float: before } : d));
      toast.error('Échec, réessayez');
      return;
    }
    toast.success(`Sacoche ${money(newFloat)}`);
  };

  const findOpenSessionId = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('cash_sessions')
      .select('id')
      .eq('restaurant_id', activeRestoId)
      .eq('status', 'OPEN')
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  };

  const printDriverTicket = (payload: any) => {
    if (!(window as any).electronAPI?.printReceipt) return false;
    (window as any).electronAPI.printReceipt({ type: 'DRIVER_SETTLEMENT', ...payload });
    return true;
  };

  const handleSettleAndLogout = async (driver: DriverProfile) => {
    if (settlingRef.current) return;
    const fin = getFinancials(driver.id);
    const driverName = driver.customer_name || driver.email || 'Livreur';

    if (fin.inTransitCount > 0) {
      toast.error(`${driverName} : ${fin.inTransitCount} course(s) en route`);
      return;
    }
    if (!window.confirm(`Encaisser ${money(fin.due)} et clôturer ${driverName} ?`)) return;

    settlingRef.current = true;
    setIsSettling(true);
    const nowIso = new Date().toISOString();
    const collectedAmt = receivedCashStr.trim() !== '' ? (parseFloat(receivedCashStr) || 0) : fin.due;

    try {
      // 1. Les commandes non payées passent en payées (dans la session de caisse ouverte → rapport Z)
      if (fin.unpaid.length > 0) {
        const sessionId = await findOpenSessionId();
        if (!sessionId) {
          toast.error("Ouvrez la caisse d'abord");
          return;
        }
        for (const o of fin.unpaid) {
          const isCash = (unpaidChoice[String(o.id)] ?? defaultUnpaidChoice(o)) === 'cash';
          const { error } = await supabase.from('orders').update({
            is_paid: true,
            payment_status: 'paid',
            payment_method: isCash ? 'Espèces' : 'Carte bancaire',
            cash_amount: isCash ? orderTotal(o) : 0,
            session_id: sessionId
          }).eq('id', o.id);
          if (error) throw error;
        }
      }

      // 2. Courses soldées
      const deliveredIds = fin.delivered.map(o => o.id);
      if (deliveredIds.length > 0) {
        const { error } = await supabase.from('orders').update({ is_settled: true, settled_at: nowIso }).in('id', deliveredIds);
        if (error) throw error;
      }

      // 3. Fin de service
      const { error: shiftErr } = await supabase
        .from('driver_shifts')
        .update({ is_active: false, ended_at: nowIso, total_deliveries: fin.count, total_cash_collected: fin.cash })
        .eq('driver_id', driver.id)
        .eq('is_active', true);
      if (shiftErr) throw shiftErr;

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ is_driver_online: false, cash_float: 0 })
        .eq('id', driver.id);
      if (profileErr) throw profileErr;

      setOrders(prev => prev.map(o => deliveredIds.includes(o.id) ? { ...o, is_settled: true, settled_at: nowIso } : o));
      setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, is_driver_online: false, cash_float: 0 } : d));

      printDriverTicket({
        title: 'CLÔTURE LIVREUR',
        driverName,
        date: new Date().toLocaleString('fr-FR'),
        totalCourses: fin.count,
        cashOrders: fin.cash.toFixed(2),
        cbTotal: fin.card.toFixed(2),
        cashFloat: fin.float.toFixed(2),
        expectedTotal: fin.due.toFixed(2),
        collectedTotal: collectedAmt.toFixed(2),
        orders: fin.delivered.map(o => {
          const kind = getPayKind(o);
          const choice = kind === 'unpaid' ? (unpaidChoice[String(o.id)] ?? defaultUnpaidChoice(o)) : null;
          return {
            number: orderNum(o),
            client: o.customer_name || '',
            total: orderTotal(o).toFixed(2),
            mode: choice ? (choice === 'cash' ? 'ESP' : 'CB') : PAY_BADGE[kind].label
          };
        })
      });

      toast.success(`${driverName} clôturé`);
      setSelectedDriverIdForSettlement(null);
      setReceivedCashStr('');
      setUnpaidChoice({});
      loadInitialData();
    } catch (err: any) {
      console.error('Erreur clôture livreur :', err);
      toast.error(`Erreur clôture${err?.message ? ` : ${err.message}` : ''}`);
      loadInitialData();
    } finally {
      settlingRef.current = false;
      setIsSettling(false);
    }
  };

  const handlePrintPastShift = (shift: DriverShiftHistory) => {
    const driver = drivers.find(d => d.id === shift.driver_id);
    const ok = printDriverTicket({
      title: 'DUPLICATA CLÔTURE LIVREUR',
      driverName: driver?.customer_name || driver?.email || 'Livreur',
      date: new Date(shift.ended_at || shift.started_at).toLocaleString('fr-FR'),
      totalCourses: shift.total_deliveries || 0,
      cashOrders: Number(shift.total_cash_collected || 0).toFixed(2),
      expectedTotal: Number(shift.total_cash_collected || 0).toFixed(2)
    });
    if (ok) toast.success('Duplicata imprimé');
    else toast.error('Uniquement sur la caisse');
  };

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

  const targetedOverview = useMemo(
    () => targetedMapDriver ? getDriverOverview(targetedMapDriver.id) : null,
    [targetedMapDriver, getDriverOverview]
  );

  // Arrondi à ~11 m pour ne pas recharger la carte à chaque tremblement du GPS
  const mapEmbedUrl = useMemo(() => {
    if (!targetedMapDriver?.latitude || !targetedMapDriver?.longitude) return '';
    const lat = Number(targetedMapDriver.latitude).toFixed(4);
    const lng = Number(targetedMapDriver.longitude).toFixed(4);
    if (isNaN(Number(lat)) || isNaN(Number(lng))) return '';

    if (targetedOverview?.currentOrder?.customer_address) {
      return `https://maps.google.com/maps?saddr=${lat},${lng}&daddr=${encodeURIComponent(targetedOverview.currentOrder.customer_address)}&output=embed&hl=fr`;
    }
    return `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=16&hl=fr&output=embed`;
  }, [
    targetedMapDriver?.latitude ? Number(targetedMapDriver.latitude).toFixed(4) : null,
    targetedMapDriver?.longitude ? Number(targetedMapDriver.longitude).toFixed(4) : null,
    targetedOverview?.currentOrder?.customer_address
  ]);

  const openDriverOnMap = (driverId: string) => {
    setActiveDriverIdForMap(driverId);
    setSubTab('map');
  };

  const selectDriverForSettlement = (id: string) => {
    setSelectedDriverIdForSettlement(id);
    setReceivedCashStr('');
    setUnpaidChoice({});
  };

  // ── RENDU ──
  const tabBtn = (active: boolean, activeCls: string) =>
    `h-9 px-3.5 rounded-none text-xs font-black uppercase flex items-center gap-1.5 transition-all active:scale-95 shrink-0 ${active ? `${activeCls} shadow-md` : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`;

  const segBtn = (active: boolean) =>
    `h-7 px-2.5 rounded-none text-[10.5px] font-black uppercase ${active ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`;

  const settleFin = selectedDriverForSettlement ? getFinancials(selectedDriverForSettlement.id) : null;
  const receivedNum = parseFloat(receivedCashStr);
  const changeDue = settleFin && !isNaN(receivedNum) ? Math.max(0, receivedNum - settleFin.due) : 0;
  const missingCash = settleFin && !isNaN(receivedNum) && receivedCashStr.trim() !== '' ? Math.max(0, settleFin.due - receivedNum) : 0;

  return (
    <div className="flex flex-col h-full w-full bg-[#0f172a] text-slate-100 font-helvetica select-none">

      {/* ── BARRE DU HAUT ── */}
      <div className="bg-[#1e293b] px-3 h-12 border-b border-slate-700 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button onClick={() => setSubTab('dispatch')} className={tabBtn(subTab === 'dispatch', 'bg-blue-600 text-white')}>
            <Send className="w-4 h-4" /> Dispatch
          </button>
          <button onClick={() => setSubTab('map')} className={tabBtn(subTab === 'map', 'bg-amber-500 text-slate-950')}>
            <Compass className="w-4 h-4" /> Carte
          </button>
          <button onClick={() => setSubTab('settlement')} className={tabBtn(subTab === 'settlement', 'bg-[#04B855] text-white')}>
            <Banknote className="w-4 h-4" /> Caisse livreurs
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Indicateurs */}
          <span title="En retard" className={`h-8 px-2 flex items-center gap-1 text-xs font-black tabular-nums ${lateCount > 0 ? 'bg-red-600 text-white' : 'bg-slate-900 text-slate-500'}`}>
            <AlertTriangle className="w-3.5 h-3.5" /> {lateCount}
          </span>
          <span title="À assigner" className="h-8 px-2 flex items-center gap-1 text-xs font-black tabular-nums bg-slate-900 text-amber-400">
            <Send className="w-3.5 h-3.5" /> {unassignedOrders.length}
          </span>
          <span title="Livreurs libres / en ligne" className="h-8 px-2 flex items-center gap-1 text-xs font-black tabular-nums bg-slate-900 text-emerald-400">
            <Users className="w-3.5 h-3.5" /> {freeDriversCount}/{onlineDrivers.length}
          </span>

          {subTab === 'dispatch' && (
            <div className="hidden lg:flex items-center bg-slate-900 p-0.5 border border-slate-700 ml-1">
              {[['all', 'Toutes'], ['late', 'Retard'], ['cash', 'Argent'], ['failed', 'Incidents']].map(([type, label]) => (
                <button key={type} onClick={() => setFilterType(type as any)} className={segBtn(filterType === type)}>{label}</button>
              ))}
            </div>
          )}

          {subTab === 'settlement' && (
            <div className="flex items-center bg-slate-900 p-0.5 border border-slate-700 ml-1">
              <button onClick={() => setSettlementView('pending')} className={segBtn(settlementView === 'pending')}>À régler</button>
              <button onClick={() => setSettlementView('history')} className={segBtn(settlementView === 'history')}>
                <History className="w-3 h-3 inline -mt-0.5" /> {pastShifts.length}
              </button>
            </div>
          )}

          <button onClick={loadInitialData} title="Actualiser" className="h-8 w-8 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center active:scale-95 ml-1">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── CORPS ── */}
      <div className="flex-1 overflow-hidden p-2">
        {loading ? (
          <div className="h-full flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-500" /></div>
        ) : subTab === 'dispatch' ? (

          /* ═══ 1. DISPATCH ═══ */
          <div className="h-full grid grid-cols-2 gap-2">

            {/* À ASSIGNER */}
            <div className="bg-slate-900 border-2 border-slate-700 flex flex-col overflow-hidden">
              <ColumnHeader cls="bg-amber-500 text-slate-950" icon={Send} label="À assigner" count={unassignedOrders.length}>
                {selectedOrderIdsForBatch.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowBatchAssignModal(true)} className="h-7 px-2.5 bg-slate-950 text-white text-[11px] font-black uppercase flex items-center gap-1 active:scale-95">
                      <Layers className="w-3.5 h-3.5" /> Tournée ({selectedOrderIdsForBatch.length})
                    </button>
                    <button onClick={() => setSelectedOrderIdsForBatch([])} title="Vider la sélection" className="h-7 w-7 bg-black/20 flex items-center justify-center active:scale-95">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </ColumnHeader>

              <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {unassignedOrders.length === 0 ? (
                  <Empty icon={CheckCircle2} label="Rien à assigner" />
                ) : unassignedOrders.map(order => {
                  const isPicking = assigningOrderId === order.id;
                  const zone = extractZone(order.customer_address);
                  const isChecked = selectedOrderIdsForBatch.includes(order.id);
                  const isIncident = order.delivery_status === 'failed';
                  const late = isLate(order);

                  return (
                    <div key={order.id} className={`bg-slate-800/70 border-2 ${isIncident ? 'border-red-500' : isChecked ? 'border-purple-400' : isPicking ? 'border-amber-400' : late ? 'border-red-500/50' : 'border-slate-700'}`}>
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-slate-800 border-b border-slate-700">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <button onClick={() => toggleBatch(order.id)} className="text-slate-400 hover:text-white shrink-0" title="Ajouter à une tournée">
                            {isChecked ? <CheckSquare className="w-5 h-5 text-purple-400" /> : <Square className="w-5 h-5" />}
                          </button>
                          <span className="text-sm font-black text-white">#{orderNum(order)}</span>
                          <span className="text-sm font-black text-slate-300 tabular-nums">{money(orderTotal(order))}</span>
                          <PayBadge order={order} />
                          {zone && (
                            <button onClick={() => toggleZone(zone)} title="Sélectionner toute la zone" className="px-1.5 py-0.5 text-[9px] font-black leading-none bg-purple-500/20 text-purple-300 hover:bg-purple-500/40">
                              {zone}
                            </button>
                          )}
                          {isIncident && <span className="px-1.5 py-0.5 text-[9px] font-black leading-none bg-red-600 text-white">INCIDENT</span>}
                        </div>
                        <TimerBadge order={order} now={now} defaultPrepTime={defaultPrepTime} />
                      </div>

                      <div className="px-2.5 py-2 text-xs font-bold space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white font-black truncate">{order.customer_name || 'Client'}</span>
                          {order.customer_phone && <span className="text-slate-400 tabular-nums shrink-0">{order.customer_phone}</span>}
                        </div>
                        <p className="text-slate-300 flex items-start gap-1">
                          <MapPin className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          <span className="break-words">{order.customer_address || 'Adresse manquante'}</span>
                        </p>
                        {order.customer_address_complement && (
                          <p className="text-amber-400 text-[11px] pl-[18px]">{order.customer_address_complement}</p>
                        )}
                        {order.comment && (
                          <p className="text-amber-200 text-[11px] bg-amber-500/10 border-l-2 border-amber-500 px-1.5 py-1 mt-1">{order.comment}</p>
                        )}
                      </div>

                      {isPicking ? (
                        <div className="px-2 pb-2">
                          {driversForPicker.length === 0 && (
                            <div className="h-11 flex items-center justify-center gap-1.5 bg-slate-950 text-slate-500 text-[11px] font-black uppercase">
                              <Users className="w-4 h-4" /> Aucun livreur en ligne
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto custom-scrollbar">
                            {driversForPicker.map(d => {
                              const load = driverLoad[d.id] || 0;
                              return (
                                <button key={d.id} onClick={() => handleAssign([order.id], d.id)} className={`h-11 px-2 text-left text-xs font-black flex items-center justify-between gap-1 border active:scale-95 ${d.is_driver_online ? 'bg-slate-900 border-slate-600 text-white hover:bg-blue-600' : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:bg-slate-700'}`}>
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <span className={`w-2 h-2 shrink-0 ${d.is_driver_online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                    <span className="truncate">{d.customer_name || d.email}</span>
                                  </span>
                                  <span className={`px-1.5 text-[10px] tabular-nums shrink-0 ${load ? 'bg-blue-500/30 text-blue-200' : 'bg-emerald-500/20 text-emerald-300'}`}>{load || 'libre'}</span>
                                </button>
                              );
                            })}
                          </div>
                          <button onClick={() => setAssigningOrderId(null)} className="w-full h-8 mt-1 bg-slate-800 text-slate-400 text-[11px] font-black uppercase">Annuler</button>
                        </div>
                      ) : (
                        <button onClick={() => setAssigningOrderId(order.id)} className="w-full h-10 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-black text-xs uppercase flex items-center justify-center gap-1.5">
                          <Send className="w-3.5 h-3.5" /> {isIncident ? 'Réassigner' : 'Assigner'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* EN ROUTE — GROUPÉ PAR LIVREUR */}
            <div className="bg-slate-900 border-2 border-slate-700 flex flex-col overflow-hidden">
              <ColumnHeader cls="bg-blue-600 text-white" icon={Bike} label="En route" count={enRouteFiltered.length} />

              <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {tours.length === 0 ? (
                  <Empty icon={Bike} label="Aucune course en route" />
                ) : tours.map(({ driverId, driver, orders: list }) => {
                  const hasGps = driver?.latitude && driver?.longitude;
                  return (
                    <div key={driverId} className="border-2 border-slate-700 bg-slate-800/50">
                      <div className="flex items-center justify-between gap-2 px-2 h-10 bg-slate-800 border-b border-slate-700">
                        <button onClick={() => openDriverOnMap(driverId)} className="flex items-center gap-2 min-w-0 hover:text-amber-300" title="Voir sur la carte">
                          <Bike className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="font-black text-sm text-white truncate">{driver?.customer_name || 'Livreur'}</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-black bg-blue-600 text-white leading-none">{list.length}</span>
                          <span className={`text-[10px] font-black ${hasGps ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {formatGpsAge(driver?.location_updated_at, now)}
                          </span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {driver?.phone && (
                            <a href={`tel:${driver.phone}`} title={driver.phone} className="h-7 px-2 bg-emerald-600 text-white text-[10px] font-black flex items-center gap-1 tabular-nums">
                              <Phone className="w-3 h-3" /> {driver.phone}
                            </a>
                          )}
                          <button onClick={() => openDriverOnMap(driverId)} title="Carte" className="h-7 w-7 bg-slate-700 hover:bg-slate-600 flex items-center justify-center">
                            <Navigation className="w-3.5 h-3.5 text-amber-300" />
                          </button>
                        </div>
                      </div>

                      <div className="divide-y divide-slate-700/70">
                        {list.map((order, idx) => (
                          <div key={order.id} className="px-2 py-1.5 flex items-center gap-2">
                            <span className={`w-5 h-5 shrink-0 flex items-center justify-center text-[10px] font-black ${idx === 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>{idx + 1}</span>
                            <div className="min-w-0 flex-1 text-xs font-bold">
                              <div className="flex items-center gap-1.5">
                                <span className="font-black text-white">#{orderNum(order)}</span>
                                <span className="text-slate-300 tabular-nums">{money(orderTotal(order))}</span>
                                <PayBadge order={order} />
                                <TimerBadge order={order} now={now} defaultPrepTime={defaultPrepTime} />
                              </div>
                              <p className="text-slate-400 truncate">
                                {order.customer_address || 'Adresse manquante'}
                                {order.customer_address_complement && <span className="text-amber-400"> · {order.customer_address_complement}</span>}
                              </p>
                            </div>
                            <button onClick={() => handleMarkDelivered(order)} title="Marquer livrée" className="h-9 px-2.5 bg-[#04B855] hover:bg-[#039d48] text-white text-[11px] font-black uppercase flex items-center gap-1 active:scale-95 shrink-0">
                              <Check className="w-4 h-4" /> Livrée
                            </button>
                            <button onClick={() => handleUnassign(order)} title="Remettre à assigner" className="h-9 w-9 bg-slate-700 hover:bg-red-600 text-slate-200 flex items-center justify-center active:scale-95 shrink-0">
                              <Undo2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        ) : subTab === 'map' ? (

          /* ═══ 2. CARTE ═══ */
          <div className="h-full grid grid-cols-12 gap-2">

            <div className="col-span-4 bg-slate-900 border-2 border-slate-700 flex flex-col overflow-hidden">
              <ColumnHeader cls="bg-slate-800 text-slate-200" icon={Users} label="Livreurs" count={drivers.length}>
                <span className="text-[10px] font-black text-emerald-400">{onlineDrivers.length} en ligne</span>
              </ColumnHeader>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                {drivers.length === 0 ? (
                  <Empty icon={Users} label="Aucun livreur" />
                ) : drivers.map(d => {
                  const ov = getDriverOverview(d.id);
                  const isSel = targetedMapDriver?.id === d.id;
                  const hasGps = d.latitude !== null && d.longitude !== null && d.latitude !== undefined;
                  const progressPct = ov.totalCount > 0 ? Math.round((ov.deliveredCount / ov.totalCount) * 100) : 0;
                  const state = ov.inTransitCount > 0
                    ? { label: `${ov.currentStepNumber}/${ov.totalCount}`, cls: 'bg-amber-500 text-slate-950' }
                    : ov.isReturning
                    ? { label: 'Retour', cls: 'bg-purple-500/30 text-purple-200' }
                    : { label: 'Libre', cls: 'bg-emerald-500/20 text-emerald-300' };

                  return (
                    <button key={d.id} onClick={() => setActiveDriverIdForMap(d.id)} className={`w-full text-left p-2 border-2 transition-all ${isSel ? 'bg-blue-600/20 border-blue-400' : 'bg-slate-800/70 border-slate-700 hover:border-slate-500'}`}>
                      <div className="flex justify-between items-center gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`w-2.5 h-2.5 shrink-0 ${hasGps ? 'bg-emerald-400' : d.is_driver_online ? 'bg-amber-400' : 'bg-slate-600'}`} />
                          <span className="font-black text-sm text-white truncate">{d.customer_name || d.email}</span>
                        </span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-black uppercase leading-none shrink-0 ${state.cls}`}>{state.label}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-slate-400 truncate flex items-center gap-1">
                        <Navigation className="w-3 h-3 text-emerald-400 shrink-0" />
                        {driverAddresses[d.id] || (hasGps ? '…' : 'Pas de GPS')}
                        <span className="text-slate-600">· {formatGpsAge(d.location_updated_at, now)}</span>
                      </div>
                      {ov.currentOrder && (
                        <div className="text-[11px] font-black text-amber-300 truncate flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" /> #{orderNum(ov.currentOrder)} · {ov.currentOrder.customer_address}
                        </div>
                      )}
                      {ov.totalCount > 0 && (
                        <div className="w-full h-1 bg-slate-950 mt-1.5 overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-span-8 bg-slate-950 border-2 border-slate-700 overflow-hidden flex flex-col">
              {targetedMapDriver ? (
                <>
                  <div className="bg-slate-900 p-2 border-b border-slate-700 space-y-2 shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-black text-base text-white truncate">{targetedMapDriver.customer_name || targetedMapDriver.email}</span>
                        <span className="px-1.5 py-0.5 text-[10px] font-black bg-emerald-500/20 text-emerald-300 leading-none">{formatGpsAge(targetedMapDriver.location_updated_at, now)}</span>
                        {targetedMapDriver.speed ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-black bg-blue-500/20 text-blue-300 leading-none tabular-nums">{Math.round(Number(targetedMapDriver.speed) * 3.6)} km/h</span>
                        ) : null}
                        <span className="px-1.5 py-0.5 text-[10px] font-black bg-purple-500/20 text-purple-300 leading-none tabular-nums" title="Sacoche">
                          <Coins className="w-3 h-3 inline -mt-0.5" /> {money(Number(targetedMapDriver.cash_float || 0))}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {targetedMapDriver.phone && (
                          <a href={`tel:${targetedMapDriver.phone}`} className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1 tabular-nums">
                            <Phone className="w-3.5 h-3.5" /> {targetedMapDriver.phone}
                          </a>
                        )}
                        {targetedMapDriver.latitude && targetedMapDriver.longitude && (
                          <a href={`https://www.google.com/maps?q=${targetedMapDriver.latitude},${targetedMapDriver.longitude}`} target="_blank" rel="noreferrer" title="Ouvrir dans Google Maps" className="h-8 w-8 bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center">
                            <Navigation className="w-3.5 h-3.5 text-blue-400" />
                          </a>
                        )}
                        <button onClick={() => setDriverForCashReload(targetedMapDriver)} className="h-8 px-2.5 bg-amber-500 text-slate-950 text-xs font-black flex items-center gap-1 active:scale-95">
                          <Coins className="w-3.5 h-3.5" /> Monnaie
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-black">
                      <div className="bg-slate-950 border border-emerald-500/40 px-2 py-1.5 flex items-center gap-2 min-w-0">
                        <Navigation className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-white truncate">
                          {driverAddresses[targetedMapDriver.id] || (targetedMapDriver.latitude
                            ? `${Number(targetedMapDriver.latitude).toFixed(4)}, ${Number(targetedMapDriver.longitude).toFixed(4)}`
                            : 'Pas de signal GPS')}
                        </span>
                      </div>
                      <div className={`bg-slate-950 border px-2 py-1.5 flex items-center gap-2 min-w-0 ${targetedOverview?.currentOrder ? 'border-amber-500/50' : 'border-slate-800'}`}>
                        <MapPin className={`w-4 h-4 shrink-0 ${targetedOverview?.currentOrder ? 'text-amber-400' : 'text-slate-600'}`} />
                        <span className={`truncate ${targetedOverview?.currentOrder ? 'text-white' : 'text-slate-500'}`}>
                          {targetedOverview?.currentOrder
                            ? `#${orderNum(targetedOverview.currentOrder)} · ${targetedOverview.currentOrder.customer_address || '?'}${targetedOverview.currentOrder.customer_address_complement ? ` (${targetedOverview.currentOrder.customer_address_complement})` : ''}`
                            : targetedOverview?.isReturning ? 'Retour au restaurant' : 'Aucune course'}
                        </span>
                      </div>
                    </div>

                    {targetedOverview && targetedOverview.totalCount > 0 && (
                      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                        {targetedOverview.deliveredOrders.map(ord => (
                          <span key={ord.id} className="px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black shrink-0 flex items-center gap-1">
                            <Check className="w-3 h-3" /> #{orderNum(ord)}
                          </span>
                        ))}
                        {targetedOverview.inTransitOrders.map((ord, idx) => (
                          <span key={ord.id} className={`px-1.5 py-0.5 text-[10px] font-black shrink-0 flex items-center gap-1 ${idx === 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                            {idx === 0 ? <Bike className="w-3 h-3" /> : <span className="tabular-nums">{idx + 1}</span>} #{orderNum(ord)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 w-full relative">
                    {mapEmbedUrl ? (
                      <iframe key={mapEmbedUrl} title="Carte" width="100%" height="100%" style={{ border: 0 }} src={mapEmbedUrl} />
                    ) : (
                      <Empty icon={Compass} label="Pas de signal GPS" />
                    )}
                  </div>
                </>
              ) : (
                <Empty icon={Users} label="Choisissez un livreur" />
              )}
            </div>
          </div>

        ) : settlementView === 'pending' ? (

          /* ═══ 3. CAISSE LIVREURS ═══ */
          <div className="h-full grid grid-cols-3 gap-2">
            <div className="bg-slate-900 border-2 border-slate-700 flex flex-col overflow-hidden">
              <ColumnHeader cls="bg-[#04B855] text-white" icon={Banknote} label="À régler" count={settlementDrivers.length} />
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                {settlementDrivers.length === 0 ? (
                  <Empty icon={CheckCircle2} label="Tout est réglé" />
                ) : settlementDrivers.map(d => {
                  const fin = getFinancials(d.id);
                  const isSel = selectedDriverForSettlement?.id === d.id;
                  return (
                    <button key={d.id} onClick={() => selectDriverForSettlement(d.id)} className={`w-full text-left p-2.5 border-2 ${isSel ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800/70 border-slate-700 hover:border-slate-500'}`}>
                      <div className="flex justify-between items-center font-black text-sm gap-2">
                        <span className="truncate">{d.customer_name || d.email}</span>
                        <span className={`tabular-nums shrink-0 ${isSel ? 'text-white' : 'text-amber-400'}`}>{money(fin.due)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] font-black">
                        <span className="px-1 bg-slate-950/60">{fin.count} livrée(s)</span>
                        {fin.inTransitCount > 0 && <span className="px-1 bg-blue-500/30 text-blue-200">{fin.inTransitCount} en route</span>}
                        {fin.unpaid.length > 0 && <span className="px-1 bg-red-600 text-white">{fin.unpaid.length} non payée(s)</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-span-2 bg-slate-900 border-2 border-slate-700 flex flex-col overflow-hidden">
              {selectedDriverForSettlement && settleFin ? (
                <>
                  <div className="flex justify-between items-center px-3 h-11 bg-slate-800 border-b border-slate-700 shrink-0">
                    <span className="text-base font-black text-white truncate">{selectedDriverForSettlement.customer_name || selectedDriverForSettlement.email}</span>
                    <button onClick={() => setDriverForCashReload(selectedDriverForSettlement)} className="h-8 px-2.5 bg-amber-500 text-slate-950 text-xs font-black flex items-center gap-1 active:scale-95">
                      <Coins className="w-3.5 h-3.5" /> Monnaie
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Espèces', value: settleFin.cash, cls: 'border-amber-500/40 text-amber-400' },
                        { label: 'Sacoche', value: settleFin.float, cls: 'border-purple-500/40 text-purple-300' },
                        { label: 'À remettre', value: settleFin.due, cls: 'border-[#04B855] text-[#04B855] bg-[#04B855]/10' },
                        { label: 'CB', value: settleFin.card, cls: 'border-slate-600 text-slate-300' },
                      ].map(t => (
                        <div key={t.label} className={`border-2 p-2 text-center ${t.cls}`}>
                          <span className="text-[10px] font-black uppercase block opacity-80">{t.label}</span>
                          <span className="text-xl font-black tabular-nums">{money(t.value)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Commandes non payées : le livreur a encaissé, on choisit comment */}
                    {settleFin.unpaid.length > 0 && (
                      <div className="border-2 border-red-500/60">
                        <div className="px-2 h-8 bg-red-600 text-white text-[11px] font-black uppercase flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> Encaissé par le livreur
                        </div>
                        <div className="divide-y divide-slate-700">
                          {settleFin.unpaid.map(o => {
                            const choice = unpaidChoice[String(o.id)] ?? defaultUnpaidChoice(o);
                            return (
                              <div key={o.id} className="px-2 py-1.5 flex items-center justify-between gap-2 text-xs font-black">
                                <span className="truncate">#{orderNum(o)} <span className="text-slate-400 font-bold">{o.customer_name}</span></span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="tabular-nums">{money(orderTotal(o))}</span>
                                  <div className="flex border border-slate-600">
                                    {(['cash', 'card'] as const).map(c => (
                                      <button key={c} onClick={() => setUnpaidChoice(prev => ({ ...prev, [String(o.id)]: c }))} className={`h-8 px-3 text-[11px] font-black ${choice === c ? (c === 'cash' ? 'bg-amber-500 text-slate-950' : 'bg-slate-500 text-white') : 'bg-slate-900 text-slate-400'}`}>
                                        {c === 'cash' ? 'ESP' : 'CB'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-950 p-2.5 border border-slate-700 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            value={receivedCashStr}
                            onChange={e => setReceivedCashStr(e.target.value)}
                            placeholder={`Reçu · ${settleFin.due.toFixed(2)}`}
                            className="w-full h-11 bg-slate-900 border border-slate-700 px-3 font-black text-lg text-white outline-none focus:border-[#04B855] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <span className="absolute right-3 top-2.5 text-slate-500 font-bold">€</span>
                        </div>
                        {[20, 50, 100].map(amt => (
                          <button key={amt} onClick={() => setReceivedCashStr(String(amt))} className="h-11 px-3 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs active:scale-95">{amt}</button>
                        ))}
                        <button onClick={() => setReceivedCashStr(settleFin.due.toFixed(2))} className="h-11 px-3 bg-blue-600 text-white font-black text-xs active:scale-95">Exact</button>
                        <button onClick={() => setReceivedCashStr('')} className="h-11 w-11 bg-slate-800 text-slate-400 flex items-center justify-center"><X className="w-4 h-4" /></button>
                      </div>
                      {changeDue > 0 && <div className="h-8 bg-[#04B855] text-white text-sm font-black flex items-center justify-center tabular-nums">Rendre {money(changeDue)}</div>}
                      {missingCash > 0 && <div className="h-8 bg-red-600 text-white text-sm font-black flex items-center justify-center tabular-nums">Manque {money(missingCash)}</div>}
                    </div>

                    <div className="space-y-1">
                      {settleFin.delivered.length === 0 ? (
                        <p className="text-[11px] font-black uppercase text-slate-600 text-center py-4">Aucune course livrée</p>
                      ) : settleFin.delivered.map(o => (
                        <div key={o.id} className="bg-slate-800/70 px-2 py-1.5 flex justify-between items-center text-xs font-bold gap-2">
                          <span className="truncate">#{orderNum(o)} <span className="text-slate-400">{o.customer_name}</span></span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="tabular-nums">{money(orderTotal(o))}</span>
                            <PayBadge order={o} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleSettleAndLogout(selectedDriverForSettlement)}
                    disabled={settleFin.inTransitCount > 0 || isSettling}
                    className={`w-full h-14 shrink-0 font-black text-sm uppercase flex items-center justify-center gap-2 active:scale-[0.99] transition-all ${settleFin.inTransitCount > 0 || isSettling ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-[#04B855] hover:bg-[#039d48] text-white'}`}
                  >
                    {isSettling ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                    {settleFin.inTransitCount > 0 ? `${settleFin.inTransitCount} course(s) en route` : `Encaisser ${money(settleFin.due)} & clôturer`}
                  </button>
                </>
              ) : (
                <Empty icon={Banknote} label="Choisissez un livreur" />
              )}
            </div>
          </div>

        ) : (

          /* ═══ 3b. CLÔTURES DU JOUR ═══ */
          <div className="h-full bg-slate-900 border-2 border-slate-700 flex flex-col overflow-hidden">
            <ColumnHeader cls="bg-slate-800 text-slate-200" icon={History} label="Clôtures du jour" count={pastShifts.length}>
              <span className="text-xs font-black text-amber-400 tabular-nums">{money(pastShifts.reduce((s, sh) => s + Number(sh.total_cash_collected || 0), 0))}</span>
            </ColumnHeader>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
              {pastShifts.length === 0 ? (
                <Empty icon={History} label="Aucune clôture aujourd'hui" />
              ) : pastShifts.map(shift => {
                const driver = drivers.find(d => String(d.id) === String(shift.driver_id));
                return (
                  <div key={shift.id} className="bg-slate-800/70 border-2 border-slate-700 px-3 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 text-sm font-black">
                      <span className="text-white truncate">{driver?.customer_name || driver?.email || 'Livreur'}</span>
                      <span className="px-1.5 py-0.5 text-[10px] bg-slate-950 text-slate-400 tabular-nums">
                        {shift.ended_at ? new Date(shift.ended_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span className="text-xs text-slate-400">{shift.total_deliveries || 0} course(s)</span>
                      <span className="text-amber-400 tabular-nums">{money(Number(shift.total_cash_collected || 0))}</span>
                    </div>
                    <button onClick={() => handlePrintPastShift(shift)} title="Réimprimer" className="h-9 px-3 bg-slate-700 hover:bg-slate-600 text-white text-xs font-black flex items-center gap-1.5 active:scale-95 shrink-0">
                      <Printer className="w-4 h-4" /> Ticket
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── SACOCHE : AJOUT DE MONNAIE ── */}
      {driverForCashReload && (
        <div className="fixed inset-0 z-[999999] bg-black/75 flex items-center justify-center p-4" onClick={() => setDriverForCashReload(null)}>
          <div className="bg-slate-900 border-2 border-amber-500 w-[380px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-3 h-11 bg-amber-500 text-slate-950">
              <span className="font-black text-sm uppercase flex items-center gap-1.5"><Coins className="w-4 h-4" /> {driverForCashReload.customer_name || 'Livreur'}</span>
              <button onClick={() => setDriverForCashReload(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 space-y-3">
              <div className="text-center text-xs font-black text-slate-400 tabular-nums">Sacoche actuelle {money(Number(driverForCashReload.cash_float || 0))}</div>
              <div className="grid grid-cols-4 gap-1.5">
                {[10, 20, 30, 50].map(amt => (
                  <button key={amt} onClick={() => setReloadAmount(amt)} className={`h-12 font-black text-sm border-2 ${reloadAmount === amt ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-slate-800 text-white border-slate-700'}`}>
                    +{amt}
                  </button>
                ))}
              </div>
              <button onClick={() => handleUpdateCashFloat(driverForCashReload, reloadAmount)} className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm uppercase flex items-center justify-center gap-1.5 active:scale-95">
                <Check className="w-4 h-4" /> Ajouter {reloadAmount} €
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOURNÉE GROUPÉE ── */}
      {showBatchAssignModal && (
        <div className="fixed inset-0 z-[999999] bg-black/75 flex items-center justify-center p-4" onClick={() => setShowBatchAssignModal(false)}>
          <div className="bg-slate-900 border-2 border-purple-500 w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-3 h-11 bg-purple-600 text-white">
              <span className="font-black text-sm uppercase flex items-center gap-1.5"><Layers className="w-4 h-4" /> Tournée · {selectedOrderIdsForBatch.length}</span>
              <button onClick={() => setShowBatchAssignModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-2 space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
              {driversForPicker.length === 0 && (
                <div className="h-12 flex items-center justify-center gap-1.5 bg-slate-950 text-slate-500 text-xs font-black uppercase">
                  <Users className="w-4 h-4" /> Aucun livreur en ligne
                </div>
              )}
              {driversForPicker.map(d => {
                const load = driverLoad[d.id] || 0;
                return (
                  <button key={d.id} onClick={() => handleAssign(selectedOrderIdsForBatch, d.id)} className={`w-full h-12 px-3 flex justify-between items-center text-sm font-black active:scale-[0.99] border ${d.is_driver_online ? 'bg-slate-800 border-slate-700 text-white hover:bg-purple-600' : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-700'}`}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 shrink-0 ${d.is_driver_online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      <span className="truncate">{d.customer_name || d.email}</span>
                    </span>
                    <span className={`px-1.5 text-[11px] tabular-nums ${load ? 'bg-blue-500/30 text-blue-200' : 'bg-emerald-500/20 text-emerald-300'}`}>{load || 'libre'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default DeliveryDispatchModal;
