import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Supabase configuration
const SUPABASE_URL = 'https://ilohortirjaprmpcfigv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xYvYMx2c8dCIQEPFQ-vG5Q_0QuCafWU';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ------------------------------------------------------------------ PayTech Config
function loadPayTechConfig() {
  let fileConfig = {};
  const paths = [
    path.join(__dirname, 'paytech.config.local.json'),
    path.join(__dirname, 'paytech.config.json'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      } catch (e) {
        console.error('Erreur lecture config PayTech:', e.message);
      }
    }
  }

  const apiKey = process.env.PAYTECH_API_KEY || fileConfig.api_key || '';
  const apiSecret = process.env.PAYTECH_API_SECRET || fileConfig.api_secret || '';
  const isPlaceholder = !apiKey || apiKey.includes('VOTRE_API_KEY') || !apiSecret || apiSecret.includes('VOTRE_API_SECRET');

  return {
    api_key: apiKey,
    api_secret: apiSecret,
    env: process.env.PAYTECH_ENV || fileConfig.env || 'test',
    currency: fileConfig.currency || 'XOF',
    ipn_url: fileConfig.ipn_url || '',
    success_url: fileConfig.success_url || '',
    cancel_url: fileConfig.cancel_url || '',
    is_ready: !isPlaceholder,
  };
}

// ------------------------------------------------------------------ Helper Body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2e6) {
        req.destroy();
        reject(new Error('Payload trop lourd'));
      }
    });
    req.on('end', () => {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) {
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch {
          resolve({});
        }
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        const out = {};
        new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
        resolve(out);
      } else {
        resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, API_KEY, API_SECRET',
  });
  res.end(JSON.stringify(data));
}

// ------------------------------------------------------------------ PayTech API Handler
async function handlePayTechApi(req, res, parsedUrl) {
  const method = req.method.toUpperCase();
  const pathname = parsedUrl.pathname;
  const config = loadPayTechConfig();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, API_KEY, API_SECRET',
    });
    res.end();
    return;
  }

  // 1. Statut PayTech
  if (pathname === '/api/paytech/status' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      is_ready: config.is_ready,
      env: config.env,
      currency: config.currency,
      message: config.is_ready
        ? 'Passerelle PayTech connectée et prête.'
        : 'Clés PayTech en attente de configuration dans paytech.config.json (mode simulation actif).',
    });
  }

  // 2. Création de paiement PayTech
  if (pathname === '/api/paytech/request-payment' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const {
        package_id,
        item_name,
        item_price,
        credits = 1,
        target_payment,
        phone_number = '',
        user_id,
        full_name = '',
        payment_id,
      } = body;

      if (!item_price || item_price <= 0) {
        return sendJson(res, 400, { ok: false, error: 'Montant invalide.' });
      }

      // Génération de la référence FINSMART
      const ref_command = 'FIN-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);

      // Calcul des URLs de retour
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      const origin = `${proto}://${host}`;

      let ipn_url = config.ipn_url || `${origin}/api/paytech/ipn`;
      if (ipn_url.startsWith('http://')) ipn_url = 'https://' + ipn_url.slice(7);
      const success_url = config.success_url || `${origin}/?payment=success&ref=${encodeURIComponent(ref_command)}`;
      const cancel_url = config.cancel_url || `${origin}/?payment=cancel&ref=${encodeURIComponent(ref_command)}`;

      // Mapping du moyen de paiement cible
      const TARGET_MAP = {
        wave: 'Wave',
        orange_money: 'Orange Money',
        free_money: 'Free Money',
        carte: 'Carte Bancaire',
      };
      const tp = TARGET_MAP[target_payment] || target_payment || 'Wave';

      // Nettoyage du numéro de téléphone sénégalais (ex: 221770000000 -> 770000000)
      const cleanPhone = String(phone_number).replace(/[\s\-\+\.]/g, '').replace(/^221/, '');

      // SI LES CLÉS NE SONT PAS ENCORE RENSEIGNÉES (Mode simulation transparente pour tests)
      if (!config.is_ready) {
        console.log(`[PayTech Sandbox] Demande de paiement ${ref_command} (${item_price} FCFA, ${credits} crédits) simulée avec succès.`);
        return sendJson(res, 200, {
          ok: true,
          success: 1,
          is_mock: true,
          ref_command,
          token: 'sandbox-' + ref_command,
          redirect_url: `${origin}/?payment=success&ref=${encodeURIComponent(ref_command)}&mock=1&credits=${credits}`,
          message: 'Mode simulation sandbox : clés PayTech non encore configurées.',
        });
      }

      // REQUÊTE RÉELLE VERS L'API PAYTECH
      const paytechPayload = {
        item_name: item_name || `Pack FINSMART (${credits} liasse${credits > 1 ? 's' : ''})`,
        item_price: Number(item_price),
        currency: config.currency,
        ref_command: ref_command,
        command_name: `Achat de ${credits} crédits FINSMART - ${item_name || 'Liasses DGID'}`,
        env: config.env,
        ipn_url: ipn_url,
        success_url: success_url,
        cancel_url: cancel_url,
        custom_field: JSON.stringify({
          userId: user_id || null,
          packageId: package_id || null,
          paymentId: payment_id || null,
          credits: credits,
          phone: cleanPhone,
        }),
      };

      console.log('[PayTech] Envoi requête à PayTech:', {
        ref_command,
        item_price,
        env: config.env,
        target: tp,
      });

      const ptRes = await fetch('https://paytech.sn/api/payment/request-payment', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'API_KEY': config.api_key,
          'API_SECRET': config.api_secret,
        },
        body: JSON.stringify(paytechPayload),
      });

      const ptData = await ptRes.json().catch(() => ({}));

      const rawRedirect = ptData.redirect_url || ptData.redirectUrl;
      if (ptData.success === 1 && rawRedirect) {
        // Paramètres d'auto-remplissage selon documentation PayTech
        // ?pn=numero & nn=221 & fn=Nom & tp=Wave & nac=1
        const u = new URL(rawRedirect);
        if (cleanPhone) {
          u.searchParams.set('pn', cleanPhone);
          u.searchParams.set('nn', '221');
        }
        if (full_name) u.searchParams.set('fn', full_name);
        if (tp) u.searchParams.set('tp', tp);
        u.searchParams.set('nac', tp === 'Carte Bancaire' ? '0' : '1');

        console.log('[PayTech] Succès création paiement. URL:', u.toString());
        return sendJson(res, 200, {
          ok: true,
          success: 1,
          token: ptData.token,
          redirect_url: u.toString(),
          ref_command: ref_command,
        });
      } else {
        console.error('[PayTech] Erreur retournée par PayTech:', ptData);
        return sendJson(res, 400, {
          ok: false,
          error: ptData.errors || ptData.message || 'Échec de l\'initialisation auprès de PayTech.',
          details: ptData,
        });
      }
    } catch (err) {
      console.error('[PayTech] Exception dans request-payment:', err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // 3. Webhook IPN PayTech (Instant Payment Notification)
  if (pathname === '/api/paytech/ipn' && method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log('[PayTech IPN] Notification reçue:', body);

      const typeEvent = body.type_event;
      const refCommand = body.ref_command;
      const itemPrice = body.item_price;
      const token = body.token;
      const apiKeySha = body.api_key_sha256;
      const apiSecretSha = body.api_secret_sha256;

      // Si configuré avec clés réelles, vérification cryptographique SHA-256
      if (config.is_ready) {
        const expectedKeySha = crypto.createHash('sha256').update(config.api_key).digest('hex');
        const expectedSecretSha = crypto.createHash('sha256').update(config.api_secret).digest('hex');

        if (apiKeySha !== expectedKeySha || apiSecretSha !== expectedSecretSha) {
          console.warn('[PayTech IPN] Signature SHA-256 invalide ! Rejet.');
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Signature invalide');
          return;
        }
      }

      if (typeEvent === 'sale_complete') {
        console.log(`[PayTech IPN] Validation du paiement ${refCommand} (${itemPrice} FCFA)`);

        let completed = false;
        // 1. Tentative d'appel de la procédure Supabase complete_payment_by_ref
        try {
          const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/complete_payment_by_ref`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
            body: JSON.stringify({
              p_ref_command: refCommand,
              p_external_token: token || null,
            }),
          });
          const sbData = await sbRes.json();
          if (sbData && sbData.ok) {
            completed = true;
            console.log('[PayTech IPN] Succès via complete_payment_by_ref:', sbData);
          } else {
            console.warn('[PayTech IPN] RPC complete_payment_by_ref résultat non concluant:', sbData);
          }
        } catch (sbErr) {
          console.error('[PayTech IPN] Erreur appel RPC:', sbErr);
        }

        // 2. Fallback direct REST si la RPC n'a pas validé la commande
        if (!completed) {
          try {
            const pRes = await fetch(`${SUPABASE_URL}/rest/v1/payments?reference_externe=eq.${encodeURIComponent(refCommand)}&select=*`, {
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
              }
            });
            const payments = await pRes.json();
            const payRow = payments?.[0];

            if (payRow && payRow.statut !== 'completed') {
              const userId = payRow.user_id;
              const creditsToAdd = Number(payRow.credits_achetes) || 1;

              // Lecture solde actuel
              const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_balance`, {
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                }
              });
              const profData = await profRes.json();
              const oldBal = Number(profData?.[0]?.credits_balance || 0);
              const newBal = oldBal + creditsToAdd;

              // Créditer le profil
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
                body: JSON.stringify({ credits_balance: newBal }),
              });

              // Mettre à jour payments -> completed
              await fetch(`${SUPABASE_URL}/rest/v1/payments?id=eq.${payRow.id}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
                body: JSON.stringify({
                  statut: 'completed',
                  updated_at: new Date().toISOString(),
                }),
              });

              // Écrire l'audit dans credit_ledger
              await fetch(`${SUPABASE_URL}/rest/v1/credit_ledger`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
                body: JSON.stringify({
                  user_id: userId,
                  montant_credits: creditsToAdd,
                  solde_apres: newBal,
                  motif: 'purchase',
                  payment_id: payRow.id,
                  commentaire: `Achat ${payRow.package_id || 'crédits'} validé via IPN`,
                }),
              });

              console.log(`[PayTech IPN] Fallback REST réussi : +${creditsToAdd} crédits alloués à l'utilisateur ${userId}. Solde = ${newBal}`);
            }
          } catch (fbErr) {
            console.error('[PayTech IPN] Erreur secours REST:', fbErr);
          }
        }
      }

      return sendJson(res, 200, { success: 1, message: 'IPN traité avec succès' });
    } catch (err) {
      console.error('[PayTech IPN] Erreur:', err);
      return sendJson(res, 500, { success: 0, error: err.message });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Route PayTech non trouvée' });
}

// ------------------------------------------------------------------ Serveur HTTP
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Routes API
  if (parsedUrl.pathname.startsWith('/api/paytech')) {
    return handlePayTechApi(req, res, parsedUrl);
  }

  // Fichiers statiques
  let reqPath = decodeURI(parsedUrl.pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(__dirname, reqPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Non trouvé');
      } else {
        res.writeHead(500);
        res.end('Erreur serveur');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`FINSMART tourne en local sur http://localhost:${PORT}`);
});
