// Écran client : page plein écran affichée sur le second écran (#/ecran-client).
// Lecture seule : reçoit l'état de la caisse par IPC Electron, n'utilise ni la base ni le panier local.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Banknote, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  AD_NAMES,
  ADS_TABLE,
  readHiddenAdIds,
  brandBackground,
  mediaTypeFromUrl,
  readAdImageDuration,
  rowsToAds,
  getCustomerDisplayAPI,
  readCustomerDisplaySettings,
  type CustomerAd,
  type CustomerDisplayBrand,
  type CustomerDisplayState,
} from '@/lib/customerDisplay';

const BRAND_CACHE_KEY = 'customer_display_brand';

const eur = (n: number) =>
  `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const ORDER_TYPE_ICON: Record<string, string> = {
  'SUR PLACE': 'SVG/SP.svg',
  EMPORTER: 'SVG/EMP.svg',
  LIVRAISON: 'SVG/liv.svg',
};

const getPosRestaurantId = (): string | null => {
  try {
    const api = (window as any).electronAPI;
    const v = api?.getSetting ? api.getSetting('pos_restaurant_id', null) : localStorage.getItem('pos_restaurant_id');
    const id = v === null || v === undefined ? '' : String(v).trim();
    return id && id !== 'null' && id !== 'undefined' ? id : null;
  } catch {
    return null;
  }
};

const readCachedBrand = (restaurantId: string | null): CustomerDisplayBrand | null => {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    const brand = raw ? JSON.parse(raw) : null;
    // Jamais l'identité d'un autre restaurant
    return brand && restaurantId && brand.id === restaurantId ? brand : null;
  } catch {
    return null;
  }
};

/**
 * Identité du restaurant en cours (nom, logo, couleurs).
 * Priorité : ce que la caisse envoie en direct, sinon chargée depuis la base au démarrage
 * (écran client allumé avant la connexion à la caisse), sinon la dernière connue de ce restaurant.
 */
const useRestaurantBrand = (live: CustomerDisplayBrand | null) => {
  const [restaurantId] = useState(getPosRestaurantId);
  const [loaded, setLoaded] = useState<CustomerDisplayBrand | null>(() => readCachedBrand(restaurantId));

  useEffect(() => {
    if (!restaurantId) return;
    let alive = true;
    const load = async () => {
      try {
        const { data } = await supabase
          .from('restaurants')
          .select('name, restaurant_name, logo_url, theme_primary, theme_secondary, theme_accent')
          .eq('id', restaurantId)
          .single();
        if (!alive || !data) return;
        const brand: CustomerDisplayBrand = {
          id: restaurantId,
          name: data.restaurant_name || data.name || '',
          logo: data.logo_url || null,
          primary: data.theme_primary || '#04B855',
          secondary: data.theme_secondary || '#1f2937',
          accent: data.theme_accent || '#FBBF24',
        };
        setLoaded(brand);
        try { localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(brand)); } catch { /* sans effet */ }
      } catch {
        /* hors ligne : on garde l'identité en cache */
      }
    };
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [restaurantId]);

  return live || loaded;
};

const EMPTY_STATE: CustomerDisplayState = {
  phase: 'idle', brand: null, orderType: null, lines: [], count: 0,
  deliveryFee: 0, total: 0, paid: 0, remaining: 0, change: 0, lastKey: null,
};

// ---------------------------------------------------------------------------

const useCustomerDisplayState = () => {
  const [state, setState] = useState<CustomerDisplayState>(EMPTY_STATE);
  useEffect(() => {
    const api = getCustomerDisplayAPI();
    if (!api) return;
    let alive = true;
    const off = api.onState(s => { if (alive && s) setState(s); });
    api.getState().then(s => { if (alive && s) setState(s); }).catch(() => {});
    return () => { alive = false; off(); };
  }, []);
  return state;
};

const useBackgroundSettings = () => {
  const [settings, setSettings] = useState(readCustomerDisplaySettings);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    const api = getCustomerDisplayAPI();
    if (!api) return;
    return api.onConfigChanged(() => setSettings(readCustomerDisplaySettings()));
  }, []);

  useEffect(() => {
    const api = getCustomerDisplayAPI();
    if (settings.mode !== 'image' || !api) { setImage(null); return; }
    let alive = true;
    api.getBackground().then(src => { if (alive) setImage(src); }).catch(() => {});
    return () => { alive = false; };
  }, [settings.mode, settings.version]);

  return { settings, image };
};

// ---------------------------------------------------------------------------

const Background = ({ css, image, primary, secondary, accent }: { css: string; image: string | null; primary: string; secondary: string; accent: string }) => (
  <div className="absolute inset-0 overflow-hidden" aria-hidden>
    {image ? (
      <>
        <motion.img
          src={image}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          initial={{ scale: 1.02 }}
          animate={{ scale: 1.12 }}
          transition={{ duration: 40, ease: 'linear', repeat: Infinity, repeatType: 'reverse' }}
        />
        {/* Voile aux couleurs du restaurant pour la lisibilité */}
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${secondary}59 0%, ${secondary}33 45%, ${secondary}d9 100%)` }} />
      </>
    ) : (
      <>
        <div className="absolute inset-0" style={{ background: css }} />
        {/* Halos lumineux, mouvement très lent */}
        <motion.div
          className="absolute w-[60vmax] h-[60vmax] rounded-full blur-[120px] opacity-30"
          style={{ background: primary, top: '-20vmax', left: '-15vmax' }}
          animate={{ x: ['0vmax', '18vmax', '4vmax', '0vmax'], y: ['0vmax', '10vmax', '22vmax', '0vmax'] }}
          transition={{ duration: 46, ease: 'easeInOut', repeat: Infinity }}
        />
        <motion.div
          className="absolute w-[45vmax] h-[45vmax] rounded-full blur-[120px] opacity-20"
          style={{ background: accent, bottom: '-18vmax', right: '-12vmax' }}
          animate={{ x: ['0vmax', '-16vmax', '-4vmax', '0vmax'], y: ['0vmax', '-12vmax', '-20vmax', '0vmax'] }}
          transition={{ duration: 58, ease: 'easeInOut', repeat: Infinity }}
        />
      </>
    )}
  </div>
);

// Uniquement le logo du restaurant (logo_url dans Supabase) : jamais d'icône de l'application.
// Logo absent ou illisible → rien n'est affiché (le nom du restaurant suffit).
const Logo = ({ brand, size, maxWidth = '60vw' }: { brand: CustomerDisplayBrand | null; size: string; maxWidth?: string; glass?: string }) => {
  const [failed, setFailed] = useState<string | null>(null);
  const src = brand?.logo || null;
  if (!src || failed === src) return null;
  // Affiché tel quel (logo carré ou horizontal), sans cadre
  return (
    <img
      src={src}
      alt=""
      className="object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
      style={{ height: size, maxWidth, width: 'auto' }}
      onError={() => setFailed(src)}
    />
  );
};

// ---------------------------------------------------------------------------
// Pubs : liste lue dans Supabase, fichiers en cache local via Electron (affichage hors ligne)

const ADS_REFRESH_MS = 5 * 60 * 1000;

const useAds = (restaurantId: string | null) => {
  const [ads, setAds] = useState<CustomerAd[]>([]);

  useEffect(() => {
    const api = getCustomerDisplayAPI();
    if (!api?.getCachedAds || !api.syncAds || !restaurantId) return;
    let alive = true;

    // Cache d'abord : les pubs tournent même sans réseau
    api.getCachedAds().then(list => { if (alive && Array.isArray(list)) setAds(list); }).catch(() => {});

    const sync = async () => {
      try {
        const { data, error } = await supabase
          .from(ADS_TABLE)
          .select('id, nom, image_url, restaurant_id, is_active')
          .eq('restaurant_id', restaurantId)
          .in('nom', AD_NAMES);
        if (error || !data) return; // hors ligne : on garde le cache
        const duration = readAdImageDuration();
        const hiddenIds = readHiddenAdIds();
        const wanted = rowsToAds(data as any).filter(row => !hiddenIds.has(String(row.id)));
        // Pub supprimée ou masquée : retirée tout de suite, sans attendre les téléchargements en cours
        const wantedIds = new Set(wanted.map(row => String(row.id)));
        if (alive) setAds(prev => prev.filter(ad => wantedIds.has(String(ad.id))));
        const list = await api.syncAds!(wanted.map(row => ({
          id: String(row.id), url: row.image_url!, type: mediaTypeFromUrl(row.image_url!), duration,
        })));
        if (alive && Array.isArray(list)) setAds(list);
      } catch {
        /* on garde le cache */
      }
    };

    sync();
    const timer = setInterval(sync, ADS_REFRESH_MS);
    const offConfig = api.onConfigChanged(sync);
    const channel = supabase
      .channel(`customer_display_ads_${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: ADS_TABLE, filter: `restaurant_id=eq.${restaurantId}` }, () => sync())
      .subscribe();

    return () => {
      alive = false;
      clearInterval(timer);
      offConfig();
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  return ads;
};

const AdsView = ({ ads, brand, background }: { ads: CustomerAd[]; brand: CustomerDisplayBrand | null; background: string }) => {
  const [index, setIndex] = useState(0);
  const ad = ads[index % ads.length];
  const next = () => setIndex(i => (i + 1) % Math.max(1, ads.length));

  useEffect(() => {
    if (index >= ads.length) setIndex(0);
  }, [ads.length, index]);

  // Image : durée réglée. Vidéo : jusqu'à la fin (garde-fou de 5 min si elle bloque).
  useEffect(() => {
    if (!ad) return;
    const ms = ad.type === 'image' ? ad.duration * 1000 : 5 * 60 * 1000;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [ad?.id, index]);

  if (!ad) return null;
  const single = ads.length === 1;

  return (
    <motion.div
      key="ads"
      className="absolute inset-0 overflow-hidden"
      style={{ background }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={`${index}-${ad.id}`}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, ease: 'easeInOut' }}
        >
          {ad.type === 'image' ? (
            <>
              {/* Fond flouté de la même image : pas de bandes vides si le format diffère de l'écran */}
              <img src={ad.src} alt="" className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-60" />
              <motion.img
                src={ad.src}
                alt=""
                className="absolute inset-0 w-full h-full object-contain"
                initial={{ scale: 1 }}
                animate={{ scale: 1.05 }}
                transition={{ duration: ad.duration + 1, ease: 'linear' }}
              />
            </>
          ) : (
            <video
              src={ad.src}
              className="absolute inset-0 w-full h-full object-contain"
              autoPlay
              muted
              playsInline
              loop={single}
              onEnded={single ? undefined : next}
              onError={next}
            />
          )}
        </motion.div>
      </AnimatePresence>
      {/* Logo du restaurant en petit */}
      <div className="absolute bottom-[3vh] right-[3vh] opacity-90">
        <Logo brand={brand} size="min(8vh,7vw)" maxWidth="18vw" />
      </div>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------

const IdleView = ({ brand, glass }: { brand: CustomerDisplayBrand | null; glass: string }) => (
  <motion.div
    key="idle"
    className="absolute inset-0 flex flex-col items-center justify-center gap-[5vh] px-[6vw]"
    initial={{ opacity: 0, scale: 0.97 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 1.02 }}
    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
  >
    <motion.div
      animate={{ y: [0, -14, 0] }}
      transition={{ duration: 6, ease: 'easeInOut', repeat: Infinity }}
    >
      <Logo brand={brand} size="min(42vh, 40vw)" maxWidth="80vw" />
    </motion.div>
    {brand?.name && (
      <h1 className="text-center font-black uppercase tracking-[0.08em] leading-none text-[clamp(2.5rem,7vw,7rem)] drop-shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
        {brand.name}
      </h1>
    )}
  </motion.div>
);

const CartView = ({ state, glass, muted, divider, primary }: { state: CustomerDisplayState; glass: string; muted: string; divider: string; primary: string }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Toujours montrer la dernière ligne modifiée
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const target = state.lastKey ? el.querySelector(`[data-key="${CSS.escape(state.lastKey)}"]`) : null;
    if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [state.lastKey, state.lines.length]);

  return (
    <motion.div
      key="cart"
      className="absolute inset-0 flex flex-col p-[3vmin] gap-[3vmin]"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* En-tête */}
      <div className="flex items-center justify-between gap-[2vw] flex-shrink-0">
        <div className="flex items-center gap-[1.5vw] min-w-0">
          <Logo brand={state.brand} size="min(10vh, 9vw)" maxWidth="24vw" />
          {state.brand?.name && (
            <span className="font-black uppercase tracking-wider truncate text-[clamp(1.25rem,2.6vw,2.6rem)]">{state.brand.name}</span>
          )}
        </div>
        {state.orderType && ORDER_TYPE_ICON[state.orderType] && (
          <div className={`${glass} rounded-full flex items-center justify-center flex-shrink-0`} style={{ width: 'min(9vh,8vw)', height: 'min(9vh,8vw)' }}>
            <img src={ORDER_TYPE_ICON[state.orderType]} alt={state.orderType} className="w-[58%] h-[58%] object-contain icon-tint" />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,36%)] gap-[3vmin]">
        {/* Articles */}
        <div className={`${glass} rounded-[2.2rem] min-h-0 overflow-hidden flex flex-col`}>
          <div ref={listRef} className="flex-1 overflow-y-auto no-scrollbar px-[2.4vw] py-[2vh]">
            <AnimatePresence initial={false}>
              {state.lines.map(line => {
                const isLast = line.key === state.lastKey;
                return (
                  <motion.div
                    key={line.key}
                    data-key={line.key}
                    layout
                    initial={{ opacity: 0, x: -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40, height: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                    className={`relative flex items-start gap-[1.6vw] py-[1.6vh] border-b ${divider} last:border-b-0`}
                  >
                    {isLast && (
                      <motion.div
                        key={`${line.key}-${line.qty}`}
                        className="absolute -inset-x-[1.2vw] inset-y-[0.4vh] rounded-2xl"
                        style={{ background: primary }}
                        initial={{ opacity: 0.35 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 1.8, ease: 'easeOut' }}
                      />
                    )}
                    <motion.span
                      key={`q-${line.qty}`}
                      initial={{ scale: 1.5 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                      className="relative flex-shrink-0 rounded-xl font-black tabular-nums flex items-center justify-center text-white text-[clamp(1rem,2vw,1.9rem)] min-w-[2.4em] h-[1.9em] px-[0.4em]"
                      style={{ background: primary }}
                    >
                      {line.qty}
                    </motion.span>
                    <div className="relative flex-1 min-w-0">
                      <div className="font-black leading-tight text-[clamp(1.3rem,2.6vw,2.4rem)] line-clamp-2">{line.name}</div>
                      {line.options.length > 0 && (
                        <div className={`mt-[0.5vh] leading-snug font-semibold text-[clamp(0.95rem,1.6vw,1.5rem)] ${muted} line-clamp-2`}>
                          {line.options.map((o, i) => (
                            <span key={i} className={o.sans ? 'text-red-400' : undefined}>
                              {o.name}{i < line.options.length - 1 ? ' · ' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative flex-shrink-0 font-black tabular-nums text-[clamp(1.3rem,2.6vw,2.4rem)]">{eur(line.total)}</div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Total */}
        <div className={`${glass} rounded-[2.2rem] flex flex-col justify-end p-[3vmin] gap-[2vh] overflow-hidden`}>
          <div className="flex-1 flex flex-col items-center justify-center gap-[1.5vh]">
            <motion.div
              key={state.count}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              className="flex items-center gap-[0.8vw]"
            >
              <img src="SVG/kraft.svg" alt="" className="h-[clamp(2.5rem,7vh,5rem)] object-contain icon-tint" />
              <span className="font-black tabular-nums text-[clamp(2rem,5vw,4.5rem)]">{state.count}</span>
            </motion.div>
            {state.deliveryFee > 0 && (
              <div className={`flex items-center gap-[0.8vw] font-bold tabular-nums text-[clamp(1rem,1.8vw,1.7rem)] ${muted}`}>
                <img src="SVG/liv.svg" alt="" className="h-[1.4em] object-contain icon-tint opacity-70" />
                + {eur(state.deliveryFee)}
              </div>
            )}
          </div>
          <div className="rounded-[1.6rem] text-white px-[2vw] py-[3vh] text-center shadow-2xl" style={{ background: primary }}>
            <div className="font-black uppercase tracking-[0.25em] text-[clamp(0.9rem,1.5vw,1.4rem)] opacity-80">Total</div>
            <motion.div
              key={state.total}
              initial={{ y: 12, opacity: 0.4 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="font-black tabular-nums leading-none mt-[1vh] text-[clamp(2.4rem,6vw,6rem)] whitespace-nowrap"
            >
              {eur(state.total)}
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const BigAmount = ({ label, value, color, size = 'text-[clamp(3.5rem,11vw,11rem)]' }: { label: string; value: number; color?: string; size?: string }) => (
  <div className="flex flex-col items-center">
    <div className="font-black uppercase tracking-[0.3em] opacity-70 text-[clamp(1rem,2vw,2rem)]">{label}</div>
    <motion.div
      key={value}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className={`font-black tabular-nums leading-none whitespace-nowrap ${size}`}
      style={color ? { color } : undefined}
    >
      {eur(value)}
    </motion.div>
  </div>
);

const PaymentView = ({ state, glass, primary, accent }: { state: CustomerDisplayState; glass: string; primary: string; accent: string }) => {
  const partiallyPaid = state.paid > 0 && state.remaining > 0;
  return (
    <motion.div
      key="payment"
      className="absolute inset-0 flex items-center justify-center p-[4vmin]"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={`${glass} rounded-[3rem] w-full max-w-[min(92vw,1500px)] h-full max-h-[86vh] flex flex-col items-center justify-center gap-[5vh] px-[4vw]`}>
        <motion.div
          className="rounded-full flex items-center justify-center text-white"
          style={{ background: primary, width: 'min(14vh,12vw)', height: 'min(14vh,12vw)' }}
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {state.change > 0
            ? <Banknote className="w-1/2 h-1/2" strokeWidth={2.2} />
            : <CreditCard className="w-1/2 h-1/2" strokeWidth={2.2} />}
        </motion.div>

        {state.change > 0 ? (
          <div className="flex flex-col items-center gap-[4vh]">
            <BigAmount label="Total" value={state.total} size="text-[clamp(2rem,5vw,5rem)]" />
            <BigAmount label="Rendu" value={state.change} color={accent} />
          </div>
        ) : partiallyPaid ? (
          <div className="flex flex-col items-center gap-[4vh]">
            <BigAmount label="Total" value={state.total} size="text-[clamp(2rem,5vw,5rem)]" />
            <BigAmount label="Reste" value={state.remaining} color={accent} />
          </div>
        ) : (
          <BigAmount label="Total" value={state.total} />
        )}
      </div>
    </motion.div>
  );
};

const ThanksView = ({ state, glass, primary, accent }: { state: CustomerDisplayState; glass: string; primary: string; accent: string }) => (
  <motion.div
    key="thanks"
    className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] px-[6vw]"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0, scale: 0.98 }}
    transition={{ duration: 0.5 }}
  >
    <motion.div
      className="rounded-full flex items-center justify-center shadow-2xl"
      style={{ background: primary, width: 'min(22vh,20vw)', height: 'min(22vh,20vw)' }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
    >
      <svg viewBox="0 0 52 52" className="w-[58%] h-[58%]" fill="none" stroke="white" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <motion.path
          d="M14 27 l8 8 l16 -18"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.3, duration: 0.55, ease: 'easeOut' }}
        />
      </svg>
    </motion.div>
    <motion.h1
      className="font-black uppercase tracking-[0.12em] leading-none text-[clamp(3.5rem,11vw,10rem)]"
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.25, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      Merci
    </motion.h1>
    {state.change > 0 && (
      <motion.div
        className={`${glass} rounded-[2rem] px-[4vw] py-[2.5vh]`}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.5 }}
      >
        <BigAmount label="Rendu" value={state.change} color={accent} size="text-[clamp(2.5rem,6vw,6rem)]" />
      </motion.div>
    )}
    <motion.div
      className="mt-[1vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.9 }}
      transition={{ delay: 0.8 }}
    >
      <Logo brand={state.brand} size="min(12vh,11vw)" maxWidth="40vw" />
    </motion.div>
  </motion.div>
);

// ---------------------------------------------------------------------------

const CustomerDisplay = () => {
  const state = useCustomerDisplayState();
  const { settings, image } = useBackgroundSettings();
  const brand = useRestaurantBrand(state.brand);
  const [restaurantId] = useState(getPosRestaurantId);
  const ads = useAds(restaurantId);

  const primary = brand?.primary || '#04B855';
  const secondary = brand?.secondary || '#1f2937';
  const accent = brand?.accent || '#FBBF24';

  const bg = useMemo(
    () => brandBackground(settings.mode, settings.gradient, brand),
    [settings.mode, settings.gradient, brand?.primary, brand?.secondary, brand?.accent]
  );

  const light = settings.mode !== 'image' && bg.light;
  const glass = light
    ? 'bg-white/65 border border-black/5 backdrop-blur-2xl'
    : 'bg-white/[0.08] border border-white/10 backdrop-blur-2xl';
  const muted = light ? 'text-slate-500' : 'text-white/60';
  const divider = light ? 'border-black/10' : 'border-white/10';
  // Montant à rendre : couleur d'accent sur fond sombre, couleur principale sur fond clair (contraste)
  const highlight = light ? primary : accent;

  const view = state.phase === 'cart' && state.lines.length === 0 ? 'idle' : state.phase;
  const shown = { ...state, brand };

  return (
    <div
      className={`fixed inset-0 overflow-hidden select-none cursor-none font-helvetica ${light ? 'text-slate-900' : 'text-white'}`}
      style={{ background: '#05070a' }}
    >
      <style>{`
        .no-scrollbar::-webkit-scrollbar{display:none}
        .no-scrollbar{scrollbar-width:none}
        .icon-tint{${light ? '' : 'filter:brightness(0) invert(1);'}}
      `}</style>
      <Background css={bg.css} image={image} primary={primary} secondary={secondary} accent={accent} />
      <AnimatePresence mode="wait">
        {view === 'idle' && ads.length === 0 && <IdleView key="idle" brand={brand} glass={glass} />}
        {view === 'idle' && ads.length > 0 && <AdsView key="ads" ads={ads} brand={brand} background={secondary} />}
        {view === 'cart' && <CartView key="cart" state={shown} glass={glass} muted={muted} divider={divider} primary={primary} />}
        {view === 'payment' && <PaymentView key="payment" state={shown} glass={glass} primary={primary} accent={highlight} />}
        {view === 'thanks' && <ThanksView key="thanks" state={shown} glass={glass} primary={primary} accent={highlight} />}
      </AnimatePresence>
    </div>
  );
};

export default CustomerDisplay;
