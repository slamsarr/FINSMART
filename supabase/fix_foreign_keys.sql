-- ====================================================================
-- FINSMART – Correction des clés étrangères pour PostgREST
-- À exécuter dans : Supabase Dashboard > SQL Editor
-- ====================================================================

-- 1. Lier payments.user_id à public.profiles(id)
alter table public.payments 
  drop constraint if exists payments_user_id_fkey;

alter table public.payments 
  add constraint payments_user_id_fkey 
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 2. Lier credit_ledger.user_id à public.profiles(id)
alter table public.credit_ledger 
  drop constraint if exists credit_ledger_user_id_fkey;

alter table public.credit_ledger 
  add constraint credit_ledger_user_id_fkey 
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 3. Recharger le cache du schéma PostgREST
notify pgrst, 'reload schema';
