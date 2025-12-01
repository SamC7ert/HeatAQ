-- Migration 023: Refactor exception days to be universal definitions
-- Description: Exception days should be standalone definitions, not tied to templates
-- The schedule template links TO exception days, not the other way around

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Create new exception_days table (universal definitions)
CREATE TABLE IF NOT EXISTS exception_days (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_moving TINYINT(1) NOT NULL DEFAULT 0,
    easter_offset_days INT NULL,
    fixed_month INT NULL,
    fixed_day INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_exception (is_moving, easter_offset_days, fixed_month, fixed_day)
);

-- 2. Insert standard Norwegian holidays
INSERT INTO exception_days (name, is_moving, fixed_month, fixed_day) VALUES
    ('Nyttårsdag', 0, 1, 1),
    ('Arbeidernes dag', 0, 5, 1),
    ('Grunnlovsdag', 0, 5, 17),
    ('Julaften', 0, 12, 24),
    ('Første juledag', 0, 12, 25),
    ('Andre juledag', 0, 12, 26),
    ('Nyttårsaften', 0, 12, 31)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO exception_days (name, is_moving, easter_offset_days) VALUES
    ('Palmesøndag', 1, -7),
    ('Skjærtorsdag', 1, -3),
    ('Langfredag', 1, -2),
    ('Påskeaften', 1, -1),
    ('Første påskedag', 1, 0),
    ('Andre påskedag', 1, 1),
    ('Kristi himmelfartsdag', 1, 39),
    ('Første pinsedag', 1, 49),
    ('Andre pinsedag', 1, 50)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 3. Create junction table for template-exception links
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

-- 4. Migrate existing data from calendar_exception_days
-- Match by date definition (is_moving + offset or fixed month/day)
INSERT INTO schedule_template_exceptions (template_id, exception_day_id, day_schedule_id)
SELECT
    ced.schedule_template_id,
    ed.id,
    ced.day_schedule_id
FROM calendar_exception_days ced
JOIN exception_days ed ON (
    (ced.is_moving = 1 AND ed.is_moving = 1 AND ced.easter_offset_days = ed.easter_offset_days)
    OR
    (ced.is_moving = 0 AND ed.is_moving = 0 AND ced.fixed_month = ed.fixed_month AND ced.fixed_day = ed.fixed_day)
)
WHERE ced.day_schedule_id IS NOT NULL
ON DUPLICATE KEY UPDATE day_schedule_id = VALUES(day_schedule_id);

-- 5. Drop old table (after verifying migration worked)
-- DROP TABLE IF EXISTS calendar_exception_days;
-- Note: Uncomment above line after verifying data migrated correctly

SET FOREIGN_KEY_CHECKS = 1;
