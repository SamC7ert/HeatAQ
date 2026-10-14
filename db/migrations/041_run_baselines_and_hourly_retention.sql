-- 041: Run baselines and hourly-data retention
-- Description: is_baseline and hourly_purged_at on simulation_runs; drop unused indexes on simulation_hourly_results
--
-- Hourly results are by far the largest table (millions of rows). They are
-- needed only to inspect a run's hours (Details tab, week chart), so they are
-- kept for the newest 5 runs per site and removed from older runs
-- (lib/RunRetention.php). A run's inputs (config_snapshot, now including a
-- copy of the schedule), summary and daily results are always kept.
--
-- is_baseline:     run marked as a baseline to compare against (History).
--                  Never removed by the clean-up; its hours can be recreated
--                  from its saved inputs on demand.
-- hourly_purged_at: when this run's hourly rows were removed (NULL = not).
--
-- Every query on simulation_hourly_results filters by run_id, which
-- idx_run_timestamp (run_id, timestamp) serves. idx_run_id (its prefix) and
-- idx_timestamp are never used and only take space.

ALTER TABLE simulation_runs
    ADD COLUMN IF NOT EXISTS is_baseline TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Kept as a baseline to compare against; never cleaned up'
        AFTER status,
    ADD COLUMN IF NOT EXISTS hourly_purged_at DATETIME NULL DEFAULT NULL
        COMMENT 'When hourly results were removed by retention (NULL = not removed)'
        AFTER is_baseline;

ALTER TABLE simulation_hourly_results
    DROP INDEX IF EXISTS idx_timestamp,
    DROP INDEX IF EXISTS idx_run_id;

-- Verification query (run after migration)
-- SHOW COLUMNS FROM simulation_runs LIKE '%baseline%';
-- SHOW INDEX FROM simulation_hourly_results;
