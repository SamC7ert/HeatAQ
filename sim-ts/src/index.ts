// HeatAQ simulator (TypeScript port). Browser: window.HeatAQSim (from
// assets/js/sim/heataq-sim.js); simulations normally run in the Web Worker
// assets/js/sim/heataq-sim-worker.js.
export { runSimulation, debugHour, computeClosedPlan, storedDailyRows, PORT_OF_VERSION } from './engine';
export { phpRound } from './util';
export { referenceResult, compareReference, MODE_CODES } from './reference';
export { checkRules } from './rules';
export type { RuleResult } from './rules';
export type { ReferenceResult, ReferenceComparison } from './reference';
export type { RunInputs, RunResult, HourlyRow, DailyResult, StoredDayRow } from './types';
