-- Annule entièrement utilisateurs-caisse.sql (à exécuter dans Supabase > SQL Editor)
-- ATTENTION : supprime les profils, le journal et les prénoms notés sur les commandes / Z.
begin;
drop function if exists public.pos_audit_list(uuid, timestamptz, integer);
drop function if exists public.pos_audit_add(uuid, text, uuid, text, text, text, text, jsonb, uuid, text);
drop function if exists public.pos_set_master_code_disabled(uuid, boolean);
drop function if exists public.pos_staff_save(uuid, uuid, text, text, jsonb, text, boolean, text, text);
drop function if exists public.pos_staff_manager_count(uuid, uuid);
drop function if exists public.pos_staff_list(uuid);
alter table public.orders        drop column if exists staff_id;
alter table public.orders        drop column if exists staff_name;
alter table public.cash_sessions drop column if exists opened_by_id;
alter table public.cash_sessions drop column if exists opened_by_name;
alter table public.cash_sessions drop column if exists closed_by_id;
alter table public.cash_sessions drop column if exists closed_by_name;
drop table if exists public.pos_audit_log;
drop table if exists public.pos_staff_settings;
drop table if exists public.pos_staff;
commit;
