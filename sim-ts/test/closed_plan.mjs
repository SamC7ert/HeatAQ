// Unit test of the closed-period plan (computeClosedPlan, src/engine.ts;
// docs/PREDICTIVE_CONTROL.md §4). Run after `npm run build`:
//   node test/closed_plan.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { computeClosedPlan } = require('../dist/heataq-sim.cjs');

const tmr = 100.0, target = 27.0, min = 25.0, max = 29.0;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}   ${detail}`); }
};
const fill = (n, v) => Array(n).fill(v);
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Closed period: 10 h, net loss 20 kW (0.2 °C/h), heat pump 100 kW (+0.8 °C/h net).
const closedLoss = fill(10, 20.0), closedHpOut = fill(10, 100.0);

// C1 heat pump covers every open hour -> opens at target, but still starts LATE
let p = computeClosedPlan(27.0, target, min, max, tmr, closedLoss, closedHpOut, fill(10, -10.0));
check('C1 no buffer', p.preheat === false && p.buffer_energy === 0, JSON.stringify(p));
check('C1 t_req==target', near(p.t_req, target));
check('C1 late start 8 (coast, then ramp to target)', p.start_offset === 8, `start_offset=${p.start_offset}`);
check('C1 no banking', p.bank_hours === 0);

// C2 short every hour, buffer above the cap
p = computeClosedPlan(27.0, target, min, max, tmr, closedLoss, closedHpOut, fill(10, 50.0));
check('C2 buffer 500 kWh', near(p.buffer_energy, 500.0), `buffer=${p.buffer_energy}`);
check('C2 t_req capped 29', near(p.t_req, max), `t_req=${p.t_req}`);
check('C2 bank all 10 open hours', p.bank_hours === 10);

// C3 totals balance, but the short hour comes FIRST: needs a buffer
p = computeClosedPlan(27.0, target, min, 31.0, tmr, closedLoss, closedHpOut, [100.0, -100.0]);
check('C3 t_req 28 (short first hour)', near(p.t_req, 28.0), `t_req=${p.t_req}`);
check('C3 bank only hour 1', p.bank_hours === 1, `bank_hours=${p.bank_hours}`);
check('C3 late start 7', p.start_offset === 7, `start_offset=${p.start_offset}`);

// C4 totals balance, short hour LAST: heat banked in hour 1 carries it
p = computeClosedPlan(27.0, target, min, 31.0, tmr, closedLoss, closedHpOut, [-100.0, 100.0]);
check('C4 t_req = target', near(p.t_req, 27.0), `t_req=${p.t_req}`);
check('C4 bank through hour 2', p.bank_hours === 2, `bank_hours=${p.bank_hours}`);

// C5 closed period too short -> start at once
p = computeClosedPlan(27.0, target, min, max, tmr, fill(2, 20.0), fill(2, 100.0), fill(10, 100.0));
check('C5 t_req capped 29', near(p.t_req, max));
check('C5 start 0 (too short)', p.start_offset === 0, `start_offset=${p.start_offset}`);

// C6 long closed period -> very late start, coast floored at min
p = computeClosedPlan(27.0, target, min, 31.0, tmr, fill(30, 20.0), fill(30, 100.0), fill(10, 10.0));
check('C6 t_req 28', near(p.t_req, 28.0), `t_req=${p.t_req}`);
check('C6 very late start >=25', p.start_offset >= 25, `start_offset=${p.start_offset}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
