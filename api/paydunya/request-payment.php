<?php
/**
 * Relais sécurisé vers l'API PayDunya Sénégal (Checkout Invoice)
 * Endpoint: POST /api/paydunya/request-payment.php
 */
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Méthode non autorisée. Utiliser POST.']);
    exit;
}

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?: $_POST;

$config = getPayDunyaConfig();

$packageId = $body['package_id'] ?? null;
$itemName = $body['item_name'] ?? 'Pack FINSMART';
$itemPrice = isset($body['item_price']) ? (int)$body['item_price'] : 0;
$credits = isset($body['credits']) ? (int)$body['credits'] : 1;
$phoneNumber = $body['phone_number'] ?? '';
$userId = $body['user_id'] ?? null;
$userEmail = $body['user_email'] ?? '';
$fullName = $body['full_name'] ?? '';
$paymentId = $body['payment_id'] ?? null;

if ($itemPrice <= 0) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Montant invalide.']);
    exit;
}

// Référence unique FINSMART
$refCommand = 'FIN-' . strtoupper(dechex(time())) . '-' . rand(1000, 9999);

// Détection de l'origine
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443) ? "https://" : "http://";
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$origin = $protocol . $host;

$callbackUrl = !empty($config['callback_url']) ? $config['callback_url'] : $origin . '/api/paydunya/ipn.php';
if (strpos($callbackUrl, 'http://') === 0 && strpos($callbackUrl, 'localhost') === false) {
    $callbackUrl = 'https://' . substr($callbackUrl, 7);
}
$returnUrl = !empty($config['return_url']) ? $config['return_url'] : $origin . '/?payment=success&ref=' . urlencode($refCommand);
$cancelUrl = !empty($config['cancel_url']) ? $config['cancel_url'] : $origin . '/?payment=cancel&ref=' . urlencode($refCommand);

// Nettoyage téléphone
$cleanPhone = preg_replace('/[\s\-\+\.]/', '', $phoneNumber);
$cleanPhone = preg_replace('/^221/', '', $cleanPhone);

// Mode simulation transparent si clés non configurées
if (!$config['is_ready']) {
    echo json_encode([
        'ok' => true,
        'success' => 1,
        'is_mock' => true,
        'ref_command' => $refCommand,
        'token' => 'sandbox-' . $refCommand,
        'redirect_url' => $origin . '/?payment=success&ref=' . urlencode($refCommand) . '&mock=1&credits=' . $credits,
        'message' => 'Mode simulation sandbox : clés PayDunya non encore configurées dans paydunya.config.json.'
    ]);
    exit;
}

// Construction de la facture PayDunya
$baseUrl = ($config['env'] === 'live')
    ? 'https://app.paydunya.com/api/v1/checkout-invoice/create'
    : 'https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create';

$invoicePayload = [
    'invoice' => [
        'total_amount' => $itemPrice,
        'description' => 'Achat ' . $itemName . ' (' . $credits . ' liasse' . ($credits > 1 ? 's' : '') . ')'
    ],
    'store' => [
        'name' => 'FINSMART',
        'tagline' => 'Génération Liasses Fiscales SYSCOHADA',
        'phone_number' => '770000000',
        'postal_address' => 'Dakar, Sénégal',
        'website_url' => $origin
    ],
    'custom_data' => [
        'ref_command' => $refCommand,
        'user_id' => $userId,
        'package_id' => $packageId,
        'payment_id' => $paymentId,
        'credits' => $credits,
        'phone' => $cleanPhone,
        'full_name' => $fullName
    ],
    'actions' => [
        'cancel_url' => $cancelUrl,
        'return_url' => $returnUrl,
        'callback_url' => $callbackUrl
    ]
];

$ch = curl_init($baseUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($invoicePayload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'PAYDUNYA-MASTER-KEY: ' . $config['master_key'],
    'PAYDUNYA-PRIVATE-KEY: ' . $config['private_key'],
    'PAYDUNYA-TOKEN: ' . $config['token']
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Erreur de connexion à PayDunya: ' . $curlError]);
    exit;
}

$data = json_decode($response, true);

if (isset($data['response_code']) && $data['response_code'] === '00' && !empty($data['response_text'])) {
    echo json_encode([
        'ok' => true,
        'success' => 1,
        'token' => $data['token'] ?? '',
        'redirect_url' => $data['response_text'],
        'ref_command' => $refCommand
    ]);
} else {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => $data['response_text'] ?? ($data['description'] ?? 'Échec de création de la facture PayDunya.'),
        'details' => $data
    ]);
}
