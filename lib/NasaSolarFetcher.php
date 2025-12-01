<?php
/**
 * NASA POWER Solar Data Fetcher
 *
 * Fetches daily solar radiation data from NASA POWER API and distributes
 * to hourly values using solar position calculation (matching Python script).
 */

class NasaSolarFetcher {
    private $db;
    private $siteId;      // VARCHAR site_id (for pool_sites lookup)
    private $poolSiteId;  // INT pool_site_id (for solar tables)

    // NASA POWER API endpoint
    const NASA_API_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';

    public function __construct(PDO $db, string $siteId) {
        $this->db = $db;
        $this->siteId = $siteId;

        // Get numeric pool_site_id from VARCHAR site_id
        $stmt = $db->prepare("SELECT id FROM pool_sites WHERE site_id = ?");
        $stmt->execute([$siteId]);
        $result = $stmt->fetch();
        $this->poolSiteId = $result ? (int)$result['id'] : null;

        if (!$this->poolSiteId) {
            throw new Exception("Site not found: {$siteId}");
        }
    }

    /**
     * Fetch solar data from NASA POWER API
     */
    public function fetchFromNasa(float $latitude, float $longitude, string $startYear, string $endYear): array {
        $params = http_build_query([
            'parameters' => 'ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN',
            'community' => 'RE',
            'longitude' => $longitude,
            'latitude' => $latitude,
            'start' => $startYear . '0101',
            'end' => $endYear . '1231',
            'format' => 'JSON'
        ]);

        $url = self::NASA_API_URL . '?' . $params;

        $context = stream_context_create([
            'http' => [
                'timeout' => 60,
                'ignore_errors' => true
            ]
        ]);

        $response = file_get_contents($url, false, $context);

        if ($response === false) {
            throw new Exception('Failed to fetch data from NASA POWER API');
        }

        $data = json_decode($response, true);

        if (!isset($data['properties']['parameter'])) {
            throw new Exception('Invalid response from NASA POWER API');
        }

        return [
            'all_sky' => $data['properties']['parameter']['ALLSKY_SFC_SW_DWN'],
            'clear_sky' => $data['properties']['parameter']['CLRSKY_SFC_SW_DWN']
        ];
    }

    /**
     * Calculate solar elevation angle for a given time and latitude
     *
     * @param float $latitude Latitude in degrees (north = positive)
     * @param DateTime $date Date
     * @param int $hour Hour of day (0-23)
     * @return float Solar elevation in degrees (negative = below horizon)
     */
    public function calculateSolarElevation(float $latitude, DateTime $date, int $hour): float {
        // Day of year (1-365)
        $dayOfYear = (int) $date->format('z') + 1;

        // Solar declination (simplified formula)
        $declination = 23.45 * sin(deg2rad((360 / 365) * ($dayOfYear - 81)));

        // Hour angle (15 degrees per hour from solar noon)
        $hourAngle = 15 * ($hour - 12);

        // Convert to radians
        $latRad = deg2rad($latitude);
        $decRad = deg2rad($declination);
        $haRad = deg2rad($hourAngle);

        // Calculate solar altitude
        $sinAltitude = sin($latRad) * sin($decRad) +
                       cos($latRad) * cos($decRad) * cos($haRad);

        // Clamp and convert to degrees
        $sinAltitude = max(-1, min(1, $sinAltitude));
        return rad2deg(asin($sinAltitude));
    }

    /**
     * Distribute daily solar energy to hourly values based on solar position
     *
     * @param float $dailyKwhM2 Daily total in kWh/m²
     * @param float $latitude Site latitude
     * @param DateTime $date Date
     * @return array 24 hourly values in Wh/m²
     */
    public function distributeDailyToHourly(float $dailyKwhM2, float $latitude, DateTime $date): array {
        $hourlyElevation = [];
        $hourlySinElevation = [];

        // Calculate solar elevation for each hour
        for ($hour = 0; $hour < 24; $hour++) {
            $elevation = $this->calculateSolarElevation($latitude, $date, $hour);
            $hourlyElevation[$hour] = $elevation;
            // Solar radiation proportional to sin(elevation) when sun above horizon
            $hourlySinElevation[$hour] = max(0, sin(deg2rad($elevation)));
        }

        // Convert daily kWh/m² to Wh/m²
        $dailyWhM2 = $dailyKwhM2 * 1000;

        // Sum of weights
        $totalWeight = array_sum($hourlySinElevation);

        $hourlyWhM2 = [];
        if ($totalWeight > 0) {
            // Distribute energy based on sin(elevation)
            for ($hour = 0; $hour < 24; $hour++) {
                $hourlyWhM2[$hour] = ($hourlySinElevation[$hour] / $totalWeight) * $dailyWhM2;
            }
        } else {
            // Polar night - no sun
            $hourlyWhM2 = array_fill(0, 24, 0);
        }

        return $hourlyWhM2;
    }

    /**
     * Fetch and store solar data for a site (both daily and hourly)
     */
    public function fetchAndStore(float $latitude, float $longitude, string $startYear, string $endYear): array {
        // Check if required tables exist
        $tablesCheck = $this->db->query("SHOW TABLES LIKE 'site_solar_daily'");
        if ($tablesCheck->rowCount() === 0) {
            throw new Exception('site_solar_daily table does not exist. Run the solar tables migration first.');
        }
        $tablesCheck = $this->db->query("SHOW TABLES LIKE 'site_solar_hourly'");
        if ($tablesCheck->rowCount() === 0) {
            throw new Exception('site_solar_hourly table does not exist. Run the solar tables migration first.');
        }

        // Fetch from NASA
        $nasaData = $this->fetchFromNasa($latitude, $longitude, $startYear, $endYear);

        // Prepare insert statements for both tables (using pool_site_id)
        $dailyStmt = $this->db->prepare("
            INSERT INTO site_solar_daily
            (pool_site_id, date, daily_kwh_m2, clear_sky_kwh_m2, cloud_factor)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                daily_kwh_m2 = VALUES(daily_kwh_m2),
                clear_sky_kwh_m2 = VALUES(clear_sky_kwh_m2),
                cloud_factor = VALUES(cloud_factor)
        ");

        $hourlyStmt = $this->db->prepare("
            INSERT INTO site_solar_hourly
            (pool_site_id, timestamp, solar_wh_m2, clear_sky_wh_m2)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                solar_wh_m2 = VALUES(solar_wh_m2),
                clear_sky_wh_m2 = VALUES(clear_sky_wh_m2)
        ");

        // Clear existing data for this site in the date range
        $this->db->prepare("
            DELETE FROM site_solar_daily
            WHERE pool_site_id = ? AND date BETWEEN ? AND ?
        ")->execute([
            $this->poolSiteId,
            $startYear . '-01-01',
            $endYear . '-12-31'
        ]);

        $this->db->prepare("
            DELETE FROM site_solar_hourly
            WHERE pool_site_id = ? AND DATE(timestamp) BETWEEN ? AND ?
        ")->execute([
            $this->poolSiteId,
            $startYear . '-01-01',
            $endYear . '-12-31'
        ]);

        $dailyCount = 0;
        $hourlyCount = 0;
        $actualStartDate = null;
        $actualEndDate = null;
        $this->db->beginTransaction();

        try {
            foreach ($nasaData['all_sky'] as $dateStr => $dailyKwhM2) {
                // Skip invalid values
                if ($dailyKwhM2 < 0) continue;

                $date = DateTime::createFromFormat('Ymd', $dateStr);
                if (!$date) continue;

                $dateFormatted = $date->format('Y-m-d');

                // Track actual date range
                if ($actualStartDate === null || $dateFormatted < $actualStartDate) {
                    $actualStartDate = $dateFormatted;
                }
                if ($actualEndDate === null || $dateFormatted > $actualEndDate) {
                    $actualEndDate = $dateFormatted;
                }

                $clearSkyKwh = $nasaData['clear_sky'][$dateStr] ?? 0;
                $cloudFactor = $clearSkyKwh > 0 ? $dailyKwhM2 / $clearSkyKwh : 1;

                // Store daily data (raw from NASA)
                $dailyStmt->execute([
                    $this->poolSiteId,
                    $dateFormatted,
                    round($dailyKwhM2, 4),
                    round($clearSkyKwh, 4),
                    round($cloudFactor, 4)
                ]);
                $dailyCount++;

                // Distribute to hourly using solar position
                $hourlyActual = $this->distributeDailyToHourly($dailyKwhM2, $latitude, $date);
                $hourlyClearSky = $this->distributeDailyToHourly($clearSkyKwh, $latitude, $date);

                // Store hourly data
                for ($hour = 0; $hour < 24; $hour++) {
                    $timestamp = $dateFormatted . ' ' . sprintf('%02d:00:00', $hour);

                    $hourlyStmt->execute([
                        $this->poolSiteId,
                        $timestamp,
                        round($hourlyActual[$hour], 2),
                        round($hourlyClearSky[$hour], 2)
                    ]);
                    $hourlyCount++;
                }
            }

            // Update site's solar data range with ACTUAL dates received
            $this->db->prepare("
                UPDATE pool_sites SET
                    solar_latitude = ?,
                    solar_longitude = ?,
                    solar_data_start = ?,
                    solar_data_end = ?
                WHERE id = ?
            ")->execute([
                $latitude,
                $longitude,
                $actualStartDate ?? $startYear . '-01-01',
                $actualEndDate ?? $endYear . '-12-31',
                $this->poolSiteId
            ]);

            $this->db->commit();

            return [
                'success' => true,
                'daily_records' => $dailyCount,
                'hourly_records' => $hourlyCount,
                'days_processed' => count($nasaData['all_sky']),
                'date_range' => [
                    'start' => $actualStartDate ?? $startYear . '-01-01',
                    'end' => $actualEndDate ?? $endYear . '-12-31'
                ]
            ];

        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Get hourly solar data for a specific timestamp
     */
    public function getHourlySolar(string $timestamp): ?array {
        $stmt = $this->db->prepare("
            SELECT solar_wh_m2, clear_sky_wh_m2
            FROM site_solar_hourly
            WHERE pool_site_id = ? AND timestamp = ?
            LIMIT 1
        ");
        $stmt->execute([$this->poolSiteId, $timestamp]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * Get solar data range for site
     */
    public function getSolarDataRange(): ?array {
        $stmt = $this->db->prepare("
            SELECT MIN(timestamp) as min_date, MAX(timestamp) as max_date, COUNT(*) as hours
            FROM site_solar_hourly
            WHERE pool_site_id = ?
        ");
        $stmt->execute([$this->poolSiteId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    /**
     * Get daily solar data for a specific date (for debugging)
     */
    public function getDailySolar(string $date): ?array {
        $stmt = $this->db->prepare("
            SELECT daily_kwh_m2, clear_sky_kwh_m2, cloud_factor
            FROM site_solar_daily
            WHERE pool_site_id = ? AND date = ?
            LIMIT 1
        ");
        $stmt->execute([$this->poolSiteId, $date]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }
}
