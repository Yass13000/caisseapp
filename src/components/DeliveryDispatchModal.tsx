// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Bike, MapPin, CheckCircle2, Power, RefreshCw, Send, DollarSign, 
  AlertCircle, Clock, Compass, AlertTriangle, Timer, Navigation, 
  Phone, Printer, Calculator, Flame, Layers, MessageCircle, 
  CheckSquare, Square, Coins, PlusCircle, X 
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
  location_updated_at?: string | null;
  cash_float?: number | null;
}

interface DeliveryOrder {
  id: string | number;
  order_number: string;
  total_price: number;
  status: string;
  delivery_status: 'pending' | 'in_transit' | 'delivered' | null;
  driver_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  is_paid: boolean;
  payment_method: string | null;
  created_at: string;
  scheduled_time?: string | null;
  global_prep_time?: number | null;
  additional_prep_time?: number | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
}

const DELIVERY_ORDER_TYPE_ID = 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d';

const extractZone = (address: string | null) => {
  if (!address) return null;
  const m = address.match(/\b(130[0-9]{2})\b/);
  return m ? m[1] : null;
};

// ── TIMERS & BADGES CONDENSÉS ──
const OrderDeliveryTimerBadge = ({ order, now, defaultPrepTime }: { order: DeliveryOrder; now: number; defaultPrepTime: number }) => {
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
        {order.scheduled_time ? `Rdv: ${targetStr}` : `Prévu: ${targetStr}`}
      </span>
      <span className={`flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-lg ${
        isLate ? 'bg-red-600 text-white animate-pulse' : mins < 8 ? 'bg-amber-500 text-slate-950 animate-pulse' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
      }`}>
        {isLate ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
        <span>{isLate ? `+${fmt}` : fmt}</span>
      </span>
    </div>
  );
};

export const DeliveryDispatchModal: React.FC<{ searchQuery?: string }> = ({ searchQuery = '' }) => {
  const [subTab, setSubTab] = useState<'dispatch' | 'map' | 'settlement'>('dispatch');
  const [filterType, setFilterType] = useState<'all' | 'late' | 'cash'>('all');
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  
  const [selectedDriverForSettlement, setSelectedDriverForSettlement] = useState<DriverProfile | null>(null);
  const [activeDriverForMap, setActiveDriverForMap] = useState<DriverProfile | null>(null);
  const [driverForCashReload, setDriverForCashReload] = useState<DriverProfile | null>(null);
  const [reloadAmount, setReloadAmount] = useState<number>(20);

  const [selectedOrderIdsForBatch, setSelectedOrderIdsForBatch] = useState<(string | number)[]>([]);
  const [showBatchAssignModal, setShowBatchAssignModal] = useState<boolean>(false);
  const [assigningOrderId, setAssigningOrderId] = useState<string | number | null>(null);
  const [defaultPrepTime, setDefaultPrepTime] = useState<number>(40);
  const [now, setNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState<boolean>(true);
  const [receivedCashStr, setReceivedCashStr] = useState<string>('');

  const activeRestoId = (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null)
    || localStorage.getItem('pos_restaurant_id')
    || RESTAURANT_ID;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── CHARGEMENT INITIAL ──
  const loadInitialData = useCallback(async () => {
    if (!activeRestoId) return;
    try {
      const [pRes, lRes, sRes, rRes] = await Promise.all([
        supabase.from('profiles').select('id, customer_name, email, phone, role, is_driver, is_driver_online, cash_float').eq('restaurant_id', activeRestoId).or('is_driver.eq.true,role.eq.driver'),
        supabase.from('driver_locations').select('driver_id, latitude, longitude, updated_at').eq('restaurant_id', activeRestoId),
        supabase.from('cash_sessions').select('opened_at').eq('restaurant_id', activeRestoId).eq('status', 'OPEN').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('restaurants').select('prep_time_delivery').eq('id', activeRestoId).maybeSingle()
      ]);

      if (rRes.data?.prep_time_delivery) setDefaultPrepTime(Number(rRes.data.prep_time_delivery));

      const lMap = (lRes.data || []).reduce((acc, l) => ({ ...acc, [l.driver_id]: l }), {});
      setDrivers((pRes.data || []).map(p => ({
        ...p,
        latitude: lMap[p.id]?.latitude || null,
        longitude: lMap[p.id]?.longitude || null,
        location_updated_at: lMap[p.id]?.updated_at || null,
        cash_float: Number(p.cash_float || 0)
      })));

      const start = sRes.data?.opened_at || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const { data: oData } = await supabase.from('orders').select('*').eq('restaurant_id', activeRestoId).eq('order_type_id', DELIVERY_ORDER_TYPE_ID).gte('created_at', start).order('created_at', { ascending: false });
      setOrders(oData || []);
    } finally {
      setLoading(false);
    }
  }, [activeRestoId]);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  // ── FLUX REALTIME UNIQUE CANALISÉ (ZÉRO MULTI-INSTANCES) ──
  useEffect(() => {
    if (!activeRestoId) return;
    const ch = supabase.channel(`dispatch_hub_${activeRestoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `restaurant_id=eq.${activeRestoId}` }, (p) => {
        const r = p.new as any;
        if (!r?.driver_id) return;
        setDrivers(dList => dList.map(d => d.id === r.driver_id ? { ...d, latitude: r.latitude, longitude: r.longitude, location_updated_at: r.updated_at } : d));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `restaurant_id=eq.${activeRestoId}` }, (p) => {
        const r = p.new as any;
        setDrivers(dList => dList.map(d => d.id === r.id ? { ...d, ...r, cash_float: Number(r.cash_float ?? d.cash_float ?? 0) } : d));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${activeRestoId}` }, (p) => {
        if (p.eventType === 'INSERT') setOrders(prev => [p.new, ...prev]);
        else if (p.eventType === 'UPDATE') setOrders(prev => prev.map(o => o.id === p.new.id ? { ...o, ...p.new } : o));
        else if (p.eventType === 'DELETE') setOrders(prev => prev.filter(o => o.id !== p.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [activeRestoId]);

  // ── FILTRES & LISTES CALCULÉES ──
  const filteredOrders = useMemo(() => {
    let list = orders;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(o => String(o.order_number || o.id).toLowerCase().includes(q) || String(o.customer_name || '').toLowerCase().includes(q) || String(o.customer_address || '').toLowerCase().includes(q));
    }
    if (filterType === 'late') list = list.filter(o => (new Date(o.created_at).getTime() + Number(o.global_prep_time ?? defaultPrepTime ?? 40) * 60000) < now && o.delivery_status !== 'delivered');
    else if (filterType === 'cash') list = list.filter(o => (o.payment_method || '').toLowerCase().includes('esp') || !o.is_paid);
    return list;
  }, [orders, searchQuery, filterType, defaultPrepTime, now]);

  const unassignedOrders = useMemo(() => filteredOrders.filter(o => !o.driver_id && o.delivery_status !== 'delivered' && o.status !== 'Fermé'), [filteredOrders]);
  const inTransitOrders = useMemo(() => filteredOrders.filter(o => o.delivery_status === 'in_transit' || (o.driver_id && o.delivery_status !== 'delivered' && o.status !== 'Fermé')), [filteredOrders]);
  const onlineDrivers = useMemo(() => drivers.filter(d => d.is_driver_online), [drivers]);

  // ── CALCUL STATS LIVREURS ──
  const getDriverOverview = useCallback((driverId: string) => {
    const dOrders = orders.filter(o => o.driver_id === driverId);
    const inTransit = dOrders.filter(o => o.delivery_status === 'in_transit' && o.status !== 'Fermé');
    const delivered = dOrders.filter(o => o.delivery_status === 'delivered' || o.status === 'Fermé');
    return {
      currentOrder: inTransit[0] || null,
      inTransitCount: inTransit.length,
      deliveredCount: delivered.length,
      totalCount: dOrders.length,
      isReturning: inTransit.length === 0 && delivered.length > 0
    };
  }, [orders]);

  const getFinancials = useCallback((driverId: string) => {
    const driver = drivers.find(d => d.id === driverId);
    const delivered = orders.filter(o => o.driver_id === driverId && (o.delivery_status === 'delivered' || o.status === 'Fermé'));
    const cash = delivered.filter(o => (o.payment_method || '').toLowerCase().includes('esp') || (o.payment_method || '').toLowerCase().includes('cash')).reduce((s, o) => s + Number(o.total_price || 0), 0);
    const cb = delivered.filter(o => !(o.payment_method || '').toLowerCase().includes('esp') && !(o.payment_method || '').toLowerCase().includes('cash')).reduce((s, o) => s + Number(o.total_price || 0), 0);
    const floatVal = Number(driver?.cash_float || 0);
    return {
      count: delivered.length,
      cash: cash.toFixed(2),
      cb: cb.toFixed(2),
      total: (cash + cb).toFixed(2),
      float: floatVal.toFixed(2),
      due: (cash + floatVal).toFixed(2),
      delivered
    };
  }, [drivers, orders]);

  // 🎯 FILTRE CLÔTURE : Ne montre que les livreurs EN LIGNE ou ayant encore des espèces / fond sacoche à rendre
  const settlementDrivers = useMemo(() => {
    return drivers.filter(d => {
      const stats = getFinancials(d.id);
      return d.is_driver_online || parseFloat(stats.due) > 0;
    });
  }, [drivers, getFinancials]);

  // ── ACTIONS SUPABASE ──
  const handleAssignSingle = async (orderId: string | number, driverId: string) => {
    const iso = new Date().toISOString();
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso } : o));
    setAssigningOrderId(null);
    await supabase.from('orders').update({ driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso }).eq('id', orderId);
    toast.success("Course assignée !");
  };

  const handleAssignBatchTour = async (driverId: string) => {
    const iso = new Date().toISOString();
    setOrders(prev => prev.map(o => selectedOrderIdsForBatch.includes(o.id) ? { ...o, driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso } : o));
    await supabase.from('orders').update({ driver_id: driverId, delivery_status: 'in_transit', picked_up_at: iso }).in('id', selectedOrderIdsForBatch);
    toast.success(`Tournée de ${selectedOrderIdsForBatch.length} courses lancée !`);
    setSelectedOrderIdsForBatch([]);
    setShowBatchAssignModal(false);
  };

  const handleUnassignDriver = async (orderId: string | number) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, driver_id: null, delivery_status: 'pending', picked_up_at: null } : o));
    await supabase.from('orders').update({ driver_id: null, delivery_status: 'pending', picked_up_at: null }).eq('id', orderId);
    toast.info("Course remise en attente");
  };

  const handleUpdateCashFloat = async (driver: DriverProfile, amt: number) => {
    const newFloat = Math.max(0, Number(driver.cash_float || 0) + amt);
    setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, cash_float: newFloat } : d));
    await supabase.from('profiles').update({ cash_float: newFloat }).eq('id', driver.id);
    toast.success(`Sacoche mise à jour : ${newFloat.toFixed(2)} €`);
    setDriverForCashReload(null);
  };

  const handleSettleAndLogout = async (driver: DriverProfile) => {
    const fin = getFinancials(driver.id);
    if (!window.confirm(`Confirmer l'encaissement de ${fin.due} € et fermer le service de ${driver.customer_name || driver.email} ?`)) return;

    // 🏁 Clôture : hors ligne + reset du fond de caisse (disparaît immédiatement de la liste)
    setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, is_driver_online: false, cash_float: 0 } : d));
    await supabase.from('profiles').update({ is_driver_online: false, cash_float: 0 }).eq('id', driver.id);

    if ((window as any).electronAPI?.printReceipt) {
      (window as any).electronAPI.printReceipt({
        title: "CLÔTURE LIVREUR", driverName: driver.customer_name || driver.email, date: new Date().toLocaleString('fr-FR'),
        totalCourses: fin.count, cashOrders: fin.cash, cashFloat: fin.float, expectedTotal: fin.due, cbTotal: fin.cb
      });
    }

    toast.success(`Session fermée pour ${driver.customer_name || 'Livreur'}`);
    setSelectedDriverForSettlement(null);
    setReceivedCashStr('');
  };

  // ── GOOGLE MAPS COMPUTED ──
  const targetedMapDriver = useMemo(() => activeDriverForMap || drivers.find(d => d.is_driver_online && d.latitude) || drivers[0] || null, [activeDriverForMap, drivers]);
  const targetedOverview = useMemo(() => targetedMapDriver ? getDriverOverview(targetedMapDriver.id) : null, [targetedMapDriver, getDriverOverview]);

  const mapEmbedUrl = useMemo(() => {
    if (!targetedMapDriver?.latitude || !targetedMapDriver?.longitude) return '';
    const { latitude: lat, longitude: lng } = targetedMapDriver;
    if (targetedOverview?.currentOrder?.customer_address) {
      return `https://maps.google.com/maps?saddr=${lat},${lng}&daddr=${encodeURIComponent(targetedOverview.currentOrder.customer_address)}&output=embed&hl=fr`;
    }
    return `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=17&hl=fr&output=embed`;
  }, [targetedMapDriver, targetedOverview]);

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
            <Compass className="w-4 h-4" /> <span>CARTE DIRECT ({onlineDrivers.length})</span>
          </button>
          <button onClick={() => setSubTab('settlement')} className={`h-11 px-4 rounded-xl text-xs font-black uppercase flex items-center gap-2 transition-all active:scale-95 ${subTab === 'settlement' ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-900 text-slate-400 hover:text-white'}`}>
            <DollarSign className="w-4 h-4" /> <span>FAIRE LES COMPTES ({settlementDrivers.length})</span>
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
              {['all', 'late', 'cash'].map((type) => (
                <button key={type} onClick={() => setFilterType(type)} className={`h-8 px-2.5 rounded-lg text-[10.5px] font-black uppercase ${filterType === type ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
                  {type === 'all' ? 'Toutes' : type === 'late' ? 'En retard' : 'Espèces'}
                </button>
              ))}
            </div>
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
            {/* Non assignées */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 shrink-0">
                <span className="text-xs font-black uppercase text-amber-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> À assigner ({unassignedOrders.length})
                </span>
                {unassignedOrders.length > 1 && <span className="text-[10px] text-slate-400 font-bold">Cocher pour grouper</span>}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pt-2.5 pr-1 custom-scrollbar">
                {unassignedOrders.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold py-16">Toutes les livraisons sont attribuées</div>
                ) : (
                  unassignedOrders.map(order => {
                    const isSel = assigningOrderId === order.id;
                    const zone = extractZone(order.customer_address);
                    const isChecked = selectedOrderIdsForBatch.includes(order.id);

                    return (
                      <div key={order.id} className={`bg-slate-800/90 border rounded-xl p-3 space-y-2 ${isChecked ? 'border-purple-400 bg-purple-950/20' : isSel ? 'border-amber-400' : 'border-slate-700'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setSelectedOrderIdsForBatch(prev => prev.includes(order.id) ? prev.filter(x => x !== order.id) : [...prev, order.id])} className="text-slate-400 hover:text-white">
                              {isChecked ? <CheckSquare className="w-4 h-4 text-purple-400" /> : <Square className="w-4 h-4" />}
                            </button>
                            <span className="text-xs font-black bg-blue-600 text-white px-2 py-0.5 rounded-md">#{order.order_number || String(order.id).slice(-4)}</span>
                            <span className="text-sm font-black text-white">{Number(order.total_price || 0).toFixed(2)} €</span>
                            {zone && <span className="text-[10px] font-black bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-md">{zone}</span>}
                          </div>
                          <OrderDeliveryTimerBadge order={order} now={now} defaultPrepTime={defaultPrepTime} />
                        </div>

                        <div className="text-xs font-bold text-slate-300">
                          <p className="text-white font-black">{order.customer_name || 'Client'}</p>
                          <p className="text-slate-400 truncate flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-red-400 shrink-0" />{order.customer_address || "Adresse manquante"}</p>
                        </div>

                        {isSel ? (
                          <div className="pt-2 border-t border-slate-700 space-y-2">
                            <div className="flex items-center justify-between text-[11px] font-black uppercase text-amber-400">
                              <span>Choisir le livreur :</span>
                              <button onClick={() => setAssigningOrderId(null)} className="text-slate-400 underline">Annuler</button>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                              {drivers.map(d => (
                                <button key={d.id} onClick={() => handleAssignSingle(order.id, d.id)} className="h-12 px-2.5 bg-slate-900 hover:bg-blue-600 rounded-lg text-left text-xs font-bold text-white flex items-center justify-between border border-slate-700 active:scale-95">
                                  <span className="truncate">{d.customer_name || d.email}</span>
                                  <span className={`w-2 h-2 rounded-full ${d.is_driver_online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setAssigningOrderId(order.id)} className="w-full h-11 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs uppercase rounded-xl flex items-center justify-center gap-1.5">
                            <Send className="w-4 h-4" /> <span>ASSIGNER</span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* En transit */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 shrink-0">
                <span className="text-xs font-black uppercase text-blue-400 flex items-center gap-2">
                  <Bike className="w-4 h-4" /> En cours ({inTransitOrders.length})
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pt-2.5 pr-1 custom-scrollbar">
                {inTransitOrders.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold py-16">Aucun livreur en route</div>
                ) : (
                  inTransitOrders.map(order => {
                    const assignedDriver = drivers.find(d => d.id === order.driver_id);
                    return (
                      <div key={order.id} className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black bg-emerald-600 text-white px-2 py-0.5 rounded-md">#{order.order_number || String(order.id).slice(-4)}</span>
                          <span className="text-sm font-black text-white">{Number(order.total_price || 0).toFixed(2)} €</span>
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
                            <button onClick={() => handleUnassignDriver(order.id)} className="h-8 px-2 bg-red-600/20 text-red-300 rounded-lg text-[10px] font-black">Annuler</button>
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

          /* 2. CARTE INTERACTIVE DIRECTE */
          <div className="h-full grid grid-cols-3 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col overflow-hidden">
              <span className="text-xs font-black uppercase text-slate-400 pb-2 border-b border-slate-800">Flotte ({drivers.length})</span>
              <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1 custom-scrollbar">
                {drivers.map(d => {
                  const ov = getDriverOverview(d.id);
                  const isSel = targetedMapDriver?.id === d.id;
                  return (
                    <div key={d.id} onClick={() => setActiveDriverForMap(d)} className={`p-3 rounded-xl border cursor-pointer ${isSel ? 'bg-blue-600/20 border-blue-500' : 'bg-slate-800/80 border-slate-700'}`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${d.is_driver_online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          <span className="font-black text-sm text-white">{d.customer_name || d.email}</span>
                        </div>
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-950 text-slate-400">{ov.isReturning ? 'RETOUR' : d.is_driver_online ? 'EN LIGNE' : 'OFF'}</span>
                      </div>
                      <div className="mt-2 flex justify-between text-[11px] text-slate-400 font-bold border-t border-slate-700/50 pt-1.5">
                        <span>Courses: {ov.inTransitCount} en route</span>
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
                  <div className="flex items-center gap-2">
                    <Bike className="w-5 h-5 text-blue-400" />
                    <div>
                      <span className="font-black text-sm text-white">{targetedMapDriver.customer_name || targetedMapDriver.email}</span>
                      <p className="text-[11px] text-amber-300 font-bold">
                        {targetedOverview?.currentOrder ? `Vers #${targetedOverview.currentOrder.order_number} • ${targetedOverview.currentOrder.customer_address}` : 'En attente de course'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setDriverForCashReload(targetedMapDriver)} className="h-9 px-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1 active:scale-95">
                    <Coins className="w-3.5 h-3.5" /> <span>+ Monnaie</span>
                  </button>
                </div>
              )}
              <div className="flex-1 w-full h-full">
                {mapEmbedUrl ? (
                  <iframe key={mapEmbedUrl} title="Maps" width="100%" height="100%" style={{ border: 0 }} src={mapEmbedUrl} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm font-bold">Signal GPS en attente</div>
                )}
              </div>
            </div>
          </div>

        ) : (

          /* 3. FAIRE LES COMPTES : SEULS LES LIVREURS AVEC DETTE S'AFFICHENT */
          <div className="h-full grid grid-cols-3 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden">
              <span className="text-xs font-black uppercase text-slate-400 pb-2 border-b border-slate-800">Livreurs à encaisser ({settlementDrivers.length})</span>
              <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1 custom-scrollbar">
                {settlementDrivers.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs font-bold text-center py-16">
                    Tous les comptes sont réglés et clôturés
                  </div>
                ) : (
                  settlementDrivers.map(d => {
                    const fin = getFinancials(d.id);
                    const isSel = selectedDriverForSettlement?.id === d.id;
                    return (
                      <div key={d.id} onClick={() => { setSelectedDriverForSettlement(d); setReceivedCashStr(''); }} className={`p-3 rounded-xl border cursor-pointer ${isSel ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800/80 border-slate-700'}`}>
                        <div className="flex justify-between font-black text-sm">
                          <span>{d.customer_name || d.email}</span>
                          <span className="text-amber-400">{fin.due} €</span>
                        </div>
                        <div className="text-[11px] opacity-80 mt-0.5">Ventes: {fin.cash}€ • Sacoche: {fin.float}€</div>
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
                          <div>
                            <h3 className="text-xl font-black text-white">{selectedDriverForSettlement.customer_name || selectedDriverForSettlement.email}</h3>
                            <span className="text-xs text-slate-400 font-bold">Règlement et fin de service</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setDriverForCashReload(selectedDriverForSettlement)} className="h-9 px-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-black">+ Monnaie</button>
                            <button onClick={() => (window as any).electronAPI?.printReceipt && handleSettleAndLogout(selectedDriverForSettlement)} className="h-9 px-3 bg-slate-800 text-white rounded-xl text-xs font-black"><Printer className="w-4 h-4" /></button>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2.5 my-3.5">
                          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
                            <span className="text-[10px] font-black uppercase text-red-400 block">Ventes Espèces</span>
                            <span className="text-xl font-black text-red-500">{fin.cash} €</span>
                          </div>
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 text-center">
                            <span className="text-[10px] font-black uppercase text-purple-400 block">Fond Sacoche</span>
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

                        {/* Calculatrice Rendu */}
                        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 mb-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-black uppercase text-slate-400">Espèces données par le livreur :</span>
                            {changeDue > 0 && <span className="bg-emerald-500 text-slate-950 text-xs font-black px-2.5 py-0.5 rounded-lg animate-bounce">RENDRE : {changeDue.toFixed(2)} €</span>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {[20, 50, 100].map(amt => (
                              <button key={amt} onClick={() => setReceivedCashStr(String(amt))} className="h-9 flex-1 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs rounded-xl">{amt}€</button>
                            ))}
                            <button onClick={() => setReceivedCashStr(fin.due)} className="h-9 px-3 bg-blue-600 text-white font-black text-xs rounded-xl">Compte Juste</button>
                            <button onClick={() => setReceivedCashStr('')} className="h-9 px-2.5 bg-red-600/20 text-red-300 rounded-xl text-xs font-black">X</button>
                          </div>
                        </div>

                        <div className="space-y-1 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                          {fin.delivered.map(o => (
                            <div key={o.id} className="bg-slate-800/80 px-3 py-1 rounded-lg flex justify-between text-xs font-bold">
                              <span>#{o.order_number} ({o.customer_name})</span>
                              <span>{Number(o.total_price).toFixed(2)} € ({o.payment_method || 'CB'})</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <button onClick={() => handleSettleAndLogout(selectedDriverForSettlement)} className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-sm uppercase rounded-xl flex items-center justify-center gap-2 shadow-xl">
                        <CheckCircle2 className="w-5 h-5" /> <span>ENCAISSER {fin.due} € & FERMER SERVICE</span>
                      </button>
                    </div>
                  );
                })()
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm font-bold">Sélectionnez un livreur à gauche</div>
              )}
            </div>
          </div>

        )}
      </div>

      {/* ── MODALE APPOINT MONNAIE SACOCHE ── */}
      {driverForCashReload && (
        <div className="fixed inset-0 z-[999999] bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-amber-500 w-[420px] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
              <span className="font-black text-sm text-white">Appoint Monnaie : {driverForCashReload.customer_name || 'Livreur'}</span>
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
              <CheckCircle2 className="w-4 h-4" /> <span>Valider (+{reloadAmount} €)</span>
            </button>
          </div>
        </div>
      )}

      {/* ── MODALE BATCH TOURNÉE ── */}
      {showBatchAssignModal && (
        <div className="fixed inset-0 z-[999999] bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-purple-500 w-[460px] rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <span className="font-black text-sm text-white">Lancer tournée ({selectedOrderIdsForBatch.length} commandes)</span>
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