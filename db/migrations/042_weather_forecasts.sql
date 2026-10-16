-- 042: Weather forecasts for predictive control
-- Description: weather_forecasts table: archived forecasts per station, as they were issued
--
-- The predictive controller plans each night from the weather ahead. A run
-- can plan on the actual weather (hindsight) or on the forecasts that were
-- available at the time (docs/PREDICTIVE_CONTROL.md, Planning on forecasts).
-- This table holds those forecasts, interpolated to each weather station by
-- scripts/forecast/fetch_met_nordic.py and imported in Admin -> Weather.
--
-- One row per forecast run and forecast hour. All times UTC, like weather_data.
-- issued_at:    nominal run time (e.g. 12:00 for the 12 UTC run)
-- available_at: when the run could first be used (the file's creation time,
--               about 30 minutes after issued_at); a plan at hour T uses the
--               newest run with available_at <= T
-- valid_at:     the hour the values are for
--
-- Size: 4 runs a day x 49 hours = about 72,000 rows per station and year.

CREATE TABLE IF NOT EXISTS weather_forecasts (
    station_id VARCHAR(50) NOT NULL,
    source VARCHAR(30) NOT NULL COMMENT 'Forecast product, e.g. met_nordic',
    issued_at DATETIME NOT NULL COMMENT 'Nominal run time (UTC)',
    valid_at DATETIME NOT NULL COMMENT 'Hour the values are for (UTC)',
    available_at DATETIME NOT NULL COMMENT 'When the run could first be used (UTC)',
    air_temperature DECIMAL(5,2) NOT NULL COMMENT '°C at 2 m, corrected to station height',
    wind_speed DECIMAL(5,2) NOT NULL COMMENT 'm/s at 10 m',
    humidity DECIMAL(4,1) NOT NULL COMMENT 'Relative humidity, %',
    cloud_cover TINYINT UNSIGNED NULL COMMENT 'Cloud cover, %',
    solar_w_m2 DECIMAL(6,1) NULL COMMENT 'Mean downwelling shortwave over the hour ending at valid_at',
    PRIMARY KEY (station_id, source, issued_at, valid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Archived weather forecasts per station (scripts/forecast)';

-- Verification query (run after migration)
-- SHOW CREATE TABLE weather_forecasts;
