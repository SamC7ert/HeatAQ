-- Migration 019: Drop site_id columns after verifying code works with pool_site_id
-- Run this AFTER migration 018 and testing that simulations work
-- Note: FK constraints already dropped in migration 018

-- 1. Drop site_id column from pools table
DROP INDEX IF EXISTS `site_id` ON `pools`;
ALTER TABLE `pools` DROP COLUMN IF EXISTS `site_id`;

-- Ensure pool_site_id index exists on pools
CREATE INDEX IF NOT EXISTS `idx_pool_site_id` ON `pools` (`pool_site_id`);

-- 2. Drop site_id column from simulation_runs table
DROP INDEX IF EXISTS `idx_site` ON `simulation_runs`;
DROP INDEX IF EXISTS `site_id` ON `simulation_runs`;
ALTER TABLE `simulation_runs` DROP COLUMN IF EXISTS `site_id`;
