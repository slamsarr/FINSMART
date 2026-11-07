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
    $completed = false;
    // 1. Appel de la procédure Supabase complete_payment_by_ref
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

    if ($res) {
        $resObj = json_decode($res, true);
        if (!empty($resObj['ok'])) {
            $completed = true;
        }
    }

    // 2. Secours direct REST si la fonction RPC n'est pas installée
    if (!$completed) {
        // Recherche du paiement
        $pUrl = $SUPABASE_URL . '/rest/v1/payments?reference_externe=eq.' . urlencode($refCommand) . '&select=*';
        $ch2 = curl_init($pUrl);
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_HTTPHEADER, [
            'apikey: ' . $SUPABASE_KEY,
            'Authorization: Bearer ' . $SUPABASE_KEY
        ]);
        curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, true);
        $pRes = curl_exec($ch2);
        curl_close($ch2);

        $payments = json_decode($pRes, true);
        $payRow = (!empty($payments) && is_array($payments)) ? $payments[0] : null;

        if ($payRow && $payRow['statut'] !== 'completed') {
            $userId = $payRow['user_id'];
            $creditsToAdd = !empty($payRow['credits_achetes']) ? (int)$payRow['credits_achetes'] : 1;

            // Récupération solde actuel
            $profUrl = $SUPABASE_URL . '/rest/v1/profiles?id=eq.' . urlencode($userId) . '&select=credits_balance';
            $ch3 = curl_init($profUrl);
            curl_setopt($ch3, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch3, CURLOPT_HTTPHEADER, [
                'apikey: ' . $SUPABASE_KEY,
                'Authorization: Bearer ' . $SUPABASE_KEY
            ]);
            $profRes = curl_exec($ch3);
            curl_close($ch3);

            $profs = json_decode($profRes, true);
            $oldBal = (!empty($profs) && isset($profs[0]['credits_balance'])) ? (int)$profs[0]['credits_balance'] : 0;
            $newBal = $oldBal + $creditsToAdd;

            // Mise à jour profiles
            $ch4 = curl_init($SUPABASE_URL . '/rest/v1/profiles?id=eq.' . urlencode($userId));
            curl_setopt($ch4, CURLOPT_CUSTOMREQUEST, 'PATCH');
            curl_setopt($ch4, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch4, CURLOPT_POSTFIELDS, json_encode(['credits_balance' => $newBal]));
            curl_setopt($ch4, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'apikey: ' . $SUPABASE_KEY,
                'Authorization: Bearer ' . $SUPABASE_KEY
            ]);
            curl_exec($ch4);
            curl_close($ch4);

            // Mise à jour payments
            $ch5 = curl_init($SUPABASE_URL . '/rest/v1/payments?id=eq.' . urlencode($payRow['id']));
            curl_setopt($ch5, CURLOPT_CUSTOMREQUEST, 'PATCH');
            curl_setopt($ch5, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch5, CURLOPT_POSTFIELDS, json_encode(['statut' => 'completed', 'updated_at' => date('c')]));
            curl_setopt($ch5, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'apikey: ' . $SUPABASE_KEY,
                'Authorization: Bearer ' . $SUPABASE_KEY
            ]);
            curl_exec($ch5);
            curl_close($ch5);

            // Grand livre credit_ledger
            $ch6 = curl_init($SUPABASE_URL . '/rest/v1/credit_ledger');
            curl_setopt($ch6, CURLOPT_POST, true);
            curl_setopt($ch6, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch6, CURLOPT_POSTFIELDS, json_encode([
                'user_id' => $userId,
                'montant_credits' => $creditsToAdd,
                'solde_apres' => $newBal,
                'motif' => 'purchase',
                'payment_id' => $payRow['id'],
                'commentaire' => 'Achat ' . ($payRow['package_id'] ?? 'crédits') . ' validé via IPN'
            ]));
            curl_setopt($ch6, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'apikey: ' . $SUPABASE_KEY,
                'Authorization: Bearer ' . $SUPABASE_KEY
            ]);
            curl_exec($ch6);
            curl_close($ch6);
        }
    }
}

echo json_encode(['success' => 1, 'message' => 'Notification reçue']);
