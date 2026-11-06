<?php
/**
 * Endpoint de statut PayTech Sénégal pour hébergement Hostinger / Apache
 * GET /api/paytech/status.php
 */
require_once __DIR__ . '/config.php';

$config = getPayTechConfig();

echo json_encode([
    'ok' => true,
    'is_ready' => $config['is_ready'],
    'env' => $config['env'],
    'currency' => $config['currency'],
    'message' => $config['is_ready']
        ? 'Passerelle PayTech connectée et prête.'
        : 'Clés PayTech en attente de configuration dans paytech.config.json.'
]);
