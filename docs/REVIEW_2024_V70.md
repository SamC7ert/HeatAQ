# HeatAQ Code & Database Review - V70
## Date: 2024-11-27

---

## 1. Changes Made Today (V68 → V70)

### Control Strategy Fixes
- **Reactive mode** now works like a thermostat - heats 24/7 to target temp, ignores schedule
- **Predictive mode** uses schedule with setback temperature when closed
- Fixed: simulation now starts at target temp (not arbitrary 20°C)
- Fixed: control_strategy read from `equipment` config, not poolConfig

### Chart Fixes
- **Yearly chart stacking** - HP and Boiler now properly stack (manual data summation)
- Charts show **thermal output** (heat delivered) not electricity consumed
- HP thermal = electricity × COP, Boiler thermal = fuel × efficiency

### UI/UX Improvements
- **Debug panel redesign**:
  - Removed Water °C input (uses stored simulation value)
  - Removed Config dropdown (shows config from stored run)
  - Added ◀/▶ arrow buttons to navigate hour-by-hour
  - Shows Config and Schedule as read-only info
  - Water temp displayed next to status
- **Run Simulation button** moved into weather range card
- **Stats table** above chart, chart at bottom
- **Schedule column** added to simulation runs list
- Removed Total Cost from completion message

### User Preferences
- Added `user_preferences` table for cross-device sync
- Preferences stored in database (not just localStorage)
- Selected Config and OHC persist across iPad/desktop

### Version Tracking
- Updated to V70

---

## 2. Database Schema Review

### Current Tables (from schema.json + actual usage)

#### Core Simulation Tables
| Table | Purpose | Status |
|-------|---------|--------|
| `simulation_runs` | Run metadata, config snapshot | ✓ Documented |
| `simulation_daily_results` | Daily aggregates | ✓ Documented |
| `simulation_hourly_results` | Hourly detail | ✓ Documented |

#### Configuration Tables
| Table | Purpose | Status |
|-------|---------|--------|
| `config_templates` | Equipment configs | ⚠️ Issues (see below) |
| `pool_configurations` | Pool physical params | ✓ Documented |
| `pool_sites` | Site definitions | ✓ Documented |

#### Schedule Tables (NOT in schema.json!)
| Table | Purpose | Status |
|-------|---------|--------|
| `schedule_templates` | OHC calendars | ❌ Missing from docs |
| `day_schedules` | Day type definitions | ❌ Missing from docs |
| `day_schedule_periods` | Time periods per day | ❌ Missing from docs |
| `week_schedules` | Mon-Sun patterns | ❌ Missing from docs |
| `calendar_date_ranges` | Seasonal overrides | ❌ Missing from docs |
| `calendar_exception_days` | Holidays | ❌ Missing from docs |

#### Support Tables
| Table | Purpose | Status |
|-------|---------|--------|
| `weather_data` | Historical weather | ✓ Documented |
| `weather_stations` | Station metadata | ✓ Documented |
| `holiday_definitions` | Holiday rules | ✓ Documented |
| `user_preferences` | Per-user settings | ✓ New - Documented |
| `users` | User accounts | ✓ Documented |
| `projects` | Multi-tenant | ✓ Documented |

### Critical Issues Found

#### Issue 1: Dual JSON Columns in config_templates
```
config_templates has BOTH:
- json_config (used by current API)
- config_json (legacy, may have data)
```
**Risk**: Data desync between columns
**Recommendation**: Migrate to single `json_config` column

#### Issue 2: project_id vs site_id Mismatch
```
Schema docs say: site_id VARCHAR(50)
Actual table has: project_id INT
```
**Risk**: Broken foreign key relationships
**Recommendation**: Standardize on one approach

#### Issue 3: Duplicated Fields
These exist BOTH as columns AND in JSON:
- hp_capacity_kw
- boiler_capacity_kw
- target_temp
- control_strategy

**Current behavior**: API overwrites JSON values with column values
**Risk**: Confusion about source of truth

---

## 3. JSON vs Column Storage Analysis

### Current Strategy

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| Equipment settings | JSON (`json_config`) | Flexible, extensible |
| Key metrics | Columns (`hp_capacity_kw`, etc.) | Quick SQL queries |
| Full simulation config | JSON (`config_snapshot`) | Point-in-time snapshot |
| Summary stats | JSON (`summary_json`) | Variable structure |
| Schedule periods | Columns | Relational queries needed |
| User preferences | Key-value columns | Simple, fast |

### The Logic Behind Current Design

**JSON is used when:**
1. Structure may evolve (new equipment types, parameters)
2. Full snapshot needed (simulation config at run time)
3. Variable number of fields (summary stats vary by run)
4. Hierarchical data (equipment → heat_pump → capacity)

**Columns are used when:**
1. Direct SQL filtering needed (`WHERE hp_capacity_kw > 50`)
2. Indexing required for performance
3. Foreign key relationships exist
4. Simple atomic values

### Recommendation: Hybrid Approach (Keep, But Clean Up)

The current hybrid approach is **sensible** for this use case, but needs cleanup:

1. **Remove duplicate columns** from config_templates:
   ```sql
   -- These should ONLY be in json_config:
   ALTER TABLE config_templates DROP COLUMN hp_capacity_kw;
   ALTER TABLE config_templates DROP COLUMN boiler_capacity_kw;
   ALTER TABLE config_templates DROP COLUMN target_temp;
   ALTER TABLE config_templates DROP COLUMN control_strategy;
   ```

2. **OR keep columns as "indexed cache"** but document clearly:
   ```
   json_config = source of truth (full config)
   columns = indexed copies for SQL queries (synced on save)
   ```

3. **Standardize naming**: Use `json_config` everywhere, drop `config_json`

---

## 4. Suggested Next Actions

### High Priority (Fix Issues)

1. **Database Cleanup**
   - [ ] Run migration to consolidate json_config/config_json
   - [ ] Document the JSON vs column strategy
   - [ ] Regenerate schema.json with ALL tables

2. **Schedule Tables Documentation**
   - [ ] Add CREATE TABLE statements for all schedule tables
   - [ ] Document the schedule hierarchy

3. **Test Reactive vs Predictive**
   - [ ] Verify reactive heats 24/7 correctly
   - [ ] Verify predictive uses setback when closed

### Medium Priority (Improvements)

4. **Chart Improvements**
   - [ ] Add toggle for thermal vs electrical view
   - [ ] Fix 6-hour schedule issue (verify OHC selection)

5. **Debug Panel**
   - [ ] Test arrow navigation across day boundaries
   - [ ] Verify config/schedule display for old runs

6. **User Experience**
   - [ ] Auto-select matching OHC when config selected
   - [ ] Show validation when schedule != expected hours

### Low Priority (Future)

7. **Cost Calculations**
   - [ ] Implement proper cost model
   - [ ] Add cost display back when ready

8. **Export/Reporting**
   - [ ] Export simulation results to CSV/Excel
   - [ ] Generate PDF reports

---

## 5. Files Modified Today

```
lib/EnergySimulator.php      - Control strategy logic, start temp fix
assets/js/modules/simulations.js - Charts, debug panel, progress display
assets/js/modules/simcontrol.js  - User preferences, OHC loading
api/simulation_api.php       - Config snapshot with schedule name
api/heataq_api.php           - User preferences API
index.html                   - UI changes, version bump
docs/database_schema_simulation.sql - user_preferences table
db/migrations/002_user_preferences.sql - New migration
```

---

## 6. Database Migration Checklist

To clean up the database:

```sql
-- 1. Consolidate JSON columns
UPDATE config_templates
SET json_config = config_json
WHERE json_config IS NULL AND config_json IS NOT NULL;

-- 2. Remove legacy column (after verification)
-- ALTER TABLE config_templates DROP COLUMN config_json;

-- 3. Create user_preferences if not exists
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INT NOT NULL,
    pref_key VARCHAR(50) NOT NULL,
    pref_value VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, pref_key)
);

-- 4. Regenerate schema documentation
-- Run: php db/dump_schema.php
```

---

## 7. Summary

**What's Working Well:**
- Simulation engine with reactive/predictive modes
- Thermal output tracking (HP × COP, Boiler × efficiency)
- User preferences syncing across devices
- Debug hour navigation with stored data
- Stacked yearly charts

**What Needs Attention:**
- Database schema cleanup (JSON column consolidation)
- Schedule tables documentation
- Testing of control strategies with real schedules

**Version:** V70
**Last Updated:** 2024-11-27
