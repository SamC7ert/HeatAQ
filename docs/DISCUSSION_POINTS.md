# HeatAQ Development Discussion Points

## 1. Data Retention Strategy

**Your Proposal:**
- Keep **full hourly data** for last **6 runs per user/project**
- Keep **monthly summaries** for last **50 runs**
- Delete older data automatically

**Implementation Plan:**
```
┌─────────────────────────────────────────────────────────┐
│  Run #1-6:    Full hourly + daily + monthly + summary   │
│  Run #7-50:   Monthly summaries + run summary only      │
│  Run #51+:    Auto-deleted (or archive option)          │
└─────────────────────────────────────────────────────────┘
```

**Database Changes Needed:**
- Add `simulation_monthly_results` table
- Add retention cleanup job (cron or on-demand)
- Add `retention_tier` column to `simulation_runs` (full/summary/archived)

**Questions:**
- Should users be able to "pin" runs to prevent auto-deletion?
- Archive to CSV before deletion, or just delete?


---

## 2. Simulation Frequency

**Your Input:** Development phase, variable bursts when researching.

**Implications:**
- No need for queuing system (yet)
- Keep simple synchronous execution
- Consider "quick preview" mode (1 year instead of 10) for rapid iteration
- Add progress indicator for long runs

**Future Consideration:**
- If production use increases, add background job processing
- Rate limiting per user (e.g., max 5 concurrent runs)


---

## 3. User Management System

**Requirements:**
| Feature | Description |
|---------|-------------|
| User Types | **Admin** (full access) / **User** (project-scoped) |
| Username | Email address |
| Password | Hashed + salted (bcrypt/Argon2) |
| Password Reset | Email link (time-limited token) |
| Admin Menu | Only visible to admin users |

**Proposed Database Schema:**
```sql
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME NULL
);

CREATE TABLE user_projects (
    user_id INT NOT NULL,
    project_id VARCHAR(50) NOT NULL,
    access_level ENUM('read', 'write', 'admin') DEFAULT 'write',
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE password_reset_tokens (
    token_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used BOOLEAN DEFAULT FALSE
);
```

**UI Changes:**
- Add "User Management" menu item (admin-only, hidden for regular users)
- User list with add/edit/deactivate
- Project assignment interface
- Password reset trigger button

**Password Reset Flow:**
1. Admin clicks "Send Reset Link" for user
2. System generates token, stores hash, emails link
3. User clicks link → enters new password
4. Token marked as used


---

## 4. Exception Days Management

**Current State:** Exception days defined inline in schedule management.

**Your Proposal:**
- **Admin-only** exception day definition (separate menu)
- Schedule management only **connects** day schedules to pre-defined exception days
- Add **"Default" exception days** = calendar-based, lower priority, can't be deleted

**Proposed Structure:**
```
┌─────────────────────────────────────────────────────────┐
│  ADMIN MENU: "Exception Day Definitions"                │
│  ├── Easter Sunday (calculated)                         │
│  ├── Easter Monday (Easter +1)                          │
│  ├── Christmas Day (Dec 25)                             │
│  ├── New Year's Day (Jan 1)                             │
│  └── [Add Custom...]                                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  PROJECT SCHEDULE: "Exception Day Assignments"          │
│  ├── Easter Sunday → "Holiday Schedule" (default)       │
│  ├── Easter Monday → "Holiday Schedule" (default)       │
│  ├── Christmas Day → "Closed Day" (custom override)     │
│  └── [Assign Schedule to Exception Day...]              │
└─────────────────────────────────────────────────────────┘
```

**Database Changes:**
```sql
CREATE TABLE exception_day_definitions (
    definition_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    calculation_type ENUM('fixed', 'easter_relative', 'custom') NOT NULL,
    month TINYINT NULL,           -- For fixed dates
    day TINYINT NULL,             -- For fixed dates
    easter_offset INT NULL,       -- Days from Easter Sunday
    is_system BOOLEAN DEFAULT FALSE,  -- TRUE = can't delete
    created_by INT NULL
);

-- Project-level assignments
CREATE TABLE exception_day_assignments (
    assignment_id INT AUTO_INCREMENT PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    definition_id INT NOT NULL,
    day_schedule_id INT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,  -- TRUE = from calendar, lower priority
    priority INT DEFAULT 0
);
```

**Priority Logic:**
1. Custom project assignment (highest)
2. Default calendar-based (lower)
3. Week schedule fallback (lowest)


---

## 5. Application Structure

**Your Vision:**
```
┌─────────────────────────────────────────────────────────┐
│  PROJECT (top-level)                                    │
│  ├── Project Settings                                   │
│  │   ├── Site Configuration (location, pool specs)      │
│  │   ├── Equipment Defaults (HP, boiler, costs)         │
│  │   └── Weather Station Assignment                     │
│  │                                                      │
│  ├── Schedule Management                                │
│  │   ├── Day Schedules                                  │
│  │   ├── Week Schedules                                 │
│  │   └── Calendar Rules (date ranges, exceptions)       │
│  │                                                      │
│  └── Simulation Defaults                                │
│      ├── Default date range                             │
│      ├── Default equipment settings                     │
│      └── Default output format                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  SIMULATIONS                                            │
│  ├── New Simulation Order                               │
│  │   ├── Use project defaults OR override               │
│  │   ├── Sensitivity analysis parameters                │
│  │   └── Batch run configuration                        │
│  │                                                      │
│  ├── Simulation Runs (list)                             │
│  │   └── View results, export, delete                   │
│  │                                                      │
│  └── Run Comparison                                     │
│      ├── Select 2+ runs to compare                      │
│      ├── Side-by-side output table                      │
│      └── Difference highlighting                        │
└─────────────────────────────────────────────────────────┘
```

**Menu Structure:**
```
┌─────────────────────┐
│ 📁 Project          │  ← Project selector dropdown
├─────────────────────┤
│ 📊 Dashboard        │
│ 📅 Schedules        │
│ ⚙️ Configuration    │
│ 🔬 Simulations      │
│ 📈 Comparison       │
│ 📋 Reports          │
├─────────────────────┤
│ 👤 User Mgmt (admin)│
│ 📆 Exception Defs   │  ← Admin only
└─────────────────────┘
```


---

## 6. Standard Output Format

**Your Reference Output:**
```
                           v3.6.0.2      v3.6.0.3      Difference    Status
--------------------------------------------------------------------------------
THERMAL LOSSES (MWh/year):
Evaporation                 364.1         364.1           0.0         ✓
Convection                  147.4         147.4           0.0         ✓
Radiation                   166.2         166.2           0.0         ✓
Floor losses                  4.3           4.3           0.0         ✓
Wall losses                  11.8          11.8           0.0         ✓
Solar gain                 -144.2        -144.2           0.0         ✓
--------------------------------------------------------------------------------
Total system loss           891.0         891.0           0.0         ✓
Pool water heating           30.4          30.4           0.0         ✓
Total system need           925.0         925.0           0.0         ✓

HEATING DELIVERED (MWh/year):
Heat pump thermal           596.4         596.4           0.0         ✓
Boiler thermal              182.6         182.6           0.0         ✓
Total delivered             779.1         779.1           0.0         ✓
Unmet need                   28.2          28.2           0.0         ✓

ELECTRICITY (MWh/year):
HP electricity              129.7         129.7           0.0         ✓
Boiler electricity          182.6         182.6           0.0         ✓
Pool system total           312.3         312.3           0.0         ✓
Shower heating               89.1          89.1           0.0         ✓
Total electricity           401.4         401.4           0.0         ✓

TEMPERATURE (°C):
Minimum                     26.25         26.25           0.00        ✓
Average                     28.92         28.92           0.00        ✓
Maximum                     30.00         30.00           0.00        ✓
Days < 27°C                     2             2              0        ✓
Days < 26°C                     0             0              0        ✓
```

**Implementation Notes:**

1. **Current gaps in EnergySimulator.php:**
   - Missing: Floor losses vs Wall losses separation (currently combined as "conduction")
   - Missing: Pool water heating (fresh water makeup)
   - Missing: Unmet need tracking
   - Missing: Shower heating
   - Missing: Days below temperature threshold counts

2. **Needed additions:**
   ```php
   // Add to summary:
   'floor_loss_mwh' => ...,
   'wall_loss_mwh' => ...,
   'pool_water_heating_mwh' => ...,
   'unmet_need_mwh' => ...,
   'shower_heating_mwh' => ...,
   'min_temp' => ...,
   'max_temp' => ...,
   'days_below_27' => ...,
   'days_below_26' => ...
   ```

3. **Comparison UI:**
   - Select multiple runs from dropdown
   - Generate comparison table
   - Color-code differences (green = improved, red = worse, gray = same)
   - Export comparison as CSV/PDF


---

## 7. Benchmark Against v3.6.0.3

**Action Items:**
1. You provide CSV files from Python v3.6.0.3 runs
2. I import as reference data
3. Run PHP simulator with same inputs
4. Compare outputs row by row
5. Identify and fix any discrepancies

**Benchmark Test Cases Needed:**
- Full 10-year run (2014-2023)
- Single cold week (worst case)
- Single hot week (best case for solar)
- Shoulder season week


---

## 8. Interactive Web Features (vs Python)

**Advantages of web version:**
| Feature | Python CLI | Web Version |
|---------|-----------|-------------|
| Real-time progress | ❌ | ✓ Live updates |
| Interactive charts | ❌ | ✓ Zoom, hover, filter |
| Parameter sliders | ❌ | ✓ Instant re-run |
| Comparison overlay | ❌ | ✓ Multiple runs on same chart |
| Mobile access | ❌ | ✓ Any device |
| Shareable results | ❌ | ✓ URL links |

**Chart Ideas:**
- Temperature over time (line chart, zoomable)
- Energy balance Sankey diagram
- Monthly heatmap (loss vs gain)
- COP vs outdoor temp scatter plot
- Cost breakdown pie chart


---

## Next Steps Priority

1. **Immediate:** Benchmark PHP against Python v3.6.0.3
2. **Short-term:** Add missing output metrics (floor/wall separation, unmet need, etc.)
3. **Medium-term:** User management system
4. **Medium-term:** Exception day admin interface
5. **Longer-term:** Full comparison UI with interactive charts

---

## Questions for Discussion

1. For the 6-run retention: per user, per project, or per user-project combo?
2. Shower heating - is this pool-related or separate building system?
3. "Unmet need" - what triggers this? HP at capacity + boiler at capacity?
4. Do you want email notifications when simulations complete?
5. Multi-language support needed (Norwegian/English)?
