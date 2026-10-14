<?php
/**
 * Simulation run retention.
 *
 * Hourly results are the bulk of the database (one row per simulated hour).
 * They are needed only to look at a run's hours (Details tab, week chart),
 * so they are kept for the newest KEEP_HOURLY runs per site that have them
 * and removed from older runs. A run's inputs (config_snapshot, including a
 * copy of its schedule), summary and daily results are always kept, so
 * History, reports, charts and comparisons keep working; a baseline's hours
 * can be recreated from its inputs (simulation_api action recreate_hourly).
 *
 * Deletes run in batches under a time budget, so a large first clean-up can
 * be finished over several calls instead of timing out a web request.
 */
class RunRetention {
    const KEEP_HOURLY = 5;
    const BATCH_ROWS = 20000;

    /**
     * Runs whose hourly rows should go: per site, every run with hourly data
     * except the newest KEEP_HOURLY, plus failed or long-dead running runs.
     *
     * @param int|null $poolSiteId one site, or null for all sites
     * @return array of ['run_id','pool_site_id','scenario_name','created_at','status']
     */
    public static function candidates(PDO $pdo, $poolSiteId = null) {
        $sql = "
            SELECT r.run_id, r.pool_site_id, r.scenario_name, r.created_at, r.status
            FROM simulation_runs r
            WHERE r.hourly_purged_at IS NULL
              AND EXISTS (SELECT 1 FROM simulation_hourly_results h WHERE h.run_id = r.run_id)
              AND NOT (r.status = 'running' AND r.created_at > NOW() - INTERVAL 6 HOUR)
        " . ($poolSiteId ? " AND r.pool_site_id = ?" : "") . "
            ORDER BY r.pool_site_id, r.created_at DESC, r.run_id DESC
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($poolSiteId ? [(int) $poolSiteId] : []);

        $kept = [];
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $run) {
            $site = (int) $run['pool_site_id'];
            $kept[$site] = $kept[$site] ?? 0;
            if ($run['status'] === 'completed' && $kept[$site] < self::KEEP_HOURLY) {
                $kept[$site]++;
                continue;
            }
            $out[] = $run;
        }
        return $out;
    }

    /**
     * Remove hourly rows of the candidate runs, within $seconds.
     *
     * @return array ['runs_done' => int, 'rows_deleted' => int, 'remaining' => int]
     */
    public static function purgeHourly(PDO $pdo, $poolSiteId = null, $seconds = 20) {
        $deadline = microtime(true) + $seconds;
        $runs = self::candidates($pdo, $poolSiteId);
        $done = 0;
        $rows = 0;
        $del = $pdo->prepare("DELETE FROM simulation_hourly_results WHERE run_id = ? LIMIT " . self::BATCH_ROWS);
        $mark = $pdo->prepare("UPDATE simulation_runs SET hourly_purged_at = NOW() WHERE run_id = ?");

        foreach ($runs as $run) {
            do {
                if (microtime(true) > $deadline) {
                    break 2;
                }
                $del->execute([$run['run_id']]);
                $n = $del->rowCount();
                $rows += $n;
            } while ($n === self::BATCH_ROWS);
            $mark->execute([$run['run_id']]);
            $done++;
        }

        return ['runs_done' => $done, 'rows_deleted' => $rows, 'remaining' => count($runs) - $done];
    }

    /**
     * Size of the database's tables (MB), largest first, from
     * information_schema (data + indexes; free = allocated but unused).
     */
    public static function tableSizes(PDO $pdo) {
        $stmt = $pdo->query("
            SELECT table_name AS name, table_rows AS approx_rows,
                   ROUND((data_length + index_length) / 1048576, 1) AS size_mb,
                   ROUND(data_free / 1048576, 1) AS free_mb
            FROM information_schema.TABLES
            WHERE table_schema = DATABASE()
            ORDER BY (data_length + index_length) DESC
        ");
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Give the space of deleted rows back to the disk (InnoDB keeps it in
     * the table file otherwise). Rebuilds the simulation result tables.
     */
    public static function compact(PDO $pdo) {
        $log = [];
        foreach (['simulation_hourly_results', 'simulation_daily_results'] as $table) {
            try {
                $pdo->query("OPTIMIZE TABLE `$table`")->fetchAll();
                $log[] = "Compacted $table";
            } catch (Throwable $e) {
                $log[] = "Could not compact $table: " . $e->getMessage();
            }
        }
        return $log;
    }
}
