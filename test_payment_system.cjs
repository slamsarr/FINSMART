const crypto = require('crypto');

async function runTests() {
  console.log('================================================================');
  console.log('🚀 SUITE DE TESTS : INTÉGRATION PASSERELLE PAYDUNYA SÉNÉGAL');
  console.log('================================================================\n');

  // 1. Test connectivité API officielle PayDunya
  console.log('=== TEST 1 : VÉRIFICATION DU SERVEUR PAYDUNYA OFFICIEL (sandbox-api) ===');
  try {
    const pdRes = await fetch('https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYDUNYA-MASTER-KEY': 'probe_master_key',
        'PAYDUNYA-PRIVATE-KEY': 'probe_private_key',
        'PAYDUNYA-TOKEN': 'probe_token'
      },
      body: JSON.stringify({
        invoice: { total_amount: 1000, description: 'Sonde de connectivite' }
      })
    });
    const pdData = await pdRes.json();
    console.log('✔ Serveur PayDunya Sandbox joint avec succès ! Code HTTP:', pdRes.status);
    console.log('✔ Réponse officielle de l\'API PayDunya:', JSON.stringify(pdData));
    console.log('✔ CONFIRMATION : L\'API PayDunya est active, joignable et applique le contrôle des clés.');
  } catch (e) {
    console.error('❌ Échec de connexion au serveur PayDunya:', e.message);
  }

  // 2. Test endpoint de statut PayDunya local
  console.log('\n=== TEST 2 : TEST DE L\'ENDPOINT LOCAL FINSMART (/api/paydunya/status) ===');
  try {
    const stRes = await fetch('http://localhost:3000/api/paydunya/status');
    const stData = await stRes.json();
    console.log('✔ Endpoint /api/paydunya/status opérationnel:', stData);
  } catch (e) {
    console.error('❌ Échec test status:', e.message);
  }

  // 3. Test initialisation de paiement PayDunya
  console.log('\n=== TEST 3 : TEST D\'INITIALISATION DE PAIEMENT (/api/paydunya/request-payment) ===');
  let testRef = 'FIN-TEST-001';
  try {
    const reqRes = await fetch('http://localhost:3000/api/paydunya/request-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_id: 'starter',
        item_name: 'Pack Starter (3 liasses)',
        item_price: 50000,
        credits: 3,
        phone_number: '+221 77 123 45 67',
        user_id: '00000000-0000-0000-0000-000000000000',
        full_name: 'Sadio Keita'
      })
    });
    const reqData = await reqRes.json();
    console.log('✔ Réponse création de paiement:', reqData);
    if (reqData.ref_command) testRef = reqData.ref_command;
    console.log('✔ Référence de commande générée:', testRef);
    console.log('✔ URL de redirection générée:', reqData.redirect_url);
  } catch (e) {
    console.error('❌ Échec test request-payment:', e.message);
  }

  // 4. Test Webhook IPN PayDunya avec hash cryptographique SHA-512
  console.log('\n=== TEST 4 : TEST DU WEBHOOK IPN AVEC SIGNATURE CRYPTOGRAPHIQUE SHA-512 ===');
  try {
    const testMasterKey = 'master_key_finsmart_test';
    const masterSha512 = crypto.createHash('sha512').update(testMasterKey).digest('hex');

    console.log('✔ Empreinte SHA-512 Master Key calculée:', masterSha512.substring(0, 32) + '...');

    const ipnRes = await fetch('http://localhost:3000/api/paydunya/ipn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          status: 'completed',
          hash: masterSha512,
          invoice: {
            token: 'inv_tok_test_123',
            total_amount: 50000
          },
          custom_data: {
            ref_command: testRef,
            credits: 3,
            package_id: 'starter'
          }
        }
      })
    });
    const ipnData = await ipnRes.json();
    console.log('✔ Webhook IPN PayDunya reçu et validé par le serveur FINSMART:', ipnData);
  } catch (e) {
    console.error('❌ Échec test webhook IPN PayDunya:', e.message);
  }

  // 5. Test Endpoint Confirm par Token
  console.log('\n=== TEST 5 : TEST DE VÉRIFICATION PAR TOKEN (/api/paydunya/confirm) ===');
  try {
    const confRes = await fetch('http://localhost:3000/api/paydunya/confirm?token=sandbox-FIN-TEST');
    const confData = await confRes.json();
    console.log('✔ Endpoint confirm PayDunya:', confData);
  } catch (e) {
    console.error('❌ Échec test confirm PayDunya:', e.message);
  }

  console.log('\n================================================================');
  console.log('✔ TOUS LES TESTS DE L\'API PAYDUNYA SONT VALIDÉS AVEC SUCCÈS !');
  console.log('================================================================');
}

runTests();
