-- =============================================================================
-- SÉCURITÉ PAIEMENTS — à exécuter UNE FOIS dans Supabase > SQL Editor
-- =============================================================================
-- Ferme les deux portes qui permettaient de DÉTOURNER les paiements CB :
--
--  1. N'importe qui (même sans compte) pouvait modifier n'importe quelle fiche
--     « profiles », donc se donner le rôle admin / super_admin, entrer dans
--     l'admin d'un resto et remplacer sa clé SumUp par la sienne.
--     → Le rôle et « franchise master » ne peuvent plus être changés que par
--       un super_admin, ou par l'admin du resto concerné (jamais vers super_admin).
--       Toute autre tentative est ignorée en silence (le reste de la fiche,
--       points de fidélité, adresse…, s'enregistre normalement comme avant).
--
--  2. La table « sumup_settings » (clés SumUp) était modifiable par tous.
--     → Écriture réservée au serveur (clé service) et aux admins du resto
--       concerné / super_admin. La lecture ne change pas (la borne lit toujours
--       sa clé d'affiliation ; la clé API secrète reste illisible).
--
--  3. Bonus : un simple compte client pouvait SUPPRIMER toutes les fiches clients.
--     → Suppression réservée à la personne elle-même ou aux admins du resto.
--
-- Ne change RIEN pour : la caisse, la borne, le KDS, l'appli client
-- (inscription, adresse, fidélité), l'admin des restos et SuperAd.
-- Ne supprime ni ne modifie AUCUNE donnée.
-- Pour tout annuler : exécuter securite-paiements-ANNULER.sql
-- =============================================================================

begin;

-- ── Fonctions d'aide (lecture des profils sans passer par les règles) ───────

create or replace function public.secu_pay_is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'super_admin')
$$;

-- L'utilisateur connecté gère-t-il ce restaurant ? (super_admin, admin du resto,
-- ou franchise master rattaché à ce resto)
create or replace function public.secu_pay_can_manage(p_resto uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role = 'super_admin'
           or (p.role = 'admin' and p.restaurant_id = p_resto)
           or (coalesce((to_jsonb(p) ->> 'is_franchise_master')::boolean, false) and p.restaurant_id = p_resto))
  )
$$;

-- ── 1. Rôle et franchise master protégés ─────────────────────────────────────

create or replace function public.secu_pay_profiles_roles() returns trigger
language plpgsql as $$
declare
  -- Clé service / tableau de bord Supabase : aucune restriction
  privileged boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
  is_super boolean;
  new_master boolean;
  old_master boolean;
begin
  if privileged then return new; end if;
  is_super := public.secu_pay_is_super_admin();
  if is_super then return new; end if;

  new_master := coalesce((to_jsonb(new) ->> 'is_franchise_master')::boolean, false);

  if tg_op = 'INSERT' then
    -- Création d'une fiche : rôle client, sauf création par l'admin du resto (jamais super_admin)
    if coalesce(new.role, 'client') not in ('client', 'user') then
      if not (new.role <> 'super_admin' and public.secu_pay_can_manage(new.restaurant_id)) then
        new.role := 'client';
      end if;
    end if;
    if new_master then
      new := jsonb_populate_record(new, jsonb_build_object('is_franchise_master', false));
    end if;
    return new;
  end if;

  -- Modification
  old_master := coalesce((to_jsonb(old) ->> 'is_franchise_master')::boolean, false);

  if new.role is distinct from old.role then
    if not (new.role is distinct from 'super_admin'
            and old.role is distinct from 'super_admin'
            and new.restaurant_id is not distinct from old.restaurant_id
            and public.secu_pay_can_manage(old.restaurant_id)) then
      new.role := old.role;
    end if;
  end if;

  if new_master is distinct from old_master then
    new := jsonb_populate_record(new, jsonb_build_object('is_franchise_master', old_master));
  end if;

  -- Un compte admin ne peut pas être déplacé vers un autre resto (sauf super_admin)
  if old.role in ('admin', 'super_admin') and new.restaurant_id is distinct from old.restaurant_id then
    new.restaurant_id := old.restaurant_id;
  end if;

  return new;
end $$;

drop trigger if exists secu_pay_profiles_roles on public.profiles;
create trigger secu_pay_profiles_roles
  before insert or update on public.profiles
  for each row execute function public.secu_pay_profiles_roles();

-- ── 2. Clés SumUp : écriture réservée aux admins du resto ────────────────────

drop policy if exists "Allow all operations on sumup_settings" on public.sumup_settings;
drop policy if exists "Allow authenticated access on sumup_settings" on public.sumup_settings;

drop policy if exists "secu_pay_sumup_insert" on public.sumup_settings;
create policy "secu_pay_sumup_insert" on public.sumup_settings
  for insert to authenticated with check (public.secu_pay_can_manage(restaurant_id));

drop policy if exists "secu_pay_sumup_update" on public.sumup_settings;
create policy "secu_pay_sumup_update" on public.sumup_settings
  for update to authenticated
  using (public.secu_pay_can_manage(restaurant_id))
  with check (public.secu_pay_can_manage(restaurant_id));

drop policy if exists "secu_pay_sumup_delete" on public.sumup_settings;
create policy "secu_pay_sumup_delete" on public.sumup_settings
  for delete to authenticated using (public.secu_pay_can_manage(restaurant_id));

-- Sans compte : aucune écriture possible (la lecture reste inchangée)
revoke insert, update, delete, truncate on public.sumup_settings from anon;
revoke truncate on public.sumup_settings from authenticated;

-- ── 3. Suppression des fiches clients ────────────────────────────────────────

drop policy if exists "Allow authenticated users to delete profiles" on public.profiles;
drop policy if exists "secu_pay_profiles_delete" on public.profiles;
create policy "secu_pay_profiles_delete" on public.profiles
  for delete to authenticated
  using (id = auth.uid() or public.secu_pay_can_manage(restaurant_id));

revoke truncate on public.profiles from anon, authenticated;

-- Appelées par le déclencheur avec les droits de l'appelant (caisse, borne… sans compte) :
-- elles ne répondent que « oui/non » sur la personne connectée elle-même
grant execute on function public.secu_pay_is_super_admin() to anon, authenticated;
grant execute on function public.secu_pay_can_manage(uuid) to anon, authenticated;

commit;
