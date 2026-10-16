# HeatAQ simulator - the engine

The simulation engine: pool physics, schedule, heating strategies
(reactive, predictive, planning on forecasts) and run totals. It runs in
the browser, in a Web Worker. It is the only engine: the server prepares
each run and stores its results, but does not simulate. (Until simulator
3.19.0 a PHP engine, `lib/EnergySimulator.php`, ran alongside it and gave
identical results; it is in git history, and its results are kept in
`tests/reference`.)

| File | Content |
|---|---|
| `src/engine.ts` | The run: hour loop, predictive planning (`computeClosedPlan`), heating modes, totals, planning on forecasts, and `debugHour` (the Details hour panel). `PORT_OF_VERSION` is the simulator version. |
| `src/physics.ts` | Heat losses (evaporation, convection, radiation, cover, floor, walls), solar gain, heat pump, boiler. |
| `src/scheduler.ts` | Opening periods and targets from the schedule copy (port of `lib/PoolScheduler.php`). |
| `src/rules.ts` | Strategy rules every hour must satisfy (checked on the reference set). |
| `src/reference.ts` | The compact "reference result" and its comparison (`tests/reference`). |
| `src/worker.ts` | The Web Worker: runs a simulation, or a reference check. |
| `src/types.ts` | The inputs (`RunInputs`, from the server) and the results. |

## A run

1. The page calls `run_simulation` (Simulate, Energy Analysis) or
   `recreate_hourly`. The server (`lib/EnergySimulator.php`, run
   preparation) builds the configuration from the config template, the
   run's overrides and the schedule, validates it, loads weather, solar
   and (when planning on forecasts) forecasts, creates the run record, and
   returns the engine's inputs (`exportRunInputs()`).
2. The browser simulates them in the worker (`SimEngine.run`,
   `assets/js/modules/simengine.js`) and saves the results (below).

Local clock times are handled as wall-clock values in a fixed zone (UTC),
so results do not depend on the browser's or the server's time zone.

## Saving a run

Requests stay under ~90 KB each (shared hosts' firewalls refuse larger
bodies with a bare 403), so results go in pieces:

1. The daily results as stored (`storedDailyRows()`: compact rows; about
   30 KB a year) go with the summary in one `submit_ts_results` request,
   or for long runs first in pieces (`submit_ts_daily`, 3 at a time). The
   run is then complete and every results view works. With hourly data it
   is flagged `summary.hourly_saving`. The server writes each request in
   one transaction.
2. Only if "Save hourly data in database" is ticked (off by default; the
   Details tab does not need saved hours, see below), the hourly rows are
   saved in the background (`HourlySaver` in `simengine.js`, progress panel
   in the top bar): `submit_ts_hourly` pieces, 3 at a time, then
   `finish_ts_hourly` clears the flag. Runs queue oldest first; a failed
   piece is retried twice, then the panel offers Retry / Dismiss.
3. If retention removes the run's hours during saving (newer runs took the
   newest-5 places), the server answers 410 and the run is dropped from
   the queue. A run left `hourly_saving` (page closed, saving dismissed)
   shows as "hours incomplete"; Recreate hours rebuilds them (a new run
   from the saved inputs, simulated here with its hours saved).

## Hours on demand (Details tab)

A run's hours are only needed by the Details tab (hour panel, week chart).
They are computed in the browser when needed instead of being stored
(`SimulationsModule.ensureHours()` in `assets/js/modules/simulations.js`):

1. The Details tab shows the inspected run (the one selected in History or
   just run; else the newest run covering the date). If this browser holds
   its hours (`SimEngine.local`, the newest 2 runs, kept with their
   inputs), they are used.
2. Otherwise the run's saved inputs are loaded (`get_sim_inputs`) and
   simulated in the worker: about 0.1-0.3 s per simulated year, once per
   run and session.
3. The recomputed days are checked against the run's saved daily results.
   The note next to the week chart heading says where the hours come from,
   and warns when they do not match: the run was made with another
   simulator version, or weather or solar data changed since.
4. A run made with another simulator version that has its own saved hours
   uses those (`debug_week`): they are the exact record of that version.
   Runs without a saved schedule copy (before V239) also use the server.

The hour panel (Calculate) recomputes one hour in the browser
(`HeatAQSim.debugHour`, main-thread bundle `assets/js/sim/heataq-sim.js`)
from the run's inputs, at the hour's start water temperature and open
state; `debug_hour` on the server only gives the run, its saved row for
the hour (if its hours are saved), its settings and the day's schedule.

## Tests

From `sim-ts/`, after `npm run build`:

    node test/closed_plan.mjs        # the closed-period plan (computeClosedPlan)
    node test/rules.mjs              # every strategy rule catches a broken run
    node test/reference.mjs check    # reference set: results + strategy rules
    npm test                         # build and all three

The reference set (`tests/reference/README.md`) holds scenarios with
frozen inputs and the results each simulator version gives, and is the
checklist for releasing a new version. Admin → System → Engine
Verification runs it in the browser; run it after each deployment and once
in each browser you use.

`test/seed_ts_sim.py` writes synthetic weather and solar data and a
seasonal schedule for a local test database (see its docstring).

## Build

The browser bundles in `assets/js/sim/` are committed (the server needs no
build step). After changing `src/`:

    cd sim-ts && npm install && npm run typecheck && npm run build

The build also writes `assets/js/sim/version.json` (the simulator version,
read by the server). Bump `?v=` in `index.html` as for any JS change. The
design of the control strategy is in `docs/PREDICTIVE_CONTROL.md` (§0 maps
the code).
