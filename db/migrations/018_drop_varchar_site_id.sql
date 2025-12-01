-- Migration 018: Drop VARCHAR site_id columns from tables that now use INT pool_site_id
-- This cleanup follows migration 017 which added pool_site_id
--
-- Tables affected:
-- - site_solar_hourly: now uses pool_site_id (INT) for foreign key
-- - site_solar_fetch_log: now uses pool_site_id (INT) for foreign key
-- - pools: now uses pool_site_id (INT) for foreign key
--
-- The pool_sites.site_id column is KEPT as it's the source VARCHAR identifier

-- 1. Drop site_id from site_solar_hourly
-- First drop index if exists
DROP INDEX IF EXISTS `idx_site` ON `site_solar_hourly`;
DROP INDEX IF EXISTS `idx_site_id` ON `site_solar_hourly`;

ALTER TABLE `site_solar_hourly`
DROP COLUMN IF EXISTS `site_id`;

-- 2. Drop site_id from site_solar_fetch_log
DROP INDEX IF EXISTS `idx_site` ON `site_solar_fetch_log`;
DROP INDEX IF EXISTS `site_id` ON `site_solar_fetch_log`;

ALTER TABLE `site_solar_fetch_log`
DROP COLUMN IF EXISTS `site_id`;

-- 3. Drop site_id from pools table
DROP INDEX IF EXISTS `site_id` ON `pools`;

ALTER TABLE `pools`
DROP COLUMN IF EXISTS `site_id`;

-- 4. Ensure pool_site_id indexes exist
CREATE INDEX IF NOT EXISTS `idx_pool_site_id` ON `site_solar_hourly` (`pool_site_id`);
CREATE INDEX IF NOT EXISTS `idx_pool_site_id` ON `site_solar_fetch_log` (`pool_site_id`);
CREATE INDEX IF NOT EXISTS `idx_pool_site_id` ON `pools` (`pool_site_id`);

-- Verify the columns were dropped
-- SELECT 'site_solar_hourly columns:' as info;
-- DESCRIBE site_solar_hourly;
-- SELECT 'site_solar_fetch_log columns:' as info;
-- DESCRIBE site_solar_fetch_log;
-- SELECT 'pools columns:' as info;
-- DESCRIBE pools;
