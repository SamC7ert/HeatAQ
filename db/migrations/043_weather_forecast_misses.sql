-- 043: Forecast runs not found in the archive
-- Description: weather_forecast_misses table: runs MET's archive did not have when fetched, and how often they were tried
--
-- MET's archive sometimes answers "not found" for a run it has (a passing
-- fault on its server), and some runs are really missing. The fetch (Admin
-- -> Weather -> Weather Forecasts) records each miss here and tries the run
-- again later; after MetNordicForecast::MAX_ATTEMPTS tries the run counts as
-- not in the archive and is not asked for again. A run fetched later is
-- removed from this table.

CREATE TABLE IF NOT EXISTS weather_forecast_misses (
    station_id VARCHAR(50) NOT NULL,
    source VARCHAR(30) NOT NULL COMMENT 'Forecast product, e.g. met_nordic',
    issued_at DATETIME NOT NULL COMMENT 'Nominal run time (UTC)',
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Fetches that found no run',
    last_tried_at DATETIME NOT NULL COMMENT 'Last attempt (UTC)',
    PRIMARY KEY (station_id, source, issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Forecast runs not found in the archive, with attempts';

-- Verification query (run after migration)
-- SHOW CREATE TABLE weather_forecast_misses;
