-- Migration: Create solar data tables linked to site_id
-- Date: 2025-11-26
-- Purpose: Store solar radiation data per site (both daily from NASA and calculated hourly)

-- ============================================
-- Daily solar data (raw from NASA API)
-- ============================================
CREATE TABLE IF NOT EXISTS site_solar_daily (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    daily_kwh_m2 DECIMAL(8,4) NOT NULL COMMENT 'Daily total kWh/m² (actual with clouds)',
    clear_sky_kwh_m2 DECIMAL(8,4) DEFAULT NULL COMMENT 'Clear sky kWh/m² (theoretical max)',
    cloud_factor DECIMAL(5,4) DEFAULT NULL COMMENT 'Actual/clear sky ratio (0-1)',

    -- Unique constraint: one record per site per day
    UNIQUE KEY uk_site_date (site_id, date),
    INDEX idx_site_date (site_id, date),

    FOREIGN KEY (site_id) REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- Hourly solar data (calculated from daily using solar position)
-- ============================================
CREATE TABLE IF NOT EXISTS site_solar_hourly (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    timestamp DATETIME NOT NULL,
    solar_wh_m2 DECIMAL(10,2) NOT NULL COMMENT 'Wh/m² for this hour (distributed from daily)',
    clear_sky_wh_m2 DECIMAL(10,2) DEFAULT NULL COMMENT 'Clear sky Wh/m² for reference',

    -- Unique constraint: one record per site per hour
    UNIQUE KEY uk_site_timestamp (site_id, timestamp),
    INDEX idx_site_timestamp (site_id, timestamp),
    INDEX idx_timestamp (timestamp),

    FOREIGN KEY (site_id) REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- Add solar location columns to pool_sites
-- ============================================
ALTER TABLE pool_sites
ADD COLUMN IF NOT EXISTS solar_latitude DECIMAL(9,6) DEFAULT NULL COMMENT 'Latitude for NASA solar data',
ADD COLUMN IF NOT EXISTS solar_longitude DECIMAL(9,6) DEFAULT NULL COMMENT 'Longitude for NASA solar data',
ADD COLUMN IF NOT EXISTS solar_data_start DATE DEFAULT NULL COMMENT 'Start of solar data coverage',
ADD COLUMN IF NOT EXISTS solar_data_end DATE DEFAULT NULL COMMENT 'End of solar data coverage';
