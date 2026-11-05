-- ====================================================================
-- FINSMART – Migration du système de monétisation et gestion des crédits
-- ====================================================================

-- 1. Extension des tables existantes
alter table public.profiles 
  add column if not exists credits_balance int default 0 check (credits_balance >= 0);

alter table public.companies 
  add column if not exists free_generation_used boolean default false,
  add column if not exists free_generation_exercise_id uuid;

alter table public.exercises 
  add column if not exists is_full_version boolean default false,
  add column if not exists generation_type text default 'none';

-- 2. Configuration des packs de crédits
create table if not exists public.credit_packages (
  id text primary key,
  nom text not null,
  credits int not null,
  prix_fcfa int not null,
  prix_unitaire_fcfa int not null,
  economie_pct int default 0,
  description text,
  is_active boolean default true,
  sort_order int default 0
);

-- Insertion / mise à jour des tarifs officiels
insert into public.credit_packages (id, nom, credits, prix_fcfa, prix_unitaire_fcfa, economie_pct, description, is_active, sort_order)
values 
  ('unit', 'Génération à l''unité', 1, 20000, 20000, 0, '1 génération complète avec toutes les 36 notes et fiches officielles', true, 1),
  ('starter', 'Pack Starter', 3, 50000, 16667, 17, '3 générations complètes (16 667 FCFA / liasse)', true, 2),
  ('business', 'Pack Business', 10, 160000, 16000, 20, '10 générations complètes (16 000 FCFA / liasse)', true, 3),
  ('cabinet_expert', 'Pack Cabinet & Pack Expert', 25, 400000, 16000, 20, '25 générations complètes (16 000 FCFA / liasse)', true, 4)
on conflict (id) do update set
  nom = excluded.nom,
  credits = excluded.credits,
  prix_fcfa = excluded.prix_fcfa,
  prix_unitaire_fcfa = excluded.prix_unitaire_fcfa,
  economie_pct = excluded.economie_pct,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;


-- 3. Table des paiements et commandes
create table if not exists public.payments (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  user_id uuid references auth.users(id) not null,
  package_id text references public.credit_packages(id),
  credits_achetes int not null,
  montant_fcfa int not null,
  moyen_paiement text not null,
  reference_externe text,
  telephone_paiement text,
  statut text default 'pending',
  metadata jsonb default '{}'::jsonb
);

-- 4. Journal d'audit des crédits (ledger immuable)
create table if not exists public.credit_ledger (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  user_id uuid references auth.users(id) not null,
  company_id uuid references public.companies(id),
  exercise_id uuid references public.exercises(id),
  montant_credits int not null,
  solde_apres int not null,
  motif text not null,
  payment_id uuid references public.payments(id),
  commentaire text
);

-- Sécurité RLS
alter table public.credit_packages enable row level security;
alter table public.payments enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "Packages: select active" on public.credit_packages;
create policy "Packages: select active" on public.credit_packages for select using (true);

drop policy if exists "Packages: admin manage" on public.credit_packages;
create policy "Packages: admin manage" on public.credit_packages for all using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists "Payments: select own or admin" on public.payments;
create policy "Payments: select own or admin" on public.payments for select using (auth.uid() = user_id or public.is_app_admin());

drop policy if exists "Payments: insert own" on public.payments;
create policy "Payments: insert own" on public.payments for insert with check (auth.uid() = user_id or public.is_app_admin());

drop policy if exists "Payments: update admin" on public.payments;
create policy "Payments: update admin" on public.payments for update using (public.is_app_admin());

drop policy if exists "Ledger: select own or admin" on public.credit_ledger;
create policy "Ledger: select own or admin" on public.credit_ledger for select using (auth.uid() = user_id or public.is_app_admin());

-- ====================================================================
-- FONCTIONS TRANSACTIONNELLES CÔTÉ SERVEUR (RPC)
-- ====================================================================

-- 5.1 Vérification de l'éligibilité et du statut monétaire
create or replace function public.get_exercise_monetization_status(p_exercise_id uuid)
returns jsonb
language plpgsql
security definer
as $func$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_company_name text;
  v_free_used boolean;
  v_is_full boolean;
  v_gen_type text;
  v_user_credits int;
begin
  select e.company_id, c.nom, c.free_generation_used, e.is_full_version, coalesce(e.generation_type, 'none')
  into v_company_id, v_company_name, v_free_used, v_is_full, v_gen_type
  from public.exercises e
  join public.companies c on c.id = e.company_id
  where e.id = p_exercise_id and (e.created_by = v_user_id or public.is_app_admin());

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Dossier introuvable ou non autorisé.');
  end if;

  select coalesce(credits_balance, 0) into v_user_credits
  from public.profiles where id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'exercise_id', p_exercise_id,
    'company_id', v_company_id,
    'company_name', v_company_name,
    'free_available', not coalesce(v_free_used, false),
    'is_full_version', coalesce(v_is_full, false),
    'generation_type', v_gen_type,
    'user_credits', coalesce(v_user_credits, 0)
  );
end;
$func$;

-- 5.2 Débit / Réservation atomique sécurisée
create or replace function public.consume_generation_credit(
  p_exercise_id uuid,
  p_requested_mode text
)
returns jsonb
language plpgsql
security definer
as $func$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_free_used boolean;
  v_is_full boolean;
  v_current_credits int;
  v_new_credits int;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Session utilisateur invalide.');
  end if;

  select e.company_id, e.is_full_version, c.free_generation_used
  into v_company_id, v_is_full, v_free_used
  from public.exercises e
  join public.companies c on c.id = e.company_id
  where e.id = p_exercise_id and (e.created_by = v_user_id or public.is_app_admin())
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Dossier introuvable.');
  end if;

  if coalesce(v_is_full, false) then
    return jsonb_build_object('ok', true, 'mode', 'full', 'charged', 0, 'message', 'Dossier déjà débloqué.');
  end if;

  if p_requested_mode = 'free' then
    if coalesce(v_free_used, false) then
      return jsonb_build_object('ok', false, 'error', 'Le crédit gratuit a déjà été utilisé pour cette entreprise.');
    end if;

    update public.companies
    set free_generation_used = true, free_generation_exercise_id = p_exercise_id
    where id = v_company_id;

    update public.exercises
    set generation_type = 'free', is_full_version = false
    where id = p_exercise_id;

    select coalesce(credits_balance, 0) into v_current_credits from public.profiles where id = v_user_id;

    insert into public.credit_ledger (user_id, company_id, exercise_id, montant_credits, solde_apres, motif, commentaire)
    values (v_user_id, v_company_id, p_exercise_id, 0, v_current_credits, 'free_generation', 'Génération gratuite d''évaluation');

    return jsonb_build_object('ok', true, 'mode', 'free', 'charged', 0);
  end if;

  if p_requested_mode = 'paid' then
    select credits_balance into v_current_credits
    from public.profiles where id = v_user_id for update;

    if coalesce(v_current_credits, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'Solde de crédits insuffisant. Veuillez recharger votre compte.');
    end if;

    v_new_credits := v_current_credits - 1;

    update public.profiles
    set credits_balance = v_new_credits
    where id = v_user_id;

    update public.exercises
    set generation_type = 'paid', is_full_version = true
    where id = p_exercise_id;

    insert into public.credit_ledger (user_id, company_id, exercise_id, montant_credits, solde_apres, motif, commentaire)
    values (v_user_id, v_company_id, p_exercise_id, -1, v_new_credits, 'generation_complete', 'Déblocage liasse complète DGID');

    return jsonb_build_object('ok', true, 'mode', 'full', 'charged', 1, 'solde', v_new_credits);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Mode de génération inconnu.');
end;
$func$;

-- 5.3 Attribution manuelle de crédits par l'administrateur
create or replace function public.admin_adjust_credits(
  p_target_user_id uuid,
  p_credits_delta int,
  p_motif text
)
returns jsonb
language plpgsql
security definer
as $func$
declare
  v_old_balance int;
  v_new_balance int;
begin
  if not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'error', 'Action réservée aux administrateurs.');
  end if;

  select coalesce(credits_balance, 0) into v_old_balance
  from public.profiles where id = p_target_user_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Utilisateur introuvable.');
  end if;

  v_new_balance := v_old_balance + p_credits_delta;
  if v_new_balance < 0 then
    v_new_balance := 0;
  end if;

  update public.profiles set credits_balance = v_new_balance where id = p_target_user_id;

  insert into public.credit_ledger (user_id, montant_credits, solde_apres, motif, commentaire)
  values (p_target_user_id, p_credits_delta, v_new_balance, 'admin_adjustment', coalesce(p_motif, 'Ajustement manuel admin'));

  return jsonb_build_object('ok', true, 'new_balance', v_new_balance);
end;
$func$;

-- 5.4 Validation d'un paiement et attribution des crédits correspondants
create or replace function public.complete_payment(
  p_payment_id uuid
)
returns jsonb
language plpgsql
security definer
as $func$
declare
  v_user_id uuid;
  v_credits int;
  v_status text;
  v_package_id text;
  v_old_balance int;
  v_new_balance int;
begin
  select user_id, credits_achetes, statut, package_id
  into v_user_id, v_credits, v_status, v_package_id
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Paiement introuvable.');
  end if;

  if v_status = 'completed' then
    return jsonb_build_object('ok', true, 'message', 'Paiement déjà validé.');
  end if;

  select coalesce(credits_balance, 0) into v_old_balance
  from public.profiles where id = v_user_id for update;

  v_new_balance := coalesce(v_old_balance, 0) + v_credits;

  update public.profiles set credits_balance = v_new_balance where id = v_user_id;

  update public.payments
  set statut = 'completed', updated_at = timezone('utc'::text, now())
  where id = p_payment_id;

  insert into public.credit_ledger (user_id, montant_credits, solde_apres, motif, payment_id, commentaire)
  values (v_user_id, v_credits, v_new_balance, 'purchase', p_payment_id, 'Achat ' || coalesce(v_package_id, 'crédits'));

  return jsonb_build_object('ok', true, 'new_balance', v_new_balance, 'credits_added', v_credits);
end;
$func$;
