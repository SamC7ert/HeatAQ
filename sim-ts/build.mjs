// Builds the browser bundles (committed, so the server needs no build step)
// and a Node build for the comparison tests.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const common = { bundle: true, target: 'es2020', logLevel: 'warning', legalComments: 'none' };

// Main-thread API (window.HeatAQSim) and the Web Worker that runs simulations
await build({ ...common, entryPoints: ['src/index.ts'], format: 'iife', globalName: 'HeatAQSim',
              outfile: '../assets/js/sim/heataq-sim.js' });
await build({ ...common, entryPoints: ['src/worker.ts'], format: 'iife',
              outfile: '../assets/js/sim/heataq-sim-worker.js' });
// Node (tests only, not committed)
await build({ ...common, entryPoints: ['src/index.ts'], format: 'cjs', platform: 'node',
              outfile: 'dist/heataq-sim.cjs' });
// The simulator version, for the server (EnergySimulator::getVersion(): saved
// with each run and its inputs, shown in the app)
const version = readFileSync('src/engine.ts', 'utf8').match(/PORT_OF_VERSION = '(\d+\.\d+\.\d+)'/)[1];
writeFileSync('../assets/js/sim/version.json', JSON.stringify({ version }) + '\n');
console.log(`built assets/js/sim/heataq-sim.js, heataq-sim-worker.js, version.json (${version}), dist/heataq-sim.cjs`);
