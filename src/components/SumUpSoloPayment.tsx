// Paiement par carte sur un TPE SumUp Solo : envoie le montant, suit le TPE, rend le résultat.
// La commande n'est marquée payée par la caisse QUE si cette fenêtre répond « ok ».
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CreditCard, Loader2, RefreshCw, WifiOff, XCircle } from 'lucide-react';
import {
  SoloError,
  getSoloStatus,
  startSoloCheckout,
  terminateSoloCheckout,
} from '@/services/sumupSolo';

export interface SoloPaymentOutcome {
  ok: boolean;
  /** Code de transaction SumUp (absent si validé à la main) */
  code?: string | null;
  manual?: boolean;
}

interface Props {
  reader: { id: string; name: string };
  amountCents: number;
  description: string;
  onDone: (outcome: SoloPaymentOutcome) => void;
}

type Phase =
  | 'sending'      // envoi du montant au TPE
  | 'waiting'      // le TPE attend le client
  | 'cancelling'   // annulation demandée
  | 'success'
  | 'declined'     // refusé / annulé : on peut réessayer
  | 'error'        // le TPE n'a pas pris le paiement
  | 'unknown';     // résultat impossible à connaître (réseau) : la caissière tranche en regardant le TPE

// Le Solo ne remonte pas toujours son écran (état vide) : on se fie au statut de la transaction SumUp.
// Le Solo abandonne seul un paiement non présenté au bout d'environ 60 s (statut FAILED).
const POLL_MS = 2000;
const MAX_WAIT_MS = 4 * 60 * 1000;       // au-delà : résultat inconnu
const NEVER_STARTED_MS = 75 * 1000;      // aucune transaction créée sur le TPE : rien n'a pu être débité
const CANCEL_GRACE_MS = 30 * 1000;       // après annulation, délai pour que SumUp donne le statut final
const LOST_CONNECTION_MS = 45 * 1000;

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const SumUpSoloPayment = ({ reader, amountCents, description, onDone }: Props) => {
  const [phase, setPhase] = useState<Phase>('sending');
  const [message, setMessage] = useState('Envoi au TPE…');
  const [detail, setDetail] = useState('');
  const [confirmManual, setConfirmManual] = useState(false);

  const runRef = useRef(0);          // chaque tentative a son numéro : une ancienne boucle s'arrête seule
  const cancelAtRef = useRef(0);
  const doneRef = useRef(false);

  const finish = useCallback((outcome: SoloPaymentOutcome) => {
    if (doneRef.current) return;
    doneRef.current = true;
    runRef.current++;
    onDone(outcome);
  }, [onDone]);

  const start = useCallback(async () => {
    const run = ++runRef.current;
    const alive = () => run === runRef.current && !doneRef.current;
    cancelAtRef.current = 0;
    setConfirmManual(false);
    setDetail('');
    setPhase('sending');
    setMessage('Envoi au TPE…');

    let txId = '';
    try {
      const reference = `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await startSoloCheckout(reader.id, amountCents, description, reference);
      txId = res.client_transaction_id;
    } catch (err) {
      if (!alive()) return;
      const e = err as SoloError;
      if (e.network) {
        // La demande est peut-être arrivée au TPE : on ne relance pas à l'aveugle
        setPhase('unknown');
        setMessage('Connexion perdue pendant l\'envoi');
        setDetail('Regardez le TPE : s\'il demande la carte, laissez le client payer puis validez. Sinon, réessayez.');
      } else {
        setPhase('error');
        setMessage('Le TPE n\'a pas pris le paiement');
        setDetail(e.message);
      }
      return;
    }
    if (!alive()) return;

    setPhase('waiting');
    setMessage('Présentez la carte sur le TPE');
    const startedAt = Date.now();
    let failingSince = 0;

    while (alive()) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!alive()) return;

      let status;
      try {
        status = await getSoloStatus(reader.id, txId);
        failingSince = 0;
      } catch {
        if (!alive()) return;
        if (!failingSince) failingSince = Date.now();
        if (Date.now() - failingSince > LOST_CONNECTION_MS) {
          setPhase('unknown');
          setMessage('Connexion perdue');
          setDetail('Impossible de lire le résultat. Regardez le TPE : s\'il affiche « Paiement accepté », validez à la main.');
          return;
        }
        setDetail('Connexion instable, nouvelle tentative…');
        continue;
      }
      if (!alive()) return;
      setDetail('');

      if (status.result === 'successful') {
        setPhase('success');
        setMessage('Paiement accepté');
        const code = status.transaction?.code || null;
        setTimeout(() => finish({ ok: true, code }), 900);
        return;
      }
      if (status.result === 'failed' || status.result === 'cancelled') {
        if (cancelAtRef.current) { finish({ ok: false }); return; }
        setPhase('declined');
        setMessage(status.result === 'failed' ? 'Paiement non abouti' : 'Paiement annulé sur le TPE');
        setDetail(status.result === 'failed' ? 'Carte refusée ou délai dépassé sur le TPE. Aucun montant n\'a été encaissé.' : 'Aucun montant n\'a été encaissé.');
        return;
      }

      // Toujours en cours : seul le statut final de SumUp fait foi
      const started = Boolean(status.transaction);
      if (cancelAtRef.current) {
        // Sans transaction sur le TPE, rien n'a été débité : annulation acquise
        if (!started && Date.now() - cancelAtRef.current > 8000) { finish({ ok: false }); return; }
        if (Date.now() - cancelAtRef.current > CANCEL_GRACE_MS) {
          setPhase('unknown');
          setMessage('Annulation non confirmée');
          setDetail('Regardez le TPE : s\'il affiche « Paiement accepté », validez à la main. Sinon, choisissez un autre moyen.');
          return;
        }
        continue;
      }

      setMessage(started ? 'Présentez la carte sur le TPE' : 'Envoi au TPE…');

      if (!started && Date.now() - startedAt > NEVER_STARTED_MS) {
        terminateSoloCheckout(reader.id).catch(() => {});
        setPhase('declined');
        setMessage('Le TPE n\'a pas démarré le paiement');
        setDetail('Aucun montant n\'a été encaissé. Vérifiez que le TPE est allumé et connecté.');
        return;
      }
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        setPhase('unknown');
        setMessage('Pas de réponse du TPE');
        setDetail('Regardez le TPE : s\'il affiche « Paiement accepté », validez à la main. Sinon, réessayez.');
        return;
      }
    }
  }, [reader.id, amountCents, description, finish]);

  useEffect(() => {
    start();
    return () => { runRef.current++; };
  }, [start]);

  const cancel = async () => {
    if (phase === 'sending') return;
    if (phase !== 'waiting') { finish({ ok: false }); return; }
    setPhase('cancelling');
    setMessage('Annulation sur le TPE…');
    cancelAtRef.current = Date.now();
    try { await terminateSoloCheckout(reader.id); } catch { /* la boucle de suivi conclut */ }
  };

  const busy = phase === 'sending' || phase === 'waiting' || phase === 'cancelling';
  const Icon = phase === 'success' ? CheckCircle2
    : phase === 'declined' || phase === 'error' ? XCircle
    : phase === 'unknown' ? WifiOff
    : CreditCard;
  const tone = phase === 'success' ? 'text-emerald-500'
    : phase === 'declined' || phase === 'error' ? 'text-red-500'
    : phase === 'unknown' ? 'text-amber-500'
    : 'text-blue-600';

  return createPortal(
    <div className="fixed inset-0 z-[9999999] bg-slate-900/80 flex items-center justify-center p-4 font-helvetica select-none" role="dialog" aria-modal="true" aria-label="Paiement par carte">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center gap-4">
          <div className={`relative h-20 w-20 rounded-full bg-slate-50 flex items-center justify-center ${tone}`}>
            <Icon className="h-10 w-10" />
            {busy && <Loader2 className="absolute -inset-1 h-[88px] w-[88px] animate-spin text-blue-600/40" strokeWidth={1.2} />}
          </div>
          <div className="text-5xl font-black text-slate-900 tabular-nums tracking-tight">{euros(amountCents)}</div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{reader.name}</div>
          <div className="text-xl font-black text-slate-800 leading-tight" aria-live="polite">{message}</div>
          {detail && <p className="text-sm font-bold text-slate-500 leading-snug">{detail}</p>}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
          {(phase === 'waiting' || phase === 'cancelling' || phase === 'sending') && (
            <button
              type="button"
              onClick={cancel}
              disabled={phase !== 'waiting'}
              className="h-14 rounded-2xl bg-white border-2 border-slate-200 text-slate-700 font-black text-lg active:scale-[0.98] transition disabled:opacity-40"
            >
              Annuler le paiement
            </button>
          )}

          {(phase === 'declined' || phase === 'error' || phase === 'unknown') && !confirmManual && (
            <>
              <button
                type="button"
                onClick={start}
                className="h-14 rounded-2xl bg-blue-600 text-white font-black text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition"
              >
                <RefreshCw className="h-5 w-5" /> Réessayer
              </button>
              <button
                type="button"
                onClick={() => finish({ ok: false })}
                className="h-14 rounded-2xl bg-white border-2 border-slate-200 text-slate-700 font-black text-lg active:scale-[0.98] transition"
              >
                Autre moyen de paiement
              </button>
              {phase === 'unknown' && (
                <button
                  type="button"
                  onClick={() => setConfirmManual(true)}
                  className="h-12 rounded-2xl text-amber-700 font-black text-sm underline underline-offset-4"
                >
                  Le TPE affiche « Paiement accepté »
                </button>
              )}
            </>
          )}

          {confirmManual && (
            <>
              <p className="px-2 pb-1 text-sm font-bold text-slate-600 text-center">
                Confirmez seulement si le TPE affiche bien « Paiement accepté » pour {euros(amountCents)}.
              </p>
              <button
                type="button"
                onClick={() => finish({ ok: true, manual: true })}
                className="h-14 rounded-2xl bg-emerald-600 text-white font-black text-lg active:scale-[0.98] transition"
              >
                Oui, paiement accepté
              </button>
              <button
                type="button"
                onClick={() => setConfirmManual(false)}
                className="h-14 rounded-2xl bg-white border-2 border-slate-200 text-slate-700 font-black text-lg active:scale-[0.98] transition"
              >
                Retour
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SumUpSoloPayment;
