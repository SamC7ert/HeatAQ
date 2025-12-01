-- Migration 012: Add solar data columns to pool_sites
-- These columns track the NASA POWER solar data fetch location and date range
-- Separate from main latitude/longitude to allow different solar data source location

ALTER TABLE pool_sites
    ADD COLUMN solar_latitude DECIMAL(10,6) NULL AFTER longitude,
    ADD COLUMN solar_longitude DECIMAL(10,6) NULL AFTER solar_latitude,
    ADD COLUMN solar_data_start DATE NULL AFTER solar_longitude,
    ADD COLUMN solar_data_end DATE NULL AFTER solar_data_start;

-- Copy existing lat/lon as defaults for solar location
UPDATE pool_sites
SET solar_latitude = latitude,
    solar_longitude = longitude
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
