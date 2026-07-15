# HeatAQ Code Review — July 2026

**Reviewer:** automated multi-agent review (6 parallel reviewers) + synthesis.
**Trigger:** several recurring bug classes surfaced during a working session
(per-year vs total, open-hours vs all-hours, stale UI, source-of-truth
mismatches, silent fallbacks). This review hunts those classes across the
whole codebase and adds a correctness pass on the simulation engine.

**Scope:** `lib/EnergySimulator.php`, `lib/PoolScheduler.php`,
`lib/NasaSolarFetcher.php`, `api/{heataq_api,simulation_api,frost_api}.php`,
and `assets/js/modules/*.js`.

Severity: **HIGH** = wrong numbers/behaviour users rely on · **MED** =
conditional or narrower impact · **LOW** = cosmetic/latent/dead-code.

---

## A. Fixed in this review (commit 8717fc4, V209)

| # | Fix | File |
|---|-----|------|
| A1 | Summary cards ("Last Simulation Results" + run-detail) now **per year** (÷ `total_hours/8760`) instead of ~10× period totals | `simulations.js` |
| A2 | Partial per-sim control override no longer **nulls `target_temp`/tolerances** → no silent revert to 28 °C | `EnergySimulator.php:267-270` |
| A3 | `avg_cop` averaged only over hours the HP drew electricity (was biased high by idle hours reporting nominal COP) | `EnergySimulator.php:900` |
| A4 | Monthly-report **run-info label** updated after a run (previously only the table refreshed) | `simulations.js` |
| A5 | **Schedules section reloads on project switch/create** (was gated by one-time `window.schedulesLoaded`, showed/edited the previous project's schedules) | `project.js` |

Earlier in the session (V200–V208) we also fixed: per-year Simulation Report,
net-of-solar total, target-relative + open-hours comfort metrics, project
switch persisted to the server session, monthly report refresh after a run,
pool-value refresh after edit, days/yr, default wind exposure 0.5, and the
Energy Analysis table (per-year / in-use / real thresholds).

---

## B. Flagged — recommend fixing, but needs your call / can't verify headless

### B1. Config template silently overrides the pools table — **FIXED** (strip at read time, commit 3e8da2f)
`api/simulation_api.php:308-314` strips only pool **dimensions** from the
selected template's `json_config` before applying it *after* the pools-table
config. It does **not** strip `pool.wind_exposure`, `pool.years_operating`,
`pool.solar_absorption`, or the whole `cover` / `solar` sections. So a config
template with **non-null** values there overrides the Pool editor (pools
table), which is supposed to be authoritative (migration 024 stripped these;
`save_project_config` re-adds them).
- **Currently benign for Svalbard** only because template 10's values are
  null (verified) and `setConfigFromUI` preserves on null + guards `has_cover`.
  A template that sets e.g. `cover.u_value` or `pool.wind_exposure` would
  silently win over the pool.
- **Fix:** in `simulation_api.php` mirror the dimension-stripping —
  `unset($config['pool']['wind_exposure'], $config['pool']['years_operating'], $config['pool']['solar_absorption'], $config['cover'], $config['solar']);`
  (or strip them server-side in `save_project_config`). Pick pools table as
  the single source of truth and enforce it in both save and read paths.
- Not auto-applied: changes behaviour for any project whose template
  intentionally carries these — verify per project first.

### B2. `unmet_kwh` over-counts intentional non-heating — **FIXED** (requested_heat threading, commit ddb8ec1)
`EnergySimulator.php:875` accrues `max(0, netRequirement − total_heat)` every
hour, including hours the controller **deliberately** supplies less (water
above target → heat credit zeroes the request; predictive coast; initial
closed period). Physical results are unaffected, but the headline "unmet
need" is inflated and could drive a wrong "HP undersized" conclusion.
- **Fix:** accrue only the capacity-limited shortfall, i.e. thread the
  post-credit `requiredHeat` out of `calculateHeating` (and the plan paths)
  and use `unmet += max(0, requiredHeat − total_heat)`. Not auto-applied:
  the requested-heat value isn't currently returned by all control paths, so
  it needs care + a re-run to verify.

### B3. Outdoor pool structural losses modelled against warm references — HIGH (modeling)
- **Wall loss** `EnergySimulator.php:1424`: `tunnelRef = tunnelTemp ?? 15.0`.
  Wall loss is always computed (not gated on `has_tunnel`), so an **outdoor**
  pool with no tunnel is modelled against 15 °C — for a 27 °C pool where the
  surroundings are near 0 °C, ΔT is understated ~15 K and wall loss ~halved.
- **Floor loss** `:71,1419`: fixed flux `Q_POOL_FLUX = 1.51 W/m²` linearly
  scaled and anchored so loss → 0 at 5 °C water, implicitly assuming ground
  ≈ 5 °C. Over Svalbard permafrost the floor loss is understated.
- **Fix:** derive both from a configured **ground/soil temperature** (and a
  floor/wall U-value), use tunnel temp only when `has_tunnel`. Needs a domain
  decision + a config field, so flagged not fixed.

### B4. Silent weather/solar fallbacks — **VISIBILITY FIXED** (counters + coverage + report warning, commit e0d5490; fail-fast semantics still open)
The stated principle is "no silent fallbacks," but simulation inputs default
silently in many places:
- Hourly loop `:610-611` and result `:752-753`: `wind ?? 2.0`, `humidity ?? 70`.
- Planner/forecast paths `:1558-1560, 1637-1666, 2060-2062, 1949-1959`:
  `air ?? 10/15`, `wind ?? 2`, `humidity ?? 70` (replay path passes humidity
  **70 as a literal**, ignoring stored data).
- `validateWeatherData` samples only the **first 24 rows** and merely warns —
  a gap at hour 5000 is never detected.
- `NasaSolarFetcher.php:211,226`: NASA `-999` missing days are `continue`d
  (no row written, still counted as processed) and clear-sky defaults to 0;
  `EnergySimulator::getSolarForHour` then returns **0 solar** for missing
  hours — overstating heating demand for those periods with no warning.
- `getWeatherData` (`:993-1010`) does no coverage check: a half-populated
  year silently simulates half the hours, then gets annualized — skewing
  MWh/yr and cost/yr with no indication.
- **Fix:** fail-fast or surface a "used fallback for X% of hours / Y missing
  days" signal in the run summary; validate the whole weather array;
  distinguish "no data" from "zero irradiance." Flagged (changes failure
  semantics; verify against real runs).

### B5. Weather-fetch error handling hides gaps — **FIXED** (upsert + retry/backoff + completeness + 502, commit 2f3ebe1)
- `frost_api.php:451-475`: `INSERT IGNORE` conflates duplicate rows with
  silently-dropped bad rows (both counted as "skipped"); a year where every
  insert fails reports `success, skipped:8760`. Use
  `INSERT … ON DUPLICATE KEY UPDATE` and report insert failures.
- `frost_api.php:391-398`: Frost API errors echo `{error}` but leave HTTP
  **200**; no completeness check vs expected hours. Set 502/500 + report
  expected-vs-received.
- `simulation_api.php:722-732`: on a weather-range query failure it returns a
  hardcoded 2014-2023 range with **200 OK**, so the date picker offers dates
  with no data. Return a non-200 error instead.
- `admin.js fetchWeatherDataForStation`: the original bug — per-year fetch
  errors are swallowed with no retry (roadmap item). Add retry-with-backoff +
  re-queue years that come back short of ~8760 rows.

### B6. `PoolScheduler` project scoping — **FIXED** (template-derived project filter, commit e8c7738)
`lib/PoolScheduler.php:89-92,99-152,171-219`: `getSiteFilter()` returns
`1=1`; `loadDaySchedules`/`loadWeekSchedules` run with **no WHERE**, key day
schedules by **name**, and append the periods of **all same-named schedules
across all projects** into one merged list. Since `site_id` is now NULL the
`unique(name, site_id)` constraint no longer prevents name reuse. Latent
today (one project) but corrupts schedules the moment a second project reuses
a name.
- **Fix:** thread `project_id` into `PoolScheduler` and add
  `WHERE project_id = ?`; key day schedules by id, not name. (Note
  `simulation_api` never reads project_id at all — only `pool_site_id` — so
  the project must be derived from `pool_sites.project_id`.)

### B7. Day-1 closed-start planning gap — **FIXED** (seed plan at hour 0, commit 8fb34a1)
`EnergySimulator.php:633,698,721,2247-2249`: `planClosedPeriod` fires only on
a close **transition** (`prevTargetTemp !== null && targetTemp === null`), and
`prevTargetTemp` starts null. If the window begins while the pool is already
closed, no plan is made, the closed branch is skipped, and predictive control
returns **zero heating** for that first closed stretch — so a Regime-B first
opening gets no preheat and can open below target on day 1. Every later day is
fine.
- **Fix:** seed a closed plan at simulation start when the first hour is
  closed (or hold reactively until the first real close transition).

---

## C. Flagged — lower severity / cleanup

- **C1 `avg_cop` numerator** (`:900` vs `:967`) — addressed in A3; the residual
  is that `applyHeatPump(0,…)` returns nominal COP at all; harmless after A3.
- **C2 Heat-pump COP curve hardcoded** (`:2353-2377`): air-source reference
  15 °C, 2.5 %/°C degradation, 0.2 improvement cap, floor 2.0, `cop_nominal ?? 4.6`.
  These dominate cold-climate cost and aren't derivable from user input beyond
  nominal — make them config or a datasheet table.
- **C3 Sky-temperature offset** `T_sky = T_air − 10` (`:1388`): flat 10 K
  depression; real clear/cold/dry Svalbard nights are 20-30 K (radiation loss
  understated then). Derive from humidity/dew-point or make configurable.
- **C4 Cover default `?? 5.0` and `wind_exposure_factor ?? 1.0`** (`:1205-1206,1266`):
  the code-level `?? 1.0` wind fallbacks would silently apply full exposure if
  the value is ever null, disagreeing with the intended 0.5 — remove them so a
  missing value errors. `cover_r_value` field name vs U-value usage is a
  unit-mislabel smell.
- **C5 Inconsistent capacity/target defaults across planning fns** (`:1546 ?? 125`
  vs `:1847-1849 ?? 200`, `:2119/2174 ?? 200`, `min/max ?? 26/29`, target `?? 28`):
  a missing HP capacity is silently 125 in one path and 200 in another. Rely on
  validation; make min/max band config.
- **C6 Activity factor `?? 1.0`** (`:1288`): missing bather config → no
  evaporation enhancement during in-use hours (understated). Make explicit.
- **C7 Legacy "old-run" thermal estimate** (`simulations.js:2642,2645,2704,2710`):
  `elec × 3.5` / `fuel × 0.92` contradicts the sim's own COP 4.6 and the
  configured boiler efficiency (and the electric-boiler case). Read stored
  COP/efficiency or omit for legacy runs.
- **C8 Ground-thermal-factor fallback ladder** (`:1411,1485-1489`):
  `years_operating ?? 3` (assumes mature install) and hardcoded 1.5/1.2/1.0 when
  `ground_thermal_lookup` is absent — make explicit/config.
- **C9 `loadEquipmentConfig`** (`:131-137`) reads the deprecated `config_json`
  column filtered by `pool_site_id`, but the API writes `json_config` scoped by
  `project_id` — this loader can never match an API-created row (dead/incorrect,
  harmless only because `setConfigFromUI` overwrites it later).
- **C10 Dead code:** `calculateOpenPlanRates`, `applyOpenPeriodHeating`,
  `applyClosedPeriodHeating`, `forecastOpenPeriodDemand` (never called); the
  `runAnalysis` scenario-matrix in `simulations.js:1146-1300` (its DOM ids
  don't exist). If revived, several would need `/years`. Consider deleting.
- **C11 Gross-vs-net "Heat Loss"** (`simulations.js:1384,396,2649`): Compare
  table + cards show gross `total_heat_loss_kwh` while the report's "Total
  system loss" is net of solar — inconsistent definition of "loss."

---

## D. Verified correct (explicitly checked, no change needed)

- Heat-balance **units and signs** are sound: evaporation (Inan-Atayilmaz),
  Bowen-ratio convection, radiation, structural, cover — all dimensionally
  consistent kW; `netRequirement = losses − solar` and the water-temp update
  are correct. No unit/sign errors in the engine.
- **Bowen-ratio ordering**: `calculateConvectionLoss` always runs immediately
  after `calculateEvaporationLoss` at the same temps; `run()` stores the
  returned losses array, not instance debug state — no stale cross-hour leak.
- **Predictive control** matches `docs/PREDICTIVE_CONTROL.md`: conditional
  Regime A/B, demand-driven `T_req` capped at max, late-start ramp, HP-only
  closed heating, explicit preheat flag carried close→open, coast floored at
  min_temp, boiler never builds buffer. **The doc's §8 "divergences" list is
  stale** — see the doc update accompanying this review.
- Correctly-scoped reloads: SimControl dropdowns, Energy Analysis, Compare,
  History list, Configuration and Admin sections all reload on entry.
- Physical constants (density, cp, Stefan-Boltzmann, emissivity, latent heat,
  Magnus/Inan coefficients) are legitimate literature values.

---

## E. Cross-cutting themes (root causes)

1. **Period-total vs per-year** — every display that annualizes must divide by
   `total_hours/8760`; several were added over time without it. A shared
   `formatPerYear(summary, kwh)` helper would prevent recurrence.
2. **Load-once UI** — panels populated at init but not on state change
   (run/pool-save/project-switch/config-change). A single "invalidate + reload
   affected panels" step on each mutation would close the class.
3. **Two stores for one datum** — pools table vs config template, session vs
   cookie, `config_json` vs `json_config`. Pick one source of truth per datum
   and enforce it in **both** save and read paths.
4. **Silent fallbacks** — `?? <magic>` on simulation inputs violates the
   stated principle and hides data gaps behind plausible numbers. Fail-fast or
   surface a coverage/fallback rate on the run.

These four themes are exactly what the test suite (see `TEST_STRATEGY.md`)
should be built to catch.
