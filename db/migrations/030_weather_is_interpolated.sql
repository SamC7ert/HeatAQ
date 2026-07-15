-- 030: Flag interpolated weather rows
--
-- The gap-fill feature (Admin -> Weather Stations) reconstructs missing
-- hours / NULL fields with a diurnal-profile interpolation. Reconstructed
-- values must stay distinguishable from measurements forever, so every
-- value written by the filler carries this flag. Measured rows keep 0.

ALTER TABLE weather_data ADD COLUMN is_interpolated TINYINT(1) NOT NULL DEFAULT 0;
