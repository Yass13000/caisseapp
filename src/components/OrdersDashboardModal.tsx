// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, CheckCircle2, Loader2, MoreVertical } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
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
  customer_name?: string;
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
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | number | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<Order | null>(null);
  const [hiddenOptionNames, setHiddenOptionNames] = useState<string[]>([]);

  // VARIABLES DE FILTRAGE ASSIGNÉES EN HAUT DE COMPOSANT (SÉCURISÉ)
  const activeOrders = orders.filter(o => !isOrderClosed(o.status));
  const closedOrders = orders.filter(o => isOrderClosed(o.status));
  const displayedOrders = activeTab === 'en_cours' ? activeOrders : closedOrders;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleCloseMenus = () => setActiveMenuOrderId(null);
    window.addEventListener('click', handleCloseMenus);
    return () => window.removeEventListener('click', handleCloseMenus);
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

  const fetchHiddenOptions = async () => {
    try {
      const activeRestoId = localStorage.getItem('pos_restaurant_id');
      if (!activeRestoId) return;

      const { data: groups } = await supabase
        .from('option_groups')
        .select('id, name')
        .eq('restaurant_id', activeRestoId)
        .eq('show_on_kds', false);

      if (!groups || groups.length === 0) {
        setHiddenOptionNames([]);
        return;
      }

      const groupIds = groups.map(g => g.id);
      const namesToHide = new Set<string>();
      
      groups.forEach(g => {
        if (g.name) namesToHide.add(g.name.toLowerCase().trim());
      });

      const { data: links } = await supabase
        .from('option_group_links')
        .select('option_id')
        .in('group_id', groupIds);

      if (links && links.length > 0) {
        const optionIds = links.map(l => l.option_id);
        const { data: options } = await supabase
          .from('options')
          .select('name')
          .in('id', optionIds);

        if (options) {
          options.forEach(o => {
            if (o.name) namesToHide.add(o.name.toLowerCase().trim());
          });
        }
      }
      setHiddenOptionNames(Array.from(namesToHide));
    } catch (e) {
      console.error("Erreur options masquées:", e);
    }
  };

  const loadOrders = async () => {
    try {
      const activeRestoId = localStorage.getItem('pos_restaurant_id');
      if (!activeRestoId) {
        setIsLoading(false);
        return;
      }
      
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
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    fetchHiddenOptions();
    
    const channel = supabase
      .channel('dashboard_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadOrders)
      .subscribe();

    const optionGroupsChannel = supabase
      .channel('dashboard_optgroups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'option_groups' }, fetchHiddenOptions)
      .subscribe();

    return () => { 
      supabase.removeChannel(channel); 
      supabase.removeChannel(optionGroupsChannel);
    };
  }, []);

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

  const getOrderLines = (order: Order) => {
    const items = parseOrderDetails(order.order_details);
    const displayLines = [];
    
    items.forEach((item: any) => {
      const itemQty = item.quantity || 1;
      const productName = item.product?.name || item.name || "Produit";
      
      const dynOpts = item.selectedSubOptions || item.selections || item.options;
      const normalOptions: string[] = [];
      const kdsFalseOptions: { name: string, quantity: number }[] = [];
      
      if (dynOpts) {
        const rawOptions: { name: string, order: number }[] = [];
        let globalIndex = 0;
        
        const extractName = (o: any) => {
          if (!o) return "";
          if (typeof o === 'string') return o;
          return o.name || o.title || o.variant_name || o.value || "";
        };

        const readNode = (node: any) => {
          if (!node) return;
          if (typeof node === 'string') {
            rawOptions.push({ name: node, order: globalIndex++ });
          } else if (Array.isArray(node)) {
            node.forEach(readNode);
          } else if (typeof node === 'object') {
            if (node.options && Array.isArray(node.options)) {
              node.options.forEach(readNode);
            } else {
              const n = extractName(node);
              if (n && n.toLowerCase() !== 'option' && n.toLowerCase() !== 'options') {
                const order = node._print_order !== undefined ? node._print_order : globalIndex++;
                rawOptions.push({ name: n, order: order });
              } else if (!n || n.toLowerCase() === 'option' || n.toLowerCase() === 'options') {
                Object.values(node).forEach(readNode);
              }
            }
          }
        };

        readNode(dynOpts);
        rawOptions.sort((a, b) => a.order - b.order);

        const localGrouped: { name: string, qty: number }[] = [];
        rawOptions.forEach(opt => {
          const cleanName = typeof opt.name === 'string' ? opt.name.trim() : "";
          if (!cleanName) return;
          const existing = localGrouped.find(o => o.name.toLowerCase() === cleanName.toLowerCase());
          if (existing) {
            existing.qty += 1;
          } else {
            localGrouped.push({ name: cleanName, qty: 1 });
          }
        });

        localGrouped.forEach(opt => {
          const optNameLower = opt.name.toLowerCase().trim();
          const isHiddenOnKds = hiddenOptionNames.some(hidden => {
            const h = hidden.toLowerCase().trim();
            return optNameLower === h || optNameLower === h + 's' || optNameLower + 's' === h;
          });

          if (isHiddenOnKds) {
            kdsFalseOptions.push({
              name: opt.name,
              quantity: itemQty * opt.qty
            });
          } else {
            normalOptions.push(opt.qty > 1 ? `${opt.qty}x ${opt.name}` : opt.name);
          }
        });
      }

      displayLines.push({
        type: 'product',
        quantity: itemQty,
        name: productName,
        subOptions: normalOptions
      });

      kdsFalseOptions.forEach(kOpt => {
        displayLines.push({
          type: 'kds_false_option',
          quantity: kOpt.quantity,
          name: kOpt.name,
          subOptions: []
        });
      });
    });

    return displayLines;
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#F3F4F6] flex flex-col font-helvetica select-none rounded-none">
      
      <div className="bg-white h-[75px] border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0 shadow-sm z-10 rounded-none">
        <div className="flex gap-4">
          <button onClick={() => setActiveTab('en_cours')} className={`flex items-center gap-2 px-6 py-2.5 rounded-none font-black text-sm uppercase transition-all ${activeTab === 'en_cours' ? 'bg-secondary text-white shadow-md scale-[1.01]' : 'bg-gray-100 text-gray-500'}`}>
            <Loader2 size={16} /> En cours ({activeOrders.length})
          </button>
          <button onClick={() => setActiveTab('fermees')} className={`flex items-center gap-2 px-6 py-2.5 rounded-none font-black text-sm uppercase transition-all ${activeTab === 'fermees' ? 'bg-[#04B855] text-white shadow-md scale-[1.01]' : 'bg-gray-100 text-gray-500'}`}>
            <CheckCircle2 size={16} /> Terminées ({closedOrders.length})
          </button>
        </div>
        <button onClick={onClose} className="h-10 px-6 bg-red-50 text-red-600 rounded-none font-black border border-red-100">FERMER</button>
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
              
              // DEFINITION CORRECTE ET DECLAREE DE ISPRETE POUR LE SCOPE DU MAP
              const s = order.status?.toLowerCase() || '';
              const isPrete = s === 'prête' || s === 'prete' || s === 'prêt' || s === 'pret';

              let typeAbbr = order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' ? 'EMP' : order.order_type_id === 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d' ? 'LIV' : 'SP';
              let headerBgClass = order.order_type_id === '633425b1-f86c-4c17-8cba-b258906ad317' ? 'bg-orange-500' : order.order_type_id === '2cac3f10-73e2-40a5-a7e0-053bd861b4d9' ? 'bg-[#b07d50]' : 'bg-blue-400';
              let headerTextClass = 'text-white';
              let dotColorClass = 'text-white/80 hover:text-white hover:bg-white/20';
              const customerName = order.customer_name || "Client Caisse";

              return (
                <div key={order.id} className="bg-white rounded-none border-r border-b border-slate-700 flex flex-col h-auto overflow-hidden break-inside-avoid w-full relative">
                  
                  {/* EN-TÊTE ULTRA COMPACTE SUR 1 SEULE LIGNE */}
                  <div className={`p-2 border-b border-slate-700/30 ${headerBgClass} flex justify-between items-center w-full min-w-0 rounded-none relative`}>
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <h3 className={`text-sm font-black ${headerTextClass} truncate leading-none`}>{order.order_number || `#${order.id.toString().slice(-4)}`}</h3>
                      <span className={`px-1 py-0.5 rounded-none text-[8px] font-black uppercase bg-white/20 ${headerTextClass} leading-none flex-shrink-0`}>{typeAbbr}</span>
                      {!order.is_paid && (
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

                  {/* CORPS DU TICKET : SÉPARATION ET PROFILES GRANDS DES OPTIONS MASQUÉES KDS */}
                  <div className="bg-white rounded-none p-3 w-full space-y-1">
                    {getOrderLines(order).map((line, i) => (
                      <div key={i} className="border-b border-gray-50 py-1 flex flex-col last:border-0">
                        <div className="text-xs flex items-start truncate leading-tight">
                          <span className="mr-2 text-secondary font-black flex-shrink-0">{line.quantity}x</span> 
                          <span className={`truncate ${line.type === 'kds_false_option' ? 'text-amber-600 bg-amber-50 font-black px-1 border-l-2 border-amber-500 uppercase' : 'text-slate-800 font-bold'}`}>
                            {line.name}
                          </span>
                        </div>
                        {line.subOptions && line.subOptions.length > 0 && (
                          <div className="pl-6 space-y-0.5 mt-0.5">
                            {line.subOptions.map((opt, idx) => (
                              <div key={idx} className="text-[10px] font-bold text-blue-500 uppercase tracking-wider leading-tight">+ {opt}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* FOOTER EXTRA-COMPACT UNIQUE SUR 1 SEULE LIGNE */}
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