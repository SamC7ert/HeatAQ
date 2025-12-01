# HeatAQ Session Handoff

**Date:** December 2024
**Next Task:** Debug Simulator Heat Balance Calculation

---

## Current State

### What Works
- **Schedule system** - Pool open/closed hours correctly determined
- **Schedule periods** - 10-20 type periods correctly identify open hours
- **Cover logic in code** - `if ($hasCover && !$isOpen)` applies 90% reduction
- **Pool settings** - `has_cover` correctly saved in pools table
- **Debug endpoint** - `/api/scheduler_api.php?action=debug_schedule&date=2024-06-15` shows schedule status

### What Needs Debugging
The simulation shows "Cover Off" and constant heat demand even when:
1. Pool is Closed (schedule working)
2. Pool has `has_cover = 1` in database

**Root cause found:** Config templates had `cover: { has_cover: false }` in `json_config`, which overwrote the pool's `has_cover` setting.

**Fix applied:** Migration 024 removes pool/cover/solar sections from config_templates.

### Pending Verification
After running migration 024 and re-running simulation:
- [ ] Verify "Cover On" displays when pool is Closed
- [ ] Verify heat demand drops significantly during closed hours (90% reduction)
- [ ] Verify chart shows variation between open/closed periods

---

## Recent Migrations (Run in Order)

### Migration 023: Exception Days Refactor
Creates new exception days architecture:
- `reference_days` - anchor date types (Easter = id 1)
- `reference_day_dates` - actual dates per year
- `exception_days` - universal holiday definitions
- `schedule_template_exceptions` - junction table linking templates to exception days

### Migration 024: Clean Config Templates JSON
Removes pool physical properties from config templates:
```sql
UPDATE config_templates SET json_config = JSON_REMOVE(json_config, '$.pool') WHERE ...;
UPDATE config_templates SET json_config = JSON_REMOVE(json_config, '$.cover') WHERE ...;
UPDATE config_templates SET json_config = JSON_REMOVE(json_config, '$.solar') WHERE ...;
```

---

## Key Files

### Scheduler
- `lib/PoolScheduler.php` - Schedule resolution, period matching
- `api/scheduler_api.php` - Schedule API with debug endpoint

### Simulator
- `lib/EnergySimulator.php` - Heat balance calculation
  - Line 1312: `$hasCover = $this->poolConfig['has_cover'];`
  - Line 1417-1422: Cover reduction logic
  - `setConfigFromUI()` - receives pool config, could be improved to ignore pool/cover/solar sections

### Simulation API
- `api/simulation_api.php`
  - Line 200: First call to `setConfigFromUI($poolConfig)` - pool data
  - Line 261: Second call to `setConfigFromUI($config)` - config template (was overwriting pool settings)

---

## Debug Tools

### Schedule Debug
```
/api/scheduler_api.php?action=debug_schedule&date=2024-06-15
```
Returns: template info, hourly open/closed, all schedules, periods

### Simulation Debug Hour
```
/api/simulation_api.php?action=debug_hour&date=2024-07-27&hour=7
```
Returns: stored values, recalculated values, config info, schedule debug

---

## Data Flow

### Simulation Run
1. Pool loaded from `pools` table → `has_cover = true`
2. `$poolConfig['cover']['has_cover'] = true` built
3. `setConfigFromUI($poolConfig)` → sets `$this->poolConfig['has_cover'] = true`
4. Config template loaded → `json_config` parsed
5. `setConfigFromUI($config)` → **WAS overwriting has_cover if present in json_config**
6. Simulation runs with final config
7. `config_snapshot` saved to `simulation_runs` table

### Debug Panel Display
1. Loads `config_snapshot` from stored run
2. `inp.config.has_cover` used for display
3. Shows value from **when simulation was run**, not current pool setting
4. Must re-run simulation to see updated settings

---

## Architecture Principles

- **Pool properties in pools table** - has_cover, has_tunnel, solar_absorption
- **Config templates for equipment/control** - hp_capacity, boiler_capacity, control_strategy
- **No silent fallbacks** - fail with clear error
- **INT foreign keys** - proper FK relationships

---

## Next Steps

1. **Run migration 024** in phpMyAdmin
2. **Re-run simulation** with updated config
3. **Verify** cover applies correctly (lower heat demand when closed)
4. **If still issues**, debug EnergySimulator heat balance calculation:
   - Check `debugSingleHour` output for actual vs expected values
   - Verify cover factor (0.1) being applied to evap/conv/rad losses
   - Compare open hour vs closed hour calculations

---

## User Preferences

- Prefers INT foreign keys over VARCHAR lookups
- No silent fallbacks - fail with clear error
- Thorough fixes over quick patches
- Run migrations directly in SQL before deploying code changes
- Reference day name should be "1. Påskedag" not "Easter (Norway)"
