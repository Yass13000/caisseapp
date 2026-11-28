-- =============================================================================
-- AUDIT FIDÉLITÉ FRANCHISE — LECTURE SEULE (aucune modification)
-- Supabase > SQL Editor : coller, exécuter, puis copier le résultat (une seule table).
-- =============================================================================
with
fn as (
  select 'FONCTION' as quoi, p.proname as nom, pg_get_functiondef(p.oid) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname in ('spend_loyalty_points', 'franchise_account_id', 'list_franchise_restaurants',
                       'franchise_group_ids', 'franchise_overview', 'handle_loyalty_on_payment',
                       'add_loyalty_points', 'handle_new_user', 'assign_customer_number',
                       'set_loyalty_code_before_insert')
         or p.proname ilike '%loyal%' or p.proname ilike '%franchise%' or p.proname ilike '%profile%'
         or p.proname ilike '%new_user%')
),
trg as (
  select 'DECLENCHEUR' as quoi,
         c.relname || '.' || t.tgname as nom,
         pg_get_triggerdef(t.oid) || '   →  fonction : ' || f.proname as detail
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc f on f.oid = t.tgfoid
  where not t.tgisinternal
    and ((n.nspname = 'public' and c.relname in ('orders', 'profiles', 'loyalty_points'))
         or (n.nspname = 'auth' and c.relname = 'users'))
),
pol as (
  select 'REGLE ACCES' as quoi,
         tablename || ' : ' || policyname as nom,
         'commande=' || cmd || '  roles=' || array_to_string(roles, ',')
           || '  USING=' || coalesce(qual, '-') || '  CHECK=' || coalesce(with_check, '-') as detail
  from pg_policies
  where schemaname = 'public'
    and tablename in ('loyalty_points', 'profiles', 'loyalty_reward_tier', 'loyalty_reward_product')
),
rls as (
  select 'RLS ACTIVE' as quoi, c.relname as nom,
         'rls=' || c.relrowsecurity || '  force=' || c.relforcerowsecurity as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('loyalty_points', 'profiles', 'loyalty_reward_tier', 'loyalty_reward_product')
),
droits as (
  select 'DROITS TABLE' as quoi, table_name as nom,
         grantee || ' : ' || string_agg(privilege_type, ',' order by privilege_type) as detail
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('loyalty_points', 'profiles', 'loyalty_reward_tier', 'loyalty_reward_product')
    and grantee in ('anon', 'authenticated')
  group by table_name, grantee
),
exec_fn as (
  select 'DROIT EXECUTE' as quoi, p.proname as nom,
         'anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
           || '  authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
           || '  security_definer=' || p.prosecdef as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname ilike '%loyal%' or p.proname ilike '%franchise%')
),
cle as (
  select 'CLE PROFILES' as quoi, con.conname as nom, pg_get_constraintdef(con.oid) as detail
  from pg_constraint con join pg_class c on c.oid = con.conrelid
  where c.relname = 'profiles' and con.contype in ('p', 'u')
)
select * from fn
union all select * from trg
union all select * from pol
union all select * from rls
union all select * from droits
union all select * from exec_fn
union all select * from cle
order by 1, 2;
