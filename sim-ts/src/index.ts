// HeatAQ simulator (TypeScript port). Browser: window.HeatAQSim (from
// assets/js/sim/heataq-sim.js); simulations normally run in the Web Worker
// assets/js/sim/heataq-sim-worker.js.
export { runSimulation, computeClosedPlan, storedDailyRows, PORT_OF_VERSION } from './engine';
export { phpRound } from './util';
export type { RunInputs, RunResult, HourlyRow, DailyResult, StoredDayRow } from './types';
