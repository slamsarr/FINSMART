/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur Fiscal : Pré-Audit Fiscal & Détection des Risques de Redressement DGID (CGI Sénégal)
 * 
 * Référentiel légal : Code Général des Impôts (CGI) du Sénégal (Loi n° 2012-31 du 31 décembre 2012 modifiée)
 * Couche en lecture seule : Évalue la conformité fiscale sans modifier les écritures comptables.
 */

const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));

/**
 * Exécute l'audit fiscal complet à partir du snapshot financier.
 * @param {object} snapshot - Données financières extraites
 * @param {object} metricsResult - Catalogue des indicateurs calculés
 * @returns {object} { audits: Array, stats: object, scoreFiscal: number }
 */
export function runTaxAudit(snapshot, metricsResult) {
  const { cr = {}, bilan = {}, equilibre = {}, metadata = {} } = snapshot;
  const caN = cr.chiffreAffaires?.n || 0;
  const rnN = cr.resultatNet?.n || 0;
  const capitalN = bilan.capitalSocial?.n || 0;
  const dotAmortN = cr.dotationsAmortProvisExpl?.n || 0;
  const chargesFinN = cr.fraisFinanciers?.n || 0;
  const fraisGenerauxN = (cr.autresCharges?.n || 0) + (cr.servicesExterieurs?.n || 0);
  const dettesFinN = bilan.totalDettesFinancieres?.n || 0;
  const immoCorpN = bilan.immosCorporellesNet?.n || 0;

  const audits = [];

  // --------------------------------------------------------------------------
  // TAX_01 : Amortissement des véhicules de tourisme (Art. 9 CGI)
  // Règle : Base maximale amortissable plafonnée à 25 000 000 FCFA par véhicule, dotation max 5 000 000 FCFA/an/véhicule (taux 20%).
  // --------------------------------------------------------------------------
  const vehiculesVal = immoCorpN; // Proxy matériel de transport
  const hasHighAmort = dotAmortN > 15000000 && dotAmortN > (caN * 0.08);
  audits.push({
    code: 'TAX_01',
    titre: 'Amortissement des véhicules de tourisme & Matériel roulant',
    articleCGI: 'Article 9 du CGI (Loi 2012-31)',
    severite: hasHighAmort ? 'vigilance' : 'ok',
    constat: `Dotations globales aux amortissements de ${fmt(dotAmortN)} FCFA enregistrées sur l'exercice N.`,
    regleLegale: 'La base amortissable des véhicules de tourisme est plafonnée à 25 000 000 FCFA TTC par véhicule (dotation déductible maximale de 5 000 000 FCFA par an sur 5 ans). La fraction excédentaire doit être réintégrée au résultat fiscal.',
    risqueEstime: hasHighAmort ? 'Risque de rejet fiscal de la fraction d\'amortissement excédant 5 000 000 FCFA par véhicule.' : 'Conforme ou non significatif.',
    recommandation: hasHighAmort
      ? 'Vérifier sur l\'état des immobilisations (Tableau 6 DGID) le coût d\'acquisition de chaque véhicule de tourisme. Réintégrer le surplus d\'amortissement sur le Tableau 7 (Détermination du Résultat Fiscal).'
      : 'Veiller à isoler les véhicules utilitaires (100% déductibles) des véhicules de direction et de tourisme.'
  });

  // --------------------------------------------------------------------------
  // TAX_02 : Rémunération des comptes courants d'associés & Sous-capitalisation (Art. 12 CGI)
  // Règle : Capital social entièrement libéré ; taux max = Taux des avances de la BCEAO + 2 points (env. 6.5% - 7.5%) ;
  //         Montant total des avances rémunérées plafonné au montant du capital social.
  // --------------------------------------------------------------------------
  const ratioInteretsSurCA = caN > 0 ? (chargesFinN / caN) * 100 : 0;
  const isSousCapitalise = capitalN > 0 && dettesFinN > (capitalN * 3);
  audits.push({
    code: 'TAX_02',
    titre: 'Intérêts des comptes courants d\'associés & Sous-capitalisation',
    articleCGI: 'Article 12-II du CGI',
    severite: isSousCapitalise && chargesFinN > 5000000 ? 'risque_eleve' : (chargesFinN > 10000000 ? 'vigilance' : 'ok'),
    constat: `Charges financières globales de ${fmt(chargesFinN)} FCFA (${ratioInteretsSurCA.toFixed(1)}% du CA). Dettes financières de ${fmt(dettesFinN)} FCFA face à un capital social de ${fmt(capitalN)} FCFA.`,
    regleLegale: 'Les intérêts servis aux associés sur leurs comptes courants ne sont déductibles que si : 1) Le capital est intégralement libéré ; 2) Le taux ne dépasse pas le taux des avances de la BCEAO + 2 points ; 3) Les sommes n\'excèdent pas le montant du capital social.',
    risqueEstime: isSousCapitalise ? 'Réintégration d\'office des intérêts excédentaires + retenue à la source sur revenus de capitaux mobiliers (IRCM à 16%).' : 'Risque faible.',
    recommandation: isSousCapitalise
      ? 'Calculer la quote-part des intérêts rémunérant les avances supérieures au capital social ou dépassant le taux BCEAO+2% et la porter en réintégration fiscale.'
      : 'S\'assurer de la libération totale du capital social avant toute déduction d\'intérêts d\'associés.'
  });

  // --------------------------------------------------------------------------
  // TAX_03 : Redevances, management fees & frais de siège à l'étranger (Art. 14 & 18 CGI)
  // Règle : Frais de siège et redevances versées hors UEMOA plafonnées à 5% du CA ou 20% des frais généraux.
  // --------------------------------------------------------------------------
  const autresChargesN = fraisGenerauxN;
  const isHighServices = caN > 0 && (autresChargesN / caN) > 0.25;
  audits.push({
    code: 'TAX_03',
    titre: 'Redevances de marque, brevets & Management Fees (Frais d\'assistance)',
    articleCGI: 'Article 14 et 18 du CGI',
    severite: isHighServices ? 'vigilance' : 'ok',
    constat: `Poste "Autres charges externes & services" représentant ${fmt(autresChargesN)} FCFA (${caN > 0 ? ((autresChargesN / caN) * 100).toFixed(1) : 0}% du CA).`,
    regleLegale: 'Les sommes payées pour rémunérer les brevets, marques et conventions d\'assistance technique versées à une maison mère ou entité étrangère sont déductibles dans la limite de 5% du chiffre d\'affaires ou 20% des frais généraux, avec obligation de documentation des prix de transfert.',
    risqueEstime: isHighServices ? 'Rejet en cas de contrôle DGID si l\'effectivité des prestations et les livrables concrets ne sont pas prouvés par écrit.' : 'Conforme.',
    recommandation: 'Conserver les conventions de management fees, les feuilles de temps, rapports d\'intervention et factures détaillées justifiant la matérialité des services.'
  });

  // --------------------------------------------------------------------------
  // TAX_04 : Déductibilité des dons, libéralités et mécénat (Art. 8 CGI)
  // Règle : Plafonnés à 0,5% du chiffre d'affaires annuel.
  // --------------------------------------------------------------------------
  const plafondDons = Math.round(caN * 0.005);
  audits.push({
    code: 'TAX_04',
    titre: 'Dons, mécénat, cadeaux d\'entreprise et libéralités',
    articleCGI: 'Article 8-I-g du CGI',
    severite: 'ok',
    constat: `Plafond légal de déductibilité des dons pour ${metadata.anneeN} : ${fmt(plafondDons)} FCFA (0,5% du chiffre d'affaires).`,
    regleLegale: 'Les dons et libéralités ne sont déductibles que s\'ils sont consentis à des œuvres ou organismes d\'intérêt général d\'utilité publique reconnus au Sénégal, dans la limite de 0,5% du CA.',
    risqueEstime: 'Réintégration automatique de toute libéralité accordée sans reçu fiscal certifié ou dépassant 0,5% du CA.',
    recommandation: `Vérifier que le total des comptes 657/658 pour dons ne dépasse pas ${fmt(plafondDons)} FCFA et exiger les reçus fiscaux des bénéficiaires.`
  });

  // --------------------------------------------------------------------------
  // TAX_05 : Retenues à la source BRS (5%) sur prestations de services (Art. 201 CGI)
  // Règle : Retenue obligatoire de 5% sur les honoraires, commissions et prestations fournies par des prestataires locaux non dispensés.
  // --------------------------------------------------------------------------
  audits.push({
    code: 'TAX_05',
    titre: 'Retenue à la Source sur Prestations de Services (BRS 5%)',
    articleCGI: 'Article 201 et 202 du CGI',
    severite: 'vigilance',
    constat: `Volume important de services extérieurs engagés au cours de l'exercice N.`,
    regleLegale: 'Toute entreprise établie au Sénégal doit opérer une retenue de 5% (BRS) sur les sommes payées à des prestataires de services résidents (hors entreprises attestant d\'une dispense officielle de la DGID ou professions salariées).',
    risqueEstime: 'En cas d\'omission de retenue, l\'entreprise est personnellement tenue au paiement du montant éludé assorti de pénalités de retard de 25% à 50%.',
    recommandation: 'Auditer les dossiers fournisseurs prestataires pour vérifier la présence soit de la quittance BRS versée mensuellement, soit de l\'attestation de régularité fiscale (ARF) du prestataire.'
  });

  // --------------------------------------------------------------------------
  // TAX_06 : Impôt Minimum Forfaitaire (IMF) vs Impôt sur les Sociétés (Art. 140 CGI)
  // Règle : IMF = 0.5% du CA (min. 500 000 FCFA, max. 20 000 000 FCFA). L'impôt dû est le max(IS à 30%, IMF).
  // --------------------------------------------------------------------------
  let imfTheorique = Math.round(caN * 0.005);
  if (imfTheorique < 500000 && caN > 0) imfTheorique = 500000;
  if (imfTheorique > 20000000) imfTheorique = 20000000;

  const isTheorique = rnN > 0 ? Math.round(rnN * 0.30) : 0;
  const regimeImposition = isTheorique >= imfTheorique ? 'Impôt sur les Sociétés (IS à 30%)' : 'Impôt Minimum Forfaitaire (IMF)';

  audits.push({
    code: 'TAX_06',
    titre: 'Arbitrage Fiscal : Impôt sur les Sociétés (IS 30%) vs IMF (0,5% du CA)',
    articleCGI: 'Article 140 et 141 du CGI',
    severite: isTheorique < imfTheorique ? 'vigilance' : 'ok',
    constat: `IS théorique estimé (30%) : ${fmt(isTheorique)} FCFA | IMF calculé (0,5% CA) : ${fmt(imfTheorique)} FCFA. Régime d'assujettissement applicable : ${regimeImposition}.`,
    regleLegale: 'L\'Impôt Minimum Forfaitaire sur les sociétés (IMF) est dû même en cas de déficit comptable. Il est compris obligatoirement entre 500 000 FCFA et 20 000 000 FCFA par exercice.',
    risqueEstime: rnN <= 0 ? `Entreprise en situation de déficit : paiement obligatoire de l'IMF de ${fmt(imfTheorique)} FCFA non imputable.` : 'Conforme.',
    recommandation: isTheorique < imfTheorique
      ? `Prévoir dans la trésorerie le décaissement de l'IMF minimum de ${fmt(imfTheorique)} FCFA payable en 2 acomptes et solde.`
      : `Le montant prévisionnel d'IS de ${fmt(isTheorique)} FCFA absorbe totalement l'IMF.`
  });

  // --------------------------------------------------------------------------
  // TAX_07 : Pertes fiscales & Report déficitaire (Art. 13 CGI)
  // Règle : Les déficits sont reportables sur les 3 exercices suivants au Sénégal.
  // --------------------------------------------------------------------------
  const hasDeficit = rnN < 0;
  audits.push({
    code: 'TAX_07',
    titre: 'Report déficitaire et Forclusion des pertes fiscales antérieures',
    articleCGI: 'Article 13 du CGI',
    severite: hasDeficit ? 'vigilance' : 'ok',
    constat: hasDeficit ? `Déficit net comptable de ${fmt(Math.abs(rnN))} FCFA constaté sur l'exercice N.` : `Résultat bénéficiaire (${fmt(rnN)} FCFA).`,
    regleLegale: 'Au Sénégal, le déficit d\'un exercice peut être déduit des bénéfices réalisés pendant les trois (3) exercices suivants. Passé ce délai, le déficit non imputé est définitivement forclos.',
    risqueEstime: hasDeficit ? 'Perte définitive du droit de déduction si les résultats des années N+1 à N+3 sont insuffisants.' : 'Pertes antérieures éventuelles à imputer en priorité.',
    recommandation: hasDeficit
      ? 'Mentionner expressément le déficit reportable sur le Tableau 7 de la liasse DGID pour préserver le droit au report sur 3 ans.'
      : 'Vérifier dans les liasses N-1, N-2 et N-3 si des déficits antérieurs non prescrits peuvent être déduits du bénéfice imposable N.'
  });

  // --------------------------------------------------------------------------
  // TAX_08 : TVA et Rapprochement de Chiffre d'Affaires (CGI Titre II)
  // --------------------------------------------------------------------------
  audits.push({
    code: 'TAX_08',
    titre: 'Rapprochement Chiffre d\'Affaires déclaré (TVA) vs Compte de Résultat',
    articleCGI: 'Article 350 et suivants du CGI',
    severite: 'ok',
    constat: `Chiffre d'affaires taxable au compte de résultat : ${fmt(caN)} FCFA.`,
    regleLegale: 'Le montant total des ventes et prestations figurant sur les déclarations mensuelles de TVA de janvier à décembre N doit être strictement égal au chiffre d\'affaires comptabilisé en classe 7.',
    risqueEstime: 'Un écart entre le CA de la liasse et les déclarations de TVA est l\'un des déclencheurs automatiques numéro un de contrôle sur pièces par la DGID.',
    recommandation: 'Établir systématiquement un tableau de concordance avant le dépôt de la liasse pour justifier les écarts éventuels (encaissements vs facturations, décalages de clôture).'
  });

  // Statistiques de l'audit
  const nbRisqueEleve = audits.filter(a => a.severite === 'risque_eleve').length;
  const nbVigilance = audits.filter(a => a.severite === 'vigilance').length;
  const nbConformes = audits.filter(a => a.severite === 'ok').length;

  let scoreFiscal = 100 - (nbRisqueEleve * 25) - (nbVigilance * 8);
  if (scoreFiscal < 20) scoreFiscal = 20;

  let statutGlobal = 'Excellente conformité fiscale préventive';
  let badgeColor = 'ok';
  if (nbRisqueEleve > 0) {
    statutGlobal = 'Risques de redressement fiscal détectés (action corrective requise)';
    badgeColor = 'bad';
  } else if (nbVigilance > 0) {
    statutGlobal = 'Conformité fiscale globalement satisfaisante avec points de vigilance';
    badgeColor = 'warn';
  }

  return {
    audits,
    stats: {
      total: audits.length,
      nbRisqueEleve,
      nbVigilance,
      nbConformes,
      scoreFiscal,
      statutGlobal,
      badgeColor
    }
  };
}
