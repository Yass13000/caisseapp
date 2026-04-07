// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { Calendar, Clock, X, Search, ChevronDown, ChevronUp, ShoppingBag, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface OrderHistoryModalProps {
  onClose: () => void;
}

const OrderHistoryModal = ({ onClose }: OrderHistoryModalProps) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | number | null>(null);
  
  // Utilitaire pour obtenir la date locale correcte (YYYY-MM-DD)
  const getLocalToday = () => {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    return new Date(today.getTime() - offset).toISOString().split('T')[0];
  };

  const [filterDate, setFilterDate] = useState(getLocalToday());
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const activeRestoId = localStorage.getItem('admin_override_restaurant_id') || RESTAURANT_ID;
      
      // --- CORRECTION DU FUSEAU HORAIRE ---
      const [year, month, day] = filterDate.split('-').map(Number);
      
      const startOfDayLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
      const endOfDayLocal = new Date(year, month - 1, day, 23, 59, 59, 999);

      // On convertit en UTC pour la base de données
      const startOfDay = startOfDayLocal.toISOString();
      const endOfDay = endOfDayLocal.toISOString();
      // ------------------------------------

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', activeRestoId)
        .eq('is_paid', true) // Uniquement les commandes payées
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

  useEffect(() => {
    fetchHistory();
  }, [filterDate, sortOrder]);

  const changeDay = (days: number) => {
    const [year, month, day] = filterDate.split('-').map(Number);
    const date = new Date(year, month - 1, day + days);
    const newDateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    
    // Bloquer les jours dans le futur
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

  // NOUVEAU : Traduire les méthodes de paiement pour un affichage propre
  const getPaymentMethodLabel = (method: string) => {
    if (!method) return 'N/A';
    const m = method.toLowerCase();
    if (m === 'counter' || m === 'espèces') return 'Espèces';
    if (m === 'card' || m === 'carte bancaire') return 'Carte Bancaire';
    return method;
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
            <h2 className="text-2xl font-black text-secondary uppercase tracking-tight">Historique des Ventes</h2>
            
            <div className="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-200 shadow-inner">
              
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

                {/* Bouton pour aller vers le futur désactivé si on est déjà "Aujourd'hui" */}
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

        {/* CORPS : Tableau de l'historique */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
              <p className="text-gray-400 font-bold text-base">Recherche des tickets...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Search size={60} className="mb-4 opacity-20" />
              <p className="text-xl font-bold italic">Aucune vente enregistrée pour {getFormattedDateLabel().toLowerCase()}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 font-black uppercase text-xs tracking-widest">
                    <th className="p-4 w-[120px]">Heure</th>
                    <th className="p-4 w-[150px]">N° Cmd</th>
                    <th className="p-4">Client / Origine</th>
                    <th className="p-4 w-[180px]">Paiement</th>
                    <th className="p-4 text-right w-[150px]">Total</th>
                    <th className="p-4 w-[80px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order) => (
                    <React.Fragment key={order.id}>
                      <tr 
                        onClick={() => toggleExpand(order.id)}
                        className={`transition-colors cursor-pointer ${expandedOrderId === order.id ? 'bg-primary/5' : 'hover:bg-gray-50/80'}`}
                      >
                        <td className="p-4 font-bold text-secondary text-base">
                          {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        
                        <td className="p-4">
                          <span className="bg-white px-3 py-1.5 rounded-lg font-black text-secondary text-base border border-gray-200 shadow-sm">
                            #{order.order_number || order.id.toString().slice(0, 4)}
                          </span>
                        </td>
                        
                        <td className="p-4">
                          <div className="font-bold text-gray-800 text-base">
                            {order.customer_name || "Client Direct"}
                          </div>
                          <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 rounded text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                            {order.order_origin || 'Caisse'}
                          </span>
                        </td>
                        
                        {/* Affiche "Espèces" ou "Carte Bancaire" proprement */}
                        <td className="p-4 font-bold text-gray-500 text-sm uppercase">
                          {getPaymentMethodLabel(order.payment_method)}
                        </td>
                        
                        <td className="p-4 text-right font-black text-lg text-[#04B855]">
                          {order.total_price.toFixed(2)} €
                        </td>
                        
                        <td className="p-4 text-right">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all shadow-sm inline-flex ${
                            expandedOrderId === order.id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-400'
                          }`}>
                            {expandedOrderId === order.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </td>
                      </tr>

                      {expandedOrderId === order.id && (
                        <tr className="bg-gray-50/30">
                          <td colSpan={6} className="p-4 border-t border-gray-100">
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

        {/* PIED DE PAGE : Statistiques */}
        <div className="p-6 bg-white border-t border-gray-200 flex items-center justify-center flex-shrink-0">
            <div className="flex gap-16 items-center bg-gray-50 px-8 py-4 rounded-2xl border border-gray-200 shadow-inner">
                <div className="flex flex-col items-center">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Ventes Finalisées</span>
                    <span className="text-2xl font-black text-secondary">{orders.length}</span>
                </div>
                
                <div className="w-px h-10 bg-gray-300"></div>
                
                <div className="flex flex-col items-center">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Chiffre d'Affaires</span>
                    <span className="text-3xl font-black text-[#04B855]">
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

export default OrderHistoryModal;