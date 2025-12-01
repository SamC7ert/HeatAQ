-- Migration 015: Remove site_id from projects table
-- Date: 2024-12-01
--
-- Step 3 of database structure fix:
-- The relationship is now: projects <- pool_sites <- pools
-- (pool_sites.project_id links to projects, pools.pool_site_id links to pool_sites)
--
-- projects.site_id is now redundant and confusing - remove it
--
-- Final clean structure:
--   projects: project_id, project_name, description, is_active
--   pool_sites: id, site_id, project_id (FK), name, lat/lng, etc.
--   pools: pool_id, pool_site_id (FK), name, dimensions, etc.

-- First check and drop any FK constraints on site_id
-- (The FK constraint name may vary - try common patterns)
ALTER TABLE projects DROP FOREIGN KEY IF EXISTS fk_projects_site;
ALTER TABLE projects DROP FOREIGN KEY IF EXISTS fk_project_site;
ALTER TABLE projects DROP FOREIGN KEY IF EXISTS projects_ibfk_1;

-- Drop the index on site_id
ALTER TABLE projects DROP INDEX IF EXISTS idx_site;
ALTER TABLE projects DROP INDEX IF EXISTS idx_site_id;

-- Remove site_id column from projects (relationship now via pool_sites.project_id)
ALTER TABLE projects DROP COLUMN site_id;

-- Drop index on project_code if exists
ALTER TABLE projects DROP INDEX IF EXISTS idx_code;
ALTER TABLE projects DROP INDEX IF EXISTS project_code;

-- Remove project_code (unclear purpose, redundant)
ALTER TABLE projects DROP COLUMN project_code;
