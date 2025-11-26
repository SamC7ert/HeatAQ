-- Migration: Create solar_hourly_data table linked to site_id
-- Date: 2025-11-26
-- Purpose: Store pre-calculated hourly solar radiation data per site

-- Create solar_hourly_data table
CREATE TABLE IF NOT EXISTS solar_hourly_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    timestamp DATETIME NOT NULL,
    solar_radiation_wh_m2 DECIMAL(10,2) NOT NULL COMMENT 'Wh/m² for this hour (energy, not power)',
    solar_clear_sky_wh_m2 DECIMAL(10,2) DEFAULT NULL COMMENT 'Clear sky Wh/m² for reference',
    cloud_factor DECIMAL(5,4) DEFAULT NULL COMMENT 'Actual/clear sky ratio',

    -- Indexes for fast lookups
    INDEX idx_site_timestamp (site_id, timestamp),
    INDEX idx_timestamp (timestamp),

    -- Foreign key to pool_sites
    FOREIGN KEY (site_id) REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add solar location columns to pool_sites if not exists
-- (latitude/longitude may already exist, this ensures they do)
ALTER TABLE pool_sites
ADD COLUMN IF NOT EXISTS solar_latitude DECIMAL(9,6) DEFAULT NULL COMMENT 'Latitude for NASA solar data',
ADD COLUMN IF NOT EXISTS solar_longitude DECIMAL(9,6) DEFAULT NULL COMMENT 'Longitude for NASA solar data',
ADD COLUMN IF NOT EXISTS solar_data_start DATE DEFAULT NULL COMMENT 'Start of solar data coverage',
ADD COLUMN IF NOT EXISTS solar_data_end DATE DEFAULT NULL COMMENT 'End of solar data coverage';

-- Create index on date for daily aggregation queries
CREATE INDEX IF NOT EXISTS idx_solar_hourly_date ON solar_hourly_data (site_id, DATE(timestamp));
