// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Phone, User, Check, X, Loader2, Search, Users, AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';

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
  // Mode de recherche : 'phone' (pavé tactile) ou 'text' (nom/adresse)
  const [searchMode, setSearchMode] = useState<'phone' | 'text'>('phone');
  
  // Saisie pavé numérique
  const [dialPadValue, setDialPadValue] = useState('');
  const [textSearch, setTextSearch] = useState('');

  // États Formulaire Client
  const [streetNumber, setStreetNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [fee, setFee] = useState<number>(0);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Géolocalisation & Calcul
  const [isCheckingDistance, setIsCheckingDistance] = useState(false);
  const [isEligible, setIsEligible] = useState(false);
  const [calcStatus, setCalcStatus] = useState<{msg: string, isError: boolean} | null>(null);

  // Suggestions d'adresse
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clients Supabase
  const [clients, setClients] = useState<any[]>([]);
  const [filteredClients, setFilteredClients] = useState<any[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  // Resto & Zones
  const [restoCoords, setRestoCoords] = useState<{lat: number, lng: number} | null>(null);
  const [deliveryZones, setDeliveryZones] = useState<any[]>([]);
  const [isRestoGeolocated, setIsRestoGeolocated] = useState<boolean>(false);

  // Chargement initial des données
  useEffect(() => {
    const activeRestoId = getActiveRestaurantId();

    const fetchConfigAndClients = async () => {
      if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') {
        setIsLoadingClients(false);
        return;
      }

      const { data: resto } = await supabase.from('restaurants').select('*').eq('id', activeRestoId).single();
      
      let rLat = resto?.latitude !== undefined && resto?.latitude !== null ? parseFloat(resto.latitude) : null;
      let rLng = resto?.longitude !== undefined && resto?.longitude !== null ? parseFloat(resto.longitude) : null;

      if ((rLat === null || isNaN(rLat)) && resto?.address) {
        try {
          const safeQuery = encodeURIComponent(resto.address.replace(/,/g, ' ').trim());
          const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${safeQuery}&limit=1`);
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            rLng = data.features[0].geometry.coordinates[0];
            rLat = data.features[0].geometry.coordinates[1];
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
      setDialPadValue(initialData.phone || '');
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

  // Filtrage en temps réel
  useEffect(() => {
    if (searchMode === 'phone') {
      if (!dialPadValue.trim()) {
        setFilteredClients(clients);
        return;
      }
      const cleanSearch = dialPadValue.replace(/\s+/g, '');
      const filtered = clients.filter(c => {
        const p = (c.phone || '').replace(/\s+/g, '');
        return p.includes(cleanSearch);
      });
      setFilteredClients(filtered);
    } else {
      if (!textSearch.trim()) {
        setFilteredClients(clients);
        return;
      }
      const lower = textSearch.toLowerCase();
      const filtered = clients.filter(c => {
        const fullName = `${c.first_name || ''} ${c.last_name || ''} ${c.customer_name || ''}`.toLowerCase();
        const addressStr = (c.address || '').toLowerCase();
        return fullName.includes(lower) || addressStr.includes(lower);
      });
      setFilteredClients(filtered);
    }
  }, [dialPadValue, textSearch, searchMode, clients]);

  // Gestion des touches du Pavé Numérique Tactile
  const handleKeyPress = (num: string) => {
    if (dialPadValue.length < 10) {
      setDialPadValue(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setDialPadValue(prev => prev.slice(0, -1));
  };

  const handleClearPad = () => {
    setDialPadValue('');
  };

  // Passage à la création d'un nouveau client avec le numéro tapé
  const handleStartNewClient = () => {
    setIsCreatingNew(true);
    setSelectedClientId(null);
    setPhone(dialPadValue);
    setName('');
    setStreetNumber('');
    setStreetName('');
    setQuery('');
    setAdditionalInfo('');
    setFee(0);
    setIsEligible(false);
    setCalcStatus(null);
  };

  // Sélection d'un client existant
  const handleSelectExistingClient = async (client: any) => {
    setIsCreatingNew(false);
    setSelectedClientId(client.id);
    const fullName = (client.customer_name || `${client.first_name || ''} ${client.last_name || ''}`).trim();
    setName(fullName);
    setPhone(client.phone || '');
    setDialPadValue(client.phone || '');

    if (client.address) {
      const { num, street } = splitAddress(client.address);
      setStreetNumber(num);
      setStreetName(street);
      setQuery(street);

      setIsCheckingDistance(true);
      setCalcStatus({ msg: "Vérification adresse...", isError: false });
      
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
      setCalcStatus({ msg: "Aucune adresse enregistrée pour ce client.", isError: true });
    }
  };

  // API Recherche d'Adresse
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
      setCalcStatus({ msg: "GPS restaurant absent. Définissez les frais manuellement.", isError: true });
      setIsCheckingDistance(false);
      return;
    }

    const distance = calculateDistance(restoCoords.lat, restoCoords.lng, lat, lng);
    
    if (deliveryZones.length === 0) {
      setIsEligible(true);
      setFee(0);
      setCalcStatus({ msg: `Distance: ${distance.toFixed(1)} km. Aucune zone configurée.`, isError: true });
      setIsCheckingDistance(false);
      return;
    }

    const zone = deliveryZones.find(z => distance <= parseFloat(z.max_distance_km));
    
    if (zone) {
      setFee(parseFloat(zone.delivery_fee) || 0);
      setIsEligible(true);
      setCalcStatus({ msg: `✅ ${forceLabel || 'Adresse validée'} ! Distance: ${distance.toFixed(1)} km`, isError: false });
      toast.success("Zone validée !", { duration: 800 });
    } else {
      setIsEligible(false);
      setFee(0);
      setCalcStatus({ msg: `❌ Hors zone de livraison (${distance.toFixed(1)} km)`, isError: true });
      toast.error("Hors zone de livraison", { duration: 800 });
    }
    
    setIsCheckingDistance(false);
  };

  const handleForceCalculation = async () => {
    const addressToTest = `${streetNumber.trim()} ${query.trim()}`.trim();
    if (!addressToTest) return toast.error("Veuillez saisir une adresse.", { duration: 800 });

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
        setCalcStatus({ msg: "Adresse introuvable sur le GPS.", isError: true });
        toast.error("Adresse introuvable", { duration: 800 });
        setIsEligible(false);
        setIsCheckingDistance(false);
      }
    } catch (e) {
      setCalcStatus({ msg: "Erreur GPS.", isError: true });
      toast.error("Erreur GPS", { duration: 800 });
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
      toast.error("Erreur de vérification", { duration: 800 });
      setIsCheckingDistance(false);
    } 
  };

  const handleFinalize = async () => {
    if (!streetName && !isEligible) return toast.error("Sélectionnez une adresse valide.", { duration: 1000 });
    if (!name.trim()) return toast.error("Le nom du client est requis.", { duration: 1000 });

    const fullAddress = `${streetNumber.trim()} ${streetName.trim()}`.trim();
    const cleanPhone = phone.replace(/\s+/g, '');
    let finalClientId = selectedClientId;

    if (!finalClientId) {
      toast.info("Création de la fiche client...", { id: 'saveClient', duration: 800 });
      
      const newClientId = generateUUID(); 
      const fakeEmail = cleanPhone ? `guest_${cleanPhone}@caisse.local` : `guest_${Date.now()}@caisse.local`;
      const activeRestoId = localStorage.getItem('pos_restaurant_id') || RESTAURANT_ID;

      try {
        const { data: newProfile, error } = await supabase
          .from('profiles')
          .insert([{
            id: newClientId,
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
          console.error("Erreur FK Supabase:", error);
          toast.warning("Client non sauvegardé, mais commande validée !", { id: 'saveClient', duration: 1500 });
        } else if (newProfile) {
          finalClientId = newProfile.id;
          toast.success("Nouveau client créé !", { id: 'saveClient', duration: 800 });
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
    <div className="fixed inset-0 z-[999999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 font-helvetica select-none">
      
      <div className="bg-white rounded-2xl w-full max-w-6xl h-[90vh] max-h-[720px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* HEADER MODALE */}
        <div className="bg-secondary p-3 flex justify-between items-center text-white shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary"/>
            <h2 className="font-black uppercase tracking-wider text-sm">Prise d'Appel / Client Livraison</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-full text-[10px] font-bold">
              <div className={`w-2 h-2 rounded-full ${isRestoGeolocated ? 'bg-green-400' : 'bg-red-500'}`}></div>
              {isRestoGeolocated ? 'GPS ACTIF' : 'GPS INACTIF'}
            </div>
            <button onClick={onClose} className="hover:bg-white/20 rounded-lg p-1.5 transition-colors">
              <X className="h-5 w-5"/>
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          
          {/* ================= COLONNE GAUCHE (PAVÉ NUMÉRIQUE TACTILE XXL - 45%) ================= */}
          <div className="w-[45%] border-r border-gray-200 bg-gray-50 flex flex-col p-3 space-y-3 shrink-0">
            
            {/* Commutateur de Mode */}
            <div className="flex bg-gray-200 p-1 rounded-xl gap-1 shrink-0">
              <button 
                onClick={() => setSearchMode('phone')}
                className={`flex-1 py-2 rounded-lg font-black text-xs uppercase flex items-center justify-center gap-2 transition-all ${searchMode === 'phone' ? 'bg-primary text-white shadow-md' : 'text-gray-600 hover:bg-gray-300'}`}
              >
                <Phone className="h-4 w-4"/> Pavé Téléphone
              </button>
              <button 
                onClick={() => setSearchMode('text')}
                className={`flex-1 py-2 rounded-lg font-black text-xs uppercase flex items-center justify-center gap-2 transition-all ${searchMode === 'text' ? 'bg-primary text-white shadow-md' : 'text-gray-600 hover:bg-gray-300'}`}
              >
                <Search className="h-4 w-4"/> Nom / Adresse
              </button>
            </div>

            {searchMode === 'phone' ? (
              <div className="flex-1 flex flex-col justify-between space-y-2">
                
                {/* Afficheur du numéro tapé */}
                <div className="bg-white border-2 border-primary/30 rounded-xl p-3 shadow-inner flex items-center justify-between">
                  <span className="text-gray-400 font-bold text-xs">TEL:</span>
                  <span className="font-black text-2xl text-secondary tracking-widest">
                    {dialPadValue || <span className="text-gray-300 font-normal text-lg">06...</span>}
                  </span>
                </div>

                {/* GRILLE DU PAVÉ NUMÉRIQUE TACTILE XXL */}
                <div className="grid grid-cols-3 gap-2 flex-1">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                    <button
                      key={num}
                      onClick={() => handleKeyPress(num)}
                      className="bg-white border-2 border-gray-200 rounded-2xl font-black text-2xl text-secondary hover:bg-primary/10 active:bg-primary active:text-white active:scale-95 transition-all shadow-sm flex items-center justify-center"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    onClick={handleClearPad}
                    className="bg-red-50 border-2 border-red-200 rounded-2xl font-black text-sm text-red-600 hover:bg-red-500 hover:text-white active:scale-95 transition-all shadow-sm flex items-center justify-center uppercase"
                  >
                    Effacer
                  </button>
                  <button
                    onClick={() => handleKeyPress('0')}
                    className="bg-white border-2 border-gray-200 rounded-2xl font-black text-2xl text-secondary hover:bg-primary/10 active:bg-primary active:text-white active:scale-95 transition-all shadow-sm flex items-center justify-center"
                  >
                    0
                  </button>
                  <button
                    onClick={handleBackspace}
                    className="bg-orange-50 border-2 border-orange-200 rounded-2xl font-black text-lg text-orange-600 hover:bg-orange-500 hover:text-white active:scale-95 transition-all shadow-sm flex items-center justify-center"
                  >
                    ⌫
                  </button>
                </div>

              </div>
            ) : (
              /* Mode Secours : Recherche Textuelle */
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase">Recherche par Nom ou Adresse</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"/>
                    <input 
                      type="text"
                      placeholder="Saisissez le nom ou la rue..."
                      value={textSearch}
                      onChange={e => setTextSearch(e.target.value)}
                      className="w-full bg-white border-2 border-gray-200 h-11 rounded-xl pl-9 pr-3 font-bold text-sm text-secondary focus:border-primary outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* ================= COLONNE DROITE (RÉSULTATS & FORMULAIRE FICHE - 55%) ================= */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            
            {/* Si un client est sélectionné ou en cours de création */}
            {(selectedClientId || isCreatingNew) ? (
              <div className="flex-1 flex flex-col justify-between p-4 overflow-y-auto custom-scrollbar">
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                    <span className="font-black uppercase text-xs text-primary flex items-center gap-1.5">
                      <User className="h-4 w-4"/> {selectedClientId ? "Fiche Client Sélectionné" : "Nouvelle Fiche Client"}
                    </span>
                    <button 
                      onClick={() => { setSelectedClientId(null); setIsCreatingNew(false); }}
                      className="text-[10px] font-black uppercase text-gray-400 hover:text-red-500 bg-gray-100 px-2 py-1 rounded"
                    >
                      Changer
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">Nom *</label>
                      <input 
                        type="text" 
                        value={name} 
                        onChange={e => setName(e.target.value)} 
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold text-sm focus:border-primary focus:bg-white outline-none"
                        placeholder="Nom du client"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">Téléphone</label>
                      <input 
                        type="tel" 
                        value={phone} 
                        onChange={e => setPhone(e.target.value)} 
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-bold text-sm focus:border-primary focus:bg-white outline-none"
                        placeholder="06..."
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Adresse (Numéro + Rue)</label>
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
                        {isCheckingDistance && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-gray-400"/>}
                        
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
                        <RefreshCw className={`w-4 h-4 ${isCheckingDistance ? 'animate-spin' : ''}`}/>
                      </button>
                    </div>
                  </div>

                  {calcStatus && (
                    <div className={`text-[11px] font-bold px-3 py-1.5 rounded flex items-center gap-1.5 border ${calcStatus.isError ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      {calcStatus.isError ? <AlertTriangle className="w-3.5 h-3.5"/> : <Check className="w-3.5 h-3.5"/>}
                      {calcStatus.msg}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Complément (Bâtiment, Interphone...)</label>
                    <input 
                      type="text" 
                      value={additionalInfo} 
                      onChange={e => setAdditionalInfo(e.target.value)} 
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-primary focus:bg-white outline-none"
                      placeholder="Code, étage, bâtiment..."
                    />
                  </div>
                </div>

                {/* Footer Validation */}
                <div className="pt-3 border-t border-gray-200 flex justify-between items-center mt-2">
                   <div className="flex items-center gap-2">
                     <span className="text-xs font-black uppercase text-gray-500">Frais Livr.</span>
                     <div className="flex items-center bg-white border border-gray-300 rounded px-2">
                        <input 
                          type="number" 
                          step="0.5"
                          value={fee} 
                          onChange={e => setFee(parseFloat(e.target.value) || 0)} 
                          className="w-12 py-1 font-black text-sm text-primary text-right outline-none"
                        />
                        <span className="font-black text-primary text-sm ml-0.5">€</span>
                     </div>
                   </div>
                   <button 
                     onClick={handleFinalize} 
                     className="px-6 py-2.5 bg-primary text-white rounded-xl font-black uppercase text-sm flex items-center gap-2 hover:bg-primary/90 active:scale-95 shadow-md"
                   >
                     <Check className="h-4 w-4"/> Valider Commande
                   </button>
                </div>

              </div>
            ) : (
              /* LISTE DE FILTRAGE DES CLIENTS EN TEMPS RÉEL */
              <div className="flex-1 flex flex-col p-3 overflow-hidden">
                <div className="flex justify-between items-center mb-2 shrink-0">
                  <span className="font-black uppercase text-xs text-gray-400 flex items-center gap-1.5">
                    <Users className="h-4 w-4"/> Clients Trouvés ({filteredClients.length})
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                  {isLoadingClients ? (
                    <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin"/></div>
                  ) : filteredClients.length === 0 ? (
                    <div className="text-center py-10 space-y-3">
                      <div className="text-gray-400 text-xs font-bold uppercase">Aucun client trouvé avec ce numéro</div>
                      {dialPadValue.length >= 3 && (
                        <button
                          onClick={handleStartNewClient}
                          className="px-5 py-3 bg-green-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 mx-auto hover:bg-green-700 active:scale-95 shadow-lg transition-all"
                        >
                          <Plus className="h-4 w-4"/> Créer un nouveau client avec le {dialPadValue}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {dialPadValue.length >= 3 && (
                        <button
                          onClick={handleStartNewClient}
                          className="w-full p-2.5 bg-green-50 border-2 border-dashed border-green-300 text-green-700 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-green-100 active:scale-95 transition-all mb-2"
                        >
                          <Plus className="h-4 w-4"/> Créer une nouvelle fiche pour le {dialPadValue}
                        </button>
                      )}
                      
                      {filteredClients.map(client => {
                        const fullName = (client.customer_name || `${client.first_name || ''} ${client.last_name || ''}`).trim() || 'Client Sans Nom';
                        return (
                          <button 
                            key={client.id}
                            onClick={() => handleSelectExistingClient(client)}
                            className="w-full text-left p-3 rounded-xl border-2 border-gray-100 bg-white hover:border-primary hover:bg-primary/5 active:scale-[0.99] transition-all shadow-sm flex justify-between items-center group"
                          >
                            <div className="space-y-1">
                              <div className="font-black text-sm text-secondary group-hover:text-primary transition-colors">{fullName}</div>
                              <div className="text-xs text-gray-500 font-bold flex items-center gap-1">
                                <MapPin className="h-3 w-3 text-gray-400"/> {client.address || 'Aucune adresse renseignée'}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-black text-xs text-primary bg-primary/10 px-2.5 py-1 rounded-lg block">
                                {client.phone || 'Sans tel'}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}

          </div>

        </div>
      </div>
    </div>,
    document.body
  );
};