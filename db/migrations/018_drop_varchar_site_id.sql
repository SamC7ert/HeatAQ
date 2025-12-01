-- Migration 018: Prepare for pool_site_id migration
-- Step 1: Drop FK constraints that require site_id
ALTER TABLE `simulation_runs` DROP FOREIGN KEY IF EXISTS `fk_sim_run_site`;
ALTER TABLE `pools` DROP FOREIGN KEY IF EXISTS `fk_pool_site`;

-- Step 2: Populate pool_site_id for existing simulation_runs
UPDATE simulation_runs SET pool_site_id = 1 WHERE pool_site_id IS NULL;

-- Verify
SELECT COUNT(*) as rows_without_pool_site_id FROM simulation_runs WHERE pool_site_id IS NULL;
