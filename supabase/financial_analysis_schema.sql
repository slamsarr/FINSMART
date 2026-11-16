-- ====================================================================
-- FINSMART – Module Analyse Financière Intelligente Premium V1.0
-- Migration Supabase : Tables, index et politiques de sécurité RLS
-- ====================================================================

-- 1. Table principale des analyses financières
create table if not exists public.financial_analyses (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  company_id uuid references public.companies(id) on delete cascade not null,
  exercise_id uuid references public.exercises(id) on delete cascade not null,
  created_by uuid references auth.users(id) not null,
  
  -- Niveau d'analyse : 'express' (3-5p), 'professionnel' (15-25p), 'expert' (approfondi + scénarios)
  analysis_level text not null default 'professionnel',
  
  -- Version du moteur d'analyse
  engine_version text not null default '1.0.0',
  
  -- Instantané des données sources N et N-1 utilisées
  source_snapshot jsonb not null default '{}'::jsonb,
  
  -- Catalogue des 100 indicateurs calculés avec valeurs N, N-1, variations et statuts
  metrics jsonb not null default '{}'::jsonb,
  
  -- Audit des 20 contrôles de cohérence et journal des anomalies
  controls_audit jsonb not null default '{}'::jsonb,
  
  -- Score de santé financière sur 100 et décomposition par piliers
  health_score jsonb not null default '{"total": 0, "piliers": {}, "mention": "Non évalué"}'::jsonb,
  
  -- Synthèse et commentaires générés par l'IA (ou personnalisés par l'utilisateur)
  ai_commentary jsonb not null default '{}'::jsonb,
  
  -- Recommandations stratégiques et opérationnelles (Court, Moyen, Long terme)
  recommendations jsonb not null default '[]'::jsonb,
  
  -- Simulations et scénarios prévisionnels N+1 (Prudent, Central, Favorable)
  scenarios jsonb not null default '{}'::jsonb,
  
  -- Statut de validation : 'brouillon', 'valide', 'archive'
  status text not null default 'valide',
  
  -- Métadonnées complémentaires (nom fichier export, options, logs)
  metadata jsonb default '{}'::jsonb,

  constraint uq_exercise_analysis_level unique(exercise_id, analysis_level)
);

-- Index pour optimiser la recherche par société et exercice
create index if not exists idx_financial_analyses_company on public.financial_analyses(company_id);
create index if not exists idx_financial_analyses_exercise on public.financial_analyses(exercise_id);
create index if not exists idx_financial_analyses_created_by on public.financial_analyses(created_by);

-- 2. Trigger de mise à jour automatique de updated_at
create or replace function public.touch_financial_analysis_updated_at()
returns trigger 
language plpgsql
as $func$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$func$;

drop trigger if exists on_financial_analysis_updated on public.financial_analyses;
create trigger on_financial_analysis_updated
  before update on public.financial_analyses
  for each row execute procedure public.touch_financial_analysis_updated_at();

-- 3. Sécurité Row Level Security (RLS)
alter table public.financial_analyses enable row level security;

-- Politique d'accès en lecture : propriétaire de la société, créateur ou admin
drop policy if exists "Financial analyses: select owner, creator or admin" on public.financial_analyses;
create policy "Financial analyses: select owner, creator or admin" on public.financial_analyses
  for select using (
    created_by = auth.uid() or 
    public.is_app_admin() or 
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_id = auth.uid()
    )
  );

-- Politique d'insertion : utilisateur authentifié sur sa propre société
drop policy if exists "Financial analyses: insert owner, creator or admin" on public.financial_analyses;
create policy "Financial analyses: insert owner, creator or admin" on public.financial_analyses
  for insert with check (
    created_by = auth.uid() or 
    public.is_app_admin() or 
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_id = auth.uid()
    )
  );

-- Politique de mise à jour : propriétaire ou admin
drop policy if exists "Financial analyses: update owner, creator or admin" on public.financial_analyses;
create policy "Financial analyses: update owner, creator or admin" on public.financial_analyses
  for update using (
    created_by = auth.uid() or 
    public.is_app_admin() or 
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_id = auth.uid()
    )
  );

-- Politique de suppression : propriétaire ou admin
drop policy if exists "Financial analyses: delete owner, creator or admin" on public.financial_analyses;
create policy "Financial analyses: delete owner, creator or admin" on public.financial_analyses
  for delete using (
    created_by = auth.uid() or 
    public.is_app_admin() or 
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_id = auth.uid()
    )
  );
