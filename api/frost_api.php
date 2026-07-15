<?php
/**
 * Frost API Proxy - Norwegian Meteorological Institute
 * Proxies requests to frost.met.no to avoid CORS issues
 * and keep API credentials server-side
 */

// Increase limits for large data fetches
set_time_limit(300);  // 5 minutes
ini_set('memory_limit', '512M');

header('Content-Type: application/json');

/**
 * Check if a station exists and get its metadata
 */
function checkStation($clientId) {
    $stationId = $_GET['station_id'] ?? '';
    if (!$stationId) {
        http_response_code(400);
        echo json_encode(['error' => 'station_id required']);
        return;
    }

    // Normalize station ID
    if (is_numeric($stationId)) {
        $stationId = 'SN' . $stationId;
    } elseif (!preg_match('/^SN/i', $stationId)) {
        $stationId = 'SN' . $stationId;
    }
    $stationId = strtoupper($stationId);

    // Query Frost API for station metadata
    $url = 'https://frost.met.no/sources/v0.jsonld?ids=' . urlencode($stationId);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $clientId . ':',
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FOLLOWLOCATION => true
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);
    curl_close($ch);

    // Log for server-side debugging
    error_log("[FrostAPI] checkStation: stationId=$stationId, httpCode=$httpCode, curlErrno=$curlErrno, curlError=$curlError");
    error_log("[FrostAPI] Response (first 500 chars): " . substr($response, 0, 500));

    if ($curlErrno) {
        echo json_encode([
            'found' => false,
            'error' => 'Connection error: ' . $curlError,
            'curl_errno' => $curlErrno,
            'station_id_used' => $stationId,
            'url' => $url
        ]);
        return;
    }

    if ($httpCode !== 200) {
        // Try to get error message from response
        $errorData = json_decode($response, true);
        $apiError = $errorData['error']['message'] ?? $errorData['message'] ?? null;

        echo json_encode([
            'found' => false,
            'error' => $apiError ?: 'Station not found or API error',
            'http_code' => $httpCode,
            'station_id_used' => $stationId,
            'url' => $url,
            'response_preview' => substr($response, 0, 200)
        ]);
        return;
    }

    $data = json_decode($response, true);
    if (!isset($data['data']) || empty($data['data'])) {
        echo json_encode([
            'found' => false,
            'error' => 'Station not found in Frost response',
            'station_id_used' => $stationId,
            'url' => $url
        ]);
        return;
    }

    $station = $data['data'][0];
    $geometry = $station['geometry'] ?? null;

    $result = [
        'found' => true,
        'station_id' => $station['id'] ?? $stationId,
        'name' => $station['name'] ?? 'Unknown',
        'latitude' => $geometry['coordinates'][1] ?? null,
        'longitude' => $geometry['coordinates'][0] ?? null,
        'elevation' => $station['masl'] ?? null,
        'valid_from' => $station['validFrom'] ?? null,
        'valid_to' => $station['validTo'] ?? null,
        'county' => $station['county'] ?? null,
        'municipality' => $station['municipality'] ?? null
    ];

    // Get available time series
    $seriesUrl = 'https://frost.met.no/observations/availableTimeSeries/v0.jsonld?sources=' . urlencode($stationId);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $seriesUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $clientId . ':',
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_TIMEOUT => 15
    ]);

    $seriesResponse = curl_exec($ch);
    $seriesCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($seriesCode === 200) {
        $seriesData = json_decode($seriesResponse, true);
        $availableElements = [];
        $windLevels = [];
        $dateRange = ['from' => null, 'to' => null];

        if (isset($seriesData['data'])) {
            foreach ($seriesData['data'] as $series) {
                $elementId = $series['elementId'] ?? '';
                $level = $series['level']['value'] ?? null;
                $validFrom = $series['validFrom'] ?? null;
                $validTo = $series['validTo'] ?? date('Y-m-d');

                // Track elements
                if (!in_array($elementId, $availableElements)) {
                    $availableElements[] = $elementId;
                }

                // Track wind levels
                if ($elementId === 'wind_speed' && $level) {
                    $windLevels[] = $level;
                }

                // Track date range
                if ($validFrom) {
                    if (!$dateRange['from'] || $validFrom < $dateRange['from']) {
                        $dateRange['from'] = $validFrom;
                    }
                }
                if ($validTo) {
                    if (!$dateRange['to'] || $validTo > $dateRange['to']) {
                        $dateRange['to'] = $validTo;
                    }
                }
            }
        }

        // Check for required elements
        $requiredElements = ['air_temperature', 'wind_speed', 'relative_humidity'];
        $hasElements = [];
        foreach ($requiredElements as $el) {
            $hasElements[$el] = in_array($el, $availableElements);
        }
        $hasElements['solar'] = in_array('surface_downwelling_shortwave_flux_in_air', $availableElements);

        $result['available_elements'] = $hasElements;
        $result['wind_levels'] = array_unique($windLevels);
        $result['data_range'] = $dateRange;
        $result['recommended_wind_height'] = in_array(2, $windLevels) ? 2 : (in_array(10, $windLevels) ? 10 : 10);
    }

    echo json_encode($result);
}

/**
 * Get available time series for a station
 */
function getAvailableSeries($clientId) {
    $stationId = $_GET['station_id'] ?? '';
    if (!$stationId) {
        http_response_code(400);
        echo json_encode(['error' => 'station_id required']);
        return;
    }

    $url = 'https://frost.met.no/observations/availableTimeSeries/v0.jsonld?sources=' . urlencode($stationId);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $clientId . ':',
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_TIMEOUT => 15
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        http_response_code($httpCode);
        echo json_encode(['error' => 'Frost API error', 'http_code' => $httpCode]);
        return;
    }

    echo $response;
}

/**
 * Fetch weather data for a date range
 * This is a longer operation - fetches month by month
 */
function fetchWeatherData($clientId) {
    $stationId = $_GET['station_id'] ?? '';
    $startDate = $_GET['start_date'] ?? '';
    $endDate = $_GET['end_date'] ?? '';
    $windLevel = $_GET['wind_level'] ?? null;

    if (!$stationId || !$startDate || !$endDate) {
        http_response_code(400);
        echo json_encode(['error' => 'station_id, start_date, end_date required']);
        return;
    }

    $elements = [
        'air_temperature',
        'wind_speed',
        'wind_from_direction',
        'relative_humidity',
        'surface_downwelling_shortwave_flux_in_air'
    ];

    $params = [
        'sources' => $stationId,
        'elements' => implode(',', $elements),
        // Frost's referencetime range is END-EXCLUSIVE: start/end fetches up to
        // 23:00 the day BEFORE end. Add one day so endDate itself is included
        // (this was the root cause of every station missing Dec 31 each year).
        'referencetime' => $startDate . '/' . date('Y-m-d', strtotime($endDate) + 86400),
        'timeresolutions' => 'PT1H'
    ];

    if ($windLevel) {
        $params['levels'] = $windLevel;
    }

    $url = 'https://frost.met.no/observations/v0.jsonld?' . http_build_query($params);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $clientId . ':',
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_TIMEOUT => 60  // Longer timeout for data fetch
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        http_response_code($httpCode);
        echo json_encode(['error' => 'Frost API error', 'http_code' => $httpCode]);
        return;
    }

    // Parse and format the data
    $data = json_decode($response, true);
    $records = [];

    if (isset($data['data'])) {
        foreach ($data['data'] as $item) {
            $time = $item['referenceTime'] ?? null;
            if (!$time) continue;

            $record = [
                'time' => $time,
                'temperature' => null,
                'wind_speed' => null,
                'wind_direction' => null,
                'humidity' => null,
                'solar_radiation' => null
            ];

            foreach ($item['observations'] ?? [] as $obs) {
                $elementId = $obs['elementId'] ?? '';
                $value = $obs['value'] ?? null;

                switch ($elementId) {
                    case 'air_temperature':
                        $record['temperature'] = $value;
                        break;
                    case 'wind_speed':
                        $record['wind_speed'] = $value;
                        break;
                    case 'wind_from_direction':
                        $record['wind_direction'] = $value;
                        break;
                    case 'relative_humidity':
                        $record['humidity'] = $value;
                        break;
                    case 'surface_downwelling_shortwave_flux_in_air':
                        $record['solar_radiation'] = $value;
                        break;
                }
            }

            $records[] = $record;
        }
    }

    echo json_encode([
        'station_id' => $stationId,
        'start_date' => $startDate,
        'end_date' => $endDate,
        'record_count' => count($records),
        'data' => $records
    ]);
}

/**
 * Fetch one year of weather data from Frost API and store in database
 */
function fetchAndStoreYear($clientId) {
    $stationId = $_GET['station_id'] ?? '';
    $year = $_GET['year'] ?? '';

    if (!$stationId || !$year) {
        http_response_code(400);
        echo json_encode(['error' => 'station_id and year required']);
        return;
    }

    // Normalize station ID
    if (is_numeric($stationId)) {
        $stationId = 'SN' . $stationId;
    } elseif (!preg_match('/^SN/i', $stationId)) {
        $stationId = 'SN' . $stationId;
    }
    $stationId = strtoupper($stationId);

    $startDate = $year . '-01-01';
    $endDate = $year . '-12-31';

    // Don't fetch future dates
    $today = date('Y-m-d');
    if ($endDate > $today) {
        $endDate = $today;
    }
    if ($startDate > $today) {
        echo json_encode(['success' => true, 'inserted' => 0, 'skipped' => 0, 'message' => 'Year is in the future']);
        return;
    }

    $elements = [
        'air_temperature',
        'wind_speed',
        'wind_from_direction',
        'relative_humidity',
        'surface_downwelling_shortwave_flux_in_air'
    ];

    $params = [
        'sources' => $stationId,
        'elements' => implode(',', $elements),
        // Frost's referencetime range is END-EXCLUSIVE - add one day so the
        // end date itself is included (root cause of the missing-Dec-31 holes).
        'referencetime' => $startDate . '/' . date('Y-m-d', strtotime($endDate) + 86400),
        'timeresolutions' => 'PT1H'
    ];

    $url = 'https://frost.met.no/observations/v0.jsonld?' . http_build_query($params);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERPWD => $clientId . ':',
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_TIMEOUT => 120  // Longer timeout for yearly fetch
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode !== 200) {
        // Propagate a real error status so any consumer checking HTTP status
        // (not just data.error) sees the failure.
        http_response_code(502);
        echo json_encode([
            'error' => 'Frost API error',
            'http_code' => $httpCode,
            'curl_error' => $curlError
        ]);
        return;
    }

    // Parse the data
    $data = json_decode($response, true);
    $records = [];

    if (isset($data['data'])) {
        foreach ($data['data'] as $item) {
            $time = $item['referenceTime'] ?? null;
            if (!$time) continue;

            $record = [
                'timestamp' => $time,
                'temperature' => null,
                'wind_speed' => null,
                'wind_direction' => null,
                'humidity' => null,
                'solar_radiation' => null
            ];

            foreach ($item['observations'] ?? [] as $obs) {
                $elementId = $obs['elementId'] ?? '';
                $value = $obs['value'] ?? null;

                switch ($elementId) {
                    case 'air_temperature':
                        $record['temperature'] = $value;
                        break;
                    case 'wind_speed':
                        $record['wind_speed'] = $value;
                        break;
                    case 'wind_from_direction':
                        $record['wind_direction'] = $value;
                        break;
                    case 'relative_humidity':
                        $record['humidity'] = $value;
                        break;
                    case 'surface_downwelling_shortwave_flux_in_air':
                        $record['solar_radiation'] = $value;
                        break;
                }
            }

            $records[] = $record;
        }
    }

    // Store in database
    try {
        $db = Config::getDatabase();

        // Idempotent upsert. INSERT IGNORE also downgraded truncation/type
        // errors to silently-dropped rows counted as "skipped" - a year where
        // every row failed reported success. ON DUPLICATE KEY UPDATE re-fetches
        // cleanly (existing rows refreshed) and real errors now throw.
        // Note: solar_radiation not stored - weather_data table doesn't have this column
        $stmt = $db->prepare("
            INSERT INTO weather_data
            (station_id, timestamp, temperature, wind_speed, wind_direction, humidity)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                temperature = VALUES(temperature),
                wind_speed = VALUES(wind_speed),
                wind_direction = VALUES(wind_direction),
                humidity = VALUES(humidity)
        ");

        $inserted = 0;   // new rows
        $updated = 0;    // existing rows changed
        $unchanged = 0;  // existing rows identical

        foreach ($records as $record) {
            $stmt->execute([
                $stationId,
                $record['timestamp'],
                $record['temperature'],
                $record['wind_speed'],
                $record['wind_direction'],
                $record['humidity']
            ]);
            // MariaDB rowCount: 1 = inserted, 2 = updated, 0 = identical
            $rc = $stmt->rowCount();
            if ($rc === 1) $inserted++;
            elseif ($rc === 2) $updated++;
            else $unchanged++;
        }

        // Completeness signal: expected hourly rows for the (possibly partial)
        // year vs what Frost actually returned, so short years are visible.
        $spanStart = strtotime($startDate);
        $spanEnd = strtotime($endDate) + 86400; // end date inclusive
        $expectedHours = max(0, (int) round(($spanEnd - $spanStart) / 3600));
        $complete = $expectedHours > 0 ? round(100 * count($records) / $expectedHours, 1) : null;

        echo json_encode([
            'success' => true,
            'year' => $year,
            'station_id' => $stationId,
            'fetched' => count($records),
            'inserted' => $inserted,
            'updated' => $updated,
            'skipped' => $unchanged,
            'expected_hours' => $expectedHours,
            'completeness_pct' => $complete
        ]);

    } catch (PDOException $e) {
        echo json_encode([
            'error' => 'Database error: ' . $e->getMessage(),
            'fetched' => count($records)
        ]);
    }
}

// ========== MAIN EXECUTION ==========

// Catch all errors and return as JSON
set_error_handler(function($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    // Include configuration loader
    require_once __DIR__ . '/../config.php';

    // Get FROST_CLIENT_ID - try Config class first, then fallback to direct file read
    $frostClientId = null;

    // Method 1: Try Config class if it has a get method
    if (method_exists('Config', 'get')) {
        $frostClientId = Config::get('FROST_CLIENT_ID');
    }

    // Method 2: Try Config class getEnvConfig if available
    if (!$frostClientId && method_exists('Config', 'getEnvConfig')) {
        $envConfig = Config::getEnvConfig();
        $frostClientId = $envConfig['FROST_CLIENT_ID'] ?? null;
    }

    // Method 3: Fallback - read database.env directly (same location Config class uses)
    if (!$frostClientId) {
        $configPaths = [
            dirname(__DIR__, 2) . '/config_heataq/database.env',  // /config_heataq/database.env
            '/config_heataq/database.env',                          // Absolute path
            dirname(__DIR__) . '/database.env',                     // HeatAQ/database.env
        ];

        foreach ($configPaths as $configPath) {
            if (file_exists($configPath)) {
                $lines = file($configPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                foreach ($lines as $line) {
                    if (strpos($line, ';') === 0) continue; // Skip comments
                    if (strpos($line, 'FROST_CLIENT_ID') !== false && strpos($line, '=') !== false) {
                        list($key, $value) = explode('=', $line, 2);
                        if (trim($key) === 'FROST_CLIENT_ID') {
                            $frostClientId = trim($value);
                            break 2;
                        }
                    }
                }
            }
        }
    }

    if (!$frostClientId) {
        http_response_code(500);
        echo json_encode(['error' => 'FROST_CLIENT_ID not configured', 'debug' => 'Checked Config class and database.env paths']);
        exit;
    }

    $action = $_GET['action'] ?? '';

    switch ($action) {
        case 'check_station':
            checkStation($frostClientId);
            break;
        case 'get_available_series':
            getAvailableSeries($frostClientId);
            break;
        case 'fetch_data':
            fetchWeatherData($frostClientId);
            break;
        case 'fetch_and_store_year':
            fetchAndStoreYear($frostClientId);
            break;
        default:
            http_response_code(400);
            echo json_encode(['error' => 'Invalid action']);
    }

} catch (Exception $e) {
    // Global error handler
    echo json_encode([
        'error' => 'Server error: ' . $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine()
    ]);
} catch (Error $e) {
    echo json_encode([
        'error' => 'Fatal error: ' . $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine()
    ]);
}
