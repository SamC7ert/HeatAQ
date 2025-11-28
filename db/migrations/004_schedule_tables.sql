-- ============================================
-- HeatAQ Schedule Tables Schema
-- Date: 2024-11-27
--
-- These tables manage pool opening schedules:
-- - schedule_templates: Top-level calendar definitions (OHC)
-- - day_schedules: Named day types (Normal, Weekend, Closed, etc.)
-- - day_schedule_periods: Time periods within each day
-- - week_schedules: Mon-Sun patterns mapping to day_schedules
-- - calendar_date_ranges: Seasonal overrides with date ranges
-- - calendar_exception_days: Holiday exceptions
-- - holiday_reference_days: Pre-calculated Easter dates
--
-- Hierarchy:
--   schedule_templates (OHC)
--     └── week_schedules (default + date range overrides)
--           └── day_schedules (per day of week)
--                 └── day_schedule_periods (time slots)
-- ============================================

-- ============================================
-- SCHEDULE TEMPLATES (Open Hours Calendars)
-- The top-level calendar definition selected when running simulations
-- ============================================
CREATE TABLE IF NOT EXISTS schedule_templates (
    template_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Default week schedule (used when no date range matches)
    base_week_schedule_id INT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_site_id (site_id),

    -- Foreign key to pool_sites
    CONSTRAINT fk_schedule_template_site
        FOREIGN KEY (site_id) REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- DAY SCHEDULES
-- Named day types with their own opening periods
-- Examples: "Normal", "Weekend", "Holiday-Closed", "Summer Extended"
-- ============================================
CREATE TABLE IF NOT EXISTS day_schedules (
    day_schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_site_id (site_id),
    UNIQUE INDEX idx_site_name (site_id, name),

    -- Foreign key
    CONSTRAINT fk_day_schedule_site
        FOREIGN KEY (site_id) REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- DAY SCHEDULE PERIODS
-- Time periods within a day schedule
-- Each period defines: start time, end time, target temperature
-- ============================================
CREATE TABLE IF NOT EXISTS day_schedule_periods (
    period_id INT AUTO_INCREMENT PRIMARY KEY,
    day_schedule_id INT NOT NULL,

    -- Time range (as TIME or stored as HH:MM:SS)
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,

    -- Target temperature during this period
    target_temp DECIMAL(4,1) NOT NULL DEFAULT 28.0,

    -- Optional min/max tolerance (null = use default ±0.5°C)
    min_temp DECIMAL(4,1),
    max_temp DECIMAL(4,1),

    -- Order for multiple periods in same day
    period_order INT DEFAULT 0,

    -- Indexes
    INDEX idx_day_schedule (day_schedule_id),

    -- Foreign key
    CONSTRAINT fk_period_day_schedule
        FOREIGN KEY (day_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- WEEK SCHEDULES
-- Maps each day of the week to a day_schedule
-- Example: "Standard Week" has Mon-Fri → Normal, Sat-Sun → Weekend
-- ============================================
CREATE TABLE IF NOT EXISTS week_schedules (
    week_schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Day schedule assignments (NULL = closed/no schedule)
    monday_schedule_id INT,
    tuesday_schedule_id INT,
    wednesday_schedule_id INT,
    thursday_schedule_id INT,
    friday_schedule_id INT,
    saturday_schedule_id INT,
    sunday_schedule_id INT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_site_id (site_id),

    -- Foreign keys
    CONSTRAINT fk_week_schedule_site
        FOREIGN KEY (site_id) REFERENCES pool_sites(site_id) ON DELETE CASCADE,
    CONSTRAINT fk_week_monday
        FOREIGN KEY (monday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL,
    CONSTRAINT fk_week_tuesday
        FOREIGN KEY (tuesday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL,
    CONSTRAINT fk_week_wednesday
        FOREIGN KEY (wednesday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL,
    CONSTRAINT fk_week_thursday
        FOREIGN KEY (thursday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL,
    CONSTRAINT fk_week_friday
        FOREIGN KEY (friday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL,
    CONSTRAINT fk_week_saturday
        FOREIGN KEY (saturday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL,
    CONSTRAINT fk_week_sunday
        FOREIGN KEY (sunday_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- CALENDAR DATE RANGES
-- Seasonal overrides: "Summer Hours" from Jun 1 - Aug 31
-- Higher priority overrides lower priority
-- ============================================
CREATE TABLE IF NOT EXISTS calendar_date_ranges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_template_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,

    -- Which week schedule to use during this range
    week_schedule_id INT NOT NULL,

    -- Date range (year is ignored for recurring ranges)
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    -- Priority: higher number = higher priority
    priority INT DEFAULT 0,

    -- Is this range recurring yearly?
    is_recurring TINYINT(1) DEFAULT 1,

    -- Active flag
    is_active TINYINT(1) DEFAULT 1,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_template (schedule_template_id),
    INDEX idx_priority (priority DESC),

    -- Foreign keys
    CONSTRAINT fk_date_range_template
        FOREIGN KEY (schedule_template_id) REFERENCES schedule_templates(template_id) ON DELETE CASCADE,
    CONSTRAINT fk_date_range_week
        FOREIGN KEY (week_schedule_id) REFERENCES week_schedules(week_schedule_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- CALENDAR EXCEPTION DAYS
-- Holiday overrides: specific day_schedule for holidays
-- Can be fixed date (Dec 25) or Easter-relative (Good Friday = Easter-2)
-- ============================================
CREATE TABLE IF NOT EXISTS calendar_exception_days (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_template_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,

    -- Which day schedule to use on this exception day
    day_schedule_id INT,

    -- For fixed-date holidays (e.g., Dec 25)
    fixed_month INT,
    fixed_day INT,

    -- For Easter-relative holidays
    is_moving TINYINT(1) DEFAULT 0,
    easter_offset_days INT,  -- Negative = before Easter, Positive = after

    -- Priority (higher = checked first)
    priority INT DEFAULT 50,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_template (schedule_template_id),
    INDEX idx_priority (priority DESC),

    -- Foreign keys
    CONSTRAINT fk_exception_template
        FOREIGN KEY (schedule_template_id) REFERENCES schedule_templates(template_id) ON DELETE CASCADE,
    CONSTRAINT fk_exception_day_schedule
        FOREIGN KEY (day_schedule_id) REFERENCES day_schedules(day_schedule_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- HOLIDAY REFERENCE DAYS
-- Pre-calculated Easter dates for quick lookup
-- Used to calculate moving holidays (Good Friday, Ascension, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS holiday_reference_days (
    year INT NOT NULL,
    easter_sunday DATE NOT NULL,
    country VARCHAR(10) DEFAULT 'NO',

    PRIMARY KEY (year, country),
    INDEX idx_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SAMPLE DATA: Norwegian holidays (Easter dates 2020-2030)
-- ============================================
INSERT IGNORE INTO holiday_reference_days (year, easter_sunday, country) VALUES
    (2020, '2020-04-12', 'NO'),
    (2021, '2021-04-04', 'NO'),
    (2022, '2022-04-17', 'NO'),
    (2023, '2023-04-09', 'NO'),
    (2024, '2024-03-31', 'NO'),
    (2025, '2025-04-20', 'NO'),
    (2026, '2026-04-05', 'NO'),
    (2027, '2027-03-28', 'NO'),
    (2028, '2028-04-16', 'NO'),
    (2029, '2029-04-01', 'NO'),
    (2030, '2030-04-21', 'NO');

-- ============================================
-- NOTES
-- ============================================
--
-- Schedule Resolution Priority (highest to lowest):
-- 1. Exception days (holidays) - checked first
-- 2. Date ranges (seasonal overrides) - by priority
-- 3. Base week schedule - default fallback
--
-- Example lookup for Feb 14, 2024:
-- 1. Is Feb 14 an exception day? No → continue
-- 2. Does any date range cover Feb 14? No → continue
-- 3. Use base_week_schedule_id from schedule_templates
-- 4. Get day_schedule for Wednesday from week_schedules
-- 5. Get periods from day_schedule_periods
-- 6. Return target_temp if current hour is within a period, else NULL (closed)
