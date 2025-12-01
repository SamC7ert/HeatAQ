-- Migration 013: Fix pools table to use proper FK to pool_sites
-- Date: 2024-12-01
--
-- Problem: pools.site_id is VARCHAR that text-matches pool_sites.site_id
-- Solution: Add pool_site_id INT as proper FK to pool_sites.id
--
-- This is Step 1 of database structure fix:
-- Step 1: pools -> pool_sites (this migration)
-- Step 2: pool_sites -> projects (next migration)
-- Step 3: Clean up projects table

-- Step 1a: Add the new FK column
ALTER TABLE pools
ADD COLUMN pool_site_id INT NULL AFTER site_id,
ADD INDEX idx_pool_site_id (pool_site_id);

-- Step 1b: Populate from existing VARCHAR site_id match
UPDATE pools p
SET pool_site_id = (
    SELECT ps.id
    FROM pool_sites ps
    WHERE ps.site_id = p.site_id
    LIMIT 1
)
WHERE pool_site_id IS NULL;

-- Step 1c: Add foreign key constraint
ALTER TABLE pools
ADD CONSTRAINT fk_pools_pool_site
    FOREIGN KEY (pool_site_id) REFERENCES pool_sites(id) ON DELETE CASCADE;

-- Note: Keep old site_id column for now as fallback
-- Can be removed in a future cleanup migration after code is updated
