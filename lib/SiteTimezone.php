<?php
/**
 * Time zone of a site, read from its coordinates.
 *
 * Weather and solar data are stored in UTC, but opening hours are local
 * clock times. The simulator converts each UTC weather hour to the site's
 * local time for schedule lookups, daily totals and the hours it reports.
 *
 * PHP has no coordinate -> zone lookup, so this picks the IANA zone whose
 * reference location (DateTimeZone::getLocation) is nearest. Neighbouring
 * zones in the same region share their rules (e.g. all of CET), so a wrong
 * pick near a border does not change the clock time. Without coordinates,
 * UTC is used (the behaviour before time zones were handled).
 */
class SiteTimezone {
    private static $cache = [];

    /** IANA zone name for coordinates, or 'UTC' when they are missing. */
    public static function nameFor($latitude, $longitude) {
        if ($latitude === null || $longitude === null || $latitude === '' || $longitude === '') {
            return 'UTC';
        }
        $lat = (float) $latitude;
        $lon = (float) $longitude;
        $key = round($lat, 3) . ',' . round($lon, 3);
        if (isset(self::$cache[$key])) {
            return self::$cache[$key];
        }

        $best = 'UTC';
        $bestDist = INF;
        foreach (DateTimeZone::listIdentifiers() as $id) {
            $loc = (new DateTimeZone($id))->getLocation();
            if (!$loc || ($loc['country_code'] ?? '??') === '??') {
                continue;
            }
            $d = self::distanceKm($lat, $lon, (float) $loc['latitude'], (float) $loc['longitude']);
            if ($d < $bestDist) {
                $bestDist = $d;
                $best = $id;
            }
        }
        return self::$cache[$key] = $best;
    }

    /** Zone for a pool site (by id), from its coordinates. */
    public static function forSite(PDO $db, $poolSiteId) {
        try {
            $stmt = $db->prepare("SELECT latitude, longitude FROM pool_sites WHERE id = ?");
            $stmt->execute([$poolSiteId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return new DateTimeZone(self::nameFor($row['latitude'] ?? null, $row['longitude'] ?? null));
        } catch (Throwable $e) {
            return new DateTimeZone('UTC');
        }
    }

    private static function distanceKm($lat1, $lon1, $lat2, $lon2) {
        $r = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return 2 * $r * asin(min(1.0, sqrt($a)));
    }
}
