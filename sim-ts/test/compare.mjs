// Compare the TypeScript engine with PHP on harness output files:
//   node test/compare.mjs file1.json [file2.json ...]
// Each file: { scenario, inputs, php: { summary, daily, hourly } } written by
// a PHP harness (EnergySimulator::runSimulation + exportRunInputs).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sim = require('../dist/heataq-sim.cjs');

// PHP hourly harness columns -> TS HourlyRow columns
// php: [ts, water_temp, target, eff_target, mode, total_kw, solar_kw, hp_kw, boiler_kw, hp_elec, boiler_fuel, cost, water_start]
const MAP = [['timestamp', 0, 0], ['water_temp', 1, 6], ['target_temp', 2, 5], ['effective_target', 3, 18],
             ['heating_mode', 4, 17], ['total_loss_kw', 5, 9], ['solar_kw', 6, 10], ['hp_kw', 7, 11],
             ['boiler_kw', 8, 12], ['hp_elec', 9, 13], ['boiler_fuel', 10, 14], ['cost', 11, 16],
             ['water_temp_start', 12, 7], ['hp_cop', 20, 15]];

const rel = (a, b) => {
  if (a === b) return 0;
  if (typeof a !== 'number' || typeof b !== 'number') return a == b ? 0 : Infinity;
  const d = Math.abs(a - b);
  return d / Math.max(1, Math.abs(a), Math.abs(b));
};

let failed = 0;
for (const file of process.argv.slice(2)) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const t0 = Date.now();
  const ts = sim.runSimulation(data.inputs);
  const ms = Date.now() - t0;
  const php = data.php;
  const out = [];

  // Summary
  let worstKey = null, worst = 0;
  for (const [k, v] of Object.entries(php.summary)) {
    if (typeof v === 'object' && v !== null) continue;
    const r = rel(v, ts.summary[k]);
    if (r > worst) { worst = r; worstKey = k; }
  }
  // Daily
  let dailyWorst = 0, dailyAt = null;
  if (php.daily.length !== ts.daily.length) out.push(`daily count php ${php.daily.length} vs ts ${ts.daily.length}`);
  php.daily.forEach((d, i) => {
    const t = ts.daily[i] || {};
    for (const [k, v] of Object.entries(d)) {
      const r = rel(v, t[k]);
      if (r > dailyWorst) { dailyWorst = r; dailyAt = `${d.date}.${k} php=${v} ts=${t[k]}`; }
    }
  });
  // Hourly: first divergence
  let firstDiff = null, hourlyWorst = 0;
  if (php.hourly.length !== ts.hourly.length) out.push(`hourly count php ${php.hourly.length} vs ts ${ts.hourly.length}`);
  for (let i = 0; i < php.hourly.length; i++) {
    const p = php.hourly[i], t = ts.hourly[i];
    if (!t) break;
    for (const [name, pi, ti] of MAP) {
      const r = rel(p[pi], t[ti]);
      if (r > hourlyWorst) hourlyWorst = r;
      if (r > 1e-6 && !firstDiff) firstDiff = `hour ${i} ${p[0]} ${name}: php=${JSON.stringify(p[pi])} ts=${JSON.stringify(t[ti])}`;
    }
  }
  const ok = worst <= 1e-6 && dailyWorst <= 1e-6 && !firstDiff && out.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'MATCH' : 'DIFF '} ${file.split('/').pop()}  ${JSON.stringify(data.scenario)}  php ${data.php_ms} ms / ts ${ms} ms`);
  console.log(`   summary worst rel ${worst.toExponential(2)} (${worstKey}: php=${php.summary[worstKey]} ts=${ts.summary[worstKey]}); daily worst ${dailyWorst.toExponential(2)}${dailyAt && dailyWorst > 1e-6 ? ' at ' + dailyAt : ''}; hourly worst ${hourlyWorst.toExponential(2)}`);
  if (firstDiff) console.log('   first hourly difference: ' + firstDiff);
  for (const o of out) console.log('   ' + o);
}
process.exit(failed ? 1 : 0);
