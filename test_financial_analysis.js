/**
 * Test unitaire et fonctionnel du Module Analyse Financière Intelligente Premium V1.0
 * Vérifie le catalogue des 100 indicateurs, les 20 contrôles et le score de santé.
 */

import { extractFinancialSnapshot } from './js/financial-analysis/financial-extractor.js';
import { computeFinancialMetrics } from './js/financial-analysis/financial-metrics.js';
import { runFinancialControls } from './js/financial-analysis/financial-controls.js';

console.log('--- TEST DU MODULE ANALYSE FINANCIÈRE ---');

// Mock représentatif d'une entreprise sénégalaise en croissance (chiffres en FCFA)
const mockValues = {
  'COMPTE DE RESULTAT': {
    'E8': 150000000, 'F8': 130000000, // Ventes marchandises
    'E9': 105000000, 'F9': 92000000,  // Achats marchandises
    'E10': -2000000, 'F10': 1000000,  // Var stocks march
    'E11': 43000000, 'F11': 39000000, // Marge commerciale
    'E12': 80000000, 'F12': 70000000, // Ventes prod fab
    'E13': 20000000, 'F13': 15000000, // Travaux services
    'E14': 5000000,  'F14': 4000000,  // Prod accessoires
    'E15': 255000000, 'F15': 219000000, // CA Total (+16.4%)
    'E21': 40000000, 'F21': 35000000, // Achats mat 1eres
    'E25': 8000000,  'F25': 7000000,  // Transports
    'E26': 22000000, 'F26': 19000000, // Serv ext
    'E27': 4000000,  'F27': 3500000,  // Impots taxes
    'E28': 3000000,  'F28': 2500000,  // Autres charges
    'E29': 68000000, 'F29': 58000000, // Valeur Ajoutée
    'E30': 35000000, 'F30': 30000000, // Personnel
    'E31': 33000000, 'F31': 28000000, // EBE
    'E32': 2000000,  'F32': 1500000,  // Reprises
    'E33': 11000000, 'F33': 9500000,  // Dotations
    'E34': 24000000, 'F34': 20000000, // Résultat Exploitation
    'E35': 1000000,  'F35': 800000,   // Revenus fin
    'E38': 4500000,  'F38': 4000000,  // Frais fin
    'E40': -3500000, 'F40': -3200000, // Résultat financier
    'E41': 20500000, 'F41': 16800000, // RAO
    'E42': 500000,   'F42': 0,
    'E43': 200000,   'F43': 100000,
    'E44': 300000,   'F44': 0,
    'E45': 100000,   'F45': 50000,
    'E46': 300000,   'F46': 50000,    // RHAO
    'E47': 0,        'F47': 0,
    'E48': 6000000,  'F48': 4800000,  // Impot résultat
    'E49': 14800000, 'F49': 12050000, // Résultat net (+22.8%)
  },
  'BILAN PAYSAGE': {
    // Actif
    'D24': 120000000, 'E24': 45000000, 'F24': 75000000, 'G24': 68000000, // Immo net
    'F25': 2000000,   'G25': 1500000,  // AC HAO
    'F26': 28000000,  'G26': 24000000, // Stocks
    'F28': 1500000,   'G28': 1000000,  // Fourn avances
    'F29': 38000000,  'G29': 32000000, // Clients
    'F30': 4500000,   'G30': 3500000,  // Autres créances
    'F27': 44000000,  'G27': 36500000, // Créances tot
    'F31': 74000000,  'G31': 62000000, // Actif circulant tot
    'F32': 5000000,   'G32': 4000000,  // Titres placement
    'F33': 1000000,   'G33': 500000,
    'F34': 18000000,  'G34': 14500000, // Banques / caisses
    'F35': 24000000,  'G35': 19000000, // Trésorerie Actif
    'F36': 0,         'G36': 0,
    'F37': 173000000, 'G37': 149000000, // Total Actif
    // Passif
    'K9': 20000000,   'L9': 20000000,  // Capital
    'K11': 0,         'L11': 0,
    'K12': 0,         'L12': 0,
    'K13': 2000000,   'L13': 2000000,  // Réserves
    'K14': 24000000,  'L14': 17000000,
    'K15': 3200000,   'L15': 2150000,  // Report à nouveau
    'K16': 14800000,  'L16': 12050000, // Résultat Net Bilan (= CR)
    'K17': 0,         'L17': 0,
    'K18': 0,         'L18': 0,
    'K19': 64000000,  'L19': 53200000, // Total Capitaux Propres
    'K20': 42000000,  'L20': 38000000, // Emprunts
    'K21': 0,         'L21': 0,
    'K22': 2000000,   'L22': 1500000,
    'K23': 44000000,  'L23': 39500000, // Total Dettes Fin
    'K24': 108000000, 'L24': 92700000, // Ressources Stables (64M + 44M)
    'K25': 1500000,   'L25': 1000000,  // Passif circ HAO
    'K26': 2000000,   'L26': 1500000,  // Clients avances reçues
    'K27': 36000000,  'L27': 31000000, // Fournisseurs
    'K28': 14000000,  'L28': 12000000, // Dettes fiscales et soc
    'K29': 4500000,   'L29': 3800000,  // Autres dettes
    'K30': 0,         'L30': 0,
    'K31': 58000000,  'L31': 49300000, // Passif Circulant Total
    'K33': 0,         'L33': 0,
    'K34': 7000000,   'L34': 7000000,  // Découverts / Tréso Passif
    'K35': 7000000,   'L35': 7000000,  // Total Trésorerie Passif
    'K36': 0,         'L36': 0,
    'K37': 173000000, 'L37': 149000000, // Total Passif (= 173M)
  },
  'FLUX DE TRESORERIE': {
    'E8': 12000000,   'F8': 9500000,   // Trésorerie d'ouverture (19M - 7M = 12M)
    'E10': 23800000,  'F10': 20050000, // CAFG
    'E11': -500000,   'E12': -4000000, 'E13': -6000000, 'E14': 7000000,
    'E16': 20300000,  'F16': 17500000, // Flux Opérationnels
    'E18': 0, 'E19': 15000000, 'E20': 0, // Investissements (15M)
    'E21': 500000, 'E22': 0,
    'E23': -14500000, 'F23': -12000000, // Flux Investissement
    'E25': 0, 'E26': 0, 'E27': 0,
    'E28': 4000000,   'F28': 3000000,  // Dividendes
    'E31': 8000000,   'E32': 0,        // Nouveaux emprunts (8M)
    'E33': 4800000,                    // Remboursements emprunts (4.8M)
    'E35': -800000,   'F35': -3000000, // Flux Financement (-4M div + 8M emp - 4.8M remb = -800k)
    'E36': 5000000,   'F36': 2500000,  // Var Nette Tréso (20.3M - 14.5M - 0.8M = 5.0M)
    'E37': 17000000,  'F37': 12000000, // Tréso clôture (12M + 5M = 17M = 24M actif - 7M passif)
  }
};

const mockInfos = {
  denomination: 'SOCIETE EXEMPLE SA',
  ninea: '0012345 2V3',
  rccm: 'SN-DKR-2020-B-1000',
  fin: '2025-12-31',
  finPrec: '2024-12-31',
  dureePrec: 12,
  activite: 'Commerce et Prestations de services informatiques',
  effectifs: { 'i0B': 2, 'i1B': 4, 'i2B': 8, 'i3B': 10 } // 24 salariés
};

// 1. Extraction du snapshot
const snapshot = extractFinancialSnapshot({ values: mockValues, infos: mockInfos });
console.log('1. Snapshot extrait avec succès pour :', snapshot.metadata.denomination);
console.log('   CA N :', snapshot.cr.chiffreAffaires.n, 'FCFA');
console.log('   Total Actif N :', snapshot.bilan.totalGeneralActif.n, 'FCFA');
console.log('   FRNG N :', snapshot.equilibre.frng.n, 'FCFA');
console.log('   BFR Global N :', snapshot.equilibre.bfrGlobal.n, 'FCFA');
console.log('   Trésorerie Nette N :', snapshot.equilibre.tresorerieNette.n, 'FCFA');

// 2. Calcul des 100 métriques
const metricsResult = computeFinancialMetrics(snapshot);
console.log('\n2. Catalogue des métriques calculé :');
console.log('   Nombre total d\'indicateurs :', metricsResult.count);
console.log('   Indicateurs calculables :', metricsResult.computableCount);
console.log('   Nombre de familles :', Object.keys(metricsResult.families).length);

// Affichage d'échantillons clés
const indCA = metricsResult.metricsMap.get('IND_01');
const indCroissCA = metricsResult.metricsMap.get('IND_02');
const indROE = metricsResult.metricsMap.get('IND_24');
const indROA = metricsResult.metricsMap.get('IND_25');
const indDuPont = metricsResult.metricsMap.get('IND_29');
const indFRNG = metricsResult.metricsMap.get('IND_41');
const indTN = metricsResult.metricsMap.get('IND_45');
const indDetteNette = metricsResult.metricsMap.get('IND_54');
const indFCF = metricsResult.metricsMap.get('IND_68');
const indDSO = metricsResult.metricsMap.get('IND_72');
const indDPO = metricsResult.metricsMap.get('IND_73');
const indCCC = metricsResult.metricsMap.get('IND_74');

console.log('   - Croissance CA :', indCroissCA.valN, '%');
console.log('   - ROE :', indROE.valN, '% | Statut :', indROE.status);
console.log('   - ROA :', indROA.valN, '%');
console.log('   - Décomposition DuPont :', indDuPont.interpretation);
console.log('   - FRNG :', indFRNG.valN, 'FCFA | TN :', indTN.valN, 'FCFA');
console.log('   - Dette Financière Nette :', indDetteNette.valN, 'FCFA');
console.log('   - Free Cash Flow :', indFCF.valN, 'FCFA');
console.log('   - DSO (Clients) :', indDSO.valN, 'jours');
console.log('   - DPO (Fournisseurs) :', indDPO.valN, 'jours');
console.log('   - Cycle de cash CCC :', indCCC.valN, 'jours');

// 3. Contrôles de cohérence et score de santé
const controlsResult = runFinancialControls(snapshot, metricsResult);
console.log('\n3. Contrôles de cohérence et Score de santé :');
console.log('   Total contrôles exécutés :', controlsResult.stats.totalControls);
console.log('   Contrôles conformes (OK) :', controlsResult.stats.ok);
console.log('   Avertissements :', controlsResult.stats.avertissements);
console.log('   Anomalies bloquantes :', controlsResult.stats.bloquants);
console.log('   Est validé :', controlsResult.stats.estValide ? 'OUI (Conforme)' : 'NON');
console.log('\n   SCORE DE SANTÉ FINANCIÈRE :', controlsResult.healthScore.total, '/ 100');
console.log('   Mention :', controlsResult.healthScore.mention);
console.log('   Détail par pilier :');
for (const [k, p] of Object.entries(controlsResult.healthScore.piliers)) {
  console.log(`     * ${p.label} : ${p.score} / ${p.max} pts`);
}

if (metricsResult.count === 100 && controlsResult.stats.totalControls === 20 && controlsResult.stats.estValide) {
  console.log('\n>>> TOUS LES TESTS SONT VALIDES AVEC SUCCÈS (100 INDICATEURS + 20 CONTRÔLES) ! <<<');
  process.exit(0);
} else {
  console.error('\n>>> ERREUR LORS DU TEST ! <<<');
  process.exit(1);
}
