-- =============================================================================
-- PROFILS CAISSE — durcissement (à exécuter UNE FOIS dans Supabase > SQL Editor,
-- APRÈS utilisateurs-caisse.sql)
-- =============================================================================
-- Avant : la liste des profils renvoyait l'empreinte des codes (un code à 4 chiffres
-- se retrouve en moins d'une seconde) et n'importe qui pouvait créer un gérant.
-- Maintenant :
--   • la liste ne contient plus aucune empreinte de code ;
--   • le code personnel est vérifié par le serveur (pos_staff_login),
--     avec au plus 30 erreurs par 10 minutes et par restaurant ;
--   • créer / modifier un profil, supprimer ou réactiver le profil Standard
--     demande le code d'un profil « Gérer les profils » dès qu'il en existe un
--     (le tout premier gérant se crée avec le profil Standard, comme avant) ;
--   • un code déjà pris par un autre profil est refusé par le serveur.
-- Aucune donnée supprimée. Aucun impact tant qu'aucun profil n'existe.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pos_staff_login_attempts (
  id bigserial primary key,
  restaurant_id uuid not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists pos_staff_login_attempts_idx on public.pos_staff_login_attempts (restaurant_id, created_at desc);
alter table public.pos_staff_login_attempts enable row level security;

-- Empreinte identique à celle de la caisse : SHA-256 de « sel:code »
create or replace function public.pos_pin_hash(p_salt text, p_pin text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(p_salt || ':' || p_pin, 'sha256'), 'hex')
$$;

-- Profil actif correspondant à un code (usage interne)
create or replace function public.pos_staff_find(p_restaurant_id uuid, p_pin text, p_exclude uuid default null)
returns public.pos_staff language sql stable security definer set search_path = public, extensions as $$
  select s.* from pos_staff s
  where s.restaurant_id = p_restaurant_id and s.active
    and (p_exclude is null or s.id <> p_exclude)
    and s.pin_hash = public.pos_pin_hash(s.pin_salt, coalesce(p_pin, ''))
  limit 1
$$;

-- Code valable d'un profil actif « Gérer les profils » ? (usage interne)
create or replace function public.pos_staff_is_manager_pin(p_restaurant_id uuid, p_pin text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare s public.pos_staff;
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then return false; end if;
  s := public.pos_staff_find(p_restaurant_id, p_pin);
  return s.id is not null and coalesce((s.permissions ->> 'profils')::boolean, false);
end $$;

-- Exige le code d'un gérant dès qu'un gérant existe (usage interne)
create or replace function public.pos_staff_require_manager(p_restaurant_id uuid, p_manager_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.pos_staff_manager_count(p_restaurant_id, null) > 0
     and not public.pos_staff_is_manager_pin(p_restaurant_id, p_manager_pin) then
    raise exception 'Code d''un gérant requis (profil avec « Gérer les profils »)';
  end if;
end $$;

-- ── Liste sans empreintes ────────────────────────────────────────────────────
create or replace function public.pos_staff_list(p_restaurant_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'master_code_disabled', coalesce((select s.master_code_disabled from pos_staff_settings s
                                      where s.restaurant_id = p_restaurant_id), false),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'role', p.role,
        'permissions', p.permissions, 'color', p.color, 'active', p.active,
        'updated_at', p.updated_at) order by p.created_at)
      from pos_staff p where p.restaurant_id = p_restaurant_id), '[]'::jsonb)
  )
$$;

-- ── Connexion par code (vérifiée ici) ────────────────────────────────────────
create or replace function public.pos_staff_login(p_restaurant_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.pos_staff;
begin
  if (select count(*) from pos_staff_login_attempts
      where restaurant_id = p_restaurant_id and not ok and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Trop de codes incorrects : réessayez dans quelques minutes';
  end if;
  s := public.pos_staff_find(p_restaurant_id, p_pin);
  insert into pos_staff_login_attempts (restaurant_id, ok) values (p_restaurant_id, s.id is not null);
  delete from pos_staff_login_attempts where created_at < now() - interval '1 day';
  if s.id is null then return null; end if;
  return jsonb_build_object('id', s.id, 'first_name', s.first_name, 'role', s.role,
                            'permissions', s.permissions, 'color', s.color, 'active', s.active);
end $$;

-- ── Création / modification (code envoyé en clair sur HTTPS, empreinte calculée ici) ──
drop function if exists public.pos_staff_save(uuid, uuid, text, text, jsonb, text, boolean, text, text);

create or replace function public.pos_staff_save(
  p_restaurant_id uuid, p_id uuid, p_first_name text, p_role text,
  p_permissions jsonb, p_color text, p_active boolean,
  p_pin text default null, p_manager_pin text default null
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_salt text;
  v_disabled boolean := coalesce((select master_code_disabled from pos_staff_settings
                                  where restaurant_id = p_restaurant_id), false);
  v_will_manage boolean := coalesce(p_active, true) and coalesce((p_permissions ->> 'profils')::boolean, false);
begin
  perform public.pos_staff_require_manager(p_restaurant_id, p_manager_pin);

  if p_pin is not null and p_pin !~ '^\d{4}$' then
    raise exception 'Le code doit faire 4 chiffres';
  end if;
  if p_pin is not null and (public.pos_staff_find(p_restaurant_id, p_pin, p_id)).id is not null then
    raise exception 'Ce code est déjà utilisé par un autre profil';
  end if;
  if p_pin is not null then
    v_salt := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  if p_id is null then
    if p_pin is null then raise exception 'Code personnel obligatoire'; end if;
    insert into pos_staff (restaurant_id, first_name, role, pin_salt, pin_hash, permissions, color, active)
    values (p_restaurant_id, trim(p_first_name), trim(coalesce(p_role, 'Caissier')), v_salt,
            public.pos_pin_hash(v_salt, p_pin), coalesce(p_permissions, '{}'::jsonb), p_color, coalesce(p_active, true))
    returning id into v_id;
    return v_id;
  end if;

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
    pin_salt    = coalesce(v_salt, pin_salt),
    pin_hash    = case when v_salt is null then pin_hash else public.pos_pin_hash(v_salt, p_pin) end,
    updated_at  = now()
  where id = p_id and restaurant_id = p_restaurant_id
  returning id into v_id;
  if v_id is null then raise exception 'Profil introuvable'; end if;
  return v_id;
end $$;

-- ── Profil Standard : code d'un gérant exigé ─────────────────────────────────
drop function if exists public.pos_set_master_code_disabled(uuid, boolean);

create or replace function public.pos_set_master_code_disabled(p_restaurant_id uuid, p_disabled boolean, p_manager_pin text default null)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_disabled and public.pos_staff_manager_count(p_restaurant_id, null) = 0 then
    raise exception 'Créez d''abord un profil actif avec « Gérer les profils »';
  end if;
  perform public.pos_staff_require_manager(p_restaurant_id, p_manager_pin);
  insert into pos_staff_settings (restaurant_id, master_code_disabled, updated_at)
  values (p_restaurant_id, p_disabled, now())
  on conflict (restaurant_id) do update set master_code_disabled = excluded.master_code_disabled, updated_at = now();
  return p_disabled;
end $$;

-- Droits : seules les fonctions « publiques » sont appelables par la caisse
revoke all on function public.pos_pin_hash(text, text) from public, anon, authenticated;
revoke all on function public.pos_staff_find(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.pos_staff_is_manager_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.pos_staff_require_manager(uuid, text) from public, anon, authenticated;
grant execute on function public.pos_staff_list(uuid) to anon, authenticated;
grant execute on function public.pos_staff_login(uuid, text) to anon, authenticated;
grant execute on function public.pos_staff_save(uuid, uuid, text, text, jsonb, text, boolean, text, text) to anon, authenticated;
grant execute on function public.pos_set_master_code_disabled(uuid, boolean, text) to anon, authenticated;

commit;
