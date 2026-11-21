// Réglages > Écran client : pubs.
// Table existante restaurant_images (partagée avec la borne et l'app) :
//   Caisse1..5 gérées ici ; Borne1..3 (borne) et Pub1..2 (app) affichées aussi, en lecture seule.
// Les écrans clients téléchargent les fichiers et les gardent en cache (voir electron/main.js).
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, Loader2, Minus, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import {
  AD_NAMES,
  ADS_BUCKET,
  ADS_TABLE,
  CAISSE_AD_SLOTS,
  adSource,
  getCustomerDisplayAPI,
  mediaTypeFromUrl,
  readAdImageDuration,
  rowsToAds,
  type RestaurantImageRow,
} from '@/lib/customerDisplay';

const MAX_SIZE = 100 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';

const getRestaurantId = (): string | null => {
  try {
    const api = (window as any).electronAPI;
    const v = api?.getSetting ? api.getSetting('pos_restaurant_id', null) : localStorage.getItem('pos_restaurant_id');
    const id = v === null || v === undefined ? '' : String(v).trim();
    return id && id !== 'null' && id !== 'undefined' ? id : null;
  } catch {
    return null;
  }
};

const notifyScreen = () => getCustomerDisplayAPI()?.refresh?.();

const Media = ({ url }: { url: string }) =>
  mediaTypeFromUrl(url) === 'video' ? (
    <>
      <video src={url} muted preload="metadata" className="w-full h-full object-contain" />
      <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center"><Play size={20} fill="white" /></span>
      </span>
    </>
  ) : (
    <img src={url} alt="" className="w-full h-full object-contain" loading="lazy" />
  );

const iconBtn = 'w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 cursor-pointer disabled:opacity-40';

const CustomerDisplayAds = () => {
  const [restaurantId] = useState(getRestaurantId);
  const [rows, setRows] = useState<RestaurantImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [duration, setDuration] = useState(readAdImageDuration);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<string | null>(null);

  const load = async () => {
    if (!restaurantId) return;
    const { data, error } = await supabase
      .from(ADS_TABLE)
      .select('id, nom, image_url, restaurant_id, is_active')
      .eq('restaurant_id', restaurantId)
      .in('nom', AD_NAMES);
    setLoading(false);
    if (error) { toast.error('Pubs : chargement impossible'); return; }
    setRows((data as RestaurantImageRow[]) || []);
  };

  useEffect(() => {
    if (!restaurantId) { setLoading(false); return; }
    load();
  }, [restaurantId]);

  const bySlot = (slot: string) => rows.find(r => r.nom === slot && r.image_url);

  const pick = (slot: string) => {
    pendingSlot.current = slot;
    inputRef.current?.click();
  };

  // Même fonctionnement que les pubs de la borne : fichier « pub-<emplacement>-<date> » dans Images, ligne mise à jour ou créée
  const upload = async (file: File | undefined) => {
    const slot = pendingSlot.current;
    if (inputRef.current) inputRef.current.value = '';
    if (!file || !slot || !restaurantId) return;
    if (!ACCEPT.split(',').includes(file.type)) { toast.error('Format non pris en charge'); return; }
    if (file.size > MAX_SIZE) { toast.error('Fichier de plus de 100 Mo'); return; }

    setBusySlot(slot);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const fileName = `pub-${slot.toLowerCase()}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(ADS_BUCKET).upload(fileName, file, { cacheControl: '3600', upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from(ADS_BUCKET).getPublicUrl(fileName);

      const existing = rows.find(r => r.nom === slot);
      const { error } = existing
        ? await supabase.from(ADS_TABLE).update({ image_url: publicUrl, is_active: true }).eq('id', existing.id)
        : await supabase.from(ADS_TABLE).insert([{ nom: slot, image_url: publicUrl, restaurant_id: restaurantId, is_active: true }]);
      if (error) throw error;
      await load();
      notifyScreen();
    } catch (err: any) {
      toast.error(`Envoi impossible : ${err?.message || 'erreur'}`);
    } finally {
      setBusySlot(null);
    }
  };

  const toggle = async (row: RestaurantImageRow) => {
    const next = row.is_active === false;
    setRows(rs => rs.map(r => (r.id === row.id ? { ...r, is_active: next } : r)));
    const { error } = await supabase.from(ADS_TABLE).update({ is_active: next }).eq('id', row.id);
    if (error) { toast.error('Modification impossible'); load(); return; }
    notifyScreen();
  };

  const remove = async (row: RestaurantImageRow) => {
    setBusySlot(row.nom);
    const { error } = await supabase.from(ADS_TABLE).delete().eq('id', row.id);
    setBusySlot(null);
    if (error) { toast.error('Suppression impossible'); return; }
    setRows(rs => rs.filter(r => r.id !== row.id));
    notifyScreen();
  };

  const changeDuration = (delta: number) => {
    const v = Math.min(60, Math.max(3, duration + delta));
    setDuration(v);
    try { localStorage.setItem('customer_display_ad_duration', String(v)); } catch { /* sans effet */ }
    (window as any).electronAPI?.setSetting?.('customer_display_ad_duration', String(v));
  };

  if (!restaurantId) return null;

  // Pubs borne et app, affichées aussi sur l'écran client (gérées ailleurs)
  const shared = rowsToAds(rows.map(r => ({ ...r, is_active: true }))).filter(r => adSource(r.nom) !== 'caisse');

  return (
    <div className="bg-white rounded-[2rem] border border-gray-200 p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-xl font-black text-secondary uppercase tracking-wide">Pubs</div>
        <div className="flex items-center gap-2" aria-label="Durée d'une image">
          <button type="button" aria-label="Moins longtemps" onClick={() => changeDuration(-1)} className={`${iconBtn} bg-gray-100 text-secondary`}><Minus size={18} /></button>
          <span className="w-14 text-center font-black text-secondary tabular-nums text-lg">{duration}s</span>
          <button type="button" aria-label="Plus longtemps" onClick={() => changeDuration(1)} className={`${iconBtn} bg-gray-100 text-secondary`}><Plus size={18} /></button>
        </div>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={28} /></div>
      ) : (
        <>
          {/* Emplacements de la caisse */}
          <div className="grid grid-cols-3 gap-4">
            {CAISSE_AD_SLOTS.map((slot, i) => {
              const row = bySlot(slot);
              const busy = busySlot === slot;
              if (!row) {
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => pick(slot)}
                    disabled={!!busySlot}
                    aria-label={`Ajouter une pub (${slot})`}
                    className="relative aspect-video rounded-2xl border-2 border-dashed border-gray-300 hover:border-gray-400 bg-gray-50 flex items-center justify-center text-gray-400 active:scale-[0.98] cursor-pointer disabled:cursor-wait"
                  >
                    <span className="absolute top-2 left-2 w-8 h-8 rounded-lg bg-gray-200 text-gray-500 font-black text-sm flex items-center justify-center">{i + 1}</span>
                    {busy ? <Loader2 size={30} className="animate-spin" /> : <ImagePlus size={30} />}
                  </button>
                );
              }
              const off = row.is_active === false;
              return (
                <div key={slot} className={`rounded-2xl border-2 overflow-hidden bg-gray-50 ${off ? 'border-dashed border-gray-300' : 'border-gray-200'}`}>
                  <div className={`relative aspect-video bg-black ${off ? 'opacity-40' : ''}`}>
                    <Media url={row.image_url!} />
                    <span className="absolute top-2 left-2 w-8 h-8 rounded-lg bg-black/60 text-white font-black text-sm flex items-center justify-center">{i + 1}</span>
                    {busy && <span className="absolute inset-0 bg-black/40 flex items-center justify-center text-white"><Loader2 size={30} className="animate-spin" /></span>}
                  </div>
                  <div className="p-2 flex items-center justify-between gap-1">
                    <button type="button" aria-label="Remplacer" onClick={() => pick(slot)} disabled={!!busySlot} className={`${iconBtn} bg-white border border-gray-200 text-secondary`}><RefreshCw size={19} /></button>
                    <div className="flex gap-1">
                      <button type="button" aria-label={off ? 'Afficher' : 'Masquer'} onClick={() => toggle(row)} disabled={!!busySlot} className={`${iconBtn} bg-white border border-gray-200 text-secondary`}>
                        {off ? <EyeOff size={19} /> : <Eye size={19} />}
                      </button>
                      <button type="button" aria-label="Supprimer" onClick={() => remove(row)} disabled={!!busySlot} className={`${iconBtn} bg-red-50 text-red-600`}><Trash2 size={19} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pubs borne et app (lecture seule) */}
          {shared.length > 0 && (
            <div className="pt-5 border-t border-gray-100">
              <div className="grid grid-cols-5 gap-3">
                {shared.map(row => {
                  const off = rows.find(r => r.id === row.id)?.is_active === false;
                  return (
                    <div key={row.id} className={`relative aspect-video rounded-xl overflow-hidden bg-black ${off ? 'opacity-40' : ''}`}>
                      <Media url={row.image_url!} />
                      <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/60 text-white font-black text-[11px] uppercase tracking-wider">
                        {adSource(row.nom) === 'borne' ? 'Borne' : 'App'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={e => upload(e.target.files?.[0])} />
    </div>
  );
};

export default CustomerDisplayAds;
