-- HeatAQ Simulation Database Schema
-- Run this SQL to add simulation tables to your existing database
-- Version: 1.0.0
-- Date: 2024

-- ============================================
-- SIMULATION RUNS TABLE
-- Stores metadata for each simulation run
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_runs (
    run_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    user_id INT NULL,

    -- Run identification
    scenario_name VARCHAR(255) NOT NULL DEFAULT 'Unnamed Scenario',
    description TEXT,

    -- Simulation period
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    -- Status tracking
    status ENUM('pending', 'running', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,

    -- Configuration snapshot (JSON)
    -- Stores pool_config, equipment settings at time of simulation
    config_snapshot JSON,

    -- Summary results (JSON)
    -- Stores aggregated totals and averages
    summary_json JSON,

    -- Indexes
    INDEX idx_site_id (site_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at),

    -- Foreign key (optional - depends on your schema)
    -- FOREIGN KEY (site_id) REFERENCES pool_sites(site_id)
    CONSTRAINT fk_sim_run_site FOREIGN KEY (site_id)
        REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SIMULATION DAILY RESULTS TABLE
-- Stores daily aggregated results
-- ~3,653 rows per 10-year simulation
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_daily_results (
    result_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id INT NOT NULL,
    date DATE NOT NULL,

    -- Time tracking
    hours_count TINYINT NOT NULL DEFAULT 24,
    open_hours TINYINT NOT NULL DEFAULT 0,

    -- Average conditions
    avg_air_temp DECIMAL(5,2),
    avg_water_temp DECIMAL(5,2),

    -- Energy totals (kWh)
    total_loss_kwh DECIMAL(10,3) NOT NULL DEFAULT 0,
    total_solar_kwh DECIMAL(10,3) NOT NULL DEFAULT 0,
    total_hp_kwh DECIMAL(10,3) NOT NULL DEFAULT 0,      -- HP electricity consumed
    total_boiler_kwh DECIMAL(10,3) NOT NULL DEFAULT 0,  -- Boiler fuel consumed

    -- Cost (NOK)
    total_cost DECIMAL(10,2) NOT NULL DEFAULT 0,

    -- Indexes
    INDEX idx_run_id (run_id),
    INDEX idx_date (date),
    UNIQUE INDEX idx_run_date (run_id, date),

    -- Foreign key
    CONSTRAINT fk_daily_run FOREIGN KEY (run_id)
        REFERENCES simulation_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SIMULATION HOURLY RESULTS TABLE
-- Stores detailed hourly results
-- ~87,672 rows per 10-year simulation
-- Consider partitioning for very large datasets
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_hourly_results (
    result_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id INT NOT NULL,
    timestamp DATETIME NOT NULL,

    -- Weather conditions
    air_temp DECIMAL(5,2),
    wind_speed DECIMAL(5,2),
    humidity DECIMAL(5,2),
    solar_kwh_m2 DECIMAL(8,5),

    -- Pool state
    target_temp DECIMAL(4,1) NULL,  -- NULL when closed
    water_temp DECIMAL(5,2),
    is_open TINYINT(1) NOT NULL DEFAULT 0,

    -- Heat losses (kW)
    total_loss_kw DECIMAL(8,3),

    -- Heat gains (kW)
    solar_gain_kw DECIMAL(8,3),
    hp_heat_kw DECIMAL(8,3),
    boiler_heat_kw DECIMAL(8,3),

    -- Energy consumption (kWh)
    hp_electricity_kwh DECIMAL(8,3),
    boiler_fuel_kwh DECIMAL(8,3),
    hp_cop DECIMAL(4,2),

    -- Cost (NOK)
    cost DECIMAL(8,2),

    -- Indexes
    INDEX idx_run_id (run_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_run_timestamp (run_id, timestamp),

    -- Foreign key
    CONSTRAINT fk_hourly_run FOREIGN KEY (run_id)
        REFERENCES simulation_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- POOL CONFIGURATIONS TABLE
-- Stores pool physical parameters
-- May already exist in your database
-- ============================================
CREATE TABLE IF NOT EXISTS pool_configurations (
    config_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,

    -- Pool dimensions
    area_m2 DECIMAL(8,2) NOT NULL DEFAULT 312.5,      -- Surface area
    volume_m3 DECIMAL(10,2) NOT NULL DEFAULT 625,     -- Total volume
    depth_m DECIMAL(5,2) NOT NULL DEFAULT 2.0,        -- Average depth
    perimeter_m DECIMAL(8,2) NOT NULL DEFAULT 75,     -- Perimeter length

    -- Pool features
    has_cover TINYINT(1) NOT NULL DEFAULT 0,
    has_tunnel TINYINT(1) NOT NULL DEFAULT 1,
    cover_r_value DECIMAL(5,2) DEFAULT 0,
    wind_exposure_factor DECIMAL(3,2) NOT NULL DEFAULT 1.0,

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    UNIQUE INDEX idx_site_id (site_id),

    -- Foreign key
    CONSTRAINT fk_pool_config_site FOREIGN KEY (site_id)
        REFERENCES pool_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- CONFIG TEMPLATES TABLE
-- Stores equipment configurations as JSON
-- May already exist in your database
-- ============================================
CREATE TABLE IF NOT EXISTS config_templates (
    template_id INT AUTO_INCREMENT PRIMARY KEY,
    site_id VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Equipment configuration (JSON)
    config_json JSON,

    -- Status
    is_active TINYINT(1) NOT NULL DEFAULT 1,

    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_site_id (site_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- EXAMPLE: Insert default pool configuration
-- ============================================
-- INSERT INTO pool_configurations (site_id, area_m2, volume_m3, depth_m, perimeter_m, has_tunnel)
-- VALUES ('arendal_aquatic', 312.5, 625, 2.0, 75, 1);

-- ============================================
-- EXAMPLE: Insert default equipment configuration
-- ============================================
-- INSERT INTO config_templates (site_id, name, config_json) VALUES (
--     'arendal_aquatic',
--     'Default Equipment',
--     '{
--         "heat_pump": {
--             "enabled": true,
--             "capacity_kw": 50,
--             "cop_nominal": 4.5,
--             "min_operating_temp": -5,
--             "max_operating_temp": 35
--         },
--         "boiler": {
--             "enabled": true,
--             "capacity_kw": 100,
--             "efficiency": 0.92,
--             "fuel_type": "natural_gas",
--             "fuel_cost_per_kwh": 0.08
--         },
--         "electricity_cost_per_kwh": 1.20,
--         "control_strategy": "hp_priority"
--     }'
-- );

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- Monthly summary view
CREATE OR REPLACE VIEW v_simulation_monthly_summary AS
SELECT
    sr.run_id,
    sr.scenario_name,
    YEAR(sdr.date) as year,
    MONTH(sdr.date) as month,
    SUM(sdr.hours_count) as total_hours,
    SUM(sdr.open_hours) as open_hours,
    AVG(sdr.avg_air_temp) as avg_air_temp,
    AVG(sdr.avg_water_temp) as avg_water_temp,
    SUM(sdr.total_loss_kwh) as total_loss_kwh,
    SUM(sdr.total_solar_kwh) as total_solar_kwh,
    SUM(sdr.total_hp_kwh) as total_hp_kwh,
    SUM(sdr.total_boiler_kwh) as total_boiler_kwh,
    SUM(sdr.total_cost) as total_cost
FROM simulation_runs sr
JOIN simulation_daily_results sdr ON sr.run_id = sdr.run_id
GROUP BY sr.run_id, YEAR(sdr.date), MONTH(sdr.date);

-- Yearly summary view
CREATE OR REPLACE VIEW v_simulation_yearly_summary AS
SELECT
    sr.run_id,
    sr.scenario_name,
    YEAR(sdr.date) as year,
    SUM(sdr.hours_count) as total_hours,
    SUM(sdr.open_hours) as open_hours,
    AVG(sdr.avg_air_temp) as avg_air_temp,
    AVG(sdr.avg_water_temp) as avg_water_temp,
    SUM(sdr.total_loss_kwh) as total_loss_kwh,
    SUM(sdr.total_solar_kwh) as total_solar_kwh,
    SUM(sdr.total_hp_kwh) as total_hp_kwh,
    SUM(sdr.total_boiler_kwh) as total_boiler_kwh,
    SUM(sdr.total_cost) as total_cost
FROM simulation_runs sr
JOIN simulation_daily_results sdr ON sr.run_id = sdr.run_id
GROUP BY sr.run_id, YEAR(sdr.date);

-- ============================================
-- STORAGE ESTIMATES
-- ============================================
-- For 10 years of hourly data (87,672 rows):
-- - simulation_hourly_results: ~7-10 MB per run
-- - simulation_daily_results: ~100 KB per run
-- - simulation_runs: ~2 KB per run
--
-- Recommendation for high-volume usage:
-- - Consider archiving old runs after analysis
-- - Use table partitioning by run_id or year
-- - Implement data retention policy
