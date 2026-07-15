-- 031 (v2): Reset wrongly-set is_interpolated flag on SN38140 2022-10-30 01:00
--
-- REVISED before first run - the original version targeted SN99840, which
-- turned out to be WRONG. Classification of all flagged rows (July 2026):
--
--   SN38140 2022-04-19 18:00  genuine fill (Landvik's pre-fill deficit was
--                             exactly 49 h = 2 x Dec-31 + this hour)  KEEP
--   SN38140 2022-10-30 01:00  PHANTOM - the pre-UTC-fix gap walk misread the
--                             DST changeover; the row existed with measured
--                             values (fill's COALESCE never touched them,
--                             only the flag was set)                  RESET
--   SN99840 2022-08-28 x3     genuine humidity patches                KEEP
--   SN99840 2022-10-30 01:00  genuine fill - Svalbard's gap arithmetic
--                             (9010 = 8784 + 9x24 + 10x1) shows real 1-hour
--                             October holes each year incl. 2022      KEEP
--
-- Note: the Frost fetch now clears is_interpolated when it writes real
-- measured values, so re-running Update Data will self-heal any flag where
-- Frost can supply the hour.

UPDATE weather_data SET is_interpolated = 0
WHERE station_id = 'SN38140' AND timestamp = '2022-10-30 01:00:00';
