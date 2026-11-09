-- =============================================================================
-- SÉCURITÉ LIVREURS — à exécuter UNE FOIS dans Supabase > SQL Editor
-- =============================================================================
-- Ce script ne modifie AUCUNE donnée et ne change pas les droits de lecture.
-- Il ajoute des contrôles automatiques au moment des écritures :
--
--  1. Une commande ne peut être assignée qu'à un livreur EN LIGNE du même restaurant
--     (vrai pour la caisse, l'admin et tout le monde).
--  2. Un livreur connecté ne peut modifier QUE ses propres courses, et jamais
--     le prix, le mode de paiement, la session de caisse, le solde, etc.
--     Il ne peut ni créer ni supprimer de commande.
--  3. Un livreur ne peut modifier QUE son propre profil, sans toucher à son rôle,
--     à sa sacoche (cash_float) ni à son restaurant.
--  4. Personne (hors admin) ne peut se donner le rôle livreur/admin,
--     ni passer un autre livreur "en ligne".
--  5. Seul le livreur lui-même peut écrire sa position GPS.
--  6. Un livreur ne peut toucher qu'à ses propres services (driver_shifts).
--
-- Rôles considérés comme admin : profiles.role = 'admin' ou 'super_admin'.
-- Le tableau de bord Supabase (SQL Editor, Table Editor) n'est jamais bloqué.
--
-- Pour tout annuler : exécuter securite-livreurs-ANNULER.sql
-- =============================================================================

begin;

-- ── Fonctions d'aide ─────────────────────────────────────────────────────────

-- Rôle du profil de l'utilisateur connecté (lecture hors RLS)
create or replace function public.secu_user_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

-- L'utilisateur connecté est-il un livreur ?
create or replace function public.secu_user_is_driver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role in ('driver', 'livreur') or coalesce((to_jsonb(p) ->> 'is_driver')::boolean, false))
  )
$$;

-- Ce livreur existe-t-il, est-il en ligne et rattaché à ce restaurant ?
create or replace function public.secu_driver_is_online(p_driver uuid, p_resto uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_driver
      and (p.role in ('driver', 'livreur') or coalesce((to_jsonb(p) ->> 'is_driver')::boolean, false))
      and coalesce((to_jsonb(p) ->> 'is_driver_online')::boolean, false)
      and (p_resto is null or p.restaurant_id = p_resto)
  )
$$;

-- Accès technique (tableau de bord Supabase, clé service)
create or replace function public.secu_is_superuser() returns boolean
language sql stable as $$
  select current_user in ('postgres', 'supabase_admin', 'service_role')
$$;

-- Accès admin (technique ou profil admin)
create or replace function public.secu_is_privileged() returns boolean
language sql stable as $$
  select public.secu_is_superuser() or coalesce(public.secu_user_role(), '') in ('admin', 'super_admin')
$$;

-- ── 1 & 2. COMMANDES ─────────────────────────────────────────────────────────

create or replace function public.secu_orders_guard() returns trigger
language plpgsql as $$
declare
  is_drv boolean := (not public.secu_is_privileged()) and public.secu_user_is_driver();
  uid uuid := auth.uid();
  locked text[] := array[
    'total_price', 'cash_amount', 'payment_method', 'payment_status', 'is_settled', 'settled_at',
    'session_id', 'restaurant_id', 'order_details', 'delivery_fee', 'user_id', 'order_type_id',
    'order_number', 'customer_name', 'customer_phone', 'customer_address'
  ];
  c text;
  pm text;
begin
  if TG_OP = 'DELETE' then
    if is_drv then
      raise exception 'Un livreur ne peut pas supprimer de commande' using errcode = '42501';
    end if;
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    if is_drv then
      raise exception 'Un livreur ne peut pas créer de commande' using errcode = '42501';
    end if;
    if NEW.driver_id is not null and not public.secu_is_superuser()
       and not public.secu_driver_is_online(NEW.driver_id, NEW.restaurant_id) then
      raise exception 'Livreur hors ligne ou inconnu' using errcode = '42501';
    end if;
    return NEW;
  end if;

  -- UPDATE
  if is_drv then
    if OLD.driver_id is distinct from uid then
      raise exception 'Cette course n''est pas attribuée à ce livreur' using errcode = '42501';
    end if;
    if NEW.driver_id is not null and NEW.driver_id is distinct from uid then
      raise exception 'Un livreur ne peut pas transférer une course' using errcode = '42501';
    end if;
    foreach c in array locked loop
      if (to_jsonb(NEW) -> c) is distinct from (to_jsonb(OLD) -> c) then
        raise exception 'Champ protégé pour un livreur : %', c using errcode = '42501';
      end if;
    end loop;
    -- Un livreur ne peut marquer "payée" qu'une commande en espèces (comme le fait l'appli livreur)
    if (to_jsonb(NEW) -> 'is_paid') is distinct from (to_jsonb(OLD) -> 'is_paid') then
      pm := lower(coalesce(OLD.payment_method, ''));
      if not (coalesce((to_jsonb(NEW) ->> 'is_paid')::boolean, false) and (pm like '%esp%' or pm like '%cash%')) then
        raise exception 'Un livreur ne peut pas modifier le paiement de cette commande' using errcode = '42501';
      end if;
    end if;
  end if;

  if NEW.driver_id is not null and NEW.driver_id is distinct from OLD.driver_id
     and not public.secu_is_superuser()
     and not public.secu_driver_is_online(NEW.driver_id, NEW.restaurant_id) then
    raise exception 'Livreur hors ligne ou inconnu' using errcode = '42501';
  end if;

  return NEW;
end $$;

drop trigger if exists secu_orders_guard on public.orders;
create trigger secu_orders_guard
  before insert or update or delete on public.orders
  for each row execute function public.secu_orders_guard();

-- ── 3 & 4. PROFILS ───────────────────────────────────────────────────────────

create or replace function public.secu_profiles_guard() returns trigger
language plpgsql as $$
declare
  priv boolean := public.secu_is_privileged();
  uid uuid := auth.uid();
  old_j jsonb;
  new_j jsonb;
  staff_roles text[] := array['admin', 'super_admin', 'driver', 'livreur'];
  old_is_staff boolean;
begin
  if priv then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'INSERT' then
    new_j := to_jsonb(NEW);
    if coalesce(new_j ->> 'role', '') = any (staff_roles) or coalesce((new_j ->> 'is_driver')::boolean, false) then
      raise exception 'Création de compte livreur/admin réservée à l''admin' using errcode = '42501';
    end if;
    return NEW;
  end if;

  old_j := to_jsonb(OLD);
  old_is_staff := coalesce(old_j ->> 'role', '') = any (staff_roles) or coalesce((old_j ->> 'is_driver')::boolean, false);

  if TG_OP = 'DELETE' then
    if old_is_staff then
      raise exception 'Suppression d''un compte livreur/admin réservée à l''admin' using errcode = '42501';
    end if;
    return OLD;
  end if;

  -- UPDATE
  new_j := to_jsonb(NEW);

  if (new_j -> 'role') is distinct from (old_j -> 'role')
     or (new_j -> 'is_driver') is distinct from (old_j -> 'is_driver') then
    raise exception 'Changement de rôle réservé à l''admin' using errcode = '42501';
  end if;

  if old_is_staff and (new_j -> 'restaurant_id') is distinct from (old_j -> 'restaurant_id') then
    raise exception 'Changement de restaurant réservé à l''admin' using errcode = '42501';
  end if;

  -- Passer quelqu'un "en ligne" : seulement soi-même
  if coalesce((new_j ->> 'is_driver_online')::boolean, false)
     and not coalesce((old_j ->> 'is_driver_online')::boolean, false)
     and (uid is null or uid is distinct from OLD.id) then
    raise exception 'Seul le livreur peut se mettre en ligne' using errcode = '42501';
  end if;

  if public.secu_user_is_driver() then
    if uid is distinct from OLD.id then
      raise exception 'Un livreur ne peut modifier que son propre profil' using errcode = '42501';
    end if;
    if (new_j -> 'cash_float') is distinct from (old_j -> 'cash_float') then
      raise exception 'La sacoche est gérée par la caisse' using errcode = '42501';
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists secu_profiles_guard on public.profiles;
create trigger secu_profiles_guard
  before insert or update or delete on public.profiles
  for each row execute function public.secu_profiles_guard();

-- ── 5. POSITIONS GPS ─────────────────────────────────────────────────────────

create or replace function public.secu_driver_locations_guard() returns trigger
language plpgsql as $$
begin
  if public.secu_is_privileged() then
    return coalesce(NEW, OLD);
  end if;
  if TG_OP = 'DELETE' then
    if auth.uid() is null or OLD.driver_id::text is distinct from auth.uid()::text then
      raise exception 'Position GPS : accès refusé' using errcode = '42501';
    end if;
    return OLD;
  end if;
  if auth.uid() is null or NEW.driver_id::text is distinct from auth.uid()::text or not public.secu_user_is_driver() then
    raise exception 'Seul le livreur peut envoyer sa position' using errcode = '42501';
  end if;
  return NEW;
end $$;

-- ── 6. SERVICES LIVREURS ─────────────────────────────────────────────────────

create or replace function public.secu_driver_shifts_guard() returns trigger
language plpgsql as $$
begin
  if public.secu_is_privileged() or not public.secu_user_is_driver() then
    return coalesce(NEW, OLD);
  end if;
  if (TG_OP <> 'INSERT' and OLD.driver_id::text is distinct from auth.uid()::text)
     or (TG_OP <> 'DELETE' and NEW.driver_id::text is distinct from auth.uid()::text) then
    raise exception 'Un livreur ne peut gérer que ses propres services' using errcode = '42501';
  end if;
  return coalesce(NEW, OLD);
end $$;

do $$
begin
  if to_regclass('public.driver_locations') is not null then
    execute 'drop trigger if exists secu_driver_locations_guard on public.driver_locations';
    execute 'create trigger secu_driver_locations_guard before insert or update or delete on public.driver_locations for each row execute function public.secu_driver_locations_guard()';
  end if;
  if to_regclass('public.driver_shifts') is not null then
    execute 'drop trigger if exists secu_driver_shifts_guard on public.driver_shifts';
    execute 'create trigger secu_driver_shifts_guard before insert or update or delete on public.driver_shifts for each row execute function public.secu_driver_shifts_guard()';
  end if;
end $$;

commit;

-- Vérification : doit afficher 4 lignes (ou 2 si les tables livreurs n'existent pas)
select event_object_table as "table", trigger_name as "protection"
from information_schema.triggers
where trigger_name like 'secu_%'
group by 1, 2
order by 1;
