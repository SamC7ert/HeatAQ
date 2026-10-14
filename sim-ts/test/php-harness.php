<?php
// Command line only: never run from a web request.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
// php sim-ts/test/php-harness.php <libdir> '<scenario json>' <out.json> [--no-inputs]
// Runs the real PHP simulator on ts_sim and writes {inputs, php: {summary, daily, hourly}}.
error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('display_errors', 'stderr');
ini_set('error_log', '/dev/null');
ini_set('memory_limit', '2G');
date_default_timezone_set(getenv('PHPTZ') ?: 'UTC');

class Config {
    public static function getDatabase() {
        static $db;
        return $db ??= new PDO('mysql:unix_socket=/run/mysqld/mysqld.sock;dbname=' . (getenv('TSDB') ?: 'ts_sim') . ';charset=utf8mb4', 'root', '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    }
    public static function isDebug() { return false; }
    public static function requiresAuth() { return false; }
}
[$_, $lib, $scenJson, $out] = $argv;
$noInputs = in_array('--no-inputs', $argv, true);
$sc = json_decode($scenJson, true);
require "$lib/PoolScheduler.php";
require "$lib/EnergySimulator.php";
$pdo = Config::getDatabase();

function build($pdo, $sc) {
    $scheduler = new PoolScheduler($pdo, 5, (int)$sc['template']);
    $sim = new EnergySimulator($pdo, 5, $scheduler);
    $sim->setConfigFromUI([
        'pool' => ['area_m2' => 312.5, 'volume_m3' => 625, 'depth_m' => 2, 'wind_exposure' => $sc['wind'] ?? 0.5,
                   'solar_absorption' => 60, 'years_operating' => $sc['years'] ?? 3],
        'cover' => ['has_cover' => $sc['cover'] ?? true, 'r_value' => 5, 'solar_transmittance' => 10],
        'solar' => ['has_tunnel' => false],
    ]);
    $control = ['target_temp' => $sc['target'] ?? 28, 'upper_tolerance' => 1, 'lower_tolerance' => 2, 'strategy' => $sc['strategy'] ?? 'predictive'];
    if (array_key_exists('standby', $sc)) $control['standby_temp'] = $sc['standby'];
    $sim->setConfigFromUI([
        'equipment' => ['hp_capacity_kw' => $sc['hp'] ?? 250, 'hp_cop' => 4.6, 'boiler_capacity_kw' => $sc['boiler'] ?? 200,
                        'boiler_efficiency' => 0.92, 'showers_use_hp' => true, 'boiler_type' => $sc['boiler_type'] ?? 'electric'],
        'control' => $control,
        'bathers' => ['per_day' => 100, 'refill_liters' => 30, 'shower_liters' => 60, 'activity_factor' => 1.1],
        'water_temps' => ['cold_water' => 5, 'shower_target' => 40, 'hot_water_tank' => 60, 'hp_max_dhw' => 35],
        'costs' => ['electricity_nok_kwh' => 1.2, 'gas_nok_kwh' => 0.8],
    ]);
    if (isset($sc['offset'])) $sim->setConfigFromUI(['control' => ['target_offset' => $sc['offset']]]);
    if (isset($sc['air_source'])) $sim->setEquipment(['heat_pump' => ['type' => 'air_source', 'min_operating_temp' => -15, 'max_operating_temp' => 35]]);
    return $sim;
}

$res = ['scenario' => $sc];
$t0 = microtime(true);
$r = build($pdo, $sc)->runSimulation($sc['start'], $sc['end']);
$res['php_ms'] = round((microtime(true) - $t0) * 1000);
$res['php'] = [
    'summary' => $r['summary'],
    'daily' => $r['daily'],
    'hourly' => array_map(fn($h) => [
        $h['timestamp'], $h['pool']['water_temp'], $h['pool']['target_temp'], $h['pool']['effective_target'],
        $h['pool']['heating_mode'], $h['losses']['total_kw'], $h['gains']['solar_kw'], $h['gains']['heat_pump_kw'],
        $h['gains']['boiler_kw'], $h['energy']['hp_electricity_kwh'], $h['energy']['boiler_fuel_kwh'], $h['cost'],
        $h['calc']['water_temp_start'], $h['losses']['evaporation_kw'], $h['losses']['convection_kw'],
        $h['losses']['radiation_kw'], $h['losses']['cover_kw'], $h['losses']['floor_kw'], $h['losses']['walls_kw'],
        $h['pool']['is_preheat'], $h['energy']['hp_cop'],
    ], $r['hourly']),
];
if (!$noInputs && method_exists('EnergySimulator', 'exportRunInputs')) {
    $res['inputs'] = build($pdo, $sc)->exportRunInputs($sc['start'], $sc['end']);
}
file_put_contents($out, json_encode($res));
echo "ok {$res['php_ms']} ms, hours " . count($r['hourly']) . "\n";
