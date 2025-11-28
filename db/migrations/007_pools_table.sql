-- Pools Table Migration
-- Migration: 007_pools_table.sql
-- Date: 2024-11-28
-- Description: Creates pools table to store physical pool data per site
-- Allows multiple pools per site with Site → Pool hierarchy

-- ============================================
-- POOLS TABLE
-- Stores physical pool data
-- Each site can have multiple pools
-- ============================================
CREATE TABLE IF NOT EXISTS pools (
    pool_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,           -- FK to pool_sites

    -- Pool identification
    name VARCHAR(100) NOT NULL DEFAULT 'Main Pool',
    description TEXT,

    -- Physical dimensions
    length_m DECIMAL(6,2) DEFAULT 25.0,      -- Length in meters
    width_m DECIMAL(6,2) DEFAULT 12.5,       -- Width in meters
    depth_m DECIMAL(4,2) DEFAULT 2.0,        -- Average depth in meters
    area_m2 DECIMAL(8,2) DEFAULT 312.5,      -- Surface area (calculated)
    volume_m3 DECIMAL(10,2) DEFAULT 625.0,   -- Volume (calculated)

    -- Environmental factors
    wind_exposure DECIMAL(4,3) DEFAULT 0.535,      -- 0.0-1.0 exposure factor
    solar_absorption DECIMAL(4,1) DEFAULT 60.0,    -- % absorption (0-100)
    years_operating INT DEFAULT 3,                  -- Years since opening

    -- Cover properties
    has_cover TINYINT(1) DEFAULT 1,
    cover_r_value DECIMAL(4,2) DEFAULT 5.0,        -- R-value m²K/W
    cover_solar_transmittance DECIMAL(4,2) DEFAULT 10.0, -- % transmission

    -- Structure
    has_tunnel TINYINT(1) DEFAULT 1,               -- Air gap/tunnel above water
    floor_insulated TINYINT(1) DEFAULT 1,          -- Floor insulation

    -- Pool type
    pool_type ENUM('outdoor', 'indoor', 'semi-enclosed') DEFAULT 'outdoor',

    -- Audit
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_site (site_id),
    INDEX idx_active (is_active),

    -- Foreign key
    CONSTRAINT fk_pool_site FOREIGN KEY (site_id)
        REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- Insert default pool for existing site
-- ============================================
INSERT INTO pools (site_id, name, length_m, width_m, depth_m, area_m2, volume_m3,
                   wind_exposure, solar_absorption, years_operating,
                   has_cover, cover_r_value, cover_solar_transmittance,
                   has_tunnel, floor_insulated)
SELECT
    site_id,
    CONCAT(name, ' - Main Pool'),
    25.0,      -- length
    12.5,      -- width
    2.0,       -- depth
    312.5,     -- area
    625.0,     -- volume
    0.535,     -- wind_exposure
    60.0,      -- solar_absorption
    3,         -- years_operating
    1,         -- has_cover
    5.0,       -- cover_r_value
    10.0,      -- cover_solar_transmittance
    1,         -- has_tunnel
    1          -- floor_insulated
FROM pool_sites
WHERE NOT EXISTS (SELECT 1 FROM pools p WHERE p.site_id = pool_sites.site_id);

-- ============================================
-- Add pool_id to simulation_runs for tracking which pool
-- ============================================
ALTER TABLE simulation_runs
ADD COLUMN pool_id INT NULL AFTER site_id,
ADD INDEX idx_pool_id (pool_id);
-- Note: FK constraint optional since existing runs won't have pool_id
-- ADD CONSTRAINT fk_sim_pool FOREIGN KEY (pool_id) REFERENCES pools(pool_id) ON DELETE SET NULL;

-- ============================================
-- Add pool_id to config_templates
-- ============================================
ALTER TABLE config_templates
ADD COLUMN pool_id INT NULL AFTER project_id,
ADD INDEX idx_config_pool (pool_id);
