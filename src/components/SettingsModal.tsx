import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Lock, Save, ShieldCheck, Monitor, ChevronRight, ChevronUp, ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';

interface SettingsModalProps {
  onClose: () => void;
  currentCategories?: string[]; 
  onCategoriesReorder?: (newOrder: string[]) => void;
}

const SettingsModal = ({ onClose, currentCategories = [], onCategoriesReorder }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState('display');
  
  // --- ÉTATS SÉCURITÉ ---
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // --- ÉTATS AFFICHAGE (Catégories) ---
  const [orderedCategories, setOrderedCategories] = useState<string[]>([]);

  useEffect(() => {
    const savedOrder = localStorage.getItem('pos_category_order');
    if (savedOrder) {
      try {
        const parsedOrder = JSON.parse(savedOrder);
        const newCats = currentCategories.filter(c => !parsedOrder.includes(c));
        setOrderedCategories([...parsedOrder.filter((c: string) => currentCategories.includes(c)), ...newCats]);
      } catch (e) {
        setOrderedCategories([...currentCategories]);
      }
    } else {
      setOrderedCategories([...currentCategories]);
    }
  }, [currentCategories]);

  // --- HANDLERS SÉCURITÉ ---
  const handleSavePin = () => {
    const savedPin = localStorage.getItem('pos_pin') || '1234';
    if (currentPin !== savedPin) return toast.error("Le code actuel est incorrect");
    if (newPin.length !== 4) return toast.error("Le nouveau code doit faire 4 chiffres");
    if (newPin !== confirmPin) return toast.error("Les nouveaux codes ne correspondent pas");

    localStorage.setItem('pos_pin', newPin);
    toast.success("Code PIN modifié !");
    setCurrentPin(''); setNewPin(''); setConfirmPin('');
  };

  // --- HANDLERS CLASSIQUES HAUT/BAS ---
  const moveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...orderedCategories];
    const temp = newOrder[index - 1];
    newOrder[index - 1] = newOrder[index];
    newOrder[index] = temp;
    setOrderedCategories(newOrder);
  };

  const moveDown = (index: number) => {
    if (index === orderedCategories.length - 1) return;
    const newOrder = [...orderedCategories];
    const temp = newOrder[index + 1];
    newOrder[index + 1] = newOrder[index];
    newOrder[index] = temp;
    setOrderedCategories(newOrder);
  };

  const handleSaveCategoryOrder = () => {
    localStorage.setItem('pos_category_order', JSON.stringify(orderedCategories));
    if (onCategoriesReorder) {
      onCategoriesReorder(orderedCategories);
    }
    toast.success("Ordre enregistré avec succès !");
  };

  const menuItems = [
    { id: 'display', icon: Monitor, label: 'Affichage', description: 'Ordre des catégories' },
    { id: 'security', icon: ShieldCheck, label: 'Sécurité', description: 'Code PIN d\'accès' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#F3F4F6] flex flex-col font-helvetica select-none">
      
      {/* EN-TÊTE */}
      <div className="bg-white h-24 border-b border-gray-200 flex items-center justify-between px-10 flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-secondary text-white rounded-2xl flex items-center justify-center shadow-md">
            <Monitor size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-secondary uppercase tracking-tight leading-none">Réglages</h1>
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">Configuration de la caisse</p>
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
        <div className="w-[380px] bg-white border-r border-gray-200 flex flex-col py-6 overflow-y-auto z-0">
          <div className="flex flex-col gap-2 px-4">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
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
        </div>

        {/* ZONE DE CONTENU */}
        <div className="flex-1 overflow-y-auto p-10 bg-[#F3F4F6]">
          
          {/* ONGLET AFFICHAGE (Catégories) */}
          {activeTab === 'display' && (
            <div className="max-w-3xl animate-in fade-in duration-300">
              <div className="mb-8">
                <h2 className="text-3xl font-black text-secondary uppercase">Ordre des Catégories</h2>
                <p className="text-gray-500 font-bold mt-2">Utilisez les flèches pour organiser l'écran d'encaissement.</p>
              </div>

              <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-8">
                  {orderedCategories.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 font-bold border-2 border-dashed border-gray-200 rounded-xl">
                      Aucune catégorie chargée.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orderedCategories.map((cat, index) => (
                        <div 
                          key={cat}
                          className="flex items-center justify-between bg-white border-2 border-gray-100 rounded-xl p-3 hover:border-primary transition-colors"
                        >
                          <span className="font-black text-secondary uppercase tracking-wider text-lg pl-2">{cat}</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => moveUp(index)}
                              disabled={index === 0}
                              className="w-12 h-12 flex items-center justify-center bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-200 hover:text-primary active:scale-95 disabled:opacity-30 disabled:hover:bg-gray-50 disabled:hover:text-gray-600 disabled:active:scale-100 transition-all"
                            >
                              <ChevronUp size={28} />
                            </button>
                            <button
                              onClick={() => moveDown(index)}
                              disabled={index === orderedCategories.length - 1}
                              className="w-12 h-12 flex items-center justify-center bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-200 hover:text-primary active:scale-95 disabled:opacity-30 disabled:hover:bg-gray-50 disabled:hover:text-gray-600 disabled:active:scale-100 transition-all"
                            >
                              <ChevronDown size={28} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-8 bg-gray-50 border-t border-gray-200 flex justify-end">
                  <button 
                    onClick={handleSaveCategoryOrder}
                    disabled={orderedCategories.length === 0}
                    className="px-10 py-4 bg-primary text-white rounded-xl font-black text-lg uppercase tracking-wider flex items-center justify-center gap-3 hover:bg-primary/90 active:scale-95 transition-all shadow-md"
                  >
                    <Save size={24} />
                    Sauvegarder l'ordre
                  </button>
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

        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;