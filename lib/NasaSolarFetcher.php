<?php
/**
 * NASA POWER Solar Data Fetcher
 *
 * Fetches daily solar radiation data from NASA POWER API and distributes
 * to hourly values using solar position calculation (matching Python script).
 */

class NasaSolarFetcher {
    private $db;
    private $siteId;

    // NASA POWER API endpoint
    const NASA_API_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';

    public function __construct(PDO $db, string $siteId) {
        $this->db = $db;
        $this->siteId = $siteId;
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
     * Fetch and store solar data for a site
     */
    public function fetchAndStore(float $latitude, float $longitude, string $startYear, string $endYear): array {
        // Fetch from NASA
        $nasaData = $this->fetchFromNasa($latitude, $longitude, $startYear, $endYear);

        // Prepare insert statement
        $stmt = $this->db->prepare("
            INSERT INTO solar_hourly_data
            (site_id, timestamp, solar_radiation_wh_m2, solar_clear_sky_wh_m2, cloud_factor)
            VALUES (?, ?, ?, ?, ?)
        ");

        // Clear existing data for this site in the date range
        $this->db->prepare("
            DELETE FROM solar_hourly_data
            WHERE site_id = ?
            AND DATE(timestamp) BETWEEN ? AND ?
        ")->execute([
            $this->siteId,
            $startYear . '-01-01',
            $endYear . '-12-31'
        ]);

        $insertCount = 0;
        $this->db->beginTransaction();

        try {
            foreach ($nasaData['all_sky'] as $dateStr => $dailyKwhM2) {
                // Skip invalid values
                if ($dailyKwhM2 < 0) continue;

                $date = DateTime::createFromFormat('Ymd', $dateStr);
                if (!$date) continue;

                $clearSkyKwh = $nasaData['clear_sky'][$dateStr] ?? 0;
                $cloudFactor = $clearSkyKwh > 0 ? $dailyKwhM2 / $clearSkyKwh : 1;

                // Distribute to hourly
                $hourlyActual = $this->distributeDailyToHourly($dailyKwhM2, $latitude, $date);
                $hourlyClearSky = $this->distributeDailyToHourly($clearSkyKwh, $latitude, $date);

                // Insert each hour
                for ($hour = 0; $hour < 24; $hour++) {
                    $timestamp = $date->format('Y-m-d') . ' ' . sprintf('%02d:00:00', $hour);

                    $stmt->execute([
                        $this->siteId,
                        $timestamp,
                        round($hourlyActual[$hour], 2),
                        round($hourlyClearSky[$hour], 2),
                        round($cloudFactor, 4)
                    ]);
                    $insertCount++;
                }
            }

            // Update site's solar data range
            $this->db->prepare("
                UPDATE pool_sites SET
                    solar_latitude = ?,
                    solar_longitude = ?,
                    solar_data_start = ?,
                    solar_data_end = ?
                WHERE site_id = ?
            ")->execute([
                $latitude,
                $longitude,
                $startYear . '-01-01',
                $endYear . '-12-31',
                $this->siteId
            ]);

            $this->db->commit();

            return [
                'success' => true,
                'records_inserted' => $insertCount,
                'days_processed' => count($nasaData['all_sky']),
                'date_range' => [
                    'start' => $startYear . '-01-01',
                    'end' => $endYear . '-12-31'
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
            SELECT solar_radiation_wh_m2, solar_clear_sky_wh_m2, cloud_factor
            FROM solar_hourly_data
            WHERE site_id = ? AND timestamp = ?
            LIMIT 1
        ");
        $stmt->execute([$this->siteId, $timestamp]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * Get solar data range for site
     */
    public function getSolarDataRange(): ?array {
        $stmt = $this->db->prepare("
            SELECT MIN(timestamp) as min_date, MAX(timestamp) as max_date, COUNT(*) as hours
            FROM solar_hourly_data
            WHERE site_id = ?
        ");
        $stmt->execute([$this->siteId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }
}
