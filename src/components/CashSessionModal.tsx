// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { 
  X, Calculator, Printer, Lock, CheckCircle2, AlertTriangle, 
  Banknote, CreditCard, Receipt, Plus, RotateCcw, DollarSign
} from 'lucide-react';
import { toast } from 'sonner';

interface CashSessionModalProps {
  onClose: (isSuccess?: boolean) => void;
  currentSessionId: string | null;
  onSessionOpened: (sessionId: string) => void;
  onSessionClosed: () => void;
  themeColors?: { primary: string; secondary: string; accent: string };
}

const getSecureSetting = (key: string, defaultValue: any) => {
  if ((window as any).electronAPI?.getSetting) {
    return (window as any).electronAPI.getSetting(key, defaultValue);
  }
  const local = localStorage.getItem(key);
  if (local === null || local === undefined) return defaultValue;
  return local;
};

const CashSessionModal = ({
  onClose,
  currentSessionId,
  onSessionOpened,
  onSessionClosed,
  themeColors = { primary: '#04B855', secondary: '#1f2937', accent: '#FBBF24' }
}: CashSessionModalProps) => {
  
  // ÉTATS - OUVERTURE
  const [openingFloatStr, setOpeningFloatStr] = useState('100');
  
  // ÉTATS - CLÔTURE & DONNÉES EN DIRECT
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionReport, setSessionReport] = useState<any>(null);
  const [countedCashStr, setCountedCashStr] = useState('');
  const [isClosingConfirm, setIsClosingConfirm] = useState(false);

  // 1. Récupération complète et intelligente des données de session
  const fetchSessionReportData = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;

      // 🏢 A. Infos Restaurant (Récupération prioritaire sur 'name')
      const { data: resto } = await supabase
        .from('restaurants')
        .select('id, name, restaurant_name, address, phone, tva, logo_url')
        .eq('id', activeRestoId)
        .maybeSingle();

      // 🕒 B. Infos de la Session
      const { data: session, error: sessionErr } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionErr || !session) {
        toast.error("Session de caisse introuvable");
        setIsLoading(false);
        return;
      }

      // 💳 C. Commandes payées rattachées à la session (Exclusion des annulées)
      const { data: orders } = await supabase
        .from('orders')
        .select('total_price, payment_method, cash_amount')
        .eq('session_id', sessionId)
        .eq('is_paid', true)
        .neq('status', 'Annulée');

      let totalSales = 0;
      let totalCash = 0;
      let totalCard = 0;
      let totalTicketResto = 0;

      (orders || []).forEach(o => {
        const amount = Number(o.total_price || 0);
        totalSales += amount;

        const method = String(o.payment_method || '')
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

        if (method.includes('carte') || method.includes('cb') || method.includes('card') || method.includes('sumup')) {
          totalCard += amount;
        } else if (method === 'counter' || method.includes('espece') || method.includes('cash')) {
          totalCash += amount;
        } else if (method.includes('ticket') || method.includes('resto')) {
          totalTicketResto += amount;
        } else if (method.includes('fractionn')) {
          const cashPart = Number(o.cash_amount || 0);
          totalCash += cashPart;
          totalCard += Math.max(0, amount - cashPart);
        } else {
          totalCash += amount;
        }
      });

      const restoName = resto?.name || resto?.restaurant_name || 'VOTRE RESTAURANT';
      const tvaRate = Number(resto?.tva ?? 10);

      const reportObj = {
        type: session.status === 'CLOSED' ? 'Z' : 'X',
        sessionId: session.id,
        openedAt: session.opened_at,
        closedAt: session.closed_at,
        
        // Infos Établissement
        name: restoName,
        restaurantName: restoName,
        restaurantAddress: resto?.address || null,
        restaurantPhone: resto?.phone || null,
        restaurantLogo: resto?.logo_url || null,
        tvaRate,

        // Totaux financiers
        totalSales,
        totalCash,
        totalCard,
        totalTicketResto,
        totalOrders: orders?.length || 0,
        openingFloat: Number(session.opening_float || 0),
        closingFloatActual: Number(session.closing_float_actual || 0)
      };

      setSessionReport(reportObj);
      if (!countedCashStr) {
        const expectedCash = reportObj.openingFloat + reportObj.totalCash;
        setCountedCashStr(expectedCash.toFixed(2));
      }
    } catch (err) {
      console.error("Erreur rapport de caisse :", err);
      toast.error("Erreur lors du calcul du rapport de caisse");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentSessionId) {
      fetchSessionReportData(currentSessionId);
    }
  }, [currentSessionId]);

  // 2. Impression physique du Ticket X ou Z
  const printReportTicket = async (reportPayload: any) => {
    if (!(window as any).electronAPI?.printReceipt) {
      toast.info(`Impression non disponible sur navigateur. (${reportPayload.type})`);
      return;
    }

    const targetPrinter = getSecureSetting('imprimante_rapports', getSecureSetting('imprimante_caisse', undefined));

    try {
      const res = await (window as any).electronAPI.printReceipt({
        ...reportPayload,
        orderType: `RAPPORT ${reportPayload.type}`
      }, targetPrinter);

      if (res?.success) {
        toast.success(`Ticket ${reportPayload.type} imprimé avec succès !`);
      } else {
        toast.error(`Erreur d'impression : ${res?.error || 'Inconnue'}`);
      }
    } catch (e) {
      console.error("Crash impression ticket Z/X:", e);
      toast.error("Échec lors de l'envoi à l'imprimante");
    }
  };

  // 3. Action : Ouverture de Caisse
  const handleOpenSession = async () => {
    const floatAmount = parseFloat(openingFloatStr);
    if (isNaN(floatAmount) || floatAmount < 0) {
      return toast.error("Veuillez entrer un fond de caisse valide");
    }

    setIsProcessing(true);
    try {
      const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;

      const { data, error } = await supabase
        .from('cash_sessions')
        .insert([{
          restaurant_id: activeRestoId,
          opening_float: floatAmount,
          status: 'OPEN',
          opened_at: new Date().toISOString()
        }])
        .select('id')
        .single();

      if (error) throw error;

      toast.success("Caisse ouverte avec succès !");
      onSessionOpened(data.id);
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Impossible d'ouvrir la caisse");
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Action : Clôture définitive (Ticket Z)
  const handleCloseSession = async () => {
    if (!currentSessionId || !sessionReport) return;

    const actualCashCounted = parseFloat(countedCashStr);
    if (isNaN(actualCashCounted) || actualCashCounted < 0) {
      return toast.error("Veuillez saisir le montant réel des espèces comptées");
    }

    setIsProcessing(true);
    try {
      const closedAt = new Date().toISOString();

      const { error } = await supabase
        .from('cash_sessions')
        .update({
          status: 'CLOSED',
          closed_at: closedAt,
          closing_float_actual: actualCashCounted,
          total_sales: sessionReport.totalSales,
          total_cash: sessionReport.totalCash,
          total_card: sessionReport.totalCard,
          total_ticket_resto: sessionReport.totalTicketResto
        })
        .eq('id', currentSessionId);

      if (error) throw error;

      const finalZPayload = {
        ...sessionReport,
        type: 'Z',
        closedAt,
        closingFloatActual: actualCashCounted
      };

      // Impression automatique du Ticket Z
      await printReportTicket(finalZPayload);

      toast.success("Caisse clôturée avec succès !");
      onSessionClosed();
      onClose(true);
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors de la clôture de caisse");
    } finally {
      setIsProcessing(false);
    }
  };

  const expectedCashTotal = sessionReport ? (sessionReport.openingFloat + sessionReport.totalCash) : 0;
  const countedCashNum = parseFloat(countedCashStr) || 0;
  const discrepancy = countedCashNum - expectedCashTotal;

  return createPortal(
    <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 font-helvetica select-none">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#F3F4F6] w-[1000px] max-w-[95vw] max-h-[92vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-white/20"
      >
        {/* EN-TÊTE MODALE */}
        <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md" style={{ backgroundColor: themeColors.secondary }}>
              <Calculator size={26} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-secondary uppercase tracking-tight">Gestion de Caisse</h2>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                {currentSessionId ? `Session active N° ${currentSessionId.slice(0, 8)}` : "Ouverture de la journée"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-3 py-1.5 rounded-full font-black text-xs uppercase tracking-widest flex items-center gap-1.5 ${currentSessionId ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${currentSessionId ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></span>
              {currentSessionId ? 'Caisse Ouverte' : 'Caisse Fermée'}
            </span>

            <button onClick={() => onClose(false)} className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center font-black hover:bg-red-200 active:scale-95 transition-all">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* CONTENU MODALE */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          
          {/* CAS 1 : CAISSE FERMÉE -> MODALE D'OUVERTURE */}
          {!currentSessionId ? (
            <div className="flex flex-col items-center justify-center py-10 max-w-lg mx-auto">
              <div className="w-20 h-20 bg-emerald-100 text-primary rounded-3xl flex items-center justify-center mb-6 shadow-inner border border-emerald-200">
                <Banknote size={40} />
              </div>
              <h3 className="text-2xl font-black text-secondary uppercase tracking-wide text-center mb-2">Fond de Caisse Initial</h3>
              <p className="text-gray-400 font-bold text-xs text-center mb-8 uppercase tracking-wider">Saisissez le montant d'espèces présent dans le tiroir au démarrage.</p>

              <div className="w-full bg-white border-2 border-gray-200 rounded-3xl p-6 shadow-sm mb-6 flex flex-col items-center">
                <span className="text-xs font-black uppercase text-gray-400 tracking-widest mb-2">Montant compté en €</span>
                <div className="flex items-center justify-center gap-2 w-full">
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={openingFloatStr}
                    onChange={(e) => setOpeningFloatStr(e.target.value)}
                    className="w-48 text-center text-4xl font-black text-secondary bg-gray-50 border border-gray-200 rounded-2xl py-3 focus:outline-none focus:border-primary focus:bg-white transition-all shadow-inner"
                  />
                  <span className="text-3xl font-black text-gray-400">€</span>
                </div>

                <div className="grid grid-cols-4 gap-2 w-full mt-6">
                  {[50, 100, 150, 200].map(val => (
                    <button
                      key={val}
                      onClick={() => setOpeningFloatStr(String(val))}
                      className="py-2.5 bg-gray-100 hover:bg-gray-200 text-secondary font-black text-sm rounded-xl transition-all active:scale-95 shadow-sm"
                    >
                      {val} €
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleOpenSession}
                disabled={isProcessing}
                className="w-full py-5 bg-primary hover:bg-primary/90 text-white rounded-2xl font-black uppercase text-lg tracking-widest transition-all active:scale-95 shadow-lg shadow-primary/30 flex items-center justify-center gap-3 disabled:opacity-50"
              >
                <CheckCircle2 size={24} />
                {isProcessing ? "Ouverture en cours..." : "Ouvrir la Caisse"}
              </button>
            </div>
          ) : isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
              <p className="text-gray-400 font-bold text-sm uppercase tracking-wider">Calcul du rapport de caisse...</p>
            </div>
          ) : sessionReport ? (
            
            /* CAS 2 : CAISSE OUVERTE -> ÉCRAN RAPPORTS X/Z ET TIROIR */
            <div className="space-y-6">
              
              {/* CARTES STATISTIQUES EN DIRECT */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                  <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Chiffre d'Affaires Total</span>
                  <div className="text-3xl font-black text-secondary tracking-tight">{sessionReport.totalSales.toFixed(2)} €</div>
                  <div className="text-[11px] font-bold text-gray-400 mt-2 flex justify-between">
                    <span>{sessionReport.totalOrders} Commande(s)</span>
                    <span>TVA 10%: {(sessionReport.totalSales - (sessionReport.totalSales / 1.1)).toFixed(2)}€</span>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                  <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1 flex items-center gap-1">
                    <Banknote size={14} className="text-emerald-500" /> Ventes Espèces
                  </span>
                  <div className="text-3xl font-black text-emerald-600 tracking-tight">{sessionReport.totalCash.toFixed(2)} €</div>
                  <span className="text-[10px] font-bold text-gray-400 mt-2">Paiements caisse & borne</span>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                  <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1 flex items-center gap-1">
                    <CreditCard size={14} className="text-blue-500" /> Ventes Carte (CB)
                  </span>
                  <div className="text-3xl font-black text-blue-600 tracking-tight">{sessionReport.totalCard.toFixed(2)} €</div>
                  <span className="text-[10px] font-bold text-gray-400 mt-2">CB, SumUp, Sans-contact</span>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                  <span className="text-gray-400 font-bold uppercase text-[10px] tracking-widest mb-1">Fond de caisse initial</span>
                  <div className="text-3xl font-black text-gray-700 tracking-tight">{sessionReport.openingFloat.toFixed(2)} €</div>
                  <span className="text-[10px] font-bold text-gray-400 mt-2">Ouvert le {new Date(sessionReport.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>

              {/* BOUTON RAPPORT X (PROVISOIRE) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="font-black text-secondary uppercase text-base flex items-center gap-2">
                    <Receipt size={20} className="text-primary" /> Imprimer Ticket X (Rapport Provisoire)
                  </h4>
                  <p className="text-xs font-bold text-gray-400 mt-0.5">Imprime un état des ventes à l'instant T sans fermer la session de caisse.</p>
                </div>
                <button
                  onClick={() => printReportTicket({ ...sessionReport, type: 'X' })}
                  className="px-6 py-3 bg-secondary hover:bg-secondary/90 text-white rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all active:scale-95 shadow-sm"
                >
                  <Printer size={16} /> Imprimer Ticket X
                </button>
              </div>

              {/* BLOC RECONCILIATION ET CLÔTURE (TICKET Z) */}
              <div className="bg-white p-6 rounded-3xl border-2 border-orange-200 shadow-sm space-y-6">
                <div className="flex justify-between items-start border-b border-gray-100 pb-4">
                  <div>
                    <h4 className="font-black text-secondary uppercase text-lg flex items-center gap-2">
                      <Lock size={20} className="text-orange-500" /> Clôture de Caisse & Ticket Z
                    </h4>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">Comptabilisez les espèces réelles du tiroir pour valider la clôture définitive.</p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest bg-orange-100 text-orange-700 px-3 py-1 rounded-full">
                    Action Définitive
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-6 items-center">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-center">
                    <span className="text-gray-400 font-black uppercase text-[10px] tracking-widest block mb-1">Espèces Théoriques</span>
                    <div className="text-2xl font-black text-secondary">{expectedCashTotal.toFixed(2)} €</div>
                    <span className="text-[10px] font-bold text-gray-400 mt-1 block">Fond Initial ({sessionReport.openingFloat}€) + Ventes ({sessionReport.totalCash}€)</span>
                  </div>

                  <div className="bg-orange-50/50 p-4 rounded-2xl border-2 border-orange-200 text-center">
                    <span className="text-orange-600 font-black uppercase text-[10px] tracking-widest block mb-2">Espèces Comptées Réelles</span>
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number"
                        step="0.1"
                        value={countedCashStr}
                        onChange={(e) => setCountedCashStr(e.target.value)}
                        className="w-36 text-center text-2xl font-black text-secondary bg-white border border-orange-300 rounded-xl py-1.5 focus:outline-none focus:border-orange-500 shadow-inner"
                      />
                      <span className="text-xl font-black text-secondary">€</span>
                    </div>
                  </div>

                  <div className={`p-4 rounded-2xl border text-center ${discrepancy === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : discrepancy > 0 ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    <span className="font-black uppercase text-[10px] tracking-widest block mb-1">Écart de Caisse</span>
                    <div className="text-2xl font-black">
                      {discrepancy >= 0 ? '+' : ''}{discrepancy.toFixed(2)} €
                    </div>
                    <span className="text-[10px] font-bold mt-1 block">
                      {discrepancy === 0 ? 'Caisse parfaite (Aucun écart)' : discrepancy > 0 ? 'Excédent en caisse' : 'Manquant en caisse'}
                    </span>
                  </div>
                </div>

                {!isClosingConfirm ? (
                  <button
                    onClick={() => setIsClosingConfirm(true)}
                    className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black uppercase text-base tracking-widest transition-all active:scale-95 shadow-md flex items-center justify-center gap-2"
                  >
                    <Lock size={20} /> Clôturer la journée (Générer Ticket Z)
                  </button>
                ) : (
                  <div className="bg-orange-100 p-5 rounded-2xl border border-orange-300 flex items-center justify-between gap-4 animate-in fade-in duration-150">
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={28} className="text-orange-600 flex-shrink-0" />
                      <div>
                        <span className="font-black text-secondary uppercase text-sm block">Confirmer la fermeture de la caisse ?</span>
                        <span className="text-xs font-bold text-gray-600">Cette action fermera la session active et imprimera le Ticket Z officiel.</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setIsClosingConfirm(false)} className="px-4 py-2.5 bg-white text-gray-600 rounded-xl font-black uppercase text-xs hover:bg-gray-100 transition-colors">
                        Annuler
                      </button>
                      <button onClick={handleCloseSession} disabled={isProcessing} className="px-6 py-2.5 bg-red-600 text-white rounded-xl font-black uppercase text-xs hover:bg-red-700 transition-all shadow-md active:scale-95">
                        {isProcessing ? "Clôture..." : "Oui, Clôturer"}
                      </button>
                    </div>
                  </div>
                )}

              </div>

            </div>
          ) : null}

        </div>
      </motion.div>
    </div>,
    document.body
  );
};

export default CashSessionModal;