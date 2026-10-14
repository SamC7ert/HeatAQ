// Simulation engines: the PHP engine (server) and the TypeScript port
// (assets/js/sim, built from sim-ts/), which runs in a Web Worker.
//
// Engine setting on the Simulate tab:
//   php        - run on the server (as before)
//   compare    - run PHP, then TypeScript on the same inputs, and report
//                any difference (PHP's results are the ones stored)
//   typescript - the server prepares the run; this browser simulates and
//                submits the results

const SimEngine = {
    // Same cache-busting version as this script
    workerUrl: (() => {
        const src = document.querySelector('script[src*="modules/simengine.js"]')?.getAttribute('src') || '';
        const v = src.includes('?') ? src.slice(src.indexOf('?')) : '';
        return './assets/js/sim/heataq-sim-worker.js' + v;
    })(),

    /** Run the TypeScript engine on exportRunInputs() data in a worker. */
    run: function(inputs, onProgress) {
        return new Promise((resolve, reject) => {
            let worker;
            try {
                worker = new Worker(this.workerUrl);
            } catch (e) {
                reject(new Error('This browser cannot start the TypeScript engine: ' + e.message));
                return;
            }
            const id = Date.now();
            worker.onmessage = (e) => {
                const m = e.data || {};
                if (m.id !== id) return;
                if (m.type === 'progress') {
                    if (onProgress) onProgress(m.period, m.pct);
                } else if (m.type === 'result') {
                    worker.terminate();
                    resolve({ result: m.result, ms: m.ms });
                } else if (m.type === 'error') {
                    worker.terminate();
                    reject(new Error(m.message));
                }
            };
            worker.onerror = (e) => {
                worker.terminate();
                reject(new Error('TypeScript engine failed: ' + (e.message || 'worker error')));
            };
            worker.postMessage({ id, inputs });
        });
    },

    async api(action, body) {
        const response = await fetch(`/api/simulation_api.php?action=${action}`, body ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        } : undefined);
        const data = await response.json().catch(() => ({ error: `Server returned HTTP ${response.status}` }));
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    },

    /**
     * Store a TypeScript run's results: hourly rows in chunks (if the run
     * stores hourly data), then summary + daily, which completes the run.
     */
    submit: async function(runId, result, storeHourly, onStatus) {
        if (storeHourly) {
            const chunk = 8760;
            for (let i = 0; i < result.hourly.length; i += chunk) {
                if (onStatus) onStatus(`Saving hourly data... ${Math.round(100 * i / result.hourly.length)}%`);
                await this.api('submit_ts_hourly', { run_id: runId, rows: result.hourly.slice(i, i + chunk) });
            }
        }
        if (onStatus) onStatus('Saving results...');
        await this.api('submit_ts_results', { run_id: runId, summary: result.summary, daily: result.daily });
    },

    // Summary values shown in the comparison (all numeric keys are checked)
    COMPARE_KEYS: [
        ['total_cost', 'Total cost'], ['total_heat_loss_kwh', 'Heat loss'], ['total_solar_gain_kwh', 'Solar gain'],
        ['hp_thermal_kwh', 'HP heat'], ['boiler_thermal_kwh', 'Boiler heat'], ['total_electricity_kwh', 'Electricity'],
        ['unmet_kwh', 'Unmet'], ['avg_water_temp_open', 'Avg temp (open)'], ['min_water_temp_open', 'Min temp (open)'],
        ['days_below_27', 'Days >1°C below'], ['days_below_26', 'Days >2°C below'], ['open_hours', 'Open hours']
    ],

    // Values are rounded to 2 decimals (summary) / 2-3 (stored daily rows)
    same: function(a, b, absTol) {
        if (typeof a !== 'number' || typeof b !== 'number') return a === b || (a == null && b == null);
        return Math.abs(a - b) <= absTol + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
    },

    /** Compare PHP's stored summary/daily rows with a TypeScript result. */
    compare: function(phpSummary, phpDaily, ts) {
        const diffs = [];
        for (const [k, v] of Object.entries(phpSummary || {})) {
            if (typeof v !== 'number') continue;
            if (!this.same(v, ts.summary[k], 0.011)) diffs.push({ key: k, php: v, ts: ts.summary[k] });
        }
        let firstDay = null, daysDiffering = 0;
        const fields = ['avg_water_temp', 'total_loss_kwh', 'total_solar_kwh', 'total_hp_kwh', 'total_boiler_kwh', 'total_cost'];
        const tsByDate = new Map(ts.daily.map(d => [d.date, d]));
        for (const p of phpDaily || []) {
            const t = tsByDate.get(p.date);
            const bad = !t || fields.some(f => !this.same(parseFloat(p[f]), t[f], 0.006));
            if (bad) {
                daysDiffering++;
                if (!firstDay) firstDay = { date: p.date, php: p, ts: t || null };
            }
        }
        if ((phpDaily || []).length !== ts.daily.length) {
            diffs.push({ key: 'days', php: (phpDaily || []).length, ts: ts.daily.length });
        }
        return { ok: diffs.length === 0 && daysDiffering === 0, diffs, daysDiffering, firstDay, days: ts.daily.length };
    },

    renderComparison: function(report, phpSummary, ts, tsMs) {
        const fmt = v => typeof v === 'number' ? v.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(v ?? '-');
        const rows = this.COMPARE_KEYS.map(([k, label]) => {
            const ok = this.same(phpSummary?.[k], ts.summary[k], 0.011);
            return `<tr><td>${escapeHtml(label)}</td><td style="text-align:right;">${escapeHtml(fmt(phpSummary?.[k]))}</td>
                    <td style="text-align:right;">${escapeHtml(fmt(ts.summary[k]))}</td><td>${ok ? '✓' : '<strong style="color:#dc3545;">differs</strong>'}</td></tr>`;
        }).join('');
        const head = report.ok
            ? `<p style="color:#28a745; margin:4px 0;"><strong>✓ TypeScript matches PHP</strong>: all summary values and all ${escapeHtml(report.days)} days (TypeScript ${escapeHtml(tsMs)} ms).</p>`
            : `<p style="color:#dc3545; margin:4px 0;"><strong>TypeScript differs from PHP</strong>: ${escapeHtml(report.diffs.length)} summary value(s), ${escapeHtml(report.daysDiffering)} of ${escapeHtml(report.days)} days.</p>`;
        let detail = '';
        if (!report.ok && report.firstDay) {
            const f = report.firstDay;
            detail = `<p style="font-size:12px; margin:4px 0;">First differing day: <strong>${escapeHtml(f.date)}</strong> -
                PHP avg ${escapeHtml(fmt(parseFloat(f.php.avg_water_temp)))} °C, cost ${escapeHtml(fmt(parseFloat(f.php.total_cost)))};
                TypeScript ${f.ts ? `avg ${escapeHtml(fmt(f.ts.avg_water_temp))} °C, cost ${escapeHtml(fmt(f.ts.total_cost))}` : 'no such day'}.</p>`;
        }
        const other = report.diffs.filter(d => !this.COMPARE_KEYS.some(([k]) => k === d.key));
        if (other.length) {
            detail += `<p style="font-size:12px; margin:4px 0;">Other differing values: ${other.slice(0, 8).map(d =>
                `${escapeHtml(d.key)} (PHP ${escapeHtml(fmt(d.php))}, TS ${escapeHtml(fmt(d.ts))})`).join(', ')}</p>`;
        }
        return `<div style="padding:8px 10px; border:1px solid #dee2e6; border-radius:6px; background:#fafafa;">
            ${head}${detail}
            <table class="data-table compact" style="margin-top:6px;"><thead><tr><th>Engine comparison</th><th style="text-align:right;">PHP</th><th style="text-align:right;">TypeScript</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }
};
