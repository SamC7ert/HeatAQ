<?php
/**
 * HeatAQ's own forecast values for the check workbook (check_workbook.py):
 * runs lib/MetNordicForecast.php exactly as the app does when it fetches,
 * for a station position and some days, without a database. Prints JSON:
 * the station's grid cell (4 grid points, weights, grid height) and the
 * rows the app would store.
 *
 *   php scripts/forecast/check_app_values.php --lat 62.5781 --lon 11.3487 \
 *       --elevation 625 --date 2024-01-04 [--days 2]
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../../lib/MetNordicForecast.php';

$opt = getopt('', ['lat:', 'lon:', 'elevation:', 'date:', 'days::']);
foreach (['lat', 'lon', 'elevation', 'date'] as $k) {
    if (!isset($opt[$k])) {
        fwrite(STDERR, "Usage: php check_app_values.php --lat LAT --lon LON --elevation M --date YYYY-MM-DD [--days N]\n");
        exit(2);
    }
}
$station = ['station_id' => 'CHECK', 'latitude' => (float) $opt['lat'], 'longitude' => (float) $opt['lon'],
            'elevation' => (float) $opt['elevation']];
$days = max(1, (int) ($opt['days'] ?? 2));

try {
    $out = ['cell' => MetNordicForecast::stationCell($station), 'lapse' => MetNordicForecast::LAPSE,
            'rows' => [], 'missing' => []];
    for ($d = 0; $d < $days; $d++) {
        $date = gmdate('Y-m-d', strtotime($opt['date'] . ' UTC') + $d * 86400);
        $res = MetNordicForecast::readDay($station, $date, 36, MetNordicForecast::LAPSE);
        foreach ($res['rows'] as $r) {
            // [station, source, issued, valid, available, air, wind, rh, cloud, solar]
            $out['rows'][] = ['issued' => $r[2], 'valid' => $r[3], 'available' => $r[4],
                              'air' => $r[5], 'wind' => $r[6], 'rh' => $r[7]];
        }
        foreach (array_merge($res['missing'], $res['skipped']) as $hh) {
            $out['missing'][] = sprintf('%s %02d:00:00', $date, $hh);
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
echo json_encode($out, JSON_PRETTY_PRINT), "\n";
