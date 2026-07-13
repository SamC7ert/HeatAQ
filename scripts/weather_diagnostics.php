#!/usr/bin/env php
<?php
/**
 * Weather Data Diagnostics
 *
 * Read-only inspection of weather_data to verify the climate data that was
 * downloaded (from Frost/DNMI). Reports coverage, gaps, duplicates, null
 * counts, and value ranges per station, plus the site -> station links.
 *
 * Run on the SERVER (where config.php / the database are available):
 *   php scripts/weather_diagnostics.php                # summary of all stations + site links
 *   php scripts/weather_diagnostics.php SN99840        # detailed report for one station
 *   php scripts/weather_diagnostics.php SN99840 2023   # detail for one station, one year
 *
 * Nothing is written; safe to run anytime.
 */

require_once __DIR__ . '/../config.php';

$station = $argv[1] ?? null;
$yearArg = isset($argv[2]) ? (int)$argv[2] : null;

// Plausible physical ranges (flag anything outside)
const T_MIN = -60, T_MAX = 40;      // °C
const W_MIN = 0,   W_MAX = 70;      // m/s
const H_MIN = 0,   H_MAX = 100;     // %

function hr($c = '-') { echo str_repeat($c, 72) . "\n"; }

try {
    $db = Config::getDatabase();
} catch (Throwable $e) {
    fwrite(STDERR, "Could not connect to database: " . $e->getMessage() . "\n");
    exit(1);
}

/** Expected hourly records in a calendar year (accounts for leap years). */
function expectedHours($year) {
    $isLeap = ($year % 4 === 0 && ($year % 100 !== 0 || $year % 400 === 0));
    return ($isLeap ? 366 : 365) * 24;
}

// ---------------------------------------------------------------------------
// Summary mode: list stations, site links, and a one-line coverage per station
// ---------------------------------------------------------------------------
if (!$station) {
    hr('=');
    echo "WEATHER STATIONS\n";
    hr('=');
    $stations = $db->query("SELECT station_id, station_name, latitude, longitude FROM weather_stations ORDER BY station_name")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($stations as $s) {
        $row = $db->prepare("SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM weather_data WHERE station_id = ?");
        $row->execute([$s['station_id']]);
        $r = $row->fetch(PDO::FETCH_ASSOC);
        printf("%-12s %-24s  %6s rows  %s .. %s  (%s, %s)\n",
            $s['station_id'], $s['station_name'],
            number_format($r['c']), $r['mn'] ?? '-', $r['mx'] ?? '-',
            $s['latitude'] ?? '?', $s['longitude'] ?? '?');
    }

    hr('=');
    echo "SITE -> STATION LINKS  (weather_station_id is the canonical column)\n";
    hr('=');
    $sites = $db->query("SELECT id, name, weather_station_id, default_weather_station FROM pool_sites ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($sites as $st) {
        $link = $st['weather_station_id'] ?: ($st['default_weather_station'] ? $st['default_weather_station'] . ' (legacy)' : 'NONE');
        // Does that station have any data?
        $has = '-';
        if ($st['weather_station_id'] || $st['default_weather_station']) {
            $sid = $st['weather_station_id'] ?: $st['default_weather_station'];
            $q = $db->prepare("SELECT COUNT(*) FROM weather_data WHERE station_id = ?");
            $q->execute([$sid]);
            $has = number_format($q->fetchColumn()) . ' rows';
        }
        printf("site %-3s %-22s -> %-16s  %s\n", $st['id'], $st['name'], $link, $has);
    }
    echo "\nRun with a station id for a detailed report, e.g.:  php scripts/weather_diagnostics.php " . ($stations[0]['station_id'] ?? 'SN99840') . "\n";
    exit(0);
}

// ---------------------------------------------------------------------------
// Detail mode: one station (optionally one year)
// ---------------------------------------------------------------------------
hr('=');
echo "STATION $station" . ($yearArg ? " — year $yearArg" : "") . "\n";
hr('=');

$totalStmt = $db->prepare("SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM weather_data WHERE station_id = ?");
$totalStmt->execute([$station]);
$tot = $totalStmt->fetch(PDO::FETCH_ASSOC);
if ((int)$tot['c'] === 0) {
    echo "No weather_data rows for this station id.\n";
    exit(0);
}
printf("Total rows: %s    Range: %s .. %s\n\n", number_format($tot['c']), $tot['mn'], $tot['mx']);

// Per-year coverage + null counts + value ranges
$where = "station_id = ?";
$args = [$station];
if ($yearArg) { $where .= " AND YEAR(timestamp) = ?"; $args[] = $yearArg; }

$yearStmt = $db->prepare("
    SELECT YEAR(timestamp) y, COUNT(*) c,
           SUM(temperature IS NULL) t_null,
           SUM(wind_speed IS NULL)  w_null,
           SUM(humidity IS NULL)    h_null,
           MIN(temperature) t_min, MAX(temperature) t_max, AVG(temperature) t_avg,
           MIN(wind_speed)  w_min, MAX(wind_speed)  w_max, AVG(wind_speed)  w_avg,
           MIN(humidity)    h_min, MAX(humidity)    h_max
    FROM weather_data WHERE $where GROUP BY y ORDER BY y
");
$yearStmt->execute($args);
$years = $yearStmt->fetchAll(PDO::FETCH_ASSOC);

echo "COVERAGE & VALUE RANGES BY YEAR\n";
hr();
printf("%-6s %-16s %-16s %-14s %-16s\n", "year", "rows / expected", "nulls T/W/H", "temp °C", "wind m/s");
hr();
foreach ($years as $y) {
    $exp = expectedHours((int)$y['y']);
    $pct = $exp ? round(100 * $y['c'] / $exp) : 0;
    $flagT = ($y['t_min'] < T_MIN || $y['t_max'] > T_MAX) ? ' !' : '';
    $flagW = ($y['w_min'] < W_MIN || $y['w_max'] > W_MAX) ? ' !' : '';
    printf("%-6s %5s /%5s %3d%%  %-14s %5.1f..%5.1f%-2s %5.1f..%5.1f%s\n",
        $y['y'], number_format($y['c']), number_format($exp), $pct,
        "{$y['t_null']}/{$y['w_null']}/{$y['h_null']}",
        $y['t_min'], $y['t_max'], $flagT,
        $y['w_min'], $y['w_max'], $flagW);
}

// Duplicate timestamps (PK should prevent, but verify)
$dup = $db->prepare("SELECT COUNT(*) FROM (SELECT timestamp FROM weather_data WHERE $where GROUP BY timestamp HAVING COUNT(*) > 1) d");
$dup->execute($args);
$dupCount = (int)$dup->fetchColumn();
echo "\nDuplicate timestamps: " . ($dupCount === 0 ? "none (good)" : "$dupCount  <-- unexpected, PK should prevent this") . "\n";

// Out-of-range value counts
$oor = $db->prepare("
    SELECT
      SUM(temperature < " . T_MIN . " OR temperature > " . T_MAX . ") t_bad,
      SUM(wind_speed  < " . W_MIN . " OR wind_speed  > " . W_MAX . ") w_bad,
      SUM(humidity    < " . H_MIN . " OR humidity    > " . H_MAX . ") h_bad
    FROM weather_data WHERE $where
");
$oor->execute($args);
$b = $oor->fetch(PDO::FETCH_ASSOC);
printf("Out-of-range values: temp=%d, wind=%d, humidity=%d\n", $b['t_bad'] ?? 0, $b['w_bad'] ?? 0, $b['h_bad'] ?? 0);

// Largest gaps (missing consecutive hours) — pull ordered timestamps and scan
echo "\nLARGEST GAPS (missing hours between consecutive records)\n";
hr();
$tsStmt = $db->prepare("SELECT timestamp FROM weather_data WHERE $where ORDER BY timestamp");
$tsStmt->execute($args);
$prev = null; $gaps = [];
while ($ts = $tsStmt->fetchColumn()) {
    $t = strtotime($ts);
    if ($prev !== null) {
        $missing = (int)round(($t - $prev) / 3600) - 1;
        if ($missing > 0) $gaps[] = ['after' => date('Y-m-d H:i', $prev), 'hours' => $missing];
    }
    $prev = $t;
}
usort($gaps, fn($a, $b) => $b['hours'] - $a['hours']);
if (!$gaps) {
    echo "No gaps — every consecutive hour is present.\n";
} else {
    $totalMissing = array_sum(array_column($gaps, 'hours'));
    printf("%d gap(s), %s missing hours total. Top 20:\n", count($gaps), number_format($totalMissing));
    foreach (array_slice($gaps, 0, 20) as $g) {
        printf("  %s  missing %s h\n", $g['after'], number_format($g['hours']));
    }
}

echo "\nDone.\n";
