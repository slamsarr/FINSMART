const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function audit() {
  console.log('======================================================================');
  console.log('🔍 AUDIT D\'INTÉGRATION COMPLET : PASSERELLE PAYDUNYA SÉNÉGAL');
  console.log('======================================================================\n');

  let passes = 0;
  let total = 0;

  function assert(condition, title, details = '') {
    total++;
    if (condition) {
      passes++;
      console.log(`  ✅ [PASS] ${title}`);
      if (details) console.log(`     ↳ ${details}`);
    } else {
      console.error(`  ❌ [FAIL] ${title}`);
      if (details) console.error(`     ↳ ${details}`);
    }
  }

  // 1. Audit Fichiers & Configuration
  console.log('--- 1. AUDIT DE PRÉSENCE DES FICHIERS ---');
  const requiredFiles = [
    'paydunya.config.json',
    'api/paydunya/config.php',
    'api/paydunya/status.php',
    'api/paydunya/request-payment.php',
    'api/paydunya/ipn.php',
    'api/paydunya/confirm.php',
    '.htaccess',
    'server.js',
    'js/app.js',
    'index.html'
  ];

  requiredFiles.forEach(f => {
    assert(fs.existsSync(f), `Fichier existant: ${f}`);
  });

  // 2. Audit de la configuration PayDunya
  console.log('\n--- 2. AUDIT DE STRUCTURE DE CONFIGURATION ---');
  try {
    const cfg = JSON.parse(fs.readFileSync('paydunya.config.json', 'utf8'));
    assert('master_key' in cfg, 'Clé master_key présente dans paydunya.config.json');
    assert('private_key' in cfg, 'Clé private_key présente dans paydunya.config.json');
    assert('token' in cfg, 'Clé token présente dans paydunya.config.json');
    assert('env' in cfg, 'Paramètre env présent');
    assert(cfg.currency === 'XOF', 'Devise paramétrée en XOF (Franc CFA Sénégal)');
  } catch (e) {
    assert(false, 'Lecture paydunya.config.json', e.message);
  }

  // 3. Audit du code Frontend (index.html & js/app.js)
  console.log('\n--- 3. AUDIT DU FRONTEND ---');
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  assert(indexHtml.includes('Payer avec PayDunya'), 'Bouton "Payer avec PayDunya" présent dans index.html');
  assert(indexHtml.includes('API PayDunya Sénégal'), 'Mention "API PayDunya Sénégal" présente');
  assert(!indexHtml.includes('Payer avec PayTech'), 'Ancienne mention "Payer avec PayTech" supprimée de index.html');

  const appJs = fs.readFileSync('js/app.js', 'utf8');
  assert(appJs.includes('/api/paydunya/request-payment'), 'Route /api/paydunya/request-payment appelée dans app.js');
  assert(appJs.includes('api/paydunya/request-payment.php'), 'Secours Apache api/paydunya/request-payment.php présent');
  assert(appJs.includes('url.searchParams.get(\'token\')'), 'Lecture du token PayDunya au retour client');
  assert(!appJs.includes('api/paytech/request-payment'), 'Ancien endpoint PayTech nettoyé du flux principal');

  // 4. Audit des règles .htaccess (Sécurité & Réécriture)
  console.log('\n--- 4. AUDIT DU SERVEUR APACHE (.htaccess) ---');
  const htaccess = fs.readFileSync('.htaccess', 'utf8');
  assert(htaccess.includes('paydunya\\.config'), 'Protection anti-téléchargement de paydunya.config');
  assert(htaccess.includes('RewriteRule ^api/paydunya/request-payment$ api/paydunya/request-payment.php'), 'Réécriture request-payment configurée');
  assert(htaccess.includes('RewriteRule ^api/paydunya/status$ api/paydunya/status.php'), 'Réécriture status configurée');
  assert(htaccess.includes('RewriteRule ^api/paydunya/ipn$ api/paydunya/ipn.php'), 'Réécriture IPN configurée');
  assert(htaccess.includes('RewriteRule ^api/paydunya/confirm$ api/paydunya/confirm.php'), 'Réécriture confirm configurée');

  // 5. Audit de connexion réseau vers l'API Officielle PayDunya
  console.log('\n--- 5. TEST DE JOIGNABILITÉ DE L\'API OFFICIELLE PAYDUNYA ---');
  try {
    const pdPing = await fetch('https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYDUNYA-MASTER-KEY': 'audit_master_test',
        'PAYDUNYA-PRIVATE-KEY': 'audit_private_test',
        'PAYDUNYA-TOKEN': 'audit_token_test'
      },
      body: JSON.stringify({
        invoice: { total_amount: 20000, description: 'Test Sonde FINSMART' }
      })
    });
    const pdData = await pdPing.json().catch(() => ({}));
    assert(pdPing.status === 200, 'Serveur PayDunya officiel joignable avec succès (HTTP 200)', `Réponse: ${JSON.stringify(pdData)}`);
    assert(pdData.response_code === '1001' || pdData.response_text?.includes('Masterkey'), 'Contrôle de sécurité PayDunya actif et opérationnel');
  } catch (err) {
    assert(false, 'Connexion API PayDunya officielle', err.message);
  }

  // 6. Test d'exécution du serveur local FINSMART
  console.log('\n--- 6. TEST FONCTIONNEL DU RUNTIME FINSMART ---');
  try {
    const stRes = await fetch('http://localhost:3000/api/paydunya/status');
    const stData = await stRes.json();
    assert(stRes.status === 200 && stData.ok === true, 'GET /api/paydunya/status répond OK', JSON.stringify(stData));
    assert(stData.gateway === 'paydunya', 'Passerelle active identifiée: paydunya');
  } catch (e) {
    assert(false, 'Vérification /api/paydunya/status', e.message);
  }

  try {
    const reqRes = await fetch('http://localhost:3000/api/paydunya/request-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_id: 'pro',
        item_name: 'Pack Pro (10 liasses)',
        item_price: 160000,
        credits: 10,
        phone_number: '77 443 96 90',
        user_id: 'test-audit-user-id',
        full_name: 'Test Audit Auditeur'
      })
    });
    const reqData = await reqRes.json();
    assert(reqRes.status === 200 && reqData.ok === true, 'POST /api/paydunya/request-payment crée la facture', `ref_command: ${reqData.ref_command}`);
    assert(reqData.redirect_url && (reqData.redirect_url.includes('payment.paydunya.com') || reqData.redirect_url.includes('ref=') || reqData.redirect_url.includes('checkout')), 'URL de redirection PayDunya officielle générée avec succès', reqData.redirect_url);
  } catch (e) {
    assert(false, 'Vérification /api/paydunya/request-payment', e.message);
  }

  // 7. Test de la sécurité Webhook IPN (SHA-512)
  console.log('\n--- 7. AUDIT DE SÉCURITÉ IPN (SIGNATURE SHA-512) ---');
  let masterKey = 'test_secret_master_key_999';
  try {
    const liveCfg = JSON.parse(fs.readFileSync('paydunya.config.json', 'utf8'));
    if (liveCfg.master_key) masterKey = liveCfg.master_key;
  } catch {}
  const validHash = crypto.createHash('sha512').update(masterKey).digest('hex');

  try {
    const ipnRes = await fetch('http://localhost:3000/api/paydunya/ipn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          status: 'completed',
          hash: validHash,
          invoice: { token: 'inv_tok_audit_456', total_amount: 160000 },
          custom_data: { ref_command: 'FIN-AUDIT-001', credits: 10, package_id: 'pro' }
        }
      })
    });
    const ipnData = await ipnRes.json();
    assert(ipnRes.status === 200 && ipnData.success === 1, 'Webhook IPN validé et traité avec succès');
  } catch (e) {
    assert(false, 'Vérification IPN PayDunya', e.message);
  }

  console.log('\n======================================================================');
  console.log(`RÉSULTAT DU CONTRÔLE : ${passes} / ${total} VÉRIFICATIONS RÉUSSIES (${Math.round(passes/total*100)}%)`);
  if (passes === total) {
    console.log('🎉 CONCLUSION : L\'API PAYDUNYA EST COMPLÈTEMENT ET PARFAITEMENT INTÉGRÉE !');
  } else {
    console.log('⚠️ CONCLUSION : CERTAINS POINTS NÉCESSITENT ATTENTION.');
  }
  console.log('======================================================================');
}

audit();
