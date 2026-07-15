-- 032: Add water_temp_start to simulation_hourly_results
-- Description: Persist start-of-hour water temp so the single-hour debug view reconciles with stored losses
--
-- The simulation computes each hour's heat losses on the START-of-hour water
-- temperature, then updates the temperature and stores the END-of-hour value in
-- `water_temp`. The single-hour debug/reconcile view fed `water_temp` (end) back
-- into the loss recompute, so on hours where the water temperature moves within
-- the hour (peak/under-supplied hours) the recomputed losses could not match the
-- stored `total_loss_kw` (computed at the start temp). This surfaced as a phantom
-- "Net demand differs by X kW" warning on the details page.
--
-- Persisting the start-of-hour temperature lets the debug view recompute at the
-- same temperature the simulation used, so Stored == Calculated for new runs.
--
-- Nullable: existing rows keep NULL and the debug path falls back to `water_temp`
-- (current behaviour) until those runs are re-simulated.

ALTER TABLE simulation_hourly_results
    ADD COLUMN water_temp_start DECIMAL(5,2) DEFAULT NULL
        COMMENT 'Start-of-hour water temp used to compute this hour''s losses'
        AFTER water_temp;

-- Verification query (run after migration)
-- SELECT timestamp, water_temp_start, water_temp, total_loss_kw
-- FROM simulation_hourly_results
-- WHERE water_temp_start IS NOT NULL
-- ORDER BY timestamp LIMIT 5;
