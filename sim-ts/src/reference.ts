// Engine reference set (tests/reference, see its README.md): the compact
// "reference result" of a run and its comparison with an expected one.
// Mirrors lib/ReferenceCheck.php (fromPhpResult / compare) exactly, so both
// engines are checked against the same stored results.

import type { RunResult } from './types';
import { storedDailyRows } from './engine';
import { phpRound } from './util';

export const MODE_CODES: Record<string, string> = {
  preheat_coast: 'c', preheat_ramp: 'r', open_preheat: 'p', open_hold: 'h',
  standby: 's', reactive: 'x', closed_hold: 'k',
};
/** Values are rounded to 2-3 decimals: a flip in the last digit is "within rounding". */
export const TOLERANCE = 0.011;

export interface ReferenceResult {
  summary: Record<string, unknown>;
  days: (string | number)[][];
  hours: { water: number[]; hp: number[]; boiler: number[]; mode: string };
}

export interface ReferenceComparison {
  status: 'identical' | 'rounding' | 'differs';
  summary_diffs: { key: string; expected: unknown; got: unknown }[];
  summary_differing: number;
  days_differing: number;
  first_day: string | null;
  hours_differing: number;
  first_hour: number | null;
}

export function referenceResult(r: RunResult): ReferenceResult {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.summary)) {
    if (v === null || typeof v !== 'object') summary[k] = v;
  }
  const hours = { water: [] as number[], hp: [] as number[], boiler: [] as number[], mode: '' };
  for (const h of r.hourly) {
    hours.water.push(phpRound(h[6], 2));
    hours.hp.push(phpRound(h[11], 2));
    hours.boiler.push(phpRound(h[12], 2));
    hours.mode += MODE_CODES[h[17]] ?? '?';
  }
  return { summary, days: storedDailyRows(r.daily), hours };
}

const isNum = (v: unknown): v is number | string =>
  (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)));

export function compareReference(expected: ReferenceResult, got: ReferenceResult): ReferenceComparison {
  let exact = true;
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (isNum(a) && isNum(b)) {
      const x = Number(a), y = Number(b);
      if (x === y) return true;
      exact = false;
      return Math.abs(x - y) <= TOLERANCE + 1e-9 * Math.max(Math.abs(x), Math.abs(y));
    }
    return false;
  };
  const summaryDiffs: ReferenceComparison['summary_diffs'] = [];
  for (const [k, v] of Object.entries(expected.summary)) {
    const w = got.summary[k] ?? null;
    if (!same(v, w)) summaryDiffs.push({ key: k, expected: v, got: w });
  }
  let daysDiffering = 0;
  let firstDay: string | null = null;
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
  let firstHour: number | null = null;
  const eh = expected.hours, gh = got.hours;
  const nh = Math.max(eh.water.length, gh.water.length);
  for (let i = 0; i < nh; i++) {
    const ok = eh.water[i] !== undefined && gh.water[i] !== undefined
      && same(eh.water[i], gh.water[i]) && same(eh.hp[i], gh.hp[i])
      && same(eh.boiler[i], gh.boiler[i]) && (eh.mode[i] ?? '') === (gh.mode[i] ?? '');
    if (!ok) {
      hoursDiffering++;
      if (firstHour === null) firstHour = i;
    }
  }
  const differs = summaryDiffs.length > 0 || daysDiffering > 0 || hoursDiffering > 0;
  return {
    status: differs ? 'differs' : (exact ? 'identical' : 'rounding'),
    summary_diffs: summaryDiffs.slice(0, 10),
    summary_differing: summaryDiffs.length,
    days_differing: daysDiffering,
    first_day: firstDay,
    hours_differing: hoursDiffering,
    first_hour: firstHour,
  };
}
