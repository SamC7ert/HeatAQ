// Engine reference set (tests/reference/README.md) - TypeScript engine.
//   node test/reference.mjs                 TS engine vs the stored results of its
//                                            version (else the newest older)
//   node test/reference.mjs --engine F.cjs --write VERSION
//                                            store results from another build of the
//                                            engine (used once for 3.16.1, the version
//                                            before the reference set existed)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const refDir = path.join(here, '../../tests/reference');
const sim = require('../dist/heataq-sim.cjs');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const engine = arg('--engine') ? require(path.resolve(arg('--engine'))) : sim;
const writeVersion = arg('--write');
const cmpVersion = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

const scenarios = JSON.parse(readFileSync(path.join(refDir, 'scenarios.json'), 'utf8'));
const inputs = (id) => JSON.parse(gunzipSync(readFileSync(path.join(refDir, 'inputs', id + '.json.gz'))).toString());

if (writeVersion) {
  const out = { version: writeVersion, engine: 'typescript', generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), scenarios: {} };
  for (const s of scenarios) out.scenarios[s.id] = sim.referenceResult(engine.runSimulation(inputs(s.id)));
  writeFileSync(path.join(refDir, 'results', writeVersion + '.json.gz'), gzipSync(JSON.stringify(out), { level: 9 }));
  console.log(`Wrote results/${writeVersion}.json.gz`);
  process.exit(0);
}

const version = engine.PORT_OF_VERSION;
const versions = readdirSync(path.join(refDir, 'results')).map(f => f.replace('.json.gz', '')).sort(cmpVersion);
const base = versions.filter(v => cmpVersion(v, version) <= 0).pop();
if (!base) { console.error('No stored results to check against.'); process.exit(2); }
const expected = JSON.parse(gunzipSync(readFileSync(path.join(refDir, 'results', base + '.json.gz'))).toString()).scenarios;
console.log(`TypeScript engine ${version} vs stored results of ${base}`);
let bad = 0;
for (const s of scenarios) {
  const t0 = Date.now();
  const got = sim.referenceResult(engine.runSimulation(inputs(s.id)));
  const c = sim.compareReference(expected[s.id], got);
  if (c.status === 'differs') bad++;
  const detail = c.status === 'differs'
    ? `${c.summary_differing} summary values, ${c.days_differing} days (first ${c.first_day}), ${c.hours_differing} hours (first #${c.first_hour})`
    : '';
  console.log(`  ${s.id.padEnd(24)} ${c.status.padEnd(9)} ${String(Date.now() - t0).padStart(5)} ms  ${detail}`);
}
if (base !== version) { console.log('\nNo results stored for this version yet: differences are expected; review them.'); process.exit(0); }
console.log(bad ? `\n${bad} scenario(s) differ.` : '\nAll scenarios match.');
process.exit(bad ? 1 : 0);
