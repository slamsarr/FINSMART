<?php
/**
 * Configuration PayDunya Sénégal pour hébergement Apache / Hostinger
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, PAYDUNYA-MASTER-KEY, PAYDUNYA-PRIVATE-KEY, PAYDUNYA-TOKEN');

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function getPayDunyaConfig() {
    $configFile = __DIR__ . '/../../paydunya.config.json';
    $localConfigFile = __DIR__ . '/../../paydunya.config.local.json';
    
    $config = [
        'master_key' => getenv('PAYDUNYA_MASTER_KEY') ?: '',
        'private_key' => getenv('PAYDUNYA_PRIVATE_KEY') ?: '',
        'token' => getenv('PAYDUNYA_TOKEN') ?: '',
        'env' => getenv('PAYDUNYA_ENV') ?: 'test',
        'currency' => 'XOF',
        'callback_url' => '',
        'return_url' => '',
        'cancel_url' => ''
    ];

    $targetFile = file_exists($localConfigFile) ? $localConfigFile : (file_exists($configFile) ? $configFile : null);
    if ($targetFile) {
        $data = json_decode(file_get_contents($targetFile), true);
        if (is_array($data)) {
            $config = array_merge($config, $data);
        }
    }

    $isPlaceholder = empty($config['master_key']) || 
                      empty($config['private_key']) || 
                      empty($config['token']) ||
                      strpos($config['master_key'], 'VOTRE_') !== false ||
                      strpos($config['private_key'], 'VOTRE_') !== false ||
                      strpos($config['token'], 'VOTRE_') !== false;

    $config['is_ready'] = !$isPlaceholder;
    return $config;
}
