# HeatAQ simulator - TypeScript engine

A line-by-line port of `lib/EnergySimulator.php` and `lib/PoolScheduler.php`,
run in the browser (Web Worker). PHP stays the reference until the port has
been compared clean for long enough; the Simulate tab's **Engine** setting
chooses:

| Engine | What happens |
|---|---|
| PHP (server) | as before |
| Compare PHP + TypeScript | PHP runs and stores the results; the browser then runs TypeScript on the same inputs (`get_sim_inputs`) and shows a comparison (summary values and every day) |
| TypeScript (browser) | `run_simulation` with `engine=typescript` sets up the run exactly as for PHP and returns its inputs instead of simulating; the browser simulates and posts the results (see below) |

## Saving a TypeScript run

Requests stay under ~90 KB each (shared hosts' firewalls refuse larger
bodies with a bare 403), so results go in pieces:

1. The daily results as stored (`storedDailyRows()`: compact rows,
   rounded as PHP stores them; about 30 KB a year) go with the summary in
   one `submit_ts_results` request, or for long runs first in pieces
   (`submit_ts_daily`, 3 at a time). The run is then complete and every
   results view works. With hourly data it is flagged
   `summary.hourly_saving`. The server writes each request in one
   transaction (one commit, not one per row).
2. The hourly rows are saved in the background (`HourlySaver` in
   `assets/js/modules/simengine.js`, progress panel in the top bar):
   `submit_ts_hourly` pieces, 3 at a time (1 while a server-side
   simulation runs), then `finish_ts_hourly` clears the flag. Runs queue
   oldest first; a failed piece is retried twice, then the panel offers
   Retry / Dismiss.
3. The Details tab uses this browser's copy of the hours of the latest
   TypeScript runs (`SimEngine.local`, the newest 2 plus any still saving),
   whether they are saved in the database or not: the week chart is built
   locally; `debug_hour` gets the hour's row in a `row` parameter, used when
   that hour is not in the database.
4. If retention removes the run's hours during saving (newer runs took the
   newest-5 places), the server answers 410 and the run is dropped from
   the queue. A run left `hourly_saving` (page closed, saving dismissed)
   shows as "hours incomplete"; Recreate hours rebuilds them.

## How the engines get identical inputs

`EnergySimulator::exportRunInputs()` returns the simulator state after all
configuration (pool, equipment, overrides), the schedule copy
(`PoolScheduler::exportState()`), and the run's weather (UTC and local time)
and solar data - loaded by the same `loadRunData()` that `runSimulation()`
uses. The TypeScript engine (`src/engine.ts`) only computes.

Local clock times are handled as wall-clock values in a fixed zone (UTC) by
both engines (`EnergySimulator::wallClock()`), so results do not depend on
the server's default time zone.

## Build

The browser bundles in `assets/js/sim/` are committed (the server needs no
build step). After changing `src/`:

    cd sim-ts && npm install && npm run typecheck && npm run build

Bump `?v=` in `index.html` as for any JS change.

## Comparing with PHP

1. Make a test database `ts_sim`: a copy of a local HeatAQ test database
   (project 7, site 5 with weather station SN10380, pool 1, schedule
   templates 13-15), then `python3 sim-ts/test/seed_ts_sim.py | mysql ts_sim`.
   Variants: `ts_sim_daily` (daily solar data only) and `ts_sim_nosolar`.
2. For each line of `test/scenarios.txt` (`db|scenario json`):

       TSDB=<db> php sim-ts/test/php-harness.php lib '<scenario json>' case.json

3. `cd sim-ts && npm run build && node test/compare.mjs ../case*.json`

`compare.mjs` checks every summary value, every day and every hour
(water temperature, targets, heating mode, losses, heat pump, boiler,
energy, cost) and prints the first differing hour. `PHPTZ=Europe/Oslo`
runs PHP with a non-UTC server time zone.

When the PHP simulator changes, make the same change in `src/`, then re-run
the comparison.
