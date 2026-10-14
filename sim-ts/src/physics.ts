// Port of the heat-loss / gain / equipment physics in lib/EnergySimulator.php.

import type { Losses } from './types';
import { num, truthy } from './util';

export const WATER_DENSITY = 1000;
export const WATER_SPECIFIC_HEAT = 4186;
export const STEFAN_BOLTZMANN = 5.67e-8;
export const WATER_EMISSIVITY = 0.95;
export const LATENT_HEAT_VAPORIZATION = 2454000;
export const AIR_SPECIFIC_HEAT = 1005;
export const ATM_PRESSURE = 101325;
export const MOLECULAR_RATIO = 0.622;
export const Q_POOL_FLUX = 1.51;
export const U_WALLS = 0.58;
export const T_REF_LOW = 5;
export const T_REF_HIGH = 28;

export interface HeatPumpResult { heat: number; electricity: number; cop: number; cost: number; }
export interface BoilerResult { heat: number; fuel: number; cost: number; }

/** Physics bound to one run's pool configuration and equipment. */
export class Physics {
  readonly area: number;
  private hasCover: boolean;
  private coverU: number;
  private windFactor: number;
  private absorptivity: number;
  private coverTransmittance: number;
  private activityFactor: number | null;
  private groundFactor: number;
  private length: number;
  private width: number;
  private depth: number;
  readonly volume: number;

  private hpEnabled: boolean;
  private hpType: string;
  private hpCapacity: number;
  private hpCopNominal: number;
  private hpMinOp: number | null;
  private hpMaxOp: number | null;
  private elecPrice: number;
  private boilerEnabled: boolean;
  private boilerCapacity: number;
  private boilerEfficiency: number;
  private boilerElectric: boolean;
  private fuelPrice: number;

  constructor(pool: Record<string, any>, equipment: Record<string, any>, groundFactor: number) {
    this.area = num(pool.area_m2, 0) as number;
    this.hasCover = truthy(pool.has_cover ?? false);
    this.coverU = num(pool.cover_r_value, 5.0) as number;
    this.windFactor = num(pool.wind_exposure_factor, 1.0) as number;
    this.absorptivity = num(pool.solar_absorption, 0.60) as number;
    this.coverTransmittance = num(pool.cover_solar_transmittance, 0.10) as number;
    this.activityFactor = num(equipment.bathers?.activity_factor, null);
    this.groundFactor = groundFactor;
    this.length = num(pool.length_m, Math.sqrt(this.area * 2)) as number;
    this.width = num(pool.width_m, Math.sqrt(this.area / 2)) as number;
    this.depth = num(pool.depth_m, 1.5) as number;
    this.volume = num(pool.volume_m3, 0) as number;

    const hp = equipment.heat_pump || {};
    this.hpEnabled = truthy(hp.enabled);
    this.hpType = hp.type ?? 'ground_source';
    this.hpCapacity = num(hp.capacity_kw, 0) as number;
    this.hpCopNominal = num(hp.cop_nominal, 4.6) as number;
    this.hpMinOp = num(hp.min_operating_temp, null);
    this.hpMaxOp = num(hp.max_operating_temp, null);
    this.elecPrice = num(equipment.electricity_cost_per_kwh, 0) as number;
    const b = equipment.boiler || {};
    this.boilerEnabled = truthy(b.enabled);
    this.boilerCapacity = num(b.capacity_kw, 0) as number;
    this.boilerEfficiency = num(b.efficiency, 0) as number;
    this.boilerElectric = (b.fuel_type ?? null) === 'electric';
    this.fuelPrice = num(b.fuel_cost_per_kwh, 0) as number;
  }

  get boilerIsElectric(): boolean { return this.boilerElectric; }
  get boilerOn(): boolean { return this.boilerEnabled; }

  heatLosses(waterTemp: number, airTemp: number, windSpeed: number, humidity: number,
             isOpen: boolean, tunnelTemp: number | null): Losses {
    const isCovered = this.hasCover && !isOpen;
    const [floor, walls] = this.structural(waterTemp, tunnelTemp);
    let evap = 0, conv = 0, rad = 0, cover = 0;
    if (isCovered) {
      cover = this.coverLoss(waterTemp, airTemp, windSpeed);
    } else {
      const e = this.evaporation(waterTemp, airTemp, humidity, windSpeed, isOpen);
      evap = e.loss;
      conv = this.convection(waterTemp, airTemp, e.deltaP, e.lossRaw);
      rad = this.radiation(waterTemp, airTemp);
    }
    const total = evap + conv + rad + cover + floor + walls;
    return {
      evaporation: Math.max(0, evap),
      convection: Math.max(0, conv),
      radiation: Math.max(0, rad),
      cover: Math.max(0, cover),
      floor: Math.max(0, floor),
      walls: Math.max(0, walls),
      total: Math.max(0, total),
    };
  }

  private coverLoss(waterTemp: number, airTemp: number, windSpeed: number): number {
    const uRated = this.coverU;
    const vEff = windSpeed * this.windFactor;
    const hNatural = 7.0;
    const hWind = 5.7 + 3.8 * vEff;
    let uEff = uRated;
    if (uRated > 0 && hNatural > 0 && hWind > 0) {
      const rTotal = 1.0 / uRated - 1.0 / hNatural + 1.0 / hWind;
      if (rTotal > 0) uEff = 1.0 / rTotal;
    }
    uEff = Math.max(uEff, uRated);
    const loss = uEff * this.area * (waterTemp - airTemp) / 1000;
    return Math.max(0, loss);
  }

  private evaporation(waterTemp: number, airTemp: number, humidity: number, windSpeed: number, isOpen: boolean) {
    const pWater = 611.2 * Math.exp(17.67 * waterTemp / (waterTemp + 243.5));
    const pAirSat = 611.2 * Math.exp(17.67 * airTemp / (airTemp + 243.5));
    const pAirActual = pAirSat * (humidity / 100);
    const deltaP = pWater - pAirActual;
    const vEff = windSpeed * this.windFactor;
    const windCoeff = 0.28 + 0.784 * vEff;
    let evapPerM2 = windCoeff * Math.pow(Math.max(0, deltaP), 0.695) / LATENT_HEAT_VAPORIZATION;
    const activity = isOpen ? (this.activityFactor ?? 1.0) : 1.0;
    evapPerM2 *= activity;
    const lossRaw = evapPerM2 * this.area * LATENT_HEAT_VAPORIZATION / 1000;
    return { loss: Math.max(0, lossRaw), lossRaw, deltaP };
  }

  private convection(waterTemp: number, airTemp: number, deltaPIn: number, evapLoss: number): number {
    const tempDiff = waterTemp - airTemp;
    let deltaP = deltaPIn;
    if (Math.abs(deltaP) < 1.0) deltaP = deltaP >= 0 ? 1.0 : -1.0;
    const numr = AIR_SPECIFIC_HEAT * ATM_PRESSURE * tempDiff;
    const den = MOLECULAR_RATIO * LATENT_HEAT_VAPORIZATION * deltaP;
    const bowen = den !== 0 ? numr / den : 0;
    return Math.max(0, bowen * evapLoss);
  }

  private radiation(waterTemp: number, airTemp: number): number {
    const tW = waterTemp + 273.15;
    const tS = (airTemp - 10) + 273.15;
    const loss = STEFAN_BOLTZMANN * WATER_EMISSIVITY * this.area * (Math.pow(tW, 4) - Math.pow(tS, 4));
    return Math.max(0, loss / 1000);
  }

  private structural(waterTemp: number, tunnelTemp: number | null): [number, number] {
    const qFlux = Q_POOL_FLUX * this.groundFactor;
    const tempScale = (waterTemp - T_REF_LOW) / (T_REF_HIGH - T_REF_LOW);
    const floor = qFlux * this.area * tempScale / 1000;
    const tunnelRef = tunnelTemp ?? 15.0;
    const wallArea = 2 * (this.length + this.width) * this.depth;
    const walls = U_WALLS * wallArea * (waterTemp - tunnelRef) / 1000;
    return [Math.max(0, floor), Math.max(0, walls)];
  }

  solarGain(irradiance: number, isOpen: boolean): number {
    if (this.hasCover && !isOpen) {
      return irradiance * this.area * this.absorptivity * this.coverTransmittance;
    }
    return irradiance * this.area * this.absorptivity;
  }

  private heatPumpCop(airTemp: number): number {
    if (this.hpType === 'ground_source') return this.hpCopNominal;
    const diff = airTemp - 15;
    let cop: number;
    if (diff < 0) {
      cop = this.hpCopNominal * (1 - 0.025 * Math.abs(diff));
    } else {
      cop = this.hpCopNominal * (1 + Math.min(0.2, 0.01 * diff));
    }
    return Math.max(2.0, cop);
  }

  applyHeatPump(requiredHeat: number, airTemp: number): HeatPumpResult {
    if (!this.hpEnabled) return { heat: 0, electricity: 0, cop: 0, cost: 0 };
    if (this.hpType === 'air_source') {
      // PHP 8 compares a number with null as booleans: x < null is always
      // false, x > null is true unless x == 0.
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

  applyBoiler(requiredHeat: number): BoilerResult {
    if (!this.boilerEnabled) return { heat: 0, fuel: 0, cost: 0 };
    const heat = Math.min(requiredHeat, this.boilerCapacity);
    const fuel = heat / this.boilerEfficiency;
    const price = this.boilerElectric ? this.elecPrice : this.fuelPrice;
    return { heat, fuel, cost: fuel * price };
  }

  heatForTempRise(tempDiff: number, hours: number): number {
    if (tempDiff <= 0) return 0;
    if (this.volume <= 0) return 0;
    const mass = this.volume * WATER_DENSITY;
    const energy = mass * WATER_SPECIFIC_HEAT * tempDiff / 1000;
    return energy / (hours * 3600);
  }

  tempChange(heatBalanceKW: number, hours: number): number {
    if (this.volume <= 0) return 0;
    const mass = this.volume * WATER_DENSITY;
    const energy = heatBalanceKW * hours * 3600;
    return energy / (mass * WATER_SPECIFIC_HEAT / 1000);
  }
}

/** Distribute a daily solar total over hours 6-20 (legacy daily data). */
export function distributeSolarToHour(dailyTotal: number, hour: number): number {
  if (hour < 6 || hour > 20) return 0;
  const f = (h: number) => Math.exp(-0.5 * Math.pow((h - 12) / 4, 2));
  let total = 0;
  for (let h = 6; h <= 20; h++) total += f(h);
  return dailyTotal * (f(hour) / total);
}
