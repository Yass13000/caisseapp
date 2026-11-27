// Statut à l'arrivée des commandes, par canal (caisse, borne, appli).
// Le choix est enregistré dans Supabase (pos_order_arrival) et appliqué par
// une règle côté base au moment où la commande arrive : il vaut donc pour
// toutes les caisses, bornes et l'appli du restaurant.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, getActiveRestaurantId } from '@/lib/supabaseClient';

type Arrival = 'Nouvelle' | 'En cours';
type Channel = 'caisse' | 'borne' | 'app';

const CHANNELS: { key: Channel; label: string; Icon: any }[] = [
  { key: 'caisse', label: 'Caisse', Icon: Monitor },
  { key: 'borne', label: 'Borne', Icon: Tablet },
  { key: 'app', label: 'Appli / site', Icon: Smartphone },
];

const CHOICES: { value: Arrival; label: string; hint: string }[] = [
  { value: 'Nouvelle', label: 'Nouvelle', hint: 'à accepter en cuisine' },
  { value: 'En cours', label: 'En cours', hint: 'directement en préparation' },
];

const missingSetup = (error: any) => {
  const msg = String(error?.message || '') + ' ' + String(error?.code || '');
  return /pos_order_arrival|PGRST202|42883|does not exist|Could not find the function/i.test(msg);
};

const OrderArrivalSettings = () => {
  const restaurantId = getActiveRestaurantId();
  const [settings, setSettings] = useState<Partial<Record<Channel, Arrival>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Channel | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('pos_order_arrival_get', { p_restaurant_id: restaurantId });
      if (rpcError) {
        if (missingSetup(rpcError)) setNotInstalled(true);
        else setError('Réglage illisible pour le moment. Vérifiez la connexion.');
        return;
      }
      setNotInstalled(false);
      setSettings((data && typeof data === 'object') ? data : {});
    } catch {
      setError('Réglage illisible pour le moment. Vérifiez la connexion.');
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  const choose = async (channel: Channel, value: Arrival) => {
    if ((settings[channel] || 'Nouvelle') === value || saving) return;
    const next = { ...settings, [channel]: value };
    setSaving(channel);
    try {
      const { data, error: rpcError } = await supabase.rpc('pos_order_arrival_set', { p_restaurant_id: restaurantId, p_settings: next });
      if (rpcError) throw rpcError;
      setSettings((data && typeof data === 'object') ? data : next);
      const label = CHANNELS.find(c => c.key === channel)?.label;
      toast.success(`${label} : les commandes arriveront en « ${value} »`);
    } catch (e: any) {
      if (missingSetup(e)) setNotInstalled(true);
      else toast.error("Enregistrement impossible. Vérifiez la connexion.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-gray-500 font-bold py-10">
        <Loader2 className="animate-spin" size={20} /> Chargement…
      </div>
    );
  }

  if (notInstalled) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
        <p className="font-black uppercase text-sm mb-2">Réglage pas encore activé</p>
        <p className="font-bold text-sm leading-relaxed">
          Il faut d'abord exécuter une fois le script <span className="font-mono">docs/statut-arrivee-commandes.sql</span> dans
          Supabase (SQL Editor). En attendant, toutes les commandes arrivent en « Nouvelle », comme avant.
        </p>
        <button type="button" onClick={load} className="mt-4 h-11 px-4 rounded-xl bg-amber-400 text-amber-950 font-black text-sm uppercase flex items-center gap-2 active:scale-95">
          <RefreshCw size={16} /> Vérifier à nouveau
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-red-700 font-bold text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={load} className="h-10 px-3 rounded-lg bg-red-600 text-white font-black text-xs uppercase shrink-0">Réessayer</button>
        </div>
      )}

      {CHANNELS.map(({ key, label, Icon }) => {
        const current = settings[key] || 'Nouvelle';
        return (
          <div key={key} className="rounded-2xl border-2 border-gray-100 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 text-secondary flex items-center justify-center shrink-0">
                <Icon size={20} />
              </div>
              <p className="font-black text-secondary uppercase">{label}</p>
              {saving === key && <Loader2 className="animate-spin text-gray-400 ml-auto" size={18} />}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CHOICES.map(choice => {
                const active = current === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    disabled={!!saving}
                    onClick={() => choose(key, choice.value)}
                    className={`min-h-[56px] rounded-xl border-2 px-4 py-2 text-left transition-all active:scale-[0.98] disabled:opacity-60 ${
                      active ? 'border-primary bg-primary/10' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span className={`block font-black ${active ? 'text-primary' : 'text-secondary'}`}>{choice.label}</span>
                    <span className="block text-xs font-bold text-gray-500">{choice.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-xs font-bold text-gray-500 leading-relaxed">
        Le choix vaut pour tout le restaurant (toutes les caisses, bornes et l'appli) et s'applique aux prochaines commandes.
        Les commandes arrivées en « En cours » ne déclenchent pas l'alerte « nouvelle commande » du KDS.
      </p>
    </div>
  );
};

export default OrderArrivalSettings;
