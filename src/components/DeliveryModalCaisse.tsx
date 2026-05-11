// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Phone, User, Home, Check, X, Loader2, Search, Users, UserPlus, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';

// Générateur d'ID unique (UUID v4) pour les nouveaux clients créés en caisse
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const splitAddress = (fullAddress: string) => {
  if (!fullAddress) return { num: '', street: '' };
  const clean = fullAddress.trim();
  const match = clean.match(/^(\d+(?:bis|ter|q|a|b|c)?)\s+(.*)/i);
  if (match) {
    return { num: match[1], street: match[2] };
  }
  return { num: '', street: clean }; 
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
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
  const [calcStatus, setCalcStatus] = useState<{msg: string, isError: boolean} | null>(null);

  const [streetNumber, setStreetNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [fee, setFee] = useState<number>(0);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [clients, setClients] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [filteredClients, setFilteredClients] = useState<any[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  const [restoCoords, setRestoCoords] = useState<{lat: number, lng: number} | null>(null);
  const [deliveryZones, setDeliveryZones] = useState<any[]>([]);
  const [isRestoGeolocated, setIsRestoGeolocated] = useState<boolean>(false);

  useEffect(() => {
    const activeRestoId = localStorage.getItem('pos_restaurant_id') || RESTAURANT_ID;

    const fetchConfigAndClients = async () => {
      const { data: resto } = await supabase.from('restaurants').select('*').eq('id', activeRestoId).single();
      
      let rLat = resto?.latitude !== undefined && resto?.latitude !== null ? parseFloat(resto.latitude) : null;
      let rLng = resto?.longitude !== undefined && resto?.longitude !== null ? parseFloat(resto.longitude) : null;

      if ((rLat === null || isNaN(rLat)) && resto?.address) {
        toast.info("Recherche du GPS du restaurant...", { id: 'geoloc' });
        try {
          const safeQuery = encodeURIComponent(resto.address.replace(/,/g, ' ').trim());
          const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${safeQuery}&limit=1`);
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            rLng = data.features[0].geometry.coordinates[0];
            rLat = data.features[0].geometry.coordinates[1];
            toast.success("GPS Restaurant localisé !", { id: 'geoloc' });
          }
        } catch (e) { console.error("Erreur géoloc resto", e); }
      }

      if (rLat !== null && rLng !== null && !isNaN(rLat) && !isNaN(rLng)) {
        setRestoCoords({ lat: rLat, lng: rLng });
        setIsRestoGeolocated(true);
      } else {
        setIsRestoGeolocated(false);
      }

      const { data: zones } = await supabase.from('delivery_zones')
        .select('*')
        .eq('restaurant_id', activeRestoId);
        
      if (zones) {
        const sortedZones = zones.sort((a, b) => parseFloat(a.max_distance_km) - parseFloat(b.max_distance_km));
        setDeliveryZones(sortedZones);
      }

      setIsLoadingClients(true);
      const { data: profiles } = await supabase.from('profiles').select('*').eq('restaurant_id', activeRestoId);
      if (profiles) {
        setClients(profiles);
        setFilteredClients(profiles);
      }
      setIsLoadingClients(false);
    };
    
    fetchConfigAndClients();

    if (initialData) {
      setName(initialData.name || '');
      setPhone(initialData.phone || '');
      setAdditionalInfo(initialData.additionalInfo || '');
      setFee(initialData.fee || 0);

      if (initialData.address) {
        const { num, street } = splitAddress(initialData.address);
        setStreetNumber(num);
        setStreetName(street);
        setQuery(street);
        setIsEligible(true);
      }
    }
  }, [initialData]);

  useEffect(() => {
    if (!clientSearch.trim()) {
      setFilteredClients(clients);
      return;
    }
    const lower = clientSearch.toLowerCase();
    const filtered = clients.filter(c => {
      const fullName = `${c.first_name || ''} ${c.last_name || ''} ${c.customer_name || ''}`.toLowerCase();
      const phoneStr = (c.phone || '').toLowerCase();
      const addressStr = (c.address || '').toLowerCase();
      return fullName.includes(lower) || phoneStr.includes(lower) || addressStr.includes(lower);
    });
    setFilteredClients(filtered);
  }, [clientSearch, clients]);

  const handleSearchAPI = (text: string) => {
    setQuery(text);
    setStreetName(text);
    setIsEligible(false);
    setCalcStatus(null);
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (text.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(text)}&autocomplete=1&limit=5`);
        const data = await res.json();
        setSuggestions(data.features || []);
        setShowSuggestions(true);
      } catch (err) { console.error("Erreur API Gouv", err); }
    }, 300);
  };

  const processCalculations = (lat: number, lng: number, forceLabel?: string) => {
      if (!restoCoords) {
        setIsEligible(true);
        setFee(0);
        setCalcStatus({ msg: "GPS restaurant manquant. Frais manuel.", isError: true });
        setIsCheckingDistance(false);
        return;
      }

      const distance = calculateDistance(restoCoords.lat, restoCoords.lng, lat, lng);
      
      if (deliveryZones.length === 0) {
        setIsEligible(true);
        setFee(0);
        setCalcStatus({ msg: `Distance: ${distance.toFixed(1)} km. (Aucune zone en BDD).`, isError: true });
        setIsCheckingDistance(false);
        return;
      }

      const zone = deliveryZones.find(z => distance <= parseFloat(z.max_distance_km));
      
      if (zone) {
        setFee(parseFloat(zone.delivery_fee) || 0);
        setIsEligible(true);
        setCalcStatus({ msg: `✅ ${forceLabel || 'Adresse validée'} ! Distance: ${distance.toFixed(1)} km.`, isError: false });
      } else {
        setIsEligible(false);
        setFee(0);
        setCalcStatus({ msg: `❌ Hors zone de livraison (${distance.toFixed(1)} km)`, isError: true });
      }
      
      setIsCheckingDistance(false);
  };

  const handleForceCalculation = async () => {
    const addressToTest = `${streetNumber.trim()} ${query.trim()}`.trim();
    if (!addressToTest) return toast.error("Veuillez saisir une adresse.");

    setIsCheckingDistance(true);
    setCalcStatus({ msg: "Recherche GPS...", isError: false });

    try {
      const safeQuery = encodeURIComponent(addressToTest);
      const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${safeQuery}&limit=1`);
      const data = await res.json();
      
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates;
        processCalculations(lat, lng, "Calcul forcé réussi");
      } else {
        setCalcStatus({ msg: "Adresse introuvable. Saisie manuelle.", isError: true });
        setIsEligible(false);
        setIsCheckingDistance(false);
      }
    } catch (e) {
      setCalcStatus({ msg: "Erreur GPS.", isError: true });
      setIsCheckingDistance(false);
    }
  };

  const handleSelectAddress = async (feature: any) => {
    setShowSuggestions(false);
    setIsCheckingDistance(true);
    setCalcStatus(null);
    
    try {
      const [lng, lat] = feature.geometry.coordinates;
      const fullAddressLabel = feature.properties.label;
      
      const { num, street } = splitAddress(fullAddressLabel);
      if (num && !streetNumber) setStreetNumber(num);
      
      setQuery(street || fullAddressLabel);
      setStreetName(street || fullAddressLabel);

      processCalculations(lat, lng);
    } catch (error) {
      toast.error("Erreur de vérification");
      setIsCheckingDistance(false);
    } 
  };

  const handleSelectExistingClient = async (client: any) => {
    setSelectedClientId(client.id);
    const fullName = (client.customer_name || `${client.first_name || ''} ${client.last_name || ''}`).trim();
    setName(fullName);
    setPhone(client.phone || '');

    if (client.address) {
      const { num, street } = splitAddress(client.address);
      setStreetNumber(num);
      setStreetName(street);
      setQuery(street);

      setIsCheckingDistance(true);
      setCalcStatus({ msg: "Calcul...", isError: false });
      
      try {
        const safeQuery = encodeURIComponent(client.address.trim());
        const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${safeQuery}&limit=1`);
        const data = await res.json();
        
        if (data.features && data.features.length > 0) {
          const [lng, lat] = data.features[0].geometry.coordinates;
          processCalculations(lat, lng);
        } else {
          setCalcStatus({ msg: "Adresse introuvable sur le GPS.", isError: true });
          setIsEligible(false);
          setIsCheckingDistance(false);
        }
      } catch (e) {
        setCalcStatus({ msg: "Erreur réseau GPS.", isError: true });
        setIsCheckingDistance(false);
      }
    } else {
      setStreetNumber('');
      setStreetName('');
      setQuery('');
      setIsEligible(false);
      setFee(0);
      setCalcStatus({ msg: "Aucune adresse enregistrée.", isError: true });
    }
  };

  const handleClearForm = (fullClear = true) => {
    if (fullClear) {
      setName('');
      setPhone('');
      setSelectedClientId(null);
    }
    setStreetNumber('');
    setStreetName('');
    setQuery('');
    setAdditionalInfo('');
    setFee(0);
    setIsEligible(false);
    setCalcStatus(null);
  };

  const handleFinalize = async () => {
    if (!streetName && !isEligible) return toast.error("Veuillez sélectionner une adresse valide.");
    if (!name.trim()) return toast.error("Le nom du client est requis.");

    const fullAddress = `${streetNumber.trim()} ${streetName.trim()}`.trim();
    const cleanPhone = phone.replace(/\s+/g, '');
    let finalClientId = selectedClientId;

    // Si nouveau client (aucun ID sélectionné)
    if (!finalClientId) {
      toast.info("Enregistrement du client en cours...", { id: 'saveClient' });
      
      const newClientId = generateUUID(); // On fabrique l'ID nous-mêmes !
      const fakeEmail = cleanPhone ? `guest_${cleanPhone}@caisse.local` : `guest_${Date.now()}@caisse.local`;
      const activeRestoId = localStorage.getItem('pos_restaurant_id') || RESTAURANT_ID;

      try {
        const { data: newProfile, error } = await supabase
          .from('profiles')
          .insert([{
            id: newClientId, // L'ID obligatoire est maintenant fourni
            restaurant_id: activeRestoId,
            customer_name: name.trim(),
            phone: cleanPhone,
            address: fullAddress,
            email: fakeEmail, 
            role: 'client'
          }])
          .select('id')
          .single();

        if (error) {
          console.error("Erreur d'insertion du profil", error);
          toast.error("Vérifiez vos contraintes de base de données (Clé étrangère sur profiles).", { id: 'saveClient' });
        } else if (newProfile) {
          finalClientId = newProfile.id;
          toast.success("Nouveau client ajouté à la base !", { id: 'saveClient' });
        }
      } catch (err) {
        console.error(err);
      }
    }

    onConfirm({
      client_id: finalClientId,
      name: name.trim(),
      phone: phone.trim(),
      address: fullAddress,
      additionalInfo: additionalInfo.trim(),
      fee: fee
    });
    
    onClose();
  };

  if (!isOpen) return null;

  const isAddressError = !isEligible && calcStatus?.isError;

  return createPortal(
    <div className="fixed inset-0 z-[999999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 font-helvetica select-none">
      
      {/* Conteneur très compact */}
      <div className="bg-white rounded-2xl w-full max-w-5xl h-[85vh] max-h-[650px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-secondary p-3 flex justify-between items-center text-white shrink-0">
          <h2 className="font-black uppercase tracking-wider flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4" /> Livraison
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded text-[10px] font-bold">
              <div className={`w-1.5 h-1.5 rounded-full ${isRestoGeolocated ? 'bg-green-400' : 'bg-red-500'}`}></div>
              {isRestoGeolocated ? 'GPS OK' : 'GPS ABSENT'}
            </div>
            <button onClick={onClose} className="hover:bg-white/20 rounded p-1 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          
          {/* ================= COLONNE GAUCHE (Recherche Client) ================= */}
          <div className="w-1/3 min-w-[250px] border-r border-gray-100 bg-gray-50 flex flex-col">
            <div className="p-3 border-b border-gray-200 bg-white shrink-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-black text-secondary uppercase text-xs flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Clients ({clients.length})
                </h3>
                <button 
                  onClick={() => handleClearForm(true)}
                  className="flex items-center gap-1 text-[9px] font-bold uppercase bg-primary/10 text-primary px-1.5 py-1 rounded hover:bg-primary/20"
                >
                  <UserPlus className="h-3 w-3" /> Vider
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input 
                  type="text"
                  placeholder="Chercher nom, tél..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="w-full bg-gray-100 border-none h-9 rounded-lg pl-8 pr-3 font-bold text-xs text-secondary focus:bg-white focus:ring-1 focus:ring-primary outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {isLoadingClients ? (
                <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : filteredClients.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-[10px] font-bold uppercase">Aucun client</div>
              ) : (
                filteredClients.map(client => {
                  const fullName = (client.customer_name || `${client.first_name || ''} ${client.last_name || ''}`).trim() || 'Inconnu';
                  return (
                    <button 
                      key={client.id}
                      onClick={() => handleSelectExistingClient(client)}
                      className={`w-full text-left p-2.5 rounded-lg border transition-all ${selectedClientId === client.id ? 'bg-primary/10 border-primary' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                    >
                      <div className="flex justify-between items-start mb-0.5">
                        <span className="font-bold text-xs text-secondary truncate pr-1">{fullName}</span>
                        {client.phone && <span className="text-[9px] font-black text-gray-500 bg-gray-100 px-1 rounded">{client.phone}</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">{client.address || 'Aucune adresse'}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ================= COLONNE DROITE (Formulaire) ================= */}
          <div className="flex-1 flex flex-col bg-white">
            
            {/* Contenu Scrollable (compact) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
              
              {/* Ligne Nom / Téléphone */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Nom *</label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold text-sm focus:border-primary focus:bg-white outline-none"
                    placeholder="Nom du client"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Téléphone</label>
                  <input 
                    type="tel" 
                    value={phone} 
                    onChange={e => setPhone(e.target.value)} 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold text-sm focus:border-primary focus:bg-white outline-none"
                    placeholder="06..."
                  />
                </div>
              </div>

              {/* Ligne Adresse */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Adresse (Numéro + Rue)</label>
                <div className="flex gap-2">
                  <input 
                    placeholder="N°" 
                    value={streetNumber} 
                    onChange={e => setStreetNumber(e.target.value)}
                    className={`w-16 bg-gray-50 border font-bold text-center text-sm h-10 rounded-lg focus:bg-white outline-none ${isEligible ? 'border-green-500 bg-green-50 text-green-700' : isAddressError ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200'}`}
                  />
                  <div className="flex-1 relative">
                    <input 
                      placeholder="Tapez l'adresse..."
                      value={query}
                      onChange={e => handleSearchAPI(e.target.value)}
                      className={`w-full bg-gray-50 border h-10 rounded-lg px-3 font-bold text-sm focus:bg-white outline-none ${isEligible ? 'border-green-500 bg-green-50 text-green-800' : isAddressError ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-200'}`}
                    />
                    {isCheckingDistance && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-gray-400" />}
                    
                    {/* Suggestions Dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                      <ul className="absolute top-[42px] left-0 w-full bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden">
                        {suggestions.map((feature, i) => (
                          <li key={i} onClick={() => handleSelectAddress(feature)} className="px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50">
                            <div className="font-bold text-xs text-secondary">{feature.properties.name}</div>
                            <div className="text-[10px] text-gray-400">{feature.properties.postcode} {feature.properties.city}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button 
                    onClick={handleForceCalculation}
                    disabled={isCheckingDistance}
                    className="w-10 h-10 bg-secondary text-white rounded-lg flex items-center justify-center hover:bg-secondary/90 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isCheckingDistance ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Status du calcul */}
              {calcStatus && (
                <div className={`text-[11px] font-bold px-3 py-1.5 rounded flex items-center gap-1.5 border ${calcStatus.isError ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                  {calcStatus.isError ? <AlertTriangle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  {calcStatus.msg}
                </div>
              )}

              {/* Complément */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase pl-1">Complément (Bâtiment, Code...)</label>
                <input 
                  type="text" 
                  value={additionalInfo} 
                  onChange={e => setAdditionalInfo(e.target.value)} 
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-primary focus:bg-white outline-none"
                  placeholder="Code, étage..."
                />
              </div>

            </div>

            {/* Footer Fixe de la colonne droite (Frais + Bouton) */}
            <div className="shrink-0 p-4 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
               <div className="flex items-center gap-3">
                 <div className="text-xs font-black uppercase text-gray-500">Frais Livr.</div>
                 <div className="flex items-center bg-white border border-gray-300 rounded px-2">
                    <input 
                      type="number" 
                      step="0.5"
                      value={fee} 
                      onChange={e => setFee(parseFloat(e.target.value) || 0)} 
                      className="w-14 py-1.5 font-black text-sm text-primary text-right outline-none"
                    />
                    <span className="font-black text-primary text-sm ml-1">€</span>
                 </div>
               </div>
               <button 
                 onClick={handleFinalize} 
                 className="px-6 py-2.5 bg-primary text-white rounded-lg font-black uppercase text-sm flex items-center gap-2 hover:bg-primary/90 active:scale-95 shadow-md"
               >
                 <Check className="h-4 w-4" /> Valider
               </button>
            </div>

          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};