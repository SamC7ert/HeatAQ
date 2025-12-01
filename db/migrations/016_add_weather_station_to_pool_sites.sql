-- Migration 016: Add weather_station_id to pool_sites
-- This links sites to weather stations for weather data

ALTER TABLE pool_sites
ADD COLUMN weather_station_id VARCHAR(50) NULL AFTER longitude;

-- Add index for lookups
CREATE INDEX idx_pool_sites_weather_station ON pool_sites(weather_station_id);
