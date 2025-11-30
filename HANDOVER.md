# HeatAQ Development Handover Guide

**Current Version:** V105 (November 2024)

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
APP_VERSION: 'V105',
```

This updates both:
- Header badge (via JavaScript)
- System tab info panel

**Always bump version** with each change set (e.g., V105 → V106)

Note: The V85 values in `index.html` are just fallback HTML - they get overwritten by JavaScript on load.

## Pre-Commit Checklist

### 1. Run Check Script
```bash
./scripts/check.sh
```
This checks:
- PHP syntax (`php -l` on all PHP files)
- Version consistency
- Undefined JS references
- API endpoint consistency (JS calls vs PHP handlers)

### 2. Variable & Method Checks
- [ ] All variables defined before use
- [ ] All methods/functions exist before calling
- [ ] API endpoints exist for frontend calls

### 3. Data Flow
- [ ] Config data stored correctly (check `config_snapshot` structure)
- [ ] Debug/recalc uses stored config, not defaults
- [ ] DOM elements exist before accessing properties

### 4. Syntax
- [ ] Run `php -l` on modified PHP files
- [ ] No duplicate braces or missing semicolons
- [ ] Check element IDs match between HTML and JS

## Database Schema Update Workflow

When database structure changes:

```bash
./scripts/update_schema.sh
```

This will:
1. Run `php db/dump_schema.php` to regenerate schema
2. Update `db/schema.json` and `db/schema.md`
3. Auto-commit and push if changes detected

For manual migrations:
- Add SQL files to `db/migrations/`
- Run migrations on server
- Then run `update_schema.sh` to sync docs

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
| **Predictive** | Follows schedule, uses setback temp when closed | Not started |
| **Optimizing** | Minimizes cost using spot electricity prices | Planned |

### Simulation Config Flow
1. User selects config template in Simulate tab
2. `run_simulation` API loads config from `config_templates` table
3. Config stored in `simulation_runs.config_snapshot` as JSON
4. Debug tab loads this stored config for recalculation

### Key Files
| File | Purpose |
|------|---------|
| `assets/js/config.js` | App version and configuration |
| `lib/EnergySimulator.php` | Core simulation logic |
| `api/simulation_api.php` | Simulation endpoints |
| `api/heataq_api.php` | General API (configs, users, projects) |
| `assets/js/modules/simulations.js` | Simulation UI |
| `assets/js/modules/simcontrol.js` | Tab control, dropdowns |

### Common Issues & Fixes
| Issue | Cause | Fix |
|-------|-------|-----|
| Old code running | Browser cache | Bump version in config.js |
| API 400 error | Missing endpoint | Add case in API switch |
| Debug recalc mismatch | Using default config | Load from config_snapshot |
| Undefined variable | Variable not in scope | Check function parameters |
| Login fails on desktop | Untrusted submit event | Call handleLogin() directly |

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
4. Debug tab shows correct config name
5. Run simulation completes without errors
6. Charts render properly

## Known Issues (see `docs/ROADMAP.md`)

- Site selector may not load correct site
- History tab only loads partial data
- Analysis tab does not show data
- Debug tab open/close may differ from main simulation

## Documentation Index

| Document | Description |
|----------|-------------|
| `README.md` | Project overview and setup |
| `docs/SYSTEM_ARCHITECTURE.md` | Full module documentation |
| `docs/DATABASE_STRUCTURE.md` | Database tables and relationships |
| `docs/HEATING_ALGORITHM.md` | Control mode logic |
| `docs/ROADMAP.md` | Priorities, known issues, planned features |
| `docs/DESIGN_GUIDE.md` | UI/UX guidelines |
