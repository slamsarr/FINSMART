<?php
/**
 * Configuration PayTech Sénégal pour hébergement Apache / Hostinger
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, API_KEY, API_SECRET');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function getPayTechConfig() {
    $configFile = __DIR__ . '/../../paytech.config.json';
    $localConfigFile = __DIR__ . '/../../paytech.config.local.json';
    
    $config = [
        'api_key' => getenv('PAYTECH_API_KEY') ?: '',
        'api_secret' => getenv('PAYTECH_API_SECRET') ?: '',
        'env' => getenv('PAYTECH_ENV') ?: 'test',
        'currency' => 'XOF',
        'ipn_url' => '',
        'success_url' => '',
        'cancel_url' => ''
    ];

    $path = file_exists($localConfigFile) ? $localConfigFile : (file_exists($configFile) ? $configFile : null);
    if ($path) {
        $json = json_decode(file_get_contents($path), true);
        if (is_array($json)) {
            $config = array_merge($config, $json);
        }
    }

    $isPlaceholder = empty($config['api_key']) || 
                     strpos($config['api_key'], 'VOTRE_API_KEY') !== false ||
                     empty($config['api_secret']) || 
                     strpos($config['api_secret'], 'VOTRE_API_SECRET') !== false;

    $config['is_ready'] = !$isPlaceholder;
    return $config;
}
