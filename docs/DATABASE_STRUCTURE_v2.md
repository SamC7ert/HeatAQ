# HeatAQ Database Structure Documentation
Generated: 2025-11-29 (V104)
Database: heataq_pool-353130302dd2

## Overview
- **Total Tables**: 24
- **Total Records**: 95,053
- **Primary Systems**: Weather (87,545 records), Solar (3,653 records), Scheduling, Authentication

## Database Systems

### 1. AUTHENTICATION SYSTEM

#### users (3 records)
- Primary user management table
- Contains: admin@heataq.local, operator@hisoy.no, viewer@tvedestrand.no
- Fields: user_id, email, password_hash, name, is_active, is_super_admin
- Security fields (V104): force_password_change, password_history (JSON)

#### user_preferences
- User-specific settings (e.g., last_project_id)
- Syncs across devices via server-side storage
- Fields: user_id, pref_key, pref_value

#### projects (1 record)
- Project management for multi-site support
- Current: Arendal Aquatic Center Project
- Links to: pool_sites via site_id

#### user_projects (1 record)
- Maps users to projects with roles
- Roles (V104): operator, admin (simplified from previous 4 roles)

#### user_sessions (1 record)
- Active session management
- Tracks: session_id, user_id, project_id, expires_at

#### audit_log (4 records)
- System activity tracking
- Records: user actions, entity changes, IP addresses

### 2. POOL SITE CONFIGURATION

#### pool_sites (1 record)
- Site: arendal_aquatic
- Core site information: name, latitude, longitude, elevation
- Links to weather station

#### pool_configurations (1 record)
- Physical pool specifications
- Area: 312.5 m² (implied 25×12.5m)
- Volume: 625 m³
- Depth: 2m
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

### 4. THERMAL LOOKUP TABLES

#### ground_thermal_lookup (4 records)
- Year-based ground heat loss
- Q_total_kW values by year

#### tunnel_heat_transfer_lookup (50 records)
- Temperature-dependent heat transfer
- Maps outdoor temp to heat flow (kW)

### 5. SCHEDULE MANAGEMENT

#### schedule_templates (1 record)
- Template: "Hisøy Default v1.0"
- Links to base week schedule
- Site-specific templates

#### day_schedules (10 records)
Types include:
- Normal (standard operating)
- Weekend (reduced temperature)
- Holiday
- Closed
- Various operational variants

#### day_schedule_periods (7 records)
- Time periods within day schedules
- Start/end times
- Target, min, max temperatures

#### week_schedules (3 records)
- Weekly patterns
- Maps each day to a day_schedule
- Site-specific

#### calendar_date_ranges (1 record)
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

#### holiday_definitions (8 records)
Norwegian holidays defined:
- Fixed dates (Christmas, New Year, etc.)
- Easter-relative (Good Friday, Easter Monday, etc.)

#### holiday_reference_days (101 records)
- Pre-calculated holiday dates
- Multiple years of Easter dates
- Country-specific (NO)

#### holiday_dates (0 records)
- Calculated holiday instances (currently empty)

### 7. CONFIGURATION

#### config_templates (1 record)
- System configuration storage
- HP/boiler capacities
- Control strategies
- JSON configuration blobs

## Key Relationships

```
pool_sites (1)
├── weather_stations (1) [via default_weather_station]
├── pool_configurations (1) [via site_id]
├── projects (1) [via site_id]
├── day_schedules (10) [via site_id]
├── week_schedules (3) [via site_id]
└── schedule_templates (1) [via site_id]

weather_stations (1)
└── weather_data (87,545) [via station_id]

schedule_templates (1)
├── calendar_date_ranges (1) [via schedule_template_id]
├── calendar_exception_days (18) [via schedule_template_id]
└── week_schedules (3) [via base_week_schedule_id]

day_schedules (10)
└── day_schedule_periods (7) [via day_schedule_id]

users (3)
├── user_sessions (1) [via user_id]
├── user_projects (1) [via user_id]
├── user_preferences [via user_id]
└── audit_log (4) [via user_id]
```

## Data Volume Summary

| System | Tables | Total Records | Primary Table | Record Count |
|--------|--------|--------------|---------------|--------------|
| Weather | 2 | 87,546 | weather_data | 87,545 |
| Solar | 1 | 3,653 | solar_daily_data | 3,653 |
| Authentication | 5 | 12 | users | 3 |
| Scheduling | 7 | 40 | calendar_exception_days | 18 |
| Site Config | 2 | 2 | pool_sites | 1 |
| Holidays | 3 | 109 | holiday_reference_days | 101 |
| Thermal | 2 | 54 | tunnel_heat_transfer | 50 |

## Critical Notes

### Current State
- Single site configured: Arendal Aquatic Center
- 10 years of weather data (2015-2024)
- Authentication system ready but optional (REQUIRE_AUTH flag)
- Comprehensive Norwegian holiday calendar

### For Simulator Implementation
Key tables needed:
1. weather_data - Environmental inputs
2. pool_configurations - Physical parameters
3. day_schedule_periods - Temperature targets
4. solar_daily_data - Solar gains
5. ground_thermal_lookup - Ground losses
6. tunnel_heat_transfer_lookup - Tunnel effects

### For Multi-Site Expansion
Structure supports multiple sites via:
- site_id foreign keys throughout
- Project-based authentication
- Template system for schedules
- Separate weather stations per site

### Missing/Future Tables
Consider adding:
- equipment_specifications (HP/boiler details)
- simulation_results (store outputs)
- energy_consumption (actual vs simulated)
- maintenance_schedule
- water_quality_parameters
