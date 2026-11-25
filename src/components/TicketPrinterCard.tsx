// Réglage imprimante ticket simplifié — même système et même interface que la borne.
// Par défaut : AUTOMATIQUE — la caisse trouve seule l'imprimante ticket branchée (USB ou réseau).
// On peut quand même en forcer une ; si elle est débranchée, la caisse reprend l'automatique.
// Une carte par rôle : ticket client, bon cuisine, rapports Z/X, livraison.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Check, Printer, X } from 'lucide-react';
import { toast } from 'sonner';
import { ensureAndroidPrinting } from '@/lib/androidPrinting';

type RankedPrinter = {
  name: string;
  isDefault?: boolean;
  port?: string;
  driver?: string;
  score?: number;
  virtual?: boolean;
};

type PrinterAuto = {
  selected: string;
  reason: 'choisie' | 'automatique' | 'remplacement' | 'aucune';
  auto?: string;
  printers: RankedPrinter[];
  lastPrint: { at: string | null; ok: boolean | null; printer: string; error: string; label: string };
  appVersion?: string;
  errors?: string[];
};

type PrintResult = { success: boolean; error?: string };

// Caisse Android (APK ≥ 1.4.0) : module d'impression installé dans window.electronAPI
const api = () => {
  ensureAndroidPrinting();
  const w = (window as any).electronAPI;
  return typeof w?.printerAuto === 'function' ? w : null;
};

export const hasAutoPrinter = () => {
  try {
    return !!api();
  } catch {
    return false;
  }
};

/** Filet de sécurité : si une carte plante, les réglages reviennent à l'ancienne liste au lieu de se bloquer */
export class PrinterCardsBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.warn('Réglages imprimantes (cartes) indisponibles, retour à la liste classique :', err);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Une recherche lancée depuis une carte met à jour les autres
const UPDATED_EVENT = 'caisse-printers-updated';

const portLabel = (port = '') => {
  if (/^usb/i.test(port)) return 'USB';
  if (/^com/i.test(port)) return 'Série';
  if (/^(ip_|tcp|wsd|\d)/i.test(port)) return 'Réseau';
  return port ? port : '';
};

const timeLabel = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

interface Props {
  /** Ex. « Imprimante ticket client » */
  title: string;
  /** caisse | cuisine | rapports | livraison */
  role: string;
  savedName: string;
  onSave: (name: string) => Promise<void> | void;
  /** Ce que fait l'automatique pour ce rôle, ex. « même que le ticket client » */
  autoHint?: string;
  /** Ticket de test du rôle (sinon un petit ticket « TEST CAISSE ») */
  onTest?: (target: string) => Promise<PrintResult>;
}

const TicketPrinterCard: React.FC<Props> = ({ title, role, savedName, onSave, autoHint, onTest }) => {
  const [info, setInfo] = useState<PrinterAuto | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<'' | 'html' | 'raw'>('');
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(savedName);
  const [manual, setManual] = useState('');

  const refresh = useCallback(async (force = false) => {
    const a = api();
    if (!a) return;
    setLoading(true);
    try {
      setInfo(await a.printerAuto(savedName, force, role));
      if (force) window.dispatchEvent(new Event(UPDATED_EVENT));
    } catch (err) {
      console.warn('Détection imprimante impossible :', err);
    } finally {
      setLoading(false);
    }
  }, [savedName, role]);

  useEffect(() => { refresh(false); }, [refresh]);

  useEffect(() => {
    const onUpdated = () => { refresh(false); };
    window.addEventListener(UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(UPDATED_EVENT, onUpdated);
  }, [refresh]);

  const test = async (mode: 'html' | 'raw', target = savedName) => {
    setTesting(mode);
    try {
      const res: PrintResult = mode === 'html' && onTest ? await onTest(target) : await api().printTest(target, mode, role);
      if (res?.success) toast.success('Ticket de test envoyé');
      else toast.error(`Le test n'a pas imprimé : ${res?.error || 'erreur inconnue'}`, { duration: 10000 });
    } catch (err: any) {
      toast.error(`Erreur d'impression : ${err?.message || err}`);
    } finally {
      setTesting('');
      refresh(false);
    }
  };

  const save = async () => {
    const name = (manual.trim() || choice).trim();
    await onSave(name);
    setOpen(false);
    setManual('');
    toast.success(name ? `Imprimante « ${name} » choisie` : 'Imprimante automatique activée');
  };

  const selected = info?.selected || '';
  const selectedInfo = info?.printers.find((p) => p.name === selected);
  const last = info?.lastPrint;

  let statusText = 'Recherche de l’imprimante…';
  let statusColor = 'bg-zinc-300';
  if (info) {
    if (!selected) {
      statusText = info.errors?.length
        ? `Recherche en échec : ${info.errors[0]}`
        : 'Aucune imprimante ticket trouvée : branchez-la puis « Actualiser »';
      statusColor = 'bg-rose-500';
    } else if (last?.ok === false && last.printer === selected) {
      statusText = `Dernière impression échouée à ${timeLabel(last.at)} : ${last.error || 'erreur'}`;
      statusColor = 'bg-rose-500';
    } else if (info.reason === 'remplacement') {
      statusText = `« ${savedName} » est introuvable : la caisse imprime sur « ${selected} »`;
      statusColor = 'bg-amber-400';
    } else {
      statusText = last?.ok && last.printer === selected ? `Prête · dernier ticket imprimé à ${timeLabel(last.at)}` : 'Prête';
      statusColor = 'bg-emerald-500';
    }
  }

  const realPrinters = (info?.printers || []).filter((p) => !p.virtual);
  const recommended = info?.auto || realPrinters.find((p) => (p.score || 0) > 0)?.name;

  return (
    <>
      <div className="px-5 py-4 border-b border-zinc-100 last:border-b-0">
        <div className="flex items-start gap-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-zinc-800 text-white">
            <Printer className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-zinc-900">{title}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${savedName ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-100 text-emerald-700'}`}>
                {savedName ? 'Choisie' : 'Automatique'}
              </span>
            </div>
            <div className="text-sm font-mono text-zinc-700 truncate mt-0.5">
              {selected || '—'}
              {selectedInfo?.port ? <span className="text-zinc-400"> · {portLabel(selectedInfo.port)}</span> : null}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor}`} />
              <span className="text-xs text-zinc-500">{statusText}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <button
            type="button"
            onClick={() => test('html')}
            disabled={testing !== '' || !selected}
            className="py-3 text-sm font-bold text-white bg-zinc-900 hover:bg-black rounded-xl disabled:opacity-40 cursor-pointer"
          >
            {testing === 'html' ? 'Impression…' : 'Imprimer un test'}
          </button>
          <button
            type="button"
            onClick={() => { setChoice(savedName); setManual(''); setOpen(true); refresh(true); }}
            className="py-3 text-sm font-bold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-xl cursor-pointer"
          >
            Changer
          </button>
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={loading}
            className="py-3 text-sm font-bold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        </div>
      </div>

      {open && createPortal(
        <div className="fixed inset-0 z-[100001] bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-zinc-900">{title}</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-full hover:bg-zinc-100 cursor-pointer" aria-label="Fermer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => { setChoice(''); setManual(''); }}
                className={`w-full text-left p-4 rounded-2xl border-2 cursor-pointer ${choice === '' && !manual ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900">Automatique (conseillé)</span>
                  {choice === '' && !manual && <Check className="w-5 h-5" />}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {autoHint ? `${autoHint.charAt(0).toUpperCase()}${autoHint.slice(1)}, sinon la caisse choisit seule l’imprimante ticket branchée` : 'La caisse choisit seule l’imprimante ticket branchée'}
                  {recommended ? ` (actuellement : ${recommended})` : ''}.
                </div>
              </button>

              {realPrinters.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => { setChoice(p.name); setManual(''); }}
                  className={`w-full text-left p-4 rounded-2xl border-2 cursor-pointer ${choice === p.name && !manual ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-zinc-900 truncate">{p.name}</span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {p.name === recommended && <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Ticket</span>}
                      {choice === p.name && !manual && <Check className="w-5 h-5" />}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 truncate">
                    {[portLabel(p.port), p.driver, p.isDefault ? 'par défaut' : ''].filter(Boolean).join(' · ')}
                  </div>
                </button>
              ))}

              {loading && realPrinters.length === 0 && (
                <div className="p-4 rounded-2xl bg-zinc-50 text-zinc-600 text-sm flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Recherche USB et réseau…
                </div>
              )}

              {info && !loading && realPrinters.length === 0 && (
                <div className="p-4 rounded-2xl bg-rose-50 text-rose-700 text-sm">
                  Aucune imprimante trouvée. Branchez l’imprimante en USB (ou sur le même réseau que la tablette), allumez-la puis touchez « Actualiser ».
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-5">
              <button type="button" onClick={() => setOpen(false)} className="py-3.5 font-bold text-zinc-700 bg-zinc-100 rounded-xl cursor-pointer">Annuler</button>
              <button type="button" onClick={save} className="py-3.5 font-bold text-white bg-zinc-900 rounded-xl cursor-pointer">Enregistrer</button>
            </div>

            <details className="mt-5 text-xs text-zinc-500">
              <summary className="cursor-pointer font-semibold">Avancé (dépannage)</summary>
              <div className="mt-3 space-y-3">
                <input
                  type="text"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Nom exact ou adresse IP (ex. 192.168.1.50) si absente de la liste"
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl font-mono text-sm text-zinc-800 outline-none focus:border-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => test('raw', manual.trim() || choice || selected)}
                  disabled={testing !== '' || !(manual.trim() || choice || selected)}
                  className="w-full py-2.5 font-bold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {testing === 'raw' ? 'Impression…' : 'Test texte brut (ESC/POS)'}
                </button>
                <div className="font-mono break-all space-y-1 bg-zinc-50 border border-zinc-200 rounded-xl p-2.5">
                  <div>Application caisse {info?.appVersion || '?'}</div>
                  {(info?.printers || []).map((p) => (
                    <div key={p.name}>• {p.name}{p.isDefault ? ' (défaut)' : ''} — {p.port || '?'} — {p.driver || '?'}{p.virtual ? ' — virtuelle' : ''}</div>
                  ))}
                  {last?.at && <div>Dernière impression : {last.label} · {timeLabel(last.at)} · {last.ok ? 'OK' : `échec : ${last.error}`}</div>}
                  {(info?.errors || []).map((e, i) => <div key={i} className="text-rose-600">⚠ {e}</div>)}
                </div>
              </div>
            </details>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default TicketPrinterCard;
