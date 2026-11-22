// Réglages des TPE SumUp Solo : serveur, appairage, choix du TPE de cette caisse.
import { useCallback, useEffect, useState } from 'react';
import { BatteryMedium, Check, Loader2, Plus, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  type SoloReader,
  getSelectedReader,
  getSoloApiUrl,
  getSoloPosKey,
  listReaders,
  pairReader,
  saveSoloServer,
  selectReader,
  unpairReader,
} from '@/services/sumupSolo';

const inputClass = 'w-full h-12 rounded-xl border-2 border-gray-200 bg-white px-4 text-base font-bold text-secondary outline-none focus:border-primary';

const SumUpSoloSettings = () => {
  const [url, setUrl] = useState(getSoloApiUrl());
  const [posKey, setPosKey] = useState(getSoloPosKey());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [readers, setReaders] = useState<SoloReader[]>([]);
  const [affiliateReady, setAffiliateReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(getSelectedReader()?.id || '');
  const [showPair, setShowPair] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listReaders();
      setReaders(data.readers);
      setAffiliateReady(data.affiliate_ready);
      // Le TPE choisi a été retiré du compte : la caisse repasse en encaissement manuel
      const current = getSelectedReader();
      if (current && !data.readers.some((r) => r.id === current.id)) {
        selectReader(null);
        setSelectedId('');
      }
    } catch (err: any) {
      setError(err?.message || 'Lecture des TPE impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveServer = () => {
    saveSoloServer(url, posKey);
    setUrl(getSoloApiUrl());
    toast.success('Serveur enregistré');
    refresh();
  };

  const choose = (reader: SoloReader | null) => {
    selectReader(reader ? { id: reader.id, name: reader.name } : null);
    setSelectedId(reader?.id || '');
    toast.success(reader ? `Paiements carte sur « ${reader.name} »` : 'Paiement carte manuel');
  };

  const pair = async () => {
    if (pairing) return;
    setPairing(true);
    try {
      const { reader } = await pairReader(code, name);
      toast.success(`TPE « ${reader.name} » appairé`);
      setCode('');
      setName('');
      setShowPair(false);
      await refresh();
      // Premier TPE de la caisse : choisi d'office
      if (!getSelectedReader()) choose({ ...reader, online: true } as SoloReader);
    } catch (err: any) {
      toast.error(err?.message || 'Appairage impossible.');
    } finally {
      setPairing(false);
    }
  };

  const remove = async (reader: SoloReader) => {
    try {
      await unpairReader(reader.id);
      if (selectedId === reader.id) choose(null);
      setConfirmDelete('');
      toast.success(`TPE « ${reader.name} » retiré`);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Suppression impossible.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border-2 border-gray-100 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="font-black text-secondary uppercase text-sm">TPE de cette caisse</h3>
            <button type="button" onClick={refresh} disabled={loading} aria-label="Actualiser" className="ml-auto h-10 w-10 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => setShowPair((v) => !v)} aria-label="Ajouter un TPE" className="h-10 w-10 rounded-full bg-primary text-white flex items-center justify-center active:scale-95 transition">
              <Plus className={`h-5 w-5 transition-transform ${showPair ? 'rotate-45' : ''}`} />
            </button>
          </div>

          {error && <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
          {!error && !affiliateReady && (
            <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm font-bold text-amber-800">
              Clé d'affilié SumUp non renseignée pour ce restaurant : les paiements seront refusés tant qu'elle manque.
            </p>
          )}

          {showPair && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
              <p className="text-sm font-bold text-gray-600">
                Sur le Solo déconnecté : menu du haut → Connexions → API → Connecter, puis saisissez le code affiché.
              </p>
              <input className={`${inputClass} tracking-[0.3em] uppercase text-center text-xl`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9))} placeholder="CODE" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du TPE (ex. Comptoir)" maxLength={60} />
              <button type="button" onClick={pair} disabled={pairing || code.length < 8 || !name.trim()} className="w-full h-12 rounded-xl bg-primary text-white font-black flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-40">
                {pairing && <Loader2 className="h-5 w-5 animate-spin" />} Appairer
              </button>
            </div>
          )}

          <div className="space-y-2">
            {/* Encaissement manuel : la caisse enregistre « Carte » sans piloter de TPE */}
            <button type="button" onClick={() => choose(null)} className={`w-full flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${!selectedId ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className={`h-6 w-6 rounded-full border-2 flex items-center justify-center ${!selectedId ? 'border-primary bg-primary text-white' : 'border-gray-300'}`}>{!selectedId && <Check className="h-4 w-4" />}</span>
              <span className="font-black text-secondary">Manuel</span>
              <span className="ml-auto text-xs font-bold text-gray-400">sans TPE piloté</span>
            </button>

            {readers.map((r) => {
              const usable = r.pairing === 'paired';
              const selected = selectedId === r.id;
              return (
                <div key={r.id} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 transition ${selected ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
                  <button type="button" disabled={!usable} onClick={() => choose(r)} className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:opacity-50">
                    <span className={`h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center ${selected ? 'border-primary bg-primary text-white' : 'border-gray-300'}`}>{selected && <Check className="h-4 w-4" />}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-black text-secondary">{r.name}</span>
                      <span className="block truncate text-xs font-bold text-gray-400">
                        {usable ? (r.serial || r.model || 'Solo') : r.pairing === 'processing' ? 'Appairage en attente sur le TPE' : 'Appairage expiré : à refaire'}
                      </span>
                    </span>
                  </button>
                  {usable && (
                    <span className={`flex items-center gap-2 text-xs font-black ${r.online ? 'text-emerald-600' : 'text-red-500'}`}>
                      {r.battery != null && <span className="flex items-center gap-0.5 text-gray-400"><BatteryMedium className="h-4 w-4" />{r.battery}%</span>}
                      {r.online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                      {r.online ? 'En ligne' : 'Hors ligne'}
                    </span>
                  )}
                  {confirmDelete === r.id ? (
                    <button type="button" onClick={() => remove(r)} className="h-10 px-3 rounded-lg bg-red-600 text-white text-xs font-black">Retirer ?</button>
                  ) : (
                    <button type="button" aria-label={`Retirer ${r.name}`} onClick={() => setConfirmDelete(r.id)} className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

      {/* Avancé : serveur (inutile dans une installation normale) */}
      <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs font-bold text-gray-400 underline underline-offset-4">
        {showAdvanced ? 'Masquer les réglages avancés' : 'Réglages avancés'}
      </button>
      {showAdvanced && (
        <section className="rounded-2xl border-2 border-gray-100 bg-white p-5 space-y-3">
          <h3 className="font-black text-secondary uppercase text-sm">Serveur</h3>
          <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Adresse du serveur (https://…)" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" />
          <input className={inputClass} value={posKey} onChange={(e) => setPosKey(e.target.value)} placeholder="Clé d'appareil (facultative)" type="password" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <button type="button" onClick={saveServer} className="h-12 px-6 rounded-xl bg-secondary text-white font-black active:scale-[0.98] transition">Enregistrer</button>
        </section>
      )}
    </div>
  );
};

export default SumUpSoloSettings;
