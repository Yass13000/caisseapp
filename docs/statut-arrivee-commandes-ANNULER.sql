-- Annule entièrement statut-arrivee-commandes.sql (à exécuter dans Supabase > SQL Editor)
-- Les commandes arrivent de nouveau toutes en « Nouvelle ». Les commandes déjà reçues ne changent pas.
begin;
drop trigger if exists pos_order_arrival_trigger on public.orders;
drop function if exists public.pos_order_arrival_apply();
drop function if exists public.pos_order_arrival_set(uuid, jsonb);
drop function if exists public.pos_order_arrival_get(uuid);
drop table if exists public.pos_order_arrival;
commit;
