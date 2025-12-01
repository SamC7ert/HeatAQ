<?php
/**
 * HeatAQ Energy Simulator
 *
 * Calculates pool energy requirements based on:
 * - Weather data (temperature, wind, humidity, solar)
 * - Pool configuration (area, volume, depth)
 * - Schedule (target temperatures by hour)
 * - Equipment (heat pump, boiler capacities)
 *
 * Heat Loss Components:
 * - Evaporation (dominant for outdoor pools)
 * - Convection (wind-dependent)
 * - Radiation (to sky)
 * - Conduction (to ground)
 * - Tunnel effects (if applicable)
 *
 * Heat Gain Components:
 * - Solar radiation
 * - Heat pump
 * - Boiler
 *
 * Version History:
 * - 3.7.0: Initial PHP port from Python v3.6.0.3
 *          Config UI with all parameters, DB-backed schedules
 */

class EnergySimulator {
    // Simulator version - update when calculation logic changes
    const VERSION = '3.8.0';

    private $db;
    private $siteId;
    private $poolSiteId;  // INT pool_site_id for solar tables
    private $scheduler;

    // Pool physical parameters
    private $poolConfig;

    // Equipment parameters
    private $equipment;

    // Physical constants
    const WATER_DENSITY = 1000;      // kg/m³
    const WATER_SPECIFIC_HEAT = 4186; // J/(kg·K)
    const STEFAN_BOLTZMANN = 5.67e-8; // W/(m²·K⁴)
    const WATER_EMISSIVITY = 0.95;
    const LATENT_HEAT_VAPORIZATION = 2.45e6; // J/kg at ~20°C

    /**
     * Initialize simulator
     *
     * @param PDO $db Database connection
     * @param int $poolSiteId Integer pool_site_id (references pool_sites.id)
     * @param PoolScheduler $scheduler Scheduler instance
     */
    public function __construct($db, $poolSiteId = 1, $scheduler = null) {
        $this->db = $db;
        $this->poolSiteId = (int)$poolSiteId;
        $this->siteId = null; // Deprecated - kept for compatibility
        $this->scheduler = $scheduler;

        // Load pool configuration
        $this->poolConfig = $this->loadPoolConfig();

        // Load equipment configuration
        $this->equipment = $this->loadEquipmentConfig();
    }

    /**
     * Initialize pool configuration - all values from config template via setConfigFromUI()
     * Note: pool_configurations table is deprecated, all config now in config_templates.config_json
     */
    private function loadPoolConfig() {
        // Return structure with null values - MUST be set via setConfigFromUI()
        // No defaults - if value is null, calculation should handle appropriately
        return [
            // Physical pool properties - from config template pool section
            'area_m2' => null,
            'volume_m3' => null,
            'depth_m' => null,
            'perimeter_m' => null,        // Can be calculated from area if needed
            'has_tunnel' => false,
            'cover_r_value' => null,
            // Simulation parameters - from config template
            'has_cover' => null,
            'cover_solar_transmittance' => null,
            'solar_absorption' => null,
            'wind_exposure_factor' => null,
            'years_operating' => null
        ];
    }

    /**
     * Load equipment configuration from database
     */
    private function loadEquipmentConfig() {
        // Try to load from config_templates (may not exist yet)
        try {
            $stmt = $this->db->prepare("
                SELECT config_json FROM config_templates
                WHERE pool_site_id = ?
                LIMIT 1
            ");
            $stmt->execute([$this->poolSiteId]);
            $row = $stmt->fetch();

            if ($row && $row['config_json']) {
                $config = json_decode($row['config_json'], true);
                if ($config) {
                    return $config;
                }
            }
        } catch (\PDOException $e) {
            // Table or column doesn't exist yet, use defaults
        }

        // Default equipment configuration
        return [
            'heat_pump' => [
                'enabled' => true,
                'type' => 'ground_source',   // 'air_source' or 'ground_source' (borehole)
                'capacity_kw' => 125,        // Nominal heating capacity
                'cop_nominal' => 4.6,        // COP (constant for ground source)
                'min_operating_temp' => -20, // °C (only applies to air_source)
                'max_operating_temp' => 35,  // °C (only applies to air_source)
            ],
            'boiler' => [
                'enabled' => true,
                'capacity_kw' => 200,        // Backup boiler capacity
                'efficiency' => 0.92,        // 92% efficiency
                'fuel_type' => 'natural_gas',
                'fuel_cost_per_kwh' => 0.08, // NOK per kWh
            ],
            'electricity_cost_per_kwh' => 1.20, // NOK per kWh
            'control_strategy' => 'hp_priority', // hp_priority, boiler_priority, cost_optimal
        ];
    }

    /**
     * Set configuration from UI format (config_templates.config_json)
     *
     * @param array $uiConfig Configuration object from UI
     */
    public function setConfigFromUI($uiConfig) {
        // Pool physical parameters
        if (isset($uiConfig['pool'])) {
            // Length and width are primary - area/volume/perimeter calculated from them
            $length = $uiConfig['pool']['length_m'] ?? null;
            $width = $uiConfig['pool']['width_m'] ?? null;
            $depth = $uiConfig['pool']['depth_m'] ?? $this->poolConfig['depth_m'];

            $this->poolConfig['length_m'] = $length;
            $this->poolConfig['width_m'] = $width;
            $this->poolConfig['depth_m'] = $depth;

            // Calculate area, volume, perimeter from length × width
            if ($length !== null && $width !== null) {
                $this->poolConfig['area_m2'] = $length * $width;
                $this->poolConfig['perimeter_m'] = 2 * ($length + $width);
                if ($depth !== null) {
                    $this->poolConfig['volume_m3'] = $length * $width * $depth;
                }
            } else {
                // Fallback to provided values if length/width not set
                $this->poolConfig['area_m2'] = $uiConfig['pool']['area_m2'] ?? $this->poolConfig['area_m2'];
                $this->poolConfig['volume_m3'] = $uiConfig['pool']['volume_m3'] ?? $this->poolConfig['volume_m3'];
            }

            $this->poolConfig['wind_exposure_factor'] = $uiConfig['pool']['wind_exposure'] ?? $this->poolConfig['wind_exposure_factor'];
            $this->poolConfig['years_operating'] = $uiConfig['pool']['years_operating'] ?? $this->poolConfig['years_operating'];
            $this->poolConfig['has_tunnel'] = $uiConfig['pool']['has_tunnel'] ?? $this->poolConfig['has_tunnel'];

            // Solar absorption can come from pool section (from pools table)
            if (isset($uiConfig['pool']['solar_absorption'])) {
                $absorb = (float) $uiConfig['pool']['solar_absorption'];
                $this->poolConfig['solar_absorption'] = $absorb > 1 ? $absorb / 100 : $absorb;
            }
        }

        // Cover settings
        if (isset($uiConfig['cover'])) {
            $this->poolConfig['has_cover'] = $uiConfig['cover']['has_cover'] ?? $this->poolConfig['has_cover'];
            // Check both r_value (from pools table) and u_value (from config template)
            $this->poolConfig['cover_r_value'] = $uiConfig['cover']['r_value'] ?? $uiConfig['cover']['u_value'] ?? $this->poolConfig['cover_r_value'];
            // UI stores as percentage, convert to decimal
            if (isset($uiConfig['cover']['solar_transmittance'])) {
                $trans = (float) $uiConfig['cover']['solar_transmittance'];
                $this->poolConfig['cover_solar_transmittance'] = $trans > 1 ? $trans / 100 : $trans;
            }
        }

        // Solar settings (fallback if not in pool section)
        if (isset($uiConfig['solar']['absorption']) && !isset($uiConfig['pool']['solar_absorption'])) {
            $absorb = (float) $uiConfig['solar']['absorption'];
            $this->poolConfig['solar_absorption'] = $absorb > 1 ? $absorb / 100 : $absorb;
        }

        // Equipment - Heat Pump
        if (isset($uiConfig['equipment'])) {
            $this->equipment['heat_pump']['capacity_kw'] = $uiConfig['equipment']['hp_capacity_kw'] ?? $this->equipment['heat_pump']['capacity_kw'];
            $this->equipment['heat_pump']['cop_nominal'] = $uiConfig['equipment']['hp_cop'] ?? $this->equipment['heat_pump']['cop_nominal'];
            $this->equipment['boiler']['capacity_kw'] = $uiConfig['equipment']['boiler_capacity_kw'] ?? $this->equipment['boiler']['capacity_kw'];
            $this->equipment['boiler']['efficiency'] = $uiConfig['equipment']['boiler_efficiency'] ?? $this->equipment['boiler']['efficiency'];
        }

        // Control settings
        if (isset($uiConfig['control'])) {
            $this->equipment['control_strategy'] = $uiConfig['control']['strategy'] ?? $this->equipment['control_strategy'];
            $this->equipment['target_temp'] = $uiConfig['control']['target_temp'] ?? null;
            // Config stores upper/lower tolerance separately
            $this->equipment['upper_tolerance'] = $uiConfig['control']['upper_tolerance'] ?? null;
            $this->equipment['lower_tolerance'] = $uiConfig['control']['lower_tolerance'] ?? null;
            // For backward compat, also check temp_tolerance
            if (isset($uiConfig['control']['temp_tolerance'])) {
                $this->equipment['upper_tolerance'] = $uiConfig['control']['temp_tolerance'];
                $this->equipment['lower_tolerance'] = $uiConfig['control']['temp_tolerance'];
            }
        }

        // Energy costs
        if (isset($uiConfig['costs'])) {
            $this->equipment['electricity_cost_per_kwh'] = $uiConfig['costs']['electricity_nok_kwh'] ?? $this->equipment['electricity_cost_per_kwh'];
            $this->equipment['boiler']['fuel_cost_per_kwh'] = $uiConfig['costs']['gas_nok_kwh'] ?? $this->equipment['boiler']['fuel_cost_per_kwh'];
        }

        // Water temperatures - needed for bather energy calculation
        if (isset($uiConfig['water_temps'])) {
            $this->equipment['water_temps'] = [
                'cold_water' => $uiConfig['water_temps']['cold_water'] ?? null,
                'shower_target' => $uiConfig['water_temps']['shower_target'] ?? null,
                'hot_water_tank' => $uiConfig['water_temps']['hot_water_tank'] ?? null,
                'hp_max_dhw' => $uiConfig['water_temps']['hp_max_dhw'] ?? null,
            ];
        }

        // Equipment extras
        if (isset($uiConfig['equipment']['showers_use_hp'])) {
            $this->equipment['showers_use_hp'] = $uiConfig['equipment']['showers_use_hp'];
        }

        // Bathers settings - calculate kwh_per_visit from water volumes and temps
        if (isset($uiConfig['bathers'])) {
            $perDay = $uiConfig['bathers']['per_day'] ?? null;
            $refillLiters = $uiConfig['bathers']['refill_liters'] ?? null;
            $showerLiters = $uiConfig['bathers']['shower_liters'] ?? null;
            $activityFactor = $uiConfig['bathers']['activity_factor'] ?? null;
            $showersUseHp = $this->equipment['showers_use_hp'] ?? false;

            // Calculate kWh per visit from water heating requirements
            // Energy = mass * specific_heat * temp_diff / 3600000 (to get kWh)
            $refillEnergy = null;
            $showerEnergy = null;
            $kwhPerVisit = null;

            if ($refillLiters !== null && isset($this->equipment['water_temps'])) {
                $coldWater = $this->equipment['water_temps']['cold_water'] ?? null;
                $poolTemp = $this->equipment['target_temp'] ?? null;

                if ($coldWater !== null && $poolTemp !== null) {
                    // Pool refill heating: cold water -> pool temp (always included)
                    $refillEnergy = $refillLiters * 4.186 * ($poolTemp - $coldWater) / 3600; // kWh
                    $kwhPerVisit = $refillEnergy;
                }
            }

            if ($showerLiters !== null && isset($this->equipment['water_temps'])) {
                $coldWater = $this->equipment['water_temps']['cold_water'] ?? null;
                $showerTarget = $this->equipment['water_temps']['shower_target'] ?? null;

                if ($coldWater !== null && $showerTarget !== null) {
                    // Shower heating: cold water -> shower target
                    $showerEnergy = $showerLiters * 4.186 * ($showerTarget - $coldWater) / 3600; // kWh

                    // Only add shower energy to pool load if showers_use_hp is true
                    if ($showersUseHp && $kwhPerVisit !== null) {
                        $kwhPerVisit += $showerEnergy;
                    }
                }
            }

            $this->equipment['bathers'] = [
                'per_day' => $perDay,
                'activity_factor' => $activityFactor,
                'refill_liters' => $refillLiters,
                'shower_liters' => $showerLiters,
                'refill_kwh_per_visit' => $refillEnergy,
                'shower_kwh_per_visit' => $showerEnergy,
                'kwh_per_visit' => $kwhPerVisit, // Only includes shower if showers_use_hp=true
                'showers_use_hp' => $showersUseHp,
                'open_hours' => $uiConfig['bathers']['open_hours'] ?? 10,
            ];
        }
    }

    /**
     * Set equipment configuration
     */
    public function setEquipment($equipment) {
        $this->equipment = array_merge($this->equipment, $equipment);
    }

    /**
     * Get simulator version
     */
    public static function getVersion() {
        return self::VERSION;
    }

    /**
     * Get pool configuration
     */
    public function getPoolConfig() {
        return $this->poolConfig;
    }

    /**
     * Set pool configuration (used when restoring from stored config_snapshot)
     */
    public function setPoolConfig($poolConfig) {
        if (is_array($poolConfig)) {
            $this->poolConfig = array_merge($this->poolConfig, $poolConfig);
        }
    }

    /**
     * Get equipment configuration
     */
    public function getEquipment() {
        return $this->equipment;
    }

    /**
     * Run simulation for a date range
     *
     * @param string $startDate Start date (YYYY-MM-DD)
     * @param string $endDate End date (YYYY-MM-DD)
     * @param array $options Simulation options
     * @return array Simulation results
     */
    public function runSimulation($startDate, $endDate, $options = []) {
        $start = new DateTime($startDate);
        $end = new DateTime($endDate);

        // Get weather data for period
        $weatherData = $this->getWeatherData($startDate, $endDate);

        // Get solar data for period
        $solarData = $this->getSolarData($startDate, $endDate);

        // Initialize results
        $results = [
            'meta' => [
                'simulator_version' => self::VERSION,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'pool_site_id' => $this->poolSiteId,
                'pool_config' => $this->poolConfig,
                'equipment' => $this->equipment,
                'created_at' => date('Y-m-d H:i:s'),
            ],
            'hourly' => [],
            'daily' => [],
            'summary' => [
                'total_hours' => 0,
                'open_hours' => 0,
                // Detailed loss breakdown (kWh)
                'evaporation_kwh' => 0,
                'convection_kwh' => 0,
                'radiation_kwh' => 0,
                'floor_loss_kwh' => 0,
                'wall_loss_kwh' => 0,
                'total_heat_loss_kwh' => 0,
                'total_solar_gain_kwh' => 0,
                // Heating delivered (thermal kWh)
                'hp_thermal_kwh' => 0,
                'boiler_thermal_kwh' => 0,
                'unmet_kwh' => 0,
                // Energy consumed (kWh)
                'total_hp_energy_kwh' => 0,
                'total_boiler_energy_kwh' => 0,
                'total_electricity_kwh' => 0,
                'total_fuel_kwh' => 0,
                'shower_heating_kwh' => 0,
                'total_cost' => 0,
                // Temperature stats
                'min_water_temp' => 999,
                'max_water_temp' => -999,
                'avg_water_temp' => 0,
                'days_below_27' => 0,
                'days_below_26' => 0,
                'avg_cop' => 0,
            ]
        ];

        // Track state - start at target temp (will be set from first hour's schedule)
        $currentWaterTemp = null;
        $dailyStats = [];
        $currentDay = null;

        // Process each hour
        foreach ($weatherData as $hour) {
            $timestamp = $hour['timestamp'];
            $date = substr($timestamp, 0, 10);
            $hourOfDay = (int) substr($timestamp, 11, 2);

            // Get target temperature from scheduler
            $targetTemp = null;
            if ($this->scheduler) {
                $period = $this->scheduler->getCurrentPeriod(new DateTime($timestamp));
                if ($period) {
                    $targetTemp = $period['target_temp'];
                }
            }

            // Initialize water temp on first iteration (start at target, not arbitrary 20°C)
            if ($currentWaterTemp === null) {
                $currentWaterTemp = $targetTemp ?? 28.0;  // Use target or default 28°C
            }

            // Get solar for this hour (uses pre-calculated hourly if available)
            $hourlySolar = $this->getSolarForHour($solarData, $date, $hourOfDay);

            // Calculate heat losses
            $losses = $this->calculateHeatLosses(
                $currentWaterTemp,
                (float) $hour['air_temperature'],
                (float) ($hour['wind_speed'] ?? 2.0),
                (float) ($hour['humidity'] ?? 70),
                $targetTemp !== null // is pool open?
            );

            // Calculate solar gain
            $solarGain = $this->calculateSolarGain($hourlySolar, $targetTemp !== null);

            // Calculate net heat requirement
            $netRequirement = $losses['total'] - $solarGain;

            // Determine heating (simplified algorithm - no deadband)
            $heating = $this->calculateHeating(
                $netRequirement,
                (float) $hour['air_temperature'],
                $targetTemp,
                $currentWaterTemp
            );

            // Update water temperature
            $heatBalance = $solarGain + $heating['total_heat'] - $losses['total'];
            $tempChange = $this->calculateTempChange($heatBalance, 1.0); // 1 hour
            $currentWaterTemp += $tempChange;

            // Clamp water temperature to reasonable range
            $currentWaterTemp = max(5, min(35, $currentWaterTemp));

            // Store hourly result
            $hourlyResult = [
                'timestamp' => $timestamp,
                'weather' => [
                    'air_temp' => (float) $hour['air_temperature'],
                    'wind_speed' => (float) ($hour['wind_speed'] ?? 2.0),
                    'humidity' => (float) ($hour['humidity'] ?? 70),
                    'solar_kwh_m2' => $hourlySolar,
                ],
                'pool' => [
                    'target_temp' => $targetTemp,
                    'water_temp' => round($currentWaterTemp, 2),
                    'is_open' => $targetTemp !== null,
                ],
                'losses' => [
                    'evaporation_kw' => round($losses['evaporation'], 3),
                    'convection_kw' => round($losses['convection'], 3),
                    'radiation_kw' => round($losses['radiation'], 3),
                    'conduction_kw' => round($losses['conduction'], 3),
                    'total_kw' => round($losses['total'], 3),
                ],
                'gains' => [
                    'solar_kw' => round($solarGain, 3),
                    'heat_pump_kw' => round($heating['hp_heat'], 3),
                    'boiler_kw' => round($heating['boiler_heat'], 3),
                ],
                'energy' => [
                    'hp_electricity_kwh' => round($heating['hp_electricity'], 3),
                    'boiler_fuel_kwh' => round($heating['boiler_fuel'], 3),
                    'hp_cop' => round($heating['hp_cop'], 2),
                ],
                'cost' => round($heating['cost'], 2),
            ];

            $results['hourly'][] = $hourlyResult;

            // Aggregate daily stats
            if ($date !== $currentDay) {
                if ($currentDay !== null) {
                    $results['daily'][] = $dailyStats;
                }
                $currentDay = $date;
                $dailyStats = [
                    'date' => $date,
                    'hours' => 0,
                    'open_hours' => 0,
                    'avg_air_temp' => 0,
                    'avg_water_temp' => 0,
                    'min_water_temp' => 999,
                    'total_loss_kwh' => 0,
                    'total_solar_kwh' => 0,
                    'total_hp_kwh' => 0,           // Electricity consumed
                    'total_boiler_kwh' => 0,       // Fuel consumed
                    'hp_thermal_kwh' => 0,         // Thermal output (for charts)
                    'boiler_thermal_kwh' => 0,     // Thermal output (for charts)
                    'total_cost' => 0,
                ];
            }

            // Accumulate daily totals
            $dailyStats['hours']++;
            $dailyStats['open_hours'] += $targetTemp !== null ? 1 : 0;
            $dailyStats['avg_air_temp'] += (float) $hour['air_temperature'];
            $dailyStats['avg_water_temp'] += $currentWaterTemp;
            $dailyStats['min_water_temp'] = min($dailyStats['min_water_temp'], $currentWaterTemp);
            $dailyStats['total_loss_kwh'] += $losses['total'];
            $dailyStats['total_solar_kwh'] += $solarGain;
            $dailyStats['total_hp_kwh'] += $heating['hp_electricity'];
            $dailyStats['total_boiler_kwh'] += $heating['boiler_fuel'];
            $dailyStats['hp_thermal_kwh'] += $heating['hp_heat'];
            $dailyStats['boiler_thermal_kwh'] += $heating['boiler_heat'];
            $dailyStats['total_cost'] += $heating['cost'];

            // Accumulate summary totals
            $results['summary']['total_hours']++;
            $results['summary']['open_hours'] += $targetTemp !== null ? 1 : 0;

            // Detailed loss breakdown
            $results['summary']['evaporation_kwh'] += $losses['evaporation'];
            $results['summary']['convection_kwh'] += $losses['convection'];
            $results['summary']['radiation_kwh'] += $losses['radiation'];
            // Split conduction into floor and wall (rough estimate: 80% floor, 20% wall)
            $results['summary']['floor_loss_kwh'] += $losses['conduction'] * 0.8;
            $results['summary']['wall_loss_kwh'] += $losses['conduction'] * 0.2;
            $results['summary']['total_heat_loss_kwh'] += $losses['total'];
            $results['summary']['total_solar_gain_kwh'] += $solarGain;

            // Heating delivered (thermal)
            $results['summary']['hp_thermal_kwh'] += $heating['hp_heat'];
            $results['summary']['boiler_thermal_kwh'] += $heating['boiler_heat'];
            $results['summary']['unmet_kwh'] += max(0, $netRequirement - $heating['total_heat']);

            // Energy consumed
            $results['summary']['total_hp_energy_kwh'] += $heating['hp_electricity'];
            $results['summary']['total_boiler_energy_kwh'] += $heating['boiler_fuel'];
            $results['summary']['total_electricity_kwh'] += $heating['hp_electricity'];
            $results['summary']['total_fuel_kwh'] += $heating['boiler_fuel'];
            $results['summary']['total_cost'] += $heating['cost'];

            // Temperature stats
            $results['summary']['min_water_temp'] = min($results['summary']['min_water_temp'], $currentWaterTemp);
            $results['summary']['max_water_temp'] = max($results['summary']['max_water_temp'], $currentWaterTemp);
            $results['summary']['avg_water_temp'] += $currentWaterTemp;

            if ($heating['hp_cop'] > 0) {
                $results['summary']['avg_cop'] += $heating['hp_cop'];
            }
        }

        // Finalize last day
        if ($currentDay !== null && $dailyStats['hours'] > 0) {
            $dailyStats['avg_air_temp'] /= $dailyStats['hours'];
            $dailyStats['avg_water_temp'] /= $dailyStats['hours'];
            $results['daily'][] = $dailyStats;
        }

        // Count days below temperature thresholds
        foreach ($results['daily'] as $day) {
            if ($day['min_water_temp'] < 27) {
                $results['summary']['days_below_27']++;
            }
            if ($day['min_water_temp'] < 26) {
                $results['summary']['days_below_26']++;
            }
        }

        // Finalize averages
        if ($results['summary']['total_hours'] > 0) {
            $results['summary']['avg_water_temp'] /= $results['summary']['total_hours'];
        }

        // Fix min/max if no data
        if ($results['summary']['min_water_temp'] == 999) {
            $results['summary']['min_water_temp'] = 0;
        }
        if ($results['summary']['max_water_temp'] == -999) {
            $results['summary']['max_water_temp'] = 0;
        }

        if ($results['summary']['total_hp_energy_kwh'] > 0) {
            $hpHours = count(array_filter($results['hourly'], fn($h) => $h['energy']['hp_electricity_kwh'] > 0));
            if ($hpHours > 0) {
                $results['summary']['avg_cop'] = $results['summary']['avg_cop'] / $hpHours;
            }
        }

        // Round summary values
        foreach ($results['summary'] as $key => $value) {
            if (is_float($value)) {
                $results['summary'][$key] = round($value, 2);
            }
        }

        return $results;
    }

    /**
     * Get weather data for date range
     */
    private function getWeatherData($startDate, $endDate) {
        $stmt = $this->db->prepare("
            SELECT
                wd.timestamp,
                wd.temperature as air_temperature,
                wd.wind_speed,
                wd.humidity,
                wd.tunnel_temp as tunnel_temperature
            FROM weather_data wd
            JOIN weather_stations ws ON wd.station_id = ws.station_id
            JOIN pool_sites ps ON ws.station_id = ps.default_weather_station
            WHERE ps.id = ?
              AND DATE(wd.timestamp) BETWEEN ? AND ?
            ORDER BY wd.timestamp
        ");
        $stmt->execute([$this->poolSiteId, $startDate, $endDate]);
        return $stmt->fetchAll();
    }

    /**
     * Check if hourly solar data is available for this site
     */
    private function hasHourlySolarData() {
        if (!$this->poolSiteId) return false;
        try {
            $stmt = $this->db->prepare("
                SELECT COUNT(*) FROM site_solar_hourly WHERE pool_site_id = ? LIMIT 1
            ");
            $stmt->execute([$this->poolSiteId]);
            return $stmt->fetchColumn() > 0;
        } catch (PDOException $e) {
            return false;
        }
    }

    /**
     * Get hourly solar data for date range (pre-calculated values from NASA POWER)
     */
    private function getHourlySolarData($startDate, $endDate) {
        if (!$this->poolSiteId) return [];

        $stmt = $this->db->prepare("
            SELECT timestamp, solar_wh_m2
            FROM site_solar_hourly
            WHERE pool_site_id = ?
              AND DATE(timestamp) BETWEEN ? AND ?
            ORDER BY timestamp
        ");
        $stmt->execute([$this->poolSiteId, $startDate, $endDate]);
        $rows = $stmt->fetchAll();

        // Index by timestamp, convert Wh/m² to kWh/m²
        $solarByTimestamp = [];
        foreach ($rows as $row) {
            $solarByTimestamp[$row['timestamp']] = [
                'hourly_kwh_m2' => ($row['solar_wh_m2'] ?? 0) / 1000
            ];
        }
        return $solarByTimestamp;
    }

    /**
     * Get solar data for date range (legacy - daily data)
     */
    private function getSolarData($startDate, $endDate) {
        // First check if we have hourly data (preferred)
        if ($this->hasHourlySolarData()) {
            return $this->getHourlySolarData($startDate, $endDate);
        }

        // Fallback to legacy daily data via weather station
        $stmt = $this->db->prepare("
            SELECT
                sd.date,
                sd.daily_total_kwh_m2,
                sd.daily_clear_sky_kwh_m2 as clear_sky_kwh_m2,
                sd.cloud_reduction_factor as cloud_factor
            FROM solar_daily_data sd
            JOIN weather_stations ws ON sd.station_id = ws.station_id
            JOIN pool_sites ps ON ws.station_id = ps.default_weather_station
            WHERE ps.id = ?
              AND sd.date BETWEEN ? AND ?
            ORDER BY sd.date
        ");
        $stmt->execute([$this->poolSiteId, $startDate, $endDate]);
        $rows = $stmt->fetchAll();

        // Index by date (legacy format)
        $solarByDate = [];
        foreach ($rows as $row) {
            $solarByDate[$row['date']] = $row;
        }
        return $solarByDate;
    }

    /**
     * Get solar for a specific hour - handles both hourly and daily data
     */
    private function getSolarForHour($solarData, $date, $hour) {
        // Check if this is hourly data (has timestamp keys)
        $timestamp = $date . ' ' . sprintf('%02d:00:00', $hour);

        if (isset($solarData[$timestamp])) {
            // Hourly data - return pre-calculated value
            return $solarData[$timestamp]['hourly_kwh_m2'];
        }

        // Legacy daily data - distribute to hourly
        $dailySolar = $solarData[$date] ?? ['daily_total_kwh_m2' => 0];
        return $this->distributeSolarToHour($dailySolar, $hour);
    }

    /**
     * Distribute daily solar to hourly (legacy fallback - simple bell curve)
     */
    private function distributeSolarToHour($dailySolar, $hour) {
        // Solar primarily between 6am and 8pm with peak at noon
        $dailyTotal = (float) ($dailySolar['daily_total_kwh_m2'] ?? 0);

        if ($hour < 6 || $hour > 20) {
            return 0;
        }

        // Simple bell curve distribution
        $peakHour = 12;
        $spread = 4;
        $factor = exp(-0.5 * pow(($hour - $peakHour) / $spread, 2));

        // Normalize (sum of factors for hours 6-20)
        $totalFactor = 0;
        for ($h = 6; $h <= 20; $h++) {
            $totalFactor += exp(-0.5 * pow(($h - $peakHour) / $spread, 2));
        }

        return $dailyTotal * ($factor / $totalFactor);
    }

    /**
     * Calculate all heat losses
     *
     * @param float $waterTemp Pool water temperature (°C)
     * @param float $airTemp Ambient air temperature (°C)
     * @param float $windSpeed Wind speed (m/s)
     * @param float $humidity Relative humidity (%)
     * @param bool $isOpen Is pool open (affects evaporation)
     * @return array Heat losses in kW
     */
    private function calculateHeatLosses($waterTemp, $airTemp, $windSpeed, $humidity, $isOpen) {
        $area = $this->poolConfig['area_m2'];

        // 1. EVAPORATION LOSS (dominant for outdoor pools)
        // Uses simplified Carrier equation
        $evapLoss = $this->calculateEvaporationLoss($waterTemp, $airTemp, $humidity, $windSpeed, $isOpen);

        // 2. CONVECTION LOSS
        $convLoss = $this->calculateConvectionLoss($waterTemp, $airTemp, $windSpeed);

        // 3. RADIATION LOSS
        $radLoss = $this->calculateRadiationLoss($waterTemp, $airTemp);

        // 4. CONDUCTION LOSS (to ground/walls)
        $condLoss = $this->calculateConductionLoss($waterTemp);

        // Apply cover reduction if pool has cover and is closed
        if ($this->poolConfig['has_cover'] && !$isOpen) {
            $coverFactor = 0.1; // 90% reduction with cover
            $evapLoss *= $coverFactor;
            $convLoss *= $coverFactor;
            $radLoss *= $coverFactor;
        }

        return [
            'evaporation' => max(0, $evapLoss),
            'convection' => max(0, $convLoss),
            'radiation' => max(0, $radLoss),
            'conduction' => max(0, $condLoss),
            'total' => max(0, $evapLoss + $convLoss + $radLoss + $condLoss)
        ];
    }

    /**
     * Calculate evaporation heat loss
     * Using simplified ASHRAE method
     */
    private function calculateEvaporationLoss($waterTemp, $airTemp, $humidity, $windSpeed, $isOpen) {
        $area = $this->poolConfig['area_m2'];

        // Saturation vapor pressure at water temperature (kPa)
        $pWater = 0.6108 * exp(17.27 * $waterTemp / ($waterTemp + 237.3));

        // Saturation vapor pressure at air temperature (kPa)
        $pSat = 0.6108 * exp(17.27 * $airTemp / ($airTemp + 237.3));

        // Actual vapor pressure in air
        $pAir = $pSat * ($humidity / 100);

        // Evaporation rate coefficient (kg/m²·s·kPa)
        // Increases with wind and activity - activity factor from config
        $configActivityFactor = $this->equipment['bathers']['activity_factor'] ?? null;
        $activityFactor = $isOpen ? ($configActivityFactor ?? 1.0) : 1.0;
        $windFactor = 1 + 0.1 * $windSpeed * $this->poolConfig['wind_exposure_factor'];

        $evapCoeff = 0.0000375 * $activityFactor * $windFactor;

        // Evaporation rate (kg/s)
        $evapRate = $evapCoeff * $area * ($pWater - $pAir);

        // Heat loss (kW)
        $evapLoss = $evapRate * self::LATENT_HEAT_VAPORIZATION / 1000;

        return max(0, $evapLoss);
    }

    /**
     * Calculate convection heat loss
     */
    private function calculateConvectionLoss($waterTemp, $airTemp, $windSpeed) {
        $area = $this->poolConfig['area_m2'];
        $tempDiff = $waterTemp - $airTemp;

        if ($tempDiff <= 0) {
            return 0; // No loss if air is warmer
        }

        // Convection coefficient (W/m²·K) - increases with wind
        // McAdams correlation for forced convection
        $hConv = 5.7 + 3.8 * $windSpeed * $this->poolConfig['wind_exposure_factor'];

        // Heat loss (kW)
        return $hConv * $area * $tempDiff / 1000;
    }

    /**
     * Calculate radiation heat loss
     */
    private function calculateRadiationLoss($waterTemp, $airTemp) {
        $area = $this->poolConfig['area_m2'];

        // Convert to Kelvin
        $tWaterK = $waterTemp + 273.15;
        $tSkyK = $this->estimateSkyTemperature($airTemp) + 273.15;

        // Stefan-Boltzmann radiation (W)
        $radLoss = self::STEFAN_BOLTZMANN * self::WATER_EMISSIVITY * $area *
                   (pow($tWaterK, 4) - pow($tSkyK, 4));

        return max(0, $radLoss / 1000); // Convert to kW
    }

    /**
     * Estimate effective sky temperature for radiation
     */
    private function estimateSkyTemperature($airTemp) {
        // Clear sky is about 20°C below air temp
        // Cloudy sky is closer to air temp
        // Use average assumption
        return $airTemp - 15;
    }

    /**
     * Calculate conduction heat loss to ground
     * Uses years_operating to adjust for ground thermal stabilization
     *
     * Ground around pool warms up over time:
     * - Year 1: Cold ground, higher losses (factor ~1.5)
     * - Year 2: Warming ground (factor ~1.2)
     * - Year 3+: Steady state (factor 1.0)
     */
    private function calculateConductionLoss($waterTemp) {
        // Ground temperature assumed ~10°C year-round in Norway
        $groundTemp = 10;
        $tempDiff = $waterTemp - $groundTemp;

        // U-value for pool walls/floor (W/m²·K)
        // Typical insulated pool: 0.3-0.5, uninsulated: 1.0-2.0
        $uValue = 0.5;

        // Years operating affects ground thermal - ground warms up over time
        $yearsOperating = $this->poolConfig['years_operating'] ?? 3;
        $groundFactor = $this->getGroundThermalFactor($yearsOperating);

        // Calculate areas
        $bottomArea = $this->poolConfig['area_m2'];
        $perimeter = $this->poolConfig['perimeter_m'] ?? $this->calculatePerimeter();
        $sideArea = $perimeter * $this->poolConfig['depth_m'];
        $totalArea = $bottomArea + $sideArea;

        return $uValue * $totalArea * $tempDiff * $groundFactor / 1000; // kW
    }

    /**
     * Get ground thermal factor based on years of operation
     * Ground around pool warms up over time, reducing heat loss
     */
    private function getGroundThermalFactor($yearsOperating) {
        // Try to get from lookup table first
        try {
            $stmt = $this->db->prepare("
                SELECT q_total_kw FROM ground_thermal_lookup
                WHERE year = ?
                LIMIT 1
            ");
            $stmt->execute([$yearsOperating]);
            $row = $stmt->fetch();
            if ($row && $row['q_total_kw'] > 0) {
                // Normalize to year 3 baseline (factor of 1.0)
                $stmt->execute([3]);
                $baseline = $stmt->fetch();
                if ($baseline && $baseline['q_total_kw'] > 0) {
                    return $row['q_total_kw'] / $baseline['q_total_kw'];
                }
            }
        } catch (\PDOException $e) {
            // Table doesn't exist, use calculated factors
        }

        // Fallback: calculated factors if lookup fails
        switch ($yearsOperating) {
            case 1: return 1.5;  // Cold ground, 50% more loss
            case 2: return 1.2;  // Warming ground, 20% more loss
            default: return 1.0; // Year 3+: steady state
        }
    }

    /**
     * Calculate perimeter from area (assuming rectangular pool ~2:1 ratio)
     */
    private function calculatePerimeter() {
        $area = $this->poolConfig['area_m2'];
        // Assume length = 2 * width, so area = 2*w^2, w = sqrt(area/2)
        $width = sqrt($area / 2);
        $length = 2 * $width;
        return 2 * ($length + $width);
    }

    /**
     * Calculate solar heat gain
     *
     * Based on v3.6.0.3 benchmark:
     * - Solar absorption: 60% (water absorptivity + reflection losses)
     * - Cover solar transmittance: 10% (when covered)
     *
     * Values loaded from poolConfig (configurable in UI)
     */
    private function calculateSolarGain($solarIrradiance, $isOpen) {
        $area = $this->poolConfig['area_m2'];

        // Solar absorptivity of water (accounts for reflection)
        // Default 60% from v3.6.0.3 benchmark
        $absorptivity = $this->poolConfig['solar_absorption'] ?? 0.60;

        // Cover solar transmittance (% of solar that passes through cover)
        // Default 10% from v3.6.0.3 benchmark
        $coverTransmittance = $this->poolConfig['cover_solar_transmittance'] ?? 0.10;

        // When covered, only a fraction of solar passes through
        if ($this->poolConfig['has_cover'] && !$isOpen) {
            return $solarIrradiance * $area * $absorptivity * $coverTransmittance;
        }

        // Solar gain when uncovered (kW)
        return $solarIrradiance * $area * $absorptivity;
    }

    /**
     * Calculate heating from equipment
     *
     * Simplified algorithm (V103):
     * - Two strategies only: 'reactive' (maintain temp always) and 'predictive' (use schedule)
     * - No deadband: direct comparison to target
     * - If below target: add extra heat to raise to target in 1 hour
     * - If above target: reduce heat demand by the thermal value of excess temp
     * - Always prioritize heat pump, boiler for overflow only
     *
     * @param float $netRequirement Net heat loss (losses - solar gain) in kW
     * @param float $airTemp Current air temperature
     * @param float|null $targetTemp Target water temperature (null = closed)
     * @param float $currentWaterTemp Current water temperature
     */
    private function calculateHeating($netRequirement, $airTemp, $targetTemp, $currentWaterTemp) {
        $result = [
            'hp_heat' => 0,
            'hp_electricity' => 0,
            'hp_cop' => 0,
            'boiler_heat' => 0,
            'boiler_fuel' => 0,
            'total_heat' => 0,
            'cost' => 0,
        ];

        // Determine control strategy: only 'reactive' or 'predictive'
        $controlStrategy = $this->equipment['control_strategy'] ?? 'reactive';

        // Normalize old strategies to reactive (they all behave the same now)
        if (!in_array($controlStrategy, ['reactive', 'predictive'])) {
            $controlStrategy = 'reactive';
        }

        // Determine effective target temperature
        if ($controlStrategy === 'predictive' && $targetTemp === null) {
            // Predictive mode during closed hours: use setback temperature
            $targetTemp = $this->poolConfig['setback_temp'] ?? 26.0;
        } elseif ($targetTemp === null) {
            // Reactive mode: always maintain configured target (ignores schedule)
            $targetTemp = $this->poolConfig['target_temp'] ?? 28.0;
        }
        // When targetTemp is provided from schedule, use it directly

        // Calculate temperature difference
        $tempDiff = $targetTemp - $currentWaterTemp;

        // Calculate required heating
        $requiredHeat = 0;

        if ($tempDiff > 0) {
            // BELOW TARGET: Need extra heat to raise temperature
            // Required = losses + heat to raise temp to target in 1 hour
            $heatToRaise = $this->calculateHeatForTempRise($tempDiff, 1.0);
            $requiredHeat = $netRequirement + $heatToRaise;
        } else {
            // AT OR ABOVE TARGET: Excess temp reduces heat demand
            // The thermal energy stored in excess temp offsets some losses
            $excessTemp = abs($tempDiff);
            $heatCredit = $this->calculateHeatForTempRise($excessTemp, 1.0);
            $requiredHeat = max(0, $netRequirement - $heatCredit);
        }

        // If no heating needed (solar exceeds losses + we have excess temp)
        if ($requiredHeat <= 0) {
            return $result;
        }

        $remainingHeat = $requiredHeat;

        // ALWAYS prioritize heat pump (more efficient)
        $hpResult = $this->applyHeatPump($remainingHeat, $airTemp);
        $result['hp_heat'] = $hpResult['heat'];
        $result['hp_electricity'] = $hpResult['electricity'];
        $result['hp_cop'] = $hpResult['cop'];
        $result['cost'] += $hpResult['cost'];
        $remainingHeat -= $hpResult['heat'];

        // Boiler handles overflow (when HP capacity exceeded)
        if ($remainingHeat > 0 && $this->equipment['boiler']['enabled']) {
            $boilerResult = $this->applyBoiler($remainingHeat);
            $result['boiler_heat'] = $boilerResult['heat'];
            $result['boiler_fuel'] = $boilerResult['fuel'];
            $result['cost'] += $boilerResult['cost'];
        }

        $result['total_heat'] = $result['hp_heat'] + $result['boiler_heat'];

        return $result;
    }

    /**
     * Apply heat pump heating
     */
    private function applyHeatPump($requiredHeat, $airTemp) {
        $hp = $this->equipment['heat_pump'];

        if (!$hp['enabled']) {
            return ['heat' => 0, 'electricity' => 0, 'cop' => 0, 'cost' => 0];
        }

        $hpType = $hp['type'] ?? 'ground_source';

        // For air source, check operating temperature range
        if ($hpType === 'air_source') {
            if ($airTemp < $hp['min_operating_temp'] || $airTemp > $hp['max_operating_temp']) {
                return ['heat' => 0, 'electricity' => 0, 'cop' => 0, 'cost' => 0];
            }
        }
        // Ground source (borehole) has no air temperature limits

        // Calculate COP based on HP type
        $cop = $this->calculateHeatPumpCOP($airTemp);

        // Available heat output (limited by capacity)
        $availableHeat = min($requiredHeat, $hp['capacity_kw']);

        // Electricity consumption
        $electricity = $availableHeat / $cop;

        // Cost
        $cost = $electricity * $this->equipment['electricity_cost_per_kwh'];

        return [
            'heat' => $availableHeat,
            'electricity' => $electricity,
            'cop' => $cop,
            'cost' => $cost
        ];
    }

    /**
     * Calculate heat pump COP based on conditions
     */
    private function calculateHeatPumpCOP($airTemp) {
        $hp = $this->equipment['heat_pump'];
        $nominalCOP = $hp['cop_nominal'] ?? 4.6;
        $hpType = $hp['type'] ?? 'ground_source';

        // Ground source (borehole): constant COP regardless of air temp
        if ($hpType === 'ground_source') {
            return $nominalCOP;
        }

        // Air source: COP varies with air temperature
        // COP decreases roughly 2.5% per degree below 15°C
        $referenceTemp = 15;
        $tempDiff = $airTemp - $referenceTemp;

        if ($tempDiff < 0) {
            // Below reference: COP decreases
            $degradation = 0.025 * abs($tempDiff);
            $cop = $nominalCOP * (1 - $degradation);
        } else {
            // Above reference: COP slightly increases
            $improvement = 0.01 * $tempDiff;
            $cop = $nominalCOP * (1 + min(0.2, $improvement)); // Cap at 20% improvement
        }

        // Minimum COP of 2.0
        return max(2.0, $cop);
    }

    /**
     * Apply boiler heating
     */
    private function applyBoiler($requiredHeat) {
        $boiler = $this->equipment['boiler'];

        if (!$boiler['enabled']) {
            return ['heat' => 0, 'fuel' => 0, 'cost' => 0];
        }

        // Available heat output
        $availableHeat = min($requiredHeat, $boiler['capacity_kw']);

        // Fuel consumption
        $fuel = $availableHeat / $boiler['efficiency'];

        // Cost
        $cost = $fuel * $boiler['fuel_cost_per_kwh'];

        return [
            'heat' => $availableHeat,
            'fuel' => $fuel,
            'cost' => $cost
        ];
    }

    /**
     * Calculate heat required to raise pool temperature
     */
    private function calculateHeatForTempRise($tempDiff, $hours) {
        if ($tempDiff <= 0) {
            return 0;
        }

        $volume = $this->poolConfig['volume_m3'] ?? 0;
        if ($volume <= 0) {
            return 0; // Can't calculate heat without volume
        }
        $mass = $volume * self::WATER_DENSITY; // kg

        // Energy required (kJ)
        $energy = $mass * self::WATER_SPECIFIC_HEAT * $tempDiff / 1000;

        // Convert to kW (power over time period)
        return $energy / ($hours * 3600);
    }

    /**
     * Calculate temperature change from heat balance
     */
    private function calculateTempChange($heatBalanceKW, $hours) {
        $volume = $this->poolConfig['volume_m3'] ?? 0;
        if ($volume <= 0) {
            return 0; // Can't calculate temp change without volume
        }
        $mass = $volume * self::WATER_DENSITY;

        // Energy in kJ
        $energy = $heatBalanceKW * $hours * 3600;

        // Temperature change
        return $energy / ($mass * self::WATER_SPECIFIC_HEAT / 1000);
    }

    /**
     * Debug a single hour calculation with detailed intermediate values
     *
     * Outputs all intermediate calculations for comparison with Excel benchmark
     *
     * @param string $date Date (YYYY-MM-DD)
     * @param int $hour Hour of day (0-23)
     * @param float|null $waterTemp Override water temperature (optional)
     * @return array Detailed breakdown of all calculations
     */
    public function debugSingleHour($date, $hour, $waterTemp = null) {
        // Get weather for this specific hour
        $timestamp = sprintf('%s %02d:00:00', $date, $hour);

        $stmt = $this->db->prepare("
            SELECT
                wd.timestamp,
                wd.temperature as air_temperature,
                wd.wind_speed,
                wd.humidity,
                wd.tunnel_temp
            FROM weather_data wd
            JOIN weather_stations ws ON wd.station_id = ws.station_id
            JOIN pool_sites ps ON ws.station_id = ps.default_weather_station
            WHERE ps.id = ?
              AND wd.timestamp = ?
            LIMIT 1
        ");
        $stmt->execute([$this->poolSiteId, $timestamp]);
        $weather = $stmt->fetch();

        if (!$weather) {
            return ['error' => "No weather data found for $timestamp"];
        }

        // Get solar data for this hour (prefer hourly data if available)
        $hourlySolar = 0;
        $dailySolar = 0;
        $solarSource = 'none';

        // First try hourly data
        if ($this->hasHourlySolarData() && $this->poolSiteId) {
            $stmt = $this->db->prepare("
                SELECT solar_wh_m2
                FROM site_solar_hourly
                WHERE pool_site_id = ? AND timestamp = ?
                LIMIT 1
            ");
            $stmt->execute([$this->poolSiteId, $timestamp]);
            $hourlyRow = $stmt->fetch();
            if ($hourlyRow) {
                $hourlySolar = ($hourlyRow['solar_wh_m2'] ?? 0) / 1000; // Wh to kWh
                $dailySolar = $hourlySolar * 24; // Estimate for display
                $solarSource = 'hourly';
            }
        }

        // Fallback to legacy daily data
        if ($solarSource === 'none') {
            $stmt = $this->db->prepare("
                SELECT daily_total_kwh_m2, daily_clear_sky_kwh_m2
                FROM solar_daily_data sd
                JOIN weather_stations ws ON sd.station_id = ws.station_id
                JOIN pool_sites ps ON ws.station_id = ps.default_weather_station
                WHERE ps.id = ? AND sd.date = ?
                LIMIT 1
            ");
            $stmt->execute([$this->poolSiteId, $date]);
            $solar = $stmt->fetch();
            if ($solar) {
                $dailySolar = (float) $solar['daily_total_kwh_m2'];
                $hourlySolar = $this->distributeSolarToHour(['daily_total_kwh_m2' => $dailySolar], $hour);
                $solarSource = 'daily';
            }
        }

        // Get schedule info
        $isOpen = false;
        $targetTemp = null;
        if ($this->scheduler) {
            $period = $this->scheduler->getCurrentPeriod(new DateTime($timestamp));
            if ($period) {
                $isOpen = true;
                $targetTemp = $period['target_temp'] ?? 28;
            }
        }

        // Use provided water temp or default
        $poolTemp = $waterTemp ?? 28.59;

        // Extract weather values
        $airTemp = (float) $weather['air_temperature'];
        $windSpeed = (float) ($weather['wind_speed'] ?? 2.0);
        $humidity = (float) ($weather['humidity'] ?? 70);
        $tunnelTemp = $weather['tunnel_temp'] ? (float) $weather['tunnel_temp'] : null;

        // Solar irradiance - already calculated above ($hourlySolar in kWh/m²)
        // Convert kWh/m² to W/m² for this hour (kWh/m²/hour = kW/m² = 1000 W/m²)
        $solarIrradiance = $hourlySolar * 1000; // W/m²

        // Pool config
        $area = $this->poolConfig['area_m2'];
        $volume = $this->poolConfig['volume_m3'];
        $depth = $this->poolConfig['depth_m'];
        $perimeter = $this->poolConfig['perimeter_m'] ?? $this->calculatePerimeter();
        $windFactor = $this->poolConfig['wind_exposure_factor'];
        $yearsOperating = $this->poolConfig['years_operating'] ?? 3;
        $hasCover = $this->poolConfig['has_cover'];
        $coverUValue = $this->poolConfig['cover_r_value'];
        $solarAbsorption = $this->poolConfig['solar_absorption'] ?? 0.60;
        $coverTransmittance = $this->poolConfig['cover_solar_transmittance'] ?? 0.10;

        // Wall area
        $wallArea = $perimeter * $depth;
        $floorArea = $area;

        // ========== EVAPORATION CALCULATION ==========
        // Saturation vapor pressure at water temp (Pa)
        $pWaterKPa = 0.6108 * exp(17.27 * $poolTemp / ($poolTemp + 237.3));
        $pWaterPa = $pWaterKPa * 1000;

        // Saturation vapor pressure at air temp (Pa)
        $pSatKPa = 0.6108 * exp(17.27 * $airTemp / ($airTemp + 237.3));
        $pSatPa = $pSatKPa * 1000;

        // Actual vapor pressure in air (Pa)
        $pAirPa = $pSatPa * ($humidity / 100);

        // Vapor pressure difference (Pa)
        $vpDiff = $pWaterPa - $pAirPa;

        // Effective wind speed (m/s)
        $effectWindSpeed = $windSpeed * $windFactor;

        // Activity factor - from config (required when pool is open)
        $configActivityFactor = $this->equipment['bathers']['activity_factor'] ?? null;
        $activityFactor = $isOpen ? ($configActivityFactor ?? 1.0) : 1.0;

        // Evaporation using ASHRAE formula variant
        // E = (25 + 19*v) * A * (pw - pa) / L_v  [W]
        // where v=wind speed, A=area, pw/pa in kPa, L_v=latent heat
        $windCoeff = 25 + 19 * $effectWindSpeed; // W/(m²·kPa)
        $evapRateKgPerS = $windCoeff * $area * ($vpDiff / 1000) / self::LATENT_HEAT_VAPORIZATION;
        $evapPerUnitArea = $evapRateKgPerS / $area;

        // Heat loss from evaporation (kW)
        $evapLossKW = $evapRateKgPerS * self::LATENT_HEAT_VAPORIZATION / 1000 * $activityFactor;

        // ========== CONVECTION CALCULATION ==========
        // Using Bowen ratio approach: Q_conv = β * Q_evap
        // β = (c_p / L_v) * (T_water - T_air) / (p_water - p_air) * P_atm
        $tempDiff = $poolTemp - $airTemp; // K (same as °C difference)
        $cP = 1005; // J/(kg·K) specific heat of air
        $pAtm = 101325; // Pa

        // Bowen ratio
        $bowenNumerator = $cP * $tempDiff * $pAtm;
        $bowenDenominator = self::LATENT_HEAT_VAPORIZATION * $vpDiff;
        $bowenRatio = $bowenDenominator > 0 ? $bowenNumerator / $bowenDenominator : 0;

        // Convection loss (kW) = Bowen ratio * Evaporation
        $convLossKW = abs($bowenRatio) * $evapLossKW;

        // ========== RADIATION CALCULATION ==========
        $tWaterK = $poolTemp + 273.15;
        $tSkyK = $this->estimateSkyTemperature($airTemp) + 273.15;
        $tWater4 = pow($tWaterK, 4);
        $tSky4 = pow($tSkyK, 4);
        $radDiff = $tWater4 - $tSky4;

        // Radiation loss (kW)
        $radLossKW = self::STEFAN_BOLTZMANN * self::WATER_EMISSIVITY * $area * $radDiff / 1000;

        // ========== SOLAR GAIN CALCULATION ==========
        // Solar irradiance in kW/m² for this calculation
        $solarKWm2 = $hourlySolar; // Already in kWh/m² for this hour = kW/m² average

        $solarGainKW = 0;
        if ($hasCover && !$isOpen) {
            $solarGainKW = $solarKWm2 * $area * $solarAbsorption * $coverTransmittance;
        } else {
            $solarGainKW = $solarKWm2 * $area * $solarAbsorption;
        }

        // ========== CONDUCTION CALCULATION ==========
        $groundTemp = 10; // °C assumed
        $groundTempDiff = $poolTemp - $groundTemp;
        $uValueWall = 0.58; // W/(m²·K) from Excel
        $groundFactor = $this->getGroundThermalFactor($yearsOperating);

        // Wall loss (kW)
        $wallLossKW = $uValueWall * $wallArea * $groundTempDiff * $groundFactor / 1000;

        // Floor loss (kW)
        $floorLossKW = $uValueWall * $floorArea * $groundTempDiff * $groundFactor / 1000;

        // Total conduction
        $condLossKW = $wallLossKW + $floorLossKW;

        // ========== WATER HEATING (bather makeup) ==========
        // Values from configuration - NO DEFAULTS
        $bathersPerDay = $this->equipment['bathers']['per_day'] ?? null;
        $kwhPerVisit = $this->equipment['bathers']['kwh_per_visit'] ?? null;
        $openHours = $this->equipment['bathers']['open_hours'] ?? null;

        // Calculate water heating only if all bather values are configured
        $waterHeatingKW = 0;
        if ($bathersPerDay !== null && $kwhPerVisit !== null && $openHours !== null && $openHours > 0) {
            $waterHeatingKW = ($bathersPerDay * $kwhPerVisit) / $openHours;
        }

        // ========== APPLY COVER REDUCTION ==========
        if ($hasCover && !$isOpen) {
            $coverFactor = 0.1; // 90% reduction
            $evapLossKW *= $coverFactor;
            $convLossKW *= $coverFactor;
            $radLossKW *= $coverFactor;
        }

        // ========== TOTALS ==========
        $totalLossKW = $evapLossKW + $convLossKW + $radLossKW + $condLossKW + $waterHeatingKW;
        $netRequirementKW = $totalLossKW - $solarGainKW;

        // ========== HEATING OUTPUT ==========
        $hpOutput = 0;
        $hpElectricity = 0;
        $hpCop = 0;
        $boilerOutput = 0;
        $boilerFuel = 0;
        $remainingHeat = max(0, $netRequirementKW);
        // Use equipment config for strategy (same as main simulation)
        $strategy = $this->equipment['control_strategy'] ?? 'hp_priority';

        // Calculate heat pump output (if heat needed and not boiler_priority)
        if ($remainingHeat > 0 && $strategy !== 'boiler_priority') {
            $hpCop = $this->calculateHeatPumpCOP($airTemp);
            $hpCapacity = $this->equipment['heat_pump']['capacity_kw'] ?? 125;
            $hpEnabled = $this->equipment['heat_pump']['enabled'] ?? true;
            $hpType = $this->equipment['heat_pump']['type'] ?? 'ground_source';
            $minOpTemp = $this->equipment['heat_pump']['min_operating_temp'] ?? -20;

            // Ground source (borehole) has no temperature limits
            $canOperate = $hpEnabled && ($hpType === 'ground_source' || $airTemp >= $minOpTemp);

            if ($canOperate) {
                $hpOutput = min($remainingHeat, $hpCapacity);
                $hpElectricity = $hpOutput / $hpCop;
                $remainingHeat -= $hpOutput;
            }
        }

        // Calculate boiler output (for remaining heat)
        if ($remainingHeat > 0) {
            $boilerCapacity = $this->equipment['boiler']['capacity_kw'] ?? 100;
            $boilerEnabled = $this->equipment['boiler']['enabled'] ?? true;
            $boilerEfficiency = $this->equipment['boiler']['efficiency'] ?? 0.92;

            if ($boilerEnabled) {
                $boilerOutput = min($remainingHeat, $boilerCapacity);
                $boilerFuel = $boilerOutput / $boilerEfficiency;
                $remainingHeat -= $boilerOutput;
            }
        }

        $unmetHeat = $remainingHeat;
        $totalHeating = $hpOutput + $boilerOutput;

        // Return detailed breakdown matching Excel format
        return [
            'timestamp' => $timestamp,
            'input' => [
                'date' => $date,
                'hour' => $hour,
                'weather' => [
                    'air_temp_c' => round($airTemp, 2),
                    'wind_speed_ms' => round($windSpeed, 2),
                    'humidity_pct' => round($humidity, 1),
                    'solar_ghi_wm2' => round($solarIrradiance, 2),
                    'tunnel_temp_c' => $tunnelTemp,
                ],
                'pool' => [
                    'water_temp_c' => round($poolTemp, 2),
                    'area_m2' => $area,
                    'volume_m3' => $volume,
                    'depth_m' => $depth,
                    'perimeter_m' => round($perimeter, 1),
                    'wall_area_m2' => round($wallArea, 1),
                    'floor_area_m2' => $floorArea,
                ],
                'config' => [
                    'wind_factor' => $windFactor,
                    'years_operating' => $yearsOperating,
                    'ground_thermal_factor' => $groundFactor,
                    'has_cover' => $hasCover,
                    'cover_u_value' => $coverUValue,
                    'solar_absorption' => $solarAbsorption,
                    'cover_transmittance' => $coverTransmittance,
                    'is_open' => $isOpen,
                    'target_temp' => $targetTemp,
                ],
            ],
            'evaporation' => [
                'p_water_sat_pa' => round($pWaterPa, 1),
                'p_air_sat_pa' => round($pSatPa, 1),
                'p_air_actual_pa' => round($pAirPa, 1),
                'vapor_diff_pa' => round($vpDiff, 1),
                'effect_wind_speed_ms' => round($effectWindSpeed, 3),
                'wind_coeff' => round($windCoeff, 2),
                'evap_per_unit_area_kgm2s' => sprintf('%.6f', $evapPerUnitArea),
                'evap_rate_kgs' => sprintf('%.4f', $evapRateKgPerS),
                'activity_factor' => $activityFactor,
                'evap_loss_kw' => round($evapLossKW, 3),
            ],
            'convection' => [
                'temp_diff_k' => round($tempDiff, 2),
                'bowen_numerator' => round($bowenNumerator, 0),
                'bowen_denominator' => round($bowenDenominator, 0),
                'bowen_ratio' => round($bowenRatio, 3),
                'conv_loss_kw' => round($convLossKW, 3),
            ],
            'radiation' => [
                't_water_k' => round($tWaterK, 2),
                't_water_4' => sprintf('%.0f', $tWater4),
                't_sky_k' => round($tSkyK, 2),
                't_sky_4' => sprintf('%.0f', $tSky4),
                'diff_t4' => sprintf('%.0f', $radDiff),
                'rad_loss_kw' => round($radLossKW, 3),
            ],
            'solar_gain' => [
                'source' => $solarSource, // 'hourly' = pre-calculated, 'daily' = legacy bell curve
                'daily_total_kwh_m2' => round($dailySolar, 3),
                'hourly_kwh_m2' => round($hourlySolar, 4),
                'solar_absorption' => $solarAbsorption,
                'cover_transmittance' => $hasCover && !$isOpen ? $coverTransmittance : 1.0,
                'solar_gain_kw' => round($solarGainKW, 3),
            ],
            'conduction' => [
                'ground_temp_c' => $groundTemp,
                'temp_diff_k' => round($groundTempDiff, 2),
                'u_value' => $uValueWall,
                'wall_area_m2' => round($wallArea, 1),
                'floor_area_m2' => $floorArea,
                'ground_factor' => $groundFactor,
                'wall_loss_kw' => round($wallLossKW, 3),
                'floor_loss_kw' => round($floorLossKW, 3),
                'total_cond_kw' => round($condLossKW, 3),
            ],
            'water_heating' => [
                'bathers_per_day' => $bathersPerDay,
                'kwh_per_visit' => $kwhPerVisit,
                'open_hours' => $openHours,
                'water_heating_kw' => round($waterHeatingKW, 3),
            ],
            'heat_pump' => [
                'strategy' => $strategy,
                'type' => $this->equipment['heat_pump']['type'] ?? 'ground_source',
                'capacity_kw' => $this->equipment['heat_pump']['capacity_kw'] ?? 125,
                'enabled' => $this->equipment['heat_pump']['enabled'] ?? true,
                'min_temp_c' => $this->equipment['heat_pump']['min_operating_temp'] ?? -20,
                'cop' => round($hpCop, 2),
                'output_kw' => round($hpOutput, 3),
                'electricity_kw' => round($hpElectricity, 3),
            ],
            'boiler' => [
                'capacity_kw' => $this->equipment['boiler']['capacity_kw'] ?? 200,
                'enabled' => $this->equipment['boiler']['enabled'] ?? true,
                'efficiency' => $this->equipment['boiler']['efficiency'] ?? 0.92,
                'output_kw' => round($boilerOutput, 3),
                'fuel_kw' => round($boilerFuel, 3),
            ],
            'heating_summary' => [
                'net_demand_kw' => round(max(0, $netRequirementKW), 3),
                'hp_output_kw' => round($hpOutput, 3),
                'boiler_output_kw' => round($boilerOutput, 3),
                'total_heating_kw' => round($totalHeating, 3),
                'unmet_kw' => round($unmetHeat, 3),
            ],
            'summary' => [
                'evaporation_kw' => round($evapLossKW, 3),
                'convection_kw' => round($convLossKW, 3),
                'radiation_kw' => round($radLossKW, 3),
                'wall_loss_kw' => round($wallLossKW, 3),
                'floor_loss_kw' => round($floorLossKW, 3),
                'water_heating_kw' => round($waterHeatingKW, 3),
                'total_loss_kw' => round($totalLossKW, 3),
                'solar_gain_kw' => round($solarGainKW, 3),
                'net_requirement_kw' => round($netRequirementKW, 3),
            ],
            'excel_comparison' => [
                // Excel reference values for 2024-07-27 hour 1
                'excel_evaporation' => 73.0,
                'excel_convection' => 24.318,
                'excel_radiation' => 37.908,
                'excel_solar_gain' => -68.1,
                'excel_wall_loss' => 0.909,
                'excel_floor_loss' => 0.484,
            ],
        ];
    }
}
