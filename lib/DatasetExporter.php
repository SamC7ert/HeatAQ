<?php
/**
 * Export a weather station's dataset to git, for analysis outside the app
 * (Admin -> Weather -> Weather Data, "Export dataset to git").
 *
 * Writes data/<station_id>/ on the branch data-exports (never merged into
 * master):
 *   station.json         the station, and the pool sites that use it
 *   weather.csv.gz       hourly observations (weather_data, with is_interpolated)
 *   forecasts.csv.gz     forecast runs (weather_forecasts)
 *   forecast_misses.csv  runs not found in MET's archive (weather_forecast_misses)
 *   solar_site_<id>.csv.gz  hourly solar per linked pool site (site_solar_hourly)
 *   manifest.json        when, row counts, sizes, simulator version, app commit
 *
 * The commit is built with git's plumbing commands (a temporary index, no
 * checkout), so the live checkout and its branch are never touched. A new
 * export of a station replaces its folder; other stations' folders stay.
 */
class DatasetExporter {
    const BRANCH = 'data-exports';
    const MAX_FILE_BYTES = 90 * 1024 * 1024;     // GitHub refuses files over 100 MB

    /**
     * @return array ['success', 'branch', 'commit', 'path', 'files' => [name => [rows, bytes]], 'log' => [...]]
     */
    public static function export(PDO $db, string $stationId) {
        $log = [];
        $repo = realpath(__DIR__ . '/..');
        $stmt = $db->prepare("SELECT * FROM weather_stations WHERE station_id = ?");
        $stmt->execute([$stationId]);
        $station = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$station) {
            throw new InvalidArgumentException('Station not found');
        }
        if (!preg_match('/^[A-Za-z0-9_.-]{1,50}$/', $stationId)) {
            throw new InvalidArgumentException('Station id not usable as a folder name');
        }
        if (!is_dir($repo . '/.git')) {
            throw new RuntimeException('The app folder is not a git checkout');
        }

        $tmp = sys_get_temp_dir() . '/heataq_export_' . bin2hex(random_bytes(6));
        if (!mkdir($tmp, 0700)) {
            throw new RuntimeException('Could not create a temporary folder');
        }
        try {
            $files = [];

            // station.json: the station and its pool sites (position and height only)
            $sites = $db->prepare("
                SELECT id, name, latitude, longitude, elevation_m, weather_station_id, default_weather_station,
                       solar_latitude, solar_longitude
                FROM pool_sites WHERE weather_station_id = ? OR default_weather_station = ?
                ORDER BY id
            ");
            try {
                $sites->execute([$stationId, $stationId]);
                $siteRows = $sites->fetchAll(PDO::FETCH_ASSOC);
            } catch (PDOException $e) {
                $siteRows = [];
                $log[] = 'Pool sites not read: ' . $e->getMessage();
            }
            file_put_contents("$tmp/station.json", json_encode(['station' => $station, 'pool_sites' => $siteRows],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n");
            $files['station.json'] = ['rows' => 1 + count($siteRows), 'bytes' => filesize("$tmp/station.json")];

            $tables = [
                ['weather.csv.gz', "SELECT * FROM weather_data WHERE station_id = ? ORDER BY timestamp", [$stationId]],
                ['forecasts.csv.gz', "SELECT * FROM weather_forecasts WHERE station_id = ? ORDER BY source, issued_at, valid_at", [$stationId]],
                ['forecast_misses.csv', "SELECT * FROM weather_forecast_misses WHERE station_id = ? ORDER BY source, issued_at", [$stationId]],
            ];
            foreach ($siteRows as $s) {
                $tables[] = ["solar_site_{$s['id']}.csv.gz",
                             "SELECT * FROM site_solar_hourly WHERE pool_site_id = ? ORDER BY timestamp", [$s['id']]];
            }
            foreach ($tables as [$name, $sql, $params]) {
                try {
                    $rows = self::writeCsv($db, "$tmp/$name", $sql, $params);
                } catch (PDOException $e) {
                    $log[] = "$name: not exported (" . $e->getMessage() . ')';
                    @unlink("$tmp/$name");
                    continue;
                }
                $bytes = filesize("$tmp/$name");
                if ($bytes > self::MAX_FILE_BYTES) {
                    throw new RuntimeException("$name is too large for GitHub (" . round($bytes / 1048576) . ' MB)');
                }
                $files[$name] = ['rows' => $rows, 'bytes' => $bytes];
                $log[] = "$name: " . number_format($rows) . ' rows, ' . number_format($bytes / 1024) . ' kB';
            }

            $version = @json_decode((string) @file_get_contents($repo . '/assets/js/sim/version.json'), true);
            $manifest = [
                'station_id' => $stationId,
                'exported_at' => gmdate('Y-m-d H:i:s') . ' UTC',
                'simulator_version' => $version['version'] ?? null,
                'app_commit' => trim((string) self::git($repo, 'rev-parse HEAD')),
                'files' => $files,
                'notes' => 'Times are UTC as stored (weather_data.timestamp, weather_forecasts.*_at). '
                         . 'CSV files: header row, comma separated, NULL as empty.',
            ];
            file_put_contents("$tmp/manifest.json", json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n");

            $result = self::commitAndPush($repo, $tmp, "data/$stationId", array_merge(array_keys($files), ['manifest.json']),
                                          "Dataset export: $stationId ({$manifest['exported_at']})", $log);
            return $result + ['path' => "data/$stationId", 'files' => $files, 'log' => $log];
        } finally {
            foreach (glob("$tmp/*") ?: [] as $f) @unlink($f);
            @rmdir($tmp);
        }
    }

    /** Stream a query to a CSV file (gzip when the name ends in .gz); returns the row count. */
    private static function writeCsv(PDO $db, string $path, string $sql, array $params) {
        $gz = substr($path, -3) === '.gz';
        $fh = fopen(($gz ? 'compress.zlib://' : '') . $path, 'wb');
        if (!$fh) throw new RuntimeException("Could not write $path");
        // Unbuffered: rows go to the file as they come (hundreds of thousands of rows)
        $buffered = $db->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
        $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        $n = 0;
        try {
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            $header = false;
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                if (!$header) {
                    fputcsv($fh, array_keys($row), ',', '"', '');
                    $header = true;
                }
                fputcsv($fh, array_values($row), ',', '"', '');
                $n++;
            }
            if (!$header) {
                // No rows: header from the result's columns
                $cols = [];
                for ($i = 0; $i < $stmt->columnCount(); $i++) $cols[] = $stmt->getColumnMeta($i)['name'];
                fputcsv($fh, $cols, ',', '"', '');
            }
            $stmt->closeCursor();
        } finally {
            $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $buffered);
            fclose($fh);
        }
        return $n;
    }

    /**
     * Commit the files to BRANCH under $dir (replacing that folder) without a
     * checkout: blobs (hash-object), a temporary index based on the branch's
     * last commit, write-tree, commit-tree, push.
     */
    private static function commitAndPush(string $repo, string $tmp, string $dir, array $names, string $message, array &$log) {
        $remote = self::pushRemote($repo, $log);
        // The branch's last commit on GitHub (none on the first export)
        $parent = null;
        $fetch = self::git($repo, 'fetch --quiet ' . escapeshellarg($remote) . ' '
                                  . escapeshellarg('refs/heads/' . self::BRANCH), $code);
        if ($code === 0) {
            $parent = trim((string) self::git($repo, 'rev-parse FETCH_HEAD'));
        } elseif (strpos((string) $fetch, "couldn't find remote ref") === false) {
            throw new RuntimeException('git fetch failed: ' . self::hideToken($fetch));
        }

        $index = "$tmp/index";
        $env = 'GIT_INDEX_FILE=' . escapeshellarg($index) . ' ';
        if ($parent) {
            self::git($repo, 'read-tree ' . escapeshellarg($parent), $code, $env);
            self::git($repo, 'rm --cached -r -q --ignore-unmatch ' . escapeshellarg($dir), $code, $env);
        } else {
            self::git($repo, 'read-tree --empty', $code, $env);
        }
        foreach ($names as $name) {
            $blob = trim((string) self::git($repo, 'hash-object -w ' . escapeshellarg("$tmp/$name"), $code));
            if ($code !== 0 || !preg_match('/^[0-9a-f]{40}$/', $blob)) {
                throw new RuntimeException("git hash-object failed for $name");
            }
            self::git($repo, 'update-index --add --cacheinfo ' . escapeshellarg("100644,$blob,$dir/$name"), $code, $env);
            if ($code !== 0) throw new RuntimeException("git update-index failed for $name");
        }
        $tree = trim((string) self::git($repo, 'write-tree', $code, $env));
        if ($code !== 0) throw new RuntimeException('git write-tree failed');

        // Author: the checkout's git identity, else the app's
        $ident = trim((string) self::git($repo, 'config user.email')) === ''
            ? "GIT_AUTHOR_NAME=HeatAQ GIT_AUTHOR_EMAIL=heataq@localhost GIT_COMMITTER_NAME=HeatAQ GIT_COMMITTER_EMAIL=heataq@localhost "
            : '';
        $commit = trim((string) self::git($repo, 'commit-tree ' . escapeshellarg($tree)
            . ($parent ? ' -p ' . escapeshellarg($parent) : '') . ' -m ' . escapeshellarg($message), $code, $ident));
        if ($code !== 0 || !preg_match('/^[0-9a-f]{40}$/', $commit)) {
            throw new RuntimeException('git commit-tree failed: ' . self::hideToken($commit));
        }
        $out = self::git($repo, 'push --quiet ' . escapeshellarg($remote) . ' '
                                . escapeshellarg($commit . ':refs/heads/' . self::BRANCH), $code);
        if ($code !== 0) {
            throw new RuntimeException('git push failed: ' . self::hideToken($out));
        }
        $log[] = 'Pushed ' . substr($commit, 0, 7) . ' to ' . self::BRANCH;
        return ['success' => true, 'branch' => self::BRANCH, 'commit' => $commit];
    }

    /** origin with the token from config_heataq/git_credentials.php when present (as Admin -> Deployment). */
    private static function pushRemote(string $repo, array &$log) {
        foreach ([$repo . '/../config_heataq/git_credentials.php', $repo . '/git_credentials.php'] as $path) {
            if (!file_exists($path)) continue;
            $c = include $path;
            $url = trim((string) self::git($repo, 'remote get-url origin'));
            if (!empty($c['github_token']) && !empty($c['github_user']) && preg_match('#^https://github\.com/(.+)$#', $url, $m)) {
                $log[] = 'Using the GitHub credentials from ' . basename($path);
                return "https://{$c['github_user']}:{$c['github_token']}@github.com/{$m[1]}";
            }
        }
        return 'origin';
    }

    private static function git(string $repo, string $args, &$code = null, string $env = '') {
        $out = [];
        exec('cd ' . escapeshellarg($repo) . ' && ' . $env . 'git ' . $args . ' 2>&1', $out, $code);
        return implode("\n", $out);
    }

    private static function hideToken($text) {
        return preg_replace('#https://[^@\s]+@#', 'https://***@', (string) $text);
    }
}
