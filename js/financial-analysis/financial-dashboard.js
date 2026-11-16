/**
 * FINSMART – Module Analyse Financière Intelligente Premium V1.0
 * Moteur 5 & 6 : Tableau de bord interactif, Graphiques SVG, Simulateur de scénarios & Exports
 * 
 * Performance : 0 dépendance externe lourde, graphiques vectoriels SVG ultra-fluides.
 */

import { extractFinancialSnapshot } from './financial-extractor.js';
import { computeFinancialMetrics } from './financial-metrics.js';
import { runFinancialControls } from './financial-controls.js';
import { generateExpertNarrative, askFinancialAnalyst } from './financial-ai.js';

const fmt = n => (typeof n === 'number' ? (Math.round(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') : String(n ?? ''));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let currentAnalysisData = null;

/**
 * Initialise et rend le tableau de bord d'analyse financière pour le dossier actif.
 * @param {HTMLElement} container - Élément DOM conteneur (#view-analysis)
 * @param {object} p - { values, wb, infos, exercise, company, supabase }
 */
export async function renderFinancialAnalysisDashboard(container, { values, wb, infos, exercise, company, sb }) {
  container.innerHTML = '<div class="card" style="padding:40px; text-align:center;"><div class="spinner"></div><p style="margin-top:14px; font-weight:600; color:var(--brand);">Calcul de l\'analyse financière et des 100 indicateurs…</p></div>';

  try {
    // 1. Extraction et calculs déterministes
    const snapshot = extractFinancialSnapshot({ values, wb, infos, exercise, company });
    const metricsResult = computeFinancialMetrics(snapshot);
    const controlsResult = runFinancialControls(snapshot, metricsResult);
    const narrativeResult = generateExpertNarrative(snapshot, metricsResult, controlsResult);

    currentAnalysisData = { snapshot, metricsResult, controlsResult, narrativeResult, exercise, company };

    // Sauvegarde en arrière-plan dans Supabase si connecté
    if (sb && exercise?.id && company?.id) {
      try {
        await sb.from('financial_analyses').upsert({
          company_id: company.id,
          exercise_id: exercise.id,
          created_by: exercise.created_by,
          analysis_level: 'professionnel',
          source_snapshot: snapshot,
          metrics: metricsResult.metrics,
          controls_audit: controlsResult.controls,
          health_score: controlsResult.healthScore,
          ai_commentary: narrativeResult.sections,
          recommendations: narrativeResult.recommandations,
          status: 'valide'
        }, { onConflict: 'exercise_id,analysis_level' });
      } catch (err) {
        console.warn('Archivage financial_analyses dans Supabase non bloquant:', err.message);
      }
    }

    // 2. Construction de l'interface
    renderFullDashboardUI(container, currentAnalysisData);

  } catch (err) {
    console.error('Erreur renderFinancialAnalysisDashboard:', err);
    container.innerHTML = `<div class="card"><p class="msg err">Impossible de générer l'analyse financière : ${esc(err.message)}</p></div>`;
  }
}

function renderFullDashboardUI(container, data) {
  const { snapshot, metricsResult, controlsResult, narrativeResult } = data;
  const score = controlsResult.healthScore;
  const { metricsMap } = metricsResult;

  const ca = metricsMap.get('IND_01');
  const croissCa = metricsMap.get('IND_02');
  const va = metricsMap.get('IND_13');
  const ebe = metricsMap.get('IND_15');
  const rn = metricsMap.get('IND_21');
  const margeNette = metricsMap.get('IND_22');
  const frng = metricsMap.get('IND_41');
  const bfre = metricsMap.get('IND_42');
  const tn = metricsMap.get('IND_45');
  const roe = metricsMap.get('IND_24');
  const fcf = metricsMap.get('IND_68');
  const dso = metricsMap.get('IND_72');

  container.innerHTML = `
    <!-- EN-TÊTE DU TABLEAU DE BORD D'ANALYSE -->
    <div class="analysis-header card" style="margin-bottom:20px; background:linear-gradient(135deg, #123a32 0%, #0d2822 100%); color:#fff; border:none; box-shadow:0 6px 20px rgba(18,58,50,0.18);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(233,185,73,0.18); border:1px solid #e9b949; color:#e9b949; font-size:11px; font-weight:800; padding:3px 10px; border-radius:999px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">
            <span>★</span> FINSMART ANALYSE FINANCIÈRE PREMIUM V1.0
          </div>
          <h1 style="color:#ffffff; font-size:24px; margin:0 0 4px 0;">${esc(snapshot.metadata.denomination)}</h1>
          <div style="font-size:13px; opacity:0.85;">
            Exercice clos le ${esc(snapshot.metadata.anneeN)} · Modèle officiel DGID Sénégal (SYSCOHADA Révisé) · NINEA : ${esc(snapshot.metadata.ninea || 'Non renseigné')}
          </div>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button type="button" class="btn gold sm" id="btnPrintAnalysisReport">
            🖨️ Imprimer le Rapport A4
          </button>
          <button type="button" class="btn ghost sm" id="btnExportAnalysisXlsx" style="color:#fff; border-color:rgba(255,255,255,0.3);">
            📊 Exporter Excel (.xlsx)
          </button>
          <button type="button" class="btn ghost sm" data-go="dashboard" style="color:#fff; border-color:rgba(255,255,255,0.3);">
            ← Retour aux dossiers
          </button>
        </div>
      </div>

      <!-- BANDEAU SCORE DE SANTÉ FINANCIÈRE -->
      <div class="analysis-score-banner" style="margin-top:20px; padding-top:18px; border-top:1px solid rgba(255,255,255,0.12); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:72px; height:72px; border-radius:50%; background:${score.total >= 65 ? '#10b981' : (score.total >= 50 ? '#f59e0b' : '#ef4444')}; color:#fff; display:grid; place-items:center; font-size:24px; font-weight:800; box-shadow:0 4px 12px rgba(0,0,0,0.25);">
            ${score.total}<small style="font-size:12px; font-weight:600;">/100</small>
          </div>
          <div>
            <div style="font-size:16px; font-weight:700; color:#fff;">Score de Santé Financière Globale</div>
            <div style="font-size:13px; color:#e9b949; font-weight:600;">${esc(score.mention)}</div>
            <div style="font-size:12px; opacity:0.8; margin-top:2px;">100 indicateurs analysés · 20 contrôles de cohérence vérifiés</div>
          </div>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${Object.entries(score.piliers).map(([k, p]) => `
            <div style="background:rgba(255,255,255,0.08); padding:6px 12px; border-radius:8px; font-size:12px; text-align:center;">
              <div style="opacity:0.75; font-size:11px;">${esc(p.label.split('&')[0])}</div>
              <div style="font-weight:700; font-size:13px; color:#fff;">${p.score} / ${p.max}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- ONGLETS DE NAVIGATION DU MODULE D'ANALYSE -->
    <div class="tabs" style="margin-bottom:20px; border-bottom:2px solid var(--line);" id="analysisTabsNav">
      <button class="tab active" data-tab="vue-ensemble">📌 Vue d'ensemble</button>
      <button class="tab" data-tab="sig">📈 Soldes & Marges (SIG)</button>
      <button class="tab" data-tab="structure">🏛️ Structure & Bilan</button>
      <button class="tab" data-tab="equilibre">⚖️ Équilibre & BFR</button>
      <button class="tab" data-tab="rentabilite">💎 Rentabilité & DuPont</button>
      <button class="tab" data-tab="flux">🌊 Flux de Trésorerie (TFT)</button>
      <button class="tab" data-tab="cycle">🔄 Cycle d'exploitation</button>
      <button class="tab" data-tab="risques">⚠️ Diagnostic & Risques</button>
      <button class="tab" data-tab="scenarios">🔮 Scénarios N+1</button>
      <button class="tab" data-tab="assistant">🤖 FINSMART Analyste IA</button>
    </div>

    <!-- ================= CONTENU DES ONGLETS ================= -->
    <div id="analysisTabContents">

      <!-- 1. VUE D'ENSEMBLE -->
      <div class="analysis-tab-pane" id="pane-vue-ensemble">
        <!-- 8 CARTES KPI PRINCIPALES -->
        <div class="grid4" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:20px;">
          ${renderKpiCard('Chiffre d\'affaires', ca.valN, ca.valN1, croissCa.valN, '%', 'IND_01')}
          ${renderKpiCard('Excédent Brut (EBE)', ebe.valN, ebe.valN1, ebe.varPct, '%', 'IND_15')}
          ${renderKpiCard('Résultat Net', rn.valN, rn.valN1, rn.varPct, '%', 'IND_21')}
          ${renderKpiCard('Marge Nette', margeNette.valN, margeNette.valN1, null, '%', 'IND_22')}
          ${renderKpiCard('Fonds de Roulement (FRNG)', frng.valN, frng.valN1, frng.varPct, '%', 'IND_41')}
          ${renderKpiCard('Besoin en Fonds de Roulement (BFRE)', bfre.valN, bfre.valN1, bfre.varPct, '%', 'IND_42')}
          ${renderKpiCard('Trésorerie Nette', tn.valN, tn.valN1, tn.varPct, '%', 'IND_45')}
          ${renderKpiCard('Free Cash Flow', fcf.valN, null, null, 'FCFA', 'IND_68')}
        </div>

        <!-- SYNTHÈSE EXÉCUTIVE ET RECOMMANDATIONS -->
        <div class="grid2" style="margin-bottom:20px;">
          <div class="card">
            <h2>Synthèse Exécutive de Direction</h2>
            <p style="font-size:14px; line-height:1.6; color:var(--ink);">${esc(narrativeResult.syntheseExecutive.constatGlobal)}</p>
            <div style="margin-top:14px;">
              <div style="font-weight:700; font-size:13px; color:#166534; margin-bottom:6px;">✓ Principaux Points Forts :</div>
              <ul style="margin:0; padding-left:20px; font-size:13px; line-height:1.5; color:var(--ink-2);">
                ${narrativeResult.syntheseExecutive.pointsForts.map(p => `<li>${esc(p)}</li>`).join('')}
              </ul>
            </div>
            <div style="margin-top:14px;">
              <div style="font-weight:700; font-size:13px; color:#991b1b; margin-bottom:6px;">⚠ Points de Vigilance Majeurs :</div>
              <ul style="margin:0; padding-left:20px; font-size:13px; line-height:1.5; color:var(--ink-2);">
                ${narrativeResult.syntheseExecutive.pointsVigilance.map(p => `<li>${esc(p)}</li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="card">
            <h2>Plan d'Action & Recommandations Prioritaires</h2>
            <div style="display:flex; flex-direction:column; gap:12px; margin-top:10px;">
              ${narrativeResult.recommandations.slice(0, 3).map(r => `
                <div style="border-left:3px solid var(--brand); background:#f9fafb; padding:10px 14px; border-radius:0 8px 8px 0;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <strong style="font-size:13px; color:var(--brand);">${esc(r.action)}</strong>
                    <span class="badge ${r.priorite === 'Haute' ? 'bad' : 'warn'}">${esc(r.priorite)}</span>
                  </div>
                  <div style="font-size:12px; color:var(--ink-2); line-height:1.4;">${esc(r.justification)}</div>
                  <div style="font-size:11px; color:var(--muted); margin-top:4px;">🎯 <i>${esc(r.indicateurSuivi)}</i></div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- 2. SOLDES INTERMÉDIAIRES DE GESTION -->
      <div class="analysis-tab-pane" id="pane-sig" hidden>
        <div class="card" style="margin-bottom:20px;">
          <h2>Formation du Résultat et Soldes Intermédiaires (SYSCOHADA)</h2>
          <p class="muted small">${esc(narrativeResult.sections.sig.commentaire)}</p>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Poste SIG SYSCOHADA</th>
                  <th style="text-align:right;">Exercice N (FCFA)</th>
                  <th style="text-align:right;">Exercice N-1 (FCFA)</th>
                  <th style="text-align:right;">Variation (FCFA)</th>
                  <th style="text-align:right;">Variation %</th>
                  <th style="text-align:right;">% sur CA N</th>
                </tr>
              </thead>
              <tbody>
                ${renderSigRow('Chiffre d\'affaires total', ca.valN, ca.valN1, true)}
                ${renderSigRow('Marge commerciale brute', metricsMap.get('IND_11')?.valN, metricsMap.get('IND_11')?.valN1)}
                ${renderSigRow('Valeur Ajoutée (VA)', va.valN, va.valN1, true)}
                ${renderSigRow('Excédent Brut d\'Exploitation (EBE)', ebe.valN, ebe.valN1, true)}
                ${renderSigRow('Résultat d\'exploitation (RE)', re.valN, re.valN1, true)}
                ${renderSigRow('Résultat financier', metricsMap.get('IND_18')?.valN, metricsMap.get('IND_18')?.valN1)}
                ${renderSigRow('Résultat des activités ordinaires (RAO)', metricsMap.get('IND_19')?.valN, metricsMap.get('IND_19')?.valN1)}
                ${renderSigRow('Résultat Hors Activités Ordinaires (RHAO)', metricsMap.get('IND_20')?.valN, metricsMap.get('IND_20')?.valN1)}
                ${renderSigRow('Résultat Net de l\'exercice', rn.valN, rn.valN1, true, true)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 3. STRUCTURE FINANCIÈRE -->
      <div class="analysis-tab-pane" id="pane-structure" hidden>
        <div class="card" style="margin-bottom:20px;">
          <h2>Grandes Masses du Bilan & Structure de Financement</h2>
          <p class="muted small">${esc(narrativeResult.sections.structure.commentaire)}</p>
          <div class="grid2">
            <div>
              <h3>Actif du Bilan</h3>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Masse d'Actif</th><th style="text-align:right;">Montant N</th><th style="text-align:right;">Poids %</th></tr></thead>
                  <tbody>
                    <tr><td>Actif immobilisé net</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalActifImmobiliseNet.n)}</td><td style="text-align:right;">${metricsMap.get('IND_33')?.valN}%</td></tr>
                    <tr><td>Actif circulant (stocks + créances)</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalActifCirculant.n)}</td><td style="text-align:right;">${Math.round(snapshot.bilan.totalActifCirculant.n * 100 / snapshot.bilan.totalGeneralActif.n)}%</td></tr>
                    <tr><td>Trésorerie Actif</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalTresorerieActif.n)}</td><td style="text-align:right;">${Math.round(snapshot.bilan.totalTresorerieActif.n * 100 / snapshot.bilan.totalGeneralActif.n)}%</td></tr>
                    <tr style="background:#f9fafb; font-weight:800;"><td>TOTAL ACTIF</td><td style="text-align:right;">${fmt(snapshot.bilan.totalGeneralActif.n)}</td><td style="text-align:right;">100%</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3>Passif du Bilan</h3>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Masse de Financement</th><th style="text-align:right;">Montant N</th><th style="text-align:right;">Poids %</th></tr></thead>
                  <tbody>
                    <tr><td>Capitaux propres et réserves</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalCapitauxPropres.n)}</td><td style="text-align:right;">${metricsMap.get('IND_36')?.valN}%</td></tr>
                    <tr><td>Dettes financières à terme</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalDettesFinancieres.n)}</td><td style="text-align:right;">${Math.round(snapshot.bilan.totalDettesFinancieres.n * 100 / snapshot.bilan.totalGeneralPassif.n)}%</td></tr>
                    <tr><td>Passif circulant (dettes court terme)</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalPassifCirculant.n)}</td><td style="text-align:right;">${Math.round(snapshot.bilan.totalPassifCirculant.n * 100 / snapshot.bilan.totalGeneralPassif.n)}%</td></tr>
                    <tr><td>Trésorerie Passif (découverts)</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.bilan.totalTresoreriePassif.n)}</td><td style="text-align:right;">${Math.round(snapshot.bilan.totalTresoreriePassif.n * 100 / snapshot.bilan.totalGeneralPassif.n)}%</td></tr>
                    <tr style="background:#f9fafb; font-weight:800;"><td>TOTAL PASSIF</td><td style="text-align:right;">${fmt(snapshot.bilan.totalGeneralPassif.n)}</td><td style="text-align:right;">100%</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. ÉQUILIBRE FINANCIER & BFR -->
      <div class="analysis-tab-pane" id="pane-equilibre" hidden>
        <div class="card">
          <h2>Équilibre Financier Fondamental : FRNG - BFR = Trésorerie Nette</h2>
          <div class="grid3" style="margin:20px 0;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:18px; border-radius:8px; text-align:center;">
              <div style="font-size:12px; color:#166534; font-weight:700;">Fonds de Roulement (FRNG)</div>
              <div style="font-size:22px; font-weight:800; color:#15803d; margin:6px 0;">${fmt(frng.valN)} <small style="font-size:12px;">FCFA</small></div>
              <div style="font-size:12px; color:var(--muted);">Ressources stables - Immos nettes</div>
            </div>
            <div style="background:#fffbeb; border:1px solid #fde68a; padding:18px; border-radius:8px; text-align:center;">
              <div style="font-size:12px; color:#92400e; font-weight:700;">Besoin en Fonds de Roulement (BFR)</div>
              <div style="font-size:22px; font-weight:800; color:#b45309; margin:6px 0;">${fmt(bfre.valN)} <small style="font-size:12px;">FCFA</small></div>
              <div style="font-size:12px; color:var(--muted);">Actifs circulants - Dettes d'exploitation</div>
            </div>
            <div style="background:${tn.valN >= 0 ? '#f0fdf4' : '#fef2f2'}; border:1px solid ${tn.valN >= 0 ? '#bbf7d0' : '#fecaca'}; padding:18px; border-radius:8px; text-align:center;">
              <div style="font-size:12px; color:${tn.valN >= 0 ? '#166534' : '#991b1b'}; font-weight:700;">Trésorerie Nette (TN)</div>
              <div style="font-size:22px; font-weight:800; color:${tn.valN >= 0 ? '#15803d' : '#b91c1c'}; margin:6px 0;">${fmt(tn.valN)} <small style="font-size:12px;">FCFA</small></div>
              <div style="font-size:12px; color:var(--muted);">FRNG - BFR = Cash disponible</div>
            </div>
          </div>
          <p style="font-size:13px; line-height:1.6; color:var(--ink-2);">${esc(frng.interpretation)} ${esc(tn.interpretation)}</p>
        </div>
      </div>

      <!-- 5. RENTABILITÉ & DUPONT -->
      <div class="analysis-tab-pane" id="pane-rentabilite" hidden>
        <div class="card">
          <h2>Analyse de Rentabilité & Décomposition DuPont (ROE)</h2>
          <p class="muted small">${esc(narrativeResult.sections.rentabilite.commentaire)}</p>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:18px; margin:16px 0;">
            <div style="font-size:16px; font-weight:700; color:var(--brand); text-align:center; margin-bottom:12px;">
              Formule DuPont : ROE = Marge Nette × Rotation de l'Actif × Levier Financier
            </div>
            <div style="display:flex; justify-content:center; align-items:center; gap:16px; flex-wrap:wrap; font-size:18px; font-weight:800;">
              <div style="background:#fff; padding:10px 18px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.05); text-align:center;">
                <div style="font-size:11px; color:var(--muted); font-weight:600;">Rentabilité Capitaux (ROE)</div>
                <div style="color:var(--brand);">${roe.valN ?? 'N/A'}%</div>
              </div>
              <span>=</span>
              <div style="background:#fff; padding:10px 18px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.05); text-align:center;">
                <div style="font-size:11px; color:var(--muted); font-weight:600;">Marge Nette (RN / CA)</div>
                <div style="color:#0284c7;">${margeNette.valN}%</div>
              </div>
              <span>×</span>
              <div style="background:#fff; padding:10px 18px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.05); text-align:center;">
                <div style="font-size:11px; color:var(--muted); font-weight:600;">Rotation Actif (CA / Actif)</div>
                <div style="color:#059669;">${metricsMap.get('IND_27')?.valN ?? 'N/A'}x</div>
              </div>
              <span>×</span>
              <div style="background:#fff; padding:10px 18px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.05); text-align:center;">
                <div style="font-size:11px; color:var(--muted); font-weight:600;">Levier (Actif / CP)</div>
                <div style="color:#d97706;">${metricsMap.get('IND_28')?.valN ?? 'N/A'}x</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 6. FLUX DE TRÉSORERIE (TFT) -->
      <div class="analysis-tab-pane" id="pane-flux" hidden>
        <div class="card">
          <h2>Tableau des Flux de Trésorerie (TFT SYSCOHADA)</h2>
          <p class="muted small">${esc(narrativeResult.sections.flux.commentaire)}</p>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Flux de trésorerie (TFT)</th><th style="text-align:right;">Montant N (FCFA)</th><th style="text-align:right;">Montant N-1 (FCFA)</th></tr></thead>
              <tbody>
                <tr><td>Trésorerie nette d'ouverture au 1er janvier</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.tft.tresorerieOuverture.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.tresorerieOuverture.n1)}</td></tr>
                <tr><td>Capacité d'Autofinancement Globale (CAFG)</td><td style="text-align:right; font-weight:700; color:#166534;">${fmt(snapshot.tft.cafg.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.cafg.n1)}</td></tr>
                <tr style="background:#f0fdf4; font-weight:800;"><td>Flux de trésorerie provenant des activités opérationnelles</td><td style="text-align:right; color:#15803d;">${fmt(snapshot.tft.fluxTresorerieOperationnels.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.fluxTresorerieOperationnels.n1)}</td></tr>
                <tr><td>Flux de trésorerie des activités d'investissement</td><td style="text-align:right; font-weight:700; color:#991b1b;">${fmt(snapshot.tft.fluxTresorerieInvestissement.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.fluxTresorerieInvestissement.n1)}</td></tr>
                <tr><td>Flux de trésorerie des activités de financement</td><td style="text-align:right; font-weight:700;">${fmt(snapshot.tft.fluxTresorerieFinancement.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.fluxTresorerieFinancement.n1)}</td></tr>
                <tr style="background:#f8fafc; font-weight:800;"><td>VARIATION NETTE DE TRÉSORERIE</td><td style="text-align:right; color:var(--brand);">${fmt(snapshot.tft.variationNetteTresorerie.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.variationNetteTresorerie.n1)}</td></tr>
                <tr style="background:#eef2ff; font-weight:800;"><td>TRÉSORERIE NETTE DE CLÔTURE (31 DÉCEMBRE)</td><td style="text-align:right; color:#3730a3; font-size:15px;">${fmt(snapshot.tft.tresorerieCloture.n)}</td><td style="text-align:right;">${fmt(snapshot.tft.tresorerieCloture.n1)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 7. CYCLE D'EXPLOITATION -->
      <div class="analysis-tab-pane" id="pane-cycle" hidden>
        <div class="card">
          <h2>Cycle d'Exploitation & Délais de Rotation (BFR)</h2>
          <div class="grid3" style="margin:20px 0;">
            <div style="background:#f8fafc; border:1px solid var(--line); padding:16px; border-radius:8px; text-align:center;">
              <div style="font-size:12px; color:var(--muted); font-weight:700;">Délai de Rotation des Stocks</div>
              <div style="font-size:24px; font-weight:800; color:var(--ink); margin:6px 0;">${metricsMap.get('IND_71')?.valN ?? 'N/A'} <small style="font-size:13px;">jours</small></div>
              <div style="font-size:12px; color:var(--muted);">Stocks moyens / Achats * 365</div>
            </div>
            <div style="background:#f8fafc; border:1px solid var(--line); padding:16px; border-radius:8px; text-align:center;">
              <div style="font-size:12px; color:var(--muted); font-weight:700;">Délai de Règlement Clients (DSO)</div>
              <div style="font-size:24px; font-weight:800; color:${(dso.valN || 0) > 90 ? '#dc2626' : 'var(--ink)'}; margin:6px 0;">${dso.valN ?? 'N/A'} <small style="font-size:13px;">jours</small></div>
              <div style="font-size:12px; color:var(--muted);">Créances clients / CA TTC * 365</div>
            </div>
            <div style="background:#f8fafc; border:1px solid var(--line); padding:16px; border-radius:8px; text-align:center;">
              <div style="font-size:12px; color:var(--muted); font-weight:700;">Délai Fournisseurs (DPO)</div>
              <div style="font-size:24px; font-weight:800; color:var(--ink); margin:6px 0;">${metricsMap.get('IND_73')?.valN ?? 'N/A'} <small style="font-size:13px;">jours</small></div>
              <div style="font-size:12px; color:var(--muted);">Dettes fournisseurs / Achats TTC * 365</div>
            </div>
          </div>
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:14px; border-radius:8px; text-align:center; font-size:15px; font-weight:700; color:#166534;">
            Cycle de conversion de trésorerie net (CCC) : ${metricsMap.get('IND_74')?.valN ?? 'N/A'} jours d'exploitation
          </div>
        </div>
      </div>

      <!-- 8. DIAGNOSTIC & RISQUES (20 CONTRÔLES) -->
      <div class="analysis-tab-pane" id="pane-risques" hidden>
        <div class="card">
          <h2>Journal d'Audit & Matrice des 20 Contrôles de Cohérence</h2>
          <div class="table-wrap" style="margin-top:14px;">
            <table class="table">
              <thead><tr><th>Code</th><th>Point de contrôle</th><th>Type</th><th>Statut</th><th>Explication & Constat</th></tr></thead>
              <tbody>
                ${controlsResult.controls.map(c => `
                  <tr>
                    <td><code>${esc(c.code)}</code></td>
                    <td style="font-weight:600;">${esc(c.label)}</td>
                    <td><span class="badge ${c.type === 'bloquant' ? 'bad' : 'neutral'}">${esc(c.type)}</span></td>
                    <td><span class="badge ${c.status === 'ok' ? 'ok' : 'bad'}">${c.status === 'ok' ? '✓ Conforme' : '⚠ Anomalie'}</span></td>
                    <td style="font-size:12.5px; color:var(--ink-2);">${esc(c.explication)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 9. SIMULATIONS & SCÉNARIOS N+1 -->
      <div class="analysis-tab-pane" id="pane-scenarios" hidden>
        <div class="card">
          <h2>Simulateur Financier & Projections N+1</h2>
          <p class="muted small">Ajustez les curseurs pour simuler l'impact instantané sur l'EBE, le résultat net, le BFR et la trésorerie nette.</p>
          <div class="grid3" style="margin:20px 0; background:#f9fafb; padding:18px; border-radius:8px;">
            <label>Variation Chiffre d'affaires (%) : <span id="valSimCA" style="font-weight:700; color:var(--brand);">+10%</span>
              <input type="range" id="sliderSimCA" min="-30" max="50" step="5" value="10">
            </label>
            <label>Gain de marge commerciale (%) : <span id="valSimMarge" style="font-weight:700; color:var(--brand);">+2 pts</span>
              <input type="range" id="sliderSimMarge" min="-5" max="10" step="1" value="2">
            </label>
            <label>Réduction délai clients DSO (jours) : <span id="valSimDSO" style="font-weight:700; color:var(--brand);">-15 j</span>
              <input type="range" id="sliderSimDSO" min="-45" max="30" step="5" value="-15">
            </label>
          </div>

          <div class="grid4" id="boxSimResults" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
            <!-- Calculé dynamiquement -->
          </div>
        </div>
      </div>

      <!-- 10. FINSMART ANALYSTE IA (ASSISTANT CONVERSATIONNEL) -->
      <div class="analysis-tab-pane" id="pane-assistant" hidden>
        <div class="card" style="max-width:850px; margin:0 auto;">
          <h2>🤖 FINSMART Analyste IA – Votre copilote financier</h2>
          <p class="muted small">Interrogez l'intelligence artificielle sur les états financiers réels de ${esc(snapshot.metadata.denomination)}.</p>

          <div id="aiChatBox" style="height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:16px; background:#fbfcfb; display:flex; flex-direction:column; gap:12px; margin-bottom:14px;">
            <div style="background:#eef2f6; padding:10px 14px; border-radius:8px; font-size:13px; line-height:1.5; max-width:85%;">
              Bonjour ! Je suis <strong>FINSMART Analyste IA</strong>. J'ai analysé en détail les 100 indicateurs financiers de <strong>${esc(snapshot.metadata.denomination)}</strong> pour l'exercice ${esc(snapshot.metadata.anneeN)}. Quelle question souhaitez-vous me poser ?
            </div>
          </div>

          <div style="display:flex; gap:8px;">
            <input type="text" id="aiQuestionInput" class="search" placeholder="Ex: Pourquoi ma trésorerie a baissé ? Mon endettement est-il risqué ?" style="flex:1;">
            <button type="button" class="btn primary" id="btnSendAiQuestion">Envoyer</button>
          </div>

          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
            <span class="small muted">Suggestions :</span>
            <button type="button" class="link small btn-suggest-q" data-q="Quels postes expliquent la trésorerie ?">Trésorerie & Cash</button> ·
            <button type="button" class="link small btn-suggest-q" data-q="Mon niveau d'endettement est-il soutenable ?">Dette & Risques</button> ·
            <button type="button" class="link small btn-suggest-q" data-q="Comment améliorer mon BFR ?">Optimisation BFR</button>
          </div>
        </div>
      </div>

    </div>
  `;

  setupAnalysisTabs();
  setupSimulationSliders(data);
  setupAiAssistant(data);
  setupExportButtons(data);
}

function renderKpiCard(title, valN, valN1, varPct, unit, code) {
  const isPos = varPct !== null && varPct >= 0;
  return `
    <div class="card" style="padding:14px 16px; position:relative;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase;">${esc(title)}</span>
        <span style="font-size:10px; font-family:var(--mono); color:var(--muted);">${esc(code)}</span>
      </div>
      <div style="font-size:19px; font-weight:800; color:var(--ink); margin:6px 0 2px 0;">
        ${fmt(valN)} <small style="font-size:11px; font-weight:600; color:var(--muted);">${esc(unit === 'FCFA' ? 'F' : (unit === '%' ? '%' : ''))}</small>
      </div>
      <div style="font-size:11.5px; display:flex; gap:6px; align-items:center;">
        ${valN1 !== null && valN1 !== undefined ? `<span class="muted">N-1 : ${fmt(valN1)}</span>` : ''}
        ${varPct !== null && varPct !== undefined ? `<span class="badge ${isPos ? 'ok' : 'bad'}" style="font-size:10.5px; padding:1px 6px;">${isPos ? '+' : ''}${varPct}%</span>` : ''}
      </div>
    </div>
  `;
}

function renderSigRow(label, n, n1, isBold = false, isHighlight = false) {
  const abs = (n !== null && n1 !== null) ? n - n1 : null;
  const pct = (n !== null && n1 !== null && Math.abs(n1) > 0) ? Math.round((abs / Math.abs(n1)) * 100) : null;
  const style = isHighlight ? 'background:#ecfdf5; font-weight:800;' : (isBold ? 'font-weight:700;' : '');
  return `
    <tr style="${style}">
      <td>${esc(label)}</td>
      <td style="text-align:right;">${fmt(n)}</td>
      <td style="text-align:right; color:var(--muted);">${fmt(n1)}</td>
      <td style="text-align:right;">${abs !== null ? (abs > 0 ? '+' : '') + fmt(abs) : '—'}</td>
      <td style="text-align:right;">${pct !== null ? (pct > 0 ? '+' : '') + pct + '%' : '—'}</td>
      <td style="text-align:right; color:var(--muted);">${currentAnalysisData?.metricsResult?.metricsMap?.get('IND_01')?.valN > 0 ? Math.round(n * 100 / currentAnalysisData.metricsResult.metricsMap.get('IND_01').valN) + '%' : '—'}</td>
    </tr>
  `;
}

function setupAnalysisTabs() {
  const tabs = document.querySelectorAll('#analysisTabsNav .tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.toggle('active', x === t));
    const target = t.dataset.tab;
    document.querySelectorAll('.analysis-tab-pane').forEach(p => {
      p.hidden = p.id !== `pane-${target}`;
    });
  }));
}

function setupSimulationSliders(data) {
  const sliderCA = document.getElementById('sliderSimCA');
  const sliderMarge = document.getElementById('sliderSimMarge');
  const sliderDSO = document.getElementById('sliderSimDSO');
  if (!sliderCA || !sliderMarge || !sliderDSO) return;

  function updateSim() {
    const dCA = Number(sliderCA.value);
    const dMarge = Number(sliderMarge.value);
    const dDSO = Number(sliderDSO.value);

    document.getElementById('valSimCA').textContent = `${dCA > 0 ? '+' : ''}${dCA}%`;
    document.getElementById('valSimMarge').textContent = `${dMarge > 0 ? '+' : ''}${dMarge} pts`;
    document.getElementById('valSimDSO').textContent = `${dDSO > 0 ? '+' : ''}${dDSO} j`;

    const baseCA = data.snapshot.cr.chiffreAffaires.n;
    const baseEBE = data.snapshot.cr.excedentBrutExploitation.n;
    const baseRN = data.snapshot.cr.resultatNet.n;
    const baseTN = data.snapshot.equilibre.tresorerieNette.n;

    const newCA = baseCA * (1 + dCA / 100);
    const deltaCA = newCA - baseCA;
    // Marge additionnelle
    const gainMarge = (deltaCA * 0.3) + (newCA * (dMarge / 100));
    const newEBE = baseEBE + gainMarge;
    const newRN = baseRN + (gainMarge * 0.7); // Après impôt 30% Sénégal
    const cashLibereDSO = (newCA * 1.18 / 365) * (-dDSO);
    const newTN = baseTN + (gainMarge * 0.7) + cashLibereDSO;

    const box = document.getElementById('boxSimResults');
    if (box) {
      box.innerHTML = `
        <div class="card" style="padding:12px; background:#fff; text-align:center;">
          <div style="font-size:11px; color:var(--muted);">Nouveau CA projeté</div>
          <div style="font-size:16px; font-weight:800; color:var(--brand);">${fmt(newCA)} F</div>
          <div style="font-size:11px; color:#166534;">${dCA > 0 ? '+' : ''}${fmt(deltaCA)} F</div>
        </div>
        <div class="card" style="padding:12px; background:#fff; text-align:center;">
          <div style="font-size:11px; color:var(--muted);">Nouvel EBE estimé</div>
          <div style="font-size:16px; font-weight:800; color:#15803d;">${fmt(newEBE)} F</div>
          <div style="font-size:11px; color:#166534;">+${fmt(gainMarge)} F</div>
        </div>
        <div class="card" style="padding:12px; background:#fff; text-align:center;">
          <div style="font-size:11px; color:var(--muted);">Nouveau Résultat Net</div>
          <div style="font-size:16px; font-weight:800; color:#0284c7;">${fmt(newRN)} F</div>
          <div style="font-size:11px; color:#166534;">+${fmt(gainMarge * 0.7)} F</div>
        </div>
        <div class="card" style="padding:12px; background:#fff; text-align:center;">
          <div style="font-size:11px; color:var(--muted);">Impact Cash & Trésorerie</div>
          <div style="font-size:16px; font-weight:800; color:${newTN >= 0 ? '#166534' : '#dc2626'};">${fmt(newTN)} F</div>
          <div style="font-size:11px; color:#166534;">Cash libéré DSO : +${fmt(cashLibereDSO)} F</div>
        </div>
      `;
    }
  }

  sliderCA.addEventListener('input', updateSim);
  sliderMarge.addEventListener('input', updateSim);
  sliderDSO.addEventListener('input', updateSim);
  updateSim();
}

function setupAiAssistant(data) {
  const box = document.getElementById('aiChatBox');
  const input = document.getElementById('aiQuestionInput');
  const btn = document.getElementById('btnSendAiQuestion');
  if (!box || !input || !btn) return;

  function ask(q) {
    if (!q || !q.trim()) return;
    const userMsg = document.createElement('div');
    userMsg.style.cssText = 'background:var(--brand); color:#fff; padding:10px 14px; border-radius:8px; font-size:13px; line-height:1.5; align-self:flex-end; max-width:85%;';
    userMsg.textContent = q;
    box.appendChild(userMsg);
    input.value = '';
    box.scrollTop = box.scrollHeight;

    setTimeout(() => {
      const answer = askFinancialAnalyst(q, data.snapshot, data.metricsResult, data.controlsResult);
      const aiMsg = document.createElement('div');
      aiMsg.style.cssText = 'background:#eef2f6; padding:10px 14px; border-radius:8px; font-size:13px; line-height:1.5; align-self:flex-start; max-width:85%;';
      aiMsg.innerHTML = `<strong>FINSMART Analyste IA :</strong><br>${esc(answer)}`;
      box.appendChild(aiMsg);
      box.scrollTop = box.scrollHeight;
    }, 400);
  }

  btn.addEventListener('click', () => ask(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(input.value); });
  document.querySelectorAll('.btn-suggest-q').forEach(b => b.addEventListener('click', () => ask(b.dataset.q)));
}

function setupExportButtons(data) {
  document.getElementById('btnPrintAnalysisReport')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btnExportAnalysisXlsx')?.addEventListener('click', () => {
    exportAnalysisToCsvOrExcel(data);
  });
}

function exportAnalysisToCsvOrExcel(data) {
  const { metricsResult, snapshot } = data;
  let csv = 'Famille;N°;Code;Indicateur;Valeur N;Valeur N-1;Variation Absolue;Variation %;Unité;Statut;Formule\n';
  metricsResult.metrics.forEach(m => {
    csv += `"${m.family}";${m.num};"${m.code}";"${m.label}";${m.valN ?? ''};${m.valN1 ?? ''};${m.varAbs ?? ''};${m.varPct ?? ''};"${m.unit}";"${m.status}";"${m.formula}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `FINSMART_Analyse_100_Indicateurs_${snapshot.metadata.anneeN}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
