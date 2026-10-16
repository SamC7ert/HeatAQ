// The strategy rules (src/rules.ts) must catch what they describe: each case
// breaks one property in a correct reference run and expects that rule, and
// only that kind of rule, to report it.
//   node test/rules.mjs   (after: npm run build)
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const sim = require('../dist/heataq-sim.cjs');

const inputs = JSON.parse(gunzipSync(readFileSync(path.join(here, '../../tests/reference/inputs/predictive-2y.json.gz'))).toString());
const base = sim.runSimulation(inputs);
const TARGET = 5, WATER = 6, START = 7, OPEN = 8, HP = 11, BOILER = 12, MODE = 17;
const find = (pred) => base.hourly.findIndex((h, i) => pred(h, i, base.hourly));

const cases = [
  ['closed-no-boiler', 'boiler during a coast hour', (rows) => {
    const i = find(h => h[MODE] === 'preheat_coast' && h[HP] === 0);
    rows[i][BOILER] = 50; rows[i][WATER] = +(rows[i][WATER] + 50 / (625 * 4186 / 3600)).toFixed(2);
  }],
  ['boiler-last', 'boiler while the heat pump has capacity left', (rows) => {
    const i = find(h => h[MODE] === 'open_hold' && h[HP] > 10 && h[HP] < 200 && h[BOILER] === 0);
    rows[i][HP] -= 10; rows[i][BOILER] = 10;
  }],
  ['no-overshoot', 'heating above the hold level', (rows) => {
    const i = find(h => h[MODE] === 'open_hold' && h[HP] > 1);
    rows[i][WATER] = rows[i][18] + 0.5; rows[i][START] += 0.5 + rows[i][18] - rows[i][WATER] + 0.5;
  }],
  ['late-start', 'coast after the ramp started', (rows) => {
    const i = find((h, k, r) => h[MODE] === 'preheat_ramp' && r[k + 1] && r[k + 1][MODE] === 'preheat_ramp' && !r[k + 1][OPEN]);
    rows[i + 1][MODE] = 'preheat_coast';
  }],
  ['bank-first', 'banking after holding target', (rows) => {
    const i = find((h, k, r) => h[MODE] === 'open_hold' && r[k + 1] && r[k + 1][OPEN] && r[k + 1][MODE] === 'open_hold');
    rows[i + 1][MODE] = 'open_preheat';
  }],
  ['opening-temp', 'opening below target after a coast', (rows) => {
    const i = find((h, k, r) => h[OPEN] && r[k - 1] && !r[k - 1][OPEN] && r[k - 1][MODE] === 'preheat_ramp');
    rows[i - 1][MODE] = 'preheat_coast'; rows[i][START] = rows[i][TARGET] - 1;
  }],
  ['energy-balance', 'water temperature not following the balance', (rows) => {
    const i = find(h => h[OPEN] && h[WATER] > 20);
    rows[i][WATER] += 0.3;
  }],
];

const clean = sim.checkRules(inputs, base).filter(r => r.violations);
let failed = clean.length ? 1 : 0;
if (clean.length) console.log('Unmodified run already violates:', clean.map(r => r.id).join(', '));
for (const [id, what, breakIt] of cases) {
  const rows = base.hourly.map(h => h.slice());
  breakIt(rows);
  const res = sim.checkRules(inputs, { ...base, hourly: rows });
  const hit = res.find(r => r.id === id);
  const ok = hit && hit.violations > 0;
  if (!ok) failed++;
  console.log(`  ${ok ? 'caught ' : 'MISSED '} ${id.padEnd(17)} ${what}${ok ? ` (${hit.first})` : ''}`);
}
console.log(failed ? `\n${failed} problem(s).` : '\nEvery rule catches its case.');
process.exit(failed ? 1 : 0);
