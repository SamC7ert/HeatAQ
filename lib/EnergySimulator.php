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
    const VERSION = '3.7.0';

    private $db;
    private $siteId;
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
     * @param string $siteId Site identifier
     * @param PoolScheduler $scheduler Scheduler instance
     */
    public function __construct($db, $siteId = 'arendal_aquatic', $scheduler = null) {
        $this->db = $db;
        $this->siteId = $siteId;
        $this->scheduler = $scheduler;

        // Load pool configuration
        $this->poolConfig = $this->loadPoolConfig();

        // Load equipment configuration
        $this->equipment = $this->loadEquipmentConfig();
    }

    /**
     * Load pool physical configuration from database
     */
    private function loadPoolConfig() {
        $stmt = $this->db->prepare("
            SELECT * FROM pool_configurations
            WHERE site_id = ?
            LIMIT 1
        ");
        $stmt->execute([$this->siteId]);
        $config = $stmt->fetch();

        if (!$config) {
            // Default configuration if no pool_configurations row exists
            // These are conservative defaults - admin should configure actual values
            return [
                'area_m2' => 312.5,      // 25m x 12.5m
                'volume_m3' => 625,       // area × 2m depth
                'depth_m' => 2.0,
                'perimeter_m' => 75,      // 2×(25+12.5)
                'has_cover' => false,     // Default: no cover (must be configured)
                'has_tunnel' => true,
                'cover_r_value' => 5.0,   // U-value when cover exists
                'cover_solar_transmittance' => 0.10, // 10% solar passes through cover
                'solar_absorption' => 0.60,          // 60% solar absorption
                'wind_exposure_factor' => 1.0        // Default: full wind exposure
            ];
        }

        return [
            'area_m2' => (float) ($config['area_m2'] ?? 312.5),
            'volume_m3' => (float) ($config['volume_m3'] ?? 625),
            'depth_m' => (float) ($config['depth_m'] ?? 2.0),
            'perimeter_m' => (float) ($config['perimeter_m'] ?? 75),
            'has_cover' => (bool) ($config['has_cover'] ?? false),
            'has_tunnel' => (bool) ($config['has_tunnel'] ?? true),
            'cover_r_value' => (float) ($config['cover_r_value'] ?? 5.0),
            'cover_solar_transmittance' => (float) ($config['cover_solar_transmittance'] ?? 0.10),
            'solar_absorption' => (float) ($config['solar_absorption'] ?? 0.60),
            'wind_exposure_factor' => (float) ($config['wind_exposure_factor'] ?? 1.0)
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
                WHERE site_id = ?
                LIMIT 1
            ");
            $stmt->execute([$this->siteId]);
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
                'capacity_kw' => 50,       // Nominal heating capacity
                'cop_nominal' => 4.5,       // Coefficient of performance at 15°C air
                'min_operating_temp' => -5, // °C
                'max_operating_temp' => 35, // °C
            ],
            'boiler' => [
                'enabled' => true,
                'capacity_kw' => 100,
                'efficiency' => 0.92,       // 92% efficiency
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
            $this->poolConfig['area_m2'] = $uiConfig['pool']['area_m2'] ?? $this->poolConfig['area_m2'];
            $this->poolConfig['volume_m3'] = $uiConfig['pool']['volume_m3'] ?? $this->poolConfig['volume_m3'];
            $this->poolConfig['depth_m'] = $uiConfig['pool']['depth_m'] ?? $this->poolConfig['depth_m'];
            $this->poolConfig['wind_exposure_factor'] = $uiConfig['pool']['wind_exposure'] ?? $this->poolConfig['wind_exposure_factor'];
        }

        // Cover settings
        if (isset($uiConfig['cover'])) {
            $this->poolConfig['has_cover'] = $uiConfig['cover']['has_cover'] ?? $this->poolConfig['has_cover'];
            $this->poolConfig['cover_r_value'] = $uiConfig['cover']['u_value'] ?? $this->poolConfig['cover_r_value'];
            // UI stores as percentage, convert to decimal
            if (isset($uiConfig['cover']['solar_transmittance'])) {
                $trans = (float) $uiConfig['cover']['solar_transmittance'];
                $this->poolConfig['cover_solar_transmittance'] = $trans > 1 ? $trans / 100 : $trans;
            }
        }

        // Solar settings
        if (isset($uiConfig['solar'])) {
            // UI stores as percentage, convert to decimal
            if (isset($uiConfig['solar']['absorption'])) {
                $absorb = (float) $uiConfig['solar']['absorption'];
                $this->poolConfig['solar_absorption'] = $absorb > 1 ? $absorb / 100 : $absorb;
            }
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
            $this->equipment['target_temp'] = $uiConfig['control']['target_temp'] ?? 28;
            $this->equipment['temp_tolerance'] = $uiConfig['control']['temp_tolerance'] ?? 2;
        }

        // Energy costs
        if (isset($uiConfig['costs'])) {
            $this->equipment['electricity_cost_per_kwh'] = $uiConfig['costs']['electricity_nok_kwh'] ?? $this->equipment['electricity_cost_per_kwh'];
            $this->equipment['boiler']['fuel_cost_per_kwh'] = $uiConfig['costs']['gas_nok_kwh'] ?? $this->equipment['boiler']['fuel_cost_per_kwh'];
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
                'site_id' => $this->siteId,
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

        // Track state
        $currentWaterTemp = 20.0; // Starting water temperature
        $dailyStats = [];
        $currentDay = null;

        // Process each hour
        foreach ($weatherData as $hour) {
            $timestamp = $hour['timestamp'];
            $date = substr($timestamp, 0, 10);
            $hourOfDay = (int) substr($timestamp, 11, 2);

            // Get temperature settings from scheduler (target, min, max)
            $targetTemp = null;
            $minTemp = null;
            $maxTemp = null;
            if ($this->scheduler) {
                $period = $this->scheduler->getCurrentPeriod(new DateTime($timestamp));
                if ($period) {
                    $targetTemp = $period['target_temp'];
                    $minTemp = $period['min_temp'] ?? ($targetTemp - 2);  // Default: target - 2°C
                    $maxTemp = $period['max_temp'] ?? ($targetTemp + 2);  // Default: target + 2°C
                }
            }

            // Get solar for this day
            $dailySolar = $solarData[$date] ?? ['daily_total_kwh_m2' => 0];
            $hourlySolar = $this->distributeSolarToHour($dailySolar, $hourOfDay);

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

            // Determine heating strategy with temperature limits
            $heating = $this->calculateHeating(
                $netRequirement,
                (float) $hour['air_temperature'],
                $targetTemp,
                $currentWaterTemp,
                $minTemp,
                $maxTemp
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
                    'total_hp_kwh' => 0,
                    'total_boiler_kwh' => 0,
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
            WHERE ps.site_id = ?
              AND DATE(wd.timestamp) BETWEEN ? AND ?
            ORDER BY wd.timestamp
        ");
        $stmt->execute([$this->siteId, $startDate, $endDate]);
        return $stmt->fetchAll();
    }

    /**
     * Get solar data for date range
     */
    private function getSolarData($startDate, $endDate) {
        // TODO: Link solar_daily_data to site_id instead of station_id
        $stmt = $this->db->prepare("
            SELECT
                sd.date,
                sd.daily_total_kwh_m2,
                sd.daily_clear_sky_kwh_m2 as clear_sky_kwh_m2,
                sd.cloud_reduction_factor as cloud_factor
            FROM solar_daily_data sd
            JOIN weather_stations ws ON sd.station_id = ws.station_id
            JOIN pool_sites ps ON ws.station_id = ps.default_weather_station
            WHERE ps.site_id = ?
              AND sd.date BETWEEN ? AND ?
            ORDER BY sd.date
        ");
        $stmt->execute([$this->siteId, $startDate, $endDate]);
        $rows = $stmt->fetchAll();

        // Index by date
        $solarByDate = [];
        foreach ($rows as $row) {
            $solarByDate[$row['date']] = $row;
        }
        return $solarByDate;
    }

    /**
     * Distribute daily solar to hourly (simple bell curve)
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
        // Increases with wind and activity
        $activityFactor = $isOpen ? 1.3 : 1.0; // More evaporation when pool is in use
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
     * Always use calculation - lookup table was unreliable
     */
    private function calculateConductionLoss($waterTemp) {
        // Ground temperature assumed ~10°C year-round in Norway
        $groundTemp = 10;
        $tempDiff = $waterTemp - $groundTemp;

        // U-value for pool walls/floor (W/m²·K)
        // Typical insulated pool: 0.3-0.5, uninsulated: 1.0-2.0
        $uValue = 0.5;

        // Calculate areas
        $bottomArea = $this->poolConfig['area_m2'];
        $perimeter = $this->poolConfig['perimeter_m'] ?? $this->calculatePerimeter();
        $sideArea = $perimeter * $this->poolConfig['depth_m'];
        $totalArea = $bottomArea + $sideArea;

        return $uValue * $totalArea * $tempDiff / 1000; // kW
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
     * Uses deadband control with min/max temperature limits:
     * - Below minTemp: Heat up to target
     * - Above maxTemp: Don't heat (allow to cool)
     * - Between min and max: Only compensate for losses
     *
     * @param float $netRequirement Net heat loss (losses - solar gain) in kW
     * @param float $airTemp Current air temperature
     * @param float|null $targetTemp Target water temperature (null = closed)
     * @param float $currentWaterTemp Current water temperature
     * @param float|null $minTemp Minimum allowed temperature
     * @param float|null $maxTemp Maximum allowed temperature
     */
    private function calculateHeating($netRequirement, $airTemp, $targetTemp, $currentWaterTemp, $minTemp = null, $maxTemp = null) {
        $result = [
            'hp_heat' => 0,
            'hp_electricity' => 0,
            'hp_cop' => 0,
            'boiler_heat' => 0,
            'boiler_fuel' => 0,
            'total_heat' => 0,
            'cost' => 0,
        ];

        // If no target temp (closed), minimal heating to prevent freezing
        if ($targetTemp === null) {
            $targetTemp = 15; // Minimum maintenance temperature
            $minTemp = 10;
            $maxTemp = 20;
        }

        // Default min/max if not provided
        if ($minTemp === null) {
            $minTemp = $targetTemp - 2;
        }
        if ($maxTemp === null) {
            $maxTemp = $targetTemp + 2;
        }

        // Deadband control logic:
        // 1. If water temp > maxTemp: No heating (allow to cool naturally)
        if ($currentWaterTemp >= $maxTemp) {
            return $result;
        }

        // 2. Calculate required heating based on current state
        $requiredHeat = 0;

        if ($currentWaterTemp < $minTemp) {
            // Below minimum: Heat aggressively to reach target
            $tempDeficit = $targetTemp - $currentWaterTemp;
            $heatToRaiseTemp = $this->calculateHeatForTempRise($tempDeficit, 1.0);
            $requiredHeat = $netRequirement + max(0, $heatToRaiseTemp);
        } else {
            // Within deadband (minTemp to maxTemp): Just compensate for losses
            $requiredHeat = max(0, $netRequirement);
        }

        // If negative (solar gain exceeds losses), no heating needed
        if ($requiredHeat <= 0) {
            return $result;
        }

        // Apply heating strategy
        $strategy = $this->equipment['control_strategy'] ?? 'hp_priority';

        $remainingHeat = $requiredHeat;

        // Heat pump first (more efficient)
        if ($strategy === 'hp_priority' || $strategy === 'cost_optimal') {
            $hpResult = $this->applyHeatPump($remainingHeat, $airTemp);
            $result['hp_heat'] = $hpResult['heat'];
            $result['hp_electricity'] = $hpResult['electricity'];
            $result['hp_cop'] = $hpResult['cop'];
            $result['cost'] += $hpResult['cost'];
            $remainingHeat -= $hpResult['heat'];
        }

        // Boiler for remaining
        if ($remainingHeat > 0 && $this->equipment['boiler']['enabled']) {
            $boilerResult = $this->applyBoiler($remainingHeat);
            $result['boiler_heat'] = $boilerResult['heat'];
            $result['boiler_fuel'] = $boilerResult['fuel'];
            $result['cost'] += $boilerResult['cost'];
            $remainingHeat -= $boilerResult['heat'];
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

        // Check operating temperature range
        if ($airTemp < $hp['min_operating_temp'] || $airTemp > $hp['max_operating_temp']) {
            return ['heat' => 0, 'electricity' => 0, 'cop' => 0, 'cost' => 0];
        }

        // Calculate COP based on air temperature
        // COP decreases as air temp drops
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
        $nominalCOP = $hp['cop_nominal'];

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

        $volume = $this->poolConfig['volume_m3'];
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
        $volume = $this->poolConfig['volume_m3'];
        $mass = $volume * self::WATER_DENSITY;

        // Energy in kJ
        $energy = $heatBalanceKW * $hours * 3600;

        // Temperature change
        return $energy / ($mass * self::WATER_SPECIFIC_HEAT / 1000);
    }
}
