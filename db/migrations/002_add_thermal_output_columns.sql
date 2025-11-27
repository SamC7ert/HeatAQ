-- Migration: Add thermal output columns to simulation_daily_results
-- Date: 2025-11-27
-- Purpose: Store thermal output (kWh) alongside electricity/fuel consumed
--          This allows charts to show heat delivered vs energy consumed

-- Add thermal output columns to simulation_daily_results
ALTER TABLE simulation_daily_results
ADD COLUMN IF NOT EXISTS hp_thermal_kwh DECIMAL(10,3) NOT NULL DEFAULT 0
    COMMENT 'HP thermal output (heat delivered) in kWh' AFTER total_boiler_kwh,
ADD COLUMN IF NOT EXISTS boiler_thermal_kwh DECIMAL(10,3) NOT NULL DEFAULT 0
    COMMENT 'Boiler thermal output (heat delivered) in kWh' AFTER hp_thermal_kwh;

-- Note: Existing simulations will have 0 for thermal columns
-- Re-run simulations to populate thermal data
