# HeatAQ System Architecture Documentation
Version: 105
Date: December 2024

## System Overview

HeatAQ is a web-based pool energy design and analysis system for outdoor swimming pools in Norway. It combines weather data, thermal modeling, and scheduling to optimize energy consumption.

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface                        │
│                  (HTML/CSS/JavaScript)                   │
├─────────────────────────────────────────────────────────┤
│                     API Layer                            │
│                  (PHP REST API)                          │
├─────────────────────────────────────────────────────────┤
│                  Business Logic                          │
│           (Authentication, Scheduling, Config)           │
├─────────────────────────────────────────────────────────┤
│                   Data Layer                             │
│                  (MySQL Database)                        │
├─────────────────────────────────────────────────────────┤
│                 External Systems                         │
│        (Weather API, NASA POWER, Simulations)           │
└─────────────────────────────────────────────────────────┘
```

## Module Architecture

### 1. Frontend Modules (`/assets/js/modules/`)

#### api.js - API Communication Layer
```javascript
Purpose: Centralized API communication
Functions:
- get(endpoint) - GET requests
- post(endpoint, data) - POST requests  
- handleError(error) - Error handling
- addAuthHeader() - Session management

Interactions:
→ Sends to: /api/heataq_api.php
← Receives: JSON responses
→ Uses: localStorage for session
```

#### navigation.js - UI Navigation
```javascript
Purpose: Section switching and menu management
Functions:
- switchSection(sectionName)
- updateActiveMenu()
- initializeNavigation()

Controls:
- Sidebar menu state
- Content section visibility
- Active tab highlighting
```

#### schedules.js - Schedule Management
```javascript
Purpose: Day/Week schedule CRUD operations
Functions:
- loadDaySchedules()
- saveDaySchedule(data)
- renderScheduleEditor()
- validatePeriods()

Data Flow:
→ API: get_day_schedules
← Renders: Schedule dropdowns & editors
→ API: save_day_schedule
```

#### calendar.js - Calendar & Exceptions
```javascript
Purpose: Calendar rules and holiday management
Functions:
- loadCalendarRules()
- addExceptionDay()
- testResolution(date)
- renderReferenceDays()

Manages:
- Date ranges
- Holiday exceptions
- Easter calculations
- Rule priorities
```

#### config.js - Configuration
```javascript
Purpose: Global settings and constants
Contains:
- API endpoints
- Default values
- System constants
- Feature flags
```

#### app.js - Application Bootstrap
```javascript
Purpose: Initialize and coordinate modules
Functions:
- init() - Start application
- loadUserContext() - Get user/project
- setupEventHandlers()
- saveChanges() - Global save
- checkUserRole() - Verify admin access
- isAdmin() - Check admin/owner role

Coordinates all modules
```

#### admin.js - User & System Administration
```javascript
Purpose: User management and system settings (admin/owner only)
Functions:
- loadUsers() - List all users
- saveUser(data) - Create/update user
- deleteUser(id) - Remove user
- renderUserForm() - User edit dialog

Security:
- Restricted to admin/owner roles
- Uses canDelete() permission check
```

#### simcontrol.js - Simulation Control
```javascript
Purpose: Manage simulation runs
Functions:
- loadSites() - Get project's site
- loadPools() - List pools for site
- runSimulation() - Execute simulator

Data Flow:
→ API: get_project_site (session-based)
→ API: get_pools
→ Simulator execution
```

### 2. Backend Modules (PHP)

#### /api/heataq_api.php - Main API
```php
Purpose: REST API endpoint
Endpoints:
- GET /api/heataq_api.php?action=get_day_schedules
- GET /api/heataq_api.php?action=get_week_schedules
- GET /api/heataq_api.php?action=get_calendar_rules
- POST /api/heataq_api.php (save operations)

Security:
- Optional authentication (REQUIRE_AUTH flag)
- Project-based data filtering
- Input validation
- Prepared statements
```

#### auth.php - Authentication Layer
```php
Purpose: Session and permission management
Functions:
- HeatAQAuth::check() - Verify session
- HeatAQAuth::hasRole() - Check permissions
- HeatAQAuth::audit() - Log actions

Session Sources:
1. PHP $_SESSION
2. Authorization header
3. X-Session-ID header
4. Request parameters
```

#### config.php - Configuration Loader
```php
Purpose: Secure configuration management
Functions:
- Config::get($key) - Get config value
- Config::getDatabase() - PDO connection
- Config::requiresAuth() - Check auth mode

Loads from: /config_heataq/database.env
```

#### login_api.php - Authentication
```php
Purpose: User login, password management, project selection
Flow:
1. Validate credentials
2. Check force_password_change flag
3. If password change required:
   - Validate new password (min 8 chars)
   - Check against password history (last 5)
   - Check for similar passwords
   - Update password and clear flag
4. Return available projects (+ last_project_id)
5. Auto-select if only one project
6. Create session on project selection

Returns: session_id, user_name, project_name, role
Security: force_password_change, password_history (JSON)
```

## Data Flow Patterns

### 1. Login Flow
```
User → login.html → login_api.php → Database
                         ↓
                  Verify Password
                         ↓
              Check force_password_change?
                    ↓ Yes         ↓ No
              Show password    Return Projects
              change form            ↓
                    ↓          Single project?
              Validate &         ↓ Yes      ↓ No
              update password   Auto-select  Show selector
                    ↓               ↓            ↓
                  Return Projects ←──────────────┘
                         ↓
                  Create Session → user_sessions table
                         ↓
                  Save last_project_id → user_preferences
                         ↓
                  localStorage ← session_id
```

### 2. Schedule Loading Flow
```
app.js → schedules.js → api.js → heataq_api.php
                                        ↓
                                  auth.php (check)
                                        ↓
                                  Filter by site_id
                                        ↓
                                  Query Database
                                        ↓
                                  Return JSON
                                        ↓
                        schedules.js renders UI
```

### 3. Save Operation Flow
```
User Action → Validate Client-Side → api.js POST
                                          ↓
                                    heataq_api.php
                                          ↓
                                    Validate Server
                                          ↓
                                    Check Permissions
                                          ↓
                                    Update Database
                                          ↓
                                    Audit Log
                                          ↓
                                    Return Success
```

### 4. Simulation Run Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SIMULATION RUN DATA FLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   USER INTERFACE (simulations.js / simcontrol.js)                          │
│   ├─ Pool dropdown: SimControlModule.currentPoolId                         │
│   ├─ Config dropdown: sim-config-select                                     │
│   ├─ Schedule dropdown: sim-ohc-select                                      │
│   ├─ Dates: sim-start-date, sim-end-date                                   │
│   └─ Run button → startSimulation()                                        │
│                            │                                                │
│                            ▼                                                │
│   API REQUEST (POST /api/simulation_api.php?action=run_simulation)         │
│   {                                                                         │
│     pool_id: number,        ← Required: selects pool from pools table      │
│     config_id: number,      ← Required: selects config from config_templates│
│     template_id: number,    ← Optional: schedule template override         │
│     start_date: string,     ← YYYY-MM-DD                                   │
│     end_date: string,       ← YYYY-MM-DD                                   │
│     scenario_name: string,  ← Display name for run                         │
│     config_override: {      ← Optional overrides                           │
│       equipment: { hp_capacity_kw, boiler_capacity_kw },                   │
│       control: { strategy, target_temp }                                   │
│     }                                                                       │
│   }                                                                         │
│                            │                                                │
│                            ▼                                                │
│   SIMULATION_API.PHP (Backend)                                             │
│   1. Validate pool_id → sendError if missing                               │
│   2. Validate config_id → sendError if missing                             │
│   3. Load from pools table:                                                │
│      ├─ area_m2, volume_m3, depth_m                                        │
│      ├─ wind_exposure, solar_absorption                                    │
│      ├─ has_cover, cover_r_value, cover_solar_transmittance               │
│      └─ has_tunnel                                                         │
│   4. Load from config_templates table:                                     │
│      ├─ json_config (full config object)                                   │
│      ├─ hp_capacity_kw, boiler_capacity_kw                                 │
│      ├─ target_temp, control_strategy                                      │
│      └─ template_name                                                      │
│   5. Apply config_override if provided                                     │
│   6. Initialize: PoolScheduler, EnergySimulator                           │
│                            │                                                │
│                            ▼                                                │
│   ENERGY SIMULATOR (lib/EnergySimulator.php)                               │
│   Constructor receives:                                                     │
│   ├─ $db: PDO database connection                                          │
│   ├─ $poolSiteId: INT pool_site_id (references pool_sites.id)             │
│   └─ $scheduler: PoolScheduler instance                                    │
│                                                                             │
│   setConfigFromUI() receives pool config:                                  │
│   ├─ pool: { area_m2, volume_m3, depth_m, wind_exposure, solar_absorption }│
│   ├─ cover: { has_cover, r_value, solar_transmittance }                   │
│   ├─ solar: { has_tunnel }                                                 │
│   └─ control: { target_temp, strategy }                                    │
│                                                                             │
│   runSimulation(startDate, endDate) returns:                               │
│   {                                                                         │
│     meta: {                                                                 │
│       simulator_version, start_date, end_date, site_id,                    │
│       pool_config, equipment, created_at                                   │
│     },                                                                      │
│     hourly: [ { timestamp, water_temp, hp_output_kw, boiler_output_kw,    │
│                 solar_gain_kw, total_loss_kw, ... } ],                     │
│     daily: [ { date, total_hp_kwh, total_boiler_kwh, avg_water_temp, ... }]│
│     summary: {                                                              │
│       total_hours, open_hours, total_heat_loss_kwh, total_solar_gain_kwh, │
│       hp_thermal_kwh, boiler_thermal_kwh, total_hp_energy_kwh,            │
│       total_boiler_energy_kwh, total_electricity_kwh, total_cost,         │
│       avg_cop, days_below_27, days_below_26                               │
│     }                                                                       │
│   }                                                                         │
│                            │                                                │
│                            ▼                                                │
│   DATA STORAGE (simulation_api.php)                                        │
│   1. simulation_runs table:                                                │
│      ├─ run_id, pool_site_id, pool_id, user_id                            │
│      ├─ scenario_name, description                                         │
│      ├─ start_date, end_date, status                                       │
│      ├─ config_snapshot (JSON of full config used)                        │
│      ├─ summary_json (JSON of summary results)                            │
│      └─ created_at, completed_at                                           │
│   2. simulation_daily_results table:                                       │
│      └─ run_id, date, total_hp_kwh, total_boiler_kwh, ...                 │
│   3. simulation_hourly_results table:                                      │
│      └─ run_id, timestamp, water_temp, hp_heat_kw, ...                    │
│                            │                                                │
│                            ▼                                                │
│   API RESPONSE → simulations.js                                            │
│   {                                                                         │
│     status: "success",                                                      │
│     run_id: number,                                                         │
│     simulator_version: string,                                              │
│     summary: { ... },                                                       │
│     meta: { ... },                                                          │
│     daily_count: number,                                                    │
│     hourly_count: number                                                    │
│   }                                                                         │
│                            │                                                │
│                            ▼                                                │
│   DISPLAY (simcontrol.js)                                                  │
│   showBenchmarkReport(results) renders:                                    │
│   ├─ Period, Pool dimensions, Equipment specs                              │
│   ├─ Target temp, Tolerance, Strategy                                      │
│   ├─ Energy totals (HP, Boiler, Loss, Solar)                              │
│   ├─ Cost summary, COP average                                             │
│   └─ Days below threshold                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Modules Involved in Simulation:

| Module | Location | Role |
|--------|----------|------|
| SimulationsModule | assets/js/modules/simulations.js | UI, triggers runs, displays history |
| SimControlModule | assets/js/modules/simcontrol.js | Pool/Config selection, report display |
| simulation_api.php | api/simulation_api.php | REST endpoint, orchestrates run |
| EnergySimulator | lib/EnergySimulator.php | Core calculation engine |
| PoolScheduler | lib/PoolScheduler.php | Schedule resolution |
| Config | config.php | Database connection |

#### Data Sources for Simulation:

| Data | Table | Key Fields |
|------|-------|------------|
| Pool physical properties | pools | area_m2, volume_m3, depth_m, wind_exposure |
| Pool cover settings | pools | has_cover, cover_r_value, cover_solar_transmittance |
| Equipment config | config_templates | hp_capacity_kw, boiler_capacity_kw, target_temp |
| Weather data | weather_data | temperature, humidity, wind_speed |
| Solar radiation | site_solar_hourly | pool_site_id, timestamp, solar_wh_m2 |
| Schedule periods | day_schedule_periods | start_time, end_time, target_temp |

## Database Relationships

### Core Relationships
```
pool_sites
    ↓ [site_id]
    ├── projects → user_projects → users
    ├── day_schedules → day_schedule_periods
    ├── week_schedules → (links to day_schedules)
    ├── schedule_templates → calendar_rules
    └── weather_stations → weather_data

schedule_templates
    ↓ [template_id]
    ├── calendar_date_ranges → week_schedules
    └── calendar_exception_days → day_schedules

users (security columns - V104)
    ├── force_password_change  TINYINT(1) - requires password change on login
    └── password_history       JSON - array of previous password hashes

user_preferences
    ├── user_id
    ├── pref_key (e.g., 'last_project_id')
    └── pref_value
```

## Security Architecture

### 1. Authentication Layers
```
Level 1: Session Check (auth.php)
Level 2: Role Verification (viewer/operator/admin/owner)
Level 3: Project Filtering (site_id based)
Level 4: Audit Logging (all modifications)

Role Permissions:
- viewer: Read-only access
- operator: Edit schedules/calendars (canEdit)
- admin: User management, system settings (canDelete)
- owner: Full access including delete
```

### 2. Data Protection
```
- Credentials: /config_heataq/database.env (outside web root)
- Sessions: Expire after 8 hours
- Passwords: bcrypt hashed
- SQL: Prepared statements only
- API: Input validation
```

### 3. Password Security (V104)
```
- Force password change on first login
- Password history (last 5 passwords cannot be reused)
- Similar password detection (blocks trivial modifications)
- Minimum 8 character requirement
- Admin sets initial password, user must change
```

## Simulator Integration Points

### Input Sources
```
Weather Data:
- Table: weather_data
- Fields: temperature, wind_speed, humidity
- Frequency: Hourly

Solar Data:
- Table: solar_daily_data  
- Fields: daily_total_kwh_m2
- Frequency: Daily

Schedules:
- Tables: day_schedule_periods
- Fields: start_time, end_time, target_temp
- Resolution: Multiple periods per day

Pool Configuration:
- Table: pool_configurations
- Fields: area_m2, volume_m3, depth_m
```

### Output Targets
```
Future Tables Needed:
- simulation_runs (metadata)
- simulation_results (hourly outputs)
- energy_statistics (aggregated)
- comparison_reports (scenarios)
```

## File Structure

```
/home/sites/35a/a/a6072c6cd5/
├── config_heataq/
│   └── database.env          # Secure credentials
│
└── public_html/
    └── heataq/
        ├── index.html        # Main application
        ├── login.html        # Authentication
        ├── config.php        # Configuration loader
        ├── auth.php          # Auth checker
        ├── login_api.php     # Login handler
        │
        ├── api/
        │   └── heataq_api.php    # Main API
        │
        ├── assets/
        │   ├── css/
        │   │   ├── main.css
        │   │   ├── bootstrap-utilities.css
        │   │   └── components/
        │   │       ├── sidebar.css
        │   │       ├── schedules.css
        │   │       └── calendar.css
        │   │
        │   └── js/
        │       ├── config.js     # Global config
        │       ├── app.js        # Bootstrap
        │       └── modules/
        │           ├── api.js
        │           ├── navigation.js
        │           ├── schedules.js
        │           └── calendar.js
        │
        └── _setup/              # Setup/test files
            └── (various test scripts)
```

## Configuration Flags

### database.env Settings
```ini
REQUIRE_AUTH=true        # Enforce login
APP_DEBUG=false         # Production mode
SESSION_LIFETIME=28800  # 8 hours
```

### JavaScript Feature Flags (config.js)
```javascript
enableSimulation: false  // Not yet implemented
enableReports: false    // Not yet implemented
debugMode: false        // Console logging
```

## Error Handling Chain

```
JavaScript try/catch
    ↓
api.js handleError()
    ↓
User notification (UI)
    ↓
Console logging
    
PHP try/catch
    ↓
Error response JSON
    ↓
Error logging (server)
    ↓
Generic message (production)
```

## Next Phase: Simulator Module

### Proposed Architecture
```
simulator.js (frontend)
    ↓
/api/simulator_api.php
    ↓
/simulator/pool_energy_v3.5.py
    ↓
Database (input/output)
```

### Required Connections
1. Read weather data for date range
2. Read schedule for simulation period
3. Get pool configuration
4. Execute Python simulator
5. Store results in database
6. Return summary to frontend
7. Generate reports/graphs

## Development Guidelines

### Adding New Features
1. Create module in `/assets/js/modules/`
2. Add API endpoint in `heataq_api.php`
3. Update `app.js` initialization
4. Add database tables if needed
5. Update authentication rules
6. Document in this file

### Security Checklist
- [ ] Use prepared statements
- [ ] Validate all inputs
- [ ] Check user permissions
- [ ] Audit log modifications
- [ ] Sanitize outputs
- [ ] Test SQL injection
- [ ] Verify CSRF protection

## System Limitations

Current:
- Single weather station per site
- No real-time data integration
- Manual schedule updates only
- No automated reports

Planned:
- Multiple weather sources
- Real-time monitoring integration
- API for external systems
- Automated daily reports
- Mobile application

## Contact & Support

System: HeatAQ Pool Energy Design
Version: 104
Company: Aquarious AS, Norway
Database: heataq_pool-353130302dd2
Hosting: StackCP (sdb-86.hosting.stackcp.net)
