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
        // Support both string site_id (legacy) and integer pool_site_id (new)
        $currentSiteId = $auth['project']['site_id'];
        $currentPoolSiteId = $auth['project']['pool_site_id'] ?? null;
    }
} else {
    // If auth not required, get site from user preference (cookie/session)
    // NEVER hardcode default values - get from user's last choice
    $currentSiteId = null;
    $currentPoolSiteId = null;

    // Try to get from cookie (set by frontend)
    if (isset($_COOKIE['heataq_site_id']) && !empty($_COOKIE['heataq_site_id'])) {
        $currentSiteId = $_COOKIE['heataq_site_id'];
    }

    // Validate site exists in database if we have one
    if ($currentSiteId) {
        try {
            $db = Config::getDatabase();
            $stmt = $db->prepare("SELECT site_id FROM pool_sites WHERE site_id = ? LIMIT 1");
            $stmt->execute([$currentSiteId]);
            if (!$stmt->fetch()) {
                // Site not found in DB, clear it
                $currentSiteId = null;
            }
        } catch (Exception $e) {
            // DB error, continue without site
            $currentSiteId = null;
        }
    }

    // If still no site, get first available from database
    if (!$currentSiteId) {
        try {
            $db = Config::getDatabase();
            $stmt = $db->query("SELECT site_id FROM pool_sites ORDER BY id LIMIT 1");
            $row = $stmt->fetch();
            if ($row) {
                $currentSiteId = $row['site_id'];
            }
        } catch (Exception $e) {
            // No sites available
        }
    }
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
                case 'diagnose_site_ids':
                    $this->diagnoseSiteIds();
                    break;
                case 'fix_site_ids':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->fixSiteIds();
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

                // ADMIN: Users (admin-only operations)
                case 'get_users':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->getUsers();
                    break;

                case 'save_user':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->saveUser();
                    break;

                case 'get_current_user':
                    $this->getCurrentUser();
                    break;

                case 'get_projects':
                    $this->getProjects();
                    break;

                case 'update_project':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->updateProject();
                    break;

                case 'create_project':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->createProject();
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

                // Solar data endpoints
                case 'get_solar_status':
                    $this->getSolarStatus();
                    break;

                case 'get_site_location':
                    $this->getSiteLocation();
                    break;

                case 'save_site_location':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveSiteLocation();
                    break;

                case 'fetch_nasa_solar':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->fetchNasaSolar();
                    break;

                // User preferences (syncs across devices)
                case 'get_preferences':
                    $this->getUserPreferences();
                    break;
                case 'save_preference':
                    $this->saveUserPreference();
                    break;

                // DEPLOYMENT (admin only)
                case 'deploy_status':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->deployStatus();
                    break;
                case 'deploy_pull':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->deployPull();
                    break;

                case 'merge_branch':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->mergeBranch();
                    break;
                case 'deploy_push':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->deployPush();
                    break;

                // DATABASE MIGRATIONS (admin only)
                case 'check_migrations':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->checkMigrations();
                    break;
                case 'run_migration':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->runMigration();
                    break;
                case 'archive_migration':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->archiveMigration();
                    break;
                case 'export_schema':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied - admin only', 403);
                    }
                    $this->exportSchema();
                    break;

                // SITE AND POOL MANAGEMENT
                case 'get_project_site':
                    $this->getProjectSite();
                    break;

                case 'get_sites':
                    $this->getSites();
                    break;

                case 'save_site':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveSiteData();
                    break;

                case 'get_pools':
                    $this->getPools();
                    break;

                case 'get_pool':
                    $this->getPool($_GET['pool_id'] ?? 0);
                    break;

                case 'save_pool':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->savePool();
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
        $currentYear = (int)date('Y');
        $referenceDays = [];

        // Calculate Easter for years around current year
        for ($year = $currentYear - 1; $year <= $currentYear + 5; $year++) {
            $easterDate = $this->calculateEaster($year);
            $referenceDays[] = [
                'year' => $year,
                'easter_date' => $easterDate
            ];
        }

        $this->sendResponse(['reference_days' => $referenceDays]);
    }

    private function calculateEaster($year) {
        // Anonymous Gregorian algorithm
        $a = $year % 19;
        $b = intdiv($year, 100);
        $c = $year % 100;
        $d = intdiv($b, 4);
        $e = $b % 4;
        $f = intdiv($b + 8, 25);
        $g = intdiv($b - $f + 1, 3);
        $h = (19 * $a + $b - $d - $g + 15) % 30;
        $i = intdiv($c, 4);
        $k = $c % 4;
        $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
        $m = intdiv($a + 11 * $h + 22 * $l, 451);
        $month = intdiv($h + $l - 7 * $m + 114, 31);
        $day = (($h + $l - 7 * $m + 114) % 31) + 1;

        return sprintf('%04d-%02d-%02d', $year, $month, $day);
    }
    
    private function testResolution() {
        $date = $_GET['date'] ?? date('Y-m-d');
        $templateId = $_GET['template_id'] ?? 1;

        // Get template info
        $stmt = $this->db->prepare("
            SELECT st.*, ws.name as base_week_name
            FROM schedule_templates st
            LEFT JOIN week_schedules ws ON st.base_week_schedule_id = ws.week_schedule_id
            WHERE st.template_id = ?
        ");
        $stmt->execute([$templateId]);
        $template = $stmt->fetch();

        // Check if date matches any exception day
        $dateObj = new DateTime($date);
        $month = (int)$dateObj->format('n');
        $day = (int)$dateObj->format('j');

        $stmt = $this->db->prepare("
            SELECT ce.*, ds.name as day_schedule_name
            FROM calendar_exceptions ce
            LEFT JOIN day_schedules ds ON ce.day_schedule_id = ds.day_schedule_id
            WHERE ce.schedule_template_id = ?
            AND ((ce.fixed_month = ? AND ce.fixed_day = ?) OR ce.is_moving = 1)
        ");
        $stmt->execute([$templateId, $month, $day]);
        $exceptions = $stmt->fetchAll();

        // Check if date matches any date range
        $stmt = $this->db->prepare("
            SELECT cr.*, ws.name as week_schedule_name
            FROM calendar_date_ranges cr
            LEFT JOIN week_schedules ws ON cr.week_schedule_id = ws.week_schedule_id
            WHERE cr.schedule_template_id = ? AND cr.is_active = 1
        ");
        $stmt->execute([$templateId]);
        $dateRanges = $stmt->fetchAll();

        // Determine which rules apply
        $matchingRanges = [];
        foreach ($dateRanges as $range) {
            $fromMD = [$range['start_month'], $range['start_day']];
            $toMD = [$range['end_month'], $range['end_day']];
            $currentMD = [$month, $day];

            $matches = ($fromMD <= $toMD)
                ? ($currentMD >= $fromMD && $currentMD <= $toMD)
                : ($currentMD >= $fromMD || $currentMD <= $toMD);

            if ($matches) {
                $matchingRanges[] = $range;
            }
        }

        $this->sendResponse([
            'date' => $date,
            'day_of_week' => $dateObj->format('l'),
            'template' => [
                'id' => $template['template_id'] ?? null,
                'name' => $template['name'] ?? null,
                'base_week_schedule_id' => $template['base_week_schedule_id'] ?? null,
                'base_week_name' => $template['base_week_name'] ?? 'NOT SET - THIS IS THE PROBLEM!'
            ],
            'matching_exceptions' => $exceptions,
            'matching_date_ranges' => $matchingRanges,
            'all_date_ranges' => $dateRanges
        ]);
    }

    /**
     * Diagnose site_id mismatches between auth and schedule tables
     */
    private function diagnoseSiteIds() {
        $currentSiteId = $this->siteId;

        // Get all unique site_ids from schedule tables
        $tables = [
            'schedule_templates' => 'site_id',
            'day_schedules' => 'site_id',
            'week_schedules' => 'site_id',
        ];

        $results = [
            'current_site_id' => $currentSiteId,
            'tables' => []
        ];

        foreach ($tables as $table => $column) {
            $stmt = $this->db->query("SELECT DISTINCT $column as site_id, COUNT(*) as count FROM $table GROUP BY $column");
            $rows = $stmt->fetchAll();
            $results['tables'][$table] = $rows;
        }

        // Check for mismatches
        $mismatches = [];
        foreach ($results['tables'] as $table => $siteIds) {
            foreach ($siteIds as $row) {
                if ($row['site_id'] !== $currentSiteId) {
                    $mismatches[] = [
                        'table' => $table,
                        'has_site_id' => $row['site_id'],
                        'expected_site_id' => $currentSiteId,
                        'record_count' => $row['count']
                    ];
                }
            }
        }

        $results['mismatches'] = $mismatches;
        $results['has_mismatches'] = !empty($mismatches);

        $this->sendResponse($results);
    }

    /**
     * Fix site_id mismatches - update old site_id to current
     */
    private function fixSiteIds() {
        $input = $this->getPostInput();
        $oldSiteId = $input['old_site_id'] ?? null;
        $newSiteId = $input['new_site_id'] ?? $this->siteId;

        if (!$oldSiteId) {
            $this->sendError('old_site_id is required');
        }

        $tables = ['schedule_templates', 'day_schedules', 'week_schedules'];
        $results = [];

        foreach ($tables as $table) {
            $stmt = $this->db->prepare("UPDATE $table SET site_id = ? WHERE site_id = ?");
            $stmt->execute([$newSiteId, $oldSiteId]);
            $results[$table] = $stmt->rowCount();
        }

        $this->sendResponse([
            'success' => true,
            'old_site_id' => $oldSiteId,
            'new_site_id' => $newSiteId,
            'updated_rows' => $results
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

        try {
            $stmt = $this->db->prepare("DELETE FROM holiday_definitions WHERE holiday_code = ?");
            $stmt->execute([$id]);
            $this->sendResponse(['success' => true]);
        } catch (PDOException $e) {
            $this->sendError($e->getMessage());
        }
    }

    // ====================================
    // ADMIN: WEATHER STATIONS
    // ====================================

    private function getWeatherStations() {
        $stationId = $_GET['station_id'] ?? null;

        try {
            // Query only basic columns that are guaranteed to exist
            $stmt = $this->db->query("
                SELECT station_id, station_name as name, latitude, longitude
                FROM weather_stations
                ORDER BY station_name
            ");
            $stations = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            // Try alternative column name
            try {
                $stmt = $this->db->query("
                    SELECT station_id, name, latitude, longitude
                    FROM weather_stations
                    ORDER BY name
                ");
                $stations = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (PDOException $e2) {
                $this->sendResponse([
                    'stations' => [],
                    'summary' => [],
                    'error' => $e2->getMessage()
                ]);
                return;
            }
        }

        // Return stations only - skip slow summary query
        $this->sendResponse([
            'stations' => $stations
        ]);
    }

    private function getWeatherYearlyAverages() {
        $stationId = $_GET['station_id'] ?? null;

        $sql = "
            SELECT
                YEAR(timestamp) as year,
                ROUND(AVG(temperature), 1) as avg_temp,
                ROUND(MIN(temperature), 1) as min_temp,
                ROUND(MAX(temperature), 1) as max_temp,
                ROUND(AVG(wind_speed), 1) as avg_wind,
                ROUND(AVG(humidity), 0) as avg_humidity,
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
                ROUND(AVG(temperature), 1) as avg_temp,
                ROUND(MIN(temperature), 1) as min_temp,
                ROUND(MAX(temperature), 1) as max_temp,
                ROUND(AVG(wind_speed), 1) as avg_wind,
                ROUND(AVG(humidity), 0) as avg_humidity,
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

    /**
     * Get current user info including role (for frontend role-based UI)
     */
    private function getCurrentUser() {
        if (!$this->userId) {
            $this->sendResponse(['user' => null]);
            return;
        }

        $this->sendResponse([
            'user' => [
                'user_id' => $this->userId,
                'project_id' => $this->projectId,
                'role' => $this->userRole,
                'is_admin' => in_array($this->userRole, ['admin', 'owner'])
            ]
        ]);
    }

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

    private function updateProject() {
        $input = $this->getPostInput();
        $projectId = $input['project_id'] ?? null;
        $name = $input['name'] ?? null;
        $description = $input['description'] ?? null;

        // If no project ID provided, use the current project from auth
        if (!$projectId && $this->projectId) {
            $projectId = $this->projectId;
        }

        if (!$projectId) {
            $this->sendError('Project ID is required');
        }

        // Build update query dynamically based on what's provided
        $updates = [];
        $params = [];

        if ($name !== null) {
            $updates[] = "project_name = ?";
            $params[] = $name;
        }

        if ($description !== null) {
            $updates[] = "description = ?";
            $params[] = $description;
        }

        if (empty($updates)) {
            $this->sendError('No fields to update');
        }

        $params[] = $projectId;
        $sql = "UPDATE projects SET " . implode(', ', $updates) . " WHERE project_id = ?";

        try {
            $stmt = $this->db->prepare($sql);
            $stmt->execute($params);

            $this->sendResponse(['success' => true, 'project_id' => $projectId]);
        } catch (PDOException $e) {
            $this->sendError('Failed to update project: ' . $e->getMessage());
        }
    }

    private function createProject() {
        $input = $this->getPostInput();
        $name = $input['name'] ?? null;
        $description = $input['description'] ?? '';

        if (!$name) {
            $this->sendError('Project name is required');
        }

        try {
            $stmt = $this->db->prepare("
                INSERT INTO projects (project_name, description, is_active, created_at)
                VALUES (?, ?, 1, NOW())
            ");
            $stmt->execute([$name, $description]);
            $projectId = $this->db->lastInsertId();

            $this->sendResponse(['success' => true, 'id' => $projectId, 'name' => $name]);
        } catch (PDOException $e) {
            $this->sendError('Failed to create project: ' . $e->getMessage());
        }
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

            // force_password_change = 1 so user must change password on first login
            $stmt = $this->db->prepare("
                INSERT INTO users (email, password_hash, name, is_active, force_password_change)
                VALUES (?, ?, ?, ?, 1)
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
            // Include legacy columns to merge with json_config
            if ($this->projectId) {
                $query = "SELECT template_id, template_name as name, json_config, created_at,
                                 hp_capacity_kw, boiler_capacity_kw, target_temp, control_strategy
                          FROM config_templates
                          WHERE project_id = :project_id
                          ORDER BY template_name";
                $stmt = $this->db->prepare($query);
                $stmt->execute([':project_id' => $this->projectId]);
            } else {
                $query = "SELECT template_id, template_name as name, json_config, created_at,
                                 hp_capacity_kw, boiler_capacity_kw, target_temp, control_strategy
                          FROM config_templates
                          ORDER BY template_name";
                $stmt = $this->db->query($query);
            }
            $configs = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Decode JSON and merge with legacy columns (legacy columns override)
            foreach ($configs as &$config) {
                $jsonConfig = json_decode($config['json_config'] ?? '{}', true) ?: [];

                // Ensure nested arrays exist
                if (!isset($jsonConfig['equipment'])) $jsonConfig['equipment'] = [];
                if (!isset($jsonConfig['control'])) $jsonConfig['control'] = [];

                // Override with legacy column values if set
                if ($config['hp_capacity_kw'] !== null) {
                    $jsonConfig['equipment']['hp_capacity_kw'] = (float)$config['hp_capacity_kw'];
                }
                if ($config['boiler_capacity_kw'] !== null) {
                    $jsonConfig['equipment']['boiler_capacity_kw'] = (float)$config['boiler_capacity_kw'];
                }
                if ($config['target_temp'] !== null) {
                    $jsonConfig['control']['target_temp'] = (float)$config['target_temp'];
                }
                if ($config['control_strategy'] !== null) {
                    $jsonConfig['control']['strategy'] = $config['control_strategy'];
                }

                $config['config'] = $jsonConfig;
                unset($config['json_config'], $config['hp_capacity_kw'], $config['boiler_capacity_kw'],
                      $config['target_temp'], $config['control_strategy']);
            }

            $this->sendResponse(['configs' => $configs]);
        } catch (PDOException $e) {
            // Fallback: json_config column might not exist
            try {
                if ($this->projectId) {
                    $query = "SELECT template_id, template_name as name, created_at
                              FROM config_templates
                              WHERE project_id = :project_id
                              ORDER BY template_name";
                    $stmt = $this->db->prepare($query);
                    $stmt->execute([':project_id' => $this->projectId]);
                } else {
                    $query = "SELECT template_id, template_name as name, created_at
                              FROM config_templates
                              ORDER BY template_name";
                    $stmt = $this->db->query($query);
                }
                $configs = $stmt->fetchAll(PDO::FETCH_ASSOC);

                // No json_config column - return empty config
                foreach ($configs as &$config) {
                    $config['config'] = [];
                }

                $this->sendResponse(['configs' => $configs, 'debug_project_id' => $this->projectId, 'note' => 'json_config column not found']);
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
                SELECT template_id, template_name as name, json_config
                FROM config_templates
                WHERE template_id = ?
            ");
            $stmt->execute([$configId]);
            $config = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$config) {
                $this->sendError('Configuration not found', 404);
            }

            $config['config'] = json_decode($config['json_config'] ?? '{}', true);
            unset($config['json_config']);

            $this->sendResponse(['config' => $config]);
        } catch (PDOException $e) {
            // Fallback without json_config
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
            $this->sendResponse(['config' => $config, 'note' => 'json_config column not found']);
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

        // Extract individual values from config for legacy columns
        $hpCapacity = $configData['equipment']['hp_capacity_kw'] ?? null;
        $boilerCapacity = $configData['equipment']['boiler_capacity_kw'] ?? null;
        $targetTemp = $configData['control']['target_temp'] ?? null;
        $controlStrategy = $configData['control']['strategy'] ?? null;

        // Check if columns exist
        $hasConfigJson = $this->columnExists('config_templates', 'json_config');
        $hasUpdatedAt = $this->columnExists('config_templates', 'updated_at');

        // Get current user for audit
        $updatedBy = $this->userId ?? 'system';

        if ($configId) {
            // Update existing - include legacy columns
            if ($hasConfigJson && $hasUpdatedAt) {
                $stmt = $this->db->prepare("
                    UPDATE config_templates
                    SET template_name = ?, json_config = ?,
                        hp_capacity_kw = ?, boiler_capacity_kw = ?, target_temp = ?, control_strategy = ?,
                        updated_at = NOW(), updated_by = ?
                    WHERE template_id = ?
                ");
                $stmt->execute([$name, $configJson, $hpCapacity, $boilerCapacity, $targetTemp, $controlStrategy, $updatedBy, $configId]);
            } elseif ($hasConfigJson) {
                $stmt = $this->db->prepare("
                    UPDATE config_templates
                    SET template_name = ?, json_config = ?,
                        hp_capacity_kw = ?, boiler_capacity_kw = ?, target_temp = ?, control_strategy = ?
                    WHERE template_id = ?
                ");
                $stmt->execute([$name, $configJson, $hpCapacity, $boilerCapacity, $targetTemp, $controlStrategy, $configId]);
            } else {
                $stmt = $this->db->prepare("
                    UPDATE config_templates
                    SET template_name = ?,
                        hp_capacity_kw = ?, boiler_capacity_kw = ?, target_temp = ?, control_strategy = ?
                    WHERE template_id = ?
                ");
                $stmt->execute([$name, $hpCapacity, $boilerCapacity, $targetTemp, $controlStrategy, $configId]);
            }
        } else {
            // Insert new
            if ($hasConfigJson) {
                $stmt = $this->db->prepare("
                    INSERT INTO config_templates (project_id, template_name, json_config, hp_capacity_kw, boiler_capacity_kw, target_temp, control_strategy)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([$this->projectId, $name, $configJson, $hpCapacity, $boilerCapacity, $targetTemp, $controlStrategy]);
            } else {
                $stmt = $this->db->prepare("
                    INSERT INTO config_templates (project_id, template_name, hp_capacity_kw, boiler_capacity_kw, target_temp, control_strategy)
                    VALUES (?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([$this->projectId, $name, $hpCapacity, $boilerCapacity, $targetTemp, $controlStrategy]);
            }
            $configId = $this->db->lastInsertId();
        }

        $response = ['success' => true, 'config_id' => $configId];
        if (!$hasConfigJson) {
            $response['warning'] = 'json_config column missing - run: ALTER TABLE config_templates ADD COLUMN json_config JSON;';
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
    // SOLAR DATA METHODS
    // ====================================

    private function getSolarStatus() {
        // Check if site_solar_hourly table exists
        $tableExists = $this->columnExists('site_solar_hourly', 'site_id');

        if (!$tableExists) {
            $this->sendResponse([
                'status' => 'not_configured',
                'message' => 'Solar hourly data table not yet created. Run migration first.',
                'has_data' => false
            ]);
            return;
        }

        // Get solar data range for this site
        $stmt = $this->db->prepare("
            SELECT
                MIN(timestamp) as data_start,
                MAX(timestamp) as data_end,
                COUNT(*) as hour_count,
                COUNT(DISTINCT DATE(timestamp)) as day_count
            FROM site_solar_hourly
            WHERE site_id = ?
        ");
        $stmt->execute([$this->siteId]);
        $stats = $stmt->fetch();

        // Get site location
        $locStmt = $this->db->prepare("
            SELECT solar_latitude, solar_longitude, solar_data_start, solar_data_end
            FROM pool_sites
            WHERE site_id = ?
        ");
        $locStmt->execute([$this->siteId]);
        $location = $locStmt->fetch();

        $this->sendResponse([
            'status' => $stats['hour_count'] > 0 ? 'configured' : 'no_data',
            'has_data' => $stats['hour_count'] > 0,
            'data_start' => $stats['data_start'],
            'data_end' => $stats['data_end'],
            'hour_count' => (int) $stats['hour_count'],
            'day_count' => (int) $stats['day_count'],
            'location' => [
                'latitude' => $location['solar_latitude'] ?? null,
                'longitude' => $location['solar_longitude'] ?? null
            ]
        ]);
    }

    private function getSiteLocation() {
        $stmt = $this->db->prepare("
            SELECT site_id, name as site_name, latitude, longitude,
                   solar_latitude, solar_longitude, solar_data_start, solar_data_end
            FROM pool_sites
            WHERE site_id = ?
        ");
        $stmt->execute([$this->siteId]);
        $site = $stmt->fetch();

        if (!$site) {
            $this->sendError('Site not found', 404);
        }

        $this->sendResponse([
            'site_id' => $site['site_id'],
            'site_name' => $site['site_name'],
            'latitude' => $site['latitude'] ?? $site['solar_latitude'],
            'longitude' => $site['longitude'] ?? $site['solar_longitude'],
            'solar_latitude' => $site['solar_latitude'],
            'solar_longitude' => $site['solar_longitude'],
            'solar_data_start' => $site['solar_data_start'],
            'solar_data_end' => $site['solar_data_end']
        ]);
    }

    private function saveSiteLocation() {
        $input = $this->getPostInput();
        $latitude = $input['latitude'] ?? null;
        $longitude = $input['longitude'] ?? null;

        if ($latitude === null || $longitude === null) {
            $this->sendError('latitude and longitude are required');
        }

        $lat = (float) $latitude;
        $lon = (float) $longitude;

        if ($lat < -90 || $lat > 90) {
            $this->sendError('latitude must be between -90 and 90');
        }
        if ($lon < -180 || $lon > 180) {
            $this->sendError('longitude must be between -180 and 180');
        }

        $stmt = $this->db->prepare("
            UPDATE pool_sites
            SET solar_latitude = ?, solar_longitude = ?
            WHERE site_id = ?
        ");
        $stmt->execute([$lat, $lon, $this->siteId]);

        $this->sendResponse(['success' => true, 'latitude' => $lat, 'longitude' => $lon]);
    }

    private function fetchNasaSolar() {
        $input = $this->getPostInput();
        $startYear = $input['start_year'] ?? date('Y') - 10;
        $endYear = $input['end_year'] ?? date('Y') - 1;
        $latitude = $input['latitude'] ?? null;
        $longitude = $input['longitude'] ?? null;

        // If location not provided, get from site
        if ($latitude === null || $longitude === null) {
            $stmt = $this->db->prepare("
                SELECT solar_latitude, solar_longitude, latitude, longitude
                FROM pool_sites WHERE site_id = ?
            ");
            $stmt->execute([$this->siteId]);
            $site = $stmt->fetch();

            $latitude = $site['solar_latitude'] ?? $site['latitude'] ?? null;
            $longitude = $site['solar_longitude'] ?? $site['longitude'] ?? null;

            if ($latitude === null || $longitude === null) {
                $this->sendError('Site location not configured. Set latitude/longitude first.');
            }
        }

        // Include the NASA fetcher
        require_once __DIR__ . '/../lib/NasaSolarFetcher.php';

        try {
            $fetcher = new NasaSolarFetcher($this->db, $this->siteId);
            $result = $fetcher->fetchAndStore(
                (float) $latitude,
                (float) $longitude,
                (string) $startYear,
                (string) $endYear
            );

            $this->sendResponse($result);

        } catch (Exception $e) {
            $this->sendError('Failed to fetch NASA solar data: ' . $e->getMessage());
        }
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

    // ====================================
    // USER PREFERENCES (sync across devices)
    // ====================================

    private function getUserPreferences() {
        if (!$this->userId) {
            // Not authenticated - return empty preferences
            $this->sendResponse(['preferences' => []]);
            return;
        }

        try {
            // Check if table exists
            if (!$this->tableExists('user_preferences')) {
                $this->sendResponse(['preferences' => [], 'note' => 'preferences table not yet created']);
                return;
            }

            $stmt = $this->db->prepare("
                SELECT pref_key, pref_value
                FROM user_preferences
                WHERE user_id = ?
            ");
            $stmt->execute([$this->userId]);
            $rows = $stmt->fetchAll();

            $preferences = [];
            foreach ($rows as $row) {
                $preferences[$row['pref_key']] = $row['pref_value'];
            }

            $this->sendResponse(['preferences' => $preferences]);
        } catch (PDOException $e) {
            $this->sendResponse(['preferences' => [], 'error' => 'Failed to load preferences']);
        }
    }

    private function saveUserPreference() {
        if (!$this->userId) {
            $this->sendError('Authentication required to save preferences', 401);
            return;
        }

        $input = $this->getPostInput();
        $key = $input['key'] ?? null;
        $value = $input['value'] ?? null;

        if (!$key) {
            $this->sendError('Preference key required');
            return;
        }

        // Validate key (only allow known preference keys)
        $allowedKeys = [
            'selected_config',
            'selected_ohc',
            'selected_tab',
            'selected_site',
            'selected_pool',
            'sim_overrides',      // JSON: override values for simulation
            'sim_sub_tab',        // Current sub-tab in Simulate
            'last_scenario_name'  // Last used scenario name
        ];
        if (!in_array($key, $allowedKeys)) {
            $this->sendError('Invalid preference key: ' . $key);
            return;
        }

        // For sim_overrides, ensure value is valid JSON if provided
        if ($key === 'sim_overrides' && $value !== null && $value !== '') {
            $decoded = json_decode($value, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                $this->sendError('sim_overrides must be valid JSON');
                return;
            }
        }

        try {
            // Check if table exists, create if not
            if (!$this->tableExists('user_preferences')) {
                $this->db->exec("
                    CREATE TABLE IF NOT EXISTS user_preferences (
                        user_id INT NOT NULL,
                        pref_key VARCHAR(50) NOT NULL,
                        pref_value TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (user_id, pref_key)
                    )
                ");
            }

            // Upsert preference
            $stmt = $this->db->prepare("
                INSERT INTO user_preferences (user_id, pref_key, pref_value)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE pref_value = VALUES(pref_value)
            ");
            $stmt->execute([$this->userId, $key, $value]);

            $this->sendResponse(['success' => true]);
        } catch (PDOException $e) {
            $this->sendError('Failed to save preference: ' . $e->getMessage());
        }
    }

    private function tableExists($table) {
        try {
            $stmt = $this->db->prepare("
                SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
            ");
            $stmt->execute([$table]);
            return $stmt->fetchColumn() > 0;
        } catch (PDOException $e) {
            return false;
        }
    }

    // ====================================
    // DEPLOYMENT METHODS
    // ====================================

    private function deployStatus() {
        $repoRoot = realpath(__DIR__ . '/..');
        $oldDir = getcwd();
        chdir($repoRoot);

        $result = [
            'repo_root' => $repoRoot,
            'branch' => trim(shell_exec('git branch --show-current 2>&1')),
            'head' => trim(shell_exec('git rev-parse HEAD 2>&1')),
            'head_short' => trim(shell_exec('git rev-parse --short HEAD 2>&1')),
            'status' => shell_exec('git status --porcelain 2>&1'),
            'last_commits' => array_filter(explode("\n", shell_exec('git log --oneline -5 2>&1'))),
            'remote_url' => trim(shell_exec('git remote get-url origin 2>&1')),
        ];

        // Check for updates (prune removes references to deleted remote branches)
        shell_exec('git fetch --all --prune 2>&1');
        $behind = trim(shell_exec('git rev-list HEAD..origin/master --count 2>&1'));
        $ahead = trim(shell_exec('git rev-list origin/master..HEAD --count 2>&1'));
        $result['behind_origin'] = is_numeric($behind) ? (int)$behind : 0;
        $result['ahead_origin'] = is_numeric($ahead) ? (int)$ahead : 0;

        // Get remote branches (for merge dropdown)
        $branchesRaw = shell_exec('git branch -r 2>&1');
        $branches = [];
        foreach (explode("\n", $branchesRaw) as $b) {
            $b = trim($b);
            // Filter to only claude/ branches, skip HEAD pointer
            if (strpos($b, 'origin/claude/') === 0) {
                $branches[] = str_replace('origin/', '', $b);
            }
        }
        // Sort reverse so newest branch is first (default selection)
        rsort($branches);
        $result['remote_branches'] = $branches;

        // Get app version from index.html
        $indexPath = $repoRoot . '/index.html';
        if (file_exists($indexPath)) {
            $index = file_get_contents($indexPath);
            if (preg_match('/App Version<\/strong><\/td><td>(V\d+)/', $index, $m)) {
                $result['app_version'] = $m[1];
            }
        }

        // Untracked files (potential push candidates)
        $untracked = array_filter(explode("\n", shell_exec('git ls-files --others --exclude-standard 2>&1')));
        $result['untracked_files'] = $untracked;

        // Modified files
        $modified = array_filter(explode("\n", shell_exec('git diff --name-only 2>&1')));
        $result['modified_files'] = $modified;

        chdir($oldDir);
        $this->sendResponse($result);
    }

    private function deployPull() {
        $repoRoot = realpath(__DIR__ . '/..');
        $oldDir = getcwd();
        chdir($repoRoot);

        $log = [];
        $log[] = "Working dir: $repoRoot";

        // Stash any local changes
        $log[] = "Stashing local changes...";
        $log[] = shell_exec('git stash 2>&1');

        // Fetch from origin
        $log[] = "Fetching from origin...";
        $log[] = shell_exec('git fetch origin master 2>&1');

        // Checkout master if not on it
        $branch = trim(shell_exec('git branch --show-current 2>&1'));
        if ($branch !== 'master') {
            $log[] = "Switching to master (was on $branch)...";
            $log[] = shell_exec('git checkout master 2>&1');
        }

        // Reset to origin/master
        $log[] = "Resetting to origin/master...";
        $log[] = shell_exec('git reset --hard origin/master 2>&1');

        // Get new version
        $newHead = trim(shell_exec('git rev-parse --short HEAD 2>&1'));
        $log[] = "Now at: $newHead";

        // Get app version
        $appVersion = 'unknown';
        $indexPath = $repoRoot . '/index.html';
        if (file_exists($indexPath)) {
            $index = file_get_contents($indexPath);
            if (preg_match('/App Version<\/strong><\/td><td>(V\d+)/', $index, $m)) {
                $appVersion = $m[1];
            }
        }
        $log[] = "App version: $appVersion";

        chdir($oldDir);
        $this->sendResponse([
            'success' => true,
            'app_version' => $appVersion,
            'head' => $newHead,
            'log' => $log
        ]);
    }

    /**
     * Merge a remote branch into master and deploy
     */
    private function mergeBranch() {
        $input = $this->getPostInput();
        $branch = $input['branch'] ?? null;

        if (!$branch) {
            $this->sendError('Branch name required');
            return;
        }

        // Security: only allow claude/ branches
        if (strpos($branch, 'claude/') !== 0) {
            $this->sendError('Only claude/* branches can be merged');
            return;
        }

        $repoRoot = realpath(__DIR__ . '/..');
        $oldDir = getcwd();
        chdir($repoRoot);

        $log = [];
        $log[] = "Merging branch: $branch";

        // Fetch all branches with prune to remove stale refs
        $log[] = "Fetching all branches...";
        $log[] = trim(shell_exec('git fetch --all --prune 2>&1'));

        // Pull latest from the selected branch (update remote tracking)
        $log[] = "Pulling latest from $branch...";
        $pullBranchOutput = shell_exec("git fetch origin $branch 2>&1");
        $log[] = trim($pullBranchOutput);

        // Ensure we're on master
        $currentBranch = trim(shell_exec('git branch --show-current 2>&1'));
        if ($currentBranch !== 'master') {
            $log[] = "Switching to master (was on $currentBranch)...";
            $log[] = trim(shell_exec('git checkout master 2>&1'));
        }

        // Pull latest master first
        $log[] = "Pulling latest master...";
        $log[] = trim(shell_exec('git pull origin master 2>&1'));

        // Merge the branch
        $log[] = "Merging origin/$branch...";
        $mergeOutput = shell_exec("git merge origin/$branch -m 'Merge $branch' 2>&1");
        $log[] = trim($mergeOutput);

        // Check if merge was successful
        $mergeSuccess = (strpos($mergeOutput, 'CONFLICT') === false && strpos($mergeOutput, 'fatal') === false);

        if ($mergeSuccess) {
            // Push to origin
            $log[] = "Pushing to origin...";
            $log[] = trim(shell_exec('git push origin master 2>&1'));
            $log[] = "✓ Merge complete!";
        } else {
            // Abort the merge
            $log[] = "Merge failed, aborting...";
            shell_exec('git merge --abort 2>&1');
        }

        chdir($oldDir);
        $this->sendResponse([
            'success' => $mergeSuccess,
            'branch' => $branch,
            'log' => $log
        ]);
    }

    private function deployPush() {
        $input = $this->getPostInput();
        $files = $input['files'] ?? [];
        $message = $input['message'] ?? 'Update from HeatAQ admin';

        if (empty($files)) {
            $this->sendError('No files specified for push');
            return;
        }

        $repoRoot = realpath(__DIR__ . '/..');
        $oldDir = getcwd();
        chdir($repoRoot);

        $log = [];
        $log[] = "Working dir: $repoRoot";

        // Load GitHub credentials from secure config (outside public_html)
        $gitToken = null;
        $gitUser = null;
        $configPaths = [
            __DIR__ . '/../../config_heataq/git_credentials.php',  // Standard location
            __DIR__ . '/../git_credentials.php',                    // Repo root (gitignored)
        ];

        foreach ($configPaths as $path) {
            if (file_exists($path)) {
                $gitConfig = include($path);
                $gitToken = $gitConfig['github_token'] ?? null;
                $gitUser = $gitConfig['github_user'] ?? null;
                $log[] = "Loaded credentials from: " . basename(dirname($path)) . "/" . basename($path);
                break;
            }
        }

        if (!$gitToken) {
            $log[] = "No GitHub credentials found. Create config_heataq/git_credentials.php with:";
            $log[] = "<?php return ['github_user' => 'username', 'github_token' => 'ghp_xxx'];";
            chdir($oldDir);
            $this->sendResponse([
                'success' => false,
                'log' => $log,
                'note' => 'GitHub credentials not configured'
            ]);
            return;
        }

        // Add specified files
        foreach ($files as $file) {
            // Security: only allow files in docs/ or db/ directories
            if (!preg_match('/^(docs|db)\//', $file)) {
                $log[] = "Skipped (not in allowed path): $file";
                continue;
            }
            $log[] = "Adding: $file";
            $log[] = shell_exec("git add " . escapeshellarg($file) . " 2>&1");
        }

        // Commit
        $log[] = "Committing...";
        $log[] = shell_exec("git commit -m " . escapeshellarg($message) . " 2>&1");

        // Get current remote URL and convert to authenticated URL
        $remoteUrl = trim(shell_exec('git remote get-url origin 2>&1'));
        $log[] = "Remote: $remoteUrl";

        // Build authenticated URL: https://user:token@github.com/...
        if (preg_match('#https://github\.com/(.+)#', $remoteUrl, $m)) {
            $authUrl = "https://{$gitUser}:{$gitToken}@github.com/{$m[1]}";
            $log[] = "Pushing with authentication...";
            $pushResult = shell_exec("git push " . escapeshellarg($authUrl) . " master 2>&1");
            // Don't log the URL (contains token)
            $log[] = preg_replace('/https:\/\/[^@]+@/', 'https://***@', $pushResult);
        } else {
            $log[] = "Could not parse remote URL for authentication";
            $pushResult = "error: invalid remote URL";
        }

        $success = strpos($pushResult, 'error') === false && strpos($pushResult, 'fatal') === false;

        chdir($oldDir);
        $this->sendResponse([
            'success' => $success,
            'log' => $log,
            'note' => $success ? 'Pushed successfully' : 'Push may have failed - check log'
        ]);
    }

    // ====================================
    // DATABASE MIGRATIONS
    // ====================================

    /**
     * Check for pending migrations in db/migrations/
     */
    private function checkMigrations() {
        $migrationsDir = realpath(__DIR__ . '/../db/migrations');

        if (!$migrationsDir || !is_dir($migrationsDir)) {
            $this->sendResponse([
                'pending' => [],
                'note' => 'Migrations directory not found'
            ]);
            return;
        }

        $files = glob($migrationsDir . '/*.sql');
        $pending = [];

        foreach ($files as $file) {
            $filename = basename($file);
            $content = file_get_contents($file);

            // Extract description from comment header
            $description = '';
            if (preg_match('/--\s*Description:\s*(.+)/i', $content, $m)) {
                $description = trim($m[1]);
            }

            $pending[] = [
                'filename' => $filename,
                'path' => $file,
                'description' => $description,
                'size' => filesize($file),
                'modified' => date('Y-m-d H:i:s', filemtime($file))
            ];
        }

        // Sort by filename (which should be numbered)
        usort($pending, fn($a, $b) => strcmp($a['filename'], $b['filename']));

        $this->sendResponse([
            'pending' => $pending,
            'count' => count($pending)
        ]);
    }

    /**
     * Run a specific migration file
     */
    private function runMigration() {
        $input = $this->getPostInput();
        $filename = $input['filename'] ?? null;

        if (!$filename) {
            $this->sendError('Migration filename required');
            return;
        }

        // Security: only allow .sql files in migrations directory
        if (!preg_match('/^\d{3}_[a-z0-9_]+\.sql$/', $filename)) {
            $this->sendError('Invalid migration filename format');
            return;
        }

        $dbDir = realpath(__DIR__ . '/../db');
        $migrationsDir = $dbDir . '/migrations';
        $oldMigrationsDir = $dbDir . '/old_migrations';
        $filepath = $migrationsDir . '/' . $filename;

        if (!file_exists($filepath)) {
            $this->sendError('Migration file not found: ' . $filename);
            return;
        }

        $sql = file_get_contents($filepath);
        $log = [];
        $log[] = date('Y-m-d H:i:s') . " - Running migration: $filename";

        // Extract expected tables from CREATE TABLE statements
        $expectedTables = [];
        if (preg_match_all('/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/i', $sql, $matches)) {
            $expectedTables = $matches[1];
        }

        try {
            // Remove SQL comments first, then split by semicolons
            $sqlNoComments = preg_replace('/--.*$/m', '', $sql);
            $statements = array_filter(
                array_map('trim', explode(';', $sqlNoComments)),
                fn($s) => !empty($s)
            );

            $executed = 0;
            foreach ($statements as $stmt) {
                if (empty(trim($stmt))) continue;

                $log[] = "Executing: " . substr($stmt, 0, 80) . (strlen($stmt) > 80 ? '...' : '');
                $this->db->exec($stmt);
                $executed++;
            }

            $log[] = "Executed $executed statements";

            // Verify migration: check that expected tables exist
            $verified = true;
            $verifyLog = [];
            foreach ($expectedTables as $table) {
                $exists = $this->tableExists($table);
                $status = $exists ? '✓' : '✗';
                $verifyLog[] = "$status Table '$table' " . ($exists ? 'exists' : 'MISSING');
                if (!$exists) $verified = false;
            }

            if (!empty($verifyLog)) {
                $log[] = "Verification:";
                $log = array_merge($log, $verifyLog);
            }

            // Save log file
            $logFilename = preg_replace('/\.sql$/', '_log.txt', $filename);
            $logPath = $migrationsDir . '/' . $logFilename;
            file_put_contents($logPath, implode("\n", $log));

            if ($verified) {
                $log[] = "✓ Migration verified - tables exist";
            } else {
                $log[] = "✗ Verification failed";
            }

            $this->sendResponse([
                'success' => $verified,
                'filename' => $filename,
                'statements' => $executed,
                'verified' => $verified,
                'tables_created' => $expectedTables,
                'log_file' => $logFilename,
                'log' => $log
            ]);

        } catch (PDOException $e) {
            $log[] = "ERROR: " . $e->getMessage();

            // Save error log
            $logFilename = preg_replace('/\.sql$/', '_error.txt', $filename);
            $logPath = $migrationsDir . '/' . $logFilename;
            file_put_contents($logPath, implode("\n", $log));

            $this->sendResponse([
                'success' => false,
                'filename' => $filename,
                'error' => $e->getMessage(),
                'log' => $log
            ]);
        }
    }

    /**
     * Archive a completed migration (move to old_migrations)
     */
    private function archiveMigration() {
        $input = $this->getPostInput();
        $filename = $input['filename'] ?? null;

        if (!$filename) {
            $this->sendError('Migration filename required');
            return;
        }

        // Security: only allow .sql files
        if (!preg_match('/^\d{3}_[a-z0-9_]+\.sql$/', $filename)) {
            $this->sendError('Invalid migration filename format');
            return;
        }

        $dbDir = realpath(__DIR__ . '/../db');
        $migrationsDir = $dbDir . '/migrations';
        $oldMigrationsDir = $dbDir . '/old_migrations';
        $filepath = $migrationsDir . '/' . $filename;

        if (!file_exists($filepath)) {
            $this->sendError('Migration file not found: ' . $filename);
            return;
        }

        // Ensure old_migrations directory exists
        if (!is_dir($oldMigrationsDir)) {
            mkdir($oldMigrationsDir, 0755, true);
        }

        $log = [];
        $log[] = date('Y-m-d H:i:s') . " - Archiving: $filename";

        // Move migration file
        $newPath = $oldMigrationsDir . '/' . $filename;
        if (!rename($filepath, $newPath)) {
            $this->sendError('Could not move migration file');
            return;
        }
        $log[] = "✓ Moved $filename to old_migrations/";

        // Also move log file if exists
        $logFilename = preg_replace('/\.sql$/', '_log.txt', $filename);
        $logPath = $migrationsDir . '/' . $logFilename;
        if (file_exists($logPath)) {
            rename($logPath, $oldMigrationsDir . '/' . $logFilename);
            $log[] = "✓ Moved $logFilename to old_migrations/";
        }

        // Export schema (without git push - we'll do our own commit)
        $log[] = "Exporting schema...";
        $schemaOutput = shell_exec('php ' . escapeshellarg($dbDir . '/dump_schema.php') . ' 2>&1');
        $log[] = "✓ Schema exported";

        // Commit to branch, then merge to master
        $repoRoot = realpath(__DIR__ . '/..');
        $oldDir = getcwd();
        chdir($repoRoot);

        $migrationName = preg_replace('/^\d{3}_/', '', $filename);
        $migrationName = preg_replace('/\.sql$/', '', $migrationName);
        $branch = 'db-migration-archive';
        $commitMsg = "Apply migration: $migrationName";

        $log[] = "Committing to branch $branch...";

        // Git commands: commit to branch, push, merge to master, push master
        $commands = [
            "git checkout " . escapeshellarg($branch) . " 2>/dev/null || git checkout -b " . escapeshellarg($branch),
            "git add db/old_migrations/",
            "git add db/schema.json db/schema.md",
            "git add -u db/migrations/",
            "git commit -m " . escapeshellarg($commitMsg) . " || echo 'No changes to commit'",
            "git push -u origin " . escapeshellarg($branch),
            "git checkout master",
            "git merge " . escapeshellarg($branch) . " -m " . escapeshellarg("Merge: $commitMsg"),
            "git push origin master"
        ];

        $fullCommand = implode(' && ', $commands) . ' 2>&1';
        $output = shell_exec($fullCommand);

        $merged = strpos($output, 'fatal') === false && strpos($output, 'CONFLICT') === false;

        if ($merged) {
            $log[] = "✓ Committed and merged to master";
            $log[] = "✓ Pushed to origin/master";
        } else {
            $log[] = "⚠ Git operation may have failed";
            $log[] = trim($output);
        }

        chdir($oldDir);

        $this->sendResponse([
            'success' => true,
            'filename' => $filename,
            'pushed' => $merged,
            'merged' => $merged,
            'log' => $log
        ]);
    }

    /**
     * Export current database schema
     */
    private function exportSchema() {
        $dbDir = realpath(__DIR__ . '/../db');
        $dumpScript = $dbDir . '/dump_schema.php';

        if (!file_exists($dumpScript)) {
            $this->sendError('Schema dump script not found');
            return;
        }

        $log = [];
        $oldDir = getcwd();
        chdir($dbDir);

        try {
            // Run the dump script as separate PHP process
            $log[] = "Running schema export...";
            $output = shell_exec('php dump_schema.php 2>&1');
            $log[] = $output ?: "Export completed (no output)";

            // Check if files were updated recently (within last 30 seconds)
            $schemaJsonTime = file_exists($dbDir . '/schema.json') ? filemtime($dbDir . '/schema.json') : 0;
            $schemaMdTime = file_exists($dbDir . '/schema.md') ? filemtime($dbDir . '/schema.md') : 0;
            $now = time();

            $jsonUpdated = ($now - $schemaJsonTime) < 30;
            $mdUpdated = ($now - $schemaMdTime) < 30;

            $log[] = "schema.json: " . ($jsonUpdated ? 'updated' : 'not updated');
            $log[] = "schema.md: " . ($mdUpdated ? 'updated' : 'not updated');

            chdir($oldDir);
            $this->sendResponse([
                'success' => $jsonUpdated && $mdUpdated,
                'files' => [
                    'schema.json' => $jsonUpdated,
                    'schema.md' => $mdUpdated
                ],
                'log' => $log
            ]);

        } catch (Exception $e) {
            chdir($oldDir);
            $this->sendResponse([
                'success' => false,
                'error' => $e->getMessage(),
                'log' => $log
            ]);
        }
    }

    // ====================================
    // SITE AND POOL MANAGEMENT
    // ====================================

    /**
     * Get all sites (pool_sites) accessible to user
     */
    /**
     * Get the current project's site_id for SimControl to use
     */
    private function getProjectSite() {
        // Return the site_id associated with the current project
        if ($this->siteId) {
            $this->sendResponse([
                'site_id' => $this->siteId,
                'project_id' => $this->projectId
            ]);
        } else {
            $this->sendResponse([
                'site_id' => null,
                'error' => 'No site associated with current session'
            ]);
        }
    }

    private function getSites() {
        // Check if pools table exists to avoid error on subquery
        $tableCheck = $this->db->query("SHOW TABLES LIKE 'pools'");
        $poolsTableExists = $tableCheck->rowCount() > 0;

        if ($poolsTableExists) {
            $stmt = $this->db->prepare("
                SELECT
                    ps.id,
                    ps.site_id,
                    ps.name,
                    ps.latitude,
                    ps.longitude,
                    ps.description,
                    (SELECT COUNT(*) FROM pools p WHERE p.pool_site_id = ps.id AND p.is_active = 1) as pool_count
                FROM pool_sites ps
                ORDER BY ps.name
            ");
        } else {
            $stmt = $this->db->prepare("
                SELECT
                    ps.id,
                    ps.site_id,
                    ps.name,
                    ps.latitude,
                    ps.longitude,
                    ps.description,
                    0 as pool_count
                FROM pool_sites ps
                ORDER BY ps.name
            ");
        }
        $stmt->execute();
        $sites = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $this->sendResponse(['sites' => $sites]);
    }

    /**
     * Save site data to pool_sites (with project_id link)
     */
    private function saveSiteData() {
        $input = $this->getPostInput();

        $siteId = $input['site_id'] ?? null;
        $name = $input['name'] ?? 'Main Site';
        $latitude = $input['latitude'] ?? null;
        $longitude = $input['longitude'] ?? null;
        $weatherStationId = $input['weather_station_id'] ?? null;
        $projectId = $input['project_id'] ?? $this->projectId ?? 1;

        if (!$siteId && $name) {
            // Generate site_id from name
            $siteId = strtolower($name);
            $siteId = str_replace(['æ', 'ø', 'å'], ['ae', 'o', 'a'], $siteId);
            $siteId = preg_replace('/[^a-z0-9]+/', '_', $siteId);
            $siteId = trim($siteId, '_');
        }

        if (!$siteId) {
            $this->sendError('site_id is required');
        }

        try {
            // Check if site exists
            $stmt = $this->db->prepare("SELECT id FROM pool_sites WHERE site_id = ?");
            $stmt->execute([$siteId]);
            $existing = $stmt->fetch();

            if ($existing) {
                // Update existing site (include project_id link)
                $stmt = $this->db->prepare("
                    UPDATE pool_sites
                    SET name = ?, latitude = ?, longitude = ?, weather_station_id = ?,
                        project_id = COALESCE(project_id, ?)
                    WHERE site_id = ?
                ");
                $stmt->execute([$name, $latitude, $longitude, $weatherStationId, $projectId, $siteId]);
            } else {
                // Insert new site with project_id link
                $stmt = $this->db->prepare("
                    INSERT INTO pool_sites (site_id, name, latitude, longitude, weather_station_id, project_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([$siteId, $name, $latitude, $longitude, $weatherStationId, $projectId]);
            }

            $this->sendResponse([
                'success' => true,
                'site_id' => $siteId,
                'message' => $existing ? 'Site updated' : 'Site created'
            ]);

        } catch (PDOException $e) {
            $this->sendError('Failed to save site: ' . $e->getMessage());
        }
    }

    /**
     * Get pools for a site (or all pools for current user's site)
     */
    private function getPools() {
        $siteId = $_GET['site_id'] ?? $this->siteId;

        // Check if pools table exists
        $tableCheck = $this->db->query("SHOW TABLES LIKE 'pools'");
        if ($tableCheck->rowCount() === 0) {
            // Pools table doesn't exist yet - return empty with migration notice
            $this->sendResponse([
                'pools' => [],
                'notice' => 'Pools table not found. Run migration 007_pools_table.sql'
            ]);
            return;
        }

        $stmt = $this->db->prepare("
            SELECT
                p.pool_id,
                p.pool_site_id,
                ps.site_id,
                p.name,
                p.description,
                p.length_m,
                p.width_m,
                p.depth_m,
                p.area_m2,
                p.volume_m3,
                p.wind_exposure,
                p.solar_absorption,
                p.years_operating,
                p.has_cover,
                p.cover_r_value,
                p.cover_solar_transmittance,
                p.has_tunnel,
                p.floor_insulated,
                p.pool_type,
                p.is_active,
                ps.name as site_name
            FROM pools p
            JOIN pool_sites ps ON p.pool_site_id = ps.id
            WHERE ps.site_id = ? AND p.is_active = 1
            ORDER BY p.name
        ");
        $stmt->execute([$siteId]);
        $pools = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $this->sendResponse(['pools' => $pools, 'site_id' => $siteId]);
    }

    /**
     * Get a single pool by ID
     */
    private function getPool($poolId) {
        if (!$poolId) {
            $this->sendError('pool_id is required');
        }

        $stmt = $this->db->prepare("
            SELECT
                p.*,
                ps.name as site_name
            FROM pools p
            JOIN pool_sites ps ON p.pool_site_id = ps.id
            WHERE p.pool_id = ?
        ");
        $stmt->execute([$poolId]);
        $pool = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$pool) {
            $this->sendError('Pool not found', 404);
        }

        $this->sendResponse(['pool' => $pool]);
    }

    /**
     * Save pool (create or update)
     */
    private function savePool() {
        $input = $this->getPostInput();

        $poolId = $input['pool_id'] ?? null;
        $siteId = $input['site_id'] ?? $this->siteId;
        $name = $input['name'] ?? 'Main Pool';

        // Physical dimensions
        $length = floatval($input['length_m'] ?? 25);
        $width = floatval($input['width_m'] ?? 12.5);
        $depth = floatval($input['depth_m'] ?? 2.0);
        $area = $length * $width;
        $volume = $area * $depth;

        // Environmental factors
        $windExposure = floatval($input['wind_exposure'] ?? 0.535);
        $solarAbsorption = floatval($input['solar_absorption'] ?? 60);
        $yearsOperating = intval($input['years_operating'] ?? 3);

        // Cover properties
        $hasCover = ($input['has_cover'] ?? true) ? 1 : 0;
        $coverRValue = floatval($input['cover_r_value'] ?? 5.0);
        $coverSolarTrans = floatval($input['cover_solar_transmittance'] ?? 10);

        // Structure
        $hasTunnel = ($input['has_tunnel'] ?? true) ? 1 : 0;
        $floorInsulated = ($input['floor_insulated'] ?? true) ? 1 : 0;
        $poolType = $input['pool_type'] ?? 'outdoor';

        $description = $input['description'] ?? '';

        try {
            // Look up pool_site_id from site_id (for new FK relationship)
            $poolSiteId = null;
            if ($siteId) {
                $lookupStmt = $this->db->prepare("SELECT id FROM pool_sites WHERE site_id = ? LIMIT 1");
                $lookupStmt->execute([$siteId]);
                $poolSiteId = $lookupStmt->fetchColumn();
            }

            if ($poolId) {
                // Update existing pool (also set pool_site_id if it was null)
                $stmt = $this->db->prepare("
                    UPDATE pools SET
                        pool_site_id = COALESCE(pool_site_id, ?),
                        name = ?,
                        description = ?,
                        length_m = ?,
                        width_m = ?,
                        depth_m = ?,
                        area_m2 = ?,
                        volume_m3 = ?,
                        wind_exposure = ?,
                        solar_absorption = ?,
                        years_operating = ?,
                        has_cover = ?,
                        cover_r_value = ?,
                        cover_solar_transmittance = ?,
                        has_tunnel = ?,
                        floor_insulated = ?,
                        pool_type = ?
                    WHERE pool_id = ?
                ");
                $stmt->execute([
                    $poolSiteId,
                    $name, $description,
                    $length, $width, $depth, $area, $volume,
                    $windExposure, $solarAbsorption, $yearsOperating,
                    $hasCover, $coverRValue, $coverSolarTrans,
                    $hasTunnel, $floorInsulated, $poolType,
                    $poolId
                ]);
            } else {
                // Create new pool using pool_site_id FK
                $stmt = $this->db->prepare("
                    INSERT INTO pools (
                        pool_site_id, name, description,
                        length_m, width_m, depth_m, area_m2, volume_m3,
                        wind_exposure, solar_absorption, years_operating,
                        has_cover, cover_r_value, cover_solar_transmittance,
                        has_tunnel, floor_insulated, pool_type
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $poolSiteId, $name, $description,
                    $length, $width, $depth, $area, $volume,
                    $windExposure, $solarAbsorption, $yearsOperating,
                    $hasCover, $coverRValue, $coverSolarTrans,
                    $hasTunnel, $floorInsulated, $poolType
                ]);
                $poolId = $this->db->lastInsertId();
            }

            $this->sendResponse([
                'success' => true,
                'pool_id' => $poolId,
                'message' => 'Pool saved successfully'
            ]);

        } catch (PDOException $e) {
            $this->sendError('Failed to save pool: ' . $e->getMessage());
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
