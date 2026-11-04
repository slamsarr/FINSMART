-- ====================================================================
-- FINSMART – Schéma Supabase complet (PostgreSQL + RLS + Triggers)
-- À exécuter dans : Supabase Dashboard > SQL Editor > New query
-- ====================================================================

-- 1. Table des administrateurs autorisés
create table if not exists public.app_admins (
  email text primary key,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Insérez votre email administrateur principal ici :
insert into public.app_admins (email)
values 
  ('souleymane.aw@gmail.com')
on conflict (email) do nothing;

-- 2. Table des profils utilisateurs
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  nom_complet text,
  telephone text,
  email text,
  is_admin boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 3. Trigger pour synchroniser auth.users avec public.profiles
create or replace function public.handle_new_user()
returns trigger 
language plpgsql 
security definer
as $func$
begin
  insert into public.profiles (id, nom_complet, telephone, email, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nom_complet', ''),
    coalesce(new.raw_user_meta_data->>'telephone', ''),
    new.email,
    exists(select 1 from public.app_admins a where lower(a.email) = lower(new.email))
  )
  on conflict (id) do update set
    nom_complet = excluded.nom_complet,
    telephone = excluded.telephone,
    email = excluded.email,
    is_admin = exists(select 1 from public.app_admins a where lower(a.email) = lower(new.email));
    
  return new;
end;
$func$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Table des entreprises
create table if not exists public.companies (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  owner_id uuid references auth.users(id) on delete cascade not null,
  nom text not null,
  ninea text not null,
  rc text,
  forme_juridique text,
  adresse text,
  telephone text,
  email_contact text
);

-- 5. Table des exercices / dossiers
create table if not exists public.exercises (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  company_id uuid references public.companies(id) on delete cascade not null,
  created_by uuid references auth.users(id) not null,
  exercice text not null,
  date_debut date,
  date_fin date not null,
  statut text default 'en_attente',
  infos jsonb default '{}'::jsonb,
  rapport jsonb default '{}'::jsonb,
  generated_at timestamp with time zone,
  nb_comptes int,
  total_debit bigint,
  total_credit bigint,
  balance_equilibree boolean,
  ecart_balance bigint,
  sig_chiffre_affaires bigint,
  sig_valeur_ajoutee bigint,
  sig_excedent_brut bigint,
  sig_resultat_exploitation bigint,
  sig_resultat_net bigint,
  avertissements text[],
  constraint uq_company_exercise unique(company_id, exercice)
);

-- Trigger pour mettre à jour exercises.updated_at
create or replace function public.touch_exercise_updated_at()
returns trigger 
language plpgsql
as $func$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$func$;

drop trigger if exists on_exercise_updated on public.exercises;
create trigger on_exercise_updated
  before update on public.exercises
  for each row execute procedure public.touch_exercise_updated_at();

-- 6. Table des fichiers attachés aux exercices
create table if not exists public.exercise_files (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  exercise_id uuid references public.exercises(id) on delete cascade not null,
  type text not null, -- 'balance_n', 'balance_n1', 'etats_complet_xlsx'
  storage_path text not null,
  nom_original text not null,
  taille_octets bigint,
  mime_type text
);

-- ====================================================================
-- SÉCURITÉ ROW LEVEL SECURITY (RLS)
-- ====================================================================
alter table public.app_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_files enable row level security;

-- Fonction pour vérifier si l'utilisateur est admin
create or replace function public.is_app_admin()
returns boolean 
language sql 
security definer
as $func$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  );
$func$;

-- RLS Profiles
drop policy if exists "Profiles: select self or admin" on public.profiles;
create policy "Profiles: select self or admin" on public.profiles
  for select using (auth.uid() = id or public.is_app_admin());

drop policy if exists "Profiles: update self" on public.profiles;
create policy "Profiles: update self" on public.profiles
  for update using (auth.uid() = id);

-- RLS Companies
drop policy if exists "Companies: manage by owner or admin" on public.companies;
create policy "Companies: manage by owner or admin" on public.companies
  for all using (auth.uid() = owner_id or public.is_app_admin())
  with check (auth.uid() = owner_id or public.is_app_admin());

-- RLS Exercises
drop policy if exists "Exercises: manage by creator or admin" on public.exercises;
create policy "Exercises: manage by creator or admin" on public.exercises
  for all using (auth.uid() = created_by or public.is_app_admin())
  with check (auth.uid() = created_by or public.is_app_admin());

-- RLS Exercise files
drop policy if exists "Exercise files: manage linked exercise" on public.exercise_files;
create policy "Exercise files: manage linked exercise" on public.exercise_files
  for all using (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and (e.created_by = auth.uid() or public.is_app_admin())
    )
  )
  with check (
    exists (
      select 1 from public.exercises e
      where e.id = exercise_id and (e.created_by = auth.uid() or public.is_app_admin())
    )
  );

-- ====================================================================
-- STORAGE BUCKETS (balances et etats)
-- ====================================================================
insert into storage.buckets (id, name, public)
values 
  ('balances', 'balances', false),
  ('etats', 'etats', false)
on conflict (id) do update set public = false;

-- Politiques Storage
drop policy if exists "Storage balances: access by authenticated" on storage.objects;
create policy "Storage balances: access by authenticated" on storage.objects
  for all using (
    bucket_id in ('balances', 'etats') and auth.role() = 'authenticated'
  )
  with check (
    bucket_id in ('balances', 'etats') and auth.role() = 'authenticated'
  );
