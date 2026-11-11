<?php
/**
 * Vérification du statut d'une facture PayDunya par Token
 * GET /api/paydunya/confirm.php?token=xyz
 */
require_once __DIR__ . '/config.php';

$token = $_GET['token'] ?? '';
if (empty($token)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Paramètre token requis.']);
    exit;
}

$config = getPayDunyaConfig();

// Mode simulation si clés absentes
if (!$config['is_ready'] || strpos($token, 'sandbox-') === 0) {
    echo json_encode([
        'ok' => true,
        'status' => 'completed',
        'is_mock' => true,
        'token' => $token,
        'message' => 'Mode simulation sandbox PayDunya.'
    ]);
    exit;
}

$baseUrl = ($config['env'] === 'live')
    ? 'https://app.paydunya.com/api/v1/checkout-invoice/confirm/' . urlencode($token)
    : 'https://app.paydunya.com/sandbox-api/v1/checkout-invoice/confirm/' . urlencode($token);

$ch = curl_init($baseUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'PAYDUNYA-MASTER-KEY: ' . $config['master_key'],
    'PAYDUNYA-PRIVATE-KEY: ' . $config['private_key'],
    'PAYDUNYA-TOKEN: ' . $config['token']
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$res = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($res === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Erreur de connexion PayDunya: ' . $err]);
    exit;
}

$data = json_decode($res, true);
echo json_encode([
    'ok' => ($httpCode >= 200 && $httpCode < 300),
    'status' => $data['status'] ?? 'unknown',
    'data' => $data
]);
