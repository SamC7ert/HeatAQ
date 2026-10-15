<?php
// Engine reference set - command line tool (see README.md in this folder).
//
//   php tests/reference/reference.php check [id ...]   PHP engine vs the stored results
//                                                      for its version (else the newest older)
//   php tests/reference/reference.php write [--force]  store this version's results
//   php tests/reference/reference.php changes FROM TO  key figures that changed between
//                                                      two versions' stored results
//   php tests/reference/reference.php add ID "Title" "Description" inputs.json
//                                                      add a scenario from a run's exported
//                                                      inputs (run detail -> Export inputs)
//
// Command line only: this script must never run from a web request.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('memory_limit', '2G');
require __DIR__ . '/../../lib/PoolScheduler.php';
require __DIR__ . '/../../lib/EnergySimulator.php';
require __DIR__ . '/../../lib/ReferenceCheck.php';

$cmd = $argv[1] ?? 'check';
$version = EnergySimulator::getVersion();

if ($cmd === 'check') {
    $ids = array_slice($argv, 2) ?: array_column(ReferenceCheck::scenarios(), 'id');
    $base = ReferenceCheck::baselineVersion($version);
    if ($base === null) {
        fwrite(STDERR, "No stored results to check against (run 'write' first).\n");
        exit(2);
    }
    $expected = ReferenceCheck::results($base);
    echo "Engine $version vs stored results of $base" . ($base === $version ? '' : ' (no results stored for this version yet)') . "\n";
    $bad = 0;
    foreach ($ids as $id) {
        [$got, $ms] = ReferenceCheck::runPhp($id);
        if (!isset($expected[$id])) {
            echo sprintf("  %-24s no stored result\n", $id);
            continue;
        }
        $c = ReferenceCheck::compare($expected[$id], $got);
        if ($c['status'] === 'differs') $bad++;
        $detail = $c['status'] === 'differs'
            ? sprintf('%d summary values, %d days (first %s), %d hours (first #%s)%s',
                $c['summary_differing'], $c['days_differing'], $c['first_day'] ?? '-', $c['hours_differing'], $c['first_hour'] ?? '-',
                $c['summary_diffs'] ? '; e.g. ' . implode(', ', array_map(fn($d) => "{$d['key']} " . json_encode($d['expected']) . ' -> ' . json_encode($d['got']), array_slice($c['summary_diffs'], 0, 3))) : '')
            : '';
        echo sprintf("  %-24s %-9s %5d ms  %s\n", $id, $c['status'], $ms, $detail);
    }
    if ($base !== $version) {
        echo "\nDifferences are expected for a new version: review them, then store its results with 'write'.\n";
        exit(0);
    }
    echo $bad ? "\n$bad scenario(s) differ from the stored results of this version.\n" : "\nAll scenarios match.\n";
    exit($bad ? 1 : 0);
}

if ($cmd === 'write') {
    $file = ReferenceCheck::dir() . "/results/$version.json.gz";
    if (file_exists($file) && !in_array('--force', $argv, true)) {
        fwrite(STDERR, "Results for $version already exist. A version's results must not change: bump the version, or use --force for a version not yet released.\n");
        exit(2);
    }
    $out = ['version' => $version, 'engine' => 'php', 'generated' => gmdate('Y-m-d\TH:i:s\Z'), 'scenarios' => []];
    foreach (ReferenceCheck::scenarios() as $s) {
        [$out['scenarios'][$s['id']], $ms] = ReferenceCheck::runPhp($s['id']);
        echo sprintf("  %-24s %5d ms\n", $s['id'], $ms);
    }
    file_put_contents($file, gzencode(json_encode($out), 9));
    echo "Wrote results/$version.json.gz\n";
    exit(0);
}

if ($cmd === 'changes') {
    [$from, $to] = [$argv[2] ?? null, $argv[3] ?? $version];
    $rows = ReferenceCheck::changes($from, $to);
    if ($rows === null) {
        fwrite(STDERR, "Need stored results for both versions. Stored: " . implode(', ', ReferenceCheck::versions()) . "\n");
        exit(2);
    }
    echo "Changes $from -> $to\n";
    $pct = fn($a, $b) => (is_numeric($a) && is_numeric($b) && abs($a) > 1e-9) ? sprintf('%+.1f%%', 100 * ($b - $a) / abs($a)) : (($a == $b) ? '=' : json_encode($a) . '->' . json_encode($b));
    echo sprintf("  %-24s %-9s %9s %9s %9s %9s %s\n", 'scenario', 'status', 'cost', 'boiler', 'HP heat', 'electr.', 'days >1°C below');
    foreach ($rows as $r) {
        $v = $r['values'];
        echo sprintf("  %-24s %-9s %9s %9s %9s %9s %s\n", $r['id'], $r['status'],
            $pct($v['total_cost']['from'], $v['total_cost']['to']), $pct($v['boiler_thermal_kwh']['from'], $v['boiler_thermal_kwh']['to']),
            $pct($v['hp_thermal_kwh']['from'], $v['hp_thermal_kwh']['to']), $pct($v['total_electricity_kwh']['from'], $v['total_electricity_kwh']['to']),
            $v['days_below_27']['from'] . ' -> ' . $v['days_below_27']['to']);
    }
    exit(0);
}

if ($cmd === 'add') {
    [$id, $title, $description, $file] = array_slice($argv, 2, 4) + [null, null, null, null];
    if (!$file || !preg_match('/^[a-z0-9-]+$/', (string) $id)) {
        fwrite(STDERR, "Usage: reference.php add ID \"Title\" \"Description\" inputs.json  (ID: a-z, 0-9, -)\n");
        exit(2);
    }
    $inputs = json_decode((string) file_get_contents($file), true);
    if (($inputs['format'] ?? null) !== 1) {
        fwrite(STDERR, "$file is not exported run inputs\n");
        exit(2);
    }
    $list = ReferenceCheck::scenarios();
    if (in_array($id, array_column($list, 'id'), true)) {
        fwrite(STDERR, "Scenario $id exists already\n");
        exit(2);
    }
    file_put_contents(ReferenceCheck::dir() . "/inputs/$id.json.gz", gzencode(json_encode($inputs), 9));
    $list[] = ['id' => $id, 'title' => $title, 'description' => $description, 'start' => $inputs['start_date'], 'end' => $inputs['end_date']];
    file_put_contents(ReferenceCheck::dir() . '/scenarios.json', json_encode($list, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    echo "Added $id. Stored results of earlier versions do not include it; store this version's results with 'write --force' (only for a version not yet released) or with the next version.\n";
    exit(0);
}

fwrite(STDERR, "Usage: reference.php check [id ...] | write [--force] | changes FROM [TO] | add ID TITLE DESCRIPTION FILE\n");
exit(2);
