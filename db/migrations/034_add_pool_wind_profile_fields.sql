-- 034: Add pool wind-profile fields
-- Description: reference height, terrain roughness, fence transmission on pools for the wind-profile transfer
--
-- Step 1 of the pool phase (see docs/WIND_CORRECTION.md). Additive and inert:
-- nothing reads these columns yet, and wind_exposure is deliberately left
-- untouched (its "NULL = computed" override reinterpretation lands in Step 3,
-- once the derivation exists). All three are nullable — they must be entered
-- deliberately in Step 2.
--
-- All are "what fraction of wind gets through" quantities (transmission), the
-- same convention as wind_exposure and the log-law transfer, so the derivation
-- is a clean product with no 1-x flips:
--   E = transmission_loglaw(z_s,z0_s,z_p,z0_p) * fence_wind_transmission

ALTER TABLE pools
    ADD COLUMN wind_reference_height_m DECIMAL(4,1) DEFAULT NULL
        COMMENT 'z_p: height at the pool to transfer wind to (m)'
        AFTER wind_exposure,
    ADD COLUMN terrain_roughness DECIMAL(6,4) DEFAULT NULL
        COMMENT 'z0_p: pool-site surface roughness length (m); same Davenport classes as weather_stations'
        AFTER wind_reference_height_m,
    ADD COLUMN fence_wind_transmission DECIMAL(4,3) DEFAULT NULL
        COMMENT 'Fraction of wind passing the fence (0.6 = 60% through / 40% sheltered); NULL = 1.0 (no fence)'
        AFTER terrain_roughness;

-- Verification query (run after migration)
-- SELECT pool_id, name, wind_exposure, wind_reference_height_m, terrain_roughness, fence_wind_transmission
-- FROM pools;
