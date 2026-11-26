// Réglages > Utilisateurs : profils (prénom + code + rôle + droits cochés) et profil Standard.
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, ShieldCheck, ShieldOff, Save, X, UserRound, Loader2, RotateCcw } from 'lucide-react';
import { getActiveRestaurantId } from '@/lib/supabaseClient';
import {
  PERMISSIONS, ROLE_PRESETS, type Permissions, type StaffProfile, type StaffState,
  readStaffCache, refreshStaff, saveStaff, setMasterCodeDisabled, isPinTakenByStaff, hashPin,
  fetchAuditLog, AUDIT_LABELS, type AuditEntry,
} from '@/lib/staff';

interface Props {
  /** Code d'accès de CETTE caisse (profil Standard) */
  masterPin: string;
  /** Appelé après chaque changement (la fenêtre Réglages met à jour ses onglets) */
  onChange?: () => void;
}

const OTHER_ROLE = '__autre__';
const presetFor = (role: string) => ROLE_PRESETS.find(r => r.role === role);
const countRights = (p: Permissions) => PERMISSIONS.filter(x => p?.[x.key]).length;

const pinInputClass = "w-full max-w-[220px] bg-gray-50 border-2 border-gray-200 rounded-xl px-5 py-3 text-2xl font-black tracking-[0.8em] focus:outline-none focus:border-primary";
const textInputClass = "w-full bg-gray-50 border-2 border-gray-200 rounded-xl px-5 py-3 text-lg font-bold text-secondary focus:outline-none focus:border-primary";
const labelClass = "block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2";

interface Draft {
  id: string | null;
  first_name: string;
  roleChoice: string;      // un rôle proposé ou OTHER_ROLE
  customRole: string;
  permissions: Permissions;
  active: boolean;
  pin: string;
  pin2: string;
}

const emptyDraft = (): Draft => ({
  id: null, first_name: '', roleChoice: 'Caissier', customRole: '',
  permissions: { ...presetFor('Caissier')!.permissions }, active: true, pin: '', pin2: '',
});

const draftFrom = (p: StaffProfile): Draft => ({
  id: p.id, first_name: p.first_name,
  roleChoice: presetFor(p.role) ? p.role : OTHER_ROLE,
  customRole: presetFor(p.role) ? '' : p.role,
  permissions: { ...(p.permissions || {}) }, active: p.active, pin: '', pin2: '',
});

const fmtDetails = (e: AuditEntry): string => {
  const d = e.details || {};
  const parts: string[] = [];
  if (d.droit) parts.push(`droit « ${d.droit} »`);
  if (d.numero) parts.push(`commande ${d.numero}`);
  if (d.libelle) parts.push(String(d.libelle));
  if (d.motif) parts.push(`motif : ${d.motif}`);
  if (d.montant != null) parts.push(`-${Number(d.montant).toFixed(2)} €`);
  if (d.fond != null) parts.push(`fond ${Number(d.fond).toFixed(2)} €`);
  if (d.total != null && e.action !== 'remise' && e.action !== 'offert') parts.push(`total ${Number(d.total).toFixed(2)} €`);
  if (d.ecart != null) parts.push(`écart ${Number(d.ecart).toFixed(2)} €`);
  return parts.join(' · ');
};

/** Journal « qui a fait quoi » (7 derniers jours) */
const AuditLogPanel: React.FC<{ restaurantId: string }> = ({ restaurantId }) => {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError(null);
    try { setEntries(await fetchAuditLog(restaurantId, 7)); }
    catch (e: any) { setError(e?.message || 'Journal indisponible'); }
    finally { setLoading(false); }
  };
  return (
    <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 flex items-center justify-between border-b border-gray-100">
        <div>
          <div className="text-xl font-black text-secondary uppercase">Journal</div>
          <div className="text-sm font-bold text-gray-400">Annulations, remises, tiroir, ouverture, Z et autorisations (7 derniers jours)</div>
        </div>
        <button onClick={load} disabled={loading} className="px-5 py-3 rounded-xl bg-gray-100 text-secondary font-black uppercase text-sm flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50 cursor-pointer">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <RotateCcw size={18} />} {entries ? 'Actualiser' : 'Afficher'}
        </button>
      </div>
      {error && <div className="p-6 font-bold text-red-500">{error}</div>}
      {entries && entries.length === 0 && <div className="p-6 text-center font-bold text-gray-400">Rien sur les 7 derniers jours.</div>}
      {entries && entries.length > 0 && (
        <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
          {entries.map(e => (
            <div key={e.id} className="px-6 py-3 flex items-start gap-4">
              <div className="w-28 shrink-0 text-sm font-bold text-gray-400 tabular-nums">
                {new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-secondary">
                  {AUDIT_LABELS[e.action] || e.action}
                  <span className="font-bold text-gray-500"> · {e.staff_name || 'Standard'}</span>
                  {e.approved_by_name && <span className="font-bold text-amber-600"> · validé par {e.approved_by_name}</span>}
                </div>
                {fmtDetails(e) && <div className="text-sm font-bold text-gray-400 truncate">{fmtDetails(e)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const StaffSettings: React.FC<Props> = ({ masterPin, onChange }) => {
  const restaurantId = getActiveRestaurantId();
  const [state, setState] = useState<StaffState | null>(() => readStaffCache(restaurantId));
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managerPin, setManagerPin] = useState('');

  useEffect(() => {
    let alive = true;
    refreshStaff(restaurantId).then(s => { if (alive) { setState(s); setLoading(false); onChange?.(); } });
    return () => { alive = false; };
  }, [restaurantId]);

  const staff = state?.staff || [];
  const masterDisabled = state?.masterCodeDisabled === true;
  const managers = useMemo(() => staff.filter(p => p.active && p.permissions?.profils), [staff]);

  // ── Formulaire ──
  const setRole = (choice: string) => {
    if (!draft) return;
    const preset = presetFor(choice);
    setDraft({ ...draft, roleChoice: choice, permissions: preset ? { ...preset.permissions } : draft.permissions });
  };
  const toggle = (key: string) => draft && setDraft({ ...draft, permissions: { ...draft.permissions, [key]: !draft.permissions[key as keyof Permissions] } });

  const handleSave = async () => {
    if (!draft || !restaurantId) return;
    const role = draft.roleChoice === OTHER_ROLE ? draft.customRole.trim() : draft.roleChoice;
    const isNew = !draft.id;
    if (!draft.first_name.trim()) return toast.error("Indiquez le prénom");
    if (!role) return toast.error("Indiquez le rôle");
    if (isNew || draft.pin) {
      if (!/^\d{4}$/.test(draft.pin)) return toast.error("Le code doit faire 4 chiffres");
      if (draft.pin !== draft.pin2) return toast.error("Les deux codes ne correspondent pas");
      if (draft.pin === String(masterPin)) return toast.error("Ce code est celui du profil Standard : choisissez-en un autre");
      if (isPinTakenByStaff(draft.pin, restaurantId, draft.id)) return toast.error("Ce code est déjà utilisé par un autre profil");
    }
    setSaving(true);
    try {
      const s = await saveStaff(restaurantId, {
        id: draft.id, first_name: draft.first_name, role, permissions: draft.permissions,
        active: draft.active, pin: draft.pin || null,
      });
      setState(s);
      onChange?.();
      setDraft(null);
      toast.success(isNew ? `Profil ${draft.first_name.trim()} créé` : "Profil enregistré");
    } catch (e: any) {
      toast.error(e?.message || "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  // ── Profil Standard ──
  const handleDeleteStandard = async () => {
    if (!restaurantId) return;
    const ok = managers.some(p => hashPin(p.pin_salt, managerPin) === p.pin_hash);
    if (!ok) return toast.error("Code incorrect : tapez le code d'un profil qui peut « Gérer les profils »");
    setSaving(true);
    try {
      setState(await setMasterCodeDisabled(restaurantId, true));
      onChange?.();
      setConfirmDelete(false);
      setManagerPin('');
      toast.success("Profil Standard supprimé : le code d'accès des caisses ne fonctionne plus");
    } catch (e: any) {
      toast.error(e?.message || "Suppression impossible");
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreStandard = async () => {
    if (!restaurantId) return;
    setSaving(true);
    try {
      setState(await setMasterCodeDisabled(restaurantId, false));
      onChange?.();
      toast.success("Profil Standard réactivé");
    } catch (e: any) {
      toast.error(e?.message || "Réactivation impossible");
    } finally {
      setSaving(false);
    }
  };

  // ── Rendu : formulaire ──
  if (draft) {
    const isNew = !draft.id;
    return (
      <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-black text-secondary uppercase">{isNew ? 'Nouveau profil' : `Modifier ${draft.first_name}`}</h3>
            <button onClick={() => setDraft(null)} className="w-11 h-11 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 cursor-pointer" aria-label="Annuler"><X size={22} /></button>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Prénom</label>
              <input className={textInputClass} maxLength={40} value={draft.first_name} onChange={e => setDraft({ ...draft, first_name: e.target.value })} placeholder="Ex. Karim" />
            </div>
            <div>
              <label className={labelClass}>Rôle</label>
              <select className={textInputClass} value={draft.roleChoice} onChange={e => setRole(e.target.value)}>
                {ROLE_PRESETS.map(r => <option key={r.role} value={r.role}>{r.role}</option>)}
                <option value={OTHER_ROLE}>Autre…</option>
              </select>
              {draft.roleChoice === OTHER_ROLE && (
                <input className={`${textInputClass} mt-2`} maxLength={40} value={draft.customRole} onChange={e => setDraft({ ...draft, customRole: e.target.value })} placeholder="Nom du rôle" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 pt-6 border-t border-gray-100">
            <div>
              <label className={labelClass}>{isNew ? 'Code personnel (4 chiffres)' : 'Nouveau code (vide = inchangé)'}</label>
              <input type="password" inputMode="numeric" maxLength={4} className={pinInputClass} value={draft.pin} onChange={e => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '') })} placeholder="••••" />
            </div>
            <div>
              <label className={labelClass}>Confirmer le code</label>
              <input type="password" inputMode="numeric" maxLength={4} className={pinInputClass} value={draft.pin2} onChange={e => setDraft({ ...draft, pin2: e.target.value.replace(/\D/g, '') })} placeholder="••••" />
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100">
            <label className={labelClass}>Droits de ce profil</label>
            <div className="grid grid-cols-2 gap-3">
              {PERMISSIONS.map(p => {
                const on = !!draft.permissions[p.key];
                return (
                  <button key={p.key} type="button" onClick={() => toggle(p.key)}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left font-bold transition-all cursor-pointer ${on ? 'border-primary bg-primary/5 text-secondary' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                    <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center text-white text-sm ${on ? 'bg-primary border-primary' : 'bg-white border-gray-300'}`}>{on ? '✓' : ''}</span>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {!isNew && (
            <label className="flex items-center gap-3 pt-6 border-t border-gray-100 font-bold text-secondary cursor-pointer">
              <input type="checkbox" className="w-6 h-6 accent-primary" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />
              Profil actif (décoché : ce code n'ouvre plus la caisse, l'historique est gardé)
            </label>
          )}
        </div>
        <div className="p-8 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={() => setDraft(null)} className="px-8 py-4 bg-white border border-gray-200 text-gray-600 rounded-xl font-black uppercase tracking-wider hover:bg-gray-100 cursor-pointer">Annuler</button>
          <button onClick={handleSave} disabled={saving}
            className="px-10 py-4 bg-primary text-white rounded-xl font-black text-lg uppercase tracking-wider flex items-center gap-3 hover:bg-primary/90 active:scale-95 disabled:opacity-50 shadow-md cursor-pointer">
            {saving ? <Loader2 size={22} className="animate-spin" /> : <Save size={22} />} Enregistrer
          </button>
        </div>
      </div>
    );
  }

  // ── Rendu : liste ──
  return (
    <div className="space-y-6">
      {/* Profil Standard */}
      <div className={`bg-white rounded-[2rem] shadow-sm border overflow-hidden ${masterDisabled ? 'border-gray-200 opacity-80' : 'border-gray-200'}`}>
        <div className="p-6 flex items-center gap-5">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${masterDisabled ? 'bg-gray-100 text-gray-400' : 'bg-primary/10 text-primary'}`}>
            {masterDisabled ? <ShieldOff size={28} /> : <ShieldCheck size={28} />}
          </div>
          <div className="flex-1">
            <div className="text-xl font-black text-secondary uppercase">Standard</div>
            <div className="text-sm font-bold text-gray-400">
              {masterDisabled
                ? "Supprimé : le code d'accès des caisses n'ouvre plus la caisse"
                : "Code d'accès de chaque caisse (Réglages > Sécurité) · tous les droits"}
            </div>
          </div>
          {masterDisabled ? (
            <button onClick={handleRestoreStandard} disabled={saving} className="px-5 py-3 rounded-xl bg-gray-100 text-secondary font-black uppercase text-sm flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50 cursor-pointer">
              <RotateCcw size={18} /> Réactiver
            </button>
          ) : (
            <button onClick={() => setConfirmDelete(v => !v)} disabled={managers.length === 0}
              title={managers.length === 0 ? "Créez d'abord un profil actif avec « Gérer les profils »" : undefined}
              className="px-5 py-3 rounded-xl bg-red-50 text-red-600 border border-red-100 font-black uppercase text-sm hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              Supprimer
            </button>
          )}
        </div>
        {!masterDisabled && managers.length === 0 && (
          <div className="px-6 pb-5 text-sm font-bold text-gray-400">Pour pouvoir le supprimer, créez d'abord un profil actif avec la case « Gérer les profils ».</div>
        )}
        {confirmDelete && !masterDisabled && (
          <div className="px-6 pb-6 pt-2 border-t border-red-100 bg-red-50/50 space-y-3">
            <p className="font-bold text-red-700">Le code d'accès ne fonctionnera plus sur AUCUNE caisse du restaurant. Tapez le code d'un profil qui peut « Gérer les profils » pour confirmer :</p>
            <div className="flex items-center gap-3">
              <input type="password" inputMode="numeric" maxLength={4} className={pinInputClass} value={managerPin} onChange={e => setManagerPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
              <button onClick={handleDeleteStandard} disabled={saving || managerPin.length !== 4} className="px-6 py-4 bg-red-600 text-white rounded-xl font-black uppercase hover:bg-red-700 disabled:opacity-50 cursor-pointer">Confirmer</button>
              <button onClick={() => { setConfirmDelete(false); setManagerPin(''); }} className="px-6 py-4 bg-white border border-gray-200 text-gray-600 rounded-xl font-black uppercase cursor-pointer">Annuler</button>
            </div>
          </div>
        )}
      </div>

      {/* Profils */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 flex items-center justify-between border-b border-gray-100">
          <div className="text-xl font-black text-secondary uppercase">Profils {loading && <Loader2 size={18} className="inline animate-spin text-gray-400 ml-2" />}</div>
          <button onClick={() => setDraft(emptyDraft())} disabled={!restaurantId}
            className="px-5 py-3 bg-primary text-white rounded-xl font-black uppercase text-sm flex items-center gap-2 hover:bg-primary/90 active:scale-95 disabled:opacity-50 shadow-md cursor-pointer">
            <Plus size={20} /> Ajouter
          </button>
        </div>
        {staff.length === 0 ? (
          <div className="p-8 text-center font-bold text-gray-400">
            Aucun profil pour l'instant. La caisse fonctionne avec le code d'accès, comme avant.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {staff.map(p => (
              <div key={p.id} className={`p-5 flex items-center gap-4 ${p.active ? '' : 'opacity-50'}`}>
                <div className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center"><UserRound size={24} /></div>
                <div className="flex-1">
                  <div className="text-lg font-black text-secondary">{p.first_name} {!p.active && <span className="text-xs font-bold text-gray-400 uppercase ml-2">désactivé</span>}</div>
                  <div className="text-sm font-bold text-gray-400">{p.role} · {countRights(p.permissions)} droit(s) sur {PERMISSIONS.length}</div>
                </div>
                <button onClick={() => setDraft(draftFrom(p))} className="px-5 py-3 rounded-xl bg-gray-100 text-secondary font-black uppercase text-sm flex items-center gap-2 hover:bg-gray-200 cursor-pointer">
                  <Pencil size={18} /> Modifier
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {restaurantId && <AuditLogPanel restaurantId={restaurantId} />}
    </div>
  );
};

export default StaffSettings;
