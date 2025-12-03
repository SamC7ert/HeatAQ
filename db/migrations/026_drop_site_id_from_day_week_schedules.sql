-- Migration 026: Drop VARCHAR site_id from day_schedules and week_schedules
-- Description: Complete the site_id cleanup - these tables now use project_id
--
-- Current state:
-- - schedule_templates: CLEAN (site_id already dropped, uses project_id)
-- - day_schedules: still has site_id VARCHAR(50) and unique_name_site constraint
-- - week_schedules: still has site_id VARCHAR(50), pool_site_id INT, and unique_name_site constraint
--
-- After migration:
-- - All schedule tables use project_id only (no site_id or pool_site_id)
-- - Unique constraint changed from (name, site_id) to (name, project_id)

-- 1. Drop unique constraints that include site_id
-- These constraints block dropping the site_id column
ALTER TABLE day_schedules DROP INDEX IF EXISTS unique_name_site;
ALTER TABLE day_schedules DROP INDEX IF EXISTS site_id;
ALTER TABLE week_schedules DROP INDEX IF EXISTS unique_name_site;
ALTER TABLE week_schedules DROP INDEX IF EXISTS site_id;

-- 2. Drop the site_id columns
ALTER TABLE day_schedules DROP COLUMN IF EXISTS site_id;
ALTER TABLE week_schedules DROP COLUMN IF EXISTS site_id;

-- 3. Drop pool_site_id from week_schedules (not needed, project_id is used instead)
ALTER TABLE week_schedules DROP COLUMN IF EXISTS pool_site_id;

-- 4. Create new unique constraints using project_id
-- Ensures schedule names are unique within a project
ALTER TABLE day_schedules ADD CONSTRAINT unique_name_project UNIQUE (name, project_id);
ALTER TABLE week_schedules ADD CONSTRAINT unique_name_project UNIQUE (name, project_id);

-- 5. Verify changes
SELECT 'day_schedules columns after migration:' as info;
SHOW COLUMNS FROM day_schedules;

SELECT 'week_schedules columns after migration:' as info;
SHOW COLUMNS FROM week_schedules;
