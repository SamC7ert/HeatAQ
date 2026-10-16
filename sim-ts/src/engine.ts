// Port of EnergySimulator::runSimulation() and its predictive-control helpers
// (lib/EnergySimulator.php). Runs on EnergySimulator::exportRunInputs().
// Kept structurally parallel to the PHP so the two can be compared line by
// line; see docs/PREDICTIVE_CONTROL.md for the control logic.

import type { DailyResult, Heating, HourlyRow, Losses, ProgressFn, RunInputs, RunResult, StoredDayRow, WeatherRow } from './types';
import { Physics, distributeSolarToHour } from './physics';
import type { LossDetail } from './physics';
import { Scheduler } from './scheduler';
import { addHours, num, parseNaive, phpRound, unix } from './util';

export const PORT_OF_VERSION = '3.19.0';

interface ClosedPlan {
  preheat: boolean;
  target: number;
  t_req: number;
  start_offset: number;
  min_temp: number;
  max_temp: number;
  buffer_energy: number;
  bank_hours: number;
  start_index?: number;
  hours_to_open?: number;
  open_duration?: number;
  /** Forecast run the plan read (null: actual weather) */
  forecast_run?: number | null;
}

/** A forecast run indexed for planning (unix seconds); see EnergySimulator::prepareForecast */
interface PlanRun {
  issued: number;
  available: number;
  first: number;
  air: (number | null)[];
  wind: (number | null)[];
  rh: (number | null)[];
}

/** UTC 'Y-m-d H:i:s' -> unix seconds (PHP strtotime($ts . ' UTC')) */
const unixUtc = (ts: string): number => unix(parseNaive(ts));

const ZERO_HEATING = (): Heating => ({
  hp_heat: 0, hp_electricity: 0, hp_cop: 0, boiler_heat: 0, boiler_fuel: 0,
  total_heat: 0, cost: 0, requested_heat: 0,
});

/**
 * EnergySimulator::computeClosedPlan (pure); see the PHP docblock and
 * docs/PREDICTIVE_CONTROL.md §4. openDeficit: per open hour, net demand minus
 * the heat pump at full (kW). t_req from the backward need recursion; late
 * start always; bank_hours = open hours up to the last short hour.
 */
export function computeClosedPlan(waterTemp: number, target: number, minTemp: number, maxTemp: number, tmr: number,
                                  closedLoss: number[], closedHpOut: number[], openDeficit: number[]): ClosedPlan {
  const hoursToOpen = closedLoss.length;

  let need = target;
  let bankHours = 0;
  for (let k = openDeficit.length - 1; k >= 0; k--) {
    need = Math.max(target, need + openDeficit[k] / tmr);
    if (bankHours === 0 && openDeficit[k] > 1e-9) bankHours = k + 1;
  }
  const bufferEnergy = (need - target) * tmr;
  const tReq = Math.min(need, maxTemp);

  const coast: number[] = [];
  let t = waterTemp;
  for (let i = 0; i < hoursToOpen; i++) {
    coast[i] = t;
    t = Math.max(minTemp, t - (closedLoss[i] / tmr));
  }
  let startOffset = 0;
  for (let s = hoursToOpen - 1; s >= 0; s--) {
    let tt = coast[s];
    for (let i = s; i < hoursToOpen; i++) {
      tt += (closedHpOut[i] - closedLoss[i]) / tmr;
      if (tt > maxTemp) tt = maxTemp;
    }
    if (tt >= tReq - 0.01) {
      startOffset = s;
      break;
    }
  }
  return { preheat: bufferEnergy > 1e-9, target, t_req: tReq, start_offset: startOffset, min_temp: minTemp, max_temp: maxTemp,
           buffer_energy: bufferEnergy, bank_hours: bankHours };
}

class Run {
  private phys: Physics;
  private sched: Scheduler | null;
  private eq: Record<string, any>;
  private pool: Record<string, any>;
  private tmr: number | null;
  private weather: WeatherRow[];
  private solar: Record<string, number>;
  private hasSolar: boolean;

  private closedPlan: ClosedPlan | null = null;
  private standbyCheckDate: string | null = null;
  private standbyPlanAt: number | null = null;
  private openPreheat = false;
  private openMaxTemp: number | null = null;
  private openBankEnd = 0;

  // Planning on forecasts (doc §11); null = plans read the actual weather
  private forecast: { source: string; runs: PlanRun[]; available: number[] } | null = null;
  private planRun: number | null = null;
  private fs = { plans: 0, plans_without: 0, replans: 0, age_sum: 0, hours_beyond: 0 };

  constructor(private inputs: RunInputs) {
    this.pool = inputs.pool_config || {};
    this.eq = inputs.equipment || {};
    this.phys = new Physics(this.pool, this.eq, num(inputs.ground_factor, 1) as number);
    this.sched = inputs.schedule ? new Scheduler(inputs.schedule) : null;
    this.tmr = num(inputs.thermal_mass_rate, null);
    this.weather = inputs.weather;
    this.solar = inputs.solar || {};
    this.hasSolar = Object.keys(this.solar).length > 0;
    // EnergySimulator::prepareForecast
    if (inputs.forecast && this.strategy() === 'predictive' && (this.eq.planning_weather ?? 'actual') === 'forecast') {
      const runs = inputs.forecast.runs.map(r => ({
        issued: unixUtc(r[0]), available: unixUtc(r[1]), first: unixUtc(r[2]), air: r[3], wind: r[4], rh: r[5],
      }));
      this.forecast = { source: inputs.forecast.source, runs, available: runs.map(r => r.available) };
    }
  }

  // ---- planning on forecasts (EnergySimulator::newestRunAt / selectPlanRun / planningRow) ----
  private newestRunAt(utc: string): number | null {
    if (this.forecast === null) return null;
    const t = unixUtc(utc);
    const avail = this.forecast.available;
    let lo = 0, hi = avail.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (avail[mid] <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (found < 0) return null;
    const run = this.forecast.runs[found];
    return run.first + (run.air.length - 1) * 3600 >= t ? found : null;
  }

  private selectPlanRun(idx: number, count = true): void {
    this.planRun = null;
    if (this.forecast === null) return;
    const utc = this.weather[idx][0];
    this.planRun = this.newestRunAt(utc);
    if (!count) return;
    if (this.planRun === null) {
      this.fs.plans_without++;
    } else {
      this.fs.plans++;
      this.fs.age_sum += (unixUtc(utc) - this.forecast.runs[this.planRun].issued) / 3600;
    }
  }

  private planningRow(idx: number): WeatherRow {
    const h = this.weather[idx];
    if (this.planRun === null || this.forecast === null) return h;
    const run = this.forecast.runs[this.planRun];
    const n = run.air.length;
    let k = Math.trunc((unixUtc(h[0]) - run.first) / 3600);
    if (k < 0) return h;
    if (k >= n) {
      k = n - 1;
      this.fs.hours_beyond++;
    }
    while (k >= 0 && (run.air[k] === null || run.wind[k] === null || run.rh[k] === null)) k--;
    if (k < 0) return h;
    return [h[0], h[1], run.air[k], run.wind[k], run.rh[k], h[5]];
  }

  // ---- targets ----
  private configDefaultTarget(): number { return num(this.eq.target_temp, 28.0) as number; }
  private targetOffset(): number { return num(this.eq.target_offset, 0.0) as number; }
  /** EnergySimulator::maxTemp: target + "Max overheat" (upper_tolerance). */
  private maxTemp(target: number): number { return target + (num(this.eq.upper_tolerance, 1.0) as number); }
  /** EnergySimulator::closedFloor: "Min temp when closed" (standby_temp), else 5 °C; never above target. */
  private closedFloor(target: number): number {
    const floor = num(this.eq.standby_temp, null);
    return Math.min(target, floor === null ? 5.0 : floor);
  }
  private fallbackTarget(): number { return this.configDefaultTarget() + this.targetOffset(); }
  private strategy(): string { return this.eq.control_strategy ?? 'reactive'; }

  // ---- weather / solar ----
  private air(r: WeatherRow): number { return num(r[2], 0) as number; }
  private wind(r: WeatherRow): number { return num(r[3], 0) as number; }
  private hum(r: WeatherRow): number { return num(r[4], 0) as number; }
  private tunnel(r: WeatherRow): number | null { return r[5] === null || r[5] === undefined ? null : Number(r[5]); }

  private solarForHour(date: string, hour: number): number {
    const ts = `${date} ${hour < 10 ? '0' + hour : hour}:00:00`;
    const v = this.solar[ts];
    if (v !== undefined) return v;
    return distributeSolarToHour(this.solar[date] ?? 0, hour);
  }

  private planningSolarGain(r: WeatherRow, isOpen: boolean): number {
    if (!this.hasSolar) return 0.0;
    const utc = r[0];
    return this.phys.solarGain(this.solarForHour(utc.slice(0, 10), +utc.slice(11, 13)), isOpen);
  }

  // ---- heating helpers ----
  private uncoveredLoss(holdTemp: number | null, waterTemp: number, netRequirement: number, delivered: number): number {
    if (holdTemp === null || waterTemp > holdTemp + 0.01) return 0.0;
    return Math.max(0.0, netRequirement - delivered);
  }

  private heatPumpToHold(holdTemp: number, net: number, air: number, water: number, tmr: number): Heating {
    const required = Math.max(0.0, net + (holdTemp - water) * tmr);
    const hp = this.phys.applyHeatPump(required, air);
    return {
      hp_heat: hp.heat, hp_electricity: hp.electricity, hp_cop: hp.cop,
      boiler_heat: 0, boiler_fuel: 0, total_heat: hp.heat, cost: hp.cost,
      requested_heat: required,
      unmet_heat: this.uncoveredLoss(holdTemp, water, net, hp.heat),
    };
  }

  private standbyHeating(standby: number, net: number, air: number, water: number, tmr: number): Heating {
    const required = Math.max(0.0, net + (standby - water) * tmr);
    const hp = this.phys.applyHeatPump(required, air);
    let boiler = { heat: 0, fuel: 0, cost: 0 };
    if (required - hp.heat > 0.001 && this.phys.boilerOn) {
      boiler = this.phys.applyBoiler(required - hp.heat);
    }
    const total = hp.heat + boiler.heat;
    return {
      hp_heat: hp.heat, hp_electricity: hp.electricity, hp_cop: hp.cop,
      boiler_heat: boiler.heat, boiler_fuel: boiler.fuel, total_heat: total,
      cost: hp.cost + boiler.cost, requested_heat: required,
      unmet_heat: this.uncoveredLoss(standby, water, net, total),
    };
  }

  private openPreheatHeating(target: number, maxTemp: number, net: number, air: number, water: number, tmr: number): Heating {
    const hpReq = Math.max(0.0, net + (maxTemp - water) * tmr);
    const hp = this.phys.applyHeatPump(hpReq, air);
    // At or below target the boiler restores target this hour (see PHP)
    let boiler = { heat: 0, fuel: 0, cost: 0 };
    const boilerReq = net + Math.max(0.0, (target - water) * tmr) - hp.heat;
    if (water <= target + 0.01 && boilerReq > 0) {
      boiler = this.phys.applyBoiler(boilerReq);
    }
    const requested = water <= target + 0.01
      ? Math.max(0.0, net + Math.max(0.0, (target - water) * tmr))
      : 0.0;
    return {
      hp_heat: hp.heat, hp_electricity: hp.electricity, hp_cop: hp.cop,
      boiler_heat: boiler.heat, boiler_fuel: boiler.fuel, total_heat: hp.heat + boiler.heat,
      cost: hp.cost + boiler.cost, requested_heat: requested,
      unmet_heat: this.uncoveredLoss(target, water, net, hp.heat + boiler.heat),
    };
  }

  private calculateHeating(net: number, air: number, targetIn: number | null, water: number): Heating {
    const result = ZERO_HEATING();
    let strategy = this.strategy();
    if (strategy !== 'reactive' && strategy !== 'predictive') strategy = 'reactive';
    let target = targetIn;
    if (strategy === 'predictive' && target === null) {
      return result;
    } else if (target === null) {
      target = this.fallbackTarget();
    }
    const tempDiff = target - water;
    let required: number;
    if (tempDiff > 0) {
      required = net + this.phys.heatForTempRise(tempDiff, 1.0);
    } else {
      const credit = this.phys.heatForTempRise(Math.abs(tempDiff), 1.0);
      required = Math.max(0, net - credit);
    }
    if (required <= 0) return result;

    result.requested_heat = required;
    let remaining = required;
    const hp = this.phys.applyHeatPump(remaining, air);
    result.hp_heat = hp.heat;
    result.hp_electricity = hp.electricity;
    result.hp_cop = hp.cop;
    result.cost += hp.cost;
    remaining -= hp.heat;
    if (remaining > 0 && this.phys.boilerOn) {
      const b = this.phys.applyBoiler(remaining);
      result.boiler_heat = b.heat;
      result.boiler_fuel = b.fuel;
      result.cost += b.cost;
    }
    result.total_heat = result.hp_heat + result.boiler_heat;
    result.unmet_heat = this.uncoveredLoss(target, water, net, result.total_heat);
    return result;
  }

  // ---- predictive planning ----
  private planClosedPeriod(nowMs: number, waterTemp: number, idx: number): ClosedPlan | null {
    if (!this.sched) return null;
    if (!this.tmr || this.tmr <= 0) return null;
    const next = this.sched.findNextOpening(nowMs);
    if (next.datetime === null) return null;

    const tmr = this.tmr;
    const target = next.target_temp ?? this.fallbackTarget();
    const maxTemp = this.maxTemp(target);
    const minTemp = this.closedFloor(target);
    const hpCapacity = num(this.eq.heat_pump?.capacity_kw, 0) as number;

    const hoursToOpen = Math.max(1, phpRound((unix(next.datetime) - unix(nowMs)) / 3600));
    const openIdx = idx + hoursToOpen;
    const n = this.weather.length;
    this.selectPlanRun(idx);

    const closedLoss: number[] = [];
    const closedHpOut: number[] = [];
    for (let i = 0; i < hoursToOpen; i++) {
      const j = idx + i;
      if (j >= n) break;
      const h = this.planningRow(j);
      const air = this.air(h);
      const loss = this.phys.heatLosses(target, air, this.wind(h), this.hum(h), false, this.tunnel(h));
      closedLoss.push(loss.total - this.planningSolarGain(h, false));
      closedHpOut.push(this.phys.applyHeatPump(hpCapacity, air).heat);
    }

    const openDeficit: number[] = [];
    let openDuration = 0;
    for (let k = 0; k < 48; k++) {
      const j = openIdx + k;
      if (j >= n) break;
      const dt = k > 0 ? addHours(next.datetime, k) : next.datetime;
      if (this.sched.getCurrentPeriod(dt) === null) break;
      const h = this.planningRow(j);
      const air = this.air(h);
      const loss = this.phys.heatLosses(target, air, this.wind(h), this.hum(h), true, this.tunnel(h));
      openDeficit.push(loss.total - this.planningSolarGain(h, true) - this.phys.applyHeatPump(hpCapacity, air).heat);
      openDuration++;
    }

    const plan = computeClosedPlan(waterTemp, target, minTemp, maxTemp, tmr, closedLoss, closedHpOut, openDeficit);
    plan.start_index = idx + (plan.start_offset ?? 0);
    plan.hours_to_open = closedLoss.length;
    plan.open_duration = openDuration;
    plan.forecast_run = this.planRun;
    this.planRun = null;
    return plan;
  }

  private standbyPlanStart(nowMs: number, waterTemp: number, idx: number): number | null {
    if (!this.sched) return null;
    const next = this.sched.findNextOpening(nowMs);
    if (next.datetime === null) return null;
    const target = next.target_temp ?? this.fallbackTarget();
    const tmr = (this.tmr && this.tmr > 0) ? this.tmr : 1.0;
    const hpCap = num(this.eq.heat_pump?.capacity_kw, 0) as number;
    const openTs = unix(next.datetime);
    const hoursToOpen = Math.floor((openTs - unix(nowMs)) / 3600);
    let needed: number | null = null;
    let w = waterTemp;
    this.selectPlanRun(idx, false);
    for (let k = 0; k <= hoursToOpen && k < 14 * 24 && this.weather[idx + k] !== undefined; k++) {
      if (w >= target) { needed = k; break; }
      const h = this.planningRow(idx + k);
      const air = this.air(h);
      const loss = this.phys.heatLosses(w, air, this.wind(h), this.hum(h), false, null).total;
      const gain = hpCap > 0 ? this.phys.applyHeatPump(hpCap, air).heat : 0;
      w += (gain - loss) / tmr;
    }
    this.planRun = null;
    if (needed === null) needed = 14 * 24;
    return openTs - (needed + 12) * 3600;
  }

  // ---- Details: one hour, recomputed (was EnergySimulator::debugSingleHour) ----
  /**
   * The losses, gains and heating of one hour (site local time, as in the
   * results), at the given water temperature (the hour's start) and open
   * state (the run's). Heating is the steady-state view: hold the target
   * (closed predictive: heat pump only); the run's own mode is in its row.
   */
  debugHour(localTs: string, waterTempIn: number | null, isOpenOverride: boolean | null): Record<string, any> {
    const row = this.weather.find(r => r[1] === localTs);
    if (!row) return { error: `No weather data for ${localTs} in this run's inputs` };
    if (row[2] === null || row[3] === null || row[4] === null) {
      throw new Error(`Weather for ${localTs} is missing a value (air, wind or humidity)`);
    }
    const utc = row[0];
    const tsMs = parseNaive(localTs);
    const hourlySolar = this.solarForHour(utc.slice(0, 10), +utc.slice(11, 13));
    const solarSource = this.inputs.solar_kind === 'none' || !this.hasSolar ? 'none' : this.inputs.solar_kind;

    let isOpen = false;
    let targetTemp: number | null = null;
    if (isOpenOverride !== null) {
      isOpen = isOpenOverride;
      targetTemp = this.fallbackTarget();
      const period = this.sched ? this.sched.getCurrentPeriod(tsMs) : null;
      if (period && period.target_temp !== undefined && period.target_temp !== null) targetTemp = period.target_temp;
    } else if (this.sched) {
      const period = this.sched.getCurrentPeriod(tsMs);
      if (period) { isOpen = true; targetTemp = period.target_temp ?? 28; }
    }
    const poolTemp = waterTempIn ?? 28.59;
    const air = this.air(row), wind = this.wind(row), hum = this.hum(row), tunnel = this.tunnel(row);
    const detail: LossDetail = {};
    const losses = this.phys.heatLosses(poolTemp, air, wind, hum, isOpen, tunnel, detail);
    const solarGain = this.phys.solarGain(hourlySolar, isOpen);
    const net = losses.total - solarGain;

    const st = this.phys.settings;
    const strategy = this.strategy();
    const tmr = (this.tmr && this.tmr > 0) ? this.tmr : 1.0;
    let heating: Heating;
    let mode: string;
    if (strategy === 'predictive' && !isOpen) {
      heating = this.heatPumpToHold(targetTemp ?? this.fallbackTarget(), net, air, poolTemp, tmr);
      mode = 'closed_hold';
    } else {
      heating = this.calculateHeating(net, air, targetTemp, poolTemp);
      mode = strategy === 'predictive' ? 'open_hold' : 'reactive';
    }
    const b = this.eq.bathers || {};
    const bathers = num(b.per_day, null), perVisit = num(b.kwh_per_visit, null), openH = num(b.open_hours, null);
    const waterHeating = (bathers !== null && perVisit !== null && openH !== null && openH > 0) ? bathers * perVisit / openH : 0;
    const r = (v: number, d: number) => phpRound(v, d);
    const perimeter = num(this.pool.perimeter_m, 2 * (st.length + st.width)) as number;
    const isCovered = st.hasCover && !isOpen;
    const tempDiff = (targetTemp ?? 28.0) - poolTemp;
    const heatToRaise = this.phys.heatForTempRise(Math.max(0, tempDiff), 1.0);
    const totalHeating = heating.hp_heat + heating.boiler_heat;
    return {
      timestamp: localTs,
      input: {
        date: localTs.slice(0, 10), hour: +localTs.slice(11, 13),
        weather: { air_temp_c: r(air, 2), wind_speed_ms: r(wind, 2), humidity_pct: r(hum, 1),
                   solar_ghi_wm2: r(hourlySolar * 1000, 2), tunnel_temp_c: tunnel },
        pool: { water_temp_c: r(poolTemp, 4), area_m2: this.phys.area, volume_m3: this.phys.volume, depth_m: st.depth,
                perimeter_m: r(perimeter, 1), wall_area_m2: r(perimeter * st.depth, 1), floor_area_m2: this.phys.area,
                target_temp: targetTemp },
        config: { wind_factor: st.windFactor, years_operating: this.pool.years_operating ?? 3, has_cover: st.hasCover,
                  cover_u_value: st.coverU, solar_absorption: st.absorptivity, is_open: isOpen, target_temp: targetTemp },
      },
      losses: { evaporation_kw: r(losses.evaporation, 3), convection_kw: r(losses.convection, 3), radiation_kw: r(losses.radiation, 3),
                cover_kw: r(losses.cover, 3), floor_kw: r(losses.floor, 3), walls_kw: r(losses.walls, 3), total_kw: r(losses.total, 3) },
      evaporation: { p_water_pa: r(detail.p_water_pa ?? 0, 1), p_air_pa: r(detail.p_air_pa ?? 0, 1), delta_p_pa: r(detail.delta_p_pa ?? 0, 1),
                     v_eff_ms: r(detail.v_eff_ms ?? 0, 2), activity_factor: detail.activity_factor ?? 1.0, loss_kw: r(losses.evaporation, 3) },
      convection: { temp_diff_k: r(detail.temp_diff_k ?? 0, 2), bowen_ratio: r(detail.bowen_ratio ?? 0, 3), loss_kw: r(losses.convection, 3) },
      radiation: { water_temp_k: r(poolTemp + 273.15, 1), sky_temp_k: r(air - 10 + 273.15, 1), loss_kw: r(losses.radiation, 3) },
      cover: { has_cover: st.hasCover, is_covered: isCovered, u_value: st.coverU, transmittance: st.coverTransmittance, loss_kw: r(losses.cover, 3) },
      solar_gain: { source: solarSource, hourly_kwh_m2: r(hourlySolar, 4), solar_gain_kw: r(solarGain, 3) },
      structural: { floor_kw: r(losses.floor, 3), walls_kw: r(losses.walls, 3), total_kw: r(losses.floor + losses.walls, 3) },
      water_heating: { bathers_per_day: bathers, kwh_per_visit: perVisit, open_hours: openH, water_heating_kw: r(waterHeating, 3) },
      heat_pump: { strategy, type: st.hpType, capacity_kw: st.hpCapacity, enabled: st.hpEnabled, min_temp_c: st.hpMinOp ?? -20,
                   cop: r(heating.hp_cop, 2), output_kw: r(heating.hp_heat, 3), electricity_kw: r(heating.hp_electricity, 3) },
      boiler: { capacity_kw: st.boilerCapacity, enabled: st.boilerEnabled, efficiency: st.boilerEfficiency,
                type: this.phys.boilerIsElectric ? 'electric' : 'fuel', output_kw: r(heating.boiler_heat, 3), fuel_kw: r(heating.boiler_fuel, 3) },
      heating_summary: { net_demand_kw: r(Math.max(0, net), 3), hp_output_kw: r(heating.hp_heat, 3), boiler_output_kw: r(heating.boiler_heat, 3),
                         total_heating_kw: r(totalHeating, 3), unmet_kw: r(Math.max(0, net - totalHeating), 3), debug_mode: mode },
      heating_calc_debug: { net_requirement_kw: r(net, 2), air_temp_c: r(air, 2), target_temp_c: r(targetTemp ?? 28.0, 2),
                            water_temp_c: r(poolTemp, 2), volume_m3: this.phys.volume, temp_diff_c: r(tempDiff, 2),
                            heat_to_raise_kw: r(heatToRaise, 2), required_heat_kw: r(net + heatToRaise, 2),
                            hp_output_kw: r(heating.hp_heat, 2), boiler_output_kw: r(heating.boiler_heat, 2) },
      summary: { evaporation_kw: r(losses.evaporation, 3), convection_kw: r(losses.convection, 3), radiation_kw: r(losses.radiation, 3),
                 cover_loss_kw: r(losses.cover, 3), wall_loss_kw: r(losses.walls, 3), floor_loss_kw: r(losses.floor, 3),
                 water_heating_kw: r(waterHeating, 3), total_loss_kw: r(losses.total, 3), solar_gain_kw: r(solarGain, 3),
                 net_requirement_kw: r(net, 3) },
      pool: { water_temp: poolTemp, thermal_mass: this.tmr },
    };
  }

  // ---- main loop ----
  run(progress?: ProgressFn): RunResult {
    const inp = this.inputs;
    const eq = this.eq;
    const strategyRequested = inp.strategy_requested;
    const s: Record<string, any> = {
      total_hours: 0, open_hours: 0,
      evaporation_kwh: 0, convection_kwh: 0, radiation_kwh: 0, cover_loss_kwh: 0,
      floor_loss_kwh: 0, wall_loss_kwh: 0, total_heat_loss_kwh: 0, total_solar_gain_kwh: 0,
      hp_thermal_kwh: 0, boiler_thermal_kwh: 0, unmet_kwh: 0,
      total_hp_energy_kwh: 0, total_boiler_energy_kwh: 0, total_electricity_kwh: 0, total_fuel_kwh: 0,
      boiler_type: this.phys.boilerIsElectric ? 'electric' : 'fuel',
      boiler_type_set: (eq.boiler?.fuel_type ?? null) !== null,
      shower_heating_kwh: 0, total_cost: 0,
      min_water_temp: 999, max_water_temp: -999, avg_water_temp: 0,
      min_water_temp_open: 999, max_water_temp_open: -999, avg_water_temp_open: 0,
      target_open_min: null, target_open_max: null,
      target_hours_schedule: 0, target_hours_default: 0,
      target_default: this.configDefaultTarget(), target_offset: this.targetOffset(),
      strategy_requested: strategyRequested,
      strategy_used: eq.control_strategy ?? 'reactive',
      weather_hours_missing_wind: 0, weather_hours_missing_humidity: 0, weather_hours_missing_air_temp: 0,
      solar_days_missing: 0, expected_hours: 0, weather_coverage_pct: null,
      days_below_27: 0, days_below_26: 0, avg_cop: 0,
    };
    const hourly: HourlyRow[] = [];
    const daily: DailyResult[] = [];
    let day: DailyResult | null = null;
    let currentDay: string | null = null;
    let currentWaterTemp: number | null = null;
    let prevTargetTemp: number | null = null;
    this.closedPlan = null;

    const weather = this.weather;
    const total = weather.length;
    let lastSolarCheckDate: string | null = null;
    let lastProgressMonth: string | null = null;
    let hpHoursRounded = 0;
    const startDate = inp.start_date;
    const finalizeDay = (d: DailyResult) => {
      if (d.hours > 0) {
        d.avg_air_temp /= d.hours;
        d.avg_water_temp /= d.hours;
      }
      return d;
    };

    for (let hourIndex = 0; hourIndex < total; hourIndex++) {
      const row = weather[hourIndex];
      const utc = row[0];
      const timestamp = row[1];
      const tsMs = parseNaive(timestamp);
      let date = timestamp.slice(0, 10);
      const solarDate = utc.slice(0, 10);
      const solarHour = +utc.slice(11, 13);

      if (progress) {
        const month = timestamp.slice(0, 7);
        if (month !== lastProgressMonth) {
          lastProgressMonth = month;
          progress(month, hourIndex, total);
        }
      }

      if (row[3] === null) s.weather_hours_missing_wind++;
      if (row[4] === null) s.weather_hours_missing_humidity++;
      if (row[2] === null) s.weather_hours_missing_air_temp++;
      if (this.hasSolar && solarDate !== lastSolarCheckDate && solarDate >= startDate) {
        lastSolarCheckDate = solarDate;
        if (this.solar[solarDate] === undefined && this.solar[solarDate + ' 12:00:00'] === undefined) {
          s.solar_days_missing++;
        }
      }

      let targetTemp: number | null = null;
      let targetSource: string | null = null;
      if (this.sched) {
        const period = this.sched.getCurrentPeriod(tsMs);
        if (period) {
          targetTemp = period.target_temp;
          targetSource = period.target_source ?? 'schedule';
        }
      }

      if (currentWaterTemp === null) {
        let w: number | null = targetTemp;
        if (w === null && this.sched) {
          w = this.sched.findNextOpening(tsMs).target_temp ?? null;
        }
        currentWaterTemp = w ?? this.fallbackTarget();
      }

      const hourlySolar = this.solarForHour(solarDate, solarHour);
      const waterTempStart = currentWaterTemp;
      const airTemp = this.air(row);
      const losses: Losses = this.phys.heatLosses(currentWaterTemp, airTemp, this.wind(row), this.hum(row),
                                                  targetTemp !== null, this.tunnel(row));
      const solarGain = this.phys.solarGain(hourlySolar, targetTemp !== null);
      const netRequirement = losses.total - solarGain;

      const controlStrategy = this.strategy();
      let effectiveTarget: number | null = targetTemp;
      let isPreheat = false;

      if (controlStrategy === 'predictive') {
        if (hourIndex === 0 && targetTemp === null && this.closedPlan === null) {
          this.closedPlan = this.planClosedPeriod(tsMs, currentWaterTemp, hourIndex);
        }
        if (prevTargetTemp !== null && targetTemp === null) {
          this.closedPlan = this.planClosedPeriod(tsMs, currentWaterTemp, hourIndex);
        }
        // Planning on forecasts: a newer forecast -> plan again (see PHP)
        if (this.forecast !== null && targetTemp === null && this.closedPlan !== null
            && this.newestRunAt(utc) !== (this.closedPlan.forecast_run ?? null)) {
          this.closedPlan = this.planClosedPeriod(tsMs, currentWaterTemp, hourIndex);
          this.fs.replans++;
        }
        if (targetTemp === null && this.closedPlan === null) {
          if (this.standbyCheckDate !== date) {
            this.standbyCheckDate = date;
            this.standbyPlanAt = this.standbyPlanStart(tsMs, currentWaterTemp, hourIndex);
          }
          if (this.standbyPlanAt !== null && unix(tsMs) >= this.standbyPlanAt) {
            this.closedPlan = this.planClosedPeriod(tsMs, currentWaterTemp, hourIndex);
            this.standbyPlanAt = null;
          }
        }
        if (prevTargetTemp === null && targetTemp !== null) {
          const bankHours = this.closedPlan?.bank_hours ?? 0;
          this.openPreheat = bankHours > 0;
          this.openBankEnd = hourIndex + bankHours;
          this.openMaxTemp = this.closedPlan?.max_temp ?? this.maxTemp(targetTemp);
          this.closedPlan = null;
          date = timestamp.slice(0, 10);
        }
        prevTargetTemp = targetTemp;
      }

      let heatingMode = 'reactive';
      const tmr = (this.tmr && this.tmr > 0) ? this.tmr : 1.0;
      let heating: Heating;

      if (controlStrategy === 'predictive' && targetTemp === null && this.closedPlan !== null) {
        const plan = this.closedPlan;
        const isRamp = hourIndex >= (plan.start_index ?? hourIndex);
        const holdTemp = isRamp ? plan.t_req : plan.min_temp;
        heatingMode = isRamp ? 'preheat_ramp' : 'preheat_coast';
        effectiveTarget = holdTemp;
        isPreheat = currentWaterTemp < holdTemp - 0.1;
        heating = this.heatPumpToHold(holdTemp, netRequirement, airTemp, currentWaterTemp, tmr);
      } else if (controlStrategy === 'predictive' && targetTemp !== null && this.openPreheat && hourIndex < this.openBankEnd) {
        heatingMode = 'open_preheat';
        const maxTemp = this.openMaxTemp ?? this.maxTemp(targetTemp);
        effectiveTarget = targetTemp;
        isPreheat = currentWaterTemp > targetTemp + 0.1;
        heating = this.openPreheatHeating(targetTemp, maxTemp, netRequirement, airTemp, currentWaterTemp, tmr);
      } else if (controlStrategy === 'predictive' && targetTemp === null && this.closedPlan === null
                 && (eq.standby_temp ?? null) !== null) {
        heatingMode = 'standby';
        effectiveTarget = num(eq.standby_temp, 0) as number;
        heating = this.standbyHeating(effectiveTarget, netRequirement, airTemp, currentWaterTemp, tmr);
      } else {
        if (controlStrategy === 'predictive' && targetTemp !== null) heatingMode = 'open_hold';
        heating = this.calculateHeating(netRequirement, airTemp, effectiveTarget, currentWaterTemp);
      }

      const heatBalance = solarGain + heating.total_heat - losses.total;
      const tempChange = this.phys.tempChange(heatBalance, 1.0);
      if (currentWaterTemp + tempChange < 5 && losses.total > 0) {
        const excess = Math.min(losses.total, (5 - (currentWaterTemp + tempChange)) * tmr);
        const scale = (losses.total - excess) / losses.total;
        losses.evaporation *= scale; losses.convection *= scale; losses.radiation *= scale;
        losses.cover *= scale; losses.floor *= scale; losses.walls *= scale; losses.total *= scale;
      }
      currentWaterTemp += tempChange;
      currentWaterTemp = Math.max(5, Math.min(35, currentWaterTemp));

      const hpElecRounded = phpRound(heating.hp_electricity, 3);
      hourly.push([
        timestamp, airTemp, this.wind(row), this.hum(row), hourlySolar, targetTemp,
        phpRound(currentWaterTemp, 2), phpRound(waterTempStart, 4), targetTemp !== null ? 1 : 0,
        phpRound(losses.total, 3), phpRound(solarGain, 3), phpRound(heating.hp_heat, 3),
        phpRound(heating.boiler_heat, 3), hpElecRounded, phpRound(heating.boiler_fuel, 3),
        phpRound(heating.hp_cop, 2), phpRound(heating.cost, 2), heatingMode, effectiveTarget,
      ]);
      if (hpElecRounded > 0) hpHoursRounded++;

      if (date !== currentDay) {
        if (currentDay !== null && day) daily.push(finalizeDay(day));
        currentDay = date;
        day = {
          date, hours: 0, open_hours: 0, avg_air_temp: 0, avg_water_temp: 0,
          min_water_temp: 999, min_water_temp_open: 999, max_shortfall_open: null,
          total_loss_kwh: 0, total_solar_kwh: 0, total_hp_kwh: 0, total_boiler_kwh: 0,
          hp_thermal_kwh: 0, boiler_thermal_kwh: 0, total_cost: 0,
        };
      }
      const d = day as DailyResult;
      d.hours++;
      d.open_hours += targetTemp !== null ? 1 : 0;
      d.avg_air_temp += airTemp;
      d.avg_water_temp += currentWaterTemp;
      d.min_water_temp = Math.min(d.min_water_temp, currentWaterTemp);
      if (targetTemp !== null) {
        d.min_water_temp_open = Math.min(d.min_water_temp_open, currentWaterTemp);
        const shortfall = targetTemp - currentWaterTemp;
        d.max_shortfall_open = d.max_shortfall_open === null ? shortfall : Math.max(d.max_shortfall_open, shortfall);
      }
      d.total_loss_kwh += losses.total;
      d.total_solar_kwh += solarGain;
      d.total_hp_kwh += heating.hp_electricity;
      d.total_boiler_kwh += heating.boiler_fuel;
      d.hp_thermal_kwh += heating.hp_heat;
      d.boiler_thermal_kwh += heating.boiler_heat;
      d.total_cost += heating.cost;

      s.total_hours++;
      s.open_hours += targetTemp !== null ? 1 : 0;
      s.evaporation_kwh += losses.evaporation;
      s.convection_kwh += losses.convection;
      s.radiation_kwh += losses.radiation;
      s.cover_loss_kwh += losses.cover;
      s.floor_loss_kwh += losses.floor;
      s.wall_loss_kwh += losses.walls;
      s.total_heat_loss_kwh += losses.total;
      s.total_solar_gain_kwh += solarGain;
      s.hp_thermal_kwh += heating.hp_heat;
      s.boiler_thermal_kwh += heating.boiler_heat;
      s.unmet_kwh += heating.unmet_heat ?? 0;
      s.total_hp_energy_kwh += heating.hp_electricity;
      s.total_boiler_energy_kwh += heating.boiler_fuel;
      if (this.phys.boilerIsElectric) {
        s.total_electricity_kwh += heating.hp_electricity + heating.boiler_fuel;
      } else {
        s.total_electricity_kwh += heating.hp_electricity;
        s.total_fuel_kwh += heating.boiler_fuel;
      }
      s.total_cost += heating.cost;
      s.min_water_temp = Math.min(s.min_water_temp, currentWaterTemp);
      s.max_water_temp = Math.max(s.max_water_temp, currentWaterTemp);
      s.avg_water_temp += currentWaterTemp;
      if (targetTemp !== null) {
        s.target_open_min = s.target_open_min === null ? targetTemp : Math.min(s.target_open_min, targetTemp);
        s.target_open_max = s.target_open_max === null ? targetTemp : Math.max(s.target_open_max, targetTemp);
        if (targetSource === 'default') s.target_hours_default++;
        else s.target_hours_schedule++;
        s.min_water_temp_open = Math.min(s.min_water_temp_open, currentWaterTemp);
        s.max_water_temp_open = Math.max(s.max_water_temp_open, currentWaterTemp);
        s.avg_water_temp_open += currentWaterTemp;
      }
      if (isPreheat) s.preheat_hours = (s.preheat_hours ?? 0) + 1;
      if (heating.hp_electricity > 0) s.avg_cop += heating.hp_cop;
    }

    if (currentDay !== null && day && day.hours > 0) daily.push(finalizeDay(day));

    s.days_below_mode = 'relative_to_target';
    s.days_below_threshold1_delta = 1.0;
    s.days_below_threshold2_delta = 2.0;
    for (const d of daily) {
      if ((d.open_hours ?? 0) <= 0 || d.max_shortfall_open === null) continue;
      if (d.max_shortfall_open > 1.0 + 1e-6) s.days_below_27++;
      if (d.max_shortfall_open > 2.0 + 1e-6) s.days_below_26++;
    }

    if (s.total_hours > 0) s.avg_water_temp /= s.total_hours;
    if ((s.open_hours ?? 0) > 0) s.avg_water_temp_open /= s.open_hours;
    else s.avg_water_temp_open = s.avg_water_temp;
    if (s.min_water_temp === 999) s.min_water_temp = 0;
    if (s.max_water_temp === -999) s.max_water_temp = 0;
    if (s.min_water_temp_open === 999) s.min_water_temp_open = s.min_water_temp;
    if (s.max_water_temp_open === -999) s.max_water_temp_open = s.max_water_temp;
    if (s.total_hp_energy_kwh > 0 && hpHoursRounded > 0) s.avg_cop = s.avg_cop / hpHoursRounded;

    const expected = (Math.trunc((Date.parse(inp.end_date + 'T00:00:00Z') - Date.parse(inp.start_date + 'T00:00:00Z')) / 86400000) + 1) * 24;
    s.expected_hours = expected;
    s.weather_coverage_pct = expected > 0 ? phpRound(100 * s.total_hours / expected, 1) : null;

    if (this.forecast !== null) {
      const fs = this.fs;
      s.planning_weather = 'forecast';
      s.forecast_source = this.forecast.source;
      s.forecast_plans = fs.plans;
      s.forecast_replans = fs.replans;
      s.forecast_plans_without = fs.plans_without;
      s.forecast_age_h_avg = fs.plans > 0 ? phpRound(fs.age_sum / fs.plans, 1) : null;
      s.forecast_hours_beyond = fs.hours_beyond;
    }

    for (const k of Object.keys(s)) {
      if (typeof s[k] === 'number') s[k] = phpRound(s[k], 2);
    }
    return { version: PORT_OF_VERSION, summary: s, daily, hourly };
  }
}

/**
 * Details hour panel: one hour of a run recomputed from its inputs, at the
 * hour's start water temperature and the run's open state.
 */
export function debugHour(inputs: RunInputs, localTs: string, waterTemp: number | null,
                          isOpen: boolean | null): Record<string, any> {
  return new Run(inputs).debugHour(localTs, waterTemp, isOpen);
}

export function runSimulation(inputs: RunInputs, progress?: ProgressFn): RunResult {
  if (!inputs || inputs.format !== 1) throw new Error('Unsupported simulator inputs');
  return new Run(inputs).run(progress);
}

/** Daily results as simulation_daily_results stores them (compact, for upload). */
export function storedDailyRows(daily: DailyResult[]): StoredDayRow[] {
  return daily.map(d => [
    d.date, d.hours, d.open_hours, phpRound(d.avg_air_temp, 2), phpRound(d.avg_water_temp, 2),
    phpRound(d.total_loss_kwh, 3), phpRound(d.total_solar_kwh, 3), phpRound(d.total_hp_kwh, 3),
    phpRound(d.total_boiler_kwh, 3), phpRound(d.hp_thermal_kwh ?? 0, 3), phpRound(d.boiler_thermal_kwh ?? 0, 3),
    phpRound(d.total_cost, 2),
  ]);
}
