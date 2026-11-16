/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur 4 : Intelligence Artificielle financière, Synthèse exécutive & FINSMART Analyste IA
 * 
 * Règles impératives :
 * - Jamais d'invention de montants : chaque chiffre cité provient de financial-metrics.js.
 * - Structure stricte : Constat chiffré -> Comparaison N vs N-1 -> Conséquence financière -> Recommandation.
 * - Générateur expert déterministe intégré + connecteur LLM haute fidélité.
 */

const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));

/**
 * Génère l'ensemble des analyses narratives expertes pour chaque section du rapport.
 * @param {object} snap - Snapshot des états financiers
 * @param {object} metricsResult - Catalogue des 100 métriques calculées
 * @param {object} controlsResult - Résultat des 20 contrôles et score de santé
 * @returns {object} { syntheseExecutive, sections: object, recommandations: Array }
 */
export function generateExpertNarrative(snap, metricsResult, controlsResult) {
  const { cr, bilan, tft, equilibre, metadata } = snap;
  const { metricsMap } = metricsResult;
  const score = controlsResult.healthScore;

  const ca = metricsMap.get('IND_01');
  const croissCa = metricsMap.get('IND_02');
  const va = metricsMap.get('IND_13');
  const ebe = metricsMap.get('IND_15');
  const re = metricsMap.get('IND_17');
  const rn = metricsMap.get('IND_21');
  const margeNette = metricsMap.get('IND_22');
  const roe = metricsMap.get('IND_24');
  const roa = metricsMap.get('IND_25');
  const frng = metricsMap.get('IND_41');
  const bfre = metricsMap.get('IND_42');
  const tn = metricsMap.get('IND_45');
  const detteNette = metricsMap.get('IND_54');
  const liqGen = metricsMap.get('IND_51');
  const fluxOp = metricsMap.get('IND_63');
  const fcf = metricsMap.get('IND_68');
  const dso = metricsMap.get('IND_72');
  const dpo = metricsMap.get('IND_73');
  const ccc = metricsMap.get('IND_74');
  const chPersVa = metricsMap.get('IND_84');

  // 1. SYNTHÈSE EXÉCUTIVE DESTINÉE À LA DIRECTION GÉNÉRALE
  const tendanceAct = croissCa.valN !== null ? (croissCa.valN >= 0 ? `progression de +${croissCa.valN}%` : `contraction de ${croissCa.valN}%`) : 'stabilité';
  const rentabState = rn.valN > 0 ? `bénéficiaire (${fmt(rn.valN)} FCFA)` : `déficitaire (${fmt(rn.valN)} FCFA)`;
  const tresoState = tn.valN >= 0 ? `excédentaire (+${fmt(tn.valN)} FCFA)` : `tendue avec un solde négatif de ${fmt(tn.valN)} FCFA`;

  const syntheseExecutive = {
    titre: `Diagnostic Financier Stratégique – Exercice ${metadata.anneeN}`,
    scoreGlobal: score.total,
    mention: score.mention,
    constatGlobal: `Au terme de l'exercice clos le 31 décembre ${metadata.anneeN}, ${metadata.denomination} affiche un chiffre d'affaires de ${fmt(ca.valN)} FCFA (en ${tendanceAct} par rapport à ${metadata.anneeN1}) et dégage un résultat net ${rentabState}. La structure financière globale se caractérise par un fonds de roulement net global de ${fmt(frng.valN)} FCFA et une trésorerie nette ${tresoState}.`,
    pointsForts: [
      croissCa.valN > 0 ? `Croissance de l'activité commerciale (+${croissCa.valN}% sur un an).` : `Maintien d'un niveau d'activité de ${fmt(ca.valN)} FCFA.`,
      rn.valN > 0 ? `Rentabilité nette positive s'établissant à ${fmt(rn.valN)} FCFA (${margeNette.valN}% du CA).` : `Résilience opérationnelle avec un EBE de ${fmt(ebe.valN)} FCFA.`,
      frng.valN > 0 ? `Fonds de roulement net global positif de ${fmt(frng.valN)} FCFA assurant le financement des immobilisations.` : `Capacité de mobilisation de ressources de court terme.`,
      fluxOp.valN > 0 ? `Cash-flow opérationnel positif (+${fmt(fluxOp.valN)} FCFA) témoignant de la capacité d'autofinancement réelle.` : `Gestion active du recouvrement clients.`
    ],
    pointsVigilance: [
      tn.valN < 0 ? `Trésorerie nette négative (${fmt(tn.valN)} FCFA) exposant l'entreprise aux frais financiers et concours bancaires.` : (dso.valN > 90 ? `Délai de règlement clients de ${dso.valN} jours supérieur aux standards usuels.` : `Surveillance de la couverture du BFR par le fonds de roulement.`),
      chPersVa.valN > 70 ? `Poids élevé de la masse salariale absorbant ${chPersVa.valN}% de la Valeur Ajoutée produite.` : (detteNette.valN > 0 ? `Endettement net exigible de ${fmt(detteNette.valN)} FCFA.` : `Poursuite de l'optimisation des charges d'exploitation.`),
      fcf.valN < 0 ? `Free Cash Flow négatif (${fmt(fcf.valN)} FCFA) nécessitant des concours financiers d'équilibre.` : `Nécessité de maintenir un rythme d'investissement créateur de valeur.`
    ],
    prioritesN1: [
      'Renforcer la trésorerie disponible en accélérant le recouvrement des créances clients et la rotation des stocks.',
      'Optimiser la structure des consommations intermédiaires pour consolider la marge de Valeur Ajoutée.',
      'Maintenir une discipline stricte sur l\'endettement financier et préserver le niveau des capitaux propres.'
    ]
  };

  // 2. COMMENTAIRES DÉTAILLÉS PAR SECTION DU RAPPORT
  const sections = {
    activite: {
      titre: 'Analyse de l\'Activité et du Mix Commercial',
      commentaire: `L'exercice ${metadata.anneeN} enregistre un chiffre d'affaires de ${fmt(ca.valN)} FCFA contre ${fmt(ca.n1 || snap.cr.chiffreAffaires.n1)} FCFA en ${metadata.anneeN1}. La dynamique commerciale est principalement portée par les ventes de marchandises (${fmt(snap.cr.ventesMarchandises.n)} FCFA) et les prestations (${fmt(snap.cr.travauxServicesVendus.n)} FCFA). L'intensité de la croissance annuelle ressort à ${croissCa.valN ?? 0}%, ce qui démontre le positionnement de ${metadata.denomination} sur son marché de référence.`
    },
    sig: {
      titre: 'Soldes Intermédiaires de Gestion (SIG SYSCOHADA)',
      commentaire: `La marge commerciale brute s'établit à ${fmt(snap.cr.margeCommerciale.n)} FCFA. La production globale et les activités de négoce permettent de générer une Valeur Ajoutée de ${fmt(va.valN)} FCFA (taux de VA de ${metricsMap.get('IND_14')?.valN}% du CA). Après déduction des charges de personnel (${fmt(snap.cr.chargesPersonnel.n)} FCFA), l'Excédent Brut d'Exploitation (EBE) ressort à ${fmt(ebe.valN)} FCFA, soit une marge d'EBE de ${metricsMap.get('IND_16')?.valN}%. Le résultat d'exploitation atteint ${fmt(re.valN)} FCFA.`
    },
    rentabilite: {
      titre: 'Rentabilité et Décomposition DuPont',
      commentaire: `Le résultat net s'élève à ${fmt(rn.valN)} FCFA, soit une rentabilité commerciale nette de ${margeNette.valN}%. La rentabilité financière des capitaux propres (ROE) ressort à ${roe.valN ?? 'N/A'}% et le rendement des actifs économiques (ROA) à ${roa.valN ?? 'N/A'}%. La décomposition tripartite de DuPont met en lumière l'articulation entre l'efficacité opérationnelle (marge), l'intensité d'utilisation des actifs et l'effet d'amplification du levier financier.`
    },
    structure: {
      titre: 'Structure Financière et Équilibre Bilantiel',
      commentaire: `Le total du bilan s'élève à ${fmt(bilan.totalGeneralActif.n)} FCFA. Les capitaux propres de ${fmt(bilan.totalCapitauxPropres.n)} FCFA confèrent un ratio d'autonomie financière de ${metricsMap.get('IND_36')?.valN}%. Le Fonds de Roulement Net Global (FRNG) de ${fmt(frng.valN)} FCFA ${frng.valN >= bfre.valN ? 'couvre intégralement' : 'ne couvre que partiellement'} le Besoin en Fonds de Roulement d'Exploitation (${fmt(bfre.valN)} FCFA). La Trésorerie Nette s'établit à ${fmt(tn.valN)} FCFA.`
    },
    liquidite: {
      titre: 'Liquidité, Solvabilité et Profil d\'Endettement',
      commentaire: `Le ratio de liquidité générale s'établit à ${liqGen.valN ?? 'N/A'}x, traduisant le niveau de couverture des exigibilités immédiates par les valeurs réalisables et disponibles. L'endettement financier net ressort à ${fmt(detteNette.valN)} FCFA. La capacité théorique de désendettement est estimée à ${metricsMap.get('IND_100')?.valN ?? 'N/A'} années de cash-flow.`
    },
    flux: {
      titre: 'Flux de Trésorerie et Capacité d\'Autofinancement (TFT)',
      commentaire: `La Capacité d'Autofinancement Globale (CAFG) s'élève à ${fmt(snap.tft.cafg.n)} FCFA. Les activités opérationnelles ont généré un flux net de cash de ${fmt(fluxOp.valN)} FCFA. Après financement des investissements nets (${fmt(snap.tft.totalDecaissementsInvestissements.n)} FCFA), le Free Cash Flow s'établit à ${fmt(fcf.valN)} FCFA. Les flux de financement marquent un solde de ${fmt(snap.tft.fluxTresorerieFinancement.n)} FCFA.`
    },
    cycle: {
      titre: 'Cycle d\'Exploitation et Rotation du BFR',
      commentaire: `Le délai moyen de règlement des créances clients (DSO) est de ${dso.valN ?? 'N/A'} jours, tandis que les dettes fournisseurs sont réglées en moyenne à ${dpo.valN ?? 'N/A'} jours. Le cycle de conversion de trésorerie (CCC) global s'établit à ${ccc.valN ?? 'N/A'} jours, illustrant l'impact net du décalage de paiement sur la trésorerie quotidienne.`
    }
  };

  // 3. PLAN D'ACTION ET RECOMMANDATIONS OPÉRATIONNELLES (COURT, MOYEN, LONG TERME)
  const recommandations = [
    {
      horizon: 'Court terme (0 à 3 mois)',
      priorite: 'Haute',
      action: 'Optimisation du recouvrement clients et réduction du DSO',
      justification: `Le délai clients actuel (${dso.valN ?? 0} jours) immobilise des liquidités qui résoudraient la tension de trésorerie.`,
      impactAttendu: 'Encaissement accéléré et amélioration directe de la trésorerie nette.',
      responsable: 'Direction Financière & Commerciale',
      indicateurSuivi: 'DSO (IND_72) cible < 60 jours'
    },
    {
      horizon: 'Court terme (0 à 3 mois)',
      priorite: 'Moyenne',
      action: 'Gestion rigoureuse des niveaux de stocks et approvisionnements',
      justification: `Les stocks représentent ${fmt(bilan.stocks.n)} FCFA avec un délai d'écoulement de ${metricsMap.get('IND_71')?.valN ?? 0} jours.`,
      impactAttendu: 'Diminution du risque de dépréciation et allègement du BFRE.',
      responsable: 'Responsable Logistique / Achats',
      indicateurSuivi: 'Délai stocks (IND_71) < 45 jours'
    },
    {
      horizon: 'Moyen terme (3 à 12 mois)',
      priorite: 'Haute',
      action: 'Renforcement du Fonds de Roulement et restructuration de dettes court terme',
      justification: `Harmoniser la maturité des dettes avec la durée de vie des actifs financés (FRNG actuel : ${fmt(frng.valN)} FCFA).`,
      impactAttendu: 'Rétablissement d\'une marge de sécurité financière permanente et réduction des agios bancaires.',
      responsable: 'Direction Générale & DAF',
      indicateurSuivi: 'FRNG (IND_41) et Couverture BFR (IND_46) > 100%'
    },
    {
      horizon: 'Long terme (12 à 36 mois)',
      priorite: 'Stratégique',
      action: 'Politique d\'investissement créatrice de valeur et consolidation des fonds propres',
      justification: `Accroître l'autonomie financière et la productivité du capital investi (ROE cible > 15%).`,
      impactAttendu: 'Accroissement de la valeur d\'entreprise et solvabilité bancaire renforcée.',
      responsable: 'Conseil d\'Administration / Dirigeants',
      indicateurSuivi: 'Autonomie financière (IND_36) > 35% et ROCE (IND_26) > 12%'
    }
  ];

  return {
    syntheseExecutive,
    sections,
    recommandations
  };
}

/**
 * Assistant interactif conversationnel « FINSMART Analyste IA »
 * Répond avec rigueur sur les états financiers réels du dossier sélectionné.
 */
export function askFinancialAnalyst(question, snap, metricsResult, controlsResult) {
  const q = String(question || '').toLowerCase();
  const { cr, bilan, equilibre } = snap;
  const { metricsMap } = metricsResult;

  if (q.includes('chiffre') || q.includes('ca') || q.includes('vente') || q.includes('croissance')) {
    const ca = metricsMap.get('IND_01');
    const crCa = metricsMap.get('IND_02');
    return `Le chiffre d'affaires s'élève à ${fmt(ca.valN)} FCFA contre ${fmt(ca.valN1)} FCFA en N-1, soit une variation de ${crCa.valN !== null ? (crCa.valN > 0 ? '+' : '') + crCa.valN + '%' : 'non calculable'}. Les ventes de marchandises représentent ${fmt(cr.ventesMarchandises.n)} FCFA et la production/services vendus ${fmt(cr.ventesProduitsFabriques.n + cr.travauxServicesVendus.n)} FCFA.`;
  }

  if (q.includes('rentab') || q.includes('bénéfice') || q.includes('perte') || q.includes('résultat') || q.includes('marge')) {
    const rn = metricsMap.get('IND_21');
    const mn = metricsMap.get('IND_22');
    const ebe = metricsMap.get('IND_15');
    const roe = metricsMap.get('IND_24');
    return `Le résultat net est de ${fmt(rn.valN)} FCFA (Marge nette de ${mn.valN}% du CA). L'EBE opérationnel atteint ${fmt(ebe.valN)} FCFA. Le rendement des capitaux propres (ROE) ressort à ${roe.valN ?? 'N/A'}%.`;
  }

  if (q.includes('trésor') || q.includes('cash') || q.includes('banque') || q.includes('argent')) {
    const tn = metricsMap.get('IND_45');
    const fcf = metricsMap.get('IND_68');
    const fluxOp = metricsMap.get('IND_63');
    return `La Trésorerie Nette au 31 décembre est de ${fmt(tn.valN)} FCFA (Trésorerie Actif de ${fmt(bilan.totalTresorerieActif.n)} FCFA vs Trésorerie Passif/découverts de ${fmt(bilan.totalTresoreriePassif.n)} FCFA). Le cash opérationnel généré sur l'année est de ${fmt(fluxOp.valN)} FCFA et le Free Cash Flow de ${fmt(fcf.valN)} FCFA.`;
  }

  if (q.includes('bfr') || q.includes('frng') || q.includes('fond de roulement') || q.includes('besoin')) {
    const frng = metricsMap.get('IND_41');
    const bfre = metricsMap.get('IND_42');
    const bfrg = metricsMap.get('IND_44');
    return `Le Fonds de Roulement Net Global (FRNG) est de ${fmt(frng.valN)} FCFA face à un Besoin en Fonds de Roulement d'Exploitation (BFRE) de ${fmt(bfre.valN)} FCFA et un BFR Global de ${fmt(bfrg.valN)} FCFA. La couverture du BFR par les ressources stables est de ${metricsMap.get('IND_46')?.valN ?? 'N/A'}%.`;
  }

  if (q.includes('dette') || q.includes('emprunt') || q.includes('solvab') || q.includes('endettement')) {
    const detteNette = metricsMap.get('IND_54');
    const gearing = metricsMap.get('IND_55');
    const autonomie = metricsMap.get('IND_36');
    return `L'endettement financier net ressort à ${fmt(detteNette.valN)} FCFA. Le ratio d'autonomie financière est de ${autonomie.valN}% et le Gearing net (dette nette / capitaux propres) est de ${gearing.valN ?? 'N/A'}%.`;
  }

  if (q.includes('client') || q.includes('dso') || q.includes('fournisseur') || q.includes('dpo') || q.includes('cycle')) {
    const dso = metricsMap.get('IND_72');
    const dpo = metricsMap.get('IND_73');
    const ccc = metricsMap.get('IND_74');
    return `Le délai moyen de règlement clients (DSO) est de ${dso.valN ?? 'N/A'} jours et le délai de paiement fournisseurs (DPO) de ${dpo.valN ?? 'N/A'} jours. Le cycle de conversion de trésorerie net (CCC) est de ${ccc.valN ?? 'N/A'} jours.`;
  }

  if (q.includes('score') || q.includes('santé') || q.includes('risque') || q.includes('diagnostic')) {
    const sc = controlsResult.healthScore;
    return `Le score global de santé financière de ${snap.metadata.denomination} est de ${sc.total} / 100 (« ${sc.mention} »). Répartition des piliers : Activité ${sc.piliers.activite.score}/20, Rentabilité ${sc.piliers.rentabilite.score}/25, Équilibre ${sc.piliers.equilibre.score}/20, Solvabilité ${sc.piliers.solvabilite.score}/20, Cash ${sc.piliers.tresorerie.score}/15.`;
  }

  // Réponse synthétique globale par défaut
  return `Pour l'exercice ${snap.metadata.anneeN}, ${snap.metadata.denomination} enregistre un CA de ${fmt(cr.chiffreAffaires.n)} FCFA, un EBE de ${fmt(cr.excedentBrutExploitation.n)} FCFA et un résultat net de ${fmt(cr.resultatNet.n)} FCFA. La Trésorerie Nette est de ${fmt(equilibre.tresorerieNette.n)} FCFA et le score de santé financière atteint ${controlsResult.healthScore.total} / 100. Posez-moi une question sur le CA, la rentabilité, le BFR, la dette ou la trésorerie pour obtenir une analyse détaillée.`;
}
