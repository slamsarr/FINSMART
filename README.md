# FINSMART – SaaS « États financiers DGID »

Application web : vos clients créent un compte, déposent la **balance N** et la **balance N-1**, complètent les informations de la liasse, puis téléchargent **modele_etats_financiers_DGID (Nouveau).xlsx** déjà rempli (valeurs uniquement, aucune formule, onglets d'origine inchangés).

## Fonctionnement

| Étape | Ce que fait l'application |
|---|---|
| 1. Entreprise | Création de l'entreprise (dénomination, NINEA, RCCM…) et de l'exercice. |
| 2. Balances | Lecture des balances au format 6 colonnes : `Compte · Intitulé · Solde ant Dbt · Solde ant Cdt · Débit période · Crédit période`. Contrôle de l'équilibre, des comptes non numériques, des doublons et des lignes de total. Les fichiers sont archivés dans Supabase. |
| 3. Informations | Formulaire reprenant la feuille « Saisie infos » du moteur : identification, signature, fiche R2, banques, activités, dirigeants, conseil d'administration, capital (note 13), effectifs et masse salariale (note 27B). Enregistrement automatique. |
| 4. Liasse | Le moteur rejoue **toutes les formules de SEN_ETAFI _DGID.xlsx** (table de correspondance, bilan, compte de résultat, TFT, notes, contrôles), puis écrit les valeurs dans le modèle DGID. Affichage des chiffres clés, des 30 contrôles de cohérence et des comptes signalés. |

L'espace **Administration** (visible uniquement par souleymane.aw@gmail.com) liste tous les dossiers, avec le téléchargement des balances et des liasses et la modification du statut.

## Mise en ligne (10 minutes)

1. **Hébergement du site** : le dossier `app` est un site statique. Le plus simple : <https://app.netlify.com/drop>, puis glisser-déposer le dossier `app`. Vercel, Cloudflare Pages ou GitHub Pages conviennent aussi. Un double-clic sur `index.html` ne suffit pas : le site doit être servi en http(s).
2. **Supabase** (projet « États Financiers SYSCOHADA », déjà configuré) : dans *Authentication → URL Configuration*, mettre l'adresse du site dans **Site URL** et dans **Redirect URLs** (liens de confirmation d'email et de réinitialisation du mot de passe).
3. Créer votre compte sur le site avec **souleymane.aw@gmail.com** : il reçoit automatiquement le rôle administrateur.

## Base de données (déjà appliquée)

- `profiles.is_admin` + table privée `app_admins` (ajouter une ligne pour un nouvel administrateur).
- `exercises.infos` (formulaire), `exercises.rapport` (contrôles), `exercises.generated_at`.
- Stockage : `balances/<entreprise>/<dossier>/…` et `etats/<entreprise>/<dossier>/…`. Chaque client ne voit que les fichiers de ses entreprises ; l'administrateur voit tout.
- Correction de sécurité : les anciennes règles laissaient tout utilisateur connecté lire les fichiers de tous les clients. Elles sont remplacées.

## Mettre à jour le moteur ou le modèle

Si vous modifiez `SEN_ETAFI _DGID.xlsx` (table de correspondance, formules) ou le modèle DGID :

```bash
pip install openpyxl
python build/extract_engine.py "SEN_ETAFI _DGID.xlsx" "modele_etats_financiers_DGID (Nouveau).xlsx" app/engine.json
copy "modele_etats_financiers_DGID (Nouveau).xlsx" app/modele_DGID.xlsx
```

Puis republier le dossier `app`. Les onglets du modèle doivent garder la même disposition que ceux du moteur, cellule pour cellule.

## Fichiers

- `index.html`, `css/styles.css` : interface.
- `js/app.js` : écrans, Supabase, téléchargements.
- `js/liasse.js` : lecture des balances, champs de saisie, contrôles.
- `js/formula-engine.js` : évaluateur des formules Excel du moteur.
- `js/xlsx-filler.js` : écriture des valeurs dans le modèle DGID, en conservant la mise en forme.
- `js/worker.js` : calcul en arrière-plan.
- `js/config.js` : URL et clé publique Supabase.
- `engine.json` : moteur extrait. `modele_DGID.xlsx` : modèle officiel vierge.
- `vendor/` : supabase-js 2.45.4, JSZip 3.10.1, SheetJS 0.18.5, embarqués localement.

## Validation effectuée

- 12 747 cellules du moteur recalculées en JavaScript et comparées au recalcul du classeur : toutes identiques, sauf 3 listes FILTER (dans « Contrôles balances » et « Piste d'audit ») que l'outil de comparaison ne savait pas calculer. Ces listes ne sont pas reprises dans la liasse.
- Liasse produite avec les balances d'exemple (OMEGA SARL) : 55 onglets, 0 formule, total actif = total passif = 33 056 232 691 FCFA. Le fichier s'ouvre et s'imprime correctement.

## Limite connue

Le calcul se fait dans le navigateur du client. Le moteur (`engine.json`) est donc téléchargé par le navigateur et reste lisible par un utilisateur averti. Pour protéger entièrement la méthode, il faudrait déplacer le calcul sur un serveur, avec le même code.

