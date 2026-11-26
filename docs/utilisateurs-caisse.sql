-- =============================================================================
-- PROFILS UTILISATEURS DE LA CAISSE — étape 1 — à exécuter UNE FOIS
-- dans Supabase > SQL Editor
-- =============================================================================
-- Ce script ne fait QUE des ajouts :
--   • 3 nouvelles tables : pos_staff (profils), pos_staff_settings (profil
--     Standard actif ou non), pos_audit_log (journal « qui a fait quoi »)
--   • des colonnes FACULTATIVES (vides par défaut) sur orders et cash_sessions
--     pour noter le prénom de la personne
--   • des fonctions pos_* appelées par la caisse
-- Il ne modifie, ne renomme et ne supprime AUCUNE donnée ni colonne existante.
-- Tant qu'aucun profil n'est créé dans la caisse, rien ne change.
--
-- Le code personnel n'est jamais stocké en clair : la caisse envoie une
-- empreinte (SHA-256 avec un sel propre à chaque profil).
-- Les tables sont fermées en accès direct : la caisse passe uniquement par
-- les fonctions pos_*, qui empêchent de se bloquer dehors (on ne peut pas
-- retirer le dernier profil qui peut « Gérer les profils » une fois le profil
-- Standard supprimé, ni supprimer le Standard sans un tel profil).
--
-- Secours si plus personne ne peut entrer : exécuter
--   update public.pos_staff_settings set master_code_disabled = false;
-- (le code d'accès actuel de chaque caisse refonctionne).
--
-- Pour tout annuler : exécuter utilisateurs-caisse-ANNULER.sql
-- =============================================================================

begin;

-- Sécurité : on vérifie que les identifiants restaurant sont bien des uuid
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'restaurants' and column_name = 'id') <> 'uuid' then
    raise exception 'restaurants.id n''est pas un uuid : script arrêté, rien n''a été modifié';
  end if;
end $$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.pos_staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  first_name    text not null check (length(trim(first_name)) between 1 and 40),
  role          text not null default 'Caissier' check (length(trim(role)) between 1 and 40),
  pin_salt      text not null,
  pin_hash      text not null,
  permissions   jsonb not null default '{}'::jsonb,
  color         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pos_staff_restaurant_idx on public.pos_staff (restaurant_id);

create table if not exists public.pos_staff_settings (
  restaurant_id        uuid primary key references public.restaurants(id) on delete cascade,
  master_code_disabled boolean not null default false,
  updated_at           timestamptz not null default now()
);

create table if not exists public.pos_audit_log (
  id            bigserial primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  action        text not null,
  staff_id      uuid,
  staff_name    text,
  approved_by_id   uuid,
  approved_by_name text,
  order_id      text,
  session_id    text,
  device_id     text,
  details       jsonb
);
create index if not exists pos_audit_log_resto_date_idx on public.pos_audit_log (restaurant_id, created_at desc);

-- Fermées en accès direct (seules les fonctions pos_* y touchent)
alter table public.pos_staff enable row level security;
alter table public.pos_staff_settings enable row level security;
alter table public.pos_audit_log enable row level security;

-- ── Colonnes facultatives (vides = comme aujourd'hui) ───────────────────────

alter table public.orders        add column if not exists staff_id uuid;
alter table public.orders        add column if not exists staff_name text;
alter table public.cash_sessions add column if not exists opened_by_id uuid;
alter table public.cash_sessions add column if not exists opened_by_name text;
alter table public.cash_sessions add column if not exists closed_by_id uuid;
alter table public.cash_sessions add column if not exists closed_by_name text;

-- ── Fonctions appelées par la caisse ─────────────────────────────────────────

-- Liste des profils + état du profil Standard (la caisse en garde une copie
-- pour pouvoir se connecter hors ligne)
create or replace function public.pos_staff_list(p_restaurant_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'master_code_disabled', coalesce((select s.master_code_disabled from pos_staff_settings s
                                      where s.restaurant_id = p_restaurant_id), false),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'role', p.role,
        'pin_salt', p.pin_salt, 'pin_hash', p.pin_hash,
        'permissions', p.permissions, 'color', p.color, 'active', p.active,
        'updated_at', p.updated_at) order by p.created_at)
      from pos_staff p where p.restaurant_id = p_restaurant_id), '[]'::jsonb)
  )
$$;

-- Nombre de profils actifs pouvant « Gérer les profils » (en excluant éventuellement un profil)
create or replace function public.pos_staff_manager_count(p_restaurant_id uuid, p_exclude uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from pos_staff p
  where p.restaurant_id = p_restaurant_id and p.active
    and coalesce((p.permissions ->> 'profils')::boolean, false)
    and (p_exclude is null or p.id <> p_exclude)
$$;

-- Créer (p_id null) ou modifier un profil. p_pin_salt/p_pin_hash null = code inchangé.
create or replace function public.pos_staff_save(
  p_restaurant_id uuid, p_id uuid, p_first_name text, p_role text,
  p_permissions jsonb, p_color text, p_active boolean,
  p_pin_salt text default null, p_pin_hash text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_disabled boolean := coalesce((select master_code_disabled from pos_staff_settings
                                  where restaurant_id = p_restaurant_id), false);
  v_will_manage boolean := coalesce(p_active, true) and coalesce((p_permissions ->> 'profils')::boolean, false);
begin
  if p_id is null then
    if p_pin_salt is null or p_pin_hash is null then
      raise exception 'Code personnel obligatoire';
    end if;
    insert into pos_staff (restaurant_id, first_name, role, pin_salt, pin_hash, permissions, color, active)
    values (p_restaurant_id, trim(p_first_name), trim(coalesce(p_role, 'Caissier')), p_pin_salt, p_pin_hash,
            coalesce(p_permissions, '{}'::jsonb), p_color, coalesce(p_active, true))
    returning id into v_id;
    return v_id;
  end if;

  -- Anti-blocage : profil Standard supprimé → il doit rester un gérant actif
  if v_disabled and not v_will_manage
     and public.pos_staff_manager_count(p_restaurant_id, p_id) = 0 then
    raise exception 'Impossible : c''est le dernier profil qui peut gérer les profils';
  end if;

  update pos_staff set
    first_name  = trim(p_first_name),
    role        = trim(coalesce(p_role, role)),
    permissions = coalesce(p_permissions, permissions),
    color       = p_color,
    active      = coalesce(p_active, active),
    pin_salt    = coalesce(p_pin_salt, pin_salt),
    pin_hash    = coalesce(p_pin_hash, pin_hash),
    updated_at  = now()
  where id = p_id and restaurant_id = p_restaurant_id
  returning id into v_id;
  if v_id is null then raise exception 'Profil introuvable'; end if;
  return v_id;
end $$;

-- Supprimer (true) ou réactiver (false) le profil Standard (code d'accès actuel)
create or replace function public.pos_set_master_code_disabled(p_restaurant_id uuid, p_disabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_disabled and public.pos_staff_manager_count(p_restaurant_id, null) = 0 then
    raise exception 'Créez d''abord un profil actif avec « Gérer les profils »';
  end if;
  insert into pos_staff_settings (restaurant_id, master_code_disabled, updated_at)
  values (p_restaurant_id, p_disabled, now())
  on conflict (restaurant_id) do update set master_code_disabled = excluded.master_code_disabled, updated_at = now();
  return p_disabled;
end $$;

-- Ajouter une ligne au journal (jamais bloquant côté caisse)
create or replace function public.pos_audit_add(
  p_restaurant_id uuid, p_action text, p_staff_id uuid, p_staff_name text,
  p_order_id text default null, p_session_id text default null, p_device_id text default null,
  p_details jsonb default null, p_approved_by_id uuid default null, p_approved_by_name text default null
) returns void language sql security definer set search_path = public as $$
  insert into pos_audit_log (restaurant_id, action, staff_id, staff_name, order_id, session_id,
                             device_id, details, approved_by_id, approved_by_name)
  values (p_restaurant_id, left(p_action, 60), p_staff_id, left(p_staff_name, 60), p_order_id, p_session_id,
          left(p_device_id, 80), p_details, p_approved_by_id, left(p_approved_by_name, 60))
$$;

-- Lire le journal (écran « Journal » des Réglages)
create or replace function public.pos_audit_list(p_restaurant_id uuid, p_since timestamptz, p_limit integer default 200)
returns setof public.pos_audit_log language sql stable security definer set search_path = public as $$
  select * from pos_audit_log
  where restaurant_id = p_restaurant_id and created_at >= p_since
  order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

revoke all on function public.pos_staff_manager_count(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pos_staff_list(uuid) to anon, authenticated;
grant execute on function public.pos_staff_save(uuid, uuid, text, text, jsonb, text, boolean, text, text) to anon, authenticated;
grant execute on function public.pos_set_master_code_disabled(uuid, boolean) to anon, authenticated;
grant execute on function public.pos_audit_add(uuid, text, uuid, text, text, text, text, jsonb, uuid, text) to anon, authenticated;
grant execute on function public.pos_audit_list(uuid, timestamptz, integer) to anon, authenticated;

commit;

-- Vérification (doit afficher {"staff": [], "master_code_disabled": false}) :
-- select public.pos_staff_list((select id from public.restaurants limit 1));
