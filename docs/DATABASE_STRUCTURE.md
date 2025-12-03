# HeatAQ Database Structure Documentation
Generated: 2025-12-03 (V132)
Database: heataq_pool-353130302dd2

## Overview
- **Total Tables**: 26
- **Total Records**: ~905,000
- **Primary Systems**: Simulation (813K+ records), Weather (87,545 records), Solar (3,653 records), Scheduling, Authentication

> **Note**: For full schema details with all columns and indexes, see `db/schema.md` (auto-generated)

## Schedule Access Control Model (V131)

All schedule tables connect **ONLY through project_id**. This provides clean access control:
- Anyone with project access can access all schedules for that project
- Anyone without project access cannot see any schedules

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACCESS CONTROL BOUNDARY                              │
│                                                                             │
│    users ───► user_projects ───► projects                                   │
│                                      │                                      │
│                                      │ project_id (INT FK)                  │
│                                      ▼                                      │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │                    SCHEDULE TABLES                               │     │
│    │                                                                  │     │
│    │   schedule_templates ◄──────────────────────────────────────────│     │
│    │         │                                                        │     │
│    │         │ base_week_schedule_id                                  │     │
│    │         ▼                                                        │     │
│    │   week_schedules ◄───────── project_id                          │     │
│    │         │                                                        │     │
│    │         │ day_schedule_id (mon-sun)                              │     │
│    │         ▼                                                        │     │
│    │   day_schedules ◄────────── project_id                          │     │
│    │         │                                                        │     │
│    │         │ day_schedule_id                                        │     │
│    │         ▼                                                        │     │
│    │   day_schedule_periods                                           │     │
│    │                                                                  │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │                    CALENDAR TABLES                               │     │
│    │                  (connect via schedule_template_id)              │     │
│    │                                                                  │     │
│    │   calendar_date_ranges ────► schedule_template_id ────► project │     │
│    │   calendar_exception_days ─► schedule_template_id ────► project │     │
│    │   calendar_rules ──────────► template_id ─────────────► project │     │
│    │                                                                  │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- `day_schedules` → `project_id` (direct)
- `week_schedules` → `project_id` (direct)
- `schedule_templates` → `project_id` (direct)
- Calendar tables → `schedule_template_id` → `project_id` (indirect via schedule_templates)

**Removed in V131-V132 (Migrations 026-027):**
- `day_schedules.site_id` VARCHAR - removed (Migration 026)
- `week_schedules.site_id` VARCHAR - removed (Migration 026)
- `week_schedules.pool_site_id` INT - removed (Migration 026, redundant with project_id)
- `pool_sites.site_id` VARCHAR - removed (Migration 027)

**Current Identifiers (V132+):**
- `pool_sites.id` INT - primary key (use pool_site_id as FK in other tables)
- `project_id` INT - used in all schedule tables for access control

## Database Systems

### 1. AUTHENTICATION SYSTEM

#### users (4 records)
- Primary user management table
- Fields: user_id, email, password_hash, name, is_active, is_super_admin
- Security fields (V104): force_password_change, password_history (JSON)

#### user_preferences (3 records)
- User-specific settings (e.g., last_project_id)
- Syncs across devices via server-side storage
- Fields: user_id, pref_key, pref_value

#### projects (1 record)
- Project management for multi-site support
- Current: Arendal Aquatic Center Project
- Links to: pool_sites via project_id (INT FK)

#### user_projects (4 records)
- Maps users to projects with roles
- Roles: viewer, operator, admin, owner

#### user_sessions (4 records)
- Active session management
- Tracks: session_id, user_id, project_id, expires_at

#### audit_log (3,316 records)
- System activity tracking
- Records: user actions, entity changes, IP addresses

### 2. POOL SITE CONFIGURATION

#### pool_sites (1 record)
- Primary key: id (INT auto-increment)
- Core site information: name, latitude, longitude, elevation
- Links to weather station via weather_station_id
- Links to project via project_id (INT FK)

#### pools (1 record)
- Physical pool specifications with detailed properties
- Dimensions: 25m × 12.5m × 2m (312.5 m², 625 m³)
- Properties: wind_exposure, solar_absorption, years_operating
- Features: has_cover, cover_r_value, has_tunnel, floor_insulated
- Pool type: outdoor/indoor/semi-enclosed

#### pool_configurations (1 record)
- Legacy pool specifications (being replaced by pools table)
- Area: 312.5 m², Volume: 625 m³, Depth: 2m
- Features: cover, tunnel options

### 3. WEATHER SYSTEM

#### weather_stations (1 record)
- Station: Landvik (SN37230/SN38140)
- Location data and measurement heights
- Active period tracking

#### weather_data (87,545 records)
- Hourly measurements 2015-2024
- Temperature, wind speed/direction, humidity
- Tunnel temperature included

#### solar_daily_data (3,653 records)
- Daily solar irradiance (10 years)
- Includes: total kWh/m², clear sky values
- Cloud reduction factors

#### site_solar_daily (0 records)
- Site-specific daily solar data from NASA POWER
- Fields: site_id, date, daily_kwh_m2, clear_sky_kwh_m2, cloud_factor

#### site_solar_hourly (0 records)
- Calculated hourly solar distribution
- Fields: site_id, timestamp, solar_wh_m2, clear_sky_wh_m2

### 4. THERMAL LOOKUP TABLES

#### ground_thermal_lookup (4 records)
- Year-based ground heat loss
- Q_total_kW values by year

#### tunnel_heat_transfer_lookup (50 records)
- Temperature-dependent heat transfer
- Maps outdoor temp to heat flow (kW)

### 5. SCHEDULE MANAGEMENT

#### schedule_templates (3 records)
- Links to base week schedule
- Project-specific templates (via project_id)

#### day_schedules (11 records)
Types include:
- Normal (standard operating)
- Weekend (reduced temperature)
- Holiday
- Closed
- Various operational variants

#### day_schedule_periods (6 records)
- Time periods within day schedules
- Start/end times
- Target, min, max temperatures

#### week_schedules (5 records)
- Weekly patterns
- Maps each day to a day_schedule
- Project-specific (via project_id)

#### calendar_date_ranges (2 records)
- Date range rules with priorities
- Links to week schedules
- Active flag for enable/disable

#### calendar_exception_days (18 records)
- Holiday and special day overrides
- Fixed dates and moving holidays (Easter-based)
- Priority system for precedence

#### calendar_rules (11 records)
- Rule engine for schedule selection
- Types: base, date_range, holiday, specific_date
- Priority-based resolution

### 6. HOLIDAYS & REFERENCES

#### holiday_definitions (21 records)
Norwegian holidays defined:
- Fixed dates (Christmas, New Year, etc.)
- Easter-relative (Good Friday, Easter Monday, etc.)

#### holiday_reference_days (101 records)
- Pre-calculated holiday dates
- Multiple years of Easter dates
- Country-specific (NO)

#### holiday_dates (0 records)
- Calculated holiday instances (currently empty)

### 7. SIMULATION SYSTEM

#### simulation_runs (95 records)
- Simulation execution metadata
- Fields: run_id, pool_site_id, pool_id, scenario_name, start_date, end_date
- Status: pending, running, completed, failed
- Stores config_snapshot (JSON) and summary_json

#### simulation_hourly_results (780,809 records)
- Detailed hourly simulation outputs
- Weather: air_temp, wind_speed, humidity, solar_kwh_m2
- Pool state: water_temp, target_temp, is_open
- Energy: total_loss_kw, solar_gain_kw, hp_heat_kw, boiler_heat_kw
- Costs: hp_electricity_kwh, boiler_fuel_kwh, hp_cop, cost

#### simulation_daily_results (32,582 records)
- Aggregated daily simulation summaries
- Fields: date, hours_count, open_hours, avg temps
- Totals: loss_kwh, solar_kwh, hp_kwh, boiler_kwh, cost

### 8. CONFIGURATION

#### config_templates (3 records)
- System configuration storage
- HP/boiler capacities
- Control strategies
- JSON configuration blobs

## Key Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ACCESS CONTROL HIERARCHY                                                 │
│                                                                         │
│   users ──► user_projects ──► projects                                  │
│                                    │                                    │
│                                    ├──► schedule_templates ──┐          │
│                                    │         │               │          │
│                                    │    base_week_schedule_id│          │
│                                    │         ▼               │          │
│                                    ├──► week_schedules       │          │
│                                    │                         │          │
│                                    └──► day_schedules        │          │
│                                              │               │          │
│                                    day_schedule_periods      │          │
│                                                              │          │
│   Calendar tables connect via schedule_template_id: ◄────────┘          │
│   • calendar_date_ranges                                                │
│   • calendar_exception_days                                             │
│   • calendar_rules                                                      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ SITE & POOL HIERARCHY                                                    │
│                                                                         │
│   projects ──► pool_sites (id) ──► pools (pool_site_id FK)              │
│                    │                                                    │
│                    └──► simulation_runs (pool_site_id FK)               │
│                              │                                          │
│                              ├──► simulation_hourly_results (run_id)    │
│                              └──► simulation_daily_results (run_id)     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ WEATHER DATA                                                             │
│                                                                         │
│   weather_stations ──► weather_data (87,545 records)                    │
│   pool_sites.default_weather_station ──► weather_stations               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Detailed Relationships

| Parent Table | Child Table | Foreign Key | Notes |
|--------------|-------------|-------------|-------|
| projects | schedule_templates | project_id | Direct |
| projects | day_schedules | project_id | Direct |
| projects | week_schedules | project_id | Direct |
| schedule_templates | calendar_date_ranges | schedule_template_id | Indirect access |
| schedule_templates | calendar_exception_days | schedule_template_id | Indirect access |
| schedule_templates | calendar_rules | template_id | Indirect access |
| schedule_templates | week_schedules | base_week_schedule_id | Links template to base week |
| week_schedules | day_schedules | mon-sun_schedule_id | 7 FKs for each day |
| day_schedules | day_schedule_periods | day_schedule_id | Time periods within day |
| pool_sites | pools | pool_site_id | Physical pool data |
| pool_sites | simulation_runs | pool_site_id | Simulation history |
| simulation_runs | simulation_hourly_results | run_id | Detailed results |
| simulation_runs | simulation_daily_results | run_id | Aggregated results |
| weather_stations | weather_data | station_id | Weather history |
| users | user_projects | user_id | Project membership |
| projects | user_projects | project_id | Project membership |

## Data Volume Summary

| System | Tables | Total Records | Primary Table | Record Count |
|--------|--------|--------------|---------------|--------------|
| Simulation | 3 | 813,486 | simulation_hourly_results | 780,809 |
| Weather | 2 | 87,546 | weather_data | 87,545 |
| Authentication | 6 | 3,331 | audit_log | 3,316 |
| Solar | 3 | 3,653 | solar_daily_data | 3,653 |
| Scheduling | 7 | 55 | calendar_exception_days | 18 |
| Holidays | 3 | 122 | holiday_reference_days | 101 |
| Site Config | 3 | 3 | pools | 1 |
| Thermal | 2 | 54 | tunnel_heat_transfer | 50 |
| Configuration | 1 | 3 | config_templates | 3 |

## Critical Notes

### Current State
- Single site configured: Arendal Aquatic Center
- 10 years of weather data (2015-2024)
- **95 simulation runs completed** with 813K+ result records
- Authentication system ready but optional (REQUIRE_AUTH flag)
- Comprehensive Norwegian holiday calendar (21 definitions)

### Simulator Data Flow
Input tables:
1. weather_data - Environmental inputs (87K records)
2. pools - Physical parameters
3. day_schedule_periods - Temperature targets
4. solar_daily_data - Solar gains (3.6K records)
5. ground_thermal_lookup - Ground losses
6. tunnel_heat_transfer_lookup - Tunnel effects

Output tables:
1. simulation_runs - Run metadata and config snapshots
2. simulation_hourly_results - Detailed outputs (780K records)
3. simulation_daily_results - Aggregated summaries (32K records)

### For Multi-Site Expansion
Structure supports multiple sites via:
- Project-based access control (users → user_projects → projects)
- Schedule tables use project_id (INT FK) - no VARCHAR site_id
- Pool sites linked to projects (projects → pool_sites → pools)
- Template system for schedules within each project
- Separate weather stations per site

### Future Enhancements
Consider adding:
- equipment_specifications (HP/boiler details)
- energy_consumption (actual vs simulated comparison)
- maintenance_schedule
- water_quality_parameters

---

## Simulation Storage Strategy

### Data Volume Per Run (10 years)
| Data Type | Rows | Est. Size |
|-----------|------|-----------|
| Hourly Results | ~87,672 | 7-10 MB |
| Daily Results | ~3,653 | 100 KB |
| Run Metadata | 1 | 2 KB |
| **Total per run** | ~91,326 | **~10 MB** |

### Current Strategy: Full Storage
All hourly data stored in database for complete analysis access.

### Retention Recommendations
- **Recent runs (1-6)**: Full hourly + daily + summary
- **Older runs (7-50)**: Consider monthly summaries only
- **Very old (51+)**: Archive or delete based on policy

### API Patterns
- Pagination: `?action=get_results&run_id=123&limit=1000&offset=0`
- Date filtering: `?action=get_results&run_id=123&date=2024-06-15`
- Aggregation: `?action=get_daily_results&run_id=123`
