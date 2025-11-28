-- Migration 005: Convert string site_id to integer foreign keys
-- This migration adds integer pool_site_id columns to all tables that currently use VARCHAR site_id
-- After migration, code should use pool_site_id (integer) instead of site_id (string)
--
-- IMPORTANT: Run this migration in a transaction or backup first!
-- Rollback: Each ALTER TABLE can be reversed by dropping the added column

-- ============================================
-- Step 1: Ensure pool_sites has an integer ID
-- ============================================
-- First check if pool_sites.id exists, if not we need to add it
-- The pool_sites table should have: id INT AUTO_INCREMENT PRIMARY KEY, site_id VARCHAR(50) UNIQUE

-- Add id column if it doesn't exist (make it auto-increment primary key)
-- Note: If site_id is currently the PRIMARY KEY, we need to change that first
ALTER TABLE pool_sites
ADD COLUMN IF NOT EXISTS id INT AUTO_INCREMENT PRIMARY KEY FIRST;

-- Ensure site_id is a UNIQUE index (not primary key anymore)
-- This allows using site_id as a lookup key while id is the foreign key
ALTER TABLE pool_sites
ADD UNIQUE INDEX IF NOT EXISTS idx_site_code (site_id);

-- ============================================
-- Step 2: Add pool_site_id to schedule tables
-- ============================================

-- schedule_templates
ALTER TABLE schedule_templates
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER template_id;

-- Populate from existing site_id
UPDATE schedule_templates st
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = st.site_id)
WHERE pool_site_id IS NULL;

-- Add foreign key (after data is populated)
-- ALTER TABLE schedule_templates
-- ADD CONSTRAINT fk_sched_tmpl_site FOREIGN KEY (pool_site_id) REFERENCES pool_sites(id) ON DELETE CASCADE;

-- day_schedules
ALTER TABLE day_schedules
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER day_schedule_id;

UPDATE day_schedules ds
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ds.site_id)
WHERE pool_site_id IS NULL;

-- week_schedules
ALTER TABLE week_schedules
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER week_schedule_id;

UPDATE week_schedules ws
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ws.site_id)
WHERE pool_site_id IS NULL;

-- ============================================
-- Step 3: Add pool_site_id to simulation tables
-- ============================================

-- simulation_runs
ALTER TABLE simulation_runs
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER site_id;

UPDATE simulation_runs sr
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = sr.site_id)
WHERE pool_site_id IS NULL;

-- ============================================
-- Step 4: Add pool_site_id to config tables
-- ============================================

-- pool_configurations (if exists)
ALTER TABLE pool_configurations
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER config_id;

UPDATE pool_configurations pc
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = pc.site_id)
WHERE pool_site_id IS NULL;

-- config_templates (if exists)
ALTER TABLE config_templates
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER template_id;

UPDATE config_templates ct
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ct.site_id)
WHERE pool_site_id IS NULL;

-- ============================================
-- Step 5: Add pool_site_id to solar data tables
-- ============================================

-- site_solar_daily
ALTER TABLE site_solar_daily
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER id;

UPDATE site_solar_daily ssd
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ssd.site_id)
WHERE pool_site_id IS NULL;

-- site_solar_hourly
ALTER TABLE site_solar_hourly
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL AFTER id;

UPDATE site_solar_hourly ssh
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ssh.site_id)
WHERE pool_site_id IS NULL;

-- ============================================
-- Step 6: Add indexes for performance
-- ============================================

ALTER TABLE schedule_templates ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);
ALTER TABLE day_schedules ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);
ALTER TABLE week_schedules ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);
ALTER TABLE simulation_runs ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);
ALTER TABLE site_solar_daily ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);
ALTER TABLE site_solar_hourly ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);

-- ============================================
-- Verification query - run after migration
-- ============================================
-- SELECT 'schedule_templates' as tbl, COUNT(*) as total, SUM(pool_site_id IS NULL) as null_count FROM schedule_templates
-- UNION ALL
-- SELECT 'day_schedules', COUNT(*), SUM(pool_site_id IS NULL) FROM day_schedules
-- UNION ALL
-- SELECT 'week_schedules', COUNT(*), SUM(pool_site_id IS NULL) FROM week_schedules
-- UNION ALL
-- SELECT 'simulation_runs', COUNT(*), SUM(pool_site_id IS NULL) FROM simulation_runs;

-- ============================================
-- Notes for code migration:
-- ============================================
-- 1. Auth should return both site_id (string for display) and pool_site_id (int for FK)
-- 2. All WHERE site_id = ? should become WHERE pool_site_id = ?
-- 3. INSERT statements should use pool_site_id instead of site_id
-- 4. Eventually, the VARCHAR site_id columns can be dropped (separate migration)
