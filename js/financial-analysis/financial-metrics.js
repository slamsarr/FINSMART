/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur 2 : Catalogue déterministe des 100 indicateurs financiers (10 familles)
 * 
 * Règles impératives :
 * - Calculs strictement déterministes (aucune hallucination IA).
 * - Sécurisation absolue des divisions par zéro et bases nulles ou négatives.
 * - Respect des conventions SYSCOHADA AUDCIF et du modèle officiel DGID Sen-etafi.
 */

// Helper sécurisé pour les divisions
function safeDiv(num, den, fallback = null) {
  if (den === null || den === undefined || isNaN(den) || Math.abs(den) < 0.000001) return fallback;
  if (num === null || num === undefined || isNaN(num)) return fallback;
  return num / den;
}

// Calcul de variation relative propre avec gestion des bases négatives
function calcVar(n, n1) {
  if (n === null || n1 === null || n === undefined || n1 === undefined) {
    return { abs: null, pct: null, points: null, note: 'Données insuffisantes' };
  }
  const abs = n - n1;
  if (Math.abs(n1) < 0.000001) {
    return { abs, pct: null, points: null, note: n !== 0 ? 'Base N-1 nulle' : 'Inchangé' };
  }
  // Si passage d'une perte à un bénéfice ou inversement
  if (n1 < 0 && n > 0) {
    return { abs, pct: null, points: null, note: 'Passage d\'un solde négatif à positif' };
  }
  if (n1 > 0 && n < 0) {
    return { abs, pct: null, points: null, note: 'Passage d\'un solde positif à négatif' };
  }
  const pct = (abs / Math.abs(n1)) * 100;
  return { abs, pct: Math.round(pct * 100) / 100, points: null, note: null };
}

// Variation en points de pourcentage pour les taux / ratios exprimés en %
function calcVarPoints(tN, tN1) {
  if (tN === null || tN1 === null) return { abs: null, pct: null, points: null, note: null };
  const points = Math.round((tN - tN1) * 100) / 100;
  return { abs: points, pct: null, points, note: `${points > 0 ? '+' : ''}${points} pts` };
}

/**
 * Calcule l'intégralité du catalogue des 100 indicateurs financiers à partir du snapshot.
 * @param {object} snap - Données extraites par financial-extractor.js
 * @returns {{ metrics: Array<object>, metricsMap: Map<string, object>, families: object }}
 */
export function computeFinancialMetrics(snap) {
  const { cr, bilan, tft, equilibre, social, metadata } = snap;
  const metrics = [];
  const metricsMap = new Map();

  function registerMetric(m) {
    metrics.push(m);
    metricsMap.set(m.id, m);
  }

  const dureeMois = metadata.dureeMois || 12;
  const nbJours = Math.round((dureeMois / 12) * 365);

  // =========================================================================
  // FAMILLE 1 : ACTIVITÉ ET CROISSANCE (1 à 10)
  // =========================================================================
  const caN = cr.chiffreAffaires.n;
  const caN1 = cr.chiffreAffaires.n1;
  const varCA = calcVar(caN, caN1);

  registerMetric({
    id: 'IND_01', family: 'Activité et croissance', num: 1,
    code: 'CA', label: 'Chiffre d\'affaires total',
    unit: 'FCFA', valN: caN, valN1: caN1, varAbs: varCA.abs, varPct: varCA.pct,
    formula: 'Ventes marchandises + Produits fabriqués + Services + Produits accessoires (Réf XB)',
    computable: true,
    status: varCA.pct !== null ? (varCA.pct >= 0 ? 'favorable' : 'alerte') : 'neutre',
    interpretation: varCA.pct !== null 
      ? `Le chiffre d'affaires affiche une ${varCA.pct >= 0 ? 'progression' : 'régression'} de ${Math.abs(varCA.pct)}% par rapport à N-1.`
      : `Le chiffre d'affaires s'établit à ${Math.round(caN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_02', family: 'Activité et croissance', num: 2,
    code: 'TX_CROISS_CA', label: 'Taux de croissance du chiffre d\'affaires',
    unit: '%', valN: varCA.pct, valN1: null, varAbs: null, varPct: null,
    formula: '(CA_N - CA_N-1) / CA_N-1 * 100',
    computable: varCA.pct !== null,
    status: varCA.pct !== null ? (varCA.pct > 5 ? 'favorable' : varCA.pct >= 0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: varCA.pct !== null ? `Croissance annuelle de ${varCA.pct}%.` : 'Non calculable (base N-1 nulle ou non comparable).'
  });

  const vmN = cr.ventesMarchandises.n; const vmN1 = cr.ventesMarchandises.n1;
  registerMetric({
    id: 'IND_03', family: 'Activité et croissance', num: 3,
    code: 'VTE_MARCH', label: 'Ventes de marchandises',
    unit: 'FCFA', valN: vmN, valN1: vmN1, varAbs: vmN - vmN1, varPct: calcVar(vmN, vmN1).pct,
    formula: 'Compte de résultat Réf TA',
    computable: true,
    status: 'neutre',
    interpretation: `Activité commerciale de négoce : ${Math.round(vmN).toLocaleString('fr-FR')} FCFA.`
  });

  const vpfN = cr.ventesProduitsFabriques.n; const vpfN1 = cr.ventesProduitsFabriques.n1;
  registerMetric({
    id: 'IND_04', family: 'Activité et croissance', num: 4,
    code: 'VTE_PROD_FAB', label: 'Ventes de produits fabriqués',
    unit: 'FCFA', valN: vpfN, valN1: vpfN1, varAbs: vpfN - vpfN1, varPct: calcVar(vpfN, vpfN1).pct,
    formula: 'Compte de résultat Réf TB',
    computable: true,
    status: 'neutre',
    interpretation: `Production vendue : ${Math.round(vpfN).toLocaleString('fr-FR')} FCFA.`
  });

  const tsvN = cr.travauxServicesVendus.n; const tsvN1 = cr.travauxServicesVendus.n1;
  registerMetric({
    id: 'IND_05', family: 'Activité et croissance', num: 5,
    code: 'TRAV_SERV_VEND', label: 'Travaux et services vendus',
    unit: 'FCFA', valN: tsvN, valN1: tsvN1, varAbs: tsvN - tsvN1, varPct: calcVar(tsvN, tsvN1).pct,
    formula: 'Compte de résultat Réf TC',
    computable: true,
    status: 'neutre',
    interpretation: `Prestations de services et travaux : ${Math.round(tsvN).toLocaleString('fr-FR')} FCFA.`
  });

  const paN = cr.produitsAccessoires.n; const paN1 = cr.produitsAccessoires.n1;
  registerMetric({
    id: 'IND_06', family: 'Activité et croissance', num: 6,
    code: 'PROD_ACC', label: 'Produits accessoires',
    unit: 'FCFA', valN: paN, valN1: paN1, varAbs: paN - paN1, varPct: calcVar(paN, paN1).pct,
    formula: 'Compte de résultat Réf TD',
    computable: true,
    status: 'neutre',
    interpretation: `Revenus annexes de l'exploitation : ${Math.round(paN).toLocaleString('fr-FR')} FCFA.`
  });

  const pvmN = safeDiv(vmN * 100, caN); const pvmN1 = safeDiv(vmN1 * 100, caN1);
  registerMetric({
    id: 'IND_07', family: 'Activité et croissance', num: 7,
    code: 'POIDS_MARCH', label: 'Poids des ventes de marchandises dans le CA',
    unit: '%', valN: pvmN !== null ? Math.round(pvmN * 10) / 10 : null, valN1: pvmN1 !== null ? Math.round(pvmN1 * 10) / 10 : null,
    varAbs: calcVarPoints(pvmN, pvmN1).points, varPct: null,
    formula: 'Ventes marchandises / CA * 100',
    computable: pvmN !== null,
    status: 'neutre',
    interpretation: pvmN !== null ? `Le négoce représente ${Math.round(pvmN)}% du chiffre d'affaires global.` : 'Non calculable'
  });

  const pvpfN = safeDiv(vpfN * 100, caN); const pvpfN1 = safeDiv(vpfN1 * 100, caN1);
  registerMetric({
    id: 'IND_08', family: 'Activité et croissance', num: 8,
    code: 'POIDS_PROD_FAB', label: 'Poids des produits fabriqués dans le CA',
    unit: '%', valN: pvpfN !== null ? Math.round(pvpfN * 10) / 10 : null, valN1: pvpfN1 !== null ? Math.round(pvpfN1 * 10) / 10 : null,
    varAbs: calcVarPoints(pvpfN, pvpfN1).points, varPct: null,
    formula: 'Ventes produits fabriqués / CA * 100',
    computable: pvpfN !== null,
    status: 'neutre',
    interpretation: pvpfN !== null ? `L'activité industrielle/fabrication représente ${Math.round(pvpfN)}% du CA.` : 'Non calculable'
  });

  const ptsvN = safeDiv(tsvN * 100, caN); const ptsvN1 = safeDiv(tsvN1 * 100, caN1);
  registerMetric({
    id: 'IND_09', family: 'Activité et croissance', num: 9,
    code: 'POIDS_SERVICES', label: 'Poids des services et travaux dans le CA',
    unit: '%', valN: ptsvN !== null ? Math.round(ptsvN * 10) / 10 : null, valN1: ptsvN1 !== null ? Math.round(ptsvN1 * 10) / 10 : null,
    varAbs: calcVarPoints(ptsvN, ptsvN1).points, varPct: null,
    formula: 'Travaux et services vendus / CA * 100',
    computable: ptsvN !== null,
    status: 'neutre',
    interpretation: ptsvN !== null ? `Les prestations de services représentent ${Math.round(ptsvN)}% de l'activité.` : 'Non calculable'
  });

  // Contribution de l'activité principale à la variation de CA
  const contribPrinc = varCA.abs && Math.abs(varCA.abs) > 0 ? Math.round(safeDiv(Math.max(vmN - vmN1, vpfN - vpfN1, tsvN - tsvN1) * 100, varCA.abs) || 0) : null;
  registerMetric({
    id: 'IND_10', family: 'Activité et croissance', num: 10,
    code: 'CONTRIB_CROISS', label: 'Contribution du premier pôle à la variation de CA',
    unit: '%', valN: contribPrinc, valN1: null, varAbs: null, varPct: null,
    formula: 'Variation du pôle moteur / Variation totale CA * 100',
    computable: contribPrinc !== null,
    status: 'neutre',
    interpretation: contribPrinc !== null ? `Le pôle commercial le plus dynamique a contribué à hauteur de ${contribPrinc}% à l'évolution du chiffre d'affaires.` : 'Incalculable'
  });

  // =========================================================================
  // FAMILLE 2 : SOLDES INTERMÉDIAIRES DE GESTION (11 à 20)
  // =========================================================================
  const mbN = cr.margeCommerciale.n; const mbN1 = cr.margeCommerciale.n1;
  const txMbN = safeDiv(mbN * 100, vmN); const txMbN1 = safeDiv(mbN1 * 100, vmN1);
  registerMetric({
    id: 'IND_11', family: 'Soldes intermédiaires de gestion', num: 11,
    code: 'MARGE_COMM', label: 'Marge commerciale brute',
    unit: 'FCFA', valN: mbN, valN1: mbN1, varAbs: mbN - mbN1, varPct: calcVar(mbN, mbN1).pct,
    formula: 'Ventes marchandises - Achats marchandises -/+ Var stocks marchandises (Réf XA)',
    computable: true,
    status: mbN > 0 ? 'favorable' : mbN === 0 ? 'neutre' : 'alerte',
    interpretation: mbN >= 0 ? `Marge brute commerciale de ${Math.round(mbN).toLocaleString('fr-FR')} FCFA.` : 'Marge commerciale négative (vente à perte détectée).'
  });

  registerMetric({
    id: 'IND_12', family: 'Soldes intermédiaires de gestion', num: 12,
    code: 'TX_MARGE_COMM', label: 'Taux de marge commerciale',
    unit: '%', valN: txMbN !== null ? Math.round(txMbN * 10) / 10 : null, valN1: txMbN1 !== null ? Math.round(txMbN1 * 10) / 10 : null,
    varAbs: calcVarPoints(txMbN, txMbN1).points, varPct: null,
    formula: 'Marge commerciale / Ventes de marchandises * 100',
    computable: txMbN !== null,
    status: txMbN !== null ? (txMbN >= 20 ? 'favorable' : txMbN >= 10 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txMbN !== null ? `Taux de marge sur coût d'achat de ${Math.round(txMbN)}%.` : 'Non applicable (pas d\'activité de négoce).'
  });

  const vaN = cr.valeurAjoutee.n; const vaN1 = cr.valeurAjoutee.n1;
  const txVaN = safeDiv(vaN * 100, caN); const txVaN1 = safeDiv(vaN1 * 100, caN1);
  registerMetric({
    id: 'IND_13', family: 'Soldes intermédiaires de gestion', num: 13,
    code: 'VALEUR_AJOUTEE', label: 'Valeur Ajoutée (VA)',
    unit: 'FCFA', valN: vaN, valN1: vaN1, varAbs: vaN - vaN1, varPct: calcVar(vaN, vaN1).pct,
    formula: 'Marge commerciale + Chiffre d\'affaires + Production - Consommations intermédiaires (Réf XC)',
    computable: true,
    status: vaN > 0 ? 'favorable' : 'alerte',
    interpretation: vaN > 0 ? `Création de richesse économique brute de ${Math.round(vaN).toLocaleString('fr-FR')} FCFA.` : 'Destruction de valeur (consommations supérieures à la production).'
  });

  registerMetric({
    id: 'IND_14', family: 'Soldes intermédiaires de gestion', num: 14,
    code: 'TAUX_VA', label: 'Taux de Valeur Ajoutée',
    unit: '%', valN: txVaN !== null ? Math.round(txVaN * 10) / 10 : null, valN1: txVaN1 !== null ? Math.round(txVaN1 * 10) / 10 : null,
    varAbs: calcVarPoints(txVaN, txVaN1).points, varPct: null,
    formula: 'Valeur Ajoutée / Chiffre d\'affaires * 100',
    computable: txVaN !== null,
    status: txVaN !== null ? (txVaN >= 30 ? 'favorable' : txVaN >= 15 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txVaN !== null ? `Taux d'intégration économique de ${Math.round(txVaN)}% du CA.` : 'Incalculable'
  });

  const ebeN = cr.excedentBrutExploitation.n; const ebeN1 = cr.excedentBrutExploitation.n1;
  const txEbeN = safeDiv(ebeN * 100, caN); const txEbeN1 = safeDiv(ebeN1 * 100, caN1);
  registerMetric({
    id: 'IND_15', family: 'Soldes intermédiaires de gestion', num: 15,
    code: 'EBE', label: 'Excédent Brut d\'Exploitation (EBE)',
    unit: 'FCFA', valN: ebeN, valN1: ebeN1, varAbs: ebeN - ebeN1, varPct: calcVar(ebeN, ebeN1).pct,
    formula: 'Valeur Ajoutée - Charges de personnel (Réf XD)',
    computable: true,
    status: ebeN > 0 ? 'favorable' : 'alerte',
    interpretation: ebeN > 0 ? `Ressource opérationnelle brute générée : ${Math.round(ebeN).toLocaleString('fr-FR')} FCFA.` : 'Insuffisance Brute d\'Exploitation (IBE) : l\'exploitation ne couvre pas la masse salariale.'
  });

  registerMetric({
    id: 'IND_16', family: 'Soldes intermédiaires de gestion', num: 16,
    code: 'MARGE_EBE', label: 'Taux de marge brute d\'exploitation (EBE / CA)',
    unit: '%', valN: txEbeN !== null ? Math.round(txEbeN * 10) / 10 : null, valN1: txEbeN1 !== null ? Math.round(txEbeN1 * 10) / 10 : null,
    varAbs: calcVarPoints(txEbeN, txEbeN1).points, varPct: null,
    formula: 'EBE / Chiffre d\'affaires * 100',
    computable: txEbeN !== null,
    status: txEbeN !== null ? (txEbeN >= 12 ? 'favorable' : txEbeN >= 5 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txEbeN !== null ? `Marge brute d'EBE de ${Math.round(txEbeN)}% du CA.` : 'Incalculable'
  });

  const reN = cr.resultatExploitation.n; const reN1 = cr.resultatExploitation.n1;
  registerMetric({
    id: 'IND_17', family: 'Soldes intermédiaires de gestion', num: 17,
    code: 'RES_EXPL', label: 'Résultat d\'exploitation (RE)',
    unit: 'FCFA', valN: reN, valN1: reN1, varAbs: reN - reN1, varPct: calcVar(reN, reN1).pct,
    formula: 'EBE + Reprises - Dotations aux amortissements et provisions (Réf XE)',
    computable: true,
    status: reN > 0 ? 'favorable' : 'alerte',
    interpretation: reN >= 0 ? `Résultat d'exploitation bénéficiaire de ${Math.round(reN).toLocaleString('fr-FR')} FCFA.` : 'Résultat d\'exploitation déficitaire (perte opérationnelle nette).'
  });

  const rfN = cr.resultatFinancier.n; const rfN1 = cr.resultatFinancier.n1;
  registerMetric({
    id: 'IND_18', family: 'Soldes intermédiaires de gestion', num: 18,
    code: 'RES_FIN', label: 'Résultat financier',
    unit: 'FCFA', valN: rfN, valN1: rfN1, varAbs: rfN - rfN1, varPct: calcVar(rfN, rfN1).pct,
    formula: 'Revenus financiers - Frais financiers (Réf XF)',
    computable: true,
    status: rfN >= 0 ? 'favorable' : (Math.abs(rfN) < (ebeN * 0.33) ? 'vigilance' : 'alerte'),
    interpretation: `Résultat financier : ${Math.round(rfN).toLocaleString('fr-FR')} FCFA (impact des charges d'endettement).`
  });

  const raoN = cr.resultatActivitesOrdinaires.n; const raoN1 = cr.resultatActivitesOrdinaires.n1;
  registerMetric({
    id: 'IND_19', family: 'Soldes intermédiaires de gestion', num: 19,
    code: 'RAO', label: 'Résultat des activités ordinaires (RAO)',
    unit: 'FCFA', valN: raoN, valN1: raoN1, varAbs: raoN - raoN1, varPct: calcVar(raoN, raoN1).pct,
    formula: 'Résultat d\'exploitation + Résultat financier (Réf XG)',
    computable: true,
    status: raoN > 0 ? 'favorable' : 'alerte',
    interpretation: raoN >= 0 ? `Rentabilité courante pérenne : ${Math.round(raoN).toLocaleString('fr-FR')} FCFA.` : 'Perte courante sur activités ordinaires.'
  });

  const rhaoN = cr.resultatHAO.n; const rhaoN1 = cr.resultatHAO.n1;
  registerMetric({
    id: 'IND_20', family: 'Soldes intermédiaires de gestion', num: 20,
    code: 'RES_HAO', label: 'Résultat Hors Activités Ordinaires (HAO)',
    unit: 'FCFA', valN: rhaoN, valN1: rhaoN1, varAbs: rhaoN - rhaoN1, varPct: calcVar(rhaoN, rhaoN1).pct,
    formula: 'Produits HAO - Charges HAO (Réf XH)',
    computable: true,
    status: 'neutre',
    interpretation: `Composante exceptionnelle/extraordinaire : ${Math.round(rhaoN).toLocaleString('fr-FR')} FCFA.`
  });

  // =========================================================================
  // FAMILLE 3 : RENTABILITÉ ET PERFORMANCE (21 à 30)
  // =========================================================================
  const rnN = cr.resultatNet.n; const rnN1 = cr.resultatNet.n1;
  const txMargeNetteN = safeDiv(rnN * 100, caN); const txMargeNetteN1 = safeDiv(rnN1 * 100, caN1);
  const txMargeOpN = safeDiv(reN * 100, caN); const txMargeOpN1 = safeDiv(reN1 * 100, caN1);

  registerMetric({
    id: 'IND_21', family: 'Rentabilité et performance', num: 21,
    code: 'RES_NET', label: 'Résultat net de l\'exercice',
    unit: 'FCFA', valN: rnN, valN1: rnN1, varAbs: rnN - rnN1, varPct: calcVar(rnN, rnN1).pct,
    formula: 'RAO + RHAO - Participation salariés - Impôt sur résultat (Réf XI)',
    computable: true,
    status: rnN > 0 ? 'favorable' : 'alerte',
    interpretation: rnN > 0 ? `Bénéfice net annuel : ${Math.round(rnN).toLocaleString('fr-FR')} FCFA.` : `Déficit net de clôture : ${Math.round(rnN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_22', family: 'Rentabilité et performance', num: 22,
    code: 'MARGE_NETTE', label: 'Marge nette (Rentabilité commerciale nette)',
    unit: '%', valN: txMargeNetteN !== null ? Math.round(txMargeNetteN * 10) / 10 : null, valN1: txMargeNetteN1 !== null ? Math.round(txMargeNetteN1 * 10) / 10 : null,
    varAbs: calcVarPoints(txMargeNetteN, txMargeNetteN1).points, varPct: null,
    formula: 'Résultat net / Chiffre d\'affaires * 100',
    computable: txMargeNetteN !== null,
    status: txMargeNetteN !== null ? (txMargeNetteN >= 5 ? 'favorable' : txMargeNetteN > 0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txMargeNetteN !== null ? `Marge nette finale de ${Math.round(txMargeNetteN)}% du CA.` : 'Incalculable'
  });

  registerMetric({
    id: 'IND_23', family: 'Rentabilité et performance', num: 23,
    code: 'MARGE_OP', label: 'Marge opérationnelle (RE / CA)',
    unit: '%', valN: txMargeOpN !== null ? Math.round(txMargeOpN * 10) / 10 : null, valN1: txMargeOpN1 !== null ? Math.round(txMargeOpN1 * 10) / 10 : null,
    varAbs: calcVarPoints(txMargeOpN, txMargeOpN1).points, varPct: null,
    formula: 'Résultat d\'exploitation / Chiffre d\'affaires * 100',
    computable: txMargeOpN !== null,
    status: txMargeOpN !== null ? (txMargeOpN >= 8 ? 'favorable' : txMargeOpN > 0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txMargeOpN !== null ? `Taux de profitabilité opérationnelle de ${Math.round(txMargeOpN)}%.` : 'Incalculable'
  });

  // ROE = Résultat net / Capitaux propres moyens
  const cpN = bilan.totalCapitauxPropres.n; const cpN1 = bilan.totalCapitauxPropres.n1;
  const cpMoy = cpN1 > 0 ? (cpN + cpN1) / 2 : cpN;
  const roeN = cpMoy > 0 ? safeDiv(rnN * 100, cpMoy) : null;
  registerMetric({
    id: 'IND_24', family: 'Rentabilité et performance', num: 24,
    code: 'ROE', label: 'Rentabilité financière des capitaux propres (ROE)',
    unit: '%', valN: roeN !== null ? Math.round(roeN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Résultat net / Capitaux propres moyens * 100',
    computable: roeN !== null,
    status: roeN !== null ? (roeN >= 12 ? 'favorable' : roeN > 0 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: roeN !== null ? `Rendement des capitaux actionnaires : ${Math.round(roeN)}%.` : (cpN <= 0 ? 'Capitaux propres négatifs ou nuls (ROE non interprétable).' : 'Non calculable')
  });

  // ROA = Résultat net / Total Actif moyen
  const actifN = bilan.totalGeneralActif.n; const actifN1 = bilan.totalGeneralActif.n1;
  const actifMoy = actifN1 > 0 ? (actifN + actifN1) / 2 : actifN;
  const roaN = safeDiv(rnN * 100, actifMoy);
  registerMetric({
    id: 'IND_25', family: 'Rentabilité et performance', num: 25,
    code: 'ROA', label: 'Rentabilité économique des actifs (ROA)',
    unit: '%', valN: roaN !== null ? Math.round(roaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Résultat net / Total actif moyen * 100',
    computable: roaN !== null,
    status: roaN !== null ? (roaN >= 6 ? 'favorable' : roaN > 0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: roaN !== null ? `Efficacité de l'actif global : ${Math.round(roaN)}%.` : 'Incalculable'
  });

  // ROCE = Résultat d'exploitation / Capitaux employés (Actif Immo Net + BFR Global)
  const capEmployesN = bilan.totalActifImmobiliseNet.n + equilibre.bfrGlobal.n;
  const roceN = safeDiv(reN * 100, capEmployesN);
  registerMetric({
    id: 'IND_26', family: 'Rentabilité et performance', num: 26,
    code: 'ROCE', label: 'Rentabilité des capitaux employés (ROCE)',
    unit: '%', valN: roceN !== null ? Math.round(roceN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Résultat d\'exploitation / (Actif immobilisé net + BFR global) * 100',
    computable: roceN !== null,
    status: roceN !== null ? (roceN >= 10 ? 'favorable' : roceN > 0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: roceN !== null ? `Rendement du capital investi dans l'outil d'exploitation : ${Math.round(roceN)}%.` : 'Incalculable'
  });

  // Rotation des actifs = CA / Total Actif moyen
  const rotActifN = safeDiv(caN, actifMoy);
  registerMetric({
    id: 'IND_27', family: 'Rentabilité et performance', num: 27,
    code: 'ROT_ACTIF', label: 'Vitesse de rotation des actifs',
    unit: 'ratio', valN: rotActifN !== null ? Math.round(rotActifN * 100) / 100 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Chiffre d\'affaires / Total de l\'actif moyen',
    computable: rotActifN !== null,
    status: rotActifN !== null ? (rotActifN >= 1.2 ? 'favorable' : rotActifN >= 0.8 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: rotActifN !== null ? `100 FCFA d'actifs génèrent ${Math.round(rotActifN * 100)} FCFA de ventes par an.` : 'Incalculable'
  });

  // Levier financier = Total Actif moyen / Capitaux propres moyens
  const levierFinN = cpMoy > 0 ? safeDiv(actifMoy, cpMoy) : null;
  registerMetric({
    id: 'IND_28', family: 'Rentabilité et performance', num: 28,
    code: 'LEVIER_FIN', label: 'Levier financier de structure (Actif / CP)',
    unit: 'ratio', valN: levierFinN !== null ? Math.round(levierFinN * 100) / 100 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Total actif moyen / Capitaux propres moyens',
    computable: levierFinN !== null,
    status: levierFinN !== null ? (levierFinN <= 3 ? 'favorable' : levierFinN <= 5 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: levierFinN !== null ? `Multiplicateur de fonds propres : ${Math.round(levierFinN * 10) / 10}x.` : 'Non applicable (capitaux propres négatifs).'
  });

  // Décomposition DuPont : ROE = Marge Nette * Rotation Actif * Levier Financier
  const dupontConcordance = (txMargeNetteN !== null && rotActifN !== null && levierFinN !== null && roeN !== null);
  registerMetric({
    id: 'IND_29', family: 'Rentabilité et performance', num: 29,
    code: 'DUPONT_SYNTH', label: 'Décomposition DuPont du ROE (Marge x Rotation x Levier)',
    unit: '%', valN: roeN !== null ? Math.round(roeN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: '(Résultat net / CA) * (CA / Actif) * (Actif / CP) * 100',
    computable: dupontConcordance,
    status: roeN !== null && roeN >= 10 ? 'favorable' : 'vigilance',
    interpretation: dupontConcordance 
      ? `Le ROE de ${Math.round(roeN)}% s'explique par : une marge de ${Math.round(txMargeNetteN)}%, une rotation d'actif de ${Math.round(rotActifN * 100)/100}x et un levier d'endettement de ${Math.round(levierFinN * 10)/10}x.`
      : 'Décomposition non réalisable.'
  });

  const varRN = calcVar(rnN, rnN1);
  registerMetric({
    id: 'IND_30', family: 'Rentabilité et performance', num: 30,
    code: 'CROISS_RN', label: 'Croissance du résultat net',
    unit: '%', valN: varRN.pct, valN1: null, varAbs: varRN.abs, varPct: null,
    formula: '(Résultat net N - Résultat net N-1) / |Résultat net N-1| * 100',
    computable: varRN.pct !== null,
    status: varRN.pct !== null ? (varRN.pct >= 0 ? 'favorable' : 'alerte') : 'neutre',
    interpretation: varRN.pct !== null ? `Variation du bénéfice net de ${varRN.pct}%.` : (varRN.note || 'Non applicable')
  });

  // =========================================================================
  // FAMILLE 4 : STRUCTURE FINANCIÈRE (31 à 40)
  // =========================================================================
  const immoNetN = bilan.totalActifImmobiliseNet.n; const immoNetN1 = bilan.totalActifImmobiliseNet.n1;
  const pdsImmoN = safeDiv(immoNetN * 100, actifN); const pdsImmoN1 = safeDiv(immoNetN1 * 100, actifN1);
  const actCircN = bilan.totalActifCirculant.n; const actCircN1 = bilan.totalActifCirculant.n1;

  registerMetric({
    id: 'IND_31', family: 'Structure financière', num: 31,
    code: 'TOTAL_ACTIF', label: 'Total de l\'actif du bilan',
    unit: 'FCFA', valN: actifN, valN1: actifN1, varAbs: actifN - actifN1, varPct: calcVar(actifN, actifN1).pct,
    formula: 'Bilan Paysage Réf BZ',
    computable: true,
    status: 'neutre',
    interpretation: `Dimension bilantielle : ${Math.round(actifN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_32', family: 'Structure financière', num: 32,
    code: 'IMMO_NET', label: 'Actif immobilisé net',
    unit: 'FCFA', valN: immoNetN, valN1: immoNetN1, varAbs: immoNetN - immoNetN1, varPct: calcVar(immoNetN, immoNetN1).pct,
    formula: 'Bilan Paysage Réf AZ',
    computable: true,
    status: 'neutre',
    interpretation: `Valeur nette comptable de l'appareil productif : ${Math.round(immoNetN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_33', family: 'Structure financière', num: 33,
    code: 'POIDS_IMMO', label: 'Poids des immobilisations (Intensité capitalistique)',
    unit: '%', valN: pdsImmoN !== null ? Math.round(pdsImmoN * 10) / 10 : null, valN1: pdsImmoN1 !== null ? Math.round(pdsImmoN1 * 10) / 10 : null,
    varAbs: calcVarPoints(pdsImmoN, pdsImmoN1).points, varPct: null,
    formula: 'Actif immobilisé net / Total actif * 100',
    computable: pdsImmoN !== null,
    status: 'neutre',
    interpretation: pdsImmoN !== null ? `Les actifs à long terme représentent ${Math.round(pdsImmoN)}% du patrimoine.` : 'Incalculable'
  });

  registerMetric({
    id: 'IND_34', family: 'Structure financière', num: 34,
    code: 'ACTIF_CIRC', label: 'Total actif circulant',
    unit: 'FCFA', valN: actCircN, valN1: actCircN1, varAbs: actCircN - actCircN1, varPct: calcVar(actCircN, actCircN1).pct,
    formula: 'Stocks + Créances exploitation + Actif circulant HAO (Réf BK)',
    computable: true,
    status: 'neutre',
    interpretation: `Actifs d'exploitation à court terme : ${Math.round(actCircN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_35', family: 'Structure financière', num: 35,
    code: 'CAP_PROPRES', label: 'Capitaux propres et ressources assimilées',
    unit: 'FCFA', valN: cpN, valN1: cpN1, varAbs: cpN - cpN1, varPct: calcVar(cpN, cpN1).pct,
    formula: 'Bilan Paysage Réf CP',
    computable: true,
    status: cpN > 0 ? (cpN >= bilan.capitalSocial.n * 0.5 ? 'favorable' : 'alerte') : 'alerte',
    interpretation: cpN > 0 
      ? `Fonds propres positifs de ${Math.round(cpN).toLocaleString('fr-FR')} FCFA.`
      : 'Capitaux propres négatifs : situation de faillite technique (Art. 664 AUSCGIE).'
  });

  const txAutonomieN = safeDiv(cpN * 100, actifN); const txAutonomieN1 = safeDiv(cpN1 * 100, actifN1);
  registerMetric({
    id: 'IND_36', family: 'Structure financière', num: 36,
    code: 'AUTONOMIE_FIN', label: 'Ratio d\'autonomie financière globale (CP / Total Bilan)',
    unit: '%', valN: txAutonomieN !== null ? Math.round(txAutonomieN * 10) / 10 : null, valN1: txAutonomieN1 !== null ? Math.round(txAutonomieN1 * 10) / 10 : null,
    varAbs: calcVarPoints(txAutonomieN, txAutonomieN1).points, varPct: null,
    formula: 'Capitaux propres / Total bilan * 100',
    computable: txAutonomieN !== null,
    status: txAutonomieN !== null ? (txAutonomieN >= 33 ? 'favorable' : txAutonomieN >= 20 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: txAutonomieN !== null ? `Les capitaux propres financent ${Math.round(txAutonomieN)}% du total bilan (norme bancaire > 25-33%).` : 'Incalculable'
  });

  const dfN = bilan.totalDettesFinancieres.n; const dfN1 = bilan.totalDettesFinancieres.n1;
  registerMetric({
    id: 'IND_37', family: 'Structure financière', num: 37,
    code: 'DETTES_FIN', label: 'Dettes financières stables et assimilées',
    unit: 'FCFA', valN: dfN, valN1: dfN1, varAbs: dfN - dfN1, varPct: calcVar(dfN, dfN1).pct,
    formula: 'Emprunts bancaires + Dettes crédit-bail + Provisions risques long terme (Réf DD)',
    computable: true,
    status: 'neutre',
    interpretation: `Engagements financiers à long et moyen terme : ${Math.round(dfN).toLocaleString('fr-FR')} FCFA.`
  });

  const ratioEndettementN = cpN > 0 ? safeDiv(dfN * 100, cpN) : null;
  registerMetric({
    id: 'IND_38', family: 'Structure financière', num: 38,
    code: 'RATIO_ENDETT', label: 'Ratio d\'endettement financier (Dettes LMT / CP)',
    unit: '%', valN: ratioEndettementN !== null ? Math.round(ratioEndettementN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dettes financières / Capitaux propres * 100',
    computable: ratioEndettementN !== null,
    status: ratioEndettementN !== null ? (ratioEndettementN <= 100 ? 'favorable' : ratioEndettementN <= 150 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: ratioEndettementN !== null ? `Endettement financier représentant ${Math.round(ratioEndettementN)}% des fonds propres (plafond bancaire 100%).` : 'Incalculable ou capitaux propres négatifs'
  });

  const rsN = bilan.totalRessourcesStables.n; const rsN1 = bilan.totalRessourcesStables.n1;
  registerMetric({
    id: 'IND_39', family: 'Structure financière', num: 39,
    code: 'RESS_STABLES', label: 'Ressources stables totales',
    unit: 'FCFA', valN: rsN, valN1: rsN1, varAbs: rsN - rsN1, varPct: calcVar(rsN, rsN1).pct,
    formula: 'Capitaux propres + Dettes financières (Réf DF)',
    computable: true,
    status: 'neutre',
    interpretation: `Ressources de long terme : ${Math.round(rsN).toLocaleString('fr-FR')} FCFA.`
  });

  const couvImmoN = immoNetN > 0 ? safeDiv(rsN * 100, immoNetN) : null;
  registerMetric({
    id: 'IND_40', family: 'Structure financière', num: 40,
    code: 'COUV_IMMO', label: 'Taux de couverture des immobilisations par ressources stables',
    unit: '%', valN: couvImmoN !== null ? Math.round(couvImmoN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Ressources stables / Actif immobilisé net * 100',
    computable: couvImmoN !== null,
    status: couvImmoN !== null ? (couvImmoN >= 100 ? 'favorable' : 'alerte') : 'neutre',
    interpretation: couvImmoN !== null 
      ? `Couverture des emplois stables à ${Math.round(couvImmoN)}% (${couvImmoN >= 100 ? 'règle d\'orthodoxie financière respectée' : 'orthodoxie violée : immobilisations financées par des dettes court terme'}).`
      : 'Incalculable'
  });

  // =========================================================================
  // FAMILLE 5 : ÉQUILIBRE FINANCIER (41 à 50)
  // =========================================================================
  const frngN = equilibre.frng.n; const frngN1 = equilibre.frng.n1;
  const bfreN = equilibre.bfre.n; const bfreN1 = equilibre.bfre.n1;
  const bfrHaoN = equilibre.bfrHao.n; const bfrHaoN1 = equilibre.bfrHao.n1;
  const bfrgN = equilibre.bfrGlobal.n; const bfrgN1 = equilibre.bfrGlobal.n1;
  const tnN = equilibre.tresorerieNette.n; const tnN1 = equilibre.tresorerieNette.n1;

  registerMetric({
    id: 'IND_41', family: 'Équilibre financier', num: 41,
    code: 'FRNG', label: 'Fonds de Roulement Net Global (FRNG)',
    unit: 'FCFA', valN: frngN, valN1: frngN1, varAbs: frngN - frngN1, varPct: calcVar(frngN, frngN1).pct,
    formula: 'Ressources stables - Actif immobilisé net',
    computable: true,
    status: frngN > 0 ? 'favorable' : 'alerte',
    interpretation: frngN > 0 
      ? `Excédent de capitaux stables de ${Math.round(frngN).toLocaleString('fr-FR')} FCFA disponible pour financer le cycle d'exploitation.`
      : `Déficit de ressources stables (-${Math.round(Math.abs(frngN)).toLocaleString('fr-FR')} FCFA) : risque structurel d'illiquidité.`
  });

  registerMetric({
    id: 'IND_42', family: 'Équilibre financier', num: 42,
    code: 'BFRE', label: 'Besoin en Fonds de Roulement d\'Exploitation (BFRE)',
    unit: 'FCFA', valN: bfreN, valN1: bfreN1, varAbs: bfreN - bfreN1, varPct: calcVar(bfreN, bfreN1).pct,
    formula: 'Actif circulant d\'exploitation - Passif circulant d\'exploitation',
    computable: true,
    status: 'neutre',
    interpretation: bfreN >= 0 
      ? `Besoin de financement généré par l'exploitation : ${Math.round(bfreN).toLocaleString('fr-FR')} FCFA.`
      : `Ressource nette d'exploitation générée : ${Math.round(Math.abs(bfreN)).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_43', family: 'Équilibre financier', num: 43,
    code: 'BFR_HAO', label: 'Besoin en Fonds de Roulement HAO',
    unit: 'FCFA', valN: bfrHaoN, valN1: bfrHaoN1, varAbs: bfrHaoN - bfrHaoN1, varPct: calcVar(bfrHaoN, bfrHaoN1).pct,
    formula: 'Actif circulant HAO - Passif circulant HAO',
    computable: true,
    status: 'neutre',
    interpretation: `Composante non opérationnelle du BFR : ${Math.round(bfrHaoN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_44', family: 'Équilibre financier', num: 44,
    code: 'BFRG', label: 'Besoin en Fonds de Roulement Global (BFRG)',
    unit: 'FCFA', valN: bfrgN, valN1: bfrgN1, varAbs: bfrgN - bfrgN1, varPct: calcVar(bfrgN, bfrgN1).pct,
    formula: 'BFRE + BFR HAO',
    computable: true,
    status: 'neutre',
    interpretation: `Besoin total de liquidités immobilisées dans le cycle : ${Math.round(bfrgN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_45', family: 'Équilibre financier', num: 45,
    code: 'TN', label: 'Trésorerie Nette (TN)',
    unit: 'FCFA', valN: tnN, valN1: tnN1, varAbs: tnN - tnN1, varPct: calcVar(tnN, tnN1).pct,
    formula: 'FRNG - BFRG = Trésorerie Actif - Trésorerie Passif',
    computable: true,
    status: tnN > 0 ? 'favorable' : 'alerte',
    interpretation: tnN > 0 
      ? `Position de trésorerie nette positive et disponible : ${Math.round(tnN).toLocaleString('fr-FR')} FCFA.`
      : `Position de trésorerie nette négative (-${Math.round(Math.abs(tnN)).toLocaleString('fr-FR')} FCFA) : dépendance aux concours bancaires court terme.`
  });

  const couvBfrN = bfrgN > 0 ? safeDiv(frngN * 100, bfrgN) : null;
  registerMetric({
    id: 'IND_46', family: 'Équilibre financier', num: 46,
    code: 'COUV_BFR', label: 'Couverture du BFR par le FRNG',
    unit: '%', valN: couvBfrN !== null ? Math.round(couvBfrN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'FRNG / BFRG * 100',
    computable: couvBfrN !== null,
    status: couvBfrN !== null ? (couvBfrN >= 100 ? 'favorable' : couvBfrN >= 50 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: couvBfrN !== null ? `Le fonds de roulement couvre ${Math.round(couvBfrN)}% du besoin en fonds de roulement.` : (bfrgN <= 0 ? 'BFR négatif (autofinancé).' : 'Incalculable')
  });

  const bfrJoursCaN = caN > 0 ? safeDiv(bfreN * nbJours, caN) : null;
  const bfrJoursCaN1 = caN1 > 0 ? safeDiv(bfreN1 * nbJours, caN1) : null;
  registerMetric({
    id: 'IND_47', family: 'Équilibre financier', num: 47,
    code: 'BFRE_JOURS_CA', label: 'BFRE en jours de chiffre d\'affaires',
    unit: 'jours', valN: bfrJoursCaN !== null ? Math.round(bfrJoursCaN) : null, valN1: bfrJoursCaN1 !== null ? Math.round(bfrJoursCaN1) : null,
    varAbs: bfrJoursCaN !== null && bfrJoursCaN1 !== null ? Math.round(bfrJoursCaN - bfrJoursCaN1) : null, varPct: null,
    formula: 'BFRE / CA * 365',
    computable: bfrJoursCaN !== null,
    status: bfrJoursCaN !== null ? (bfrJoursCaN <= 60 ? 'favorable' : bfrJoursCaN <= 90 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: bfrJoursCaN !== null ? `L'entreprise immobilise l'équivalent de ${Math.round(bfrJoursCaN)} jours de ventes dans son cycle d'exploitation.` : 'Incalculable'
  });

  registerMetric({
    id: 'IND_48', family: 'Équilibre financier', num: 48,
    code: 'VAR_BFRE', label: 'Variation absolue du BFRE (Impact cash)',
    unit: 'FCFA', valN: bfreN - bfreN1, valN1: null, varAbs: null, varPct: null,
    formula: 'BFRE_N - BFRE_N-1',
    computable: true,
    status: (bfreN - bfreN1) <= 0 ? 'favorable' : 'vigilance',
    interpretation: (bfreN - bfreN1) > 0 
      ? `Augmentation du BFRE de ${Math.round(bfreN - bfreN1).toLocaleString('fr-FR')} FCFA (consommation de trésorerie).`
      : `Diminution du BFRE de ${Math.round(Math.abs(bfreN - bfreN1)).toLocaleString('fr-FR')} FCFA (libération de trésorerie).`
  });

  registerMetric({
    id: 'IND_49', family: 'Équilibre financier', num: 49,
    code: 'VAR_FRNG', label: 'Variation absolue du FRNG',
    unit: 'FCFA', valN: frngN - frngN1, valN1: null, varAbs: null, varPct: null,
    formula: 'FRNG_N - FRNG_N-1',
    computable: true,
    status: (frngN - frngN1) >= 0 ? 'favorable' : 'alerte',
    interpretation: (frngN - frngN1) >= 0 
      ? `Renforcement du fonds de roulement de +${Math.round(frngN - frngN1).toLocaleString('fr-FR')} FCFA.`
      : `Érosion du fonds de roulement de -${Math.round(Math.abs(frngN - frngN1)).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_50', family: 'Équilibre financier', num: 50,
    code: 'VAR_TN', label: 'Variation de la Trésorerie Nette',
    unit: 'FCFA', valN: tnN - tnN1, valN1: null, varAbs: null, varPct: null,
    formula: 'TN_N - TN_N-1 = Delta FRNG - Delta BFRG',
    computable: true,
    status: (tnN - tnN1) >= 0 ? 'favorable' : 'alerte',
    interpretation: (tnN - tnN1) >= 0 
      ? `Amélioration globale de la trésorerie nette de +${Math.round(tnN - tnN1).toLocaleString('fr-FR')} FCFA.`
      : `Dégradation de la trésorerie nette de -${Math.round(Math.abs(tnN - tnN1)).toLocaleString('fr-FR')} FCFA sur l'exercice.`
  });

  // =========================================================================
  // FAMILLE 6 : LIQUIDITÉ ET SOLVABILITÉ (51 à 60)
  // =========================================================================
  const passCircTotN = bilan.totalPassifCirculant.n; const passCircTotN1 = bilan.totalPassifCirculant.n1;
  const liqGenN = safeDiv(actCircN + bilan.totalTresorerieActif.n, passCircTotN + bilan.totalTresoreriePassif.n);
  const liqRedN = safeDiv(actCircN - bilan.stocks.n + bilan.totalTresorerieActif.n, passCircTotN + bilan.totalTresoreriePassif.n);
  const liqImmN = safeDiv(bilan.totalTresorerieActif.n, passCircTotN + bilan.totalTresoreriePassif.n);

  registerMetric({
    id: 'IND_51', family: 'Liquidité et solvabilité', num: 51,
    code: 'LIQ_GEN', label: 'Ratio de liquidité générale (Current Ratio)',
    unit: 'ratio', valN: liqGenN !== null ? Math.round(liqGenN * 100) / 100 : null, valN1: null, varAbs: null, varPct: null,
    formula: '(Actif circulant + Trésorerie actif) / (Passif circulant + Trésorerie passif)',
    computable: liqGenN !== null,
    status: liqGenN !== null ? (liqGenN >= 1.3 ? 'favorable' : liqGenN >= 1.0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: liqGenN !== null 
      ? `Capacité à couvrir les dettes court terme à ${Math.round(liqGenN * 100)}% (${liqGenN >= 1 ? 'dettes court terme intégralement couvertes par les actifs circulants' : 'tension de liquidité : actifs court terme insuffisants'}).`
      : 'Incalculable'
  });

  registerMetric({
    id: 'IND_52', family: 'Liquidité et solvabilité', num: 52,
    code: 'LIQ_RED', label: 'Ratio de liquidité réduite (Quick Ratio / Acid Test)',
    unit: 'ratio', valN: liqRedN !== null ? Math.round(liqRedN * 100) / 100 : null, valN1: null, varAbs: null, varPct: null,
    formula: '(Créances + Trésorerie actif) / Passif à court terme',
    computable: liqRedN !== null,
    status: liqRedN !== null ? (liqRedN >= 0.8 ? 'favorable' : liqRedN >= 0.5 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: liqRedN !== null ? `Liquidité hors stocks : ${Math.round(liqRedN * 100)}% des dettes court terme.` : 'Incalculable'
  });

  registerMetric({
    id: 'IND_53', family: 'Liquidité et solvabilité', num: 53,
    code: 'LIQ_IMM', label: 'Ratio de liquidité immédiate (Cash Ratio)',
    unit: 'ratio', valN: liqImmN !== null ? Math.round(liqImmN * 100) / 100 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Trésorerie disponible / Passif à court terme',
    computable: liqImmN !== null,
    status: liqImmN !== null ? (liqImmN >= 0.2 ? 'favorable' : liqImmN >= 0.05 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: liqImmN !== null ? `Trésorerie instantanément mobilisable : ${Math.round(liqImmN * 100)}% des dettes exigibles.` : 'Incalculable'
  });

  // Dette financière nette = Dettes financières + Concours bancaires court terme - Trésorerie actif
  const detteFinNetteN = dfN + bilan.totalTresoreriePassif.n - bilan.totalTresorerieActif.n;
  const detteFinNetteN1 = dfN1 + bilan.totalTresoreriePassif.n1 - bilan.totalTresorerieActif.n1;

  registerMetric({
    id: 'IND_54', family: 'Liquidité et solvabilité', num: 54,
    code: 'DETTE_NETTE', label: 'Dette financière nette',
    unit: 'FCFA', valN: detteFinNetteN, valN1: detteFinNetteN1, varAbs: detteFinNetteN - detteFinNetteN1, varPct: calcVar(detteFinNetteN, detteFinNetteN1).pct,
    formula: 'Dettes financières stables + Trésorerie passif - Trésorerie actif',
    computable: true,
    status: detteFinNetteN <= 0 ? 'favorable' : (cpN > 0 && detteFinNetteN <= cpN ? 'vigilance' : 'alerte'),
    interpretation: detteFinNetteN <= 0 
      ? `Trésorerie nette globale positive : aucun endettement net (excédent de cash de ${Math.round(Math.abs(detteFinNetteN)).toLocaleString('fr-FR')} FCFA).`
      : `Endettement net exigible de ${Math.round(detteFinNetteN).toLocaleString('fr-FR')} FCFA.`
  });

  const gearingNetN = cpN > 0 ? safeDiv(detteFinNetteN * 100, cpN) : null;
  registerMetric({
    id: 'IND_55', family: 'Liquidité et solvabilité', num: 55,
    code: 'GEARING_NET', label: 'Gearing net (Dette nette / Capitaux propres)',
    unit: '%', valN: gearingNetN !== null ? Math.round(gearingNetN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dette financière nette / Capitaux propres * 100',
    computable: gearingNetN !== null,
    status: gearingNetN !== null ? (gearingNetN <= 50 ? 'favorable' : gearingNetN <= 100 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: gearingNetN !== null ? `Gearing net de ${Math.round(gearingNetN)}% (plafond bancaire critique à 100%).` : 'Incalculable ou capitaux propres négatifs'
  });

  const levierEbeN = ebeN > 0 ? safeDiv(detteFinNetteN, ebeN) : null;
  registerMetric({
    id: 'IND_56', family: 'Liquidité et solvabilité', num: 56,
    code: 'DETTE_SUR_EBE', label: 'Levier financier opérationnel (Dette nette / EBE)',
    unit: 'années', valN: levierEbeN !== null ? Math.round(levierEbeN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dette financière nette / EBE',
    computable: levierEbeN !== null,
    status: levierEbeN !== null ? (levierEbeN <= 2.5 ? 'favorable' : levierEbeN <= 4.0 ? 'vigilance' : 'alerte') : (detteFinNetteN <= 0 ? 'favorable' : 'alerte'),
    interpretation: levierEbeN !== null ? `L'entreprise rembourserait sa dette nette en ${Math.round(levierEbeN * 10) / 10} années d'EBE (norme < 3.5 - 4.0 ans).` : (detteFinNetteN <= 0 ? 'Trésorerie nette positive.' : 'EBE négatif : remboursement théorique impossible.')
  });

  const fraisFinN = cr.fraisFinanciers.n;
  const couvInteretsN = fraisFinN > 0 ? safeDiv(reN, fraisFinN) : null;
  registerMetric({
    id: 'IND_57', family: 'Liquidité et solvabilité', num: 57,
    code: 'COUV_INTERETS', label: 'Ratio de couverture des intérêts (ICR : RE / Intérêts)',
    unit: 'ratio', valN: couvInteretsN !== null ? Math.round(couvInteretsN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Résultat d\'exploitation / Frais financiers',
    computable: couvInteretsN !== null,
    status: couvInteretsN !== null ? (couvInteretsN >= 3.0 ? 'favorable' : couvInteretsN >= 1.5 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: couvInteretsN !== null ? `Le résultat d'exploitation couvre ${Math.round(couvInteretsN * 10) / 10}x la charge d'intérêts (seuil critique < 1.5x).` : 'Pas de frais financiers significatifs.'
  });

  // DSCR (Debt Service Coverage Ratio) = (CAFG + Frais financiers) / (Remboursements emprunts + Frais financiers)
  const rembEmpruntsN = tft.remboursementsEmprunts.n;
  const serviceDetteN = rembEmpruntsN + fraisFinN;
  const dscrN = serviceDetteN > 0 ? safeDiv(tft.cafg.n + fraisFinN, serviceDetteN) : null;
  registerMetric({
    id: 'IND_58', family: 'Liquidité et solvabilité', num: 58,
    code: 'DSCR', label: 'Ratio de couverture du service de la dette (DSCR)',
    unit: 'ratio', valN: dscrN !== null ? Math.round(dscrN * 100) / 100 : null, valN1: null, varAbs: null, varPct: null,
    formula: '(CAFG + Intérêts) / (Remboursements d\'emprunts + Intérêts)',
    computable: dscrN !== null,
    status: dscrN !== null ? (dscrN >= 1.25 ? 'favorable' : dscrN >= 1.0 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: dscrN !== null ? `DSCR de ${Math.round(dscrN * 100) / 100}x (exigence minimale des bailleurs de fonds : 1.20 - 1.30x).` : 'Données de service de la dette non disponibles.'
  });

  const totalPassifN = bilan.totalGeneralPassif.n;
  const pdsDettesCtN = safeDiv((passCircTotN + bilan.totalTresoreriePassif.n) * 100, totalPassifN);
  registerMetric({
    id: 'IND_59', family: 'Liquidité et solvabilité', num: 59,
    code: 'POIDS_DETTES_CT', label: 'Poids des dettes exigibles à court terme dans le passif',
    unit: '%', valN: pdsDettesCtN !== null ? Math.round(pdsDettesCtN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: '(Passif circulant + Trésorerie passif) / Total bilan * 100',
    computable: pdsDettesCtN !== null,
    status: pdsDettesCtN !== null ? (pdsDettesCtN <= 50 ? 'favorable' : pdsDettesCtN <= 70 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: pdsDettesCtN !== null ? `${Math.round(pdsDettesCtN)}% des financements sont exigibles à moins d'un an.` : 'Incalculable'
  });

  const totDettesN = dfN + passCircTotN + bilan.totalTresoreriePassif.n;
  const solvabiliteGenN = totDettesN > 0 ? safeDiv(actifN * 100, totDettesN) : null;
  registerMetric({
    id: 'IND_60', family: 'Liquidité et solvabilité', num: 60,
    code: 'SOLV_GEN', label: 'Ratio de solvabilité générale (Total Actif / Total Dettes)',
    unit: '%', valN: solvabiliteGenN !== null ? Math.round(solvabiliteGenN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Total actif / Total des dettes * 100',
    computable: solvabiliteGenN !== null,
    status: solvabiliteGenN !== null ? (solvabiliteGenN >= 130 ? 'favorable' : solvabiliteGenN >= 100 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: solvabiliteGenN !== null 
      ? `L'actif total couvre ${Math.round(solvabiliteGenN)}% de l'ensemble des dettes (${solvabiliteGenN >= 100 ? 'gage des créanciers assuré' : 'actif insuffisant pour désintéresser tous les créanciers'}).`
      : 'Incalculable'
  });

  // =========================================================================
  // FAMILLE 7 : FLUX DE TRÉSORERIE (61 à 70)
  // =========================================================================
  const tnOuvN = tft.tresorerieOuverture.n; const tnOuvN1 = tft.tresorerieOuverture.n1;
  const cafgN = tft.cafg.n; const cafgN1 = tft.cafg.n1;
  const fluxOpN = tft.fluxTresorerieOperationnels.n; const fluxOpN1 = tft.fluxTresorerieOperationnels.n1;
  const fluxInvN = tft.fluxTresorerieInvestissement.n; const fluxInvN1 = tft.fluxTresorerieInvestissement.n1;
  const fluxFinN = tft.fluxTresorerieFinancement.n; const fluxFinN1 = tft.fluxTresorerieFinancement.n1;
  const varNetteTnN = tft.variationNetteTresorerie.n; const varNetteTnN1 = tft.variationNetteTresorerie.n1;
  const tnClotN = tft.tresorerieCloture.n; const tnClotN1 = tft.tresorerieCloture.n1;

  registerMetric({
    id: 'IND_61', family: 'Flux de trésorerie', num: 61,
    code: 'TN_OUV_TFT', label: 'Trésorerie nette d\'ouverture au 1er janvier',
    unit: 'FCFA', valN: tnOuvN, valN1: tnOuvN1, varAbs: tnOuvN - tnOuvN1, varPct: calcVar(tnOuvN, tnOuvN1).pct,
    formula: 'TFT Réf ZA',
    computable: true,
    status: tnOuvN >= 0 ? 'favorable' : 'alerte',
    interpretation: `Disponibilités nettes de début d'exercice : ${Math.round(tnOuvN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_62', family: 'Flux de trésorerie', num: 62,
    code: 'CAFG', label: 'Capacité d\'Autofinancement Globale (CAFG)',
    unit: 'FCFA', valN: cafgN, valN1: cafgN1, varAbs: cafgN - cafgN1, varPct: calcVar(cafgN, cafgN1).pct,
    formula: 'TFT Réf FA',
    computable: true,
    status: cafgN > 0 ? 'favorable' : 'alerte',
    interpretation: cafgN > 0 ? `Potentiel d'autofinancement généré : ${Math.round(cafgN).toLocaleString('fr-FR')} FCFA.` : 'CAFG négative : l\'activité détruit du potentiel financier.'
  });

  registerMetric({
    id: 'IND_63', family: 'Flux de trésorerie', num: 63,
    code: 'FLUX_OP', label: 'Flux de trésorerie provenant des activités opérationnelles',
    unit: 'FCFA', valN: fluxOpN, valN1: fluxOpN1, varAbs: fluxOpN - fluxOpN1, varPct: calcVar(fluxOpN, fluxOpN1).pct,
    formula: 'CAFG - Variation du BFR lié aux activités opérationnelles (Réf ZB)',
    computable: true,
    status: fluxOpN > 0 ? 'favorable' : 'alerte',
    interpretation: fluxOpN > 0 ? `Cash réel généré par les opérations : +${Math.round(fluxOpN).toLocaleString('fr-FR')} FCFA.` : `Déficit de cash opérationnel (-${Math.round(Math.abs(fluxOpN)).toLocaleString('fr-FR')} FCFA) : l'activité consomme plus de cash qu'elle n'en produit.`
  });

  registerMetric({
    id: 'IND_64', family: 'Flux de trésorerie', num: 64,
    code: 'FLUX_INV', label: 'Flux de trésorerie des activités d\'investissement',
    unit: 'FCFA', valN: fluxInvN, valN1: fluxInvN1, varAbs: fluxInvN - fluxInvN1, varPct: calcVar(fluxInvN, fluxInvN1).pct,
    formula: 'Encaissements cessions - Décaissements acquisitions immobilisations (Réf ZC)',
    computable: true,
    status: 'neutre',
    interpretation: `Effort d'investissement net de l'exercice : ${Math.round(fluxInvN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_65', family: 'Flux de trésorerie', num: 65,
    code: 'FLUX_FIN', label: 'Flux de trésorerie des activités de financement',
    unit: 'FCFA', valN: fluxFinN, valN1: fluxFinN1, varAbs: fluxFinN - fluxFinN1, varPct: calcVar(fluxFinN, fluxFinN1).pct,
    formula: 'Augmentations capital + Nouveaux emprunts - Remboursements - Dividendes (Réf ZF)',
    computable: true,
    status: 'neutre',
    interpretation: `Solde des mouvements de financement : ${Math.round(fluxFinN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_66', family: 'Flux de trésorerie', num: 66,
    code: 'VAR_NETTE_TN_TFT', label: 'Variation nette de trésorerie de l\'exercice',
    unit: 'FCFA', valN: varNetteTnN, valN1: varNetteTnN1, varAbs: varNetteTnN - varNetteTnN1, varPct: null,
    formula: 'Flux opérationnels + Flux investissement + Flux financement (Réf ZG)',
    computable: true,
    status: varNetteTnN >= 0 ? 'favorable' : 'alerte',
    interpretation: varNetteTnN >= 0 ? `Flux monétaire net positif : +${Math.round(varNetteTnN).toLocaleString('fr-FR')} FCFA.` : `Consommation nette de cash : -${Math.round(Math.abs(varNetteTnN)).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_67', family: 'Flux de trésorerie', num: 67,
    code: 'TN_CLOT_TFT', label: 'Trésorerie nette au 31 décembre (TFT)',
    unit: 'FCFA', valN: tnClotN, valN1: tnClotN1, varAbs: tnClotN - tnClotN1, varPct: calcVar(tnClotN, tnClotN1).pct,
    formula: 'Trésorerie ouverture + Variation nette (Réf ZH)',
    computable: true,
    status: tnClotN >= 0 ? 'favorable' : 'alerte',
    interpretation: `Trésorerie disponible de clôture : ${Math.round(tnClotN).toLocaleString('fr-FR')} FCFA.`
  });

  // Free Cash Flow = Flux opérationnels - Décaissements investissements
  const decaissInvestN = tft.totalDecaissementsInvestissements.n;
  const fcfN = fluxOpN - decaissInvestN;
  registerMetric({
    id: 'IND_68', family: 'Flux de trésorerie', num: 68,
    code: 'FREE_CASH_FLOW', label: 'Flux de trésorerie disponible (Free Cash Flow - FCF)',
    unit: 'FCFA', valN: fcfN, valN1: null, varAbs: null, varPct: null,
    formula: 'Flux de trésorerie opérationnels - Décaissements d\'investissements',
    computable: true,
    status: fcfN > 0 ? 'favorable' : 'alerte',
    interpretation: fcfN > 0 
      ? `Cash libre généré après investissements : +${Math.round(fcfN).toLocaleString('fr-FR')} FCFA (disponible pour désendettement ou dividendes).`
      : `Déficit de Free Cash Flow (-${Math.round(Math.abs(fcfN)).toLocaleString('fr-FR')} FCFA) : nécessite des financements externes.`
  });

  // Taux de conversion de l'EBE en trésorerie = Flux opérationnels / EBE
  const convEbeN = ebeN > 0 ? safeDiv(fluxOpN * 100, ebeN) : null;
  registerMetric({
    id: 'IND_69', family: 'Flux de trésorerie', num: 69,
    code: 'CONV_EBE_CASH', label: 'Taux de conversion de l\'EBE en cash opérationnel',
    unit: '%', valN: convEbeN !== null ? Math.round(convEbeN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Flux de trésorerie opérationnels / EBE * 100',
    computable: convEbeN !== null,
    status: convEbeN !== null ? (convEbeN >= 80 ? 'favorable' : convEbeN >= 50 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: convEbeN !== null 
      ? `${Math.round(convEbeN)}% de l'EBE comptable s'est matérialisé en encaissements réels (benchmark de qualité comptable > 70%).`
      : 'Incalculable (EBE nul ou négatif)'
  });

  // Couverture des investissements par les flux opérationnels = Flux op / Décaissements investissements
  const couvInvestN = decaissInvestN > 0 ? safeDiv(fluxOpN * 100, decaissInvestN) : null;
  registerMetric({
    id: 'IND_70', family: 'Flux de trésorerie', num: 70,
    code: 'COUV_INVEST', label: 'Taux d\'autofinancement des investissements (Flux Op / Investissements)',
    unit: '%', valN: couvInvestN !== null ? Math.round(couvInvestN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Flux opérationnels / Décaissements d\'acquisitions d\'immobilisations * 100',
    computable: couvInvestN !== null,
    status: couvInvestN !== null ? (couvInvestN >= 100 ? 'favorable' : couvInvestN >= 50 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: couvInvestN !== null 
      ? `Les investissements de l'exercice ont été autofinancés à hauteur de ${Math.round(couvInvestN)}% par le cash opérationnel.`
      : (decaissInvestN === 0 ? 'Aucun investissement significatif sur l\'exercice.' : 'Incalculable')
  });

  // =========================================================================
  // FAMILLE 8 : CYCLE D'EXPLOITATION (71 à 80)
  // =========================================================================
  const stocksN = bilan.stocks.n; const stocksN1 = bilan.stocks.n1;
  const stocksMoy = stocksN1 > 0 ? (stocksN + stocksN1) / 2 : stocksN;
  // Coût des ventes / achats consommés = Achats marchandises + Achats matières + Autres achats + Var stocks
  const coutAchatsConsommesN = cr.achatsMarchandises.n + cr.varStocksMarchandises.n + cr.achatsMatieresPremieres.n + cr.varStocksMatieres.n + cr.autresAchats.n + cr.varStocksAutresAchats.n;
  const delaiStocksN = coutAchatsConsommesN > 0 ? safeDiv(stocksMoy * nbJours, coutAchatsConsommesN) : null;

  registerMetric({
    id: 'IND_71', family: 'Cycle d\'exploitation', num: 71,
    code: 'ROT_STOCKS_JOURS', label: 'Délai moyen de rotation des stocks',
    unit: 'jours', valN: delaiStocksN !== null ? Math.round(delaiStocksN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Stocks moyens / Coût annuel des achats consommés * 365',
    computable: delaiStocksN !== null,
    status: delaiStocksN !== null ? (delaiStocksN <= 60 ? 'favorable' : delaiStocksN <= 120 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: delaiStocksN !== null ? `Les stocks tournent en moyenne tous les ${Math.round(delaiStocksN)} jours.` : 'Non applicable (pas de stocks).'
  });

  const creancesClientsN = bilan.creancesClients.n; const creancesClientsN1 = bilan.creancesClients.n1;
  const creancesMoy = creancesClientsN1 > 0 ? (creancesClientsN + creancesClientsN1) / 2 : creancesClientsN;
  // Estimation CA TTC avec taux TVA moyen 18% UEMOA/Sénégal
  const caTtcEstimeN = caN * 1.18;
  const dsoN = caTtcEstimeN > 0 ? safeDiv(creancesMoy * nbJours, caTtcEstimeN) : null;

  registerMetric({
    id: 'IND_72', family: 'Cycle d\'exploitation', num: 72,
    code: 'DSO', label: 'Délai moyen de règlement clients (DSO)',
    unit: 'jours', valN: dsoN !== null ? Math.round(dsoN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Créances clients moyennes / Chiffre d\'affaires TTC * 365',
    computable: dsoN !== null,
    status: dsoN !== null ? (dsoN <= 60 ? 'favorable' : dsoN <= 90 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: dsoN !== null ? `Les clients règlent en moyenne à ${Math.round(dsoN)} jours (norme légale < 60-90 jours).` : 'Incalculable'
  });

  const dettesFournN = bilan.fournisseursExploitation.n; const dettesFournN1 = bilan.fournisseursExploitation.n1;
  const dettesFournMoy = dettesFournN1 > 0 ? (dettesFournN + dettesFournN1) / 2 : dettesFournN;
  const achatsTtcEstimesN = (cr.achatsMarchandises.n + cr.achatsMatieresPremieres.n + cr.autresAchats.n + cr.servicesExterieurs.n) * 1.18;
  const dpoN = achatsTtcEstimesN > 0 ? safeDiv(dettesFournMoy * nbJours, achatsTtcEstimesN) : null;

  registerMetric({
    id: 'IND_73', family: 'Cycle d\'exploitation', num: 73,
    code: 'DPO', label: 'Délai moyen de règlement fournisseurs (DPO)',
    unit: 'jours', valN: dpoN !== null ? Math.round(dpoN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dettes fournisseurs moyennes / Achats et services extérieurs TTC * 365',
    computable: dpoN !== null,
    status: dpoN !== null ? (dpoN <= 90 ? 'favorable' : 'vigilance') : 'neutre',
    interpretation: dpoN !== null ? `Paiement des fournisseurs à ${Math.round(dpoN)} jours en moyenne.` : 'Incalculable'
  });

  // Cycle de conversion de trésorerie CCC = Délai Stocks + DSO - DPO
  const cccN = (delaiStocksN !== null || dsoN !== null || dpoN !== null) ? ((delaiStocksN || 0) + (dsoN || 0) - (dpoN || 0)) : null;
  registerMetric({
    id: 'IND_74', family: 'Cycle d\'exploitation', num: 74,
    code: 'CCC', label: 'Cycle de conversion de trésorerie (CCC)',
    unit: 'jours', valN: cccN !== null ? Math.round(cccN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Délai stocks + DSO (clients) - DPO (fournisseurs)',
    computable: cccN !== null,
    status: cccN !== null ? (cccN <= 45 ? 'favorable' : cccN <= 90 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: cccN !== null 
      ? `Cycle de cash de ${Math.round(cccN)} jours entre le décaissement des achats et l'encaissement des ventes.`
      : 'Incalculable'
  });

  const rotClientsN = creancesMoy > 0 ? safeDiv(caTtcEstimeN, creancesMoy) : null;
  registerMetric({
    id: 'IND_75', family: 'Cycle d\'exploitation', num: 75,
    code: 'ROT_CLIENTS', label: 'Vitesse de rotation des créances clients',
    unit: 'ratio', valN: rotClientsN !== null ? Math.round(rotClientsN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Chiffre d\'affaires TTC / Créances clients moyennes',
    computable: rotClientsN !== null,
    status: 'neutre',
    interpretation: rotClientsN !== null ? `Le poste client est recouvré et renouvelé ${Math.round(rotClientsN * 10) / 10} fois par an.` : 'Incalculable'
  });

  const rotFournN = dettesFournMoy > 0 ? safeDiv(achatsTtcEstimesN, dettesFournMoy) : null;
  registerMetric({
    id: 'IND_76', family: 'Cycle d\'exploitation', num: 76,
    code: 'ROT_FOURN', label: 'Vitesse de rotation des dettes fournisseurs',
    unit: 'ratio', valN: rotFournN !== null ? Math.round(rotFournN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Achats et services TTC / Dettes fournisseurs moyennes',
    computable: rotFournN !== null,
    status: 'neutre',
    interpretation: rotFournN !== null ? `Les dettes fournisseurs tournent ${Math.round(rotFournN * 10) / 10} fois par exercice.` : 'Incalculable'
  });

  const rotStocksCoeffN = stocksMoy > 0 ? safeDiv(coutAchatsConsommesN, stocksMoy) : null;
  registerMetric({
    id: 'IND_77', family: 'Cycle d\'exploitation', num: 77,
    code: 'ROT_STOCKS_COEFF', label: 'Coefficient de rotation des stocks',
    unit: 'ratio', valN: rotStocksCoeffN !== null ? Math.round(rotStocksCoeffN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Coût des achats consommés / Stock moyen',
    computable: rotStocksCoeffN !== null,
    status: 'neutre',
    interpretation: rotStocksCoeffN !== null ? `Renouvellement complet du stock ${Math.round(rotStocksCoeffN * 10) / 10} fois par an.` : 'Incalculable'
  });

  const pdsStocksActCircN = actCircN > 0 ? safeDiv(stocksN * 100, actCircN) : null;
  registerMetric({
    id: 'IND_78', family: 'Cycle d\'exploitation', num: 78,
    code: 'POIDS_STOCKS_ACT_CIRC', label: 'Poids des stocks dans l\'actif circulant',
    unit: '%', valN: pdsStocksActCircN !== null ? Math.round(pdsStocksActCircN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Stocks / Actif circulant total * 100',
    computable: pdsStocksActCircN !== null,
    status: pdsStocksActCircN !== null ? (pdsStocksActCircN <= 50 ? 'favorable' : 'vigilance') : 'neutre',
    interpretation: pdsStocksActCircN !== null ? `Les stocks immobilisent ${Math.round(pdsStocksActCircN)}% des actifs à court terme.` : 'Incalculable'
  });

  const pdsClientsCaN = caN > 0 ? safeDiv(creancesClientsN * 100, caN) : null;
  registerMetric({
    id: 'IND_79', family: 'Cycle d\'exploitation', num: 79,
    code: 'POIDS_CLIENTS_CA', label: 'Poids de l\'encours client dans le chiffre d\'affaires',
    unit: '%', valN: pdsClientsCaN !== null ? Math.round(pdsClientsCaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Créances clients / CA annuel * 100',
    computable: pdsClientsCaN !== null,
    status: pdsClientsCaN !== null ? (pdsClientsCaN <= 25 ? 'favorable' : pdsClientsCaN <= 35 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: pdsClientsCaN !== null ? `L'encours client non recouvré représente ${Math.round(pdsClientsCaN)}% des ventes de l'année.` : 'Incalculable'
  });

  const totalAchatsN = cr.achatsMarchandises.n + cr.achatsMatieresPremieres.n + cr.autresAchats.n;
  const pdsFournAchatsN = totalAchatsN > 0 ? safeDiv(dettesFournN * 100, totalAchatsN) : null;
  registerMetric({
    id: 'IND_80', family: 'Cycle d\'exploitation', num: 80,
    code: 'POIDS_FOURN_ACHATS', label: 'Poids du crédit fournisseurs dans les achats',
    unit: '%', valN: pdsFournAchatsN !== null ? Math.round(pdsFournAchatsN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Fournisseurs d\'exploitation / Achats annuels * 100',
    computable: pdsFournAchatsN !== null,
    status: 'neutre',
    interpretation: pdsFournAchatsN !== null ? `Les dettes fournisseurs représentent ${Math.round(pdsFournAchatsN)}% des achats de l'exercice.` : 'Incalculable'
  });

  // =========================================================================
  // FAMILLE 9 : CHARGES ET PRODUCTIVITÉ (81 à 90)
  // =========================================================================
  const pdsAchatsCaN = caN > 0 ? safeDiv(totalAchatsN * 100, caN) : null;
  registerMetric({
    id: 'IND_81', family: 'Charges et productivité', num: 81,
    code: 'POIDS_ACHATS_CA', label: 'Poids des achats de biens dans le chiffre d\'affaires',
    unit: '%', valN: pdsAchatsCaN !== null ? Math.round(pdsAchatsCaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Total achats (marchandises + matières + autres) / CA * 100',
    computable: pdsAchatsCaN !== null,
    status: 'neutre',
    interpretation: pdsAchatsCaN !== null ? `Consommations d'achats : ${Math.round(pdsAchatsCaN)}% du CA.` : 'Incalculable'
  });

  const pdsTranspCaN = caN > 0 ? safeDiv(cr.transports.n * 100, caN) : null;
  registerMetric({
    id: 'IND_82', family: 'Charges et productivité', num: 82,
    code: 'POIDS_TRANSP_CA', label: 'Poids des frais de transport dans le chiffre d\'affaires',
    unit: '%', valN: pdsTranspCaN !== null ? Math.round(pdsTranspCaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Frais de transports / CA * 100',
    computable: pdsTranspCaN !== null,
    status: pdsTranspCaN !== null && pdsTranspCaN > 10 ? 'vigilance' : 'neutre',
    interpretation: pdsTranspCaN !== null ? `Charges logistiques et transport : ${Math.round(pdsTranspCaN * 10) / 10}% du CA.` : 'Incalculable'
  });

  const pdsServExtCaN = caN > 0 ? safeDiv(cr.servicesExterieurs.n * 100, caN) : null;
  registerMetric({
    id: 'IND_83', family: 'Charges et productivité', num: 83,
    code: 'POIDS_SERV_EXT_CA', label: 'Poids des services extérieurs dans le chiffre d\'affaires',
    unit: '%', valN: pdsServExtCaN !== null ? Math.round(pdsServExtCaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Services extérieurs / CA * 100',
    computable: pdsServExtCaN !== null,
    status: pdsServExtCaN !== null && pdsServExtCaN > 25 ? 'vigilance' : 'neutre',
    interpretation: pdsServExtCaN !== null ? `Prestations externes, loyers et sous-traitance : ${Math.round(pdsServExtCaN)}% du CA.` : 'Incalculable'
  });

  const chPersN = cr.chargesPersonnel.n;
  const pdsPersVaN = vaN > 0 ? safeDiv(chPersN * 100, vaN) : null;
  registerMetric({
    id: 'IND_84', family: 'Charges et productivité', num: 84,
    code: 'POIDS_PERS_VA', label: 'Partage de la Valeur Ajoutée au personnel (Charges personnel / VA)',
    unit: '%', valN: pdsPersVaN !== null ? Math.round(pdsPersVaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Charges de personnel / Valeur Ajoutée * 100',
    computable: pdsPersVaN !== null,
    status: pdsPersVaN !== null ? (pdsPersVaN <= 65 ? 'favorable' : pdsPersVaN <= 80 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: pdsPersVaN !== null 
      ? `Les rémunérations absorbent ${Math.round(pdsPersVaN)}% de la richesse créée (zone d'équilibre saine : 50 à 70%).`
      : 'Valeur ajoutée négative ou nulle (masse salariale non couverte).'
  });

  const pdsImpotsCaN = caN > 0 ? safeDiv(cr.impotsTaxes.n * 100, caN) : null;
  registerMetric({
    id: 'IND_85', family: 'Charges et productivité', num: 85,
    code: 'POIDS_IMPOTS_CA', label: 'Poids des impôts et taxes d\'exploitation dans le CA',
    unit: '%', valN: pdsImpotsCaN !== null ? Math.round(pdsImpotsCaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Impôts et taxes d\'exploitation / CA * 100',
    computable: pdsImpotsCaN !== null,
    status: 'neutre',
    interpretation: pdsImpotsCaN !== null ? `Fiscalité d'exploitation directe : ${Math.round(pdsImpotsCaN * 10) / 10}% du CA.` : 'Incalculable'
  });

  const pdsFraisFinCaN = caN > 0 ? safeDiv(fraisFinN * 100, caN) : null;
  registerMetric({
    id: 'IND_86', family: 'Charges et productivité', num: 86,
    code: 'POIDS_FRAIS_FIN_CA', label: 'Poids des charges financières dans le CA',
    unit: '%', valN: pdsFraisFinCaN !== null ? Math.round(pdsFraisFinCaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Frais financiers / CA * 100',
    computable: pdsFraisFinCaN !== null,
    status: pdsFraisFinCaN !== null ? (pdsFraisFinCaN <= 3 ? 'favorable' : pdsFraisFinCaN <= 6 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: pdsFraisFinCaN !== null ? `Poids de la dette sur l'activité : ${Math.round(pdsFraisFinCaN * 10) / 10}% du CA (seuil d'alerte > 4%).` : 'Incalculable'
  });

  const dotAmortN = cr.dotationsAmortProvisExpl.n;
  const txAmortEcoN = immoNetN > 0 ? safeDiv(dotAmortN * 100, immoNetN) : null;
  registerMetric({
    id: 'IND_87', family: 'Charges et productivité', num: 87,
    code: 'TAUX_AMORT_ECO', label: 'Taux d\'amortissement économique de l\'outil de production',
    unit: '%', valN: txAmortEcoN !== null ? Math.round(txAmortEcoN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dotations aux amortissements d\'exploitation / Actif immobilisé net * 100',
    computable: txAmortEcoN !== null,
    status: 'neutre',
    interpretation: txAmortEcoN !== null ? `Rythme d'usure et renouvellement de l'outil de production : ${Math.round(txAmortEcoN)}%/an.` : 'Incalculable'
  });

  const nbSalaries = social.totalSalaries;
  const caParSalarieN = (nbSalaries && caN > 0) ? safeDiv(caN, nbSalaries) : null;
  registerMetric({
    id: 'IND_88', family: 'Charges et productivité', num: 88,
    code: 'CA_PAR_SALARIE', label: 'Chiffre d\'affaires par salarié',
    unit: 'FCFA', valN: caParSalarieN !== null ? Math.round(caParSalarieN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Chiffre d\'affaires / Effectif moyen',
    computable: caParSalarieN !== null,
    status: 'neutre',
    interpretation: caParSalarieN !== null ? `Productivité apparente : ${Math.round(caParSalarieN).toLocaleString('fr-FR')} FCFA de CA / collaborateur.` : 'Effectif non renseigné dans la liasse.'
  });

  const vaParSalarieN = (nbSalaries && vaN > 0) ? safeDiv(vaN, nbSalaries) : null;
  registerMetric({
    id: 'IND_89', family: 'Charges et productivité', num: 89,
    code: 'VA_PAR_SALARIE', label: 'Valeur Ajoutée créée par salarié',
    unit: 'FCFA', valN: vaParSalarieN !== null ? Math.round(vaParSalarieN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Valeur Ajoutée / Effectif moyen',
    computable: vaParSalarieN !== null,
    status: 'neutre',
    interpretation: vaParSalarieN !== null ? `Richesse brute créée : ${Math.round(vaParSalarieN).toLocaleString('fr-FR')} FCFA / collaborateur.` : 'Effectif non renseigné.'
  });

  const ebeParSalarieN = (nbSalaries && ebeN > 0) ? safeDiv(ebeN, nbSalaries) : null;
  registerMetric({
    id: 'IND_90', family: 'Charges et productivité', num: 90,
    code: 'EBE_PAR_SALARIE', label: 'EBE généré par salarié',
    unit: 'FCFA', valN: ebeParSalarieN !== null ? Math.round(ebeParSalarieN) : null, valN1: null, varAbs: null, varPct: null,
    formula: 'EBE / Effectif moyen',
    computable: ebeParSalarieN !== null,
    status: ebeParSalarieN !== null ? (ebeParSalarieN > 0 ? 'favorable' : 'alerte') : 'neutre',
    interpretation: ebeParSalarieN !== null ? `Marge brute générée : ${Math.round(ebeParSalarieN).toLocaleString('fr-FR')} FCFA / collaborateur.` : 'Effectif non renseigné.'
  });

  // =========================================================================
  // FAMILLE 10 : INVESTISSEMENT, FINANCEMENT ET CRÉATION DE VALEUR (91 à 100)
  // =========================================================================
  registerMetric({
    id: 'IND_91', family: 'Investissement, financement et valeur', num: 91,
    code: 'DECAISS_INVEST', label: 'Décaissements d\'investissements de l\'exercice',
    unit: 'FCFA', valN: decaissInvestN, valN1: null, varAbs: null, varPct: null,
    formula: 'TFT Réf FF + FG + FH',
    computable: true,
    status: 'neutre',
    interpretation: `Acquisitions effectives payées d'immobilisations : ${Math.round(decaissInvestN).toLocaleString('fr-FR')} FCFA.`
  });

  const txInvestVaN = vaN > 0 ? safeDiv(decaissInvestN * 100, vaN) : null;
  registerMetric({
    id: 'IND_92', family: 'Investissement, financement et valeur', num: 92,
    code: 'TX_INVEST_VA', label: 'Taux d\'investissement (Investissements / VA)',
    unit: '%', valN: txInvestVaN !== null ? Math.round(txInvestVaN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Décaissements d\'investissements / Valeur Ajoutée * 100',
    computable: txInvestVaN !== null,
    status: txInvestVaN !== null && txInvestVaN >= 15 ? 'favorable' : 'neutre',
    interpretation: txInvestVaN !== null ? `L'entreprise réinvestit ${Math.round(txInvestVaN)}% de sa richesse créée dans son avenir.` : 'Incalculable'
  });

  const immoBrutN = bilan.totalActifImmobiliseBrut.n;
  const txRenouvImmoN = immoBrutN > 0 ? safeDiv(decaissInvestN * 100, immoBrutN) : null;
  registerMetric({
    id: 'IND_93', family: 'Investissement, financement et valeur', num: 93,
    code: 'TX_RENOUV_IMMO', label: 'Taux de renouvellement du parc d\'immobilisations',
    unit: '%', valN: txRenouvImmoN !== null ? Math.round(txRenouvImmoN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Investissements de l\'année / Actif immobilisé brut * 100',
    computable: txRenouvImmoN !== null,
    status: 'neutre',
    interpretation: txRenouvImmoN !== null ? `Renouvellement à hauteur de ${Math.round(txRenouvImmoN)}% du parc brut.` : 'Incalculable'
  });

  const totAmortN = bilan.totalAmortissementsDeprec.n;
  const txAmortApparentN = immoBrutN > 0 ? safeDiv(totAmortN * 100, immoBrutN) : null;
  registerMetric({
    id: 'IND_94', family: 'Investissement, financement et valeur', num: 94,
    code: 'TX_AMORT_APPARENT', label: 'Taux de vétusté apparent des équipements',
    unit: '%', valN: txAmortApparentN !== null ? Math.round(txAmortApparentN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Cumul des amortissements et dépréciations / Actif immobilisé brut * 100',
    computable: txAmortApparentN !== null,
    status: txAmortApparentN !== null ? (txAmortApparentN <= 60 ? 'favorable' : txAmortApparentN <= 80 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txAmortApparentN !== null 
      ? `L'outil de production est amorti à ${Math.round(txAmortApparentN)}% (${txAmortApparentN > 75 ? 'parc vieillissant : besoins d\'investissements de renouvellement à prévoir' : 'parc récent et productif'}).`
      : 'Incalculable'
  });

  const nouvEmpruntsN = tft.empruntsNouveaux.n;
  registerMetric({
    id: 'IND_95', family: 'Investissement, financement et valeur', num: 95,
    code: 'NOUV_EMPRUNTS', label: 'Nouveaux emprunts et financements mobilisés',
    unit: 'FCFA', valN: nouvEmpruntsN, valN1: null, varAbs: null, varPct: null,
    formula: 'TFT Réf FO + FP',
    computable: true,
    status: 'neutre',
    interpretation: `Tirages de nouveaux crédits bancaires sur l'exercice : ${Math.round(nouvEmpruntsN).toLocaleString('fr-FR')} FCFA.`
  });

  registerMetric({
    id: 'IND_96', family: 'Investissement, financement et valeur', num: 96,
    code: 'REMB_EMPRUNTS', label: 'Remboursements en capital d\'emprunts',
    unit: 'FCFA', valN: rembEmpruntsN, valN1: null, varAbs: null, varPct: null,
    formula: 'TFT Réf FQ',
    computable: true,
    status: 'neutre',
    interpretation: `Amortissement financier du capital emprunté : ${Math.round(rembEmpruntsN).toLocaleString('fr-FR')} FCFA.`
  });

  const divVersesN = tft.dividendesVerses.n;
  registerMetric({
    id: 'IND_97', family: 'Investissement, financement et valeur', num: 97,
    code: 'DIVIDENDES_VERSES', label: 'Dividendes décaissés aux associés',
    unit: 'FCFA', valN: divVersesN, valN1: null, varAbs: null, varPct: null,
    formula: 'TFT Réf FN',
    computable: true,
    status: 'neutre',
    interpretation: `Rémunération du capital versée : ${Math.round(divVersesN).toLocaleString('fr-FR')} FCFA.`
  });

  // Taux de distribution = Dividendes / Résultat Net N-1 (ou N si positif)
  const baseDistrib = rnN1 > 0 ? rnN1 : (rnN > 0 ? rnN : null);
  const txDistribN = (baseDistrib && divVersesN > 0) ? safeDiv(divVersesN * 100, baseDistrib) : (divVersesN === 0 ? 0 : null);
  registerMetric({
    id: 'IND_98', family: 'Investissement, financement et valeur', num: 98,
    code: 'TX_DISTRIB_DIV', label: 'Taux de distribution des dividendes (Payout Ratio)',
    unit: '%', valN: txDistribN !== null ? Math.round(txDistribN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dividendes versés / Résultat net distribuable * 100',
    computable: txDistribN !== null,
    status: txDistribN !== null ? (txDistribN <= 50 ? 'favorable' : txDistribN <= 80 ? 'vigilance' : 'alerte') : 'neutre',
    interpretation: txDistribN !== null ? `Distribution de ${Math.round(txDistribN)}% des bénéfices générés aux actionnaires.` : 'Non applicable (pas de dividendes distribués).'
  });

  const txRetentionN = txDistribN !== null ? Math.max(0, 100 - txDistribN) : (rnN > 0 ? 100 : null);
  registerMetric({
    id: 'IND_99', family: 'Investissement, financement et valeur', num: 99,
    code: 'TX_RETENTION_BENEF', label: 'Taux de rétention des bénéfices (Autofinancement interne)',
    unit: '%', valN: txRetentionN !== null ? Math.round(txRetentionN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: '100 - Taux de distribution des dividendes',
    computable: txRetentionN !== null,
    status: txRetentionN !== null && txRetentionN >= 50 ? 'favorable' : 'neutre',
    interpretation: txRetentionN !== null ? `${Math.round(txRetentionN)}% des bénéfices sont mis en réserve pour consolider l'autonomie financière.` : 'Incalculable'
  });

  const capDesendettementN = (cafgN > 0 && detteFinNetteN > 0) ? safeDiv(detteFinNetteN, cafgN) : (detteFinNetteN <= 0 ? 0 : null);
  registerMetric({
    id: 'IND_100', family: 'Investissement, financement et valeur', num: 100,
    code: 'CAPACITE_DESENDETT', label: 'Capacité théorique de désendettement (Dette Nette / CAFG)',
    unit: 'années', valN: capDesendettementN !== null ? Math.round(capDesendettementN * 10) / 10 : null, valN1: null, varAbs: null, varPct: null,
    formula: 'Dette financière nette / Capacité d\'Autofinancement Globale (CAFG)',
    computable: capDesendettementN !== null,
    status: capDesendettementN !== null ? (capDesendettementN <= 3.0 ? 'favorable' : capDesendettementN <= 5.0 ? 'vigilance' : 'alerte') : 'alerte',
    interpretation: capDesendettementN !== null 
      ? `L'entreprise peut apurer l'intégralité de sa dette nette en ${Math.round(capDesendettementN * 10) / 10} ans de cash-flow d'autofinancement (norme prudentielle < 3 à 4 ans).`
      : 'CAFG négative ou incalculable : risque de surendettement.'
  });

  // Regroupement par famille pour l'affichage synthétique
  const families = {};
  for (const m of metrics) {
    families[m.family] = families[m.family] || [];
    families[m.family].push(m);
  }

  return {
    metrics,
    metricsMap,
    families,
    count: metrics.length,
    computableCount: metrics.filter(m => m.computable).length
  };
}
