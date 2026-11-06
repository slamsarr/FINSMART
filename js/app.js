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
  setMsg($('#authMsg'), 'Connexion en cours…');
  const { data, error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
  if (error) {
    console.error('Erreur Supabase Login:', error);
    if (/confirm/i.test(error.message)) {
      setMsg($('#authMsg'), 'Adresse email non confirmée : cliquez sur le lien reçu par email, ou désactivez la confirmation dans Supabase.', 'err');
    } else {
      setMsg($('#authMsg'), `${error.message === 'Invalid login credentials' ? 'Identifiants invalides ou compte non confirmé.' : error.message}`, 'err');
    }
  } else if (data?.session) {
    setMsg($('#authMsg'), 'Connecté ! Redirection…', 'ok');
    onSession(data.session);
  }
});
$('#formSignup').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  setMsg($('#authMsg'), 'Création du compte…');
  const { data, error } = await sb.auth.signUp({
    email: f.get('email').trim(), password: f.get('password'),
    options: {
      data: { nom_complet: f.get('nom_complet').trim(), telephone: f.get('telephone').trim() },
      emailRedirectTo: location.origin + location.pathname
    },
  });
  if (error) {
    console.error('Erreur Supabase Signup:', error);
    return setMsg($('#authMsg'), error.message, 'err');
  }
  if (data?.session) {
    setMsg($('#authMsg'), 'Compte créé avec succès ! Connexion…', 'ok');
    onSession(data.session);
  } else {
    setMsg($('#authMsg'), 'Compte créé ! Veuillez confirmer votre adresse email via le lien reçu, puis connectez-vous (ou désactivez "Confirm email" dans Supabase pour connexion directe).', 'ok');
  }
});
$('#btnForgot').addEventListener('click', async () => {
  const email = $('#formLogin [name=email]').value.trim();
  if (!email) return setMsg($('#authMsg'), 'Saisissez votre email puis cliquez à nouveau.', 'err');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  setMsg($('#authMsg'), error ? error.message : 'Un lien de réinitialisation vous a été envoyé.', error ? 'err' : 'ok');
});
$('#btnLogout').addEventListener('click', async () => { await sb.auth.signOut(); location.hash = ''; });

async function checkPaymentReturnParams() {
  const url = new URL(window.location.href);
  const paymentStatus = url.searchParams.get('payment');
  const ref = url.searchParams.get('ref');

  if (paymentStatus === 'success') {
    url.searchParams.delete('payment');
    url.searchParams.delete('ref');
    url.searchParams.delete('mock');
    url.searchParams.delete('credits');
    window.history.replaceState({}, document.title, url.pathname + url.hash);

    await refreshProfile();
    toast(`Paiement PayTech validé avec succès (${ref || ''}) ! Vos crédits sont disponibles.`);
    if (location.hash === '#/pricing') renderPricing();
  } else if (paymentStatus === 'cancel') {
    url.searchParams.delete('payment');
    url.searchParams.delete('ref');
    window.history.replaceState({}, document.title, url.pathname + url.hash);

    toast('Paiement PayTech annulé. Aucun débit n\'a été effectué.', true);
  }
}

async function onSession(session) {
  state.user = session ? session.user : null;
  if (!state.user) { show('auth'); return; }
  await refreshProfile();
  await checkPaymentReturnParams();
  const isAdmin = !!state.profile?.is_admin;
  $('#whoami').innerHTML = `${esc(state.profile.nom_complet || state.user.email)}${isAdmin ? ' <span class="badge ok" style="font-size:10px; padding:2px 7px; font-weight:800; background:#065f46; color:#fff; border-radius:12px; margin-left:6px; vertical-align:middle;">👑 ADMIN</span>' : ''}`;
  $('#navAdmin').hidden = !isAdmin;
  route();
}


async function refreshProfile() {
  if (!state.user) return;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.profile = prof || { email: state.user.email, credits_balance: 0 };
  updateCreditsDisplay();
}

function updateCreditsDisplay() {
  const c = state.profile?.credits_balance || 0;
  const txt = `${c} crédit${c > 1 ? 's' : ''}`;
  const badgeEl = $('#userCreditsBadge');
  if (badgeEl) badgeEl.textContent = txt;
  const balEl = $('#pricingUserBalance');
  if (balEl) balEl.textContent = txt;
}
$('#userCreditsBadge')?.addEventListener('click', () => (location.hash = '#/pricing'));

// ------------------------------------------------------------------ navigation
$$('[data-go]').forEach(b => b.addEventListener('click', () => (location.hash = '#/' + b.dataset.go)));
window.addEventListener('hashchange', route);
async function route() {
  if (!state.user) return show('auth');
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('dossier/')) return openDossier(h.split('/')[1]);
  if (h === 'nouveau') return newDossier();
  if (h === 'pricing') return renderPricing();
  if (h === 'admin' && state.profile.is_admin) return renderAdmin();
  return renderDashboard();
}

// ------------------------------------------------------------------ tableau de bord client
async function renderDashboard() {
  show('dashboard');
  const box = $('#dossiersList'); box.innerHTML = '<p class="muted">Chargement…</p>';
  const { data, error } = await sb.from('exercises')
    .select('id, exercice, date_fin, statut, updated_at, generated_at, rapport, is_full_version, generation_type, company_id, companies(nom, ninea, owner_id), exercise_files(type, storage_path, nom_original)')
    .order('updated_at', { ascending: false });
  if (error) { box.innerHTML = `<p class="msg err">${esc(dbErr(error))}</p>`; return; }
  const mine = (data || []).filter(d => !state.profile.is_admin || (d.companies && d.companies.owner_id === state.user.id));
  if (!mine.length) {
    box.innerHTML = `<div class="empty"><h2>Aucun dossier pour l'instant</h2><p>Créez un dossier, déposez vos balances N et N-1 et récupérez votre liasse DGID remplie.</p><button class="btn primary" onclick="location.hash='#/nouveau'">+ Nouveau dossier</button></div>`;
    return;
  }
  box.innerHTML = mine.map(d => {
    const liasse = (d.exercise_files || []).find(f => f.type === 'etats_complet_xlsx' || f.type === 'etats_gratuit_xlsx');
    const r = d.rapport || {};
    const ctl = d.generated_at ? (r.bloquants ? `<span class="badge bad">${r.bloquants} contrôle(s) bloquant(s)</span>` : '<span class="badge ok">Contrôles OK</span>') : '';
    const typeBadge = d.is_full_version 
      ? '<span class="badge ok">Complète</span>' 
      : (d.generation_type === 'free' ? '<span class="badge warn">Évaluation</span>' : '');
    return `<article class="dossier">
      <div><h3>${esc(d.companies?.nom || 'Entreprise')}</h3><div class="meta">NINEA ${esc(d.companies?.ninea || '—')} · Exercice clos le ${esc(dateFr(d.date_fin) || d.exercice)}</div></div>
      <div>${badge(d.statut)} ${ctl} ${typeBadge}<div class="meta">Mis à jour le ${esc(dateTimeFr(d.updated_at))}</div></div>
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
  if (n === 4) { checkStep4Monetization(); renderStoredResult(); }
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
// ------------------------------------------------------------------ modales & monétisation
function closeModals() {
  $('#modalPreGen').hidden = true;
  $('#modalPayment').hidden = true;
}
$$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
$('.modal-overlay')?.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) closeModals(); });

let currentMonetizationStatus = null;
async function checkStep4Monetization() {
  const d = state.dossier;
  if (!d?.exercise) return;
  const box = $('#dossierMonetizationNotice');
  if (!box) return;
  box.innerHTML = '<p class="small muted">Vérification de vos droits de génération…</p>';
  try {
    const { data, error } = await sb.rpc('get_exercise_monetization_status', { p_exercise_id: d.exercise.id });
    if (!error && data?.ok) {
      currentMonetizationStatus = data;
    } else {
      // Fallback si la fonction RPC n'est pas encore exécutée
      const isFull = !!d.exercise.is_full_version;
      const freeUsed = !!d.company?.free_generation_used;
      currentMonetizationStatus = {
        free_available: !freeUsed,
        is_full_version: isFull,
        user_credits: state.profile?.credits_balance || 0,
        generation_type: d.exercise.generation_type || 'none',
      };
    }
  } catch (e) {
    currentMonetizationStatus = {
      free_available: !d.company?.free_generation_used,
      is_full_version: !!d.exercise.is_full_version,
      user_credits: state.profile?.credits_balance || 0,
      generation_type: d.exercise.generation_type || 'none',
    };
  }

  const s = currentMonetizationStatus;
  if (state.profile?.is_admin) {
    box.innerHTML = `<div class="status-banner ok" style="border-left: 4px solid #10b981; background:#ecfdf5;">
      <div><strong style="color:#065f46;">👑 Privilège Super-Administrateur Actif</strong><div class="small">En tant qu'administrateur, vous disposez d'un accès illimité : génération complète officielle (55 onglets et 36 notes) autorisée sans restriction.</div></div>
    </div>`;
  } else if (s.is_full_version) {
    box.innerHTML = `<div class="status-banner ok">
      <div><strong>Liasse complète officielle débloquée</strong><div class="small">Ce dossier dispose d'un accès illimité aux 55 onglets SYSCOHADA (aucun crédit supplémentaire requis).</div></div>
    </div>`;
  } else if (s.free_available) {
    box.innerHTML = `<div class="status-banner ok">
      <div><strong>1 Génération gratuite offerte disponible</strong><div class="small">Cette entreprise peut tester la liasse gratuitement (Bilan, Compte de résultat et TFT). Vous pouvez aussi utiliser un crédit pour obtenir directement la liasse complète avec les 36 notes.</div></div>
    </div>`;
  } else if (s.user_credits >= 1) {
    box.innerHTML = `<div class="status-banner warn">
      <div><strong>Génération gratuite déjà utilisée.</strong><div class="small">Vous disposez de <strong>${s.user_credits} crédit(s)</strong>. La génération complète consommera 1 crédit.</div></div>
    </div>`;
  } else {
    box.innerHTML = `<div class="status-banner warn">
      <div><strong>Génération gratuite déjà utilisée.</strong><div class="small">Vous avez utilisé votre génération gratuite. Vous pouvez débloquer votre prochaine génération complète pour 20 000 FCFA ou choisir un pack de crédits pour bénéficier d'un tarif avantageux.</div></div>
      <button class="btn gold sm" type="button" onclick="location.hash='#/pricing'">Acheter des crédits</button>
    </div>`;
  }
}

$('#btnGenerate').addEventListener('click', promptGeneration);

async function promptGeneration() {
  const d = state.dossier;
  if (!(d.balN?.ok && d.balN1?.ok)) return toast('Déposez deux balances conformes (étape 2).', true);
  await checkStep4Monetization();
  const s = currentMonetizationStatus;

  // L'administrateur ou un dossier déjà débloqué génère directement la liasse complète
  if (state.profile?.is_admin || s.is_full_version) {
    return executeGeneration('paid');
  }

  const modal = $('#modalPreGen');
  const body = $('#preGenBody');

  if (s.free_available) {
    body.innerHTML = `
      <p class="muted" style="margin-top:0;">Choisissez le type de génération souhaité pour <b>${esc(d.company?.nom || 'cette entreprise')}</b> :</p>
      <div class="gen-choice-card selected" data-mode="free">
        <h4><span>Génération Gratuite (Évaluation)</span><span class="badge ok">0 FCFA</span></h4>
        <p>Inclus : Bilan officiel, Compte de résultat, Flux de trésorerie (TFT), chiffres clés et contrôles de cohérence. <i>(Les 36 notes et fiches complémentaires sont masquées).</i></p>
      </div>
      <div class="gen-choice-card" data-mode="paid">
        <h4><span>Liasse Complète Officielle Sen-etafi</span><span class="badge gold">1 Crédit ou 20 000 FCFA</span></h4>
        <p>Inclus : Les 55 onglets complets, toutes les 36 notes annexes remplies, conforme au dépôt fiscal officiel DGID. Solde disponible : <b>${s.user_credits} crédit(s)</b>.</p>
      </div>
    `;
    setupGenChoiceCards();
    modal.hidden = false;
  } else if (s.user_credits >= 1) {
    body.innerHTML = `
      <p>La génération gratuite a déjà été utilisée pour cette entreprise.</p>
      <div class="status-banner ok" style="margin:12px 0;">
        <div><strong>Débloquer la liasse complète officielle</strong><div class="small">1 crédit sera débité de votre compte. Votre solde après génération sera de <b>${s.user_credits - 1} crédit(s)</b>.</div></div>
      </div>
      <input type="hidden" id="selectedGenMode" value="paid">
    `;
    modal.hidden = false;
  } else {
    // 0 crédit et gratuit déjà utilisé
    body.innerHTML = `
      <div class="status-banner warn" style="margin-top:0;">
        <div><strong>Génération gratuite épuisée</strong></div>
      </div>
      <p style="margin:14px 0 16px;">Vous avez utilisé votre génération gratuite. Vous pouvez débloquer votre prochaine génération complète pour 20 000 FCFA ou choisir un pack de crédits pour bénéficier d'un tarif avantageux.</p>
      <button class="btn gold lg" style="width:100%; justify-content:center;" id="btnGoPricingFromModal">Acheter des crédits</button>
    `;
    modal.hidden = false;
    $('#btnGoPricingFromModal')?.addEventListener('click', () => { closeModals(); location.hash = '#/pricing'; });
  }
}


function setupGenChoiceCards() {
  const cards = $$('.gen-choice-card');
  cards.forEach(c => c.addEventListener('click', () => {
    cards.forEach(x => x.classList.toggle('selected', x === c));
  }));
}

$('#btnConfirmGen').addEventListener('click', async () => {
  const selCard = $('.gen-choice-card.selected');
  const hiddenMode = $('#selectedGenMode');
  const mode = selCard ? selCard.dataset.mode : (hiddenMode ? hiddenMode.value : 'free');
  
  const s = currentMonetizationStatus;
  if (mode === 'paid' && s.user_credits < 1) {
    closeModals();
    location.hash = '#/pricing';
    return toast('Solde insuffisant. Veuillez recharger votre compte.', true);
  }
  
  closeModals();
  executeGeneration(mode);
});

async function executeGeneration(mode) {
  const d = state.dossier;
  const btn = $('#btnGenerate'); btn.disabled = true;
  $('#progress').hidden = false; $('#progressTxt').textContent = 'Vérification et réservation du crédit…'; $('#resultBox').innerHTML = '';

  try {
    // 1. Débit ou enregistrement sécurisé côté serveur
    let charged = false;
    try {
      const { data: res, error: rpcErr } = await sb.rpc('consume_generation_credit', {
        p_exercise_id: d.exercise.id,
        p_requested_mode: mode
      });
      if (rpcErr) throw new Error(rpcErr.message);
      if (!res.ok) throw new Error(res.error || 'Impossible de consommer le crédit.');
      charged = true;
    } catch (err) {
      // Si la fonction RPC n'est pas encore déployée dans Supabase, secours direct
      console.warn('RPC consume_generation_credit non disponible, repli direct:', err.message);
      if (mode === 'paid' && (state.profile?.credits_balance || 0) < 1) {
        throw new Error('Solde de crédits insuffisant.');
      }
    }

    // 2. Moteur comptable existant (100% INTACT)
    await saveInfos(true);
    $('#progressTxt').textContent = 'Calcul des états et des contrôles…';
    const { values, results } = await compute({ engineUrl: ENGINE_URL, balN: d.balN.rows, balN1: d.balN1.rows, infos: d.infos });
    
    // 3. Remplissage du modèle Excel
    $('#progressTxt').textContent = 'Remplissage du modèle DGID…';
    const isLimited = (mode === 'free');
    const modele = await fetch(MODELE_URL).then(r => r.arrayBuffer());
    const { bytes, skippedErrors } = await fillModele(modele, values, { JSZip: window.JSZip, DOMParser, XMLSerializer }, { isLimited });
    results.erreursCellules = skippedErrors;
    
    const name = nomFichier(d.infos);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    d.lastBlob = { blob, name };
    
    // 4. Archivage dans Supabase Storage
    $('#progressTxt').textContent = 'Enregistrement…';
    const path = `${d.exercise.company_id}/${d.exercise.id}/${name}`;
    const up = await sb.storage.from('etats').upload(path, blob, { upsert: true, contentType: blob.type });
    if (up.error) toast('Liasse générée, mais non archivée : ' + up.error.message, true);
    else {
      await sb.from('exercise_files').delete().eq('exercise_id', d.exercise.id).eq('type', isLimited ? 'etats_gratuit_xlsx' : 'etats_complet_xlsx');
      await sb.from('exercise_files').insert({
        exercise_id: d.exercise.id,
        type: isLimited ? 'etats_gratuit_xlsx' : 'etats_complet_xlsx',
        storage_path: path,
        nom_original: name,
        taille_octets: blob.size,
        mime_type: blob.type
      });
    }

    // 5. Mise à jour de l'exercice
    const rapport = { ...results, anomalies: results.anomalies.slice(0, 300), nbAnomalies: results.anomalies.length, fichier: name, isLimited };
    const s = results.sig;
    const { data: exUpd } = await sb.from('exercises').update({
      statut: 'disponible',
      generated_at: new Date().toISOString(),
      rapport,
      is_full_version: !isLimited || d.exercise.is_full_version,
      generation_type: isLimited ? 'free' : 'paid',
      sig_chiffre_affaires: s.ca, sig_valeur_ajoutee: s.va, sig_excedent_brut: s.ebe, sig_resultat_exploitation: s.re, sig_resultat_net: s.rn,
      avertissements: results.controls.filter(c => !c.section && String(c.statut).startsWith('⚠')).map(c => `${c.code} ${c.libelle}`),
    }).eq('id', d.exercise.id).select().single();

    if (exUpd) d.exercise = exUpd;
    else Object.assign(d.exercise, { rapport, generated_at: new Date().toISOString(), statut: 'disponible', is_full_version: !isLimited, generation_type: isLimited ? 'free' : 'paid' });

    // 6. Mise à jour du profil et réaffichage
    await refreshProfile();
    await checkStep4Monetization();
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

const CONTROLS_DIAGNOSTIC = {
  A1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Le total des débits d\'ouverture n\'est pas égal au total des crédits d\'ouverture (déséquilibre au 01/01).',
    solution: 'Vérifiez le journal des à-nouveaux dans votre logiciel comptable pour équilibrer les débits et crédits d\'ouverture, puis réimportez la balance N à l\'étape 2.',
    actionLabel: 'Corriger la Balance N (Étape 2)',
    hasAnomalies: false,
  },
  A2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Le total des mouvements débits de la période est différent du total des mouvements crédits.',
    solution: 'Votre balance générale comporte des écritures déséquilibrées. Corrigez-les dans votre logiciel et rechargez la balance à l\'étape 2.',
    actionLabel: 'Recharger la Balance N (Étape 2)',
    hasAnomalies: false,
  },
  A3: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'La somme algébrique des soldes nets de clôture n\'est pas nulle (Débit clôture ≠ Crédit clôture).',
    solution: 'La balance de clôture est déséquilibrée. Vérifiez vos cumuls et réimportez la balance équilibrée à l\'étape 2.',
    actionLabel: 'Corriger la Balance N (Étape 2)',
    hasAnomalies: false,
  },
  B1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Présence de comptes obsolètes de l\'ancien plan comptable ou inexistants dans le SYSCOHADA Révisé (ex. racines 20, 74, 76, classe 9).',
    solution: 'Reclassez ces comptes vers les racines SYSCOHADA Révisé autorisées (ex. 74/76 reclassés en 70/75/77). Consultez le tableau des comptes signalés ci-dessous pour les identifier.',
    actionLabel: 'Voir les comptes & corriger à l\'Étape 2',
    hasAnomalies: true,
  },
  B2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Des comptes à 6 chiffres ne figurent pas dans la table de correspondance officielle DGID.',
    solution: 'Vérifiez les numéros de comptes signalés dans la liste ci-dessous et alignez-les sur le plan de comptes officiel.',
    actionLabel: 'Voir les comptes non classés',
    hasAnomalies: true,
  },
  B4: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Des comptes de gestion (charges classe 6, produits classe 7 ou 8) comportent un solde d\'ouverture au 01/01.',
    solution: 'En normes SYSCOHADA, les comptes de gestion doivent être soldés à l\'ouverture. Dans votre balance N, mettez à zéro les soldes d\'ouverture des classes 6, 7 et 8.',
    actionLabel: 'Modifier les soldes d\'ouverture (Étape 2)',
    hasAnomalies: true,
  },
  C1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Le résultat net dégagé par la balance (Produits - Charges) est différent du résultat net calculé au Compte de Résultat.',
    solution: 'Vérifiez la concordance de vos comptes de charges et produits ainsi que les écritures d\'inventaire.',
    actionLabel: 'Vérifier la balance (Étape 2)',
    hasAnomalies: false,
  },
  C2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Le total de l\'Actif du Bilan n\'est pas égal au total du Passif (Bilan déséquilibré).',
    solution: 'Vérifiez que le résultat net de l\'exercice est correctement rattaché aux capitaux propres (compte 13) au passif et que les amortissements/dépréciations sont bien au crédit.',
    actionLabel: 'Vérifier les comptes de bilan (Étape 2)',
    hasAnomalies: false,
  },
  C3: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'La variation de trésorerie issue du Tableau des Flux (TFT) ne correspond pas à la trésorerie nette au Bilan.',
    solution: 'Vérifiez les variations des comptes de disponibilités (52 Banque, 57 Caisse) et de concours bancaires (56 Découverts).',
    actionLabel: 'Vérifier la trésorerie (Étape 2)',
    hasAnomalies: false,
  },
  C4: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Incohérence dans les cumuls des soldes intermédiaires de gestion du Compte de Résultat.',
    solution: 'Vérifiez les totaux de la cascade de résultat (Marge, Valeur Ajoutée, EBE, Résultat d\'Exploitation).',
    actionLabel: 'Vérifier le compte de résultat',
    hasAnomalies: false,
  },
  D1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'L\'ouverture N des Capitaux Propres (classe 1) ne concorde pas avec la clôture N-1 majorée du résultat N-1.',
    solution: 'Vérifiez que l\'affectation du résultat N-1 a bien été enregistrée et que la balance N-1 chargée correspond bien à l\'exercice précédent arrêté.',
    actionLabel: 'Vérifier les capitaux propres (Étape 2)',
    hasAnomalies: false,
  },
  D2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'L\'ouverture N des Immobilisations (classe 2) ne concorde pas avec la clôture N-1.',
    solution: 'Les valeurs brutes d\'immobilisations au 01/01/N doivent être strictement identiques à celles au 31/12/N-1.',
    actionLabel: 'Vérifier la classe 2 (Étape 2)',
    hasAnomalies: false,
  },
  D3: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'L\'ouverture N des Stocks (classe 3) ne concorde pas avec la clôture N-1.',
    solution: 'Le stock initial au 01/01/N doit être rigoureusement identique au stock final au 31/12/N-1.',
    actionLabel: 'Vérifier les stocks (Étape 2)',
    hasAnomalies: false,
  },
  D4: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'L\'ouverture N des Créances et Dettes circulantes (classe 4) ne concorde pas avec la clôture N-1.',
    solution: 'Vérifiez les reports des comptes de tiers (clients, fournisseurs, personnel, organismes sociaux, État).',
    actionLabel: 'Vérifier la classe 4 (Étape 2)',
    hasAnomalies: false,
  },
  D5: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'L\'ouverture N des comptes de Trésorerie (classe 5) ne concorde pas avec la clôture N-1.',
    solution: 'Les soldes d\'ouverture de banque et caisse au 01/01/N doivent être exactement égaux aux soldes de clôture N-1.',
    actionLabel: 'Vérifier la classe 5 (Étape 2)',
    hasAnomalies: false,
  },
  E7: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Les amortissements cumulés (classe 28) dépassent la valeur brute de l\'immobilisation correspondante.',
    solution: 'Ajustez les dotations aux amortissements ou constatez la sortie des immobilisations totalement amorties ou cédées.',
    actionLabel: 'Vérifier les amortissements (Étape 2)',
    hasAnomalies: true,
  },
  E8: {
    cible: 'Étape 3 (Informations)',
    step: 3,
    cause: 'Le capital social saisi dans la Note 13 ne concorde pas avec le compte 101 du Bilan.',
    solution: 'Rendez-vous à l\'Étape 3 (Informations) pour renseigner le tableau du Capital social (Note 13) avec un montant identique au Bilan.',
    actionLabel: 'Remplir la Note 13 (Étape 3)',
    hasAnomalies: false,
  },
  F1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'Anomalie de format dans le fichier de balance (numéro de compte absent ou textuel, doublons de comptes, ligne de total collée).',
    solution: 'Rendez-vous à l\'Étape 2 et vérifiez que votre balance respecte le modèle 6 colonnes (sans lignes de sous-totaux dans les données).',
    actionLabel: 'Recharger la balance (Étape 2)',
    hasAnomalies: false,
  },
  F2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    cause: 'La balance dépasse 5 000 lignes ou l\'en-tête de total a été altéré.',
    solution: 'Vérifiez la taille et les en-têtes de votre fichier de balance à l\'Étape 2.',
    actionLabel: 'Vérifier le fichier (Étape 2)',
    hasAnomalies: false,
  }
};

function renderResult(r, fresh) {
  const d = state.dossier;
  const isLimited = (d.exercise?.generation_type === 'free' && !d.exercise?.is_full_version) || !!r.isLimited;
  const cls = r.bloquants ? 'bad' : (r.vigilance || r.infosManquantes) ? 'warn' : 'ok';
  const title = r.bloquants ? `${r.bloquants} contrôle(s) bloquant(s) à corriger avant dépôt` : r.infosManquantes ? `${r.infosManquantes} information(s) obligatoire(s) à compléter` : r.vigilance ? 'Liasse cohérente – points de vigilance à examiner' : 'Liasse prête pour le dépôt Sen-etafi';
  const pct = v => (typeof v === 'number' ? (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '');
  const val = (l, v) => (/marge/i.test(l) ? pct(v) : fmt(v));
  const kpis = (r.chiffresCles || []).map(k => `<div class="kpi"><div class="l">${esc(k.libelle)}</div><div class="v">${esc(val(k.libelle, k.n))}</div><div class="d">N-1 : ${esc(val(k.libelle, k.n1))}${typeof k.variation === 'number' && !/marge/i.test(k.libelle) ? ' · ' + pct(k.variation) : ''}</div></div>`).join('');
  const an = r.anomalies || [];

  // Filtrage des contrôles bloquants et de vigilance non conformes
  const allControls = r.controls || [];
  const failedBloquants = allControls.filter(c => !c.section && c.type === 'B' && !String(c.statut).startsWith('✔'));
  const failedVigilances = allControls.filter(c => !c.section && c.type === 'V' && !String(c.statut).startsWith('✔'));
  const totalValids = allControls.filter(c => !c.section && String(c.statut).startsWith('✔')).length;
  const totalControls = allControls.filter(c => !c.section).length;

  // Construction du panneau de diagnostic bloquants
  let diagnosticHtml = '';
  if (failedBloquants.length > 0) {
    diagnosticHtml = `
      <div class="diagnostic-box bad" id="diagnosticBox">
        <div class="diagnostic-header">
          <span class="diag-icon">⛔</span>
          <div>
            <h4>${failedBloquants.length} contrôle(s) bloquant(s) détecté(s) : Action requise</h4>
            <p>Ces anomalies entraînent le rejet de votre liasse par la plateforme officielle <strong>Sen-etafi de la DGID</strong>. Suivez les consignes pour aller directement corriger chaque élément :</p>
          </div>
        </div>
        <div class="diagnostic-cards">
          ${failedBloquants.map(c => {
            const diag = CONTROLS_DIAGNOSTIC[c.code] || {
              cible: 'Étape 2 (Balances)',
              step: 2,
              cause: 'Écart constaté sur ce contrôle de cohérence.',
              solution: 'Vérifiez les montants correspondants dans votre balance générale et réimportez le fichier à l\'étape 2.',
              actionLabel: 'Corriger à l\'Étape 2 (Balances)',
              hasAnomalies: false,
            };
            const ecartTxt = typeof c.n === 'number' && c.n !== 0 ? `Écart N : ${fmt(c.n)} FCFA` : (typeof c.n1 === 'number' && c.n1 !== 0 ? `Écart N-1 : ${fmt(c.n1)} FCFA` : 'Non conforme');
            return `<div class="diagnostic-card">
              <div class="diag-card-head">
                <div>
                  <span class="badge bad" style="font-weight:700;">⛔ Bloquant · ${esc(c.code)}</span>
                  <strong style="margin-left:8px;">${esc(c.libelle)}</strong>
                </div>
                <span class="diag-ecart">${esc(ecartTxt)}</span>
              </div>
              <div class="diag-card-body">
                <p><strong>Cause :</strong> ${esc(diag.cause)}</p>
                <p><strong>Où et comment corriger :</strong> <span style="color:#991b1b; font-weight:600;">[${esc(diag.cible)}]</span> ${esc(diag.solution)}</p>
              </div>
              <div class="diag-card-foot">
                <button class="btn sm gold" data-step-go="${diag.step}">✏️ ${esc(diag.actionLabel)}</button>
                ${diag.hasAnomalies && an.length ? `<button class="btn sm ghost" data-open-anomalies="true">🔍 Voir les comptes signalés (${an.length})</button>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  } else if (failedVigilances.length > 0) {
    diagnosticHtml = `
      <div class="diagnostic-box warn" id="diagnosticBox">
        <div class="diagnostic-header" style="margin-bottom:0;">
          <span class="diag-icon">⚠️</span>
          <div>
            <h4 style="color:#92400e;">Aucun blocage – ${failedVigilances.length} point(s) de vigilance à examiner</h4>
            <p style="color:#78350f;">Votre liasse ne comporte aucune erreur bloquante, mais quelques écarts indicatifs méritent une vérification avant validation finale.</p>
          </div>
        </div>
      </div>
    `;
  } else {
    diagnosticHtml = `
      <div class="diagnostic-box ok" id="diagnosticBox">
        <div class="diagnostic-header" style="margin-bottom:0;">
          <span class="diag-icon">✅</span>
          <div>
            <h4 style="color:#166534;">Liasse 100% conforme et équilibrée</h4>
            <p style="color:#15803d;">Tous les contrôles de cohérence et équilibres SYSCOHADA sont validés avec succès. Votre fichier est prêt pour Sen-etafi.</p>
          </div>
        </div>
      </div>
    `;
  }

  // Tableau des contrôles avec repères visuels clairs
  const ctl = allControls.map(c => {
    if (c.section) {
      return `<tr class="section" data-kind="section"><td colspan="5">${esc(c.code)} · ${esc(c.libelle)}</td></tr>`;
    }
    const isOk = String(c.statut).startsWith('✔');
    const isBloquant = c.type === 'B';
    const isFail = !isOk;
    const rowClass = isFail ? (isBloquant ? 'tr-bloquant-err' : 'tr-vigilance-err') : '';
    const filterKind = isFail ? (isBloquant ? 'bloquant' : 'vigilance') : 'ok';
    const diag = CONTROLS_DIAGNOSTIC[c.code];
    const guideNote = isFail && diag ? `<div class="ctl-guide-note"><strong>Où corriger :</strong> ${esc(diag.cible)} – ${esc(diag.solution)}</div>` : '';

    return `<tr class="${rowClass}" data-kind="${filterKind}">
      <td><b>${esc(c.code)}</b></td>
      <td>
        <div>${esc(c.libelle)} ${isBloquant ? '<span class="badge ' + (isFail ? 'bad' : 'neutral') + '">bloquant</span>' : '<span class="badge neutral">vigilance</span>'}</div>
        ${guideNote}
      </td>
      <td class="num">${esc(typeof c.n === 'number' ? fmt(c.n) : c.n ?? '')}</td>
      <td class="num">${esc(typeof c.n1 === 'number' ? fmt(c.n1) : c.n1 ?? '')}</td>
      <td>${isOk ? '<span class="badge ok">OK</span>' : `<span class="badge ${isBloquant ? 'bad' : 'warn'}" style="font-weight:700;">${isBloquant ? '⛔ À corriger' : '⚠️ À vérifier'}</span>`}</td>
    </tr>`;
  }).join('');

  const limitedBanner = isLimited ? `
    <div class="status-banner warn" style="margin-top:0;">
      <div>
        <strong>Rapport d'évaluation gratuit (Bilan, Compte de résultat, TFT)</strong>
        <div class="small">Les 36 notes annexes et fiches R2-R4 sont masquées dans ce fichier. Débloquez la liasse complète pour le dépôt officiel Sen-etafi.</div>
      </div>
      <button class="btn gold" id="btnUnlockFullDossier">Débloquer la liasse complète (20 000 FCFA)</button>
    </div>` : `
    <div class="status-banner ok" style="margin-top:0;">
      <div><strong>Liasse complète officielle DGID (55 onglets)</strong><div class="small">Toutes les notes annexes et fiches sont incluses et prêtes pour Sen-etafi.</div></div>
    </div>`;

  $('#resultBox').innerHTML = `
    ${limitedBanner}
    <div class="status-banner ${cls}"><div><strong>${esc(title)}</strong><div class="small">Généré le ${esc(dateTimeFr(d.exercise?.generated_at || Date.now()))} · ${esc(r.fichier || '')}</div></div>
      <button class="btn primary" id="btnDlLiasse">${isLimited ? 'Télécharger l\'évaluation (.xlsx)' : 'Télécharger la liasse complète (.xlsx)'}</button></div>
    
    ${diagnosticHtml}

    <h3>Chiffres clés (FCFA)</h3><div class="kpis">${kpis}</div>
    
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-top:20px;">
      <h3 style="margin:0;">Contrôles de cohérence</h3>
      <div class="control-filters">
        <span class="control-filter-label">Filtrer :</span>
        <button class="control-filter-btn active" data-ctl-filter="all">Tous (${totalControls})</button>
        ${failedBloquants.length ? `<button class="control-filter-btn filter-bad" data-ctl-filter="bloquant">⛔ Bloquants à corriger (${failedBloquants.length})</button>` : ''}
        ${failedVigilances.length ? `<button class="control-filter-btn filter-warn" data-ctl-filter="vigilance">⚠️ Vigilance (${failedVigilances.length})</button>` : ''}
        <button class="control-filter-btn" data-ctl-filter="ok">✅ Conformes (${totalValids})</button>
      </div>
    </div>
    
    <div class="table-wrap"><table class="table" id="tableControls"><thead><tr><th>N°</th><th>Contrôle</th><th>N</th><th>N-1</th><th>Statut</th></tr></thead><tbody>${ctl}</tbody></table></div>
    ${an.length ? `<details style="margin-top:14px" id="detailsAnomalies"><summary><span>${r.nbAnomalies || an.length} compte(s) signalé(s) dans les balances</span></summary>
      <div class="table-wrap"><table class="table"><thead><tr><th>Balance</th><th>Compte</th><th>Intitulé</th><th>Solde</th><th>Observation</th></tr></thead><tbody>
      ${an.map(a => `<tr><td>${esc(a.balance)}</td><td>${esc(a.compte)}</td><td>${esc(a.intitule)}</td><td class="num">${fmt(a.solde)}</td><td>${esc(a.messages.join(' ; '))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <p class="small muted" style="margin-top:14px">Le fichier reprend le modèle officiel <em>modele_etats_financiers_DGID (Nouveau)</em> : onglets inchangés, valeurs uniquement (aucune formule). Rappel : visa de l'expert-comptable ou du commissaire aux comptes requis pour le dépôt sur Sen-etafi.</p>`;

  // Écouteurs de téléchargement et déblocage
  $('#btnDlLiasse').addEventListener('click', async () => {
    if (d.lastBlob) return downloadBlob(d.lastBlob.blob, d.lastBlob.name);
    const f = (await sb.from('exercise_files').select('*').eq('exercise_id', d.exercise.id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
    if (f) downloadStored('etats', f.storage_path, f.nom_original); else toast('Fichier introuvable : relancez la génération.', true);
  });

  $('#btnUnlockFullDossier')?.addEventListener('click', () => {
    executeGeneration('paid');
  });

  // Écouteurs de navigation directe vers l'étape de correction
  $('#resultBox').querySelectorAll('[data-step-go]').forEach(b => b.addEventListener('click', () => {
    setStep(+b.dataset.stepGo);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // Écouteur pour ouvrir les comptes en anomalie
  $('#resultBox').querySelectorAll('[data-open-anomalies]').forEach(b => b.addEventListener('click', () => {
    const det = $('#detailsAnomalies');
    if (det) {
      det.open = true;
      det.scrollIntoView({ behavior: 'smooth' });
    }
  }));

  // Écouteurs de filtrage interactif du tableau des contrôles
  $('#resultBox').querySelectorAll('[data-ctl-filter]').forEach(b => b.addEventListener('click', () => {
    $('#resultBox').querySelectorAll('[data-ctl-filter]').forEach(x => x.classList.toggle('active', x === b));
    const filter = b.dataset.ctlFilter;
    $('#tableControls tbody').querySelectorAll('tr').forEach(tr => {
      const kind = tr.dataset.kind;
      if (kind === 'section') {
        tr.hidden = filter !== 'all';
      } else if (filter === 'all') {
        tr.hidden = false;
      } else {
        tr.hidden = kind !== filter;
      }
    });
  }));

  if (fresh) toast(isLimited ? 'Évaluation générée.' : 'Liasse complète générée.');
}


// ------------------------------------------------------------------ tarifs & paiements
const DEFAULT_PACKS = [
  { id: 'unit', nom: 'Génération à l\'unité', credits: 1, prix_fcfa: 20000, prix_unitaire_fcfa: 20000, economie_pct: 0, description: '1 génération complète officielle avec toutes les 36 notes et fiches' },
  { id: 'starter', nom: 'Pack Starter', credits: 3, prix_fcfa: 50000, prix_unitaire_fcfa: 16667, economie_pct: 17, description: '3 générations complètes (16 667 FCFA / liasse)' },
  { id: 'business', nom: 'Pack Business', credits: 10, prix_fcfa: 160000, prix_unitaire_fcfa: 16000, economie_pct: 20, popular: true, description: '10 générations complètes (16 000 FCFA / liasse)' },
  { id: 'cabinet_expert', nom: 'Pack Cabinet & Pack Expert', credits: 25, prix_fcfa: 400000, prix_unitaire_fcfa: 16000, economie_pct: 20, description: '25 générations complètes (16 000 FCFA / liasse)' },
];

async function renderPricing() {

  show('pricing');
  updateCreditsDisplay();
  const grid = $('#pricingPacksGrid');
  grid.innerHTML = '<p class="muted">Chargement des tarifs…</p>';

  let packs = DEFAULT_PACKS;
  const { data: dbPacks } = await sb.from('credit_packages').select('*').eq('is_active', true).order('sort_order');
  const isDbOutdated = !dbPacks?.length || dbPacks.some(p => (p.id === 'unit' && p.prix_fcfa === 10000) || p.id === 'expert');
  if (dbPacks?.length && !isDbOutdated) {
    packs = dbPacks;
  }

  // Si l'administrateur est connecté, mise à jour transparente de la table Supabase
  if (state.profile?.is_admin && isDbOutdated) {
    (async () => {
      try {
        await sb.from('credit_packages').update({ is_active: false }).neq('id', '');
        for (let i = 0; i < DEFAULT_PACKS.length; i++) {
          const p = DEFAULT_PACKS[i];
          await sb.from('credit_packages').upsert({
            id: p.id,
            nom: p.nom,
            credits: p.credits,
            prix_fcfa: p.prix_fcfa,
            prix_unitaire_fcfa: p.prix_unitaire_fcfa,
            economie_pct: p.economie_pct,
            description: p.description,
            is_active: true,
            sort_order: i + 1
          });
        }
      } catch (e) {
        console.warn('Synchro auto credit_packages:', e.message);
      }
    })();
  }

  grid.innerHTML = packs.map(p => {
    const isPop = p.id === 'business' || p.popular;

    const econ = p.economie_pct ? `<span class="saving-tag">Économie de ${p.economie_pct}%</span>` : '';
    return `<div class="pricing-card ${isPop ? 'popular' : ''}">
      ${isPop ? '<div class="ribbon">Recommandé</div>' : ''}
      <div class="pricing-head">
        <h3>${esc(p.nom)}</h3>
        <p>${esc(p.description || '')}</p>
        <div class="pricing-price">
          <div class="amount">${fmt(p.prix_fcfa)} FCFA</div>
          <div class="period">${fmt(p.prix_unitaire_fcfa)} F / dossier ${econ}</div>
        </div>
      </div>
      <ul class="pricing-features">
        <li><strong>${p.credits} génération(s)</strong> de liasse complète</li>
        <li>Toutes les 36 notes et fiches officielles</li>
        <li>Fichier .xlsx conforme Sen-etafi</li>
        <li>Valable sans limite de durée</li>
      </ul>
      <button class="btn ${isPop ? 'gold' : 'primary'}" data-buy="${p.id}">Choisir ce pack</button>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
    const pack = packs.find(x => x.id === b.dataset.buy);
    if (pack) openPaymentModal(pack);
  }));

  // Charge l'historique des paiements de l'utilisateur
  const tb = $('#tableUserPayments tbody');
  const { data: payments } = await sb.from('payments').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false });
  if (payments?.length) {
    tb.innerHTML = payments.map(pay => {
      const st = pay.statut === 'completed'
        ? '<span class="badge ok">Validé</span>'
        : pay.statut === 'pending'
        ? '<span class="badge warn" title="En attente de réception du transfert au 77 443 96 90">En attente de validation</span>'
        : '<span class="badge bad">Annulé</span>';
      const moyen = pay.reference_externe
        ? `<b>${esc(pay.moyen_paiement)}</b><div class="small muted" style="font-family:monospace; font-size:11px;">Réf: ${esc(pay.reference_externe)}</div>`
        : esc(pay.moyen_paiement);
      return `<tr>
        <td>${esc(dateTimeFr(pay.created_at))}</td>
        <td><b>${esc(pay.package_id || 'Crédits')}</b></td>
        <td>${fmt(pay.montant_fcfa)} FCFA</td>
        <td>${moyen}</td>
        <td>${st}</td>
        <td>+${pay.credits_achetes}</td>
      </tr>`;
    }).join('');
  } else {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Aucune transaction enregistrée.</td></tr>';
  }
}

let selectedPackForPayment = null;
function openPaymentModal(pack) {
  selectedPackForPayment = pack;
  $('#payModalTitle').textContent = `Commander ${pack.nom}`;
  $('#payModalDetails').innerHTML = `
    <div style="background:var(--bg); padding:12px; border-radius:8px; margin-bottom:12px;">
      <div style="font-size:16px; font-weight:700;">${esc(pack.nom)} · ${pack.credits} génération(s) complète(s)</div>
      <div style="font-size:22px; font-weight:800; color:var(--brand); margin-top:4px;">${fmt(pack.prix_fcfa)} FCFA</div>
    </div>
  `;
  const msgEl = $('#payStatusMsg');
  if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
  const btn = $('#btnSubmitPayment');
  if (btn) { btn.disabled = false; btn.textContent = 'Confirmer ma commande'; }
  if (state.profile?.telephone) $('#payPhone').value = state.profile.telephone;
  $('#modalPayment').hidden = false;
}

// Sélection de moyen de paiement
$$('.payment-method').forEach(pm => pm.addEventListener('click', () => {
  $$('.payment-method').forEach(x => x.classList.toggle('active', x === pm));
  const r = pm.querySelector('input[type=radio]');
  if (r) r.checked = true;
}));

$('#btnSubmitPayment').addEventListener('click', async () => {
  const pack = selectedPackForPayment;
  if (!pack) return;
  const provider = $('input[name=payProvider]:checked')?.value || 'Wave';
  const phone = $('#payPhone').value.trim();
  if (!phone) return toast('Indiquez votre numéro de téléphone émetteur du transfert.', true);

  const btn = $('#btnSubmitPayment');
  const msgEl = $('#payStatusMsg');
  btn.disabled = true;
  btn.textContent = 'Enregistrement de votre commande…';
  if (msgEl) {
    msgEl.hidden = false;
    msgEl.className = 'msg';
    msgEl.textContent = 'Création de la commande en cours…';
  }

  try {
    // Génération de la référence unique de commande
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const refCmd = `FIN-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;

    // 1. Enregistre la commande dans Supabase avec statut 'pending'
    const { data: payRow, error: pErr } = await sb.from('payments').insert({
      user_id: state.user.id,
      package_id: pack.id,
      credits_achetes: pack.credits,
      montant_fcfa: pack.prix_fcfa,
      moyen_paiement: provider,
      telephone_paiement: phone,
      reference_externe: refCmd,
      statut: 'pending'
    }).select().single();

    if (pErr) throw new Error(pErr.message);

    // 2. Mémorise le numéro de téléphone dans le profil si non renseigné
    if (!state.profile?.telephone) {
      await sb.from('profiles').update({ telephone: phone }).eq('id', state.user.id);
      if (state.profile) state.profile.telephone = phone;
    }

    closeModals();

    // 3. Information claire pour l'utilisateur
    alert(
      `✅ Commande enregistrée avec succès !\n\n` +
      `Référence commande : ${refCmd}\n` +
      `Pack : ${pack.nom} (+${pack.credits} générations)\n` +
      `Montant à transférer : ${fmt(pack.prix_fcfa)} FCFA\n\n` +
      `📱 Instructions de règlement :\n` +
      `Effectuez le transfert de ${fmt(pack.prix_fcfa)} FCFA via ${provider} vers le numéro officiel FINSMART :\n` +
      `👉 77 443 96 90 (Bénéficiaire : FINSMART)\n\n` +
      `Dès réception de votre transfert, l'administrateur valide votre commande et vos crédits seront immédiatement activés sur votre compte.`
    );

    toast(`Commande ${refCmd} créée ! En attente de votre transfert.`);

    // 4. Actualise l'historique sur la page tarifs
    if (location.hash === '#/pricing' || location.hash === '#pricing') {
      renderPricing();
    }
  } catch (err) {
    console.error('[Commande Paiement] Erreur:', err);
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.className = 'msg err';
      msgEl.textContent = 'Erreur : ' + err.message;
    }
    toast('Échec de la commande : ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmer ma commande';
  }
});


// ------------------------------------------------------------------ administration
let adminRows = [];
let adminCurrentTab = 'dossiers';

$$('[data-admin-tab]').forEach(tab => tab.addEventListener('click', () => {
  $$('[data-admin-tab]').forEach(t => t.classList.toggle('active', t === tab));
  adminCurrentTab = tab.dataset.adminTab;
  $('#adminTabDossiers').hidden = adminCurrentTab !== 'dossiers';
  $('#adminTabPayments').hidden = adminCurrentTab !== 'payments';
  $('#adminTabCredits').hidden = adminCurrentTab !== 'credits';
  if (adminCurrentTab === 'payments') renderAdminPayments();
  if (adminCurrentTab === 'credits') renderAdminCredits();
}));

async function renderAdmin() {
  show('admin');
  const tb = $('#adminTable tbody'); tb.innerHTML = '<tr><td colspan="8">Chargement…</td></tr>';
  const { data, error } = await sb.from('exercises')
    .select('id, exercice, date_fin, statut, is_full_version, generation_type, updated_at, generated_at, rapport, companies(nom, ninea, telephone, email_contact), profiles!exercises_created_by_fkey(nom_complet, email, telephone), exercise_files(type, storage_path, nom_original)')
    .order('updated_at', { ascending: false });
  if (error) { tb.innerHTML = `<tr><td colspan="8" class="msg err">${esc(error.message)}</td></tr>`; return; }
  adminRows = data || [];
  const clients = new Set(adminRows.map(r => r.profiles?.email)).size;
  const gen = adminRows.filter(r => r.generated_at).length, prets = adminRows.filter(r => r.rapport && r.rapport.pret).length;
  
  // Récupère aussi les commandes en attente de validation
  const { data: pendingPays } = await sb.from('payments').select('id').eq('statut', 'pending');
  const pendingCount = pendingPays?.length || 0;

  const tabBtn = $('[data-admin-tab="payments"]');
  if (tabBtn) {
    tabBtn.innerHTML = `Paiements & Commandes ${pendingCount ? `<span class="badge warn" style="margin-left:6px; font-size:11px;">${pendingCount} en attente</span>` : ''}`;
  }

  $('#adminKpis').innerHTML = [
    ['Clients', clients],
    ['Dossiers', adminRows.length],
    ['Liasses générées', gen],
    ['Commandes en attente', `<span style="color:${pendingCount ? '#b45309' : 'inherit'}">${pendingCount}</span>`]
  ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  drawAdmin();
}

function drawAdmin() {
  const q = $('#adminSearch').value.trim().toLowerCase();
  const rows = adminRows.filter(r => !q || [r.companies?.nom, r.companies?.ninea, r.profiles?.nom_complet, r.profiles?.email].join(' ').toLowerCase().includes(q));
  $('#adminTable tbody').innerHTML = rows.map(r => {
    const files = r.exercise_files || [];
    const fb = (type, label, bucket) => { const f = files.find(x => x.type === type); return f ? `<button class="btn ghost sm" data-b="${bucket}" data-p="${esc(f.storage_path)}" data-n="${esc(f.nom_original)}">${label}</button>` : ''; };
    const rp = r.rapport || {};
    const genTypeBadge = r.is_full_version ? '<span class="badge ok">Complète</span>' : (r.generation_type === 'free' ? '<span class="badge warn">Évaluation</span>' : '<span class="badge neutral">—</span>');
    return `<tr><td><b>${esc(r.companies?.nom)}</b><div class="small muted">NINEA ${esc(r.companies?.ninea || '—')}</div></td>
      <td>${esc(dateFr(r.date_fin) || r.exercice)}</td>
      <td>${esc(r.profiles?.nom_complet || '')}<div class="small muted">${esc(r.profiles?.email || '')} ${esc(r.profiles?.telephone || '')}</div></td>
      <td>${genTypeBadge}</td>
      <td><select data-statut="${r.id}">${Object.entries(STATUTS).map(([k, [l]]) => `<option value="${k}" ${k === r.statut ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${r.generated_at ? (rp.bloquants ? `<span class="badge bad">${rp.bloquants} bloquant(s)</span>` : '<span class="badge ok">OK</span>') + (rp.vigilance ? ` <span class="badge warn">${rp.vigilance} vigilance</span>` : '') : '<span class="muted small">non générée</span>'}</td>
      <td class="small">${esc(dateTimeFr(r.updated_at))}</td>
      <td style="white-space:nowrap">${fb('balance_n', 'Bal. N', 'balances')} ${fb('balance_n1', 'Bal. N-1', 'balances')} ${fb('etats_complet_xlsx', 'Liasse', 'etats') || fb('etats_gratuit_xlsx', 'Liasse', 'etats')}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">Aucun dossier.</td></tr>';
}

$('#adminSearch').addEventListener('input', drawAdmin);
$('#adminTable').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) downloadStored(b.dataset.b, b.dataset.p, b.dataset.n); });
$('#adminTable').addEventListener('change', async e => {
  const s = e.target.closest('[data-statut]'); if (!s) return;
  const { error } = await sb.from('exercises').update({ statut: s.value }).eq('id', s.dataset.statut);
  toast(error ? error.message : 'Statut mis à jour.', !!error);
});

async function renderAdminPayments() {
  const tb = $('#adminPaymentsTable tbody');
  tb.innerHTML = '<tr><td colspan="8">Chargement des paiements…</td></tr>';
  const { data: pays, error } = await sb.from('payments').select('*').order('created_at', { ascending: false });
  if (error) { tb.innerHTML = `<tr><td colspan="8" class="msg err">${esc(error.message)}</td></tr>`; return; }
  if (!pays?.length) { tb.innerHTML = '<tr><td colspan="8" class="muted">Aucune commande ou paiement enregistré.</td></tr>'; return; }

  // Charge les profils clients de manière découplée (compatible avec tous les schémas PostgREST)
  const userIds = [...new Set(pays.map(p => p.user_id).filter(Boolean))];
  const profilesMap = {};
  if (userIds.length) {
    const { data: profs } = await sb.from('profiles').select('id, nom_complet, email, telephone').in('id', userIds);
    (profs || []).forEach(p => { profilesMap[p.id] = p; });
  }

  // Met à jour le badge sur l'onglet admin si des commandes sont en attente
  const pendingCount = pays.filter(p => p.statut === 'pending').length;
  const tabBtn = $('[data-admin-tab="payments"]');
  if (tabBtn) {
    tabBtn.innerHTML = `Paiements & Commandes ${pendingCount ? `<span class="badge warn" style="margin-left:6px; font-size:11px;">${pendingCount} en attente</span>` : ''}`;
  }

  tb.innerHTML = pays.map(p => {
    const st = p.statut === 'completed' 
      ? '<span class="badge ok">Validé</span>' 
      : p.statut === 'pending' 
      ? '<span class="badge warn">En attente</span>' 
      : '<span class="badge bad">' + esc(p.statut) + '</span>';

    const action = p.statut === 'pending' 
      ? `<div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn ok sm" data-approve-pay="${p.id}" title="Valider et créditer immédiatement le client">✅ Valider & Créditer</button>
          <button class="btn bad sm" data-reject-pay="${p.id}" title="Rejeter / Annuler cette commande">❌ Rejeter</button>
        </div>` 
      : `<span class="muted small">—</span>`;

    const moyenCell = p.reference_externe
      ? `<b>${esc(p.moyen_paiement)}</b><div class="small muted" style="font-family:monospace; font-weight:600; font-size:11px;">${esc(p.reference_externe)}</div>`
      : esc(p.moyen_paiement);

    const prof = profilesMap[p.user_id] || {};
    const clientNom = prof.nom_complet || 'Client';
    const clientEmail = prof.email || '';
    const phoneDisplay = p.telephone_paiement || prof.telephone || '—';

    return `<tr>
      <td>${esc(dateTimeFr(p.created_at))}</td>
      <td><b>${esc(clientNom)}</b><div class="small muted">${esc(clientEmail)}</div></td>
      <td>${esc(p.package_id || 'crédits')} (+${p.credits_achetes})</td>
      <td><b>${fmt(p.montant_fcfa)} FCFA</b></td>
      <td>${moyenCell}</td>
      <td><a href="tel:${esc(phoneDisplay)}" style="color:inherit; font-weight:600;">${esc(phoneDisplay)}</a></td>
      <td>${st}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('[data-approve-pay]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.approvePay;
    const pay = pays.find(x => x.id === id);
    const prof = profilesMap[pay?.user_id] || {};
    const clientName = prof.nom_complet || prof.email || 'ce client';
    if (!confirm(`Confirmez-vous la réception du transfert de ${fmt(pay?.montant_fcfa || 0)} FCFA et l'attribution immédiate de +${pay?.credits_achetes} crédits à ${clientName} ?`)) {
      return;
    }
    b.disabled = true;
    b.textContent = 'Validation…';

    let { error: err } = await sb.rpc('complete_payment', { p_payment_id: id });
    if (err) {
      console.warn('RPC complete_payment fallback direct:', err);
      try {
        await sb.from('payments').update({ statut: 'completed' }).eq('id', id);
        if (pay) {
          const { data: profRow } = await sb.from('profiles').select('credits_balance').eq('id', pay.user_id).single();
          const newBal = (profRow?.credits_balance || 0) + (pay.credits_achetes || 0);
          await sb.from('profiles').update({ credits_balance: newBal }).eq('id', pay.user_id);
          await sb.from('credit_ledger').insert({
            user_id: pay.user_id,
            type_mouvement: 'achat',
            montant_credits: pay.credits_achetes,
            solde_avant: profRow?.credits_balance || 0,
            solde_apres: newBal,
            motif: `Commande ${pay.reference_externe || id} validée manuellement par admin`,
            payment_id: id
          });
        }
        err = null;
      } catch (fallbackErr) {
        err = fallbackErr;
      }
    }

    if (err) {
      toast('Erreur validation : ' + err.message, true);
      b.disabled = false;
      b.textContent = '✅ Valider & Créditer';
    } else {
      toast(`Paiement validé ! +${pay?.credits_achetes || 0} crédits alloués à ${clientName}.`);
      await refreshProfile();
      renderAdminPayments();
    }
  }));

  tb.querySelectorAll('[data-reject-pay]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.rejectPay;
    if (!confirm('Rejeter cette commande ? Aucun crédit ne sera attribué au client.')) return;
    b.disabled = true;
    const { error: err } = await sb.from('payments').update({ statut: 'cancelled' }).eq('id', id);
    if (err) {
      toast('Erreur rejet : ' + err.message, true);
      b.disabled = false;
    } else {
      toast('Commande rejetée.');
      renderAdminPayments();
    }
  }));
}

async function renderAdminCredits() {
  const sel = $('#adminCreditUser');
  sel.innerHTML = '<option value="">Chargement des clients…</option>';
  const { data: profs } = await sb.from('profiles').select('id, nom_complet, email, credits_balance').order('nom_complet');
  sel.innerHTML = (profs || []).map(p => `<option value="${p.id}">${esc(p.nom_complet || p.email)} (Solde actuel : ${p.credits_balance || 0} crédits)</option>`).join('');

  // Charge le journal d'audit de manière découplée
  const tb = $('#adminLedgerTable tbody');
  const { data: ledgers, error: lErr } = await sb.from('credit_ledger').select('*').order('created_at', { ascending: false }).limit(50);
  if (lErr) { tb.innerHTML = `<tr><td colspan="6" class="msg err">${esc(lErr.message)}</td></tr>`; return; }
  
  if (ledgers?.length) {
    const ledgerUserIds = [...new Set(ledgers.map(l => l.user_id).filter(Boolean))];
    const ledgerProfMap = {};
    if (ledgerUserIds.length) {
      const { data: lProfs } = await sb.from('profiles').select('id, nom_complet, email').in('id', ledgerUserIds);
      (lProfs || []).forEach(p => { ledgerProfMap[p.id] = p; });
    }

    tb.innerHTML = ledgers.map(l => {
      const delta = l.montant_credits > 0 ? `+${l.montant_credits}` : String(l.montant_credits);
      const cls = l.montant_credits > 0 ? 'ok' : l.montant_credits < 0 ? 'bad' : 'neutral';
      const prof = ledgerProfMap[l.user_id] || {};
      const clientName = prof.nom_complet || prof.email || 'Client';
      return `<tr>
        <td>${esc(dateTimeFr(l.created_at))}</td>
        <td>${esc(clientName)}</td>
        <td><span class="badge ${cls}">${delta} crédit(s)</span></td>
        <td><b>${l.solde_apres}</b></td>
        <td>${esc(l.motif)}</td>
        <td>${esc(l.commentaire || '')}</td>
      </tr>`;
    }).join('');
  } else {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Aucune écriture d\'audit.</td></tr>';
  }
}

$('#formAdminCredit')?.addEventListener('submit', async e => {
  e.preventDefault();
  const userId = $('#adminCreditUser').value;
  const delta = +$('#adminCreditDelta').value;
  const motif = $('#adminCreditMotif').value.trim();
  if (!userId || !delta || !motif) return toast('Remplissez tous les champs.', true);

  const { error } = await sb.rpc('admin_adjust_credits', {
    p_target_user_id: userId,
    p_credits_delta: delta,
    p_motif: motif
  });

  if (error) {
    toast('Échec ajustement : ' + error.message, true);
  } else {
    toast('Crédits mis à jour avec succès.');
    $('#formAdminCredit').reset();
    renderAdminCredits();
  }
});

// ------------------------------------------------------------------ démarrage
$('#footContact').textContent = `${BRAND.contact} · ${BRAND.tel}`;
sb.auth.onAuthStateChange((_ev, session) => {
  if ((session?.user?.id || null) !== (state.user?.id || null)) onSession(session);
});
sb.auth.getSession().then(({ data }) => onSession(data.session));

