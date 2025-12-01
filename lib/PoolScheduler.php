<?php
/**
 * HeatAQ Pool Scheduler v4.0.0 (PHP Port)
 *
 * Database-backed pool schedule manager.
 * Ported from Python pool_scheduler_db.py
 *
 * Features:
 * - Named daily schedules (Normal, Weekend, Closed, etc.)
 * - Calendar programs with date ranges and priorities
 * - Holiday exceptions (fixed dates and Easter-relative)
 * - Day-specific assignments via week_schedules
 */

class PoolScheduler {
    private $db;
    private $siteId;
    private $poolSiteId;  // Integer ID (preferred)
    private $templateId;
    private $template;
    private $schedules = [];
    private $weekSchedules = [];
    private $dateRanges = [];
    private $exceptionDays = [];
    private $holidayDates = [];

    /**
     * Initialize scheduler from database
     *
     * @param PDO $db Database connection
     * @param int $poolSiteId Integer pool_site_id (references pool_sites.id)
     * @param int|null $templateId Optional specific template ID
     */
    public function __construct($db, $poolSiteId = 1, $templateId = null) {
        $this->db = $db;
        $this->poolSiteId = (int)$poolSiteId;
        $this->siteId = null; // Deprecated - kept for compatibility

        // Load configuration from database
        $this->template = $this->loadTemplate($templateId);
        $this->templateId = $this->template['template_id'];

        // Load all schedule data
        $this->schedules = $this->loadDaySchedules();
        $this->weekSchedules = $this->loadWeekSchedules();
        $this->dateRanges = $this->loadDateRanges();
        $this->exceptionDays = $this->loadExceptionDays();
        $this->holidayDates = $this->loadHolidayDates();
    }

    /**
     * Load schedule template from database
     */
    private function loadTemplate($templateId = null) {
        if ($templateId) {
            $stmt = $this->db->prepare("
                SELECT * FROM schedule_templates
                WHERE template_id = ?
            ");
            $stmt->execute([$templateId]);
        } else {
            // Use default template (template_id = 1)
            $stmt = $this->db->prepare("
                SELECT * FROM schedule_templates
                WHERE template_id = 1
                LIMIT 1
            ");
            $stmt->execute();
        }

        $result = $stmt->fetch();

        if (!$result) {
            throw new Exception("No schedule template found");
        }

        return $result;
    }

    /**
     * Get site filter condition and value for queries
     * Note: Schedule tables now use project_id, not pool_site_id
     */
    private function getSiteFilter($tableAlias = null) {
        // Schedule tables are now project-level (no site filter needed)
        return ["condition" => "1=1", "value" => null];
    }

    /**
     * Load all day schedules with their periods
     *
     * @return array Schedule data indexed by name
     */
    private function loadDaySchedules() {
        // Load base schedules (project-level, no site filter)
        $stmt = $this->db->prepare("
            SELECT day_schedule_id, name, description
            FROM day_schedules
            ORDER BY name
        ");
        $stmt->execute();
        $rows = $stmt->fetchAll();

        $schedules = [];
        foreach ($rows as $row) {
            $schedules[$row['name']] = [
                'id' => $row['day_schedule_id'],
                'description' => $row['description'] ?? '',
                'periods' => []
            ];
        }

        // Load periods for each schedule (project-level, no site filter)
        $stmt = $this->db->prepare("
            SELECT
                ds.name as schedule_name,
                dsp.start_time,
                dsp.end_time,
                dsp.target_temp,
                dsp.min_temp,
                dsp.max_temp,
                dsp.period_order
            FROM day_schedule_periods dsp
            JOIN day_schedules ds ON dsp.day_schedule_id = ds.day_schedule_id
            ORDER BY ds.name, dsp.period_order, dsp.start_time
        ");
        $stmt->execute();
        $periods = $stmt->fetchAll();

        foreach ($periods as $period) {
            $scheduleName = $period['schedule_name'];
            if (isset($schedules[$scheduleName])) {
                // Convert TIME to hour integer
                $startHour = $this->timeToHour($period['start_time']);
                $endHour = $this->timeToHour($period['end_time']);

                $schedules[$scheduleName]['periods'][] = [
                    'from' => $startHour,
                    'to' => $endHour,
                    'target_temp' => (float) $period['target_temp'],
                    'min_temp' => $period['min_temp'] ? (float) $period['min_temp'] : null,
                    'max_temp' => $period['max_temp'] ? (float) $period['max_temp'] : null
                ];
            }
        }

        return $schedules;
    }

    /**
     * Convert TIME string or object to hour integer
     */
    private function timeToHour($time) {
        if (is_string($time)) {
            $parts = explode(':', $time);
            return (int) $parts[0];
        }
        return (int) $time;
    }

    /**
     * Load week schedules mapping days to day_schedules
     *
     * @return array Week schedules indexed by ID
     */
    private function loadWeekSchedules() {
        // Project-level, no site filter
        $stmt = $this->db->prepare("
            SELECT
                ws.week_schedule_id,
                ws.name,
                d1.name as monday,
                d2.name as tuesday,
                d3.name as wednesday,
                d4.name as thursday,
                d5.name as friday,
                d6.name as saturday,
                d7.name as sunday
            FROM week_schedules ws
            LEFT JOIN day_schedules d1 ON ws.monday_schedule_id = d1.day_schedule_id
            LEFT JOIN day_schedules d2 ON ws.tuesday_schedule_id = d2.day_schedule_id
            LEFT JOIN day_schedules d3 ON ws.wednesday_schedule_id = d3.day_schedule_id
            LEFT JOIN day_schedules d4 ON ws.thursday_schedule_id = d4.day_schedule_id
            LEFT JOIN day_schedules d5 ON ws.friday_schedule_id = d5.day_schedule_id
            LEFT JOIN day_schedules d6 ON ws.saturday_schedule_id = d6.day_schedule_id
            LEFT JOIN day_schedules d7 ON ws.sunday_schedule_id = d7.day_schedule_id
        ");
        $stmt->execute();
        $rows = $stmt->fetchAll();

        $weekSchedules = [];
        foreach ($rows as $row) {
            $weekSchedules[$row['week_schedule_id']] = [
                'name' => $row['name'],
                'days' => [
                    'mon' => $row['monday'],
                    'tue' => $row['tuesday'],
                    'wed' => $row['wednesday'],
                    'thu' => $row['thursday'],
                    'fri' => $row['friday'],
                    'sat' => $row['saturday'],
                    'sun' => $row['sunday']
                ]
            ];
        }

        return $weekSchedules;
    }

    /**
     * Load calendar date ranges (programs)
     *
     * @return array Date ranges sorted by priority (highest first)
     */
    private function loadDateRanges() {
        try {
            $stmt = $this->db->prepare("
                SELECT
                    id,
                    name,
                    priority,
                    week_schedule_id,
                    start_date,
                    end_date,
                    is_recurring,
                    is_active
                FROM calendar_date_ranges
                WHERE schedule_template_id = ? AND is_active = 1
                ORDER BY priority DESC
            ");
            $stmt->execute([$this->templateId]);
            $rows = $stmt->fetchAll();

            $dateRanges = [];
            foreach ($rows as $row) {
                $startDate = new DateTime($row['start_date']);
                $endDate = new DateTime($row['end_date']);

                $dateRanges[] = [
                    'id' => $row['id'],
                    'name' => $row['name'],
                    'priority' => $row['priority'] ?? 0,
                    'week_schedule_id' => $row['week_schedule_id'],
                    'start_month' => (int) $startDate->format('n'),
                    'start_day' => (int) $startDate->format('j'),
                    'end_month' => (int) $endDate->format('n'),
                    'end_day' => (int) $endDate->format('j'),
                    'is_recurring' => isset($row['is_recurring']) ? (bool) $row['is_recurring'] : true
                ];
            }

            return $dateRanges;
        } catch (Exception $e) {
            return [];
        }
    }

    /**
     * Load calendar exception days (holidays)
     *
     * @return array Exception days sorted by priority
     */
    private function loadExceptionDays() {
        try {
            $stmt = $this->db->prepare("
                SELECT
                    ste.id,
                    ed.name,
                    ste.day_schedule_id,
                    ds.name as day_schedule_name,
                    ed.is_fixed,
                    ed.fixed_month,
                    ed.fixed_day,
                    ed.reference_day_id,
                    ed.offset_days
                FROM schedule_template_exceptions ste
                JOIN exception_days ed ON ste.exception_day_id = ed.id
                LEFT JOIN day_schedules ds ON ste.day_schedule_id = ds.day_schedule_id
                WHERE ste.template_id = ?
            ");
            $stmt->execute([$this->templateId]);
            $rows = $stmt->fetchAll();

            $exceptions = [];
            foreach ($rows as $row) {
                $exceptions[] = [
                    'id' => $row['id'],
                    'name' => $row['name'],
                    'day_schedule_id' => $row['day_schedule_id'],
                    'day_schedule_name' => $row['day_schedule_name'],
                    'fixed_month' => $row['fixed_month'] ? (int) $row['fixed_month'] : null,
                    'fixed_day' => $row['fixed_day'] ? (int) $row['fixed_day'] : null,
                    'is_moving' => !((bool) $row['is_fixed']),
                    'reference_day_id' => $row['reference_day_id'] ? (int) $row['reference_day_id'] : null,
                    'easter_offset' => $row['offset_days'] !== null ? (int) $row['offset_days'] : null,
                    'priority' => 50
                ];
            }

            return $exceptions;
        } catch (Exception $e) {
            // If query fails, return empty array
            return [];
        }
    }

    /**
     * Load pre-calculated reference day dates (Easter, etc.)
     *
     * @return array Reference dates indexed by [reference_day_id][year]
     */
    private function loadHolidayDates() {
        try {
            // Get reference day dates from new table
            $stmt = $this->db->prepare("
                SELECT reference_day_id, year, date
                FROM reference_day_dates
                ORDER BY reference_day_id, year
            ");
            $stmt->execute();
            $rows = $stmt->fetchAll();

            $holidays = [];
            foreach ($rows as $row) {
                $refId = (int)$row['reference_day_id'];
                $year = (int)$row['year'];
                if (!isset($holidays[$refId])) {
                    $holidays[$refId] = [];
                }
                $holidays[$refId][$year] = new DateTime($row['date']);
            }

            // For backward compatibility, also index by year for reference_day_id=1 (Easter)
            if (isset($holidays[1])) {
                foreach ($holidays[1] as $year => $date) {
                    $holidays[$year] = $date;
                }
            }

            return $holidays;
        } catch (Exception $e) {
            // If table doesn't exist, use algorithm fallback
            return [];
        }
    }

    /**
     * Get Easter date for a given year
     * Uses pre-calculated dates or falls back to algorithm
     *
     * @param int $year
     * @return DateTime
     */
    private function getEasterDate($year) {
        if (isset($this->holidayDates[$year])) {
            return $this->holidayDates[$year];
        }

        // Fallback: Calculate Easter using Anonymous Gregorian algorithm
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

        return new DateTime("$year-$month-$day");
    }

    /**
     * Find which daily schedule to use for a given date
     * Checks exception days first, then date ranges, then base schedule
     *
     * @param DateTime $date
     * @return string Schedule name (e.g., "Normal", "Weekend", "Closed")
     */
    public function getScheduleForDate($date) {
        if (is_string($date)) {
            $date = new DateTime($date);
        }

        // 1. Check exception days (holidays) - highest priority
        $exception = $this->checkExceptionDays($date);
        if ($exception) {
            return $exception['day_schedule_name'];
        }

        // 2. Check date ranges (programs)
        foreach ($this->dateRanges as $dateRange) {
            if ($this->dateInRange($date, $dateRange)) {
                $weekSchedule = $this->weekSchedules[$dateRange['week_schedule_id']] ?? null;
                if ($weekSchedule) {
                    $dow = $this->getDayOfWeekShort($date);
                    $scheduleName = $weekSchedule['days'][$dow] ?? null;
                    if ($scheduleName) {
                        return $scheduleName;
                    }
                }
            }
        }

        // 3. Fall back to base week schedule from template
        $baseWeekId = $this->template['base_week_schedule_id'] ?? null;
        if ($baseWeekId && isset($this->weekSchedules[$baseWeekId])) {
            $weekSchedule = $this->weekSchedules[$baseWeekId];
            $dow = $this->getDayOfWeekShort($date);
            $scheduleName = $weekSchedule['days'][$dow] ?? null;
            if ($scheduleName) {
                return $scheduleName;
            }
        }

        // 4. Last resort: use first available schedule
        if (!empty($this->schedules)) {
            return array_key_first($this->schedules);
        }

        throw new Exception("No schedule found for date " . $date->format('Y-m-d'));
    }

    /**
     * Get short day of week (mon, tue, etc.)
     */
    private function getDayOfWeekShort($date) {
        $dayMap = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        $dayNum = (int) $date->format('N') - 1; // 1=Monday in PHP
        return $dayMap[$dayNum];
    }

    /**
     * Check if date matches any exception day (holiday)
     *
     * @param DateTime $date
     * @return array|null Exception data if match found
     */
    private function checkExceptionDays($date) {
        $year = (int) $date->format('Y');
        $month = (int) $date->format('n');
        $day = (int) $date->format('j');

        foreach ($this->exceptionDays as $exc) {
            if ($exc['is_moving'] && $exc['easter_offset'] !== null) {
                // Easter-relative holiday
                $easter = $this->getEasterDate($year);
                $holidayDate = clone $easter;
                $holidayDate->modify("{$exc['easter_offset']} days");

                if ($date->format('Y-m-d') === $holidayDate->format('Y-m-d')) {
                    return $exc;
                }
            } elseif ($exc['fixed_month'] && $exc['fixed_day']) {
                // Fixed date holiday
                if ($month === $exc['fixed_month'] && $day === $exc['fixed_day']) {
                    return $exc;
                }
            }
        }

        return null;
    }

    /**
     * Check if date falls within a date range
     * Supports recurring annual ranges and year-crossing ranges
     *
     * @param DateTime $date
     * @param array $dateRange
     * @return bool
     */
    private function dateInRange($date, $dateRange) {
        if ($dateRange['is_recurring'] ?? true) {
            $fromMD = [$dateRange['start_month'], $dateRange['start_day']];
            $toMD = [$dateRange['end_month'], $dateRange['end_day']];
            $currentMD = [(int) $date->format('n'), (int) $date->format('j')];

            if ($fromMD <= $toMD) {
                // Normal range: Jun 25 - Aug 15
                return $currentMD >= $fromMD && $currentMD <= $toMD;
            } else {
                // Year-crossing range: Dec 20 - Jan 5
                return $currentMD >= $fromMD || $currentMD <= $toMD;
            }
        }

        return false;
    }

    /**
     * Get all operating periods for a given date
     *
     * @param DateTime|string $date
     * @return array List of period dicts, empty if closed
     */
    public function getPeriods($date) {
        if (is_string($date)) {
            $date = new DateTime($date);
        }

        $scheduleName = $this->getScheduleForDate($date);

        if (!isset($this->schedules[$scheduleName])) {
            // Unknown schedule = treat as closed (empty periods)
            return [];
        }

        return $this->schedules[$scheduleName]['periods'] ?? [];
    }

    /**
     * Get target temperature for a specific datetime
     *
     * @param DateTime|string $datetime
     * @return float|null Temperature or null if closed
     */
    public function getCurrentTemperature($datetime) {
        if (is_string($datetime)) {
            $datetime = new DateTime($datetime);
        }

        $hour = (int) $datetime->format('G');
        $periods = $this->getPeriods($datetime);

        foreach ($periods as $period) {
            // Skip invalid periods where from == to (zero-length period)
            if ($period['from'] === $period['to']) {
                continue;
            }

            if ($period['from'] < $period['to']) {
                // Normal case: 10-20
                if ($hour >= $period['from'] && $hour < $period['to']) {
                    return $period['target_temp'];
                }
            } else {
                // Overnight case: 22-6
                if ($hour >= $period['from'] || $hour < $period['to']) {
                    return $period['target_temp'];
                }
            }
        }

        return null;
    }

    /**
     * Check if pool is open at a specific datetime
     *
     * @param DateTime|string $datetime
     * @return bool
     */
    public function isOpen($datetime) {
        return $this->getCurrentTemperature($datetime) !== null;
    }

    /**
     * Get all temperature transitions for a day
     *
     * @param DateTime|string $date
     * @return array List of transition dicts
     */
    public function getDailyTransitions($date) {
        if (is_string($date)) {
            $date = new DateTime($date);
        }

        $periods = $this->getPeriods($date);

        if (empty($periods)) {
            return [];
        }

        $transitions = [];
        $lastTarget = null;

        foreach ($periods as $period) {
            $transitions[] = [
                'time' => $period['from'],
                'type' => 'open',
                'target_temp' => $period['target_temp'],
                'from_temp' => $lastTarget
            ];

            $transitions[] = [
                'time' => $period['to'],
                'type' => 'close',
                'target_temp' => null,
                'from_temp' => $period['target_temp']
            ];

            $lastTarget = $period['target_temp'];
        }

        usort($transitions, fn($a, $b) => $a['time'] <=> $b['time']);

        return $transitions;
    }

    /**
     * Find next pool opening time from a given datetime
     *
     * @param DateTime|string $datetime
     * @return array ['datetime' => DateTime|null, 'target_temp' => float|null]
     */
    public function findNextOpening($datetime) {
        if (is_string($datetime)) {
            $datetime = new DateTime($datetime);
        }

        $currentDate = clone $datetime;
        $currentDate->setTime(0, 0, 0);
        $currentHour = (int) $datetime->format('G');

        // Check remaining transitions today
        $transitions = $this->getDailyTransitions($currentDate);
        foreach ($transitions as $trans) {
            if ($trans['type'] === 'open' && $trans['time'] > $currentHour) {
                $openingDt = clone $currentDate;
                $openingDt->setTime($trans['time'], 0, 0);
                return [
                    'datetime' => $openingDt,
                    'target_temp' => $trans['target_temp']
                ];
            }
        }

        // Check next 30 days
        for ($dayOffset = 1; $dayOffset <= 30; $dayOffset++) {
            $nextDate = clone $currentDate;
            $nextDate->modify("+$dayOffset days");

            $transitions = $this->getDailyTransitions($nextDate);
            foreach ($transitions as $trans) {
                if ($trans['type'] === 'open') {
                    $openingDt = clone $nextDate;
                    $openingDt->setTime($trans['time'], 0, 0);
                    return [
                        'datetime' => $openingDt,
                        'target_temp' => $trans['target_temp']
                    ];
                }
            }
        }

        return ['datetime' => null, 'target_temp' => null];
    }

    /**
     * Get current period info if pool is open
     *
     * @param DateTime|string $datetime
     * @return array|null Period data or null if closed
     */
    public function getCurrentPeriod($datetime) {
        if (is_string($datetime)) {
            $datetime = new DateTime($datetime);
        }

        $hour = (int) $datetime->format('G');
        $periods = $this->getPeriods($datetime);

        foreach ($periods as $period) {
            // Skip invalid periods where from == to (zero-length period)
            if ($period['from'] === $period['to']) {
                continue;
            }

            if ($period['from'] < $period['to']) {
                // Normal case: 10-20
                if ($hour >= $period['from'] && $hour < $period['to']) {
                    return $period;
                }
            } else {
                // Overnight case: 22-6
                if ($hour >= $period['from'] || $hour < $period['to']) {
                    return $period;
                }
            }
        }

        return null;
    }

    /**
     * Calculate duration of a period in hours
     *
     * @param array $period
     * @return int
     */
    public function getPeriodDuration($period) {
        if ($period['from'] < $period['to']) {
            return $period['to'] - $period['from'];
        } else {
            return (24 - $period['from']) + $period['to'];
        }
    }

    /**
     * Get loaded template info
     *
     * @return array
     */
    public function getTemplate() {
        return $this->template;
    }

    /**
     * Get all loaded schedules
     *
     * @return array
     */
    public function getSchedules() {
        return $this->schedules;
    }

    /**
     * Get all loaded week schedules
     *
     * @return array
     */
    public function getWeekSchedules() {
        return $this->weekSchedules;
    }

    /**
     * Get all loaded date ranges
     *
     * @return array
     */
    public function getDateRanges() {
        return $this->dateRanges;
    }

    /**
     * Get all loaded exception days
     *
     * @return array
     */
    public function getExceptionDays() {
        return $this->exceptionDays;
    }

    /**
     * Get schedule info for a date range (for calendar display)
     *
     * @param string $startDate
     * @param string $endDate
     * @return array
     */
    public function getScheduleRange($startDate, $endDate) {
        $start = new DateTime($startDate);
        $end = new DateTime($endDate);
        $results = [];

        $current = clone $start;
        while ($current <= $end) {
            $dateStr = $current->format('Y-m-d');
            $scheduleName = $this->getScheduleForDate($current);
            $periods = $this->getPeriods($current);

            $results[$dateStr] = [
                'date' => $dateStr,
                'day_of_week' => $current->format('l'),
                'schedule_name' => $scheduleName,
                'periods' => $periods,
                'is_open' => !empty($periods)
            ];

            $current->modify('+1 day');
        }

        return $results;
    }

    /**
     * Get schedule debug info for a date
     * Returns detailed info about which schedule is being used and why
     *
     * @param string $date Date string (YYYY-MM-DD)
     * @return array Debug information
     */
    public function getScheduleDebugInfo($date) {
        $dateObj = new DateTime($date);
        $scheduleName = $this->getScheduleForDate($dateObj);
        $periods = $this->getPeriods($dateObj);

        // Calculate open hours from periods
        $openHours = 0;
        foreach ($periods as $period) {
            $openHours += ($period['to'] - $period['from']);
        }

        // Get template info
        $baseWeekId = $this->template['base_week_schedule_id'] ?? null;
        $baseWeekSchedule = $baseWeekId && isset($this->weekSchedules[$baseWeekId])
            ? $this->weekSchedules[$baseWeekId]
            : null;

        return [
            'date' => $date,
            'day_of_week' => $dateObj->format('l'),
            'schedule_name' => $scheduleName,
            'periods' => $periods,
            'open_hours' => $openHours,
            'template_id' => $this->templateId,
            'template_name' => $this->template['name'] ?? null,
            'base_week_schedule_id' => $baseWeekId,
            'base_week_schedule_name' => $baseWeekSchedule ? $baseWeekSchedule['name'] : null,
            'available_schedules' => array_keys($this->schedules),
        ];
    }
}
