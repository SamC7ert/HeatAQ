# HeatAQ Roadmap

**Last Updated:** December 2024 (Session: Exception Days & Simulator Debug)

Long-term architectural improvements and technical debt items.

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
