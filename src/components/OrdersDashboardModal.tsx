// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, LayoutDashboard, Clock, ShoppingBag, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
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
}

interface DashboardProps {
  onClose: () => void;
}

const getStatusBadgeStyles = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s === 'nouvelle') return 'bg-red-500 text-white border-red-600 shadow-red-500/20';
  if (s === 'en cours') return 'bg-blue-500 text-white border-blue-600 shadow-blue-500/20';
  if (s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret') return 'bg-[#04B855] text-white border-[#039d48] shadow-green-500/20';
  if (s === 'fermé' || s === 'ferme' || s === 'terminée' || s === 'terminee') return 'bg-gray-900 text-white border-gray-800 shadow-gray-900/20';
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

// Analyseur de détails ultra-robuste
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
  const [activeTab, setActiveTab] = useState<'en_cours' | 'fermees'>('en_cours');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const getTimeElapsed = (dateString: string) => {
    const orderDate = new Date(dateString);
    const diffMs = now.getTime() - orderDate.getTime();
    if (diffMs < 0) return "À l'instant";
    
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "À l'instant";
    if (diffMins < 60) return `${diffMins} min`;
    
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const loadOrders = async () => {
    try {
      const activeRestoId = localStorage.getItem('admin_override_restaurant_id') || RESTAURANT_ID;
      
      const today = new Date();
      const startOfLocalDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startOfDayISO = startOfLocalDay.toISOString(); 

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', activeRestoId)
        .gte('created_at', startOfDayISO)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data as Order[]);
    } catch (error) {
      toast.error("Erreur lors du chargement des commandes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const channel = supabase
      .channel('dashboard_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        loadOrders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Validation avec le terme exact attendu par Supabase
  const handleCompleteOrder = async (orderId: string | number) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'Fermé' }) 
        .eq('id', orderId);

      if (error) throw error;
      toast.success("Commande marquée comme terminée !");
      
      setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, status: 'Fermé' } : o));
    } catch (err) {
      toast.error("Erreur lors de la mise à jour");
    }
  };

  const getFormattedOptions = (item: any) => {
    const opts: {name: string}[] = [];
    const dynOpts = item.selectedSubOptions || item.selections;
    if (dynOpts) {
      if (Array.isArray(dynOpts)) {
        dynOpts.forEach((g: any) => {
          if (Array.isArray(g.options)) opts.push(...g.options.map((o: any) => ({ name: o.name })));
        });
      } else if (typeof dynOpts === 'object') {
        Object.values(dynOpts).forEach((arr: any) => {
          if (Array.isArray(arr)) opts.push(...arr.map((o: any) => ({ name: o.name })));
        });
      }
    }
    const grouped: Record<string, {name: string, count: number}> = {};
    opts.forEach(o => {
      const n = o.name || "Option";
      if (!grouped[n]) grouped[n] = { name: n, count: 0 };
      grouped[n].count += 1;
    });
    return Object.values(grouped).map(g => g.count > 1 ? `${g.count}x ${g.name}` : g.name);
  };

  const activeOrders = orders.filter(o => !isOrderClosed(o.status));
  const closedOrders = orders.filter(o => isOrderClosed(o.status));
  const displayedOrders = activeTab === 'en_cours' ? activeOrders : closedOrders;

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#F3F4F6] flex flex-col font-helvetica select-none">
      
      <div className="bg-white h-[90px] border-b border-gray-200 flex items-center justify-between px-8 flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-secondary text-white rounded-2xl flex items-center justify-center shadow-md">
            <LayoutDashboard size={30} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-secondary uppercase tracking-tight leading-none">Commandes du Jour</h1>
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">Tableau de bord</p>
          </div>
        </div>

        <button onClick={onClose} className="h-14 px-6 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center font-black text-lg hover:bg-red-100 active:scale-95 transition-all gap-2 border border-red-100">
          <X size={24} /> FERMER
        </button>
      </div>

      <div className="bg-white border-b border-gray-200 px-8 py-3 flex gap-4 shadow-sm z-0">
        <button onClick={() => setActiveTab('en_cours')} className={`flex items-center gap-3 px-6 py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${activeTab === 'en_cours' ? 'bg-secondary text-white shadow-md scale-[1.02]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          <Loader2 size={18} className={activeTab === 'en_cours' ? 'animate-spin-slow' : ''} />
          En cours
          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${activeTab === 'en_cours' ? 'bg-white/20' : 'bg-gray-300'}`}>{activeOrders.length}</span>
        </button>

        <button onClick={() => setActiveTab('fermees')} className={`flex items-center gap-3 px-6 py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${activeTab === 'fermees' ? 'bg-[#04B855] text-white shadow-md scale-[1.02]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
          <CheckCircle2 size={18} />
          Terminées
          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${activeTab === 'fermees' ? 'bg-white/20' : 'bg-gray-300'}`}>{closedOrders.length}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-gray-400 font-bold text-xl uppercase tracking-widest animate-pulse">Chargement...</span>
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-gray-400 font-bold text-2xl uppercase tracking-widest">Aucune commande dans cet onglet</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 content-start pb-10">
            {displayedOrders.map((order) => {
              const orderTime = new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const detailsList = parseOrderDetails(order.order_details);
              
              const s = order.status?.toLowerCase() || '';
              const isPrete = s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret';

              return (
                <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col h-[280px] overflow-hidden hover:shadow-md transition-shadow relative">
                  
                  <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-black text-secondary truncate leading-none">
                          {order.order_number || `#${order.id.toString().slice(-4)}`}
                        </h3>
                        {/* Sécurisation stricte de l'affichage Non Payé */}
                        {!order.is_paid && (
                          <span className="bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest leading-none flex-shrink-0 animate-pulse">
                            Non Payé
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Clock size={14} className="text-secondary" />
                        <span className="font-black text-secondary text-sm leading-none">{getTimeElapsed(order.created_at)}</span>
                        <span className="text-gray-400 font-bold text-[10px] leading-none">({orderTime})</span>
                      </div>
                    </div>
                    <div className={`px-2.5 py-1 rounded-lg border-b-2 font-black text-[10px] uppercase tracking-wider text-center shadow-sm flex-shrink-0 ${getStatusBadgeStyles(order.status)}`}>
                      {order.status || 'Nouvelle'}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 custom-scrollbar bg-white">
                    <ul className="space-y-2.5">
                      {detailsList.map((item: any, index: number) => {
                        const options = getFormattedOptions(item);
                        return (
                          <li key={index} className="flex flex-col border-b border-gray-50 pb-2.5 last:border-0 last:pb-0">
                            <div className="flex items-start gap-2">
                              <span className="font-black text-sm text-secondary min-w-[20px]">{item.quantity}x</span>
                              <div className="flex-1 min-w-0">
                                <span className="font-bold text-sm text-gray-800 leading-tight block">{item.product?.name || item.name}</span>
                                {options.length > 0 && (
                                  <div className="mt-0.5 space-y-0.5">
                                    {options.map((opt, i) => (
                                      <div key={i} className="text-[10px] font-bold text-blue-500 uppercase tracking-wider leading-tight">+ {opt}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className={`p-3 flex justify-between items-center ${getStatusFooterStyles(order.status)}`}>
                    <div className="flex flex-col">
                      <span className="font-bold text-[10px] uppercase tracking-widest opacity-90">Total</span>
                      <span className="text-lg font-black leading-none">{order.total_price?.toFixed(2)} €</span>
                    </div>
                    
                    {isPrete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCompleteOrder(order.id); }}
                        className="bg-white text-[#04B855] px-3 py-2 rounded-xl font-black uppercase text-[10px] tracking-wider hover:bg-gray-50 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 border border-white/20"
                      >
                        <CheckCircle2 size={14} strokeWidth={3} /> Terminer
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