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
                $configStmt = $pdo->prepare("SELECT config_json FROM config_templates WHERE template_id = ?");
                $configStmt->execute([$configId]);
                $configRow = $configStmt->fetch();
                if ($configRow && $configRow['config_json']) {
                    $config = json_decode($configRow['config_json'], true);
                    if ($config) {
                        $simulator->setConfigFromUI($config);
                    }
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
            // Return available weather data range (simplified query)
            try {
                $stmt = $pdo->query("
                    SELECT
                        MIN(DATE(timestamp)) as min_date,
                        MAX(DATE(timestamp)) as max_date,
                        COUNT(DISTINCT DATE(timestamp)) as days_count,
                        COUNT(*) as hours_count
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
                        'max_date' => '2023-12-31',
                        'days_count' => 3653,
                        'hours_count' => 87672
                    ],
                    'note' => 'Using default range'
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
                'simulator_version' => EnergySimulator::getVersion()
            ]);
            break;

        default:
            sendError('Invalid action. Valid actions: run_simulation, get_runs, get_run, get_summary, get_daily_results, get_results, delete_run, get_weather_range, get_pool_config, get_version');
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
    // Store daily results
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
