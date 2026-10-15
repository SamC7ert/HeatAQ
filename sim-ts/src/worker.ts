// Web Worker: runs one simulation per message so long (10-year) runs do not
// block the page.
//   in:  { id, inputs, expected? }
//   out: { id, type: 'progress', period, pct } ... then
//        { id, type: 'result', result, dailyRows, ms } or { id, type: 'error', message }
//        (dailyRows: the daily results as stored, for upload)
//   With `expected` (a reference result, tests/reference) the run is a
//   reference check instead: { id, type: 'reference', comparison, ms }
import { runSimulation, storedDailyRows } from './engine';
import { compareReference, referenceResult } from './reference';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent) => {
  const { id, inputs, expected } = e.data || {};
  const t0 = Date.now();
  try {
    const result = runSimulation(inputs, (period, done, total) => {
      ctx.postMessage({ id, type: 'progress', period, pct: total > 0 ? Math.round(100 * done / total) : 0 });
    });
    const ms = Date.now() - t0;
    if (expected) {
      ctx.postMessage({ id, type: 'reference', comparison: compareReference(expected, referenceResult(result)), ms });
    } else {
      ctx.postMessage({ id, type: 'result', result, dailyRows: storedDailyRows(result.daily), ms });
    }
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
