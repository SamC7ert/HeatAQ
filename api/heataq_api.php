<?php
/**
 * HeatAQ API - Schedule Management System
 * Version: 3.0 - With secure configuration
 * 
 * Security improvements:
 * - Database credentials in external config
 * - Optional authentication support
 * - Input validation
 * - Prepared statements throughout
 */

// Include configuration loader
require_once __DIR__ . '/../config.php';

// Include authentication if required
if (Config::requiresAuth() && file_exists(__DIR__ . '/../auth.php')) {
    require_once __DIR__ . '/../auth.php';
    $auth = HeatAQAuth::check(Config::requiresAuth());
    if ($auth) {
        $currentSiteId = $auth['project']['site_id'];
    }
} else {
    // If auth not required, use default site
    $currentSiteId = 'arendal_aquatic';
}

// ====================================
// CORS & HEADERS
// ====================================
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Session-ID');

// Handle OPTIONS request for CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

class HeatAQAPI {
    private $db;
    private $siteId;
    private $userId;
    private $projectId;
    private $userRole;
    private $postInput = null;  // Store POST body to avoid double-read

    public function __construct($siteId = null, $auth = null) {
        try {
            // Get database connection from Config
            $this->db = Config::getDatabase();
            
            // Set site context
            $this->siteId = $siteId;
            
            // Set auth context if available
            if ($auth) {
                $this->userId = $auth['user']['user_id'] ?? null;
                $this->projectId = $auth['project']['project_id'] ?? null;
                $this->userRole = $auth['user']['role'] ?? null;
            }
            
        } catch (Exception $e) {
            $this->sendError($e->getMessage());
        }
    }
    
    // ====================================
    // PERMISSION CHECKS
    // ====================================
    
    private function canView() {
        return true; // Everyone can view
    }
    
    private function canEdit() {
        if (!Config::requiresAuth()) return true;
        if (!$this->userRole) return false;
        return in_array($this->userRole, ['operator', 'admin', 'owner']);
    }
    
    private function canDelete() {
        if (!Config::requiresAuth()) return true;
        if (!$this->userRole) return false;
        return in_array($this->userRole, ['admin', 'owner']);
    }
    
    // ====================================
    // SITE FILTERING
    // ====================================
    
    private function addSiteFilter($query, $paramName = 'site_id') {
        if ($this->siteId) {
            if (stripos($query, 'WHERE') !== false) {
                $query = str_replace('WHERE', "WHERE {$paramName} = :site_id AND", $query);
            } else {
                $query .= " WHERE {$paramName} = :site_id";
            }
        }
        return $query;
    }
    
    private function bindSiteParam(&$params) {
        if ($this->siteId) {
            $params[':site_id'] = $this->siteId;
        }
    }
    
    // ====================================
    // MAIN HANDLER
    // ====================================

    public function handle() {
        // Get action from query string first, then from POST body
        $action = $_GET['action'] ?? '';

        // If no action in query string, check POST body
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            // Read and store POST body once (php://input can only be read once)
            $this->postInput = json_decode(file_get_contents('php://input'), true);
            if (empty($action)) {
                $action = $this->postInput['action'] ?? '';
            }
        }

        // Log API access if authenticated
        if (Config::requiresAuth() && class_exists('HeatAQAuth')) {
            HeatAQAuth::audit('api_access', 'endpoint', null, null, ['action' => $action]);
        }

        try {
            switch ($action) {
                // READ operations
                case 'get_templates':
                    $this->getTemplates();
                    break;
                case 'get_day_schedules':
                    $this->getDaySchedules();
                    break;
                case 'get_week_schedules':
                    $this->getWeekSchedules();
                    break;
                case 'get_calendar_rules':
                    $this->getCalendarRules($_GET['template_id'] ?? 1);
                    break;
                case 'get_exception_days':
                    $this->getExceptionDays($_GET['template_id'] ?? 1);
                    break;
                case 'get_reference_days':
                    $this->getReferenceDays();
                    break;
                case 'test_resolution':
                    $this->testResolution();
                    break;
                    
                // WRITE operations
                case 'save_template':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveTemplate();
                    break;

                case 'save_day_schedule':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveDaySchedule();
                    break;

                case 'save_week_schedule':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveWeekSchedule();
                    break;

                case 'save_date_range':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveDateRange();
                    break;

                case 'save_exception_day':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveExceptionDay();
                    break;

                // DELETE operations
                case 'delete_date_range':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteDateRange($_GET['range_id'] ?? 0);
                    break;

                case 'delete_exception_day':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteExceptionDay($_GET['exception_id'] ?? 0);
                    break;

                case 'delete_day_schedule':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteDaySchedule();
                    break;

                case 'delete_week_schedule':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteWeekSchedule();
                    break;

                case 'delete_template':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteTemplate();
                    break;

                // ADMIN: Holiday Definitions
                case 'get_holiday_definitions':
                    $this->getHolidayDefinitions();
                    break;

                case 'save_holiday_definition':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveHolidayDefinition();
                    break;

                case 'delete_holiday_definition':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteHolidayDefinition($_GET['id'] ?? 0);
                    break;

                case 'get_reference_days':
                    $this->getReferenceDays();
                    break;

                // ADMIN: Weather Stations
                case 'get_weather_stations':
                    $this->getWeatherStations();
                    break;

                case 'get_weather_yearly_averages':
                    $this->getWeatherYearlyAverages();
                    break;

                case 'get_weather_monthly_averages':
                    $this->getWeatherMonthlyAverages();
                    break;

                // ADMIN: Users
                case 'get_users':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->getUsers();
                    break;

                case 'save_user':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveUser();
                    break;

                case 'get_projects':
                    $this->getProjects();
                    break;

                // PROJECT CONFIGURATION
                case 'get_project_configs':
                    $this->getProjectConfigs();
                    break;

                case 'get_project_config':
                    $this->getProjectConfig($_GET['config_id'] ?? 0);
                    break;

                case 'save_project_config':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveProjectConfig();
                    break;

                case 'delete_project_config':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteProjectConfig($_GET['config_id'] ?? 0);
                    break;

                default:
                    $this->sendError('Invalid action');
            }
        } catch (Exception $e) {
            $this->sendError(Config::isDebug() ? $e->getMessage() : 'An error occurred');
        }
    }
    
    // ====================================
    // API METHODS
    // ====================================
    
    private function getTemplates() {
        $query = "SELECT * FROM schedule_templates";
        $query = $this->addSiteFilter($query);
        $query .= " ORDER BY name";
        
        $params = [];
        $this->bindSiteParam($params);
        
        if ($params) {
            $stmt = $this->db->prepare($query);
            $stmt->execute($params);
            $templates = $stmt->fetchAll();
        } else {
            $templates = $this->db->query($query)->fetchAll();
        }
        
        $this->sendResponse(['templates' => $templates]);
    }
    
    private function getDaySchedules() {
        $query = "SELECT * FROM day_schedules";
        $query = $this->addSiteFilter($query);
        $query .= " ORDER BY name";
        
        $params = [];
        $this->bindSiteParam($params);
        
        if ($params) {
            $stmt = $this->db->prepare($query);
            $stmt->execute($params);
            $schedules = $stmt->fetchAll();
        } else {
            $schedules = $this->db->query($query)->fetchAll();
        }
        
        foreach ($schedules as &$schedule) {
            $stmt = $this->db->prepare("
                SELECT period_id, day_schedule_id, start_time, end_time, 
                       target_temp as target_temp_c, min_temp, max_temp, period_order
                FROM day_schedule_periods
                WHERE day_schedule_id = ?
                ORDER BY period_order, start_time
            ");
            $stmt->execute([$schedule['day_schedule_id']]);
            $periods = $stmt->fetchAll();
            
            if ($periods) {
                $jsonPeriods = array_map('json_encode', $periods);
                $schedule['periods'] = implode(',', $jsonPeriods);
            } else {
                $schedule['periods'] = null;
            }
        }
        
        $this->sendResponse(['schedules' => $schedules]);
    }
    
    private function getWeekSchedules() {
        $query = "
            SELECT ws.*, 
                   d1.name as monday_schedule_name,
                   d2.name as tuesday_schedule_name,
                   d3.name as wednesday_schedule_name,
                   d4.name as thursday_schedule_name,
                   d5.name as friday_schedule_name,
                   d6.name as saturday_schedule_name,
                   d7.name as sunday_schedule_name
            FROM week_schedules ws
            LEFT JOIN day_schedules d1 ON ws.monday_schedule_id = d1.day_schedule_id
            LEFT JOIN day_schedules d2 ON ws.tuesday_schedule_id = d2.day_schedule_id
            LEFT JOIN day_schedules d3 ON ws.wednesday_schedule_id = d3.day_schedule_id
            LEFT JOIN day_schedules d4 ON ws.thursday_schedule_id = d4.day_schedule_id
            LEFT JOIN day_schedules d5 ON ws.friday_schedule_id = d5.day_schedule_id
            LEFT JOIN day_schedules d6 ON ws.saturday_schedule_id = d6.day_schedule_id
            LEFT JOIN day_schedules d7 ON ws.sunday_schedule_id = d7.day_schedule_id
        ";
        
        $query = $this->addSiteFilter($query, 'ws.site_id');
        $query .= " ORDER BY ws.name";
        
        $params = [];
        $this->bindSiteParam($params);
        
        if ($params) {
            $stmt = $this->db->prepare($query);
            $stmt->execute($params);
            $schedules = $stmt->fetchAll();
        } else {
            $schedules = $this->db->query($query)->fetchAll();
        }
        
        $this->sendResponse(['schedules' => $schedules]);
    }
    
    private function getCalendarRules($templateId) {
        if (!$this->validateId($templateId)) {
            $this->sendError('Invalid template ID');
        }
        
        $stmt = $this->db->prepare("
            SELECT 
                cr.id as range_id,
                cr.*,
                ws.name as week_schedule_name
            FROM calendar_date_ranges cr
            LEFT JOIN week_schedules ws ON cr.week_schedule_id = ws.week_schedule_id
            WHERE cr.schedule_template_id = ?
            ORDER BY cr.priority DESC, cr.start_date
        ");
        $stmt->execute([$templateId]);
        
        $this->sendResponse(['rules' => $stmt->fetchAll()]);
    }
    
    private function getExceptionDays($templateId) {
        if (!$this->validateId($templateId)) {
            $this->sendError('Invalid template ID');
        }

        // Get saved exceptions for this template
        $stmt = $this->db->prepare("
            SELECT
                ce.id as exception_id,
                ce.*,
                ds.name as day_schedule_name
            FROM calendar_exception_days ce
            LEFT JOIN day_schedules ds ON ce.day_schedule_id = ds.day_schedule_id
            WHERE ce.schedule_template_id = ?
        ");
        $stmt->execute([$templateId]);
        $savedExceptions = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Standard Norwegian holidays - will be merged with saved exceptions
        $standardHolidays = [
            // Fixed date holidays
            ['name' => 'Nyttårsdag', 'is_moving' => 0, 'fixed_month' => 1, 'fixed_day' => 1],
            ['name' => 'Arbeidernes dag', 'is_moving' => 0, 'fixed_month' => 5, 'fixed_day' => 1],
            ['name' => 'Grunnlovsdag', 'is_moving' => 0, 'fixed_month' => 5, 'fixed_day' => 17],
            ['name' => 'Julaften', 'is_moving' => 0, 'fixed_month' => 12, 'fixed_day' => 24],
            ['name' => 'Første juledag', 'is_moving' => 0, 'fixed_month' => 12, 'fixed_day' => 25],
            ['name' => 'Andre juledag', 'is_moving' => 0, 'fixed_month' => 12, 'fixed_day' => 26],
            ['name' => 'Nyttårsaften', 'is_moving' => 0, 'fixed_month' => 12, 'fixed_day' => 31],
            // Easter-relative holidays
            ['name' => 'Palmesøndag', 'is_moving' => 1, 'easter_offset_days' => -7],
            ['name' => 'Skjærtorsdag', 'is_moving' => 1, 'easter_offset_days' => -3],
            ['name' => 'Langfredag', 'is_moving' => 1, 'easter_offset_days' => -2],
            ['name' => 'Påskeaften', 'is_moving' => 1, 'easter_offset_days' => -1],
            ['name' => 'Første påskedag', 'is_moving' => 1, 'easter_offset_days' => 0],
            ['name' => 'Andre påskedag', 'is_moving' => 1, 'easter_offset_days' => 1],
            ['name' => 'Kristi himmelfartsdag', 'is_moving' => 1, 'easter_offset_days' => 39],
            ['name' => 'Første pinsedag', 'is_moving' => 1, 'easter_offset_days' => 49],
            ['name' => 'Andre pinsedag', 'is_moving' => 1, 'easter_offset_days' => 50],
        ];

        // Build lookup of saved exceptions by key (name + date info)
        $savedLookup = [];
        foreach ($savedExceptions as $ex) {
            if ($ex['is_moving']) {
                $key = 'easter:' . $ex['easter_offset_days'];
            } else {
                $key = 'fixed:' . $ex['fixed_month'] . ':' . $ex['fixed_day'];
            }
            $savedLookup[$key] = $ex;
        }

        // Merge standard holidays with saved exceptions
        $result = [];
        foreach ($standardHolidays as $holiday) {
            if ($holiday['is_moving']) {
                $key = 'easter:' . $holiday['easter_offset_days'];
            } else {
                $key = 'fixed:' . $holiday['fixed_month'] . ':' . $holiday['fixed_day'];
            }

            if (isset($savedLookup[$key])) {
                // Use saved exception (has exception_id and possibly day_schedule_id)
                $result[] = $savedLookup[$key];
                unset($savedLookup[$key]); // Remove from lookup so we don't duplicate
            } else {
                // Create placeholder with no saved id (will need to be created when saved)
                $result[] = [
                    'exception_id' => null,
                    'id' => null,
                    'schedule_template_id' => $templateId,
                    'name' => $holiday['name'],
                    'day_schedule_id' => null,
                    'day_schedule_name' => null,
                    'is_moving' => $holiday['is_moving'],
                    'easter_offset_days' => $holiday['easter_offset_days'] ?? null,
                    'fixed_month' => $holiday['fixed_month'] ?? null,
                    'fixed_day' => $holiday['fixed_day'] ?? null,
                ];
            }
        }

        // Add any custom exceptions that weren't in the standard list
        foreach ($savedLookup as $ex) {
            $result[] = $ex;
        }

        // Sort by is_moving (easter first), then by date
        usort($result, function($a, $b) {
            if ($a['is_moving'] != $b['is_moving']) {
                return $b['is_moving'] - $a['is_moving'];
            }
            if ($a['is_moving']) {
                return ($a['easter_offset_days'] ?? 0) - ($b['easter_offset_days'] ?? 0);
            }
            return (($a['fixed_month'] ?? 0) * 100 + ($a['fixed_day'] ?? 0)) -
                   (($b['fixed_month'] ?? 0) * 100 + ($b['fixed_day'] ?? 0));
        });

        $this->sendResponse(['exceptions' => $result]);
    }
    
    private function getReferenceDays() {
        $currentYear = date('Y');
        $startYear = $currentYear - 1;
        $endYear = $currentYear + 1;
        
        $stmt = $this->db->prepare("
            SELECT * FROM holiday_reference_days 
            WHERE year BETWEEN ? AND ?
            ORDER BY year
        ");
        $stmt->execute([$startYear, $endYear]);
        
        $this->sendResponse(['reference_days' => $stmt->fetchAll()]);
    }
    
    private function testResolution() {
        $date = $_GET['date'] ?? date('Y-m-d');
        $templateId = $_GET['template_id'] ?? 1;
        
        $this->sendResponse([
            'date' => $date,
            'rule_name' => 'Default',
            'day_schedule' => 'Normal'
        ]);
    }
    
    private function saveTemplate() {
        $input = $this->getPostInput();

        $templateId = $input['template_id'] ?? null;
        $name = trim($input['name'] ?? '');
        $description = trim($input['description'] ?? '');
        $baseWeekScheduleId = $input['base_week_schedule_id'] ?? $input['default_week_schedule_id'] ?? null;

        if (empty($name)) {
            $this->sendError('Template name is required');
        }

        if ($templateId) {
            // Update existing
            $stmt = $this->db->prepare("
                UPDATE schedule_templates
                SET name = ?, description = ?, base_week_schedule_id = ?
                WHERE template_id = ?
            ");
            $stmt->execute([$name, $description, $baseWeekScheduleId, $templateId]);
        } else {
            // Create new - generate unique version
            $siteId = $this->siteId ?? 'arendal_aquatic';

            // Find next available version for this name
            $stmt = $this->db->prepare("
                SELECT MAX(CAST(SUBSTRING(version, 2) AS DECIMAL(10,1))) as max_ver
                FROM schedule_templates
                WHERE name = ?
            ");
            $stmt->execute([$name]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $nextVer = ($row && $row['max_ver']) ? 'v' . number_format($row['max_ver'] + 0.1, 1) : 'v1.0';

            $stmt = $this->db->prepare("
                INSERT INTO schedule_templates (site_id, name, version, description, base_week_schedule_id)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([$siteId, $name, $nextVer, $description, $baseWeekScheduleId]);
            $templateId = $this->db->lastInsertId();
        }

        $this->sendResponse(['success' => true, 'template_id' => $templateId]);
    }

    private function saveDaySchedule() {
        $input = $this->getPostInput();

        $scheduleId = $input['day_schedule_id'] ?? null;
        $name = trim($input['name'] ?? '');
        $isClosed = $input['is_closed'] ?? 0;
        $periods = $input['periods'] ?? [];

        if (empty($name)) {
            $this->sendError('Schedule name is required');
        }

        $this->db->beginTransaction();

        try {
            if ($scheduleId) {
                // Update existing
                $stmt = $this->db->prepare("
                    UPDATE day_schedules SET name = ?, is_closed = ? WHERE day_schedule_id = ?
                ");
                $stmt->execute([$name, $isClosed, $scheduleId]);

                // Delete existing periods
                $stmt = $this->db->prepare("DELETE FROM day_schedule_periods WHERE day_schedule_id = ?");
                $stmt->execute([$scheduleId]);
            } else {
                // Create new
                $siteId = $this->siteId ?? 'arendal_aquatic';
                $stmt = $this->db->prepare("
                    INSERT INTO day_schedules (site_id, name, is_closed) VALUES (?, ?, ?)
                ");
                $stmt->execute([$siteId, $name, $isClosed]);
                $scheduleId = $this->db->lastInsertId();
            }

            // Insert periods
            if (!$isClosed && !empty($periods)) {
                $stmt = $this->db->prepare("
                    INSERT INTO day_schedule_periods
                    (day_schedule_id, start_time, end_time, target_temp, min_temp, max_temp, period_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ");

                foreach ($periods as $i => $period) {
                    $stmt->execute([
                        $scheduleId,
                        $period['start_time'],
                        $period['end_time'],
                        $period['target_temp'] ?? 28.0,
                        $period['min_temp'] ?? 26.0,
                        $period['max_temp'] ?? 30.0,
                        $period['period_order'] ?? ($i + 1)
                    ]);
                }
            }

            $this->db->commit();
            $this->sendResponse(['success' => true, 'day_schedule_id' => $scheduleId]);

        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    private function saveWeekSchedule() {
        $input = $this->getPostInput();

        $scheduleId = $input['week_schedule_id'] ?? null;
        $name = trim($input['name'] ?? '');

        if (empty($name)) {
            $this->sendError('Schedule name is required');
        }

        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $dayScheduleIds = [];
        foreach ($days as $day) {
            $dayScheduleIds[$day] = $input[$day . '_schedule_id'] ?? null;
        }

        if ($scheduleId) {
            // Update existing
            $stmt = $this->db->prepare("
                UPDATE week_schedules SET
                    name = ?,
                    monday_schedule_id = ?, tuesday_schedule_id = ?, wednesday_schedule_id = ?,
                    thursday_schedule_id = ?, friday_schedule_id = ?, saturday_schedule_id = ?, sunday_schedule_id = ?
                WHERE week_schedule_id = ?
            ");
            $stmt->execute([
                $name,
                $dayScheduleIds['monday'], $dayScheduleIds['tuesday'], $dayScheduleIds['wednesday'],
                $dayScheduleIds['thursday'], $dayScheduleIds['friday'], $dayScheduleIds['saturday'], $dayScheduleIds['sunday'],
                $scheduleId
            ]);
        } else {
            // Create new
            $siteId = $this->siteId ?? 'arendal_aquatic';
            $stmt = $this->db->prepare("
                INSERT INTO week_schedules
                (site_id, name, monday_schedule_id, tuesday_schedule_id, wednesday_schedule_id,
                 thursday_schedule_id, friday_schedule_id, saturday_schedule_id, sunday_schedule_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $siteId, $name,
                $dayScheduleIds['monday'], $dayScheduleIds['tuesday'], $dayScheduleIds['wednesday'],
                $dayScheduleIds['thursday'], $dayScheduleIds['friday'], $dayScheduleIds['saturday'], $dayScheduleIds['sunday']
            ]);
            $scheduleId = $this->db->lastInsertId();
        }

        $this->sendResponse(['success' => true, 'week_schedule_id' => $scheduleId]);
    }

    private function saveDateRange() {
        $input = $this->getPostInput();

        $rangeId = $input['range_id'] ?? null;
        $templateId = $input['template_id'] ?? 1;
        $weekScheduleId = $input['week_schedule_id'] ?? null;
        $startDate = $input['start_date'] ?? null;
        $endDate = $input['end_date'] ?? null;
        $priority = (int)($input['priority'] ?? 1);

        if (!$weekScheduleId) {
            $this->sendError('Week schedule is required');
        }

        // For year-round (default), use priority 0 and placeholder dates
        $isDefault = ($input['is_default'] ?? false) || $priority === 0;
        if ($isDefault || $priority === 0) {
            $startDate = $startDate ?: '1970-01-01';
            $endDate = $endDate ?: '2099-12-31';
            $priority = 0;
        }

        if ($rangeId) {
            // Update existing (column is 'id', not 'range_id')
            $stmt = $this->db->prepare("
                UPDATE calendar_date_ranges
                SET week_schedule_id = ?, start_date = ?, end_date = ?, priority = ?
                WHERE id = ?
            ");
            $stmt->execute([$weekScheduleId, $startDate, $endDate, $priority, $rangeId]);
        } else {
            // Create new (column is 'schedule_template_id', not 'template_id')
            $stmt = $this->db->prepare("
                INSERT INTO calendar_date_ranges (schedule_template_id, week_schedule_id, start_date, end_date, priority)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([$templateId, $weekScheduleId, $startDate, $endDate, $priority]);
            $rangeId = $this->db->lastInsertId();
        }

        $this->sendResponse(['success' => true, 'range_id' => $rangeId]);
    }

    private function saveExceptionDay() {
        $input = $this->getPostInput();

        // Debug: check what we received
        if (empty($input)) {
            $this->sendError('No input received');
        }

        $exceptionId = isset($input['exception_id']) ? (int)$input['exception_id'] : 0;

        // Convert any non-positive value to null for foreign key
        $dayScheduleId = null;
        if (array_key_exists('day_schedule_id', $input)) {
            $raw = $input['day_schedule_id'];
            if ($raw !== null && $raw !== '' && $raw !== 'null' && $raw !== 0 && $raw !== '0') {
                $val = (int)$raw;
                if ($val > 0) {
                    $dayScheduleId = $val;
                }
            }
        }

        // DEBUG v4: Log what we're about to do
        error_log("saveExceptionDay: exceptionId=$exceptionId, dayScheduleId=" . var_export($dayScheduleId, true));

        // For updates, just update the day_schedule_id
        if ($exceptionId > 0) {
            if ($dayScheduleId === null) {
                // V6: DELETE the record instead of setting NULL
                // The standard holiday list will show "No Exception" for missing records
                $stmt = $this->db->prepare("DELETE FROM calendar_exception_days WHERE id = ?");
                $stmt->execute([$exceptionId]);
                $this->sendResponse(['success' => true, 'v' => 'V6-DEL', 'deleted_id' => $exceptionId]);
            } else {
                $stmt = $this->db->prepare("UPDATE calendar_exception_days SET day_schedule_id = ? WHERE id = ?");
                $stmt->execute([$dayScheduleId, $exceptionId]);
                $this->sendResponse(['success' => true, 'v' => 'V6-UPD', 'id' => $exceptionId, 'ds' => $dayScheduleId]);
            }
            return;
        }

        // For new exceptions - this shouldn't be reached for "No Exception" selection
        error_log("saveExceptionDay: Creating NEW exception (no exceptionId)");
        $templateId = $input['template_id'] ?? 1;
        $name = trim($input['name'] ?? '');
        $isMoving = (int)($input['is_moving'] ?? 0);
        $easterOffsetDays = array_key_exists('easter_offset_days', $input) ? $input['easter_offset_days'] : null;
        $fixedMonth = $input['fixed_month'] ?? null;
        $fixedDay = $input['fixed_day'] ?? null;

        if (empty($name)) {
            $this->sendError('Exception name is required');
        }

        if ($isMoving && $easterOffsetDays === null) {
            $this->sendError('Easter offset is required for moving holidays');
        }

        if (!$isMoving && (!$fixedMonth || !$fixedDay)) {
            $this->sendError('Fixed month and day are required for fixed holidays');
        }

        // Create new
        try {
            $stmt = $this->db->prepare("
                INSERT INTO calendar_exception_days (schedule_template_id, name, day_schedule_id, is_moving, easter_offset_days, fixed_month, fixed_day)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([$templateId, $name, $dayScheduleId, $isMoving, $easterOffsetDays, $fixedMonth, $fixedDay]);
            $exceptionId = $this->db->lastInsertId();
            $this->sendResponse(['success' => true, 'exception_id' => $exceptionId]);
        } catch (Exception $e) {
            $this->sendError('Database error: ' . $e->getMessage());
        }
    }

    private function deleteDateRange($rangeId) {
        if (!$this->validateId($rangeId)) {
            $this->sendError('Invalid range ID');
        }

        $stmt = $this->db->prepare("DELETE FROM calendar_date_ranges WHERE id = ?");
        $stmt->execute([$rangeId]);

        $this->sendResponse(['success' => true]);
    }

    private function deleteExceptionDay($exceptionId) {
        if (!$this->validateId($exceptionId)) {
            $this->sendError('Invalid exception ID');
        }

        $stmt = $this->db->prepare("DELETE FROM calendar_exception_days WHERE id = ?");
        $stmt->execute([$exceptionId]);

        $this->sendResponse(['success' => true]);
    }

    private function deleteDaySchedule() {
        $input = $this->getPostInput();
        $scheduleId = $input['schedule_id'] ?? null;

        if (!$this->validateId($scheduleId)) {
            $this->sendError('Invalid schedule ID');
        }

        // Delete periods first
        $stmt = $this->db->prepare("DELETE FROM day_schedule_periods WHERE day_schedule_id = ?");
        $stmt->execute([$scheduleId]);

        // Delete the schedule
        $stmt = $this->db->prepare("DELETE FROM day_schedules WHERE day_schedule_id = ?");
        $stmt->execute([$scheduleId]);

        $this->sendResponse(['success' => true]);
    }

    private function deleteWeekSchedule() {
        $input = $this->getPostInput();
        $scheduleId = $input['schedule_id'] ?? null;

        if (!$this->validateId($scheduleId)) {
            $this->sendError('Invalid schedule ID');
        }

        // Delete the week schedule
        $stmt = $this->db->prepare("DELETE FROM week_schedules WHERE week_schedule_id = ?");
        $stmt->execute([$scheduleId]);

        $this->sendResponse(['success' => true]);
    }

    private function deleteTemplate() {
        $input = $this->getPostInput();
        $templateId = $input['template_id'] ?? null;

        if (!$this->validateId($templateId)) {
            $this->sendError('Invalid template ID');
        }

        // Don't allow deleting template 1 (default)
        if ($templateId == 1) {
            $this->sendError('Cannot delete the default template');
        }

        // Delete related data first (cascading delete)
        // Delete calendar date ranges
        $stmt = $this->db->prepare("DELETE FROM calendar_date_ranges WHERE schedule_template_id = ?");
        $stmt->execute([$templateId]);

        // Delete calendar exception days
        $stmt = $this->db->prepare("DELETE FROM calendar_exception_days WHERE schedule_template_id = ?");
        $stmt->execute([$templateId]);

        // Delete the template
        $stmt = $this->db->prepare("DELETE FROM schedule_templates WHERE template_id = ?");
        $stmt->execute([$templateId]);

        $this->sendResponse(['success' => true]);
    }

    // ====================================
    // ADMIN: HOLIDAY DEFINITIONS
    // ====================================

    private function getHolidayDefinitions() {
        try {
            // Production schema: holiday_code, holiday_name_no, holiday_name_en,
            // calculation_type (enum), fixed_date (varchar), easter_offset (int)
            $stmt = $this->db->query("
                SELECT
                    holiday_code as id,
                    holiday_name_no as name,
                    holiday_name_en as name_en,
                    CASE WHEN calculation_type = 'easter_relative' THEN 1 ELSE 0 END as is_moving,
                    SUBSTRING(fixed_date, 1, 2) as fixed_month,
                    SUBSTRING(fixed_date, 4, 2) as fixed_day,
                    easter_offset as easter_offset_days
                FROM holiday_definitions
                ORDER BY
                    CASE WHEN calculation_type = 'fixed' THEN fixed_date ELSE CONCAT('03-', LPAD(easter_offset + 100, 3, '0')) END
            ");
            $definitions = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $this->sendResponse(['definitions' => $definitions]);
        } catch (PDOException $e) {
            $this->sendResponse([
                'definitions' => [],
                'error' => 'Holiday definitions table error',
                'debug' => $e->getMessage()
            ]);
        }
    }

    private function saveHolidayDefinition() {
        $input = $this->getPostInput();
        $code = $input['id'] ?? null;  // holiday_code is the primary key
        $nameNo = $input['name'] ?? '';
        $nameEn = $input['name_en'] ?? null;
        $isMoving = $input['is_moving'] ?? 0;
        $fixedMonth = $input['fixed_month'] ?? null;
        $fixedDay = $input['fixed_day'] ?? null;
        $easterOffset = $input['easter_offset_days'] ?? null;

        if (empty($nameNo)) {
            $this->sendError('Name is required');
        }

        // Convert to production schema format
        $calculationType = $isMoving ? 'easter_relative' : 'fixed';
        $fixedDate = null;
        if (!$isMoving && $fixedMonth && $fixedDay) {
            $fixedDate = sprintf('%02d-%02d', $fixedMonth, $fixedDay);
        }

        if ($code) {
            // Update existing
            $stmt = $this->db->prepare("
                UPDATE holiday_definitions
                SET holiday_name_no = ?, holiday_name_en = ?, calculation_type = ?,
                    fixed_date = ?, easter_offset = ?
                WHERE holiday_code = ?
            ");
            $stmt->execute([$nameNo, $nameEn, $calculationType, $fixedDate, $easterOffset, $code]);
        } else {
            // Generate code from name for new entries
            $code = strtolower(preg_replace('/[^a-zA-Z0-9]/', '_', $nameNo));
            $stmt = $this->db->prepare("
                INSERT INTO holiday_definitions (holiday_code, holiday_name_no, holiday_name_en,
                    calculation_type, fixed_date, easter_offset)
                VALUES (?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([$code, $nameNo, $nameEn, $calculationType, $fixedDate, $easterOffset]);
        }

        $this->sendResponse(['success' => true, 'id' => $code]);
    }

    private function deleteHolidayDefinition($id) {
        if (empty($id)) {
            $this->sendError('Invalid ID');
        }

        $stmt = $this->db->prepare("DELETE FROM holiday_definitions WHERE holiday_code = ?");
        $stmt->execute([$id]);

        $this->sendResponse(['success' => true]);
    }

    // ====================================
    // ADMIN: WEATHER STATIONS
    // ====================================

    private function getWeatherStations() {
        $stationId = $_GET['station_id'] ?? null;

        // Query only basic columns that are guaranteed to exist
        $stmt = $this->db->query("
            SELECT station_id, station_name as name, latitude, longitude
            FROM weather_stations
            ORDER BY station_name
        ");
        $stations = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Get weather data summary (filtered by station if specified)
        if ($stationId) {
            $summaryStmt = $this->db->prepare("
                SELECT
                    MIN(DATE(timestamp)) as min_date,
                    MAX(DATE(timestamp)) as max_date,
                    COUNT(*) as record_count
                FROM weather_data
                WHERE station_id = ?
            ");
            $summaryStmt->execute([$stationId]);
        } else {
            $summaryStmt = $this->db->query("
                SELECT
                    MIN(DATE(timestamp)) as min_date,
                    MAX(DATE(timestamp)) as max_date,
                    COUNT(*) as record_count
                FROM weather_data
            ");
        }
        $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC);

        $this->sendResponse([
            'stations' => $stations,
            'summary' => $summary ?: []
        ]);
    }

    private function getWeatherYearlyAverages() {
        $stationId = $_GET['station_id'] ?? null;

        $sql = "
            SELECT
                YEAR(timestamp) as year,
                ROUND(AVG(air_temperature), 1) as avg_temp,
                ROUND(MIN(air_temperature), 1) as min_temp,
                ROUND(MAX(air_temperature), 1) as max_temp,
                ROUND(AVG(wind_speed), 1) as avg_wind,
                ROUND(AVG(humidity), 0) as avg_humidity,
                ROUND(SUM(solar_irradiance) / 1000, 0) as total_solar_kwh_m2,
                COUNT(*) as hours_count
            FROM weather_data
        ";

        $params = [];
        if ($stationId) {
            $sql .= " WHERE station_id = ?";
            $params[] = $stationId;
        }

        $sql .= " GROUP BY YEAR(timestamp) ORDER BY year";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $yearly = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $this->sendResponse([
            'yearly_averages' => $yearly
        ]);
    }

    private function getWeatherMonthlyAverages() {
        $stationId = $_GET['station_id'] ?? null;

        $sql = "
            SELECT
                MONTH(timestamp) as month,
                ROUND(AVG(air_temperature), 1) as avg_temp,
                ROUND(MIN(air_temperature), 1) as min_temp,
                ROUND(MAX(air_temperature), 1) as max_temp,
                ROUND(AVG(wind_speed), 1) as avg_wind,
                ROUND(AVG(humidity), 0) as avg_humidity,
                ROUND(AVG(solar_irradiance), 0) as avg_solar_w_m2,
                COUNT(*) as hours_count
            FROM weather_data
        ";

        $params = [];
        if ($stationId) {
            $sql .= " WHERE station_id = ?";
            $params[] = $stationId;
        }

        $sql .= " GROUP BY MONTH(timestamp) ORDER BY month";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $monthly = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Add month names
        $monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        foreach ($monthly as &$row) {
            $row['month_name'] = $monthNames[(int)$row['month']] ?? '';
        }

        $this->sendResponse([
            'monthly_averages' => $monthly
        ]);
    }

    // ====================================
    // ADMIN: USERS
    // ====================================

    private function getUsers() {
        // Simple query first to check what columns exist
        try {
            $stmt = $this->db->query("
                SELECT u.user_id, u.email,
                       COALESCE(u.name, u.email) as name,
                       COALESCE(u.is_active, 1) as is_active,
                       MAX(up.role) as role,
                       GROUP_CONCAT(DISTINCT p.project_name SEPARATOR ', ') as project_names,
                       GROUP_CONCAT(DISTINCT up.project_id) as project_ids_str
                FROM users u
                LEFT JOIN user_projects up ON u.user_id = up.user_id
                LEFT JOIN projects p ON up.project_id = p.project_id
                GROUP BY u.user_id, u.email
                ORDER BY u.email
            ");
            $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            // Fallback to simpler query if columns don't exist
            $stmt = $this->db->query("SELECT user_id, email FROM users ORDER BY email");
            $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($users as &$user) {
                $user['name'] = $user['email'];
                $user['is_active'] = 1;
                $user['role'] = 'operator';
                $user['project_names'] = '';
                $user['project_ids'] = [];
            }
            $this->sendResponse(['users' => $users]);
            return;
        }

        // Convert project_ids_str to array
        foreach ($users as &$user) {
            $user['project_ids'] = $user['project_ids_str']
                ? array_map('intval', explode(',', $user['project_ids_str']))
                : [];
            unset($user['project_ids_str']);
        }

        $this->sendResponse(['users' => $users]);
    }

    private function getProjects() {
        $stmt = $this->db->query("
            SELECT project_id, project_name
            FROM projects
            ORDER BY project_name
        ");
        $projects = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $this->sendResponse(['projects' => $projects]);
    }

    private function saveUser() {
        $input = $this->getPostInput();
        $userId = $input['user_id'] ?? null;
        $email = $input['email'] ?? '';
        $name = $input['name'] ?? '';
        $role = $input['role'] ?? 'operator';
        $projectIds = $input['project_ids'] ?? [];
        $isActive = $input['is_active'] ?? 1;
        $password = $input['password'] ?? null;

        if (empty($email)) {
            $this->sendError('Email is required');
        }

        // Validate role - only admin or operator allowed
        if (!in_array($role, ['admin', 'operator'])) {
            $role = 'operator';
        }

        if ($userId) {
            // Update existing user
            $stmt = $this->db->prepare("
                UPDATE users SET name = ?, is_active = ? WHERE user_id = ?
            ");
            $stmt->execute([$name, $isActive, $userId]);

            // Clear existing project assignments
            $stmt = $this->db->prepare("DELETE FROM user_projects WHERE user_id = ?");
            $stmt->execute([$userId]);

            // Add new project assignments
            if ($role === 'admin') {
                // Admins get access to all projects
                $allProjects = $this->db->query("SELECT project_id FROM projects")->fetchAll(PDO::FETCH_COLUMN);
                foreach ($allProjects as $projectId) {
                    $stmt = $this->db->prepare("
                        INSERT INTO user_projects (user_id, project_id, role)
                        VALUES (?, ?, ?)
                    ");
                    $stmt->execute([$userId, $projectId, $role]);
                }
            } else {
                // Operators get access to selected projects
                foreach ($projectIds as $projectId) {
                    $stmt = $this->db->prepare("
                        INSERT INTO user_projects (user_id, project_id, role)
                        VALUES (?, ?, ?)
                    ");
                    $stmt->execute([$userId, $projectId, $role]);
                }
            }
        } else {
            // Create new user
            if (empty($password)) {
                $this->sendError('Password is required for new users');
            }

            $passwordHash = password_hash($password, PASSWORD_DEFAULT);

            $stmt = $this->db->prepare("
                INSERT INTO users (email, password_hash, name, is_active)
                VALUES (?, ?, ?, ?)
            ");
            $stmt->execute([$email, $passwordHash, $name, $isActive]);
            $userId = $this->db->lastInsertId();

            // Add project assignments
            if ($role === 'admin') {
                // Admins get access to all projects
                $allProjects = $this->db->query("SELECT project_id FROM projects")->fetchAll(PDO::FETCH_COLUMN);
                foreach ($allProjects as $projectId) {
                    $stmt = $this->db->prepare("
                        INSERT INTO user_projects (user_id, project_id, role)
                        VALUES (?, ?, ?)
                    ");
                    $stmt->execute([$userId, $projectId, $role]);
                }
            } else {
                // Operators get access to selected projects
                foreach ($projectIds as $projectId) {
                    $stmt = $this->db->prepare("
                        INSERT INTO user_projects (user_id, project_id, role)
                        VALUES (?, ?, ?)
                    ");
                    $stmt->execute([$userId, $projectId, $role]);
                }
            }
        }

        $this->sendResponse(['success' => true, 'user_id' => $userId]);
    }

    // ====================================
    // PROJECT CONFIGURATION
    // ====================================

    private function getProjectConfigs() {
        try {
            // Try with config_json column first
            $query = "SELECT template_id, template_name as name, config_json, created_at, updated_at
                      FROM config_templates";
            $query = $this->addSiteFilter($query);
            $query .= " ORDER BY template_name";

            $params = [];
            $this->bindSiteParam($params);

            if ($params) {
                $stmt = $this->db->prepare($query);
                $stmt->execute($params);
                $configs = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } else {
                $configs = $this->db->query($query)->fetchAll(PDO::FETCH_ASSOC);
            }

            // Decode JSON
            foreach ($configs as &$config) {
                $config['config'] = json_decode($config['config_json'] ?? '{}', true);
                unset($config['config_json']);
            }

            $this->sendResponse(['configs' => $configs]);
        } catch (PDOException $e) {
            // Fallback: config_json column might not exist
            try {
                $query = "SELECT template_id, template_name as name, created_at, updated_at
                          FROM config_templates";
                $query = $this->addSiteFilter($query);
                $query .= " ORDER BY template_name";

                $params = [];
                $this->bindSiteParam($params);

                if ($params) {
                    $stmt = $this->db->prepare($query);
                    $stmt->execute($params);
                    $configs = $stmt->fetchAll(PDO::FETCH_ASSOC);
                } else {
                    $configs = $this->db->query($query)->fetchAll(PDO::FETCH_ASSOC);
                }

                // No config_json column - return empty config
                foreach ($configs as &$config) {
                    $config['config'] = [];
                }

                $this->sendResponse(['configs' => $configs, 'note' => 'config_json column not found - run migration']);
            } catch (PDOException $e2) {
                $this->sendError('Failed to load configs: ' . $e2->getMessage());
            }
        }
    }

    private function getProjectConfig($configId) {
        if (!$this->validateId($configId)) {
            $this->sendError('Invalid config ID');
        }

        try {
            $stmt = $this->db->prepare("
                SELECT template_id, template_name as name, config_json
                FROM config_templates
                WHERE template_id = ?
            ");
            $stmt->execute([$configId]);
            $config = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$config) {
                $this->sendError('Configuration not found', 404);
            }

            $config['config'] = json_decode($config['config_json'] ?? '{}', true);
            unset($config['config_json']);

            $this->sendResponse(['config' => $config]);
        } catch (PDOException $e) {
            // Fallback without config_json
            $stmt = $this->db->prepare("
                SELECT template_id, template_name as name
                FROM config_templates
                WHERE template_id = ?
            ");
            $stmt->execute([$configId]);
            $config = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$config) {
                $this->sendError('Configuration not found', 404);
            }

            $config['config'] = [];
            $this->sendResponse(['config' => $config, 'note' => 'config_json column not found']);
        }
    }

    private function saveProjectConfig() {
        $input = $this->getPostInput();
        $configId = $input['config_id'] ?? null;
        $name = $input['name'] ?? '';
        $configData = $input['config'] ?? [];

        if (empty($name)) {
            $this->sendError('Name is required');
        }

        $configJson = json_encode($configData);

        // Check if config_json column exists
        $hasConfigJson = $this->columnExists('config_templates', 'config_json');

        if ($configId) {
            // Update existing
            if ($hasConfigJson) {
                $stmt = $this->db->prepare("
                    UPDATE config_templates
                    SET template_name = ?, config_json = ?, updated_at = NOW()
                    WHERE template_id = ?
                ");
                $stmt->execute([$name, $configJson, $configId]);
            } else {
                $stmt = $this->db->prepare("
                    UPDATE config_templates
                    SET template_name = ?, updated_at = NOW()
                    WHERE template_id = ?
                ");
                $stmt->execute([$name, $configId]);
            }
        } else {
            // Insert new
            if ($hasConfigJson) {
                $stmt = $this->db->prepare("
                    INSERT INTO config_templates (site_id, template_name, config_json)
                    VALUES (?, ?, ?)
                ");
                $stmt->execute([$this->siteId, $name, $configJson]);
            } else {
                $stmt = $this->db->prepare("
                    INSERT INTO config_templates (site_id, template_name)
                    VALUES (?, ?)
                ");
                $stmt->execute([$this->siteId, $name]);
            }
            $configId = $this->db->lastInsertId();
        }

        $response = ['success' => true, 'config_id' => $configId];
        if (!$hasConfigJson) {
            $response['warning'] = 'config_json column missing - run: ALTER TABLE config_templates ADD COLUMN config_json JSON;';
        }
        $this->sendResponse($response);
    }

    private function deleteProjectConfig($configId) {
        if (!$this->validateId($configId)) {
            $this->sendError('Invalid config ID');
        }

        $stmt = $this->db->prepare("DELETE FROM config_templates WHERE template_id = ?");
        $stmt->execute([$configId]);

        $this->sendResponse(['success' => true]);
    }

    // ====================================
    // UTILITY METHODS
    // ====================================

    private function getPostInput() {
        // Return stored POST input (already parsed in handle())
        return $this->postInput ?? [];
    }

    private function validateId($id) {
        return is_numeric($id) && $id > 0;
    }
    
    private function sendResponse($data) {
        echo json_encode($data);
        exit;
    }
    
    private function sendError($message, $code = 400) {
        http_response_code($code);
        echo json_encode(['error' => $message]);
        exit;
    }

    private function columnExists($table, $column) {
        try {
            $stmt = $this->db->prepare("
                SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND COLUMN_NAME = ?
            ");
            $stmt->execute([$table, $column]);
            return $stmt->fetchColumn() > 0;
        } catch (PDOException $e) {
            return false;
        }
    }
}

// Initialize and handle request
try {
    $api = new HeatAQAPI($currentSiteId ?? null, $auth ?? null);
    $api->handle();
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => Config::isDebug() ? $e->getMessage() : 'System error']);
}
