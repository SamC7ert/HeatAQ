-- Migration 027: Drop pool_sites.site_id VARCHAR column
-- Description: Remove redundant site_id - use pool_sites.id (INT PK) instead
--
-- Before: pool_sites has both id (INT PK) and site_id (VARCHAR)
-- After: pool_sites uses only id (INT PK), name for display
--
-- The INT pool_sites.id is the proper identifier (referenced as pool_site_id in other tables)
-- The VARCHAR site_id was confusing because it looked like a FK but was a display code

-- 1. Drop the unique index on site_id
DROP INDEX idx_site_code ON pool_sites;

-- 2. Drop the site_id column
ALTER TABLE pool_sites DROP COLUMN site_id;

-- 3. Verify the change
SELECT 'pool_sites columns after migration:' as info;
SHOW COLUMNS FROM pool_sites;
