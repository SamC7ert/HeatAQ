# HeatAQ Development Handover Guide

## Before Starting
Run the error check script:
```bash
./scripts/check.sh
```

## Version Management
- **Always bump version** with each change set (e.g., V73 → V74)
- Version appears in two places in `index.html`:
  - Header badge (line ~77)
  - Admin info panel (line ~1218)
- **Update cache-bust params** on all JS includes: `?v=XX`
- Both must match!

## Pre-Commit Checklist

### 1. Variable & Method Checks
- [ ] All variables defined before use
- [ ] All methods/functions exist before calling
- [ ] API endpoints exist for frontend calls

### 2. Data Flow
- [ ] Config data stored correctly (check `config_snapshot` structure)
- [ ] Debug/recalc uses stored config, not defaults
- [ ] DOM elements exist before accessing properties

### 3. Syntax
- [ ] Run `php -l` on modified PHP files
- [ ] No duplicate braces or missing semicolons
- [ ] Check element IDs match between HTML and JS

## Key Architecture Points

### Simulation Config Flow
1. User selects config template in Simulate tab
2. `run_simulation` API loads config from `config_templates` table
3. Config stored in `simulation_runs.config_snapshot` as JSON:
   ```json
   {
     "simulator_version": "1.0.0",
     "pool_config": { ... },
     "equipment": { ... },
     "config_template_id": 1,
     "config_template_name": "Benchmark",
     "schedule_template_id": 1,
     "schedule_template_name": "Standard Hours"
   }
   ```
4. Debug tab loads this stored config for recalculation

### Key Files
- `lib/EnergySimulator.php` - Core simulation logic
- `api/simulation_api.php` - Simulation endpoints
- `api/heataq_api.php` - General API (configs, users, projects)
- `assets/js/modules/simulations.js` - Simulation UI
- `assets/js/modules/simcontrol.js` - Tab control, dropdowns

### Common Issues & Fixes
| Issue | Cause | Fix |
|-------|-------|-----|
| Old code running | Browser cache | Bump version + cache params |
| API 400 error | Missing endpoint | Add case in API switch |
| Debug recalc mismatch | Using default config | Load from config_snapshot |
| Undefined variable | Variable not in scope | Check function parameters |

## Database
- **Full schema reference**: `db/schema.md` (auto-generated, comprehensive)
- **Schema JSON**: `db/schema.json` (for programmatic access)
- **Structure overview**: `docs/DATABASE_STRUCTURE.md` (human-readable)
- **SQL schema**: `db/database_schema_simulation.sql`
- **Migrations**: `db/migrations/`

## Testing
After changes, verify:
1. Simulate tab loads last run
2. Config dropdown populates
3. Debug tab shows correct config name
4. Run simulation completes without errors
5. Charts render properly
