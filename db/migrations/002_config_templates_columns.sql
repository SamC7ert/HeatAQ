-- Migration: Add missing columns to config_templates table
-- Date: 2025-11-26
-- Purpose: Ensure config_templates has all required columns for equipment configuration

-- Add json_config column if only config_json exists (rename/add for consistency)
-- Note: The API uses 'json_config' as the column name

-- Add json_config column (used by API - some databases might have config_json instead)
ALTER TABLE config_templates
ADD COLUMN IF NOT EXISTS json_config JSON DEFAULT NULL COMMENT 'Full configuration as JSON';

-- Add legacy columns for quick access (extracted from JSON for querying)
ALTER TABLE config_templates
ADD COLUMN IF NOT EXISTS hp_capacity_kw DECIMAL(8,2) DEFAULT NULL COMMENT 'Heat pump capacity in kW',
ADD COLUMN IF NOT EXISTS boiler_capacity_kw DECIMAL(8,2) DEFAULT NULL COMMENT 'Boiler capacity in kW',
ADD COLUMN IF NOT EXISTS target_temp DECIMAL(4,1) DEFAULT NULL COMMENT 'Target water temperature',
ADD COLUMN IF NOT EXISTS control_strategy VARCHAR(50) DEFAULT NULL COMMENT 'Control strategy (reactive, predictive, etc.)';

-- Add project_id column if missing (for linking configs to projects)
ALTER TABLE config_templates
ADD COLUMN IF NOT EXISTS project_id VARCHAR(50) DEFAULT NULL COMMENT 'Project this config belongs to';

-- If config_json exists but json_config doesn't, copy data
-- This handles cases where the original schema used config_json
-- Note: Run this manually if needed:
-- UPDATE config_templates SET json_config = config_json WHERE json_config IS NULL AND config_json IS NOT NULL;

-- Add index on project_id for faster lookups
-- ALTER TABLE config_templates ADD INDEX IF NOT EXISTS idx_project_id (project_id);
