-- Migration: Consolidate JSON columns in config_templates
-- Date: 2024-11-27
-- Issue: Table has both 'json_config' and 'config_json' columns causing confusion
--
-- BEFORE RUNNING: Backup your database!
-- This migration copies data from config_json to json_config where needed,
-- then marks config_json as deprecated.

-- Step 1: Copy data from config_json to json_config where json_config is empty/null
UPDATE config_templates
SET json_config = config_json
WHERE (json_config IS NULL OR json_config = '' OR json_config = '{}')
  AND config_json IS NOT NULL
  AND config_json != ''
  AND config_json != '{}';

-- Step 2: Verify the migration worked
-- Run this SELECT to check all configs have json_config populated:
-- SELECT template_id, template_name,
--        LENGTH(json_config) as json_config_len,
--        LENGTH(config_json) as config_json_len
-- FROM config_templates;

-- Step 3 (OPTIONAL - only after verification):
-- Once verified, you can drop the legacy column:
-- ALTER TABLE config_templates DROP COLUMN config_json;

-- Note: The API (heataq_api.php) uses json_config as the primary column.
-- The duplicate columns (hp_capacity_kw, boiler_capacity_kw, etc.) are kept
-- for backward compatibility and quick SQL queries, but json_config is the
-- source of truth.

-- Document the intended structure:
-- json_config should contain:
-- {
--   "equipment": {
--     "hp_capacity_kw": 125.0,
--     "boiler_capacity_kw": 100.0,
--     "hp_cop": 4.5,
--     "hp_min_temp": -5,
--     "hp_max_temp": 35,
--     "boiler_efficiency": 0.92
--   },
--   "control": {
--     "target_temp": 28.0,
--     "strategy": "reactive"
--   },
--   "cost": {
--     "electricity_per_kwh": 1.20,
--     "fuel_per_kwh": 0.80
--   },
--   "pool": {
--     "area_m2": 312.5,
--     "volume_m3": 625.0,
--     ...
--   }
-- }
