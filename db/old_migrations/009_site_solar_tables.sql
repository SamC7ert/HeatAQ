-- Site Solar Tables Migration
-- Migration: 009_site_solar_tables.sql
-- Date: 2024-11-28
-- Description: Creates tables for storing NASA POWER solar data per site

-- ============================================
-- SITE SOLAR DAILY
-- Daily solar radiation totals per site
-- ============================================
CREATE TABLE IF NOT EXISTS site_solar_daily (
    site_id VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    daily_kwh_m2 DECIMAL(6,4),           -- Actual daily solar (kWh/m²)
    clear_sky_kwh_m2 DECIMAL(6,4),       -- Clear sky daily solar (kWh/m²)
    cloud_factor DECIMAL(4,3),            -- Ratio actual/clear_sky (0-1)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (site_id, date),
    INDEX idx_date (date),
    INDEX idx_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SITE SOLAR HOURLY
-- Hourly solar radiation values per site
-- Derived from daily data using solar position calculation
-- ============================================
CREATE TABLE IF NOT EXISTS site_solar_hourly (
    site_id VARCHAR(50) NOT NULL,
    timestamp DATETIME NOT NULL,
    solar_wh_m2 DECIMAL(8,2),            -- Actual hourly solar (Wh/m²)
    clear_sky_wh_m2 DECIMAL(8,2),        -- Clear sky hourly solar (Wh/m²)

    PRIMARY KEY (site_id, timestamp),
    INDEX idx_timestamp (timestamp),
    INDEX idx_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
