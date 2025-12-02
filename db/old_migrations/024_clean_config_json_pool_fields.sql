-- Migration 024: Remove pool physical properties from config_templates json_config
--
-- Pool properties like has_cover, has_tunnel belong in the pools table,
-- not in config templates. Config templates should only contain:
-- - equipment (heat pump, boiler settings)
-- - control (strategy, target temp)
-- - bathers (visitor settings)
--
-- This migration removes pool/cover/solar sections from json_config to prevent
-- config templates from overriding pool physical properties.

-- Remove pool section from json_config
UPDATE config_templates
SET json_config = JSON_REMOVE(json_config, '$.pool')
WHERE json_config IS NOT NULL
  AND JSON_CONTAINS_PATH(json_config, 'one', '$.pool');

-- Remove cover section from json_config
UPDATE config_templates
SET json_config = JSON_REMOVE(json_config, '$.cover')
WHERE json_config IS NOT NULL
  AND JSON_CONTAINS_PATH(json_config, 'one', '$.cover');

-- Remove solar section from json_config (solar absorption is a pool property)
UPDATE config_templates
SET json_config = JSON_REMOVE(json_config, '$.solar')
WHERE json_config IS NOT NULL
  AND JSON_CONTAINS_PATH(json_config, 'one', '$.solar');

-- Verify cleanup
-- SELECT template_id, template_name, json_config FROM config_templates;
