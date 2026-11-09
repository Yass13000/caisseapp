-- Annule entièrement securite-livreurs.sql (à exécuter dans Supabase > SQL Editor)
begin;
drop trigger if exists secu_orders_guard on public.orders;
drop trigger if exists secu_profiles_guard on public.profiles;
do $$
begin
  if to_regclass('public.driver_locations') is not null then
    execute 'drop trigger if exists secu_driver_locations_guard on public.driver_locations';
  end if;
  if to_regclass('public.driver_shifts') is not null then
    execute 'drop trigger if exists secu_driver_shifts_guard on public.driver_shifts';
  end if;
end $$;
drop function if exists public.secu_orders_guard();
drop function if exists public.secu_profiles_guard();
drop function if exists public.secu_driver_locations_guard();
drop function if exists public.secu_driver_shifts_guard();
drop function if exists public.secu_is_privileged();
drop function if exists public.secu_is_superuser();
drop function if exists public.secu_driver_is_online(uuid, uuid);
drop function if exists public.secu_user_is_driver();
drop function if exists public.secu_user_role();
commit;
