-- Migration 018: Populate pool_site_id for existing simulation_runs
-- Simple approach: only one pool exists, so set pool_site_id = 1 everywhere
UPDATE simulation_runs SET pool_site_id = 1 WHERE pool_site_id IS NULL;

-- Verify
SELECT COUNT(*) as rows_without_pool_site_id FROM simulation_runs WHERE pool_site_id IS NULL;
