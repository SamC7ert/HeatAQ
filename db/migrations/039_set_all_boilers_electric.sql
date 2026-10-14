-- 039: Set every configuration's boiler to electric
-- Description: equipment.boiler_type = 'electric' in all config_templates.json_config
--
-- Simulator 3.16 added the boiler type (V236). A config without a type runs
-- as a fossil-fuel boiler (priced at the gas/oil price, kept out of the
-- electricity total), as before. All boilers in use are electric, so this
-- sets the type on every existing configuration: boiler input then counts
-- as electricity, priced at the electricity price.
--
-- Only boiler_type changes; other equipment values (including the boiler
-- efficiency) are kept. Rows whose json_config is not a JSON object are
-- left alone (see the verification query).
-- Re-running is harmless (sets the same value again).

UPDATE config_templates
SET json_config = JSON_SET(
        json_config,
        '$.equipment',
        JSON_MERGE_PATCH(
            COALESCE(JSON_EXTRACT(json_config, '$.equipment'), JSON_OBJECT()),
            JSON_OBJECT('boiler_type', 'electric')
        )
    )
WHERE JSON_VALID(json_config) AND JSON_TYPE(json_config) = 'OBJECT';

-- Verification query (run after migration): every row should say 'electric'
-- SELECT template_id, template_name,
--        JSON_VALUE(json_config, '$.equipment.boiler_type') AS boiler_type,
--        JSON_VALUE(json_config, '$.equipment.boiler_efficiency') AS boiler_efficiency
-- FROM config_templates;
