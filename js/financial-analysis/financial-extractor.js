/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur 1 : Extraction et normalisation des rubriques DGID officielles
 * 
 * Référentiel : SYSCOHADA Révisé – Modèle DGID Sen-etafi (classeur modele_DGID.xlsx)
 * Couche en lecture seule : Ne modifie jamais les états financiers sources ni le modèle.
 */

// Helper pour extraire un nombre sûr depuis une cellule ou valeur
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (typeof v === 'object' && 'err' in v) return 0;
  const s = String(v).trim().replace(/[\s  ]/g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Normalise l'extraction depuis un objet values { [sheet]: { [cell]: val } } ou un Workbook.
 * @param {object} p - { values, wb, infos, exercise, company }
 * @returns {object} snapshot structuré et horodaté
 */
export function extractFinancialSnapshot({ values, wb, infos = {}, exercise = {}, company = {} }) {
  // Accesseur universel de cellule
  const get = (sheet, cell) => {
    if (values && values[sheet] && values[sheet][cell] !== undefined) {
      return toNum(values[sheet][cell]);
    }
    if (wb && typeof wb.getAddr === 'function') {
      try { return toNum(wb.getAddr(sheet, cell)); } catch (_) { return 0; }
    }
    if (wb && wb.Sheets && wb.Sheets[sheet] && wb.Sheets[sheet][cell]) {
      return toNum(wb.Sheets[sheet][cell].v);
    }
    return 0;
  };

  const getStr = (sheet, cell, fallback = '') => {
    if (values && values[sheet] && values[sheet][cell] !== undefined) {
      const v = values[sheet][cell];
      return v && typeof v === 'object' && 'err' in v ? fallback : String(v ?? fallback).trim();
    }
    if (wb && typeof wb.getAddr === 'function') {
      try { const v = wb.getAddr(sheet, cell); return v ? String(v).trim() : fallback; } catch (_) { return fallback; }
    }
    if (wb && wb.Sheets && wb.Sheets[sheet] && wb.Sheets[sheet][cell]) {
      const v = wb.Sheets[sheet][cell].v ?? wb.Sheets[sheet][cell].w;
      return v ? String(v).trim() : fallback;
    }
    return fallback;
  };

  // 1. Identification légale et temporelle
  const anneeN = exercise.exercice || (infos.fin ? infos.fin.slice(0, 4) : String(new Date().getFullYear()));
  const anneeN1 = infos.finPrec ? infos.finPrec.slice(0, 4) : String(Number(anneeN) - 1);

  const denomination = company.nom || infos.denomination || getStr('Page de garde', 'B5', 'Entreprise');
  const ninea = company.ninea || infos.ninea || getStr('Page de garde', 'B8', '');
  const rccm = company.rc || infos.rccm || getStr('Page de garde', 'B17', '');
  const secteur = infos.activite || company.forme_juridique || getStr('Page de garde', 'B28', 'Activités générales');
  const dureeMois = Number(infos.dureePrec || 12) || 12;

  // 2. COMPTE DE RÉSULTAT (SIG SYSCOHADA)
  const cr = {
    // Ventes et Chiffre d'Affaires
    ventesMarchandises: { n: get('COMPTE DE RESULTAT', 'E8'), n1: get('COMPTE DE RESULTAT', 'F8'), ref: 'TA' },
    achatsMarchandises: { n: get('COMPTE DE RESULTAT', 'E9'), n1: get('COMPTE DE RESULTAT', 'F9'), ref: 'RA' },
    varStocksMarchandises: { n: get('COMPTE DE RESULTAT', 'E10'), n1: get('COMPTE DE RESULTAT', 'F10'), ref: 'RB' },
    margeCommerciale: { n: get('COMPTE DE RESULTAT', 'E11'), n1: get('COMPTE DE RESULTAT', 'F11'), ref: 'XA' },
    
    ventesProduitsFabriques: { n: get('COMPTE DE RESULTAT', 'E12'), n1: get('COMPTE DE RESULTAT', 'F12'), ref: 'TB' },
    travauxServicesVendus: { n: get('COMPTE DE RESULTAT', 'E13'), n1: get('COMPTE DE RESULTAT', 'F13'), ref: 'TC' },
    produitsAccessoires: { n: get('COMPTE DE RESULTAT', 'E14'), n1: get('COMPTE DE RESULTAT', 'F14'), ref: 'TD' },
    chiffreAffaires: { n: get('COMPTE DE RESULTAT', 'E15'), n1: get('COMPTE DE RESULTAT', 'F15'), ref: 'XB' },
    
    productionStockee: { n: get('COMPTE DE RESULTAT', 'E16'), n1: get('COMPTE DE RESULTAT', 'F16'), ref: 'TE' },
    productionImmobilisee: { n: get('COMPTE DE RESULTAT', 'E17'), n1: get('COMPTE DE RESULTAT', 'F17'), ref: 'TF' },
    subventionsExploitation: { n: get('COMPTE DE RESULTAT', 'E18'), n1: get('COMPTE DE RESULTAT', 'F18'), ref: 'TG' },
    autresProduits: { n: get('COMPTE DE RESULTAT', 'E19'), n1: get('COMPTE DE RESULTAT', 'F19'), ref: 'TH' },
    transfertsChargesExploitation: { n: get('COMPTE DE RESULTAT', 'E20'), n1: get('COMPTE DE RESULTAT', 'F20'), ref: 'TI' },

    achatsMatieresPremieres: { n: get('COMPTE DE RESULTAT', 'E21'), n1: get('COMPTE DE RESULTAT', 'F21'), ref: 'RC' },
    varStocksMatieres: { n: get('COMPTE DE RESULTAT', 'E22'), n1: get('COMPTE DE RESULTAT', 'F22'), ref: 'RD' },
    autresAchats: { n: get('COMPTE DE RESULTAT', 'E23'), n1: get('COMPTE DE RESULTAT', 'F23'), ref: 'RE' },
    varStocksAutresAchats: { n: get('COMPTE DE RESULTAT', 'E24'), n1: get('COMPTE DE RESULTAT', 'F24'), ref: 'RF' },
    transports: { n: get('COMPTE DE RESULTAT', 'E25'), n1: get('COMPTE DE RESULTAT', 'F25'), ref: 'RG' },
    servicesExterieurs: { n: get('COMPTE DE RESULTAT', 'E26'), n1: get('COMPTE DE RESULTAT', 'F26'), ref: 'RH' },
    impotsTaxes: { n: get('COMPTE DE RESULTAT', 'E27'), n1: get('COMPTE DE RESULTAT', 'F27'), ref: 'RI' },
    autresCharges: { n: get('COMPTE DE RESULTAT', 'E28'), n1: get('COMPTE DE RESULTAT', 'F28'), ref: 'RJ' },
    
    valeurAjoutee: { n: get('COMPTE DE RESULTAT', 'E29'), n1: get('COMPTE DE RESULTAT', 'F29'), ref: 'XC' },
    chargesPersonnel: { n: get('COMPTE DE RESULTAT', 'E30'), n1: get('COMPTE DE RESULTAT', 'F30'), ref: 'RK' },
    excedentBrutExploitation: { n: get('COMPTE DE RESULTAT', 'E31'), n1: get('COMPTE DE RESULTAT', 'F31'), ref: 'XD' },

    reprisesAmortProvisExpl: { n: get('COMPTE DE RESULTAT', 'E32'), n1: get('COMPTE DE RESULTAT', 'F32'), ref: 'TJ' },
    dotationsAmortProvisExpl: { n: get('COMPTE DE RESULTAT', 'E33'), n1: get('COMPTE DE RESULTAT', 'F33'), ref: 'RL' },
    resultatExploitation: { n: get('COMPTE DE RESULTAT', 'E34'), n1: get('COMPTE DE RESULTAT', 'F34'), ref: 'XE' },

    revenusFinanciers: { n: get('COMPTE DE RESULTAT', 'E35'), n1: get('COMPTE DE RESULTAT', 'F35'), ref: 'TK' },
    fraisFinanciers: { n: get('COMPTE DE RESULTAT', 'E38'), n1: get('COMPTE DE RESULTAT', 'F38'), ref: 'RM' },
    resultatFinancier: { n: get('COMPTE DE RESULTAT', 'E40'), n1: get('COMPTE DE RESULTAT', 'F40'), ref: 'XF' },
    resultatActivitesOrdinaires: { n: get('COMPTE DE RESULTAT', 'E41'), n1: get('COMPTE DE RESULTAT', 'F41'), ref: 'XG' },

    produitsHAO: { n: get('COMPTE DE RESULTAT', 'E42') + get('COMPTE DE RESULTAT', 'E43'), n1: get('COMPTE DE RESULTAT', 'F42') + get('COMPTE DE RESULTAT', 'F43'), ref: 'TN+TO' },
    chargesHAO: { n: get('COMPTE DE RESULTAT', 'E44') + get('COMPTE DE RESULTAT', 'E45'), n1: get('COMPTE DE RESULTAT', 'F44') + get('COMPTE DE RESULTAT', 'F45'), ref: 'RO+RP' },
    resultatHAO: { n: get('COMPTE DE RESULTAT', 'E46'), n1: get('COMPTE DE RESULTAT', 'F46'), ref: 'XH' },

    participationSalaries: { n: get('COMPTE DE RESULTAT', 'E47'), n1: get('COMPTE DE RESULTAT', 'F47'), ref: 'RQ' },
    impotsResultat: { n: get('COMPTE DE RESULTAT', 'E48'), n1: get('COMPTE DE RESULTAT', 'F48'), ref: 'RS' },
    resultatNet: { n: get('COMPTE DE RESULTAT', 'E49'), n1: get('COMPTE DE RESULTAT', 'F49'), ref: 'XI' },
  };

  // 3. BILAN PAYSAGE (ACTIF & PASSIF)
  const bilan = {
    // Actif Immobilisé
    immosIncorporellesBrut: { n: get('BILAN PAYSAGE', 'D9'), n1: 0 },
    immosIncorporellesNet: { n: get('BILAN PAYSAGE', 'F9'), n1: get('BILAN PAYSAGE', 'G9'), ref: 'AD' },
    immosCorporellesBrut: { n: get('BILAN PAYSAGE', 'D14'), n1: 0 },
    immosCorporellesNet: { n: get('BILAN PAYSAGE', 'F14'), n1: get('BILAN PAYSAGE', 'G14'), ref: 'AI' },
    immosFinancieresBrut: { n: get('BILAN PAYSAGE', 'D21'), n1: 0 },
    immosFinancieresNet: { n: get('BILAN PAYSAGE', 'F21'), n1: get('BILAN PAYSAGE', 'G21'), ref: 'AQ' },

    totalActifImmobiliseBrut: { n: get('BILAN PAYSAGE', 'D24'), n1: 0, ref: 'AZ_Brut' },
    totalAmortissementsDeprec: { n: get('BILAN PAYSAGE', 'E24'), n1: 0, ref: 'AZ_Amort' },
    totalActifImmobiliseNet: { n: get('BILAN PAYSAGE', 'F24'), n1: get('BILAN PAYSAGE', 'G24'), ref: 'AZ' },

    // Actif Circulant
    actifCirculantHAO: { n: get('BILAN PAYSAGE', 'F25'), n1: get('BILAN PAYSAGE', 'G25'), ref: 'BA' },
    stocks: { n: get('BILAN PAYSAGE', 'F26'), n1: get('BILAN PAYSAGE', 'G26'), ref: 'BB' },
    creancesClients: { n: get('BILAN PAYSAGE', 'F29'), n1: get('BILAN PAYSAGE', 'G29'), ref: 'BI' },
    fournisseursAvances: { n: get('BILAN PAYSAGE', 'F28'), n1: get('BILAN PAYSAGE', 'G28'), ref: 'BH' },
    autresCreances: { n: get('BILAN PAYSAGE', 'F30'), n1: get('BILAN PAYSAGE', 'G30'), ref: 'BJ' },
    creancesExploitationTotal: { n: get('BILAN PAYSAGE', 'F27'), n1: get('BILAN PAYSAGE', 'G27'), ref: 'BG' },
    totalActifCirculant: { n: get('BILAN PAYSAGE', 'F31'), n1: get('BILAN PAYSAGE', 'G31'), ref: 'BK' },

    // Trésorerie Actif
    titresPlacement: { n: get('BILAN PAYSAGE', 'F32'), n1: get('BILAN PAYSAGE', 'G32'), ref: 'BQ' },
    valeursEncaisser: { n: get('BILAN PAYSAGE', 'F33'), n1: get('BILAN PAYSAGE', 'G33'), ref: 'BR' },
    banquesCaisses: { n: get('BILAN PAYSAGE', 'F34'), n1: get('BILAN PAYSAGE', 'G34'), ref: 'BS' },
    totalTresorerieActif: { n: get('BILAN PAYSAGE', 'F35'), n1: get('BILAN PAYSAGE', 'G35'), ref: 'BT' },
    ecartsConversionActif: { n: get('BILAN PAYSAGE', 'F36'), n1: get('BILAN PAYSAGE', 'G36'), ref: 'BU' },
    totalGeneralActif: { n: get('BILAN PAYSAGE', 'F37'), n1: get('BILAN PAYSAGE', 'G37'), ref: 'BZ' },

    // Capitaux Propres
    capitalSocial: { n: get('BILAN PAYSAGE', 'K9'), n1: get('BILAN PAYSAGE', 'L9'), ref: 'CA' },
    primesCapital: { n: get('BILAN PAYSAGE', 'K11'), n1: get('BILAN PAYSAGE', 'L11'), ref: 'CD' },
    ecartsReevaluation: { n: get('BILAN PAYSAGE', 'K12'), n1: get('BILAN PAYSAGE', 'L12'), ref: 'CE' },
    reserves: { n: get('BILAN PAYSAGE', 'K13') + get('BILAN PAYSAGE', 'K14'), n1: get('BILAN PAYSAGE', 'L13') + get('BILAN PAYSAGE', 'L14'), ref: 'CF+CG' },
    reportNouveau: { n: get('BILAN PAYSAGE', 'K15'), n1: get('BILAN PAYSAGE', 'L15'), ref: 'CH' },
    resultatNetBilan: { n: get('BILAN PAYSAGE', 'K16'), n1: get('BILAN PAYSAGE', 'L16'), ref: 'CJ' },
    subventionsInvestissement: { n: get('BILAN PAYSAGE', 'K17'), n1: get('BILAN PAYSAGE', 'L17'), ref: 'CL' },
    provisionsReglementees: { n: get('BILAN PAYSAGE', 'K18'), n1: get('BILAN PAYSAGE', 'L18'), ref: 'CM' },
    totalCapitauxPropres: { n: get('BILAN PAYSAGE', 'K19'), n1: get('BILAN PAYSAGE', 'L19'), ref: 'CP' },

    // Dettes Financières
    empruntsDettesFinancieres: { n: get('BILAN PAYSAGE', 'K20'), n1: get('BILAN PAYSAGE', 'L20'), ref: 'DA' },
    dettesLocationAcquisition: { n: get('BILAN PAYSAGE', 'K21'), n1: get('BILAN PAYSAGE', 'L21'), ref: 'DB' },
    provisionsRisquesCharges: { n: get('BILAN PAYSAGE', 'K22'), n1: get('BILAN PAYSAGE', 'L22'), ref: 'DC' },
    totalDettesFinancieres: { n: get('BILAN PAYSAGE', 'K23'), n1: get('BILAN PAYSAGE', 'L23'), ref: 'DD' },
    totalRessourcesStables: { n: get('BILAN PAYSAGE', 'K24'), n1: get('BILAN PAYSAGE', 'L24'), ref: 'DF' },

    // Passif Circulant
    dettesCirculantesHAO: { n: get('BILAN PAYSAGE', 'K25'), n1: get('BILAN PAYSAGE', 'L25'), ref: 'DH' },
    clientsAvancesRecues: { n: get('BILAN PAYSAGE', 'K26'), n1: get('BILAN PAYSAGE', 'L26'), ref: 'DI' },
    fournisseursExploitation: { n: get('BILAN PAYSAGE', 'K27'), n1: get('BILAN PAYSAGE', 'L27'), ref: 'DJ' },
    dettesFiscalesSociales: { n: get('BILAN PAYSAGE', 'K28'), n1: get('BILAN PAYSAGE', 'L28'), ref: 'DK' },
    autresDettes: { n: get('BILAN PAYSAGE', 'K29'), n1: get('BILAN PAYSAGE', 'L29'), ref: 'DM' },
    provisionsCourtTerme: { n: get('BILAN PAYSAGE', 'K30'), n1: get('BILAN PAYSAGE', 'L30'), ref: 'DN' },
    totalPassifCirculant: { n: get('BILAN PAYSAGE', 'K31'), n1: get('BILAN PAYSAGE', 'L31'), ref: 'DP' },

    // Trésorerie Passif
    creditsEscompte: { n: get('BILAN PAYSAGE', 'K33'), n1: get('BILAN PAYSAGE', 'L33'), ref: 'DQ' },
    decouvertsCreditsTresorerie: { n: get('BILAN PAYSAGE', 'K34'), n1: get('BILAN PAYSAGE', 'L34'), ref: 'DR' },
    totalTresoreriePassif: { n: get('BILAN PAYSAGE', 'K35'), n1: get('BILAN PAYSAGE', 'L35'), ref: 'DT' },
    ecartsConversionPassif: { n: get('BILAN PAYSAGE', 'K36'), n1: get('BILAN PAYSAGE', 'L36'), ref: 'DV' },
    totalGeneralPassif: { n: get('BILAN PAYSAGE', 'K37'), n1: get('BILAN PAYSAGE', 'L37'), ref: 'DZ' },
  };

  // 4. TABLEAU DES FLUX DE TRÉSORERIE (TFT)
  const tft = {
    tresorerieOuverture: { n: get('FLUX DE TRESORERIE', 'E8'), n1: get('FLUX DE TRESORERIE', 'F8'), ref: 'ZA' },
    cafg: { n: get('FLUX DE TRESORERIE', 'E10'), n1: get('FLUX DE TRESORERIE', 'F10'), ref: 'FA' },
    variationBFR_TFT: { n: get('FLUX DE TRESORERIE', 'E11') + get('FLUX DE TRESORERIE', 'E12') + get('FLUX DE TRESORERIE', 'E13') + get('FLUX DE TRESORERIE', 'E14'), n1: 0, ref: 'Var_BFR' },
    fluxTresorerieOperationnels: { n: get('FLUX DE TRESORERIE', 'E16'), n1: get('FLUX DE TRESORERIE', 'F16'), ref: 'ZB' },

    decaissementsImmosIncorp: { n: get('FLUX DE TRESORERIE', 'E18'), n1: get('FLUX DE TRESORERIE', 'F18'), ref: 'FF' },
    decaissementsImmosCorp: { n: get('FLUX DE TRESORERIE', 'E19'), n1: get('FLUX DE TRESORERIE', 'F19'), ref: 'FG' },
    decaissementsImmosFinanc: { n: get('FLUX DE TRESORERIE', 'E20'), n1: get('FLUX DE TRESORERIE', 'F20'), ref: 'FH' },
    totalDecaissementsInvestissements: { n: get('FLUX DE TRESORERIE', 'E18') + get('FLUX DE TRESORERIE', 'E19') + get('FLUX DE TRESORERIE', 'E20'), n1: 0 },
    encaissementsCessionsImmos: { n: get('FLUX DE TRESORERIE', 'E21') + get('FLUX DE TRESORERIE', 'E22'), n1: 0 },
    fluxTresorerieInvestissement: { n: get('FLUX DE TRESORERIE', 'E23'), n1: get('FLUX DE TRESORERIE', 'F23'), ref: 'ZC' },

    augmentationsCapital: { n: get('FLUX DE TRESORERIE', 'E25'), n1: get('FLUX DE TRESORERIE', 'F25'), ref: 'FK' },
    subventionsInvestissementRecues: { n: get('FLUX DE TRESORERIE', 'E26'), n1: get('FLUX DE TRESORERIE', 'F26'), ref: 'FL' },
    dividendesVerses: { n: get('FLUX DE TRESORERIE', 'E28'), n1: get('FLUX DE TRESORERIE', 'F28'), ref: 'FN' },
    empruntsNouveaux: { n: get('FLUX DE TRESORERIE', 'E31') + get('FLUX DE TRESORERIE', 'E32'), n1: 0, ref: 'FO+FP' },
    remboursementsEmprunts: { n: get('FLUX DE TRESORERIE', 'E33'), n1: get('FLUX DE TRESORERIE', 'F33'), ref: 'FQ' },
    fluxTresorerieFinancement: { n: get('FLUX DE TRESORERIE', 'E35'), n1: get('FLUX DE TRESORERIE', 'F35'), ref: 'ZF' },

    variationNetteTresorerie: { n: get('FLUX DE TRESORERIE', 'E36'), n1: get('FLUX DE TRESORERIE', 'F36'), ref: 'ZG' },
    tresorerieCloture: { n: get('FLUX DE TRESORERIE', 'E37'), n1: get('FLUX DE TRESORERIE', 'F37'), ref: 'ZH' },
  };

  // 5. AGRÉGATS DÉRIVÉS FONDAMENTAUX (AUDCIF)
  // FRNG = Ressources Stables - Actif Immobilisé Net
  const frngN = bilan.totalRessourcesStables.n - bilan.totalActifImmobiliseNet.n;
  const frngN1 = bilan.totalRessourcesStables.n1 - bilan.totalActifImmobiliseNet.n1;

  // BFRE = Actif Circulant Exploitation (Stocks + Créances clients + Avances + Autres créances) - Passif Circulant Exploitation (Fournisseurs + Fiscal/Social + Avances clients + Autres dettes)
  const actCircExplN = bilan.stocks.n + bilan.creancesClients.n + bilan.fournisseursAvances.n + bilan.autresCreances.n;
  const actCircExplN1 = bilan.stocks.n1 + bilan.creancesClients.n1 + bilan.fournisseursAvances.n1 + bilan.autresCreances.n1;

  const pasCircExplN = bilan.fournisseursExploitation.n + bilan.dettesFiscalesSociales.n + bilan.clientsAvancesRecues.n + bilan.autresDettes.n + bilan.provisionsCourtTerme.n;
  const pasCircExplN1 = bilan.fournisseursExploitation.n1 + bilan.dettesFiscalesSociales.n1 + bilan.clientsAvancesRecues.n1 + bilan.autresDettes.n1 + bilan.provisionsCourtTerme.n1;

  const bfreN = actCircExplN - pasCircExplN;
  const bfreN1 = actCircExplN1 - pasCircExplN1;

  // BFR HAO = Actif Circulant HAO - Passif Circulant HAO
  const bfrHaoN = bilan.actifCirculantHAO.n - bilan.dettesCirculantesHAO.n;
  const bfrHaoN1 = bilan.actifCirculantHAO.n1 - bilan.dettesCirculantesHAO.n1;

  // BFR Global = BFRE + BFR HAO
  const bfrgN = bfreN + bfrHaoN;
  const bfrgN1 = bfreN1 + bfrHaoN1;

  // Trésorerie Nette = FRNG - BFRG = Trésorerie Actif - Trésorerie Passif
  const tnN_Bilan = bilan.totalTresorerieActif.n - bilan.totalTresoreriePassif.n;
  const tnN1_Bilan = bilan.totalTresorerieActif.n1 - bilan.totalTresoreriePassif.n1;

  const equilibre = {
    frng: { n: frngN, n1: frngN1 },
    bfre: { n: bfreN, n1: bfreN1 },
    bfrHao: { n: bfrHaoN, n1: bfrHaoN1 },
    bfrGlobal: { n: bfrgN, n1: bfrgN1 },
    tresorerieNette: { n: tnN_Bilan, n1: tnN1_Bilan },
  };

  // 6. Effectifs et données sociales
  const effectifs = infos.effectifs || {};
  let totalSalaries = 0;
  if (effectifs) {
    for (const [k, v] of Object.entries(effectifs)) {
      if (k.startsWith('i') && typeof v === 'number') totalSalaries += v;
    }
  }

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      denomination,
      ninea,
      rccm,
      secteur,
      anneeN,
      anneeN1,
      dureeMois,
    },
    cr,
    bilan,
    tft,
    equilibre,
    social: {
      totalSalaries: totalSalaries > 0 ? totalSalaries : null,
    }
  };
}
