// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { Calendar, Clock, X, Search, ChevronDown, ChevronUp, ShoppingBag, ChevronLeft, ChevronRight, CreditCard, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface OrderTrackerModalProps {
  onClose: () => void;
  onLoadOrder: (orderDetails: any[], orderId: string | number) => void;
}

const OrderTrackerModal = ({ onClose, onLoadOrder }: OrderTrackerModalProps) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | number | null>(null);
  
  // Utilitaire pour avoir la date locale correcte
  const getLocalToday = () => {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    return new Date(today.getTime() - offset).toISOString().split('T')[0];
  };

  const [filterDate, setFilterDate] = useState(getLocalToday());
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const fetchPendingOrders = async () => {
    setIsLoading(true);
    try {
      const activeRestoId = localStorage.getItem('pos_restaurant_id');
      
      // SÉCURITÉ ANTI-UNDEFINED
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
        .eq('is_paid', false) // UNIQUEMENT LES COMMANDES NON PAYÉES
        .neq('status', 'Annulée') 
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)
        .order('created_at', { ascending: sortOrder === 'asc' });

      if (error) throw error;
      setOrders(data || []);
    } catch (e) {
      toast.error("Erreur lors de la récupération des commandes");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingOrders();
  }, [filterDate, sortOrder]);

  const changeDay = (days: number) => {
    const current = new Date(filterDate);
    current.setDate(current.getDate() + days);
    const newDateStr = current.toISOString().split('T')[0];
    const todayStr = getLocalToday();

    if (newDateStr > todayStr) return;
    
    setFilterDate(newDateStr);
    setExpandedOrderId(null);
  };

  const getFormattedDateLabel = () => {
    const todayStr = getLocalToday();
    if (filterDate === todayStr) return "Aujourd'hui";
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (filterDate === yesterday.toISOString().split('T')[0]) return "Hier";

    const [year, month, day] = filterDate.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    return targetDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const toggleExpand = (id: string | number) => {
    setExpandedOrderId(prev => prev === id ? null : id);
  };

  const handleSelectOrder = (order: any) => {
    let items = [];
    try {
      items = typeof order.order_details === 'string' ? JSON.parse(order.order_details) : order.order_details;
      if (!Array.isArray(items)) items = items.items || items.cart || [items];
    } catch (e) {
      toast.error("Format de commande invalide");
      return;
    }
    onLoadOrder(items, order.id);
    onClose();
  };

  const handleQuickPay = async (e: React.MouseEvent, order: any) => {
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from('orders')
        .update({ 
          is_paid: true,
          payment_status: 'paid',
          status: 'Fermé',
          payment_method: 'Carte bancaire'
        })
        .eq('id', order.id);

      if (error) throw error;

      toast.success(`Commande #${order.order_number || order.id.toString().slice(0, 4)} encaissée par carte`);
      setOrders(prevOrders => prevOrders.filter(o => o.id !== order.id));
    } catch (err) {
      toast.error("Erreur lors de l'encaissement rapide");
    }
  };

  const handleDeleteOrder = async (e: React.MouseEvent, order: any) => {
    e.stopPropagation();
    
    const confirmDelete = window.confirm(`Voulez-vous vraiment supprimer la commande #${order.order_number || order.id.toString().slice(0, 4)} ?\nCette action est définitive.`);
    if (!confirmDelete) return;

    try {
      const { error } = await supabase
        .from('orders')
        .delete() // ON LA SUPPRIME TOTALEMENT DE LA BASE
        .eq('id', order.id);

      if (error) throw error;

      toast.success("Commande supprimée avec succès");
      setOrders(prevOrders => prevOrders.filter(o => o.id !== order.id));
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la suppression de la commande");
    }
  };

  const renderOrderDetails = (detailsRaw: any) => {
    try {
      let items = typeof detailsRaw === 'string' ? JSON.parse(detailsRaw) : detailsRaw;
      if (!Array.isArray(items)) items = items.items || items.cart || [items];

      if (!items || items.length === 0) return <p className="text-gray-400 italic">Aucun détail disponible</p>;

      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-2">
          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <ShoppingBag size={14} /> Contenu de la commande
          </h4>
          <ul className="space-y-2">
            {items.map((item: any, idx: number) => {
              const productName = item.product?.name || item.name || 'Produit inconnu';
              const qty = item.quantity || 1;
              const price = parseFloat(item.product?.price || item.price || 0);
              
              return (
                <li key={idx} className="flex justify-between items-start text-sm">
                  <div className="font-bold text-gray-700">
                    <span className="text-primary mr-2">{qty}x</span>
                    {productName}
                  </div>
                  <div className="font-black text-secondary">
                    {(price * qty).toFixed(2)} €
                  </div>
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
      <div className="bg-[#F3F4F6] w-[1200px] h-[750px] max-w-[95vw] max-h-[95vh] rounded-[1.5rem] shadow-2xl flex flex-col overflow-hidden border border-white/20">
        
        {/* EN-TÊTE : Titre et Filtres */}
        <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-black text-secondary uppercase tracking-tight">Suivi Commandes</h2>
            
            <div className="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-200 shadow-inner">
              
              {/* NAVIGATEUR DE JOURS */}
              <div className="flex items-center bg-white rounded-lg shadow-sm border border-gray-200 p-1">
                <button 
                  onClick={() => changeDay(-1)} 
                  className="p-2 hover:bg-gray-100 rounded-md transition-colors active:scale-95 text-gray-600"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                
                <div className="flex items-center gap-2 px-4 justify-center min-w-[160px]">
                  <Calendar className="text-primary w-5 h-5" />
                  <span className="font-bold text-secondary text-base capitalize">
                    {getFormattedDateLabel()}
                  </span>
                </div>

                <button 
                  onClick={() => !isToday && changeDay(1)} 
                  disabled={isToday}
                  className={`p-2 rounded-md transition-colors ${isToday ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 active:scale-95 text-gray-600'}`}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <button 
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-200 text-secondary rounded-lg font-bold text-sm active:scale-95 transition-all shadow-sm h-full"
              >
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
          ) : orders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Search size={60} className="mb-4 opacity-20" />
              <p className="text-xl font-bold italic">Aucune commande en attente pour {getFormattedDateLabel().toLowerCase()}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-black uppercase text-xs tracking-widest">
                    <th className="p-4 w-[100px]">Heure</th>
                    <th className="p-4 w-[120px]">N° Cmd</th>
                    <th className="p-4">Client / Origine</th>
                    {/* Colonne Statut supprimée ici */}
                    <th className="p-4 text-right w-[100px]">Total</th>
                    <th className="p-4 w-[300px] text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {orders.map((order) => {
                    const isApp = order.order_origin?.toLowerCase() === 'app';
                    const originLabel = isApp ? 'App' : 'Borne';
                    const clientLabel = order.customer_name || `Client ${originLabel}`;

                    return (
                      <React.Fragment key={order.id}>
                        <tr 
                          onClick={() => toggleExpand(order.id)}
                          className={`transition-colors cursor-pointer ${expandedOrderId === order.id ? 'bg-primary/5' : 'hover:bg-gray-50/80'}`}
                        >
                          <td className="p-4 font-bold text-secondary text-base">
                            {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          
                          <td className="p-4">
                            <span className="bg-gray-100 px-3 py-1.5 rounded-lg font-black text-secondary text-base border border-gray-200 shadow-sm">
                              #{order.order_number || order.id.toString().slice(0, 4)}
                            </span>
                          </td>
                          
                          <td className="p-4">
                            <div className="font-bold text-gray-800 text-base">
                              {clientLabel}
                            </div>
                            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${isApp ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                              {originLabel}
                            </span>
                          </td>
                          
                          {/* Cellule Statut supprimée ici */}
                          
                          <td className="p-4 text-right font-black text-lg text-secondary">
                            {order.total_price.toFixed(2)} €
                          </td>
                          
                          <td className="p-4 flex items-center justify-end gap-2">
                            <button 
                              onClick={(e) => handleDeleteOrder(e, order)}
                              className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 rounded-lg hover:bg-red-200 active:scale-95 transition-all shadow-sm flex-shrink-0"
                              title="Supprimer la commande"
                            >
                              <Trash2 size={18} />
                            </button>

                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all shadow-sm flex-shrink-0 ${
                              expandedOrderId === order.id ? 'bg-secondary text-white' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {expandedOrderId === order.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </div>
                            
                            {/* Bouton Ouvrir modifié : suppression de l'icône et ajustement des marges */}
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleSelectOrder(order); }}
                              className="h-10 px-4 bg-secondary text-white rounded-lg font-black uppercase text-xs hover:bg-secondary/90 active:scale-95 transition-all shadow-sm flex items-center justify-center flex-shrink-0"
                              title="Ouvrir en caisse"
                            >
                              Ouvrir
                            </button>

                            <button 
                              onClick={(e) => handleQuickPay(e, order)}
                              className="h-10 px-3 bg-[#04B855] text-white rounded-lg font-black uppercase text-xs hover:bg-[#039d48] active:scale-95 transition-all shadow-sm flex items-center gap-1 flex-shrink-0"
                              title="Payer directement par CB"
                            >
                              <CreditCard size={16} /> CB
                            </button>
                          </td>
                        </tr>

                        {expandedOrderId === order.id && (
                          <tr className="bg-gray-50/30">
                            {/* colSpan ajusté de 6 à 5 suite à la suppression de la colonne statut */}
                            <td colSpan={5} className="p-4 border-t border-gray-100">
                              {renderOrderDetails(order.order_details)}
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

      </div>
    </div>,
    document.body
  );
};

export default OrderTrackerModal;