// Date and number helpers matching PHP's behaviour.
//
// Times: PHP builds DateTime objects from the site's LOCAL clock strings
// ('Y-m-d H:i:s') in the server's default time zone (UTC), so all date
// arithmetic on them is plain wall-clock arithmetic. Here a "naive time" is
// that wall-clock string read as UTC milliseconds.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 'Y-m-d H:i:s' or 'Y-m-d' -> naive ms */
export function parseNaive(s: string): number {
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  const h = s.length > 10 ? +s.slice(11, 13) : 0;
  const mi = s.length > 13 ? +s.slice(14, 16) : 0;
  const se = s.length > 16 ? +s.slice(17, 19) : 0;
  return Date.UTC(y, m - 1, d, h, mi, se);
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function hourOf(ms: number): number {
  return new Date(ms).getUTCHours();
}

/** PHP format('N') - 1: 0 = Monday ... 6 = Sunday */
export function isoDow0(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

export function startOfDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export function addHours(ms: number, h: number): number {
  return ms + h * HOUR;
}

export function addDays(ms: number, d: number): number {
  return ms + d * DAY;
}

/** Unix seconds (PHP getTimestamp()) */
export function unix(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * PHP round($value, $precision) (PHP <= 8.3): pre-round to 15 significant
 * digits, then round half away from zero.
 */
export function phpRound(value: number, precision = 0): number {
  if (!isFinite(value)) return value;
  const f = Math.pow(10, precision);
  let tmp = Math.abs(value) * f;
  if (tmp >= 1e15) return value;
  tmp = parseFloat(tmp.toPrecision(15));
  const r = Math.floor(tmp + 0.5);
  return (Math.sign(value) || 1) * (r / f);
}

/** PHP (float) / numeric coercion for config values that may be strings. */
export function num(v: unknown, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** PHP truthiness for config flags */
export function truthy(v: unknown): boolean {
  return !(v === null || v === undefined || v === false || v === 0 || v === '' || v === '0');
}
