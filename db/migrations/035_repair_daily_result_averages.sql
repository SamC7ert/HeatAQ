-- 035: Repair daily averages stored as sums in simulation_daily_results
--
-- Before simulator 3.12.1 every day except the last stored the SUM of its
-- hourly air and water temperatures in avg_air_temp / avg_water_temp
-- (only the final day was divided by its hour count). A real daily average
-- water temperature is never above 45 C, so a multi-hour row above that is a
-- sum: divide both columns by hours_count. Rows already correct are untouched,
-- so the migration is safe to run more than once.

UPDATE simulation_daily_results
SET avg_air_temp = ROUND(avg_air_temp / hours_count, 2),
    avg_water_temp = ROUND(avg_water_temp / hours_count, 2)
WHERE hours_count > 1 AND avg_water_temp > 45;
