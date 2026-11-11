<?php
/**
 * Endpoint de statut PayDunya Sénégal pour hébergement Hostinger / Apache
 * GET /api/paydunya/status.php
 */
require_once __DIR__ . '/config.php';

$config = getPayDunyaConfig();

echo json_encode([
    'ok' => true,
    'gateway' => 'paydunya',
    'is_ready' => $config['is_ready'],
    'env' => $config['env'],
    'currency' => $config['currency'],
    'message' => $config['is_ready']
        ? 'Passerelle PayDunya connectée et prête.'
        : 'Clés PayDunya en attente de configuration dans paydunya.config.json (mode simulation actif).'
]);
