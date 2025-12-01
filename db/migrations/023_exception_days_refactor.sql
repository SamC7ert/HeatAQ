-- Migration 023: Refactor exception days to universal definitions
--
-- Design:
-- 1. reference_days - defines anchor dates (Easter, Thanksgiving, etc.)
-- 2. reference_day_dates - actual dates per year for each reference day
-- 3. exception_days - universal holiday definitions (Admin edits this)
-- 4. schedule_template_exceptions - which templates observe which exceptions

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================
-- 1. REFERENCE DAYS - anchor date types
-- ============================================
CREATE TABLE IF NOT EXISTS reference_days (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert standard reference days
INSERT INTO reference_days (id, name, description) VALUES
    (1, '1. Påskedag', 'Easter Sunday')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ============================================
-- 2. REFERENCE DAY DATES - actual dates per year
-- ============================================
CREATE TABLE IF NOT EXISTS reference_day_dates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reference_day_id INT NOT NULL,
    year INT NOT NULL,
    date DATE NOT NULL,
    UNIQUE KEY unique_ref_year (reference_day_id, year),
    CONSTRAINT fk_rdd_reference FOREIGN KEY (reference_day_id) REFERENCES reference_days(id)
);

-- Migrate existing Easter dates from holiday_reference_days
INSERT INTO reference_day_dates (reference_day_id, year, date)
SELECT 1, year, easter_sunday FROM holiday_reference_days
ON DUPLICATE KEY UPDATE date = VALUES(date);

-- ============================================
-- 3. EXCEPTION DAYS - universal definitions (Admin edits this)
-- ============================================
CREATE TABLE IF NOT EXISTS exception_days (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_fixed TINYINT(1) NOT NULL DEFAULT 1,
    fixed_month INT NULL,
    fixed_day INT NULL,
    reference_day_id INT NULL,
    offset_days INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ed_reference FOREIGN KEY (reference_day_id) REFERENCES reference_days(id)
);

-- Insert standard Norwegian holidays
-- Fixed date holidays
INSERT INTO exception_days (name, is_fixed, fixed_month, fixed_day) VALUES
    ('Nyttårsdag', 1, 1, 1),
    ('Arbeidernes dag', 1, 5, 1),
    ('Grunnlovsdag', 1, 5, 17),
    ('Julaften', 1, 12, 24),
    ('Første juledag', 1, 12, 25),
    ('Andre juledag', 1, 12, 26),
    ('Nyttårsaften', 1, 12, 31);

-- Easter-relative holidays (reference_day_id = 1 = Easter)
INSERT INTO exception_days (name, is_fixed, reference_day_id, offset_days) VALUES
    ('Palmesøndag', 0, 1, -7),
    ('Skjærtorsdag', 0, 1, -3),
    ('Langfredag', 0, 1, -2),
    ('Påskeaften', 0, 1, -1),
    ('Første påskedag', 0, 1, 0),
    ('Andre påskedag', 0, 1, 1),
    ('Kristi himmelfartsdag', 0, 1, 39),
    ('Første pinsedag', 0, 1, 49),
    ('Andre pinsedag', 0, 1, 50);

-- ============================================
-- 4. SCHEDULE TEMPLATE EXCEPTIONS - template links to exceptions
-- ============================================
CREATE TABLE IF NOT EXISTS schedule_template_exceptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_id INT NOT NULL,
    exception_day_id INT NOT NULL,
    day_schedule_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_template_exception (template_id, exception_day_id),
    CONSTRAINT fk_ste_template FOREIGN KEY (template_id) REFERENCES schedule_templates(id),
    CONSTRAINT fk_ste_exception FOREIGN KEY (exception_day_id) REFERENCES exception_days(id),
    CONSTRAINT fk_ste_day_schedule FOREIGN KEY (day_schedule_id) REFERENCES day_schedules(day_schedule_id)
);

-- ============================================
-- 5. MIGRATE existing calendar_exception_days data
-- ============================================
-- Match by date definition and migrate to new structure
INSERT INTO schedule_template_exceptions (template_id, exception_day_id, day_schedule_id)
SELECT
    ced.schedule_template_id,
    ed.id,
    ced.day_schedule_id
FROM calendar_exception_days ced
JOIN exception_days ed ON (
    (ced.is_moving = 0 AND ed.is_fixed = 1 AND ced.fixed_month = ed.fixed_month AND ced.fixed_day = ed.fixed_day)
    OR
    (ced.is_moving = 1 AND ed.is_fixed = 0 AND ced.easter_offset_days = ed.offset_days)
)
WHERE ced.day_schedule_id IS NOT NULL
ON DUPLICATE KEY UPDATE day_schedule_id = VALUES(day_schedule_id);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================
-- CLEANUP (run after verifying migration worked)
-- ============================================
-- DROP TABLE IF EXISTS calendar_exception_days;
-- DROP TABLE IF EXISTS holiday_reference_days;
