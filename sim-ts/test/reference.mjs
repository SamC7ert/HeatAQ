// Engine reference set (tests/reference/README.md) - command-line tool.
//   node test/reference.mjs check [id ...]    engine vs the stored results of its version
//                                             (else the newest older), and the strategy rules
//   node test/reference.mjs write [--force]   store this version's results
//   node test/reference.mjs changes FROM [TO] key figures that changed between two
//                                             versions' stored results
//   node test/reference.mjs add ID "Title" "Description" inputs.json
//                                             add a scenario from a run's exported inputs
//                                             (run detail -> Export inputs)
// Run after `npm run build` (uses dist/heataq-sim.cjs).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const refDir = path.join(here, '../../tests/reference');
const sim = require('../dist/heataq-sim.cjs');

const version = sim.PORT_OF_VERSION;
const cmpVersion = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const scenariosFile = path.join(refDir, 'scenarios.json');
const scenarios = JSON.parse(readFileSync(scenariosFile, 'utf8'));
const inputs = (id) => JSON.parse(gunzipSync(readFileSync(path.join(refDir, 'inputs', id + '.json.gz'))).toString());
const versions = () => readdirSync(path.join(refDir, 'results')).map(f => f.replace('.json.gz', '')).sort(cmpVersion);
const results = (v) => {
  const f = path.join(refDir, 'results', v + '.json.gz');
  return existsSync(f) ? JSON.parse(gunzipSync(readFileSync(f)).toString()).scenarios : null;
};
/** Run a scenario: reference result, rule results, ms */
const run = (id) => {
  const inp = inputs(id);
  const t0 = Date.now();
  const r = sim.runSimulation(inp);
  return { got: sim.referenceResult(r), rules: sim.checkRules(inp, r), ms: Date.now() - t0 };
};
const ruleText = (rules) => {
  const bad = rules.filter(r => r.violations);
  return bad.length ? 'RULES: ' + bad.map(r => `${r.id} ${r.violations}x (first ${r.first})`).join('; ') : '';
};
const [cmd = 'check', ...args] = process.argv.slice(2);

if (cmd === 'check') {
  const ids = args.length ? args : scenarios.map(s => s.id);
  const base = versions().filter(v => cmpVersion(v, version) <= 0).pop();
  if (!base) { console.error("No stored results to check against (run 'write' first)."); process.exit(2); }
  const expected = results(base);
  console.log(`Engine ${version} vs stored results of ${base}${base === version ? '' : ' (no results stored for this version yet)'}`);
  let bad = 0, ruleBad = 0;
  for (const id of ids) {
    const { got, rules, ms } = run(id);
    const rt = ruleText(rules);
    if (rt) ruleBad++;
    if (!expected[id]) { console.log(`  ${id.padEnd(24)} no stored result     ${String(ms).padStart(5)} ms  ${rt}`); continue; }
    const c = sim.compareReference(expected[id], got);
    if (c.status === 'differs') bad++;
    const detail = c.status === 'differs'
      ? `${c.summary_differing} summary values, ${c.days_differing} days (first ${c.first_day}), ${c.hours_differing} hours (first #${c.first_hour})`
        + (c.summary_diffs.length ? '; e.g. ' + c.summary_diffs.slice(0, 3).map(d => `${d.key} ${JSON.stringify(d.expected)} -> ${JSON.stringify(d.got)}`).join(', ') : '')
      : '';
    console.log(`  ${id.padEnd(24)} ${c.status.padEnd(9)} ${String(ms).padStart(5)} ms  ${[detail, rt].filter(Boolean).join('  ')}`);
  }
  if (ruleBad) console.log(`\n${ruleBad} scenario(s) break a strategy rule (sim-ts/src/rules.ts).`);
  if (base !== version) {
    console.log("\nDifferences are expected for a new version: review them, then store its results with 'write'.");
    process.exit(ruleBad ? 1 : 0);
  }
  if (!ruleBad) console.log(bad ? `\n${bad} scenario(s) differ from the stored results of this version.` : '\nAll scenarios match, all strategy rules hold.');
  process.exit(bad || ruleBad ? 1 : 0);
}

if (cmd === 'write') {
  const file = path.join(refDir, 'results', version + '.json.gz');
  if (existsSync(file) && !args.includes('--force')) {
    console.error(`Results for ${version} already exist. A version's results must not change: bump the version, or use --force for a version not yet released.`);
    process.exit(2);
  }
  const out = { version, engine: 'typescript', generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), scenarios: {} };
  let ruleBad = 0;
  for (const s of scenarios) {
    const { got, rules, ms } = run(s.id);
    out.scenarios[s.id] = got;
    const rt = ruleText(rules);
    if (rt) ruleBad++;
    console.log(`  ${s.id.padEnd(24)} ${String(ms).padStart(5)} ms  ${rt}`);
  }
  if (ruleBad) { console.error(`\nNot written: ${ruleBad} scenario(s) break a strategy rule.`); process.exit(1); }
  writeFileSync(file, gzipSync(JSON.stringify(out), { level: 9 }));
  console.log(`Wrote results/${version}.json.gz`);
  process.exit(0);
}

if (cmd === 'changes') {
  const [from, to = version] = args;
  const a = from && results(from), b = results(to);
  if (!a || !b) { console.error(`Need stored results for both versions. Stored: ${versions().join(', ')}`); process.exit(2); }
  const pct = (x, y) => x === y ? '=' : (typeof x === 'number' && typeof y === 'number' && Math.abs(x) > 1e-9)
    ? `${(100 * (y - x) / Math.abs(x) >= 0 ? '+' : '')}${(100 * (y - x) / Math.abs(x)).toFixed(1)}%`
    : (x === y ? '=' : `${JSON.stringify(x)}->${JSON.stringify(y)}`);
  console.log(`Changes ${from} -> ${to}`);
  console.log(`  ${'scenario'.padEnd(24)} ${'status'.padEnd(9)} ${'cost'.padStart(9)} ${'boiler'.padStart(9)} ${'HP heat'.padStart(9)} ${'electr.'.padStart(9)} days >1°C below`);
  for (const s of scenarios) {
    if (!a[s.id] || !b[s.id]) continue;
    const c = sim.compareReference(a[s.id], b[s.id]);
    const v = (k) => [a[s.id].summary[k], b[s.id].summary[k]];
    console.log(`  ${s.id.padEnd(24)} ${c.status.padEnd(9)} ${pct(...v('total_cost')).padStart(9)} ${pct(...v('boiler_thermal_kwh')).padStart(9)} `
      + `${pct(...v('hp_thermal_kwh')).padStart(9)} ${pct(...v('total_electricity_kwh')).padStart(9)} ${v('days_below_27').join(' -> ')}`);
  }
  process.exit(0);
}

if (cmd === 'add') {
  const [id, title, description, file] = args;
  if (!file || !/^[a-z0-9-]+$/.test(id || '')) {
    console.error('Usage: node test/reference.mjs add ID "Title" "Description" inputs.json  (ID: a-z, 0-9, -)');
    process.exit(2);
  }
  const inp = JSON.parse(readFileSync(file, 'utf8'));
  if (inp.format !== 1) { console.error(`${file} is not exported run inputs`); process.exit(2); }
  if (scenarios.some(s => s.id === id)) { console.error(`Scenario ${id} exists already`); process.exit(2); }
  writeFileSync(path.join(refDir, 'inputs', id + '.json.gz'), gzipSync(JSON.stringify(inp), { level: 9 }));
  scenarios.push({ id, title, description, start: inp.start_date, end: inp.end_date });
  writeFileSync(scenariosFile, JSON.stringify(scenarios, null, 4) + '\n');
  console.log(`Added ${id}. Stored results of earlier versions do not include it; store this version's results with 'write --force' (only for a version not yet released) or with the next version.`);
  process.exit(0);
}

console.error('Usage: node test/reference.mjs check [id ...] | write [--force] | changes FROM [TO] | add ID TITLE DESCRIPTION FILE');
process.exit(2);
