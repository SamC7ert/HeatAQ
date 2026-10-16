<?php
/**
 * HeatAQ Simulation API
 * REST API for pool energy simulations
 *
 * Endpoints:
 * - POST ?action=run_simulation - Run a new simulation
 * - GET ?action=get_run&run_id=123 - Get simulation run details
 * - GET ?action=get_runs - List simulation runs
 * - GET ?action=get_results&run_id=123 - Get detailed results
 * - GET ?action=get_daily_results&run_id=123 - Get daily aggregated results
 * - GET ?action=get_summary&run_id=123 - Get run summary only
 * - DELETE ?action=delete_run&run_id=123 - Delete a simulation run
 * - GET ?action=get_weather_range - Get available weather data date range
 * - GET ?action=get_version - Get simulator version
 */

// Enable error output for debugging
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Increase memory limit for long simulations (10+ years)
ini_set('memory_limit', '512M');

// Custom error handler to return JSON errors
set_error_handler(function($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Catch fatal errors
// A fatal error (memory, time limit) mid-run must not leave the run row
// 'running' forever: the run sets $GLOBALS['activeRunId'] while it executes.
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!empty($GLOBALS['activeRunId']) && isset($GLOBALS['pdo'])) {
            try {
                updateRunStatus($GLOBALS['pdo'], $GLOBALS['activeRunId'], 'failed', ['error' => 'Simulation aborted: ' . strtok($error['message'], "\n")]);
            } catch (Throwable $e) {
                // nothing more we can do
            }
        }
        $debug = class_exists('Config') && Config::isDebug();
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json');
        }
        echo json_encode($debug
            ? ['error' => $error['message'], 'file' => $error['file'], 'line' => $error['line']]
            : ['error' => 'Simulation aborted: ' . strtok($error['message'], "\n")]);
    }
});

// Include configuration
require_once __DIR__ . '/../config.php';

// Include authentication if required
// pool_site_id is now OPTIONAL at startup - individual actions check if they need it
$currentPoolSiteId = null;
$currentUserId = null;
$auth = null;

if (Config::requiresAuth() && file_exists(__DIR__ . '/../auth.php')) {
    require_once __DIR__ . '/../auth.php';
    $auth = HeatAQAuth::check(Config::requiresAuth());
    if ($auth) {
        if (isset($auth['project']['pool_site_id']) && !empty($auth['project']['pool_site_id'])) {
            $currentPoolSiteId = (int)$auth['project']['pool_site_id'];
        }
        $currentUserId = $auth['user']['user_id'] ?? null;
    }
} else {
    // Development mode - get pool_site_id from cookie (optional)
    if (isset($_COOKIE['heataq_pool_site_id']) && !empty($_COOKIE['heataq_pool_site_id'])) {
        $currentPoolSiteId = (int)$_COOKIE['heataq_pool_site_id'];
    }
    // pool_site_id check moved to individual actions that require it
}

// Release the PHP session lock now that auth is done. A running simulation
// holds this request open for a long time; with the lock held, the
// get_run_progress polls (and every other request from the same browser)
// would block until the run finishes.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

// Include required classes
require_once __DIR__ . '/../lib/RequestGuard.php';
require_once __DIR__ . '/../lib/PoolScheduler.php';
require_once __DIR__ . '/../lib/EnergySimulator.php';
require_once __DIR__ . '/../lib/RunRetention.php';

// CORS & Headers
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Session-ID');

// Handle OPTIONS for CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

/**
 * Send JSON response
 */
function sendResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit;
}

/**
 * Send error response
 */
function sendError($message, $statusCode = 400) {
    sendResponse(['error' => $message], $statusCode);
}

/**
 * Get request parameter
 */
function getParam($name, $default = null) {
    // Check JSON body for POST requests
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $json = json_decode(file_get_contents('php://input'), true);
        if ($json && isset($json[$name])) {
            return $json[$name];
        }
    }
    return $_GET[$name] ?? $_POST[$name] ?? $default;
}

/**
 * Validate date format
 */
/**
 * Default run for the Details tab when the UI sends no run_id: the newest
 * completed run of this site that covers $date AND stored hourly rows
 * (summary-only runs cannot be inspected). Used by debug_hour and debug_week.
 */
function defaultDebugRunId($pdo, $poolSiteId, $date, $needHourly = true) {
    $hourly = $needHourly
        ? 'AND EXISTS (SELECT 1 FROM simulation_hourly_results h WHERE h.run_id = r.run_id)' : '';
    $stmt = $pdo->prepare("
        SELECT r.run_id
        FROM simulation_runs r
        WHERE r.pool_site_id = ?
          AND r.status = 'completed'
          AND r.start_date <= ?
          AND r.end_date >= ?
          {$hourly}
        ORDER BY r.created_at DESC, r.run_id DESC
        LIMIT 1
    ");
    $stmt->execute([$poolSiteId, $date, $date]);
    $runId = $stmt->fetchColumn();
    return $runId ? (int) $runId : null;
}

/** A TypeScript run whose hourly rows the browser is (or was) still saving. */
function isHourlySaving($pdo, $runId) {
    $stmt = $pdo->prepare("SELECT summary_json FROM simulation_runs WHERE run_id = ?");
    $stmt->execute([(int) $runId]);
    $summary = json_decode($stmt->fetchColumn() ?: '', true) ?: [];
    return !empty($summary['hourly_saving']);
}

function validateDate($date) {
    $d = DateTime::createFromFormat('Y-m-d', $date);
    return $d && $d->format('Y-m-d') === $date;
}

// Main handler
try {
    // Get database connection
    $pdo = Config::getDatabase();

    $action = getParam('action', '');

    switch ($action) {
        case 'run_simulation':
            RequestGuard::requireWriteRequest();
            RequestGuard::requireRole($auth, 'operator');
            // Require pool_site_id for simulation
            if (!$currentPoolSiteId) {
                sendResponse([
                    'error' => 'No pool site configured',
                    'code' => 'NO_POOL_SITE',
                    'message' => 'Please configure a pool site before running simulations'
                ], 400);
            }

            // Validate required parameters
            $startDate = getParam('start_date');
            $endDate = getParam('end_date');
            $scenarioName = getParam('scenario_name', 'Unnamed Scenario');
            $description = getParam('description', '');

            if (!$startDate || !$endDate) {
                sendError('start_date and end_date parameters required');
            }

            if (!validateDate($startDate) || !validateDate($endDate)) {
                sendError('Invalid date format. Use YYYY-MM-DD');
            }

            if (strtotime($endDate) < strtotime($startDate)) {
                sendError('end_date must be after start_date');
            }

            // Check date range size (limit to prevent memory issues)
            $daysDiff = (strtotime($endDate) - strtotime($startDate)) / 86400;
            $maxDays = 3653; // ~10 years
            if ($daysDiff > $maxDays) {
                sendError("Date range too large. Maximum {$maxDays} days allowed.");
            }

            // Get optional equipment overrides (legacy)
            $equipmentOverrides = getParam('equipment', null);

            // Get optional config overrides (new - can override equipment, control, pool, etc.)
            $configOverride = getParam('config_override', null);

            // Get optional config and template IDs
            $configId = getParam('config_id', null);
            $templateId = getParam('template_id', null);
            $poolId = getParam('pool_id', null);

            // The run is prepared here (setup, validation, inputs) and simulated
            // in the browser by the TypeScript engine (assets/js/sim), which
            // submits the results (submit_ts_results, submit_ts_hourly).

            // Store hourly data? Default true for backward compatibility
            // Set to false for faster analysis runs that only need summary
            $storeHourly = getParam('store_hourly', true);
            if ($storeHourly === 'false' || $storeHourly === false) {
                $storeHourly = false;
            } else {
                $storeHourly = true;
            }

            // The schedule template must belong to this site's project
            if ($templateId) {
                $tplStmt = $pdo->prepare("
                    SELECT 1 FROM schedule_templates t
                    JOIN pool_sites s ON s.project_id = t.project_id
                    WHERE t.template_id = ? AND s.id = ?
                ");
                $tplStmt->execute([$templateId, $currentPoolSiteId]);
                if (!$tplStmt->fetchColumn()) {
                    sendError('Run not started - the selected Schedule was not found in this project', 400);
                }
            }

            // Initialize scheduler (with optional template selection)
            $poolSiteId = $currentPoolSiteId;
            $scheduler = new PoolScheduler($pdo, $poolSiteId, $templateId);

            // DEBUG: Log what PoolScheduler loaded
            $scheduleTemplate = $scheduler->getTemplate();
            $dateRanges = $scheduler->getDateRanges();  // Get loaded date ranges

            // DEBUG: Direct DB query to see what's actually in the table
            $dbCheckStmt = $pdo->prepare("SELECT id, schedule_template_id, is_active, priority, week_schedule_id FROM calendar_date_ranges WHERE schedule_template_id = ?");
            $dbCheckStmt->execute([$templateId]);
            $dbRows = $dbCheckStmt->fetchAll(PDO::FETCH_ASSOC);

            $debugScheduleInfo = [
                'requested_template_id' => $templateId,
                'loaded_template_id' => $scheduleTemplate['template_id'] ?? null,
                'loaded_template_name' => $scheduleTemplate['name'] ?? null,
                'date_ranges_count' => count($dateRanges),
                'date_ranges' => array_map(function($r) {
                    return [
                        'id' => $r['id'] ?? null,
                        'is_default' => $r['is_default'] ?? false,
                        'week_schedule_id' => $r['week_schedule_id'] ?? null,
                        'priority' => $r['priority'] ?? null,
                    ];
                }, $dateRanges),
                'db_direct_query' => $dbRows,  // Show what's actually in DB
            ];

            // Get first date schedule to verify (with error handling)
            $testDate = $startDate ?? date('Y-m-d');
            try {
                $testScheduleName = $scheduler->getScheduleForDate($testDate);
                $debugScheduleInfo['test_date'] = $testDate;
                $debugScheduleInfo['test_schedule_name'] = $testScheduleName;
            } catch (Exception $e) {
                $debugScheduleInfo['test_date'] = $testDate;
                $debugScheduleInfo['test_error'] = $e->getMessage();
                // Re-throw to stop simulation
                error_log("[SimAPI] Schedule debug (error): " . json_encode($debugScheduleInfo));
                sendError($e->getMessage() . ' | Debug: ' . json_encode($debugScheduleInfo), 400);
            }
            error_log("[SimAPI] Schedule debug: " . json_encode($debugScheduleInfo));

            // Initialize simulator
            $simulator = new EnergySimulator($pdo, $poolSiteId, $scheduler);

            // Pool selection is required
            if (!$poolId) {
                sendError('Run not started - missing Pool selection', 400);
            }

            // Load pool data from pools table
            $poolStmt = $pdo->prepare("
                SELECT * FROM pools WHERE pool_id = ? AND pool_site_id = ? AND is_active = 1
            ");
            $poolStmt->execute([$poolId, $currentPoolSiteId]);
            $poolRow = $poolStmt->fetch();

            if (!$poolRow) {
                sendError('Run not started - selected Pool not found or inactive', 400);
            }

            // Build pool config from database row
            $poolConfig = [
                'pool' => [
                    'area_m2' => (float)$poolRow['area_m2'],
                    'volume_m3' => (float)$poolRow['volume_m3'],
                    'depth_m' => (float)$poolRow['depth_m'],
                    'wind_exposure' => (float)$poolRow['wind_exposure'],
                    'solar_absorption' => (float)$poolRow['solar_absorption'],
                    'years_operating' => (int)$poolRow['years_operating'],
                ],
                'cover' => [
                    'has_cover' => (bool)$poolRow['has_cover'],
                    'r_value' => (float)$poolRow['cover_r_value'],
                    'solar_transmittance' => (float)$poolRow['cover_solar_transmittance'],
                ],
                'solar' => [
                    'has_tunnel' => (bool)$poolRow['has_tunnel'],
                ]
            ];
            $simulator->setConfigFromUI($poolConfig);

            // Config selection is required
            if (!$configId) {
                sendError('Run not started - missing Config selection', 400);
            }

            // Load and apply configuration
            {
                $config = null;
                $configRow = null;

                // Only a config of this site's project (or an unassigned
                // legacy one) may be used - never another project's.
                $configScope = "AND (project_id IS NULL OR project_id = (SELECT project_id FROM pool_sites WHERE id = ?))";
                $configParams = [$configId, $currentPoolSiteId];

                // Try with all columns first (json_config + legacy columns + template_name)
                try {
                    $configStmt = $pdo->prepare("
                        SELECT template_name, json_config, hp_capacity_kw, boiler_capacity_kw, target_temp, control_strategy
                        FROM config_templates WHERE template_id = ? $configScope
                    ");
                    $configStmt->execute($configParams);
                    $configRow = $configStmt->fetch();
                } catch (PDOException $e) {
                    // Columns may not exist, try fallback
                    $configRow = null;
                }

                // Fallback: try config_json column (original schema name)
                if (!$configRow) {
                    try {
                        $configStmt = $pdo->prepare("
                            SELECT template_name, config_json as json_config
                            FROM config_templates WHERE template_id = ? $configScope
                        ");
                        $configStmt->execute($configParams);
                        $configRow = $configStmt->fetch();
                    } catch (PDOException $e) {
                        // Neither column exists
                        $configRow = null;
                    }
                }

                if (!$configRow) {
                    sendError('Run not started - the selected Config was not found in this project. Pick a Config and try again.', 400);
                }

                if ($configRow) {
                    $config = json_decode($configRow['json_config'] ?? '{}', true) ?: [];

                    // IMPORTANT: ALL pool physical properties come ONLY from the
                    // pools table (loaded above): dimensions, wind exposure,
                    // solar absorption, years operating, and the cover/solar
                    // sections. Strip them from the template so a legacy
                    // json_config with stale non-null values cannot silently
                    // override the Pool editor (migration 024 removed these
                    // sections, but old templates may still carry them).
                    if (isset($config['pool'])) {
                        unset($config['pool']['length_m']);
                        unset($config['pool']['width_m']);
                        unset($config['pool']['depth_m']);
                        unset($config['pool']['area_m2']);
                        unset($config['pool']['volume_m3']);
                        unset($config['pool']['wind_exposure']);
                        unset($config['pool']['years_operating']);
                        unset($config['pool']['solar_absorption']);
                        unset($config['pool']['has_tunnel']);
                    }
                    unset($config['cover']);
                    unset($config['solar']);

                    // Ensure nested arrays exist
                    if (!isset($config['equipment'])) $config['equipment'] = [];
                    if (!isset($config['control'])) $config['control'] = [];

                    // Override with legacy column values if set (legacy columns take precedence)
                    if (isset($configRow['hp_capacity_kw']) && $configRow['hp_capacity_kw'] !== null) {
                        $config['equipment']['hp_capacity_kw'] = (float)$configRow['hp_capacity_kw'];
                    }
                    if (isset($configRow['boiler_capacity_kw']) && $configRow['boiler_capacity_kw'] !== null) {
                        $config['equipment']['boiler_capacity_kw'] = (float)$configRow['boiler_capacity_kw'];
                    }
                    if (isset($configRow['target_temp']) && $configRow['target_temp'] !== null) {
                        $config['control']['target_temp'] = (float)$configRow['target_temp'];
                    }
                    if (isset($configRow['control_strategy']) && $configRow['control_strategy'] !== null) {
                        $config['control']['strategy'] = $configRow['control_strategy'];
                    }

                    $simulator->setConfigFromUI($config);
                }
            }

            // Apply equipment overrides if provided (legacy method)
            if ($equipmentOverrides) {
                $simulator->setEquipment($equipmentOverrides);
            }

            // Apply config overrides if provided (new method - takes precedence)
            if ($configOverride && is_array($configOverride)) {
                // Apply equipment overrides
                if (isset($configOverride['equipment']) && is_array($configOverride['equipment'])) {
                    $currentEquip = $simulator->getEquipment();
                    if (isset($configOverride['equipment']['hp_capacity_kw'])) {
                        $currentEquip['heat_pump']['capacity_kw'] = (float)$configOverride['equipment']['hp_capacity_kw'];
                    }
                    if (isset($configOverride['equipment']['boiler_capacity_kw'])) {
                        $currentEquip['boiler']['capacity_kw'] = (float)$configOverride['equipment']['boiler_capacity_kw'];
                    }
                    $simulator->setEquipment($currentEquip);
                }

                // Apply control overrides via setConfigFromUI
                $uiConfig = [];
                if (isset($configOverride['control'])) {
                    $strategy = $configOverride['control']['strategy'] ?? null;
                    if ($strategy !== null && !in_array($strategy, ['predictive', 'reactive'], true)) {
                        sendError('Run not started - Strategy must be predictive or reactive', 400);
                    }
                    $uiConfig['control'] = $configOverride['control'];
                }
                if (isset($configOverride['pool'])) {
                    $uiConfig['pool'] = $configOverride['pool'];
                }
                if (isset($configOverride['bathers'])) {
                    $uiConfig['bathers'] = $configOverride['bathers'];
                }
                if (isset($configOverride['solar'])) {
                    $uiConfig['solar'] = $configOverride['solar'];
                }
                if (!empty($uiConfig)) {
                    $simulator->setConfigFromUI($uiConfig);
                }
            }

            // Create simulation run record
            $scheduleTemplate = $scheduler->getTemplate();
            $configTemplateName = $configRow['template_name'] ?? null;
            $poolSiteId = $currentPoolSiteId;
            $runId = createSimulationRun($pdo, [
                'pool_site_id' => $poolSiteId,
                'pool_id' => $poolId,
                'user_id' => $currentUserId,
                'scenario_name' => $scenarioName,
                'description' => $description,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'config_snapshot' => json_encode([
                    'simulator_version' => EnergySimulator::getVersion(),
                    'pool_config' => $simulator->getPoolConfig(),
                    'equipment' => $simulator->getEquipment(),
                    'thermal_mass_rate' => $simulator->getThermalMassRate(),  // Debug: verify calculation
                    'pool_id' => $poolId,
                    'config_template_id' => $configId,
                    'config_template_name' => $configTemplateName,
                    'schedule_template_id' => $scheduleTemplate['template_id'] ?? null,
                    'schedule_template_name' => $scheduleTemplate['name'] ?? null,
                    // Copy of the schedule as used, so the run can be re-run
                    // exactly (recreate_hourly) after the schedule is edited
                    'schedule_state' => $scheduler->exportState(),
                    'engine' => 'typescript',
                    'store_hourly' => $storeHourly,
                ]),
            ]);

            updateRunStatus($pdo, $runId, 'running');
            try {
                $inputs = $simulator->exportRunInputs($startDate, $endDate);
            } catch (Throwable $e) {
                updateRunStatus($pdo, $runId, 'failed', ['error' => $e->getMessage()]);
                throw $e;
            }
            sendResponse([
                'status' => 'prepared',
                'run_id' => $runId,
                'store_hourly' => $storeHourly,
                'inputs' => $inputs,
                'meta' => [
                    'schedule_template_id' => $scheduleTemplate['template_id'] ?? null,
                    'schedule_template_name' => $scheduleTemplate['name'] ?? null,
                    'config_template_name' => $configTemplateName,
                ],
            ]);
            break;

        case 'set_baseline':
            // Mark / unmark a run as a baseline to compare against. Baselines
            // keep their inputs and results permanently (see RunRetention).
            RequestGuard::requireWriteRequest();
            RequestGuard::requireRole($auth, 'operator');
            $runId = (int) getParam('run_id');
            $flag = getParam('baseline', 1) ? 1 : 0;
            $stmt = $pdo->prepare("UPDATE simulation_runs SET is_baseline = ? WHERE run_id = ? AND pool_site_id = ? AND status = 'completed'");
            $stmt->execute([$flag, $runId, $currentPoolSiteId]);
            if ($stmt->rowCount() === 0) {
                $chk = $pdo->prepare("SELECT 1 FROM simulation_runs WHERE run_id = ? AND pool_site_id = ? AND status = 'completed'");
                $chk->execute([$runId, $currentPoolSiteId]);
                if (!$chk->fetchColumn()) {
                    sendError('Completed run not found', 404);
                }
            }
            sendResponse(['success' => true, 'run_id' => $runId, 'is_baseline' => $flag]);
            break;

        case 'recreate_hourly':
            // Re-run a run from its saved inputs (config snapshot + schedule
            // copy) with hourly results stored, as a new run - e.g. to look at
            // the hours of a baseline whose hourly data was removed.
            RequestGuard::requireWriteRequest();
            RequestGuard::requireRole($auth, 'operator');
            $sourceId = (int) getParam('run_id');
            $stmt = $pdo->prepare("SELECT * FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$sourceId, $currentPoolSiteId]);
            $source = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$source || $source['status'] !== 'completed') {
                sendError('Completed run not found', 404);
            }
            $snap = json_decode($source['config_snapshot'] ?? '', true) ?: [];
            if (empty($snap['equipment']) || empty($snap['pool_config'])) {
                sendError('This run has no saved inputs to re-run from', 400);
            }

            $warnings = [];
            if (!empty($snap['schedule_state'])) {
                $scheduler = PoolScheduler::fromState($snap['schedule_state']);
            } elseif (!empty($snap['schedule_template_id'])) {
                // Runs from before the schedule copy was saved
                $scheduler = new PoolScheduler($pdo, $currentPoolSiteId, $snap['schedule_template_id']);
                $warnings[] = 'This run has no saved copy of its schedule: the schedule as it is now was used.';
            } else {
                sendError('This run has no saved schedule to re-run from', 400);
            }
            $sourceVersion = $snap['simulator_version'] ?? 'unknown';
            if ($sourceVersion !== EnergySimulator::getVersion()) {
                $warnings[] = "The run was made with simulator $sourceVersion; this re-run uses " . EnergySimulator::getVersion() . ', so results can differ.';
            }

            $simulator = new EnergySimulator($pdo, $currentPoolSiteId, $scheduler);
            $simulator->setPoolConfig($snap['pool_config']);
            $simulator->setEquipment($snap['equipment']);

            $newSnap = $snap;
            $newSnap['simulator_version'] = EnergySimulator::getVersion();
            $newSnap['recreated_from_run_id'] = $sourceId;
            $newSnap['engine'] = 'typescript';
            $newSnap['store_hourly'] = true;
            $newRunId = createSimulationRun($pdo, [
                'pool_site_id' => $currentPoolSiteId,
                'pool_id' => $source['pool_id'],
                'user_id' => $currentUserId,
                'scenario_name' => function_exists('mb_substr')
                    ? mb_substr($source['scenario_name'] . ' (hours recreated)', 0, 250)
                    : $source['scenario_name'] . ' (hours recreated)',
                'description' => "Re-run of run $sourceId with hourly data",
                'start_date' => $source['start_date'],
                'end_date' => $source['end_date'],
                'config_snapshot' => json_encode($newSnap),
            ]);
            // Simulated in the browser like any run, with its hours saved;
            // the page compares the result with the source run
            updateRunStatus($pdo, $newRunId, 'running');
            try {
                $inputs = $simulator->exportRunInputs($source['start_date'], $source['end_date']);
            } catch (Throwable $e) {
                updateRunStatus($pdo, $newRunId, 'failed', ['error' => $e->getMessage()]);
                throw $e;
            }
            sendResponse([
                'status' => 'prepared',
                'run_id' => $newRunId,
                'store_hourly' => true,
                'inputs' => $inputs,
                'source_run_id' => $sourceId,
                'source_summary' => json_decode($source['summary_json'] ?? '', true) ?: [],
                'warnings' => $warnings,
            ]);
            break;

        case 'get_sim_inputs':
            // Inputs of a run for the TypeScript engine (Compare mode): the
            // simulator rebuilt from the run's saved state, as recreate_hourly.
            RequestGuard::requireRole($auth, 'operator');
            $runId = (int) getParam('run_id');
            $stmt = $pdo->prepare("SELECT * FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$runId, $currentPoolSiteId]);
            $runRow = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$runRow) {
                sendError('Simulation run not found', 404);
            }
            $snap = json_decode($runRow['config_snapshot'] ?? '', true) ?: [];
            if (empty($snap['schedule_state']) || empty($snap['equipment']) || empty($snap['pool_config'])) {
                sendError('This run has no saved inputs (runs from before V239)', 400);
            }
            $simulator = new EnergySimulator($pdo, $currentPoolSiteId, PoolScheduler::fromState($snap['schedule_state']));
            $simulator->setPoolConfig($snap['pool_config']);
            $simulator->setEquipment($snap['equipment']);
            sendResponse(['run_id' => $runId, 'inputs' => $simulator->exportRunInputs($runRow['start_date'], $runRow['end_date'])]);
            break;

        case 'submit_ts_hourly':
        case 'submit_ts_daily':
        case 'submit_ts_results':
        case 'finish_ts_hourly':
        case 'fail_ts_run':
            // Results of a TypeScript-engine run (prepared by run_simulation
            // with engine=typescript). Only for that run while it is running,
            // except its hourly rows: the browser saves those in the
            // background after completing the run (summary.hourly_saving).
            RequestGuard::requireWriteRequest();
            RequestGuard::requireRole($auth, 'operator');
            $runId = (int) getParam('run_id');
            $stmt = $pdo->prepare("SELECT * FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$runId, $currentPoolSiteId]);
            $runRow = $stmt->fetch(PDO::FETCH_ASSOC);
            $snap = $runRow ? (json_decode($runRow['config_snapshot'] ?? '', true) ?: []) : [];
            $runSummary = $runRow ? (json_decode($runRow['summary_json'] ?? '', true) ?: []) : [];
            $isTs = $runRow && ($snap['engine'] ?? 'php') === 'typescript';
            $savingHourly = $isTs && $runRow['status'] === 'completed' && !empty($runSummary['hourly_saving']);

            if (in_array($action, ['submit_ts_hourly', 'finish_ts_hourly'], true) && $savingHourly) {
                $endSaving = function () use ($pdo, $runId, $runSummary) {
                    unset($runSummary['hourly_saving']);
                    $pdo->prepare("UPDATE simulation_runs SET summary_json = ? WHERE run_id = ?")
                        ->execute([json_encode($runSummary), $runId]);
                };
                $purged = function () use ($pdo, $runId, $endSaving) {
                    // Retention removed this run's hours meanwhile (newer
                    // runs took the KEEP_HOURLY places): no point in more,
                    // and rows that arrived during the purge go as well
                    $pdo->prepare("DELETE FROM simulation_hourly_results WHERE run_id = ?")->execute([$runId]);
                    $endSaving();
                    sendError('The hourly data of this run was removed by retention (only the newest ' . RunRetention::KEEP_HOURLY . ' runs keep it)', 410);
                };
                if (!empty($runRow['hourly_purged_at'])) {
                    $purged();
                }
                if ($action === 'finish_ts_hourly') {
                    $endSaving();
                    try {
                        RunRetention::purgeHourly($pdo, $currentPoolSiteId, 5);
                    } catch (Throwable $e) {
                        error_log('[SimAPI] hourly retention failed: ' . $e->getMessage());
                    }
                    sendResponse(['success' => true]);
                }
                $rows = getParam('rows', []);
                if (!is_array($rows) || count($rows) > 20000) {
                    sendError('rows must be a list of at most 20000 hours');
                }
                storeHourlyRows($pdo, $runId, $rows);
                // Purged while these rows were being written? Then remove
                // them too, or they would stay outside retention's reach.
                $chk = $pdo->prepare("SELECT hourly_purged_at FROM simulation_runs WHERE run_id = ?");
                $chk->execute([$runId]);
                if ($chk->fetchColumn()) {
                    $purged();
                }
                sendResponse(['success' => true, 'stored' => count($rows)]);
            }

            if (!$isTs || $runRow['status'] !== 'running') {
                sendError('No TypeScript run in progress with this id', 409);
            }

            if ($action === 'fail_ts_run') {
                // The browser could not finish (e.g. a refused upload)
                $msg = substr((string) getParam('message', 'TypeScript run did not complete'), 0, 500);
                updateRunStatus($pdo, $runId, 'failed', ['error' => $msg, 'engine' => 'typescript']);
                sendResponse(['success' => true]);
            }

            if ($action === 'submit_ts_daily') {
                // Daily rows in pieces (hosts refuse large request bodies)
                $daily = getParam('daily', []);
                if (!is_array($daily) || count($daily) > 5000) {
                    sendError('daily must be a list of at most 5000 days');
                }
                storeSimulationResults($pdo, $runId, ['daily' => sanitizeDaily($daily), 'hourly' => []], false);
                sendResponse(['success' => true, 'stored' => count($daily)]);
            }

            if ($action === 'submit_ts_hourly') {
                $rows = getParam('rows', []);
                if (!is_array($rows) || count($rows) > 20000) {
                    sendError('rows must be a list of at most 20000 hours');
                }
                storeHourlyRows($pdo, $runId, $rows);
                sendResponse(['success' => true, 'stored' => count($rows)]);
            }

            $summary = getParam('summary', null);
            $daily = getParam('daily', null);  // optional: may come in pieces (submit_ts_daily)
            if (!is_array($summary)) {
                sendError('summary is required');
            }
            $summary['engine'] = 'typescript';
            unset($summary['hourly_saving']);
            if (getParam('hourly_pending', false) && !empty($snap['store_hourly'])) {
                // The browser saves the hourly rows after this (submit_ts_hourly,
                // then finish_ts_hourly); until then they are incomplete
                $summary['hourly_saving'] = true;
            }
            if (is_array($daily) && $daily) {
                storeSimulationResults($pdo, $runId, ['daily' => sanitizeDaily($daily), 'hourly' => []], false);
            }
            updateRunStatus($pdo, $runId, 'completed', $summary);
            if (!empty($snap['store_hourly'])) {
                try {
                    RunRetention::purgeHourly($pdo, $currentPoolSiteId, 5);
                } catch (Throwable $e) {
                    error_log('[SimAPI] hourly retention failed: ' . $e->getMessage());
                }
            }
            sendResponse(['status' => 'success', 'run_id' => $runId]);
            break;

        case 'get_run_progress':
            // Progress of the most recent still-running simulation (the
            // frontend polls this while the run_simulation POST is in flight
            // and doesn't yet know the run_id).
            $stmt = $pdo->prepare("
                SELECT run_id, status, summary_json
                FROM simulation_runs
                WHERE status = 'running' AND pool_site_id = ?
                ORDER BY run_id DESC
                LIMIT 1
            ");
            $stmt->execute([$currentPoolSiteId]);
            $running = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$running) {
                sendResponse(['running' => false]);
            }
            $sj = json_decode($running['summary_json'] ?? '{}', true) ?: [];
            sendResponse([
                'running' => true,
                'run_id' => (int) $running['run_id'],
                'progress' => $sj['progress'] ?? null
            ]);
            break;

        case 'get_runs':
            // Get all simulation runs for this site
            $limit = max(1, min(500, (int) getParam('limit', 50)));
            $offset = max(0, (int) getParam('offset', 0));
            // Optional filters: status=completed (the "last results" views must
            // not show a running or failed run as an all-zero result) and
            // run_id (load one run in the same shape).
            $statusFilter = getParam('status', null);
            if ($statusFilter !== null && !in_array($statusFilter, ['completed', 'running', 'failed'], true)) {
                sendError('Invalid status filter');
            }
            $runIdFilter = getParam('run_id', null);
            $baselineFilter = getParam('baseline', null);
            $where = 'pool_site_id = ?';
            $whereParams = [$currentPoolSiteId];
            if ($statusFilter !== null) {
                $where .= ' AND status = ?';
                $whereParams[] = $statusFilter;
            }
            if ($runIdFilter !== null && $runIdFilter !== '') {
                $where .= ' AND run_id = ?';
                $whereParams[] = (int) $runIdFilter;
            }
            if ($baselineFilter !== null && $baselineFilter !== '') {
                $where .= ' AND is_baseline = 1';  // (column from migration 041)
            }

            // If no pool_site_id, return empty list (no runs possible without site)
            $poolSiteId = $currentPoolSiteId;
            if (!$poolSiteId) {
                sendResponse([
                    'runs' => [],
                    'total' => 0,
                    'limit' => $limit,
                    'offset' => $offset,
                    'note' => 'No pool site configured'
                ]);
            }

            try {
                // Note: LIMIT/OFFSET as prepared params can cause issues, so we embed them directly (already cast to int)
                $stmt = $pdo->prepare("
                    SELECT
                        -- * : is_baseline / hourly_purged_at exist only after
                        -- migration 041, and the list must not break before it
                        *,
                        -- exact moments (unix seconds), see get_run
                        UNIX_TIMESTAMP(created_at) AS created_ts, UNIX_TIMESTAMP(completed_at) AS completed_ts
                    FROM simulation_runs
                    WHERE {$where}
                    ORDER BY created_at DESC, run_id DESC
                    LIMIT {$limit} OFFSET {$offset}
                ");
                $stmt->execute($whereParams);
                $runs = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (Exception $e) {
                error_log("[SimAPI] get_runs query failed: " . $e->getMessage());
                $runs = [];
            }

            // Decode JSON fields (handle NULL values for PHP 8.1+)
            foreach ($runs as &$run) {
                $run['summary'] = $run['summary_json'] ? json_decode($run['summary_json'], true) : null;
                $run['config'] = $run['config_snapshot'] ? json_decode($run['config_snapshot'], true) : null;
                unset($run['summary_json'], $run['config_snapshot']);
                // The schedule copy is for re-runs only; keep the list small
                if (is_array($run['config'])) {
                    unset($run['config']['schedule_state']);
                }
            }

            // Get total count
            $totalCount = 0;
            try {
                $countStmt = $pdo->prepare("SELECT COUNT(*) FROM simulation_runs WHERE {$where}");
                $countStmt->execute($whereParams);
                $totalCount = $countStmt->fetchColumn();
            } catch (Exception $e) {
                error_log("[SimAPI] get_runs count query failed: " . $e->getMessage());
                $totalCount = count($runs);
            }

            sendResponse([
                'runs' => $runs,
                'total' => $totalCount,
                'limit' => $limit,
                'offset' => $offset
            ]);
            break;

        case 'get_run':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            $poolSiteId = $currentPoolSiteId;
            $stmt = $pdo->prepare("
                SELECT *,
                       -- exact moments (unix seconds): created_at/completed_at
                       -- are the database server's clock time, not the user's
                       UNIX_TIMESTAMP(created_at) AS created_ts, UNIX_TIMESTAMP(completed_at) AS completed_ts
                FROM simulation_runs
                WHERE run_id = ? AND pool_site_id = ?
            ");
            $stmt->execute([$runId, $poolSiteId]);
            $run = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$run) {
                sendError('Simulation run not found', 404);
            }

            $run['config'] = $run['config_snapshot'] ? json_decode($run['config_snapshot'], true) : null;
            if (is_array($run['config'])) {
                $run['config']['has_schedule_copy'] = !empty($run['config']['schedule_state']);
                unset($run['config']['schedule_state']);
            }
            $hh = $pdo->prepare("SELECT 1 FROM simulation_hourly_results WHERE run_id = ? LIMIT 1");
            $hh->execute([$runId]);
            $run['has_hourly'] = (bool) $hh->fetchColumn();
            $run['summary'] = $run['summary_json'] ? json_decode($run['summary_json'], true) : null;
            unset($run['config_snapshot'], $run['summary_json']);

            sendResponse(['run' => $run]);
            break;

        case 'get_summary':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            $poolSiteId = $currentPoolSiteId;
            $stmt = $pdo->prepare("
                SELECT run_id, scenario_name, start_date, end_date, status, summary_json
                FROM simulation_runs
                WHERE run_id = ? AND pool_site_id = ?
            ");
            $stmt->execute([$runId, $poolSiteId]);
            $run = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$run) {
                sendError('Simulation run not found', 404);
            }

            sendResponse([
                'run_id' => $run['run_id'],
                'scenario_name' => $run['scenario_name'],
                'start_date' => $run['start_date'],
                'end_date' => $run['end_date'],
                'status' => $run['status'],
                'summary' => $run['summary_json'] ? json_decode($run['summary_json'], true) : null
            ]);
            break;

        case 'get_daily_results':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            // Verify run belongs to site
            $poolSiteId = $currentPoolSiteId;
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$runId, $poolSiteId]);
            if (!$stmt->fetch()) {
                sendError('Simulation run not found', 404);
            }

            // Get daily results
            $stmt = $pdo->prepare("
                SELECT * FROM simulation_daily_results
                WHERE run_id = ?
                ORDER BY date
            ");
            $stmt->execute([$runId]);
            $dailyResults = $stmt->fetchAll(PDO::FETCH_ASSOC);

            sendResponse([
                'run_id' => $runId,
                'daily_results' => $dailyResults
            ]);
            break;

        case 'get_monthly_results':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            // Verify run belongs to site
            $poolSiteId = $currentPoolSiteId;
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$runId, $poolSiteId]);
            if (!$stmt->fetch()) {
                sendError('Simulation run not found', 404);
            }

            // Get monthly aggregated results
            $stmt = $pdo->prepare("
                SELECT
                    YEAR(date) as year,
                    MONTH(date) as month,
                    SUM(total_loss_kwh) as total_loss_kwh,
                    SUM(total_solar_kwh) as total_solar_kwh,
                    SUM(total_hp_kwh) as total_hp_kwh,
                    SUM(total_boiler_kwh) as total_boiler_kwh,
                    SUM(total_cost) as total_cost,
                    AVG(avg_air_temp) as avg_air_temp,
                    AVG(avg_water_temp) as avg_water_temp,
                    SUM(open_hours) as open_hours,
                    COUNT(*) as days_count
                FROM simulation_daily_results
                WHERE run_id = ?
                GROUP BY YEAR(date), MONTH(date)
                ORDER BY year, month
            ");
            $stmt->execute([$runId]);
            $monthlyResults = $stmt->fetchAll(PDO::FETCH_ASSOC);

            sendResponse([
                'run_id' => $runId,
                'monthly_results' => $monthlyResults
            ]);
            break;

        case 'get_results':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            // Optional pagination for hourly data
            $limit = (int) getParam('limit', 1000);
            $offset = (int) getParam('offset', 0);
            $dateFilter = getParam('date'); // Optional single date filter

            // Verify run belongs to site
            $poolSiteId = $currentPoolSiteId;
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$runId, $poolSiteId]);
            if (!$stmt->fetch()) {
                sendError('Simulation run not found', 404);
            }

            // Build query based on filters (LIMIT/OFFSET embedded directly, already cast to int)
            if ($dateFilter) {
                $stmt = $pdo->prepare("
                    SELECT * FROM simulation_hourly_results
                    WHERE run_id = ? AND DATE(timestamp) = ?
                    ORDER BY timestamp
                    LIMIT {$limit} OFFSET {$offset}
                ");
                $stmt->execute([$runId, $dateFilter]);
            } else {
                $stmt = $pdo->prepare("
                    SELECT * FROM simulation_hourly_results
                    WHERE run_id = ?
                    ORDER BY timestamp
                    LIMIT {$limit} OFFSET {$offset}
                ");
                $stmt->execute([$runId]);
            }
            $hourlyResults = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Get total count
            $countStmt = $pdo->prepare("SELECT COUNT(*) FROM simulation_hourly_results WHERE run_id = ?");
            $countStmt->execute([$runId]);
            $totalCount = $countStmt->fetchColumn();

            sendResponse([
                'run_id' => $runId,
                'hourly_results' => $hourlyResults,
                'total' => $totalCount,
                'limit' => $limit,
                'offset' => $offset
            ]);
            break;

        case 'delete_run':
            RequestGuard::requireWriteRequest();
            RequestGuard::requireRole($auth, 'admin');
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            // Verify run belongs to site
            $poolSiteId = $currentPoolSiteId;
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
            $stmt->execute([$runId, $poolSiteId]);
            if (!$stmt->fetch()) {
                sendError('Simulation run not found', 404);
            }

            // Delete results first (cascade)
            $pdo->prepare("DELETE FROM simulation_hourly_results WHERE run_id = ?")->execute([$runId]);
            $pdo->prepare("DELETE FROM simulation_daily_results WHERE run_id = ?")->execute([$runId]);
            $pdo->prepare("DELETE FROM simulation_runs WHERE run_id = ?")->execute([$runId]);

            sendResponse(['status' => 'deleted', 'run_id' => $runId]);
            break;

        case 'get_weather_range':
            // Return available weather data range (fast query - removed slow COUNT)
            try {
                $stmt = $pdo->query("
                    SELECT
                        MIN(DATE(timestamp)) as min_date,
                        MAX(DATE(timestamp)) as max_date
                    FROM weather_data
                ");
                $range = $stmt->fetch(PDO::FETCH_ASSOC);

                sendResponse([
                    'pool_site_id' => $currentPoolSiteId,
                    'weather_range' => $range
                ]);
            } catch (Exception $e) {
                // No silent fallbacks: a made-up 2014-2023 range let the date
                // picker offer periods with no data behind them.
                sendError('Could not determine available weather range: ' . $e->getMessage()
                    . '. Retry, and check the database connection / weather_data table.', 500);
            }
            break;

        case 'reference_info':
        case 'reference_check_php':
        case 'reference_scenario':
            // Engine reference set (tests/reference, lib/ReferenceCheck.php):
            // frozen scenarios and the results each simulator version gives.
            // Admin > System > Engine verification runs every scenario with
            // this server's PHP engine and in the browser (TypeScript).
            RequestGuard::requireRole($auth, 'admin');
            require_once __DIR__ . '/../lib/ReferenceCheck.php';
            $engineVersion = EnergySimulator::getVersion();
            $baseline = ReferenceCheck::baselineVersion($engineVersion);

            if ($action === 'reference_info') {
                $versions = ReferenceCheck::versions();
                $i = $baseline !== null ? array_search($baseline, $versions, true) : false;
                $previous = ($i !== false && $i > 0) ? $versions[$i - 1] : null;
                sendResponse([
                    'engine_version' => $engineVersion,
                    'versions' => $versions,
                    'compared_with' => $baseline,
                    'previous_version' => $previous,
                    'scenarios' => ReferenceCheck::scenarios(),
                    'changes' => $previous ? ReferenceCheck::changes($previous, $baseline) : null,
                ]);
            }

            $id = (string) getParam('id', '');
            ReferenceCheck::scenario($id);   // validates the id
            if ($baseline === null) {
                sendError('No reference results are stored', 404);
            }
            $expected = ReferenceCheck::results($baseline)[$id] ?? null;
            if ($expected === null) {
                sendError("No reference result for '$id' in $baseline", 404);
            }

            if ($action === 'reference_check_php') {
                [$got, $ms] = ReferenceCheck::runPhp($id);
                sendResponse(['id' => $id, 'compared_with' => $baseline, 'ms' => $ms]
                    + ReferenceCheck::compare($expected, $got));
            }

            // reference_scenario: what the browser needs to check TypeScript
            sendResponse(['id' => $id, 'compared_with' => $baseline,
                          'inputs' => ReferenceCheck::inputs($id), 'expected' => $expected]);
            break;

        case 'get_version':
            sendResponse([
                'version' => EnergySimulator::getVersion(),
                'simulator_version' => EnergySimulator::getVersion(),
                'php_version' => PHP_VERSION
            ]);
            break;

        case 'debug_hour':
            // Details hour panel: the run's saved row for the hour (if its
            // hours are saved), its settings and the day's schedule
            $date = getParam('date');
            $hour = (int) getParam('hour', 0);
            $runId = getParam('run_id'); // Optional: specific run

            if (!$date) {
                sendError('date parameter required (YYYY-MM-DD)');
            }

            if (!validateDate($date)) {
                sendError('Invalid date format. Use YYYY-MM-DD');
            }

            if ($hour < 0 || $hour > 23) {
                sendError('hour must be between 0 and 23');
            }

            $timestamp = sprintf('%s %02d:00:00', $date, $hour);

            // Get run_id (specified or most recent completed run covering this date)
            if ($runId) {
                // An explicit run must belong to this site
                $ownStmt = $pdo->prepare("SELECT 1 FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
                $ownStmt->execute([(int)$runId, $currentPoolSiteId]);
                if (!$ownStmt->fetchColumn()) {
                    sendError('Simulation run not found', 404);
                }
            }
            if (!$runId) {
                $poolSiteId = $currentPoolSiteId;
                // Newest completed run covering the date: its hours are
                // computed in the browser when they are not saved
                $runId = defaultDebugRunId($pdo, $poolSiteId, $date, false);
                if (!$runId) {
                    sendError("No simulation run covers $date: run one (or open one in History) first.", 404);
                }
            }

            // The hour as the run saved it, if its hours are in the database
            // (the browser has them otherwise: computed or kept from the run)
            $stmt = $pdo->prepare("
                SELECT *
                FROM simulation_hourly_results
                WHERE run_id = ? AND timestamp = ?
                LIMIT 1
            ");
            $stmt->execute([$runId, $timestamp]);
            $stored = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

            $configStmt = $pdo->prepare("SELECT config_snapshot, start_date, end_date FROM simulation_runs WHERE run_id = ?");
            $configStmt->execute([$runId]);
            $runRow = $configStmt->fetch(PDO::FETCH_ASSOC) ?: [];
            $configSnapshot = json_decode((string) ($runRow['config_snapshot'] ?? ''), true) ?: [];
            $scheduler = !empty($configSnapshot['schedule_state'])
                ? PoolScheduler::fromState($configSnapshot['schedule_state'])
                : new PoolScheduler($pdo, $currentPoolSiteId, $configSnapshot['schedule_template_id'] ?? null);

            // The hour's losses, gains and heating are computed in the browser
            // from the run's inputs (sim-ts debugHour); this gives the run's
            // saved values for the hour and its settings and schedule.
            $out = [
                'run_id' => (int) $runId,
                'start_date' => $runRow['start_date'] ?? null,
                'end_date' => $runRow['end_date'] ?? null,
                'simulator_version' => $configSnapshot['simulator_version'] ?? 'unknown',
                'has_schedule_copy' => !empty($configSnapshot['schedule_state']),
                'stored' => $stored ? [
                    'water_temp' => (float) $stored['water_temp'],
                    'water_temp_start' => isset($stored['water_temp_start']) && $stored['water_temp_start'] !== null
                        ? (float) $stored['water_temp_start'] : (float) $stored['water_temp'],
                    'is_open' => (bool) $stored['is_open'],
                    'total_loss_kw' => (float) $stored['total_loss_kw'],
                    'solar_gain_kw' => (float) $stored['solar_gain_kw'],
                    'hp_heat_kw' => (float) $stored['hp_heat_kw'],
                    'boiler_heat_kw' => (float) $stored['boiler_heat_kw'],
                    'hp_cop' => (float) $stored['hp_cop'],
                    'heating_mode' => $stored['heating_mode'] ?? null,
                ] : null,
                'config_info' => [
                    'config_template_name' => $configSnapshot['config_template_name'] ?? null,
                    'schedule_template_name' => $configSnapshot['schedule_template_name'] ?? null,
                    'schedule_template_id_stored' => $configSnapshot['schedule_template_id'] ?? 'not stored',
                    'schedule_template_id_used' => $scheduler->getTemplate()['template_id'] ?? null,
                    'hp_capacity_kw' => $configSnapshot['equipment']['heat_pump']['capacity_kw'] ?? $configSnapshot['equipment']['hp_capacity_kw'] ?? null,
                    'boiler_capacity_kw' => $configSnapshot['equipment']['boiler']['capacity_kw'] ?? $configSnapshot['equipment']['boiler_capacity_kw'] ?? null,
                ],
                'schedule_debug' => $scheduler->getScheduleDebugInfo($date),
            ];
            sendResponse($out);
            break;

        case 'debug_week':
            // Get hourly data from stored simulation results for chart visualization
            // Returns data for Thu-Wed week centered on selected date
            $centerDate = getParam('date');
            $runId = getParam('run_id'); // Optional: specific run, defaults to most recent

            if (!$centerDate) {
                sendError('date parameter required (YYYY-MM-DD)');
            }

            if (!validateDate($centerDate)) {
                sendError('Invalid date format. Use YYYY-MM-DD');
            }

            // Calculate Thu-Wed week range
            $centerDt = new DateTime($centerDate);
            $dayOfWeek = (int) $centerDt->format('N'); // 1=Mon, 4=Thu, 7=Sun
            $daysToThursday = ($dayOfWeek >= 4) ? ($dayOfWeek - 4) : ($dayOfWeek + 3);
            $startDt = clone $centerDt;
            $startDt->modify("-{$daysToThursday} days");
            $endDt = clone $startDt;
            $endDt->modify("+6 days");

            $startDate = $startDt->format('Y-m-d');
            $endDate = $endDt->format('Y-m-d');

            // Get run_id (specified or most recent completed run that covers this date range)
            if ($runId) {
                // An explicit run must belong to this site
                $ownStmt = $pdo->prepare("SELECT 1 FROM simulation_runs WHERE run_id = ? AND pool_site_id = ?");
                $ownStmt->execute([(int)$runId, $currentPoolSiteId]);
                if (!$ownStmt->fetchColumn()) {
                    sendError('Simulation run not found', 404);
                }
            }
            if (!$runId) {
                $poolSiteId = $currentPoolSiteId;
                // Same rule as debug_hour (a run covering the selected date),
                // so the week chart and the hour panel show the same run
                $runId = defaultDebugRunId($pdo, $poolSiteId, $centerDate);
                if (!$runId) {
                    sendError("No simulation run with stored hourly data covers $centerDate. Run a simulation with 'Store hourly' on first.", 404);
                }
            }

            // Get hourly results from stored data
            $stmt = $pdo->prepare("
                SELECT
                    timestamp,
                    air_temp,
                    wind_speed,
                    humidity,
                    target_temp,
                    water_temp,
                    is_open,
                    total_loss_kw,
                    solar_gain_kw,
                    hp_heat_kw,
                    boiler_heat_kw,
                    hp_electricity_kwh,
                    boiler_fuel_kwh,
                    hp_cop
                FROM simulation_hourly_results
                WHERE run_id = ?
                  AND DATE(timestamp) >= ?
                  AND DATE(timestamp) <= ?
                ORDER BY timestamp
            ");
            $stmt->execute([$runId, $startDate, $endDate]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (empty($rows)) {
                if (isHourlySaving($pdo, $runId)) {
                    sendError("The hourly data of run $runId is still being saved (or its saving was interrupted: use Recreate hours).", 404);
                }
                sendError("No hourly data found for run $runId in date range $startDate to $endDate", 404);
            }

            // Format data for chart (matching expected structure)
            $hourlyData = [];
            foreach ($rows as $i => $row) {
                $ts = new DateTime($row['timestamp']);
                $netDemand = (float)$row['total_loss_kw'] - (float)$row['solar_gain_kw'];

                $hourlyData[] = [
                    'timestamp' => $ts->format('Y-m-d H:i'),
                    'hour' => $i,
                    'air_temp' => (float)$row['air_temp'],
                    'wind_speed' => (float)$row['wind_speed'],
                    'humidity' => $row['humidity'] !== null ? (float)$row['humidity'] : null,
                    'water_temp' => (float)$row['water_temp'],
                    'total_loss' => (float)$row['total_loss_kw'],
                    'net_demand' => $netDemand,
                    'solar_gain' => (float)$row['solar_gain_kw'],
                    'hp_output' => (float)$row['hp_heat_kw'],
                    'hp_electric' => (float)$row['hp_electricity_kwh'],
                    'hp_cop' => (float)$row['hp_cop'],
                    'boiler_output' => (float)$row['boiler_heat_kw'],
                    'boiler_fuel' => (float)$row['boiler_fuel_kwh'],
                    'is_open' => (bool)$row['is_open'],
                    'has_cover' => !((bool)$row['is_open']), // Cover on when closed
                ];
            }

            // ===== REPLAY SCHEDULING to cache open_plan/heating_mode for debug =====
            // Load config from run to recreate simulator state
            $configStmt = $pdo->prepare("SELECT config_snapshot FROM simulation_runs WHERE run_id = ?");
            $configStmt->execute([$runId]);
            $runConfig = $configStmt->fetch();
            $configSnapshot = $runConfig ? json_decode($runConfig['config_snapshot'], true) : [];

            // Initialize simulator with scheduler
            $scheduleTemplateId = $configSnapshot['schedule_template_id'] ?? null;
            $scheduler = !empty($configSnapshot['schedule_state'])
                ? PoolScheduler::fromState($configSnapshot['schedule_state'])
                : new PoolScheduler($pdo, $currentPoolSiteId, $scheduleTemplateId);
            $simulator = new EnergySimulator($pdo, $currentPoolSiteId, $scheduler);

            if (!empty($configSnapshot['equipment'])) {
                $simulator->setEquipment($configSnapshot['equipment']);
            }
            if (!empty($configSnapshot['pool_config'])) {
                $simulator->setPoolConfig($configSnapshot['pool_config']);
            }

            // Capture debug info about thermalMassRate
            $debugThermalMass = [
                'pool_config_volume' => $configSnapshot['pool_config']['volume_m3'] ?? 'NOT SET',
                'thermal_mass_rate_after_setPoolConfig' => $simulator->getThermalMassRate(),
            ];

            // Replay scheduling using consolidated method in simulator
            // This ensures debug uses same logic as run()
            $replayResult = $simulator->replaySchedulingForData($rows, $centerDate);
            $debugCache = $replayResult['cache'];
            $debugPlanCall = $replayResult['debug_plan_call'];

            // Apply control_strategy to heating modes (reactive strategy overrides planned modes)
            $controlStrategy = $configSnapshot['equipment']['control_strategy'] ?? 'reactive';
            if ($controlStrategy !== 'predictive') {
                foreach ($debugCache as $ts => &$cached) {
                    $cached['heating_mode'] = 'reactive';
                }
                unset($cached);
            }

            // Store in session keyed by run_id
            if (session_status() === PHP_SESSION_NONE) {
                session_start();
            }
            $_SESSION['debug_cache'][$runId] = $debugCache;

            // Find first cached open_plan to debug
            $firstOpenPlan = null;
            foreach ($debugCache as $ts => $cached) {
                if (!empty($cached['open_plan'])) {
                    $firstOpenPlan = ['timestamp' => $ts, 'plan' => $cached['open_plan']];
                    break;
                }
            }

            sendResponse([
                'run_id' => (int)$runId,
                'source' => 'stored', // Indicates data comes from DB, not recalculated
                'start_date' => $startDate,
                'end_date' => $endDate,
                'center_date' => $centerDate,
                'hours' => count($hourlyData),
                'data' => $hourlyData,
                'debug_cache_size' => count($debugCache),  // For verification
                'debug_thermal_mass' => $debugThermalMass,  // Debug: verify thermalMassRate
                'debug_plan_call' => $debugPlanCall,  // Debug: inputs/outputs of first plan calculation
            ]);
            break;

        default:
            sendError('Invalid action. Valid actions: run_simulation, get_sim_inputs, submit_ts_hourly, submit_ts_daily, submit_ts_results, finish_ts_hourly, fail_ts_run, reference_info, reference_check_php, reference_scenario, set_baseline, recreate_hourly, get_runs, get_run, get_summary, get_daily_results, get_results, delete_run, get_weather_range, get_version, debug_hour, debug_week');
    }

} catch (PDOException $e) {
    $message = Config::isDebug() ? $e->getMessage() : 'Database error occurred';
    sendError($message, 500);
} catch (Throwable $e) {
    // The simulator's own validation errors (missing data, invalid config)
    // tell the user what to fix, so they are always shown; anything else
    // (PHP errors) only in debug mode.
    $userFacing = $e instanceof RuntimeException || $e instanceof InvalidArgumentException;
    if (!$userFacing) {
        error_log('[SimAPI] ' . get_class($e) . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
    }
    $message = ($userFacing || Config::isDebug()) ? $e->getMessage() : 'An error occurred';
    sendError($message, $userFacing ? 400 : 500);
}

// Helper functions

/**
 * Create a new simulation run record
 */
function createSimulationRun($pdo, $data) {
    $stmt = $pdo->prepare("
        INSERT INTO simulation_runs
        (pool_site_id, pool_id, user_id, scenario_name, description, start_date, end_date, status, config_snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW())
    ");
    $stmt->execute([
        $data['pool_site_id'],
        $data['pool_id'] ?? null,
        $data['user_id'],
        $data['scenario_name'],
        $data['description'],
        $data['start_date'],
        $data['end_date'],
        $data['config_snapshot']
    ]);

    return $pdo->lastInsertId();
}

/**
 * Update simulation run status
 */
function updateRunStatus($pdo, $runId, $status, $summary = null) {
    if ($status === 'completed' || $status === 'failed') {
        $stmt = $pdo->prepare("
            UPDATE simulation_runs
            SET status = ?, summary_json = ?, completed_at = NOW()
            WHERE run_id = ?
        ");
        $stmt->execute([$status, json_encode($summary), $runId]);
    } else {
        $stmt = $pdo->prepare("
            UPDATE simulation_runs SET status = ? WHERE run_id = ?
        ");
        $stmt->execute([$status, $runId]);
    }
}

/**
 * Daily rows from the TypeScript engine, cast to the stored types. Rows are
 * compact lists of the stored values (storedDailyRows() in sim-ts):
 * [date, hours, open_hours, avg_air_temp, avg_water_temp, total_loss_kwh,
 *  total_solar_kwh, total_hp_kwh, total_boiler_kwh, hp_thermal_kwh,
 *  boiler_thermal_kwh, total_cost] - or objects with these keys.
 */
function sanitizeDaily(array $daily) {
    $keys = ['date', 'hours', 'open_hours', 'avg_air_temp', 'avg_water_temp', 'total_loss_kwh',
             'total_solar_kwh', 'total_hp_kwh', 'total_boiler_kwh', 'hp_thermal_kwh',
             'boiler_thermal_kwh', 'total_cost'];
    $out = [];
    foreach ($daily as $d) {
        if (is_array($d) && array_key_exists(0, $d)) {
            $d = count($d) === count($keys) ? array_combine($keys, $d) : null;
        }
        if (!is_array($d) || !isset($d['date']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $d['date'])) {
            sendError('Invalid daily row');
        }
        $row = ['date' => $d['date']];
        foreach (['hours', 'open_hours'] as $k) $row[$k] = (int) ($d[$k] ?? 0);
        foreach (['avg_air_temp', 'avg_water_temp', 'total_loss_kwh', 'total_solar_kwh', 'total_hp_kwh',
                  'total_boiler_kwh', 'hp_thermal_kwh', 'boiler_thermal_kwh', 'total_cost'] as $k) {
            $row[$k] = (float) ($d[$k] ?? 0);
        }
        $out[] = $row;
    }
    return $out;
}

/**
 * Store compact hourly rows from the TypeScript engine:
 * [timestamp, air, wind, humidity, solar_kwh_m2, target_temp, water_temp,
 *  water_temp_start, is_open, total_loss_kw, solar_gain_kw, hp_heat_kw,
 *  boiler_heat_kw, hp_electricity_kwh, boiler_fuel_kwh, hp_cop, cost, ...]
 */
function storeHourlyRows($pdo, $runId, array $rows) {
    inTransaction($pdo, function () use ($pdo, $runId, $rows) {
        insertHourlyRows($pdo, $runId, $rows);
    });
}

function insertHourlyRows($pdo, $runId, array $rows) {
    foreach (array_chunk($rows, 500) as $batch) {
        $placeholders = [];
        $values = [];
        foreach ($batch as $r) {
            if (!is_array($r) || count($r) < 17 || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string) $r[0])) {
                sendError('Invalid hourly row');
            }
            $placeholders[] = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            array_push($values, $runId, $r[0], (float) $r[1], (float) $r[2], (float) $r[3], (float) $r[4],
                $r[5] === null ? null : (float) $r[5], (float) $r[6], (float) $r[7], $r[8] ? 1 : 0,
                (float) $r[9], (float) $r[10], (float) $r[11], (float) $r[12], (float) $r[13],
                (float) $r[14], (float) $r[15], (float) $r[16]);
        }
        $stmt = $pdo->prepare("INSERT INTO simulation_hourly_results
            (run_id, timestamp, air_temp, wind_speed, humidity, solar_kwh_m2,
             target_temp, water_temp, water_temp_start, is_open, total_loss_kw, solar_gain_kw,
             hp_heat_kw, boiler_heat_kw, hp_electricity_kwh, boiler_fuel_kwh, hp_cop, cost)
            VALUES " . implode(", ", $placeholders));
        $stmt->execute($values);
    }
}

/**
 * Run a created run: progress reporting, simulate, store results, mark it
 * completed (or failed, rethrowing), then apply hourly retention for the
 * site. Returns the simulator results.
 */
function executeRun($pdo, $simulator, $runId, $startDate, $endDate, $storeHourly) {
    updateRunStatus($pdo, $runId, 'running');
    $GLOBALS['activeRunId'] = $runId;

    // Live progress: once per simulated month, store the current period +
    // percent on the run row so the frontend can poll it (get_run_progress)
    // while this request is still executing.
    $progressStmt = $pdo->prepare("UPDATE simulation_runs SET summary_json = ? WHERE run_id = ?");
    $simulator->setProgressCallback(function ($period, $done, $total) use ($progressStmt, $runId) {
        $pct = $total > 0 ? (int) round(100 * $done / $total) : 0;
        $progressStmt->execute([
            json_encode(['progress' => ['period' => $period, 'pct' => $pct]]),
            $runId
        ]);
    });

    try {
        $results = $simulator->runSimulation($startDate, $endDate);
        storeSimulationResults($pdo, $runId, $results, $storeHourly);
        updateRunStatus($pdo, $runId, 'completed', $results['summary']);
        $GLOBALS['activeRunId'] = null;
    } catch (Throwable $e) {
        // Errors too, e.g. a division by zero
        $GLOBALS['activeRunId'] = null;
        updateRunStatus($pdo, $runId, 'failed', ['error' => $e->getMessage()]);
        throw $e;
    }

    // Keep hourly data only for the newest runs of this site (a few seconds
    // at most here; the Admin -> Storage clean-up finishes larger backlogs).
    // Never fails the run.
    if ($storeHourly) {
        try {
            $site = $pdo->prepare("SELECT pool_site_id FROM simulation_runs WHERE run_id = ?");
            $site->execute([$runId]);
            RunRetention::purgeHourly($pdo, (int) $site->fetchColumn(), 5);
        } catch (Throwable $e) {
            error_log('[SimAPI] hourly retention failed: ' . $e->getMessage());
        }
    }
    return $results;
}

/**
 * Store simulation results
 */
function storeSimulationResults($pdo, $runId, $results, $storeHourly = true) {
    // One transaction: one commit instead of one per day (each commit waits
    // for the disk, which on shared hosts made saving a year take seconds)
    inTransaction($pdo, function () use ($pdo, $runId, $results, $storeHourly) {
        insertSimulationResults($pdo, $runId, $results, $storeHourly);
    });
}

/** Run $fn in a transaction (or in the caller's, if one is open). */
function inTransaction($pdo, callable $fn) {
    if ($pdo->inTransaction()) {
        return $fn();
    }
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function insertSimulationResults($pdo, $runId, $results, $storeHourly = true) {
    // Check if thermal columns exist (backward compatibility)
    $hasThermalColumns = false;
    try {
        $checkStmt = $pdo->query("SHOW COLUMNS FROM simulation_daily_results LIKE 'hp_thermal_kwh'");
        $hasThermalColumns = $checkStmt->rowCount() > 0;
    } catch (PDOException $e) {
        // Columns don't exist
    }

    // Store daily results - use appropriate schema
    if ($hasThermalColumns) {
        $dailyStmt = $pdo->prepare("
            INSERT INTO simulation_daily_results
            (run_id, date, hours_count, open_hours, avg_air_temp, avg_water_temp,
             total_loss_kwh, total_solar_kwh, total_hp_kwh, total_boiler_kwh,
             hp_thermal_kwh, boiler_thermal_kwh, total_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        foreach ($results['daily'] as $day) {
            $dailyStmt->execute([
                $runId,
                $day['date'],
                $day['hours'],
                $day['open_hours'],
                round($day['avg_air_temp'], 2),
                round($day['avg_water_temp'], 2),
                round($day['total_loss_kwh'], 3),
                round($day['total_solar_kwh'], 3),
                round($day['total_hp_kwh'], 3),
                round($day['total_boiler_kwh'], 3),
                round($day['hp_thermal_kwh'] ?? 0, 3),
                round($day['boiler_thermal_kwh'] ?? 0, 3),
                round($day['total_cost'], 2)
            ]);
        }
    } else {
        // Legacy schema without thermal columns
        $dailyStmt = $pdo->prepare("
            INSERT INTO simulation_daily_results
            (run_id, date, hours_count, open_hours, avg_air_temp, avg_water_temp,
             total_loss_kwh, total_solar_kwh, total_hp_kwh, total_boiler_kwh, total_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        foreach ($results['daily'] as $day) {
            $dailyStmt->execute([
                $runId,
                $day['date'],
                $day['hours'],
                $day['open_hours'],
                round($day['avg_air_temp'], 2),
                round($day['avg_water_temp'], 2),
                round($day['total_loss_kwh'], 3),
                round($day['total_solar_kwh'], 3),
                round($day['total_hp_kwh'], 3),
                round($day['total_boiler_kwh'], 3),
                round($day['total_cost'], 2)
            ]);
        }
    }

    // Store hourly results (in batches for performance) - only if requested
    if ($storeHourly && !empty($results['hourly'])) {
        $batchSize = 500;
        $hourlyData = $results['hourly'];
        $totalHours = count($hourlyData);

        for ($i = 0; $i < $totalHours; $i += $batchSize) {
            $batch = array_slice($hourlyData, $i, $batchSize);
            $placeholders = [];
            $values = [];

            foreach ($batch as $hour) {
                $placeholders[] = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
                $values = array_merge($values, [
                    $runId,
                    $hour['timestamp'],
                    $hour['weather']['air_temp'],
                    $hour['weather']['wind_speed'],
                    $hour['weather']['humidity'],
                    $hour['weather']['solar_kwh_m2'],
                    $hour['pool']['target_temp'],
                    $hour['pool']['water_temp'],
                    // Start-of-hour temp drives this hour's losses; persist it so the
                    // single-hour debug view can recompute at the same temperature.
                    $hour['calc']['water_temp_start'] ?? $hour['pool']['water_temp'],
                    $hour['pool']['is_open'] ? 1 : 0,
                    $hour['losses']['total_kw'],
                    $hour['gains']['solar_kw'],
                    $hour['gains']['heat_pump_kw'],
                    $hour['gains']['boiler_kw'],
                    $hour['energy']['hp_electricity_kwh'],
                    $hour['energy']['boiler_fuel_kwh'],
                    $hour['energy']['hp_cop'],
                    $hour['cost']
                ]);
            }

            $sql = "INSERT INTO simulation_hourly_results
                    (run_id, timestamp, air_temp, wind_speed, humidity, solar_kwh_m2,
                     target_temp, water_temp, water_temp_start, is_open, total_loss_kw, solar_gain_kw,
                     hp_heat_kw, boiler_heat_kw, hp_electricity_kwh, boiler_fuel_kwh, hp_cop, cost)
                    VALUES " . implode(", ", $placeholders);

            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);
        }
    }
}
