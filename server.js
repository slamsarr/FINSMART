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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// ------------------------------------------------------------------ PayDunya Config
function loadPayDunyaConfig() {
  let fileConfig = {};
  const paths = [
    path.join(__dirname, 'paydunya.config.local.json'),
    path.join(__dirname, 'paydunya.config.json'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      } catch (e) {
        console.error('Erreur lecture config PayDunya:', e.message);
      }
    }
  }

  const masterKey = process.env.PAYDUNYA_MASTER_KEY || fileConfig.master_key || '';
  const privateKey = process.env.PAYDUNYA_PRIVATE_KEY || fileConfig.private_key || '';
  const token = process.env.PAYDUNYA_TOKEN || fileConfig.token || '';

  const isPlaceholder = !masterKey || masterKey.includes('VOTRE_') ||
                        !privateKey || privateKey.includes('VOTRE_') ||
                        !token || token.includes('VOTRE_');

  return {
    master_key: masterKey,
    private_key: privateKey,
    token: token,
    env: process.env.PAYDUNYA_ENV || fileConfig.env || 'test',
    currency: fileConfig.currency || 'XOF',
    callback_url: fileConfig.callback_url || '',
    return_url: fileConfig.return_url || '',
    cancel_url: fileConfig.cancel_url || '',
    is_ready: !isPlaceholder,
  };
}

// ------------------------------------------------------------------ PayTech Config (Legacy / Fallback)
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

// ------------------------------------------------------------------ Helper Body & JSON
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, PAYDUNYA-MASTER-KEY, PAYDUNYA-PRIVATE-KEY, PAYDUNYA-TOKEN, API_KEY, API_SECRET',
  });
  res.end(JSON.stringify(data));
}

// ------------------------------------------------------------------ Helper Supabase Credit
async function applyCreditsToUser(refCommand, token, fallbackCredits = 1, gatewayName = 'PayDunya') {
  let completed = false;
  // 1. Appel RPC Supabase
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
      console.log(`[${gatewayName} IPN] Succès via complete_payment_by_ref:`, sbData);
    } else {
      console.warn(`[${gatewayName} IPN] RPC complete_payment_by_ref résultat non concluant:`, sbData);
    }
  } catch (sbErr) {
    console.error(`[${gatewayName} IPN] Erreur appel RPC:`, sbErr);
  }

  // 2. Fallback REST
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
        const creditsToAdd = Number(payRow.credits_achetes) || Number(fallbackCredits) || 1;

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

        // Créditer profil
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

        // Écrire dans credit_ledger
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
            commentaire: `Achat ${payRow.package_id || 'crédits'} validé via IPN ${gatewayName}`,
          }),
        });

        console.log(`[${gatewayName} IPN] Fallback REST réussi : +${creditsToAdd} crédits alloués à l'utilisateur ${userId}. Nouveau solde = ${newBal}`);
      }
    } catch (fbErr) {
      console.error(`[${gatewayName} IPN] Erreur secours REST:`, fbErr);
    }
  }
}

// ------------------------------------------------------------------ PayDunya API Handler
async function handlePayDunyaApi(req, res, parsedUrl) {
  const method = req.method.toUpperCase();
  const pathname = parsedUrl.pathname;
  const config = loadPayDunyaConfig();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, PAYDUNYA-MASTER-KEY, PAYDUNYA-PRIVATE-KEY, PAYDUNYA-TOKEN',
    });
    res.end();
    return;
  }

  // 1. Statut PayDunya
  if (pathname === '/api/paydunya/status' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      gateway: 'paydunya',
      is_ready: config.is_ready,
      env: config.env,
      currency: config.currency,
      message: config.is_ready
        ? 'Passerelle PayDunya connectée et prête.'
        : 'Clés PayDunya en attente de configuration dans paydunya.config.json (mode simulation actif).',
    });
  }

  // 2. Création de facture PayDunya (Checkout Invoice)
  if (pathname === '/api/paydunya/request-payment' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const {
        package_id,
        item_name = 'Pack FINSMART',
        item_price,
        credits = 1,
        phone_number = '',
        user_id,
        user_email = '',
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

      let callback_url = config.callback_url || `${origin}/api/paydunya/ipn`;
      if (callback_url.startsWith('http://') && !callback_url.includes('localhost')) {
        callback_url = 'https://' + callback_url.slice(7);
      }
      const return_url = config.return_url || `${origin}/?payment=success&ref=${encodeURIComponent(ref_command)}`;
      const cancel_url = config.cancel_url || `${origin}/?payment=cancel&ref=${encodeURIComponent(ref_command)}`;

      // Nettoyage du numéro de téléphone
      const cleanPhone = String(phone_number).replace(/[\s\-\+\.]/g, '').replace(/^221/, '');

      // SI LES CLÉS NE SONT PAS ENCORE CONFIGURÉES : Mode simulation transparent
      if (!config.is_ready) {
        console.log(`[PayDunya Sandbox] Demande ${ref_command} (${item_price} FCFA, ${credits} crédits) simulée avec succès.`);
        return sendJson(res, 200, {
          ok: true,
          success: 1,
          is_mock: true,
          ref_command,
          token: 'sandbox-' + ref_command,
          redirect_url: `${origin}/?payment=success&ref=${encodeURIComponent(ref_command)}&mock=1&credits=${credits}`,
          message: 'Mode simulation sandbox : clés PayDunya non encore configurées.',
        });
      }

      // REQUÊTE RÉELLE VERS L'API PAYDUNYA
      const invoiceEndpoint = (config.env === 'live')
        ? 'https://app.paydunya.com/api/v1/checkout-invoice/create'
        : 'https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create';

      const invoicePayload = {
        invoice: {
          total_amount: Number(item_price),
          description: `Achat ${item_name} (${credits} liasse${credits > 1 ? 's' : ''})`
        },
        store: {
          name: 'FINSMART',
          tagline: 'Génération Liasses Fiscales SYSCOHADA',
          phone_number: '770000000',
          postal_address: 'Dakar, Sénégal',
          website_url: origin
        },
        custom_data: {
          ref_command,
          user_id: user_id || null,
          package_id: package_id || null,
          payment_id: payment_id || null,
          credits,
          phone: cleanPhone,
          full_name,
        },
        actions: {
          cancel_url,
          return_url,
          callback_url,
        }
      };

      console.log('[PayDunya] Envoi requête création de facture:', {
        ref_command,
        item_price,
        endpoint: invoiceEndpoint,
      });

      const pdRes = await fetch(invoiceEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PAYDUNYA-MASTER-KEY': config.master_key,
          'PAYDUNYA-PRIVATE-KEY': config.private_key,
          'PAYDUNYA-TOKEN': config.token,
        },
        body: JSON.stringify(invoicePayload),
      });

      const pdData = await pdRes.json().catch(() => ({}));

      if (pdData.response_code === '00' && pdData.response_text) {
        console.log('[PayDunya] Succès création facture. Redirection:', pdData.response_text);
        return sendJson(res, 200, {
          ok: true,
          success: 1,
          token: pdData.token,
          redirect_url: pdData.response_text,
          ref_command: ref_command,
        });
      } else {
        console.error('[PayDunya] Erreur retournée par PayDunya:', pdData);
        return sendJson(res, 400, {
          ok: false,
          error: pdData.response_text || pdData.description || 'Échec de création de la facture PayDunya.',
          details: pdData,
        });
      }
    } catch (err) {
      console.error('[PayDunya] Exception dans request-payment:', err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // 3. Webhook IPN PayDunya (Notification instantanée)
  if (pathname === '/api/paydunya/ipn' && method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log('[PayDunya IPN] Notification reçue:', body);

      const data = (body.data && typeof body.data === 'object') ? body.data : body;
      const receivedHash = data.hash || body.hash || '';
      const status = data.status || body.status || '';

      let customData = data.custom_data || body.custom_data || {};
      if (typeof customData === 'string') {
        try { customData = JSON.parse(customData); } catch {}
      }

      const invoice = data.invoice || body.invoice || {};
      const token = invoice.token || data.token || body.token || '';
      const refCommand = customData.ref_command || data.ref_command || '';
      const credits = Number(customData.credits) || 1;

      // Vérification SHA-512 de la clé Master PayDunya
      if (config.is_ready && config.master_key) {
        const expectedHash = crypto.createHash('sha512').update(config.master_key).digest('hex');
        if (!receivedHash || expectedHash.toLowerCase() !== String(receivedHash).toLowerCase()) {
          console.warn('[PayDunya IPN] Signature SHA-512 invalide ! Rejet.');
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Signature SHA-512 PayDunya invalide' }));
          return;
        }
      }

      if (status === 'completed' && refCommand) {
        console.log(`[PayDunya IPN] Validation du paiement ${refCommand} (+${credits} crédits)`);
        await applyCreditsToUser(refCommand, token, credits, 'PayDunya');
      }

      return sendJson(res, 200, { success: 1, message: 'IPN PayDunya validé avec succès' });
    } catch (err) {
      console.error('[PayDunya IPN] Erreur:', err);
      return sendJson(res, 500, { success: 0, error: err.message });
    }
  }

  // 4. Confirmation de statut par Token
  if (pathname === '/api/paydunya/confirm' && method === 'GET') {
    try {
      const token = parsedUrl.searchParams.get('token');
      if (!token) {
        return sendJson(res, 400, { ok: false, error: 'Paramètre token requis.' });
      }

      if (!config.is_ready || token.startsWith('sandbox-')) {
        return sendJson(res, 200, {
          ok: true,
          status: 'completed',
          is_mock: true,
          token,
          message: 'Mode simulation sandbox PayDunya.'
        });
      }

      const confirmEndpoint = (config.env === 'live')
        ? `https://app.paydunya.com/api/v1/checkout-invoice/confirm/${encodeURIComponent(token)}`
        : `https://app.paydunya.com/sandbox-api/v1/checkout-invoice/confirm/${encodeURIComponent(token)}`;

      const cRes = await fetch(confirmEndpoint, {
        headers: {
          'Content-Type': 'application/json',
          'PAYDUNYA-MASTER-KEY': config.master_key,
          'PAYDUNYA-PRIVATE-KEY': config.private_key,
          'PAYDUNYA-TOKEN': config.token,
        }
      });
      const cData = await cRes.json().catch(() => ({}));
      return sendJson(res, cRes.status, {
        ok: cRes.ok,
        status: cData.status || 'unknown',
        data: cData
      });
    } catch (err) {
      console.error('[PayDunya Confirm] Erreur:', err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Route PayDunya non trouvée' });
}

// ------------------------------------------------------------------ PayTech API Handler (Compatibilité)
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

  if (pathname === '/api/paytech/status' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      gateway: 'paytech',
      is_ready: config.is_ready,
      env: config.env,
      currency: config.currency,
      message: 'Route de compatibilité PayTech.',
    });
  }

  if (pathname === '/api/paytech/request-payment' && method === 'POST') {
    // Redirige vers PayDunya transparentement
    parsedUrl.pathname = '/api/paydunya/request-payment';
    return handlePayDunyaApi(req, res, parsedUrl);
  }

  if (pathname === '/api/paytech/ipn' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const typeEvent = body.type_event;
      const refCommand = body.ref_command;
      const token = body.token;
      let credits = 1;
      try {
        const cf = JSON.parse(body.custom_field || '{}');
        if (cf.credits) credits = Number(cf.credits);
      } catch {}

      if (typeEvent === 'sale_complete' && refCommand) {
        await applyCreditsToUser(refCommand, token, credits, 'PayTech');
      }
      return sendJson(res, 200, { success: 1, message: 'IPN PayTech traité' });
    } catch (err) {
      return sendJson(res, 500, { success: 0, error: err.message });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Route PayTech non trouvée' });
}

// ------------------------------------------------------------------ Serveur HTTP
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Routes API
  if (parsedUrl.pathname.startsWith('/api/paydunya')) {
    return handlePayDunyaApi(req, res, parsedUrl);
  }
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

  fs.stat(filePath, (err, stats) => {
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

    if (stats.isDirectory()) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const range = req.headers.range;

    // Support streaming pour la vidéo (HTTP 206 Partial Content)
    if (range && (ext === '.mp4' || ext === '.webm')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (start >= stats.size || end >= stats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        res.end();
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': ext === '.mp4' ? 'public, max-age=86400' : 'no-cache, no-store, must-revalidate',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`FINSMART tourne en local sur http://localhost:${PORT}`);
});
