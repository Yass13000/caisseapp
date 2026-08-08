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
  localStorage.setItem(key, String(value));
  if ((window as any).electronAPI?.setSetting) {
    (window as any).electronAPI.setSetting(key, value);
  }
};

const SettingsModal = ({ onClose, currentCategories, onCategoriesReorder }: SettingsModalProps) => {
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

  // --- ÉTATS IMPRESSION AVANCÉS ---
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(() => getSecureSetting('auto_print_receipt', 'false') === 'true');
  const [printKitchenTicket, setPrintKitchenTicket] = useState(() => getSecureSetting('print_kitchen_ticket', 'true') !== 'false');
  const [receiptWidth, setReceiptWidth] = useState(() => getSecureSetting('receipt_width', '72'));

  const [availablePrinters, setAvailablePrinters] = useState<any[]>([]);
  const [caissePrinter, setCaissePrinter] = useState(getSecureSetting('imprimante_caisse', ''));
  const [kitchenPrinter, setKitchenPrinter] = useState(getSecureSetting('imprimante_cuisine', ''));
  const [deliveryPrinter, setDeliveryPrinter] = useState(getSecureSetting('imprimante_livraison', ''));
  const [reportsPrinter, setReportsPrinter] = useState(getSecureSetting('imprimante_rapports', ''));

  const [fontSize, setFontSize] = useState(() => getSecureSetting('receipt_font_size', 'normal'));
  const [marginType, setMarginType] = useState(() => getSecureSetting('receipt_margin_type', 'none'));
  const [copiesClient, setCopiesClient] = useState(() => getSecureSetting('receipt_copies_client', '1'));
  const [copiesKitchen, setCopiesKitchen] = useState(() => getSecureSetting('receipt_copies_kitchen', '1'));

  const [logoB64, setLogoB64] = useState(() => getSecureSetting('restaurant_logo_b64', ''));
  const [showLogo, setShowLogo] = useState(() => getSecureSetting('show_logo', 'true') === 'true');
  const [showHeaderInfo, setShowHeaderInfo] = useState(() => getSecureSetting('show_header_info', 'true') === 'true');
  const [showTaxDetails, setShowTaxDetails] = useState(() => getSecureSetting('show_tax_details', 'false') === 'true');
  const [showFooterMessage, setShowFooterMessage] = useState(() => getSecureSetting('show_footer_message', 'true') === 'true');
  const [footerMessage, setFooterMessage] = useState(() => getSecureSetting('footer_custom_message', 'Merci de votre visite !\nA bientôt.'));
  const [showQrCode, setShowQrCode] = useState(() => getSecureSetting('show_qr_code', 'false') === 'true');
  const [qrCodeType, setQrCodeType] = useState(() => getSecureSetting('qr_code_type', 'google'));
  const [qrCodeUrl, setQrCodeUrl] = useState(() => getSecureSetting('qr_code_custom_url', 'https://google.com'));
  const [kitchenShowPrices, setKitchenShowPrices] = useState(() => getSecureSetting('kitchen_show_prices', 'false') === 'true');

  const [drawerPinMode, setDrawerPinMode] = useState(() => getSecureSetting('drawer_pin_mode', 'both'));
  const [autoOpenDrawerCash, setAutoOpenDrawerCash] = useState(() => getSecureSetting('auto_open_drawer_cash', 'true') === 'true');

  const [categoryRouting, setCategoryRouting] = useState<Record<string, string>>(() => {
    try {
      const raw = getSecureSetting('category_printer_routing', '{}');
      return typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    } catch (e) {
      return {};
    }
  });

  const fetchPrinters = async () => {
    if ((window as any).electronAPI) {
      try {
        const printers = await (window as any).electronAPI.getPrinters();
        setAvailablePrinters(printers || []);
        toast.success("Liste des imprimantes actualisée !");
      } catch (e) {
        console.error("Erreur lors du chargement des imprimantes:", e);
      }
    }
  };

  useEffect(() => {
    fetchPrinters();
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result as string;
      setLogoB64(b64);
      setSecureSetting('restaurant_logo_b64', b64);
      toast.success("Logo du restaurant enregistré !");
    };
    reader.readAsDataURL(file);
  };

  const handleTestPrint = async (targetPrinter?: string) => {
    if (!(window as any).electronAPI) {
      return toast.error("Impression de test non disponible sur navigateur web");
    }

    toast.info("Envoi du ticket de test...");
    const testData = {
      orderType: 'SUR PLACE',
      orderNumber: 'TEST-01',
      orderDate: new Date().toLocaleString('fr-FR'),
      restaurantName: 'TEST CALIBRATION POS',
      restaurantAddress: '123 Rue de la Caisse, Paris',
      restaurantPhone: '01 02 03 04 05',
      items: [
        { qty: 1, name: 'TICKET DE CALIBRATION', unitPrice: 10.00, notes: ['Vérification largeur', 'Vérification coupe'] }
      ],
      total: 10.00
    };

    try {
      const res = await (window as any).electronAPI.printReceipt(testData, targetPrinter);
      if (res?.success) toast.success("Ticket de test envoyé avec succès !");
      else toast.error(`Échec impression test: ${res?.error || 'Erreur inconnue'}`);
    } catch (e: any) {
      toast.error(`Erreur: ${e.message}`);
    }
  };

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
                  
                  {/* 1. CONFIGURATION MULTI-IMPRIMANTES ET RÔLES */}
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-black text-secondary uppercase tracking-wide">Affectation des Imprimantes</h3>
                      <button 
                        onClick={fetchPrinters}
                        className="px-4 py-2 bg-white border border-gray-300 rounded-xl text-xs font-bold text-secondary flex items-center gap-2 hover:bg-gray-100 active:scale-95 transition-all shadow-sm"
                      >
                        <RefreshCw size={14} /> Actualiser la liste
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Imprimante Ticket Client</label>
                        <select 
                          value={caissePrinter}
                          onChange={(e) => { setCaissePrinter(e.target.value); setSecureSetting('imprimante_caisse', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="">-- Imprimante par défaut --</option>
                          {availablePrinters.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name} {p.isDefault ? '(Système)' : ''}</option>
                          ))}
                        </select>
                        <button onClick={() => handleTestPrint(caissePrinter)} className="mt-2 text-xs font-bold text-primary hover:underline flex items-center gap-1">
                          <Printer size={12} /> Test impression Client
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Imprimante Bon Cuisine</label>
                        <select 
                          value={kitchenPrinter}
                          onChange={(e) => { setKitchenPrinter(e.target.value); setSecureSetting('imprimante_cuisine', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="">-- Imprimante par défaut --</option>
                          {availablePrinters.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                        <button onClick={() => handleTestPrint(kitchenPrinter)} className="mt-2 text-xs font-bold text-primary hover:underline flex items-center gap-1">
                          <Printer size={12} /> Test impression Cuisine
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Imprimante Étiquette Livraison</label>
                        <select 
                          value={deliveryPrinter}
                          onChange={(e) => { setDeliveryPrinter(e.target.value); setSecureSetting('imprimante_livraison', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="">-- Même que Ticket Client --</option>
                          {availablePrinters.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Imprimante Rapports Z/X</label>
                        <select 
                          value={reportsPrinter}
                          onChange={(e) => { setReportsPrinter(e.target.value); setSecureSetting('imprimante_rapports', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="">-- Même que Ticket Client --</option>
                          {availablePrinters.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* 2. RÉGLAGES DE MISE EN PAGE */}
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="text-lg font-black text-secondary uppercase tracking-wide">Mise en page & Format</h3>

                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Largeur Papier</label>
                        <select 
                          value={receiptWidth}
                          onChange={(e) => { setReceiptWidth(e.target.value); setSecureSetting('receipt_width', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="58">58 mm (Compact)</option>
                          <option value="72">72 mm (Standard 80mm)</option>
                          <option value="80">80 mm (Plein)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Taille Police</label>
                        <select 
                          value={fontSize}
                          onChange={(e) => { setFontSize(e.target.value); setSecureSetting('receipt_font_size', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="small">Petite</option>
                          <option value="normal">Normale (Auto)</option>
                          <option value="large">Grande (Lisibilité Cuisine)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Marges</label>
                        <select 
                          value={marginType}
                          onChange={(e) => { setMarginType(e.target.value); setSecureSetting('receipt_margin_type', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        >
                          <option value="none">Sans marge (0mm)</option>
                          <option value="standard">Marge standard</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-200">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Copies Ticket Client</label>
                        <input 
                          type="number" min={1} max={5} value={copiesClient}
                          onChange={(e) => { setCopiesClient(e.target.value); setSecureSetting('receipt_copies_client', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Copies Bon Cuisine</label>
                        <input 
                          type="number" min={1} max={5} value={copiesKitchen}
                          onChange={(e) => { setCopiesKitchen(e.target.value); setSecureSetting('receipt_copies_kitchen', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold text-secondary shadow-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. LOGO & EN-TÊTE DU TICKET */}
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="text-lg font-black text-secondary uppercase tracking-wide">Logo & Visuels</h3>

                    <div className="flex items-center gap-6">
                      {logoB64 && (
                        <div className="w-24 h-24 bg-white border border-gray-300 rounded-xl p-2 flex items-center justify-center shadow-sm">
                          <img src={logoB64} alt="Logo" className="max-h-full max-w-full object-contain grayscale" />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Charger le logo du restaurant</label>
                        <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-xs font-bold text-gray-500" />
                        <p className="text-[11px] text-gray-400 mt-1">Converti automatiquement en niveaux de gris pour l'imprimante thermique.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={showLogo} onChange={(e) => { setShowLogo(e.target.checked); setSecureSetting('show_logo', String(e.target.checked)); }} className="w-5 h-5 accent-primary" />
                        <span className="text-sm font-bold text-secondary">Afficher le Logo</span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={showHeaderInfo} onChange={(e) => { setShowHeaderInfo(e.target.checked); setSecureSetting('show_header_info', String(e.target.checked)); }} className="w-5 h-5 accent-primary" />
                        <span className="text-sm font-bold text-secondary">Afficher Adresse/Tél</span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={showTaxDetails} onChange={(e) => { setShowTaxDetails(e.target.checked); setSecureSetting('show_tax_details', String(e.target.checked)); }} className="w-5 h-5 accent-primary" />
                        <span className="text-sm font-bold text-secondary">Détail des Taxes HT/TVA</span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={kitchenShowPrices} onChange={(e) => { setKitchenShowPrices(e.target.checked); setSecureSetting('kitchen_show_prices', String(e.target.checked)); }} className="w-5 h-5 accent-primary" />
                        <span className="text-sm font-bold text-secondary">Prix sur Bon Cuisine</span>
                      </label>
                    </div>
                  </div>

                  {/* 4. PIED DE PAGE & QR CODE */}
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="text-lg font-black text-secondary uppercase tracking-wide">Pied de page & QR Code</h3>

                    <div>
                      <label className="flex items-center gap-3 cursor-pointer mb-3">
                        <input type="checkbox" checked={showFooterMessage} onChange={(e) => { setShowFooterMessage(e.target.checked); setSecureSetting('show_footer_message', String(e.target.checked)); }} className="w-5 h-5 accent-primary" />
                        <span className="text-sm font-bold text-secondary">Message de fin de ticket</span>
                      </label>
                      {showFooterMessage && (
                        <textarea 
                          rows={2} value={footerMessage}
                          onChange={(e) => { setFooterMessage(e.target.value); setSecureSetting('footer_custom_message', e.target.value); }}
                          className="w-full bg-white border border-gray-300 rounded-xl p-3 text-xs font-bold text-secondary shadow-sm"
                        />
                      )}
                    </div>

                    <div className="pt-4 border-t border-gray-200 space-y-4">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={showQrCode} onChange={(e) => { setShowQrCode(e.target.checked); setSecureSetting('show_qr_code', String(e.target.checked)); }} className="w-5 h-5 accent-primary" />
                        <span className="text-sm font-bold text-secondary">Imprimer un QR Code</span>
                      </label>

                      {showQrCode && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type de QR Code</label>
                            <select 
                              value={qrCodeType}
                              onChange={(e) => { setQrCodeType(e.target.value); setSecureSetting('qr_code_type', e.target.value); }}
                              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm font-bold text-secondary"
                            >
                              <option value="google">Avis Google / URL Custom</option>
                              <option value="tracking">Suivi de commande</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">URL Cible</label>
                            <input 
                              type="text" value={qrCodeUrl}
                              onChange={(e) => { setQrCodeUrl(e.target.value); setSecureSetting('qr_code_custom_url', e.target.value); }}
                              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm font-bold text-secondary"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 6. ROUTAGE DES ARTICLES PAR CATÉGORIE (CUISINE / COMPTOIR / LIVRAISON) */}
                  <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <h3 className="text-lg font-black text-secondary uppercase tracking-wide">Routage par Catégorie</h3>
                    <p className="text-xs font-bold text-gray-400">Dirigez automatiquement les bons de préparation des articles de certaines catégories vers des imprimantes spécifiques.</p>

                    {currentCategories && currentCategories.length > 0 ? (
                      <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                        {currentCategories.map((cat, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                            <span className="text-xs font-black text-secondary uppercase tracking-wider">{cat}</span>
                            <select 
                              value={categoryRouting[cat] || 'cuisine'}
                              onChange={(e) => {
                                const newRouting = { ...categoryRouting, [cat]: e.target.value };
                                setCategoryRouting(newRouting);
                                setSecureSetting('category_printer_routing', JSON.stringify(newRouting));
                              }}
                              className="bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-bold text-secondary focus:outline-none focus:border-primary"
                            >
                              <option value="cuisine">Imprimante Cuisine (Par défaut)</option>
                              <option value="caisse">Imprimante Caisse / Comptoir</option>
                              <option value="livraison">Imprimante Livraison</option>
                              <option value="rapports">Imprimante Rapports</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-bold text-gray-400 italic">Aucune catégorie détectée sur ce menu.</p>
                    )}
                  </div>

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