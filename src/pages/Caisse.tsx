// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { useCart } from '@/context/CartContext';
import { toast } from 'sonner';
import { 
  getFormattedOrderOptions, 
  fetchOptionGroupMapping, 
  buildClientReceiptPayload, 
  buildKitchenReceiptPayload,
  kitchenCustomerName
} from '@/lib/orderFormatter';

import { 
  Trash2, Delete, Settings, Lock, 
  ClipboardList, History, Package, Wifi, WifiOff,
  UserRound, CalendarDays, LayoutDashboard, AlertTriangle,
  CreditCard, Banknote, CheckCircle2, Store, ArchiveRestore,
  Calculator, Hourglass, Plus, RotateCcw, RotateCw,
  X, Check, Equal, Receipt, ArrowLeftRight, Loader2, Gift, Tag, MoreHorizontal, MessageSquare, Ticket
} from 'lucide-react';

// Composants
import ProductCard from '@/features/menu/components/ProductCard';
import OptionsModal from '@/features/menu/components/OptionsModal';
import ProductVariantsModal from '@/components/ProductVariantsModal';
// Grandes fenêtres chargées à leur première ouverture : l'écran de caisse démarre plus léger
const OrderTrackerModal = React.lazy(() => import('@/components/OrderTrackerModal'));
const OrderHistoryModal = React.lazy(() => import('@/components/OrderHistoryModal'));
const SettingsModal = React.lazy(() => import('@/components/SettingsModal'));
const StockModal = React.lazy(() => import('@/components/StockModal'));
const OrdersDashboardModal = React.lazy(() => import('@/components/OrdersDashboardModal'));
import NewtonsCradleLoader from '@/components/NewtonsCradleLoader';
import SumUpSoloPayment, { type SoloPaymentOutcome } from '@/components/SumUpSoloPayment';
import { getSelectedReader, isSoloEnabled } from '@/services/sumupSolo';
import CashSessionModal from '@/components/CashSessionModal';
import { DeliveryModalCaisse } from '@/components/DeliveryModalCaisse';
import PosSetup from '@/components/PosSetup';
import { ORDER_TYPE_ID } from '@/lib/orderTypes';
import { announceDevicePresence } from '@/lib/devicePresence';
import { buildLoadedCartItem, normalizeLinesForSave, tillLineTotal, extractRealProductId, mapOrderItemsForTill, orderItemName } from '@/lib/loadedOrderPricing';
import { publishCustomerCart, publishCustomerPayment, showCustomerThanks } from '@/lib/customerDisplay';
import { TapToPayIcon, publicAsset } from '@/components/MaskIcon';

export interface Product {
  id: number | string;
  name: string;
  price: number;
  category: string;
  image?: string | null;
  image_url?: string | null;
  solo_image_url?: string | null;
  is_available: boolean;
  hide_on_kiosk?: boolean;
  variantId?: string | number;
  variant_id?: string | number;
  variantName?: string;
  original_product_id?: number | string;
}

interface Category {
  name: string;
}

const ORDER_TYPE_IDS = {
  'SUR PLACE': ORDER_TYPE_ID.SUR_PLACE,
  'EMPORTER': ORDER_TYPE_ID.EMPORTER,
  'LIVRAISON': ORDER_TYPE_ID.LIVRAISON
};

const ORDER_TYPE_CONFIG: Record<string, { label: string; icon: string }> = {
  'SUR PLACE': { label: 'Sur Place', icon: publicAsset('SVG/SP.svg') },
  'EMPORTER': { label: 'À Emporter', icon: publicAsset('SVG/EMP.svg') },
  'LIVRAISON': { label: 'Livraison', icon: publicAsset('SVG/liv.svg') }
};

// 🟢 Extraction fiable de l'ID numérique produit (même sur 'loaded-15196-0-208' ou '208-var_12')

// Erreur renvoyée par PostgREST/Postgres (a un code) vs coupure réseau (pas de code)
const isDbRejection = (e: any): boolean =>
  !!e && typeof e.code === 'string' && e.code !== '' && !/fetch|network/i.test(String(e.message || ''));

const describeDbError = (e: any): string =>
  e && typeof e === 'object'
    ? JSON.stringify({ code: e.code, message: e.message, details: e.details, hint: e.hint })
    : String(e);

// 🟢 Normalisation universelle des modes de paiement
const normalizeCaissePaymentMethod = (rawMethod?: string): string => {
  if (!rawMethod) return 'Espèces';
  const m = String(rawMethod).trim().toLowerCase();

  // Commande offerte (repas employé, promo) : libellé conservé tel quel
  if (m.startsWith('offert')) {
    return String(rawMethod).trim();
  }

  if (m.includes('fractionn') || m.includes('mixte')) {
    // Pas d'expansion "CB" → "Carte bancaire" : la colonne payment_method est limitée à 50 caractères
    return String(rawMethod)
      .replace(/\bcarte bancaire\b/gi, 'CB')
      .replace(/\bespeces\b/gi, 'Espèces')
      .trim()
      .slice(0, 50);
  }

  if (m.includes('attente') || m === 'pending') {
    return 'en attente';
  }

  if (
    m.includes('carte') || 
    m.includes('cb') || 
    m.includes('card') || 
    m.includes('stripe') || 
    m.includes('sumup') ||
    m.includes('terminal') ||
    m.includes('tpe')
  ) {
    return 'Carte bancaire';
  }

  if (
    m.includes('espece') || 
    m.includes('espèces') || 
    m.includes('cash') || 
    m === 'counter' || 
    m === 'comptoir'
  ) {
    return 'Espèces';
  }

  if (m.includes('ticket') || m.includes('titre') || m.includes('tr')) {
    return 'Titre restaurant';
  }

  return String(rawMethod).trim();
};

const getSecureSetting = (key: string, defaultValue: any) => {
  if ((window as any).electronAPI?.getSetting) {
    return (window as any).electronAPI.getSetting(key, defaultValue);
  }
  const local = localStorage.getItem(key);
  if (local === null || local === undefined) return defaultValue;
  return local;
};

// Type par défaut du restaurant (chargé depuis la base au démarrage), utilisé si la caisse n'a pas son propre réglage
let restaurantDefaultOrderType: string | null = null;

// Le complément d'adresse peut arriver sous plusieurs noms selon l'écran d'origine
const getClientComplement = (client: any): string =>
  String(client?.additionalInfo || client?.address_complement || client?.customer_address_complement || '').trim();

const getDefaultOrderType = (): 'SUR PLACE' | 'EMPORTER' | 'LIVRAISON' => {
  const val = getSecureSetting('default_order_type', restaurantDefaultOrderType || 'EMPORTER');
  return (val === 'SUR PLACE' || val === 'LIVRAISON' || val === 'EMPORTER') ? val : 'EMPORTER';
};

const setSecureSetting = (key: string, value: any) => {
  localStorage.setItem(key, String(value));
  if ((window as any).electronAPI?.setSetting) {
    (window as any).electronAPI.setSetting(key, value);
  }
};

const hexToHslString = (hex: string) => {
  if (!hex) return hex;
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  let r = parseInt(hex.substring(0, 2), 16) / 255, g = parseInt(hex.substring(2, 4), 16) / 255, b = parseInt(hex.substring(4, 6), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

// Total d'une ligne : calcul commun (aussi vérifié par « npm run verif:encaissement »)
const getItemTotal = tillLineTotal;

const getInitialRestaurantId = (): string | null => {
  const val = getSecureSetting('pos_restaurant_id', null);
  if (!val || val === 'null' || val === 'undefined' || String(val).trim() === '') return null;
  return String(val).trim();
};

const getActiveRestaurantId = () => getInitialRestaurantId();

const openCashDrawer = async (silent: boolean = false) => {
  if (!(window as any).electronAPI?.openDrawer) { 
    if (!silent) toast.error("Non disponible sur la version Web."); 
    return; 
  }
  try {
    const printerName = getSecureSetting('imprimante_caisse', undefined) || undefined;
    const result = await (window as any).electronAPI.openDrawer(printerName);
    if (!result?.success) {
      if (!silent) toast.error("Impossible de communiquer avec l'imprimante.");
    } else {
      if (!silent) toast.success("Tiroir ouvert", { duration: 800 });
    }
  } catch (error) { 
    console.error("Erreur ouverture tiroir :", error); 
  }
};

const generateAndPrintReceipt = async (
  restaurantInfo: any, 
  orderNumber: string, 
  orderType: string, 
  paymentMethod: string, 
  items: any[], 
  subtotal: number, 
  deliveryFee: number, 
  finalTotal: number, 
  cashAmount: number, 
  clientInfo?: any, 
  groupMapping: Record<string, string> = {}
) => {
  if (!(window as any).electronAPI) return;
  const printerName = getSecureSetting('imprimante_caisse', undefined) || undefined;

  const orderPayloadData = buildClientReceiptPayload({
    restaurantId: getActiveRestaurantId(),
    restaurantInfo,
    orderNumber,
    orderType,
    paymentMethod,
    items,
    subtotal,
    deliveryFee,
    finalTotal,
    cashAmount,
    clientInfo,
    groupMapping
  });

  try {
    const result = await (window as any).electronAPI.printReceipt(orderPayloadData, printerName);
    if (!result?.success) toast.error("Erreur avec l'imprimante caisse !");
  } catch (error) { 
    console.error("Erreur API impression caisse :", error); 
  }
};

const generateAndPrintKitchenTicket = async (
  orderNumber: string, 
  orderType: string, 
  items: any[], 
  groupMapping: Record<string, string> = {},
  comment: string = '',
  customerName: string = ''
) => {
  if (!(window as any).electronAPI) return;
  const printerName = getSecureSetting('imprimante_cuisine', undefined) || undefined;

  const kitchenPayloadData = buildKitchenReceiptPayload({
    orderNumber,
    orderType,
    items,
    groupMapping,
    comment,
    customer_name: kitchenCustomerName(customerName)
  });

  try {
    const result = await (window as any).electronAPI.printReceipt(kitchenPayloadData, printerName);
    if (!result?.success) toast.error("Erreur avec l'imprimante cuisine !");
  } catch (error) { 
    console.error("Erreur API impression cuisine :", error); 
  }
};

/**
 * Heure / date de l'en-tête. Composant à part, mis à jour à chaque changement de minute :
 * avant, une horloge à la seconde redessinait toute la caisse (grille produits, ticket) 1×/s.
 */
const LiveClock = React.memo(({ kind }: { kind: 'time' | 'date' }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const d = new Date();
      timer = setTimeout(() => { setNow(new Date()); schedule(); }, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return <>{kind === 'time'
    ? now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</>;
});

// TR = titre-restaurant (Swile, Edenred, Up, Pluxee…)
type PayMethod = 'CB' | 'Espèces' | 'TR';
type PayLine = { id: number; method: PayMethod; amount: number; tendered: number }; // centimes

const toCents = (v: number) => Math.round((Number(v) || 0) * 100);
const fmtCents = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const parseInputCents = (s: string) => {
  if (!s || s === '.') return 0;
  const [i, d = ''] = s.split('.');
  return (parseInt(i || '0', 10) || 0) * 100 + (parseInt((d + '00').slice(0, 2), 10) || 0);
};

// ── Remise : motif (employé avec prénom, promo), % ou €, puis confirmation ──
type AppliedDiscount = { cents: number; label: string; reason: 'Employé' | 'Promo' };

const DiscountSheet = ({ totalCents, feeCents = 0, onCancel, onApply, busy }: {
  /** Montant remisable : les produits seuls (les frais de livraison ne sont jamais remisés) */
  totalCents: number;
  /** Frais de livraison, ajoutés au net affiché */
  feeCents?: number;
  onCancel: () => void;
  onApply: (d: AppliedDiscount) => void;
  busy: boolean;
}) => {
  const [reason, setReason] = useState<'Employé' | 'Promo' | null>(null);
  const [firstName, setFirstName] = useState('');
  // Aucun montant présélectionné : la remise doit être choisie explicitement
  const [pct, setPct] = useState<number | null>(null);
  const [eur, setEur] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');

  const eurCents = Math.min(parseInputCents(eur.replace(',', '.')), totalCents);
  const discountCents = pct !== null ? Math.round(totalCents * pct / 100) : eurCents;
  const usingEuros = pct === null && eur.trim() !== '';
  const netCents = Math.max(0, totalCents - discountCents) + feeCents;
  const cleanName = firstName.trim().replace(/\s+/g, ' ');
  const nameOk = reason !== 'Employé' || cleanName.length >= 2;
  const canValidate = !!reason && nameOk && discountCents > 0;
  const amountLabel = pct !== null ? `-${pct}%` : `-${fmtCents(discountCents)}€`;
  const label = reason === 'Employé' ? `Employé : ${cleanName} (${amountLabel})` : `Promo (${amountLabel})`;

  const chip = (active: boolean) =>
    `h-12 rounded-xl font-black text-base flex items-center justify-center active:scale-95 cursor-pointer transition-colors ${
      active ? 'bg-violet-600 text-white' : 'bg-gray-100 text-secondary'
    }`;

  return (
    <div className="absolute inset-0 z-20 bg-white flex flex-col p-6 gap-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-violet-700 font-black text-xl">
          <Tag size={24} /> Remise
        </div>
        <button type="button" onClick={onCancel} aria-label="Fermer" className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center active:scale-95 cursor-pointer">
          <X size={22} />
        </button>
      </div>

      {step === 'edit' ? (
        <>
          {/* Motif */}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setReason('Employé')} className={`${chip(reason === 'Employé')} h-16 gap-2`}>
              <UserRound size={22} /> Employé
            </button>
            <button type="button" onClick={() => setReason('Promo')} className={`${chip(reason === 'Promo')} h-16 gap-2`}>
              <Tag size={22} /> Promo
            </button>
          </div>

          {reason === 'Employé' && (
            <input
              autoFocus
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value.slice(0, 30))}
              placeholder="Prénom de l'employé"
              className={`h-14 px-4 rounded-xl border-2 text-lg font-bold text-secondary outline-none ${cleanName.length >= 2 ? 'border-violet-300' : 'border-amber-300'} focus:border-violet-500`}
              style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            />
          )}

          {/* Montant de la remise */}
          <div className="grid grid-cols-5 gap-2">
            {[10, 20, 50, 100].map(v => (
              <button key={v} type="button" onClick={() => { setPct(v); setEur(''); }} className={chip(pct === v)}>
                {v}%
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              value={eur}
              onFocus={() => setPct(null)}
              onChange={(e) => { setPct(null); setEur(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 7)); }}
              placeholder="€"
              aria-label="Remise en euros"
              className={`h-12 rounded-xl text-center text-base font-black outline-none border-2 ${usingEuros ? 'border-violet-500 text-violet-700' : 'border-gray-200 text-secondary'} focus:border-violet-500`}
              style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            />
          </div>

          {/* Récapitulatif */}
          <div className="mt-auto rounded-2xl bg-gray-50 p-4 grid grid-cols-3 text-center tabular-nums">
            <div>
              <div className="text-xs font-bold text-gray-400">Total</div>
              <div className="text-xl font-black text-secondary">{fmtCents(totalCents)} €</div>
            </div>
            <div>
              <div className="text-xs font-bold text-gray-400">Remise</div>
              <div className="text-xl font-black text-violet-600">-{fmtCents(discountCents)} €</div>
            </div>
            <div>
              <div className="text-xs font-bold text-gray-400">À payer</div>
              <div className="text-xl font-black text-secondary">{fmtCents(netCents)} €</div>
            </div>
          </div>

          <button
            type="button"
            disabled={!canValidate}
            onClick={() => setStep('confirm')}
            className="h-16 rounded-2xl bg-violet-600 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-95 cursor-pointer disabled:opacity-40"
          >
            <Check size={24} strokeWidth={3} /> Valider
          </button>
        </>
      ) : (
        <>
          {/* Message de confirmation */}
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-16 h-16 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center">
              {reason === 'Employé' ? <UserRound size={32} /> : <Tag size={32} />}
            </div>
            <div className="text-2xl font-black text-secondary">
              {reason === 'Employé' ? `Repas employé · ${cleanName}` : 'Promotion'}
            </div>
            <div className="text-lg font-bold text-violet-700 tabular-nums">
              Remise {pct !== null ? `${pct} % ` : ''}(-{fmtCents(discountCents)} €)
            </div>
            <div className="text-base font-bold text-gray-500">
              {netCents === 0
                ? 'La commande part en cuisine sans paiement.'
                : `Il restera ${fmtCents(netCents)} € à encaisser.`}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setStep('edit')} className="h-16 rounded-2xl bg-gray-100 text-secondary font-black text-lg active:scale-95 cursor-pointer">
              Retour
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onApply({ cents: discountCents, label, reason: reason! })}
              className="h-16 rounded-2xl bg-violet-600 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {busy ? <Loader2 size={24} className="animate-spin" /> : <Check size={24} strokeWidth={3} />} Confirmer
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export const PaymentModal = ({ subtotal, deliveryFee = 0, themeColors, onClose, onConfirm, onOffer, isProcessing }: any) => {
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const grossCents = toCents(subtotal);
  // Frais de livraison : jamais remisés (une remise en % ne porte que sur les produits)
  const feeCents = Math.min(Math.max(0, toCents(deliveryFee)), grossCents);
  const totalCents = Math.max(0, grossCents - (discount?.cents || 0));
  const [lines, setLines] = useState<PayLine[]>([]);
  const [input, setInput] = useState('');
  const lineIdRef = useRef(0);
  const confirmLockRef = useRef(false);

  const paidCents = lines.reduce((s, l) => s + l.amount, 0);
  const remainingCents = Math.max(0, totalCents - paidCents);
  const changeCents = lines.reduce((s, l) => s + (l.tendered - l.amount), 0);
  const inputCents = parseInputCents(input);
  const pendingChange = Math.max(0, inputCents - remainingCents);
  const isComplete = totalCents > 0 && remainingCents === 0;
  const busy = !!isProcessing;

  // Écran client : total, reste dû et monnaie à rendre en direct
  useEffect(() => {
    publishCustomerPayment({ total: totalCents / 100, paid: paidCents / 100, remaining: remainingCents / 100, change: changeCents / 100 });
  }, [totalCents, paidCents, remainingCents, changeCents]);
  useEffect(() => () => publishCustomerPayment(null), []);

  const confirm = (finalLines: PayLine[]) => {
    if (confirmLockRef.current || busy) return;
    const sum = finalLines.reduce((s, l) => s + l.amount, 0);
    if (sum !== totalCents) return;
    confirmLockRef.current = true;
    const label = (m: PayMethod) => (m === 'CB' ? 'Carte bancaire' : m === 'TR' ? 'Titre restaurant' : 'Espèces');
    const merged = (['CB', 'Espèces', 'TR'] as PayMethod[])
      .map(m => ({ m, c: finalLines.filter(l => l.method === m).reduce((s, l) => s + l.amount, 0) }))
      .filter(x => x.c > 0);
    // payment_method est un varchar(50) : un total par mode, libellé court (max ~46 car.)
    const split = (short: boolean) =>
      `Fractionné (${merged.map(x => `${short && x.m === 'Espèces' ? 'ESP' : x.m}: ${(x.c / 100).toFixed(2)}${short ? '' : '€'}`).join(' + ')})`;
    const method = merged.length > 1
      ? (split(false).length <= 50 ? split(false) : split(true))
      : label(merged[0].m);
    const cash = (merged.find(x => x.m === 'Espèces')?.c || 0) / 100;
    const discountInfo = discount ? { amount: discount.cents / 100, label: discount.label, reason: discount.reason } : null;
    Promise.resolve(onConfirm(method, cash, discountInfo)).finally(() => { confirmLockRef.current = false; });
  };

  const addLine = (method: PayMethod) => {
    if (busy || remainingCents <= 0) return;
    const asked = inputCents > 0 ? inputCents : remainingCents;
    const amount = Math.min(asked, remainingCents);
    // CB et titre-restaurant : jamais plus que le reste (pas de rendu). Espèces : on garde le montant remis pour calculer le rendu.
    const tendered = method === 'Espèces' ? asked : amount;
    const next = [...lines, { id: ++lineIdRef.current, method, amount, tendered }];
    setLines(next);
    setInput('');
    const nextChange = next.reduce((s, l) => s + (l.tendered - l.amount), 0);
    // Paiement soldé sans monnaie à rendre → validation immédiate
    if (amount === remainingCents && nextChange === 0) confirm(next);
  };

  const removeLine = (id: number) => {
    if (busy) return;
    setLines(ls => ls.filter(l => l.id !== id));
  };

  const press = (key: string) => {
    if (busy) return;
    setInput(prev => {
      if (key === 'DEL') return prev.slice(0, -1);
      if (key === 'C') return '';
      if (key === '.') return prev.includes('.') ? prev : (prev || '0') + '.';
      const [i, d] = prev.split('.');
      if (d !== undefined) {
        const room = 2 - d.length;
        return room <= 0 ? prev : prev + key.slice(0, room);
      }
      const nextInt = (i === '0' ? '' : i) + key;
      const clean = nextInt.replace(/^0+(?=\d)/, '');
      return clean.length > 5 ? prev : clean;
    });
  };

  const addBill = (euros: number) => {
    if (busy) return;
    const c = parseInputCents(input) + euros * 100;
    if (c > 9999900) return;
    setInput(c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));
  };

  // Clavier physique
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (discountOpen || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('DEL');
      else if (e.key === 'Escape') { if (!busy) onClose(); }
      else if (e.key === 'Enter') { if (isComplete) confirm(lines); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const primary = themeColors?.primary || '#04B855';
  const display = input ? input.replace('.', ',') : '';
  const key = 'rounded-2xl bg-white border border-gray-200 text-secondary font-black active:scale-[0.96] active:bg-gray-100 transition-transform flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:pointer-events-none';

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999999] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 font-helvetica select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: 'linear' }}
    >
      <motion.div
        className="relative bg-[#F3F4F6] w-[1000px] h-[600px] max-w-[96vw] max-h-[94vh] rounded-[2rem] shadow-2xl flex overflow-hidden"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 400, mass: 0.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        {discountOpen && (
          <DiscountSheet
            totalCents={grossCents - feeCents}
            feeCents={feeCents}
            busy={busy}
            onCancel={() => setDiscountOpen(false)}
            onApply={(d) => {
              setDiscountOpen(false);
              // Remise totale : envoi direct en cuisine sans paiement
              if (grossCents - d.cents <= 0) onOffer({ amount: d.cents / 100, label: d.label, reason: d.reason });
              else setDiscount(d);
            }}
          />
        )}
        {/* Colonne gauche : récap */}
        <div className="w-[36%] bg-white border-r border-gray-200 flex flex-col p-5 gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} aria-label="Fermer" className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center active:scale-95 cursor-pointer disabled:opacity-40">
                <X size={22} />
              </button>
              {/* Remise (employé, promo) : discrète, uniquement avant tout paiement */}
              {onOffer && lines.length === 0 && !discount && (
                <button
                  type="button"
                  onClick={() => setDiscountOpen(true)}
                  disabled={busy}
                  title="Remise (employé, promo)"
                  aria-label="Appliquer une remise"
                  className="w-12 h-12 rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 flex items-center justify-center active:scale-95 cursor-pointer disabled:opacity-40"
                >
                  <MoreHorizontal size={24} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-secondary">
              <Receipt size={20} className="text-gray-400" />
              <span className="text-2xl font-black tabular-nums">{fmtCents(totalCents)} €</span>
            </div>
          </div>

          {/* Rappel de la remise appliquée (retirable tant qu'aucun paiement n'est saisi) */}
          {discount && (
              <div className="flex items-center gap-2 rounded-xl bg-violet-50 border border-violet-200 pl-3 pr-1 py-1">
                <Tag size={18} className="text-violet-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black text-violet-700 truncate">{discount.label}</div>
                  <div className="text-xs font-bold text-violet-500 tabular-nums">
                    <span className="line-through">{fmtCents(grossCents)} €</span> → {fmtCents(totalCents)} €
                  </div>
                </div>
                {lines.length === 0 && (
                  <button type="button" onClick={() => setDiscount(null)} disabled={busy} aria-label="Retirer la remise" className="w-11 h-11 rounded-lg text-violet-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center active:scale-95 cursor-pointer">
                    <X size={18} />
                  </button>
                )}
              </div>
          )}

          <div
            className="rounded-2xl p-4 flex items-center justify-center gap-3 transition-colors"
            style={{ backgroundColor: isComplete ? `${primary}1A` : '#FFF7ED' }}
          >
            {isComplete
              ? <CheckCircle2 size={34} style={{ color: primary }} />
              : <Hourglass size={26} className="text-orange-500" />}
            <div className="text-4xl font-black tabular-nums" style={{ color: isComplete ? primary : '#F97316' }}>
              {fmtCents(remainingCents)} €
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            <AnimatePresence initial={false}>
              {lines.map(l => (
                <motion.div
                  key={l.id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl pl-3 pr-1 py-1"
                >
                  {l.method === 'CB'
                    ? <TapToPayIcon className="h-5 flex-shrink-0 text-blue-600" />
                    : l.method === 'TR'
                      ? <Ticket size={20} className="text-orange-500 flex-shrink-0" />
                      : <Banknote size={20} className="flex-shrink-0" style={{ color: primary }} />}
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-secondary tabular-nums">{fmtCents(l.amount)} €</div>
                    {l.tendered > l.amount && (
                      <div className="text-[11px] font-bold text-gray-400 tabular-nums">
                        {fmtCents(l.tendered)} € → <span className="text-amber-600">{fmtCents(l.tendered - l.amount)} €</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => removeLine(l.id)} disabled={busy} aria-label="Supprimer" className="w-11 h-11 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center active:scale-95 cursor-pointer disabled:opacity-40">
                    <X size={18} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {changeCents > 0 && (
            <div className="rounded-2xl bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
              <ArrowLeftRight size={22} />
              <span className="text-3xl font-black tabular-nums">{fmtCents(changeCents)} €</span>
            </div>
          )}

          {isComplete && (
            <button
              onClick={() => confirm(lines)}
              disabled={busy}
              aria-label="Valider"
              className="h-16 rounded-2xl text-white flex items-center justify-center active:scale-95 transition-transform shadow-md cursor-pointer disabled:opacity-60"
              style={{ backgroundColor: primary }}
            >
              {busy ? <Loader2 size={28} className="animate-spin" /> : <Check size={32} strokeWidth={3} />}
            </button>
          )}
        </div>

        {/* Colonne droite : saisie */}
        <div className="flex-1 flex flex-col p-5 gap-3 min-w-0">
          <div className="h-20 flex-shrink-0 bg-white border border-gray-200 rounded-2xl px-5 flex items-center gap-4">
            <div className={`flex-1 text-4xl font-black tabular-nums truncate ${display ? 'text-secondary' : 'text-gray-300'}`}>
              {display || fmtCents(remainingCents)} <span className="text-xl text-gray-400">€</span>
            </div>
            {pendingChange > 0 && (
              <div className="bg-amber-500 text-white px-3 py-2 rounded-xl font-black text-lg tabular-nums flex items-center gap-2">
                <ArrowLeftRight size={18} /> {fmtCents(pendingChange)} €
              </div>
            )}
          </div>

          <div className="flex-1 flex gap-3 min-h-0">
            <div className="w-[26%] grid grid-rows-5 gap-2">
              <button onClick={() => setInput(remainingCents ? (remainingCents / 100).toFixed(2) : '')} disabled={busy || isComplete} aria-label="Montant exact" className={key}>
                <Equal size={24} />
              </button>
              {[5, 10, 20, 50].map(b => (
                <button key={b} onClick={() => addBill(b)} disabled={busy || isComplete} className={`${key} text-lg gap-1`}>
                  <Plus size={14} className="text-gray-400" />{b}
                </button>
              ))}
            </div>

            <div className="flex-1 grid grid-cols-3 grid-rows-4 gap-2">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(k => (
                <button key={k} onClick={() => press(k)} disabled={busy || isComplete} className={`${key} text-2xl`}>{k}</button>
              ))}
              <button onClick={() => press('.')} disabled={busy || isComplete} className={`${key} text-2xl`}>,</button>
              <button onClick={() => press('0')} disabled={busy || isComplete} className={`${key} text-2xl`}>0</button>
              <button
                onClick={() => press('DEL')}
                onContextMenu={(e) => { e.preventDefault(); press('C'); }}
                disabled={busy || isComplete || !input}
                aria-label="Effacer"
                className={`${key} !bg-red-50 !border-red-100 text-red-500`}
              >
                <Delete size={24} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 h-20 flex-shrink-0">
            {[
              {
                method: 'CB' as PayMethod,
                label: 'Carte',
                aria: 'Carte bancaire',
                cls: 'bg-blue-600',
                style: undefined,
                icon: <TapToPayIcon className="h-9 text-white" />,
                amount: Math.min(inputCents || remainingCents, remainingCents)
              },
              {
                method: 'Espèces' as PayMethod,
                label: 'Espèces',
                aria: 'Espèces',
                cls: '',
                style: { backgroundColor: primary },
                icon: <Banknote size={34} strokeWidth={1.75} />,
                amount: inputCents || remainingCents
              },
              {
                method: 'TR' as PayMethod,
                label: 'Titre resto',
                aria: 'Titre restaurant (Swile, Edenred, Up, Pluxee…)',
                cls: 'bg-orange-500',
                style: undefined,
                icon: <Ticket size={34} strokeWidth={1.75} />,
                amount: Math.min(inputCents || remainingCents, remainingCents)
              }
            ].map(b => (
              <button
                key={b.method}
                onClick={() => addLine(b.method)}
                disabled={busy || isComplete}
                aria-label={b.aria}
                title={b.aria}
                className={`rounded-2xl text-white flex items-center gap-3 px-4 active:scale-[0.97] transition-transform shadow-md cursor-pointer disabled:opacity-40 ${b.cls}`}
                style={b.style}
              >
                <span className="w-12 flex items-center justify-center shrink-0">{b.icon}</span>
                <span className="flex flex-col items-start leading-none gap-1.5 min-w-0">
                  <span className="text-[13px] font-extrabold uppercase tracking-[0.16em] opacity-85 truncate">{b.label}</span>
                  <span className="text-2xl font-black tabular-nums">{fmtCents(b.amount)} €</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
};

const Caisse = () => {
  const { state: cartState, addToCart, removeFromCart, updateQuantity, clearCart } = useCart();
  const navigate = useNavigate();

  const [posRestoId, setPosRestoId] = useState<string | null>(getInitialRestaurantId);
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinCode, setPinCode] = useState("");

  const [restaurantLogo, setRestaurantLogo] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState<string>("VOTRE RESTAURANT");
  const [restaurantInfo, setRestaurantInfo] = useState<{ name: string; address: string | null; phone: string | null; tva: number; logoUrl?: string | null }>({
    name: 'VOTRE RESTAURANT',
    address: null,
    phone: null,
    tva: 10,
    logoUrl: null
  });
  const [themeColors, setThemeColors] = useState({ primary: '#04B855', secondary: '#1f2937', accent: '#FBBF24' });
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [menuData, setMenuData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const isSubmittingRef = useRef(false);
  const isSyncingOfflineRef = useRef(false);

  const [isOrderTrackerOpen, setIsOrderTrackerOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStockOpen, setIsStockOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [loadedOrderId, setLoadedOrderId] = useState<string | number | null>(null);
  // Frais de livraison saisis avant de passer en sur place / emporter (remis en revenant en livraison)
  const lastDeliveryFeeRef = useRef<number | null>(null);
  // Contenu d'une commande rouverte au moment du chargement : si rien n'a changé, l'encaisser ne la
  // renvoie pas « En cours » en cuisine (elle peut déjà être prête ou remise au client)
  const loadedSignatureRef = useRef<string | null>(null);
  // Lignes de la commande rouverte telles qu'au chargement (pour imprimer en cuisine les seuls ajouts)
  const loadedLinesRef = useRef<any[]>([]);
  // true = la commande rechargée a été créée sur la caisse (son bon cuisine est déjà sorti à la mise en attente)
  const loadedOrderFromCaisseRef = useRef<boolean>(true);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  // Paiement en cours sur un TPE SumUp Solo (null = aucun)
  const [soloPayment, setSoloPayment] = useState<null | {
    reader: { id: string; name: string };
    amountCents: number;
    resolve: (outcome: SoloPaymentOutcome) => void;
  }>(null);
  const soloBusyRef = useRef(false);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isVariantsModalOpen, setIsVariantsModalOpen] = useState(false);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
  
  const [initialSelections, setInitialSelections] = useState<any>(null);

  // Forme « paresseuse » : le réglage n'est lu qu'une fois (sinon lecture disque via l'exe à chaque affichage)
  const [orderType, setOrderType] = useState<'SUR PLACE' | 'EMPORTER' | 'LIVRAISON'>(getDefaultOrderType);
  const [previousOrderType, setPreviousOrderType] = useState<'SUR PLACE' | 'EMPORTER' | 'LIVRAISON'>(getDefaultOrderType);
  const [activeOrderTypes, setActiveOrderTypes] = useState<string[]>(['SUR PLACE', 'EMPORTER', 'LIVRAISON']);
  
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [clientInfo, setClientInfo] = useState<{name: string, phone: string, address: string, additionalInfo: string, fee: number} | null>(null);
  const clientInfoRef = useRef<any>(null);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);

  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const lastClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const [optionGroupMapping, setOptionGroupMapping] = useState<Record<string, string>>({});

  const customToast = (msg: string, type: 'success' | 'error' = 'success', options = {}) => 
    toast[type](msg, { duration: 800, ...options });

  useEffect(() => {
    const handleRestoChanged = (e?: any) => {
      const newId = e?.detail?.restaurantId || getInitialRestaurantId();
      if (newId && newId !== 'null' && newId !== 'undefined' && String(newId).trim() !== '') {
        setPosRestoId(String(newId).trim());
      } else {
        setPosRestoId(null);
      }
    };

    window.addEventListener('restaurant_id_changed', handleRestoChanged);
    return () => window.removeEventListener('restaurant_id_changed', handleRestoChanged);
  }, []);

  // Présence en direct (Supabase Realtime) : signale au panneau admin que cette caisse est allumée
  useEffect(() => {
    if (!posRestoId) return;
    let deviceId: string | null = null;
    try {
      deviceId = localStorage.getItem('pos_device_id');
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('pos_device_id', deviceId);
      }
    } catch {
      deviceId = deviceId || crypto.randomUUID();
    }
    return announceDevicePresence(supabase, {
      restaurantId: posRestoId,
      deviceId,
      deviceType: 'pos',
      deviceName: 'Caisse Principale',
    });
  }, [posRestoId]);

  useEffect(() => {
    const loadMapping = async () => {
      if (cartState.items && cartState.items.length > 0) {
        const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;
        const mapping = await fetchOptionGroupMapping(cartState.items, activeRestoId);
        setOptionGroupMapping(mapping);
      }
    };
    loadMapping();
  }, [cartState.items]);

  const subtotal = cartState.items.reduce((total, item) => total + getItemTotal(item, optionGroupMapping), 0);
  const cartItemCount = cartState.items.reduce((sum, item) => sum + (item.quantity || 1), 0);

  // Commentaire du ticket (bandeau sous les articles) → colonne « comment » de la commande
  const [ticketComment, setTicketComment] = useState('');
  const ticketCommentRef = useRef('');
  ticketCommentRef.current = ticketComment;
  // Ticket vidé (encaissé, mis en attente ou annulé) : le commentaire repart à zéro
  const prevCartCountRef = useRef(cartItemCount);
  useEffect(() => {
    if (prevCartCountRef.current > 0 && cartItemCount === 0) setTicketComment('');
    prevCartCountRef.current = cartItemCount;
  }, [cartItemCount]);

  // Compteur des commandes du jour en attente de paiement (même périmètre que le suivi des commandes)
  const [pendingPaymentCount, setPendingPaymentCount] = useState(0);
  useEffect(() => {
    const restoId = getActiveRestaurantId() || RESTAURANT_ID;
    if (!restoId || restoId === 'undefined' || restoId === 'null') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const refresh = async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restoId)
        .eq('is_paid', false)
        .neq('status', 'Annulée')
        .gte('created_at', start)
        .lte('created_at', end);
      if (!cancelled && !error) setPendingPaymentCount(count || 0);
    };
    const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
    refresh();
    const channel = supabase
      .channel('caisse_pending_payment_count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restoId}` }, scheduleRefresh)
      .subscribe();
    // Retour sur la caisse (veille, autre fenêtre) : on se remet à jour
    const onVisible = () => { if (document.visibilityState === 'visible') scheduleRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, []);
  const activeDeliveryFee = orderType === 'LIVRAISON' ? (parseFloat(deliveryFee) || 0) : 0;
  const finalTotal = subtotal + activeDeliveryFee;

  // Écran client (second écran) : panier en direct
  useEffect(() => {
    const lines = cartState.items.map((item: any, idx: number) => {
      const key = String(item.customKey || item._cartKey || item.cartKey || item.id || idx);
      const options = getFormattedOrderOptions(item, optionGroupMapping)
        .flatMap((grp: any) => grp.items || [])
        .map((opt: any) => ({ name: `${opt.qty > 1 ? `${opt.qty}× ` : ''}${opt.name}`, sans: !!opt.isSans }));
      return {
        key,
        name: String(item.product?.name || item.name || ''),
        qty: Number(item.quantity) || 1,
        total: Number(getItemTotal(item, optionGroupMapping)) || 0,
        options,
      };
    });
    publishCustomerCart({
      // Restaurant pas encore chargé : l'écran client garde la dernière identité connue
      brand: restaurantName === 'VOTRE RESTAURANT' && !restaurantLogo ? null : {
        id: posRestoId,
        name: restaurantName === 'VOTRE RESTAURANT' ? '' : restaurantName,
        logo: restaurantLogo,
        primary: themeColors.primary,
        secondary: themeColors.secondary,
        accent: themeColors.accent,
      },
      orderType,
      lines,
      count: cartItemCount,
      deliveryFee: activeDeliveryFee,
      total: finalTotal,
      lastKey: null,
    });
  }, [cartState.items, optionGroupMapping, orderType, activeDeliveryFee, finalTotal, cartItemCount, restaurantName, restaurantLogo, themeColors, posRestoId]);

  const hasActiveOrderData = cartItemCount > 0 || !!clientInfo || !!loadedOrderId || deliveryFee > 0;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  // Session réellement ouverte en base pour ce restaurant.
  // string = id ouvert, null = aucune session ouverte, undefined = base injoignable
  const fetchOpenSessionId = async (): Promise<string | null | undefined> => {
    const restoId = posRestoId || getActiveRestaurantId();
    if (!restoId) return null;
    try {
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('id')
        .eq('restaurant_id', restoId)
        .eq('status', 'OPEN')
        .is('closed_at', null)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return undefined;
      return data?.id ?? null;
    } catch {
      return undefined;
    }
  };

  // Ne jamais rattacher une vente à une session fermée (ex : clôturée depuis un autre poste).
  // Hors-ligne, impossible de vérifier : la synchro recontrôlera avant l'envoi.
  const ensureOpenSession = async (): Promise<string | null> => {
    if (!isOnline) return currentSessionId;
    const openId = await fetchOpenSessionId();
    if (openId === undefined) return currentSessionId;
    if (openId !== currentSessionId) setCurrentSessionId(openId);
    return openId;
  };

  const syncOfflineOrders = async () => {
    if (!(window as any).electronAPI?.getOfflineOrders) return;
    // Verrou : une seule synchro à la fois, sinon les mêmes tickets sont envoyés deux fois
    if (isSyncingOfflineRef.current) return;
    isSyncingOfflineRef.current = true;
    let failedCount = 0;
    try {
      const offlineOrders = await (window as any).electronAPI.getOfflineOrders();
      if (!offlineOrders || offlineOrders.length === 0) return;

      // Les tickets hors-ligne ne doivent jamais partir sur une session clôturée entre-temps
      const openSessionId = await fetchOpenSessionId();
      if (openSessionId === undefined) return; // base injoignable : on réessaiera
      if (openSessionId !== currentSessionId) setCurrentSessionId(openSessionId);

      customToast(`Sync de ${offlineOrders.length} ticket(s) local...`, "success");

      for (const order of offlineOrders) {
        const { offline_id, is_update, target_id, order_number, ...supabasePayload } = order;

        if (supabasePayload.session_id !== openSessionId) {
          if (!openSessionId) {
            // Aucune session ouverte : on garde le ticket en local jusqu'à la prochaine ouverture
            failedCount++;
            continue;
          }
          // Session d'origine clôturée : rattachement à la session ouverte (comptée dans le prochain Z)
          supabasePayload.session_id = openSessionId;
        }
        if (supabasePayload.payment_method) {
          supabasePayload.payment_method = normalizeCaissePaymentMethod(supabasePayload.payment_method);
        }

        let error = null;

        if (is_update && target_id) {
          // Commande rouverte (borne, app, caisse) : on ne touche ni à son canal d'origine
          // ni aux coordonnées client que la caisse n'a pas renseignées
          const updatePayload: any = { ...supabasePayload };
          delete updatePayload.order_origin;
          delete updatePayload.checkout_reference;
          if (!updatePayload.customer_name || updatePayload.customer_name === 'Client Caisse') delete updatePayload.customer_name;
          ['customer_phone', 'customer_address', 'customer_address_complement'].forEach(k => {
            if (updatePayload[k] === null || updatePayload[k] === undefined || updatePayload[k] === '') delete updatePayload[k];
          });
          const { error: err } = await supabase
            .from('orders')
            .update(updatePayload)
            .eq('id', target_id);
          error = err;
        } else {
          // Déjà arrivée en base (réponse perdue avant la coupure) : ne pas la créer une 2e fois
          const ref = supabasePayload.checkout_reference;
          const { data: existing, error: lookupErr } = ref
            ? await supabase.from('orders').select('id').eq('checkout_reference', ref).limit(1)
            : { data: [], error: null } as any;
          if (lookupErr) {
            error = lookupErr;
          } else if (existing && existing.length > 0) {
            error = null;
          } else {
            const { error: err } = await supabase
              .from('orders')
              .insert([supabasePayload]);
            error = err;
          }
        }

        if (!error) {
          await (window as any).electronAPI.removeOfflineOrder(offline_id);
        } else {
          failedCount++;
          console.error("Échec synchro ticket hors-ligne :", offline_id, describeDbError(error));
        }
      }
      if (failedCount === 0) customToast("Caisse synchronisée !", "success");
      else customToast(`${failedCount} ticket(s) hors-ligne non synchronisé(s), nouvel essai plus tard`, "error");
    } catch (err) {
      console.error("Échec boucle sync :", err);
    } finally {
      isSyncingOfflineRef.current = false;
    }
  };

  useEffect(() => {
    if (isOnline && isAuthenticated && posRestoId) {
      syncOfflineOrders();
    }
    // currentSessionId : une ouverture de caisse relance l'envoi des tickets restés en local
  }, [isOnline, isAuthenticated, posRestoId, currentSessionId]);

  useEffect(() => {
    if (pinCode.length === 4) {
      if (pinCode === (getSecureSetting('pos_pin', '1234'))) {
        setIsAuthenticated(true);
        setPinCode("");

        if (hasActiveOrderData) {
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
        }

        customToast("Caisse déverrouillée", "success", { duration: 800 });
      } else {
        customToast("Code incorrect", "error");
        setTimeout(() => setPinCode(""), 300);
      }
    }
  }, [pinCode]);

  useEffect(() => {
    if (isAuthenticated && posRestoId) {
      const checkCashSession = async () => {
        try {
          const { data } = await supabase
            .from('cash_sessions')
            .select('id')
            .eq('restaurant_id', posRestoId)
            .eq('status', 'OPEN')
            .is('closed_at', null)
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (data) {
            setCurrentSessionId(data.id);
          } else {
            setIsCashSessionModalOpen(true);
          }
        } catch (e) {
          setIsCashSessionModalOpen(true);
        }
      };
      checkCashSession();
    }
  }, [isAuthenticated, posRestoId, currentSessionId]);

  const loadMenuData = async (activeRestoId: string) => {
    if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') return;
    const [categoriesResponse, productsResponse] = await Promise.all([
      supabase.from('categories').select('*').eq('restaurant_id', activeRestoId).order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true }),
      supabase.from('product').select('*').eq('restaurant_id', activeRestoId).order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true })
    ]);

    if (productsResponse.data) {
      setMenuData(productsResponse.data as Product[]);
      
      const visibleProducts = productsResponse.data.filter((p: any) => p.hide_on_kiosk !== true && p.category?.toLowerCase() !== 'ingredients');
      const activeCategoryNames = new Set<string>();
      
      visibleProducts.forEach((p: any) => {
        if (p.category) activeCategoryNames.add(p.category.trim().toLowerCase());
      });

      let finalCategories: Category[] = [];

      if (categoriesResponse.data && categoriesResponse.data.length > 0) {
        finalCategories = categoriesResponse.data
          .filter((cat: any) => {
            const lowerName = cat.name?.trim().toLowerCase();
            return lowerName !== 'ingredients' && activeCategoryNames.has(lowerName);
          })
          .map((cat: any) => ({ name: cat.name }));
      } else {
        const uniqueCatNames = Array.from(activeCategoryNames);
        finalCategories = uniqueCatNames.map(name => ({ name }));
      }

      setCategories(finalCategories);
      if (!selectedCategory && finalCategories.length > 0) setSelectedCategory(finalCategories[0].name);
    }
  };

  const handleRefreshData = async () => {
    const activeRestoId = getActiveRestaurantId();
    if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') return;
    setIsRefreshing(true);
    try {
      await loadMenuData(activeRestoId);
      customToast("Données actualisées", "success");
    } catch (e) {
      customToast("Erreur d'actualisation", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const activeRestoId = getActiveRestaurantId();
    if (!activeRestoId || activeRestoId === 'undefined' || activeRestoId === 'null') return;

    const init = async () => {
      setIsLoading(true);
      try {
        const { data: restoData } = await supabase.from('restaurants').select('name, restaurant_name, address, phone, tva, logo_url, theme_primary, theme_secondary, theme_accent, allow_dine_in, allow_takeaway, allow_delivery, default_order_type').eq('id', activeRestoId).single();
        if (restoData) {
          const finalRestoName = restoData.restaurant_name || restoData.name || 'VOTRE RESTAURANT';
          setRestaurantName(finalRestoName);
          if (restoData.logo_url) setRestaurantLogo(restoData.logo_url);
          const tvaRate = (restoData.tva !== null && restoData.tva !== undefined) ? Number(restoData.tva) : 10;
          setRestaurantInfo({
            name: finalRestoName,
            address: restoData.address || null,
            phone: restoData.phone || null,
            tva: tvaRate,
            logoUrl: restoData.logo_url || null
          });
          setThemeColors({
            primary: restoData.theme_primary || '#04B855',
            secondary: restoData.theme_secondary || '#1f2937',
            accent: restoData.theme_accent || '#FBBF24'
          });
          
          if (restoData.theme_primary) document.documentElement.style.setProperty('--primary', hexToHslString(restoData.theme_primary));
          if (restoData.theme_secondary) document.documentElement.style.setProperty('--secondary', hexToHslString(restoData.theme_secondary));
          if (restoData.theme_accent) document.documentElement.style.setProperty('--accent', hexToHslString(restoData.theme_accent));

          const types: string[] = [];
          if (restoData.allow_dine_in !== false) types.push('SUR PLACE');
          if (restoData.allow_takeaway !== false) types.push('EMPORTER');
          if (restoData.allow_delivery !== false) types.push('LIVRAISON');
          
          if (types.length === 0) types.push('EMPORTER');
          
          setActiveOrderTypes(types);

          const defaultFromDb = restoData.default_order_type;
          restaurantDefaultOrderType = (defaultFromDb && types.includes(defaultFromDb)) ? defaultFromDb : null;
          const localDefault = getSecureSetting('default_order_type', '');
          // Priorité : réglage de cette caisse > réglage du restaurant en ligne > EMPORTER
          const initialDefault = (localDefault && types.includes(localDefault))
            ? localDefault
            : (defaultFromDb && types.includes(defaultFromDb))
              ? defaultFromDb
              : getDefaultOrderType();

          setOrderType(initialDefault as any);
          setPreviousOrderType(initialDefault as any);
        }

        await loadMenuData(activeRestoId);
      } catch (e) {
        customToast("Erreur de connexion", "error");
      } finally {
        setIsLoading(false);
      }
    };
    init();

    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, [posRestoId]);

  const handleOrderTypeChange = (type: any) => {
    if (type === 'LIVRAISON') {
      const currentInfo = clientInfoRef.current || clientInfo;
      const hasValidClientInfo = currentInfo && currentInfo.name?.trim() && currentInfo.phone?.trim() && currentInfo.address?.trim();
      setPreviousOrderType(orderType);
      setOrderType('LIVRAISON');
      if (!hasValidClientInfo) {
        setIsDeliveryModalOpen(true);
      } else if (orderType !== 'LIVRAISON') {
        // Retour en livraison avec le même client : on remet ses frais (sinon livraison facturée 0 €)
        const infoFee = parseFloat(currentInfo?.fee ?? currentInfo?.delivery_fee ?? currentInfo?.deliveryFee ?? 0);
        const restored = lastDeliveryFeeRef.current ?? (isNaN(infoFee) ? 0 : infoFee);
        setDeliveryFee(Math.max(0, restored));
      }
    } else {
      if (orderType === 'LIVRAISON') lastDeliveryFeeRef.current = deliveryFee;
      setOrderType(type);
      setDeliveryFee(0);
    }
  };

  const handleClientConfirm = (data: any) => {
    if (!data || !data.name?.trim() || !data.phone?.trim() || !data.address?.trim()) {
      toast.error("Nom, Téléphone et Adresse obligatoires pour la livraison !");
      clientInfoRef.current = null;
      setClientInfo(null);
      setOrderType(previousOrderType || getDefaultOrderType());
      setIsDeliveryModalOpen(false);
      return;
    }

    clientInfoRef.current = data;
    setClientInfo(data);
    const fee = parseFloat(data?.fee ?? data?.delivery_fee ?? data?.deliveryFee ?? data?.frais_livraison ?? 0);
    setDeliveryFee(isNaN(fee) ? 0 : Math.max(0, fee));
    lastDeliveryFeeRef.current = null;
    setOrderType('LIVRAISON');
    setIsDeliveryModalOpen(false);
    toast.success(`Client ${data.name} enregistré !`);
  };

  const handleDeliveryModalClose = () => {
    const currentInfo = clientInfoRef.current || clientInfo;
    const hasValidClientInfo = currentInfo && currentInfo.name?.trim() && currentInfo.phone?.trim() && currentInfo.address?.trim();
    if (!hasValidClientInfo) {
      setOrderType(previousOrderType || getDefaultOrderType());
    }
    setIsDeliveryModalOpen(false);
  };

  const ticketSignature = (lines: any[]) =>
    (lines || []).filter(Boolean).map((l: any) => [
      orderItemName(l),
      Number(l.quantity) || 1,
      tillLineTotal(l, optionGroupMapping).toFixed(2),
      getFormattedOrderOptions(l, optionGroupMapping).flatMap(g => g.items.map(o => `${o.qty || 1}x${o.name}${o.isSans ? '-sans' : ''}`)).join(','),
      (Array.isArray(l.removedIngredients) ? l.removedIngredients : []).map((i: any) => i?.name ?? i).join(','),
    ].join('|')).sort().join('\n');

  /** Statut cuisine à enregistrer pour une commande rouverte : inchangée → statut actuel conservé. */
  const isLoadedUnchanged = () =>
    loadedSignatureRef.current !== null && ticketSignature(cartState.items) === loadedSignatureRef.current;
  const kitchenStatusForLoaded = (currentStatus?: string | null) =>
    isLoadedUnchanged() && currentStatus ? currentStatus : 'En cours';

  // ── Commande rouverte modifiée : ticket cuisine des seules différences ──
  // Une ligne = même produit, mêmes options, même prix unitaire, mêmes ingrédients retirés.
  const kitchenLineKey = (l: any) => {
    const qty = Number(l?.quantity) || 1;
    return [
      orderItemName(l),
      (tillLineTotal(l, optionGroupMapping) / qty).toFixed(2),
      getFormattedOrderOptions(l, optionGroupMapping).flatMap(g => g.items.map(o => `${o.qty || 1}x${o.name}${o.isSans ? '-sans' : ''}`)).join(','),
      (Array.isArray(l?.removedIngredients) ? l.removedIngredients : []).map((i: any) => i?.name ?? i).join(','),
    ].join('|');
  };

  /** Ajouts (lignes à préparer) et retraits d'une commande rouverte ; null si rien n'a changé. */
  const computeKitchenDelta = (): { added: any[]; removed: string[] } | null => {
    if (!loadedOrderId || loadedSignatureRef.current === null) return null;
    const before = new Map<string, { qty: number; line: any }>();
    loadedLinesRef.current.filter(Boolean).forEach(l => {
      const k = kitchenLineKey(l); const cur = before.get(k);
      before.set(k, { qty: (cur?.qty || 0) + (Number(l.quantity) || 1), line: cur?.line || l });
    });
    const now = new Map<string, { qty: number; line: any }>();
    cartState.items.filter(Boolean).forEach((l: any) => {
      const k = kitchenLineKey(l); const cur = now.get(k);
      now.set(k, { qty: (cur?.qty || 0) + (Number(l.quantity) || 1), line: cur?.line || l });
    });
    const added: any[] = [];
    now.forEach((v, k) => {
      const diff = v.qty - (before.get(k)?.qty || 0);
      if (diff > 0) added.push({ ...v.line, quantity: diff });
    });
    const removed: string[] = [];
    before.forEach((v, k) => {
      const diff = v.qty - (now.get(k)?.qty || 0);
      if (diff > 0) removed.push(`${diff}x ${orderItemName(v.line)}`);
    });
    return added.length || removed.length ? { added, removed } : null;
  };

  const printKitchenDelta = async (orderNumber: string, comment: string, customerName: string, delta: { added: any[]; removed: string[] }) => {
    const header = `MODIFICATION DE LA COMMANDE ${orderNumber}`;
    const fullComment = [header, comment].filter(Boolean).join(' • ');
    // Retraits imprimés comme des lignes (un ticket cuisine sans ligne n'est pas imprimé par l'exe)
    const lines = [
      ...delta.added,
      ...delta.removed.map(r => ({ name: `RETIRÉ : ${r}`, quantity: 1, isSolo: false })),
    ];
    await generateAndPrintKitchenTicket(orderNumber, orderType, lines, optionGroupMapping, fullComment, customerName);
  };

  // Poubelle d'une ligne. Dernière ligne d'une commande rouverte supprimée : le ticket n'est plus
  // relié à cette commande (sinon la vente suivante écraserait la commande rouverte).
  const removeTicketLine = (itemKey: string) => {
    const isLastLine = cartState.items.filter(Boolean).length <= 1;
    removeFromCart(itemKey);
    if (isLastLine && loadedOrderId) {
      setLoadedOrderId(null);
      loadedOrderFromCaisseRef.current = false;
      setDeliveryFee(0);
      setClientInfo(null);
      clientInfoRef.current = null;
      setTicketComment('');
    }
  };

  const handleLoadOrderIntoCart = (items: any[], orderId: string | number, loadedOrderType?: string, loadedClientInfo?: any, isFromCaisse: boolean = true) => {
    setLoadedOrderId(orderId);
    loadedOrderFromCaisseRef.current = isFromCaisse;
    lastDeliveryFeeRef.current = null;
    clearCart();
    setDeliveryFee(0);
    setClientInfo(null);
    clientInfoRef.current = null;
    
    if (loadedOrderType && activeOrderTypes.includes(loadedOrderType)) {
      setOrderType(loadedOrderType as any);
    }

    setTicketComment(String(loadedClientInfo?.comment || loadedClientInfo?.notes || ''));

    if (loadedClientInfo && Object.keys(loadedClientInfo).length > 0) {
      clientInfoRef.current = loadedClientInfo;
      setClientInfo(loadedClientInfo);
      if (loadedClientInfo.fee || loadedClientInfo.delivery_fee) {
        setDeliveryFee(parseFloat(loadedClientInfo.fee || loadedClientInfo.delivery_fee) || 0);
      }
    }

    loadedSignatureRef.current = null;
    loadedLinesRef.current = [];
    setTimeout(() => {
      // Ligne rouverte : calcul commun (aussi vérifié par « npm run verif:encaissement »)
      const built = items.map((item, idx) => buildLoadedCartItem(item, idx, orderId, menuData));
      built.forEach(line => addToCart(line));
      loadedSignatureRef.current = ticketSignature(built);
      loadedLinesRef.current = built;
      customToast(`Commande #${orderId} chargée (${loadedOrderType || 'SUR PLACE'})`, "success");
    }, 150);
  };

  // ── Recommander une ancienne commande d'un client (fiche livraison) ──
  // Ajoute les lignes au ticket (sans vider le panier) aux prix de la commande, comme le suivi des
  // commandes. Sont écartés : produits supprimés ou indisponibles, lignes dont une option n'est plus
  // disponible, récompenses fidélité offertes. Renvoie le détail pour prévenir le caissier.
  const handleReorderPastOrder = async (order: any): Promise<{ added: number; skipped: { name: string; reason: string }[] }> => {
    const lines = mapOrderItemsForTill(order, optionGroupMapping);
    const skipped: { name: string; reason: string }[] = [];

    // Disponibilité actuelle des options choisies (une seule requête)
    const optionsOf = (line: any): any[] => {
      const src = line.selectedSubOptions || line.product?.selectedSubOptions || line.options || line.flatOptions || [];
      return (Array.isArray(src) ? src : []).flatMap((o: any) => (o && Array.isArray(o.options) ? o.options : [o])).filter(Boolean);
    };
    const optionIds = [...new Set(lines.flatMap(l => optionsOf(l))
      .map((o: any) => String(o.id ?? ''))
      .filter(id => id && !id.startsWith('dyn_') && /^\d+$/.test(id)))];
    const optionAvailability = new Map<string, boolean>();
    if (optionIds.length > 0) {
      try {
        const { data } = await supabase.from('options').select('id, is_available').in('id', optionIds);
        (data || []).forEach((o: any) => optionAvailability.set(String(o.id), o.is_available !== false));
      } catch {
        // Hors ligne : on ne bloque pas sur les options
      }
    }
    const findProduct = (rawId: any) => {
      const realId = extractRealProductId(rawId);
      return (menuData || []).find((p: any) => String(p.id) === String(realId)) || null;
    };

    const keep: any[] = [];
    lines.forEach((line: any) => {
      const name = orderItemName(line);
      if (line.isReward === true || line.is_reward === true || line.product?.isReward === true) {
        skipped.push({ name, reason: 'cadeau fidélité' });
        return;
      }
      const product = findProduct(line.product?.id ?? line.id);
      if (!product) { skipped.push({ name, reason: 'supprimé' }); return; }
      if (product.is_available === false) { skipped.push({ name, reason: 'indisponible' }); return; }

      const badOption = optionsOf(line).find((o: any) => {
        const id = String(o.id ?? '');
        if (id.startsWith('dyn_')) {
          const p = findProduct(id.replace(/^dyn_/, ''));
          return !p || p.is_available === false;
        }
        return optionAvailability.get(id) === false || (optionIds.includes(id) && optionAvailability.size > 0 && !optionAvailability.has(id));
      });
      if (badOption) {
        skipped.push({ name, reason: `${badOption.name || 'option'} indisponible` });
        return;
      }
      keep.push(line);
    });

    const stamp = `re${order.id}-${Date.now().toString(36)}`;
    keep.forEach((line, idx) => addToCart(buildLoadedCartItem(line, idx, stamp, menuData)));

    if (keep.length > 0) customToast(`${keep.length} article${keep.length > 1 ? 's' : ''} ajouté${keep.length > 1 ? 's' : ''}`, 'success');
    if (skipped.length > 0) {
      customToast(`Non ajouté : ${skipped.map(x => `${x.name} (${x.reason})`).join(', ')}`, 'error', { duration: 5000 });
    }
    return { added: keep.length, skipped };
  };

  // 🟢 Vérifie à la fois product_option_groups, sub_option_groups et product_ingredients
  const checkHasCustomization = async (productId: number | string): Promise<boolean> => {
    const cleanPid = extractRealProductId(productId);
    const [optGroupsRes, subGroupsRes, ingRes] = await Promise.all([
      supabase.from('product_option_groups').select('id').eq('product_id', cleanPid).limit(1),
      supabase.from('sub_option_groups').select('id').eq('product_id', cleanPid).limit(1),
      supabase.from('product_ingredients').select('product_id').eq('product_id', cleanPid).limit(1)
    ]);
    return Boolean(
      (optGroupsRes.data && optGroupsRes.data.length > 0) ||
      (subGroupsRes.data && subGroupsRes.data.length > 0) ||
      (ingRes.data && ingRes.data.length > 0)
    );
  };

  // Callback stable pour les cartes produit mémorisées (appelle toujours la dernière version)
  const handleSelectProductRef = useRef<(p: Product) => any>(() => {});
  const onSelectProductStable = useCallback((p: Product) => handleSelectProductRef.current(p), []);
  const visibleProducts = useMemo(
    () => menuData.filter(p => p.category === selectedCategory),
    [menuData, selectedCategory]
  );

  const handleSelectProduct = async (product: Product) => {
    if (!product.is_available) { customToast("Produit indisponible", "error"); return; }
    try {
      const { data: variants } = await supabase.from('product_variants').select('*').eq('product_id', product.id).eq('available', true);
      if (variants && variants.length > 0) {
        setSelectedProductForVariants(product);
        setIsVariantsModalOpen(true);
        return;
      }

      const hasOptions = await checkHasCustomization(product.id);
      if (hasOptions) {
        setSelectedProduct(product);
        setInitialSelections(null);
        setIsOptionsModalOpen(true);
      } else {
        const uniqueId = `${product.id}-no-opts`;
        addToCart({ id: uniqueId, product, quantity: 1, cartKey: uniqueId, customKey: uniqueId } as any);
      }
    } catch (err) {
      const uniqueId = `${product.id}-no-opts`;
      addToCart({ id: uniqueId, product, quantity: 1, cartKey: uniqueId, customKey: uniqueId } as any);
    }
  };
  handleSelectProductRef.current = handleSelectProduct;

  const handleAddToCartFromModal = (p: Product, incomingData: any) => {
    let finalFlatOptions: any[] = [];
    let finalRawSelections: any = null;
    let removedIngredientsList: any[] = [];

    if (incomingData && incomingData.flatOptions && incomingData.rawSelections) {
      finalFlatOptions = incomingData.flatOptions;
      finalRawSelections = incomingData.rawSelections;
      removedIngredientsList = incomingData.removedIngredients || [];
    } 
    else {
      if (Array.isArray(incomingData)) {
        incomingData.forEach(opt => { finalFlatOptions.push({ ...opt, print_order: 1 }); });
        removedIngredientsList = incomingData.removedIngredients || [];
      } else if (typeof incomingData === 'object' && incomingData !== null) {
        const sortedKeys = Object.keys(incomingData).sort((a, b) => parseInt(a) - parseInt(b));
        sortedKeys.forEach(key => {
          const val = incomingData[key];
          const arr = Array.isArray(val) ? val : [val];
          arr.forEach((opt: any) => {
            if (typeof opt === 'object') finalFlatOptions.push({ ...opt, print_order: 1 });
            else if (typeof opt === 'string') finalFlatOptions.push({ name: opt, price: 0, print_order: 1 });
          });
        });
        removedIngredientsList = incomingData.removedIngredients || [];
      }
      finalRawSelections = incomingData;
    }

    const currentProduct = p || selectedProduct;
    const effectiveVariantId = currentProduct?.variantId ?? currentProduct?.variant_id ?? selectedProduct?.variantId;
    const baseParentId = currentProduct?.original_product_id ?? currentProduct?.id ?? selectedProduct?.id;
    
    const effectiveProductId = effectiveVariantId ? `${baseParentId}-var_${effectiveVariantId}` : baseParentId;

    const effectiveProduct: Product = {
      ...selectedProduct,
      ...p,
      id: effectiveProductId,
      original_product_id: baseParentId,
      name: p?.name || currentProduct?.name,
      price: p?.price !== undefined ? p.price : currentProduct?.price,
      isSolo: p?.isSolo ?? currentProduct?.isSolo ?? false,
      variantId: effectiveVariantId,
      variant_id: effectiveVariantId,
      variantName: p?.variantName || currentProduct?.variantName
    };

    const optionsString = finalFlatOptions.map(o => `${o.group_name || o.option_group_name || 'Opt'}:${o.name}`).join('-');
    const removedString = removedIngredientsList.map((i: any) => i.name || i.id).join('-');
    const variantKey = effectiveVariantId ? `var-${effectiveVariantId}` : encodeURIComponent(effectiveProduct.name);
    const optionsHash = btoa(encodeURIComponent(`${variantKey}_${optionsString}_${removedString}`)).substring(0, 15);
    const uniqueCartKey = `${effectiveProductId}-${optionsHash}`;

    let originalQty = 1;
    if (editingItemKey) {
      const found = cartState.items.find((item: any) => (item.customKey || item.cartKey || item.id) === editingItemKey);
      if (found) originalQty = found.quantity || 1;
      removeFromCart(editingItemKey);
      setEditingItemKey(null);
    }

    addToCart({
      id: uniqueCartKey,
      product: effectiveProduct,
      isSolo: effectiveProduct.isSolo === true,
      selectedSubOptions: finalFlatOptions,
      rawSelections: finalRawSelections,
      removedIngredients: removedIngredientsList,
      quantity: originalQty,
      cartKey: uniqueCartKey,
      customKey: uniqueCartKey
    } as any);

    setIsOptionsModalOpen(false);
    setSelectedProduct(null);
    setInitialSelections(null);
  };

  // Encaissement avec TPE : si un SumUp Solo est choisi pour cette caisse, la part « carte »
  // part d'abord sur le TPE. La commande n'est enregistrée payée qu'une fois le paiement accepté ;
  // refus ou annulation = rien n'est enregistré, la caissière choisit un autre moyen.
  const payWithTerminal = async (
    method: string,
    cashAmount: number = 0,
    discount: { amount: number; label: string; reason: string } | null = null
  ) => {
    const reader = isSoloEnabled() ? getSelectedReader() : null;
    let cardCents = 0;
    if (reader) {
      if (method === 'Carte bancaire') {
        cardCents = Math.max(0, Math.round((finalTotal - (discount?.amount || 0)) * 100));
      } else {
        // Paiement fractionné : « Fractionné (CB: 12.50€ + Espèces: 5.00€) »
        const part = method.match(/CB: (\d+(?:\.\d+)?)/);
        if (part) cardCents = Math.round(parseFloat(part[1]) * 100);
      }
    }
    if (!reader || cardCents <= 0) return finalizePayment(method, cashAmount, discount);

    // Mêmes garde-fous que l'enregistrement, AVANT de débiter la carte
    if (cartState.items.length === 0 || isSubmittingRef.current || isProcessing || soloBusyRef.current) return;
    soloBusyRef.current = true;
    try {
      const sessionId = await ensureOpenSession();
      if (!sessionId) {
        customToast("Caisse fermée : ouvrez une session pour encaisser", "error");
        setIsCashSessionModalOpen(true);
        setIsPaymentModalOpen(false);
        return;
      }
      if (!getActiveRestaurantId()) {
        customToast("Caisse non reliée à un restaurant : reconnectez-la dans les réglages", "error");
        return;
      }
      const outcome = await new Promise<SoloPaymentOutcome>((resolve) => {
        setSoloPayment({ reader, amountCents: cardCents, resolve });
      });
      setSoloPayment(null);
      if (!outcome.ok) return;
      await finalizePayment(method, cashAmount, discount);
    } finally {
      soloBusyRef.current = false;
    }
  };

  const finalizePayment = async (
    method: string,
    cashAmount: number = 0,
    discount: { amount: number; label: string; reason: string } | null = null
  ) => {
    // Remise (employé, promo) : total_price = montant réellement dû, discount_amount = remise,
    // coupon_title = motif (+ prénom). Remise totale = commande offerte : payée à 0 €,
    // aucun chiffre d'affaires ne la compte, pas de tiroir ni de ticket client.
    const discountAmount = discount ? Math.min(Math.round(discount.amount * 100) / 100, parseFloat(finalTotal.toFixed(2))) : 0;
    const recordedTotal = Math.max(0, Math.round((finalTotal - discountAmount) * 100) / 100);
    const isOffered = !!discount && recordedTotal === 0;
    if (isOffered) {
      method = `Offert (${discount!.reason})`;
      cashAmount = 0;
    }
    const discountFields = discount ? { discount_amount: discountAmount, coupon_title: discount.label.slice(0, 120) } : {};
    // Ticket client : ligne « REMISE » négative pour que le total imprimé soit juste
    // Lignes aux montants à jour (base_price = prix réellement vendu, même après modification
    // d'une ligne rouverte) : le ticket imprime exactement ce qui est enregistré.
    const receiptLines = normalizeLinesForSave(cartState.items, optionGroupMapping);
    const receiptItems = discount && !isOffered
      ? [...receiptLines, { name: `REMISE ${discount.label}`, quantity: 1, price: -discountAmount, isSolo: false }]
      : receiptLines;
    if (cartState.items.length === 0) return;
    
    // 🛑 Verrou synchrone immédiat : bloque tout double-clic ou rebond tactile
    if (isSubmittingRef.current || isProcessing) return;
    isSubmittingRef.current = true;
    setIsProcessing(true);
    // Commande rouverte : différences à envoyer en cuisine (calculées avant de vider le ticket)
    const kitchenDelta = computeKitchenDelta();

    try {
      const sessionId = await ensureOpenSession();
      if (!sessionId) {
        customToast("Caisse fermée : ouvrez une session pour encaisser", "error");
        setIsCashSessionModalOpen(true);
        setIsPaymentModalOpen(false);
        return;
      }
      
      const activeRestoId = getActiveRestaurantId();
      // Jamais de commande sans restaurant (invisible dans l'admin, la cuisine et le Z)
      if (!activeRestoId) {
        customToast("Caisse non reliée à un restaurant : reconnectez-la dans les réglages", "error");
        return;
      }
      // Montants de chaque ligne recalculés à l'enregistrement (jamais d'ancien total périmé)
      const cleanOrderDetails = normalizeLinesForSave(JSON.parse(JSON.stringify(cartState.items)), optionGroupMapping);
      const currentOrderTypeId = ORDER_TYPE_IDS[orderType];
      let targetOrderNumber = `C${String(Date.now()).slice(-4)}`;

      // 🟢 Normalisation stricte de la méthode (ex: 'cb' ou 'CB' devient 'Carte bancaire')
      const cleanPaymentMethod = normalizeCaissePaymentMethod(method);
      const effectiveClient = clientInfoRef.current || clientInfo;

      const offlineId = `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const orderPayload = {
        offline_id: offlineId,
        is_update: !!loadedOrderId,
        target_id: loadedOrderId || null,
        // Référence unique de la vente : la synchro hors-ligne ne l'insère jamais deux fois
        ...(loadedOrderId ? {} : { checkout_reference: offlineId }),
        restaurant_id: activeRestoId,
        total_price: recordedTotal,
        ...discountFields,
        delivery_fee: activeDeliveryFee, 
        is_paid: true,
        payment_status: 'paid',
        // Commande rouverte sans modification : statut cuisine laissé tel quel (clé absente)
        status: (loadedOrderId && isLoadedUnchanged()) ? undefined : 'En cours',
        payment_method: cleanPaymentMethod,
        cash_amount: cashAmount,
        order_origin: 'caisse',
        order_type_id: currentOrderTypeId,
        order_details: cleanOrderDetails,
        customer_name: effectiveClient?.name || 'Client Caisse',
        customer_phone: effectiveClient?.phone || null,
        customer_address: effectiveClient?.address ? String(effectiveClient.address).trim() : null,
        customer_address_complement: getClientComplement(effectiveClient) || null,
        comment: ticketCommentRef.current.trim() || effectiveClient?.comment || effectiveClient?.notes || null,
        order_number: targetOrderNumber,
        session_id: sessionId 
      };

      if (!isOnline) {
        if ((window as any).electronAPI?.saveOfflineOrder) {
          await (window as any).electronAPI.saveOfflineOrder(orderPayload);
          customToast(isOffered ? `${method} : ${finalTotal.toFixed(2)}€ envoyés en cuisine (hors-ligne)` : `Encaissé (Hors-ligne) ${recordedTotal.toFixed(2)}€`, "success");

          const isCashMethodOffline = String(cleanPaymentMethod).toLowerCase().includes('espece') || 
                                      String(cleanPaymentMethod).toLowerCase().includes('espèces') || 
                                      String(cleanPaymentMethod).toLowerCase().includes('cash') || 
                                      cashAmount > 0;
          if (isCashMethodOffline && !isOffered) {
            openCashDrawer(true);
          }
          
          const isAutoPrintReceiptEnabled = getSecureSetting('auto_print_receipt', 'true') !== 'false';
          if (isAutoPrintReceiptEnabled && !isOffered) {
            await generateAndPrintReceipt(restaurantInfo, targetOrderNumber, orderType, cleanPaymentMethod, receiptItems, subtotal, activeDeliveryFee, recordedTotal, cashAmount, effectiveClient, optionGroupMapping);
          }
          
          const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
          if (isKitchenTicketEnabled && (!loadedOrderId || !loadedOrderFromCaisseRef.current)) {
            setTimeout(async () => {
              await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping, orderPayload.comment || '', orderPayload.customer_name || '');
            }, 500);
          } else if (isKitchenTicketEnabled && kitchenDelta) {
            setTimeout(() => { printKitchenDelta(targetOrderNumber, orderPayload.comment || '', orderPayload.customer_name || '', kitchenDelta); }, 500);
          }

          showCustomerThanks(recordedTotal);
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
          setIsPaymentModalOpen(false);
        } else {
          customToast("Erreur : Mode hors-ligne impossible sur le Web", "error");
        }
        return;
      }

      let savedOnline = false;
      try {
        if (loadedOrderId) {
          // Commande rouverte : elle doit être encore à encaisser (pas payée ailleurs, pas annulée)
          const { data: current, error: currentErr } = await supabase
            .from('orders').select('is_paid, payment_status, status').eq('id', loadedOrderId).maybeSingle();
          if (currentErr) throw currentErr;
          if (!current || current.is_paid || current.payment_status === 'paid' || current.status === 'Annulée') {
            customToast(
              !current ? "Commande introuvable : elle a été supprimée"
                : current.status === 'Annulée' ? "Commande annulée entre-temps : encaissement bloqué"
                : "Commande déjà encaissée ailleurs : encaissement bloqué",
              "error"
            );
            setIsPaymentModalOpen(false);
            return;
          }
          const updateData: any = {
            is_paid: true,
            payment_status: 'paid',
            status: kitchenStatusForLoaded(current.status),
            payment_method: cleanPaymentMethod,
            cash_amount: cashAmount, 
            order_type_id: currentOrderTypeId || undefined, 
            order_details: cleanOrderDetails, 
            total_price: recordedTotal, 
            ...discountFields,
            delivery_fee: activeDeliveryFee,
            session_id: sessionId 
          };

          updateData.comment = orderPayload.comment;
          if (effectiveClient?.name) updateData.customer_name = effectiveClient.name;
          if (effectiveClient?.phone) updateData.customer_phone = effectiveClient.phone;
          if (effectiveClient?.address) {
            updateData.customer_address = String(effectiveClient.address).trim();
            updateData.customer_address_complement = getClientComplement(effectiveClient) || null;
          }

          const { error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', loadedOrderId);
          if (error) throw error;
          savedOnline = true;

          const { data: orderData } = await supabase.from('orders').select('order_number').eq('id', loadedOrderId).single();
          if (orderData?.order_number) targetOrderNumber = orderData.order_number;
        } else {
          const { offline_id, is_update, target_id, order_number, ...insertPayload } = orderPayload;

          const { data: insertedOrder, error } = await supabase
            .from('orders')
            .insert([insertPayload])
            .select('id, order_number')
            .single();

          if (error) throw error;
          savedOnline = true;
          if (insertedOrder?.order_number) {
            targetOrderNumber = insertedOrder.order_number;
          }
        }

        customToast(isOffered ? `${method} : ${finalTotal.toFixed(2)}€ envoyés en cuisine` : `Encaissé ${recordedTotal.toFixed(2)}€${discount ? ` (remise -${discountAmount.toFixed(2)}€)` : ''}`, "success");

        const isCashMethodOnline = String(cleanPaymentMethod).toLowerCase().includes('espece') || 
                                   String(cleanPaymentMethod).toLowerCase().includes('espèces') || 
                                   String(cleanPaymentMethod).toLowerCase().includes('cash') || 
                                   cashAmount > 0;
        if (isCashMethodOnline && !isOffered) {
          openCashDrawer(true);
        }

        const isAutoPrintReceiptEnabled = getSecureSetting('auto_print_receipt', 'true') !== 'false';
        if (isAutoPrintReceiptEnabled && !isOffered) {
          await generateAndPrintReceipt(restaurantInfo, targetOrderNumber, orderType, cleanPaymentMethod, receiptItems, subtotal, activeDeliveryFee, recordedTotal, cashAmount, effectiveClient, optionGroupMapping);
        }
        
        const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
        if (isKitchenTicketEnabled && (!loadedOrderId || !loadedOrderFromCaisseRef.current)) {
          setTimeout(async () => {
            await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping, orderPayload.comment || '', orderPayload.customer_name || '');
          }, 500);
        } else if (isKitchenTicketEnabled && kitchenDelta) {
          setTimeout(() => { printKitchenDelta(targetOrderNumber, orderPayload.comment || '', orderPayload.customer_name || '', kitchenDelta); }, 500);
        }

        showCustomerThanks(recordedTotal);
        clearCart();
        setLoadedOrderId(null);
        setDeliveryFee(0);
        setClientInfo(null);
        clientInfoRef.current = null;
        setOrderType(getDefaultOrderType());
        setIsPaymentModalOpen(false);

      } catch (e) {
        // Commande DÉJÀ enregistrée (l'erreur vient de l'impression, du tiroir…) : surtout pas de
        // copie locale, elle serait renvoyée à la synchro et la vente compterait deux fois.
        if (savedOnline) {
          console.error("Erreur après l'enregistrement de la commande :", e);
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
          setIsPaymentModalOpen(false);
          return;
        }
        // Refus explicite de Supabase (contrainte, trigger, droits…) : inutile de stocker en local,
        // la synchro échouerait à l'identique. On affiche la vraie raison et on garde le panier.
        if (isDbRejection(e)) {
          console.error("Supabase a refusé l'enregistrement :", describeDbError(e));
          customToast(`Refusé par la base : ${e?.message || e?.code}`, "error");
          return;
        }
        console.error("Crash réseau inattendu, bascule de secours locale :", describeDbError(e));
        if ((window as any).electronAPI?.saveOfflineOrder) {
          orderPayload.order_number = targetOrderNumber;
          await (window as any).electronAPI.saveOfflineOrder(orderPayload);
          customToast(isOffered ? `${method} : ${finalTotal.toFixed(2)}€ envoyés en cuisine (local)` : `Encaissé (Local de secours) ${recordedTotal.toFixed(2)}€`, "success");
          
          const isAutoPrintReceiptEnabled = getSecureSetting('auto_print_receipt', 'true') !== 'false';
          if (isAutoPrintReceiptEnabled && !isOffered) {
            await generateAndPrintReceipt(restaurantInfo, targetOrderNumber, orderType, cleanPaymentMethod, receiptItems, subtotal, activeDeliveryFee, recordedTotal, cashAmount, effectiveClient, optionGroupMapping);
          }

          const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
          if (isKitchenTicketEnabled && (!loadedOrderId || !loadedOrderFromCaisseRef.current)) {
            setTimeout(async () => {
              await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping, orderPayload.comment || '', orderPayload.customer_name || '');
            }, 500);
          } else if (isKitchenTicketEnabled && kitchenDelta) {
            setTimeout(() => { printKitchenDelta(targetOrderNumber, orderPayload.comment || '', orderPayload.customer_name || '', kitchenDelta); }, 500);
          }
          
          showCustomerThanks(recordedTotal);
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
          setIsPaymentModalOpen(false);
        } else {
          customToast("Erreur d'enregistrement BDD", "error");
        }
      }
    } finally {
      isSubmittingRef.current = false;
      setIsProcessing(false);
    }
  };

  const processPendingOrder = async () => {
    if (cartState.items.length === 0) return;
    
    if (isSubmittingRef.current || isProcessing) return;
    isSubmittingRef.current = true;
    setIsProcessing(true);
    // Commande rouverte : différences à envoyer en cuisine (calculées avant de vider le ticket)
    const kitchenDelta = computeKitchenDelta();

    try {
      const sessionId = await ensureOpenSession();
      if (!sessionId) {
        customToast("Caisse fermée : ouvrez une session pour encaisser", "error");
        setIsCashSessionModalOpen(true);
        return;
      }
      
      const activeRestoId = getActiveRestaurantId();
      // Jamais de commande sans restaurant (invisible dans l'admin, la cuisine et le Z)
      if (!activeRestoId) {
        customToast("Caisse non reliée à un restaurant : reconnectez-la dans les réglages", "error");
        return;
      }
      // Montants de chaque ligne recalculés à l'enregistrement (jamais d'ancien total périmé)
      const cleanOrderDetails = normalizeLinesForSave(JSON.parse(JSON.stringify(cartState.items)), optionGroupMapping);
      const currentOrderTypeId = ORDER_TYPE_IDS[orderType];
      let targetOrderNumber = `C${String(Date.now()).slice(-4)}`;
      const effectiveClient = clientInfoRef.current || clientInfo;

      const offlineId = `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const orderPayload = {
        offline_id: offlineId,
        is_update: !!loadedOrderId,
        target_id: loadedOrderId || null,
        // Référence unique de la vente : la synchro hors-ligne ne l'insère jamais deux fois
        ...(loadedOrderId ? {} : { checkout_reference: offlineId }),
        restaurant_id: activeRestoId,
        total_price: parseFloat(finalTotal.toFixed(2)),
        delivery_fee: activeDeliveryFee, 
        is_paid: false,
        payment_status: 'pending',
        // Commande rouverte sans modification : statut cuisine laissé tel quel (clé absente)
        status: (loadedOrderId && isLoadedUnchanged()) ? undefined : 'En cours',
        payment_method: 'en attente',
        cash_amount: 0,
        order_origin: 'caisse',
        order_type_id: currentOrderTypeId,
        order_details: cleanOrderDetails,
        customer_name: effectiveClient?.name || 'Client Caisse',
        customer_phone: effectiveClient?.phone || null,
        customer_address: effectiveClient?.address ? String(effectiveClient.address).trim() : null,
        customer_address_complement: getClientComplement(effectiveClient) || null,
        comment: ticketCommentRef.current.trim() || effectiveClient?.comment || effectiveClient?.notes || null,
        order_number: targetOrderNumber,
        session_id: sessionId 
      };

      if (!isOnline) {
        if ((window as any).electronAPI?.saveOfflineOrder) {
          await (window as any).electronAPI.saveOfflineOrder(orderPayload);
          customToast(`En attente (Hors-ligne) ${finalTotal.toFixed(2)}€`, "success");
          
          const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
          if (isKitchenTicketEnabled && !loadedOrderId) {
            setTimeout(async () => {
              await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping, orderPayload.comment || '', orderPayload.customer_name || '');
            }, 500);
          } else if (isKitchenTicketEnabled && kitchenDelta) {
            setTimeout(() => { printKitchenDelta(targetOrderNumber, orderPayload.comment || '', orderPayload.customer_name || '', kitchenDelta); }, 500);
          }

          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
        } else {
          customToast("Erreur : Mode hors-ligne impossible sur le Web", "error");
        }
        return;
      }

      let savedOnline = false;
      try {
        if (loadedOrderId) {
          // Commande rouverte : jamais repasser « non payée » une commande encaissée ou annulée ailleurs
          const { data: current, error: currentErr } = await supabase
            .from('orders').select('is_paid, payment_status, status').eq('id', loadedOrderId).maybeSingle();
          if (currentErr) throw currentErr;
          if (!current || current.is_paid || current.payment_status === 'paid' || current.status === 'Annulée') {
            customToast(
              !current ? "Commande introuvable : elle a été supprimée"
                : current.status === 'Annulée' ? "Commande annulée entre-temps : rien n'a été modifié"
                : "Commande déjà encaissée ailleurs : rien n'a été modifié",
              "error"
            );
            return;
          }
          const updateData: any = { 
            is_paid: false, 
            payment_status: 'pending', 
            status: kitchenStatusForLoaded(current.status), 
            payment_method: 'en attente', 
            cash_amount: 0, 
            order_type_id: currentOrderTypeId || undefined, 
            order_details: cleanOrderDetails, 
            total_price: parseFloat(finalTotal.toFixed(2)), 
            delivery_fee: activeDeliveryFee, 
            session_id: sessionId 
          };

          updateData.comment = orderPayload.comment;
          if (effectiveClient?.name) updateData.customer_name = effectiveClient.name;
          if (effectiveClient?.phone) updateData.customer_phone = effectiveClient.phone;
          if (effectiveClient?.address) {
            updateData.customer_address = String(effectiveClient.address).trim();
            updateData.customer_address_complement = getClientComplement(effectiveClient) || null;
          }

          const { error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', loadedOrderId);
          if (error) throw error;
          savedOnline = true;

          const { data: orderData } = await supabase.from('orders').select('order_number').eq('id', loadedOrderId).single();
          if (orderData?.order_number) targetOrderNumber = orderData.order_number;
        } else {
          const { offline_id, is_update, target_id, order_number, ...insertPayload } = orderPayload;

          const { data: insertedOrder, error } = await supabase
            .from('orders')
            .insert([insertPayload])
            .select('id, order_number')
            .single();

          if (error) throw error;
          savedOnline = true;
          if (insertedOrder?.order_number) {
            targetOrderNumber = insertedOrder.order_number;
          }
        }

        customToast(`Commande en attente de ${finalTotal.toFixed(2)}€`, "success");
        
        const isKitchenTicketEnabled = getSecureSetting('print_kitchen_ticket', 'true') !== 'false';
        if (isKitchenTicketEnabled && !loadedOrderId) {
          setTimeout(async () => {
            await generateAndPrintKitchenTicket(targetOrderNumber, orderType, cartState.items, optionGroupMapping, orderPayload.comment || '', orderPayload.customer_name || '');
          }, 500);
        } else if (isKitchenTicketEnabled && kitchenDelta) {
          setTimeout(() => { printKitchenDelta(targetOrderNumber, orderPayload.comment || '', orderPayload.customer_name || '', kitchenDelta); }, 500);
        }

        clearCart();
        setLoadedOrderId(null);
        setDeliveryFee(0);
        setClientInfo(null);
        clientInfoRef.current = null;
        setOrderType(getDefaultOrderType());

      } catch (e) {
        // Déjà enregistrée : pas de copie locale (elle serait renvoyée une 2e fois à la synchro)
        if (savedOnline) {
          console.error("Erreur après l'enregistrement de la commande :", e);
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
          return;
        }
        // Refus explicite de Supabase (contrainte, trigger, droits…) : inutile de stocker en local,
        // la synchro échouerait à l'identique. On affiche la vraie raison et on garde le panier.
        if (isDbRejection(e)) {
          console.error("Supabase a refusé l'enregistrement :", describeDbError(e));
          customToast(`Refusé par la base : ${e?.message || e?.code}`, "error");
          return;
        }
        console.error("Crash réseau inattendu, bascule de secours locale :", describeDbError(e));
        if ((window as any).electronAPI?.saveOfflineOrder) {
          orderPayload.order_number = targetOrderNumber;
          await (window as any).electronAPI.saveOfflineOrder(orderPayload);
          customToast(`En attente (Sauvegardé localement) ${finalTotal.toFixed(2)}€`, "success");
          
          clearCart();
          setLoadedOrderId(null);
          setDeliveryFee(0);
          setClientInfo(null);
          clientInfoRef.current = null;
          setOrderType(getDefaultOrderType());
        } else {
          customToast("Erreur d'enregistrement BDD", "error");
        }
      }
    } finally {
      isSubmittingRef.current = false;
      setIsProcessing(false);
    }
  };

  const rightBarBtnClass = "w-[56px] h-[56px] flex flex-col items-center justify-center text-primary rounded-xl hover:bg-white/10 active:scale-95 transition-all shadow-sm mx-auto cursor-pointer";

  if (!posRestoId || posRestoId === 'null' || posRestoId === 'undefined' || posRestoId.trim() === '') {
    return (
      <PosSetup>
        <></>
      </PosSetup>
    );
  }

  if (isLoading) return <NewtonsCradleLoader />;

  if (!isAuthenticated) {
    const pinBtnClass = "w-16 h-16 bg-white hover:bg-gray-100 rounded-2xl text-secondary font-black text-2xl active:scale-90 transition-all shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] border border-gray-100 flex items-center justify-center group cursor-pointer";
    
    return (
      <div className="flex flex-col h-screen w-full bg-background items-center justify-center font-helvetica select-none relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center text-secondary/50 font-bold z-20">
          <span className={isOnline ? 'text-secondary/50' : 'text-red-500 animate-pulse'}>{isOnline ? <Wifi size={24} /> : <WifiOff size={24} />}</span>
          <span className="text-xl tracking-wider"><LiveClock kind="time" /></span>
        </div>
        
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-primary/10 blur-[100px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-[0_20px_80px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center border border-white max-w-[300px] w-full mx-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg overflow-hidden bg-[#0B0F19] border border-gray-800">
            {restaurantLogo ? (
              <img src={restaurantLogo} alt="Logo" className="w-full h-full object-contain p-1.5" />
            ) : (
              <Store size={28} className="text-primary" />
            )}
          </div>
          
          <h2 className="text-secondary text-xl font-black uppercase tracking-widest mb-1">Caisse Sécurisée</h2>
          <p className="text-gray-400 font-bold text-[10px] mb-6 uppercase tracking-widest">Entrez le code d'accès</p>
          
          <div className="flex gap-3 mb-6">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-inner ${pinCode.length > i ? 'scale-125 shadow-md bg-gray-200' : ''}`} style={pinCode.length > i ? { backgroundColor: themeColors.primary } : undefined}></div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[1,2,3,4,5,6,7,8,9].map(num => (
              <button key={num} onClick={() => setPinCode(p => p.length < 4 ? p + num : p)} className={pinBtnClass}>{num}</button>
            ))}
            <button onClick={() => setPinCode(p => p.length < 4 ? p + '0' : p)} className={pinBtnClass}>0</button>
            <button onClick={() => setPinCode(p => p.slice(0, -1))} className="w-16 h-16 bg-red-50 hover:bg-red-100 text-red-500 rounded-2xl font-black flex items-center justify-center active:scale-90 transition-all shadow-sm cursor-pointer"><Delete size={24} /></button>
          </div>

          <button onClick={() => navigate('/')} className="mt-6 px-5 py-2 rounded-full bg-gray-100 text-gray-500 font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors text-[9px] cursor-pointer">Retour à l'accueil</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-gray-100 font-helvetica overflow-hidden select-none">
      
      <div className="flex-shrink-0 h-8 text-white/90 flex justify-between items-center px-4 text-[11px] font-bold tracking-widest uppercase z-50 shadow-md" style={{ backgroundColor: themeColors.secondary }}>
        <div className="flex items-center gap-4">
          <div className={isOnline ? 'text-green-400' : 'text-red-500 animate-pulse'}>{isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}</div>
          <div className="w-px h-3 bg-white/20"></div>
          <div className="flex items-center gap-2 text-white/90">
            {restaurantLogo ? (
              <img src={restaurantLogo} alt="App Logo" className="w-4 h-4 rounded object-contain bg-black/40" />
            ) : (
              <Store size={14} className="text-primary" />
            )}
            <span>{restaurantInfo?.name || "Caisse Principale"}</span>
          </div>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-white font-black text-[13px] tracking-[0.2em]"><LiveClock kind="time" /></div>
        <div className="flex items-center gap-4">
          <CalendarDays size={14} /> <span><LiveClock kind="date" /></span>
          <div className="w-px h-3 bg-white/20"></div>
          <button 
            onClick={handleRefreshData} 
            disabled={isRefreshing}
            className="flex items-center gap-1.5 hover:text-white text-white/80 transition-colors active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Actualiser les données"
          >
            <RotateCw size={14} className={isRefreshing ? 'animate-spin text-primary' : ''} />
            <span>Actualiser</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        <div className="flex-1 flex flex-col h-full bg-[#F3F4F6] relative min-w-0">
          
          <div className="bg-white border-b border-gray-200 shadow-sm flex-shrink-0 z-20">
            {activeOrderTypes.length > 0 && (
              <div className="p-2 bg-gray-100/90 border-b border-gray-200">
                <div className="flex gap-2 max-w-2xl">
                  {activeOrderTypes.map(type => {
                    const isActive = orderType === type;
                    const config = ORDER_TYPE_CONFIG[type] || { label: type, icon: '' };

                    return (
                      <button 
                        key={type} 
                        onClick={() => handleOrderTypeChange(type as any)} 
                        className={`flex-1 h-11 px-4 rounded-xl font-black text-[12px] uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 cursor-pointer shadow-sm ${
                          isActive 
                            ? 'text-white shadow-md scale-[1.01]' 
                            : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                        }`} 
                        style={isActive ? { backgroundColor: themeColors.secondary } : undefined}
                      >
                        {config.icon && (
                          <img 
                            src={config.icon} 
                            alt={config.label} 
                            className={`w-5 h-5 object-contain transition-all ${isActive ? 'brightness-0 invert' : 'opacity-80'}`} 
                          />
                        )}
                        <span>{config.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="p-2.5 sm:p-3 grid grid-cols-5 gap-2 sm:gap-2.5">
              {categories.map(cat => {
                const isSelected = selectedCategory === cat.name;
                return (
                  <button 
                    key={cat.name} 
                    onClick={() => setSelectedCategory(cat.name)} 
                    className="h-[46px] sm:h-[48px] px-2 rounded-xl font-black text-[12px] xl:text-[13.5px] uppercase tracking-wide transition-all border-2 flex items-center justify-center text-center truncate cursor-pointer shadow-sm active:scale-95" 
                    style={{ 
                      backgroundColor: isSelected ? themeColors.secondary : '#ffffff', 
                      borderColor: isSelected ? themeColors.secondary : '#e5e7eb', 
                      color: isSelected ? '#ffffff' : themeColors.secondary 
                    }}
                  >
                    <span className="truncate">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 p-3.5 sm:p-4 xl:p-5 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(265px,1fr))] gap-3 sm:gap-3.5 xl:gap-4 content-start">
              {visibleProducts.map(product => (
                <ProductCard key={product.id} product={product as any} onSelectProduct={onSelectProductStable as any} />
              ))}
            </div>
          </div>
        </div>

        <div className="w-[260px] bg-white border-l border-gray-200 flex flex-col h-full z-30 shadow-xl flex-shrink-0">
          
          <div className="p-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex justify-between items-center">
            <div className="flex flex-col">
              <span className="font-black text-sm uppercase" style={{ color: themeColors.secondary }}>Ticket {loadedOrderId && `Borne`}</span>
              {clientInfo?.name && (
                <button onClick={() => setIsDeliveryModalOpen(true)} className="text-[10px] text-primary font-bold text-left hover:underline cursor-pointer">
                  👤 {clientInfo.name}
                </button>
              )}
            </div>
            <span className="flex items-center gap-1.5 bg-gray-200 px-2.5 py-1 rounded-lg font-black text-xs" style={{ color: themeColors.secondary }}>
              <img src={publicAsset('SVG/kraft.svg')} alt="Panier" className="w-4 h-4 object-contain" /> 
              {cartItemCount}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 bg-gray-50/50 custom-scrollbar">
            {cartState.items.map((item: any, index: number) => {
              const itemKey = item.customKey || item.cartKey || item.id || String(item.product?.id);
              const optionGroups = getFormattedOrderOptions(item, optionGroupMapping);

              return (
                <div 
                  key={`${itemKey}-${index}`} 
                  className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm relative overflow-hidden cursor-pointer select-none"
                  onClick={() => {
                    const now = Date.now();
                    if (lastClickRef.current.id === itemKey && now - lastClickRef.current.time < 300) {
                      const rawId = item.product?.original_product_id ?? item.product?.id ?? item.id;
                      const realId = extractRealProductId(rawId);
                      const baseProduct = menuData.find(p => String(p.id) === String(realId)) || item.product || item;
                      
                      const rawSelections = item.rawSelections || item.product?.rawSelections || null;
                      const flatOptions = item.selectedSubOptions || item.product?.selectedSubOptions || item.options || item.product?.options || [];
                      const removedIngredients = item.removedIngredients || item.product?.removedIngredients || [];

                      const fullProduct = {
                        ...baseProduct,
                        ...(item.product || {}),
                        id: realId,
                        original_product_id: realId,
                        name: item.product?.name || item.name || baseProduct.name,
                        price: item.product?.price !== undefined ? item.product.price : baseProduct.price,
                        variantId: item.product?.variantId ?? item.product?.variant_id ?? item.variantId,
                        variant_id: item.product?.variant_id ?? item.product?.variantId ?? item.variant_id,
                        variantName: item.product?.variantName || item.variantName,
                        isSolo: item.isSolo === true || item.product?.isSolo === true,
                        rawSelections,
                        selectedSubOptions: flatOptions,
                        removedIngredients,
                        options: flatOptions
                      };
                      
                      setEditingItemKey(itemKey);
                      setSelectedProduct(fullProduct);
                      setInitialSelections(rawSelections || flatOptions || null);
                      
                      setIsOptionsModalOpen(true);
                      lastClickRef.current = { id: '', time: 0 };
                    } else {
                      lastClickRef.current = { id: itemKey, time: now };
                    }
                  }}
                >
                  <div className="flex justify-between items-start gap-1">
                    <div className="flex-1 min-w-0 pr-1">
                      <h4 className="font-bold text-gray-800 text-[11px] leading-tight line-clamp-2">{item.product?.name || item.name}</h4>
                      
                      {optionGroups.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-[9px]">
                          {optionGroups.map((grp, gIdx) => (
                            <div key={gIdx} className="flex flex-wrap items-baseline gap-0.5 leading-tight">
                              {grp.groupName ? (
                                <span className="font-bold text-slate-500 uppercase text-[8px] tracking-wider">
                                  {grp.groupName} :
                                </span>
                              ) : null}
                              {grp.items.map((opt, oIdx) => (
                                <span key={oIdx} className="inline">
                                  <span className={opt.isSans ? "text-red-500 font-bold" : "text-gray-600 font-medium"}>
                                    {opt.qty > 1 ? `${opt.qty}x ` : ''}{opt.name}
                                  </span>
                                  {opt.price > 0 && <span className="text-gray-400"> (+{opt.price.toFixed(2)}€)</span>}
                                  {oIdx < grp.items.length - 1 ? ', ' : ''}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                    </div>
                    <div className="font-black text-[12px] whitespace-nowrap" style={{ color: themeColors.secondary }}>{getItemTotal(item, optionGroupMapping).toFixed(2)}€</div>
                  </div>
                  
                  <div className="mt-1.5 flex items-center justify-between">
                    <button onClick={(e) => { e.stopPropagation(); removeTicketLine(itemKey); }} className="p-1 text-red-500 hover:bg-red-50 rounded-md transition-colors cursor-pointer"><Trash2 size={14} /></button>
                    {/* Récompense fidélité : quantité figée (un « + » offrirait un produit sans points) */}
                    {(item.isReward === true || item.is_reward === true || item.product?.isReward === true) ? (
                      <span className="px-2 text-xs font-bold text-gray-500 tabular-nums">×{item.quantity || 1}</span>
                    ) : (
                    <div className="flex items-center gap-1.5 bg-gray-100 rounded-full px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                      <button className="w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-xs cursor-pointer" onClick={() => updateQuantity(itemKey, (item.quantity || 1) - 1)}>-</button>
                      <span className="w-4 text-center font-bold text-xs">{item.quantity || 1}</span>
                      <button className="w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm font-bold text-xs cursor-pointer" style={{ color: themeColors.primary }} onClick={() => updateQuantity(itemKey, (item.quantity || 1) + 1)}>+</button>
                    </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t-2 border-gray-200 bg-white flex-shrink-0">
            {orderType === 'LIVRAISON' && (
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 font-bold text-xs uppercase tracking-wider">Frais Livraison</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={deliveryFee || ''}
                    onChange={e => setDeliveryFee(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-16 text-right font-black text-secondary bg-gray-100 border border-gray-200 rounded px-2 py-1 focus:bg-white focus:border-primary outline-none transition-colors"
                  />
                  <span className="text-gray-400 font-bold text-xs">€</span>
                </div>
              </div>
            )}

            {/* Commentaire du ticket : vrai cadre d'écriture, sans texte à l'intérieur */}
            <div
              className="relative mb-3 rounded-xl border-2 bg-white transition-colors focus-within:shadow-sm"
              style={{ borderColor: ticketComment ? themeColors.primary : '#D1D5DB' }}
            >
              <MessageSquare
                size={16}
                className="pointer-events-none absolute left-2.5 top-2.5 text-gray-300"
                style={{ color: ticketComment ? themeColors.primary : undefined }}
              />
              <textarea
                value={ticketComment}
                onChange={e => setTicketComment(e.target.value)}
                maxLength={200}
                rows={3}
                aria-label="Commentaire de la commande"
                className="block w-full resize-none bg-transparent pl-9 pr-9 py-2 text-sm font-semibold leading-snug text-gray-800 outline-none"
                style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
              />
              {ticketComment && (
                <button type="button" onClick={() => setTicketComment('')} aria-label="Effacer le commentaire" className="absolute right-1 top-1 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="flex justify-between items-end mb-3">
              <span className="text-gray-400 font-bold text-xs uppercase tracking-wider">Total</span>
              <span className="text-2xl font-black whitespace-nowrap" style={{ color: themeColors.secondary }}>{finalTotal.toFixed(2)} €</span>
            </div>
            
            <div className="flex gap-2">
              <button 
                disabled={cartItemCount === 0 || isProcessing || isSubmittingRef.current} 
                onClick={processPendingOrder} 
                className="w-16 bg-orange-50 text-orange-500 flex items-center justify-center rounded-xl hover:bg-orange-100 active:scale-95 disabled:opacity-50 transition-all border border-orange-100 cursor-pointer" 
                title="Mettre en attente de paiement (Impression Cuisine uniquement)"
              >
                <Hourglass size={24} />
              </button>

              <button 
                disabled={cartItemCount === 0 || isProcessing || isSubmittingRef.current} 
                onClick={() => setIsPaymentModalOpen(true)} 
                className="flex-1 text-white font-black text-xl py-3 rounded-xl shadow-md active:scale-95 disabled:opacity-50 transition-transform uppercase tracking-wider cursor-pointer" 
                style={{ backgroundColor: themeColors.primary }}
              >
                PAYER
              </button>

              <button 
                disabled={!hasActiveOrderData || isProcessing || isSubmittingRef.current} 
                onClick={() => setShowClearConfirm(true)} 
                className="w-16 bg-red-50 text-red-500 flex items-center justify-center rounded-xl hover:bg-red-100 active:scale-95 disabled:opacity-50 transition-all border border-red-100 cursor-pointer"
                title="Réinitialiser la commande"
              >
                <Trash2 size={24} />
              </button>
            </div>
          </div>
        </div>

        <div className="w-[74px] flex flex-col items-center py-3 z-40 shadow-[-5px_0_15px_rgba(0,0,0,0.2)] flex-shrink-0 justify-between" style={{ backgroundColor: themeColors.secondary }}>
          <div className="flex flex-col gap-1.5 w-full px-2 items-center">
            
            <button onClick={() => setIsDashboardOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><LayoutDashboard size={24} /></button>
            <button
              onClick={() => setIsOrderTrackerOpen(true)}
              className={`${rightBarBtnClass} relative`}
              style={{ color: themeColors.primary }}
              title={pendingPaymentCount > 0 ? `${pendingPaymentCount} commande${pendingPaymentCount > 1 ? 's' : ''} en attente de paiement` : 'Suivi des commandes'}
            >
              <ClipboardList size={24} />
              <AnimatePresence>
                {pendingPaymentCount > 0 && (
                  <motion.span
                    key="pending-badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center"
                  >
                    {/* Quelques pulsations à chaque nouveau montant, puis l'animation s'arrête (pas d'animation 24h/24) */}
                    <span key={`ping-${pendingPaymentCount}`} className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" style={{ animationIterationCount: 4 }} />
                    <motion.span
                      key={pendingPaymentCount}
                      initial={{ scale: 1.5 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 15 }}
                      className="relative flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-[12px] font-black leading-none text-white shadow-md ring-2 ring-white"
                    >
                      {pendingPaymentCount > 99 ? '99+' : pendingPaymentCount}
                    </motion.span>
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            <button onClick={() => setIsHistoryOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><History size={24} /></button>
            <button onClick={() => openCashDrawer(false)} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Ouvrir le tiroir caisse"><ArchiveRestore size={24} /></button>
            
            <button onClick={() => setIsCashSessionModalOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Gestion Caisse (Ticket X/Z)"><Calculator size={24} /></button>
            
            <button onClick={() => setIsStockOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Gérer les stocks"><Package size={24} /></button>
            <button onClick={() => setIsSettingsOpen(true)} className={rightBarBtnClass} style={{ color: themeColors.primary }}><Settings size={24} /></button>
          </div>
          
          <div className="w-full px-2 pb-1 flex flex-col items-center gap-1.5">
            {/* Paiement carte en un geste : tout le montant en « Carte bancaire » */}
            <button
              disabled={cartItemCount === 0 || isProcessing || isSubmittingRef.current}
              onClick={() => payWithTerminal('Carte bancaire', 0)}
              className="w-[56px] h-[56px] mx-auto flex items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:scale-95 disabled:bg-gray-700/50 disabled:text-gray-500 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="Paiement carte (montant total)"
              aria-label="Paiement carte"
            >
              <TapToPayIcon className="h-6 text-current" />
            </button>
            <button onClick={() => { if (hasActiveOrderData) { setShowLogoutConfirm(true); } else { setIsAuthenticated(false); } }} className={rightBarBtnClass} style={{ color: themeColors.primary }} title="Verrouiller la caisse"><Lock size={24} className="text-red-400" /></button>
          </div>
        </div>

      </div>

      {isDeliveryModalOpen && (
        <DeliveryModalCaisse 
          isOpen={isDeliveryModalOpen}
          onClose={handleDeliveryModalClose}
          onConfirm={handleClientConfirm}
          onReorder={handleReorderPastOrder}
          initialData={clientInfo} 
        />
      )}

      {soloPayment && (
        <SumUpSoloPayment
          reader={soloPayment.reader}
          amountCents={soloPayment.amountCents}
          description="Caisse"
          onDone={soloPayment.resolve}
        />
      )}

      <AnimatePresence>
        {isPaymentModalOpen && (
          <PaymentModal subtotal={finalTotal} deliveryFee={activeDeliveryFee} themeColors={themeColors} onClose={() => setIsPaymentModalOpen(false)} onConfirm={payWithTerminal} onOffer={(d: any) => finalizePayment('', 0, d)} isProcessing={isProcessing} />
        )}
      </AnimatePresence>

      {isCashSessionModalOpen && (
        <CashSessionModal 
          restaurantId={posRestoId}
          onClose={(isSuccess?: boolean) => {
            if (!currentSessionId && isSuccess !== true) {
              customToast("Attention : Caisse non ouverte !", "error");
            }
            setIsCashSessionModalOpen(false);
          }} 
          currentSessionId={currentSessionId}
          onSessionOpened={(id: string) => {
            setCurrentSessionId(id);
            setIsCashSessionModalOpen(false);
          }}
          onSessionClosed={() => {
            setCurrentSessionId(null);
            setIsCashSessionModalOpen(false);
          }}
          themeColors={themeColors}
        />
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-red-100 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6"><Trash2 size={40} /></div>
            <h3 className="text-2xl font-black text-secondary uppercase tracking-wide mb-2">Annuler la commande ?</h3>
            <p className="text-gray-500 font-bold mb-8">Toutes les informations en cours (client, articles) seront réinitialisées.</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition-all cursor-pointer">Retour</button>
              <button onClick={() => { clearCart(); setLoadedOrderId(null); setDeliveryFee(0); setClientInfo(null); clientInfoRef.current = null; setOrderType(getDefaultOrderType()); setShowClearConfirm(false); }} className="flex-1 py-4 bg-red-500 text-white rounded-xl font-black uppercase tracking-wider hover:bg-red-600 active:scale-95 transition-all cursor-pointer">Oui, Annuler</button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[999999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-2 border-red-100 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6"><AlertTriangle size={40} /></div>
            <h3 className="text-2xl font-black text-secondary uppercase tracking-wide mb-2">Commande en cours</h3>
            <p className="text-gray-500 font-bold mb-8">Attention, une commande ou un client est en cours. Voulez-vous l'annuler et quitter ?</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setShowLogoutConfirm(false)} className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-wider hover:bg-gray-200 active:scale-95 transition-all cursor-pointer">Rester</button>
              <button onClick={() => { clearCart(); setIsAuthenticated(false); setDeliveryFee(0); setClientInfo(null); clientInfoRef.current = null; setOrderType(getDefaultOrderType()); setShowLogoutConfirm(false); navigate('/'); }} className="flex-1 py-4 bg-red-500 text-white rounded-xl font-black uppercase tracking-wider hover:bg-red-600 active:scale-95 transition-all leading-tight cursor-pointer">Quitter et annuler</button>
            </div>
          </div>
        </div>
      )}

      {isOptionsModalOpen && selectedProduct && (
        <OptionsModal 
          product={selectedProduct} 
          initialSelections={initialSelections}
          onClose={() => { 
            setIsOptionsModalOpen(false); 
            setSelectedProduct(null); 
            setEditingItemKey(null); 
            setInitialSelections(null); 
          }} 
          onAddToCart={(p, s) => handleAddToCartFromModal(p, s)} 
        />
      )}

      {isVariantsModalOpen && selectedProductForVariants && (
        <ProductVariantsModal 
          product={selectedProductForVariants as any} 
          isOpen={isVariantsModalOpen} 
          onClose={() => { setIsVariantsModalOpen(false); setSelectedProductForVariants(null); }} 
          onSelectVariant={async (v: any) => { 
            const rawVariantName = v.variant_name || v.name || '';
            const cleanVariantName = rawVariantName.replace(/\s*pi[èe]ces?/gi, '').trim();
            const finalName = cleanVariantName ? `${selectedProductForVariants.name} (${cleanVariantName})` : selectedProductForVariants.name;
            const baseProductId = selectedProductForVariants.id;
            const variantProductId = `${baseProductId}-var_${v.id}`;
            const variantPrice = v.price || v.price_supplement || selectedProductForVariants.price;

            const variantProduct: Product = { 
              ...selectedProductForVariants, 
              id: variantProductId,
              original_product_id: baseProductId,
              variantId: v.id,
              variant_id: v.id,
              variantName: cleanVariantName,
              price: variantPrice, 
              name: finalName 
            };

            setSelectedProductForVariants(null); 
            setIsVariantsModalOpen(false); 

            try {
              const hasOptions = await checkHasCustomization(baseProductId);
              if (hasOptions) {
                setSelectedProduct(variantProduct); 
                setInitialSelections(null);
                setIsOptionsModalOpen(true); 
              } else {
                const uniqueKey = `${variantProductId}-no-opts`;
                addToCart({ 
                  id: uniqueKey, 
                  product: variantProduct, 
                  quantity: 1, 
                  cartKey: uniqueKey, 
                  customKey: uniqueKey 
                } as any);
              }
            } catch (err) {
              setSelectedProduct(variantProduct); 
              setInitialSelections(null);
              setIsOptionsModalOpen(true); 
            }
          }} 
          directSubOptions={[]} 
        />
      )}

      <React.Suspense fallback={null}>
      {isDashboardOpen && <OrdersDashboardModal onClose={() => setIsDashboardOpen(false)} />}
      {isOrderTrackerOpen && <OrderTrackerModal onClose={() => setIsOrderTrackerOpen(false)} onLoadOrder={handleLoadOrderIntoCart} />}
      {isHistoryOpen && <OrderHistoryModal onClose={() => setIsHistoryOpen(false)} />}
      {isStockOpen && (
        <StockModal 
          onClose={() => {
            setIsStockOpen(false);
            const activeRestoId = getActiveRestaurantId() || RESTAURANT_ID;
            if (activeRestoId) loadMenuData(activeRestoId);
          }} 
        />
      )}
      {isSettingsOpen && (
        <SettingsModal 
          onClose={() => setIsSettingsOpen(false)} 
          currentCategories={categories.map(c => c.name)}
        />
      )}
      </React.Suspense>

    </div>
  );
};

export default Caisse;