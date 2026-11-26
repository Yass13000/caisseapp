// Contrôle des droits : si l'utilisateur connecté n'a pas le droit, une fenêtre demande
// le code d'un profil qui l'a (ou le code d'accès Standard) pour autoriser UNE fois.
// Sans profil connecté / profil Standard : accès direct, comme avant.
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Delete, ShieldAlert, X } from 'lucide-react';
import { getActiveRestaurantId } from '@/lib/supabaseClient';
import {
  can, getCurrentUser, getMasterPin, logAction, loginStaffOnline, permissionLabel, resolvePin,
  type CurrentUser, type PermissionKey,
} from '@/lib/staff';

interface Request {
  perm: PermissionKey;
  resolve: (ok: boolean) => void;
}

let pending: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Dernière autorisation donnée par un responsable (pour la traçabilité). */
let lastApproval: { perm: PermissionKey; by: CurrentUser; at: number } | null = null;
export const getLastApproval = () => lastApproval;

/**
 * true si l'utilisateur connecté a le droit, ou si un responsable a tapé son code.
 * false si la fenêtre est fermée sans autorisation.
 */
export const requirePermission = (perm: PermissionKey): Promise<boolean> => {
  if (can(perm)) return Promise.resolve(true);
  if (pending) pending.resolve(false);
  return new Promise<boolean>(resolve => {
    pending = { perm, resolve };
    emit();
  });
};

const finish = (ok: boolean) => {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(ok);
};

const PermissionGate: React.FC = () => {
  const req = useSyncExternalStore(subscribe, () => pending, () => pending);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => { setPin(''); setError(false); }, [req]);

  useEffect(() => {
    if (!req || pin.length !== 4) return;
    let cancelled = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const restaurantId = getActiveRestaurantId();
      // Sans réseau d'abord (code d'accès, profils déjà connectés ici), puis vérification serveur
      let user = resolvePin(pin, getMasterPin(), restaurantId);
      if (!user && navigator.onLine) {
        const res = await Promise.race([
          loginStaffOnline(pin, restaurantId),
          new Promise<{ user: null }>(r => setTimeout(() => r({ user: null }), 3000)),
        ]);
        user = res.user;
      }
      if (cancelled) return;
      if (user && (user.isStandard || user.permissions?.[req.perm] === true)) {
        lastApproval = { perm: req.perm, by: user, at: Date.now() };
        logAction('autorisation', { details: { droit: permissionLabel(req.perm) }, approvedBy: user });
        finish(true);
      } else {
        setError(true);
        resetTimer = setTimeout(() => { setPin(''); setError(false); }, 500);
      }
    })();
    return () => { cancelled = true; if (resetTimer) clearTimeout(resetTimer); };
  }, [pin, req]);

  if (!req) return null;
  const me = getCurrentUser();
  const btn = "w-16 h-16 bg-white hover:bg-gray-100 rounded-2xl text-secondary font-black text-2xl active:scale-90 transition-all shadow-sm border border-gray-100 flex items-center justify-center cursor-pointer";
  const press = (d: string) => setPin(p => (p.length < 4 ? p + d : p));

  return createPortal(
    <div className="fixed inset-0 z-[9999999] bg-black/50 backdrop-blur-sm flex items-center justify-center font-helvetica select-none" onClick={() => finish(false)}>
      <div className="relative bg-white p-6 rounded-[2rem] shadow-2xl flex flex-col items-center w-[320px]" onClick={e => e.stopPropagation()}>
        <button onClick={() => finish(false)} className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 cursor-pointer" aria-label="Annuler"><X size={20} /></button>
        <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mb-3"><ShieldAlert size={28} /></div>
        <h2 className="text-secondary text-lg font-black uppercase tracking-wider text-center">Code d'un responsable</h2>
        <p className="text-gray-500 font-bold text-xs text-center mt-1 mb-5">
          {me?.name ? `${me.name} n'a pas le droit « ${permissionLabel(req.perm)} ».` : `Droit requis : « ${permissionLabel(req.perm)} ».`}
          <br />Un profil autorisé tape son code pour valider une fois.
        </p>
        <div className="flex gap-3 mb-5">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all ${error ? 'bg-red-500' : pin.length > i ? 'bg-primary scale-125' : 'bg-gray-200'}`} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <button key={n} onClick={() => press(String(n))} className={btn}>{n}</button>)}
          <button onClick={() => finish(false)} className="w-16 h-16 rounded-2xl text-gray-400 font-black text-xs uppercase hover:bg-gray-100 cursor-pointer">Annuler</button>
          <button onClick={() => press('0')} className={btn}>0</button>
          <button onClick={() => setPin(p => p.slice(0, -1))} className="w-16 h-16 bg-red-50 hover:bg-red-100 text-red-500 rounded-2xl flex items-center justify-center active:scale-90 cursor-pointer" aria-label="Effacer"><Delete size={24} /></button>
        </div>
        {error && <div className="mt-4 text-sm font-black text-red-500">Code refusé</div>}
      </div>
    </div>,
    document.body
  );
};

export default PermissionGate;
