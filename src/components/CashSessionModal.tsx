// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';
import { 
  X, Calculator, Printer, Lock, CheckCircle2, AlertTriangle, 
  Banknote, CreditCard, Receipt, Plus, RotateCcw, ArrowRight
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

const round2 = (num: number) => Math.round((Number(num) || 0) * 100) / 100;

const CashSessionModal = ({
  onClose,
  currentSessionId,
  onSessionOpened,
  onSessionClosed,
  themeColors = { primary: '#04B855', secondary: '#1f2937', accent: '#FBBF24' }
}: CashSessionModalProps) => {
  
  // États ouverture
  const [openingFloatStr, setOpeningFloatStr] = useState('100');
  
  // États consultation & clôture
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionReport, setSessionReport] = useState<any>(null);
  const [countedCashStr, setCountedCashStr] = useState('');
  const [isClosingConfirm, setIsClosingConfirm] = useState(false);

  // 1. Récupération robuste des données de la session
  const fetchSessionReportData = async (sessionId: string) => {
    setIsLoading(true);
    try {
      const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;

      // A. Informations du restaurant
      const { data: resto } = await supabase
        .from('restaurants')
        .select('id, name, restaurant_name, address, phone, tva, logo_url')
        .eq('id', activeRestoId)
        .maybeSingle();

      // B. Informations de la session
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

      // C. Commandes payées rattachées à la session (exclusion des annulées)
      const { data: orders } = await supabase
        .from('orders')
        .select('total_price, payment_method, cash_amount, order_origin')
        .eq('session_id', sessionId)
        .eq('is_paid', true)
        .neq('status', 'Annulée');

      let totalSales = 0;
      let totalCash = 0;
      let totalCard = 0;
      let cardSalesCaisse = 0;
      let cardSalesBorne = 0;
      let cardSalesApp = 0;
      let totalTicketResto = 0;

      (orders || []).forEach(o => {
        const amount = round2(o.total_price || 0);
        totalSales = round2(totalSales + amount);

        const method = String(o.payment_method || '')
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

        const origin = String(o.order_origin || '').toLowerCase();

        if (method.includes('carte') || method.includes('cb') || method.includes('card') || method.includes('sumup')) {
          totalCard = round2(totalCard + amount);
          if (origin.includes('borne') || origin.includes('kiosk')) cardSalesBorne = round2(cardSalesBorne + amount);
          else if (origin.includes('app') || origin.includes('web') || origin.includes('pwa')) cardSalesApp = round2(cardSalesApp + amount);
          else cardSalesCaisse = round2(cardSalesCaisse + amount);
        } else if (method === 'counter' || method.includes('espece') || method.includes('cash')) {
          totalCash = round2(totalCash + amount);
        } else if (method.includes('ticket') || method.includes('resto')) {
          totalTicketResto = round2(totalTicketResto + amount);
        } else if (method.includes('fractionn')) {
          const cashPart = round2(o.cash_amount || 0);
          const cardPart = round2(Math.max(0, amount - cashPart));
          totalCash = round2(totalCash + cashPart);
          totalCard = round2(totalCard + cardPart);
          cardSalesCaisse = round2(cardSalesCaisse + cardPart);
        } else {
          totalCash = round2(totalCash + amount);
        }
      });

      const openingFloatVal = round2(session.opening_float ?? session.opening_cash_balance ?? 0);
      const expectedCashVal = round2(openingFloatVal + totalCash);

      const restoName = resto?.restaurant_name || resto?.name || 'VOTRE RESTAURANT';
      const tvaRate = Number(resto?.tva ?? 10);
      const totalHT = round2(totalSales / (1 + (tvaRate / 100)));
      const totalTVA = round2(totalSales - totalHT);

      const reportObj = {
        type: session.status === 'CLOSED' ? 'Z' : 'X',
        sessionId: session.id,
        openedAt: session.opened_at,
        closedAt: session.closed_at,
        
        name: restoName,
        restaurantName: restoName,
        restaurantAddress: resto?.address || null,
        restaurantPhone: resto?.phone || null,
        restaurantLogo: resto?.logo_url || null,
        tvaRate,
        totalHT,
        totalTVA,

        totalSales,
        totalCash,
        totalCard,
        cardSalesCaisse,
        cardSalesBorne,
        cardSalesApp,
        totalTicketResto,
        totalOrders: orders?.length || 0,
        openingFloat: openingFloatVal,
        expectedCash: expectedCashVal
      };

      setSessionReport(reportObj);
      setCountedCashStr(expectedCashVal.toFixed(2));
    } catch (err) {
      console.error("Erreur rapport caisse :", err);
      toast.error("Erreur lors de l'analyse de la session");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentSessionId) {
      fetchSessionReportData(currentSessionId);
    }
  }, [currentSessionId]);

  // 2. Impression du Ticket X ou Z
  const printReportTicket = async (reportPayload: any) => {
    if (!(window as any).electronAPI?.printReceipt) {
      toast.info(`Impression non disponible sur navigateur web (${reportPayload.type})`);
      return;
    }

    const targetPrinter = getSecureSetting('imprimante_rapports', getSecureSetting('imprimante_caisse', undefined));

    try {
      const res = await (window as any).electronAPI.printReceipt({
        ...reportPayload,
        orderType: `RAPPORT ${reportPayload.type}`
      }, targetPrinter);

      if (res?.success) {
        toast.success(`Ticket ${reportPayload.type} imprimé !`);
      } else {
        toast.error(`Erreur d'impression : ${res?.error || 'Inconnue'}`);
      }
    } catch (e) {
      console.error("Crash impression ticket :", e);
      toast.error("Échec de communication avec l'imprimante");
    }
  };

  // 3. Ouverture de Caisse
  const handleOpenSession = async () => {
    const floatAmount = round2(parseFloat(openingFloatStr));
    if (isNaN(floatAmount) || floatAmount < 0) {
      return toast.error("Montant de fond de caisse invalide");
    }

    setIsProcessing(true);
    try {
      const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;

      // Écriture sur les deux champs de fond de caisse pour compatibilité totale
      const { data, error } = await supabase
        .from('cash_sessions')
        .insert([{
          restaurant_id: activeRestoId,
          opening_float: floatAmount,
          opening_cash_balance: floatAmount,
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
      console.error("Erreur ouverture caisse :", e);
      toast.error("Impossible d'ouvrir la caisse");
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Clôture de Caisse (Ticket Z)
  const handleCloseSession = async () => {
    if (!currentSessionId || !sessionReport) return;

    const actualCashCounted = round2(parseFloat(countedCashStr));
    if (isNaN(actualCashCounted) || actualCashCounted < 0) {
      return toast.error("Veuillez saisir les espèces réelles comptées");
    }

    setIsProcessing(true);
    try {
      const closedAt = new Date().toISOString();
      const discrepancy = round2(actualCashCounted - sessionReport.expectedCash);

      // Snapshot JSON identique au format natif des clôtures
      const snapshot = {
        opened_at: sessionReport.openedAt,
        closed_at: closedAt,
        opening_balance: sessionReport.openingFloat,
        totalSales: sessionReport.totalSales,
        cashSales: sessionReport.totalCash,
        cardSalesTotal: sessionReport.totalCard,
        cardSalesCaisse: sessionReport.cardSalesCaisse,
        cardSalesBorne: sessionReport.cardSalesBorne,
        cardSalesApp: sessionReport.cardSalesApp,
        expectedCash: sessionReport.expectedCash,
        closing_cash_counted: actualCashCounted,
        difference: discrepancy
      };

      // Mise à jour de tous les champs de clôture
      const { error } = await supabase
        .from('cash_sessions')
        .update({
          status: 'CLOSED',
          closed_at: closedAt,
          closing_float_actual: actualCashCounted,
          closing_cash_counted: actualCashCounted,
          closing_cash_expected: sessionReport.expectedCash,
          total_sales: sessionReport.totalSales,
          total_cash: sessionReport.totalCash,
          total_card: sessionReport.totalCard,
          total_ticket_resto: sessionReport.totalTicketResto,
          z_ticket_snapshot: JSON.stringify(snapshot)
        })
        .eq('id', currentSessionId);

      if (error) throw error;

      const finalZPayload = {
        ...sessionReport,
        type: 'Z',
        closedAt,
        closingFloatActual: actualCashCounted,
        countedCash: actualCashCounted,
        discrepancy
      };

      // Impression automatique du ticket Z
      await printReportTicket(finalZPayload);

      toast.success("Caisse clôturée avec succès !");
      onSessionClosed();
      onClose(true);
    } catch (e) {
      console.error("Erreur clôture caisse :", e);
      toast.error("Erreur lors de la clôture");
    } finally {
      setIsProcessing(false);
    }
  };

  const expectedCashTotal = sessionReport?.expectedCash || 0;
  const countedCashNum = round2(parseFloat(countedCashStr) || 0);
  const discrepancy = round2(countedCashNum - expectedCashTotal);

  return createPortal(
    <div className="fixed inset-0 z-[999999] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 font-sans select-none">
      <motion.div 
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-[#F8FAFC] w-[860px] max-w-[96vw] max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-white/20"
      >
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: themeColors.secondary }}>
              <Calculator size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Session de Caisse</h2>
              <p className="text-xs text-slate-500">
                {currentSessionId ? `Session N° ${currentSessionId.slice(0, 8)}...` : "Ouverture du service"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${currentSessionId ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              <span className={`w-2 h-2 rounded-full ${currentSessionId ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              {currentSessionId ? 'En service' : 'Non ouverte'}
            </span>

            <button 
              type="button"
              onClick={() => onClose(false)} 
              className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Corps modal */}
        <div className="flex-1 overflow-y-auto p-6">
          
          {/* CAS 1 : OUVERTURE DE CAISSE */}
          {!currentSessionId ? (
            <div className="flex flex-col items-center justify-center py-6 max-w-md mx-auto">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 border border-emerald-100">
                <Banknote size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-1">Fond de Caisse Initial</h3>
              <p className="text-xs text-slate-500 text-center mb-6">Saisissez les espèces présentes dans le tiroir au démarrage.</p>

              <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-6 flex flex-col items-center">
                <div className="flex items-center justify-center gap-2 w-full">
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={openingFloatStr}
                    onChange={(e) => setOpeningFloatStr(e.target.value)}
                    className="w-40 text-center text-3xl font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl py-2 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                  />
                  <span className="text-2xl font-bold text-slate-400">€</span>
                </div>

                <div className="grid grid-cols-4 gap-2 w-full mt-4">
                  {[50, 80, 100, 150].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setOpeningFloatStr(String(val))}
                      className="py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-all active:scale-95"
                    >
                      {val} €
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleOpenSession}
                disabled={isProcessing}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm tracking-wide transition-all active:scale-95 shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 size={18} />
                <span>{isProcessing ? "Ouverture..." : "Ouvrir la caisse"}</span>
              </button>
            </div>
          ) : isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin" />
              <p className="text-slate-400 text-xs font-medium">Analyse des encaissements en cours...</p>
            </div>
          ) : sessionReport ? (
            
            /* CAS 2 : CONSULTATION & CLÔTURE */
            <div className="space-y-5">
              
              {/* Synthèse financière */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-slate-400 font-medium text-[11px] block mb-1">Chiffre d'Affaires</span>
                  <div className="text-2xl font-bold text-slate-900">{sessionReport.totalSales.toFixed(2)} €</div>
                  <div className="text-[10px] text-slate-500 mt-1">{sessionReport.totalOrders} commande(s) validée(s)</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-slate-400 font-medium text-[11px] flex items-center gap-1 mb-1">
                    <Banknote size={13} className="text-emerald-500" /> Espèces
                  </span>
                  <div className="text-2xl font-bold text-emerald-600">{sessionReport.totalCash.toFixed(2)} €</div>
                  <div className="text-[10px] text-slate-500 mt-1">Caisse & commandes cash</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-slate-400 font-medium text-[11px] flex items-center gap-1 mb-1">
                    <CreditCard size={13} className="text-blue-500" /> Cartes (CB)
                  </span>
                  <div className="text-2xl font-bold text-blue-600">{sessionReport.totalCard.toFixed(2)} €</div>
                  <div className="text-[10px] text-slate-500 mt-1">TPE & Bornes</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-slate-400 font-medium text-[11px] block mb-1">Fond initial</span>
                  <div className="text-2xl font-bold text-slate-700">{sessionReport.openingFloat.toFixed(2)} €</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {new Date(sessionReport.openedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>

              {/* Action Ticket X (Provisoire) */}
              <div className="bg-white px-5 py-3.5 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
                <div>
                  <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Receipt size={15} className="text-slate-600" /> Imprimer le Ticket X (Provisoire)
                  </h4>
                  <p className="text-[11px] text-slate-400">Édite l'état actuel des ventes sans fermer la caisse.</p>
                </div>
                <button
                  type="button"
                  onClick={() => printReportTicket({ ...sessionReport, type: 'X' })}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Printer size={13} />
                  <span>Imprimer X</span>
                </button>
              </div>

              {/* Bloc Clôture & Rapprochement Espèces */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <Lock size={16} className="text-amber-500" /> Clôture de Caisse & Ticket Z
                    </h4>
                    <p className="text-xs text-slate-500">Comptez les espèces du tiroir pour vérifier l'écart.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCountedCashStr(expectedCashTotal.toFixed(2))}
                    className="text-[11px] font-semibold text-emerald-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw size={11} /> Compte exact
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 items-center">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                    <span className="text-slate-400 font-semibold uppercase text-[9px] tracking-wider block mb-0.5">Espèces Théoriques</span>
                    <div className="text-lg font-bold text-slate-800">{expectedCashTotal.toFixed(2)} €</div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{sessionReport.openingFloat}€ + {sessionReport.totalCash}€</span>
                  </div>

                  <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200 text-center">
                    <span className="text-amber-700 font-semibold uppercase text-[9px] tracking-wider block mb-1">Espèces Réelles</span>
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number"
                        step="0.5"
                        value={countedCashStr}
                        onChange={(e) => setCountedCashStr(e.target.value)}
                        className="w-28 text-center text-lg font-bold text-slate-900 bg-white border border-amber-300 rounded-lg py-1 focus:outline-none focus:border-amber-500"
                      />
                      <span className="text-sm font-bold text-slate-600">€</span>
                    </div>
                  </div>

                  <div className={`p-3 rounded-xl border text-center ${discrepancy === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : discrepancy > 0 ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                    <span className="font-semibold uppercase text-[9px] tracking-wider block mb-0.5">Écart de Caisse</span>
                    <div className="text-lg font-bold">
                      {discrepancy >= 0 ? '+' : ''}{discrepancy.toFixed(2)} €
                    </div>
                    <span className="text-[10px] block mt-0.5">
                      {discrepancy === 0 ? 'Aucun écart' : discrepancy > 0 ? 'Excédent' : 'Manquant'}
                    </span>
                  </div>
                </div>

                {!isClosingConfirm ? (
                  <button
                    type="button"
                    onClick={() => setIsClosingConfirm(true)}
                    className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Lock size={15} />
                    <span>Clôturer la journée (Générer Ticket Z)</span>
                  </button>
                ) : (
                  <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle size={20} className="text-amber-600 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-900 text-xs block">Confirmer la clôture définitive ?</span>
                        <span className="text-[11px] text-slate-500">Cette action fermera la session et imprimera le Ticket Z.</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button 
                        type="button"
                        onClick={() => setIsClosingConfirm(false)} 
                        className="px-3 py-1.5 bg-white text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200"
                      >
                        Annuler
                      </button>
                      <button 
                        type="button"
                        onClick={handleCloseSession} 
                        disabled={isProcessing} 
                        className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
                      >
                        {isProcessing ? "Clôture..." : "Confirmer la fermeture"}
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