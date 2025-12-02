-- Migration 025: Add terrain roughness to weather stations
-- Date: 2024-12-02
--
-- Terrain roughness (z0) affects wind profile calculations
-- Typical values:
--   0.0002 = water/ice
--   0.03   = open terrain (grass, few trees)
--   0.1    = suburban (scattered buildings)
--   0.5    = urban (dense buildings)
--   1.0    = city center (tall buildings)

ALTER TABLE weather_stations
ADD COLUMN IF NOT EXISTS terrain_roughness DECIMAL(5,3) DEFAULT 0.03
COMMENT 'Surface roughness length (z0) in meters for wind profile calculations';

-- Update existing stations with reasonable defaults
UPDATE weather_stations
SET terrain_roughness = 0.03
WHERE terrain_roughness IS NULL;
