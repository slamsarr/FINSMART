/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur Juridique & Gouvernance : Rapport de Gestion & Résolutions AGO (AUDSCGIE OHADA)
 * 
 * Référentiel légal : Acte Uniforme OHADA relatif au droit des sociétés commerciales et du GIE (AUDSCGIE arts. 138-144, 346, 546)
 * Couche en lecture seule & Export Word (.doc) universel sans dépendance externe.
 */

const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Calcule l'affectation légale du résultat net selon l'OHADA.
 * @param {number} resultatNet 
 * @param {number} capitalSocial 
 * @param {number} reserveLegaleActuelle 
 * @returns {object}
 */
export function computeResultAllocation(resultatNet, capitalSocial, reserveLegaleActuelle = 0) {
  if (resultatNet <= 0) {
    return {
      isBeneficiaire: false,
      resultatNet,
      reserveLegaleDotation: 0,
      reserveLegalePlafond: capitalSocial * 0.20,
      soldeDistribuable: 0,
      reportANouveauNouveau: resultatNet,
      dividendesProposes: 0,
      recommandation: 'Affectation du déficit intégralement en report à nouveau débiteur (compte 129).'
    };
  }

  // AUDSCGIE Art. 346 : Dotation d'un dixième (10%) au moins du bénéfice diminué, le cas échéant, des pertes antérieures,
  // jusqu'à ce que la réserve légale atteigne le cinquième (20%) du capital social.
  const plafondReserve = capitalSocial * 0.20;
  let dotationReserveLegale = 0;
  if (reserveLegaleActuelle < plafondReserve) {
    const dotationTheorique = resultatNet * 0.10;
    dotationReserveLegale = Math.min(dotationTheorique, plafondReserve - reserveLegaleActuelle);
  }

  const soldeDistribuable = resultatNet - dotationReserveLegale;
  // Par défaut, proposition prudente : 50% en réserves libres / report à nouveau, 50% en dividendes
  const dividendesProposes = Math.round(soldeDistribuable * 0.50);
  const reportANouveauNouveau = soldeDistribuable - dividendesProposes;

  return {
    isBeneficiaire: true,
    resultatNet,
    capitalSocial,
    reserveLegaleActuelle,
    reserveLegalePlafond: plafondReserve,
    reserveLegaleDotation: Math.round(dotationReserveLegale),
    soldeDistribuable: Math.round(soldeDistribuable),
    dividendesProposes,
    reportANouveauNouveau,
    recommandation: `Dotation obligatoire de 10% à la réserve légale (${fmt(dotationReserveLegale)} FCFA). Solde disponible pour distribution de dividendes ou mise en réserves : ${fmt(soldeDistribuable)} FCFA.`
  };
}

/**
 * Génère le contenu structuré du rapport de gestion et des résolutions d'AGO.
 */
export function generateManagementReportData(snapshot, metricsResult, controlsResult) {
  const { cr, bilan, metadata } = snapshot;
  const metricsMap = metricsResult.metricsMap;

  const caN = cr.chiffreAffaires.n || 0;
  const caN1 = cr.chiffreAffaires.n1 || 0;
  const varCaPct = caN1 > 0 ? (((caN - caN1) / caN1) * 100).toFixed(1) : '0';

  const vaN = cr.valeurAjoutee.n || 0;
  const ebeN = cr.excedentBrutExploitation.n || 0;
  const rnN = cr.resultatNet?.n || 0;
  const rnN1 = cr.resultatNet?.n1 || 0;
  const capitalN = bilan.capitalSocial?.n || 0;
  const reservesN = bilan.reserves?.n || 0;

  const allocation = computeResultAllocation(rnN, capitalN, reservesN);

  return {
    metadata,
    chiffresCles: {
      caN, caN1, varCaPct,
      vaN, ebeN, rnN, rnN1,
      capitalN,
      totalBilanN: bilan.totalGeneralActif?.n || 0,
      frngN: snapshot.equilibre?.frng?.n || 0,
      tnN: snapshot.equilibre?.tresorerieNette?.n || 0,
    },
    allocation,
    score: controlsResult.healthScore
  };
}

/**
 * Produit le code HTML/Word du Rapport de Gestion complet et des Résolutions d'AGO.
 */
export function buildManagementReportHtml(data) {
  const { metadata, chiffresCles, allocation, score } = data;
  const isBenef = allocation.isBeneficiaire;

  return `
    <div class="management-report-document" style="font-family:'Segoe UI', Arial, sans-serif; line-height:1.6; color:#1f2937; max-width:850px; margin:0 auto; background:#fff; padding:40px; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.06);">
      
      <!-- EN-TÊTE OFFICIEL -->
      <div style="border-bottom:2px solid #123a32; padding-bottom:16px; margin-bottom:26px; display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h1 style="font-size:22px; color:#123a32; margin:0 0 4px 0; text-transform:uppercase;">${esc(metadata.denomination)}</h1>
          <div style="font-size:13px; color:#4b5563;">
            Société commerciale régie par le droit OHADA · NINEA : ${esc(metadata.ninea || '—')}<br>
            RCCM : ${esc(metadata.rccm || '—')} · Siège social : Sénégal
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px; font-weight:700; color:#e9b949; text-transform:uppercase; letter-spacing:0.05em; background:#123a32; padding:4px 10px; border-radius:4px; display:inline-block;">
            DOCUMENT JURIDIQUE OFFICIEL
          </div>
          <div style="font-size:12px; color:#6b7280; margin-top:4px;">AUDSCGIE Articles 138 à 144</div>
        </div>
      </div>

      <!-- TITRE DU RAPPORT -->
      <div style="text-align:center; margin-bottom:30px; background:#f9fafb; padding:18px; border-radius:6px; border:1px solid #e5e7eb;">
        <h2 style="font-size:20px; color:#123a32; margin:0 0 6px 0; text-transform:uppercase; letter-spacing:0.03em;">
          RAPPORT DE GESTION À L'ASSEMBLÉE GÉNÉRALE ORDINAIRE
        </h2>
        <div style="font-size:14px; font-weight:600; color:#4b5563;">
          EXERCICE COMPTABLE CLOS LE 31 DÉCEMBRE ${esc(metadata.anneeN)}
        </div>
      </div>

      <!-- CORPS DU RAPPORT -->
      <div style="font-size:14px; text-align:justify;">
        
        <p><strong>Mesdames, Messieurs les Associés / Actionnaires,</strong></p>
        
        <p>
          Conformément aux dispositions de l'Acte Uniforme de l'OHADA relatif au droit des sociétés commerciales et du GIE (AUDSCGIE), nous avons l'honneur de vous présenter notre rapport sur l'activité de la société <strong>${esc(metadata.denomination)}</strong> au cours de l'exercice social clos le 31 décembre ${esc(metadata.anneeN)}, ainsi que sur les états financiers annuels de synthèse soumis à votre approbation.
        </p>

        <h3 style="color:#123a32; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin-top:24px; font-size:16px;">
          1. Situation et activité générale de la société au cours de l'exercice
        </h3>
        <p>
          Au cours de l'exercice clos le 31 décembre ${esc(metadata.anneeN)}, l'activité s'est caractérisée par un niveau de chiffre d'affaires atteignant <strong>${fmt(chiffresCles.caN)} FCFA</strong>, contre <strong>${fmt(chiffresCles.caN1)} FCFA</strong> lors de l'exercice précédent, soit une variation de <strong>${chiffresCles.varCaPct}%</strong>.
        </p>
        <p>
          La valeur ajoutée générée par l'entreprise ressort à <strong>${fmt(chiffresCles.vaN)} FCFA</strong>, traduisant la contribution économique de notre exploitation. L'Excédent Brut d'Exploitation (EBE) s'établit à <strong>${fmt(chiffresCles.ebeN)} FCFA</strong>.
        </p>

        <h3 style="color:#123a32; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin-top:24px; font-size:16px;">
          2. Présentation des résultats financiers et des états de synthèse
        </h3>
        <p>
          L'exercice social ${esc(metadata.anneeN)} se clôture par un <strong>résultat net ${isBenef ? 'bénéficiaire' : 'déficitaire'}</strong> de <strong>${fmt(chiffresCles.rnN)} FCFA</strong>, contre ${fmt(chiffresCles.rnN1)} FCFA lors de l'exercice antérieur.
        </p>

        <!-- TABLEAU SYNTHÉTIQUE DES RÉSULTATS -->
        <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:13px;">
          <thead>
            <tr style="background:#123a32; color:#fff;">
              <th style="padding:8px 12px; text-align:left;">Rubrique (SYSCOHADA Révisé)</th>
              <th style="padding:8px 12px; text-align:right;">Exercice N (${esc(metadata.anneeN)})</th>
              <th style="padding:8px 12px; text-align:right;">Exercice N-1 (${esc(metadata.anneeN1)})</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px 12px;">Chiffre d'affaires hors taxes</td>
              <td style="padding:8px 12px; text-align:right; font-weight:600;">${fmt(chiffresCles.caN)} FCFA</td>
              <td style="padding:8px 12px; text-align:right;">${fmt(chiffresCles.caN1)} FCFA</td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb; background:#f9fafb;">
              <td style="padding:8px 12px;">Valeur Ajoutée (VA)</td>
              <td style="padding:8px 12px; text-align:right; font-weight:600;">${fmt(chiffresCles.vaN)} FCFA</td>
              <td style="padding:8px 12px; text-align:right;">—</td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px 12px;">Excédent Brut d'Exploitation (EBE)</td>
              <td style="padding:8px 12px; text-align:right; font-weight:600;">${fmt(chiffresCles.ebeN)} FCFA</td>
              <td style="padding:8px 12px; text-align:right;">—</td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb; background:#f9fafb;">
              <td style="padding:8px 12px;">Fonds de Roulement Net Global (FRNG)</td>
              <td style="padding:8px 12px; text-align:right; font-weight:600;">${fmt(chiffresCles.frngN)} FCFA</td>
              <td style="padding:8px 12px; text-align:right;">—</td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px 12px;">Trésorerie Nette à la clôture</td>
              <td style="padding:8px 12px; text-align:right; font-weight:600;">${fmt(chiffresCles.tnN)} FCFA</td>
              <td style="padding:8px 12px; text-align:right;">—</td>
            </tr>
            <tr style="background:#eef2f6; font-weight:700;">
              <td style="padding:9px 12px; color:#123a32;">RÉSULTAT NET DE L'EXERCICE</td>
              <td style="padding:9px 12px; text-align:right; color:#123a32;">${fmt(chiffresCles.rnN)} FCFA</td>
              <td style="padding:9px 12px; text-align:right; color:#123a32;">${fmt(chiffresCles.rnN1)} FCFA</td>
            </tr>
          </tbody>
        </table>

        <h3 style="color:#123a32; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin-top:24px; font-size:16px;">
          3. Proposition d'affectation du résultat (Conforme AUDSCGIE Art. 346)
        </h3>
        ${isBenef ? `
          <p>
            Nous vous proposons d'affecter le bénéfice net de l'exercice s'élevant à <strong>${fmt(allocation.resultatNet)} FCFA</strong> de la manière suivante :
          </p>
          <ul style="margin:10px 0 16px 20px; line-height:1.7;">
            <li><strong>Dotation à la Réserve Légale (10%) :</strong> <strong>${fmt(allocation.reserveLegaleDotation)} FCFA</strong> (conformément à l'article 346 de l'AUDSCGIE, jusqu'à concurrence de 20% du capital social).</li>
            <li><strong>Distribution de dividendes :</strong> <strong>${fmt(allocation.dividendesProposes)} FCFA</strong> revenant aux associés.</li>
            <li><strong>Affectation en Report à Nouveau créditeur :</strong> <strong>${fmt(allocation.reportANouveauNouveau)} FCFA</strong>.</li>
          </ul>
        ` : `
          <p>
            L'exercice s'étant achevé sur une perte de <strong>${fmt(Math.abs(allocation.resultatNet))} FCFA</strong>, nous vous proposons d'affecter l'intégralité de ce montant au compte <strong>« Report à Nouveau débiteur »</strong>.
          </p>
        `}

        <h3 style="color:#123a32; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin-top:24px; font-size:16px;">
          4. Événements importants survenus depuis la clôture & Perspectives N+1
        </h3>
        <p>
          Aucun événement postérieur de nature à altérer significativement la structure financière de la société n'a été constaté depuis le 31 décembre ${esc(metadata.anneeN)}. Les perspectives de l'exercice N+1 sont axées sur le renforcement des parts de marché, l'optimisation des charges d'exploitation et la consolidation de l'autonomie financière.
        </p>

        <h3 style="color:#123a32; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin-top:24px; font-size:16px;">
          5. Conventions réglementées (AUDSCGIE Article 438)
        </h3>
        <p>
          Nous vous informons qu'aucune convention nouvelle visée à l'article 438 de l'Acte Uniforme OHADA n'a été conclue au cours de l'exercice écoulé entre la société et l'un de ses dirigeants ou associés, en dehors des opérations courantes conclues à des conditions normales.
        </p>

      </div>

      <!-- SECTION PROJET DES RÉSOLUTIONS D'AGO -->
      <div style="margin-top:40px; page-break-before:always; border-top:2px solid #123a32; padding-top:24px;">
        <div style="text-align:center; margin-bottom:24px;">
          <h2 style="font-size:18px; color:#123a32; margin:0 0 4px 0; text-transform:uppercase;">
            PROJET DES RÉSOLUTIONS SOUMISES À L'ASSEMBLÉE GÉNÉRALE ORDINAIRE
          </h2>
          <div style="font-size:13px; color:#6b7280;">Statuant sur les comptes de l'exercice clos le 31 décembre ${esc(metadata.anneeN)}</div>
        </div>

        <div style="font-size:13.5px; text-align:justify; line-height:1.6;">
          
          <div style="background:#f9fafb; padding:14px; border-left:4px solid #123a32; margin-bottom:14px; border-radius:0 6px 6px 0;">
            <strong>PREMIÈRE RÉSOLUTION — Approbation des comptes annuels de synthèse</strong>
            <p style="margin:6px 0 0 0; font-size:13px; color:#374151;">
              L'Assemblée Générale Ordinaire, après avoir entendu la lecture du rapport de gestion, approuve les états financiers de synthèse comprenant le Bilan, le Compte de résultat, le Tableau des flux de trésorerie et les Notes annexes de l'exercice clos le 31 décembre ${esc(metadata.anneeN)}, tels qu'ils lui ont été présentés, ainsi que les opérations traduites dans ces comptes et résumées dans ce rapport.
            </p>
          </div>

          <div style="background:#f9fafb; padding:14px; border-left:4px solid #123a32; margin-bottom:14px; border-radius:0 6px 6px 0;">
            <strong>DEUXIÈME RÉSOLUTION — Quitus entier et sans réserve à la Direction</strong>
            <p style="margin:6px 0 0 0; font-size:13px; color:#374151;">
              En conséquence de l'adoption de la première résolution, l'Assemblée Générale donne aux gérants / administrateurs quitus entier, définitif et sans réserve de l'exécution de leur mandat pour l'exercice clos le 31 décembre ${esc(metadata.anneeN)}.
            </p>
          </div>

          <div style="background:#f9fafb; padding:14px; border-left:4px solid #123a32; margin-bottom:14px; border-radius:0 6px 6px 0;">
            <strong>TROISIÈME RÉSOLUTION — Affectation du résultat</strong>
            <p style="margin:6px 0 0 0; font-size:13px; color:#374151;">
              ${isBenef ? `
                L'Assemblée Générale décide d'affecter le bénéfice net de l'exercice s'élevant à ${fmt(allocation.resultatNet)} FCFA comme suit :
                <br>• Dotation à la réserve légale : ${fmt(allocation.reserveLegaleDotation)} FCFA
                <br>• Distribution aux associés à titre de dividendes : ${fmt(allocation.dividendesProposes)} FCFA
                <br>• Solde reporté à nouveau : ${fmt(allocation.reportANouveauNouveau)} FCFA
              ` : `
                L'Assemblée Générale constate que l'exercice se solde par une perte nette de ${fmt(Math.abs(allocation.resultatNet))} FCFA et décide d'affecter cette perte au compte Report à Nouveau débiteur.
              `}
            </p>
          </div>

          <div style="background:#f9fafb; padding:14px; border-left:4px solid #123a32; margin-bottom:14px; border-radius:0 6px 6px 0;">
            <strong>QUATRIÈME RÉSOLUTION — Conventions réglementées</strong>
            <p style="margin:6px 0 0 0; font-size:13px; color:#374151;">
              L'Assemblée Générale prend acte qu'aucune convention nouvelle visée aux dispositions de l'article 438 de l'AUDSCGIE n'a été conclue au cours de l'exercice clos le 31 décembre ${esc(metadata.anneeN)}.
            </p>
          </div>

          <div style="background:#f9fafb; padding:14px; border-left:4px solid #123a32; margin-bottom:14px; border-radius:0 6px 6px 0;">
            <strong>CINQUIÈME RÉSOLUTION — Pouvoirs pour l'accomplissement des formalités légales</strong>
            <p style="margin:6px 0 0 0; font-size:13px; color:#374151;">
              L'Assemblée Générale confère tous pouvoirs au porteur d'une copie ou d'un extrait du présent procès-verbal à l'effet d'accomplir toutes formalités légales de publicité et de dépôt prescrites par la loi, notamment au Registre du Commerce et du Crédit Mobilier (RCCM) et auprès de la DGID.
            </p>
          </div>

        </div>

        <!-- BLOC DE SIGNATURE -->
        <div style="margin-top:40px; display:flex; justify-content:space-between; align-items:flex-end;">
          <div>
            <div style="font-size:13px; color:#4b5563;">Fait à Dakar, le ....................................</div>
          </div>
          <div style="text-align:center; width:250px;">
            <div style="font-size:13px; font-weight:700; color:#123a32; margin-bottom:50px;">La Gérance / Le Conseil d'Administration</div>
            <div style="border-top:1px dashed #9ca3af; font-size:11px; color:#6b7280; padding-top:4px;">Signature précédée de la mention manuscrite « Bon pour approbation »</div>
          </div>
        </div>

      </div>

    </div>
  `;
}

/**
 * Télécharge le rapport au format Microsoft Word (.doc) natif.
 */
export function downloadManagementReportDoc(data) {
  const htmlContent = buildManagementReportHtml(data);
  const header = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Rapport de Gestion & AGO - ${esc(data.metadata.denomination)}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d1d5db; padding: 6px 10px; }
      th { background-color: #123a32; color: #ffffff; }
    </style>
    </head><body>
  `;
  const footer = '</body></html>';
  const fullDoc = header + htmlContent + footer;

  const blob = new Blob(['\ufeff', fullDoc], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FINSMART_Rapport_Gestion_AGO_${data.metadata.anneeN}_${data.metadata.denomination.replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
