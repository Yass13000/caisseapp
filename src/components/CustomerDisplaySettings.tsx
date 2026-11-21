// Réglages de l'écran client (second écran) : activation et fond.
import { useEffect, useState } from 'react';
import { Check, ImagePlus, Monitor, MonitorOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import CustomerDisplayAds from '@/components/CustomerDisplayAds';
import {
  BRAND_BACKGROUNDS,
  brandBackground,
  getCustomerDisplayAPI,
  readCustomerDisplaySettings,
  type CustomerBgMode,
  type CustomerDisplayBrand,
} from '@/lib/customerDisplay';

const setSetting = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* sans effet */ }
  (window as any).electronAPI?.setSetting?.(key, value);
};

const readBrand = (): CustomerDisplayBrand | null => {
  try {
    const raw = localStorage.getItem('customer_display_brand');
    const brand = raw ? JSON.parse(raw) : null;
    const api = (window as any).electronAPI;
    const restoId = String((api?.getSetting ? api.getSetting('pos_restaurant_id', '') : localStorage.getItem('pos_restaurant_id')) || '');
    return brand && (!brand.id || brand.id === restoId) ? brand : null;
  } catch {
    return null;
  }
};

const Tile = ({ selected, onClick, style, children, label }: any) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    aria-pressed={selected}
    className={`relative aspect-[16/10] rounded-2xl overflow-hidden border-2 transition-all active:scale-95 cursor-pointer flex items-center justify-center ${
      selected ? 'border-primary ring-4 ring-primary/25' : 'border-gray-200 hover:border-gray-300'
    }`}
    style={style}
  >
    {children}
    {selected && (
      <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shadow">
        <Check size={16} strokeWidth={3} />
      </span>
    )}
  </button>
);

const CustomerDisplaySettings = () => {
  const api = getCustomerDisplayAPI();
  const [cfg, setCfg] = useState(readCustomerDisplaySettings);
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<{ displays: number; open: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const brand = readBrand();

  const refresh = () => setCfg(readCustomerDisplaySettings());

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const poll = () => api.getStatus().then(s => { if (alive) setStatus(s); }).catch(() => {});
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api.getBackground().then(src => { if (alive) setImage(src); }).catch(() => {});
    return () => { alive = false; };
  }, [cfg.version]);

  if (!api) {
    // Ancienne version de l'appli (ou navigateur) : les pubs se gèrent quand même, elles sont dans Supabase
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-[2rem] border border-gray-200 p-10 flex items-center gap-5 text-gray-500 font-bold">
          <MonitorOff size={36} className="text-gray-400 flex-shrink-0" />
          Disponible avec la dernière version de l'application caisse.
        </div>
        <CustomerDisplayAds />
      </div>
    );
  }

  const setMode = (mode: CustomerBgMode, extra?: [string, string]) => {
    if (extra) setSetting(extra[0], extra[1]);
    setSetting('customer_display_bg_mode', mode);
    refresh();
  };

  const pickImage = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.pickBackground();
      if (res.success) toast.success('Image enregistrée');
      else if (!res.canceled) toast.error('Image illisible');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const removeImage = async () => {
    await api.clearBackground();
    setImage(null);
    refresh();
  };

  const current = brandBackground(cfg.mode, cfg.gradient, brand);
  const previewBg = cfg.mode === 'image' && image ? `center / cover no-repeat url("${image}")` : current.css;
  const previewLight = !(cfg.mode === 'image' && image) && current.light;
  const secondary = brand?.secondary || '#1f2937';

  const secondScreen = (status?.displays || 0) > 1;

  return (
    <div className="space-y-6">
      {/* Activation */}
      <div className="bg-white rounded-[2rem] border border-gray-200 p-6 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${cfg.enabled ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}>
            {cfg.enabled ? <Monitor size={28} /> : <MonitorOff size={28} />}
          </div>
          <div>
            <div className="text-xl font-black text-secondary uppercase tracking-wide">Écran client</div>
            {status && (
              <div className={`text-sm font-bold flex items-center gap-2 ${secondScreen ? 'text-primary' : 'text-gray-400'}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${secondScreen ? 'bg-primary' : 'bg-gray-300'}`} />
                {secondScreen ? (status.open ? 'Affiché sur le 2e écran' : '2e écran détecté') : 'Aucun 2e écran'}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cfg.enabled}
          aria-label="Activer l'écran client"
          onClick={() => { setSetting('customer_display_enabled', String(!cfg.enabled)); refresh(); }}
          className={`relative w-24 h-14 rounded-full transition-colors cursor-pointer flex-shrink-0 ${cfg.enabled ? 'bg-primary' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-1.5 w-11 h-11 rounded-full bg-white shadow-md transition-all ${cfg.enabled ? 'left-[46px]' : 'left-1.5'}`} />
        </button>
      </div>

      {/* Fond */}
      <div className={`bg-white rounded-[2rem] border border-gray-200 p-6 space-y-6 transition-opacity ${cfg.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        {/* Aperçu */}
        <div className="relative w-full aspect-video rounded-3xl overflow-hidden shadow-inner border border-gray-200" style={{ background: previewBg }}>
          {cfg.mode === 'image' && image && (
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${secondary}59 0%, ${secondary}33 45%, ${secondary}d9 100%)` }} />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {brand?.logo && (
              <div className="w-28 h-28 rounded-[28%] bg-white/10 border border-white/10 backdrop-blur-xl flex items-center justify-center shadow-2xl">
                <img src={brand.logo} alt="" className="w-[78%] h-[78%] object-contain" />
              </div>
            )}
            {brand?.name && (
              <div className={`text-3xl font-black uppercase tracking-[0.08em] ${previewLight ? 'text-slate-900' : 'text-white'}`}>{brand.name}</div>
            )}
          </div>
        </div>

        {/* Fonds aux couleurs du restaurant */}
        <div className="grid grid-cols-5 gap-3">
          {BRAND_BACKGROUNDS.map(b => {
            const selected = cfg.mode !== 'image' && current.id === b.id;
            return (
              <Tile
                key={b.id}
                label={`Fond ${b.id}`}
                selected={selected}
                onClick={() => setMode('gradient', ['customer_display_bg_gradient', b.id])}
                style={{ background: brandBackground('gradient', b.id, brand).css }}
              >
                {brand?.logo && <img src={brand.logo} alt="" className="w-10 h-10 object-contain drop-shadow" />}
              </Tile>
            );
          })}
        </div>

        {/* Image */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={image ? () => setMode('image') : pickImage}
            className={`relative flex-1 h-24 rounded-2xl overflow-hidden border-2 transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-3 font-black uppercase tracking-wider text-secondary ${
              cfg.mode === 'image' && image ? 'border-primary ring-4 ring-primary/25' : 'border-dashed border-gray-300 hover:border-gray-400 bg-gray-50'
            }`}
            style={image ? { background: `center / cover no-repeat url("${image}")` } : undefined}
            aria-label="Image de fond"
          >
            {!image && <><ImagePlus size={28} className="text-gray-400" /> Image</>}
            {cfg.mode === 'image' && image && (
              <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shadow">
                <Check size={16} strokeWidth={3} />
              </span>
            )}
          </button>
          {image && (
            <>
              <button
                type="button"
                onClick={pickImage}
                disabled={busy}
                aria-label="Changer l'image"
                className="w-24 h-24 rounded-2xl bg-gray-100 text-secondary flex items-center justify-center active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <ImagePlus size={28} />
              </button>
              <button
                type="button"
                onClick={removeImage}
                aria-label="Supprimer l'image"
                className="w-24 h-24 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center active:scale-95 cursor-pointer"
              >
                <Trash2 size={28} />
              </button>
            </>
          )}
        </div>
      </div>

      <CustomerDisplayAds />
    </div>
  );
};

export default CustomerDisplaySettings;
