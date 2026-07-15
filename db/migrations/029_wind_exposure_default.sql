-- 029: Align pools.wind_exposure column DEFAULT with the code default (0.5)
--
-- Code-level defaults (create_project seed, pool edit form, JS fallbacks)
-- were changed from 0.535 to 0.5 in V207. The schema-level column default
-- was still 0.535, so any INSERT that omits the column (manual SQL, future
-- endpoints, migrations) would silently get the old value.
--
-- This migration changes ONLY the column default. It deliberately does NOT
-- update existing rows: pools 1 (Hisøy) and 3 (Arendal) keep their stored
-- 0.535 by explicit decision, and pool 4 (Svalbard) is already 0.5.

ALTER TABLE pools ALTER wind_exposure SET DEFAULT 0.5;
