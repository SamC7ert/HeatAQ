# Database Schema

Generated: 2025-12-01 16:10:06

Database: heataq_pool-353130302dd2

## audit_log

Rows: 5695

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| log_id | int(11) | NO | PRI | NULL | auto_increment |
| user_id | int(11) | YES | MUL | NULL |  |
| project_id | int(11) | YES | MUL | NULL |  |
| action | varchar(50) | NO |  | NULL |  |
| entity_type | varchar(50) | YES | MUL | NULL |  |
| entity_id | int(11) | YES |  | NULL |  |
| old_values | longtext | YES |  | NULL |  |
| new_values | longtext | YES |  | NULL |  |
| ip_address | varchar(45) | YES |  | NULL |  |
| created_at | timestamp | YES | MUL | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (log_id)
- `idx_user` (user_id)
- `idx_project` (project_id)
- `idx_created` (created_at)
- `idx_entity` (entity_type, entity_id)

## calendar_date_ranges

Rows: 2

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| id | int(11) | NO | PRI | NULL | auto_increment |
| schedule_template_id | int(11) | YES | MUL | NULL |  |
| priority | int(11) | NO | MUL | 10 |  |
| name | varchar(100) | NO |  | NULL |  |
| description | text | YES |  | NULL |  |
| start_date | date | NO | MUL | NULL |  |
| end_date | date | NO |  | NULL |  |
| week_schedule_id | int(11) | NO | MUL | NULL |  |
| is_active | tinyint(1) | YES |  | 1 |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| updated_at | timestamp | YES |  | current_timestamp() | on update current_timestamp() |

**Indexes:**
- UNIQUE `PRIMARY` (id)
- `idx_priority` (priority)
- `idx_dates` (start_date, end_date)
- `schedule_template_id` (schedule_template_id)
- `week_schedule_id` (week_schedule_id)

## calendar_exception_days

Rows: 18

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| id | int(11) | NO | PRI | NULL | auto_increment |
| schedule_template_id | int(11) | YES | MUL | NULL |  |
| priority | int(11) | NO | MUL | 80 |  |
| name | varchar(100) | NO |  | NULL |  |
| description | text | YES |  | NULL |  |
| fixed_date | date | YES | MUL | NULL |  |
| fixed_month | tinyint(4) | YES | MUL | NULL |  |
| fixed_day | tinyint(4) | YES |  | NULL |  |
| is_moving | tinyint(1) | YES |  | 0 |  |
| easter_offset_days | int(11) | YES |  | NULL |  |
| day_schedule_id | int(11) | NO | MUL | NULL |  |
| is_active | tinyint(1) | YES |  | 1 |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| updated_at | timestamp | YES |  | current_timestamp() | on update current_timestamp() |

**Indexes:**
- UNIQUE `PRIMARY` (id)
- `idx_priority` (priority)
- `idx_fixed_date` (fixed_date)
- `idx_fixed_monthday` (fixed_month, fixed_day)
- `schedule_template_id` (schedule_template_id)
- `day_schedule_id` (day_schedule_id)

## calendar_rules

Rows: 11

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| rule_id | int(11) | NO | PRI | NULL | auto_increment |
| template_id | int(11) | NO | MUL | NULL |  |
| priority | int(11) | NO |  | NULL |  |
| rule_name | varchar(100) | NO |  | NULL |  |
| rule_type | enum('base','date_range','holiday','specific_date') | NO |  | NULL |  |
| start_date | varchar(5) | YES |  | NULL |  |
| end_date | varchar(5) | YES |  | NULL |  |
| specific_date | date | YES |  | NULL |  |
| holiday_code | varchar(50) | YES | MUL | NULL |  |
| week_schedule_id | int(11) | NO | MUL | NULL |  |
| enabled | tinyint(1) | YES |  | 1 |  |

**Indexes:**
- UNIQUE `PRIMARY` (rule_id)
- UNIQUE `unique_priority` (template_id, priority)
- `week_schedule_id` (week_schedule_id)
- `holiday_code` (holiday_code)

## config_templates

Rows: 3

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| template_id | int(11) | NO | PRI | NULL | auto_increment |
| pool_site_id | int(11) | YES |  | NULL |  |
| template_name | varchar(100) | NO | MUL | NULL |  |
| template_version | varchar(20) | YES |  | v1.0 |  |
| project_id | int(11) | YES |  | NULL |  |
| pool_id | int(11) | YES | MUL | NULL |  |
| hp_capacity_kw | decimal(6,2) | YES |  | NULL |  |
| boiler_capacity_kw | decimal(6,2) | YES |  | NULL |  |
| target_temp | decimal(3,1) | YES |  | NULL |  |
| control_strategy | varchar(50) | YES |  | NULL |  |
| json_config | longtext | NO |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| created_by | varchar(100) | YES |  | NULL |  |
| config_json | longtext | YES |  | NULL |  |
| updated_at | timestamp | YES |  | NULL |  |
| updated_by | varchar(100) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (template_id)
- UNIQUE `unique_name_version` (template_name, template_version)
- `idx_config_pool` (pool_id)

## day_schedule_periods

Rows: 6

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| period_id | int(11) | NO | PRI | NULL | auto_increment |
| day_schedule_id | int(11) | NO | MUL | NULL |  |
| period_order | int(11) | NO |  | NULL |  |
| start_time | time | NO |  | NULL |  |
| end_time | time | NO |  | NULL |  |
| target_temp | decimal(3,1) | YES |  | NULL |  |
| min_temp | decimal(3,1) | YES |  | NULL |  |
| max_temp | decimal(3,1) | YES |  | NULL |  |
| notes | varchar(255) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (period_id)
- UNIQUE `unique_schedule_order` (day_schedule_id, period_order)

## day_schedules

Rows: 11

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| day_schedule_id | int(11) | NO | PRI | NULL | auto_increment |
| pool_site_id | int(11) | YES |  | NULL |  |
| name | varchar(100) | NO | MUL | NULL |  |
| site_id | varchar(50) | YES | MUL | NULL |  |
| description | text | YES |  | NULL |  |
| is_operating | tinyint(1) | YES |  | 1 |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| is_closed | tinyint(1) | YES |  | 0 |  |

**Indexes:**
- UNIQUE `PRIMARY` (day_schedule_id)
- UNIQUE `unique_name_site` (name, site_id)
- `site_id` (site_id)

## ground_thermal_lookup

Rows: 4

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| year | int(11) | NO | PRI | NULL |  |
| Q_total_kW | decimal(8,2) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (year)

## holiday_dates

Rows: 0

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| year | int(11) | NO | PRI | NULL |  |
| holiday_code | varchar(50) | NO | PRI | NULL |  |
| actual_date | date | NO |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (year, holiday_code)
- `holiday_code` (holiday_code)

## holiday_definitions

Rows: 21

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| holiday_code | varchar(50) | NO | PRI | NULL |  |
| holiday_name_no | varchar(100) | NO |  | NULL |  |
| holiday_name_en | varchar(100) | YES |  | NULL |  |
| calculation_type | enum('fixed','easter_relative') | NO |  | NULL |  |
| fixed_date | varchar(5) | YES |  | NULL |  |
| easter_offset | int(11) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (holiday_code)

## holiday_reference_days

Rows: 101

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| id | int(11) | NO | PRI | NULL | auto_increment |
| name | varchar(100) | NO | MUL | NULL |  |
| country | varchar(2) | YES | MUL | NO |  |
| year | int(11) | NO | MUL | NULL |  |
| reference_date | date | NO |  | NULL |  |
| calculation_method | varchar(50) | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (id)
- UNIQUE `unique_reference` (name, year, country)
- `idx_year` (year)
- `idx_country` (country)

## password_reset_attempts

Rows: 2

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| attempt_id | int(11) | NO | PRI | NULL | auto_increment |
| email | varchar(255) | NO | MUL | NULL |  |
| ip_address | varchar(45) | NO | MUL | NULL |  |
| attempted_at | datetime | NO |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (attempt_id)
- `idx_email_time` (email, attempted_at)
- `idx_ip_time` (ip_address, attempted_at)

## password_reset_tokens

Rows: 1

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| token_id | int(11) | NO | PRI | NULL | auto_increment |
| user_id | int(11) | NO | MUL | NULL |  |
| token | varchar(64) | NO | UNI | NULL |  |
| created_at | datetime | NO |  | current_timestamp() |  |
| expires_at | datetime | NO | MUL | NULL |  |
| used_at | datetime | YES |  | NULL |  |
| ip_address | varchar(45) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (token_id)
- UNIQUE `idx_token` (token)
- `idx_user_id` (user_id)
- `idx_expires` (expires_at)

## pool_sites

Rows: 1

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| id | int(11) | NO | PRI | NULL | auto_increment |
| project_id | int(11) | YES | MUL | NULL |  |
| site_id | varchar(50) | NO | UNI | NULL |  |
| name | varchar(100) | NO |  | NULL |  |
| latitude | decimal(10,6) | YES |  | NULL |  |
| longitude | decimal(10,6) | YES |  | NULL |  |
| weather_station_id | varchar(50) | YES | MUL | NULL |  |
| solar_latitude | decimal(10,6) | YES |  | NULL |  |
| solar_longitude | decimal(10,6) | YES |  | NULL |  |
| solar_data_start | date | YES |  | NULL |  |
| solar_data_end | date | YES |  | NULL |  |
| elevation_m | int(11) | YES |  | NULL |  |
| default_weather_station | varchar(50) | YES |  | NULL |  |
| description | text | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (id)
- UNIQUE `idx_site_code` (site_id)
- `idx_project_id` (project_id)
- `idx_pool_sites_weather_station` (weather_station_id)

## pools

Rows: 1

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| pool_id | int(11) | NO | PRI | NULL | auto_increment |
| pool_site_id | int(11) | YES | MUL | NULL |  |
| name | varchar(100) | NO |  | Main Pool |  |
| description | text | YES |  | NULL |  |
| length_m | decimal(6,2) | YES |  | 25.00 |  |
| width_m | decimal(6,2) | YES |  | 12.50 |  |
| depth_m | decimal(4,2) | YES |  | 2.00 |  |
| area_m2 | decimal(8,2) | YES |  | 312.50 |  |
| volume_m3 | decimal(10,2) | YES |  | 625.00 |  |
| wind_exposure | decimal(4,3) | YES |  | 0.535 |  |
| solar_absorption | decimal(4,1) | YES |  | 60.0 |  |
| years_operating | int(11) | YES |  | 3 |  |
| has_cover | tinyint(1) | YES |  | 1 |  |
| cover_r_value | decimal(4,2) | YES |  | 5.00 |  |
| cover_solar_transmittance | decimal(4,2) | YES |  | 10.00 |  |
| has_tunnel | tinyint(1) | YES |  | 1 |  |
| floor_insulated | tinyint(1) | YES |  | 1 |  |
| pool_type | enum('outdoor','indoor','semi-enclosed') | YES |  | outdoor |  |
| is_active | tinyint(1) | YES | MUL | 1 |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| updated_at | timestamp | YES |  | current_timestamp() | on update current_timestamp() |

**Indexes:**
- UNIQUE `PRIMARY` (pool_id)
- `idx_active` (is_active)
- `idx_pool_site_id` (pool_site_id)

## projects

Rows: 1

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| project_id | int(11) | NO | PRI | NULL | auto_increment |
| project_name | varchar(100) | NO |  | NULL |  |
| description | text | YES |  | NULL |  |
| is_active | tinyint(1) | YES |  | 1 |  |
| settings | longtext | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (project_id)

## schedule_templates

Rows: 3

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| template_id | int(11) | NO | PRI | NULL | auto_increment |
| pool_site_id | int(11) | YES |  | NULL |  |
| name | varchar(100) | NO | MUL | NULL |  |
| version | varchar(20) | YES |  | v1.0 |  |
| site_id | varchar(50) | YES | MUL | NULL |  |
| base_week_schedule_id | int(11) | YES | MUL | NULL |  |
| description | text | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| created_by | varchar(100) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (template_id)
- UNIQUE `unique_name_version` (name, version)
- `site_id` (site_id)
- `base_week_schedule_id` (base_week_schedule_id)

## simulation_daily_results

Rows: 49771

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| result_id | bigint(20) | NO | PRI | NULL | auto_increment |
| run_id | int(11) | NO | MUL | NULL |  |
| date | date | NO | MUL | NULL |  |
| hours_count | tinyint(4) | NO |  | 24 |  |
| open_hours | tinyint(4) | NO |  | 0 |  |
| avg_air_temp | decimal(5,2) | YES |  | NULL |  |
| avg_water_temp | decimal(5,2) | YES |  | NULL |  |
| total_loss_kwh | decimal(10,3) | NO |  | 0.000 |  |
| total_solar_kwh | decimal(10,3) | NO |  | 0.000 |  |
| total_hp_kwh | decimal(10,3) | NO |  | 0.000 |  |
| total_boiler_kwh | decimal(10,3) | NO |  | 0.000 |  |
| total_cost | decimal(10,2) | NO |  | 0.00 |  |

**Indexes:**
- UNIQUE `PRIMARY` (result_id)
- UNIQUE `idx_run_date` (run_id, date)
- `idx_run_id` (run_id)
- `idx_date` (date)

## simulation_hourly_results

Rows: 1192733

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| result_id | bigint(20) | NO | PRI | NULL | auto_increment |
| run_id | int(11) | NO | MUL | NULL |  |
| timestamp | datetime | NO | MUL | NULL |  |
| air_temp | decimal(5,2) | YES |  | NULL |  |
| wind_speed | decimal(5,2) | YES |  | NULL |  |
| humidity | decimal(5,2) | YES |  | NULL |  |
| solar_kwh_m2 | decimal(8,5) | YES |  | NULL |  |
| target_temp | decimal(4,1) | YES |  | NULL |  |
| water_temp | decimal(5,2) | YES |  | NULL |  |
| is_open | tinyint(1) | NO |  | 0 |  |
| total_loss_kw | decimal(8,3) | YES |  | NULL |  |
| solar_gain_kw | decimal(8,3) | YES |  | NULL |  |
| hp_heat_kw | decimal(8,3) | YES |  | NULL |  |
| boiler_heat_kw | decimal(8,3) | YES |  | NULL |  |
| hp_electricity_kwh | decimal(8,3) | YES |  | NULL |  |
| boiler_fuel_kwh | decimal(8,3) | YES |  | NULL |  |
| hp_cop | decimal(4,2) | YES |  | NULL |  |
| cost | decimal(8,2) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (result_id)
- `idx_run_id` (run_id)
- `idx_timestamp` (timestamp)
- `idx_run_timestamp` (run_id, timestamp)

## simulation_runs

Rows: 175

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| run_id | int(11) | NO | PRI | NULL | auto_increment |
| pool_id | int(11) | YES | MUL | NULL |  |
| pool_site_id | int(11) | YES |  | NULL |  |
| user_id | int(11) | YES |  | NULL |  |
| scenario_name | varchar(255) | NO |  | Unnamed Scenario |  |
| description | text | YES |  | NULL |  |
| start_date | date | NO |  | NULL |  |
| end_date | date | NO |  | NULL |  |
| status | enum('pending','running','completed','failed') | NO | MUL | pending |  |
| created_at | datetime | NO | MUL | current_timestamp() |  |
| completed_at | datetime | YES |  | NULL |  |
| config_snapshot | longtext | YES |  | NULL |  |
| summary_json | longtext | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (run_id)
- `idx_status` (status)
- `idx_created` (created_at)
- `idx_pool_id` (pool_id)

## site_solar_daily

Rows: 3653

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| pool_site_id | int(11) | NO | PRI | NULL |  |
| date | date | NO | PRI | NULL |  |
| daily_kwh_m2 | decimal(6,4) | YES |  | NULL |  |
| clear_sky_kwh_m2 | decimal(6,4) | YES |  | NULL |  |
| cloud_factor | decimal(4,3) | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (pool_site_id, date)
- `idx_date` (date)
- `idx_pool_site_id` (pool_site_id)

## site_solar_hourly

Rows: 87672

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| pool_site_id | int(11) | NO | PRI | NULL |  |
| timestamp | datetime | NO | PRI | NULL |  |
| solar_wh_m2 | decimal(8,2) | YES |  | NULL |  |
| clear_sky_wh_m2 | decimal(8,2) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (pool_site_id, timestamp)
- `idx_timestamp` (timestamp)
- `idx_pool_site_id` (pool_site_id)

## solar_daily_data

Rows: 3653

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| station_id | varchar(50) | NO | PRI | NULL |  |
| date | date | NO | PRI | NULL |  |
| daily_total_kwh_m2 | decimal(6,4) | YES |  | NULL |  |
| daily_clear_sky_kwh_m2 | decimal(6,4) | YES |  | NULL |  |
| cloud_reduction_factor | decimal(6,4) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (station_id, date)

## tunnel_heat_transfer_lookup

Rows: 50

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| T_outdoor_C | int(11) | NO | PRI | NULL |  |
| Q_from_pool_with_kW | decimal(8,3) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (T_outdoor_C)

## user_preferences

Rows: 4

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| user_id | int(11) | NO | PRI | NULL |  |
| project_id | int(11) | NO | PRI | NULL |  |
| pref_key | varchar(50) | NO | PRI | NULL |  |
| pref_value | text | YES |  | NULL |  |
| updated_at | timestamp | YES |  | current_timestamp() | on update current_timestamp() |

**Indexes:**
- UNIQUE `PRIMARY` (user_id, project_id, pref_key)
- `idx_user_project` (user_id, project_id)

## user_projects

Rows: 5

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| user_id | int(11) | NO | PRI | NULL |  |
| project_id | int(11) | NO | PRI | NULL |  |
| role | enum('viewer','operator','admin','owner') | YES |  | viewer |  |
| granted_at | timestamp | YES |  | current_timestamp() |  |
| granted_by | int(11) | YES | MUL | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (user_id, project_id)
- `granted_by` (granted_by)
- `idx_user` (user_id)
- `idx_project` (project_id)

## user_sessions

Rows: 20

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| session_id | varchar(64) | NO | PRI | NULL |  |
| user_id | int(11) | NO | MUL | NULL |  |
| project_id | int(11) | YES | MUL | NULL |  |
| ip_address | varchar(45) | YES |  | NULL |  |
| user_agent | varchar(255) | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| last_activity | timestamp | YES |  | current_timestamp() | on update current_timestamp() |
| expires_at | timestamp | YES | MUL | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (session_id)
- `project_id` (project_id)
- `idx_user` (user_id)
- `idx_expires` (expires_at)

## users

Rows: 5

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| user_id | int(11) | NO | PRI | NULL | auto_increment |
| email | varchar(255) | NO | UNI | NULL |  |
| password_hash | varchar(255) | NO |  | NULL |  |
| force_password_change | tinyint(1) | NO |  | 1 |  |
| password_history | longtext | YES |  | NULL |  |
| name | varchar(100) | NO |  | NULL |  |
| is_active | tinyint(1) | YES |  | 1 |  |
| is_super_admin | tinyint(1) | YES |  | 0 |  |
| created_at | timestamp | YES |  | current_timestamp() |  |
| last_login | timestamp | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (user_id)
- UNIQUE `email` (email)
- `idx_email` (email)

## weather_data

Rows: 87545

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| station_id | varchar(50) | NO | PRI | NULL |  |
| timestamp | datetime | NO | PRI | NULL |  |
| temperature | decimal(5,2) | YES |  | NULL |  |
| wind_speed | decimal(5,2) | YES |  | NULL |  |
| wind_direction | int(11) | YES |  | NULL |  |
| humidity | int(11) | YES |  | NULL |  |
| tunnel_temp | decimal(5,2) | YES |  | NULL |  |

**Indexes:**
- UNIQUE `PRIMARY` (station_id, timestamp)
- `idx_timestamp` (timestamp)

## weather_stations

Rows: 1

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| station_id | varchar(50) | NO | PRI | NULL |  |
| station_name | varchar(100) | NO |  | NULL |  |
| source | varchar(50) | YES |  | NULL |  |
| latitude | decimal(10,6) | YES |  | NULL |  |
| longitude | decimal(10,6) | YES |  | NULL |  |
| elevation_m | int(11) | YES |  | NULL |  |
| wind_height_m | decimal(4,1) | YES |  | NULL |  |
| temperature_height_m | decimal(4,1) | YES |  | NULL |  |
| active_from | date | YES |  | NULL |  |
| active_to | date | YES |  | NULL |  |
| notes | text | YES |  | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (station_id)

## week_schedules

Rows: 5

| Column | Type | Null | Key | Default | Extra |
|--------|------|------|-----|---------|-------|
| week_schedule_id | int(11) | NO | PRI | NULL | auto_increment |
| pool_site_id | int(11) | YES |  | NULL |  |
| name | varchar(100) | NO | MUL | NULL |  |
| site_id | varchar(50) | YES | MUL | NULL |  |
| description | text | YES |  | NULL |  |
| monday_schedule_id | int(11) | YES | MUL | NULL |  |
| tuesday_schedule_id | int(11) | YES | MUL | NULL |  |
| wednesday_schedule_id | int(11) | YES | MUL | NULL |  |
| thursday_schedule_id | int(11) | YES | MUL | NULL |  |
| friday_schedule_id | int(11) | YES | MUL | NULL |  |
| saturday_schedule_id | int(11) | YES | MUL | NULL |  |
| sunday_schedule_id | int(11) | YES | MUL | NULL |  |
| created_at | timestamp | YES |  | current_timestamp() |  |

**Indexes:**
- UNIQUE `PRIMARY` (week_schedule_id)
- UNIQUE `unique_name_site` (name, site_id)
- `site_id` (site_id)
- `monday_schedule_id` (monday_schedule_id)
- `tuesday_schedule_id` (tuesday_schedule_id)
- `wednesday_schedule_id` (wednesday_schedule_id)
- `thursday_schedule_id` (thursday_schedule_id)
- `friday_schedule_id` (friday_schedule_id)
- `saturday_schedule_id` (saturday_schedule_id)
- `sunday_schedule_id` (sunday_schedule_id)

