// Web Worker: runs one simulation per message so long (10-year) runs do not
// block the page.
//   in:  { id, inputs }
//   out: { id, type: 'progress', period, pct } ... then
//        { id, type: 'result', result, ms } or { id, type: 'error', message }
import { runSimulation } from './engine';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent) => {
  const { id, inputs } = e.data || {};
  const t0 = Date.now();
  try {
    const result = runSimulation(inputs, (period, done, total) => {
      ctx.postMessage({ id, type: 'progress', period, pct: total > 0 ? Math.round(100 * done / total) : 0 });
    });
    ctx.postMessage({ id, type: 'result', result, ms: Date.now() - t0 });
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
