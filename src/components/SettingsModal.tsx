// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Save, ShieldCheck, ChevronRight, Printer, Settings, Receipt, Store, Power, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';

interface SettingsModalProps {
  onClose: () => void;
  currentCategories?: string[]; 
  onCategoriesReorder?: (newOrder: string[]) => void;
}

// PONT DE SÉCURITÉ ET PERSISTANCE LOCAL FILE / LOCALSTORAGE
const getSecureSetting = (key: string, defaultValue: any) => {
  if ((window as any).electronAPI?.getSetting) {
    return (window as any).electronAPI.getSetting(key, defaultValue);
  }
  const local = localStorage.getItem(key);
  if (local === null || local === undefined) return defaultValue;
  return local;
};

const setSecureSetting = (key: string, value: any) => {
  if ((window as any).electronAPI?.setSetting) {
    (window as any).electronAPI.setSetting(key, value);
  } else {
    localStorage.setItem(key, String(value));
  }
};

const SettingsModal = ({ onClose }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState('printing');
  const [showPowerMenu, setShowPowerMenu] = useState(false);
  const [gearClicks, setGearClicks] = useState(0);
  
  // --- ÉTATS SÉCURITÉ ---
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // --- ÉTATS SYSTÈME ---
  const [newRestoId, setNewRestoId] = useState('');
  const [isCheckingResto, setIsCheckingResto] = useState(false);

  // --- ÉTATS IMPRESSION ---
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(() => {
    return getSecureSetting('auto_print_receipt', 'false') === 'true';
  });
  
  const [printKitchenTicket, setPrintKitchenTicket] = useState(() => {
    return getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
  });

  const [receiptWidth, setReceiptWidth] = useState(() => {
    return getSecureSetting('receipt_width', '72');
  });

  const [availablePrinters, setAvailablePrinters] = useState<any[]>([]);
  const [caissePrinter, setCaissePrinter] = useState(getSecureSetting('imprimante_caisse', ''));
  const [kitchenPrinter, setKitchenPrinter] = useState(getSecureSetting('imprimante_cuisine', ''));

  // Chargement des imprimantes si Electron est disponible
  useEffect(() => {
    const fetchPrinters = async () => {
      if ((window as any).electronAPI) {
        try {
          const printers = await (window as any).electronAPI.getPrinters();
          setAvailablePrinters(printers || []);
        } catch (e) {
          console.error("Erreur lors du chargement des imprimantes:", e);
        }
      }
    };
    fetchPrinters();
  }, []);

  // --- HANDLERS SÉCURITÉ ---
  const handleSavePin = () => {
    const savedPin = getSecureSetting('pos_pin', '1234');
    if (currentPin !== savedPin) return toast.error("Le code actuel est incorrect");
    if (newPin.length !== 4) return toast.error("Le nouveau code doit faire 4 chiffres");
    if (newPin !== confirmPin) return toast.error("Les nouveaux codes ne correspondent pas");

    setSecureSetting('pos_pin', newPin);
    toast.success("Code PIN modifié !");
    setCurrentPin(''); setNewPin(''); setConfirmPin('');
  };

  // --- HANDLERS SYSTÈME ---
  const handleVerifyAndSaveRestoId = async () => {
    const trimmedId = newRestoId.trim();
    if (trimmedId.length < 5) return toast.error("Veuillez entrer un ID valide");

    setIsCheckingResto(true);
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name')
        .eq('id', trimmedId)
        .single();

      if (error || !data) {
        toast.error("Cet ID Restaurant n'existe pas !");
      } else {
        setSecureSetting('pos_restaurant_id', trimmedId);
        toast.success(`Connecté à ${data.name || 'nouveau restaurant'} ! Redémarrage en cours...`);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (e) {
      toast.error("Erreur de vérification de l'ID");
    } finally {
      setIsCheckingResto(false);
    }
  };

  const handleCloseApp = () => {
    if ((window as any).electronAPI?.closeApp) {
      (window as any).electronAPI.closeApp();
    } else {
      toast.error("Impossible de fermer depuis un navigateur web");
    }
  };

  const handleShutdownPC = () => {
    if ((window as any).electronAPI?.shutdownPC) {
      (window as any).electronAPI.shutdownPC();
    } else {
      toast.error("Action impossible sur le Web");
    }
  };

  const handleRestartPC = () => {
    if ((window as any).electronAPI?.restartPC) {
      (window as any).electronAPI.restartPC();
    } else {
      toast.error("Action impossible sur le Web");
    }
  };

  // --- HANDLER TRIPLE CLIC SÉCURISÉ ---
  const handleGearClick = () => {
    setGearClicks(prev => {
      const nextCount = prev + 1;
      if (nextCount === 3) {
        setActiveTab('secret-system');
        setShowPowerMenu(false);
        toast.success("Accès Administrateur déverrouillé");
        return 0;
      }
      return nextCount;
    });
  };

  // Réinitialise les clics si aucune action n'est faite après 1.5 seconde
  useEffect(() => {
    if (gearClicks === 0) return;
    const timeout = setTimeout(() => setGearClicks(0), 1500);
    return () => clearTimeout(timeout);
  }, [gearClicks]);

  // --- HANDLERS IMPRESSION ---
  const toggleAutoPrintReceipt = () => {
    const newValue = !autoPrintReceipt;
    setAutoPrintReceipt(newValue);
    setSecureSetting('auto_print_receipt', String(newValue));
    toast.success(newValue ? "Impression Auto ACTIVÉE" : "Impression Auto DÉSACTIVÉE");
  };

  const toggleKitchenTicket = () => {
    const newValue = !printKitchenTicket;
    setPrintKitchenTicket(newValue);
    setSecureSetting('print_kitchen_ticket', String(newValue));
    toast.success(newValue ? "Ticket Cuisine ACTIVÉ" : "Ticket Cuisine DÉSACTIVÉ");
  };

  const handleReceiptWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setReceiptWidth(val);
    setSecureSetting('receipt_width', val);
  };

  const handleCaissePrinterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCaissePrinter(val);
    setSecureSetting('imprimante_caisse', val);
    toast.success("Imprimante Caisse mise à jour !");
  };

  const handleKitchenPrinterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setKitchenPrinter(val);
    setSecureSetting('imprimante_cuisine', val);
    toast.success("Imprimante Cuisine mise à jour !");
  };

  const menuItems = [
    { id: 'printing', icon: Printer, label: 'Impression', description: 'Tickets et matériels' },
    { id: 'security', icon: ShieldCheck, label: 'Sécurité', description: 'Code PIN d\'accès' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#F3F4F6] flex flex-col font-helvetica select-none">
      
      {/* EN-TÊTE */}
      <div className="bg-white h-24 border-b border-gray-200 flex items-center justify-between px-10 flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-5">
          <div 
            onClick={handleGearClick}
            className="w-14 h-14 bg-secondary text-white rounded-2xl flex items-center justify-center shadow-md cursor-pointer active:scale-95 transition-transform"
          >
            <Settings size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-secondary uppercase tracking-tight leading-none">Réglages</h1>
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1"></p>
          </div>
        </div>
        <button 
          onClick={onClose} 
          className="h-14 px-6 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center font-black text-lg hover:bg-red-100 active:scale-95 transition-all gap-2 border border-red-100"
        >
          <X size={24} /> FERMER
        </button>
      </div>

      {/* CORPS */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* SIDEBAR */}
        <div className="w-[380px] bg-white border-r border-gray-200 flex flex-col py-6 z-0">
          <div className="flex flex-col gap-2 px-4 flex-1 overflow-y-auto custom-scrollbar">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setShowPowerMenu(false); }}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all ${
                    isActive 
                      ? 'bg-primary text-white shadow-md shadow-primary/20 scale-[1.02]' 
                      : 'bg-transparent text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                      <Icon size={24} />
                    </div>
                    <div className="text-left">
                      <div className={`text-lg font-black uppercase tracking-wider ${isActive ? 'text-white' : 'text-secondary'}`}>
                        {item.label}
                      </div>
                      <div className={`text-xs font-bold ${isActive ? 'text-white/70' : 'text-gray-400'}`}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                  {isActive && <ChevronRight size={24} className="text-white/50" />}
                </button>
              );
            })}
          </div>

          {/* PETIT BOUTON FLOTTANT D'ALIMENTATION */}
          <div className="px-6 mt-auto pt-4 border-t border-gray-100 flex justify-end relative">
            {showPowerMenu && (
              <div className="absolute bottom-16 right-6 w-56 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.25)] border border-gray-200 p-1.5 flex flex-col gap-0.5 animate-in fade-in slide-in-from-bottom-2 duration-150 z-50">
                <button 
                  onClick={() => { handleCloseApp(); setShowPowerMenu(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-100 rounded-xl transition-colors text-left text-secondary font-black uppercase text-[11px] tracking-wider"
                >
                  <Power size={16} className="text-gray-500" />
                  Fermer
                </button>
                <button 
                  onClick={() => { handleRestartPC(); setShowPowerMenu(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-orange-50 rounded-xl transition-colors text-left text-orange-600 font-black uppercase text-[11px] tracking-wider"
                >
                  <RefreshCw size={16} className="text-orange-500" />
                  Redémarrer
                </button>
                <button 
                  onClick={() => { handleShutdownPC(); setShowPowerMenu(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-50 rounded-xl transition-colors text-left text-red-600 font-black uppercase text-[11px] tracking-wider"
                >
                  <Power size={16} className="text-red-500" />
                  Éteindre
                </button>
              </div>
            )}

            <button
              onClick={() => setShowPowerMenu(!showPowerMenu)}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                showPowerMenu 
                  ? 'bg-red-500 text-white shadow-md shadow-red-500/20 scale-[1.02]' 
                  : 'bg-red-50 text-red-600 hover:bg-red-100 active:scale-95'
              }`}
              title="Alimentation"
            >
              <Power size={22} />
            </button>
          </div>
        </div>

        {/* ZONE DE CONTENU */}
        <div className="flex-1 overflow-y-auto p-10 bg-[#F3F4F6]">
          
          {/* ONGLET IMPRESSION */}
          {activeTab === 'printing' && (
            <div className="max-w-3xl animate-in fade-in duration-300">
              <div className="mb-8">
                <h2 className="text-3xl font-black text-secondary uppercase">Impression</h2>
                <p className="text-gray-500 font-bold mt-2">Gérez les comportements d'impression des tickets.</p>
              </div>

              <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden space-y-2">
                <div className="p-8 space-y-4">
                  
                  {/* Option Ticket Client Auto */}
                  <div className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="pr-6">
                      <p className="text-xl font-black text-secondary uppercase tracking-wide mb-1 flex items-center gap-3">
                        <Receipt className="text-gray-400" size={24} />
                        Ticket Client Automatique
                      </p>
                      <p className="text-sm font-bold text-gray-500 leading-relaxed">
                        Imprimer le ticket de caisse automatiquement lors du paiement.
                      </p>
                    </div>
                    <button 
                      onClick={toggleAutoPrintReceipt}
                      className={`relative inline-flex h-10 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-inner ${autoPrintReceipt ? 'bg-[#04B855]' : 'bg-gray-300'}`}
                    >
                      <span className={`pointer-events-none inline-block h-9 w-9 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoPrintReceipt ? 'translate-x-10' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Option Ticket Cuisine */}
                  <div className="flex items-center justify-between p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="pr-6">
                      <p className="text-xl font-black text-secondary uppercase tracking-wide mb-1 flex items-center gap-3">
                        <Printer className="text-gray-400" size={24} />
                        Ticket Cuisine
                      </p>
                      <p className="text-sm font-bold text-gray-500 leading-relaxed">
                        Imprimer le récapitulatif de la commande pour la préparation.
                      </p>
                    </div>
                    <button 
                      onClick={toggleKitchenTicket}
                      className={`relative inline-flex h-10 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-inner ${printKitchenTicket ? 'bg-[#04B855]' : 'bg-gray-300'}`}
                    >
                      <span className={`pointer-events-none inline-block h-9 w-9 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${printKitchenTicket ? 'translate-x-10' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Format et Largeur */}
                  <div className="mt-6 p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-black text-secondary uppercase tracking-wide mb-4">Format du ticket</h3>
                    <div>
                      <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Largeur d'impression (mm)</label>
                      <div className="flex items-center gap-4">
                        <input
                          type="number"
                          value={receiptWidth}
                          onChange={handleReceiptWidthChange}
                          className="w-32 bg-white border-2 border-gray-200 rounded-xl px-4 py-3 text-lg font-black text-secondary focus:outline-none focus:border-primary shadow-sm text-center"
                        />
                        <span className="text-sm font-bold text-gray-400 leading-tight">
                          mm <br/>
                          <span className="font-normal">(Ex: <b>72</b> pour rouleaux 80mm, <b>48</b> pour rouleaux 58mm)</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Configuration des Imprimantes Spécifiques */}
                  {(window as any).electronAPI && (
                    <div className="mt-6 p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                      <h3 className="text-lg font-black text-secondary uppercase tracking-wide mb-4">Configuration Matériel</h3>
                      
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Imprimante Caisse</label>
                          <select 
                            value={caissePrinter}
                            onChange={handleCaissePrinterChange}
                            className="w-full bg-white border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-secondary focus:outline-none focus:border-primary shadow-sm"
                          >
                            <option value="">-- Imprimante par défaut --</option>
                            {availablePrinters.map((p, idx) => (
                              <option key={idx} value={p.name}>{p.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Imprimante Cuisine</label>
                          <select 
                            value={kitchenPrinter}
                            onChange={handleKitchenPrinterChange}
                            disabled={!printKitchenTicket}
                            className="w-full bg-white border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-secondary focus:outline-none focus:border-primary shadow-sm disabled:opacity-50"
                          >
                            <option value="">-- Imprimante par défaut --</option>
                            {availablePrinters.map((p, idx) => (
                              <option key={idx} value={p.name}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

          {/* ONGLET SÉCURITÉ */}
          {activeTab === 'security' && (
            <div className="max-w-3xl animate-in fade-in duration-300">
              <div className="mb-8">
                <h2 className="text-3xl font-black text-secondary uppercase">Code PIN</h2>
                <p className="text-gray-500 font-bold mt-2">Gérez le code de déverrouillage de la caisse.</p>
              </div>

              <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-8 space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Code Actuel</label>
                    <input 
                      type="password" inputMode="numeric" maxLength={4}
                      value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full max-w-sm bg-gray-50 border-2 border-gray-200 rounded-xl px-6 py-4 text-3xl font-black tracking-[1em] focus:outline-none focus:border-primary"
                      placeholder="••••"
                    />
                  </div>
                  
                  <div className="pt-6 border-t border-gray-100">
                    <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2 text-primary">Nouveau Code (4 chiffres)</label>
                    <input 
                      type="password" inputMode="numeric" maxLength={4}
                      value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full max-w-sm bg-primary/5 border-2 border-primary/20 rounded-xl px-6 py-4 text-3xl font-black text-primary tracking-[1em] focus:outline-none focus:border-primary"
                      placeholder="••••"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Confirmer le nouveau code</label>
                    <input 
                      type="password" inputMode="numeric" maxLength={4}
                      value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full max-w-sm bg-gray-50 border-2 border-gray-200 rounded-xl px-6 py-4 text-3xl font-black tracking-[1em] focus:outline-none focus:border-primary"
                      placeholder="••••"
                    />
                  </div>
                </div>

                <div className="p-8 bg-gray-50 border-t border-gray-200 flex justify-end">
                  <button 
                    onClick={handleSavePin}
                    disabled={!currentPin || newPin.length !== 4 || confirmPin.length !== 4}
                    className="px-10 py-4 bg-primary text-white rounded-xl font-black text-lg uppercase tracking-wider flex items-center justify-center gap-3 hover:bg-primary/90 active:scale-95 disabled:opacity-50 transition-all shadow-md"
                  >
                    <Save size={24} />
                    Mettre à jour le code
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ZONE CACHÉE SYSTÈME : ACCESSIBLE UNIQUEMENT VIA LE TRIPLE CLIC SUR LA ROUE DENTÉE */}
          {activeTab === 'secret-system' && (
            <div className="max-w-3xl animate-in fade-in duration-300">
              <div className="mb-8">
                <h2 className="text-3xl font-black text-secondary uppercase">Configuration Resto</h2>
                <p className="text-gray-500 font-bold mt-2">Espace d'administration masqué.</p>
              </div>

              <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden space-y-6 pb-6">
                <div className="p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <Store className="text-gray-400" size={28} />
                    <div>
                      <h3 className="text-lg font-black text-secondary uppercase tracking-wide">ID du Restaurant</h3>
                      <p className="text-sm font-bold text-gray-400">Modifier l'identifiant pour synchroniser une autre base de données.</p>
                    </div>
                  </div>

                  <div className="flex items-end gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">ID unique de liaison</label>
                      <input 
                        type="text" 
                        value={newRestoId} 
                        onChange={(e) => setNewRestoId(e.target.value)}
                        placeholder="Ex: 550e8400-e29b-41d4-a716-446655440000"
                        className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl px-4 py-3 text-base font-bold tracking-wider focus:outline-none focus:border-primary transition-all"
                      />
                    </div>
                    <button 
                      onClick={handleVerifyAndSaveRestoId}
                      disabled={isCheckingResto || newRestoId.length < 5}
                      className="h-[52px] px-8 bg-secondary text-white rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-secondary/90 active:scale-95 disabled:opacity-50 transition-all shadow-md"
                    >
                      {isCheckingResto ? "Vérification..." : "Connecter"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;