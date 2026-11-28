-- =============================================================================
-- FIDÉLITÉ FRANCHISE — CORRECTIONS PROPOSÉES (NON EXÉCUTÉES)
-- À relire et valider avant tout lancement dans Supabase > SQL Editor.
-- Chaque bloc est indépendant : on peut les lancer un par un.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. spend_loyalty_points : solde calculé sur tout le groupe, profil du compte
--    Restaurants seuls : franchise_account_id = lui-même, groupe = lui-même → même résultat qu'avant.
--    La ligne 'spent' reste enregistrée sur p_restaurant_id (comme aujourd'hui).
-- -----------------------------------------------------------------------------
create or replace function public.spend_loyalty_points(
  p_user_id uuid, p_points integer, p_restaurant_id uuid, p_description text default 'Récompenses borne'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account uuid := public.franchise_account_id(p_restaurant_id);
  v_group uuid[] := public.franchise_group_ids(p_restaurant_id);
  v_balance int;
begin
  if p_points <= 0 then
    return jsonb_build_object('success', false, 'error', 'Le montant de points doit être supérieur à 0');
  end if;

  -- Verrou sur la fiche du compte (Martigues pour la franchise) : pas de double débit simultané
  perform 1 from public.profiles where id = p_user_id and restaurant_id = v_account for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Profil client introuvable');
  end if;

  -- Solde réel = mouvements des magasins du groupe (et non la valeur mémorisée dans profiles)
  select coalesce(sum(case when type = 'earned' then points else -points end), 0)
    into v_balance
    from public.loyalty_points
   where user_id = p_user_id and restaurant_id = any(v_group);

  if v_balance < p_points then
    return jsonb_build_object('success', false, 'error', 'Solde de points insuffisant',
                              'current_balance', greatest(v_balance, 0));
  end if;

  insert into public.loyalty_points (user_id, restaurant_id, points, type, description, created_at)
  values (p_user_id, p_restaurant_id, p_points, 'spent', p_description, now());

  v_balance := greatest(0, v_balance - p_points);
  update public.profiles set loyalty_points = v_balance, updated_at = now()
   where id = p_user_id and restaurant_id = v_account;

  return jsonb_build_object('success', true, 'new_balance', v_balance);
end $$;


-- -----------------------------------------------------------------------------
-- B1. Empêcher les nouveaux doublons : un compte CLIENT créé dans un magasin secondaire
--     est rangé sous le restaurant principal (et rien n'est créé s'il y existe déjà).
--     Ne touche pas : restaurants seuls, restaurant principal, clients caisse (@caisse.local),
--     livreurs et comptes du personnel (admin…).
--     À faire EN MÊME TEMPS : corriger l'appli client pour qu'elle crée et lise le profil
--     du compte de la franchise (PWA-APP-main/src/lib/supabaseClient.ts, ACCOUNT_RESTAURANT_ID).
-- -----------------------------------------------------------------------------
create or replace function public.profiles_franchise_account()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_main uuid;
begin
  if coalesce(new.role, 'client') not in ('client', 'user')
     or coalesce(new.is_driver, false)
     or coalesce(new.email, '') ilike '%@caisse.local' then
    return new;
  end if;
  select franchise_main_id into v_main from public.restaurants where id = new.restaurant_id;
  if v_main is null then
    return new;                                   -- restaurant seul ou principal : inchangé
  end if;
  if exists (select 1 from public.profiles where id = new.id and restaurant_id = v_main) then
    return null;                                  -- le compte existe déjà sous le principal
  end if;
  new.restaurant_id := v_main;
  return new;
end $$;

drop trigger if exists aa_profiles_franchise_account on public.profiles;
create trigger aa_profiles_franchise_account
  before insert on public.profiles
  for each row execute function public.profiles_franchise_account();


-- -----------------------------------------------------------------------------
-- B2. Supprimer les 4 doublons existants (lignes secondaires d'un client déjà présent
--     sous Martigues ; aucune ne porte de points propres). Limité au groupe Regal Food's.
-- -----------------------------------------------------------------------------
delete from public.profiles s
using public.profiles m
where s.id = m.id
  and m.restaurant_id = '14ca29fb-17fc-4af2-a3d5-5007a3040304'
  and s.restaurant_id in ('20b688eb-f8b9-47cb-b609-4905c189dde8',
                          '87cd809a-0130-4ae2-84c9-2077f871a46d',
                          'd4b2d25f-8b8e-4982-b7ff-1e337abd05d4')
  and coalesce(s.email, '') not ilike '%@caisse.local';


-- -----------------------------------------------------------------------------
-- C. Sécurité sans risque pour les applis : aucune appli ne modifie ni ne supprime
--    directement loyalty_points (seules les fonctions de la base le font, et elles ne
--    sont pas concernées par ces règles). Touche tous les restaurants.
-- -----------------------------------------------------------------------------
drop policy if exists "Allow update loyalty points" on public.loyalty_points;
drop policy if exists "allow_update_loyalty_points" on public.loyalty_points;
drop policy if exists "allow_delete_loyalty_points" on public.loyalty_points;
revoke truncate on public.loyalty_points, public.loyalty_reward_tier, public.loyalty_reward_product
  from anon, authenticated;


-- -----------------------------------------------------------------------------
-- D. Paliers et produits de récompense : un admin ne modifie que SES restaurants
--    (aujourd'hui, n'importe quel admin peut modifier ceux de tous les restaurants).
--    (les deux tables ont bien une colonne restaurant_id, vérifié). Touche tous les restaurants.
-- -----------------------------------------------------------------------------
-- alter policy loy_tier_insert_admin  on public.loyalty_reward_tier    with check (public.is_admin_of(restaurant_id));
-- alter policy loy_tier_update_admin  on public.loyalty_reward_tier    using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
-- alter policy loy_tier_delete_admin  on public.loyalty_reward_tier    using (public.is_admin_of(restaurant_id));
-- alter policy loy_tprod_insert_admin on public.loyalty_reward_product with check (public.is_admin_of(restaurant_id));
-- alter policy loy_tprod_update_admin on public.loyalty_reward_product using (public.is_admin_of(restaurant_id)) with check (public.is_admin_of(restaurant_id));
-- alter policy loy_tprod_delete_admin on public.loyalty_reward_product using (public.is_admin_of(restaurant_id));
