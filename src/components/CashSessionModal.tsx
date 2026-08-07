// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { supabase, getActiveRestaurantId } from '@/lib/supabaseClient';
import { toast } from "sonner";
import { Calculator, Lock, Printer, AlertTriangle, History, ArrowLeft, Eye, X } from 'lucide-react';

// --- FONCTION D'IMPRESSION X/Z (Mise à jour pour le Z Global) ---
const printCashReport = async (type: 'X' | 'Z', data: any, restaurantName: string = "RESTAURANT") => {
  if (!(window as any).electronAPI) {
    toast.error(`Impression du Ticket ${type} non disponible sur le web.`);
    return;
  }

  const printerName = localStorage.getItem('imprimante_caisse') || undefined;
  const date = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const reportItems = [
    { name: "CHIFFRE D'AFFAIRES TOTAL", qty: 1, unitPrice: Number(data.totalSales || 0), notes: [] },
    { name: "VENTES ESPÈCES", qty: 1, unitPrice: Number(data.cashSales || 0), notes: [] },
    { name: "VENTES CB TOTAL", qty: 1, unitPrice: Number(data.cardSalesTotal || 0), notes: [
      `CB Caisse: ${Number(data.cardSalesCaisse || 0).toFixed(2)}€`,
      `CB Borne: ${Number(data.cardSalesBorne || 0).toFixed(2)}€`,
      `CB App/Web: ${Number(data.cardSalesApp || 0).toFixed(2)}€`
    ]},
    { name: "FOND DE CAISSE INITIAL", qty: 1, unitPrice: Number(data.opening_balance || 0), notes: [] },
    { name: "ESPÈCES ATTENDUES", qty: 1, unitPrice: Number(data.expectedCash || 0), notes: [] }
  ];

  if (type === 'Z') {
    reportItems.push(
      { name: "ESPÈCES COMPTÉES", qty: 1, unitPrice: Number(data.closing_cash_counted || 0), notes: [] },
      { name: "ÉCART DE CAISSE", qty: 1, unitPrice: Number(data.difference || 0), notes: [] }
    );
  }

  const reportPayloadData = {
    orderType: `RAPPORT - TICKET ${type}`,
    orderNumber: `RAPPORT-${type}`,
    orderDate: date,
    restaurantName: `${restaurantName} - TICKET ${type}`,
    items: reportItems,
    total: Number(data.totalSales || 0)
  };

  try { 
    await (window as any).electronAPI.printReceipt(reportPayloadData, printerName); 
  } catch (error) { 
    console.error(`Erreur API impression ${type}:`, error); 
  }
};

export default function CashSessionModal({ onClose, currentSessionId, onSessionOpened, onSessionClosed, themeColors }: any) {
  const [mode, setMode] = useState<'LOADING' | 'OPENING' | 'CLOSING' | 'SUMMARY' | 'HISTORY' | 'HISTORY_DETAIL'>('LOADING');
  const [amountInput, setAmountInput] = useState('');
  const [expectedCash, setExpectedCash] = useState(0);
  const [zData, setZData] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [selectedPastSession, setSelectedPastSession] = useState<any>(null);

  useEffect(() => {
    if (!currentSessionId) {
      setMode('OPENING');
      return;
    }

    const fetchSessionData = async () => {
      try {
        const activeRestoId = getActiveRestaurantId();
        if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') {
          setMode('OPENING');
          return;
        }

        // 1. On récupère les infos de la session de caisse
        const { data: sessionData } = await supabase
          .from('cash_sessions')
          .select('*')
          .eq('id', currentSessionId)
          .single();

        // 2. LA MAGIE EST ICI : On récupère TOUTES les commandes payées depuis l'ouverture de la caisse
        const { data: orders } = await supabase
          .from('orders')
          .select('total_price, payment_method, cash_amount, order_origin')
          .eq('restaurant_id', activeRestoId)
          .gte('created_at', sessionData.opened_at) // Depuis l'ouverture
          .eq('is_paid', true);

        let cashSales = 0;
        let cardSalesCaisse = 0;
        let cardSalesBorne = 0;
        let cardSalesApp = 0;
        let totalSales = 0;

        if (orders) {
          orders.forEach(o => {
            const price = Number(o.total_price || 0);
            totalSales += price;
            
            const method = o.payment_method?.toLowerCase() || '';
            const origin = o.order_origin?.toLowerCase() || '';

            if (method === 'counter' || method === 'espèces') {
              cashSales += price; 
            } else if (method === 'carte bancaire' || method === 'stripe' || method === 'cb') {
              // Ventilation des CB par origine
              if (origin === 'borne') cardSalesBorne += price;
              else if (origin === 'app' || origin === 'web') cardSalesApp += price;
              else cardSalesCaisse += price; // Par défaut, c'est la caisse
            }
          });
        }

        const expected = Number(sessionData?.opening_cash_balance || 0) + cashSales;
        setExpectedCash(expected);

        setZData({
          opened_at: sessionData?.opened_at,
          opening_balance: sessionData?.opening_cash_balance,
          cashSales,
          cardSalesTotal: cardSalesCaisse + cardSalesBorne + cardSalesApp,
          cardSalesCaisse,
          cardSalesBorne,
          cardSalesApp,
          totalSales,
          expectedCash: expected
        });

        setMode('SUMMARY');
      } catch (e) {
        toast.error("Erreur de lecture de la session de caisse");
        onClose(false);
      }
    };

    fetchSessionData();
  }, [currentSessionId]); 

  const fetchPastSessions = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('status', 'CLOSED')
        .order('closed_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      setPastSessions(data || []);
      setMode('HISTORY');
    } catch (e) {
      toast.error("Erreur lors du chargement de l'historique");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNumpad = (val: string) => {
    if (val === 'DEL') setAmountInput(p => p.slice(0, -1));
    else if (val === '.') { if (!amountInput.includes('.')) setAmountInput(p => p + '.'); }
    else if (val === '00') { if (amountInput && !amountInput.includes('.')) setAmountInput(p => p + '00'); }
    else { if (amountInput.includes('.') && amountInput.split('.')[1]?.length >= 2) return; setAmountInput(p => p + val); }
  };

  const handleOpenCashRegister = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    const openingBal = parseFloat(amountInput) || 0;

    try {
      const { data, error } = await supabase
        .from('cash_sessions')
        .insert([{ opening_cash_balance: openingBal, status: 'OPEN' }])
        .select()
        .single();

      if (error) throw error;
      
      toast.success("Caisse ouverte avec succès");
      onSessionOpened(data.id);
      
      if ((window as any).electronAPI) {
          (window as any).electronAPI.openDrawer().catch(() => {});
      }

      onClose(true);
    } catch (e) {
      toast.error("Erreur lors de l'ouverture");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrintX = async () => {
    toast.info("Impression du Ticket X...");
    await printCashReport('X', zData);
  };

  const handleCloseCashRegister = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    const countedCash = parseFloat(amountInput) || 0;
    const difference = countedCash - expectedCash;

    const zSnapshot = {
        ...zData,
        closed_at: new Date().toISOString(),
        closing_cash_counted: countedCash,
        difference: difference
    };

    try {
      const { error } = await supabase
        .from('cash_sessions')
        .update({ 
            status: 'CLOSED', 
            closed_at: new Date().toISOString(),
            closing_cash_counted: countedCash,
            closing_cash_expected: expectedCash,
            total_sales: zData.totalSales,
            z_ticket_snapshot: zSnapshot
        })
        .eq('id', currentSessionId);

      if (error) throw error;
      
      if (difference === 0) toast.success("Clôture réussie : Caisse juste !");
      else toast.warning(`Clôture réussie : Écart de ${difference.toFixed(2)}€`);
      
      await printCashReport('Z', zSnapshot);

      if ((window as any).electronAPI) {
          (window as any).electronAPI.openDrawer().catch(() => {});
      }

      onSessionClosed();
      onClose(true);
    } catch (e) {
      toast.error("Erreur lors de la clôture");
    } finally {
      setIsProcessing(false);
    }
  };

  const renderNumpad = (onValidate: () => void) => (
    <div className="flex gap-6 mt-6">
        <div className="w-[60%] flex flex-col justify-center items-center bg-gray-50 rounded-xl p-6 border border-gray-200 shadow-sm">
            <span className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-2">Montant saisi</span>
            <div className="text-6xl font-black text-secondary tracking-tighter">
                {amountInput ? parseFloat(amountInput).toFixed(2) : '0.00'} <span className="text-4xl text-gray-400">€</span>
            </div>
        </div>
        <div className="w-[40%] flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
                {['1','2','3','4','5','6','7','8','9','0','00','.'].map(key => (
                    <button key={key} onClick={() => handleNumpad(key)} className="h-14 bg-gray-100 hover:bg-gray-200 text-secondary text-xl font-black rounded-xl active:scale-95 transition-all shadow-sm border border-transparent hover:border-gray-300">{key}</button>
                ))}
            </div>
            <div className="flex gap-2 h-16 mt-2">
                <button onClick={() => handleNumpad('DEL')} className="w-20 bg-red-50 text-red-500 font-black rounded-xl active:scale-95 border border-red-100 flex items-center justify-center shadow-sm hover:bg-red-100">C</button>
                <button disabled={isProcessing || amountInput === ''} onClick={onValidate} className="flex-1 bg-[#04B855] text-white rounded-xl font-black uppercase text-lg tracking-wider hover:bg-[#039d48] active:scale-95 shadow-md flex items-center justify-center gap-2 disabled:opacity-50 border border-transparent">Valider</button>
            </div>
        </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[999999] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 font-helvetica select-none">
      <div className="bg-white rounded-2xl w-full max-w-4xl p-8 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        
        <button onClick={() => onClose(false)} className="absolute top-6 right-6 w-10 h-10 bg-white border border-gray-200 text-gray-400 rounded-xl flex items-center justify-center hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all shadow-sm z-50">
            <X size={20} strokeWidth={2.5} />
        </button>
        
        {mode === 'OPENING' && (
          <>
            <div className="flex items-center justify-between mb-2 pr-14">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-50 text-blue-500 border border-blue-100 rounded-xl flex items-center justify-center"><Calculator size={24} /></div>
                    <h2 className="text-3xl font-black text-secondary tracking-tight">Ouverture de caisse</h2>
                </div>
                <button onClick={fetchPastSessions} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-xl transition-all text-sm uppercase tracking-wider border border-gray-200">
                    <History size={16} /> Historique Z
                </button>
            </div>
            <p className="text-gray-500 font-bold mb-6">Veuillez saisir le fond de caisse initial (espèces présentes dans le tiroir).</p>
            {renderNumpad(handleOpenCashRegister)}
          </>
        )}

        {mode === 'SUMMARY' && zData && (
          <>
            <div className="flex items-center justify-between mb-8 pr-14">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-secondary text-white rounded-xl flex items-center justify-center shadow-sm"><Calculator size={24} /></div>
                    <h2 className="text-3xl font-black text-secondary tracking-tight">Gestion de Caisse</h2>
                </div>
                <button onClick={fetchPastSessions} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-xl transition-all text-sm uppercase tracking-wider border border-gray-200">
                    <History size={16} /> Historique Z
                </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 shadow-sm flex flex-col justify-between">
                    <div>
                        <p className="text-blue-600 font-bold text-xs uppercase mb-1 tracking-wider">Chiffre d'affaires Global</p>
                        <p className="text-4xl font-black text-blue-800 tracking-tighter">{zData.totalSales.toFixed(2)} <span className="text-2xl opacity-50">€</span></p>
                    </div>
                    
                    <div className="mt-4 flex gap-4 text-[11px] font-bold text-blue-800 bg-blue-100/50 p-3 rounded-lg border border-blue-100/50">
                        <div className="flex flex-col">
                            <span className="uppercase opacity-70">Espèces</span>
                            <span className="text-sm">{zData.cashSales.toFixed(2)}€</span>
                        </div>
                        <div className="w-px bg-blue-200"></div>
                        <div className="flex flex-col">
                            <span className="uppercase opacity-70">CB Caisse</span>
                            <span className="text-sm">{zData.cardSalesCaisse.toFixed(2)}€</span>
                        </div>
                        <div className="w-px bg-blue-200"></div>
                        <div className="flex flex-col">
                            <span className="uppercase opacity-70">CB Borne</span>
                            <span className="text-sm">{zData.cardSalesBorne.toFixed(2)}€</span>
                        </div>
                        <div className="w-px bg-blue-200"></div>
                        <div className="flex flex-col">
                            <span className="uppercase opacity-70">CB App</span>
                            <span className="text-sm">{zData.cardSalesApp.toFixed(2)}€</span>
                        </div>
                    </div>
                </div>
                <div className="bg-green-50 p-6 rounded-xl border border-green-100 shadow-sm">
                    <p className="text-green-600 font-bold text-xs uppercase mb-1 tracking-wider">Espèces en caisse (Théorique)</p>
                    <p className="text-4xl font-black text-green-800 tracking-tighter">{zData.expectedCash.toFixed(2)} <span className="text-2xl opacity-50">€</span></p>
                    <div className="mt-4 bg-green-100/50 p-3 rounded-lg border border-green-100/50">
                        <p className="text-xs font-bold text-green-700">Fond ({Number(zData.opening_balance).toFixed(2)}€) + Encaissements ({zData.cashSales.toFixed(2)}€)</p>
                    </div>
                </div>
            </div>

            <div className="flex gap-4">
                <button onClick={handlePrintX} className="flex-1 py-5 bg-gray-50 hover:bg-gray-100 text-secondary font-black rounded-xl uppercase tracking-wider flex items-center justify-center gap-3 active:scale-95 transition-all border border-gray-200 shadow-sm">
                    <Printer size={20} /> IMPRIMER TICKET X
                </button>
                <button onClick={() => { setAmountInput(''); setMode('CLOSING'); }} className="flex-1 py-5 bg-red-500 text-white hover:bg-red-600 font-black rounded-xl uppercase tracking-wider flex items-center justify-center gap-3 active:scale-95 transition-all shadow-md">
                    <Lock size={20} /> CLÔTURER (Z)
                </button>
            </div>
          </>
        )}

        {mode === 'CLOSING' && (
          <>
            <div className="flex items-center justify-between mb-2 pr-14">
                <div className="flex items-center gap-3 text-red-500">
                    <div className="w-12 h-12 bg-red-50 text-red-600 border border-red-100 rounded-xl flex items-center justify-center"><AlertTriangle size={24} /></div>
                    <h2 className="text-3xl font-black uppercase tracking-tight text-secondary">Clôture de caisse</h2>
                </div>
                <button onClick={() => setMode('SUMMARY')} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-xl transition-all text-sm uppercase tracking-wider border border-gray-200">
                    <ArrowLeft size={16} /> Retour
                </button>
            </div>
            <p className="text-gray-500 font-bold mb-6">Comptez physiquement les espèces du tiroir et saisissez le montant total.</p>
            
            <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex justify-between items-center mb-2 shadow-sm">
                <span className="text-red-600 font-bold uppercase text-sm tracking-wider">Montant théorique (attendu) :</span>
                <span className="text-2xl font-black text-red-700">{expectedCash.toFixed(2)} €</span>
            </div>

            {renderNumpad(handleCloseCashRegister)}
          </>
        )}

        {mode === 'HISTORY' && (
          <div className="flex flex-col h-full max-h-[60vh]">
            <div className="flex items-center justify-between mb-6 pr-14">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gray-100 border border-gray-200 text-secondary rounded-xl flex items-center justify-center"><History size={24} /></div>
                    <h2 className="text-3xl font-black text-secondary tracking-tight">Historique des Clôtures</h2>
                </div>
                <button onClick={() => setMode(currentSessionId ? 'SUMMARY' : 'OPENING')} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-xl transition-all text-sm uppercase tracking-wider border border-gray-200">
                    <ArrowLeft size={16} /> Retour
                </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                {pastSessions.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 font-bold">Aucune clôture enregistrée.</div>
                ) : (
                    pastSessions.map((session) => (
                        <div key={session.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-gray-300 transition-all shadow-sm">
                            <div>
                                <h4 className="font-black text-secondary text-lg">
                                    {new Date(session.closed_at).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })}
                                </h4>
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mt-1">
                                    CA : {Number(session.total_sales).toFixed(2)} € | 
                                    Écart : <span className={Number(session.z_ticket_snapshot?.difference) < 0 ? 'text-red-500' : 'text-green-600'}>
                                        {Number(session.z_ticket_snapshot?.difference) > 0 ? '+' : ''}{Number(session.z_ticket_snapshot?.difference || 0).toFixed(2)} €
                                    </span>
                                </p>
                            </div>
                            <button 
                                onClick={() => { setSelectedPastSession(session.z_ticket_snapshot); setMode('HISTORY_DETAIL'); }}
                                className="w-12 h-12 bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center text-secondary hover:bg-gray-100 transition-colors"
                            >
                                <Eye size={20} />
                            </button>
                        </div>
                    ))
                )}
            </div>
          </div>
        )}

        {mode === 'HISTORY_DETAIL' && selectedPastSession && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-6 pr-14">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-secondary text-white rounded-xl flex items-center justify-center shadow-sm"><Calculator size={24} /></div>
                    <div>
                        <h2 className="text-2xl font-black text-secondary tracking-tight">Détail du Ticket Z</h2>
                        <p className="text-sm font-bold text-gray-500">{new Date(selectedPastSession.closed_at).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                </div>
                <button onClick={() => setMode('HISTORY')} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-xl transition-all text-sm uppercase tracking-wider border border-gray-200">
                    <ArrowLeft size={16} /> Retour
                </button>
            </div>

            <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 mb-6 space-y-4">
                <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                    <span className="text-gray-500 font-bold uppercase tracking-wider">Chiffre d'affaires total</span>
                    <span className="text-2xl font-black text-secondary">{Number(selectedPastSession.totalSales).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold text-gray-600">
                    <span>- Espèces encaissées</span>
                    <span>{Number(selectedPastSession.cashSales).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold text-gray-600">
                    <span>- CB Caisse</span>
                    <span>{Number(selectedPastSession.cardSalesCaisse || 0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold text-gray-600">
                    <span>- CB Borne</span>
                    <span>{Number(selectedPastSession.cardSalesBorne || 0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold text-gray-600 pb-4 border-b border-gray-200">
                    <span>- CB App/Web</span>
                    <span>{Number(selectedPastSession.cardSalesApp || 0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold text-gray-600 pt-2">
                    <span>Fond de caisse initial</span>
                    <span>{Number(selectedPastSession.opening_balance).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold text-gray-600">
                    <span>Espèces attendues en caisse</span>
                    <span>{Number(selectedPastSession.expectedCash).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between items-center text-lg font-black text-secondary pt-4 border-t border-gray-200">
                    <span>Espèces comptées</span>
                    <span>{Number(selectedPastSession.closing_cash_counted).toFixed(2)} €</span>
                </div>
                <div className={`flex justify-between items-center text-sm font-bold ${selectedPastSession.difference < 0 ? 'text-red-500' : 'text-green-600'}`}>
                    <span>Écart constaté</span>
                    <span>{selectedPastSession.difference > 0 ? '+' : ''}{Number(selectedPastSession.difference).toFixed(2)} €</span>
                </div>
            </div>

            <button 
                onClick={async () => {
                    toast.info("Impression de la copie du Ticket Z...");
                    await printCashReport('Z', selectedPastSession);
                }} 
                className="w-full py-4 bg-secondary text-white hover:bg-secondary/90 font-black rounded-xl uppercase tracking-wider flex items-center justify-center gap-3 active:scale-95 transition-all shadow-md"
            >
                <Printer size={20} /> RÉIMPRIMER CE TICKET Z
            </button>
          </div>
        )}

      </div>
    </div>
  );
}