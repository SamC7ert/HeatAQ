-- 033: Widen weather_stations.terrain_roughness precision
-- Description: DECIMAL(5,3) -> DECIMAL(6,4) so canonical low roughness (water z0=0.0002) is storable
--
-- terrain_roughness (z0) feeds the log-law wind-profile transfer (see
-- docs/WIND_CORRECTION.md). DECIMAL(5,3) can only hold 3 decimals, so the
-- canonical "water/ice" value 0.0002 truncates to 0.000 — which would make
-- z0 = 0 and break ln(z/z0). Widening to DECIMAL(6,4) makes the terrain-class
-- values (down to 0.0002) storable without changing any existing value.

ALTER TABLE weather_stations
    MODIFY COLUMN terrain_roughness DECIMAL(6,4) DEFAULT 0.0300
        COMMENT 'Surface roughness length (z0) in meters for wind-profile transfer';

-- Verification query (run after migration)
-- SELECT station_id, station_name, wind_height_m, terrain_roughness FROM weather_stations;
