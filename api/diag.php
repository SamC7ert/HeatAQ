<?php
/**
 * Read-only database diagnostics endpoint (token-gated).
 *
 * PROOF OF CONCEPT: only `action=ping` is implemented for now — it confirms
 * the request reaches the server, the token matches, and the database is
 * reachable. Once the round-trip is verified, this will grow read-only
 * actions (table listing, schema, weather coverage, guarded SELECT).
 *
 * Setup:
 *   1. Add to config_heataq/database.env:   DIAG_TOKEN=<secret>
 *   2. Deploy this file.
 *   3. GET https://<host>/api/diag.php?token=<secret>&action=ping
 *
 * Security: read-only; inert unless DIAG_TOKEN is set; returns 403 without a
 * matching token. The token may be sent as ?token= or the X-Diag-Token header.
 */

header('Content-Type: application/json');
header('X-Robots-Tag: noindex, nofollow');
ini_set('display_errors', '0');   // never leak HTML/stack traces from this endpoint

function diag_out($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Read DIAG_TOKEN. Prefer the Config class; fall back to parsing database.env
 * directly (same locations frost_api.php checks) in case Config::get() only
 * exposes a fixed set of keys.
 */
function diag_read_token(): ?string {
    if (class_exists('Config')) {
        try {
            $t = Config::get('DIAG_TOKEN');
            if (!empty($t)) return (string)$t;
        } catch (Throwable $e) { /* fall through */ }
    }
    $paths = [
        dirname(__DIR__, 2) . '/config_heataq/database.env',
        '/config_heataq/database.env',
        dirname(__DIR__) . '/database.env',
    ];
    foreach ($paths as $p) {
        if (!is_file($p)) continue;
        foreach (file($p, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === ';' || $line[0] === '#') continue;
            if (strncmp($line, 'DIAG_TOKEN', 10) === 0) {
                $parts = explode('=', $line, 2);
                if (count($parts) === 2) return trim($parts[1]);
            }
        }
    }
    return null;
}

// --- Bootstrap config (loads config_heataq/database.env) ---
$configPath = __DIR__ . '/../config.php';
if (!is_file($configPath)) {
    diag_out(['error' => 'config.php not found on server'], 500);
}
require_once $configPath;

// --- Token gate ---
$configured = diag_read_token();
if (empty($configured)) {
    diag_out(['error' => 'diagnostics disabled: DIAG_TOKEN is not set in config_heataq/database.env'], 403);
}
$provided = $_GET['token'] ?? ($_SERVER['HTTP_X_DIAG_TOKEN'] ?? '');
if (!is_string($provided) || !hash_equals((string)$configured, $provided)) {
    diag_out(['error' => 'invalid or missing token'], 403);
}

// --- Dispatch ---
$action = $_GET['action'] ?? 'ping';

switch ($action) {
    case 'ping':
        $result = ['ok' => true, 'action' => 'ping', 'token_ok' => true];
        try {
            $db = Config::getDatabase();
            $result['db_connected'] = true;
            $row = $db->query('SELECT NOW() AS db_time, VERSION() AS db_version')->fetch(PDO::FETCH_ASSOC);
            $result['db_time'] = $row['db_time'] ?? null;
            $result['db_version'] = $row['db_version'] ?? null;
            $result['weather_data_rows'] = (int)$db->query('SELECT COUNT(*) FROM weather_data')->fetchColumn();
        } catch (Throwable $e) {
            diag_out([
                'ok' => false, 'token_ok' => true,
                'db_connected' => false,
                'error' => 'DB error: ' . $e->getMessage(),
            ], 500);
        }
        diag_out($result);
        break;

    default:
        diag_out(['error' => 'unknown action', 'action' => $action, 'available' => ['ping']], 400);
}
