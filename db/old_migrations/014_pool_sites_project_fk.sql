-- Migration 014: Clean up pools.site_id and add project_id FK to pool_sites
-- Date: 2024-12-01
--
-- Step 1 cleanup: Remove old VARCHAR site_id from pools (now using pool_site_id FK)
-- Step 2: Add project_id to pool_sites to link sites to projects
--
-- Final structure:
--   projects (1) --> (n) pool_sites (1) --> (n) pools

-- ============================================
-- STEP 1 CLEANUP: Remove site_id from pools
-- ============================================
-- First drop the FK constraint that references site_id
ALTER TABLE pools DROP FOREIGN KEY fk_pool_site;

-- Now drop the index
ALTER TABLE pools DROP INDEX idx_site;

-- Remove the old VARCHAR column (we now use pool_site_id INT FK)
ALTER TABLE pools DROP COLUMN site_id;

-- ============================================
-- STEP 2: Add project_id FK to pool_sites
-- ============================================
ALTER TABLE pool_sites
ADD COLUMN project_id INT NULL AFTER id,
ADD INDEX idx_project_id (project_id);

-- Populate project_id from existing projects.site_id relationship
-- (projects currently has site_id pointing to pool_sites.site_id)
UPDATE pool_sites ps
SET project_id = (
    SELECT p.project_id
    FROM projects p
    WHERE p.site_id = ps.site_id
    LIMIT 1
)
WHERE project_id IS NULL;

-- Add foreign key constraint
ALTER TABLE pool_sites
ADD CONSTRAINT fk_pool_sites_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL;
