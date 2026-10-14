// Port of lib/PoolScheduler.php, running on PoolScheduler::exportState().
// Dates are naive local times (see util.ts).

import type { Period, ScheduleState, ExceptionDayState, DateRangeState } from './types';
import { addDays, fmtDate, hourOf, isoDow0, parseNaive, startOfDay } from './util';

const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface Transition {
  time: number;
  type: 'open' | 'close';
  target_temp: number | null;
  from_temp: number | null;
}

export interface NextOpening {
  datetime: number | null;
  target_temp: number | null;
}

export class Scheduler {
  private state: ScheduleState;
  private holidayDates: Record<number, Record<number, string>> = {};
  private cache = new Map<string, string>();

  constructor(state: ScheduleState) {
    this.state = state;
    for (const [refId, years] of Object.entries(state.holiday_dates || {})) {
      const r: Record<number, string> = {};
      for (const [y, d] of Object.entries(years)) r[+y] = d;
      this.holidayDates[+refId] = r;
    }
  }

  get templateName(): string {
    return String(this.state.template?.name ?? '');
  }

  /** Easter Sunday ('Y-m-d') - stored reference dates, else the algorithm. */
  private easterDate(year: number): string {
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
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return fmtDate(Date.UTC(year, month - 1, day));
  }

  private checkExceptionDays(ms: number): ExceptionDayState | null {
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

  private dateInRange(ms: number, r: DateRangeState): boolean {
    if (r.is_default) return true;
    if (r.is_recurring ?? true) {
      const d = new Date(ms);
      const cur = [d.getUTCMonth() + 1, d.getUTCDate()];
      const from = [r.start_month as number, r.start_day as number];
      const to = [r.end_month as number, r.end_day as number];
      const le = (x: number[], y: number[]) => x[0] < y[0] || (x[0] === y[0] && x[1] <= y[1]);
      if (le(from, to)) {
        return le(from, cur) && le(cur, to);
      }
      return le(from, cur) || le(cur, to);
    }
    return false;
  }

  /** Name of the day schedule for a date ('_CLOSED_' = closed). */
  getScheduleForDate(ms: number): string {
    const key = fmtDate(ms);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const v = this.resolveScheduleForDate(ms, key);
    this.cache.set(key, v);
    return v;
  }

  private resolveScheduleForDate(ms: number, key: string): string {
    const exc = this.checkExceptionDays(ms);
    if (exc) return exc.day_schedule_name as string;

    for (const r of this.state.date_ranges) {
      if (!this.dateInRange(ms, r)) continue;
      const ws = this.state.week_schedules[String(r.week_schedule_id)];
      if (ws) {
        const name = ws.days[DOW[isoDow0(ms)]];
        if (name) return name;
        if (r.is_default) return '_CLOSED_';
      } else if (r.is_default) {
        return '_CLOSED_';
      }
    }
    throw new Error(`No schedule found for date ${key}. Please configure a Default (Year-Round) schedule in Schedule Management for template '${this.templateName}'.`);
  }

  getPeriods(ms: number): Period[] {
    const name = this.getScheduleForDate(ms);
    const s = this.state.schedules[name];
    return s ? (s.periods || []) : [];
  }

  getCurrentPeriod(ms: number): Period | null {
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

  getDailyTransitions(ms: number): Transition[] {
    const periods = this.getPeriods(ms);
    if (periods.length === 0) return [];
    const out: Transition[] = [];
    let last: number | null = null;
    for (const p of periods) {
      out.push({ time: p.from, type: 'open', target_temp: p.target_temp, from_temp: last });
      out.push({ time: p.to, type: 'close', target_temp: null, from_temp: p.target_temp });
      last = p.target_temp;
    }
    // Stable sort by time (PHP 8 usort is stable)
    return out.map((t, i) => ({ t, i })).sort((a, b) => a.t.time - b.t.time || a.i - b.i).map(x => x.t);
  }

  findNextOpening(ms: number): NextOpening {
    const day0 = startOfDay(ms);
    const currentHour = hourOf(ms);
    for (const t of this.getDailyTransitions(day0)) {
      if (t.type === 'open' && t.time > currentHour) {
        return { datetime: day0 + t.time * 3600 * 1000, target_temp: t.target_temp };
      }
    }
    for (let off = 1; off <= 30; off++) {
      const next = addDays(day0, off);
      for (const t of this.getDailyTransitions(next)) {
        if (t.type === 'open') {
          return { datetime: next + t.time * 3600 * 1000, target_temp: t.target_temp };
        }
      }
    }
    return { datetime: null, target_temp: null };
  }
}
