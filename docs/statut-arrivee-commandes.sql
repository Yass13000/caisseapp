-- =============================================================================
-- STATUT À L'ARRIVÉE DES COMMANDES — à exécuter UNE FOIS
-- dans Supabase > SQL Editor
-- =============================================================================
-- Permet de choisir, par restaurant et par canal (caisse, borne, appli), si
-- une nouvelle commande arrive en « Nouvelle » (comme aujourd'hui) ou
-- directement en « En cours ».
--
-- Ce script ne fait QUE des ajouts :
--   • 1 table pos_order_arrival (le choix de chaque restaurant)
--   • 2 fonctions appelées par la caisse (lire / enregistrer le choix)
--   • 1 règle (trigger) sur orders qui, AU MOMENT DE L'INSERTION, remplace
--     « Nouvelle » par « En cours » si le restaurant l'a choisi pour ce canal.
-- Aucune donnée ni colonne existante n'est modifiée. Tant que rien n'est
-- choisi dans la caisse, toutes les commandes arrivent en « Nouvelle »,
-- exactement comme avant. La règle ne bloque jamais une commande : en cas
-- de problème elle laisse la commande telle quelle.
--
-- Pour tout annuler : exécuter statut-arrivee-commandes-ANNULER.sql
-- =============================================================================

begin;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'restaurants' and column_name = 'id') <> 'uuid' then
    raise exception 'restaurants.id n''est pas un uuid : script arrêté, rien n''a été modifié';
  end if;
end $$;

create table if not exists public.pos_order_arrival (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  settings      jsonb not null default '{}'::jsonb,   -- ex. {"caisse":"En cours","borne":"Nouvelle","app":"Nouvelle"}
  updated_at    timestamptz not null default now()
);
alter table public.pos_order_arrival enable row level security;
-- Aucune règle d'accès direct : on passe par les fonctions ci-dessous.

-- Lire le choix d'un restaurant
create or replace function public.pos_order_arrival_get(p_restaurant_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select settings from public.pos_order_arrival where restaurant_id = p_restaurant_id), '{}'::jsonb);
$$;

-- Enregistrer le choix (seuls caisse / borne / app et Nouvelle / En cours sont acceptés)
create or replace function public.pos_order_arrival_set(p_restaurant_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_clean jsonb := '{}'::jsonb;
  v_key text;
begin
  if p_restaurant_id is null or not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant introuvable';
  end if;
  foreach v_key in array array['caisse', 'borne', 'app'] loop
    if p_settings ->> v_key in ('Nouvelle', 'En cours') then
      v_clean := v_clean || jsonb_build_object(v_key, p_settings ->> v_key);
    end if;
  end loop;
  insert into public.pos_order_arrival (restaurant_id, settings, updated_at)
  values (p_restaurant_id, v_clean, now())
  on conflict (restaurant_id) do update set settings = excluded.settings, updated_at = now();
  return v_clean;
end $$;

-- Règle appliquée à chaque nouvelle commande
create or replace function public.pos_order_arrival_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_choice text;
begin
  if new.status is distinct from 'Nouvelle' or new.restaurant_id is null then
    return new;
  end if;
  select settings ->> lower(coalesce(new.order_origin, ''))
    into v_choice
    from public.pos_order_arrival
   where restaurant_id = new.restaurant_id::uuid;
  if v_choice = 'En cours' then
    new.status := 'En cours';
  end if;
  return new;
exception when others then
  return new;   -- jamais bloquer une commande
end $$;

drop trigger if exists pos_order_arrival_trigger on public.orders;
create trigger pos_order_arrival_trigger
  before insert on public.orders
  for each row execute function public.pos_order_arrival_apply();

revoke all on function public.pos_order_arrival_apply() from public, anon, authenticated;
grant execute on function public.pos_order_arrival_get(uuid) to anon, authenticated;
grant execute on function public.pos_order_arrival_set(uuid, jsonb) to anon, authenticated;

commit;
