-- 038: Store daily heat output (thermal kWh) per simulated day
-- Description: hp_thermal_kwh and boiler_thermal_kwh on simulation_daily_results
--
-- The simulator has always computed daily heat delivered by the heat pump and
-- boiler, and storeSimulationResults writes it when these columns exist, but
-- the live table never had them (the old migration 002 that added them is in
-- db/old_migrations only). Without them the yearly chart estimated heat as
-- electricity x 3.5 and fuel x 0.92, whatever the configured COP/efficiency.
--
-- NULL = not stored (runs from before this migration); the UI then shows
-- electricity, labelled as such, instead of an estimate. Re-run a simulation
-- to get its daily heat output.

ALTER TABLE simulation_daily_results
    ADD COLUMN IF NOT EXISTS hp_thermal_kwh DECIMAL(10,3) DEFAULT NULL
        COMMENT 'Heat delivered by the heat pump this day (kWh thermal)'
        AFTER total_boiler_kwh,
    ADD COLUMN IF NOT EXISTS boiler_thermal_kwh DECIMAL(10,3) DEFAULT NULL
        COMMENT 'Heat delivered by the boiler this day (kWh thermal)'
        AFTER hp_thermal_kwh;

-- Verification query (run after migration)
-- SHOW COLUMNS FROM simulation_daily_results LIKE '%thermal%';
