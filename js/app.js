/* FINSMART – Application de collecte des balances et de génération de la liasse DGID */
import { SUPABASE_URL, SUPABASE_KEY, BRAND } from './config.js';
import { parseBalance, INFO_SECTIONS, INFO_TABLES, INFO_EXTRA, EFFECTIFS, nomFichier, fmt, BALANCE_COLUMNS } from './liasse.js';
import { fillModele } from './xlsx-filler.js';

const sb = window.__SB_MOCK__ ? window.__SB_MOCK__() : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ENGINE_URL = new URL('../engine.json', import.meta.url).href;
const MODELE_URL = new URL('../modele_DGID.xlsx', import.meta.url).href;
const STATUTS = {
  en_attente: ['Brouillon', 'neutral'], en_traitement: ['En revue FINSMART', 'warn'],
  disponible: ['Liasse disponible', 'ok'], erreur: ['À corriger', 'bad'],
};

const state = { user: null, profile: null, companies: [], dossier: null, engine: null, step: 1 };

// ------------------------------------------------------------------ utilitaires UI
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 4200);
}
function setMsg(el, text, kind = '') { el.textContent = text || ''; el.className = 'msg ' + kind; }
function show(view) {
  $$('.view').forEach(v => (v.hidden = v.id !== 'view-' + view));
  $('#nav').hidden = view === 'auth';
  window.scrollTo(0, 0);
}
function badge(statut) { const [l, k] = STATUTS[statut] || [statut, 'neutral']; return `<span class="badge ${k}">${esc(l)}</span>`; }
const dateFr = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const dateTimeFr = d => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function loadEngine() {
  if (!state.engine) state.engine = await fetch(ENGINE_URL).then(r => r.json());
  return state.engine;
}
function dbErr(e) {
  if (!e) return '';
  if (e.code === '23505') return 'Un dossier existe déjà pour cette entreprise et cet exercice.';
  return e.message || String(e);
}

// ------------------------------------------------------------------ authentification
$$('[data-auth]').forEach(b => b.addEventListener('click', () => {
  $$('[data-auth]').forEach(x => x.classList.toggle('active', x === b));
  $('#formLogin').hidden = b.dataset.auth !== 'login';
  $('#formSignup').hidden = b.dataset.auth !== 'signup';
  setMsg($('#authMsg'), '');
}));
$('#formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  setMsg($('#authMsg'), 'Connexion…');
  const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
  if (error) setMsg($('#authMsg'), /confirm/i.test(error.message) ? 'Adresse email non confirmée : ouvrez le lien reçu par email.' : 'Email ou mot de passe incorrect.', 'err');
});
$('#formSignup').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  setMsg($('#authMsg'), 'Création du compte…');
  const { data, error } = await sb.auth.signUp({
    email: f.get('email').trim(), password: f.get('password'),
    options: { data: { nom_complet: f.get('nom_complet').trim(), telephone: f.get('telephone').trim() }, emailRedirectTo: location.href.split('#')[0] },
  });
  if (error) return setMsg($('#authMsg'), error.message, 'err');
  if (!data.session) setMsg($('#authMsg'), 'Compte créé. Confirmez votre adresse via le lien envoyé par email, puis connectez-vous.', 'ok');
});
$('#btnForgot').addEventListener('click', async () => {
  const email = $('#formLogin [name=email]').value.trim();
  if (!email) return setMsg($('#authMsg'), 'Saisissez votre email puis cliquez à nouveau.', 'err');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  setMsg($('#authMsg'), error ? error.message : 'Un lien de réinitialisation vous a été envoyé.', error ? 'err' : 'ok');
});
$('#btnLogout').addEventListener('click', async () => { await sb.auth.signOut(); location.hash = ''; });

async function onSession(session) {
  state.user = session ? session.user : null;
  if (!state.user) { show('auth'); return; }
  const { data: prof } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.profile = prof || { email: state.user.email };
  $('#whoami').textContent = state.profile.nom_complet || state.user.email;
  $('#navAdmin').hidden = !state.profile.is_admin;
  route();
}

// ------------------------------------------------------------------ navigation
$$('[data-go]').forEach(b => b.addEventListener('click', () => (location.hash = '#/' + b.dataset.go)));
window.addEventListener('hashchange', route);
async function route() {
  if (!state.user) return show('auth');
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('dossier/')) return openDossier(h.split('/')[1]);
  if (h === 'nouveau') return newDossier();
  if (h === 'admin' && state.profile.is_admin) return renderAdmin();
  return renderDashboard();
}

// ------------------------------------------------------------------ tableau de bord client
async function renderDashboard() {
  show('dashboard');
  const box = $('#dossiersList'); box.innerHTML = '<p class="muted">Chargement…</p>';
  const { data, error } = await sb.from('exercises')
    .select('id, exercice, date_fin, statut, updated_at, generated_at, rapport, company_id, companies(nom, ninea, owner_id), exercise_files(type, storage_path, nom_original)')
    .order('updated_at', { ascending: false });
  if (error) { box.innerHTML = `<p class="msg err">${esc(dbErr(error))}</p>`; return; }
  const mine = (data || []).filter(d => !state.profile.is_admin || (d.companies && d.companies.owner_id === state.user.id));
  if (!mine.length) {
    box.innerHTML = `<div class="empty"><h2>Aucun dossier pour l'instant</h2><p>Créez un dossier, déposez vos balances N et N-1 et récupérez votre liasse DGID remplie.</p><button class="btn primary" onclick="location.hash='#/nouveau'">+ Nouveau dossier</button></div>`;
    return;
  }
  box.innerHTML = mine.map(d => {
    const liasse = (d.exercise_files || []).find(f => f.type === 'etats_complet_xlsx');
    const r = d.rapport || {};
    const ctl = d.generated_at ? (r.bloquants ? `<span class="badge bad">${r.bloquants} contrôle(s) bloquant(s)</span>` : '<span class="badge ok">Contrôles OK</span>') : '';
    return `<article class="dossier">
      <div><h3>${esc(d.companies?.nom || 'Entreprise')}</h3><div class="meta">NINEA ${esc(d.companies?.ninea || '—')} · Exercice clos le ${esc(dateFr(d.date_fin) || d.exercice)}</div></div>
      <div>${badge(d.statut)} ${ctl}<div class="meta">Mis à jour le ${esc(dateTimeFr(d.updated_at))}</div></div>
      <div class="acts">
        ${liasse ? `<button class="btn gold sm" data-dl="${esc(liasse.storage_path)}" data-name="${esc(liasse.nom_original)}">Télécharger la liasse</button>` : ''}
        <button class="btn ghost sm" onclick="location.hash='#/dossier/${d.id}'">${d.generated_at ? 'Ouvrir' : 'Continuer'}</button>
      </div></article>`;
  }).join('');
  box.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => downloadStored('etats', b.dataset.dl, b.dataset.name)));
}
async function downloadStored(bucket, path, name) {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) return toast('Téléchargement impossible : ' + error.message, true);
  downloadBlob(data, name || path.split('/').pop());
}
$('#btnNew').addEventListener('click', () => (location.hash = '#/nouveau'));

// ------------------------------------------------------------------ dossier : étapes
function setStep(n) {
  const d = state.dossier;
  const maxStep = !d.exercise ? 1 : !(d.balN?.ok && d.balN1?.ok) ? 2 : 4;
  if (n > maxStep) n = maxStep;
  state.step = n;
  $$('.step-panel').forEach(p => (p.hidden = +p.dataset.panel !== n));
  $$('#steps li').forEach(li => {
    const s = +li.dataset.step;
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n || (s === 4 && !!d.exercise?.generated_at));
    li.classList.toggle('locked', s > maxStep);
  });
  if (n === 3) renderInfosForm();
  if (n === 4) renderStoredResult();
}
$$('#steps li').forEach(li => li.addEventListener('click', () => state.dossier && setStep(+li.dataset.step)));
$$('[data-step-go]').forEach(b => b.addEventListener('click', () => setStep(+b.dataset.stepGo)));

async function loadCompanies() {
  const { data } = await sb.from('companies').select('*').eq('owner_id', state.user.id).order('nom');
  state.companies = data || [];
}
function fillCompanySelect(selected) {
  const sel = $('#selCompany');
  sel.innerHTML = state.companies.map(c => `<option value="${c.id}">${esc(c.nom)}${c.ninea ? ' – ' + esc(c.ninea) : ''}</option>`).join('') + '<option value="">+ Nouvelle entreprise</option>';
  sel.value = selected ?? (state.companies[0]?.id || '');
  $('#newCompany').hidden = !!sel.value;
}
$('#selCompany').addEventListener('change', () => ($('#newCompany').hidden = !!$('#selCompany').value));

async function newDossier() {
  show('dossier');
  state.dossier = { exercise: null, company: null, infos: {}, balN: null, balN1: null };
  $('#dossierTitle').textContent = 'Nouveau dossier'; $('#dossierSub').textContent = '';
  await loadCompanies(); fillCompanySelect();
  const y = new Date().getFullYear() - 1;
  $('#exFin').value = `${y}-12-31`; $('#exDebut').value = `${y}-01-01`;
  ['coNom', 'coNinea', 'coRc', 'coForme', 'coAdresse', 'coTel', 'coEmail'].forEach(id => ($('#' + id).value = ''));
  $('#exFin').disabled = false; $('#exDebut').disabled = false; $('#selCompany').disabled = false;
  resetBalanceUI(); $('#resultBox').innerHTML = ''; setMsg($('#msgStep1'), '');
  setStep(1);
}

$('#btnStep1').addEventListener('click', async () => {
  const msg = $('#msgStep1');
  const d = state.dossier;
  if (d.exercise) { // dossier existant : seules les dates peuvent changer
    d.infos.debut = $('#exDebut').value || d.infos.debut; d.infos.fin = $('#exFin').value || d.infos.fin;
    await saveInfos(true); return setStep(2);
  }
  const fin = $('#exFin').value, debut = $('#exDebut').value;
  if (!fin) return setMsg(msg, "Indiquez la date de clôture de l'exercice.", 'err');
  let companyId = $('#selCompany').value, company = state.companies.find(c => c.id === companyId);
  if (!companyId) {
    const nom = $('#coNom').value.trim(), ninea = $('#coNinea').value.trim();
    if (!nom || !ninea) return setMsg(msg, 'Dénomination et NINEA sont obligatoires.', 'err');
    const { data, error } = await sb.from('companies').insert({
      nom, ninea, rc: $('#coRc').value.trim() || null, forme_juridique: $('#coForme').value.trim() || null,
      adresse: $('#coAdresse').value.trim() || null, telephone: $('#coTel').value.trim() || null,
      email_contact: $('#coEmail').value.trim() || null, owner_id: state.user.id,
    }).select().single();
    if (error) return setMsg(msg, dbErr(error), 'err');
    company = data; companyId = data.id; state.companies.push(data);
  }
  const y = +fin.slice(0, 4);
  const infos = {
    denomination: company.nom, ninea: company.ninea, rccm: company.rc, adresse: company.adresse, tel: company.telephone, email: company.email_contact,
    debut: debut || `${y}-01-01`, fin, arrete: fin, finPrec: `${y - 1}${fin.slice(4)}`, dureePrec: 12, paysGreffe: 'SN',
  };
  const { data: ex, error } = await sb.from('exercises').insert({
    company_id: companyId, created_by: state.user.id, exercice: String(y), date_debut: infos.debut, date_fin: fin, statut: 'en_attente', infos,
  }).select().single();
  if (error) {
    if (error.code === '23505') {
      const { data: old } = await sb.from('exercises').select('id').eq('company_id', companyId).eq('exercice', String(y)).maybeSingle();
      if (old) { toast('Ce dossier existe déjà : ouverture.'); location.hash = '#/dossier/' + old.id; return; }
    }
    return setMsg(msg, dbErr(error), 'err');
  }
  history.replaceState(null, '', '#/dossier/' + ex.id);
  d.exercise = ex; d.company = company; d.infos = infos;
  $('#dossierTitle').textContent = company.nom; $('#dossierSub').textContent = `Exercice clos le ${dateFr(fin)}`;
  lockStep1();
  setStep(2);
});
function lockStep1() {
  $('#selCompany').disabled = true; $('#newCompany').hidden = true;
}

async function openDossier(id) {
  show('dossier');
  const { data: ex, error } = await sb.from('exercises').select('*, companies(*), exercise_files(*)').eq('id', id).maybeSingle();
  if (error || !ex) { toast('Dossier introuvable.', true); location.hash = '#/dashboard'; return; }
  state.dossier = { exercise: ex, company: ex.companies, infos: ex.infos || {}, balN: null, balN1: null, files: ex.exercise_files || [] };
  state.companies = [ex.companies]; fillCompanySelect(ex.company_id); lockStep1();
  $('#exFin').value = ex.date_fin || ex.infos?.fin || ''; $('#exDebut').value = ex.date_debut || ex.infos?.debut || '';
  $('#dossierTitle').textContent = ex.companies?.nom || 'Dossier';
  $('#dossierSub').textContent = `Exercice clos le ${dateFr(ex.date_fin)} · ${STATUTS[ex.statut]?.[0] || ex.statut}`;
  setMsg($('#msgStep1'), ''); resetBalanceUI(); $('#resultBox').innerHTML = '';
  // recharge les balances déposées
  for (const [k, type] of [['N', 'balance_n'], ['N1', 'balance_n1']]) {
    const f = state.dossier.files.find(x => x.type === type);
    if (!f) continue;
    $('#file' + k).textContent = f.nom_original + ' (chargement…)';
    const { data, error: e2 } = await sb.storage.from('balances').download(f.storage_path);
    if (e2) { $('#file' + k).textContent = f.nom_original + ' (illisible : ' + e2.message + ')'; continue; }
    await handleBalanceFile(k, new File([data], f.nom_original), false);
  }
  setStep(state.dossier.balN?.ok && state.dossier.balN1?.ok ? (ex.generated_at ? 4 : 3) : 2);
}

// ------------------------------------------------------------------ balances
function resetBalanceUI() {
  for (const k of ['N', 'N1']) { $('#file' + k).textContent = 'Aucun fichier'; $('#rep' + k).innerHTML = ''; }
  $('#btnStep2').disabled = true;
}
$$('[data-input]').forEach(inp => inp.addEventListener('change', () => inp.files[0] && handleBalanceFile(inp.dataset.input, inp.files[0], true).finally(() => (inp.value = ''))));
$$('.drop').forEach(z => {
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleBalanceFile(z.dataset.bal, f, true); });
});

async function readSheet(file) {
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}
async function handleBalanceFile(k, file, upload) {
  const d = state.dossier; const label = k === 'N' ? 'Balance N' : 'Balance N-1';
  $('#file' + k).textContent = file.name;
  let parsed;
  try { parsed = parseBalance(await readSheet(file), label); }
  catch (e) { parsed = { rows: [], errors: [`${label} : fichier illisible (${e.message}).`], warnings: [], totals: {} }; }
  parsed.ok = !parsed.errors.length;
  d[k === 'N' ? 'balN' : 'balN1'] = parsed;
  renderBalanceReport(k, parsed);
  $('#btnStep2').disabled = !(d.balN?.ok && d.balN1?.ok);
  if (upload && d.exercise) {
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.xlsx'])[0].toLowerCase();
    const path = `${d.exercise.company_id}/${d.exercise.id}/balance_${k === 'N' ? 'n' : 'n1'}${ext}`;
    const type = k === 'N' ? 'balance_n' : 'balance_n1';
    const { error } = await sb.storage.from('balances').upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (error) return toast('Dépôt du fichier impossible : ' + error.message, true);
    await sb.from('exercise_files').delete().eq('exercise_id', d.exercise.id).eq('type', type);
    await sb.from('exercise_files').insert({ exercise_id: d.exercise.id, type, storage_path: path, nom_original: file.name, taille_octets: file.size, mime_type: file.type || null });
    if (k === 'N') {
      const t = parsed.totals;
      await sb.from('exercises').update({
        nb_comptes: t.comptes || 0, total_debit: Math.round((t.sad || 0) + (t.md || 0)), total_credit: Math.round((t.sac || 0) + (t.mc || 0)),
        balance_equilibree: parsed.ok, ecart_balance: Math.round(((t.sad || 0) + (t.md || 0)) - ((t.sac || 0) + (t.mc || 0))),
      }).eq('id', d.exercise.id);
    }
    toast(`${label} enregistrée.`);
  }
}
function renderBalanceReport(k, p) {
  const t = p.totals || {};
  const st = p.errors.length ? '<span class="badge bad">À corriger</span>' : p.warnings.length ? '<span class="badge warn">Lue avec remarques</span>' : '<span class="badge ok">Conforme</span>';
  $('#rep' + k).innerHTML = `${st}
    <dl style="margin-top:8px"><dt>Comptes</dt><dd>${fmt(t.comptes || 0)}</dd>
    <dt>Soldes d'ouverture D / C</dt><dd>${fmt(t.sad || 0)} / ${fmt(t.sac || 0)}</dd>
    <dt>Mouvements D / C</dt><dd>${fmt(t.md || 0)} / ${fmt(t.mc || 0)}</dd></dl>
    ${p.errors.length ? `<ul class="issues err">${p.errors.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${p.warnings.length ? `<details><summary class="small">${p.warnings.length} remarque(s)</summary><ul class="issues warn">${p.warnings.slice(0, 40).map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
}
$('#btnStep2').addEventListener('click', () => setStep(3));
$('#btnTemplate').addEventListener('click', () => {
  const ws = window.XLSX.utils.aoa_to_sheet([
    ['Compte', 'Intitulé', 'Solde ant Dbt (réf)', 'Solde ant Cdt (réf)', 'Débit période (réf)', 'Crédit période (réf)'],
    [101000, 'Capital social', null, 1000000, null, null],
    [521100, 'Banque', 1000000, null, 5000000, 3000000],
  ]);
  ws['!cols'] = [{ wch: 10 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Feuil1');
  window.XLSX.writeFile(wb, 'Modele_balance_FINSMART.xlsx');
});

// ------------------------------------------------------------------ informations complémentaires
async function renderInfosForm() {
  const engine = await loadEngine();
  const inf = state.dossier.infos;
  const field = f => {
    const v = inf[f.k] ?? '';
    const lab = `<span class="${f.req ? 'req' : ''}">${esc(f.label)}</span>`;
    if (f.type === 'select') return `<label>${lab}<select data-k="${f.k}"><option value=""></option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.type === 'activity') return `<label>${lab}<input data-k="${f.k}" list="dlActivites" value="${esc(v)}" placeholder="ex. 035001"></label>`;
    const type = f.type === 'date' ? 'date' : (f.type === 'int' || f.type === 'num') ? 'number' : 'text';
    return `<label>${lab}<input type="${type}" data-k="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" ${f.type === 'code' ? 'inputmode="numeric"' : ''}></label>`;
  };
  let html = `<datalist id="dlActivites">${engine.activityCodes.map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</datalist>`;
  INFO_SECTIONS.forEach((s, i) => {
    html += `<fieldset><details ${i === 0 ? 'open' : ''}><summary>${esc(s.title)}<span class="badge neutral" data-count="${s.id}"></span></summary><div class="inner grid2">${s.fields.map(field).join('')}</div></details></fieldset>`;
  });
  for (const t of INFO_TABLES) {
    const rows = inf[t.k] || [];
    html += `<fieldset><details><summary>${esc(t.title)}</summary><div class="inner table-scroll"><table class="mini-table"><thead><tr>${t.cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>`;
    for (let i = 0; i < t.rows; i++) html += `<tr>${t.cols.map(([col, , ty]) => `<td><input data-t="${t.k}" data-i="${i}" data-c="${col}" ${ty === 'num' ? 'type="number"' : ''} value="${esc(rows[i]?.[col] ?? '')}"></td>`).join('')}</tr>`;
    html += '</tbody></table>';
    if (t.k === 'associes') html += `<div class="grid2" style="margin-top:12px">${INFO_EXTRA.map(field).join('')}</div>`;
    html += '</div></details></fieldset>';
  }
  const eff = inf.effectifs || {};
  const effTable = (title, rows, pfx, cols, extraLabel) => `<h3>${title}</h3><table class="mini-table"><thead><tr><th></th>${EFFECTIFS.colLabels.map(l => `<th>Effectif ${esc(l)}</th>`).join('')}${extraLabel}</tr></thead><tbody>${EFFECTIFS.categories.map((cat, i) => `<tr><th>${esc(cat)}</th>${cols.map(c => `<td><input type="number" min="0" data-e="${pfx}${i}${c}" value="${esc(eff[pfx + i + c] ?? '')}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  html += `<fieldset><details><summary>${esc(EFFECTIFS.title)}</summary><div class="inner table-scroll">
    ${effTable("Personnel de l'entité", EFFECTIFS.interneRows, 'i', ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'], EFFECTIFS.colLabels.map(l => `<th>Masse sal. ${esc(l)}</th>`).join(''))}
    ${effTable('Personnel extérieur', EFFECTIFS.externeRows, 'e', ['B', 'C', 'D', 'E', 'F', 'G', 'H'], '<th>Facturation à l\'entité</th>')}
    </div></details></fieldset>`;
  $('#formInfos').innerHTML = html;
  updateCounts();
}
function updateCounts() {
  const inf = state.dossier.infos;
  INFO_SECTIONS.forEach(s => {
    const req = s.fields.filter(f => f.req), miss = req.filter(f => !String(inf[f.k] ?? '').trim()).length;
    const el = document.querySelector(`[data-count="${s.id}"]`);
    if (el) { el.textContent = req.length ? (miss ? `${miss} obligatoire(s) manquant(s)` : 'complet') : ''; el.className = 'badge ' + (req.length ? (miss ? 'warn' : 'ok') : 'neutral'); }
  });
}
$('#formInfos').addEventListener('input', e => {
  const el = e.target, inf = state.dossier.infos;
  if (el.dataset.k) inf[el.dataset.k] = el.value;
  else if (el.dataset.t) { const arr = (inf[el.dataset.t] ||= []); const i = +el.dataset.i; arr[i] = { ...(arr[i] || {}), [el.dataset.c]: el.value }; }
  else if (el.dataset.e) { (inf.effectifs ||= {})[el.dataset.e] = el.value; }
  updateCounts(); scheduleSave();
});
let saveTimer = null;
function scheduleSave() { $('#saveState').textContent = 'Modifications non enregistrées…'; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveInfos(), 900); }
async function saveInfos(silent) {
  clearTimeout(saveTimer);
  const d = state.dossier; if (!d?.exercise) return;
  // tableaux : on retire les lignes vides
  for (const t of INFO_TABLES) if (Array.isArray(d.infos[t.k])) d.infos[t.k] = Array.from(d.infos[t.k], r => r || {});
  const patch = { infos: d.infos };
  if (d.infos.fin) patch.date_fin = d.infos.fin; if (d.infos.debut) patch.date_debut = d.infos.debut;
  const { error } = await sb.from('exercises').update(patch).eq('id', d.exercise.id);
  $('#saveState').textContent = error ? 'Échec de l\'enregistrement' : 'Enregistré à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (error && !silent) toast(error.message, true);
}
$('#btnStep3').addEventListener('click', async () => { await saveInfos(true); setStep(4); });

// ------------------------------------------------------------------ génération
let worker = null;
function compute(payload) {
  worker ||= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.ok ? resolve(data) : reject(new Error(data.error)));
    worker.onerror = e => reject(new Error(e.message || 'Erreur du moteur de calcul'));
    worker.postMessage(payload);
  });
}
$('#btnGenerate').addEventListener('click', generate);
async function generate() {
  const d = state.dossier;
  if (!(d.balN?.ok && d.balN1?.ok)) return toast('Déposez deux balances conformes (étape 2).', true);
  const btn = $('#btnGenerate'); btn.disabled = true;
  $('#progress').hidden = false; $('#progressTxt').textContent = 'Calcul des états et des contrôles…'; $('#resultBox').innerHTML = '';
  try {
    await saveInfos(true);
    const { values, results } = await compute({ engineUrl: ENGINE_URL, balN: d.balN.rows, balN1: d.balN1.rows, infos: d.infos });
    $('#progressTxt').textContent = 'Remplissage du modèle DGID…';
    const modele = await fetch(MODELE_URL).then(r => r.arrayBuffer());
    const { bytes, skippedErrors } = await fillModele(modele, values, { JSZip: window.JSZip, DOMParser, XMLSerializer });
    results.erreursCellules = skippedErrors;
    const name = nomFichier(d.infos);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    d.lastBlob = { blob, name };
    $('#progressTxt').textContent = 'Enregistrement…';
    const path = `${d.exercise.company_id}/${d.exercise.id}/${name}`;
    const up = await sb.storage.from('etats').upload(path, blob, { upsert: true, contentType: blob.type });
    if (up.error) toast('Liasse générée, mais non archivée : ' + up.error.message, true);
    else {
      await sb.from('exercise_files').delete().eq('exercise_id', d.exercise.id).eq('type', 'etats_complet_xlsx');
      await sb.from('exercise_files').insert({ exercise_id: d.exercise.id, type: 'etats_complet_xlsx', storage_path: path, nom_original: name, taille_octets: blob.size, mime_type: blob.type });
    }
    const rapport = { ...results, anomalies: results.anomalies.slice(0, 300), nbAnomalies: results.anomalies.length, fichier: name };
    const s = results.sig;
    const { data: exUpd } = await sb.from('exercises').update({
      statut: 'disponible', generated_at: new Date().toISOString(), rapport,
      sig_chiffre_affaires: s.ca, sig_valeur_ajoutee: s.va, sig_excedent_brut: s.ebe, sig_resultat_exploitation: s.re, sig_resultat_net: s.rn,
      avertissements: results.controls.filter(c => !c.section && String(c.statut).startsWith('⚠')).map(c => `${c.code} ${c.libelle}`),
    }).eq('id', d.exercise.id).select().single();
    if (exUpd) d.exercise = exUpd; else Object.assign(d.exercise, { rapport, generated_at: new Date().toISOString(), statut: 'disponible' });
    renderResult(rapport, true);
    $$('#steps li')[3].classList.add('done');
  } catch (e) {
    console.error(e);
    $('#resultBox').innerHTML = `<p class="msg err">La génération a échoué : ${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false; $('#progress').hidden = true;
  }
}
function renderStoredResult() {
  const ex = state.dossier.exercise;
  if (ex?.rapport && ex.generated_at && !$('#resultBox').innerHTML) renderResult(ex.rapport, false);
}
function renderResult(r, fresh) {
  const d = state.dossier;
  const cls = r.bloquants ? 'bad' : (r.vigilance || r.infosManquantes) ? 'warn' : 'ok';
  const title = r.bloquants ? `${r.bloquants} contrôle(s) bloquant(s) à corriger avant dépôt` : r.infosManquantes ? `${r.infosManquantes} information(s) obligatoire(s) à compléter` : r.vigilance ? 'Liasse cohérente – points de vigilance à examiner' : 'Liasse prête pour le dépôt Sen-etafi';
  const pct = v => (typeof v === 'number' ? (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '');
  const val = (l, v) => (/marge/i.test(l) ? pct(v) : fmt(v));
  const kpis = (r.chiffresCles || []).map(k => `<div class="kpi"><div class="l">${esc(k.libelle)}</div><div class="v">${esc(val(k.libelle, k.n))}</div><div class="d">N-1 : ${esc(val(k.libelle, k.n1))}${typeof k.variation === 'number' && !/marge/i.test(k.libelle) ? ' · ' + pct(k.variation) : ''}</div></div>`).join('');
  const ctl = (r.controls || []).map(c => c.section
    ? `<tr class="section"><td colspan="5">${esc(c.code)} · ${esc(c.libelle)}</td></tr>`
    : `<tr><td>${esc(c.code)}</td><td>${esc(c.libelle)} ${c.type === 'B' ? '<span class="badge neutral">bloquant</span>' : ''}</td><td class="num">${esc(typeof c.n === 'number' ? fmt(c.n) : c.n ?? '')}</td><td class="num">${esc(typeof c.n1 === 'number' ? fmt(c.n1) : c.n1 ?? '')}</td><td>${String(c.statut).startsWith('✔') ? '<span class="badge ok">OK</span>' : `<span class="badge ${c.type === 'B' ? 'bad' : 'warn'}">À vérifier</span>`}</td></tr>`).join('');
  const an = r.anomalies || [];
  $('#resultBox').innerHTML = `
    <div class="status-banner ${cls}"><div><strong>${esc(title)}</strong><div class="small">Généré le ${esc(dateTimeFr(d.exercise?.generated_at || Date.now()))} · ${esc(r.fichier || '')}</div></div>
      <button class="btn primary" id="btnDlLiasse">Télécharger la liasse DGID (.xlsx)</button></div>
    <h3>Chiffres clés (FCFA)</h3><div class="kpis">${kpis}</div>
    <h3>Contrôles de cohérence</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>N°</th><th>Contrôle</th><th>N</th><th>N-1</th><th>Statut</th></tr></thead><tbody>${ctl}</tbody></table></div>
    ${an.length ? `<details style="margin-top:14px"><summary><span>${r.nbAnomalies || an.length} compte(s) signalé(s) dans les balances</span></summary>
      <div class="table-wrap"><table class="table"><thead><tr><th>Balance</th><th>Compte</th><th>Intitulé</th><th>Solde</th><th>Observation</th></tr></thead><tbody>
      ${an.map(a => `<tr><td>${esc(a.balance)}</td><td>${esc(a.compte)}</td><td>${esc(a.intitule)}</td><td class="num">${fmt(a.solde)}</td><td>${esc(a.messages.join(' ; '))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <p class="small muted" style="margin-top:14px">Le fichier reprend le modèle officiel <em>modele_etats_financiers_DGID (Nouveau)</em> : onglets inchangés, valeurs uniquement (aucune formule). Rappel : visa de l'expert-comptable ou du commissaire aux comptes requis pour le dépôt sur Sen-etafi.</p>`;
  $('#btnDlLiasse').addEventListener('click', async () => {
    if (d.lastBlob) return downloadBlob(d.lastBlob.blob, d.lastBlob.name);
    const f = (await sb.from('exercise_files').select('*').eq('exercise_id', d.exercise.id).eq('type', 'etats_complet_xlsx').maybeSingle()).data;
    if (f) downloadStored('etats', f.storage_path, f.nom_original); else toast('Fichier introuvable : relancez la génération.', true);
  });
  if (fresh) toast('Liasse générée.');
}

// ------------------------------------------------------------------ administration
let adminRows = [];
async function renderAdmin() {
  show('admin');
  const tb = $('#adminTable tbody'); tb.innerHTML = '<tr><td colspan="7">Chargement…</td></tr>';
  const { data, error } = await sb.from('exercises')
    .select('id, exercice, date_fin, statut, updated_at, generated_at, rapport, companies(nom, ninea, telephone, email_contact), profiles!exercises_created_by_fkey(nom_complet, email, telephone), exercise_files(type, storage_path, nom_original)')
    .order('updated_at', { ascending: false });
  if (error) { tb.innerHTML = `<tr><td colspan="7" class="msg err">${esc(error.message)}</td></tr>`; return; }
  adminRows = data || [];
  const clients = new Set(adminRows.map(r => r.profiles?.email)).size;
  const gen = adminRows.filter(r => r.generated_at).length, prets = adminRows.filter(r => r.rapport && r.rapport.pret).length;
  $('#adminKpis').innerHTML = [['Clients', clients], ['Dossiers', adminRows.length], ['Liasses générées', gen], ['Prêtes au dépôt', prets]]
    .map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  drawAdmin();
}
function drawAdmin() {
  const q = $('#adminSearch').value.trim().toLowerCase();
  const rows = adminRows.filter(r => !q || [r.companies?.nom, r.companies?.ninea, r.profiles?.nom_complet, r.profiles?.email].join(' ').toLowerCase().includes(q));
  $('#adminTable tbody').innerHTML = rows.map(r => {
    const files = r.exercise_files || [];
    const fb = (type, label, bucket) => { const f = files.find(x => x.type === type); return f ? `<button class="btn ghost sm" data-b="${bucket}" data-p="${esc(f.storage_path)}" data-n="${esc(f.nom_original)}">${label}</button>` : ''; };
    const rp = r.rapport || {};
    return `<tr><td><b>${esc(r.companies?.nom)}</b><div class="small muted">NINEA ${esc(r.companies?.ninea || '—')}</div></td>
      <td>${esc(dateFr(r.date_fin) || r.exercice)}</td>
      <td>${esc(r.profiles?.nom_complet || '')}<div class="small muted">${esc(r.profiles?.email || '')} ${esc(r.profiles?.telephone || '')}</div></td>
      <td><select data-statut="${r.id}">${Object.entries(STATUTS).map(([k, [l]]) => `<option value="${k}" ${k === r.statut ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${r.generated_at ? (rp.bloquants ? `<span class="badge bad">${rp.bloquants} bloquant(s)</span>` : '<span class="badge ok">OK</span>') + (rp.vigilance ? ` <span class="badge warn">${rp.vigilance} vigilance</span>` : '') : '<span class="muted small">non générée</span>'}</td>
      <td class="small">${esc(dateTimeFr(r.updated_at))}</td>
      <td style="white-space:nowrap">${fb('balance_n', 'Bal. N', 'balances')} ${fb('balance_n1', 'Bal. N-1', 'balances')} ${fb('etats_complet_xlsx', 'Liasse', 'etats')}</td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">Aucun dossier.</td></tr>';
}
$('#adminSearch').addEventListener('input', drawAdmin);
$('#adminTable').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) downloadStored(b.dataset.b, b.dataset.p, b.dataset.n); });
$('#adminTable').addEventListener('change', async e => {
  const s = e.target.closest('[data-statut]'); if (!s) return;
  const { error } = await sb.from('exercises').update({ statut: s.value }).eq('id', s.dataset.statut);
  toast(error ? error.message : 'Statut mis à jour.', !!error);
});

// ------------------------------------------------------------------ démarrage
$('#footContact').textContent = `${BRAND.contact} · ${BRAND.tel}`;
sb.auth.onAuthStateChange((_ev, session) => {
  if ((session?.user?.id || null) !== (state.user?.id || null)) onSession(session);
});
sb.auth.getSession().then(({ data }) => onSession(data.session));
