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

/**
 * Normalise une balance lue par SheetJS (tableau de lignes).
 * @returns {{rows:any[][], errors:string[], warnings:string[], totals:object}}
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
  const tot = { sad: 0, sac: 0, md: 0, mc: 0 };
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
    if (amts.some(a => a !== null && a < 0)) warnings.push(`${label} compte ${accStr} : montant négatif (vérifier le sens).`);
    if (seen.has(accStr)) warnings.push(`${label} : compte ${accStr} en double (lignes ${seen.get(accStr)} et ${i + 1}).`);
    seen.set(accStr, i + 1);
    rows.push([acc, String(lib).trim(), ...amts]);
    tot.sad += amts[0] || 0; tot.sac += amts[1] || 0; tot.md += amts[2] || 0; tot.mc += amts[3] || 0;
  }
  if (!rows.length) errors.push(`${label} : aucune ligne de compte lue.`);
  if (rows.length > 5000) errors.push(`${label} : ${rows.length} comptes, capacité maximale 5 000.`);
  const ecartOuv = Math.round(tot.sad - tot.sac), ecartMvt = Math.round(tot.md - tot.mc);
  if (Math.abs(ecartOuv) >= 1) errors.push(`${label} déséquilibrée : soldes d'ouverture débit – crédit = ${fmt(ecartOuv)} FCFA.`);
  if (Math.abs(ecartMvt) >= 1) errors.push(`${label} déséquilibrée : mouvements débit – crédit = ${fmt(ecartMvt)} FCFA.`);
  return { rows, errors, warnings, totals: { ...tot, comptes: rows.length } };
}
export const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));

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
      if (g(sheet, 'R' + r) === 'ANOMALIE') msgs.push(`solde de sens anormal (attendu ${g(sheet, 'Q' + r)})`);
      if (g(sheet, 'S' + r) === 'NON CONFORME') msgs.push('racine absente du plan révisé');
      const k = g(sheet, 'K' + r); if (isErr(wb.getAddr(sheet, 'K' + r)) || k === '#N/A') msgs.push('compte non classé dans la table de correspondance');
      const t = g(sheet, 'T' + r); if (t) msgs.push(t.replace(/ ;\s*$/, ''));
      if (sheet === 'Balance N') { const p = g(sheet, 'P' + r); if (typeof p === 'number' && Math.abs(p) > 0.5) msgs.push(`ouverture N ≠ clôture N-1 (écart ${fmt(p)})`); }
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
