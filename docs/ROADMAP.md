# HeatAQ Roadmap

**Last Updated:** July 2026 (Session: Climate verification, report & project-switch fixes)

Long-term architectural improvements and technical debt items.

---

## Recent Changes (Jul 2026)

### Simulation Report fixes (V200–V203, deployed)
- **Per-year losses (V200):** report headers read "MWh/year" but `summary.*_kwh`
  are cumulative over the whole period; the display now divides by the number
  of years (`total_hours / 8760`), so all MWh/year sections are true annual
  figures. (`simcontrol.js`)
- **Total system loss net of solar (V200):** total is now gross losses −
  solar gain, not gross alone. (`simcontrol.js`)
- **Days-below thresholds target-relative (V201):** were hard-coded 27/26
  (only correct for target 28); now `target−1` / `target−2`, with the actual
  temps rendered in the labels. (`EnergySimulator.php`, `simcontrol.js`,
  `energy-analysis.js`)
- **Comfort metrics use open hours only (V202–V203):** "days below" now counts
  only days the pool was open, against the in-use daily minimum; the whole
  Temperature block (min/avg/max) aggregates over open hours and is retitled
  "Temp. når åpent". While closed the water is allowed to coast below target by
  design, so those dips no longer count as failures. (`EnergySimulator.php`,
  `simcontrol.js`, `index.html`)

### Project switch persisted on server session (deployed)
- The backend derives the current project from `user_sessions.project_id`
  (set at login); the client's project selection only updated a cookie that
  production ignores, so creating/switching a project left the backend on the
  login-time project and project-scoped writes (schedules, configs) landed
  under the wrong id.
- Added `switch_project` action (validates access, updates the session);
  `create_project` now switches the session to the new project; frontend
  `switchProject()` calls it and awaits before reloading. (`heataq_api.php`,
  `project.js`)

### Code review (Jul 2026) — see `docs/CODE_REVIEW_2026-07.md`
Fixed (V209): per-year summary cards, partial control-override no longer nulls
target_temp, avg_cop over elec>0 hours, monthly-report label refresh, Schedules
reload on project switch. **Flagged follow-ups (not yet done):**
- [x] Config template overriding pools-table cover/solar/wind/years — fixed (strip at read time)
- [x] `unmet_kwh` over-counts deliberate non-heating — fixed (requested_heat threading)
- [ ] Outdoor pool wall/floor loss vs 15°C tunnel / 5°C ground anchor — PARKED as future improvement, see "Structural losses: ground temperature" under Data & Calculations
- [x] Silent weather/solar fallbacks — STRICT: simulation stops with actionable error on any missing field/hour/solar day; Frost end-exclusive fetch fixed (Dec-31 root cause)
- [x] Weather-fetch error handling — fixed (upsert, 502 on upstream error, completeness%, retry/backoff + requeue)
- [x] `PoolScheduler` project scoping — fixed (filtered by template project)
- [x] Sim starting inside a closed period — fixed (plan seeded at hour 0)
- [ ] HP COP curve / sky-temp offset / cover-U / capacity defaults hardcoded — make config/derived

### Test suite design — see `docs/TEST_STRATEGY.md`
Designed (not built): Layer 0 CI lint (php -l + node --check), Layer 1 physics
regression (extract `HeatLossPhysics`, known-value + energy-balance + per-year
invariants, golden-master), Layer 2 Playwright UI action scenarios, Layer 3 API
contract tests. Build order: physics first.

---

## Recent Changes (Dec 2024)

### Exception Days Refactor (Migration 023)
- Created universal `exception_days` table (Admin edits these)
- Created `reference_days` table (Easter, Thanksgiving as anchor dates)
- Created `reference_day_dates` table (actual dates per year)
- Created `schedule_template_exceptions` junction table (links templates to exception days with day_schedule override)
- Admin Exception Days page edits universal definitions
- Schedule Management shows all exception days and allows assigning day_schedules per template

### Config Templates Cleanup (Migration 024)
- Removed `pool`, `cover`, `solar` sections from `config_templates.json_config`
- Pool physical properties (has_cover, has_tunnel, solar_absorption) now ONLY come from pools table
- Config templates should only contain: equipment, control, bathers settings

### Schedule Period Bug Fix
- Fixed bug where `from == to` periods (zero-length) matched all hours
- Added `debug_schedule` endpoint to scheduler API for troubleshooting

---

## Priority Items

### 1. UI/UX Improvements
**Priority:** High
**Status:** In Progress

- [x] Apply brand colors from example.ppt to login/sidebar (V103)
- [x] Collapsible sidebar - icons only when not hovered (V103)
- [x] Sidebar logo (V103)
- [ ] Migration result display improvements
- [ ] Better error feedback for users
- [x] **Progress reporting for multi-year simulations** — DONE (V214) as live text + percent ("Simulating Jan 2017... (34% of period)"); a visual bar can be layered on later if wanted
- [x] **Live simulation progress next to Run button** — DONE (V214): simulator reports progress once per simulated month to the run row; frontend polls `get_run_progress` and shows "Simulating Jan 2017... (34% of period)". Session lock released in simulation_api so polls don't block behind the running request.
- [ ] **Norwegian date format** - Date fields currently show English format, should be Norwegian (dd.mm.yyyy). Investigate where locale is set - possibly per-user preference?
- [ ] **Station search/browse feature** - Add ability to search/browse nearby weather stations instead of typing IDs manually. Use Frost API `/sources/v0.jsonld` endpoint with geometry parameter for location-based search. Docs: https://frost.met.no/api.html
- [x] **Show missing weather data in the station UI** — DONE (V213): Yearly Averages has a clickable "Missing h" column (missing rows + NULL-field hours, clamped to the station's data range) opening a per-gap detail modal, plus a "Filled h" column. Fetch retry/backoff shipped earlier (V212). Additionally: explicit **gap filling by interpolation** (diurnal profile ±3 days, edge-blended, ≤7-day runs, values flagged `is_interpolated` via migration 030, measured values never overwritten) — `lib/WeatherGapFiller.php`, actions `get_weather_gaps` / `fill_weather_gaps`.
- [x] **Default station = the open project's station** — DONE (V214): the Weather Station view auto-selects the open project site's `weather_station_id` and loads its data.

### 2. Security & Permissions
**Priority:** High
**Status:** Completed (V104)

- [x] Admin section hidden from non-admin users
- [x] User management API endpoints require admin role
- [x] Role-based UI visibility
- [x] Force password change on first login (admin sets initial password)
- [x] Password history prevents reuse of last 5 passwords
- [x] Similar password detection (prevents MyPassword → MyPassword1)
- [x] Debug mode toggle (admin-only) in System section

### 3. Documentation
**Priority:** High
**Status:** In Progress (V102)

- [x] Create HEATING_ALGORITHM.md documenting reactive control
- [ ] Update DESIGN_GUIDE.md to V102
- [ ] Update SESSION_SUMMARY.md (outdated at Nov 2024)
- [ ] Create user guide for operators
- [x] **Fix energy-analysis report methodology text** — DONE: report prose (`Energianalyse Svømmebasseng`) corrected to **Inan & Atayilmaz (2022)** evaporation `(0.28 + 0.784·v)·Δp^0.695 / L_v` + **Bowen-ratio** convection (was wrongly `h = 3.1 + 4.1·v_eff` / "VDI 2089"); same fix applied to `docs/HEATING_ALGORITHM.md`. Wind-damping figure left per-project by design (set per pool via `wind_exposure`, not a fixed 25%). Radiation and wall U already matched.

### 4. Login Improvements (V104)
**Priority:** Medium
**Status:** Complete

- [x] Pre-select last used project on login
- [x] Save last project preference to server (user_preferences table)
- [x] Auto-select single project (skip dropdown if user has only one project)
- [x] login_api.php.example includes last_project_id lookup

**Migration required:** Run `db/migrations/001_add_password_security_columns.sql` to add:
- `force_password_change` column to users table
- `password_history` column to users table (JSON)

---

## Architecture Simplification

### Project → Site → Pool Hierarchy
**Priority:** Medium
**Status:** Complete (Dec 2024)

Clean project/site/pool hierarchy with INT foreign keys throughout.

**Hierarchy:**
```
users → user_projects → projects → pool_sites → pools
                            ↓            ↓
                   schedule_templates    simulation_runs
                   day_schedules         site_solar_daily/hourly
                   week_schedules
```

**Completed (Dec 2024):**
- [x] Schedule tables use INT `project_id` (FK to projects.project_id)
- [x] Site-specific tables use INT `pool_site_id` (FK to pool_sites.id)
- [x] Dropped VARCHAR `site_id` from: pools, simulation_runs, schedule_templates, day_schedules, week_schedules
- [x] User preferences are project-scoped (user_id + project_id + pref_key)

**Remaining:**
- [ ] Move target_heat and bathers from config_templates to pool level

---

## Completed Items

### Solar Data (V56-V102)
- [x] Create site_solar_daily table (raw NASA data)
- [x] Create site_solar_hourly table (calculated with solar position)
- [x] Implement proper solar elevation distribution
- [x] Add UI for configuring site location (Project section)
- [x] Add UI button to fetch NASA solar data (Edit Site modal)
- [x] Migration 009_site_solar_tables.sql

### Pools Table (V97-V102)
- [x] Create pools table with physical properties
- [x] Migration 007_pools_table.sql
- [x] Move pool physical settings from Configuration to pools table
- [x] SimControl uses Project site/pool selection

### Deployment Workflow (V96)
- [x] Merge & Deploy button (replaces GitHub PR workflow)
- [x] Hard Refresh button for cache bypass
- [x] Git merge via API endpoint

### User Preferences Sync (V90-V95, updated Dec 2024)
- [x] Server-side user preferences table
- [x] Cross-device settings sync
- [x] Project-scoped preferences (user_id + project_id + pref_key)

---

## Data & Calculations

### Wind height/roughness correction (currently manual via wind_exposure)
**Priority:** Medium
**Status:** Planned

The simulator applies **only** a single `wind_exposure` factor to the measured
wind (`vEff = windSpeed * wind_exposure_factor`, `EnergySimulator.php:1236`).
It does **not** use the station's stored `wind_height_m` or `terrain_roughness`
(z₀) — those fields are saved but never read in the loss calc (confirmed: no
height/roughness logic in `EnergySimulator.php`, `heataq_api.php`, or
`frost_api.php`; `frost_api.php:175` only picks which measurement level to
fetch).

Consequence: correcting wind from the 10 m measurement height down to pool
height (~2 m) has to be folded manually into `wind_exposure`, which mixes a
measurement-height correction with the shelter meaning the field is documented
for ("0 = sheltered, 1 = fully exposed").

**Interim method** (log wind profile, same z₀ at station and pool):
```
f_height = ln(z_pool/z0) / ln(z_ref/z0)          # 10 m -> 2 m, z0=0.03 -> 0.723
wind_exposure = f_height × f_fence               # e.g. 0.723 × 0.60 (40% fence) = 0.43
vEff = windSpeed × wind_exposure
```
Effect for the 25×5 m Svalbard case: exposure 0.535 → 0.43 lowers open-pool
loss ~15% (−10 °C: 184 → 157 kW).

**Proposed improvement:** apply the log-law height/roughness correction
automatically at weather-read time using the station's `wind_height_m` + z₀ and
the pool height, and reserve `wind_exposure` purely for shelter (fence/terrain
screening). This separates the two concepts and removes the manual step.

### Boiler energy source: electric vs oil/gas
**Priority:** Medium
**Status:** Planned

The backup boiler is modeled as a fuel boiler with a single `gas_nok_kwh`
price (`EnergySimulator.php:281`, cost = `fuel × fuel_cost_per_kwh`,
`:2397`). But the boiler may instead be **electric** (elkjele), in which
case it consumes **electricity** and must be priced at the electricity
tariff — not a separate (often cheaper) gas price.

**Rule going forward:** we choose the boiler's energy source. If electric,
use the electricity price (and ~100% efficiency, not a fuel efficiency);
if oil/gas, use the fuel price. Add an explicit boiler energy-source
selector (electric | oil/gas) instead of always treating it as gas.

**Symptom this caused:** with a low gas price, "Energy Cost" *rose* as the
HP share increased, because boiler heat (`price/efficiency`) looked cheaper
per kWh of heat than HP heat (`price/COP`). That was an artifact of pricing
an electric boiler as if it burned cheap gas. Interim fix: set the gas price
equal to the electricity price when the boiler is electric.

### Structural losses: ground temperature instead of tunnel/anchor assumptions
**Priority:** Medium
**Status:** Planned (parked Jul 2026 — deliberate decision to keep current behavior for now)

The structural loss model assumes warm indoor-ish surroundings, which
understates losses for a free-standing outdoor pool (e.g. Svalbard over
permafrost):

- **Walls** (`EnergySimulator.php` `calculateStructuralLosses`):
  `tunnelRef = tunnelTemp ?? 15.0` — always computed, not gated on
  `has_tunnel`. A no-tunnel outdoor pool is modeled against 15 °C; with
  0 °C surroundings the ΔT (and wall loss) is roughly halved. This is the
  last remaining silent physical default after the Jul 2026 strict-fallback
  cleanup — kept deliberately because all current pools have `has_tunnel=1`.
- **Floor**: fixed flux `Q_POOL_FLUX = 1.51 W/m²` scaled linearly and
  anchored so loss → 0 at 5 °C water, implicitly assuming ground ≈ 5 °C.
  Over permafrost the floor loss is understated.

**Planned fix (needs a domain decision on values):**
1. Add a `ground_temperature_c` field (pool_sites or pools table + Edit
   Pool UI; consider seasonal or annual-mean value).
2. Walls: use `tunnelTemp` only when `has_tunnel`; otherwise use the
   configured ground temperature (strict — no silent default, consistent
   with the no-fallbacks principle).
3. Floor: replace the 5 °C anchor with the configured ground temperature
   (flux or U-value × (T_water − T_ground)).
4. Re-baseline: this increases losses for outdoor cold-climate pools, so
   compare a Svalbard run before/after and note the shift.

Impact today is small (structural losses <1 kW vs ~150 kW surface losses
for the Svalbard case), which is why it is parked rather than rushed.

### Weather data source flexibility
**Priority:** Low
**Status:** Planned

Allow multiple weather data sources per project, not just one station.

### Historical simulation comparison
**Priority:** Medium
**Status:** In Progress

- Compare actual vs simulated performance
- Import actual energy consumption data
- Calculate model accuracy

UI tabs implemented in SimControl: History, Compare, Details

---

## UI Improvements

### Configuration management
**Priority:** Medium
**Status:** Completed

- [x] Configuration selector with create/save/delete
- [x] Config override system in simulation
- [x] Better visualization of active config template

### Dark Mode
**Priority:** Low
**Status:** To Discuss

- Toggle for reduced eye strain
- Respect system preference

### Localization
**Priority:** Low
**Status:** Planned

- Date format: English → Nordic (e.g., "Jan 6, 2024" → "6. jan 2024")
- Number format: Use locale-appropriate decimal separator
- Consider reading locale from browser/user settings

---

## Control Modes & Simulation

### Testing
**Priority:** High
**Status:** In Progress

Control mode testing progress:

| Mode | Status | Notes |
|------|--------|-------|
| **Reactive** | Testing | Well along, details remain |
| **Predictive** | Not Started | Next priority |
| **Optimizing** | Planned | Cost optimization based on spot electricity prices |

See `docs/HEATING_ALGORITHM.md` for mode descriptions.

### Optimizing Mode (New)
**Priority:** Medium
**Status:** Planned

New control strategy to minimize cost using spot electricity prices:
- Shift heating to low-price hours
- Pre-heat before price spikes
- Integrate with Nord Pool / electricity price API
- Balance cost vs comfort (temperature constraints)

---

## Known Issues

### Simulation / Scheduler
- [ ] **Simulator debugging needed** - Cover/schedule logic verified working, need to validate full heat balance calculation
- [ ] Debug tab "Cover On/Off" display depends on stored config_snapshot (re-run simulation after changes)
- [ ] Schedule template exception days not loading in simulation (schedule_template_exceptions empty)

### Simulation UI
- [ ] Site selector does not load correct site (may show non-existent site)
- [ ] History tab only loads partial data
- [ ] Analysis tab does not show analysis data
- [x] Debug tab renamed to Details - always visible; debug mode controls detail cards only

### Login
- [ ] Add option to view password in login form

---

## Recent Completions (Dec 2024)

- [x] Cover heat loss breakdown in debug output (evaporation/convection/radiation saved)
- [x] Debug mode toggle (admin-only) - controls detail card visibility
- [x] Details tab (renamed from Debug) - top section always visible
- [x] Memory limit increased to 512M for long simulations

---

## New Features Planned

### Details tab graph interaction
- [ ] Click on graph in Details tab to see hourly details

### Project templates
- [ ] Create new projects from template

---

## Technical Debt

### Code cleanup
- [x] Remove deprecated PHP endpoints (diagnose_site_ids, fix_site_ids) - Dec 2024
- [ ] Consolidate duplicate JavaScript modules
- [ ] Add TypeScript types for better IDE support
- [x] Remove VARCHAR site_id columns from schedule_templates (completed Dec 2024)
- [x] Remove getSiteIdString() helper (removed Dec 2024)
- [x] Drop site_id from day_schedules and week_schedules (migration 026 created Dec 2024)
- [ ] Move target_heat and bathers from config_templates to pool level
- [ ] Update EnergySimulator.setConfigFromUI() to ignore pool/cover/solar sections (defense in depth)
- [ ] Automatic cache busting (JS files have manual ?v=N, should auto-increment on deploy)
- [ ] Investigate: Planned HP rate may not apply during open periods (debug shows correct calculation but output differs)
- [x] Remove silent defaults - validation added to EnergySimulator (Dec 2024)

### Development Principles
- **No silent fallbacks** - Fail with clear error instead of defaulting to magic values
- **Thorough over quick** - Fix root cause, not symptoms
- **INT foreign keys** - Use proper FK relationships, not VARCHAR lookups

### Testing infrastructure
- [ ] Unit tests for EnergySimulator
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical workflows

### Performance
- [ ] Lazy load simulation results
- [ ] Database query optimization
- [ ] Frontend bundle optimization

---

## Brand Colors (from example.pptx)

Reference colors for UI updates:

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Blue | `#4472C4` | Buttons, links |
| Orange | `#ED7D31` | Warnings, boiler |
| Gold | `#FFC000` | Solar, highlights |
| Light Blue | `#5B9BD5` | Heat pump, info |
| Green | `#70AD47` | Success, positive |
| Dark Blue-Gray | `#44546A` | Sidebar background |

---

## Notes

This document is maintained to track long-term goals across development sessions.
