-- ====================================================================
-- MISE À JOUR DES TARIFS DES PACKS FINSMART
-- À exécuter dans l'éditeur SQL de votre Dashboard Supabase
-- ====================================================================

-- 1. Désactive les anciens packs
update public.credit_packages set is_active = false;

-- 2. Insère ou met à jour les 4 packs officiels
insert into public.credit_packages (id, nom, credits, prix_fcfa, prix_unitaire_fcfa, economie_pct, description, is_active, sort_order)
values 
  ('unit', 'Génération à l''unité', 1, 20000, 20000, 0, '1 génération complète officielle avec toutes les 36 notes et fiches', true, 1),
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
