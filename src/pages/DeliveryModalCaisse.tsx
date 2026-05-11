// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Phone, User, Home, Check, Search, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { checkDeliveryEligibility } from '@/lib/deliveryUtils';

// Remplace par le chemin réel si différent
import AddressAutocomplete from '@/components/AddressAutocomplete'; 

const splitAddress = (fullAddress: string) => {
  if (!fullAddress) return { num: '', street: '' };
  const clean = fullAddress.trim();
  const match = clean.match(/^(\d+(?:bis|ter|q|a|b|c)?)\s+(.*)/i);
  if (match) {
    return { num: match[1], street: match[2] };
  }
  return { num: '', street: clean }; 
};

export const DeliveryModalCaisse = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  initialData 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: (data: any) => void,
  initialData?: any
}) => {
  const [isCheckingDistance, setIsCheckingDistance] = useState(false);
  const [isEligible, setIsEligible] = useState(false);

  const [streetNumber, setStreetNumber] = useState('');
  const [initialStreetName, setInitialStreetName] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  
  const [fee, setFee] = useState<number>(0);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setPhone(initialData.phone || '');
      setAdditionalInfo(initialData.additionalInfo || '');
      setFee(initialData.fee || 0);

      if (initialData.address) {
        const { num, street } = splitAddress(initialData.address);
        setStreetNumber(num);
        setInitialStreetName(street);
        setIsEligible(true);
      }
    }
  }, [initialData]);

  const handleAddressSelect = async (suggestion: any) => {
    setIsCheckingDistance(true);
    setIsEligible(false);
    
    try {
      const [lng, lat] = suggestion.geometry.coordinates;
      const apiLabel = suggestion.properties.label || suggestion.properties.name || ""; 
      
      const check = await checkDeliveryEligibility(apiLabel, { lat, lng });
      
      if (!check.isEligible) {
        toast.error(check.message || "Zone non desservie par le restaurant.");
      } else {
        setFee(check.deliveryFee || 0);
        setIsEligible(true);
        
        if (!streetNumber) {
          const { num } = splitAddress(apiLabel);
          if (num) setStreetNumber(num);
        }
      }
    } catch (error) {
      toast.error('Erreur lors de la vérification de la zone.');
    } finally {
      setIsCheckingDistance(false);
    }
  };

  const handleFinalize = () => {
    if (!initialStreetName && !isEligible) return toast.error("Veuillez sélectionner une adresse valide.");
    if (!streetNumber.trim()) return toast.error("N° de rue requis.");
    if (!name.trim()) return toast.error("Nom du client requis.");

    let finalAddress = initialStreetName;
    if (isEligible) {
        // Optionnel : Si l'autocomplétion a marché on peut récupérer l'adresse exacte via l'input
        // Pour la caisse on va forcer une string propre
    }

    const fullAddress = `${streetNumber.trim()} ${initialStreetName.trim()}`;

    onConfirm({
      name,
      phone,
      address: fullAddress,
      additionalInfo,
      fee: fee
    });
    
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-helvetica select-none">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* HEADER MODALE */}
        <div className="bg-secondary p-4 flex justify-between items-center text-white">
          <h2 className="font-black uppercase tracking-wider flex items-center gap-2">
            <User className="h-5 w-5" /> Infos Client & Livraison
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* CORPS MODALE */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          
          {/* LIGNE NOM / TELEPHONE */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase">Nom du client *</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 font-bold text-secondary focus:border-primary focus:bg-white transition-colors outline-none"
                placeholder="Ex: Jean Dupont"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase">Téléphone</label>
              <input 
                type="tel" 
                value={phone} 
                onChange={e => setPhone(e.target.value)} 
                className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 font-bold text-secondary focus:border-primary focus:bg-white transition-colors outline-none"
                placeholder="06 00 00 00 00"
              />
            </div>
          </div>

          <div className="h-px bg-gray-100 w-full" />

          {/* LIGNE ADRESSE (AVEC SÉPARATION NUMÉRO / RUE) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-1">
              <MapPin className="h-4 w-4" /> Adresse exacte
            </label>
            <div className="flex gap-2 items-start">
              <div className="w-20 flex-shrink-0">
                <input 
                  placeholder="N°" 
                  value={streetNumber} 
                  onChange={e => setStreetNumber(e.target.value)}
                  className={`w-full bg-gray-50 border-2 border-gray-100 font-black text-center text-lg h-12 rounded-xl focus:border-primary focus:bg-white transition-colors outline-none ${isEligible ? 'border-green-500 bg-green-50 text-green-700' : ''}`}
                />
              </div>

              <div className="flex-1 relative">
                {/* ⚠️ ICI on utilise le composant AddressAutocomplete de PWA */}
                <AddressAutocomplete 
                  key={initialStreetName || 'caisse-address'} 
                  defaultValue={initialStreetName}
                  onAddressSelect={handleAddressSelect}
                  placeholder="Nom de la rue, ville..."
                  disabled={isCheckingDistance}
                  className={`h-12 rounded-xl border-2 border-gray-100 bg-gray-50 font-bold ${isEligible ? 'border-green-500 bg-green-50' : ''}`}
                />
                {isCheckingDistance && <div className="absolute right-4 top-4"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>}
                {isEligible && <Check className="absolute right-4 top-3.5 w-5 h-5 text-green-600 bg-white rounded-full p-0.5 shadow-sm" />}
              </div>
            </div>
          </div>

          {/* COMPLÉMENT D'ADRESSE */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-1">
              <Home className="h-3 w-3" /> Bâtiment, Code, Interphone...
            </label>
            <input 
              type="text" 
              value={additionalInfo} 
              onChange={e => setAdditionalInfo(e.target.value)} 
              className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 text-sm font-medium text-secondary focus:border-primary focus:bg-white transition-colors outline-none"
              placeholder="Ex: Bâtiment B, Code 1234A"
            />
          </div>

          {/* FRAIS DE LIVRAISON (Modifiables à la main) */}
          <div className="bg-gray-50 p-4 rounded-xl border-2 border-gray-100 flex justify-between items-center">
             <div>
               <div className="font-black text-secondary uppercase tracking-widest text-sm">Frais de port calculés</div>
               <div className="text-[10px] font-bold text-gray-400 uppercase">Modifiable si besoin</div>
             </div>
             <div className="flex items-center gap-1">
                <input 
                  type="number" 
                  step="0.5"
                  value={fee} 
                  onChange={e => setFee(parseFloat(e.target.value) || 0)} 
                  className="w-20 bg-white border-2 border-gray-200 rounded-lg px-2 py-1 font-black text-lg text-primary text-right focus:border-primary outline-none"
                />
                <span className="font-black text-lg text-primary">€</span>
             </div>
          </div>

        </div>

        {/* FOOTER MODALE */}
        <div className="p-4 border-t border-gray-100 flex gap-3 bg-gray-50">
          <button onClick={onClose} className="flex-1 py-3 bg-white text-gray-500 rounded-xl font-black uppercase tracking-wider hover:bg-gray-100 border border-gray-200 active:scale-95 transition-all">Annuler</button>
          <button onClick={handleFinalize} className="flex-[2] py-3 bg-primary text-white rounded-xl font-black uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-md">Valider le client</button>
        </div>

      </div>
    </div>,
    document.body
  );
};