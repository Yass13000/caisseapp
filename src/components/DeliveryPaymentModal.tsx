import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, CreditCard, Banknote, Check, Delete, Wallet } from 'lucide-react';

// Livraison : le client paie AU LIVREUR. Rien ne part sur le TPE de la caisse.
// On note seulement le mode prévu (CB ou espèces) et, en espèces, avec quel billet le client paie,
// pour que le livreur parte avec la bonne monnaie.

export type DeliveryPayChoice = { method: 'CB' | 'Espèces'; cashGiven: number };

interface Props {
  total: number;
  themeColors: { primary: string; secondary: string };
  isProcessing?: boolean;
  onClose: () => void;
  onConfirm: (choice: DeliveryPayChoice) => void;
  /** Le client a déjà payé (ou paie maintenant au comptoir) : encaissement normal */
  onPayNow: () => void;
}

const eur = (v: number) => `${v.toFixed(2).replace('.', ',')} €`;

export const DeliveryPaymentModal: React.FC<Props> = ({ total, themeColors, isProcessing, onClose, onConfirm, onPayNow }) => {
  const [method, setMethod] = useState<'CB' | 'Espèces' | null>(null);
  const [cashGiven, setCashGiven] = useState<number>(0); // 0 = montant exact
  const [typed, setTyped] = useState<string>('');

  // Billets proposés : uniquement ceux qui couvrent le total
  const quickNotes = useMemo(() => {
    const roundUp = Math.ceil(total / 10) * 10;
    const list = [roundUp, 20, 50, 100].filter((n) => n > total + 0.001);
    return Array.from(new Set(list)).sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  const typedValue = typed ? parseFloat(typed.replace(',', '.')) || 0 : 0;
  const given = typed ? typedValue : cashGiven;
  const change = given > 0 ? Math.max(0, given - total) : 0;
  const notEnough = method === 'Espèces' && given > 0 && given + 0.001 < total;

  const press = (k: string) => {
    setCashGiven(0);
    setTyped((prev) => {
      if (k === 'del') return prev.slice(0, -1);
      if (k === ',') return prev.includes(',') ? prev : (prev || '0') + ',';
      const [, dec] = prev.split(',');
      if (dec !== undefined && dec.length >= 2) return prev;
      if (prev.replace(',', '').length >= 6) return prev;
      return prev === '0' ? k : prev + k;
    });
  };

  const confirm = () => {
    if (!method || isProcessing || notEnough) return;
    onConfirm({ method, cashGiven: method === 'Espèces' ? given : 0 });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 font-helvetica select-none" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-[560px] max-w-[95vw] rounded-[1.5rem] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight" style={{ color: themeColors.secondary }}>Paiement à la livraison</h2>
            <p className="text-sm font-bold text-gray-400">Le client paie au livreur — rien ne part sur le TPE</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="w-10 h-10 bg-gray-100 text-gray-500 rounded-xl flex items-center justify-center hover:bg-gray-200 active:scale-90 transition">
            <X size={22} />
          </button>
        </div>

        <div className="px-6 pb-2 flex items-baseline justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-gray-400">À encaisser</span>
          <span className="text-3xl font-black" style={{ color: themeColors.secondary }}>{eur(total)}</span>
        </div>

        {/* Mode prévu */}
        <div className="px-6 pt-2 grid grid-cols-2 gap-3">
          {([
            { key: 'CB', label: 'CB', sub: 'TPE du livreur', Icon: CreditCard },
            { key: 'Espèces', label: 'Espèces', sub: 'Préparer la monnaie', Icon: Banknote },
          ] as const).map(({ key, label, sub, Icon }) => {
            const active = method === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setMethod(key)}
                className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition active:scale-[0.98] ${active ? 'shadow-md' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'}`}
                style={active ? { borderColor: themeColors.primary, backgroundColor: `${themeColors.primary}14` } : undefined}
              >
                <span className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: active ? themeColors.primary : '#9CA3AF' }}>
                  <Icon size={26} />
                </span>
                <span className="flex flex-col">
                  <span className="text-lg font-black" style={{ color: themeColors.secondary }}>{label}</span>
                  <span className="text-xs font-bold text-gray-400">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Espèces : avec quoi le client paie */}
        {method === 'Espèces' && (
          <div className="px-6 pt-4">
            <div className="text-xs font-black uppercase tracking-wider text-gray-400 mb-2">Le client paie avec</div>
            <div className="grid grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => { setCashGiven(0); setTyped(''); }}
                className={`rounded-xl py-3 text-sm font-black transition active:scale-95 ${given === 0 ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                style={given === 0 ? { backgroundColor: themeColors.secondary } : undefined}
              >
                Exact
              </button>
              {quickNotes.map((n) => {
                const active = !typed && cashGiven === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { setTyped(''); setCashGiven(n); }}
                    className={`rounded-xl py-3 text-base font-black transition active:scale-95 ${active ? 'text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    style={active ? { backgroundColor: themeColors.secondary } : undefined}
                  >
                    {n} €
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 items-stretch">
              <div className="grid grid-cols-6 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ',', 'del'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => press(k)}
                    className="h-11 rounded-lg bg-gray-100 text-gray-800 font-black text-lg flex items-center justify-center hover:bg-gray-200 active:scale-95 transition"
                    aria-label={k === 'del' ? 'Effacer' : k}
                  >
                    {k === 'del' ? <Delete size={18} /> : k}
                  </button>
                ))}
              </div>
              <div className={`w-44 rounded-2xl px-4 py-2 flex flex-col justify-center ${notEnough ? 'bg-red-50' : 'bg-emerald-50'}`}>
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Autre montant</span>
                <span className="text-lg font-black text-gray-800">{typed ? `${typed} €` : given > 0 ? eur(given) : 'Exact'}</span>
                <span className={`mt-1 text-[10px] font-black uppercase tracking-wider ${notEnough ? 'text-red-500' : 'text-emerald-600'}`}>
                  {notEnough ? 'Montant insuffisant' : 'Rendre'}
                </span>
                {!notEnough && <span className="text-2xl font-black text-emerald-700 leading-none">{eur(change)}</span>}
              </div>
            </div>
          </div>
        )}

        <div className="px-6 pt-5 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onPayNow}
            className="h-14 px-4 rounded-xl bg-gray-100 text-gray-600 font-black text-xs uppercase tracking-wider flex items-center gap-2 hover:bg-gray-200 active:scale-95 transition"
            title="Le client a déjà payé : encaisser maintenant"
          >
            <Wallet size={18} /> Payé maintenant
          </button>
          <button
            type="button"
            disabled={!method || isProcessing || notEnough}
            onClick={confirm}
            className="flex-1 h-14 rounded-xl text-white font-black text-lg uppercase tracking-wider flex items-center justify-center gap-2 shadow-md active:scale-95 disabled:opacity-40 transition"
            style={{ backgroundColor: themeColors.primary }}
          >
            <Check size={22} strokeWidth={3} /> Envoyer la livraison
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default DeliveryPaymentModal;
