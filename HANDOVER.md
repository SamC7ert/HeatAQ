# HeatAQ Development Handover Guide

**Current Version:** V132 (December 2024)

## Recent Session Summary (Dec 2024)

### V132 - Database Migrations Complete
- Migrations 026 & 027 executed - all VARCHAR site_id columns removed
- Database schema now clean: only INT foreign keys (pool_site_id, project_id)
- Version bump forces browser cache refresh

### V131 - Code Cleanup & Energy Analysis Preparation

#### Remove Silent Defaults - "No Magic Values" Policy
1. **API pool_site_id** - APIs now require explicit pool_site_id via cookie (dev mode) or auth (prod)
   - No more `pool_site_id = 1` fallback in heataq_api.php, simulation_api.php, scheduler_api.php
   - Clear error message: "Missing pool_site_id: Set heataq_pool_site_id cookie or enable authentication"

2. **EnergySimulator validation** - `validateConfigForSimulation()` added
   - Validates pool config (area_m2, volume_m3, depth_m) before running
   - Validates equipment config (heat_pump.capacity_kw, boiler.capacity_kw)
   - Validates weather data structure at simulation start
   - Throws clear errors instead of silently defaulting

3. **PoolScheduler** - Constructor now requires explicit poolSiteId parameter
   - No more `$poolSiteId = 1` default

4. **JavaScript validation** - Target temperature validation in schedules.js
   - Throws error if period target_temp is missing or invalid (20-35°C range)
   - Shows warning in UI for missing config values

#### Database site_id Cleanup
5. **Migration 026 created** - `db/migrations/026_drop_site_id_from_day_week_schedules.sql`
   - Drops `site_id` VARCHAR from day_schedules and week_schedules
   - Drops `pool_site_id` from week_schedules (uses project_id instead)
   - Creates new unique constraints on (name, project_id)

6. **Migration 027 created** - `db/migrations/027_drop_pool_sites_site_id.sql`
   - Drops `site_id` VARCHAR from pool_sites (was confusing - looked like a FK)
   - pool_sites now uses only `id` (INT PK) and `name` for display
   - All code updated to use `id` instead of `site_id`

7. **Deprecated functions removed**:
   - `getSiteIdString()` - no longer needed
   - `diagnoseSiteIds()` - migration tool, no longer needed
   - `fixSiteIds()` - migration tool, no longer needed

8. **getPools()** and all APIs updated to use pool_site_id (INT) instead of VARCHAR site_id

9. **Backward compatibility** - Code works before AND after migrations run
   - `saveSiteData()` checks if site_id column exists before INSERT
   - Pre-migration: generates slug and includes site_id
   - Post-migration: inserts without site_id column

#### Database State (V132 - Migrations Complete)
| Table | site_id Status | Notes |
|-------|---------------|-------|
| schedule_templates | ✅ CLEAN | Uses project_id |
| day_schedules | ✅ CLEAN | Uses project_id (migration 026) |
| week_schedules | ✅ CLEAN | Uses project_id (migration 026) |
| pool_sites | ✅ CLEAN | Uses id (INT PK) only (migration 027) |

**Result:**
- **No more VARCHAR site_id columns** in any table
- All foreign key references use INT `pool_site_id` (references `pool_sites.id`)
- Schedule tables use INT `project_id` for access control

### Completed Work - V129/V130

#### Weather Station Management & Frost API Integration
1. **Weather Station CRUD** - Add/Edit/Delete weather stations in Admin → Weather section
2. **Frost API Integration** - Fetch weather data from Norwegian Meteorological Institute (frost.met.no)
3. **Update Data Button** - Yellow button to fetch weather data for selected station
4. **Add Station Modal** - Check button queries Frost API for station metadata
5. **Date Range Fetch** - Yearly batch processing with progress bar
6. **Station Parameters** - Wind height (m) and terrain roughness (z₀) editable inline

#### UI Improvements
7. **Button Color Convention** - All "+ Add/New" buttons are light green (#90EE90), "Update Data" is yellow (#FFD700)
8. **Station Details Card** - Shows date range, record count, location (clickable Google Maps link)
9. **Delete/Save Button Layout** - Delete left, Save right, aligned with form width

#### Technical Improvements
10. **PHP Error Handling** - frost_api.php has 5-min timeout, 512M memory, global try-catch
11. **Summary Data API** - get_weather_stations returns date range/record count when station_id provided

### Key Files Modified
- `assets/js/config.js` - Version V130
- `assets/js/modules/admin.js` - Weather station management, showUpdateDataModal(), fetchWeatherDataForStation()
- `assets/js/modules/calendar.js` - Green "+ New" button for date ranges
- `assets/js/modules/schedules.js` - Green "+ Add Period", "+ New" buttons
- `api/frost_api.php` - NEW: Frost API proxy with check_station, fetch_and_store_year actions
- `api/heataq_api.php` - Weather station CRUD endpoints, summary data query
- `index.html` - Weather Data card with inline editing, Update Data button, green Add buttons
- `docs/DESIGN_GUIDE.md` - Updated button color convention

### Weather Station Architecture
```
Frontend (admin.js):
  loadWeatherStations() → populates dropdown
  onStationChange() → shows details, loads data
  showUpdateDataModal() → queries Frost API, shows date picker
  fetchWeatherDataForStation() → yearly batches with progress

API (frost_api.php):
  check_station → validates station exists, returns metadata + data range
  fetch_and_store_year → fetches one year, stores in weather_data table

Database:
  weather_stations: station_id, station_name, latitude, longitude, elevation_m, wind_height_m, terrain_roughness
  weather_data: station_id, timestamp, temperature, wind_speed, wind_direction, humidity
```

### Button Color Convention (V129)
| Button Type | Color | Hex | Usage |
|-------------|-------|-----|-------|
| Add/New | Light Green | `#90EE90` | + Add Station, + New, + Add Range, etc. |
| Update/Fetch | Yellow | `#FFD700` | Update Data |
| Save | Blue | `#006494` | Save changes |
| Delete | Red | `#d62828` | Delete actions |
| Cancel | Gray | `#6c757d` | Cancel/Close |

### Ongoing Issues
- `save_preference` API returns 400 for debug_mode (localStorage fallback works)
- Predictive preheating algorithm needs testing (HP rate showing 59 kW instead of 125 kW)

---

## Previous Session (V122)

### Completed Work
1. **Debug Mode Toggle** - Admin-only toggle in System section controls visibility of detail cards in Details tab
2. **Details Tab** (renamed from Debug) - Top section (graph, hour selector, main results) always visible; only detail cards are toggled
3. **Cover Heat Loss Breakdown** - Debug output now shows evaporation/convection/radiation saved by pool cover
4. **Memory Limit** - Increased to 512M for long simulations
5. **CSS Fix** - Added `!important` to `.debug-only` rules to prevent inline style overrides

### Debug Mode Architecture
```
CSS:
  .debug-only { display: none !important; }
  body.debug-mode-on .debug-only { display: block !important; }

JavaScript (admin.js):
  toggleDebugMode(enabled) → saves to localStorage + server
  applyDebugMode(enabled) → adds/removes body.debug-mode-on class
  initDebugMode() → called on page load, checks admin status

HTML:
  <div id="debug-results" class="debug-only"> <!-- controlled by debug mode -->
```

---

## Before Starting

1. Read the key documentation:
   - `docs/ROADMAP.md` - Current priorities and known issues
   - `docs/HEATING_ALGORITHM.md` - Control modes (reactive, predictive)
   - `docs/DATABASE_STRUCTURE.md` - Database overview

2. Run the error check script:
```bash
./scripts/check.sh
```

## Version Management

### App Version
**Set in ONE place:** `assets/js/config.js`
```javascript
APP_VERSION: 'V130',
```

This updates both:
- Header badge (via JavaScript)
- System tab info panel

**Always bump version** with each change set (e.g., V121 → V122)

Note: The fallback values in `index.html` should match the config.js version (for cache-bust params and HTML fallbacks).

### Simulator Version
**Set in:** `lib/EnergySimulator.php`
```php
const VERSION = '3.10.43';
```

Update the simulator version when calculation logic changes. This version is:
- Stored with each simulation run in `simulation_runs.config_snapshot`
- Displayed in the UI when viewing simulation results
- Used to track which algorithm version produced which results

## System Tab Workflow

The System tab (Admin only) provides three cards in order:

### 1. Deployment
- **Check Status**: Shows git status, behind/ahead counts, available branches
- **Pull Updates**: Pulls latest from origin/master
- **Merge & Deploy**: Merges a `claude/*` branch into master (one-click PR alternative)

### 2. Database Migrations
- **Check Migrations**: Lists pending `.sql` files in `db/migrations/`
- **Run**: Executes migration, button turns green (success) or red (failure)
- **Description → Log link**: After run, description becomes clickable log link
- **Archive**: Moves to `old_migrations/`, exports schema, commits to branch, merges to master, pushes

### 3. Database Schema Export
- **Export & Push to Git**: Exports `schema.json` + `schema.md`, commits to `db-schema-update` branch, merges to master, pushes

### 4. Debug Mode Toggle (NEW)
- Admin-only toggle switch
- Controls visibility of detail cards in Details tab
- Stored in localStorage (`heataq_debug_mode`) with server sync fallback

Both Archive and Export use **branch-then-merge** pattern for clean git history.

## Database Migration Workflow (Safe Deployment)

**Key principle**: Code must work BEFORE and AFTER migration runs.

1. **Create migration** in `db/migrations/NNN_description.sql`
2. **Make code backward-compatible** - check if column/table exists before using
   ```php
   // Example: Check if column exists before INSERT
   $cols = $db->query("SHOW COLUMNS FROM table LIKE 'old_column'")->fetchAll();
   if (count($cols) > 0) {
       // Pre-migration: include old_column
   } else {
       // Post-migration: skip old_column
   }
   ```
3. **Deploy** code (works with current schema)
4. **Run** migration via System tab → verify green button + log
5. **Archive** → exports schema, commits, merges to master, pushes
6. **Next version**: Remove backward-compatibility code (optional cleanup)

## Design Principles

### NEVER Hardcode Default Values
- User preferences (site, pool, config) must come from user's last choice
- Always validate against database before using
- Fallback: query database for first available option
- Example: Site selection uses cookie → validate in DB → fallback to first DB record

### Data Flow
- Frontend saves preference → sets cookie → backend reads cookie
- Backend validates cookie value exists in DB before using
- If invalid/missing, query DB for first available option

## Key Architecture Points

### Tech Stack
- **Frontend:** HTML5, JavaScript (ES6+), CSS3
- **Backend:** PHP 8.2+
- **Database:** MySQL 5.7+
- **Simulator:** Python 3.8+ (numpy, pandas)

### Control Modes (see `docs/HEATING_ALGORITHM.md`)

| Mode | Description | Status |
|------|-------------|--------|
| **Reactive** | Maintains target temp 24/7, ignores schedule | Testing |
| **Predictive** | Follows schedule, uses setback temp when closed | In Progress |
| **Optimizing** | Minimizes cost using spot electricity prices | Planned |

### Simulation Config Flow
1. User selects config template in Simulate tab
2. `run_simulation` API loads config from `config_templates` table
3. Config stored in `simulation_runs.config_snapshot` as JSON
4. Details tab loads this stored config for recalculation

### Key Files
| File | Purpose |
|------|---------|
| `assets/js/config.js` | App version and configuration |
| `lib/EnergySimulator.php` | Core simulation logic (v3.10.43) |
| `api/simulation_api.php` | Simulation endpoints |
| `api/heataq_api.php` | General API (configs, users, projects) |
| `assets/js/modules/simulations.js` | Simulation UI |
| `assets/js/modules/simcontrol.js` | Tab control, dropdowns |
| `assets/js/modules/admin.js` | Admin functions, debug mode toggle |
| `assets/css/main.css` | Main styles including debug mode CSS |

### Common Issues & Fixes
| Issue | Cause | Fix |
|-------|-------|-----|
| Old code running | Browser cache | Hard refresh (Ctrl+Shift+R) or bump version |
| API 400 error | Missing endpoint | Add case in API switch |
| Debug recalc mismatch | Using default config | Load from config_snapshot |
| Undefined variable | Variable not in scope | Check function parameters |
| Login fails on desktop | Untrusted submit event | Fixed V105 - calls handleLogin() directly |
| Password reset button disabled | Recursive validation bug | Fixed V113 - separated validation functions |
| Stale branches in dropdown | Deleted remote refs cached | Fixed V112 - uses `git fetch --prune` |
| Wrong site in SimControl | Hardcoded default 'arendal_aquatic' | Fixed - now reads from cookie, validates in DB |
| Debug cards always visible | Inline styles overriding CSS | Fixed V122 - removed inline styles, added !important |

### Password Reset Flow
The password reset form (`reset_password.html`) includes:
- Password requirements checklist (8 chars, upper, lower, number)
- Match confirmation hint ("✓ Passwords match" / "✗ Passwords do not match")
- Show/Hide toggle for both password fields
- Button only enables when all requirements met AND passwords match

## Database

- **Full schema reference**: `db/schema.md` (auto-generated, comprehensive)
- **Schema JSON**: `db/schema.json` (for programmatic access)
- **Structure overview**: `docs/DATABASE_STRUCTURE.md` (human-readable)
- **SQL schema**: `db/database_schema_simulation.sql`
- **Migrations**: `db/migrations/`

Current stats (~905K records):
- 26 tables
- 780K+ hourly simulation results
- 87K weather data records
- 95 simulation runs

## Testing

After changes, verify:
1. Login works on both desktop and mobile browsers
2. Simulate tab loads last run
3. Config dropdown populates
4. Details tab shows correct config name
5. Run simulation completes without errors
6. Charts render properly
7. **Debug mode toggle** works (admin only) - detail cards show/hide

## Known Issues (see `docs/ROADMAP.md`)

- Site selector may not load correct site
- History tab only loads partial data
- Analysis tab does not show data
- Predictive mode: HP rate calculation needs verification

## Documentation Index

| Document | Description |
|----------|-------------|
| `README.md` | Project overview and setup |
| `docs/SYSTEM_ARCHITECTURE.md` | Full module documentation |
| `docs/DATABASE_STRUCTURE.md` | Database tables and relationships |
| `docs/HEATING_ALGORITHM.md` | Control mode logic, cover factors |
| `docs/ROADMAP.md` | Priorities, known issues, planned features |
| `docs/DESIGN_GUIDE.md` | UI/UX guidelines |

## Next Priority Tasks

1. **Predictive Preheating** - Debug why HP shows 59 kW instead of 125 kW capacity
2. **Batch Data Storage** - For simulations longer than current memory allows
3. **save_preference API** - Fix 400 error for debug_mode preference
