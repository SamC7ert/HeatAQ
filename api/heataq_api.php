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
        $action = $_GET['action'] ?? '';
        
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
                case 'save_day_schedule':
                    if (!$this->canEdit()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->saveDaySchedule();
                    break;
                    
                // DELETE operations  
                case 'delete_exception_day':
                    if (!$this->canDelete()) {
                        $this->sendError('Permission denied', 403);
                    }
                    $this->deleteExceptionDay($_GET['exception_id'] ?? 0);
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
        
        $stmt = $this->db->prepare("
            SELECT 
                ce.id as exception_id,
                ce.*,
                ds.name as day_schedule_name
            FROM calendar_exception_days ce
            LEFT JOIN day_schedules ds ON ce.day_schedule_id = ds.day_schedule_id
            WHERE ce.schedule_template_id = ?
            ORDER BY ce.is_moving, ce.fixed_month, ce.fixed_day, ce.easter_offset_days
        ");
        $stmt->execute([$templateId]);
        
        $this->sendResponse(['exceptions' => $stmt->fetchAll()]);
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
    
    private function saveDaySchedule() {
        // TODO: Implement with proper validation
        $this->sendError('Not yet implemented');
    }
    
    private function deleteExceptionDay($exceptionId) {
        if (!$this->validateId($exceptionId)) {
            $this->sendError('Invalid exception ID');
        }
        
        $stmt = $this->db->prepare("DELETE FROM calendar_exception_days WHERE id = ?");
        $stmt->execute([$exceptionId]);
        
        $this->sendResponse(['success' => true]);
    }
    
    // ====================================
    // UTILITY METHODS
    // ====================================
    
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
}

// Initialize and handle request
try {
    $api = new HeatAQAPI($currentSiteId ?? null, $auth ?? null);
    $api->handle();
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => Config::isDebug() ? $e->getMessage() : 'System error']);
}
