// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { RefreshCw, Check, Store, ShieldCheck, Unlink } from 'lucide-react';

interface PosSetupProps {
  children?: React.ReactNode;
  forceShow?: boolean;
}

const generateRandomPairingCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const PosSetup: React.FC<PosSetupProps> = ({ children, forceShow = false }) => {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [manualRestoId, setManualRestoId] = useState('');
  const [isLoadingManual, setIsLoadingManual] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [pairedSuccess, setPairedSuccess] = useState<boolean>(false);

  const [pairingCode, setPairingCode] = useState<string>(() => generateRandomPairingCode());
  const [deviceId] = useState<string>(() => {
    let id = localStorage.getItem('pos_device_id');
    if (!id) {
      id = `pos_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`;
      localStorage.setItem('pos_device_id', id);
    }
    return id;
  });

  const isPairedHandledRef = useRef(false);

  // Vérification de la configuration existante
  useEffect(() => {
    const existingId = 
      localStorage.getItem('pos_restaurant_id') || 
      localStorage.getItem('admin_override_restaurant_id');
      
    if (existingId && existingId !== 'null' && existingId !== 'undefined' && existingId.trim().length > 5) {
      setIsConfigured(true);
    } else {
      setIsConfigured(false);
    }
    setIsChecking(false);
  }, []);

  // Déblocage et sauvegarde
  const persistConfiguration = useCallback(async (cleanRestoId: string) => {
    const validId = String(cleanRestoId).trim();
    if (!validId || isPairedHandledRef.current) return;

    isPairedHandledRef.current = true;
    localStorage.setItem('pos_restaurant_id', validId);
    localStorage.setItem('admin_override_restaurant_id', validId);

    if (window.electronAPI?.setSetting) {
      try {
        window.electronAPI.setSetting('pos_restaurant_id', validId);
        window.electronAPI.setSetting('admin_override_restaurant_id', validId);
      } catch (e) {
        console.error("Erreur Electron :", e);
      }
    }

    setPairedSuccess(true);
    toast.success("Caisse liée avec succès !");

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('restaurant_id_changed', { detail: { restaurantId: validId } }));
      setIsConfigured(true);
      if (forceShow) {
        window.location.reload();
      }
    }, 800);
  }, [forceShow]);

  // Dissociation du restaurant
  const handleDissociate = (e: React.MouseEvent) => {
    e.preventDefault();
    localStorage.removeItem('pos_restaurant_id');
    localStorage.removeItem('admin_override_restaurant_id');
    localStorage.setItem('pos_restaurant_id', '');
    localStorage.setItem('admin_override_restaurant_id', '');
    
    if (window.electronAPI?.setSetting) {
      window.electronAPI.setSetting('pos_restaurant_id', '');
    }
    
    toast.success("Restaurant dissocié avec succès.");
    window.dispatchEvent(new Event('restaurant_id_changed'));
    setTimeout(() => window.location.reload(), 300);
  };

  // 1. Inscription du code en base de données
  useEffect(() => {
    if (!forceShow && isConfigured) return;

    const registerPairingSession = async () => {
      try {
        const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
        await supabase.from('screen_pairings').upsert(
          {
            pairing_code: pairingCode,
            device_name: 'Caisse Principale',
            device_type: 'pos',
            status: 'PENDING',
            expires_at: expiresAt
          },
          { onConflict: 'pairing_code' }
        );
      } catch (err) {
        console.warn('screen_pairings bypass:', err);
      }
    };

    registerPairingSession();
  }, [pairingCode, isConfigured, forceShow]);

  // 2. Écoute temps réel (Canal unifié) + Polling de secours automatique
  useEffect(() => {
    if (!forceShow && isConfigured) return;

    isPairedHandledRef.current = false;

    // A. Un seul canal WebSocket pour éviter d'engorger Supabase
    const channelName = `pos_channel_${pairingCode}_${Date.now()}`;
    const channel = supabase.channel(channelName)
      .on('broadcast', { event: 'pair_success' }, (payload) => {
        const rId = payload?.payload?.restaurant_id || payload?.payload?.restaurantId;
        if (rId) persistConfiguration(rId);
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'screen_pairings',
          filter: `pairing_code=eq.${pairingCode}`
        },
        (payload) => {
          const row = payload.new;
          if (row && (row.status === 'PAIRED' || row.status === 'paired') && row.restaurant_id) {
            persistConfiguration(row.restaurant_id);
          }
        }
      )
      .subscribe();

    // B. Polling régulier de secours toutes les 1.5 secondes (100% insensible aux déconnexions WebSockets)
    const pollInterval = setInterval(async () => {
      if (isPairedHandledRef.current) return;
      try {
        const { data } = await supabase
          .from('screen_pairings')
          .select('status, restaurant_id')
          .eq('pairing_code', pairingCode)
          .maybeSingle();

        if (data && (data.status === 'PAIRED' || data.status === 'paired') && data.restaurant_id) {
          persistConfiguration(data.restaurant_id);
        }
      } catch (e) {
        // Erreur réseau temporaire ignorée
      }
    }, 1500);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [pairingCode, isConfigured, forceShow, persistConfiguration]);

  const handleValidateManual = async () => {
    const cleanId = manualRestoId.trim();
    if (!cleanId) return toast.error("Veuillez saisir un identifiant.");

    setIsLoadingManual(true);
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name')
        .eq('id', cleanId)
        .single();

      if (error || !data) return toast.error("Restaurant introuvable.");

      await persistConfiguration(cleanId);
    } catch (err) {
      toast.error("Erreur lors de la validation.");
    } finally {
      setIsLoadingManual(false);
    }
  };

  // URL cible générée pour le QR code
  const mobilePairUrl = `https://borne1313.vercel.app/#/pair?code=${pairingCode}&type=pos`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(mobilePairUrl)}&margin=12`;

  if (isChecking) {
    return <div className="h-screen w-screen bg-[#0B0F19]" />;
  }

  if (!forceShow && isConfigured) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-[99999] h-screen w-screen overflow-hidden bg-[#0B0F19] text-white flex flex-col justify-between select-none font-sans">
      <header className="h-14 px-8 flex items-center justify-between border-b border-white/10 shrink-0 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Store size={18} />
          </div>
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-neutral-300">
            Caisse Enregistreuse • Appairage
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          En attente
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <AnimatePresence mode="wait">
          {pairedSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center text-center"
            >
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-emerald-400 mb-4 shadow-2xl">
                <Check size={40} strokeWidth={3} />
              </div>
              <h2 className="text-2xl font-bold uppercase tracking-wider text-white mb-1">
                Caisse connectée
              </h2>
              <p className="text-gray-400 text-xs">
                Synchronisation immédiate du catalogue...
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="pairing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full max-w-3xl bg-white/[0.03] border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col md:flex-row items-center gap-8"
            >
              {/* QR Code */}
              <div className="p-4 bg-white rounded-2xl shadow-xl shrink-0">
                <img 
                  src={qrImageUrl} 
                  alt="QR Code Caisse" 
                  className="w-52 h-52 object-contain block" 
                />
              </div>

              {/* Panneau latéral */}
              <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left space-y-4 w-full">
                <div>
                  <h2 className="text-2xl font-bold uppercase tracking-tight text-white mb-1">
                    Connecter la Caisse
                  </h2>
                  <p className="text-gray-400 text-xs">
                    Scannez le QR code ou saisissez le code ci-dessous sur l'admin.
                  </p>
                </div>

                <div className="w-full bg-white/[0.04] border border-white/10 rounded-xl p-3.5 flex flex-col items-center md:items-start">
                  <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-gray-500 mb-1">
                    Code d'association direct
                  </span>
                  <div className="font-mono text-4xl font-bold tracking-[0.25em] text-blue-400">
                    {pairingCode.slice(0, 3)} {pairingCode.slice(3)}
                  </div>
                </div>

                {/* Actions */}
                <div className="w-full space-y-2.5">
                  <button
                    type="button"
                    onClick={handleDissociate}
                    className="w-full py-2.5 bg-red-950/40 border border-red-800/40 text-red-300 hover:bg-red-900/50 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Unlink size={14} />
                    <span>Dissocier le restaurant</span>
                  </button>

                  {showManualInput ? (
                    <div className="w-full space-y-2 pt-1">
                      <input
                        type="text"
                        value={manualRestoId}
                        onChange={(e) => setManualRestoId(e.target.value)}
                        placeholder="UUID du restaurant..."
                        className="w-full bg-white/[0.05] border border-white/20 px-4 py-2 rounded-xl text-xs text-white placeholder:text-gray-500 font-mono text-center focus:outline-none focus:border-blue-400"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowManualInput(false)}
                          className="px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={handleValidateManual}
                          disabled={isLoadingManual}
                          className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs uppercase rounded-xl transition-all cursor-pointer disabled:opacity-50"
                        >
                          {isLoadingManual ? 'Vérification...' : 'Valider'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center md:justify-start gap-4 text-xs text-gray-400 pt-1">
                      <button
                        type="button"
                        onClick={() => setPairingCode(generateRandomPairingCode())}
                        className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={12} />
                        <span>Renouveler</span>
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => setShowManualInput(true)}
                        className="hover:text-white transition-colors cursor-pointer"
                      >
                        Saisie manuelle UUID
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="h-10 px-8 flex items-center justify-between border-t border-white/10 text-xs text-gray-500 shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-blue-400" />
          <span>Liaison chiffrée</span>
        </div>
        <span className="font-mono text-[10px] text-gray-600">ID : {deviceId}</span>
      </footer>
    </div>
  );
};

export default PosSetup;