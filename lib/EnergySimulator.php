<?php
/**
 * HeatAQ run preparation: everything the simulation engine needs for a run.
 *
 * The simulation itself runs in the browser (TypeScript engine, sim-ts/,
 * assets/js/sim/). This class holds a run's configuration (pool, equipment,
 * control settings from the config template, the run's overrides and the
 * schedule), validates it, loads the run's data from the database (weather,
 * solar, forecasts) and exports it all as the engine's inputs
 * (exportRunInputs()). The former PHP engine (until simulator 3.19.0) is in
 * git history; its results are kept in tests/reference.
 *
 * The simulator version is the engine's (sim-ts PORT_OF_VERSION), written to
 * assets/js/sim/version.json by the engine's build (getVersion()).
 */

class EnergySimulator {
    const TARGET_OFFSET_LIMIT = 5.0;  // °C, max |offset| accepted from SimControl

    private $db;
    private $siteId;
    private $poolSiteId;  // INT pool_site_id for solar tables
    private $scheduler;

    // Pool physical parameters
    private $poolConfig;

    // Equipment parameters
    private $equipment;

    private $thermalMassRate = null;     // kWh/°C - energy to raise pool 1°C

    const WATER_DENSITY = 1000;      // kg/m³
    const WATER_SPECIFIC_HEAT = 4186; // J/(kg·K)

    /**
     * Initialize simulator
     *
     * @param PDO $db Database connection
     * @param int $poolSiteId Integer pool_site_id (references pool_sites.id) - REQUIRED
     * @param PoolScheduler $scheduler Scheduler instance
     * @throws InvalidArgumentException if poolSiteId is not provided
     */
    public function __construct($db, $poolSiteId, $scheduler = null) {
        if (!$poolSiteId) {
            throw new InvalidArgumentException('EnergySimulator requires poolSiteId - no default allowed');
        }
        $this->db = $db;
        $this->poolSiteId = (int)$poolSiteId;
        $this->siteId = null; // Deprecated - kept for compatibility
        $this->scheduler = $scheduler;

        // Load pool configuration
        $this->poolConfig = $this->loadPoolConfig();

        // Load equipment configuration
        $this->equipment = $this->loadEquipmentConfig();
        $this->syncSchedulerTargets();
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
     * NOTE: No defaults - validation will fail if equipment not configured
     */
    private function loadEquipmentConfig() {
        // Try to load from config_templates
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
                    error_log("[EnergySimulator] Loaded equipment config from database for pool_site_id={$this->poolSiteId}");
                    return $config;
                }
            }
        } catch (\PDOException $e) {
            error_log("[EnergySimulator] Could not load equipment config: " . $e->getMessage());
        }

        // Return empty structure - will fail validation if setConfigFromUI not called
        error_log("[EnergySimulator] WARNING: No equipment config found in database - must be set via setConfigFromUI()");
        return [
            'heat_pump' => [
                'enabled' => null,
                'type' => null,
                'capacity_kw' => null,
                'cop_nominal' => null,
                'min_operating_temp' => null,
                'max_operating_temp' => null,
            ],
            'boiler' => [
                'enabled' => null,
                'capacity_kw' => null,
                'efficiency' => null,
                'fuel_type' => null,
                'fuel_cost_per_kwh' => null,
            ],
            'electricity_cost_per_kwh' => null,
            'control_strategy' => null,
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

            // Wind exposure is a fraction (0.5 = 50 %). SimControl's override is
            // typed as a percentage, so a value above 1 is read as percent -
            // previously "40" became a 40x factor on evaporation/convection.
            if (isset($uiConfig['pool']['wind_exposure'])) {
                $wind = (float) $uiConfig['pool']['wind_exposure'];
                $this->poolConfig['wind_exposure_factor'] = $wind > 1 ? $wind / 100 : $wind;
            }
            $this->poolConfig['years_operating'] = $uiConfig['pool']['years_operating'] ?? $this->poolConfig['years_operating'];
            $this->poolConfig['has_tunnel'] = $uiConfig['pool']['has_tunnel'] ?? $this->poolConfig['has_tunnel'];

            // Solar absorption can come from pool section (from pools table)
            if (isset($uiConfig['pool']['solar_absorption'])) {
                $absorb = (float) $uiConfig['pool']['solar_absorption'];
                $this->poolConfig['solar_absorption'] = $absorb > 1 ? $absorb / 100 : $absorb;
            }

            // Recalculate thermal mass rate if volume is set
            if (isset($this->poolConfig['volume_m3']) && $this->poolConfig['volume_m3'] > 0) {
                $poolMass = $this->poolConfig['volume_m3'] * self::WATER_DENSITY;
                $this->thermalMassRate = $poolMass * self::WATER_SPECIFIC_HEAT / 3600000;
                error_log("[EnergySimulator] setConfigFromUI: volume={$this->poolConfig['volume_m3']}, thermalMassRate={$this->thermalMassRate}");
            } else {
                error_log("[EnergySimulator] setConfigFromUI: volume NOT SET or 0, poolConfig=" . json_encode($this->poolConfig));
            }
        }

        // Cover settings
        // NOTE: has_cover comes from pools table and should NOT be overridden by config template
        if (isset($uiConfig['cover'])) {
            // Only set has_cover if it's explicitly true in uiConfig, or if poolConfig doesn't have it yet
            if (isset($uiConfig['cover']['has_cover']) && $uiConfig['cover']['has_cover'] === true) {
                $this->poolConfig['has_cover'] = true;
            } elseif ($this->poolConfig['has_cover'] === null && isset($uiConfig['cover']['has_cover'])) {
                $this->poolConfig['has_cover'] = (bool)$uiConfig['cover']['has_cover'];
            }
            // Other cover settings can be overridden
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
            // Boiler type: 'electric' (input is electricity, at the electricity
            // price) or 'fuel' (gas/oil, at the fuel price). Not set = 'fuel',
            // how every boiler was priced before the type existed.
            if (array_key_exists('boiler_type', $uiConfig['equipment'])) {
                $type = $uiConfig['equipment']['boiler_type'];
                if ($type !== null && $type !== '' && !in_array($type, ['electric', 'fuel'], true)) {
                    throw new InvalidArgumentException("Boiler type must be 'electric' or 'fuel'");
                }
                $this->equipment['boiler']['fuel_type'] = ($type === '' ? null : $type);
            }

            $this->refreshUnitsEnabled();
        }

        // Control settings
        if (isset($uiConfig['control'])) {
            $this->equipment['control_strategy'] = $uiConfig['control']['strategy'] ?? $this->equipment['control_strategy'];
            // Preserve previously-set values on a PARTIAL override. A per-sim
            // override may carry only one field (e.g. just upper_tolerance);
            // "?? null" would wipe target_temp and silently revert the pool to
            // the 28°C fallback.
            $this->equipment['target_temp'] = $uiConfig['control']['target_temp'] ?? $this->equipment['target_temp'] ?? null;
            // "Max overheat" (°C above target). The former lower tolerance is
            // no longer used: the closed-period floor is standby_temp (3.18).
            $this->equipment['upper_tolerance'] = $uiConfig['control']['upper_tolerance'] ?? $this->equipment['upper_tolerance'] ?? null;
            // "Min temp when closed" (predictive): the lowest water
            // temperature while closed - nights, weekends, long closures
            // (closedFloor()). Blank/null = no minimum (5 °C frost floor).
            if (array_key_exists('standby_temp', $uiConfig['control'])) {
                $sb = $uiConfig['control']['standby_temp'];
                $this->equipment['standby_temp'] = ($sb === null || $sb === '' || !is_numeric($sb)) ? null : (float) $sb;
            }
            // Planning weather (predictive): 'actual' = plans read the actual
            // weather ahead (hindsight, the best case); 'forecast' = plans read
            // the newest forecast available at the time (weather_forecasts).
            if (array_key_exists('planning_weather', $uiConfig['control'])) {
                $pw = $uiConfig['control']['planning_weather'];
                $pw = ($pw === null || $pw === '') ? 'actual' : $pw;
                if (!in_array($pw, ['actual', 'forecast'], true)) {
                    throw new InvalidArgumentException("Planning weather must be 'actual' or 'forecast'");
                }
                $this->equipment['planning_weather'] = $pw;
            }
            // For backward compat, also check temp_tolerance
            if (isset($uiConfig['control']['temp_tolerance'])) {
                $this->equipment['upper_tolerance'] = $uiConfig['control']['temp_tolerance'];
            }
            // Simulation target offset (SimControl): added to every hour's
            // target (schedule period target, or the config default where the
            // period has none). Stored with the equipment so a run's snapshot
            // carries it into the Details/debug views.
            if (array_key_exists('target_offset', $uiConfig['control'])) {
                $offset = $uiConfig['control']['target_offset'];
                if ($offset === null || $offset === '') {
                    $offset = 0.0;
                }
                if (!is_numeric($offset) || abs((float) $offset) > self::TARGET_OFFSET_LIMIT) {
                    throw new InvalidArgumentException('Target offset must be between -' . self::TARGET_OFFSET_LIMIT
                        . ' and +' . self::TARGET_OFFSET_LIMIT . ' °C');
                }
                $this->equipment['target_offset'] = (float) $offset;
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
        // A partial override (e.g. SimControl sends only per_day) keeps the
        // other values already set by the config template.
        if (isset($uiConfig['bathers'])) {
            $prev = $this->equipment['bathers'] ?? [];
            $perDay = $uiConfig['bathers']['per_day'] ?? $prev['per_day'] ?? null;
            $refillLiters = $uiConfig['bathers']['refill_liters'] ?? $prev['refill_liters'] ?? null;
            $showerLiters = $uiConfig['bathers']['shower_liters'] ?? $prev['shower_liters'] ?? null;
            $activityFactor = $uiConfig['bathers']['activity_factor'] ?? $prev['activity_factor'] ?? null;
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
                'open_hours' => $uiConfig['bathers']['open_hours'] ?? $prev['open_hours'] ?? 10,
            ];
        }

        // Calculate thermal mass rate for predictive control (kWh/°C)
        // Python: self.thermal_mass_rate = pool_mass * 4186 / 3600000
        if ($this->poolConfig['volume_m3'] !== null) {
            $poolMass = $this->poolConfig['volume_m3'] * self::WATER_DENSITY; // kg
            $this->thermalMassRate = $poolMass * self::WATER_SPECIFIC_HEAT / 3600000; // kWh/°C
        }

        $this->syncSchedulerTargets();
    }

    // ------------------------------------------------------------------
    // Target temperature resolution
    //
    // Effective target for an open hour = (schedule period target, or the
    // config default where the period has none) + simulation offset. The
    // scheduler resolves period targets; these helpers give the same value
    // wherever no period applies (fallbacks) and keep the scheduler in sync.
    // ------------------------------------------------------------------

    /** Config default target (°C): used where a schedule period has no target. */
    private function configDefaultTarget() {
        return (float) ($this->equipment['target_temp'] ?? 28.0);
    }

    /** Simulation offset (°C) added to every target. */
    private function targetOffset() {
        return (float) ($this->equipment['target_offset'] ?? 0.0);
    }



    /**
     * Local clock times ('Y-m-d H:i:s' in the site's time zone) are handled
     * as wall-clock values in a fixed zone (UTC), so date arithmetic does not
     * depend on the server's default time zone (it used to: on a non-UTC
     * server the hours to the next opening on a DST night differed by one).
     * The TypeScript engine (assets/js/sim) uses the same rule.
     */
    private static function wallClock() {
        static $utc = null;
        return $utc ??= new DateTimeZone('UTC');
    }

    private $siteTz = null;

    /** The site's time zone, from its coordinates (lib/SiteTimezone.php). */
    private function siteTimezone() {
        if ($this->siteTz === null) {
            require_once __DIR__ . '/SiteTimezone.php';
            $this->siteTz = $this->poolSiteId ? SiteTimezone::forSite($this->db, $this->poolSiteId) : new DateTimeZone('UTC');
        }
        return $this->siteTz;
    }

    /** 'Y-m-d H:i:s' in UTC -> the site's local clock time. */
    private function toLocalTime($utc) {
        $d = new DateTime($utc, new DateTimeZone('UTC'));
        $d->setTimezone($this->siteTimezone());
        return $d->format('Y-m-d H:i:s');
    }



    /** Push default + offset into the scheduler so period targets resolve the same way. */
    private function syncSchedulerTargets() {
        if ($this->scheduler && method_exists($this->scheduler, 'setTargetSettings')) {
            $this->scheduler->setTargetSettings($this->configDefaultTarget(), $this->targetOffset());
        }
    }

    /**
     * Set equipment configuration
     */
    public function setEquipment($equipment) {
        // Deep merge: overriding heat_pump.capacity_kw must keep its COP etc.
        $this->equipment = array_replace_recursive($this->equipment, $equipment);
        $this->refreshUnitsEnabled();
        $this->syncSchedulerTargets();
    }

    /** A heat pump / boiler runs exactly when it has capacity (overrides included). */
    private function refreshUnitsEnabled() {
        foreach (['heat_pump', 'boiler'] as $unit) {
            $this->equipment[$unit]['enabled'] = (float) ($this->equipment[$unit]['capacity_kw'] ?? 0) > 0;
        }
    }

    private static $version = null;

    /**
     * The simulator version: the engine's (sim-ts PORT_OF_VERSION), which its
     * build writes to assets/js/sim/version.json. Saved with each run and
     * in its inputs; the engine refuses inputs prepared for another version
     * only in the reference set (results per version).
     */
    public static function getVersion() {
        if (self::$version === null) {
            $raw = @file_get_contents(dirname(__DIR__) . '/assets/js/sim/version.json');
            $v = $raw ? (json_decode($raw, true)['version'] ?? null) : null;
            self::$version = is_string($v) && preg_match('/^\d+\.\d+\.\d+$/', $v) ? $v : 'unknown';
        }
        return self::$version;
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

            // Recalculate thermal mass rate if volume is available
            if (isset($this->poolConfig['volume_m3']) && $this->poolConfig['volume_m3'] > 0) {
                $poolMass = $this->poolConfig['volume_m3'] * self::WATER_DENSITY; // kg
                $this->thermalMassRate = $poolMass * self::WATER_SPECIFIC_HEAT / 3600000; // kWh/°C
                error_log("[setPoolConfig] volume={$this->poolConfig['volume_m3']}, thermalMassRate={$this->thermalMassRate}");
            } else {
                error_log("[setPoolConfig] volume NOT SET: " . json_encode($poolConfig));
            }
        }
    }

    /**
     * Get equipment configuration
     */
    public function getEquipment() {
        return $this->equipment;
    }

    /**
     * Get thermal mass rate (kWh/°C)
     * Used for debugging to verify calculation in config_snapshot
     */
    public function getThermalMassRate() {
        return $this->thermalMassRate;
    }

    /**
     * Validate configuration before running simulation
     * Throws exception if required values are missing - NO silent defaults
     *
     * @throws InvalidArgumentException if required config is missing
     */
    private function validateConfigForSimulation() {
        $errors = [];

        // Pool config validation
        if (!isset($this->poolConfig['area_m2']) || $this->poolConfig['area_m2'] === null) {
            $errors[] = 'pool.area_m2 is required';
        }
        if (!isset($this->poolConfig['volume_m3']) || $this->poolConfig['volume_m3'] === null) {
            $errors[] = 'pool.volume_m3 is required';
        }
        if (!isset($this->poolConfig['depth_m']) || $this->poolConfig['depth_m'] === null) {
            $errors[] = 'pool.depth_m is required';
        }

        // Equipment validation
        if (!isset($this->equipment['heat_pump']['capacity_kw']) || $this->equipment['heat_pump']['capacity_kw'] === null) {
            $errors[] = 'equipment.heat_pump.capacity_kw is required';
        }
        if (!isset($this->equipment['boiler']['capacity_kw']) || $this->equipment['boiler']['capacity_kw'] === null) {
            $errors[] = 'equipment.boiler.capacity_kw is required';
        }

        // A unit that can run needs its efficiency and price: a cleared field
        // saves as null, which divided by zero (boiler) or priced energy at 0.
        $positive = fn($v) => is_numeric($v) && (float) $v > 0;
        if ((float) ($this->equipment['heat_pump']['capacity_kw'] ?? 0) > 0) {
            if (!$positive($this->equipment['heat_pump']['cop_nominal'] ?? null)) {
                $errors[] = 'heat pump COP must be greater than 0';
            }
            if (!is_numeric($this->equipment['electricity_cost_per_kwh'] ?? null)) {
                $errors[] = 'electricity price is required';
            }
        }
        if ((float) ($this->equipment['boiler']['capacity_kw'] ?? 0) > 0) {
            if (!$positive($this->equipment['boiler']['efficiency'] ?? null)) {
                $errors[] = 'boiler efficiency must be greater than 0';
            }
            if ($this->boilerIsElectric()) {
                if (!is_numeric($this->equipment['electricity_cost_per_kwh'] ?? null)) {
                    $errors[] = 'electricity price is required (electric boiler)';
                }
            } elseif (!is_numeric($this->equipment['boiler']['fuel_cost_per_kwh'] ?? null)) {
                $errors[] = 'boiler fuel price is required';
            }
        }

        // Thermal mass rate (calculated from volume)
        if ($this->thermalMassRate === null || $this->thermalMassRate <= 0) {
            $errors[] = 'thermal_mass_rate not calculated (check volume_m3)';
        }

        if (!empty($errors)) {
            throw new InvalidArgumentException(
                'Simulation config validation failed - no defaults allowed: ' . implode('; ', $errors)
            );
        }
    }

    /**
     * Validate weather data has required fields
     *
     * @param array $weatherData Weather data array
     * @throws InvalidArgumentException if required weather fields are missing
     */
    private function validateWeatherData($weatherData, $startDate, $endDate) {
        if (empty($weatherData)) {
            throw new InvalidArgumentException('No weather data available for simulation period');
        }

        // Sample first few records to validate structure
        // STRICT validation - no silent fallbacks (project principle).
        // The old version sampled only the first 24 rows and merely logged a
        // warning, so a gap at hour 5000 sailed through and the loop quietly
        // substituted wind=2.0 / humidity=70 straight into the energy and cost
        // figures. Now the WHOLE array is scanned and any missing field or
        // missing hour stops the run with an actionable message.
        $remedy = 'Fix: Admin -> Weather Stations -> select the station -> Update Data '
            . '(the fetch retries transient failures and now also fills the previously '
            . 'missing Dec 31 hours), then re-run the simulation.';

        $expectedHours = ((int) ((strtotime($endDate . ' UTC') - strtotime($startDate . ' UTC')) / 86400) + 1) * 24;

        if (count($weatherData) === 0) {
            throw new RuntimeException(
                "No weather data found for {$startDate}..{$endDate} (expected {$expectedHours} hourly rows). {$remedy}"
            );
        }

        // 1) Field completeness across ALL rows
        $missing = ['air_temperature' => [], 'wind_speed' => [], 'humidity' => []];
        foreach ($weatherData as $hour) {
            foreach ($missing as $field => $_) {
                if (!isset($hour[$field])) {
                    $missing[$field][] = $hour['timestamp'] ?? '(no timestamp)';
                }
            }
        }
        $problems = [];
        foreach ($missing as $field => $timestamps) {
            $n = count($timestamps);
            if ($n > 0) {
                $examples = implode(', ', array_slice($timestamps, 0, 3));
                $problems[] = "{$field} is NULL for {$n} hour(s) (e.g. {$examples})";
            }
        }
        if ($problems) {
            throw new RuntimeException(
                'Weather data is incomplete - simulation stopped (no silent fallbacks): '
                . implode('; ', $problems) . '. ' . $remedy
            );
        }

        // 2) Hour coverage of the requested span. Missing rows would otherwise
        //    silently shorten the simulated period and skew the per-year figures.
        $actual = count($weatherData);
        if ($actual < $expectedHours) {
            $gaps = [];
            $rows = array_values($weatherData);
            $prev = strtotime($startDate . ' 00:00:00 UTC') - 3600; // expect first row at 00:00
            foreach ($rows as $hour) {
                // UTC parse: local-DST wall times are ambiguous at changeovers and
                // would manufacture phantom gaps over complete data.
                $ts = strtotime($hour['timestamp'] . ' UTC');
                $delta = (int) round(($ts - $prev) / 3600);
                if ($delta > 1) {
                    $gaps[] = ($delta - 1) . ' h after ' . gmdate('Y-m-d H:i', $prev);
                    if (count($gaps) >= 5) break;
                }
                $prev = $ts;
            }
            $tailEnd = strtotime($endDate . ' 23:00:00 UTC');
            if (count($gaps) < 5 && $prev < $tailEnd) {
                $gaps[] = ((int) round(($tailEnd - $prev) / 3600)) . ' h after ' . gmdate('Y-m-d H:i', $prev);
            }
            $missingTotal = $expectedHours - $actual;
            throw new RuntimeException(
                "Weather data covers only {$actual} of {$expectedHours} hours in {$startDate}..{$endDate} "
                . "({$missingTotal} h missing; first gaps: " . implode(', ', $gaps) . '). '
                . 'Simulation stopped (no silent fallbacks). ' . $remedy
            );
        }
    }

    /**
     * The engine's inputs for a run (sim-ts RunInputs): the configuration,
     * the schedule copy, and the run's weather (UTC + local time), solar data
     * and, when planning on forecasts, the forecast runs. The browser runs
     * the engine on this; the reference set freezes it (tests/reference).
     */
    public function exportRunInputs($startDate, $endDate) {
        $data = $this->loadRunData($startDate, $endDate);
        $weather = [];
        foreach ($data['weather'] as $r) {
            $weather[] = [
                $r['timestamp'],
                $this->toLocalTime($r['timestamp']),
                isset($r['air_temperature']) ? (float) $r['air_temperature'] : null,
                isset($r['wind_speed']) ? (float) $r['wind_speed'] : null,
                isset($r['humidity']) ? (float) $r['humidity'] : null,
                isset($r['tunnel_temperature']) ? (float) $r['tunnel_temperature'] : null,
            ];
        }
        // Solar: hourly values keyed by UTC timestamp, or daily rows by date
        $solarKind = 'none';
        $solar = [];
        foreach ($data['solar'] as $key => $row) {
            if (isset($row['hourly_kwh_m2'])) {
                $solarKind = 'hourly';
                $solar[$key] = (float) $row['hourly_kwh_m2'];
            } else {
                $solarKind = 'daily';
                $solar[$key] = (float) ($row['daily_total_kwh_m2'] ?? 0);
            }
        }
        $inputs = [
            'format' => 1,
            'simulator_version' => self::getVersion(),
            'start_date' => $startDate,
            'end_date' => $endDate,
            'strategy_requested' => $data['strategy_requested'],
            'pool_config' => $this->poolConfig,
            'equipment' => $this->equipment,
            'thermal_mass_rate' => $this->thermalMassRate,
            'ground_factor' => $this->getGroundThermalFactor($this->poolConfig['years_operating'] ?? 3),
            'schedule' => $this->scheduler ? $this->scheduler->exportState() : null,
            'weather' => $weather,
            'solar_kind' => $solarKind,
            'solar' => (object) $solar,
        ];
        // Planning on forecasts: the forecast runs (only then, so other
        // inputs stay as before)
        if ($data['forecast'] !== null) {
            $inputs['forecast'] = $data['forecast'];
        }
        return $inputs;
    }

    /** Planning on forecasts? (predictive control with planning_weather = 'forecast') */
    private function plansOnForecasts() {
        return ($this->equipment['control_strategy'] ?? 'reactive') === 'predictive'
            && ($this->equipment['planning_weather'] ?? 'actual') === 'forecast';
    }

    /**
     * The forecast runs for a run's planning, in the inputs form:
     * ['source', 'runs' => [[issued, available, first_valid, air[], wind[],
     * humidity[]], ...]], sorted by available time; each run's values are
     * consecutive hours from first_valid (null where an hour is missing).
     * Runs issued from 3 days before the first weather hour to the last.
     * Throws when there is none: planning on forecasts without forecasts
     * would silently fall back to hindsight.
     */
    private function getForecastData(array $weatherAll) {
        $source = 'met_nordic';
        if (!$weatherAll) {
            return ['source' => $source, 'runs' => []];
        }
        $first = $weatherAll[0]['timestamp'];
        $last = $weatherAll[count($weatherAll) - 1]['timestamp'];
        $from = gmdate('Y-m-d H:i:s', strtotime($first . ' UTC') - 3 * 86400);
        try {
            $stmt = $this->db->prepare("
                SELECT wf.issued_at, wf.available_at, wf.valid_at,
                       wf.air_temperature, wf.wind_speed, wf.humidity
                FROM weather_forecasts wf
                JOIN pool_sites ps ON wf.station_id = COALESCE(ps.weather_station_id, ps.default_weather_station)
                WHERE ps.id = ? AND wf.source = ? AND wf.issued_at BETWEEN ? AND ?
                ORDER BY wf.available_at, wf.issued_at, wf.valid_at
            ");
            $stmt->execute([$this->poolSiteId, $source, $from, $last]);
        } catch (PDOException $e) {
            throw new RuntimeException('Planning on forecasts needs the weather_forecasts table: '
                . 'run migration 042 (Admin -> System -> Database Migrations).');
        }
        $runs = [];
        $cur = null;
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            if ($cur === null || $cur[0] !== $r['issued_at']) {
                if ($cur !== null) $runs[] = $cur;
                $cur = [$r['issued_at'], $r['available_at'], $r['valid_at'], [], [], []];
                $expect = $r['valid_at'];
            }
            // Keep the hours consecutive: a missing hour becomes null
            while ($expect < $r['valid_at']) {
                $cur[3][] = null; $cur[4][] = null; $cur[5][] = null;
                $expect = gmdate('Y-m-d H:i:s', strtotime($expect . ' UTC') + 3600);
            }
            $cur[3][] = (float) $r['air_temperature'];
            $cur[4][] = (float) $r['wind_speed'];
            $cur[5][] = (float) $r['humidity'];
            $expect = gmdate('Y-m-d H:i:s', strtotime($r['valid_at'] . ' UTC') + 3600);
        }
        if ($cur !== null) $runs[] = $cur;
        if (!$runs) {
            throw new RuntimeException("No weather forecasts for this site's weather station from {$from} to {$last} (UTC). "
                . 'Import them (Admin -> Weather -> Weather Forecasts; see scripts/forecast/README.md), '
                . 'or set Planning weather to Actual.');
        }
        return ['source' => $source, 'runs' => $runs];
    }






    /**
     * Validate the configuration and load what a run needs from the database:
     * the weather rows (UTC, covering the requested LOCAL days), the solar
     * data, the strategy actually used, and the forecasts when planning on
     * them. Stops with what to fix when anything is missing.
     */
    private function loadRunData($startDate, $endDate) {
        // Validate configuration before running - no silent defaults allowed
        $this->validateConfigForSimulation();
        $this->refreshUnitsEnabled();

        // Predictive control builds its buffer with the heat pump only; with no
        // heat pump it never heats a closed pool and lets it cool to the 5 °C
        // floor. Such a plant runs reactive instead, recorded on the summary.
        $strategyRequested = $this->equipment['control_strategy'] ?? 'reactive';
        if ($strategyRequested === 'predictive' && empty($this->equipment['heat_pump']['enabled'])) {
            $this->equipment['control_strategy'] = 'reactive';
        }

        $start = new DateTime($startDate, self::wallClock());
        $end = new DateTime($endDate, self::wallClock());

        // Get weather data for period. Validation is on the requested UTC days;
        // the run itself covers the requested LOCAL days, so the last hours of
        // the previous UTC day are included when present (local midnight is
        // 23:00/22:00 UTC in Norway) and hours past local midnight dropped.
        $prevDay = date('Y-m-d', strtotime($startDate . ' -1 day'));
        $weatherAll = $this->getWeatherData($prevDay, $endDate);
        $weatherData = array_values(array_filter($weatherAll, fn($r) => substr($r['timestamp'], 0, 10) >= $startDate));

        // Validate weather data structure
        $this->validateWeatherData($weatherData, $startDate, $endDate);

        $weatherData = array_values(array_filter($weatherAll, function ($r) use ($startDate, $endDate) {
            $localDate = substr($this->toLocalTime($r['timestamp']), 0, 10);
            return $localDate >= $startDate && $localDate <= $endDate;
        }));

        // Get solar data for period. Like the weather, it is fetched from the
        // previous UTC day: the first local day starts on that day's last
        // UTC hours. Coverage is still checked on the requested days only.
        $solarData = $this->getSolarData($prevDay, $endDate);

        // STRICT: when the site has solar data, it must cover every day of the
        // run - a partially covered period would silently contribute 0 solar
        // gain on the missing days and overstate heating demand. A site with
        // NO solar data at all runs explicitly (and visibly) without solar.
        // "Has solar data" is decided for the site, not the period: data for
        // other years only must not make this run silently solar-free.
        if (!empty($solarData) || $this->siteHasSolarData()) {
            $missingDays = [];
            $cursor = new DateTime($startDate, self::wallClock());
            $last = new DateTime($endDate, self::wallClock());
            while ($cursor <= $last) {
                $day = $cursor->format('Y-m-d');
                // Daily data is keyed by date, hourly by full timestamp
                if (!isset($solarData[$day]) && !isset($solarData[$day . ' 12:00:00'])) {
                    $missingDays[] = $day;
                }
                $cursor->modify('+1 day');
            }
            if ($missingDays) {
                $n = count($missingDays);
                $examples = implode(', ', array_slice($missingDays, 0, 3));
                throw new RuntimeException(
                    "Solar data is missing for {$n} day(s) in {$startDate}..{$endDate} (e.g. {$examples}). "
                    . 'Simulation stopped (no silent fallbacks - missing days would count as 0 solar gain). '
                    . 'Fix: re-fetch NASA solar data for the site (Project -> Edit Site -> Fetch Solar Data); '
                    . 'NASA marks not-yet-processed recent days as missing, so very recent dates may need a '
                    . 'shorter simulation period. Alternatively delete the site solar data to run explicitly without solar.'
                );
            }
        }

        return [
            'weather' => $weatherData,
            'solar' => $solarData,
            'strategy_requested' => $strategyRequested,
            // Planning on forecasts: the forecast runs covering the run
            'forecast' => $this->plansOnForecasts() ? $this->getForecastData($weatherData) : null,
        ];
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
            JOIN pool_sites ps ON ws.station_id = COALESCE(ps.weather_station_id, ps.default_weather_station)
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
     * Does the site have ANY solar data (hourly, or daily via its station)?
     */
    private function siteHasSolarData() {
        if ($this->hasHourlySolarData()) return true;
        if (!$this->poolSiteId) return false;
        $stmt = $this->db->prepare("
            SELECT 1
            FROM solar_daily_data sd
            JOIN pool_sites ps ON sd.station_id = COALESCE(ps.weather_station_id, ps.default_weather_station)
            WHERE ps.id = ?
            LIMIT 1
        ");
        $stmt->execute([$this->poolSiteId]);
        return (bool) $stmt->fetchColumn();
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
            JOIN pool_sites ps ON ws.station_id = COALESCE(ps.weather_station_id, ps.default_weather_station)
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
     * Get ground thermal factor based on years of operation
     * Ground around pool warms up over time, reducing heat loss
     */
    private $groundFactorCache = [];

    private function getGroundThermalFactor($yearsOperating) {
        // Fixed for a run, but asked for on every heat-loss calculation
        // (2 DB queries each): look it up once per value.
        $key = (string) $yearsOperating;
        if (!array_key_exists($key, $this->groundFactorCache)) {
            $this->groundFactorCache[$key] = $this->lookupGroundThermalFactor($yearsOperating);
        }
        return $this->groundFactorCache[$key];
    }

    private function lookupGroundThermalFactor($yearsOperating) {
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
     * Apply boiler heating
     */
    /** True when the boiler runs on electricity (config boiler_type 'electric'). */
    private function boilerIsElectric() {
        return ($this->equipment['boiler']['fuel_type'] ?? null) === 'electric';
    }





}
