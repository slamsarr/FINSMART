<?php
/**
 * Relais sécurisé vers l'API PayTech Sénégal pour hébergement Hostinger
 * Endpoint: POST /api/paytech/request-payment.php
 */
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Méthode non autorisée. Utiliser POST.']);
    exit;
}

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?: $_POST;

$config = getPayTechConfig();

$packageId = $body['package_id'] ?? null;
$itemName = $body['item_name'] ?? 'Pack FINSMART';
$itemPrice = isset($body['item_price']) ? (int)$body['item_price'] : 0;
$credits = isset($body['credits']) ? (int)$body['credits'] : 1;
$targetPayment = $body['target_payment'] ?? 'wave';
$phoneNumber = $body['phone_number'] ?? '';
$userId = $body['user_id'] ?? null;
$fullName = $body['full_name'] ?? '';
$paymentId = $body['payment_id'] ?? null;

if ($itemPrice <= 0) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Montant invalide.']);
    exit;
}

// Calcul de la référence unique de commande
$refCommand = 'FIN-' . strtoupper(dechex(time())) . '-' . rand(1000, 9999);

// Détection de l'origine
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $_SERVER['SERVER_PORT'] == 443 ? "https://" : "http://";
$host = $_SERVER['HTTP_HOST'];
$origin = $protocol . $host;

$ipnUrl = !empty($config['ipn_url']) ? $config['ipn_url'] : $origin . '/api/paytech/ipn.php';
$successUrl = !empty($config['success_url']) ? $config['success_url'] : $origin . '/?payment=success&ref=' . urlencode($refCommand);
$cancelUrl = !empty($config['cancel_url']) ? $config['cancel_url'] : $origin . '/?payment=cancel&ref=' . urlencode($refCommand);

// Nettoyage téléphone
$cleanPhone = preg_replace('/[\s\-\+\.]/', '', $phoneNumber);
$cleanPhone = preg_replace('/^221/', '', $cleanPhone);

$targetMap = [
    'wave' => 'Wave',
    'orange_money' => 'Orange Money',
    'free_money' => 'Free Money',
    'carte' => 'Carte Bancaire'
];
$tp = $targetMap[$targetPayment] ?? $targetPayment;

// Si clés non configurées, mode simulation de développement
if (!$config['is_ready']) {
    echo json_encode([
        'ok' => true,
        'success' => 1,
        'is_mock' => true,
        'ref_command' => $refCommand,
        'token' => 'sandbox-' . $refCommand,
        'redirect_url' => $origin . '/?payment=success&ref=' . urlencode($refCommand) . '&mock=1&credits=' . $credits,
        'message' => 'Mode simulation sandbox : clés PayTech non encore configurées.'
    ]);
    exit;
}

// Appel à l'API officielle PayTech via cURL
$payload = [
    'item_name' => $itemName,
    'item_price' => $itemPrice,
    'currency' => $config['currency'],
    'ref_command' => $refCommand,
    'command_name' => 'Achat crédits FINSMART - ' . $itemName,
    'env' => $config['env'],
    'ipn_url' => $ipnUrl,
    'success_url' => $successUrl,
    'cancel_url' => $cancelUrl,
    'custom_field' => json_encode([
        'userId' => $userId,
        'packageId' => $packageId,
        'paymentId' => $paymentId,
        'credits' => $credits,
        'phone' => $cleanPhone
    ])
];

$ch = curl_init('https://paytech.sn/api/payment/request-payment');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: application/json',
    'Content-Type: application/json',
    'API_KEY: ' . $config['api_key'],
    'API_SECRET: ' . $config['api_secret']
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Erreur cURL: ' . $curlErr]);
    exit;
}

$data = json_decode($response, true);
if (isset($data['success']) && $data['success'] == 1 && !empty($data['redirect_url'])) {
    // Ajout des paramètres d'auto-remplissage (?pn, nn, fn, tp, nac)
    $redirectUrl = $data['redirect_url'];
    $sep = strpos($redirectUrl, '?') === false ? '?' : '&';
    $params = [];
    if (!empty($cleanPhone)) {
        $params[] = 'pn=' . urlencode($cleanPhone);
        $params[] = 'nn=221';
    }
    if (!empty($fullName)) {
        $params[] = 'fn=' . urlencode($fullName);
    }
    if (!empty($tp)) {
        $params[] = 'tp=' . urlencode($tp);
    }
    $params[] = 'nac=' . ($tp === 'Carte Bancaire' ? '0' : '1');
    $redirectUrl .= $sep . implode('&', $params);

    echo json_encode([
        'ok' => true,
        'success' => 1,
        'token' => $data['token'] ?? null,
        'redirect_url' => $redirectUrl,
        'ref_command' => $refCommand
    ]);
} else {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => $data['errors'] ?? ($data['message'] ?? 'Erreur inconnue PayTech'),
        'details' => $data
    ]);
}
