// Strategy rules: properties every hour of a run must have, checked on the
// reference scenarios (tests/reference) by the command-line tool and by
// Admin > Engine Verification. A second engine can only show that two
// implementations agree; these rules check the heating strategy itself
// (docs/PREDICTIVE_CONTROL.md). A violation is a bug or an undocumented
// behaviour: never relax a rule to make a result pass without a reason.

import type { HourlyRow, RunInputs, RunResult } from './types';
import { num, truthy } from './util';

export interface RuleResult {
  id: string;
  title: string;
  /** Hours (or opening events) the rule applies to */
  checked: number;
  violations: number;
  /** First violation: timestamp and what was found */
  first: string | null;
}

// HourlyRow fields
const TS = 0, TARGET = 5, WATER = 6, START = 7, OPEN = 8, LOSS = 9, SOLAR = 10, HP = 11, BOILER = 12, COP = 15, MODE = 17, HOLD = 18;

/** Water temperature is stored with 2 decimals: one rounding step of slack. */
const T_TOL = 0.011;
const KW_TOL = 0.002;

export function checkRules(inputs: RunInputs, result: RunResult): RuleResult[] {
  const eq = inputs.equipment || {};
  const pool = inputs.pool_config || {};
  const rows = result.hourly;
  const predictive = (result.summary.strategy_used ?? eq.control_strategy) === 'predictive';
  const hindsight = (eq.planning_weather ?? 'actual') !== 'forecast';
  const hpOn = truthy(eq.heat_pump?.enabled);
  const hpCap = num(eq.heat_pump?.capacity_kw, 0) as number;
  const upperTol = num(eq.upper_tolerance, 1.0) as number;
  const volume = num(pool.volume_m3, 0) as number;
  const kwhPerDegree = volume * 4186 / 3600;   // Physics.tempChange: m * c

  const rules: Record<string, RuleResult> = {};
  const rule = (id: string, title: string) => (rules[id] = { id, title, checked: 0, violations: 0, first: null });
  const fail = (r: RuleResult, h: HourlyRow, what: string) => {
    r.violations++;
    if (r.first === null) r.first = `${h[TS]}: ${what}`;
  };
  /** Heat pump at full output this hour, or not able to run (off, air-source cut-out). */
  const hpAtLimit = (h: HourlyRow) => !hpOn || h[HP] >= hpCap - KW_TOL || (h[HP] === 0 && h[COP] === 0);

  const balance = rule('energy-balance', 'Water temperature follows the hour\'s heat balance');
  const boilerLast = rule('boiler-last', 'The boiler runs only when the heat pump is at full output');
  const noOvershoot = rule('no-overshoot', 'Heating never takes the water above the level it heads for');
  const closedNoBoiler = rule('closed-no-boiler', 'Closed (coast or ramp): no boiler');
  const lateStart = rule('late-start', 'Closed: once the ramp starts it continues until opening (actual weather)');
  const bankFirst = rule('bank-first', 'Open: banking (heat pump at full) only before holding target, never after');
  const opening = rule('opening-temp', 'Opening below target only when the heat pump ran at full before (actual weather)');

  for (let i = 0; i < rows.length; i++) {
    const h = rows[i];
    const mode = h[MODE];
    const heat = h[HP] + h[BOILER];

    // Energy balance: water end = start + (solar + heating - losses) / (kWh per °C),
    // except where the water sits at the 5 °C floor or the 35 °C cap
    if (kwhPerDegree > 0 && h[WATER] > 5 + T_TOL && h[WATER] < 35 - T_TOL) {
      balance.checked++;
      const expected = h[START] + (h[SOLAR] + heat - h[LOSS]) / kwhPerDegree;
      if (Math.abs(expected - h[WATER]) > T_TOL) {
        fail(balance, h, `water ${h[WATER]} °C, balance gives ${expected.toFixed(3)} °C`);
      }
    }

    if (h[BOILER] > KW_TOL) {
      boilerLast.checked++;
      if (!hpAtLimit(h)) fail(boilerLast, h, `boiler ${h[BOILER]} kW with heat pump at ${h[HP]} of ${hpCap} kW`);
    }

    if (heat > KW_TOL) {
      const limit = mode === 'open_preheat'
        ? (h[TARGET] ?? 0) + upperTol
        : h[HOLD];
      if (limit !== null && limit !== undefined) {
        noOvershoot.checked++;
        if (h[WATER] > limit + T_TOL) {
          fail(noOvershoot, h, `water ${h[WATER]} °C above ${limit} °C (${mode})`);
        }
      }
    }

    if (!predictive) continue;

    if (mode === 'preheat_coast' || mode === 'preheat_ramp') {
      closedNoBoiler.checked++;
      if (h[BOILER] > KW_TOL) fail(closedNoBoiler, h, `boiler ${h[BOILER]} kW in ${mode}`);
    }

    const prev = i > 0 ? rows[i - 1] : null;
    if (hindsight && prev && !h[OPEN] && !prev[OPEN]) {
      if (prev[MODE] === 'preheat_ramp' && mode !== 'preheat_ramp') {
        lateStart.checked++;
        fail(lateStart, h, `${mode} after preheat_ramp before opening`);
      } else if (mode === 'preheat_ramp') {
        lateStart.checked++;
      }
    }

    if (prev && h[OPEN] && prev[OPEN]) {
      bankFirst.checked++;
      if (mode === 'open_preheat' && prev[MODE] === 'open_hold') {
        fail(bankFirst, h, 'open_preheat after open_hold in the same open period');
      }
    }

    // First hour of an open period after a planned closed period
    if (hindsight && prev && h[OPEN] && !prev[OPEN]
        && (prev[MODE] === 'preheat_coast' || prev[MODE] === 'preheat_ramp')) {
      opening.checked++;
      const target = h[TARGET] ?? 0;
      if (h[START] < target - 0.05 && !(prev[MODE] === 'preheat_ramp' && hpAtLimit(prev))) {
        fail(opening, h, `opened at ${h[START].toFixed(2)} °C (target ${target}) after ${prev[MODE]} with heat pump ${prev[HP]} kW`);
      }
    }
  }
  return Object.values(rules);
}
