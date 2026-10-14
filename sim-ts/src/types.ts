// Inputs exported by EnergySimulator::exportRunInputs() (PHP) and the result
// shape of EnergySimulator::runSimulation(), which this port reproduces.

/** [utcTimestamp, localTimestamp, air °C, wind m/s, humidity %, tunnel °C] */
export type WeatherRow = [string, string, number | null, number | null, number | null, number | null];

export interface Period {
  from: number;
  to: number;
  target_temp_raw: number | null;
  target_source: 'schedule' | 'default';
  target_temp: number;
  min_temp: number | null;
  max_temp: number | null;
}

export interface DayScheduleState {
  id: number | string;
  description?: string;
  periods: Period[];
}

export interface DateRangeState {
  id: number | string;
  name: string;
  priority: number | string;
  week_schedule_id: number | string;
  is_default: boolean;
  is_recurring?: boolean;
  start_month?: number;
  start_day?: number;
  end_month?: number;
  end_day?: number;
}

export interface ExceptionDayState {
  id: number | string;
  name: string;
  day_schedule_id: number | string | null;
  day_schedule_name: string | null;
  fixed_month: number | null;
  fixed_day: number | null;
  is_moving: boolean;
  reference_day_id: number | null;
  easter_offset: number | null;
  priority: number;
}

/** PoolScheduler::exportState() */
export interface ScheduleState {
  format: 1;
  pool_site_id: number;
  template: { template_id: number | string; name: string; [k: string]: unknown };
  schedules: Record<string, DayScheduleState>;
  week_schedules: Record<string, { name: string; days: Record<string, string | null> }>;
  date_ranges: DateRangeState[];
  exception_days: ExceptionDayState[];
  /** [reference_day_id][year] = 'Y-m-d' */
  holiday_dates: Record<string, Record<string, string>>;
}

export interface RunInputs {
  format: 1;
  simulator_version: string;
  start_date: string;
  end_date: string;
  strategy_requested: string;
  pool_config: Record<string, any>;
  equipment: Record<string, any>;
  thermal_mass_rate: number | null;
  ground_factor: number;
  schedule: ScheduleState | null;
  weather: WeatherRow[];
  solar_kind: 'hourly' | 'daily' | 'none';
  /** hourly: UTC 'Y-m-d H:00:00' -> kWh/m²; daily: 'Y-m-d' -> daily total kWh/m² */
  solar: Record<string, number>;
}

export interface Heating {
  hp_heat: number;
  hp_electricity: number;
  hp_cop: number;
  boiler_heat: number;
  boiler_fuel: number;
  total_heat: number;
  cost: number;
  requested_heat: number;
  unmet_heat?: number;
}

export interface Losses {
  evaporation: number;
  convection: number;
  radiation: number;
  cover: number;
  floor: number;
  walls: number;
  total: number;
}

export interface DailyResult {
  date: string;
  hours: number;
  open_hours: number;
  avg_air_temp: number;
  avg_water_temp: number;
  min_water_temp: number;
  min_water_temp_open: number;
  max_shortfall_open: number | null;
  total_loss_kwh: number;
  total_solar_kwh: number;
  total_hp_kwh: number;
  total_boiler_kwh: number;
  hp_thermal_kwh: number;
  boiler_thermal_kwh: number;
  total_cost: number;
}

/**
 * Compact hourly row: exactly the values simulation_hourly_results stores,
 * rounded as PHP rounds them.
 * [timestamp, air, wind, humidity, solar_kwh_m2, target_temp, water_temp,
 *  water_temp_start, is_open, total_loss_kw, solar_gain_kw, hp_heat_kw,
 *  boiler_heat_kw, hp_electricity_kwh, boiler_fuel_kwh, hp_cop, cost,
 *  heating_mode, effective_target]
 */
export type HourlyRow = [
  string, number, number, number, number, number | null, number,
  number, 0 | 1, number, number, number,
  number, number, number, number, number,
  string, number | null,
];

export interface RunResult {
  version: string;
  summary: Record<string, any>;
  daily: DailyResult[];
  hourly: HourlyRow[];
}

export type ProgressFn = (period: string, done: number, total: number) => void;
