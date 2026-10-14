-- 040: Electric boiler efficiency 0.99
-- Description: equipment.boiler_efficiency = 0.99 for every electric boiler in config_templates.json_config
--
-- Migration 039 made every boiler electric but kept the old efficiency
-- (typically 0.92, a gas value). An electric (resistance/electrode) boiler
-- converts practically all of its electricity to heat: datasheets give
-- >99 %, so 0.99 is used (decided 2026-10). New configurations already
-- default to 0.99.
--
-- Only rows whose boiler_type is 'electric' are changed (run 039 first);
-- other equipment values are kept. Re-running is harmless.

UPDATE config_templates
SET json_config = JSON_SET(json_config, '$.equipment.boiler_efficiency', 0.99)
WHERE JSON_VALID(json_config)
  AND JSON_VALUE(json_config, '$.equipment.boiler_type') = 'electric';

-- Verification query (run after migration): electric boilers show 0.99
-- SELECT template_id, template_name,
--        JSON_VALUE(json_config, '$.equipment.boiler_type') AS boiler_type,
--        JSON_VALUE(json_config, '$.equipment.boiler_efficiency') AS boiler_efficiency
-- FROM config_templates;
