-- Annule securite-paiements.sql (remet exactement les anciennes règles, failles comprises)
begin;
drop trigger if exists secu_pay_profiles_roles on public.profiles;
drop function if exists public.secu_pay_profiles_roles();

drop policy if exists "secu_pay_sumup_insert" on public.sumup_settings;
drop policy if exists "secu_pay_sumup_update" on public.sumup_settings;
drop policy if exists "secu_pay_sumup_delete" on public.sumup_settings;
create policy "Allow all operations on sumup_settings" on public.sumup_settings for all to public using (true) with check (true);
create policy "Allow authenticated access on sumup_settings" on public.sumup_settings for all to authenticated using (true) with check (true);
grant truncate on public.sumup_settings to anon, authenticated;

drop policy if exists "secu_pay_profiles_delete" on public.profiles;
create policy "Allow authenticated users to delete profiles" on public.profiles for delete to public using (auth.role() = 'authenticated'::text);
grant truncate on public.profiles to anon, authenticated;

drop function if exists public.secu_pay_can_manage(uuid);
drop function if exists public.secu_pay_is_super_admin();
commit;
-- Remarque : les droits d'écriture de « anon » sur sumup_settings retirés par le script
-- n'étaient pas accordés au niveau de la table d'après la vérification du 27/11 ;
-- ils ne sont donc pas remis ici.
