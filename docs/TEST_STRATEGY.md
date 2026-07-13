# HeatAQ Test Strategy (design)

**Status:** design only — not yet built. Purpose: define a standard way to
(1) test the **simulator** whenever its calculations change, and (2) drive a
standard set of **UI/config actions** that would have caught the bug classes
found in the July 2026 review (`CODE_REVIEW_2026-07.md`). Build order:
**physics first**, then UI actions, with cheap lint guards from day one.

The design is organised around the four root-cause themes so each theme has
an owning test type:

| Theme (root cause) | Caught by |
|---|---|
| Period-total vs per-year | Physics golden-master + UI assertion |
| Load-once UI / no refresh | UI action scenarios |
| Two stores for one datum | UI action scenarios + a small API test |
| Silent fallbacks / data gaps | Physics coverage assertions |

---

## Layer 0 — Cheap guards (build first, ~1 hour)

A GitHub Actions workflow on every push/PR that runs:
- `php -l` on every `.php` file (catches PHP syntax breaks before deploy).
- `node --check` on every `assets/js/**/*.js` (would have caught the
  template-literal break introduced during this review).
- `jq -e .` / a JSON lint on `db/schema.json` and any committed fixtures.

This is the automation the deploy flow currently lacks: today a broken JS file
only surfaces after Deploy + hard refresh. Cheap, high-value, no test authoring
required. Everything below builds on top.

---

## Layer 1 — Simulator regression model (physics) — PRIORITY

**Goal:** a fixed, deterministic scenario with known-good outputs that is
re-run on every change to `EnergySimulator.php` (or its physics), asserting the
numbers haven't moved unexpectedly and the known-correct relationships hold.

### 1a. The testability problem (decide first)

`EnergySimulator`'s loss/COP methods are **private** and the constructor needs a
PDO connection and loads config from the DB. Three options, in order of
preference:

1. **Extract pure physics** into a dependency-free class, e.g.
   `lib/HeatLossPhysics.php`, with static methods
   `evaporationKw($water,$air,$hum,$windEff,$area,$activity)`,
   `convectionKw(...)`, `radiationKw(...)`, `coverKw(...)`,
   `copForAir($nominal,$air,$isGround)`. `EnergySimulator` calls into it
   (behaviour-preserving refactor). Tests then call the pure functions with no
   DB. **Recommended** — also reduces the duplication between the simulator and
   the JS/py reference implementations.
2. **Golden-master via a CLI harness**: a `tests/run_scenario.php` that boots
   the simulator against a **fixture DB** (SQLite or a disposable MySQL schema
   seeded from `db/schema.sql`), runs one canonical scenario, and prints the
   `summary` JSON. Tests diff that JSON against a committed golden file within
   tolerance. Needed anyway for whole-run assertions even if we do (1).
3. Reflection to reach private methods — last resort, brittle.

Recommend **(1) for unit-level physics + (2) for whole-run golden-master.**

### 1b. Canonical scenario (the "standard model")

Commit a fixed fixture so results are reproducible:
- **Weather:** a small committed hourly file (e.g. `tests/fixtures/weather_svalbard_2024.csv`)
  — one real year of Svalbard SN99840 data (temp/wind/humidity), no gaps.
- **Config:** target 27 °C, min 25 / max 28, HP 125 kW @ COP 4.6, boiler
  200 kW @ 0.92, wind_exposure 0.5, cover U 5.0, 125 m² / 250 m³ / 2 m,
  electric-boiler pricing (elec = gas = 4.8), predictive strategy.
- **Schedule:** a fixed OHC (e.g. open 4 h/day).

### 1c. Point (unit) assertions — known-value physics

From the hand-calculations in this session (they are the spec):
- At water 27, air +5, hum 77 %, wind_eff 2.5 m/s, 125 m²: open surface loss
  ≈ **126 kW** (evap ≈ 70, conv ≈ 36, rad ≈ 20); at air −10, hum 69 %,
  wind_eff 2.7: ≈ **175 kW**. Assert within ±2 %.
- Covered at those conditions ≈ **23 / 40 kW**.
- COP: ground-source constant 4.6; air-source degrades 2.5 %/°C below 15 °C,
  floored at 2.0 — assert the curve at a few air temps.
- Wind monotonicity: loss(wind_eff=5) > loss(2.5) > loss(0).
- Height/exposure factor: `wind_eff = measured × exposure` (once B-series
  fixes land, `× height_factor` too).

### 1d. Whole-run invariants (golden-master + property checks)

Run the canonical scenario and assert:
- **Energy balance closes:** `Σlosses − Σsolar ≈ Σ(hp_thermal + boiler_thermal)
  + Σunmet ± storage change` within tolerance. This single invariant catches
  most unit/sign regressions.
- **Per-year vs total:** `report_value == summary_total / (total_hours/8760)`
  within rounding — the exact class of bug found repeatedly. Assert for every
  annualized field.
- **Net-of-solar total:** `total_system_loss == Σlosses − Σsolar`.
- **Open-hours metrics:** `days_below_(target-1)` counts only days with open
  hours and only the in-use minimum; `min/avg/max` temp use open hours.
- **Cost identity:** `total_cost == Σ(hp_elec × elec_price) + Σ(boiler_fuel ×
  fuel_price)`.
- **avg_cop** is within [2.0, nominal] and equals numerator/denominator over
  elec>0 hours only.
- **Coverage guard (theme 4):** feed a fixture with a deliberate gap (missing
  hours / a NULL wind block) and assert the run either errors or reports the
  fallback/coverage rate — i.e. it must NOT silently annualize a partial year.
- **Golden snapshot:** the full `summary` diffed against
  `tests/golden/svalbard_2024.json`. Regenerating the golden is a deliberate,
  reviewed act (a `--update-golden` flag), so an unexpected diff fails CI and
  forces a human to confirm the change was intended.

### 1e. When it runs
On every push touching `lib/EnergySimulator.php`, `lib/PoolScheduler.php`,
`lib/NasaSolarFetcher.php`, or the fixtures. A moved number that isn't
explained by the commit = red.

---

## Layer 2 — UI / config action scenarios (catches the UI-class bugs)

**Goal:** a standard scripted sequence of user actions (build & change a
configuration, run, navigate) with assertions that would have caught today's
stale-UI / source-of-truth / per-year bugs. Tooling: **Playwright** (a browser
is preinstalled in this environment) against a disposable test instance with a
seeded DB.

### 2a. The standard action script
1. **Create project** "Test" → assert it becomes the active project **and the
   server session switched to it** (create a schedule, reload, confirm it
   persisted under the new project — the create/switch-project bug).
2. **Edit the pool**: set wind_exposure 0.5, cover on → assert the SimControl
   "From Pool Settings" panel updates **without reload** (the pool-value
   refresh bug), and that a simulation actually **uses** 0.5 (not a template
   value — the source-of-truth bug B1).
3. **Build a config** (target 27, tolerances) → **override just one tolerance**
   for a run → assert `target_temp` stays 27, not 28 (bug A2).
4. **Run a simulation** (multi-year) → assert:
   - Summary cards ≈ Simulation Report values (both per year) — no 10×
     mismatch (bug A1).
   - "MWh/year" fields ≈ total/years; "Days/yr < X°C" present with real temps.
   - Monthly table **and** its run-info label match the just-run scenario
     (bugs: monthly refresh + label).
5. **Switch to a second project** → open Schedules → assert it shows project 2's
   schedules, not project 1's (bug A5); open SimControl → assert site/pool/config
   reflect project 2.
6. **Energy Analysis** compare run → assert per-year columns, in-use Min Temp,
   real threshold labels.

### 2b. Assertion style
Prefer **relationship assertions** over hardcoded numbers so the UI tests don't
break on every physics tweak: e.g. `card.heatLoss ≈ report.heatLoss` and
`report.heatLoss ≈ raw_total / years`, rather than "heat loss == 44.0". The
physics golden-master owns the absolute numbers; the UI tests own consistency
and refresh.

### 2c. What each assertion defends
Every assertion above maps to a specific fixed bug, so the suite is a
regression net for exactly the classes that recurred. New bug of the same
class ⇒ add one assertion here.

---

## Layer 3 — Small API/contract tests (optional, cheap)
A few PHP requests against the test instance:
- `switch_project` updates `user_sessions.project_id` and enforces access.
- Project-scoped reads (`get_day_schedules`, `get_templates`) return only the
  session project's rows.
- `save_pool` then read-back returns the saved `wind_exposure` (source-of-truth).
- `fetch_and_store_year` returns a non-200 on a simulated Frost failure (B5).

---

## Build order & phasing
1. **Layer 0** (CI lint) — immediate, no authoring.
2. **Layer 1c/1d** (physics point + invariants) — the priority; start by
   extracting `HeatLossPhysics` and asserting the Svalbard known values + the
   energy-balance and per-year invariants.
3. **Layer 1b golden-master** — add the fixture + snapshot once (2) is green.
4. **Layer 2** UI action script — once the app can be booted against a seeded
   test DB.
5. **Layer 3** API tests — fill gaps as needed.

## Open decisions (for when we build)
- Fixture DB: SQLite (fast, but SQL dialect differs from MariaDB) vs a
  disposable MariaDB (faithful, heavier in CI). Leaning MariaDB service
  container so schema/SQL match production.
- Where the golden numbers come from: first run of the extracted physics,
  cross-checked against the hand-calcs in this session and the Python
  reference in `reference/python/`.
- Tolerance policy: ±2 % on physics point values, exact (±rounding) on
  aggregation/annualization identities.
