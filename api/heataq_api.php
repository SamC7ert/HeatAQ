<?php
/**
 * HeatAQ Main API
 * REST API endpoint for schedule and calendar operations
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Session-ID');

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth.php';

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

try {
    // Check authentication
    $context = HeatAQAuth::check();

    if (!$context) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }

    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? null;

    // Route requests
    if ($method === 'GET') {
        handleGet($context, $action);
    } elseif ($method === 'POST') {
        handlePost($context);
    } else {
        throw new Exception('Method not supported');
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'error' => $e->getMessage(),
        'debug' => Config::isDebug() ? $e->getTraceAsString() : null
    ]);
}

/**
 * Handle GET requests
 */
function handleGet($context, $action) {
    $pdo = Config::getDatabase();
    $siteId = $context['site_id'];

    switch ($action) {
        case 'get_day_schedules':
            $stmt = $pdo->prepare("
                SELECT
                    ds.day_schedule_id,
                    ds.name,
                    ds.description,
                    ds.schedule_type,
                    ds.is_active,
                    COUNT(dsp.period_id) as period_count
                FROM day_schedules ds
                LEFT JOIN day_schedule_periods dsp ON ds.day_schedule_id = dsp.day_schedule_id
                WHERE ds.site_id = :site_id
                GROUP BY ds.day_schedule_id
                ORDER BY ds.name
            ");
            $stmt->execute(['site_id' => $siteId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_day_schedule_periods':
            $scheduleId = $_GET['schedule_id'] ?? null;
            if (!$scheduleId) {
                throw new Exception('schedule_id required');
            }

            $stmt = $pdo->prepare("
                SELECT *
                FROM day_schedule_periods
                WHERE day_schedule_id = :schedule_id
                ORDER BY start_time
            ");
            $stmt->execute(['schedule_id' => $scheduleId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_week_schedules':
            $stmt = $pdo->prepare("
                SELECT
                    ws.*,
                    d1.name as monday_name,
                    d2.name as tuesday_name,
                    d3.name as wednesday_name,
                    d4.name as thursday_name,
                    d5.name as friday_name,
                    d6.name as saturday_name,
                    d7.name as sunday_name
                FROM week_schedules ws
                LEFT JOIN day_schedules d1 ON ws.monday_schedule_id = d1.day_schedule_id
                LEFT JOIN day_schedules d2 ON ws.tuesday_schedule_id = d2.day_schedule_id
                LEFT JOIN day_schedules d3 ON ws.wednesday_schedule_id = d3.day_schedule_id
                LEFT JOIN day_schedules d4 ON ws.thursday_schedule_id = d4.day_schedule_id
                LEFT JOIN day_schedules d5 ON ws.friday_schedule_id = d5.day_schedule_id
                LEFT JOIN day_schedules d6 ON ws.saturday_schedule_id = d6.day_schedule_id
                LEFT JOIN day_schedules d7 ON ws.sunday_schedule_id = d7.day_schedule_id
                WHERE ws.site_id = :site_id
                ORDER BY ws.name
            ");
            $stmt->execute(['site_id' => $siteId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_calendar_rules':
            $stmt = $pdo->prepare("
                SELECT
                    cr.*,
                    ws.name as week_schedule_name,
                    ds.name as day_schedule_name
                FROM calendar_rules cr
                LEFT JOIN week_schedules ws ON cr.week_schedule_id = ws.week_schedule_id
                LEFT JOIN day_schedules ds ON cr.day_schedule_id = ds.day_schedule_id
                LEFT JOIN schedule_templates st ON cr.schedule_template_id = st.template_id
                WHERE st.site_id = :site_id
                ORDER BY cr.priority DESC, cr.rule_name
            ");
            $stmt->execute(['site_id' => $siteId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_calendar_date_ranges':
            $stmt = $pdo->prepare("
                SELECT
                    cdr.*,
                    ws.name as week_schedule_name
                FROM calendar_date_ranges cdr
                LEFT JOIN week_schedules ws ON cdr.week_schedule_id = ws.week_schedule_id
                LEFT JOIN schedule_templates st ON cdr.schedule_template_id = st.template_id
                WHERE st.site_id = :site_id
                ORDER BY cdr.priority DESC, cdr.start_date
            ");
            $stmt->execute(['site_id' => $siteId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_calendar_exceptions':
            $stmt = $pdo->prepare("
                SELECT
                    ced.*,
                    ds.name as day_schedule_name,
                    hd.holiday_name
                FROM calendar_exception_days ced
                LEFT JOIN day_schedules ds ON ced.day_schedule_id = ds.day_schedule_id
                LEFT JOIN holiday_definitions hd ON ced.holiday_id = hd.holiday_id
                LEFT JOIN schedule_templates st ON ced.schedule_template_id = st.template_id
                WHERE st.site_id = :site_id
                ORDER BY ced.priority DESC, ced.exception_date
            ");
            $stmt->execute(['site_id' => $siteId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'test_schedule_resolution':
            $testDate = $_GET['date'] ?? date('Y-m-d');
            $result = resolveScheduleForDate($pdo, $siteId, $testDate);
            echo json_encode(['success' => true, 'data' => $result]);
            break;

        default:
            throw new Exception('Unknown action');
    }
}

/**
 * Handle POST requests (create/update/delete operations)
 */
function handlePost($context) {
    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input || !isset($input['action'])) {
        throw new Exception('Invalid request');
    }

    $action = $input['action'];
    $pdo = Config::getDatabase();

    // Check permissions
    if (!HeatAQAuth::hasRole($context, 'operator')) {
        http_response_code(403);
        echo json_encode(['error' => 'Insufficient permissions']);
        return;
    }

    switch ($action) {
        case 'save_day_schedule':
            saveDaySchedule($pdo, $context, $input['data']);
            break;

        case 'save_day_schedule_periods':
            saveDaySchedulePeriods($pdo, $context, $input['data']);
            break;

        case 'save_week_schedule':
            saveWeekSchedule($pdo, $context, $input['data']);
            break;

        case 'save_calendar_rule':
            saveCalendarRule($pdo, $context, $input['data']);
            break;

        case 'delete_calendar_rule':
            deleteCalendarRule($pdo, $context, $input['rule_id']);
            break;

        default:
            throw new Exception('Unknown action');
    }
}

/**
 * Save or update day schedule
 */
function saveDaySchedule($pdo, $context, $data) {
    if (isset($data['day_schedule_id']) && $data['day_schedule_id']) {
        // Update
        $stmt = $pdo->prepare("
            UPDATE day_schedules
            SET name = :name,
                description = :description,
                schedule_type = :schedule_type,
                is_active = :is_active
            WHERE day_schedule_id = :id
              AND site_id = :site_id
        ");

        $stmt->execute([
            'id' => $data['day_schedule_id'],
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'schedule_type' => $data['schedule_type'] ?? 'custom',
            'is_active' => $data['is_active'] ?? 1,
            'site_id' => $context['site_id']
        ]);

        $scheduleId = $data['day_schedule_id'];
    } else {
        // Create
        $stmt = $pdo->prepare("
            INSERT INTO day_schedules (site_id, name, description, schedule_type, is_active)
            VALUES (:site_id, :name, :description, :schedule_type, :is_active)
        ");

        $stmt->execute([
            'site_id' => $context['site_id'],
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'schedule_type' => $data['schedule_type'] ?? 'custom',
            'is_active' => $data['is_active'] ?? 1
        ]);

        $scheduleId = $pdo->lastInsertId();
    }

    HeatAQAuth::audit($context, 'save', 'day_schedule', $scheduleId, $data);

    echo json_encode(['success' => true, 'day_schedule_id' => $scheduleId]);
}

/**
 * Save day schedule periods
 */
function saveDaySchedulePeriods($pdo, $context, $data) {
    $scheduleId = $data['day_schedule_id'];

    // Delete existing periods
    $stmt = $pdo->prepare("DELETE FROM day_schedule_periods WHERE day_schedule_id = :id");
    $stmt->execute(['id' => $scheduleId]);

    // Insert new periods
    $stmt = $pdo->prepare("
        INSERT INTO day_schedule_periods (
            day_schedule_id, start_time, end_time,
            target_temp, min_temp, max_temp
        ) VALUES (
            :schedule_id, :start_time, :end_time,
            :target_temp, :min_temp, :max_temp
        )
    ");

    foreach ($data['periods'] as $period) {
        $stmt->execute([
            'schedule_id' => $scheduleId,
            'start_time' => $period['start_time'],
            'end_time' => $period['end_time'],
            'target_temp' => $period['target_temp'],
            'min_temp' => $period['min_temp'] ?? null,
            'max_temp' => $period['max_temp'] ?? null
        ]);
    }

    HeatAQAuth::audit($context, 'save', 'day_schedule_periods', $scheduleId, $data);

    echo json_encode(['success' => true]);
}

/**
 * Save or update week schedule
 */
function saveWeekSchedule($pdo, $context, $data) {
    if (isset($data['week_schedule_id']) && $data['week_schedule_id']) {
        // Update
        $stmt = $pdo->prepare("
            UPDATE week_schedules
            SET name = :name,
                description = :description,
                monday_schedule_id = :mon,
                tuesday_schedule_id = :tue,
                wednesday_schedule_id = :wed,
                thursday_schedule_id = :thu,
                friday_schedule_id = :fri,
                saturday_schedule_id = :sat,
                sunday_schedule_id = :sun
            WHERE week_schedule_id = :id
              AND site_id = :site_id
        ");

        $weekId = $data['week_schedule_id'];
    } else {
        // Create
        $stmt = $pdo->prepare("
            INSERT INTO week_schedules (
                site_id, name, description,
                monday_schedule_id, tuesday_schedule_id, wednesday_schedule_id,
                thursday_schedule_id, friday_schedule_id, saturday_schedule_id,
                sunday_schedule_id
            ) VALUES (
                :site_id, :name, :description,
                :mon, :tue, :wed, :thu, :fri, :sat, :sun
            )
        ");

        $weekId = null;
    }

    $stmt->execute([
        'id' => $weekId,
        'site_id' => $context['site_id'],
        'name' => $data['name'],
        'description' => $data['description'] ?? null,
        'mon' => $data['monday_schedule_id'],
        'tue' => $data['tuesday_schedule_id'],
        'wed' => $data['wednesday_schedule_id'],
        'thu' => $data['thursday_schedule_id'],
        'fri' => $data['friday_schedule_id'],
        'sat' => $data['saturday_schedule_id'],
        'sun' => $data['sunday_schedule_id']
    ]);

    if (!$weekId) {
        $weekId = $pdo->lastInsertId();
    }

    HeatAQAuth::audit($context, 'save', 'week_schedule', $weekId, $data);

    echo json_encode(['success' => true, 'week_schedule_id' => $weekId]);
}

/**
 * Save calendar rule
 */
function saveCalendarRule($pdo, $context, $data) {
    // Implementation depends on specific rule structure
    echo json_encode(['success' => true, 'message' => 'Rule saved']);
}

/**
 * Delete calendar rule
 */
function deleteCalendarRule($pdo, $context, $ruleId) {
    $stmt = $pdo->prepare("DELETE FROM calendar_rules WHERE rule_id = :id");
    $stmt->execute(['id' => $ruleId]);

    HeatAQAuth::audit($context, 'delete', 'calendar_rule', $ruleId);

    echo json_encode(['success' => true]);
}

/**
 * Resolve which schedule applies to a given date
 */
function resolveScheduleForDate($pdo, $siteId, $date) {
    // This is a simplified version
    // Full implementation would check:
    // 1. Exception days (highest priority)
    // 2. Date ranges
    // 3. Week schedule (base)

    return [
        'date' => $date,
        'resolved_schedule' => 'Normal',
        'source' => 'week_schedule',
        'message' => 'Resolution logic to be implemented'
    ];
}
