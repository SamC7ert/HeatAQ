// Port of EnergySimulator::runSimulation() and its predictive-control helpers
// (lib/EnergySimulator.php). Runs on EnergySimulator::exportRunInputs().
// Kept structurally parallel to the PHP so the two can be compared line by
// line; see docs/PREDICTIVE_CONTROL.md for the control logic.

import type { DailyResult, Heating, HourlyRow, Losses, ProgressFn, RunInputs, RunResult, StoredDayRow, WeatherRow } from './types';
import { Physics, distributeSolarToHour } from './physics';
import { Scheduler } from './scheduler';
import { addHours, num, parseNaive, phpRound, unix } from './util';

export const PORT_OF_VERSION = '3.16.1';

interface ClosedPlan {
  preheat: boolean;
  target: number;
  t_req: number;
  start_offset: number;
  min_temp: number;
  max_temp: number;
  buffer_energy: number;
  start_index?: number;
  hours_to_open?: number;
  open_duration?: number;
}

const ZERO_HEATING = (): Heating => ({
  hp_heat: 0, hp_electricity: 0, hp_cop: 0, boiler_heat: 0, boiler_fuel: 0,
  total_heat: 0, cost: 0, requested_heat: 0,
});

/** EnergySimulator::computeClosedPlan (pure). */
export function computeClosedPlan(waterTemp: number, target: number, minTemp: number, maxTemp: number, tmr: number,
                                  closedLoss: number[], closedHpOut: number[], openDemand: number, openHpDeliver: number): ClosedPlan {
  const hoursToOpen = closedLoss.length;
  if (openDemand <= openHpDeliver + 1e-9) {
    return { preheat: false, target, t_req: target, start_offset: 0, min_temp: minTemp, max_temp: maxTemp, buffer_energy: 0.0 };
  }
  const bufferEnergy = openDemand - openHpDeliver;
  const tReq = Math.min(target + bufferEnergy / tmr, maxTemp);
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
  return { preheat: true, target, t_req: tReq, start_offset: startOffset, min_temp: minTemp, max_temp: maxTemp, buffer_energy: bufferEnergy };
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

  constructor(private inputs: RunInputs) {
    this.pool = inputs.pool_config || {};
    this.eq = inputs.equipment || {};
    this.phys = new Physics(this.pool, this.eq, num(inputs.ground_factor, 1) as number);
    this.sched = inputs.schedule ? new Scheduler(inputs.schedule) : null;
    this.tmr = num(inputs.thermal_mass_rate, null);
    this.weather = inputs.weather;
    this.solar = inputs.solar || {};
    this.hasSolar = Object.keys(this.solar).length > 0;
  }

  // ---- targets ----
  private configDefaultTarget(): number { return num(this.eq.target_temp, 28.0) as number; }
  private targetOffset(): number { return num(this.eq.target_offset, 0.0) as number; }
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
    const afterHp = net - hp.heat;
    let boiler = { heat: 0, fuel: 0, cost: 0 };
    if (water <= target + 0.01 && afterHp > 0) {
      const boilerReq = afterHp + Math.max(0.0, (target - water) * tmr);
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
    const upperTol = num(this.eq.upper_tolerance, 1.0) as number;
    const lowerTol = num(this.eq.lower_tolerance, 2.0) as number;
    const maxTemp = num(this.pool.max_temp, target + upperTol) as number;
    const minTemp = num(this.pool.min_temp, target - lowerTol) as number;
    const hpCapacity = num(this.eq.heat_pump?.capacity_kw, 0) as number;

    const hoursToOpen = Math.max(1, phpRound((unix(next.datetime) - unix(nowMs)) / 3600));
    const openIdx = idx + hoursToOpen;
    const n = this.weather.length;

    const closedLoss: number[] = [];
    const closedHpOut: number[] = [];
    for (let i = 0; i < hoursToOpen; i++) {
      const j = idx + i;
      if (j >= n) break;
      const h = this.weather[j];
      const air = this.air(h);
      const loss = this.phys.heatLosses(target, air, this.wind(h), this.hum(h), false, this.tunnel(h));
      closedLoss.push(loss.total - this.planningSolarGain(h, false));
      closedHpOut.push(this.phys.applyHeatPump(hpCapacity, air).heat);
    }

    let openDemand = 0.0, openHpDeliver = 0.0, openDuration = 0;
    for (let k = 0; k < 48; k++) {
      const j = openIdx + k;
      if (j >= n) break;
      const dt = k > 0 ? addHours(next.datetime, k) : next.datetime;
      if (this.sched.getCurrentPeriod(dt) === null) break;
      const h = this.weather[j];
      const air = this.air(h);
      const loss = this.phys.heatLosses(target, air, this.wind(h), this.hum(h), true, this.tunnel(h));
      openDemand += loss.total - this.planningSolarGain(h, true);
      openHpDeliver += this.phys.applyHeatPump(hpCapacity, air).heat;
      openDuration++;
    }

    const plan = computeClosedPlan(waterTemp, target, minTemp, maxTemp, tmr, closedLoss, closedHpOut, openDemand, openHpDeliver);
    plan.start_index = idx + (plan.start_offset ?? 0);
    plan.hours_to_open = closedLoss.length;
    plan.open_duration = openDuration;
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
    for (let k = 0; k <= hoursToOpen && k < 14 * 24 && this.weather[idx + k] !== undefined; k++) {
      if (w >= target) { needed = k; break; }
      const h = this.weather[idx + k];
      const air = this.air(h);
      const loss = this.phys.heatLosses(w, air, this.wind(h), this.hum(h), false, null).total;
      const gain = hpCap > 0 ? this.phys.applyHeatPump(hpCap, air).heat : 0;
      w += (gain - loss) / tmr;
    }
    if (needed === null) needed = 14 * 24;
    return openTs - (needed + 12) * 3600;
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
          this.openPreheat = !!(this.closedPlan && this.closedPlan.preheat);
          this.openMaxTemp = this.closedPlan?.max_temp
            ?? num(this.pool.max_temp, targetTemp + (num(eq.upper_tolerance, 1.0) as number));
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
        let holdTemp: number;
        if (plan.preheat) {
          const isRamp = hourIndex >= (plan.start_index ?? hourIndex);
          holdTemp = isRamp ? plan.t_req : plan.min_temp;
          heatingMode = isRamp ? 'preheat_ramp' : 'preheat_coast';
        } else {
          holdTemp = plan.target;
          heatingMode = 'closed_hold';
        }
        effectiveTarget = holdTemp;
        isPreheat = currentWaterTemp < holdTemp - 0.1;
        heating = this.heatPumpToHold(holdTemp, netRequirement, airTemp, currentWaterTemp, tmr);
      } else if (controlStrategy === 'predictive' && targetTemp !== null && this.openPreheat) {
        heatingMode = 'open_preheat';
        const maxTemp = this.openMaxTemp ?? num(this.pool.max_temp, targetTemp + 1.0) as number;
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

    for (const k of Object.keys(s)) {
      if (typeof s[k] === 'number') s[k] = phpRound(s[k], 2);
    }
    return { version: PORT_OF_VERSION, summary: s, daily, hourly };
  }
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
