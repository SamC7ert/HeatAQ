<?php
/**
 * HeatAQ Scheduler API
 * REST API for pool schedule operations
 *
 * Endpoints:
 * - GET ?action=get_schedule_for_date&date=2024-03-15
 * - GET ?action=get_periods&date=2024-03-15
 * - GET ?action=get_schedule_range&start=2024-03-01&end=2024-03-31
 * - GET ?action=is_open&datetime=2024-03-15T10:00:00
 * - GET ?action=get_current_temperature&datetime=2024-03-15T10:00:00
 * - GET ?action=get_transitions&date=2024-03-15
 * - GET ?action=find_next_opening&datetime=2024-03-15T10:00:00
 * - GET ?action=test_scheduler (test/debug endpoint)
 */

// Include configuration
require_once __DIR__ . '/../config.php';

// Include authentication if required
if (Config::requiresAuth() && file_exists(__DIR__ . '/../auth.php')) {
    require_once __DIR__ . '/../auth.php';
    $auth = HeatAQAuth::check(Config::requiresAuth());
    if ($auth) {
        if (!isset($auth['project']['pool_site_id'])) {
            header('Content-Type: application/json');
            http_response_code(500);
            echo json_encode(['error' => 'Auth context missing pool_site_id']);
            exit;
        }
        $currentPoolSiteId = (int)$auth['project']['pool_site_id'];
    }
} else {
    // Development mode - get pool_site_id from cookie (required)
    $currentPoolSiteId = null;

    if (isset($_COOKIE['heataq_pool_site_id']) && !empty($_COOKIE['heataq_pool_site_id'])) {
        $currentPoolSiteId = (int)$_COOKIE['heataq_pool_site_id'];
    }

    // No default - require explicit pool_site_id
    if (!$currentPoolSiteId) {
        header('Content-Type: application/json');
        http_response_code(400);
        echo json_encode(['error' => 'Missing pool_site_id: Set heataq_pool_site_id cookie or enable authentication']);
        exit;
    }
}

// Include scheduler
require_once __DIR__ . '/../lib/PoolScheduler.php';

// CORS & Headers
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
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
    echo json_encode($data);
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
    return $_GET[$name] ?? $_POST[$name] ?? $default;
}

// Main handler
try {
    // Get database connection
    $pdo = Config::getDatabase();

    // Initialize scheduler
    $scheduler = new PoolScheduler($pdo, $currentPoolSiteId);

    $action = getParam('action', '');

    switch ($action) {
        case 'get_schedule_for_date':
            $date = getParam('date');
            if (!$date) {
                sendError('Date parameter required');
            }

            $scheduleName = $scheduler->getScheduleForDate($date);
            sendResponse([
                'date' => $date,
                'schedule_name' => $scheduleName
            ]);
            break;

        case 'get_periods':
            $date = getParam('date');
            if (!$date) {
                sendError('Date parameter required');
            }

            $scheduleName = $scheduler->getScheduleForDate($date);
            $periods = $scheduler->getPeriods($date);
            sendResponse([
                'date' => $date,
                'schedule_name' => $scheduleName,
                'periods' => $periods
            ]);
            break;

        case 'get_schedule_range':
            $startDate = getParam('start');
            $endDate = getParam('end');
            if (!$startDate || !$endDate) {
                sendError('Start and end date parameters required');
            }

            $range = $scheduler->getScheduleRange($startDate, $endDate);
            sendResponse([
                'start_date' => $startDate,
                'end_date' => $endDate,
                'days' => array_values($range)
            ]);
            break;

        case 'is_open':
            $datetime = getParam('datetime') ?? date('Y-m-d H:i:s');

            $isOpen = $scheduler->isOpen($datetime);
            $scheduleName = $scheduler->getScheduleForDate($datetime);
            $currentPeriod = $scheduler->getCurrentPeriod($datetime);

            sendResponse([
                'datetime' => $datetime,
                'is_open' => $isOpen,
                'schedule_name' => $scheduleName,
                'current_period' => $currentPeriod
            ]);
            break;

        case 'get_current_temperature':
            $datetime = getParam('datetime') ?? date('Y-m-d H:i:s');

            $temp = $scheduler->getCurrentTemperature($datetime);
            $isOpen = $temp !== null;

            sendResponse([
                'datetime' => $datetime,
                'is_open' => $isOpen,
                'target_temperature' => $temp
            ]);
            break;

        case 'get_transitions':
            $date = getParam('date') ?? date('Y-m-d');

            $scheduleName = $scheduler->getScheduleForDate($date);
            $transitions = $scheduler->getDailyTransitions($date);

            sendResponse([
                'date' => $date,
                'schedule_name' => $scheduleName,
                'transitions' => $transitions
            ]);
            break;

        case 'find_next_opening':
            $datetime = getParam('datetime') ?? date('Y-m-d H:i:s');

            $next = $scheduler->findNextOpening($datetime);

            sendResponse([
                'from_datetime' => $datetime,
                'next_opening' => $next['datetime'] ? $next['datetime']->format('Y-m-d H:i:s') : null,
                'target_temperature' => $next['target_temp']
            ]);
            break;

        case 'get_all_schedules':
            $schedules = $scheduler->getSchedules();
            sendResponse([
                'schedules' => $schedules
            ]);
            break;

        case 'get_week_schedules':
            $weekSchedules = $scheduler->getWeekSchedules();
            sendResponse([
                'week_schedules' => $weekSchedules
            ]);
            break;

        case 'get_date_ranges':
            $dateRanges = $scheduler->getDateRanges();
            sendResponse([
                'date_ranges' => $dateRanges
            ]);
            break;

        case 'get_exception_days':
            $exceptions = $scheduler->getExceptionDays();
            sendResponse([
                'exception_days' => $exceptions
            ]);
            break;

        case 'test_scheduler':
            // Test endpoint - check scheduler is working
            $template = $scheduler->getTemplate();
            $schedules = $scheduler->getSchedules();
            $weekSchedules = $scheduler->getWeekSchedules();
            $dateRanges = $scheduler->getDateRanges();
            $exceptions = $scheduler->getExceptionDays();

            // Test some dates
            $testDates = [
                date('Y-m-d'),                    // Today
                date('Y-m-d', strtotime('+1 day')), // Tomorrow
                date('Y') . '-12-25',             // Christmas
                date('Y') . '-07-01',             // Summer
            ];

            $testResults = [];
            foreach ($testDates as $testDate) {
                try {
                    $testResults[] = [
                        'date' => $testDate,
                        'schedule' => $scheduler->getScheduleForDate($testDate),
                        'periods' => $scheduler->getPeriods($testDate)
                    ];
                } catch (Exception $e) {
                    $testResults[] = [
                        'date' => $testDate,
                        'error' => $e->getMessage()
                    ];
                }
            }

            sendResponse([
                'status' => 'ok',
                'template' => [
                    'id' => $template['template_id'],
                    'name' => $template['name']
                ],
                'counts' => [
                    'day_schedules' => count($schedules),
                    'week_schedules' => count($weekSchedules),
                    'date_ranges' => count($dateRanges),
                    'exception_days' => count($exceptions)
                ],
                'test_dates' => $testResults
            ]);
            break;

        case 'debug_schedule':
            // Full debug endpoint - shows all scheduler data for diagnosing issues
            $template = $scheduler->getTemplate();
            $schedules = $scheduler->getSchedules();
            $weekSchedules = $scheduler->getWeekSchedules();
            $dateRanges = $scheduler->getDateRanges();
            $exceptions = $scheduler->getExceptionDays();

            // Test date from parameter or today
            $testDate = getParam('date', date('Y-m-d'));
            $debugInfo = $scheduler->getScheduleDebugInfo($testDate);

            // Also test specific hours to see when pool is "open"
            $hourlyCheck = [];
            for ($h = 0; $h < 24; $h++) {
                $testDateTime = $testDate . ' ' . sprintf('%02d', $h) . ':00:00';
                $period = $scheduler->getCurrentPeriod($testDateTime);
                $hourlyCheck[$h] = [
                    'hour' => $h,
                    'is_open' => $period !== null,
                    'period' => $period
                ];
            }

            sendResponse([
                'status' => 'ok',
                'debug_date' => $testDate,
                'debug_info' => $debugInfo,
                'hourly_check' => $hourlyCheck,
                'full_template' => $template,
                'all_day_schedules' => $schedules,
                'all_week_schedules' => $weekSchedules,
                'date_ranges' => $dateRanges,
                'exception_days' => $exceptions
            ]);
            break;

        default:
            sendError('Invalid action. Valid actions: get_schedule_for_date, get_periods, get_schedule_range, is_open, get_current_temperature, get_transitions, find_next_opening, get_all_schedules, get_week_schedules, get_date_ranges, get_exception_days, test_scheduler');
    }

} catch (Exception $e) {
    $message = Config::isDebug() ? $e->getMessage() : 'An error occurred';
    sendError($message, 500);
}
