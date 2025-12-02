# HeatAQ Development Handover Guide

**Current Version:** V122 (December 2024)

## Recent Session Summary (Dec 2024)

### Completed Work
1. **Debug Mode Toggle** - Admin-only toggle in System section controls visibility of detail cards in Details tab
2. **Details Tab** (renamed from Debug) - Top section (graph, hour selector, main results) always visible; only detail cards are toggled
3. **Cover Heat Loss Breakdown** - Debug output now shows evaporation/convection/radiation saved by pool cover
4. **Memory Limit** - Increased to 512M for long simulations
5. **CSS Fix** - Added `!important` to `.debug-only` rules to prevent inline style overrides

### Key Files Modified
- `assets/js/config.js` - Version V122
- `assets/css/main.css` - Debug mode CSS with `!important`
- `assets/js/modules/admin.js` - `toggleDebugMode()`, `applyDebugMode()`, `initDebugMode()`
- `assets/js/modules/simulations.js` - Removed inline `display:block` overrides
- `lib/EnergySimulator.php` - Cover breakdown in debug output (v3.10.43)
- `index.html` - Debug tab renamed to Details, HTML restructuring

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

### Ongoing Issues
- `save_preference` API returns 400 for debug_mode (localStorage fallback works)
- Predictive preheating algorithm needs testing (HP rate showing 59 kW instead of 125 kW)

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

**Version is set in ONE place:** `assets/js/config.js`
```javascript
APP_VERSION: 'V122',
```

This updates both:
- Header badge (via JavaScript)
- System tab info panel

**Always bump version** with each change set (e.g., V121 → V122)

Note: The V85 values in `index.html` are just fallback HTML - they get overwritten by JavaScript on load.

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

## Database Migration Workflow (Simplified)

1. **Create migration** in `db/migrations/NNN_description.sql`
2. **Merge & Deploy** to get code on server
3. **Run** migration via System tab → verify green button + log
4. **Archive** → automatically exports schema, commits, merges to master, pushes
5. Done! GitHub is in sync.

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
