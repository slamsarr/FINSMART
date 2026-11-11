/* FINSMART – Application de collecte des balances et de génération de la liasse DGID */
import { SUPABASE_URL, SUPABASE_KEY, BRAND } from './config.js';
import { parseBalance, checkSyscohadaRules, INFO_SECTIONS, INFO_TABLES, INFO_EXTRA, EFFECTIFS, nomFichier, fmt, BALANCE_COLUMNS } from './liasse.js';
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
  const token = url.searchParams.get('token');
  const mockCredits = parseInt(url.searchParams.get('credits') || '0', 10);

  if (paymentStatus === 'success') {
    url.searchParams.delete('payment');
    url.searchParams.delete('ref');
    url.searchParams.delete('token');
    url.searchParams.delete('mock');
    url.searchParams.delete('credits');
    window.history.replaceState({}, document.title, url.pathname + url.hash);

    let creditsAdded = 0;
    let rpcDone = false;

    // 1. Appel de la procédure stockée Supabase complete_payment_by_ref
    if (ref) {
      try {
        const { data: rpcRes, error: rpcErr } = await sb.rpc('complete_payment_by_ref', {
          p_ref_command: ref,
          p_external_token: token || null
        });
        if (!rpcErr && rpcRes && rpcRes.ok) {
          rpcDone = true;
          creditsAdded = Number(rpcRes.credits_added) || 0;
        }
      } catch (e) {
        console.warn('RPC complete_payment_by_ref non disponible ou erreur:', e);
      }
    }

    // 2. Fallback de sécurité côté client si la RPC n'a pas traité
    if (!rpcDone && ref && state.user?.id) {
      try {
        const { data: payRow } = await sb.from('payments')
          .select('*')
          .eq('reference_externe', ref)
          .maybeSingle();

        if (payRow) {
          const creditsToCredit = Number(payRow.credits_achetes) || mockCredits || 1;

          if (payRow.statut === 'pending') {
            // Lecture du solde actuel dans profiles
            const { data: profData } = await sb.from('profiles').select('credits_balance').eq('id', state.user.id).single();
            const currentBal = Number(profData?.credits_balance || 0);
            const newBal = currentBal + creditsToCredit;

            // Marquer le paiement comme complété
            await sb.from('payments').update({
              statut: 'completed',
              updated_at: new Date().toISOString()
            }).eq('id', payRow.id);

            // Créditer immédiatement le solde du profil
            await sb.from('profiles').update({
              credits_balance: newBal
            }).eq('id', state.user.id);

            // Tracer l'écriture dans le journal d'audit
            try {
              await sb.from('credit_ledger').insert({
                user_id: state.user.id,
                montant_credits: creditsToCredit,
                solde_apres: newBal,
                motif: 'purchase',
                payment_id: payRow.id,
                commentaire: `Achat ${payRow.package_id || 'crédits'} (PayDunya ${ref})`
              });
            } catch (_) {}

            creditsAdded = creditsToCredit;
            rpcDone = true;
          } else if (payRow.statut === 'completed') {
            creditsAdded = creditsToCredit;
            rpcDone = true;
          }
        }
      } catch (err) {
        console.warn('Erreur fallback validation retour client:', err);
      }
    }

    // 3. Cas simulation mock / sandbox directe
    if (!rpcDone && mockCredits > 0 && state.user?.id) {
      try {
        const { data: profData } = await sb.from('profiles').select('credits_balance').eq('id', state.user.id).single();
        const currentBal = Number(profData?.credits_balance || 0);
        const newBal = currentBal + mockCredits;
        await sb.from('profiles').update({ credits_balance: newBal }).eq('id', state.user.id);
        creditsAdded = mockCredits;
      } catch (e) {
        console.warn('Erreur mock credit:', e);
      }
    }

    // Rechargement immédiat du profil et actualisation visuelle des compteurs
    await refreshProfile();
    updateCreditsDisplay();

    const soldeActuel = state.profile?.credits_balance ?? '—';
    const nbCredits = creditsAdded || 1;
    toast(`✅ Paiement validé avec succès (${ref || 'PayDunya'}) ! +${nbCredits} crédit${nbCredits > 1 ? 's' : ''} ajouté${nbCredits > 1 ? 's' : ''}. Nouveau solde : ${soldeActuel} crédit${soldeActuel > 1 ? 's' : ''}.`);

    if (location.hash === '#/pricing' || location.hash === '#pricing') {
      renderPricing();
    } else if (location.hash === '' || location.hash === '#/' || location.hash === '#dashboard') {
      renderDashboard();
    }
  } else if (paymentStatus === 'cancel') {
    url.searchParams.delete('payment');
    url.searchParams.delete('ref');
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.pathname + url.hash);

    toast('Paiement PayDunya annulé. Aucun débit n\'a été effectué.', true);
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
  for (const k of ['N', 'N1']) {
    $('#file' + k).textContent = 'Aucun fichier';
    $('#rep' + k).innerHTML = '';
    const btnView = $('#btnBalView' + k);
    if (btnView) btnView.style.display = 'none';
  }
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
  const st = p.errors.length 
    ? `<button type="button" class="badge bad btn-fix-balance" data-bal-key="${k}" style="cursor:pointer; border:none; padding:4px 10px; font-size:12px; font-weight:800;" title="Cliquer pour corriger immédiatement les anomalies de la Balance ${k}">⛔ À corriger (cliquer pour réparer ➔)</button>` 
    : (p.warnings.length 
      ? `<button type="button" class="badge warn btn-fix-balance" data-bal-key="${k}" style="cursor:pointer; border:none; padding:4px 10px; font-size:12px; font-weight:700;" title="Cliquer pour examiner les remarques">⚠️ Lue avec remarques</button>` 
      : '<span class="badge ok">Conforme</span>');
  
  // Met à jour et affiche le bouton d'édition rapide
  const btnView = $('#btnBalView' + k);
  if (btnView) {
    btnView.style.display = 'inline-flex';
    btnView.textContent = `👁️ Visualiser & Modifier (${p.rows?.length || 0} comptes)`;
  }

  // Erreurs enrichies avec lien direct vers le compte en anomalie
  const errorsHtml = p.errors.slice(0, 10).map(x => {
    const m = x.match(/compte\s+([0-9A-Za-z]+)/i);
    const acc = m ? m[1] : null;
    return `<li style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:3px 0;">
      <span>${esc(x)}</span>
      ${acc 
        ? `<button type="button" class="btn-goto-account link small" data-bal-key="${k}" data-acc="${acc}" style="font-weight:700; white-space:nowrap; color:#b91c1c;">✏️ Corriger ce compte</button>`
        : `<button type="button" class="btn-goto-account link small" data-bal-key="${k}" data-filter="errors" style="font-weight:700; white-space:nowrap; color:#b91c1c;">✏️ Équilibrer</button>`}
    </li>`;
  }).join('');

  // Remarques SYSCOHADA avec lien direct et validation par le client
  const remarquesVal = (state.dossier?.infos && state.dossier.infos.remarques_validations) || {};
  const warningsHtml = p.warnings.slice(0, 40).map((x, idx) => {
    const m = x.match(/compte\s+([0-9A-Za-z]+)/i);
    const acc = m ? m[1] : `w_${idx}`;
    const remKey = `${k}_${acc}_${idx}`;
    const v = remarquesVal[remKey];

    let valBadge = '';
    if (v?.status === 'validated') {
      valBadge = `<span class="badge ok" style="font-size:10.5px; padding:2px 6px;">✅ Validée</span>`;
    } else if (v?.status === 'rejected') {
      valBadge = `<span class="badge warn" style="font-size:10.5px; padding:2px 6px;" title="${esc(v.note || 'Écart justifié')}">❌ Non validée</span>`;
    } else {
      valBadge = `
        <span class="btn-group-rem">
          <button type="button" class="btn-rem-action btn-rem-validate" data-rem-key="${remKey}" data-refresh-bal="${k}" title="Valider cette remarque">✔</button>
          <button type="button" class="btn-rem-action btn-rem-reject" data-rem-key="${remKey}" data-refresh-bal="${k}" title="Ne pas valider cette remarque (justifiée)">✖</button>
        </span>
      `;
    }

    return `<li style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:2px 0;">
      <span>${esc(x)}</span>
      <div style="display:inline-flex; align-items:center; gap:6px;">
        ${valBadge}
        ${acc && !acc.startsWith('w_') ? `<button type="button" class="btn-goto-account link small" data-bal-key="${k}" data-acc="${acc}" style="font-weight:700; white-space:nowrap; color:#b45309;">✏️ Examiner</button>` : ''}
      </div>
    </li>`;
  }).join('');

  $('#rep' + k).innerHTML = `${st}
    <dl style="margin-top:8px"><dt>Comptes</dt><dd>${fmt(t.comptes || 0)}</dd>
    <dt>Soldes d'ouverture D / C</dt><dd>${fmt(t.sad || 0)} / ${fmt(t.sac || 0)}</dd>
    <dt>Mouvements D / C</dt><dd>${fmt(t.md || 0)} / ${fmt(t.mc || 0)}</dd></dl>
    ${p.errors.length ? `<ul class="issues err">${errorsHtml}</ul>` : ''}
    ${p.warnings.length ? `<details><summary class="small">${p.warnings.length} remarque(s) SYSCOHADA</summary><ul class="issues warn">${warningsHtml}</ul></details>` : ''}
    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
      <button type="button" class="btn sm ${p.errors.length ? 'primary' : 'outline'} btn-open-bal" data-bal-key="${k}">
        ${p.errors.length ? '🛠️ Corriger les anomalies' : '🔍 Inspecter & Corriger les ' + (p.rows?.length || 0) + ' comptes'}
      </button>
    </div>`;
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

// ------------------------------------------------------------------ Visualiseur & Éditeur de Balance
let currentBalKey = 'N';
let currentBalRows = [];
let balFilterMode = 'all';
let balSearchQuery = '';
let balCurrentPage = 1;
const BAL_PAGE_SIZE = 50;

function openBalanceEditor(k, options = {}) {
  currentBalKey = k || 'N';
  const d = state.dossier;
  const parsed = d[currentBalKey === 'N' ? 'balN' : 'balN1'];
  const label = currentBalKey === 'N' ? 'Balance N (Exercice en cours)' : 'Balance N-1 (Exercice précédent)';
  
  const titleEl = $('#balModalTitleText');
  if (titleEl) titleEl.textContent = `Visualisation & Correction de la ${label}`;
  const subText = d.company?.nom ? `${esc(d.company.nom)} · ${d.exercise?.date_fin ? 'Clôture au ' + dateFr(d.exercise.date_fin) : ''}` : 'Contrôle des comptes et équilibre comptable';
  const subEl = $('#balModalSub');
  if (subEl) subEl.textContent = subText;

  if (parsed && Array.isArray(parsed.rows) && parsed.rows.length) {
    currentBalRows = parsed.rows.map((r, i) => ({
      id: i + 1,
      acc: String(r[0] ?? ''),
      lib: String(r[1] ?? ''),
      sad: Number(r[2]) || 0,
      sac: Number(r[3]) || 0,
      md: Number(r[4]) || 0,
      mc: Number(r[5]) || 0,
    }));
  } else {
    currentBalRows = [
      { id: 1, acc: '101000', lib: 'Capital social', sad: 0, sac: 10000000, md: 0, mc: 0 },
      { id: 2, acc: '521100', lib: 'Banque', sad: 10000000, sac: 0, md: 5000000, mc: 5000000 },
    ];
  }

  // Appliquer les options de filtrage ou de recherche ciblée
  balFilterMode = options.filter || 'all';
  balSearchQuery = options.search || '';
  balCurrentPage = 1;

  const sInput = $('#balSearchInput');
  if (sInput) sInput.value = balSearchQuery;

  const saveSt = $('#balSaveStatus');
  if (saveSt) {
    if (options.search) {
      saveSt.textContent = `🎯 Compte ${options.search} isolé. Corrigez les montants ci-dessous.`;
    } else if (options.filter === 'errors') {
      saveSt.textContent = `⚠️ Mode correction : affichage des comptes avec anomalies SYSCOHADA.`;
    } else if (options.filter === 'reclassement') {
      saveSt.textContent = `💡 Mode reclassement : comptes 401 débiteurs ou 411 créditeurs.`;
    } else {
      saveSt.textContent = 'Prêt pour modifications.';
    }
  }

  $('#btnFilterAll')?.classList.toggle('active', balFilterMode === 'all' && !balSearchQuery);
  $('#btnFilterErrors')?.classList.toggle('active', balFilterMode === 'errors');
  $('#btnFilterReclassements')?.classList.toggle('active', balFilterMode === 'reclassement');

  computeBalanceLiveStats();
  refreshBalEditorTable();

  const modal = $('#modalBalanceEditor');
  if (modal) modal.hidden = false;

  // Si un compte spécifique est ciblé : le surligner et placer le curseur dessus
  const targetAcc = options.focusAccount || options.search;
  if (targetAcc) {
    setTimeout(() => {
      const targetStr = String(targetAcc).trim();
      const inputEl = document.querySelector(`.bal-table input.acc-input[value="${targetStr}"]`);
      if (inputEl) {
        const rowTr = inputEl.closest('tr');
        if (rowTr) {
          rowTr.scrollIntoView({ behavior: 'smooth', block: 'center' });
          rowTr.classList.add('bal-row-highlight');
          setTimeout(() => rowTr.classList.remove('bal-row-highlight'), 4500);
          const numInp = rowTr.querySelector('input.num-input');
          if (numInp) {
            numInp.focus();
            numInp.select();
          } else {
            inputEl.focus();
          }
        }
      }
    }, 250);
  } else if (options.filter === 'errors') {
    // Focaliser la première anomalie
    setTimeout(() => {
      const firstErrRow = document.querySelector('.bal-table tr.bal-row-err') || document.querySelector('.bal-table tr.bal-row-warn');
      if (firstErrRow) {
        firstErrRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstErrRow.classList.add('bal-row-highlight');
        setTimeout(() => firstErrRow.classList.remove('bal-row-highlight'), 3500);
        const firstNum = firstErrRow.querySelector('input.num-input');
        if (firstNum) {
          firstNum.focus();
          firstNum.select();
        }
      }
    }, 250);
  }
}

function computeBalanceLiveStats() {
  const label = currentBalKey === 'N' ? 'Balance N' : 'Balance N-1';
  const sysCheck = checkSyscohadaRules(currentBalRows, label);
  const { errors, warnings, sysAlerts, rowAlertsMap, totals } = sysCheck;

  let errCount = 0;
  let recCount = 0;

  currentBalRows.forEach(r => {
    const accStr = String(r.acc || '').trim().replace(/\s/g, '');
    const alerts = rowAlertsMap.get(accStr) || [];
    r.sysAlerts = alerts;
    r.hasErr = alerts.some(a => a.type === 'error');
    r.hasWarn = alerts.some(a => a.type === 'warning');
    r.hasReclassement = alerts.some(a => a.type === 'reclassement');
    if (r.hasErr || r.hasWarn) errCount++;
    if (r.hasReclassement) recCount++;
  });

  const count = currentBalRows.length;
  const kpiComptes = $('#balKpiComptes');
  if (kpiComptes) kpiComptes.textContent = `${count} compte${count > 1 ? 's' : ''}`;
  const modalBadge = $('#balModalBadge');
  if (modalBadge) modalBadge.textContent = `${count} compte${count > 1 ? 's' : ''}`;

  const kpiSadSac = $('#balKpiSadSac');
  if (kpiSadSac) kpiSadSac.textContent = `${fmt(totals.sad)} / ${fmt(totals.sac)}`;
  const kpiMdMc = $('#balKpiMdMc');
  if (kpiMdMc) kpiMdMc.textContent = `${fmt(totals.md)} / ${fmt(totals.mc)}`;
  const kpiCloture = $('#balKpiCloture');
  if (kpiCloture) kpiCloture.textContent = `${fmt(totals.clDebTot)} D / ${fmt(totals.clCdtTot)} C`;

  const pillOuv = $('#balPillOuv');
  if (pillOuv) {
    if (Math.abs(totals.ecartOuv) < 1) {
      pillOuv.className = 'bal-kpi-pill ok';
      pillOuv.textContent = 'Équilibré (0 FCFA)';
    } else {
      pillOuv.className = 'bal-kpi-pill bad';
      pillOuv.textContent = `Écart : ${fmt(totals.ecartOuv)} FCFA`;
    }
  }

  const pillMvt = $('#balPillMvt');
  if (pillMvt) {
    if (Math.abs(totals.ecartMvt) < 1) {
      pillMvt.className = 'bal-kpi-pill ok';
      pillMvt.textContent = 'Équilibré (0 FCFA)';
    } else {
      pillMvt.className = 'bal-kpi-pill bad';
      pillMvt.textContent = `Écart : ${fmt(totals.ecartMvt)} FCFA`;
    }
  }

  // Mettre à jour les compteurs des boutons de filtres
  const errBadge = $('#balErrBadgeCount');
  if (errBadge) errBadge.textContent = String(errCount);
  const recBadge = $('#balRecBadgeCount');
  if (recBadge) recBadge.textContent = String(recCount);

  // Rendu du bandeau d'alertes SYSCOHADA (AUDCIF)
  const alertBox = $('#balAlertsBox');
  if (alertBox) {
    const issues = [];
    if (Math.abs(totals.ecartOuv) >= 1) {
      issues.push(`🔴 <b>[SYSCOHADA AUDCIF Art. 34]</b> Déséquilibre d'ouverture : Débit – Crédit = <b>${fmt(totals.ecartOuv)} FCFA</b> (stricte égalité requise).`);
    }
    if (Math.abs(totals.ecartMvt) >= 1) {
      issues.push(`🔴 <b>[SYSCOHADA AUDCIF Art. 17]</b> Principe de la partie double non respecté : Mouvements Débit – Crédit = <b>${fmt(totals.ecartMvt)} FCFA</b>.`);
    }
    const caisseErrs = sysAlerts.filter(a => a.code === 'CAISSE_CREDITRICE');
    if (caisseErrs.length) {
      issues.push(`🔴 <b>[SYSCOHADA Compte 57 - Caisse]</b> ${caisseErrs.length} compte(s) de caisse avec solde créditeur INTERDIT.`);
    }
    const soustrErrs = sysAlerts.filter(a => a.code === 'SOUSTRACTIF_DEBITEUR');
    if (soustrErrs.length) {
      issues.push(`⚠️ <b>[SYSCOHADA Comptes Soustractifs]</b> ${soustrErrs.length} compte(s) d'amortissements/dépréciations à solde débiteur anormal.`);
    }
    if (recCount > 0) {
      issues.push(`💡 <b>[SYSCOHADA AUDCIF Art. 34 - Non-compensation]</b> ${recCount} compte(s) de tiers (fournisseurs débiteurs ou clients créditeurs) à reclasser en 409 ou 419.`);
    }

    if (issues.length) {
      alertBox.hidden = false;
      const isBad = Math.abs(totals.ecartOuv) >= 1 || Math.abs(totals.ecartMvt) >= 1 || caisseErrs.length > 0;
      alertBox.innerHTML = `
        <div class="status-banner ${isBad ? 'bad' : 'warn'}" style="margin:0; padding:8px 14px; font-size:12.5px; line-height:1.45;">
          <div>${issues.join('<br>')}</div>
        </div>
      `;
    } else {
      alertBox.hidden = false;
      alertBox.innerHTML = `
        <div class="status-banner ok" style="margin:0; padding:7px 14px; font-size:12.5px;">
          <div>✅ <b>Balance 100% conforme aux normes SYSCOHADA révisé (AUDCIF).</b> Équilibre rigoureux des ouvertures (Art. 34) et des mouvements (Art. 17).</div>
        </div>
      `;
    }
  }
}

function getFilteredBalRows() {
  let list = currentBalRows;
  if (balSearchQuery) {
    const q = balSearchQuery.toLowerCase();
    list = list.filter(r => String(r.acc || '').toLowerCase().includes(q) || String(r.lib || '').toLowerCase().includes(q));
  }
  if (balFilterMode === 'errors') {
    list = list.filter(r => r.hasErr || r.hasWarn);
  } else if (balFilterMode === 'reclassement') {
    list = list.filter(r => r.hasReclassement);
  }
  return list;
}

function refreshBalEditorTable() {
  const filtered = getFilteredBalRows();
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / BAL_PAGE_SIZE));
  balCurrentPage = Math.min(Math.max(1, balCurrentPage), totalPages);

  const start = (balCurrentPage - 1) * BAL_PAGE_SIZE;
  const end = Math.min(start + BAL_PAGE_SIZE, totalCount);
  const pageRows = filtered.slice(start, end);

  const tbody = $('#balTableBody');
  if (!tbody) return;

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:28px 16px; color:var(--muted);">Aucun compte ne correspond à votre recherche ou filtre.<br><button type="button" class="btn sm outline" id="btnResetBalSearch" style="margin-top:10px;">Afficher tous les comptes</button></td></tr>`;
    $('#btnResetBalSearch')?.addEventListener('click', () => {
      balSearchQuery = '';
      balFilterMode = 'all';
      if ($('#balSearchInput')) $('#balSearchInput').value = '';
      $('#btnFilterAll')?.classList.add('active');
      $('#btnFilterErrors')?.classList.remove('active');
      $('#btnFilterReclassements')?.classList.remove('active');
      refreshBalEditorTable();
    });
  } else {
    let rowsHtml = '';
    pageRows.forEach((r, idx) => {
      const sD = Number(r.sad) || 0;
      const sC = Number(r.sac) || 0;
      const mD = Number(r.md) || 0;
      const mC = Number(r.mc) || 0;
      const cloture = (sD - sC) + (mD - mC);
      const clotureTxt = cloture > 0 ? `${fmt(cloture)} D` : (cloture < 0 ? `${fmt(Math.abs(cloture))} C` : '0');
      const clotureColor = cloture > 0 ? '#15803d' : (cloture < 0 ? '#b45309' : 'var(--muted)');

      let rowClass = '';
      if (r.hasErr) rowClass = 'bal-row-err';
      else if (r.hasWarn) rowClass = 'bal-row-warn';
      else if (r.hasReclassement) rowClass = 'bal-row-rec';

      let diagBadgeHtml = '<span class="bal-sys-badge ok" title="Conforme SYSCOHADA révisé">✅ Conforme</span>';
      if (r.sysAlerts && r.sysAlerts.length) {
        diagBadgeHtml = r.sysAlerts.map(a => {
          const cls = a.type === 'error' ? 'err' : (a.type === 'reclassement' ? 'rec' : 'warn');
          return `<span class="bal-sys-badge ${cls}" title="${esc(a.message)}">${esc(a.badgeText)}</span>`;
        }).join(' ');
      }

      rowsHtml += `
        <tr data-row-id="${r.id}" class="${rowClass}">
          <td style="text-align:center; color:var(--muted); font-size:12px; font-weight:600;">${start + idx + 1}</td>
          <td><input type="text" class="acc-input" data-id="${r.id}" data-col="acc" value="${esc(r.acc)}" placeholder="ex. 411100"></td>
          <td><input type="text" class="lib-input" data-id="${r.id}" data-col="lib" value="${esc(r.lib)}" placeholder="Intitulé du compte"></td>
          <td><input type="number" step="any" class="num-input" data-id="${r.id}" data-col="sad" value="${r.sad !== 0 && r.sad !== null && r.sad !== undefined ? r.sad : ''}" placeholder="0"></td>
          <td><input type="number" step="any" class="num-input" data-id="${r.id}" data-col="sac" value="${r.sac !== 0 && r.sac !== null && r.sac !== undefined ? r.sac : ''}" placeholder="0"></td>
          <td><input type="number" step="any" class="num-input" data-id="${r.id}" data-col="md" value="${r.md !== 0 && r.md !== null && r.md !== undefined ? r.md : ''}" placeholder="0"></td>
          <td><input type="number" step="any" class="num-input" data-id="${r.id}" data-col="mc" value="${r.mc !== 0 && r.mc !== null && r.mc !== undefined ? r.mc : ''}" placeholder="0"></td>
          <td class="th-num cloture-cell" id="cloture-${r.id}" style="color:${clotureColor};">${clotureTxt}</td>
          <td class="diag-cell">${diagBadgeHtml}</td>
          <td style="text-align:center;"><button type="button" class="btn-del-row" data-del-id="${r.id}" title="Supprimer ce compte">🗑️</button></td>
        </tr>
      `;
    });
    tbody.innerHTML = rowsHtml;
  }

  // Mise à jour de la pagination
  const pInfo = $('#balPaginationInfo');
  if (pInfo) {
    pInfo.textContent = totalCount ? `Affichage de ${start + 1} à ${end} sur ${totalCount} compte(s)${balSearchQuery ? ' (résultats filtrés)' : ''}` : '0 compte';
  }
  const pDisplay = $('#balPageDisplay');
  if (pDisplay) pDisplay.textContent = `Page ${balCurrentPage} / ${totalPages}`;
  const btnPrev = $('#btnBalPrevPage');
  if (btnPrev) btnPrev.disabled = (balCurrentPage <= 1);
  const btnNext = $('#btnBalNextPage');
  if (btnNext) btnNext.disabled = (balCurrentPage >= totalPages);
}

// Écouteur global pour la table d'édition de la balance
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.closest('#balTableBody')) return;

  const rowId = Number(el.dataset.id);
  const col = el.dataset.col;
  if (!rowId || !col) return;

  const row = currentBalRows.find(r => r.id === rowId);
  if (!row) return;

  if (col === 'acc' || col === 'lib') {
    row[col] = el.value;
  } else {
    row[col] = el.value === '' ? 0 : Number(el.value);
  }

  // Recalcul en direct du solde net de la ligne
  const sD = Number(row.sad) || 0;
  const sC = Number(row.sac) || 0;
  const mD = Number(row.md) || 0;
  const mC = Number(row.mc) || 0;
  const cloture = (sD - sC) + (mD - mC);
  const cell = document.getElementById(`cloture-${row.id}`);
  if (cell) {
    cell.textContent = cloture > 0 ? `${fmt(cloture)} D` : (cloture < 0 ? `${fmt(Math.abs(cloture))} C` : '0');
    cell.style.color = cloture > 0 ? '#15803d' : (cloture < 0 ? '#b45309' : 'var(--muted)');
  }

  computeBalanceLiveStats();

  // Met à jour la cellule diagnostic de la ligne modifiée en direct
  const rowTr = el.closest('tr');
  if (rowTr) {
    const diagCell = rowTr.querySelector('.diag-cell');
    if (diagCell) {
      if (row.sysAlerts && row.sysAlerts.length) {
        diagCell.innerHTML = row.sysAlerts.map(a => {
          const cls = a.type === 'error' ? 'err' : (a.type === 'reclassement' ? 'rec' : 'warn');
          return `<span class="bal-sys-badge ${cls}" title="${esc(a.message)}">${esc(a.badgeText)}</span>`;
        }).join(' ');
      } else {
        diagCell.innerHTML = '<span class="bal-sys-badge ok" title="Conforme SYSCOHADA révisé">✅ Conforme</span>';
      }
    }
    rowTr.className = row.hasErr ? 'bal-row-err' : (row.hasWarn ? 'bal-row-warn' : (row.hasReclassement ? 'bal-row-rec' : ''));
  }

  const st = $('#balSaveStatus');
  if (st) st.textContent = '⚠️ Modifications non enregistrées…';
});

// Écouteur global de suppression de ligne
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-del-id]');
  if (!btn) return;
  const id = Number(btn.dataset.delId);
  if (!id) return;

  currentBalRows = currentBalRows.filter(r => r.id !== id);
  computeBalanceLiveStats();
  refreshBalEditorTable();
  const st = $('#balSaveStatus');
  if (st) st.textContent = '⚠️ Ligne supprimée (non enregistrée)…';
});

// Ajout d'une nouvelle ligne
$('#btnAddBalRow')?.addEventListener('click', () => {
  const newId = Date.now();
  currentBalRows.unshift({
    id: newId,
    acc: '',
    lib: '',
    sad: 0,
    sac: 0,
    md: 0,
    mc: 0
  });
  balCurrentPage = 1;
  computeBalanceLiveStats();
  refreshBalEditorTable();
  const st = $('#balSaveStatus');
  if (st) st.textContent = '⚠️ Nouveau compte ajouté…';
  setTimeout(() => {
    const firstAccInput = document.querySelector(`input[data-id="${newId}"][data-col="acc"]`);
    if (firstAccInput) firstAccInput.focus();
  }, 100);
});

// Recherche
$('#balSearchInput')?.addEventListener('input', e => {
  balSearchQuery = e.target.value.trim();
  balCurrentPage = 1;
  refreshBalEditorTable();
});

// Filtres
$('#btnFilterErrors')?.addEventListener('click', () => {
  balFilterMode = 'errors';
  balCurrentPage = 1;
  $('#btnFilterErrors')?.classList.add('active');
  $('#btnFilterAll')?.classList.remove('active');
  $('#btnFilterReclassements')?.classList.remove('active');
  refreshBalEditorTable();
});
$('#btnFilterReclassements')?.addEventListener('click', () => {
  balFilterMode = 'reclassement';
  balCurrentPage = 1;
  $('#btnFilterReclassements')?.classList.add('active');
  $('#btnFilterAll')?.classList.remove('active');
  $('#btnFilterErrors')?.classList.remove('active');
  refreshBalEditorTable();
});
$('#btnFilterAll')?.addEventListener('click', () => {
  balFilterMode = 'all';
  balCurrentPage = 1;
  $('#btnFilterAll')?.classList.add('active');
  $('#btnFilterErrors')?.classList.remove('active');
  $('#btnFilterReclassements')?.classList.remove('active');
  refreshBalEditorTable();
});

// Navigation pagination
$('#btnBalPrevPage')?.addEventListener('click', () => {
  if (balCurrentPage > 1) {
    balCurrentPage--;
    refreshBalEditorTable();
  }
});
$('#btnBalNextPage')?.addEventListener('click', () => {
  balCurrentPage++;
  refreshBalEditorTable();
});

// Export Excel
$('#btnExportBalXlsx')?.addEventListener('click', () => {
  const aoa = [
    ['Compte', 'Intitulé', 'Solde ant Dbt', 'Solde ant Cdt', 'Débit période', 'Crédit période'],
    ...currentBalRows.map(r => [
      Number(r.acc) || r.acc,
      r.lib,
      r.sad || null,
      r.sac || null,
      r.md || null,
      r.mc || null
    ])
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 10 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Balance');
  const filename = `Balance_${currentBalKey}_corrigee.xlsx`;
  window.XLSX.writeFile(wb, filename);
  toast(`Fichier ${filename} exporté.`);
});

// Enregistrement des modifications de la balance
$('#btnSaveBalanceEdits')?.addEventListener('click', async () => {
  const d = state.dossier;
  const k = currentBalKey;
  const label = k === 'N' ? 'Balance N' : 'Balance N-1';

  // Validation et normalisation
  const aoa = [
    ['Compte', 'Intitulé', 'Solde ant Dbt', 'Solde ant Cdt', 'Débit période', 'Crédit période'],
    ...currentBalRows.map(r => [
      Number(r.acc) || r.acc,
      r.lib,
      r.sad || null,
      r.sac || null,
      r.md || null,
      r.mc || null
    ])
  ];

  const parsed = parseBalance(aoa, label);
  parsed.ok = !parsed.errors.length;
  d[k === 'N' ? 'balN' : 'balN1'] = parsed;

  renderBalanceReport(k, parsed);
  $('#file' + k).textContent = `Balance_${k}_corrigee.xlsx (${parsed.rows.length} comptes)`;
  $('#btnStep2').disabled = !(d.balN?.ok && d.balN1?.ok);

  // Sauvegarde dans Supabase Storage si un exercice est lié
  if (d.exercise) {
    try {
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 10 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Balance');
      const outBytes = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const newFile = new File([outBytes], `balance_${k === 'N' ? 'n' : 'n1'}_corrigee.xlsx`, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const path = `${d.exercise.company_id}/${d.exercise.id}/balance_${k === 'N' ? 'n' : 'n1'}.xlsx`;
      const type = k === 'N' ? 'balance_n' : 'balance_n1';
      await sb.storage.from('balances').upload(path, newFile, { upsert: true, contentType: newFile.type });
      await sb.from('exercise_files').delete().eq('exercise_id', d.exercise.id).eq('type', type);
      await sb.from('exercise_files').insert({
        exercise_id: d.exercise.id,
        type,
        storage_path: path,
        nom_original: newFile.name,
        taille_octets: newFile.size,
        mime_type: newFile.type
      });

      if (k === 'N') {
        const t = parsed.totals;
        await sb.from('exercises').update({
          nb_comptes: t.comptes || 0,
          total_debit: Math.round((t.sad || 0) + (t.md || 0)),
          total_credit: Math.round((t.sac || 0) + (t.mc || 0)),
          balance_equilibree: parsed.ok,
          ecart_balance: Math.round(((t.sad || 0) + (t.md || 0)) - ((t.sac || 0) + (t.mc || 0)))
        }).eq('id', d.exercise.id);
      }
    } catch (saveErr) {
      console.warn('Erreur sauvegarde balance dans Supabase:', saveErr);
    }
  }

  $('#modalBalanceEditor').hidden = true;
  toast(`✅ ${label} enregistrée avec succès (${parsed.rows.length} comptes) !`);
});

// ------------------------------------------------------------------ Validation des Remarques Client
function getRemarqueValidation(key) {
  return state.dossier?.infos?.remarques_validations?.[key] || null;
}

async function setRemarqueValidation(key, status, note = '') {
  if (!state.dossier) return;
  state.dossier.infos ||= {};
  state.dossier.infos.remarques_validations ||= {};
  if (status === null) {
    delete state.dossier.infos.remarques_validations[key];
  } else {
    state.dossier.infos.remarques_validations[key] = {
      status,
      note: String(note || '').trim(),
      updated_at: new Date().toISOString()
    };
  }
  await saveInfos(true);
}

function refreshRemarquesCounters() {
  const d = state.dossier;
  if (!d) return;
  const remarquesVal = (d.infos && d.infos.remarques_validations) || {};
  const rep = d.exercise?.rapport || {};
  const an = rep.anomalies || [];
  let validCount = 0;
  let rejectCount = 0;
  let pendingCount = 0;
  an.forEach((a, i) => {
    const remKey = `${a.balance || 'N'}_${a.compte}_${i}`;
    const v = remarquesVal[remKey];
    if (v?.status === 'validated') validCount++;
    else if (v?.status === 'rejected') rejectCount++;
    else pendingCount++;
  });
  const elV = $('#countRemValid');
  if (elV) elV.textContent = `✅ ${validCount} validée(s)`;
  const elR = $('#countRemReject');
  if (elR) elR.textContent = `❌ ${rejectCount} non validée(s)`;
  const elP = $('#countRemPending');
  if (elP) elP.textContent = `⏳ ${pendingCount} en attente`;
}

function updateRemarqueRowUI(remKey, valObj) {
  const tr = document.querySelector(`tr[data-rem-row="${remKey}"]`);
  if (!tr) return;
  const tdVal = tr.querySelector('.td-rem-val');
  if (!tdVal) return;

  if (valObj?.status === 'validated') {
    tdVal.innerHTML = `
      <div class="rem-status-box" style="align-items:center;">
        <span class="badge ok" style="font-weight:700;">✅ Remarque validée</span>
        <button type="button" class="link small btn-rem-reset" data-rem-key="${esc(remKey)}" style="font-size:11px; margin-top:2px;">Modifier</button>
      </div>
    `;
    tr.style.background = '#f0fdf4';
  } else if (valObj?.status === 'rejected') {
    tdVal.innerHTML = `
      <div class="rem-status-box" style="align-items:center;">
        <span class="badge warn" style="font-weight:700;">❌ Non validée</span>
        ${valObj.note ? `<div class="small muted" style="font-size:11px; text-align:center;"><em>${esc(valObj.note)}</em></div>` : ''}
        <div style="display:flex; gap:4px; margin-top:2px;">
          <button type="button" class="link small btn-rem-note" data-rem-key="${esc(remKey)}" data-curr-note="${esc(valObj.note || '')}" style="font-size:11px;">✏️ Motif</button>
          <button type="button" class="link small btn-rem-reset" data-rem-key="${esc(remKey)}" style="font-size:11px;">Modifier</button>
        </div>
      </div>
    `;
    tr.style.background = '#fef2f2';
  } else {
    tdVal.innerHTML = `
      <div class="btn-group-rem" style="justify-content:center;">
        <button type="button" class="btn-rem-action btn-rem-validate" data-rem-key="${esc(remKey)}" title="Valider la remarque (considérée comme prise en compte)">
          ✔ Valider
        </button>
        <button type="button" class="btn-rem-action btn-rem-reject" data-rem-key="${esc(remKey)}" title="Ne pas valider la remarque (écart justifié / dérogation)">
          ✖ Ne pas valider
        </button>
      </div>
    `;
    tr.style.background = '';
  }

  refreshRemarquesCounters();
}

// Écouteur global de délégation pour toutes les actions directes de navigation vers correction & validation
document.addEventListener('click', async e => {
  // 1. Bouton "À corriger" / badge d'anomalies de la carte Balance (Étape 2)
  const fixBalBtn = e.target.closest('.btn-fix-balance');
  if (fixBalBtn) {
    e.preventDefault();
    const k = fixBalBtn.dataset.balKey || 'N';
    openBalanceEditor(k, { filter: 'errors' });
    return;
  }

  // 2. Bouton "Corriger ce compte" individuel dans la liste d'erreurs (Étape 2)
  const gotoAccBtn = e.target.closest('.btn-goto-account');
  if (gotoAccBtn) {
    e.preventDefault();
    const k = gotoAccBtn.dataset.balKey || 'N';
    const acc = gotoAccBtn.dataset.acc || '';
    openBalanceEditor(k, { search: acc, focusAccount: acc });
    return;
  }

  // 3. Bouton "Corriger ce compte" individuel dans la table des comptes signalés (Étape 4)
  const fixAnomBtn = e.target.closest('.btn-fix-anomaly');
  if (fixAnomBtn) {
    e.preventDefault();
    const k = fixAnomBtn.dataset.balKey || 'N';
    const acc = fixAnomBtn.dataset.acc || '';
    setStep(2);
    openBalanceEditor(k, { search: acc, focusAccount: acc });
    toast(`🎯 Compte ${acc} ciblé pour correction dans la balance ${k}`);
    return;
  }

  // 4. Boutons d'action diagnostique (Étape 4 : cartes bloquantes ou badges du tableau de contrôles)
  const diagBtn = e.target.closest('.btn-diag-action');
  if (diagBtn) {
    e.preventDefault();
    const code = diagBtn.dataset.diagCode;
    if (code && typeof handleDiagnosticAction === 'function') {
      handleDiagnosticAction(code);
    }
    return;
  }

  // 5. Bouton d'ouverture simple de l'éditeur de balance
  const openBalBtn = e.target.closest('.btn-open-bal, [data-open-editor]');
  if (openBalBtn) {
    e.preventDefault();
    const k = openBalBtn.dataset.balKey || openBalBtn.dataset.openEditor || 'N';
    openBalanceEditor(k);
    return;
  }

  // 6. Validation d'une remarque par le client
  const remValBtn = e.target.closest('.btn-rem-validate');
  if (remValBtn) {
    e.preventDefault();
    const key = remValBtn.dataset.remKey;
    if (!key) return;
    await setRemarqueValidation(key, 'validated');
    toast('✅ Remarque validée par le client');
    if (remValBtn.dataset.refreshBal) {
      const k = remValBtn.dataset.refreshBal;
      const parsed = state.dossier[k === 'N' ? 'balN' : 'balN1'];
      if (parsed) renderBalanceReport(k, parsed);
    } else if (key.startsWith('ctl_')) {
      renderStoredResult(true);
    } else {
      updateRemarqueRowUI(key, { status: 'validated' });
    }
    return;
  }

  // 7. Non-validation / dérogation d'une remarque par le client
  const remRejBtn = e.target.closest('.btn-rem-reject');
  if (remRejBtn) {
    e.preventDefault();
    const key = remRejBtn.dataset.remKey;
    if (!key) return;
    const promptNote = window.prompt("Motif de non-validation ou justification de l'écart (optionnel) :", "Écart justifié / dérogation approuvée par l'entreprise");
    if (promptNote === null) return;
    const note = promptNote.trim() || "Écart justifié / dérogation approuvée";
    await setRemarqueValidation(key, 'rejected', note);
    toast('❌ Remarque marquée comme non validée (justifiée)');
    if (remRejBtn.dataset.refreshBal) {
      const k = remRejBtn.dataset.refreshBal;
      const parsed = state.dossier[k === 'N' ? 'balN' : 'balN1'];
      if (parsed) renderBalanceReport(k, parsed);
    } else if (key.startsWith('ctl_')) {
      renderStoredResult(true);
    } else {
      updateRemarqueRowUI(key, { status: 'rejected', note });
    }
    return;
  }

  // 8. Modifier le motif de non-validation
  const remNoteBtn = e.target.closest('.btn-rem-note');
  if (remNoteBtn) {
    e.preventDefault();
    const key = remNoteBtn.dataset.remKey;
    const curr = remNoteBtn.dataset.currNote || '';
    const newNote = window.prompt("Modifier le motif de non-validation / justification :", curr);
    if (newNote !== null) {
      const note = newNote.trim() || "Écart justifié";
      await setRemarqueValidation(key, 'rejected', note);
      toast('Motif de justification mis à jour');
      updateRemarqueRowUI(key, { status: 'rejected', note });
    }
    return;
  }

  // 9. Réinitialiser la décision sur une remarque
  const remResetBtn = e.target.closest('.btn-rem-reset');
  if (remResetBtn) {
    e.preventDefault();
    const key = remResetBtn.dataset.remKey;
    if (!key) return;
    await setRemarqueValidation(key, null);
    toast('Décision réinitialisée : remarque remise en attente');
    if (key.startsWith('ctl_')) {
      renderStoredResult(true);
    } else {
      updateRemarqueRowUI(key, null);
    }
    return;
  }

  // 10. Validation globale en masse des remarques
  const bulkValBtn = e.target.closest('#btnBulkValidateRemarques');
  if (bulkValBtn) {
    e.preventDefault();
    const d = state.dossier;
    if (!d) return;
    const rep = d.exercise?.rapport || {};
    const an = rep.anomalies || [];
    d.infos ||= {};
    d.infos.remarques_validations ||= {};
    an.forEach((a, i) => {
      const remKey = `${a.balance || 'N'}_${a.compte}_${i}`;
      if (!d.infos.remarques_validations[remKey] || d.infos.remarques_validations[remKey].status !== 'rejected') {
        d.infos.remarques_validations[remKey] = {
          status: 'validated',
          note: 'Validation globale',
          updated_at: new Date().toISOString()
        };
      }
    });
    await saveInfos(true);
    toast(`✅ Toutes les remarques (${an.length}) ont été validées.`);
    renderStoredResult(true);
    return;
  }

  // 11. Réinitialisation globale de toutes les décisions
  const resetAllBtn = e.target.closest('#btnResetAllRemarques');
  if (resetAllBtn) {
    e.preventDefault();
    if (!confirm("Voulez-vous réinitialiser toutes les décisions de validation des remarques ?")) return;
    const d = state.dossier;
    if (!d) return;
    d.infos ||= {};
    d.infos.remarques_validations = {};
    await saveInfos(true);
    toast('Toutes les décisions ont été réinitialisées.');
    renderStoredResult(true);
    return;
  }
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
  const mb = $('#modalBalanceEditor');
  if (mb) mb.hidden = true;
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
    if (state.profile?.is_admin) {
      // Privilège Super-Administrateur : génération illimitée sans décompte de crédits
      try {
        await sb.from('exercises').update({ is_full_version: true, generation_type: 'paid' }).eq('id', d.exercise.id);
      } catch (_) {}
      charged = true;
    } else {
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
        if (mode === 'paid') {
          const cur = Number(state.profile?.credits_balance || 0);
          if (cur < 1) {
            throw new Error('Solde de crédits insuffisant. Veuillez recharger votre compte dans l\'onglet Tarifs & Crédits.');
          }
          const newBal = cur - 1;
          await sb.from('profiles').update({ credits_balance: newBal }).eq('id', state.user.id);
          try {
            await sb.from('credit_ledger').insert({
              user_id: state.user.id,
              company_id: d.exercise.company_id,
              exercise_id: d.exercise.id,
              montant_credits: -1,
              solde_apres: newBal,
              motif: 'generation_complete',
              commentaire: 'Déblocage liasse complète DGID (mode direct)'
            });
          } catch (_) {}
          charged = true;
        } else if (mode === 'free') {
          try {
            await sb.from('companies').update({ free_generation_used: true }).eq('id', d.exercise.company_id);
          } catch (_) {}
        }
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

function renderStoredResult(force = false) {
  const ex = state.dossier?.exercise;
  if (ex?.rapport && (force || (ex.generated_at && !$('#resultBox').innerHTML))) {
    renderResult(ex.rapport, false);
  }
}

const CONTROLS_DIAGNOSTIC = {
  A1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Principe de Clôture et Réouverture des Comptes)',
    explication: 'Le total des débits au 01/01/N n\'est pas égal au total des crédits au 01/01/N. En SYSCOHADA, le bilan d\'ouverture doit être rigoureusement équilibré au premier jour de l\'exercice comptable.',
    causesFrequentes: 'Oubli de l\'écriture d\'affectation du résultat antérieur (compte 13), report à-nouveau déséquilibré généré par votre logiciel comptable, ou solde résiduel sur un compte d\'attente (471).',
    commentRegler: [
      'Cliquez sur le bouton doré ci-dessous <strong>« ✏️ Corriger la Balance N »</strong> pour ouvrir le visualiseur interactif.',
      'Dans l\'éditeur, observez l\'indicateur d\'écart d\'ouverture en rouge dans le bandeau supérieur.',
      'Pour équilibrer, ajustez le solde d\'ouverture du compte <strong>120000</strong> (Report à nouveau créditeur si Débits > Crédits) ou <strong>129000</strong> (Report à nouveau débiteur si Crédits > Débits) ou du compte <strong>130100/130900</strong>.',
      'Cliquez sur <strong>« 💾 Enregistrer les corrections »</strong> en bas à droite pour actualiser automatiquement les états.'
    ],
    ecritureConseillee: 'Équilibre requis : Total Débit 01/01 = Total Crédit 01/01 (Écart requis = 0 FCFA)',
    actionLabel: 'Corriger l\'ouverture de la Balance N (Étape 2)',
    hasAnomalies: false,
  },
  A2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 17 (Principe Fondamental de la Partie Double)',
    explication: 'Le total des mouvements débits de la période est différent du total des mouvements crédits. Chaque opération comptable enregistrée doit comporter une contrepartie exacte.',
    causesFrequentes: 'Une ou plusieurs écritures ont été saisies unilatéralement dans votre logiciel (ex. OD de paie, dotation aux amortissements sans contrepartie, ou importation Excel tronquée).',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Rééquilibrer les mouvements (Étape 2) »</strong>.',
      'L\'éditeur s\'ouvre : vérifiez les totaux de la barre KPI (Total Mouvements Débit vs Total Mouvements Crédit).',
      'Identifiez le compte dont le mouvement n\'a pas de contrepartie équivalente.',
      'Ajustez le débit ou le crédit sur le compte de contrepartie correspondant (ex. compte 521 Banque ou 401 Fournisseurs) pour annuler l\'écart.',
      'Enregistrez les modifications.'
    ],
    ecritureConseillee: 'Règle stricte AUDCIF : Somme(Mouvements Débit) = Somme(Mouvements Crédit)',
    actionLabel: 'Rééquilibrer les mouvements (Étape 2)',
    hasAnomalies: false,
  },
  A3: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 & 37 (Équilibre Bilanciel des Soldes de Clôture)',
    explication: 'La somme de tous les soldes nets débiteurs ne correspond pas à la somme de tous les soldes nets créditeurs au 31/12/N.',
    causesFrequentes: 'Déséquilibre d\'ouverture (A1) ou de mouvements (A2) qui se répercute sur les soldes finaux, ou formule de calcul de solde altérée dans le fichier source.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Corriger la Balance N (Étape 2) »</strong>.',
      'Réglez en priorité les déséquilibres d\'ouverture (colonnes Solde Ant) ou de mouvements.',
      'L\'éditeur recalcule les soldes de clôture en temps réel selon la formule officielle : (Solde Ant Dbt - Solde Ant Cdt) + (Mvt Débit - Mvt Crédit).',
      'Vérifiez que le badge d\'écart affiche 0 FCFA puis cliquez sur Enregistrer.'
    ],
    ecritureConseillee: 'Solde Net Clôture Débiteur = Solde Net Clôture Créditeur',
    actionLabel: 'Corriger la clôture de la Balance N (Étape 2)',
    hasAnomalies: false,
  },
  B1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA Révisé (Nomenclature Officielle des Comptes - PCG OHADA)',
    explication: 'Présence de numéros de comptes obsolètes ou formellement interdits dans le SYSCOHADA Révisé (notamment racine 20 « Frais d\'établissement », racines 74, 76 ou comptes analytiques classe 9).',
    causesFrequentes: 'Utilisation d\'un ancien paramétrage comptable pré-2017 ou maintien de frais d\'établissement à l\'actif du bilan.',
    commentRegler: [
      'Cliquez ci-dessous sur <strong>« 🔍 Voir les comptes signalés »</strong> pour afficher la liste exacte des comptes proscrits.',
      'Pour chaque compte interdit, cliquez sur <strong>« ✏️ Corriger ce compte »</strong> :',
      '<strong>Pour la racine 20 (Frais d\'établissement) :</strong> Transférez le solde brut en charges d\'exploitation au compte <strong>631100</strong> (Frais de constitution) ou <strong>631800</strong>, et annulez le compte d\'amortissement <strong>280</strong> correspondant.',
      '<strong>Pour les comptes 74 ou 76 :</strong> Reclassez-les vers les comptes autorisés <strong>70</strong> (Ventes/Prestations), <strong>75</strong> (Autres produits) ou <strong>77</strong> (Produits financiers).',
      'Supprimez ou mettez à zéro les lignes des anciens comptes 20, 74, 76 dans l\'éditeur, puis enregistrez.'
    ],
    ecritureConseillee: 'Reclassement racine 20 : Débit 631100 (Frais de constitution) / Crédit 201100 ; Débit 280100 / Crédit 631100',
    actionLabel: 'Reclasser les comptes interdits (Étape 2)',
    hasAnomalies: true,
  },
  B2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'DGID Sénégal (Table Officielle de Correspondance Sen-etafi)',
    explication: 'Des comptes à 6 chiffres présents dans votre balance ne figurent pas dans la nomenclature officielle paramétrée par la Direction Générale des Impôts et des Domaines (DGID).',
    causesFrequentes: 'Création de sous-comptes personnalisés avec des racines non homologuées, ou longueur de compte différente de 6 chiffres.',
    commentRegler: [
      'Consultez la table des comptes signalés ci-dessous marqués <em>« [SYSCOHADA / DGID] Compte non classé »</em>.',
      'Cliquez sur <strong>« ✏️ Corriger ce compte »</strong> en face de chaque compte non classé.',
      'Dans l\'éditeur, modifiez le numéro de compte pour le rattacher à la racine officielle SYSCOHADA la plus proche à 6 chiffres (ex. remplacer 411999 par 411100 Clients ordinaires, 401999 par 401100 Fournisseurs ordinaires).',
      'Enregistrez les corrections pour que Sen-etafi reconnaisse l\'ensemble des postes.'
    ],
    ecritureConseillee: 'Chaque compte doit comporter 6 chiffres et débuter par une racine reconnue du plan OHADA (classes 1 à 8)',
    actionLabel: 'Harmoniser les comptes avec la table DGID',
    hasAnomalies: true,
  },
  B4: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA (Principe de Séparation des Exercices & Apurement des Produits et Charges)',
    explication: 'Des comptes de résultat (charges classe 6, produits classe 7 ou 8) comportent un solde d\'ouverture au 01/01. En SYSCOHADA, les comptes de gestion doivent obligatoirement démarrer à zéro à chaque nouvel exercice.',
    causesFrequentes: 'Votre logiciel comptable a généré les à-nouveaux sans apurer les comptes de gestion de l\'exercice précédent.',
    commentRegler: [
      'Cliquez sur le bouton doré <strong>« ✏️ Mettre à zéro l\'ouverture des classes 6/7/8 »</strong>.',
      'L\'éditeur interactif s\'ouvre, automatiquement filtré sur les classes de gestion.',
      'Pour chaque ligne de classe 6, 7 et 8 : saisissez <strong>0</strong> dans les colonnes <em>Solde Ant Dbt</em> et <em>Solde Ant Cdt</em>.',
      'Reportez le solde net total vers le compte <strong>120000</strong> (Report à nouveau créditeur) ou <strong>129000</strong> (Report à nouveau débiteur) au 01/01 pour maintenir l\'équilibre.',
      'Cliquez sur <strong>« 💾 Enregistrer les corrections »</strong>.'
    ],
    ecritureConseillee: 'Règle stricte : Soldes d\'ouverture Débit et Crédit = 0 FCFA pour tous les comptes débutant par 6, 7 ou 8',
    actionLabel: 'Mettre à zéro l\'ouverture des classes 6/7/8',
    hasAnomalies: true,
  },
  C1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 30 à 33 (Concordance du Résultat Net)',
    explication: 'Le résultat net de la période calculé à partir de la balance générale (Total Produits classe 7/8 - Total Charges classe 6/8) ne concorde pas avec le résultat net calculé au Compte de Résultat officiel (poste CK).',
    causesFrequentes: 'Un compte de charge ou de produit n\'a pas été rattaché à une rubrique officielle, écriture d\'impôt sur les sociétés (891) saisie de façon asymétrique, ou omission d\'un sous-compte HAO.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier la concordance de résultat »</strong>.',
      'Vérifiez dans la balance que tous les comptes de produits (70 à 79) et charges (60 à 69) ont bien un solde conforme.',
      'Vérifiez le compte <strong>891000 Impôts sur les bénéfices</strong> : son montant doit être rigoureusement égal à la ligne d\'impôt du compte de résultat.',
      'Assurez-vous qu\'aucun compte de produit ou de charge n\'a été omis de la balance générale.'
    ],
    ecritureConseillee: 'Résultat Balance = Somme(Produits) - Somme(Charges) = Résultat Net Compte de Résultat (Poste CK)',
    actionLabel: 'Vérifier la concordance de résultat (Étape 2)',
    hasAnomalies: false,
  },
  C2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Égalité Fondamentale Actif = Passif)',
    explication: 'Le total de l\'Actif net du bilan n\'est pas égal au total du Passif (Capitaux Propres + Dettes). Le bilan est déséquilibré.',
    causesFrequentes: 'Le résultat net de l\'exercice n\'a pas été rattaché au compte 131 (bénéfice) ou 139 (perte) dans les capitaux propres, ou des comptes soustractifs d\'actif (28 Amortissements, 29/39/49 Dépréciations) ont été saisis au débit.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier les comptes de bilan »</strong>.',
      'Vérifiez que le résultat de l\'exercice est bien intégré dans la balance au compte <strong>131100</strong> (si bénéfice) ou <strong>139100</strong> (si perte).',
      'Assurez-vous que tous les amortissements (comptes 28x) ont un solde créditeur ou nul (jamais débiteur).',
      'Contrôlez que les capitaux propres (classe 1) et les dettes (classes 16 et 4) s\'additionnent exactement au total de l\'actif net.',
      'Enregistrez les corrections.'
    ],
    ecritureConseillee: 'Affectation au bilan : Résultat de l\'exercice au compte 131100 (au crédit) ou 139100 (au débit avec signe négatif)',
    actionLabel: 'Vérifier l\'équilibre Bilan Actif / Passif',
    hasAnomalies: false,
  },
  C3: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA (Cohérence du Tableau des Flux de Trésorerie TFT)',
    explication: 'La variation de trésorerie nette issue du Tableau des Flux (TFT - poste ZF) est différente de la variation réelle des disponibilités entre l\'ouverture et la clôture au Bilan.',
    causesFrequentes: 'Incohérence sur les comptes de trésorerie (52 Banque, 57 Caisse), ou confusion entre découverts bancaires à court terme (561) et emprunts financiers (16).',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier la trésorerie »</strong>.',
      'Contrôlez vos comptes de disponibilités : 521 Banque et 571 Caisse.',
      'Vérifiez que la caisse (57) ne présente aucun solde créditeur (strictement interdit en SYSCOHADA).',
      'Vérifiez que les crédits de trésorerie bancaire sont bien comptabilisés au compte <strong>561000 Crédits de trésorerie</strong> et non en déduction de l\'actif.'
    ],
    ecritureConseillee: 'Trésorerie Nette = (Disponibilités Actif 52 + 57) - (Trésorerie Passif 561 Découverts)',
    actionLabel: 'Vérifier les comptes de trésorerie (Étape 2)',
    hasAnomalies: false,
  },
  C4: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA (Cascade des Soldes Intermédiaires de Gestion SIG)',
    explication: 'Incohérence arithmétique dans les cumuls des soldes intermédiaires de gestion du Compte de Résultat (Marge Brute, Valeur Ajoutée, EBE, Résultat d\'Exploitation).',
    causesFrequentes: 'Modification manuelle d\'un sous-total ou cellule de charges externes (62, 63) mal positionnée.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier le compte de résultat »</strong>.',
      'Contrôlez la séquence des SIG : Marge Brute -> Valeur Ajoutée (+ Autres Produits - Charges externes 61/62/63) -> EBE (- Charges personnel 66) -> Résultat d\'exploitation (+ Reprises - Dotations 68).',
      'Assurez-vous qu\'aucune charge d\'exploitation n\'a été omise.'
    ],
    ecritureConseillee: 'Cascade SIG : Marge Brute -> Valeur Ajoutée -> EBE -> Résultat d\'Exploitation -> Résultat Net',
    actionLabel: 'Vérifier la cascade des SIG',
    hasAnomalies: false,
  },
  D1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Intangibilité Bilan d\'Ouverture - Capitaux Propres)',
    explication: 'L\'ouverture N des Capitaux Propres (classe 1) ne concorde pas avec la clôture N-1 majorée du résultat N-1.',
    causesFrequentes: 'L\'affectation du résultat de l\'exercice N-1 (décidée en Assemblée Générale) n\'a pas été enregistrée dans la balance d\'ouverture N, ou la balance N-1 chargée ne correspond pas à la version définitive arrêtée.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier les capitaux propres (Étape 2) »</strong>.',
      'Dans la Balance N, vérifiez la répartition des à-nouveaux entre le capital (101), les réserves (11) et le report à nouveau (12).',
      'Vérifiez que le résultat N-1 a bien été soldé vers les réserves ou le report à nouveau conformément aux décisions d\'affectation.',
      'Assurez-vous que le montant total des capitaux propres au 01/01/N égale rigoureusement le montant de clôture au 31/12/N-1.'
    ],
    ecritureConseillee: 'Affectation du résultat N-1 : Débit 131 (Résultat bénéficiaire) / Crédit 11 (Réserves) ou 12 (Report à nouveau)',
    actionLabel: 'Vérifier les capitaux propres (Étape 2)',
    hasAnomalies: false,
  },
  D2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Intangibilité Bilan d\'Ouverture - Immobilisations Brutes)',
    explication: 'Les valeurs brutes des immobilisations (classe 2) au 01/01/N sont différentes des valeurs de clôture arrêtées au 31/12/N-1.',
    causesFrequentes: 'Des écritures d\'acquisition ou de cession d\'actifs ont été antidatées au 01/01 au lieu d\'être comptabilisées dans les mouvements de l\'exercice.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier la classe 2 (Étape 2) »</strong>.',
      'Pour chaque compte d\'immobilisation (21, 22, 23, 24) : vérifiez que le montant dans la colonne <em>Solde Ant Dbt</em> au 01/01/N est strictement identique au solde de clôture au 31/12/N-1.',
      'Toute nouvelle acquisition ou mise au rebut doit figurer dans les <strong>Mouvements de la période</strong> et non dans les à-nouveaux d\'ouverture.'
    ],
    ecritureConseillee: 'Solde Brut Ouverture N = Solde Brut Clôture N-1 pour tous les comptes de classe 2',
    actionLabel: 'Vérifier les immobilisations (Étape 2)',
    hasAnomalies: false,
  },
  D3: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Intangibilité Bilan d\'Ouverture - Stocks)',
    explication: 'Le stock initial au 01/01/N (classe 3) ne correspond pas au stock final constaté au 31/12/N-1.',
    causesFrequentes: 'Modification de la valorisation de l\'inventaire physique sans mise à jour rétrospective.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier les stocks (Étape 2) »</strong>.',
      'Vérifiez les comptes de stock (31 Marchandises, 32 Matières premières, 36 Produits finis).',
      'Assurez-vous que le solde d\'ouverture N de chaque compte de stock est exactement égal au solde de clôture N-1.',
      'La variation de stock de l\'exercice s\'opère via les mouvements avec les comptes 603 ou 73.'
    ],
    ecritureConseillee: 'Stock Initial au 01/01/N = Stock Final au 31/12/N-1 (Comptes 31 à 38)',
    actionLabel: 'Vérifier les stocks (Étape 2)',
    hasAnomalies: false,
  },
  D4: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Intangibilité Bilan d\'Ouverture - Tiers)',
    explication: 'Les reports à-nouveau des comptes de tiers (classe 4 : fournisseurs, clients, personnel, État) au 01/01/N ne concordent pas avec les clôtures N-1.',
    causesFrequentes: 'Des factures ou règlements de l\'exercice N-1 ont été imputés rétroactivement dans le logiciel comptable après l\'arrêté des comptes.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier la classe 4 (Étape 2) »</strong>.',
      'Vérifiez les comptes 401 (Fournisseurs), 411 (Clients), 42 (Personnel), 43/44 (Organismes sociaux et État).',
      'Assurez-vous que chaque solde au 01/01/N reporte fidèlement le solde arrêté au 31/12/N-1.',
      'Les règlements intervenus en N doivent être enregistrés dans les mouvements de l\'année.'
    ],
    ecritureConseillee: 'Reports Tiers 01/01/N = Soldes Tiers 31/12/N-1',
    actionLabel: 'Vérifier les comptes de tiers (Étape 2)',
    hasAnomalies: false,
  },
  D5: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 34 (Intangibilité Bilan d\'Ouverture - Trésorerie)',
    explication: 'Les soldes d\'ouverture de banque et de caisse (classe 5) au 01/01/N ne correspondent pas aux soldes arrêtés au 31/12/N-1.',
    causesFrequentes: 'Rapprochement bancaire décalé ou écriture d\'ajustement de caisse saisie à cheval sur deux exercices.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier la classe 5 (Étape 2) »</strong>.',
      'Vérifiez vos comptes 521 Banque et 571 Caisse au 01/01/N.',
      'Le solde de caisse et les soldes d\'extraits bancaires au 01/01/N doivent être rigoureusement égaux à ceux au 31/12/N-1.'
    ],
    ecritureConseillee: 'Soldes Disponibilités 01/01/N = Soldes Disponibilités 31/12/N-1',
    actionLabel: 'Vérifier la trésorerie (Étape 2)',
    hasAnomalies: false,
  },
  E7: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA AUDCIF Art. 42 (Plafond Légal des Amortissements)',
    explication: 'Le montant cumulé des amortissements (classe 28) d\'une immobilisation dépasse sa valeur brute d\'acquisition (classe 2x). En comptabilité, un bien ne peut jamais être amorti au-delà de 100% de son coût d\'origine.',
    causesFrequentes: 'Poursuite automatique des dotations aux amortissements sur un matériel déjà totalement amorti, ou sortie d\'actif enregistrée de manière partielle sans annuler le compte 28 correspondant.',
    commentRegler: [
      'Cliquez sur <strong>« ✏️ Vérifier les amortissements »</strong>.',
      'Dans l\'éditeur, repérez les comptes 28x dont le crédit excède le débit du compte d\'immobilisation 2x correspondant.',
      'Ajustez le compte 28x pour plafonner son solde au montant exact de la valeur brute d\'origine.',
      'Si le bien a été cédé ou mis au rebut, enregistrez la sortie totale de l\'actif.',
      'Enregistrez les modifications.'
    ],
    ecritureConseillee: 'Plafond légal : Solde Créditeur Compte 28x <= Solde Débiteur Compte 2x correspondant ; Sortie d\'actif : Débit 28x / Crédit 2x',
    actionLabel: 'Vérifier les amortissements (Étape 2)',
    hasAnomalies: true,
  },
  E8: {
    cible: 'Étape 3 (Informations)',
    step: 3,
    norme: 'SYSCOHADA Note Annexe 13 (Rapprochement du Capital Social)',
    explication: 'Le total du capital social déclaré dans le tableau des associés/actionnaires de la Note 13 ne concorde pas avec le compte 101000 au Bilan.',
    causesFrequentes: 'Le tableau des associés à l\'Étape 3 n\'a pas encore été rempli, ou le nombre de parts multiplié par le nominal donne un total différent du solde du compte 101.',
    commentRegler: [
      'Cliquez sur le bouton doré <strong>« ✏️ Remplir la Note 13 (Étape 3) »</strong>.',
      'La page bascule automatiquement à l\'Étape 3 et fait défiler la vue sur le tableau <em>« Capital – associés (Note 13) »</em>.',
      'Renseignez les noms des associés, le nombre de parts et le montant total souscrit.',
      'Vérifiez que la somme de la colonne <em>« Montant total (FCFA) »</em> est rigoureusement égale au montant du compte 101000 de votre balance.',
      'Enregistrez et relancez la génération.'
    ],
    ecritureConseillee: 'Note 13 : Somme des montants des associés = Solde du compte 101000 au Bilan',
    actionLabel: 'Remplir la Note 13 (Étape 3)',
    hasAnomalies: false,
  },
  F1: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA (Structure & Format de Balance Générale)',
    explication: 'Le fichier Excel de balance importé comporte une anomalie structurelle (numéros de comptes non reconnus, colonnes décalées ou lignes de sous-totaux intercalées).',
    causesFrequentes: 'Export de balance avec en-têtes multiples ou lignes de titres (ex: "TOTAL CLASSE 2") directement dans les données.',
    commentRegler: [
      'Téléchargez notre modèle officiel de balance via le bouton à l\'Étape 2.',
      'Vérifiez que votre fichier contient exactement 6 colonnes sans lignes de sous-totaux intermédiaires.',
      'Rechargez le fichier conforme à l\'Étape 2.'
    ],
    ecritureConseillee: 'Structure attendue : 6 colonnes (Compte, Intitulé, Solde Ant Dbt, Solde Ant Cdt, Mvt Débit, Mvt Crédit)',
    actionLabel: 'Recharger la balance (Étape 2)',
    hasAnomalies: false,
  },
  F2: {
    cible: 'Étape 2 (Balances)',
    step: 2,
    norme: 'SYSCOHADA (Capacité & Exhaustivité des Comptes)',
    explication: 'La balance dépasse le seuil maximal de lignes ou la ligne de total de fin de fichier a été altérée.',
    causesFrequentes: 'Fichier contenant plus de 5 000 lignes ou formules corrompues dans les totaux.',
    commentRegler: [
      'Vérifiez que la balance ne comporte pas de lignes vides superflues en fin de fichier.',
      'Réexportez la balance depuis votre progiciel comptable en format standard xlsx.'
    ],
    ecritureConseillee: 'Format standard : données compactes sans cellules fusionnées',
    actionLabel: 'Vérifier le fichier (Étape 2)',
    hasAnomalies: false,
  }
};

function handleDiagnosticAction(code) {
  const diag = CONTROLS_DIAGNOSTIC[code];
  if (!diag) {
    setStep(2);
    openBalanceEditor('N', { filter: 'errors' });
    return;
  }
  if (diag.step === 3) {
    setStep(3);
    setTimeout(() => {
      const el = document.querySelector('input[data-k="capital_social"], input[data-t="t13"], details[open]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    toast(`Contrôle ${code} : Complétez la Note 13 (Capital social) à l'Étape 3`);
    return;
  }

  // Étape 2 : Balances
  setStep(2);
  const balKey = /n-1/i.test(diag.actionLabel || '') || /n1/i.test(code) ? 'N-1' : 'N';

  if (code === 'B4') {
    openBalanceEditor(balKey, { search: '6', filter: 'errors' });
    toast(`Balance ${balKey} (${code}) : Remettez à zéro les soldes d'ouverture des comptes de résultat (classes 6, 7, 8)`);
  } else if (diag.hasAnomalies) {
    openBalanceEditor(balKey, { filter: 'errors' });
    toast(`Balance ${balKey} (${code}) : Liste des comptes avec anomalies SYSCOHADA affichée`);
  } else {
    openBalanceEditor(balKey, { filter: 'errors' });
    toast(`Balance ${balKey} (${code}) : Corrigez les soldes ou écritures dans l'éditeur`);
  }
}

function renderResult(r, fresh) {
  const d = state.dossier;
  const isLimited = (d.exercise?.generation_type === 'free' && !d.exercise?.is_full_version) || !!r.isLimited;
  const cls = r.bloquants ? 'bad' : (r.vigilance || r.infosManquantes) ? 'warn' : 'ok';
  const title = r.bloquants ? `${r.bloquants} contrôle(s) bloquant(s) à corriger avant dépôt` : r.infosManquantes ? `${r.infosManquantes} information(s) obligatoire(s) à compléter` : r.vigilance ? 'Liasse cohérente – points de vigilance à examiner' : 'Liasse prête pour le dépôt Sen-etafi';
  const pct = v => (typeof v === 'number' ? (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '');
  const val = (l, v) => (/marge/i.test(l) ? pct(v) : fmt(v));
  const kpis = (r.chiffresCles || []).map(k => `<div class="kpi"><div class="l">${esc(k.libelle)}</div><div class="v">${esc(val(k.libelle, k.n))}</div><div class="d">N-1 : ${esc(val(k.libelle, k.n1))}${typeof k.variation === 'number' && !/marge/i.test(k.libelle) ? ' · ' + pct(k.variation) : ''}</div></div>`).join('');
  const an = r.anomalies || [];
  const remarquesVal = (d.infos && d.infos.remarques_validations) || {};

  // Calcul des compteurs de décisions client
  let validCount = 0;
  let rejectCount = 0;
  let pendingCount = 0;
  an.forEach((a, i) => {
    const remKey = `${a.balance || 'N'}_${a.compte}_${i}`;
    const v = remarquesVal[remKey];
    if (v?.status === 'validated') validCount++;
    else if (v?.status === 'rejected') rejectCount++;
    else pendingCount++;
  });

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
                  <span class="badge bad" style="font-weight:700; font-size:12px; padding:3px 8px;">⛔ Bloquant · Contrôle ${esc(c.code)}</span>
                  <strong style="margin-left:8px; font-size:14.5px; color:#111827;">${esc(c.libelle)}</strong>
                </div>
                <span class="diag-ecart" style="font-size:13px; font-weight:800; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:3px 10px; border-radius:6px;">${esc(ecartTxt)}</span>
              </div>
              <div class="diag-card-body" style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
                ${diag.norme ? `<div><span class="badge neutral" style="font-weight:700; color:#1e3a8a; background:#eff6ff; border:1px solid #bfdbfe; font-size:11.5px; padding:3px 8px;">📜 ${esc(diag.norme)}</span></div>` : ''}
                
                <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:8px 12px;">
                  <div style="font-weight:700; color:#374151; font-size:12.5px; margin-bottom:2px; display:flex; align-items:center; gap:5px;">
                    <span>🔍</span> <strong>Que signifie ce blocage ?</strong>
                  </div>
                  <p style="margin:0; color:#4b5563; line-height:1.45; font-size:13px;">${esc(diag.explication || diag.cause)}</p>
                </div>

                ${diag.causesFrequentes ? `
                  <div style="background:#fffbeb; border:1px solid #fef08a; border-radius:6px; padding:8px 12px;">
                    <div style="font-weight:700; color:#854d0e; font-size:12.5px; margin-bottom:2px; display:flex; align-items:center; gap:5px;">
                      <span>⚠️</span> <strong>Causes fréquentes constatées :</strong>
                    </div>
                    <p style="margin:0; color:#713f12; line-height:1.45; font-size:13px;">${esc(diag.causesFrequentes)}</p>
                  </div>
                ` : ''}

                <div style="background:#fefce8; border-left:4px solid #eab308; border-radius:0 6px 6px 0; padding:10px 14px;">
                  <div style="font-weight:800; color:#78350f; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                    <span>🛠️</span> <strong>Comment régler étape par étape :</strong> <span class="badge neutral" style="font-size:11px; margin-left:6px;">[${esc(diag.cible)}]</span>
                  </div>
                  ${Array.isArray(diag.commentRegler) ? `
                    <ol style="margin:4px 0 0 18px; padding:0; color:#78350f; font-size:13px; line-height:1.55;">
                      ${diag.commentRegler.map(stepTxt => `<li style="margin-bottom:3px;">${stepTxt}</li>`).join('')}
                    </ol>
                  ` : `<p style="margin:0; color:#78350f; font-size:13px; line-height:1.5;">${esc(diag.solution)}</p>`}
                </div>

                ${diag.ecritureConseillee ? `
                  <div style="background:#f0fdf4; border:1px dashed #86efac; border-radius:6px; padding:6px 12px;">
                    <span style="font-weight:700; color:#166534; font-size:12px;">💡 Règle / Écriture comptable conseillée :</span>
                    <div style="font-family:monospace; font-size:12px; color:#14532d; font-weight:600; margin-top:2px;">${esc(diag.ecritureConseillee)}</div>
                  </div>
                ` : ''}
              </div>
              <div class="diag-card-foot" style="margin-top:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; border-top:1px solid #f3f4f6; padding-top:10px;">
                <button type="button" class="btn sm gold btn-diag-action" data-diag-code="${esc(c.code)}" style="font-weight:800; padding:6px 16px; font-size:12.5px;">✏️ ${esc(diag.actionLabel)}</button>
                ${diag.hasAnomalies && an.length ? `<button type="button" class="btn sm ghost" data-open-anomalies="true">🔍 Voir les comptes signalés (${an.length})</button>` : ''}
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

  // Tableau des contrôles avec repères visuels clairs et décision client
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

    let ctlDecisionHtml = '';
    if (!isBloquant && isFail) {
      const ctlKey = `ctl_${c.code}`;
      const ctlVal = remarquesVal[ctlKey];
      if (ctlVal?.status === 'validated') {
        ctlDecisionHtml = `<span class="badge ok" style="font-size:11px; margin-left:6px;" title="Vigilance validée par le client">✅ Validé</span> <button type="button" class="link small btn-rem-reset" data-rem-key="${ctlKey}" style="font-size:10px;">↺</button>`;
      } else if (ctlVal?.status === 'rejected') {
        ctlDecisionHtml = `<span class="badge warn" style="font-size:11px; margin-left:6px;" title="${esc(ctlVal.note || 'Écart justifié')}">❌ Dérogation</span> <button type="button" class="link small btn-rem-reset" data-rem-key="${ctlKey}" style="font-size:10px;">↺</button>`;
      } else {
        ctlDecisionHtml = `
          <span class="btn-group-rem" style="margin-left:6px;">
            <button type="button" class="btn-rem-action btn-rem-validate" data-rem-key="${ctlKey}" title="Valider ce point de vigilance">✔</button>
            <button type="button" class="btn-rem-action btn-rem-reject" data-rem-key="${ctlKey}" title="Ne pas valider (dérogation justifiée)">✖</button>
          </span>
        `;
      }
    }

    return `<tr class="${rowClass}" data-kind="${filterKind}">
      <td><b>${esc(c.code)}</b></td>
      <td>
        <div>${esc(c.libelle)} ${isBloquant ? '<span class="badge ' + (isFail ? 'bad' : 'neutral') + '">bloquant</span>' : '<span class="badge neutral">vigilance</span>'}</div>
        ${guideNote}
      </td>
      <td class="num">${esc(typeof c.n === 'number' ? fmt(c.n) : c.n ?? '')}</td>
      <td class="num">${esc(typeof c.n1 === 'number' ? fmt(c.n1) : c.n1 ?? '')}</td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          ${isOk ? '<span class="badge ok">OK</span>' : `<button type="button" class="badge ${isBloquant ? 'bad' : 'warn'} btn-diag-action" data-diag-code="${esc(c.code)}" style="font-weight:700; cursor:pointer; border:none; padding:4px 9px; font-size:12px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;" title="Cliquer pour aller directement corriger">${isBloquant ? '⛔ À corriger ➜' : '⚠️ À vérifier ➜'}</button>`}
          ${ctlDecisionHtml}
        </div>
      </td>
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
    ${an.length ? `<details style="margin-top:14px" id="detailsAnomalies" open><summary><span>⚠️ ${r.nbAnomalies || an.length} compte(s) signalé(s) dans les balances (SYSCOHADA)</span></summary>
      <div class="rem-summary-bar">
        <div class="rem-summary-counts">
          <span class="count-item"><strong>Décisions client sur les remarques :</strong></span>
          <span class="count-item"><span class="badge ok" id="countRemValid">✅ ${validCount} validée(s)</span></span>
          <span class="count-item"><span class="badge warn" id="countRemReject">❌ ${rejectCount} non validée(s)</span></span>
          <span class="count-item"><span class="badge neutral" id="countRemPending">⏳ ${pendingCount} en attente</span></span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button type="button" class="btn sm outline" id="btnBulkValidateRemarques" title="Valider en masse toutes les remarques en attente">✔ Tout valider</button>
          <button type="button" class="btn sm ghost" id="btnResetAllRemarques" title="Réinitialiser toutes les décisions">🔄 Réinitialiser</button>
        </div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead>
          <tr>
            <th>Balance</th>
            <th>Compte</th>
            <th>Intitulé</th>
            <th style="text-align:right;">Solde</th>
            <th>Observation SYSCOHADA</th>
            <th style="text-align:center; width:200px;">Validation client</th>
            <th style="text-align:center; width:150px;">Action directe</th>
          </tr>
        </thead>
        <tbody>
          ${an.map((a, i) => {
            const remKey = `${a.balance || 'N'}_${a.compte}_${i}`;
            const v = remarquesVal[remKey];
            let valCell = '';
            let rowBg = '';
            if (v?.status === 'validated') {
              rowBg = 'style="background:#f0fdf4;"';
              valCell = `
                <div class="rem-status-box" style="align-items:center;">
                  <span class="badge ok" style="font-weight:700;">✅ Remarque validée</span>
                  <button type="button" class="link small btn-rem-reset" data-rem-key="${esc(remKey)}" style="font-size:11px; margin-top:2px;">Modifier</button>
                </div>
              `;
            } else if (v?.status === 'rejected') {
              rowBg = 'style="background:#fef2f2;"';
              valCell = `
                <div class="rem-status-box" style="align-items:center;">
                  <span class="badge warn" style="font-weight:700;">❌ Non validée</span>
                  ${v.note ? `<div class="small muted" style="font-size:11px; text-align:center;"><em>${esc(v.note)}</em></div>` : ''}
                  <div style="display:flex; gap:4px; margin-top:2px;">
                    <button type="button" class="link small btn-rem-note" data-rem-key="${esc(remKey)}" data-curr-note="${esc(v.note || '')}" style="font-size:11px;">✏️ Motif</button>
                    <button type="button" class="link small btn-rem-reset" data-rem-key="${esc(remKey)}" style="font-size:11px;">Modifier</button>
                  </div>
                </div>
              `;
            } else {
              valCell = `
                <div class="btn-group-rem" style="justify-content:center;">
                  <button type="button" class="btn-rem-action btn-rem-validate" data-rem-key="${esc(remKey)}" title="Valider la remarque (considérée comme prise en compte)">
                    ✔ Valider
                  </button>
                  <button type="button" class="btn-rem-action btn-rem-reject" data-rem-key="${esc(remKey)}" title="Ne pas valider la remarque (écart justifié / dérogation)">
                    ✖ Ne pas valider
                  </button>
                </div>
              `;
            }

            return `<tr data-rem-row="${esc(remKey)}" ${rowBg}>
              <td><span class="badge neutral" style="font-weight:700;">${esc(a.balance || 'N')}</span></td>
              <td><strong>${esc(a.compte)}</strong></td>
              <td>${esc(a.intitule)}</td>
              <td class="num font-mono">${fmt(a.solde)}</td>
              <td><span style="color:#b91c1c; font-weight:500;">${esc(Array.isArray(a.messages) ? a.messages.join(' ; ') : (a.message || ''))}</span></td>
              <td class="td-rem-val" style="text-align:center;">${valCell}</td>
              <td style="text-align:center;">
                <button type="button" class="btn sm gold btn-fix-anomaly" data-bal-key="${esc(a.balance || 'N')}" data-acc="${esc(a.compte)}" title="Ouvrir l'éditeur directement sur ce compte">
                  ✏️ Corriger ce compte
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div></details>` : ''}
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
  try {
    const { data: dbPacks } = await sb.from('credit_packages').select('*').eq('is_active', true).order('sort_order');
    const isDbOutdated = !dbPacks?.length || dbPacks.some(p => 
      (p.id === 'unit' && p.prix_fcfa !== 20000) ||
      (p.id === 'starter' && p.prix_fcfa !== 50000) ||
      (p.id === 'business' && p.prix_fcfa !== 160000) ||
      (p.id === 'cabinet_expert' && p.prix_fcfa !== 400000) ||
      p.id === 'expert' ||
      p.id === 'pro'
    );
    if (dbPacks?.length && !isDbOutdated) {
      packs = dbPacks;
    } else {
      packs = DEFAULT_PACKS;
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
  } catch (err) {
    console.warn('Erreur chargement packs DB:', err);
    packs = DEFAULT_PACKS;
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
  $('#payModalTitle').textContent = `Payer ${pack.nom}`;
  $('#payModalDetails').innerHTML = `
    <div style="background:var(--bg); padding:12px; border-radius:8px; margin-bottom:12px;">
      <div style="font-size:16px; font-weight:700;">${esc(pack.nom)} · ${pack.credits} génération(s) complète(s)</div>
      <div style="font-size:22px; font-weight:800; color:var(--brand); margin-top:4px;">${fmt(pack.prix_fcfa)} FCFA</div>
    </div>
  `;
  const msgEl = $('#payStatusMsg');
  if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
  const notice = $('#payTransferNotice');
  if (notice) notice.hidden = true;
  const btn = $('#btnSubmitPayment');
  if (btn) { btn.disabled = false; btn.textContent = 'Payer avec PayDunya'; }
  if (state.profile?.telephone) $('#payPhone').value = state.profile.telephone;
  $('#modalPayment').hidden = false;
}

// Sélection de moyen de paiement
$$('.payment-method').forEach(pm => pm.addEventListener('click', () => {
  $$('.payment-method').forEach(x => x.classList.toggle('active', x === pm));
  const r = pm.querySelector('input[type=radio]');
  if (r) {
    r.checked = true;
    const isDirect = (r.value === 'Virement / Chèque');
    const notice = $('#payTransferNotice');
    if (notice) notice.hidden = !isDirect;
    const btn = $('#btnSubmitPayment');
    if (btn) btn.textContent = isDirect ? 'Confirmer la commande (Règlement direct)' : 'Payer avec PayDunya';
  }
}));

$('#btnSubmitPayment').addEventListener('click', async () => {
  const pack = selectedPackForPayment;
  if (!pack) return;
  const provider = $('input[name=payProvider]:checked')?.value || 'Wave';
  const phone = $('#payPhone').value.trim();
  if (!phone) return toast('Indiquez votre numéro de téléphone mobile money.', true);

  const btn = $('#btnSubmitPayment');
  const msgEl = $('#payStatusMsg');
  btn.disabled = true;
  btn.textContent = 'Connexion sécurisée…';
  if (msgEl) {
    msgEl.hidden = false;
    msgEl.className = 'msg';
    msgEl.textContent = 'Préparation du paiement…';
  }

  try {
    // Si règlement manuel (Virement / Chèque)
    if (provider === 'Virement / Chèque') {
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      const refCmd = `FIN-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;

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

      closeModals();
      alert(
        `✅ Commande ${refCmd} enregistrée !\n\n` +
        `Montant : ${fmt(pack.prix_fcfa)} FCFA vers le 77 443 96 90 (Wave / Orange Money).\n` +
        `Vos crédits seront alloués dès validation par l'administrateur.`
      );
      toast(`Commande ${refCmd} enregistrée !`);
      if (location.hash === '#/pricing' || location.hash === '#pricing') renderPricing();
      return;
    }

    // PAIEMENT EN LIGNE PAYDUNYA (Wave / Orange Money / Free Money / Carte Bancaire)
    // 1. Enregistre la commande préliminaire dans Supabase
    const { data: payRow, error: pErr } = await sb.from('payments').insert({
      user_id: state.user.id,
      package_id: pack.id,
      credits_achetes: pack.credits,
      montant_fcfa: pack.prix_fcfa,
      moyen_paiement: provider,
      telephone_paiement: phone,
      statut: 'pending'
    }).select().single();

    if (pErr) console.warn('Avertissement insert payment préliminaire:', pErr.message);

    // Mémorise le téléphone dans le profil
    if (!state.profile?.telephone) {
      try {
        await sb.from('profiles').update({ telephone: phone }).eq('id', state.user.id);
      } catch (_) {}
    }

    // 2. Préparation du payload PayDunya
    let targetPaymentCode = 'wave';
    if (provider === 'Orange Money') targetPaymentCode = 'orange_money';
    else if (provider === 'Free Money') targetPaymentCode = 'free_money';
    else if (provider === 'Carte Bancaire') targetPaymentCode = 'carte';

    const reqPayload = {
      package_id: pack.id,
      item_name: `${pack.nom} (${pack.credits} liasses)`,
      item_price: pack.prix_fcfa,
      credits: pack.credits,
      target_payment: targetPaymentCode,
      phone_number: phone,
      user_id: state.user.id,
      user_email: state.user.email,
      full_name: state.profile?.nom_complet || '',
      payment_id: payRow?.id || null
    };

    // 3. Appel du relais PayDunya (gère Node.js en local et Apache PHP sur Hostinger)
    let apiEndpoint = '/api/paydunya/request-payment';
    if (window.location.pathname.endsWith('.php')) {
      apiEndpoint = 'api/paydunya/request-payment.php';
    }

    if (msgEl) msgEl.textContent = 'Connexion à la passerelle PayDunya (Wave / OM / CB)…';

    let res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload)
    }).catch(() => null);

    // Secours automatique si rewrite Apache non actif
    if (!res || res.status === 404) {
      res = await fetch('api/paydunya/request-payment.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqPayload)
      });
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Échec de l\'initialisation auprès de PayDunya.');
    }

    // Sauvegarde la référence PayDunya
    if (data.ref_command && payRow?.id) {
      await sb.from('payments').update({ reference_externe: data.ref_command }).eq('id', payRow.id);
    }

    // 4. Redirection vers la page de paiement officielle PayDunya
    if (data.redirect_url) {
      if (msgEl) {
        msgEl.className = 'msg ok';
        msgEl.textContent = 'Redirection vers l\'écran de paiement officiel PayDunya en cours…';
      }
      btn.textContent = 'Redirection en cours…';
      setTimeout(() => {
        window.location.href = data.redirect_url;
      }, 400);
      return;
    }

    // 5. Cas simulation sandbox (si clés en attente)
    if (data.is_mock) {
      if (msgEl) msgEl.textContent = 'Attribution des crédits…';
      if (payRow?.id) {
        try { await sb.rpc('complete_payment', { p_payment_id: payRow.id }); } catch (_) {}
      }
      await refreshProfile();
      closeModals();
      toast(`[Sandbox] Paiement simulé avec succès (${data.ref_command}) ! +${pack.credits} crédits ajoutés.`);
      if (location.hash === '#/pricing' || location.hash === '#pricing') renderPricing();
    }
  } catch (err) {
    console.error('[Paiement PayDunya] Erreur:', err);
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.className = 'msg err';
      msgEl.textContent = 'Erreur : ' + err.message;
    }
    toast('Échec du paiement : ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Payer avec PayDunya';
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
  const tabUsers = $('#adminTabUsers');
  if (tabUsers) tabUsers.hidden = adminCurrentTab !== 'users';

  if (adminCurrentTab === 'payments') renderAdminPayments();
  if (adminCurrentTab === 'credits') renderAdminCredits();
  if (adminCurrentTab === 'users') renderAdminUsers();
}));

async function renderAdmin() {
  show('admin');
  const tb = $('#adminTable tbody'); tb.innerHTML = '<tr><td colspan="8">Chargement…</td></tr>';
  const { data, error } = await sb.from('exercises')
    .select('id, exercice, date_fin, statut, is_full_version, generation_type, updated_at, generated_at, rapport, created_by, company_id, companies(nom, ninea, telephone, email_contact), exercise_files(type, storage_path, nom_original)')
    .order('updated_at', { ascending: false });
  if (error) { tb.innerHTML = `<tr><td colspan="8" class="msg err">${esc(error.message)}</td></tr>`; return; }

  // Charge les profils clients de manière découplée (robuste contre toute anomalie de foreign keys)
  const userIds = [...new Set((data || []).map(r => r.created_by).filter(Boolean))];
  const profilesMap = {};
  if (userIds.length) {
    const { data: profs } = await sb.from('profiles').select('id, nom_complet, email, telephone').in('id', userIds);
    (profs || []).forEach(p => { profilesMap[p.id] = p; });
  }

  adminRows = (data || []).map(r => ({
    ...r,
    profiles: profilesMap[r.created_by] || {}
  }));

  const clients = new Set(adminRows.map(r => r.profiles?.email).filter(Boolean)).size;
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
            montant_credits: pay.credits_achetes,
            solde_apres: newBal,
            motif: 'purchase',
            payment_id: id,
            commentaire: `Commande ${pay.reference_externe || id} validée manuellement par admin`
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

  let { error } = await sb.rpc('admin_adjust_credits', {
    p_target_user_id: userId,
    p_credits_delta: delta,
    p_motif: motif
  });

  if (error) {
    console.warn('RPC admin_adjust_credits non disponible, repli direct:', error);
    try {
      const { data: profRow } = await sb.from('profiles').select('credits_balance').eq('id', userId).single();
      const oldBal = Number(profRow?.credits_balance || 0);
      const newBal = Math.max(0, oldBal + delta);
      await sb.from('profiles').update({ credits_balance: newBal }).eq('id', userId);
      await sb.from('credit_ledger').insert({
        user_id: userId,
        montant_credits: delta,
        solde_apres: newBal,
        motif: 'admin_adjustment',
        commentaire: motif || 'Ajustement manuel admin'
      });
      error = null;
    } catch (fbErr) {
      error = fbErr;
    }
  }

  if (error) {
    toast('Échec ajustement : ' + error.message, true);
  } else {
    toast('Crédits mis à jour avec succès.');
    $('#formAdminCredit').reset();
    renderAdminCredits();
  }
});

let adminUsersList = [];
async function renderAdminUsers() {
  const tb = $('#adminUsersTable tbody');
  tb.innerHTML = '<tr><td colspan="6">Chargement des utilisateurs…</td></tr>';
  const { data: profs, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) { tb.innerHTML = `<tr><td colspan="6" class="msg err">${esc(error.message)}</td></tr>`; return; }
  if (!profs?.length) { tb.innerHTML = '<tr><td colspan="6" class="muted">Aucun utilisateur enregistré.</td></tr>'; return; }
  adminUsersList = profs;
  drawAdminUsers();
}

function drawAdminUsers() {
  const q = ($('#adminUsersSearch')?.value || '').trim().toLowerCase();
  const rows = adminUsersList.filter(u => !q || [u.nom_complet, u.email, u.telephone].join(' ').toLowerCase().includes(q));
  const tb = $('#adminUsersTable tbody');
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Aucun utilisateur correspondant.</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(u => {
    const isMe = (u.id === state.user?.id);
    const isAdmin = !!u.is_admin;
    const roleBadge = isAdmin
      ? '<span class="badge ok" style="background:#065f46; color:#fff; font-weight:700;">👑 Administrateur</span>'
      : '<span class="badge neutral">Client</span>';
    const actionBtn = isMe
      ? '<span class="muted small" title="Votre compte actif">(Votre compte)</span>'
      : (isAdmin
          ? `<button class="btn bad sm" data-demote-user="${u.id}" data-email="${esc(u.email)}">Rétrograder en Client</button>`
          : `<button class="btn ok sm" data-promote-user="${u.id}" data-email="${esc(u.email)}">👑 Nommer Administrateur</button>`);

    return `<tr>
      <td><b>${esc(u.nom_complet || 'Sans nom')}</b></td>
      <td>${esc(u.email || '—')}</td>
      <td>${esc(u.telephone || '—')}</td>
      <td><b>${u.credits_balance || 0}</b> crédit(s)</td>
      <td>${roleBadge}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('[data-promote-user]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.promoteUser;
    const email = b.dataset.email;
    if (!confirm(`Accorder les privilèges ADMINISTRATEUR à ${email} ?\n\nCet utilisateur aura accès au panneau administration, pourra consulter l'ensemble des dossiers clients, valider les commandes et gérer les crédits.`)) return;
    b.disabled = true;
    b.textContent = 'Promotion…';
    const { error: err } = await sb.from('profiles').update({ is_admin: true }).eq('id', id);
    if (err) {
      toast('Erreur promotion : ' + err.message, true);
      b.disabled = false;
      b.textContent = '👑 Nommer Administrateur';
    } else {
      try { await sb.from('app_admins').upsert({ email }); } catch (_) {}
      toast(`👑 ${email} a été promu Administrateur !`);
      renderAdminUsers();
    }
  }));

  tb.querySelectorAll('[data-demote-user]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.demoteUser;
    const email = b.dataset.email;
    if (!confirm(`Retirer les privilèges administrateur de ${email} ?`)) return;
    b.disabled = true;
    b.textContent = 'Modification…';
    const { error: err } = await sb.from('profiles').update({ is_admin: false }).eq('id', id);
    if (err) {
      toast('Erreur : ' + err.message, true);
      b.disabled = false;
      b.textContent = 'Rétrograder en Client';
    } else {
      try { await sb.from('app_admins').delete().eq('email', email); } catch (_) {}
      toast(`Privilèges administrateur révoqués pour ${email}.`);
      renderAdminUsers();
    }
  }));
}
$('#adminUsersSearch')?.addEventListener('input', drawAdminUsers);

// ------------------------------------------------------------------ démarrage
$('#footContact').textContent = `${BRAND.contact} · ${BRAND.tel}`;
sb.auth.onAuthStateChange((_ev, session) => {
  if ((session?.user?.id || null) !== (state.user?.id || null)) onSession(session);
});
sb.auth.getSession().then(({ data }) => onSession(data.session));

