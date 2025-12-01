-- Migration 022: Change schedule tables from pool_site_id to project_id
-- Description: Schedules belong to projects, not sites/pools

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add project_id column to schedule tables
ALTER TABLE schedule_templates ADD COLUMN project_id INT NULL;
ALTER TABLE day_schedules ADD COLUMN project_id INT NULL;
ALTER TABLE week_schedules ADD COLUMN project_id INT NULL;

-- 2. Set project_id = 1 for all existing records (single project currently)
UPDATE schedule_templates SET project_id = 1;
UPDATE day_schedules SET project_id = 1;
UPDATE week_schedules SET project_id = 1;

-- 3. Make project_id NOT NULL
ALTER TABLE schedule_templates MODIFY COLUMN project_id INT NOT NULL;
ALTER TABLE day_schedules MODIFY COLUMN project_id INT NOT NULL;
ALTER TABLE week_schedules MODIFY COLUMN project_id INT NOT NULL;

-- 4. Drop pool_site_id and site_id columns
ALTER TABLE schedule_templates DROP COLUMN IF EXISTS pool_site_id;
ALTER TABLE schedule_templates DROP COLUMN IF EXISTS site_id;
ALTER TABLE day_schedules DROP COLUMN IF EXISTS pool_site_id;
ALTER TABLE day_schedules DROP COLUMN IF EXISTS site_id;
ALTER TABLE week_schedules DROP COLUMN IF EXISTS pool_site_id;
ALTER TABLE week_schedules DROP COLUMN IF EXISTS site_id;

-- 5. Add indexes on project_id
CREATE INDEX idx_schedule_templates_project ON schedule_templates (project_id);
CREATE INDEX idx_day_schedules_project ON day_schedules (project_id);
CREATE INDEX idx_week_schedules_project ON week_schedules (project_id);

-- 6. Add FK constraints
ALTER TABLE schedule_templates ADD CONSTRAINT fk_schedule_templates_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id);
ALTER TABLE day_schedules ADD CONSTRAINT fk_day_schedules_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id);
ALTER TABLE week_schedules ADD CONSTRAINT fk_week_schedules_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id);

SET FOREIGN_KEY_CHECKS = 1;
