<?php
/**
 * Webhook IPN PayTech Sénégal pour hébergement Hostinger
 * Endpoint: POST /api/paytech/ipn.php
 */
require_once __DIR__ . '/config.php';

$config = getPayTechConfig();

$SUPABASE_URL = 'https://ilohortirjaprmpcfigv.supabase.co';
$SUPABASE_KEY = 'sb_publishable_xYvYMx2c8dCIQEPFQ-vG5Q_0QuCafWU';

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?: $_POST;

$typeEvent = $body['type_event'] ?? '';
$refCommand = $body['ref_command'] ?? '';
$itemPrice = $body['item_price'] ?? 0;
$token = $body['token'] ?? '';
$apiKeySha = $body['api_key_sha256'] ?? '';
$apiSecretSha = $body['api_secret_sha256'] ?? '';

// Contrôle de signature cryptographique
if ($config['is_ready']) {
    $expectedKeySha = hash('sha256', $config['api_key']);
    $expectedSecretSha = hash('sha256', $config['api_secret']);

    if ($apiKeySha !== $expectedKeySha || $apiSecretSha !== $expectedSecretSha) {
        http_response_code(403);
        echo 'Signature invalide';
        exit;
    }
}

if ($typeEvent === 'sale_complete' && !empty($refCommand)) {
    // Appel de la procédure Supabase complete_payment_by_ref
    $rpcUrl = $SUPABASE_URL . '/rest/v1/rpc/complete_payment_by_ref';
    $rpcPayload = [
        'p_ref_command' => $refCommand,
        'p_external_token' => $token ?: null
    ];

    $ch = curl_init($rpcUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($rpcPayload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'apikey: ' . $SUPABASE_KEY,
        'Authorization: Bearer ' . $SUPABASE_KEY
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    $res = curl_exec($ch);
    curl_close($ch);
}

echo json_encode(['success' => 1, 'message' => 'Notification reçue']);
