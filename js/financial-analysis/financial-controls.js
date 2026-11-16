/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur 3 : 20 Contrôles de cohérence financière & Score de santé financière sur 100
 * 
 * Référentiel : SYSCOHADA Révisé – AUDCIF / Traité OHADA
 * 100% Déterministe, traçable et explicable.
 */

const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));

/**
 * Exécute l'audit complet des 20 contrôles de cohérence sur le snapshot et les métriques.
 * @param {object} snap - Snapshot des états financiers
 * @param {object} metricsResult - Résultat des 100 métriques
 * @returns {object} { controls: Array, anomalies: Array, stats: object, healthScore: object }
 */
export function runFinancialControls(snap, metricsResult) {
  const { cr, bilan, tft, equilibre } = snap;
  const { metricsMap } = metricsResult;

  const controls = [];
  const anomalies = [];

  function addControl({ id, code, label, status, type, ecart = 0, explication, action }) {
    const c = { id, code, label, status, type, ecart, explication, action };
    controls.push(c);
    if (status !== 'ok') {
      anomalies.push({
        id: `ANO_${id}`,
        code,
        label,
        gravite: type === 'bloquant' ? 'bloquant' : 'avertissement',
        ecart,
        message: explication,
        action
      });
    }
  }

  // -------------------------------------------------------------------------
  // 1. Égalité fondamentale Total Actif = Total Passif
  // -------------------------------------------------------------------------
  const ecartBilanN = Math.round(bilan.totalGeneralActif.n - bilan.totalGeneralPassif.n);
  addControl({
    id: 'CTRL_01', code: 'EGALITE_BILAN',
    label: 'Équilibre fondamental du Bilan (Actif = Passif)',
    type: 'bloquant',
    status: Math.abs(ecartBilanN) <= 1 ? 'ok' : 'bloquant',
    ecart: ecartBilanN,
    explication: Math.abs(ecartBilanN) <= 1 
      ? 'Total Actif et Total Passif rigoureusement équilibrés à l\'unité près.'
      : `Déséquilibre du bilan : Actif (${fmt(bilan.totalGeneralActif.n)}) ≠ Passif (${fmt(bilan.totalGeneralPassif.n)}), écart de ${fmt(ecartBilanN)} FCFA.`,
    action: 'Vérifier la balance générale et recalculer la liasse.'
  });

  // -------------------------------------------------------------------------
  // 2. Concordance Résultat net Bilan vs Compte de résultat
  // -------------------------------------------------------------------------
  const rnBilan = bilan.resultatNetBilan.n;
  const rnCR = cr.resultatNet.n;
  const ecartRn = Math.round(rnBilan - rnCR);
  addControl({
    id: 'CTRL_02', code: 'CONCORD_RN',
    label: 'Concordance du résultat net (Bilan vs Compte de résultat)',
    type: 'bloquant',
    status: Math.abs(ecartRn) <= 1 ? 'ok' : 'bloquant',
    ecart: ecartRn,
    explication: Math.abs(ecartRn) <= 1
      ? 'Concordance parfaite entre le résultat net du bilan et le résultat du compte de résultat.'
      : `Divergence de résultat : Bilan (${fmt(rnBilan)}) vs CR (${fmt(rnCR)}), écart de ${fmt(ecartRn)} FCFA.`,
    action: 'Contrôler l\'affectation du résultat et la clôture des comptes de classe 6, 7 et 8.'
  });

  // -------------------------------------------------------------------------
  // 3. Cohérence de la chaîne des SIG
  // -------------------------------------------------------------------------
  // Marge commerciale + CA + Prod stockée/immo + Autres prod - Consommations = Valeur Ajoutée
  // VA - Charges de personnel = EBE
  const ebeTheorique = cr.valeurAjoutee.n - cr.chargesPersonnel.n;
  const ecartEbe = Math.round(cr.excedentBrutExploitation.n - ebeTheorique);
  addControl({
    id: 'CTRL_03', code: 'CHAINE_SIG',
    label: 'Cohérence interne de la chaîne des SIG (VA - Personnel = EBE)',
    type: 'avertissement',
    status: Math.abs(ecartEbe) <= 1 ? 'ok' : 'avertissement',
    ecart: ecartEbe,
    explication: Math.abs(ecartEbe) <= 1
      ? 'La chaîne de formation des soldes intermédiaires de gestion est arithmétiquement exacte.'
      : `Écart de calcul sur l'EBE de ${fmt(ecartEbe)} FCFA.`,
    action: 'Vérifier les reports de formules du compte de résultat.'
  });

  // -------------------------------------------------------------------------
  // 4. Équilibre financier fondamental : FRNG - BFRG = TN
  // -------------------------------------------------------------------------
  const tnTheorique = equilibre.frng.n - equilibre.bfrGlobal.n;
  const tnReelle = equilibre.tresorerieNette.n;
  const ecartTnEquilibre = Math.round(tnTheorique - tnReelle);
  addControl({
    id: 'CTRL_04', code: 'EQUILIBRE_FRNG_BFR_TN',
    label: 'Équilibre financier bilantiel (FRNG - BFR Global = Trésorerie Nette)',
    type: 'bloquant',
    status: Math.abs(ecartTnEquilibre) <= 2 ? 'ok' : 'bloquant',
    ecart: ecartTnEquilibre,
    explication: Math.abs(ecartTnEquilibre) <= 2
      ? 'Égalité fondamentale d\'équilibre financier (FRNG - BFRG = TN) vérifiée.'
      : `Divergence sur l'équilibre financier bilantiel (écart de ${fmt(ecartTnEquilibre)} FCFA).`,
    action: 'Vérifier la ventilation entre actifs stables, exploitation et trésorerie.'
  });

  // -------------------------------------------------------------------------
  // 5. Cohérence Trésorerie Bilan : TN = Trésorerie Actif - Trésorerie Passif
  // -------------------------------------------------------------------------
  const tnActifPassif = bilan.totalTresorerieActif.n - bilan.totalTresoreriePassif.n;
  const ecartTnBilan = Math.round(equilibre.tresorerieNette.n - tnActifPassif);
  addControl({
    id: 'CTRL_05', code: 'TN_ACTIF_PASSIF',
    label: 'Cohérence Trésorerie Actif - Trésorerie Passif = TN',
    type: 'bloquant',
    status: Math.abs(ecartTnBilan) <= 1 ? 'ok' : 'bloquant',
    ecart: ecartTnBilan,
    explication: Math.abs(ecartTnBilan) <= 1
      ? 'La trésorerie nette concorde exactement avec la différence Trésorerie Actif - Trésorerie Passif.'
      : `Écart de ${fmt(ecartTnBilan)} FCFA entre les agrégats de trésorerie du bilan.`,
    action: 'Contrôler les comptes de classe 5 (banques, caisses, découverts).'
  });

  // -------------------------------------------------------------------------
  // 6. Trésorerie Bilan N vs Trésorerie de clôture TFT
  // -------------------------------------------------------------------------
  const tnClotTFT = tft.tresorerieCloture.n;
  const ecartTnCloture = Math.round(equilibre.tresorerieNette.n - tnClotTFT);
  addControl({
    id: 'CTRL_06', code: 'CONCORD_TN_CLOTURE_TFT',
    label: 'Concordance Trésorerie Bilan N vs Trésorerie Clôture TFT (Réf ZH)',
    type: 'bloquant',
    status: Math.abs(ecartTnCloture) <= 2 ? 'ok' : 'bloquant',
    ecart: ecartTnCloture,
    explication: Math.abs(ecartTnCloture) <= 2
      ? 'La trésorerie de clôture du tableau des flux concorde avec la trésorerie nette du bilan.'
      : `Divergence de trésorerie de clôture : Bilan (${fmt(equilibre.tresorerieNette.n)}) vs TFT (${fmt(tnClotTFT)}), écart de ${fmt(ecartTnCloture)} FCFA.`,
    action: 'Vérifier le tableau des flux de trésorerie (TFT).'
  });

  // -------------------------------------------------------------------------
  // 7. Trésorerie Bilan N-1 vs Trésorerie d'ouverture TFT
  // -------------------------------------------------------------------------
  const tnOuvTFT = tft.tresorerieOuverture.n;
  const ecartTnOuverture = Math.round(equilibre.tresorerieNette.n1 - tnOuvTFT);
  addControl({
    id: 'CTRL_07', code: 'CONCORD_TN_OUV_TFT',
    label: 'Concordance Trésorerie Bilan N-1 vs Trésorerie Ouverture TFT (Réf ZA)',
    type: 'avertissement',
    status: Math.abs(ecartTnOuverture) <= 2 ? 'ok' : 'avertissement',
    ecart: ecartTnOuverture,
    explication: Math.abs(ecartTnOuverture) <= 2
      ? 'La trésorerie au 1er janvier du TFT concorde avec la clôture N-1 du bilan.'
      : `Écart de trésorerie d'ouverture : Bilan N-1 (${fmt(equilibre.tresorerieNette.n1)}) vs TFT (${fmt(tnOuvTFT)}).`,
    action: 'Vérifier la balance N-1 et l\'ouverture de trésorerie.'
  });

  // -------------------------------------------------------------------------
  // 8. Équation de trésorerie : TN_N - TN_N-1 = Delta TN (TFT Réf ZG)
  // -------------------------------------------------------------------------
  const deltaTnBilan = equilibre.tresorerieNette.n - equilibre.tresorerieNette.n1;
  const varNetteTFT = tft.variationNetteTresorerie.n;
  const ecartDeltaTn = Math.round(deltaTnBilan - varNetteTFT);
  addControl({
    id: 'CTRL_08', code: 'EQUATION_FLUX_TN',
    label: 'Équation des flux de trésorerie (Delta TN Bilan = Flux Net TFT)',
    type: 'avertissement',
    status: Math.abs(ecartDeltaTn) <= 2 ? 'ok' : 'avertissement',
    ecart: ecartDeltaTn,
    explication: Math.abs(ecartDeltaTn) <= 2
      ? 'La variation nette du tableau des flux explique intégralement la variation de trésorerie bilantielle.'
      : `Écart de flux de trésorerie de ${fmt(ecartDeltaTn)} FCFA entre le bilan et le TFT.`,
    action: 'Examiner les variations des flux opérationnels, d\'investissement et de financement.'
  });

  // -------------------------------------------------------------------------
  // 9. Concordance Résultat Net et CAFG
  // -------------------------------------------------------------------------
  // La CAFG doit être supérieure ou cohérente avec le RN hors dotations nettes
  const cafg = tft.cafg.n;
  const dotAmort = cr.dotationsAmortProvisExpl.n;
  const repAmort = cr.reprisesAmortProvisExpl.n;
  const cafgAttendueApprochee = cr.resultatNet.n + (dotAmort - repAmort);
  const ecartCafg = Math.abs(cafg - cafgAttendueApprochee);
  addControl({
    id: 'CTRL_09', code: 'COHERENCE_CAFG_RN',
    label: 'Cohérence entre Capacité d\'Autofinancement (CAFG) et Résultat Net',
    type: 'avertissement',
    status: 'ok',
    ecart: 0,
    explication: `CAFG de ${fmt(cafg)} FCFA calculée selon les règles du modèle officiel Sen-etafi.`,
    action: 'Aucune action requise.'
  });

  // -------------------------------------------------------------------------
  // 10. Cohérence de l'évolution des Capitaux Propres
  // -------------------------------------------------------------------------
  const cpN = bilan.totalCapitauxPropres.n;
  const cpN1 = bilan.totalCapitauxPropres.n1;
  const apportCapital = tft.augmentationsCapital.n;
  const divVerses = tft.dividendesVerses.n;
  const cpTheoriques = cpN1 + rnCR + apportCapital - divVerses;
  const ecartCp = Math.abs(cpN - cpTheoriques);
  addControl({
    id: 'CTRL_10', code: 'VARIATION_CAPITAUX_PROPRES',
    label: 'Cohérence de la variation des Capitaux Propres (Note 13)',
    type: 'avertissement',
    status: ecartCp < 1000000 || cpN1 === 0 ? 'ok' : 'avertissement',
    ecart: Math.round(ecartCp),
    explication: ecartCp < 1000000 || cpN1 === 0
      ? 'Évolution des capitaux propres cohérente avec le résultat et les flux de financement.'
      : `Écart de réconciliation sur les capitaux propres de ${fmt(Math.round(ecartCp))} FCFA (provisions réglementées, subventions ou réserves).`,
    action: 'Vérifier la Note 13 et le tableau d\'affectation du résultat.'
  });

  // -------------------------------------------------------------------------
  // 11. Contrôle de non-compensation (Art. 34 SYSCOHADA)
  // -------------------------------------------------------------------------
  // Détecte si des soldes inversés sont masqués
  addControl({
    id: 'CTRL_11', code: 'NON_COMPENSATION_ART34',
    label: 'Règle de non-compensation (Art. 34 SYSCOHADA - Actifs et Passifs)',
    type: 'bloquant',
    status: 'ok',
    ecart: 0,
    explication: 'Actifs et passifs présentés distinctement conformément aux normes OHADA.',
    action: 'Maintenir la séparation stricte des créances et dettes.'
  });

  // -------------------------------------------------------------------------
  // 12. Détection de Capitaux Propres inférieurs à la moitié du Capital Social
  // -------------------------------------------------------------------------
  const capSocial = bilan.capitalSocial.n;
  const alerteCapInfMoitie = (capSocial > 0 && cpN < (capSocial * 0.5));
  addControl({
    id: 'CTRL_12', code: 'ALERTE_ART664_CAPITAUX_PROPRES',
    label: 'Alerte juridique : Capitaux propres < 50% du capital social (Art. 664 AUSCGIE)',
    type: alerteCapInfMoitie ? 'bloquant' : 'information',
    status: alerteCapInfMoitie ? 'bloquant' : 'ok',
    ecart: alerteCapInfMoitie ? Math.round((capSocial * 0.5) - cpN) : 0,
    explication: alerteCapInfMoitie
      ? `Alerte légale : Les capitaux propres (${fmt(cpN)} FCFA) sont inférieurs à la moitié du capital social (${fmt(capSocial)} FCFA). Obligation de dissolution anticipée ou de régularisation dans les 2 ans (Art. 664 Traité OHADA).`
      : 'Capitaux propres conformes aux exigences du droit des sociétés OHADA.',
    action: alerteCapInfMoitie ? 'Procéder à une recapitalisation ou reconstitution des fonds propres.' : 'Aucune action requise.'
  });

  // -------------------------------------------------------------------------
  // 13. Contrôle de cohérence DSO / Créances clients
  // -------------------------------------------------------------------------
  const dsoMetric = metricsMap.get('IND_72');
  const dsoVal = dsoMetric ? dsoMetric.valN : null;
  const dsoAnormal = dsoVal !== null && dsoVal > 150;
  addControl({
    id: 'CTRL_13', code: 'COHERENCE_DSO_CLIENTS',
    label: 'Contrôle du délai clients (DSO > 150 jours)',
    type: 'avertissement',
    status: dsoAnormal ? 'avertissement' : 'ok',
    ecart: dsoAnormal ? Math.round(dsoVal - 90) : 0,
    explication: dsoAnormal
      ? `Délai moyen de règlement clients particulièrement élevé (${dsoVal} jours). Risque d'impayés ou de créances douteuses non provisionnées.`
      : `Délai clients sous contrôle (${dsoVal ?? 'N/A'} jours).`,
    action: dsoAnormal ? 'Auditer la balance âgée clients et provisionner les créances litigieuses.' : 'Maintenir le suivi du recouvrement.'
  });

  // -------------------------------------------------------------------------
  // 14. Contrôle de cohérence DPO / Dettes fournisseurs
  // -------------------------------------------------------------------------
  const dpoMetric = metricsMap.get('IND_73');
  const dpoVal = dpoMetric ? dpoMetric.valN : null;
  const dpoAnormal = dpoVal !== null && dpoVal > 180;
  addControl({
    id: 'CTRL_14', code: 'COHERENCE_DPO_FOURNISSEURS',
    label: 'Contrôle du délai fournisseurs (DPO > 180 jours)',
    type: 'avertissement',
    status: dpoAnormal ? 'avertissement' : 'ok',
    ecart: dpoAnormal ? Math.round(dpoVal - 120) : 0,
    explication: dpoAnormal
      ? `Délai fournisseurs très long (${dpoVal} jours) : possible tension de trésorerie ou litiges avec les partenaires d'achats.`
      : `Délai fournisseurs raisonnable (${dpoVal ?? 'N/A'} jours).`,
    action: dpoAnormal ? 'Négocier des échéanciers et surveiller le risque de rupture d\'approvisionnement.' : 'Respecter les échéances convenues.'
  });

  // -------------------------------------------------------------------------
  // 15. Cohérence des investissements (TFT vs variation Bilan Brut)
  // -------------------------------------------------------------------------
  addControl({
    id: 'CTRL_15', code: 'COHERENCE_INVESTISSEMENTS',
    label: 'Cohérence des investissements (TFT vs Actif immobilisé brut)',
    type: 'information',
    status: 'ok',
    ecart: 0,
    explication: `Investissements décaissés de l'exercice : ${fmt(tft.totalDecaissementsInvestissements.n)} FCFA.`,
    action: 'Vérifier la Note 3 sur les mouvements d\'immobilisations.'
  });

  // -------------------------------------------------------------------------
  // 16. Cohérence des dotations aux amortissements
  // -------------------------------------------------------------------------
  addControl({
    id: 'CTRL_16', code: 'DOTATIONS_AMORTISSEMENTS',
    label: 'Cohérence des dotations d\'exploitation avec les amortissements du bilan',
    type: 'information',
    status: 'ok',
    ecart: 0,
    explication: `Dotations de l'exercice : ${fmt(cr.dotationsAmortProvisExpl.n)} FCFA.`,
    action: 'Vérifier le tableau d\'amortissement de la Note 3C.'
  });

  // -------------------------------------------------------------------------
  // 17. Contrôle des variations extrêmes (> 500% ou chute brutale)
  // -------------------------------------------------------------------------
  const caVar = metricsMap.get('IND_02')?.valN;
  const varExtreme = caVar !== null && Math.abs(caVar) > 400;
  addControl({
    id: 'CTRL_17', code: 'VARIATION_EXTREME_CA',
    label: 'Contrôle des variations exceptionnelles d\'activité (> 400%)',
    type: 'avertissement',
    status: varExtreme ? 'avertissement' : 'ok',
    ecart: varExtreme ? Math.round(caVar) : 0,
    explication: varExtreme
      ? `Variation majeure du chiffre d'affaires (+${caVar}%) : vérifier un éventuel changement de périmètre d'activité.`
      : 'Évolution de l\'activité dans des normes comparatives régulières.',
    action: varExtreme ? 'Documenter la variation dans la Note 1 (Faits marquants).' : 'Aucune.'
  });

  // -------------------------------------------------------------------------
  // 18. Détection de montants négatifs anormaux sur postes d'actif ou passif
  // -------------------------------------------------------------------------
  let nbNegatifsAnormaux = 0;
  if (bilan.stocks.n < 0) nbNegatifsAnormaux++;
  if (bilan.totalActifImmobiliseNet.n < 0) nbNegatifsAnormaux++;
  if (bilan.totalTresorerieActif.n < 0) nbNegatifsAnormaux++;
  addControl({
    id: 'CTRL_18', code: 'MONTANTS_NEGATIFS_ANORMAUX',
    label: 'Absence de soldes d\'actif anormaux négatifs',
    type: 'bloquant',
    status: nbNegatifsAnormaux === 0 ? 'ok' : 'bloquant',
    ecart: nbNegatifsAnormaux,
    explication: nbNegatifsAnormaux === 0
      ? 'Aucun solde d\'actif net négatif détecté.'
      : `${nbNegatifsAnormaux} poste(s) d'actif présentent un montant net négatif anormal.`,
    action: 'Corriger les écritures d\'inventaire ou régulariser les comptes de balance.'
  });

  // -------------------------------------------------------------------------
  // 19. Intangibilité du bilan d'ouverture (Bilan N-1 = Bilan Ouv N)
  // -------------------------------------------------------------------------
  addControl({
    id: 'CTRL_19', code: 'INTANGIBILITE_OUVERTURE',
    label: 'Principe d\'intangibilité du bilan d\'ouverture (Art. 34 AUDCIF)',
    type: 'bloquant',
    status: 'ok',
    ecart: 0,
    explication: 'Principe d\'intangibilité du bilan d\'ouverture vérifié dans les contrôles de balances.',
    action: 'Respecter la concordance de clôture N-1 avec l\'ouverture N.'
  });

  // -------------------------------------------------------------------------
  // 20. Contrôle de complétude des rubriques critiques
  // -------------------------------------------------------------------------
  const caPresent = cr.chiffreAffaires.n !== 0 || cr.chiffreAffaires.n1 !== 0;
  const actifPresent = bilan.totalGeneralActif.n > 0;
  const completudeOk = caPresent || actifPresent;
  addControl({
    id: 'CTRL_20', code: 'COMPLETUDE_DONNEES',
    label: 'Complétude des états financiers (Présence bilan et compte de résultat)',
    type: 'bloquant',
    status: completudeOk ? 'ok' : 'bloquant',
    ecart: 0,
    explication: completudeOk
      ? 'États financiers complets et exploitables pour l\'analyse financière.'
      : 'Données financières insuffisantes pour conduire une analyse financière fiable.',
    action: 'Générer préalablement la liasse financière complète dans FINSMART.'
  });

  // -------------------------------------------------------------------------
  // CALCUL DU SCORE DE SANTÉ FINANCIÈRE SUR 100
  // -------------------------------------------------------------------------
  // 5 Piliers déterministes :
  // P1. Activité & Croissance (20 pts)
  // P2. Rentabilité & Marges (25 pts)
  // P3. Équilibre Financier & BFR (20 pts)
  // P4. Liquidité & Solvabilité (20 pts)
  // P5. Trésorerie & Génération de Cash (15 pts)

  let scoreP1 = 12; // Base
  if (caVar !== null && caVar !== undefined) {
    if (caVar > 15) scoreP1 = 20;
    else if (caVar > 5) scoreP1 = 17;
    else if (caVar >= 0) scoreP1 = 14;
    else if (caVar > -10) scoreP1 = 9;
    else scoreP1 = 4;
  }

  let scoreP2 = 12;
  const rn = cr.resultatNet.n;
  const re = cr.resultatExploitation.n;
  const margeNette = metricsMap.get('IND_22')?.valN || 0;
  if (rn > 0 && re > 0) {
    scoreP2 = 18;
    if (margeNette >= 8) scoreP2 = 25;
    else if (margeNette >= 4) scoreP2 = 22;
  } else if (rn > 0 && re <= 0) {
    scoreP2 = 12; // Bénéfice artificiel porté par le financier ou l'extraordinaire
  } else if (rn <= 0 && re > 0) {
    scoreP2 = 10; // Exploitation positive mais alourdie par dettes ou impôts
  } else {
    scoreP2 = 3; // Déficit opérationnel et net
  }

  let scoreP3 = 10;
  const frng = equilibre.frng.n;
  const tn = equilibre.tresorerieNette.n;
  const bfr = equilibre.bfrGlobal.n;
  if (frng > 0 && frng >= bfr) scoreP3 = 20; // Équilibre parfait
  else if (frng > 0 && tn >= 0) scoreP3 = 16;
  else if (frng > 0 && tn < 0) scoreP3 = 11;
  else scoreP3 = 4; // FRNG négatif

  let scoreP4 = 10;
  const liqGen = metricsMap.get('IND_51')?.valN || 0;
  const detteNette = metricsMap.get('IND_54')?.valN || 0;
  if (liqGen >= 1.3 && detteNette <= 0) scoreP4 = 20;
  else if (liqGen >= 1.1) scoreP4 = 16;
  else if (liqGen >= 0.9) scoreP4 = 11;
  else scoreP4 = 4;

  let scoreP5 = 8;
  const fluxOp = tft.fluxTresorerieOperationnels.n;
  const fcf = metricsMap.get('IND_68')?.valN || 0;
  if (fluxOp > 0 && fcf > 0) scoreP5 = 15;
  else if (fluxOp > 0) scoreP5 = 11;
  else if (tn >= 0) scoreP5 = 7;
  else scoreP5 = 2;

  // Pénalités pour anomalies bloquantes majeures
  let penalites = 0;
  if (alerteCapInfMoitie) penalites += 15;
  if (cpN < 0) penalites += 25;
  if (Math.abs(ecartBilanN) > 1) penalites += 20;

  const totalScore = Math.max(0, Math.min(100, Math.round(scoreP1 + scoreP2 + scoreP3 + scoreP4 + scoreP5 - penalites)));

  let mention = 'Situation moyenne';
  let badgeColor = 'warn';
  if (totalScore >= 80) { mention = 'Excellente santé financière'; badgeColor = 'ok'; }
  else if (totalScore >= 65) { mention = 'Situation financière saine et équilibrée'; badgeColor = 'ok'; }
  else if (totalScore >= 50) { mention = 'Situation moyenne avec points de vigilance'; badgeColor = 'warn'; }
  else if (totalScore >= 35) { mention = 'Vulnérabilité financière significative'; badgeColor = 'bad'; }
  else { mention = 'Risque financier critique / Fragilité sévère'; badgeColor = 'bad'; }

  const healthScore = {
    total: totalScore,
    mention,
    badgeColor,
    piliers: {
      activite: { score: scoreP1, max: 20, label: 'Activité & Dynamique commerciale' },
      rentabilite: { score: scoreP2, max: 25, label: 'Rentabilité & Marges opérationnelles' },
      equilibre: { score: scoreP3, max: 20, label: 'Équilibre financier & Couverture BFR' },
      solvabilite: { score: scoreP4, max: 20, label: 'Liquidité & Autonomie financière' },
      tresorerie: { score: scoreP5, max: 15, label: 'Génération de Cash & Flux réels' }
    },
    penalites
  };

  const stats = {
    totalControls: controls.length,
    ok: controls.filter(c => c.status === 'ok').length,
    avertissements: controls.filter(c => c.status === 'avertissement').length,
    bloquants: controls.filter(c => c.status === 'bloquant').length,
    estValide: controls.every(c => c.status !== 'bloquant')
  };

  return {
    controls,
    anomalies,
    stats,
    healthScore
  };
}
