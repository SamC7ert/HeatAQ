-- Solar Tables Migration to pool_site_id
-- Migration: 017_solar_tables_pool_site_id.sql
-- Date: 2025-12-01
-- Description: Links site_solar_daily and site_solar_hourly to pool_sites.id
--              Replaces VARCHAR site_id with INT pool_site_id

-- ============================================
-- Step 1: Add pool_site_id column to solar tables
-- ============================================

-- site_solar_daily
ALTER TABLE site_solar_daily
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL FIRST;

-- site_solar_hourly
ALTER TABLE site_solar_hourly
ADD COLUMN IF NOT EXISTS pool_site_id INT NULL FIRST;

-- ============================================
-- Step 2: Populate pool_site_id from site_id lookup
-- ============================================

UPDATE site_solar_daily ssd
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ssd.site_id)
WHERE pool_site_id IS NULL;

UPDATE site_solar_hourly ssh
SET pool_site_id = (SELECT id FROM pool_sites ps WHERE ps.site_id = ssh.site_id)
WHERE pool_site_id IS NULL;

-- ============================================
-- Step 3: Add indexes for pool_site_id
-- ============================================

ALTER TABLE site_solar_daily ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);
ALTER TABLE site_solar_hourly ADD INDEX IF NOT EXISTS idx_pool_site_id (pool_site_id);

-- ============================================
-- Step 4: Drop old primary keys and site_id columns
-- ============================================

-- site_solar_daily: Change primary key from (site_id, date) to (pool_site_id, date)
ALTER TABLE site_solar_daily DROP PRIMARY KEY;
ALTER TABLE site_solar_daily ADD PRIMARY KEY (pool_site_id, date);
ALTER TABLE site_solar_daily DROP INDEX IF EXISTS idx_site;
ALTER TABLE site_solar_daily DROP COLUMN site_id;

-- site_solar_hourly: Change primary key from (site_id, timestamp) to (pool_site_id, timestamp)
ALTER TABLE site_solar_hourly DROP PRIMARY KEY;
ALTER TABLE site_solar_hourly ADD PRIMARY KEY (pool_site_id, timestamp);
ALTER TABLE site_solar_hourly DROP INDEX IF EXISTS idx_site;
ALTER TABLE site_solar_hourly DROP COLUMN site_id;

-- ============================================
-- Step 5: Add foreign key constraints (optional)
-- ============================================

-- ALTER TABLE site_solar_daily
-- ADD CONSTRAINT fk_solar_daily_site FOREIGN KEY (pool_site_id) REFERENCES pool_sites(id) ON DELETE CASCADE;

-- ALTER TABLE site_solar_hourly
-- ADD CONSTRAINT fk_solar_hourly_site FOREIGN KEY (pool_site_id) REFERENCES pool_sites(id) ON DELETE CASCADE;

-- ============================================
-- Verification queries (run manually):
-- ============================================
-- SELECT COUNT(*) as total, COUNT(pool_site_id) as with_id FROM site_solar_daily;
-- SELECT COUNT(*) as total, COUNT(pool_site_id) as with_id FROM site_solar_hourly;
-- DESCRIBE site_solar_daily;
-- DESCRIBE site_solar_hourly;
