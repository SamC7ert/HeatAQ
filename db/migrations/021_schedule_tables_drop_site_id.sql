-- Migration 021: Drop VARCHAR site_id from schedule tables
-- Description: Complete INT pool_site_id migration for schedule tables

-- 1. Update existing records to have pool_site_id based on site_id lookup
UPDATE schedule_templates st
JOIN pool_sites ps ON st.site_id = ps.site_id
SET st.pool_site_id = ps.id
WHERE st.pool_site_id IS NULL AND st.site_id IS NOT NULL;

UPDATE day_schedules ds
JOIN pool_sites ps ON ds.site_id = ps.site_id
SET ds.pool_site_id = ps.id
WHERE ds.pool_site_id IS NULL AND ds.site_id IS NOT NULL;

UPDATE week_schedules ws
JOIN pool_sites ps ON ws.site_id = ps.site_id
SET ws.pool_site_id = ps.id
WHERE ws.pool_site_id IS NULL AND ws.site_id IS NOT NULL;

-- 2. Set pool_site_id = 1 for any remaining NULL values (fallback)
UPDATE schedule_templates SET pool_site_id = 1 WHERE pool_site_id IS NULL;
UPDATE day_schedules SET pool_site_id = 1 WHERE pool_site_id IS NULL;
UPDATE week_schedules SET pool_site_id = 1 WHERE pool_site_id IS NULL;

-- 3. Drop VARCHAR site_id columns
ALTER TABLE schedule_templates DROP COLUMN IF EXISTS site_id;
ALTER TABLE day_schedules DROP COLUMN IF EXISTS site_id;
ALTER TABLE week_schedules DROP COLUMN IF EXISTS site_id;

-- 4. Add index on pool_site_id for better query performance
CREATE INDEX IF NOT EXISTS idx_schedule_templates_pool_site ON schedule_templates (pool_site_id);
CREATE INDEX IF NOT EXISTS idx_day_schedules_pool_site ON day_schedules (pool_site_id);
CREATE INDEX IF NOT EXISTS idx_week_schedules_pool_site ON week_schedules (pool_site_id);
