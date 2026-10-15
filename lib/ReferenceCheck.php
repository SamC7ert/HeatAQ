<?php
/**
 * Engine reference set (tests/reference, see its README.md).
 *
 * A fixed set of scenarios with FROZEN inputs (weather, solar, configuration,
 * schedule as exportRunInputs() wrote them), and the results each simulator
 * version gives for them (results/<version>.json.gz). Because the inputs
 * never change, a difference between two versions' results comes from the
 * engine only, and re-running a version must reproduce its results.
 *
 * Results are kept in a compact form ("reference result"):
 *   summary: every summary value
 *   days:    the daily results as stored (simulation_daily_results rounding)
 *   hours:   per hour water temperature, heat pump and boiler heat (2
 *            decimals) and the heating mode (one letter, MODE_CODES)
 *
 * The TypeScript engine builds the same form (sim-ts/src/reference.ts) and
 * compares with the same rules, so both engines are checked against one set.
 */
class ReferenceCheck {
    const MODE_CODES = [
        'preheat_coast' => 'c', 'preheat_ramp' => 'r', 'open_preheat' => 'p', 'open_hold' => 'h',
        'standby' => 's', 'reactive' => 'x', 'closed_hold' => 'k',
    ];
    /** Values are rounded to 2-3 decimals: a flip in the last digit is "within rounding". */
    const TOLERANCE = 0.011;

    public static function dir() {
        return dirname(__DIR__) . '/tests/reference';
    }

    /** The scenarios: [{id, title, description}] */
    public static function scenarios() {
        $list = json_decode((string) @file_get_contents(self::dir() . '/scenarios.json'), true);
        if (!is_array($list)) {
            throw new RuntimeException('tests/reference/scenarios.json is missing or invalid');
        }
        return $list;
    }

    public static function scenario($id) {
        foreach (self::scenarios() as $s) {
            if ($s['id'] === $id) return $s;
        }
        throw new InvalidArgumentException("Unknown reference scenario '$id'");
    }

    /** A scenario's frozen inputs (exportRunInputs() format). */
    public static function inputs($id) {
        self::scenario($id);   // validates the id (it names a file)
        $raw = @file_get_contents(self::dir() . "/inputs/$id.json.gz");
        if ($raw === false) {
            throw new RuntimeException("Reference inputs for '$id' are missing");
        }
        return json_decode(gzdecode($raw), true);
    }

    /** Versions with stored results, oldest first. */
    public static function versions() {
        $out = [];
        foreach (glob(self::dir() . '/results/*.json.gz') ?: [] as $f) {
            $out[] = basename($f, '.json.gz');
        }
        usort($out, 'version_compare');
        return $out;
    }

    /** Stored results of a version: [scenario id => reference result], or null. */
    public static function results($version) {
        if (!preg_match('/^\d+\.\d+\.\d+$/', (string) $version)) return null;
        $raw = @file_get_contents(self::dir() . "/results/$version.json.gz");
        if ($raw === false) return null;
        $data = json_decode(gzdecode($raw), true);
        return $data['scenarios'] ?? null;
    }

    /** The version to check against: this engine's own, else the newest older one. */
    public static function baselineVersion($engineVersion) {
        $best = null;
        foreach (self::versions() as $v) {
            if (version_compare($v, $engineVersion, '<=')) $best = $v;
        }
        return $best;
    }

    /** Run one scenario with the PHP engine; returns [reference result, ms]. */
    public static function runPhp($id) {
        $inputs = self::inputs($id);
        $t0 = microtime(true);
        $r = EnergySimulator::fromInputs($inputs)->runSimulation($inputs['start_date'], $inputs['end_date']);
        $ms = (int) round(1000 * (microtime(true) - $t0));
        return [self::fromPhpResult($r), $ms];
    }

    /** The reference form of a runSimulation() result. */
    public static function fromPhpResult(array $r) {
        $summary = [];
        foreach ($r['summary'] as $k => $v) {
            if (is_scalar($v) || $v === null) $summary[$k] = $v;
        }
        $days = [];
        foreach ($r['daily'] as $d) {
            $days[] = [
                $d['date'], (int) $d['hours'], (int) $d['open_hours'],
                round($d['avg_air_temp'], 2), round($d['avg_water_temp'], 2),
                round($d['total_loss_kwh'], 3), round($d['total_solar_kwh'], 3),
                round($d['total_hp_kwh'], 3), round($d['total_boiler_kwh'], 3),
                round($d['hp_thermal_kwh'] ?? 0, 3), round($d['boiler_thermal_kwh'] ?? 0, 3),
                round($d['total_cost'], 2),
            ];
        }
        $hours = ['water' => [], 'hp' => [], 'boiler' => [], 'mode' => ''];
        foreach ($r['hourly'] as $h) {
            $hours['water'][] = round($h['pool']['water_temp'], 2);
            $hours['hp'][] = round($h['gains']['heat_pump_kw'], 2);
            $hours['boiler'][] = round($h['gains']['boiler_kw'], 2);
            $hours['mode'] .= self::MODE_CODES[$h['pool']['heating_mode']] ?? '?';
        }
        return ['summary' => $summary, 'days' => $days, 'hours' => $hours];
    }

    /**
     * Compare a reference result with the expected one. Same rules as
     * compareReference() in sim-ts/src/reference.ts.
     * @return array {status: identical|rounding|differs, summary_diffs, days_differing, first_day, hours_differing, first_hour}
     */
    public static function compare(array $expected, array $got) {
        $exact = true;
        $same = function ($a, $b) use (&$exact) {
            if ($a === $b) return true;
            if (is_numeric($a) && is_numeric($b)) {
                if ((float) $a == (float) $b) return true;
                $exact = false;
                return abs($a - $b) <= self::TOLERANCE + 1e-9 * max(abs($a), abs($b));
            }
            return false;
        };
        $summaryDiffs = [];
        foreach ($expected['summary'] as $k => $v) {
            $w = $got['summary'][$k] ?? null;
            if (!$same($v, $w)) $summaryDiffs[] = ['key' => $k, 'expected' => $v, 'got' => $w];
        }
        $daysDiffering = 0;
        $firstDay = null;
        $n = max(count($expected['days']), count($got['days']));
        for ($i = 0; $i < $n; $i++) {
            $a = $expected['days'][$i] ?? null;
            $b = $got['days'][$i] ?? null;
            $ok = $a !== null && $b !== null && count($a) === count($b);
            for ($j = 0; $ok && $j < count($a); $j++) {
                $ok = $same($a[$j], $b[$j]);
            }
            if (!$ok) {
                $daysDiffering++;
                $firstDay = $firstDay ?? ($a[0] ?? $b[0] ?? "#$i");
            }
        }
        $hoursDiffering = 0;
        $firstHour = null;
        $eh = $expected['hours'];
        $gh = $got['hours'];
        $n = max(count($eh['water']), count($gh['water']));
        for ($i = 0; $i < $n; $i++) {
            $ok = isset($eh['water'][$i], $gh['water'][$i])
                && $same($eh['water'][$i], $gh['water'][$i]) && $same($eh['hp'][$i], $gh['hp'][$i])
                && $same($eh['boiler'][$i], $gh['boiler'][$i]) && ($eh['mode'][$i] ?? '') === ($gh['mode'][$i] ?? '');
            if (!$ok) {
                $hoursDiffering++;
                $firstHour = $firstHour ?? $i;
            }
        }
        $differs = $summaryDiffs || $daysDiffering || $hoursDiffering;
        return [
            'status' => $differs ? 'differs' : ($exact ? 'identical' : 'rounding'),
            'summary_diffs' => array_slice($summaryDiffs, 0, 10),
            'summary_differing' => count($summaryDiffs),
            'days_differing' => $daysDiffering,
            'first_day' => $firstDay,
            'hours_differing' => $hoursDiffering,
            'first_hour' => $firstHour,
        ];
    }

    /** Key figures that changed between two versions' stored results, per scenario. */
    public static function changes($fromVersion, $toVersion) {
        $a = self::results($fromVersion);
        $b = self::results($toVersion);
        if (!$a || !$b) return null;
        $keys = ['total_cost', 'boiler_thermal_kwh', 'hp_thermal_kwh', 'total_electricity_kwh', 'days_below_27', 'avg_water_temp_open'];
        $out = [];
        foreach (self::scenarios() as $s) {
            $id = $s['id'];
            if (!isset($a[$id], $b[$id])) continue;
            $cmp = self::compare($a[$id], $b[$id]);
            $row = ['id' => $id, 'title' => $s['title'], 'status' => $cmp['status'], 'values' => []];
            foreach ($keys as $k) {
                $row['values'][$k] = ['from' => $a[$id]['summary'][$k] ?? null, 'to' => $b[$id]['summary'][$k] ?? null];
            }
            $out[] = $row;
        }
        return $out;
    }
}
