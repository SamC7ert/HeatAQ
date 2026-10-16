<?php
/**
 * Archived MET Nordic forecasts (MET Norway) for a weather station, fetched
 * by the server one day at a time (Admin -> Weather -> Weather Forecasts).
 *
 * Same method as scripts/forecast/fetch_met_nordic.py (see its README):
 * - each day has runs at 00, 06, 12 and 18 UTC, 59 hourly steps each;
 * - only the 4 grid points around the station are read, over OPeNDAP;
 * - bilinear interpolation, on land points only when the station is near
 *   the sea (inverse distance on the land corners), temperature corrected
 *   for the grid-vs-station height (lapse rate);
 * - available_at = the file's creation time (about 30 min after the run).
 *
 * Rows go to weather_forecasts (migration 042); store() is also used by the
 * CSV import.
 */
class MetNordicForecast {
    const THREDDS = 'https://thredds.met.no/thredds';
    const ARCHIVE = 'metpparchive';
    const SOURCE = 'met_nordic';
    const USER_AGENT = 'HeatAQ-forecast-fetcher/1.0';
    const FIRST_DAY = '2019-11-28';   // first day with all variables
    const LAND_THRESHOLD = 0.5;
    const FILL_LIMIT = 1e20;
    const SHORTWAVE = 'integral_of_surface_downwelling_shortwave_flux_in_air_wrt_time';
    const VARIABLES = ['air_temperature_2m', 'wind_speed_10m', 'relative_humidity_2m',
                       'cloud_area_fraction', self::SHORTWAVE];
    const REQUIRED = ['air_temperature_2m', 'wind_speed_10m', 'relative_humidity_2m'];

    /** Cache of grid, station cells and file layouts (temp file; recomputed when missing). */
    private static $cache = null;

    /**
     * Fetch and store one UTC day of runs for a station.
     * @param array $station station_id, latitude, longitude, elevation
     * @return array ['runs' => fetched, 'rows' => stored, 'missing' => [run hours not in the archive], 'skipped' => [...]]
     */
    public static function fetchDay(PDO $db, array $station, string $date, int $hours = 36, float $lapse = 0.0065,
                                    array $variables = self::REQUIRED) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new InvalidArgumentException('Date must be YYYY-MM-DD');
        }
        $cell = self::stationCell($station);
        $rows = [];
        $result = ['runs' => 0, 'rows' => 0, 'missing' => [], 'skipped' => []];

        // The day's 4 runs: layout (variables, steps; cached per month), then
        // their creation time (DAS) and data, all 8 requests in parallel.
        $runs = [];
        foreach ([0, 6, 12, 18] as $hh) {
            $path = sprintf('%s/met_forecast_1_0km_nordic_%sT%02dZ.nc',
                str_replace('-', '/', $date), str_replace('-', '', $date), $hh);
            $layout = self::layout($path);
            if ($layout === null) { $result['missing'][] = $hh; continue; }
            $have = array_values(array_intersect($variables, $layout['variables']));
            if (array_diff(self::REQUIRED, $have)) { $result['skipped'][] = $hh; continue; }
            $last = min($hours, $layout['steps'] - 1);
            $i = $cell['i'];
            $j = $cell['j'];
            $sl = "[0:{$last}][{$j}:" . ($j + 1) . "][{$i}:" . ($i + 1) . "]";
            $parts = ["time[0:{$last}]"];
            foreach ($have as $v) $parts[] = $v . $sl;
            $runs[$hh] = ['path' => $path, 'last' => $last,
                          'das' => self::dapUrl($path, 'das'),
                          'data' => self::dapUrl($path, 'ascii', implode(',', $parts))];
        }
        $urls = [];
        foreach ($runs as $hh => $r) { $urls["das{$hh}"] = $r['das']; $urls["data{$hh}"] = $r['data']; }
        $bodies = self::httpGetMulti($urls);
        foreach ($runs as $hh => $r) {
            $das = $bodies["das{$hh}"];
            $data = $bodies["data{$hh}"];
            if ($das === null || $data === null) { $result['missing'][] = $hh; continue; }
            $issued = sprintf('%s %02d:00:00', $date, $hh);
            $rows = array_merge($rows, self::runRows($station, $cell, $issued, $das, $data, $r['last'], $lapse));
            $result['runs']++;
        }
        $result['rows'] = $rows ? self::store($db, $rows) : 0;
        self::saveCache();
        return $result;
    }

    /**
     * Insert or replace forecast rows: [station_id, source, issued_at,
     * valid_at, available_at, air, wind, humidity, cloud, solar].
     */
    public static function store(PDO $db, array $rows) {
        $db->beginTransaction();
        try {
            foreach (array_chunk($rows, 500) as $chunk) {
                $sql = "INSERT INTO weather_forecasts
                            (station_id, source, issued_at, valid_at, available_at,
                             air_temperature, wind_speed, humidity, cloud_cover, solar_w_m2)
                        VALUES " . implode(',', array_fill(0, count($chunk), '(?,?,?,?,?,?,?,?,?,?)')) . "
                        ON DUPLICATE KEY UPDATE
                            available_at = VALUES(available_at),
                            air_temperature = VALUES(air_temperature),
                            wind_speed = VALUES(wind_speed),
                            humidity = VALUES(humidity),
                            cloud_cover = VALUES(cloud_cover),
                            solar_w_m2 = VALUES(solar_w_m2)";
                $db->prepare($sql)->execute(array_merge(...$chunk));
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        return count($rows);
    }

    // ------------------------------------------------------------------
    // One run
    // ------------------------------------------------------------------

    /** Rows of one run from its DAS (creation time) and data response. */
    private static function runRows(array $station, array $cell, string $issued, string $das, string $text,
                                    int $last, float $lapse) {
        $d = self::parseAscii($text);

        $issuedTs = strtotime($issued . ' UTC');
        $available = null;
        if (preg_match('/String history "Created (\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z"/', $das, $m)) {
            $available = strtotime("{$m[1]} {$m[2]} UTC");
        }
        if ($available === null || $available < $issuedTs || $available - $issuedTs > 6 * 3600) {
            $available = $issuedTs + 3600;
        }
        $w = $cell['weights'];
        $dz = $cell['grid_altitude'] - (float) $station['elevation'];
        $times = $d['time'] ?? [];
        $rows = [];
        $prevSw = null;
        for ($k = 0; $k <= $last; $k++) {
            // ASCII times have ~7 significant digits: round to the whole hour
            $valid = isset($times[$k]) ? (int) (round($times[$k] / 3600) * 3600) : $issuedTs + $k * 3600;
            $air = self::interp($d['air_temperature_2m'][$k] ?? null, $w);
            $wind = self::interp($d['wind_speed_10m'][$k] ?? null, $w);
            $rh = self::interp($d['relative_humidity_2m'][$k] ?? null, $w);
            $cloud = isset($d['cloud_area_fraction']) ? self::interp($d['cloud_area_fraction'][$k] ?? null, $w) : null;
            $sw = isset($d[self::SHORTWAVE]) ? self::interp($d[self::SHORTWAVE][$k] ?? null, $w) : null;
            $solar = ($sw !== null && $prevSw !== null) ? max(0.0, ($sw - $prevSw) / 3600.0) : null;
            $prevSw = $sw;
            if ($air === null || $wind === null || $rh === null) continue;
            $rows[] = [
                $station['station_id'], self::SOURCE, gmdate('Y-m-d H:i:s', $issuedTs), gmdate('Y-m-d H:i:s', $valid),
                gmdate('Y-m-d H:i:s', $available),
                round($air - 273.15 + $lapse * $dz, 2),
                round(max(0.0, $wind), 2),
                round(min(100.0, max(0.0, $rh * 100)), 1),
                $cloud === null ? null : (int) round(min(100.0, max(0.0, $cloud * 100))),
                $solar === null ? null : round($solar, 1),
            ];
        }
        return $rows;
    }

    /** Weighted value of the 4 corners [[a,b],[c,d]]; null when a used corner is missing. */
    private static function interp($values, array $weights) {
        if (!is_array($values) || count($values) < 2) return null;
        $flat = [$values[0][0] ?? null, $values[0][1] ?? null, $values[1][0] ?? null, $values[1][1] ?? null];
        $tot = 0.0;
        foreach ($flat as $k => $v) {
            if ($weights[$k] == 0) continue;
            if ($v === null || is_nan($v) || abs($v) > self::FILL_LIMIT) return null;
            $tot += $v * $weights[$k];
        }
        return $tot;
    }

    /** Variables and number of steps of a run file (read once per month and run hour). */
    private static function layout(string $path) {
        $key = substr($path, 0, 7) . substr($path, -7);
        self::loadCache();
        if (isset(self::$cache['layouts'][$key])) return self::$cache['layouts'][$key];
        $dds = self::httpGet(self::dapUrl($path, 'dds'));
        if ($dds === null) return null;
        preg_match_all('/Float32 (\w+)\[time = \d+\]/', $dds, $m);
        $steps = preg_match('/time\[time = (\d+)\]/', $dds, $t) ? (int) $t[1] : 0;
        $layout = ['variables' => array_values(array_unique($m[1])), 'steps' => $steps];
        // Only cache complete layouts: an early or odd file is read again
        if (!array_diff(self::REQUIRED, $layout['variables'])) {
            self::$cache['layouts'][$key] = $layout;
        }
        return $layout;
    }

    // ------------------------------------------------------------------
    // Grid and station cell
    // ------------------------------------------------------------------

    /** The 4 grid points around the station and their weights (cached). */
    public static function stationCell(array $station) {
        foreach (['station_id', 'latitude', 'longitude'] as $f) {
            if (!isset($station[$f]) || $station[$f] === '' || $station[$f] === null) {
                throw new InvalidArgumentException("Station needs {$f}");
            }
        }
        $lat = (float) $station['latitude'];
        $lon = (float) $station['longitude'];
        $key = $station['station_id'] . '|' . round($lat, 5) . '|' . round($lon, 5);
        self::loadCache();
        if (isset(self::$cache['cells'][$key])) return self::$cache['cells'][$key];

        $g = self::grid();
        [$x, $y] = self::project($g, $lat, $lon);
        $fi = ($x - $g['x0']) / $g['dx'];
        $fj = ($y - $g['y0']) / $g['dy'];
        $i = (int) floor($fi);
        $j = (int) floor($fj);
        if ($i < 0 || $j < 0 || $i >= $g['nx'] - 1 || $j >= $g['ny'] - 1) {
            throw new RuntimeException("Station {$station['station_id']} is outside the MET Nordic grid (Nordic countries only)");
        }
        $u = $fi - $i;
        $v = $fj - $j;
        $sl = "[{$j}:" . ($j + 1) . "][{$i}:" . ($i + 1) . "]";
        $text = self::httpGet(self::dapUrl($g['sample'], 'ascii',
            "latitude{$sl},longitude{$sl},altitude{$sl},land_area_fraction{$sl}"));
        if ($text === null) throw new RuntimeException('MET Nordic sample file not found');
        $d = self::parseAscii($text);
        $bil = [(1 - $u) * (1 - $v), $u * (1 - $v), (1 - $u) * $v, $u * $v];
        $pos = [[0, 0], [0, 1], [1, 0], [1, 1]];
        $corners = [];
        foreach ($pos as $k => [$dj, $di]) {
            $corners[] = [
                'lat' => $d['latitude'][$dj][$di], 'lon' => $d['longitude'][$dj][$di],
                'alt' => $d['altitude'][$dj][$di], 'land' => $d['land_area_fraction'][$dj][$di],
                'bilinear' => $bil[$k], 'dist' => hypot($di - $u, $dj - $v),
            ];
        }
        // Check the projection against the file's own coordinates
        $latI = 0.0; $lonI = 0.0;
        foreach ($corners as $c) { $latI += $c['lat'] * $c['bilinear']; $lonI += $c['lon'] * $c['bilinear']; }
        $errKm = self::kmBetween($latI, $lonI, $lat, $lon);
        if ($errKm > 0.5) {
            throw new RuntimeException(sprintf('Grid position of %s is off by %.2f km', $station['station_id'], $errKm));
        }
        $land = array_map(fn($c) => $c['land'] >= self::LAND_THRESHOLD, $corners);
        $nLand = count(array_filter($land));
        if ($nLand === 4 || $nLand === 0) {
            $weights = $bil;
            $method = $nLand === 4 ? 'bilinear' : 'bilinear (all corners sea)';
        } else {
            $weights = [];
            foreach ($corners as $k => $c) $weights[] = $land[$k] ? 1.0 / max($c['dist'], 1e-6) : 0.0;
            $method = "inverse distance on {$nLand} land corners";
        }
        $sum = array_sum($weights);
        $weights = array_map(fn($w) => $w / $sum, $weights);
        $alt = 0.0;
        foreach ($corners as $k => $c) $alt += $c['alt'] * $weights[$k];
        $cell = ['i' => $i, 'j' => $j, 'weights' => $weights, 'method' => $method,
                 'grid_altitude' => round($alt, 1)];
        self::$cache['cells'][$key] = $cell;
        self::saveCache();
        return $cell;
    }

    /** Projection (spherical Lambert conformal conic) and grid origin, from a recent file. */
    private static function grid() {
        self::loadCache();
        if (isset(self::$cache['grid'])) return self::$cache['grid'];
        // A file from a few days ago (today's may not be archived yet)
        $sample = null;
        for ($back = 2; $back <= 10 && $sample === null; $back++) {
            $date = gmdate('Y-m-d', time() - $back * 86400);
            $p = sprintf('%s/met_forecast_1_0km_nordic_%sT00Z.nc', str_replace('-', '/', $date), str_replace('-', '', $date));
            if (self::httpGet(self::dapUrl($p, 'dds')) !== null) $sample = $p;
        }
        if ($sample === null) throw new RuntimeException('Could not reach the MET Nordic archive (thredds.met.no)');
        $das = self::httpGet(self::dapUrl($sample, 'das')) ?? '';
        $dds = self::httpGet(self::dapUrl($sample, 'dds')) ?? '';
        $xy = self::parseAscii(self::httpGet(self::dapUrl($sample, 'ascii', 'x[0:1],y[0:1]')) ?? '');
        $attr = function ($name, $default) use ($das) {
            if (!preg_match('/projection_lcc \{(.*?)\}/s', $das, $b)) return $default;
            return preg_match('/Float64 ' . $name . ' ([-\d.eE+]+)/', $b[1], $m) ? (float) $m[1] : $default;
        };
        $lat1 = deg2rad($attr('standard_parallel', 63.0));
        $lat0 = deg2rad($attr('latitude_of_projection_origin', 63.0));
        $n = sin($lat1);
        $R = $attr('earth_radius', 6371000.0);
        $F = cos($lat1) * pow(tan(M_PI / 4 + $lat1 / 2), $n) / $n;
        $g = [
            'R' => $R, 'n' => $n, 'F' => $F,
            'rho0' => $R * $F / pow(tan(M_PI / 4 + $lat0 / 2), $n),
            'lon0' => deg2rad($attr('longitude_of_central_meridian', 15.0)),
            'x0' => $xy['x'][0], 'dx' => $xy['x'][1] - $xy['x'][0],
            'y0' => $xy['y'][0], 'dy' => $xy['y'][1] - $xy['y'][0],
            'nx' => preg_match('/x\[x = (\d+)\]/', $dds, $mx) ? (int) $mx[1] : 0,
            'ny' => preg_match('/y\[y = (\d+)\]/', $dds, $my) ? (int) $my[1] : 0,
            'sample' => $sample,
        ];
        self::$cache['grid'] = $g;
        return $g;
    }

    private static function project(array $g, $lat, $lon) {
        $rho = $g['R'] * $g['F'] / pow(tan(M_PI / 4 + deg2rad($lat) / 2), $g['n']);
        $theta = $g['n'] * (deg2rad($lon) - $g['lon0']);
        return [$rho * sin($theta), $g['rho0'] - $rho * cos($theta)];
    }

    private static function kmBetween($lat1, $lon1, $lat2, $lon2) {
        $p1 = deg2rad($lat1); $p2 = deg2rad($lat2);
        $dp = $p2 - $p1; $dl = deg2rad($lon2 - $lon1);
        $a = sin($dp / 2) ** 2 + cos($p1) * cos($p2) * sin($dl / 2) ** 2;
        return 6371.0 * 2 * asin(sqrt($a));
    }

    // ------------------------------------------------------------------
    // OPeNDAP
    // ------------------------------------------------------------------

    private static function dapUrl(string $path, string $suffix, ?string $constraint = null) {
        $url = self::THREDDS . '/dodsC/' . self::ARCHIVE . '/' . $path . '.' . $suffix;
        if ($constraint !== null) {
            // THREDDS (Tomcat) rejects unencoded [ ] in the query
            $url .= '?' . str_replace(['[', ']'], ['%5B', '%5D'], $constraint);
        }
        return $url;
    }

    /** GET with retries; null for 404. */
    private static function httpGet(string $url) {
        $delay = 1;
        $err = '';
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_USERAGENT => self::USER_AGENT,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            $body = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);
            if ($body !== false && $code === 200) return $body;
            if ($code === 404) return null;
            if ($code >= 400 && $code < 500 && $code !== 429) {
                throw new RuntimeException("MET archive answered HTTP {$code}");
            }
            if ($attempt < 3) { sleep($delay); $delay *= 2; }
            $err = $err ?: "HTTP {$code}";
        }
        throw new RuntimeException("MET archive not reachable ({$err})");
    }

    /**
     * Several GETs in parallel: [key => body | null (404)]. A request that
     * fails is tried again on its own (httpGet: retries, then an exception).
     */
    private static function httpGetMulti(array $urls) {
        $mh = curl_multi_init();
        $handles = [];
        foreach ($urls as $key => $url) {
            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 60,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_USERAGENT => self::USER_AGENT,
                CURLOPT_FOLLOWLOCATION => true,
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$key] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) curl_multi_select($mh, 1.0);
        } while ($running && $status === CURLM_OK);
        $out = [];
        foreach ($handles as $key => $ch) {
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $body = curl_multi_getcontent($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            if ($code === 200 && $body !== false && $body !== null) {
                $out[$key] = $body;
            } elseif ($code === 404) {
                $out[$key] = null;
            } else {
                $out[$key] = self::httpGet($urls[$key]);
            }
        }
        curl_multi_close($mh);
        return $out;
    }

    /**
     * Parse a DAP2 .ascii response: 1-D arrays and scalars -> list of floats,
     * grid arrays -> nested lists ([t][y][x] or [y][x]).
     */
    public static function parseAscii(string $text) {
        $parts = explode(str_repeat('-', 45), $text, 2);
        $lines = preg_split('/\r?\n/', end($parts));
        $out = [];
        $n = count($lines);
        $i = 0;
        while ($i < $n) {
            $line = trim($lines[$i++]);
            if ($line === '') continue;
            if (strpos($line, '[') === false && preg_match('/^([A-Za-z_][\w.]*), (\S+)$/', $line, $m)) {
                $names = explode('.', $m[1]);
                $out[end($names)] = [(float) $m[2]];
                continue;
            }
            if (!preg_match('/^([A-Za-z_][\w.]*)((?:\[\d+\])+)$/', $line, $m)) continue;
            preg_match_all('/\[(\d+)\]/', $m[2], $dm);
            $dims = array_map('intval', $dm[1]);
            $names = explode('.', $m[1]);
            if (count($names) === 2 && $names[0] !== $names[1]) {
                // a grid's map vector (grid.time, grid.x): skip its values
                if (count($dims) === 1) $i++;
                continue;
            }
            $name = end($names);
            if (count($dims) === 1) {
                $out[$name] = array_map('floatval', explode(',', $lines[$i++] ?? ''));
                continue;
            }
            $rowsN = (int) array_product(array_slice($dims, 0, -1));
            $flat = [];
            for ($r = 0; $r < $rowsN; $r++) {
                $vals = explode(',', $lines[$i++] ?? '');
                array_shift($vals);
                $flat[] = array_map('floatval', $vals);
            }
            $out[$name] = count($dims) > 2 ? array_chunk($flat, $dims[1]) : $flat;
        }
        return $out;
    }

    // ------------------------------------------------------------------
    // Cache (temp file)
    // ------------------------------------------------------------------

    private static function cacheFile() {
        return sys_get_temp_dir() . '/heataq_met_nordic_cache.json';
    }

    private static function loadCache() {
        if (self::$cache !== null) return;
        $raw = @file_get_contents(self::cacheFile());
        $c = $raw ? json_decode($raw, true) : null;
        self::$cache = is_array($c) ? $c : [];
    }

    private static function saveCache() {
        if (self::$cache === null) return;
        @file_put_contents(self::cacheFile(), json_encode(self::$cache), LOCK_EX);
    }
}
