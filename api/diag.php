<?php
/**
 * Read-only database diagnostics endpoint (token-gated).
 *
 * Lets a caller holding the shared DIAG_TOKEN inspect the database over HTTPS
 * via the server's existing config.php / PDO connection. Read-only.
 *
 * Setup:
 *   1. Add to config_heataq/database.env:   DIAG_TOKEN=<secret>
 *   2. Deploy this file.
 *   3. GET https://<host>/api/diag.php?token=<secret>&action=<action>
 *
 * Actions:
 *   ping                         DB time/version + weather_data row count
 *   tables                       list tables with (approximate) row counts
 *   schema&table=NAME            columns of a table
 *   weather                      per-station coverage summary + site links
 *   weather&station=SN99840      detailed coverage: per-year rows/nulls/ranges,
 *                                duplicates, out-of-range counts, largest gaps
 *   weather&station=SN99840&year=2023   restrict the detail to one year
 *   query&sql=SELECT ...         run a read-only SELECT/SHOW/EXPLAIN (LIMIT capped)
 *
 * Security: read-only (query rejects anything but SELECT/SHOW/EXPLAIN/DESCRIBE,
 * blocks multiple statements and INTO OUTFILE, caps rows); inert unless
 * DIAG_TOKEN is set; 403 without a matching token. Token via ?token= or the
 * X-Diag-Token header.
 */

header('Content-Type: application/json');
header('X-Robots-Tag: noindex, nofollow');
ini_set('display_errors', '0');

// Plausible physical ranges for value-sanity flags
const DIAG_T_MIN = -60, DIAG_T_MAX = 40;   // °C
const DIAG_W_MIN = 0,   DIAG_W_MAX = 70;   // m/s
const DIAG_H_MIN = 0,   DIAG_H_MAX = 100;  // %

function diag_out($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

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

function diag_expected_hours(int $year): int {
    $leap = ($year % 4 === 0 && ($year % 100 !== 0 || $year % 400 === 0));
    return ($leap ? 366 : 365) * 24;
}

/** Guarded read-only query. Throws on anything that could write. */
function diag_run_query(PDO $db, string $sql): array {
    $sql = trim(rtrim(trim($sql), "; \t\n\r\0"));
    if ($sql === '') throw new RuntimeException('empty query');
    if (strpos($sql, ';') !== false) throw new RuntimeException('multiple statements are not allowed');
    if (!preg_match('/^(SELECT|SHOW|EXPLAIN|DESCRIBE|DESC)\b/i', $sql)) {
        throw new RuntimeException('only SELECT / SHOW / EXPLAIN / DESCRIBE are allowed (read-only)');
    }
    if (preg_match('/\binto\s+(out|dump)file\b/i', $sql)) {
        throw new RuntimeException('file output is not allowed');
    }
    if (preg_match('/^SELECT\b/i', $sql) && !preg_match('/\blimit\s+\d/i', $sql)) {
        $sql .= ' LIMIT 500';
    }
    return $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
}

// --- Bootstrap + token gate ---
$configPath = __DIR__ . '/../config.php';
if (!is_file($configPath)) diag_out(['error' => 'config.php not found on server'], 500);
require_once $configPath;

$configured = diag_read_token();
if (empty($configured)) {
    diag_out(['error' => 'diagnostics disabled: DIAG_TOKEN is not set in config_heataq/database.env'], 403);
}
$provided = $_GET['token'] ?? ($_SERVER['HTTP_X_DIAG_TOKEN'] ?? '');
if (!is_string($provided) || !hash_equals((string)$configured, $provided)) {
    diag_out(['error' => 'invalid or missing token'], 403);
}

try {
    $db = Config::getDatabase();
} catch (Throwable $e) {
    diag_out(['ok' => false, 'error' => 'DB connection failed: ' . $e->getMessage()], 500);
}

$action = $_GET['action'] ?? 'ping';

try {
    switch ($action) {

        case 'ping': {
            $row = $db->query('SELECT NOW() AS db_time, VERSION() AS db_version')->fetch(PDO::FETCH_ASSOC);
            diag_out([
                'ok' => true, 'action' => 'ping', 'token_ok' => true, 'db_connected' => true,
                'db_time' => $row['db_time'] ?? null,
                'db_version' => $row['db_version'] ?? null,
                'weather_data_rows' => (int)$db->query('SELECT COUNT(*) FROM weather_data')->fetchColumn(),
            ]);
        }

        case 'tables': {
            $rows = $db->query("
                SELECT table_name, table_rows, ROUND(data_length/1024/1024, 1) AS data_mb
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                ORDER BY table_name
            ")->fetchAll(PDO::FETCH_ASSOC);
            diag_out(['ok' => true, 'action' => 'tables', 'note' => 'table_rows is approximate for InnoDB', 'tables' => $rows]);
        }

        case 'schema': {
            $table = $_GET['table'] ?? '';
            if ($table === '') diag_out(['error' => 'table parameter required'], 400);
            $stmt = $db->prepare("
                SELECT column_name, column_type, is_nullable, column_key, column_default, extra
                FROM information_schema.columns
                WHERE table_schema = DATABASE() AND table_name = ?
                ORDER BY ordinal_position
            ");
            $stmt->execute([$table]);
            $cols = $stmt->fetchAll(PDO::FETCH_ASSOC);
            if (!$cols) diag_out(['error' => "table not found: $table"], 404);
            diag_out(['ok' => true, 'action' => 'schema', 'table' => $table, 'columns' => $cols]);
        }

        case 'weather': {
            $station = $_GET['station'] ?? null;

            // --- Summary: all stations + site links ---
            if (!$station) {
                $stations = [];
                foreach ($db->query("SELECT station_id, station_name, latitude, longitude FROM weather_stations ORDER BY station_name")->fetchAll(PDO::FETCH_ASSOC) as $s) {
                    $q = $db->prepare("SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM weather_data WHERE station_id = ?");
                    $q->execute([$s['station_id']]);
                    $r = $q->fetch(PDO::FETCH_ASSOC);
                    $stations[] = [
                        'station_id' => $s['station_id'], 'station_name' => $s['station_name'],
                        'latitude' => $s['latitude'], 'longitude' => $s['longitude'],
                        'rows' => (int)$r['c'], 'first' => $r['mn'], 'last' => $r['mx'],
                    ];
                }
                $sites = [];
                foreach ($db->query("SELECT id, name, weather_station_id, default_weather_station FROM pool_sites ORDER BY id")->fetchAll(PDO::FETCH_ASSOC) as $st) {
                    $sid = $st['weather_station_id'] ?: $st['default_weather_station'];
                    $has = null;
                    if ($sid) {
                        $q = $db->prepare("SELECT COUNT(*) FROM weather_data WHERE station_id = ?");
                        $q->execute([$sid]);
                        $has = (int)$q->fetchColumn();
                    }
                    $sites[] = [
                        'site_id' => (int)$st['id'], 'name' => $st['name'],
                        'weather_station_id' => $st['weather_station_id'],
                        'default_weather_station' => $st['default_weather_station'],
                        'linked_station_rows' => $has,
                    ];
                }
                diag_out(['ok' => true, 'action' => 'weather', 'stations' => $stations, 'site_links' => $sites]);
            }

            // --- Detail: one station ---
            $where = "station_id = ?"; $args = [$station];
            if (isset($_GET['year'])) { $where .= " AND YEAR(timestamp) = ?"; $args[] = (int)$_GET['year']; }

            $tstmt = $db->prepare("SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM weather_data WHERE $where");
            $tstmt->execute($args);
            $tot = $tstmt->fetch(PDO::FETCH_ASSOC);
            if ((int)$tot['c'] === 0) diag_out(['ok' => true, 'action' => 'weather', 'station' => $station, 'total_rows' => 0, 'note' => 'no rows for this station id']);

            $ystmt = $db->prepare("
                SELECT YEAR(timestamp) y, COUNT(*) c,
                       SUM(temperature IS NULL) t_null, SUM(wind_speed IS NULL) w_null, SUM(humidity IS NULL) h_null,
                       MIN(temperature) t_min, MAX(temperature) t_max, ROUND(AVG(temperature),1) t_avg,
                       MIN(wind_speed) w_min, MAX(wind_speed) w_max, ROUND(AVG(wind_speed),1) w_avg,
                       MIN(humidity) h_min, MAX(humidity) h_max
                FROM weather_data WHERE $where GROUP BY y ORDER BY y
            ");
            $ystmt->execute($args);
            $years = [];
            foreach ($ystmt->fetchAll(PDO::FETCH_ASSOC) as $y) {
                $exp = diag_expected_hours((int)$y['y']);
                $years[] = [
                    'year' => (int)$y['y'], 'rows' => (int)$y['c'], 'expected' => $exp,
                    'coverage_pct' => $exp ? round(100 * $y['c'] / $exp, 1) : null,
                    'nulls' => ['temperature' => (int)$y['t_null'], 'wind_speed' => (int)$y['w_null'], 'humidity' => (int)$y['h_null']],
                    'temperature' => ['min' => $y['t_min'], 'max' => $y['t_max'], 'avg' => $y['t_avg'],
                        'out_of_range' => ($y['t_min'] < DIAG_T_MIN || $y['t_max'] > DIAG_T_MAX)],
                    'wind_speed' => ['min' => $y['w_min'], 'max' => $y['w_max'], 'avg' => $y['w_avg'],
                        'out_of_range' => ($y['w_min'] < DIAG_W_MIN || $y['w_max'] > DIAG_W_MAX)],
                    'humidity' => ['min' => $y['h_min'], 'max' => $y['h_max']],
                ];
            }

            $dstmt = $db->prepare("SELECT COUNT(*) FROM (SELECT timestamp FROM weather_data WHERE $where GROUP BY timestamp HAVING COUNT(*) > 1) d");
            $dstmt->execute($args);
            $duplicates = (int)$dstmt->fetchColumn();

            // Largest gaps (scan ordered timestamps server-side, return aggregates only)
            $gstmt = $db->prepare("SELECT timestamp FROM weather_data WHERE $where ORDER BY timestamp");
            $gstmt->execute($args);
            $prev = null; $gaps = []; $totalMissing = 0;
            while ($ts = $gstmt->fetchColumn()) {
                $t = strtotime($ts);
                if ($prev !== null) {
                    $missing = (int)round(($t - $prev) / 3600) - 1;
                    if ($missing > 0) { $gaps[] = ['after' => date('Y-m-d H:i', $prev), 'missing_hours' => $missing]; $totalMissing += $missing; }
                }
                $prev = $t;
            }
            usort($gaps, fn($a, $b) => $b['missing_hours'] - $a['missing_hours']);

            diag_out([
                'ok' => true, 'action' => 'weather', 'station' => $station,
                'total_rows' => (int)$tot['c'], 'first' => $tot['mn'], 'last' => $tot['mx'],
                'years' => $years,
                'duplicate_timestamps' => $duplicates,
                'gaps' => ['count' => count($gaps), 'total_missing_hours' => $totalMissing, 'largest' => array_slice($gaps, 0, 20)],
            ]);
        }

        case 'query': {
            $sql = $_GET['sql'] ?? '';
            if ($sql === '') diag_out(['error' => 'sql parameter required'], 400);
            $rows = diag_run_query($db, $sql);
            diag_out(['ok' => true, 'action' => 'query', 'row_count' => count($rows), 'rows' => $rows]);
        }

        default:
            diag_out(['error' => 'unknown action', 'action' => $action,
                'available' => ['ping', 'tables', 'schema', 'weather', 'query']], 400);
    }
} catch (Throwable $e) {
    diag_out(['ok' => false, 'action' => $action, 'error' => $e->getMessage()], 500);
}
