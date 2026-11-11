/*
 * FINSMART – Montage de la liasse SYSCOHADA (modèle DGID Sen-etafi)
 * 1. lit les balances N et N-1 (format 6 colonnes FINSMART)
 * 2. alimente le moteur SEN_ETAFI (Balance N, Balance N-1, Saisie infos)
 * 3. calcule les états et les contrôles
 * 4. écrit les VALEURS dans modele_etats_financiers_DGID (Nouveau).xlsx
 */
import { Workbook, isErr } from './formula-engine.js';
import { fillModele } from './xlsx-filler.js';

export const BALANCE_COLUMNS = ['Compte', 'Intitulé', 'Solde ant Dbt', 'Solde ant Cdt', 'Débit période', 'Crédit période'];

// ------------------------------------------------------------------ balances
function cleanAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).trim().replace(/[\s  ]/g, '');
  if (s === '' || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  if (isNaN(n)) return NaN;
  return neg ? -n : n;
}

export const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));

/**
 * Analyse de conformité comptable selon les normes officielles du SYSCOHADA révisé (AUDCIF).
 * @param {Array<Array|object>} rows - Liste des lignes (tableau [compte, intitule, sad, sac, md, mc] ou objet {acc, lib, sad, sac, md, mc})
 * @param {string} label - Libellé de la balance ('Balance N' ou 'Balance N-1')
 * @returns {{ errors: string[], warnings: string[], sysAlerts: Array<object>, totals: object, rowAlertsMap: Map<string, Array<object>> }}
 */
export function checkSyscohadaRules(rows, label = 'Balance') {
  const errors = [];
  const warnings = [];
  const sysAlerts = [];
  const rowAlertsMap = new Map();

  function addAlert(accStr, alert) {
    sysAlerts.push(alert);
    if (!rowAlertsMap.has(accStr)) rowAlertsMap.set(accStr, []);
    rowAlertsMap.get(accStr).push(alert);
    if (alert.type === 'error') errors.push(alert.fullMessage);
    else warnings.push(alert.fullMessage);
  }

  let sadTot = 0, sacTot = 0, mdTot = 0, mcTot = 0;
  let clDebTot = 0, clCdtTot = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const accRaw = Array.isArray(r) ? r[0] : r.acc;
    const libRaw = Array.isArray(r) ? r[1] : r.lib;
    const sad = Number(Array.isArray(r) ? r[2] : r.sad) || 0;
    const sac = Number(Array.isArray(r) ? r[3] : r.sac) || 0;
    const md = Number(Array.isArray(r) ? r[4] : r.md) || 0;
    const mc = Number(Array.isArray(r) ? r[5] : r.mc) || 0;

    const accStr = String(accRaw ?? '').trim().replace(/\s/g, '');
    const lib = String(libRaw ?? '').trim();

    sadTot += sad;
    sacTot += sac;
    mdTot += md;
    mcTot += mc;

    const netCloture = (sad - sac) + (md - mc);
    if (netCloture > 0) clDebTot += netCloture;
    else if (netCloture < 0) clCdtTot += Math.abs(netCloture);

    // 1. Contrôle de format et conformité numérique du compte
    if (!/^\d{2,}$/.test(accStr)) {
      addAlert(accStr, {
        type: 'error',
        code: 'NUM_INVALIDE',
        rule: 'SYSCOHADA Codification',
        compte: accStr || '(vide)',
        libelle: lib,
        badgeText: 'Compte invalide',
        message: `Compte « ${accStr || '(vide)'} » invalide : doit comporter au moins 2 chiffres numériques.`,
        fullMessage: `${label} : compte « ${accStr || '(vide)'} » non conforme (doit comporter au moins 2 chiffres numériques).`
      });
      continue;
    }

    // 2. Contrôle des montants négatifs (interdits en balance générale SYSCOHADA)
    if (sad < 0 || sac < 0 || md < 0 || mc < 0) {
      addAlert(accStr, {
        type: 'warning',
        code: 'MONTANT_NEGATIF',
        rule: 'SYSCOHADA Règles de Tenue',
        compte: accStr,
        libelle: lib,
        badgeText: 'Montant négatif',
        message: `Montant négatif détecté. En SYSCOHADA, tout montant doit être imputé en valeur positive au débit ou au crédit.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Règles de Tenue] Montant négatif interdit en balance générale (à imputer en valeur positive au Débit ou Crédit).`
      });
    }

    // 3. Soldes d'ouverture sur comptes de gestion (Classes 6, 7 et 8)
    if (/^[678]/.test(accStr) && (Math.abs(sad) > 0.01 || Math.abs(sac) > 0.01)) {
      addAlert(accStr, {
        type: 'warning',
        code: 'GESTION_OUVERTURE',
        rule: 'SYSCOHADA Comptes de Gestion',
        compte: accStr,
        libelle: lib,
        badgeText: 'Gestion au 01/01',
        message: `Solde d'ouverture non nul au 01/01 (${fmt(sad || sac)} FCFA). Les comptes de charges et produits doivent être soldés à l'ouverture.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Comptes de Gestion] Solde d'ouverture non nul (${fmt(sad || sac)} FCFA). Les charges et produits doivent être soldés au 01/01.`
      });
    }

    // 4. Compte de Caisse (57) : solde créditeur strictement interdit
    if (accStr.startsWith('57') && netCloture < -0.01) {
      addAlert(accStr, {
        type: 'error',
        code: 'CAISSE_CREDITRICE',
        rule: 'SYSCOHADA Norme Trésorerie (Compte 57)',
        compte: accStr,
        libelle: lib,
        badgeText: 'Caisse créditrice',
        message: `Solde de clôture créditeur de ${fmt(Math.abs(netCloture))} FCFA. Une caisse physique ne peut JAMAIS être créditrice en SYSCOHADA.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Compte 57 - Caisse] Solde créditeur de ${fmt(Math.abs(netCloture))} FCFA INTERDIT. Une caisse physique ne peut décaisser plus d'espèces qu'elle n'en détient.`
      });
    }

    // 5. Comptes d'amortissements (28x) et dépréciations (29x, 39x, 49x, 59x) : solde débiteur interdit
    if (/^(28|29|39|49|59)/.test(accStr) && netCloture > 0.01) {
      addAlert(accStr, {
        type: 'warning',
        code: 'SOUSTRACTIF_DEBITEUR',
        rule: 'SYSCOHADA Comptes Soustractifs',
        compte: accStr,
        libelle: lib,
        badgeText: 'Amort./Dépréc. débiteur',
        message: `Solde net débiteur (${fmt(netCloture)} FCFA). En SYSCOHADA, les amortissements et dépréciations d'actif doivent obligatoirement être créditeurs ou nuls.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Comptes Soustractifs] Solde anormalement débiteur (${fmt(netCloture)} FCFA). Les amortissements (28) et dépréciations d'actif doivent être créditeurs ou nuls.`
      });
    }

    // 6. Actifs bruts (Classes 2 et 3 hors 28/29/39) : solde brut créditeur interdit
    if (/^[23]/.test(accStr) && !/^(28|29|39)/.test(accStr) && netCloture < -0.01) {
      addAlert(accStr, {
        type: 'warning',
        code: 'ACTIF_BRUT_CREDITEUR',
        rule: 'SYSCOHADA Actif Immobilisé & Stocks',
        compte: accStr,
        libelle: lib,
        badgeText: 'Actif brut créditeur',
        message: `Solde brut créditeur (${fmt(Math.abs(netCloture))} FCFA). La valeur brute d'un actif physique ou immobilisé ne peut être négative.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Actifs Bruts] Solde brut créditeur (${fmt(Math.abs(netCloture))} FCFA). La valeur d'acquisition d'une immobilisation ou d'un stock ne peut être créditrice.`
      });
    }

    // 7. Règle de non-compensation (AUDCIF Art. 34 alinéa 3)
    // Fournisseurs (401) débiteurs -> reclassement 409
    if (accStr.startsWith('401') && netCloture > 0.01) {
      addAlert(accStr, {
        type: 'reclassement',
        code: 'NON_COMPENSATION_FOURNISSEUR',
        rule: 'SYSCOHADA AUDCIF Art. 34 (Non-compensation)',
        compte: accStr,
        libelle: lib,
        badgeText: '💡 Reclassement 409',
        message: `Solde débiteur de ${fmt(netCloture)} FCFA. Reclassement recommandé au compte 409 (Fournisseurs débiteurs : avances et acomptes versés).`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA AUDCIF Art. 34 - Non-compensation] Solde fournisseur débiteur (${fmt(netCloture)} FCFA). Reclassement recommandé au compte 409 (Avances versées).`
      });
    }
    // Clients (411) créditeurs -> reclassement 419
    if (accStr.startsWith('411') && netCloture < -0.01) {
      addAlert(accStr, {
        type: 'reclassement',
        code: 'NON_COMPENSATION_CLIENT',
        rule: 'SYSCOHADA AUDCIF Art. 34 (Non-compensation)',
        compte: accStr,
        libelle: lib,
        badgeText: '💡 Reclassement 419',
        message: `Solde créditeur de ${fmt(Math.abs(netCloture))} FCFA. Reclassement recommandé au compte 419 (Clients créditeurs : avances et acomptes reçus).`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA AUDCIF Art. 34 - Non-compensation] Solde client créditeur (${fmt(Math.abs(netCloture))} FCFA). Reclassement recommandé au compte 419 (Avances reçues).`
      });
    }

    // 8. Sens des comptes de gestion (Charges classe 6 et Produits classe 7)
    if (accStr.startsWith('6') && !accStr.startsWith('603') && netCloture < -0.01) {
      addAlert(accStr, {
        type: 'warning',
        code: 'CHARGE_CREDITRICE',
        rule: 'SYSCOHADA Comptes de Charges',
        compte: accStr,
        libelle: lib,
        badgeText: 'Charge créditrice',
        message: `Solde net créditeur (${fmt(Math.abs(netCloture))} FCFA). Un compte de charges doit normalement présenter un solde débiteur.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Comptes de Charges] Solde net créditeur (${fmt(Math.abs(netCloture))} FCFA). Un compte de charges est normalement débiteur.`
      });
    }
    if (accStr.startsWith('7') && !/^(73|709|719|729)/.test(accStr) && netCloture > 0.01) {
      addAlert(accStr, {
        type: 'warning',
        code: 'PRODUIT_DEBITEUR',
        rule: 'SYSCOHADA Comptes de Produits',
        compte: accStr,
        libelle: lib,
        badgeText: 'Produit débiteur',
        message: `Solde net débiteur (${fmt(netCloture)} FCFA). Un compte de produits doit normalement présenter un solde créditeur.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Comptes de Produits] Solde net débiteur (${fmt(netCloture)} FCFA). Un compte de produits est normalement créditeur.`
      });
    }

    // 9. Racines proscrites / obsolètes du SYSCOHADA Révisé
    if (accStr.startsWith('20')) {
      addAlert(accStr, {
        type: 'warning',
        code: 'COMPTE_PROSCRIT_20',
        rule: 'SYSCOHADA Révisé (Comptes proscrits)',
        compte: accStr,
        libelle: lib,
        badgeText: 'Racine 20 supprimée',
        message: `La racine 20 (Frais d'établissement) a été supprimée dans le SYSCOHADA révisé (frais comptabilisés directement en charges).`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Révisé] Racine 20 supprimée (frais d'établissement à constater directement en charges).`
      });
    }
    if (accStr.startsWith('74') || accStr.startsWith('76')) {
      addAlert(accStr, {
        type: 'warning',
        code: 'COMPTE_PROSCRIT_74_76',
        rule: 'SYSCOHADA Révisé (Comptes proscrits)',
        compte: accStr,
        libelle: lib,
        badgeText: `Racine ${accStr.slice(0, 2)} supprimée`,
        message: `La racine ${accStr.slice(0, 2)} a été supprimée dans le SYSCOHADA révisé (à reclasser en 70, 75 ou 77).`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Révisé] Racine ${accStr.slice(0, 2)} supprimée (à reclasser vers 70, 75 ou 77 selon la nature).`
      });
    }
    if (accStr.startsWith('9')) {
      addAlert(accStr, {
        type: 'warning',
        code: 'CLASSE_9',
        rule: 'SYSCOHADA Révisé (Classe 9)',
        compte: accStr,
        libelle: lib,
        badgeText: 'Classe 9 analytique',
        message: `Les comptes de classe 9 (analytique) ne font pas partie de la liasse financière officielle.`,
        fullMessage: `${label} compte ${accStr} (${lib}) : [SYSCOHADA Révisé] Les comptes de classe 9 (analytique) doivent être exclus de la balance générale des états financiers.`
      });
    }
  }

  // 10. Contrôle d'équilibre global
  const ecartOuv = Math.round(sadTot - sacTot);
  const ecartMvt = Math.round(mdTot - mcTot);
  const ecartCloture = Math.round(clDebTot - clCdtTot);

  if (Math.abs(ecartOuv) >= 1) {
    errors.push(`${label} déséquilibrée : [SYSCOHADA AUDCIF Art. 34] Soldes d'ouverture Débit – Crédit = ${fmt(ecartOuv)} FCFA (le bilan d'ouverture doit être rigoureusement équilibré).`);
  }
  if (Math.abs(ecartMvt) >= 1) {
    errors.push(`${label} déséquilibrée : [SYSCOHADA AUDCIF Art. 17] Principe de la partie double non respecté (Mouvements Débit – Crédit = ${fmt(ecartMvt)} FCFA).`);
  }

  return {
    errors,
    warnings,
    sysAlerts,
    rowAlertsMap,
    totals: {
      sad: sadTot,
      sac: sacTot,
      md: mdTot,
      mc: mcTot,
      clDebTot,
      clCdtTot,
      ecartOuv,
      ecartMvt,
      ecartCloture,
      comptes: rows.length
    }
  };
}

/**
 * Normalise une balance lue par SheetJS (tableau de lignes).
 * @returns {{rows:any[][], errors:string[], warnings:string[], sysAlerts:Array<object>, totals:object}}
 */
export function parseBalance(aoa, label = 'Balance') {
  const errors = [], warnings = [];
  // ligne d'en-tête = première ligne dont la 1re cellule contient « compte »
  let h = aoa.findIndex(r => r && r.some(c => typeof c === 'string' && /compte/i.test(c)));
  if (h < 0) { warnings.push(`${label} : en-tête « Compte » introuvable, lecture à partir de la 1re ligne.`); h = -1; }
  else {
    const hdr = aoa[h].map(x => String(x ?? '').toLowerCase());
    const ok = /compte/.test(hdr[0]) && /intitul|libell/.test(hdr[1] || '') && /d[ée]?b/.test(hdr[2] || '') && /cr[ée]?d|cdt/.test(hdr[3] || '') && /d[ée]?b/.test(hdr[4] || '') && /cr[ée]?d|cdt/.test(hdr[5] || '');
    if (!ok) errors.push(`${label} : colonnes attendues dans cet ordre : ${BALANCE_COLUMNS.join(' | ')}.`);
  }
  const rows = []; const seen = new Map();
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (r.slice(0, 6).every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    let acc = r[0], lib = r[1] ?? '';
    const accStr = String(acc ?? '').trim().replace(/\s/g, '');
    if (!/^\d+$/.test(accStr)) {
      if (/total/i.test(String(lib)) || /total/i.test(accStr) || accStr === '') { warnings.push(`${label} ligne ${i + 1} ignorée (ligne de total ou sans compte).`); continue; }
      errors.push(`${label} ligne ${i + 1} : compte non numérique « ${acc} ».`); continue;
    }
    if (accStr.length < 2) { warnings.push(`${label} ligne ${i + 1} ignorée (compte de classe/total « ${accStr} »).`); continue; }
    acc = Number(accStr);
    const amts = r.slice(2, 6).map(cleanAmount);
    if (amts.some(a => Number.isNaN(a))) { errors.push(`${label} ligne ${i + 1} (compte ${accStr}) : montant illisible.`); continue; }
    if (seen.has(accStr)) warnings.push(`${label} : compte ${accStr} en double (lignes ${seen.get(accStr)} et ${i + 1}).`);
    seen.set(accStr, i + 1);
    rows.push([acc, String(lib).trim(), ...amts]);
  }
  if (!rows.length) errors.push(`${label} : aucune ligne de compte lue.`);
  if (rows.length > 5000) errors.push(`${label} : ${rows.length} comptes, capacité maximale 5 000.`);

  // Validation approfondie selon les règles du SYSCOHADA révisé (AUDCIF)
  const sysCheck = checkSyscohadaRules(rows, label);
  errors.push(...sysCheck.errors);
  warnings.push(...sysCheck.warnings);

  return {
    rows,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    sysAlerts: sysCheck.sysAlerts,
    rowAlertsMap: sysCheck.rowAlertsMap,
    totals: sysCheck.totals
  };
}

// ------------------------------------------------------------------ informations complémentaires
// cellule de la feuille « Saisie infos » ; type : text | date | int | num | code | select
export const INFO_SECTIONS = [
  { id: 'ident', title: "Identification de l'entreprise", fields: [
    { k: 'denomination', cell: 'B5', label: "Dénomination sociale (ou nom et prénoms de l'exploitant)", req: true },
    { k: 'sigle', cell: 'B6', label: 'Sigle usuel', req: true },
    { k: 'adresse', cell: 'B7', label: 'Adresse complète', req: true },
    { k: 'ninea', cell: 'B8', label: "N° d'identification fiscale (NINEA)", req: true, ph: 'ex. 0012345 2V3' },
    { k: 'centre', cell: 'B9', label: 'Centre de dépôt', req: true, type: 'select', options: ['DGE', 'CME Dakar Plateau', 'CME Dakar Liberté', 'CME Pikine', 'CME Thiès', 'CME Rufisque', 'Centre des services fiscaux (CSF)', 'Autre'] },
    { k: 'debut', cell: 'B10', label: "Début de l'exercice", type: 'date', req: true },
    { k: 'fin', cell: 'B11', label: "Fin de l'exercice (clos le)", type: 'date', req: true },
    { k: 'arrete', cell: 'B13', label: "Date d'arrêté effectif des comptes", type: 'date' },
    { k: 'finPrec', cell: 'B14', label: 'Exercice précédent clos le', type: 'date' },
    { k: 'dureePrec', cell: 'B15', label: "Durée de l'exercice précédent (mois)", type: 'int' },
    { k: 'paysGreffe', cell: 'B16', label: 'Code pays du greffe', ph: 'SN' },
    { k: 'rccm', cell: 'B17', label: 'N° registre du commerce (RCCM)', req: true, ph: 'SN-DKR-2015-B-12345' },
    { k: 'repertoire', cell: 'B18', label: 'N° répertoire des entreprises' },
    { k: 'caisse', cell: 'B19', label: 'N° de caisse sociale (IPRES / CSS)', req: true },
    { k: 'importateur', cell: 'B20', label: 'N° code importateur' },
    { k: 'codeActivite', cell: 'B21', label: 'Code activité principale', req: true, type: 'activity' },
    { k: 'tel', cell: 'B22', label: 'Téléphone' },
    { k: 'email', cell: 'B23', label: 'Email' },
    { k: 'codePostal', cell: 'B24', label: 'Code postal' },
    { k: 'bp', cell: 'B25', label: 'Boîte postale' },
    { k: 'ville', cell: 'B26', label: 'Ville' },
    { k: 'adresseGeo', cell: 'B27', label: 'Adresse géographique (immeuble, rue, quartier…)' },
    { k: 'activite', cell: 'B28', label: "Désignation précise de l'activité principale", req: true },
  ] },
  { id: 'contacts', title: 'Contacts, certification et signature', fields: [
    { k: 'contact', cell: 'B31', label: 'Personne à contacter (nom, adresse, qualité)' },
    { k: 'cabinet', cell: 'B32', label: 'Professionnel / cabinet ayant établi les états financiers' },
    { k: 'cac', cell: 'B33', label: 'Commissaire(s) aux comptes (noms et adresses)' },
    { k: 'certifies', cell: 'B34', label: 'États financiers certifiés', type: 'select', options: ['Non assujettie', 'Non (refus)', 'Oui avec réserves', 'Oui sans réserves'] },
    { k: 'approuves', cell: 'B35', label: "Approuvés par l'Assemblée Générale", type: 'select', options: ['Non assujettie', 'Non', 'Oui'] },
    { k: 'signataire', cell: 'B36', label: 'Nom du signataire', req: true },
    { k: 'qualiteSignataire', cell: 'B37', label: 'Qualité du signataire', req: true },
    { k: 'dateSignature', cell: 'B38', label: 'Date de signature', type: 'date', req: true },
  ] },
  { id: 'r2', title: 'Renseignements généraux (fiche R2)', fields: [
    { k: 'formeJur', cell: 'B50', label: 'Forme juridique (code à 2 chiffres)', type: 'code', ph: '00' },
    { k: 'regime', cell: 'B51', label: 'Régime fiscal (code à 2 chiffres)', type: 'code', ph: '00' },
    { k: 'paysSiege', cell: 'B52', label: 'Pays du siège social (code à 2 chiffres)', type: 'code', ph: '00' },
    { k: 'nbEtab', cell: 'B53', label: "Nombre d'établissements dans le pays", type: 'int' },
    { k: 'nbEtabHors', cell: 'B54', label: "Nombre d'établissements hors du pays", type: 'int' },
    { k: 'anneeDebut', cell: 'B55', label: "1ère année d'exercice dans le pays (AAAA)", type: 'code', ph: '2010' },
    { k: 'controle', cell: 'B56', label: "Contrôle de l'entreprise", type: 'select', options: ['Contrôle public', 'Contrôle privé national', 'Contrôle privé étranger'] },
  ] },
];
// tableaux : lignes répétées
export const INFO_TABLES = [
  { k: 'banques', title: 'Domiciliations bancaires', row0: 41, rows: 7, cols: [['A', 'Banque'], ['B', 'Numéro de compte']] },
  { k: 'activites', title: "Activités (R2) – répartition du chiffre d'affaires", row0: 59, rows: 8, cols: [['A', 'Désignation'], ['B', 'Code nomenclature (6 chiffres)', 'code'], ['C', 'CA HT ou VA HT (FCFA)', 'num']] },
  { k: 'dirigeants', title: 'Dirigeants (R3)', row0: 71, rows: 15, cols: [['A', 'Nom'], ['B', 'Prénoms'], ['C', 'Qualité'], ['D', 'N° identification fiscale'], ['E', 'Adresse (BP, ville, pays)']] },
  { k: 'administrateurs', title: "Membres du conseil d'administration (R3)", row0: 88, rows: 14, cols: [['A', 'Nom'], ['B', 'Prénoms'], ['C', 'Qualité'], ['D', 'Adresse (BP, ville, pays)']] },
  { k: 'associes', title: 'Capital – associés (Note 13)', row0: 105, rows: 9, cols: [['A', 'Noms et prénoms'], ['B', 'Nationalité'], ['C', 'Nature des actions ou parts'], ['D', 'Nombre', 'num'], ['E', 'Montant total (FCFA)', 'num'], ['F', 'Cessions / remboursements', 'num']] },
];
export const INFO_EXTRA = [
  { k: 'nominal', cell: 'B103', label: 'Valeur nominale des actions ou parts (FCFA)', type: 'num' },
  { k: 'capitalNonAppele', cell: 'E114', label: 'Apporteurs, capital non appelé (FCFA)', type: 'num' },
];
const EFF_COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
export const EFFECTIFS = {
  title: 'Effectifs et masse salariale (Note 27B)',
  colLabels: ['Nat. H', 'Nat. F', 'OHADA H', 'OHADA F', 'Hors OHADA H', 'Hors OHADA F'],
  categories: ['Cadres supérieurs', 'Techniciens sup. et cadres moyens', 'Techniciens, agents de maîtrise, ouvriers qualifiés', 'Employés, manœuvres, ouvriers, apprentis', 'dont saisonniers'],
  interneRows: [121, 122, 123, 124, 126], externeRows: [129, 130, 131, 132, 134],
};

function toSerial(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
}
function coerce(v, type) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (type === 'date') return toSerial(String(v));
  if (type === 'int' || type === 'num') { const n = cleanAmount(v); return Number.isNaN(n) ? String(v) : n; }
  return String(v).trim();
}
/** infos (objet plat du formulaire) -> liste [cellule, valeur] de « Saisie infos » */
export function infosToCells(infos = {}) {
  const out = [];
  for (const s of INFO_SECTIONS) for (const f of s.fields) out.push([f.cell, coerce(infos[f.k], f.type)]);
  for (const f of INFO_EXTRA) out.push([f.cell, coerce(infos[f.k], f.type)]);
  for (const t of INFO_TABLES) {
    const rows = infos[t.k] || [];
    for (let i = 0; i < t.rows; i++) for (const [col, , type] of t.cols) out.push([col + (t.row0 + i), coerce(rows[i] && rows[i][col], type || 'text')]);
  }
  const eff = infos.effectifs || {};
  EFFECTIFS.interneRows.forEach((r, i) => EFF_COLS.forEach(c => out.push([c + r, coerce(eff[`i${i}${c}`], 'num')])));
  EFFECTIFS.externeRows.forEach((r, i) => EFF_COLS.slice(0, 7).forEach(c => out.push([c + r, coerce(eff[`e${i}${c}`], 'num')])));
  return out;
}

// ------------------------------------------------------------------ calcul
export function buildWorkbook(engine, balN, balN1, infos) {
  const wb = new Workbook(engine);
  for (const [sheet, rows] of [['Balance N', balN], ['Balance N-1', balN1]]) {
    rows.forEach((row, i) => row.forEach((v, j) => wb.setValue(sheet, { r: 7 + i, c: 1 + j }, v)));
    wb.setUsedRow(sheet, 6 + rows.length);
  }
  for (const [cell, v] of infosToCells(infos)) wb.setValue('Saisie infos', cell, v);
  return wb;
}

const num = v => (typeof v === 'number' ? v : 0);
export function readResults(wb) {
  const g = (s, a) => { const v = wb.getAddr(s, a); return isErr(v) ? v.err : v; };
  const controls = [];
  for (let r = 5; r <= 38; r++) {
    const code = g('Contrôles balances', 'A' + r), libelle = g('Contrôles balances', 'B' + r), type = g('Contrôles balances', 'C' + r);
    if (!libelle) continue;
    if (!type) { controls.push({ section: true, code, libelle }); continue; }
    controls.push({ code, libelle, type, n: g('Contrôles balances', 'D' + r), n1: g('Contrôles balances', 'E' + r), statut: g('Contrôles balances', 'F' + r) });
  }
  // anomalies par compte (colonnes R, S, T, P des balances)
  const anomalies = [];
  for (const sheet of ['Balance N', 'Balance N-1']) {
    const last = wb.sheets[sheet].usedRow || 6;
    for (let r = 7; r <= last; r++) {
      const acc = g(sheet, 'A' + r); if (acc === null || acc === '') continue;
      const msgs = [];
      if (g(sheet, 'R' + r) === 'ANOMALIE') msgs.push(`[SYSCOHADA Révisé] Solde de sens anormal (attendu ${g(sheet, 'Q' + r)})`);
      if (g(sheet, 'S' + r) === 'NON CONFORME') msgs.push('[SYSCOHADA Révisé] Racine de compte absente de la nomenclature officielle');
      const k = g(sheet, 'K' + r); if (isErr(wb.getAddr(sheet, 'K' + r)) || k === '#N/A') msgs.push('[SYSCOHADA / DGID] Compte non classé dans la table de correspondance Sen-etafi');
      const t = g(sheet, 'T' + r); if (t) msgs.push(t.replace(/ ;\s*$/, ''));
      if (sheet === 'Balance N') { const p = g(sheet, 'P' + r); if (typeof p === 'number' && Math.abs(p) > 0.5) msgs.push(`[SYSCOHADA AUDCIF Art. 34] Intangibilité du bilan d'ouverture non respectée (Ouverture N ≠ Clôture N-1, écart ${fmt(p)} FCFA)`); }
      if (msgs.length) anomalies.push({ balance: sheet === 'Balance N' ? 'N' : 'N-1', compte: acc, intitule: g(sheet, 'B' + r), solde: num(g(sheet, 'H' + r)), messages: msgs });
    }
  }
  const tb = 'Tableau de bord';
  const kf = [];
  for (let r = 12; r <= 21; r++) { const l = g(tb, 'B' + r); if (l) kf.push({ libelle: l, n: g(tb, 'C' + r), n1: g(tb, 'D' + r), variation: g(tb, 'E' + r) }); }
  return {
    bloquants: num(g(tb, 'F5')), vigilance: num(g(tb, 'F6')), infosManquantes: num(g(tb, 'F7')),
    pret: String(g(tb, 'G8')).includes('OUI'),
    chiffresCles: kf, controls, anomalies,
    sig: {
      ca: num(g('COMPTE DE RESULTAT', 'E15')), va: num(g('COMPTE DE RESULTAT', 'E29')), ebe: num(g('COMPTE DE RESULTAT', 'E31')),
      re: num(g('COMPTE DE RESULTAT', 'E34')), rn: num(g('COMPTE DE RESULTAT', 'E49')),
      totalActif: num(g('BILAN PAYSAGE', 'F37')), totalPassif: num(g('BILAN PAYSAGE', 'K37')),
    },
    warnings: [...new Set(wb.warnings)],
  };
}

/** valeurs à écrire dans le modèle : { feuille: {adresse: valeur} } */
export function collectValues(wb, engine) {
  const out = {};
  for (const [sheet, list] of Object.entries(engine.targets)) {
    const o = (out[sheet] = {});
    for (const a of list) o[a] = wb.getAddr(sheet, a);
  }
  return out;
}

/**
 * Chaîne complète.
 * @param {{engine:object, modeleBytes:ArrayBuffer, balN:any[][], balN1:any[][], infos:object, deps:object}} p
 */
export async function genererLiasse({ engine, modeleBytes, balN, balN1, infos, deps }) {
  const t0 = Date.now();
  const wb = buildWorkbook(engine, balN, balN1, infos);
  const values = collectValues(wb, engine);
  const results = readResults(wb);
  const { bytes, written, skippedErrors } = await fillModele(modeleBytes, values, deps);
  results.cellulesEcrites = written;
  results.erreursCellules = skippedErrors;
  results.dureeMs = Date.now() - t0;
  return { bytes, results };
}

export function nomFichier(infos) {
  const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const an = infos.fin ? infos.fin.slice(0, 4) : '';
  return [clean(infos.ninea) || 'NINEA', clean(infos.denomination) || 'Entreprise', 'EF', an].filter(Boolean).join('_') + '.xlsx';
}
