-- Migration 018: Migrate from VARCHAR site_id to INT pool_site_id
-- This cleanup follows migration 017 which added pool_site_id
--
-- Tables affected:
-- - simulation_runs: populate pool_site_id (was using site_id string)
-- - pools: drop site_id (already using pool_site_id)
--
-- NOTE: site_solar_hourly and site_solar_fetch_log already dropped site_id in migration 017
-- NOTE: pool_sites.site_id is KEPT as the source VARCHAR identifier

-- Phase 1: Populate pool_site_id for existing simulation_runs
-- Simple approach: only one pool exists, so set pool_site_id = 1 everywhere
UPDATE simulation_runs SET pool_site_id = 1 WHERE pool_site_id IS NULL;

-- Phase 2: Drop site_id column from pools table
DROP INDEX IF EXISTS `site_id` ON `pools`;
ALTER TABLE `pools` DROP COLUMN IF EXISTS `site_id`;

-- Ensure pool_site_id index exists on pools
CREATE INDEX IF NOT EXISTS `idx_pool_site_id` ON `pools` (`pool_site_id`);
