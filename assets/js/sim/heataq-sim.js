"use strict";
var HeatAQSim = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    MODE_CODES: () => MODE_CODES,
    PORT_OF_VERSION: () => PORT_OF_VERSION,
    checkRules: () => checkRules,
    compareReference: () => compareReference,
    computeClosedPlan: () => computeClosedPlan,
    debugHour: () => debugHour,
    phpRound: () => phpRound,
    referenceResult: () => referenceResult,
    runSimulation: () => runSimulation,
    storedDailyRows: () => storedDailyRows
  });

  // src/util.ts
  var HOUR = 3600 * 1e3;
  var DAY = 24 * HOUR;
  function parseNaive(s) {
    const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    const h = s.length > 10 ? +s.slice(11, 13) : 0;
    const mi = s.length > 13 ? +s.slice(14, 16) : 0;
    const se = s.length > 16 ? +s.slice(17, 19) : 0;
    return Date.UTC(y, m - 1, d, h, mi, se);
  }
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function fmtDate(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function hourOf(ms) {
    return new Date(ms).getUTCHours();
  }
  function isoDow0(ms) {
    return (new Date(ms).getUTCDay() + 6) % 7;
  }
  function startOfDay(ms) {
    return Math.floor(ms / DAY) * DAY;
  }
  function addHours(ms, h) {
    return ms + h * HOUR;
  }
  function addDays(ms, d) {
    return ms + d * DAY;
  }
  function unix(ms) {
    return Math.floor(ms / 1e3);
  }
  function phpRound(value, precision = 0) {
    if (!isFinite(value)) return value;
    const f = Math.pow(10, precision);
    let tmp = Math.abs(value) * f;
    if (tmp >= 1e15) return value;
    tmp = parseFloat(tmp.toPrecision(15));
    const r = Math.floor(tmp + 0.5);
    return (Math.sign(value) || 1) * (r / f);
  }
  function num(v, fallback = null) {
    if (v === null || v === void 0 || v === "") return fallback;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function truthy(v) {
    return !(v === null || v === void 0 || v === false || v === 0 || v === "" || v === "0");
  }

  // src/physics.ts
  var WATER_DENSITY = 1e3;
  var WATER_SPECIFIC_HEAT = 4186;
  var STEFAN_BOLTZMANN = 567e-10;
  var WATER_EMISSIVITY = 0.95;
  var LATENT_HEAT_VAPORIZATION = 2454e3;
  var AIR_SPECIFIC_HEAT = 1005;
  var ATM_PRESSURE = 101325;
  var MOLECULAR_RATIO = 0.622;
  var Q_POOL_FLUX = 1.51;
  var U_WALLS = 0.58;
  var T_REF_LOW = 5;
  var T_REF_HIGH = 28;
  var Physics = class {
    constructor(pool, equipment, groundFactor) {
      this.area = num(pool.area_m2, 0);
      this.hasCover = truthy(pool.has_cover ?? false);
      this.coverU = num(pool.cover_r_value, 5);
      this.windFactor = num(pool.wind_exposure_factor, 1);
      this.absorptivity = num(pool.solar_absorption, 0.6);
      this.coverTransmittance = num(pool.cover_solar_transmittance, 0.1);
      this.activityFactor = num(equipment.bathers?.activity_factor, null);
      this.groundFactor = groundFactor;
      this.length = num(pool.length_m, Math.sqrt(this.area * 2));
      this.width = num(pool.width_m, Math.sqrt(this.area / 2));
      this.depth = num(pool.depth_m, 1.5);
      this.volume = num(pool.volume_m3, 0);
      const hp = equipment.heat_pump || {};
      this.hpEnabled = truthy(hp.enabled);
      this.hpType = hp.type ?? "ground_source";
      this.hpCapacity = num(hp.capacity_kw, 0);
      this.hpCopNominal = num(hp.cop_nominal, 4.6);
      this.hpMinOp = num(hp.min_operating_temp, null);
      this.hpMaxOp = num(hp.max_operating_temp, null);
      this.elecPrice = num(equipment.electricity_cost_per_kwh, 0);
      const b = equipment.boiler || {};
      this.boilerEnabled = truthy(b.enabled);
      this.boilerCapacity = num(b.capacity_kw, 0);
      this.boilerEfficiency = num(b.efficiency, 0);
      this.boilerElectric = (b.fuel_type ?? null) === "electric";
      this.fuelPrice = num(b.fuel_cost_per_kwh, 0);
    }
    get boilerIsElectric() {
      return this.boilerElectric;
    }
    /** Settings shown by the Details hour panel */
    get settings() {
      return {
        hasCover: this.hasCover,
        coverU: this.coverU,
        windFactor: this.windFactor,
        absorptivity: this.absorptivity,
        coverTransmittance: this.coverTransmittance,
        length: this.length,
        width: this.width,
        depth: this.depth,
        hpEnabled: this.hpEnabled,
        hpType: this.hpType,
        hpCapacity: this.hpCapacity,
        hpMinOp: this.hpMinOp,
        boilerEnabled: this.boilerEnabled,
        boilerCapacity: this.boilerCapacity,
        boilerEfficiency: this.boilerEfficiency
      };
    }
    get boilerOn() {
      return this.boilerEnabled;
    }
    heatLosses(waterTemp, airTemp, windSpeed, humidity, isOpen, tunnelTemp, detail) {
      const isCovered = this.hasCover && !isOpen;
      const [floor, walls] = this.structural(waterTemp, tunnelTemp);
      let evap = 0, conv = 0, rad = 0, cover = 0;
      if (isCovered) {
        cover = this.coverLoss(waterTemp, airTemp, windSpeed);
      } else {
        const e = this.evaporation(waterTemp, airTemp, humidity, windSpeed, isOpen);
        evap = e.loss;
        const c = this.convection(waterTemp, airTemp, e.deltaP, e.lossRaw);
        conv = c.loss;
        rad = this.radiation(waterTemp, airTemp);
        if (detail) {
          detail.p_water_pa = e.pWater;
          detail.p_air_pa = e.pAirActual;
          detail.delta_p_pa = e.deltaP;
          detail.v_eff_ms = e.vEff;
          detail.activity_factor = e.activity;
          detail.temp_diff_k = c.tempDiff;
          detail.bowen_ratio = c.bowen;
        }
      }
      const total = evap + conv + rad + cover + floor + walls;
      return {
        evaporation: Math.max(0, evap),
        convection: Math.max(0, conv),
        radiation: Math.max(0, rad),
        cover: Math.max(0, cover),
        floor: Math.max(0, floor),
        walls: Math.max(0, walls),
        total: Math.max(0, total)
      };
    }
    coverLoss(waterTemp, airTemp, windSpeed) {
      const uRated = this.coverU;
      const vEff = windSpeed * this.windFactor;
      const hNatural = 7;
      const hWind = 5.7 + 3.8 * vEff;
      let uEff = uRated;
      if (uRated > 0 && hNatural > 0 && hWind > 0) {
        const rTotal = 1 / uRated - 1 / hNatural + 1 / hWind;
        if (rTotal > 0) uEff = 1 / rTotal;
      }
      uEff = Math.max(uEff, uRated);
      const loss = uEff * this.area * (waterTemp - airTemp) / 1e3;
      return Math.max(0, loss);
    }
    evaporation(waterTemp, airTemp, humidity, windSpeed, isOpen) {
      const pWater = 611.2 * Math.exp(17.67 * waterTemp / (waterTemp + 243.5));
      const pAirSat = 611.2 * Math.exp(17.67 * airTemp / (airTemp + 243.5));
      const pAirActual = pAirSat * (humidity / 100);
      const deltaP = pWater - pAirActual;
      const vEff = windSpeed * this.windFactor;
      const windCoeff = 0.28 + 0.784 * vEff;
      let evapPerM2 = windCoeff * Math.pow(Math.max(0, deltaP), 0.695) / LATENT_HEAT_VAPORIZATION;
      const activity = isOpen ? this.activityFactor ?? 1 : 1;
      evapPerM2 *= activity;
      const lossRaw = evapPerM2 * this.area * LATENT_HEAT_VAPORIZATION / 1e3;
      return { loss: Math.max(0, lossRaw), lossRaw, deltaP, pWater, pAirActual, vEff, activity };
    }
    convection(waterTemp, airTemp, deltaPIn, evapLoss) {
      const tempDiff = waterTemp - airTemp;
      let deltaP = deltaPIn;
      if (Math.abs(deltaP) < 1) deltaP = deltaP >= 0 ? 1 : -1;
      const numr = AIR_SPECIFIC_HEAT * ATM_PRESSURE * tempDiff;
      const den = MOLECULAR_RATIO * LATENT_HEAT_VAPORIZATION * deltaP;
      const bowen = den !== 0 ? numr / den : 0;
      return { loss: Math.max(0, bowen * evapLoss), bowen, tempDiff };
    }
    radiation(waterTemp, airTemp) {
      const tW = waterTemp + 273.15;
      const tS = airTemp - 10 + 273.15;
      const loss = STEFAN_BOLTZMANN * WATER_EMISSIVITY * this.area * (Math.pow(tW, 4) - Math.pow(tS, 4));
      return Math.max(0, loss / 1e3);
    }
    structural(waterTemp, tunnelTemp) {
      const qFlux = Q_POOL_FLUX * this.groundFactor;
      const tempScale = (waterTemp - T_REF_LOW) / (T_REF_HIGH - T_REF_LOW);
      const floor = qFlux * this.area * tempScale / 1e3;
      const tunnelRef = tunnelTemp ?? 15;
      const wallArea = 2 * (this.length + this.width) * this.depth;
      const walls = U_WALLS * wallArea * (waterTemp - tunnelRef) / 1e3;
      return [Math.max(0, floor), Math.max(0, walls)];
    }
    solarGain(irradiance, isOpen) {
      if (this.hasCover && !isOpen) {
        return irradiance * this.area * this.absorptivity * this.coverTransmittance;
      }
      return irradiance * this.area * this.absorptivity;
    }
    heatPumpCop(airTemp) {
      if (this.hpType === "ground_source") return this.hpCopNominal;
      const diff = airTemp - 15;
      let cop;
      if (diff < 0) {
        cop = this.hpCopNominal * (1 - 0.025 * Math.abs(diff));
      } else {
        cop = this.hpCopNominal * (1 + Math.min(0.2, 0.01 * diff));
      }
      return Math.max(2, cop);
    }
    applyHeatPump(requiredHeat, airTemp) {
      if (!this.hpEnabled) return { heat: 0, electricity: 0, cop: 0, cost: 0 };
      if (this.hpType === "air_source") {
        const belowMin = this.hpMinOp === null ? false : airTemp < this.hpMinOp;
        const aboveMax = this.hpMaxOp === null ? airTemp !== 0 : airTemp > this.hpMaxOp;
        if (belowMin || aboveMax) {
          return { heat: 0, electricity: 0, cop: 0, cost: 0 };
        }
      }
      const cop = this.heatPumpCop(airTemp);
      const heat = Math.min(requiredHeat, this.hpCapacity);
      const electricity = heat / cop;
      return { heat, electricity, cop, cost: electricity * this.elecPrice };
    }
    applyBoiler(requiredHeat) {
      if (!this.boilerEnabled) return { heat: 0, fuel: 0, cost: 0 };
      const heat = Math.min(requiredHeat, this.boilerCapacity);
      const fuel = heat / this.boilerEfficiency;
      const price = this.boilerElectric ? this.elecPrice : this.fuelPrice;
      return { heat, fuel, cost: fuel * price };
    }
    heatForTempRise(tempDiff, hours) {
      if (tempDiff <= 0) return 0;
      if (this.volume <= 0) return 0;
      const mass = this.volume * WATER_DENSITY;
      const energy = mass * WATER_SPECIFIC_HEAT * tempDiff / 1e3;
      return energy / (hours * 3600);
    }
    tempChange(heatBalanceKW, hours) {
      if (this.volume <= 0) return 0;
      const mass = this.volume * WATER_DENSITY;
      const energy = heatBalanceKW * hours * 3600;
      return energy / (mass * WATER_SPECIFIC_HEAT / 1e3);
    }
  };
  function distributeSolarToHour(dailyTotal, hour) {
    if (hour < 6 || hour > 20) return 0;
    const f = (h) => Math.exp(-0.5 * Math.pow((h - 12) / 4, 2));
    let total = 0;
    for (let h = 6; h <= 20; h++) total += f(h);
    return dailyTotal * (f(hour) / total);
  }

  // src/scheduler.ts
  var DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var Scheduler = class {
    constructor(state) {
      this.holidayDates = {};
      this.cache = /* @__PURE__ */ new Map();
      this.state = state;
      for (const [refId, years] of Object.entries(state.holiday_dates || {})) {
        const r = {};
        for (const [y, d] of Object.entries(years)) r[+y] = d;
        this.holidayDates[+refId] = r;
      }
    }
    get templateName() {
      return String(this.state.template?.name ?? "");
    }
    /** Easter Sunday ('Y-m-d') - stored reference dates, else the algorithm. */
    easterDate(year) {
      const stored = this.holidayDates[1]?.[year];
      if (stored) return stored;
      const a = year % 19, b = Math.floor(year / 100), c = year % 100;
      const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
      const g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30;
      const i = Math.floor(c / 4), k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7;
      const m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31);
      const day = (h + l - 7 * m + 114) % 31 + 1;
      return fmtDate(Date.UTC(year, month - 1, day));
    }
    checkExceptionDays(ms) {
      const d = new Date(ms);
      const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
      const dateStr = fmtDate(ms);
      for (const exc of this.state.exception_days) {
        if (exc.is_moving && exc.easter_offset !== null) {
          const holiday = fmtDate(addDays(parseNaive(this.easterDate(year)), exc.easter_offset));
          if (dateStr === holiday) return exc;
        } else if (exc.fixed_month && exc.fixed_day) {
          if (month === exc.fixed_month && day === exc.fixed_day) return exc;
        }
      }
      return null;
    }
    dateInRange(ms, r) {
      if (r.is_default) return true;
      if (r.is_recurring ?? true) {
        const d = new Date(ms);
        const cur = [d.getUTCMonth() + 1, d.getUTCDate()];
        const from = [r.start_month, r.start_day];
        const to = [r.end_month, r.end_day];
        const le = (x, y) => x[0] < y[0] || x[0] === y[0] && x[1] <= y[1];
        if (le(from, to)) {
          return le(from, cur) && le(cur, to);
        }
        return le(from, cur) || le(cur, to);
      }
      return false;
    }
    /** Name of the day schedule for a date ('_CLOSED_' = closed). */
    getScheduleForDate(ms) {
      const key = fmtDate(ms);
      const hit = this.cache.get(key);
      if (hit !== void 0) return hit;
      const v = this.resolveScheduleForDate(ms, key);
      this.cache.set(key, v);
      return v;
    }
    resolveScheduleForDate(ms, key) {
      const exc = this.checkExceptionDays(ms);
      if (exc) return exc.day_schedule_name;
      for (const r of this.state.date_ranges) {
        if (!this.dateInRange(ms, r)) continue;
        const ws = this.state.week_schedules[String(r.week_schedule_id)];
        if (ws) {
          const name = ws.days[DOW[isoDow0(ms)]];
          if (name) return name;
          if (r.is_default) return "_CLOSED_";
        } else if (r.is_default) {
          return "_CLOSED_";
        }
      }
      throw new Error(`No schedule found for date ${key}. Please configure a Default (Year-Round) schedule in Schedule Management for template '${this.templateName}'.`);
    }
    getPeriods(ms) {
      const name = this.getScheduleForDate(ms);
      const s = this.state.schedules[name];
      return s ? s.periods || [] : [];
    }
    getCurrentPeriod(ms) {
      const hour = hourOf(ms);
      for (const p of this.getPeriods(ms)) {
        if (p.from === p.to) continue;
        if (p.from < p.to) {
          if (hour >= p.from && hour < p.to) return p;
        } else if (hour >= p.from || hour < p.to) {
          return p;
        }
      }
      return null;
    }
    getDailyTransitions(ms) {
      const periods = this.getPeriods(ms);
      if (periods.length === 0) return [];
      const out = [];
      let last = null;
      for (const p of periods) {
        out.push({ time: p.from, type: "open", target_temp: p.target_temp, from_temp: last });
        out.push({ time: p.to, type: "close", target_temp: null, from_temp: p.target_temp });
        last = p.target_temp;
      }
      return out.map((t, i) => ({ t, i })).sort((a, b) => a.t.time - b.t.time || a.i - b.i).map((x) => x.t);
    }
    findNextOpening(ms) {
      const day0 = startOfDay(ms);
      const currentHour = hourOf(ms);
      for (const t of this.getDailyTransitions(day0)) {
        if (t.type === "open" && t.time > currentHour) {
          return { datetime: day0 + t.time * 3600 * 1e3, target_temp: t.target_temp };
        }
      }
      for (let off = 1; off <= 30; off++) {
        const next = addDays(day0, off);
        for (const t of this.getDailyTransitions(next)) {
          if (t.type === "open") {
            return { datetime: next + t.time * 3600 * 1e3, target_temp: t.target_temp };
          }
        }
      }
      return { datetime: null, target_temp: null };
    }
  };

  // src/engine.ts
  var PORT_OF_VERSION = "3.19.0";
  var unixUtc = (ts) => unix(parseNaive(ts));
  var ZERO_HEATING = () => ({
    hp_heat: 0,
    hp_electricity: 0,
    hp_cop: 0,
    boiler_heat: 0,
    boiler_fuel: 0,
    total_heat: 0,
    cost: 0,
    requested_heat: 0
  });
  function computeClosedPlan(waterTemp, target, minTemp, maxTemp, tmr, closedLoss, closedHpOut, openDeficit) {
    const hoursToOpen = closedLoss.length;
    let need = target;
    let bankHours = 0;
    for (let k = openDeficit.length - 1; k >= 0; k--) {
      need = Math.max(target, need + openDeficit[k] / tmr);
      if (bankHours === 0 && openDeficit[k] > 1e-9) bankHours = k + 1;
    }
    const bufferEnergy = (need - target) * tmr;
    const tReq = Math.min(need, maxTemp);
    const coast = [];
    let t = waterTemp;
    for (let i = 0; i < hoursToOpen; i++) {
      coast[i] = t;
      t = Math.max(minTemp, t - closedLoss[i] / tmr);
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
    return {
      preheat: bufferEnergy > 1e-9,
      target,
      t_req: tReq,
      start_offset: startOffset,
      min_temp: minTemp,
      max_temp: maxTemp,
      buffer_energy: bufferEnergy,
      bank_hours: bankHours
    };
  }
  var Run = class {
    constructor(inputs) {
      this.inputs = inputs;
      this.closedPlan = null;
      this.standbyCheckDate = null;
      this.standbyPlanAt = null;
      this.openPreheat = false;
      this.openMaxTemp = null;
      this.openBankEnd = 0;
      // Planning on forecasts (doc §11); null = plans read the actual weather
      this.forecast = null;
      this.planRun = null;
      this.fs = { plans: 0, plans_without: 0, replans: 0, age_sum: 0, hours_beyond: 0 };
      this.pool = inputs.pool_config || {};
      this.eq = inputs.equipment || {};
      this.phys = new Physics(this.pool, this.eq, num(inputs.ground_factor, 1));
      this.sched = inputs.schedule ? new Scheduler(inputs.schedule) : null;
      this.tmr = num(inputs.thermal_mass_rate, null);
      this.weather = inputs.weather;
      this.solar = inputs.solar || {};
      this.hasSolar = Object.keys(this.solar).length > 0;
      if (inputs.forecast && this.strategy() === "predictive" && (this.eq.planning_weather ?? "actual") === "forecast") {
        const runs = inputs.forecast.runs.map((r) => ({
          issued: unixUtc(r[0]),
          available: unixUtc(r[1]),
          first: unixUtc(r[2]),
          air: r[3],
          wind: r[4],
          rh: r[5]
        }));
        this.forecast = { source: inputs.forecast.source, runs, available: runs.map((r) => r.available) };
      }
    }
    // ---- planning on forecasts (EnergySimulator::newestRunAt / selectPlanRun / planningRow) ----
    newestRunAt(utc) {
      if (this.forecast === null) return null;
      const t = unixUtc(utc);
      const avail = this.forecast.available;
      let lo = 0, hi = avail.length - 1, found = -1;
      while (lo <= hi) {
        const mid = lo + hi >> 1;
        if (avail[mid] <= t) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (found < 0) return null;
      const run = this.forecast.runs[found];
      return run.first + (run.air.length - 1) * 3600 >= t ? found : null;
    }
    selectPlanRun(idx, count = true) {
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
    planningRow(idx) {
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
    configDefaultTarget() {
      return num(this.eq.target_temp, 28);
    }
    targetOffset() {
      return num(this.eq.target_offset, 0);
    }
    /** EnergySimulator::maxTemp: target + "Max overheat" (upper_tolerance). */
    maxTemp(target) {
      return target + num(this.eq.upper_tolerance, 1);
    }
    /** EnergySimulator::closedFloor: "Min temp when closed" (standby_temp), else 5 °C; never above target. */
    closedFloor(target) {
      const floor = num(this.eq.standby_temp, null);
      return Math.min(target, floor === null ? 5 : floor);
    }
    fallbackTarget() {
      return this.configDefaultTarget() + this.targetOffset();
    }
    strategy() {
      return this.eq.control_strategy ?? "reactive";
    }
    // ---- weather / solar ----
    air(r) {
      return num(r[2], 0);
    }
    wind(r) {
      return num(r[3], 0);
    }
    hum(r) {
      return num(r[4], 0);
    }
    tunnel(r) {
      return r[5] === null || r[5] === void 0 ? null : Number(r[5]);
    }
    solarForHour(date, hour) {
      const ts = `${date} ${hour < 10 ? "0" + hour : hour}:00:00`;
      const v = this.solar[ts];
      if (v !== void 0) return v;
      return distributeSolarToHour(this.solar[date] ?? 0, hour);
    }
    planningSolarGain(r, isOpen) {
      if (!this.hasSolar) return 0;
      const utc = r[0];
      return this.phys.solarGain(this.solarForHour(utc.slice(0, 10), +utc.slice(11, 13)), isOpen);
    }
    // ---- heating helpers ----
    uncoveredLoss(holdTemp, waterTemp, netRequirement, delivered) {
      if (holdTemp === null || waterTemp > holdTemp + 0.01) return 0;
      return Math.max(0, netRequirement - delivered);
    }
    heatPumpToHold(holdTemp, net, air, water, tmr) {
      const required = Math.max(0, net + (holdTemp - water) * tmr);
      const hp = this.phys.applyHeatPump(required, air);
      return {
        hp_heat: hp.heat,
        hp_electricity: hp.electricity,
        hp_cop: hp.cop,
        boiler_heat: 0,
        boiler_fuel: 0,
        total_heat: hp.heat,
        cost: hp.cost,
        requested_heat: required,
        unmet_heat: this.uncoveredLoss(holdTemp, water, net, hp.heat)
      };
    }
    standbyHeating(standby, net, air, water, tmr) {
      const required = Math.max(0, net + (standby - water) * tmr);
      const hp = this.phys.applyHeatPump(required, air);
      let boiler = { heat: 0, fuel: 0, cost: 0 };
      if (required - hp.heat > 1e-3 && this.phys.boilerOn) {
        boiler = this.phys.applyBoiler(required - hp.heat);
      }
      const total = hp.heat + boiler.heat;
      return {
        hp_heat: hp.heat,
        hp_electricity: hp.electricity,
        hp_cop: hp.cop,
        boiler_heat: boiler.heat,
        boiler_fuel: boiler.fuel,
        total_heat: total,
        cost: hp.cost + boiler.cost,
        requested_heat: required,
        unmet_heat: this.uncoveredLoss(standby, water, net, total)
      };
    }
    openPreheatHeating(target, maxTemp, net, air, water, tmr) {
      const hpReq = Math.max(0, net + (maxTemp - water) * tmr);
      const hp = this.phys.applyHeatPump(hpReq, air);
      let boiler = { heat: 0, fuel: 0, cost: 0 };
      const boilerReq = net + Math.max(0, (target - water) * tmr) - hp.heat;
      if (water <= target + 0.01 && boilerReq > 0) {
        boiler = this.phys.applyBoiler(boilerReq);
      }
      const requested = water <= target + 0.01 ? Math.max(0, net + Math.max(0, (target - water) * tmr)) : 0;
      return {
        hp_heat: hp.heat,
        hp_electricity: hp.electricity,
        hp_cop: hp.cop,
        boiler_heat: boiler.heat,
        boiler_fuel: boiler.fuel,
        total_heat: hp.heat + boiler.heat,
        cost: hp.cost + boiler.cost,
        requested_heat: requested,
        unmet_heat: this.uncoveredLoss(target, water, net, hp.heat + boiler.heat)
      };
    }
    calculateHeating(net, air, targetIn, water) {
      const result = ZERO_HEATING();
      let strategy = this.strategy();
      if (strategy !== "reactive" && strategy !== "predictive") strategy = "reactive";
      let target = targetIn;
      if (strategy === "predictive" && target === null) {
        return result;
      } else if (target === null) {
        target = this.fallbackTarget();
      }
      const tempDiff = target - water;
      let required;
      if (tempDiff > 0) {
        required = net + this.phys.heatForTempRise(tempDiff, 1);
      } else {
        const credit = this.phys.heatForTempRise(Math.abs(tempDiff), 1);
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
    planClosedPeriod(nowMs, waterTemp, idx) {
      if (!this.sched) return null;
      if (!this.tmr || this.tmr <= 0) return null;
      const next = this.sched.findNextOpening(nowMs);
      if (next.datetime === null) return null;
      const tmr = this.tmr;
      const target = next.target_temp ?? this.fallbackTarget();
      const maxTemp = this.maxTemp(target);
      const minTemp = this.closedFloor(target);
      const hpCapacity = num(this.eq.heat_pump?.capacity_kw, 0);
      const hoursToOpen = Math.max(1, phpRound((unix(next.datetime) - unix(nowMs)) / 3600));
      const openIdx = idx + hoursToOpen;
      const n = this.weather.length;
      this.selectPlanRun(idx);
      const closedLoss = [];
      const closedHpOut = [];
      for (let i = 0; i < hoursToOpen; i++) {
        const j = idx + i;
        if (j >= n) break;
        const h = this.planningRow(j);
        const air = this.air(h);
        const loss = this.phys.heatLosses(target, air, this.wind(h), this.hum(h), false, this.tunnel(h));
        closedLoss.push(loss.total - this.planningSolarGain(h, false));
        closedHpOut.push(this.phys.applyHeatPump(hpCapacity, air).heat);
      }
      const openDeficit = [];
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
    standbyPlanStart(nowMs, waterTemp, idx) {
      if (!this.sched) return null;
      const next = this.sched.findNextOpening(nowMs);
      if (next.datetime === null) return null;
      const target = next.target_temp ?? this.fallbackTarget();
      const tmr = this.tmr && this.tmr > 0 ? this.tmr : 1;
      const hpCap = num(this.eq.heat_pump?.capacity_kw, 0);
      const openTs = unix(next.datetime);
      const hoursToOpen = Math.floor((openTs - unix(nowMs)) / 3600);
      let needed = null;
      let w = waterTemp;
      this.selectPlanRun(idx, false);
      for (let k = 0; k <= hoursToOpen && k < 14 * 24 && this.weather[idx + k] !== void 0; k++) {
        if (w >= target) {
          needed = k;
          break;
        }
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
    debugHour(localTs, waterTempIn, isOpenOverride) {
      const row = this.weather.find((r2) => r2[1] === localTs);
      if (!row) return { error: `No weather data for ${localTs} in this run's inputs` };
      if (row[2] === null || row[3] === null || row[4] === null) {
        throw new Error(`Weather for ${localTs} is missing a value (air, wind or humidity)`);
      }
      const utc = row[0];
      const tsMs = parseNaive(localTs);
      const hourlySolar = this.solarForHour(utc.slice(0, 10), +utc.slice(11, 13));
      const solarSource = this.inputs.solar_kind === "none" || !this.hasSolar ? "none" : this.inputs.solar_kind;
      let isOpen = false;
      let targetTemp = null;
      if (isOpenOverride !== null) {
        isOpen = isOpenOverride;
        targetTemp = this.fallbackTarget();
        const period = this.sched ? this.sched.getCurrentPeriod(tsMs) : null;
        if (period && period.target_temp !== void 0 && period.target_temp !== null) targetTemp = period.target_temp;
      } else if (this.sched) {
        const period = this.sched.getCurrentPeriod(tsMs);
        if (period) {
          isOpen = true;
          targetTemp = period.target_temp ?? 28;
        }
      }
      const poolTemp = waterTempIn ?? 28.59;
      const air = this.air(row), wind = this.wind(row), hum = this.hum(row), tunnel = this.tunnel(row);
      const detail = {};
      const losses = this.phys.heatLosses(poolTemp, air, wind, hum, isOpen, tunnel, detail);
      const solarGain = this.phys.solarGain(hourlySolar, isOpen);
      const net = losses.total - solarGain;
      const st = this.phys.settings;
      const strategy = this.strategy();
      const tmr = this.tmr && this.tmr > 0 ? this.tmr : 1;
      let heating;
      let mode;
      if (strategy === "predictive" && !isOpen) {
        heating = this.heatPumpToHold(targetTemp ?? this.fallbackTarget(), net, air, poolTemp, tmr);
        mode = "closed_hold";
      } else {
        heating = this.calculateHeating(net, air, targetTemp, poolTemp);
        mode = strategy === "predictive" ? "open_hold" : "reactive";
      }
      const b = this.eq.bathers || {};
      const bathers = num(b.per_day, null), perVisit = num(b.kwh_per_visit, null), openH = num(b.open_hours, null);
      const waterHeating = bathers !== null && perVisit !== null && openH !== null && openH > 0 ? bathers * perVisit / openH : 0;
      const r = (v, d) => phpRound(v, d);
      const perimeter = num(this.pool.perimeter_m, 2 * (st.length + st.width));
      const isCovered = st.hasCover && !isOpen;
      const tempDiff = (targetTemp ?? 28) - poolTemp;
      const heatToRaise = this.phys.heatForTempRise(Math.max(0, tempDiff), 1);
      const totalHeating = heating.hp_heat + heating.boiler_heat;
      return {
        timestamp: localTs,
        input: {
          date: localTs.slice(0, 10),
          hour: +localTs.slice(11, 13),
          weather: {
            air_temp_c: r(air, 2),
            wind_speed_ms: r(wind, 2),
            humidity_pct: r(hum, 1),
            solar_ghi_wm2: r(hourlySolar * 1e3, 2),
            tunnel_temp_c: tunnel
          },
          pool: {
            water_temp_c: r(poolTemp, 4),
            area_m2: this.phys.area,
            volume_m3: this.phys.volume,
            depth_m: st.depth,
            perimeter_m: r(perimeter, 1),
            wall_area_m2: r(perimeter * st.depth, 1),
            floor_area_m2: this.phys.area,
            target_temp: targetTemp
          },
          config: {
            wind_factor: st.windFactor,
            years_operating: this.pool.years_operating ?? 3,
            has_cover: st.hasCover,
            cover_u_value: st.coverU,
            solar_absorption: st.absorptivity,
            is_open: isOpen,
            target_temp: targetTemp
          }
        },
        losses: {
          evaporation_kw: r(losses.evaporation, 3),
          convection_kw: r(losses.convection, 3),
          radiation_kw: r(losses.radiation, 3),
          cover_kw: r(losses.cover, 3),
          floor_kw: r(losses.floor, 3),
          walls_kw: r(losses.walls, 3),
          total_kw: r(losses.total, 3)
        },
        evaporation: {
          p_water_pa: r(detail.p_water_pa ?? 0, 1),
          p_air_pa: r(detail.p_air_pa ?? 0, 1),
          delta_p_pa: r(detail.delta_p_pa ?? 0, 1),
          v_eff_ms: r(detail.v_eff_ms ?? 0, 2),
          activity_factor: detail.activity_factor ?? 1,
          loss_kw: r(losses.evaporation, 3)
        },
        convection: { temp_diff_k: r(detail.temp_diff_k ?? 0, 2), bowen_ratio: r(detail.bowen_ratio ?? 0, 3), loss_kw: r(losses.convection, 3) },
        radiation: { water_temp_k: r(poolTemp + 273.15, 1), sky_temp_k: r(air - 10 + 273.15, 1), loss_kw: r(losses.radiation, 3) },
        cover: { has_cover: st.hasCover, is_covered: isCovered, u_value: st.coverU, transmittance: st.coverTransmittance, loss_kw: r(losses.cover, 3) },
        solar_gain: { source: solarSource, hourly_kwh_m2: r(hourlySolar, 4), solar_gain_kw: r(solarGain, 3) },
        structural: { floor_kw: r(losses.floor, 3), walls_kw: r(losses.walls, 3), total_kw: r(losses.floor + losses.walls, 3) },
        water_heating: { bathers_per_day: bathers, kwh_per_visit: perVisit, open_hours: openH, water_heating_kw: r(waterHeating, 3) },
        heat_pump: {
          strategy,
          type: st.hpType,
          capacity_kw: st.hpCapacity,
          enabled: st.hpEnabled,
          min_temp_c: st.hpMinOp ?? -20,
          cop: r(heating.hp_cop, 2),
          output_kw: r(heating.hp_heat, 3),
          electricity_kw: r(heating.hp_electricity, 3)
        },
        boiler: {
          capacity_kw: st.boilerCapacity,
          enabled: st.boilerEnabled,
          efficiency: st.boilerEfficiency,
          type: this.phys.boilerIsElectric ? "electric" : "fuel",
          output_kw: r(heating.boiler_heat, 3),
          fuel_kw: r(heating.boiler_fuel, 3)
        },
        heating_summary: {
          net_demand_kw: r(Math.max(0, net), 3),
          hp_output_kw: r(heating.hp_heat, 3),
          boiler_output_kw: r(heating.boiler_heat, 3),
          total_heating_kw: r(totalHeating, 3),
          unmet_kw: r(Math.max(0, net - totalHeating), 3),
          debug_mode: mode
        },
        heating_calc_debug: {
          net_requirement_kw: r(net, 2),
          air_temp_c: r(air, 2),
          target_temp_c: r(targetTemp ?? 28, 2),
          water_temp_c: r(poolTemp, 2),
          volume_m3: this.phys.volume,
          temp_diff_c: r(tempDiff, 2),
          heat_to_raise_kw: r(heatToRaise, 2),
          required_heat_kw: r(net + heatToRaise, 2),
          hp_output_kw: r(heating.hp_heat, 2),
          boiler_output_kw: r(heating.boiler_heat, 2)
        },
        summary: {
          evaporation_kw: r(losses.evaporation, 3),
          convection_kw: r(losses.convection, 3),
          radiation_kw: r(losses.radiation, 3),
          cover_loss_kw: r(losses.cover, 3),
          wall_loss_kw: r(losses.walls, 3),
          floor_loss_kw: r(losses.floor, 3),
          water_heating_kw: r(waterHeating, 3),
          total_loss_kw: r(losses.total, 3),
          solar_gain_kw: r(solarGain, 3),
          net_requirement_kw: r(net, 3)
        },
        pool: { water_temp: poolTemp, thermal_mass: this.tmr }
      };
    }
    // ---- main loop ----
    run(progress) {
      const inp = this.inputs;
      const eq = this.eq;
      const strategyRequested = inp.strategy_requested;
      const s = {
        total_hours: 0,
        open_hours: 0,
        evaporation_kwh: 0,
        convection_kwh: 0,
        radiation_kwh: 0,
        cover_loss_kwh: 0,
        floor_loss_kwh: 0,
        wall_loss_kwh: 0,
        total_heat_loss_kwh: 0,
        total_solar_gain_kwh: 0,
        hp_thermal_kwh: 0,
        boiler_thermal_kwh: 0,
        unmet_kwh: 0,
        total_hp_energy_kwh: 0,
        total_boiler_energy_kwh: 0,
        total_electricity_kwh: 0,
        total_fuel_kwh: 0,
        boiler_type: this.phys.boilerIsElectric ? "electric" : "fuel",
        boiler_type_set: (eq.boiler?.fuel_type ?? null) !== null,
        shower_heating_kwh: 0,
        total_cost: 0,
        min_water_temp: 999,
        max_water_temp: -999,
        avg_water_temp: 0,
        min_water_temp_open: 999,
        max_water_temp_open: -999,
        avg_water_temp_open: 0,
        target_open_min: null,
        target_open_max: null,
        target_hours_schedule: 0,
        target_hours_default: 0,
        target_default: this.configDefaultTarget(),
        target_offset: this.targetOffset(),
        strategy_requested: strategyRequested,
        strategy_used: eq.control_strategy ?? "reactive",
        weather_hours_missing_wind: 0,
        weather_hours_missing_humidity: 0,
        weather_hours_missing_air_temp: 0,
        solar_days_missing: 0,
        expected_hours: 0,
        weather_coverage_pct: null,
        days_below_27: 0,
        days_below_26: 0,
        avg_cop: 0
      };
      const hourly = [];
      const daily = [];
      let day = null;
      let currentDay = null;
      let currentWaterTemp = null;
      let prevTargetTemp = null;
      this.closedPlan = null;
      const weather = this.weather;
      const total = weather.length;
      let lastSolarCheckDate = null;
      let lastProgressMonth = null;
      let hpHoursRounded = 0;
      const startDate = inp.start_date;
      const finalizeDay = (d) => {
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
          if (this.solar[solarDate] === void 0 && this.solar[solarDate + " 12:00:00"] === void 0) {
            s.solar_days_missing++;
          }
        }
        let targetTemp = null;
        let targetSource = null;
        if (this.sched) {
          const period = this.sched.getCurrentPeriod(tsMs);
          if (period) {
            targetTemp = period.target_temp;
            targetSource = period.target_source ?? "schedule";
          }
        }
        if (currentWaterTemp === null) {
          let w = targetTemp;
          if (w === null && this.sched) {
            w = this.sched.findNextOpening(tsMs).target_temp ?? null;
          }
          currentWaterTemp = w ?? this.fallbackTarget();
        }
        const hourlySolar = this.solarForHour(solarDate, solarHour);
        const waterTempStart = currentWaterTemp;
        const airTemp = this.air(row);
        const losses = this.phys.heatLosses(
          currentWaterTemp,
          airTemp,
          this.wind(row),
          this.hum(row),
          targetTemp !== null,
          this.tunnel(row)
        );
        const solarGain = this.phys.solarGain(hourlySolar, targetTemp !== null);
        const netRequirement = losses.total - solarGain;
        const controlStrategy = this.strategy();
        let effectiveTarget = targetTemp;
        let isPreheat = false;
        if (controlStrategy === "predictive") {
          if (hourIndex === 0 && targetTemp === null && this.closedPlan === null) {
            this.closedPlan = this.planClosedPeriod(tsMs, currentWaterTemp, hourIndex);
          }
          if (prevTargetTemp !== null && targetTemp === null) {
            this.closedPlan = this.planClosedPeriod(tsMs, currentWaterTemp, hourIndex);
          }
          if (this.forecast !== null && targetTemp === null && this.closedPlan !== null && this.newestRunAt(utc) !== (this.closedPlan.forecast_run ?? null)) {
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
        let heatingMode = "reactive";
        const tmr = this.tmr && this.tmr > 0 ? this.tmr : 1;
        let heating;
        if (controlStrategy === "predictive" && targetTemp === null && this.closedPlan !== null) {
          const plan = this.closedPlan;
          const isRamp = hourIndex >= (plan.start_index ?? hourIndex);
          const holdTemp = isRamp ? plan.t_req : plan.min_temp;
          heatingMode = isRamp ? "preheat_ramp" : "preheat_coast";
          effectiveTarget = holdTemp;
          isPreheat = currentWaterTemp < holdTemp - 0.1;
          heating = this.heatPumpToHold(holdTemp, netRequirement, airTemp, currentWaterTemp, tmr);
        } else if (controlStrategy === "predictive" && targetTemp !== null && this.openPreheat && hourIndex < this.openBankEnd) {
          heatingMode = "open_preheat";
          const maxTemp = this.openMaxTemp ?? this.maxTemp(targetTemp);
          effectiveTarget = targetTemp;
          isPreheat = currentWaterTemp > targetTemp + 0.1;
          heating = this.openPreheatHeating(targetTemp, maxTemp, netRequirement, airTemp, currentWaterTemp, tmr);
        } else if (controlStrategy === "predictive" && targetTemp === null && this.closedPlan === null && (eq.standby_temp ?? null) !== null) {
          heatingMode = "standby";
          effectiveTarget = num(eq.standby_temp, 0);
          heating = this.standbyHeating(effectiveTarget, netRequirement, airTemp, currentWaterTemp, tmr);
        } else {
          if (controlStrategy === "predictive" && targetTemp !== null) heatingMode = "open_hold";
          heating = this.calculateHeating(netRequirement, airTemp, effectiveTarget, currentWaterTemp);
        }
        const heatBalance = solarGain + heating.total_heat - losses.total;
        const tempChange = this.phys.tempChange(heatBalance, 1);
        if (currentWaterTemp + tempChange < 5 && losses.total > 0) {
          const excess = Math.min(losses.total, (5 - (currentWaterTemp + tempChange)) * tmr);
          const scale = (losses.total - excess) / losses.total;
          losses.evaporation *= scale;
          losses.convection *= scale;
          losses.radiation *= scale;
          losses.cover *= scale;
          losses.floor *= scale;
          losses.walls *= scale;
          losses.total *= scale;
        }
        currentWaterTemp += tempChange;
        currentWaterTemp = Math.max(5, Math.min(35, currentWaterTemp));
        const hpElecRounded = phpRound(heating.hp_electricity, 3);
        hourly.push([
          timestamp,
          airTemp,
          this.wind(row),
          this.hum(row),
          hourlySolar,
          targetTemp,
          phpRound(currentWaterTemp, 2),
          phpRound(waterTempStart, 4),
          targetTemp !== null ? 1 : 0,
          phpRound(losses.total, 3),
          phpRound(solarGain, 3),
          phpRound(heating.hp_heat, 3),
          phpRound(heating.boiler_heat, 3),
          hpElecRounded,
          phpRound(heating.boiler_fuel, 3),
          phpRound(heating.hp_cop, 2),
          phpRound(heating.cost, 2),
          heatingMode,
          effectiveTarget
        ]);
        if (hpElecRounded > 0) hpHoursRounded++;
        if (date !== currentDay) {
          if (currentDay !== null && day) daily.push(finalizeDay(day));
          currentDay = date;
          day = {
            date,
            hours: 0,
            open_hours: 0,
            avg_air_temp: 0,
            avg_water_temp: 0,
            min_water_temp: 999,
            min_water_temp_open: 999,
            max_shortfall_open: null,
            total_loss_kwh: 0,
            total_solar_kwh: 0,
            total_hp_kwh: 0,
            total_boiler_kwh: 0,
            hp_thermal_kwh: 0,
            boiler_thermal_kwh: 0,
            total_cost: 0
          };
        }
        const d = day;
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
          if (targetSource === "default") s.target_hours_default++;
          else s.target_hours_schedule++;
          s.min_water_temp_open = Math.min(s.min_water_temp_open, currentWaterTemp);
          s.max_water_temp_open = Math.max(s.max_water_temp_open, currentWaterTemp);
          s.avg_water_temp_open += currentWaterTemp;
        }
        if (isPreheat) s.preheat_hours = (s.preheat_hours ?? 0) + 1;
        if (heating.hp_electricity > 0) s.avg_cop += heating.hp_cop;
      }
      if (currentDay !== null && day && day.hours > 0) daily.push(finalizeDay(day));
      s.days_below_mode = "relative_to_target";
      s.days_below_threshold1_delta = 1;
      s.days_below_threshold2_delta = 2;
      for (const d of daily) {
        if ((d.open_hours ?? 0) <= 0 || d.max_shortfall_open === null) continue;
        if (d.max_shortfall_open > 1 + 1e-6) s.days_below_27++;
        if (d.max_shortfall_open > 2 + 1e-6) s.days_below_26++;
      }
      if (s.total_hours > 0) s.avg_water_temp /= s.total_hours;
      if ((s.open_hours ?? 0) > 0) s.avg_water_temp_open /= s.open_hours;
      else s.avg_water_temp_open = s.avg_water_temp;
      if (s.min_water_temp === 999) s.min_water_temp = 0;
      if (s.max_water_temp === -999) s.max_water_temp = 0;
      if (s.min_water_temp_open === 999) s.min_water_temp_open = s.min_water_temp;
      if (s.max_water_temp_open === -999) s.max_water_temp_open = s.max_water_temp;
      if (s.total_hp_energy_kwh > 0 && hpHoursRounded > 0) s.avg_cop = s.avg_cop / hpHoursRounded;
      const expected = (Math.trunc((Date.parse(inp.end_date + "T00:00:00Z") - Date.parse(inp.start_date + "T00:00:00Z")) / 864e5) + 1) * 24;
      s.expected_hours = expected;
      s.weather_coverage_pct = expected > 0 ? phpRound(100 * s.total_hours / expected, 1) : null;
      if (this.forecast !== null) {
        const fs = this.fs;
        s.planning_weather = "forecast";
        s.forecast_source = this.forecast.source;
        s.forecast_plans = fs.plans;
        s.forecast_replans = fs.replans;
        s.forecast_plans_without = fs.plans_without;
        s.forecast_age_h_avg = fs.plans > 0 ? phpRound(fs.age_sum / fs.plans, 1) : null;
        s.forecast_hours_beyond = fs.hours_beyond;
      }
      for (const k of Object.keys(s)) {
        if (typeof s[k] === "number") s[k] = phpRound(s[k], 2);
      }
      return { version: PORT_OF_VERSION, summary: s, daily, hourly };
    }
  };
  function debugHour(inputs, localTs, waterTemp, isOpen) {
    return new Run(inputs).debugHour(localTs, waterTemp, isOpen);
  }
  function runSimulation(inputs, progress) {
    if (!inputs || inputs.format !== 1) throw new Error("Unsupported simulator inputs");
    return new Run(inputs).run(progress);
  }
  function storedDailyRows(daily) {
    return daily.map((d) => [
      d.date,
      d.hours,
      d.open_hours,
      phpRound(d.avg_air_temp, 2),
      phpRound(d.avg_water_temp, 2),
      phpRound(d.total_loss_kwh, 3),
      phpRound(d.total_solar_kwh, 3),
      phpRound(d.total_hp_kwh, 3),
      phpRound(d.total_boiler_kwh, 3),
      phpRound(d.hp_thermal_kwh ?? 0, 3),
      phpRound(d.boiler_thermal_kwh ?? 0, 3),
      phpRound(d.total_cost, 2)
    ]);
  }

  // src/reference.ts
  var MODE_CODES = {
    preheat_coast: "c",
    preheat_ramp: "r",
    open_preheat: "p",
    open_hold: "h",
    standby: "s",
    reactive: "x",
    closed_hold: "k"
  };
  var TOLERANCE = 0.011;
  function referenceResult(r) {
    const summary = {};
    for (const [k, v] of Object.entries(r.summary)) {
      if (v === null || typeof v !== "object") summary[k] = v;
    }
    const hours = { water: [], hp: [], boiler: [], mode: "" };
    for (const h of r.hourly) {
      hours.water.push(phpRound(h[6], 2));
      hours.hp.push(phpRound(h[11], 2));
      hours.boiler.push(phpRound(h[12], 2));
      hours.mode += MODE_CODES[h[17]] ?? "?";
    }
    return { summary, days: storedDailyRows(r.daily), hours };
  }
  var isNum = (v) => typeof v === "number" && isFinite(v) || typeof v === "string" && v.trim() !== "" && isFinite(Number(v));
  function compareReference(expected, got) {
    let exact = true;
    const same = (a, b) => {
      if (a === b) return true;
      if (isNum(a) && isNum(b)) {
        const x = Number(a), y = Number(b);
        if (x === y) return true;
        exact = false;
        return Math.abs(x - y) <= TOLERANCE + 1e-9 * Math.max(Math.abs(x), Math.abs(y));
      }
      return false;
    };
    const summaryDiffs = [];
    for (const [k, v] of Object.entries(expected.summary)) {
      const w = got.summary[k] ?? null;
      if (!same(v, w)) summaryDiffs.push({ key: k, expected: v, got: w });
    }
    let daysDiffering = 0;
    let firstDay = null;
    const nd = Math.max(expected.days.length, got.days.length);
    for (let i = 0; i < nd; i++) {
      const a = expected.days[i], b = got.days[i];
      let ok = !!a && !!b && a.length === b.length;
      for (let j = 0; ok && j < a.length; j++) ok = same(a[j], b[j]);
      if (!ok) {
        daysDiffering++;
        if (firstDay === null) firstDay = String((a ?? b)?.[0] ?? `#${i}`);
      }
    }
    let hoursDiffering = 0;
    let firstHour = null;
    const eh = expected.hours, gh = got.hours;
    const nh = Math.max(eh.water.length, gh.water.length);
    for (let i = 0; i < nh; i++) {
      const ok = eh.water[i] !== void 0 && gh.water[i] !== void 0 && same(eh.water[i], gh.water[i]) && same(eh.hp[i], gh.hp[i]) && same(eh.boiler[i], gh.boiler[i]) && (eh.mode[i] ?? "") === (gh.mode[i] ?? "");
      if (!ok) {
        hoursDiffering++;
        if (firstHour === null) firstHour = i;
      }
    }
    const differs = summaryDiffs.length > 0 || daysDiffering > 0 || hoursDiffering > 0;
    return {
      status: differs ? "differs" : exact ? "identical" : "rounding",
      summary_diffs: summaryDiffs.slice(0, 10),
      summary_differing: summaryDiffs.length,
      days_differing: daysDiffering,
      first_day: firstDay,
      hours_differing: hoursDiffering,
      first_hour: firstHour
    };
  }

  // src/rules.ts
  var TS = 0;
  var TARGET = 5;
  var WATER = 6;
  var START = 7;
  var OPEN = 8;
  var LOSS = 9;
  var SOLAR = 10;
  var HP = 11;
  var BOILER = 12;
  var COP = 15;
  var MODE = 17;
  var HOLD = 18;
  var T_TOL = 0.011;
  var KW_TOL = 2e-3;
  function checkRules(inputs, result) {
    const eq = inputs.equipment || {};
    const pool = inputs.pool_config || {};
    const rows = result.hourly;
    const predictive = (result.summary.strategy_used ?? eq.control_strategy) === "predictive";
    const hindsight = (eq.planning_weather ?? "actual") !== "forecast";
    const hpOn = truthy(eq.heat_pump?.enabled);
    const hpCap = num(eq.heat_pump?.capacity_kw, 0);
    const upperTol = num(eq.upper_tolerance, 1);
    const volume = num(pool.volume_m3, 0);
    const kwhPerDegree = volume * 4186 / 3600;
    const rules = {};
    const rule = (id, title) => rules[id] = { id, title, checked: 0, violations: 0, first: null };
    const fail = (r, h, what) => {
      r.violations++;
      if (r.first === null) r.first = `${h[TS]}: ${what}`;
    };
    const hpAtLimit = (h) => !hpOn || h[HP] >= hpCap - KW_TOL || h[HP] === 0 && h[COP] === 0;
    const balance = rule("energy-balance", "Water temperature follows the hour's heat balance");
    const boilerLast = rule("boiler-last", "The boiler runs only when the heat pump is at full output");
    const noOvershoot = rule("no-overshoot", "Heating never takes the water above the level it heads for");
    const closedNoBoiler = rule("closed-no-boiler", "Closed (coast or ramp): no boiler");
    const lateStart = rule("late-start", "Closed: once the ramp starts it continues until opening (actual weather)");
    const bankFirst = rule("bank-first", "Open: banking (heat pump at full) only before holding target, never after");
    const opening = rule("opening-temp", "Opening below target only when the heat pump ran at full before (actual weather)");
    for (let i = 0; i < rows.length; i++) {
      const h = rows[i];
      const mode = h[MODE];
      const heat = h[HP] + h[BOILER];
      if (kwhPerDegree > 0 && h[WATER] > 5 + T_TOL && h[WATER] < 35 - T_TOL) {
        balance.checked++;
        const expected = h[START] + (h[SOLAR] + heat - h[LOSS]) / kwhPerDegree;
        if (Math.abs(expected - h[WATER]) > T_TOL) {
          fail(balance, h, `water ${h[WATER]} \xB0C, balance gives ${expected.toFixed(3)} \xB0C`);
        }
      }
      if (h[BOILER] > KW_TOL) {
        boilerLast.checked++;
        if (!hpAtLimit(h)) fail(boilerLast, h, `boiler ${h[BOILER]} kW with heat pump at ${h[HP]} of ${hpCap} kW`);
      }
      if (heat > KW_TOL) {
        const limit = mode === "open_preheat" ? (h[TARGET] ?? 0) + upperTol : h[HOLD];
        if (limit !== null && limit !== void 0) {
          noOvershoot.checked++;
          if (h[WATER] > limit + T_TOL) {
            fail(noOvershoot, h, `water ${h[WATER]} \xB0C above ${limit} \xB0C (${mode})`);
          }
        }
      }
      if (!predictive) continue;
      if (mode === "preheat_coast" || mode === "preheat_ramp") {
        closedNoBoiler.checked++;
        if (h[BOILER] > KW_TOL) fail(closedNoBoiler, h, `boiler ${h[BOILER]} kW in ${mode}`);
      }
      const prev = i > 0 ? rows[i - 1] : null;
      if (hindsight && prev && !h[OPEN] && !prev[OPEN]) {
        if (prev[MODE] === "preheat_ramp" && mode !== "preheat_ramp") {
          lateStart.checked++;
          fail(lateStart, h, `${mode} after preheat_ramp before opening`);
        } else if (mode === "preheat_ramp") {
          lateStart.checked++;
        }
      }
      if (prev && h[OPEN] && prev[OPEN]) {
        bankFirst.checked++;
        if (mode === "open_preheat" && prev[MODE] === "open_hold") {
          fail(bankFirst, h, "open_preheat after open_hold in the same open period");
        }
      }
      if (hindsight && prev && h[OPEN] && !prev[OPEN] && (prev[MODE] === "preheat_coast" || prev[MODE] === "preheat_ramp")) {
        opening.checked++;
        const target = h[TARGET] ?? 0;
        if (h[START] < target - 0.05 && !(prev[MODE] === "preheat_ramp" && hpAtLimit(prev))) {
          fail(opening, h, `opened at ${h[START].toFixed(2)} \xB0C (target ${target}) after ${prev[MODE]} with heat pump ${prev[HP]} kW`);
        }
      }
    }
    return Object.values(rules);
  }
  return __toCommonJS(index_exports);
})();
