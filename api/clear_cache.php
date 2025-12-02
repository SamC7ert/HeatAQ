<?php
/**
 * Clear PHP OPcache
 *
 * Access via: /api/clear_cache.php
 * Returns JSON with status and current simulator version
 */

header('Content-Type: application/json');

$result = [
    'opcache_cleared' => false,
    'opcache_enabled' => function_exists('opcache_reset'),
    'simulator_version' => null,
    'php_version' => PHP_VERSION,
    'timestamp' => date('Y-m-d H:i:s')
];

// Clear opcache if available
if (function_exists('opcache_reset')) {
    $result['opcache_cleared'] = opcache_reset();
}

// Get simulator version to confirm code is fresh
require_once __DIR__ . '/../lib/EnergySimulator.php';
if (class_exists('EnergySimulator')) {
    $result['simulator_version'] = EnergySimulator::getVersion();
}

echo json_encode($result, JSON_PRETTY_PRINT);
