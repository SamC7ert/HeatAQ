<?php
/**
 * WeatherGapFiller - detect and interpolate gaps in hourly weather data.
 *
 * "Incomplete" covers BOTH kinds of holes the strict simulator validation
 * stops on:
 *   - missing rows (no timestamp at all, e.g. the historical Dec-31 holes)
 *   - present rows with NULL required fields (e.g. a few hours of missing
 *     humidity from a sensor outage at the source)
 *
 * Filling is EXPLICIT, never silent: every value written by this class is
 * flagged is_interpolated = 1 (migration 030) so measured and reconstructed
 * data stay distinguishable forever, and measured values are never
 * overwritten (COALESCE on update).
 *
 * Interpolation method (per field, per contiguous run of missing hours):
 *   1. Diurnal climatology: for each hour-of-day, average the same-hour
 *      values from up to CONTEXT_DAYS days before and after the run.
 *      This captures the expected day/night gradient.
 *   2. Edge blending: offset the climatology so the filled curve joins the
 *      last measured value before the run and the first after it, with the
 *      two edge offsets blended linearly across the run. This removes the
 *      step a raw climatology would create at the gap edges.
 *   3. Fallback: if the climatology has no data for some hour-of-day,
 *      fall back to straight linear interpolation between the edges.
 * ALL epoch arithmetic is done in UTC: stored timestamps are naive
 * continuous hours, and local-DST parsing makes wall times ambiguous or
 * nonexistent at changeovers, which manufactured phantom gaps (e.g. a
 * complete Oct 30 reported as missing 01:00).
 *
 * Runs longer than MAX_FILL_HOURS are refused - inventing more than a week
 * of weather is a re-fetch problem, not an interpolation problem.
 */
class WeatherGapFiller {

    const MAX_FILL_HOURS = 168;   // refuse to invent more than 7 days
    const CONTEXT_DAYS = 3;       // days on each side used for the diurnal profile
    const FIELDS = ['temperature', 'wind_speed', 'humidity'];

    private $db;

    public function __construct(PDO $db) {
        $this->db = $db;
    }

    /**
     * Station data range [min, max] as unix hours, or null when no data.
     */
    private function stationRange($stationId) {
        $stmt = $this->db->prepare(
            "SELECT MIN(timestamp) mn, MAX(timestamp) mx FROM weather_data WHERE station_id = ?"
        );
        $stmt->execute([$stationId]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$r || $r['mn'] === null) return null;
        return [strtotime($r['mn'] . ' UTC'), strtotime($r['mx'] . ' UTC')];
    }

    /**
     * List incomplete hours for one station-year, clamped to the station's own
     * data range (an un-fetched tail is "not fetched", not a gap).
     *
     * @return array {
     *   expected_hours, present_hours, missing_rows, null_field_hours,
     *   runs: [{start, end, hours, kind: 'missing_rows'|'null_fields', fields: [...]}]
     * }
     */
    public function findIncomplete($stationId, $year) {
        $range = $this->stationRange($stationId);
        if (!$range) {
            return ['expected_hours' => 0, 'present_hours' => 0, 'missing_rows' => 0,
                    'null_field_hours' => 0, 'runs' => []];
        }
        $from = max(strtotime("$year-01-01 00:00:00 UTC"), $range[0]);
        $to = min(strtotime("$year-12-31 23:00:00 UTC"), $range[1]);
        if ($to < $from) {
            return ['expected_hours' => 0, 'present_hours' => 0, 'missing_rows' => 0,
                    'null_field_hours' => 0, 'runs' => []];
        }

        $stmt = $this->db->prepare("
            SELECT timestamp, temperature, wind_speed, humidity
            FROM weather_data
            WHERE station_id = ? AND timestamp BETWEEN ? AND ?
            ORDER BY timestamp
        ");
        $stmt->execute([$stationId, gmdate('Y-m-d H:i:s', $from), gmdate('Y-m-d H:i:s', $to)]);
        $byTs = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $byTs[strtotime($row['timestamp'] . ' UTC')] = $row;
        }

        $expected = (int) (($to - $from) / 3600) + 1;
        $present = count($byTs);
        $missingRows = 0;
        $nullFieldHours = 0;

        // Walk the expected hour sequence and group problems into runs.
        $runs = [];
        $current = null; // ['start'=>ts, 'end'=>ts, 'kind'=>..., 'fields'=>set]
        for ($t = $from; $t <= $to; $t += 3600) {
            $problemFields = [];
            $kind = null;
            if (!isset($byTs[$t])) {
                $kind = 'missing_rows';
                $problemFields = self::FIELDS;
                $missingRows++;
            } else {
                foreach (self::FIELDS as $f) {
                    if ($byTs[$t][$f] === null) $problemFields[] = $f;
                }
                if ($problemFields) {
                    $kind = 'null_fields';
                    $nullFieldHours++;
                }
            }

            if ($kind === null) {
                if ($current) { $runs[] = $current; $current = null; }
                continue;
            }
            if ($current && $current['kind'] === $kind && $current['end'] + 3600 === $t) {
                $current['end'] = $t;
                $current['fields'] = array_values(array_unique(array_merge($current['fields'], $problemFields)));
            } else {
                if ($current) $runs[] = $current;
                $current = ['start' => $t, 'end' => $t, 'kind' => $kind, 'fields' => $problemFields];
            }
        }
        if ($current) $runs[] = $current;

        return [
            'expected_hours' => $expected,
            'present_hours' => $present,
            'missing_rows' => $missingRows,
            'null_field_hours' => $nullFieldHours,
            'runs' => array_map(function ($r) {
                return [
                    'start' => gmdate('Y-m-d H:i', $r['start']),
                    'end' => gmdate('Y-m-d H:i', $r['end']),
                    'hours' => (int) (($r['end'] - $r['start']) / 3600) + 1,
                    'kind' => $r['kind'],
                    'fields' => $r['fields'],
                ];
            }, $runs),
        ];
    }

    /**
     * Fill all fillable incomplete hours for one station-year.
     * Never overwrites a measured value; every write sets is_interpolated = 1.
     *
     * @return array {filled_hours, patched_hours, skipped_runs: [...]}
     */
    public function fillYear($stationId, $year) {
        $info = $this->findIncomplete($stationId, $year);
        if (!$info['runs']) {
            return ['filled_hours' => 0, 'patched_hours' => 0, 'skipped_runs' => []];
        }

        $upsert = $this->db->prepare("
            INSERT INTO weather_data
                (station_id, timestamp, temperature, wind_speed, wind_direction, humidity, is_interpolated)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
                temperature = COALESCE(weather_data.temperature, VALUES(temperature)),
                wind_speed = COALESCE(weather_data.wind_speed, VALUES(wind_speed)),
                wind_direction = COALESCE(weather_data.wind_direction, VALUES(wind_direction)),
                humidity = COALESCE(weather_data.humidity, VALUES(humidity)),
                is_interpolated = 1
        ");

        $filled = 0;
        $patched = 0;
        $skipped = [];

        foreach ($info['runs'] as $run) {
            if ($run['hours'] > self::MAX_FILL_HOURS) {
                $skipped[] = $run + ['reason' => 'run longer than ' . self::MAX_FILL_HOURS
                    . ' h - re-fetch from Frost instead of interpolating'];
                continue;
            }
            $startTs = strtotime($run['start'] . ':00 UTC');
            $endTs = strtotime($run['end'] . ':00 UTC');

            // Context window for the diurnal profile
            $ctxFrom = gmdate('Y-m-d H:i:s', $startTs - self::CONTEXT_DAYS * 86400);
            $ctxTo = gmdate('Y-m-d H:i:s', $endTs + self::CONTEXT_DAYS * 86400);
            $stmt = $this->db->prepare("
                SELECT timestamp, temperature, wind_speed, wind_direction, humidity
                FROM weather_data
                WHERE station_id = ? AND timestamp BETWEEN ? AND ?
                ORDER BY timestamp
            ");
            $stmt->execute([$stationId, $ctxFrom, $ctxTo]);
            $ctx = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $ctx[strtotime($row['timestamp'] . ' UTC')] = $row;
            }

            for ($t = $startTs; $t <= $endTs; $t += 3600) {
                $values = [];
                foreach (self::FIELDS as $f) {
                    // Only compute what is actually missing at this hour
                    if (isset($ctx[$t]) && $ctx[$t][$f] !== null) {
                        $values[$f] = null; // present - COALESCE keeps the measured value
                        continue;
                    }
                    $values[$f] = $this->estimate($ctx, $f, $t, $startTs, $endTs);
                }
                // Clamps to physical ranges
                if ($values['humidity'] !== null) $values['humidity'] = max(0, min(100, $values['humidity']));
                if ($values['wind_speed'] !== null) $values['wind_speed'] = max(0, $values['wind_speed']);

                $dir = (isset($ctx[$t]) && $ctx[$t]['wind_direction'] !== null)
                    ? null : $this->circularMeanDirection($ctx, $t);

                $upsert->execute([
                    $stationId,
                    gmdate('Y-m-d H:i:s', $t),
                    $values['temperature'],
                    $values['wind_speed'],
                    $dir,
                    $values['humidity'],
                ]);
                if ($run['kind'] === 'missing_rows') $filled++; else $patched++;
            }
        }

        return ['filled_hours' => $filled, 'patched_hours' => $patched, 'skipped_runs' => $skipped];
    }

    /**
     * Estimate one field at one hour: diurnal climatology + linear edge blend.
     */
    private function estimate(array $ctx, $field, $t, $runStart, $runEnd) {
        $hourOfDay = (int) gmdate('G', $t);

        // 1) Diurnal climatology from same-hour context values
        $sum = 0.0; $n = 0;
        foreach ($ctx as $ts => $row) {
            if ($row[$field] === null) continue;
            if ($ts >= $runStart && $ts <= $runEnd) continue; // inside the run
            if ((int) gmdate('G', $ts) === $hourOfDay) {
                $sum += (float) $row[$field];
                $n++;
            }
        }
        $clim = $n > 0 ? $sum / $n : null;

        // 2) Edge values (last measured before / first measured after the run)
        $prev = null; $prevTs = null;
        for ($ts = $runStart - 3600; $ts >= $runStart - self::CONTEXT_DAYS * 86400; $ts -= 3600) {
            if (isset($ctx[$ts]) && $ctx[$ts][$field] !== null) { $prev = (float) $ctx[$ts][$field]; $prevTs = $ts; break; }
        }
        $next = null; $nextTs = null;
        for ($ts = $runEnd + 3600; $ts <= $runEnd + self::CONTEXT_DAYS * 86400; $ts += 3600) {
            if (isset($ctx[$ts]) && $ctx[$ts][$field] !== null) { $next = (float) $ctx[$ts][$field]; $nextTs = $ts; break; }
        }

        if ($clim === null) {
            // No same-hour context: straight linear interpolation between edges
            if ($prev !== null && $next !== null) {
                $w = ($t - $prevTs) / max(1, $nextTs - $prevTs);
                return round($prev + $w * ($next - $prev), 2);
            }
            return $prev !== null ? round($prev, 2) : ($next !== null ? round($next, 2) : null);
        }

        // 3) Blend edge offsets across the run so the fill joins continuously
        $offPrev = 0.0; $offNext = 0.0;
        if ($prev !== null) {
            $climPrev = $this->climAt($ctx, $field, $prevTs, $runStart, $runEnd);
            $offPrev = $climPrev !== null ? $prev - $climPrev : 0.0;
        }
        if ($next !== null) {
            $climNext = $this->climAt($ctx, $field, $nextTs, $runStart, $runEnd);
            $offNext = $climNext !== null ? $next - $climNext : 0.0;
        }
        if ($prev === null) $offPrev = $offNext;
        if ($next === null) $offNext = $offPrev;

        $w = ($runEnd > $runStart) ? ($t - $runStart) / ($runEnd - $runStart) : 0.5;
        return round($clim + (1 - $w) * $offPrev + $w * $offNext, 2);
    }

    /** Climatology value for the hour-of-day of $t (helper for edge offsets). */
    private function climAt(array $ctx, $field, $t, $runStart, $runEnd) {
        $hourOfDay = (int) gmdate('G', $t);
        $sum = 0.0; $n = 0;
        foreach ($ctx as $ts => $row) {
            if ($row[$field] === null) continue;
            if ($ts >= $runStart && $ts <= $runEnd) continue;
            if ((int) gmdate('G', $ts) === $hourOfDay) { $sum += (float) $row[$field]; $n++; }
        }
        return $n > 0 ? $sum / $n : null;
    }

    /** Circular mean of same-hour wind directions from the context (degrees), or null. */
    private function circularMeanDirection(array $ctx, $t) {
        $hourOfDay = (int) gmdate('G', $t);
        $sinSum = 0.0; $cosSum = 0.0; $n = 0;
        foreach ($ctx as $ts => $row) {
            if ($row['wind_direction'] === null) continue;
            if ((int) gmdate('G', $ts) !== $hourOfDay) continue;
            $rad = deg2rad((float) $row['wind_direction']);
            $sinSum += sin($rad); $cosSum += cos($rad); $n++;
        }
        if ($n === 0) return null;
        $deg = rad2deg(atan2($sinSum / $n, $cosSum / $n));
        return round(fmod($deg + 360, 360), 0);
    }
}
