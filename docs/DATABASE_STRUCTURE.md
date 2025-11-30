# HeatAQ Database Structure Documentation
Generated: 2025-11-30 (V104)
Database: heataq_pool-353130302dd2

## Overview
- **Total Tables**: 26
- **Total Records**: ~905,000
- **Primary Systems**: Simulation (813K+ records), Weather (87,545 records), Solar (3,653 records), Scheduling, Authentication

> **Note**: For full schema details with all columns and indexes, see `db/schema.md` (auto-generated)

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
- Links to: pool_sites via site_id

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
- Site: arendal_aquatic
- Core site information: name, latitude, longitude, elevation
- Links to weather station

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
- Site-specific templates

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
- Site-specific

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
- Fields: run_id, site_id, pool_id, scenario_name, start_date, end_date
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
pool_sites (1)
├── pools (1) [via site_id]
├── pool_configurations (1) [via site_id]
├── projects (1) [via site_id]
├── day_schedules (11) [via site_id]
├── week_schedules (5) [via site_id]
├── schedule_templates (3) [via site_id]
└── weather_stations (1) [via default_weather_station]

weather_stations (1)
└── weather_data (87,545) [via station_id]

schedule_templates (3)
├── calendar_date_ranges (2) [via schedule_template_id]
├── calendar_exception_days (18) [via schedule_template_id]
└── week_schedules [via base_week_schedule_id]

day_schedules (11)
└── day_schedule_periods (6) [via day_schedule_id]

simulation_runs (95)
├── simulation_hourly_results (780,809) [via run_id]
└── simulation_daily_results (32,582) [via run_id]

users (4)
├── user_sessions (4) [via user_id]
├── user_projects (4) [via user_id]
├── user_preferences (3) [via user_id]
└── audit_log (3,316) [via user_id]
```

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
- site_id foreign keys throughout
- Project-based authentication
- Template system for schedules
- Separate weather stations per site

### Future Enhancements
Consider adding:
- equipment_specifications (HP/boiler details)
- energy_consumption (actual vs simulated comparison)
- maintenance_schedule
- water_quality_parameters
