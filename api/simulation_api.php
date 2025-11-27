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
 * - GET ?action=get_pool_config - Get pool configuration and equipment
 * - GET ?action=get_weather_range - Get available weather data date range
 * - GET ?action=get_version - Get simulator version
 */

// Enable error output for debugging
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Custom error handler to return JSON errors
set_error_handler(function($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Catch fatal errors
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        header('Content-Type: application/json');
        echo json_encode(['error' => $error['message'], 'file' => $error['file'], 'line' => $error['line']]);
    }
});

// Include configuration
require_once __DIR__ . '/../config.php';

// Include authentication if required
if (Config::requiresAuth() && file_exists(__DIR__ . '/../auth.php')) {
    require_once __DIR__ . '/../auth.php';
    $auth = HeatAQAuth::check(Config::requiresAuth());
    if ($auth) {
        $currentSiteId = $auth['project']['site_id'];
        $currentUserId = $auth['user']['user_id'] ?? null;
    }
} else {
    $currentSiteId = 'arendal_aquatic';
    $currentUserId = null;
}

// Include required classes
require_once __DIR__ . '/../lib/PoolScheduler.php';
require_once __DIR__ . '/../lib/EnergySimulator.php';

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

            // Get optional equipment overrides
            $equipmentOverrides = getParam('equipment', null);

            // Get optional config and template IDs
            $configId = getParam('config_id', null);
            $templateId = getParam('template_id', null);

            // Initialize scheduler (with optional template selection)
            $scheduler = new PoolScheduler($pdo, $currentSiteId, $templateId);

            // Initialize simulator
            $simulator = new EnergySimulator($pdo, $currentSiteId, $scheduler);

            // Load and apply configuration if specified
            if ($configId) {
                $config = null;
                $configRow = null;

                // Try with all columns first (json_config + legacy columns)
                try {
                    $configStmt = $pdo->prepare("
                        SELECT json_config, hp_capacity_kw, boiler_capacity_kw, target_temp, control_strategy
                        FROM config_templates WHERE template_id = ?
                    ");
                    $configStmt->execute([$configId]);
                    $configRow = $configStmt->fetch();
                } catch (PDOException $e) {
                    // Columns may not exist, try fallback
                    $configRow = null;
                }

                // Fallback: try config_json column (original schema name)
                if (!$configRow) {
                    try {
                        $configStmt = $pdo->prepare("
                            SELECT config_json as json_config
                            FROM config_templates WHERE template_id = ?
                        ");
                        $configStmt->execute([$configId]);
                        $configRow = $configStmt->fetch();
                    } catch (PDOException $e) {
                        // Neither column exists
                        $configRow = null;
                    }
                }

                if ($configRow) {
                    $config = json_decode($configRow['json_config'] ?? '{}', true) ?: [];

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

            // Apply equipment overrides if provided (takes precedence)
            if ($equipmentOverrides) {
                $simulator->setEquipment($equipmentOverrides);
            }

            // Create simulation run record
            $runId = createSimulationRun($pdo, [
                'site_id' => $currentSiteId,
                'user_id' => $currentUserId,
                'scenario_name' => $scenarioName,
                'description' => $description,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'config_snapshot' => json_encode([
                    'simulator_version' => EnergySimulator::getVersion(),
                    'pool_config' => $simulator->getPoolConfig(),
                    'equipment' => $simulator->getEquipment(),
                    'template_id' => $scheduler->getTemplate()['template_id'] ?? null,
                ]),
            ]);

            // Update status to running
            updateRunStatus($pdo, $runId, 'running');

            try {
                // Run simulation
                $results = $simulator->runSimulation($startDate, $endDate);

                // Store results
                storeSimulationResults($pdo, $runId, $results);

                // Update status to completed
                updateRunStatus($pdo, $runId, 'completed', $results['summary']);

                sendResponse([
                    'status' => 'success',
                    'run_id' => $runId,
                    'simulator_version' => EnergySimulator::getVersion(),
                    'summary' => $results['summary'],
                    'meta' => $results['meta'],
                    'daily_count' => count($results['daily']),
                    'hourly_count' => count($results['hourly']),
                ]);

            } catch (Exception $e) {
                // Update status to failed
                updateRunStatus($pdo, $runId, 'failed', ['error' => $e->getMessage()]);
                throw $e;
            }
            break;

        case 'get_runs':
            // Get all simulation runs for this site
            $limit = (int) getParam('limit', 50);
            $offset = (int) getParam('offset', 0);

            try {
                $stmt = $pdo->prepare("
                    SELECT
                        run_id,
                        scenario_name,
                        description,
                        start_date,
                        end_date,
                        status,
                        created_at,
                        completed_at,
                        summary_json
                    FROM simulation_runs
                    WHERE site_id = ?
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                ");
                $stmt->execute([$currentSiteId, $limit, $offset]);
                $runs = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (Exception $e) {
                // Table might not exist yet
                $runs = [];
            }

            // Decode summary JSON
            foreach ($runs as &$run) {
                $run['summary'] = json_decode($run['summary_json'], true);
                unset($run['summary_json']);
            }

            // Get total count
            $totalCount = 0;
            try {
                $countStmt = $pdo->prepare("SELECT COUNT(*) FROM simulation_runs WHERE site_id = ?");
                $countStmt->execute([$currentSiteId]);
                $totalCount = $countStmt->fetchColumn();
            } catch (Exception $e) {
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

            $stmt = $pdo->prepare("
                SELECT * FROM simulation_runs
                WHERE run_id = ? AND site_id = ?
            ");
            $stmt->execute([$runId, $currentSiteId]);
            $run = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$run) {
                sendError('Simulation run not found', 404);
            }

            $run['config'] = json_decode($run['config_snapshot'], true);
            $run['summary'] = json_decode($run['summary_json'], true);
            unset($run['config_snapshot'], $run['summary_json']);

            sendResponse(['run' => $run]);
            break;

        case 'get_summary':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            $stmt = $pdo->prepare("
                SELECT run_id, scenario_name, start_date, end_date, status, summary_json
                FROM simulation_runs
                WHERE run_id = ? AND site_id = ?
            ");
            $stmt->execute([$runId, $currentSiteId]);
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
                'summary' => json_decode($run['summary_json'], true)
            ]);
            break;

        case 'get_daily_results':
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            // Verify run belongs to site
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND site_id = ?");
            $stmt->execute([$runId, $currentSiteId]);
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
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND site_id = ?");
            $stmt->execute([$runId, $currentSiteId]);
            if (!$stmt->fetch()) {
                sendError('Simulation run not found', 404);
            }

            // Build query based on filters
            if ($dateFilter) {
                $stmt = $pdo->prepare("
                    SELECT * FROM simulation_hourly_results
                    WHERE run_id = ? AND DATE(timestamp) = ?
                    ORDER BY timestamp
                    LIMIT ? OFFSET ?
                ");
                $stmt->execute([$runId, $dateFilter, $limit, $offset]);
            } else {
                $stmt = $pdo->prepare("
                    SELECT * FROM simulation_hourly_results
                    WHERE run_id = ?
                    ORDER BY timestamp
                    LIMIT ? OFFSET ?
                ");
                $stmt->execute([$runId, $limit, $offset]);
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
            $runId = (int) getParam('run_id');
            if (!$runId) {
                sendError('run_id parameter required');
            }

            // Verify run belongs to site
            $stmt = $pdo->prepare("SELECT run_id FROM simulation_runs WHERE run_id = ? AND site_id = ?");
            $stmt->execute([$runId, $currentSiteId]);
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
                    'site_id' => $currentSiteId,
                    'weather_range' => $range
                ]);
            } catch (Exception $e) {
                sendResponse([
                    'site_id' => $currentSiteId,
                    'weather_range' => [
                        'min_date' => '2014-01-01',
                        'max_date' => '2023-12-31'
                    ],
                    'note' => 'Using default range',
                    'error' => $e->getMessage()
                ]);
            }
            break;

        case 'get_pool_config':
            $scheduler = new PoolScheduler($pdo, $currentSiteId);
            $simulator = new EnergySimulator($pdo, $currentSiteId, $scheduler);

            sendResponse([
                'simulator_version' => EnergySimulator::getVersion(),
                'pool_config' => $simulator->getPoolConfig(),
                'equipment' => $simulator->getEquipment()
            ]);
            break;

        case 'get_version':
            sendResponse([
                'version' => EnergySimulator::getVersion(),
                'simulator_version' => EnergySimulator::getVersion(),
                'php_version' => PHP_VERSION
            ]);
            break;

        case 'debug_hour':
            // Debug a single hour - reads from stored simulation data + detailed recalc
            $date = getParam('date');
            $hour = (int) getParam('hour', 0);
            $runId = getParam('run_id'); // Optional: specific run
            $waterTempOverride = getParam('water_temp'); // Optional manual override

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
            if (!$runId) {
                $stmt = $pdo->prepare("
                    SELECT run_id, scenario_name
                    FROM simulation_runs
                    WHERE site_id = ?
                      AND status = 'completed'
                      AND start_date <= ?
                      AND end_date >= ?
                    ORDER BY created_at DESC
                    LIMIT 1
                ");
                $stmt->execute([$currentSiteId, $date, $date]);
                $run = $stmt->fetch();

                if (!$run) {
                    sendError("No simulation run found covering date $date. Run a simulation first.", 404);
                }
                $runId = $run['run_id'];
            }

            // Get stored hourly data for this timestamp
            $stmt = $pdo->prepare("
                SELECT *
                FROM simulation_hourly_results
                WHERE run_id = ? AND timestamp = ?
                LIMIT 1
            ");
            $stmt->execute([$runId, $timestamp]);
            $stored = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$stored) {
                sendError("No stored data found for $timestamp in run $runId", 404);
            }

            // Use stored water temp unless overridden
            $waterTemp = $waterTempOverride ? (float)$waterTempOverride : (float)$stored['water_temp'];

            // Initialize scheduler and simulator for detailed recalculation
            $scheduler = new PoolScheduler($pdo, $currentSiteId);
            $simulator = new EnergySimulator($pdo, $currentSiteId, $scheduler);

            // Run detailed debug calculation using stored/specified water temp
            $debug = $simulator->debugSingleHour($date, $hour, $waterTemp);

            // Add stored values for comparison
            $debug['stored'] = [
                'run_id' => (int)$runId,
                'water_temp' => (float)$stored['water_temp'],
                'is_open' => (bool)$stored['is_open'],
                'total_loss_kw' => (float)$stored['total_loss_kw'],
                'solar_gain_kw' => (float)$stored['solar_gain_kw'],
                'hp_heat_kw' => (float)$stored['hp_heat_kw'],
                'boiler_heat_kw' => (float)$stored['boiler_heat_kw'],
                'hp_cop' => (float)$stored['hp_cop'],
            ];

            // Validation: check if recalc matches stored (warn if different)
            $storedNetDemand = (float)$stored['total_loss_kw'] - (float)$stored['solar_gain_kw'];
            $recalcNetDemand = $debug['heating_summary']['net_demand_kw'] ?? 0;
            $demandDiff = abs($storedNetDemand - $recalcNetDemand);

            if ($demandDiff > 1.0) { // More than 1 kW difference
                $debug['validation_warning'] = sprintf(
                    'Recalc differs from stored: stored=%.1f kW, recalc=%.1f kW (diff=%.1f)',
                    $storedNetDemand, $recalcNetDemand, $demandDiff
                );
            }

            sendResponse($debug);
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
            if (!$runId) {
                $stmt = $pdo->prepare("
                    SELECT run_id, scenario_name, start_date, end_date
                    FROM simulation_runs
                    WHERE site_id = ?
                      AND status = 'completed'
                      AND start_date <= ?
                      AND end_date >= ?
                    ORDER BY created_at DESC
                    LIMIT 1
                ");
                $stmt->execute([$currentSiteId, $startDate, $endDate]);
                $run = $stmt->fetch();

                if (!$run) {
                    sendError("No simulation run found covering dates $startDate to $endDate. Run a simulation first.", 404);
                }
                $runId = $run['run_id'];
            }

            // Get hourly results from stored data
            $stmt = $pdo->prepare("
                SELECT
                    timestamp,
                    air_temp,
                    wind_speed,
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

            sendResponse([
                'run_id' => (int)$runId,
                'source' => 'stored', // Indicates data comes from DB, not recalculated
                'start_date' => $startDate,
                'end_date' => $endDate,
                'center_date' => $centerDate,
                'hours' => count($hourlyData),
                'data' => $hourlyData,
            ]);
            break;

        default:
            sendError('Invalid action. Valid actions: run_simulation, get_runs, get_run, get_summary, get_daily_results, get_results, delete_run, get_weather_range, get_pool_config, get_version, debug_hour, debug_week');
    }

} catch (PDOException $e) {
    $message = Config::isDebug() ? $e->getMessage() : 'Database error occurred';
    sendError($message, 500);
} catch (Exception $e) {
    $message = Config::isDebug() ? $e->getMessage() : 'An error occurred';
    sendError($message, 500);
}

// Helper functions

/**
 * Create a new simulation run record
 */
function createSimulationRun($pdo, $data) {
    $stmt = $pdo->prepare("
        INSERT INTO simulation_runs
        (site_id, user_id, scenario_name, description, start_date, end_date, status, config_snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NOW())
    ");
    $stmt->execute([
        $data['site_id'],
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
 * Store simulation results
 */
function storeSimulationResults($pdo, $runId, $results) {
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

    // Store hourly results (in batches for performance)
    $batchSize = 500;
    $hourlyData = $results['hourly'];
    $totalHours = count($hourlyData);

    for ($i = 0; $i < $totalHours; $i += $batchSize) {
        $batch = array_slice($hourlyData, $i, $batchSize);
        $placeholders = [];
        $values = [];

        foreach ($batch as $hour) {
            $placeholders[] = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
            $values = array_merge($values, [
                $runId,
                $hour['timestamp'],
                $hour['weather']['air_temp'],
                $hour['weather']['wind_speed'],
                $hour['weather']['humidity'],
                $hour['weather']['solar_kwh_m2'],
                $hour['pool']['target_temp'],
                $hour['pool']['water_temp'],
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
                 target_temp, water_temp, is_open, total_loss_kw, solar_gain_kw,
                 hp_heat_kw, boiler_heat_kw, hp_electricity_kwh, boiler_fuel_kwh, hp_cop, cost)
                VALUES " . implode(", ", $placeholders);

        $stmt = $pdo->prepare($sql);
        $stmt->execute($values);
    }
}
