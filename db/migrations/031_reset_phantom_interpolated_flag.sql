-- 031: Reset wrongly-set is_interpolated flag on SN99840 2022-10-30 01:00
--
-- The gap-fill run on SN99840/2022 acted on a PHANTOM gap: the pre-UTC-fix
-- gap walk parsed naive timestamps in the server's local timezone, and at
-- the autumn DST changeover the ambiguous wall hour folded two rows onto
-- one epoch key, reporting 2022-10-30 01:00 as missing although the row
-- existed with measured values. The fill's COALESCE guarantee means the
-- measured values were never touched - only the is_interpolated flag was
-- set incorrectly. This resets it.
--
-- The three genuinely patched hours (2022-08-28 humidity) keep their flag.

UPDATE weather_data SET is_interpolated = 0
WHERE station_id = 'SN99840' AND timestamp = '2022-10-30 01:00:00';
