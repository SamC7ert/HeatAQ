// Simulation engines: the PHP engine (server) and the TypeScript port
// (assets/js/sim, built from sim-ts/), which runs in a Web Worker.
//
// Engine setting on the Simulate tab:
//   php        - run on the server (as before)
//   compare    - run PHP, then TypeScript on the same inputs, and report
//                any difference (PHP's results are the ones stored)
//   typescript - the server prepares the run; this browser simulates and
//                submits the results: summary and daily rows first (the run
//                is then complete), hourly rows in the background
//                (HourlySaver, below) while the Details tab uses this
//                browser's copy

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
                    resolve({ result: m.result, ms: m.ms, dailyRows: m.dailyRows });
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
        const payload = body ? JSON.stringify(body) : null;
        const response = await fetch(`/api/simulation_api.php?action=${action}`, payload ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        } : undefined);
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            // Not from HeatAQ (its errors are JSON): the web server or its
            // firewall refused the request - say which step and what it said.
            const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
            const err = new Error(`${action}: web server returned HTTP ${response.status}` +
                (payload ? ` for a ${Math.round(payload.length / 1024)} KB request` : '') + (snippet ? ` (${snippet})` : ''));
            err.status = response.status;
            throw err;
        }
        if (!response.ok || data.error) {
            const err = new Error(`${action}: ${data.error || 'HTTP ' + response.status}`);
            err.status = response.status;
            throw err;
        }
        return data;
    },

    // Shared hosts' firewalls (e.g. ModSecurity) refuse request bodies over
    // ~128 KB, often with a bare 403: upload results in pieces well below.
    MAX_BODY: 90 * 1024,

    /** Split rows into pieces whose JSON stays under MAX_BODY. */
    pieces: function(rows) {
        const out = [];
        let cur = [], size = 0;
        for (const r of rows) {
            const n = JSON.stringify(r).length + 1;
            if (cur.length && size + n > this.MAX_BODY) { out.push(cur); cur = []; size = 0; }
            cur.push(r);
            size += n;
        }
        if (cur.length) out.push(cur);
        return out;
    },

    /** Start-end index pairs of hourly rows, each piece's JSON (17 stored values a row) under MAX_BODY. */
    hourlyBounds: function(rows) {
        const out = [];
        let start = 0, size = 0;
        for (let i = 0; i < rows.length; i++) {
            const n = JSON.stringify(rows[i].slice(0, 17)).length + 1;
            if (i > start && size + n > this.MAX_BODY) { out.push([start, i]); start = i; size = 0; }
            size += n;
        }
        if (rows.length > start) out.push([start, rows.length]);
        return out;
    },

    /** Run async tasks, at most `limit` at a time; rejects with the first error. */
    parallel: async function(tasks, limit) {
        let next = 0, failed = null;
        const lane = async () => {
            while (!failed && next < tasks.length) {
                const task = tasks[next++];
                try { await task(); } catch (e) { failed = failed || e; }
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane));
        if (failed) throw failed;
    },

    /**
     * Run a prepared TypeScript run (run_simulation with engine=typescript):
     * simulate in the worker, then save the daily rows and the summary,
     * which completes the run. Its hourly rows (if the run stores them) stay
     * in this browser for the Details tab and are saved in the background
     * (HourlySaver). On failure the run is marked failed, not left "running".
     */
    runPrepared: async function(prepared, label, onProgress, onStatus) {
        const runId = prepared.run_id;
        const say = t => { if (onStatus) onStatus(t); };
        try {
            const { result, ms, dailyRows } = await this.run(prepared.inputs, onProgress);
            const hourlyPending = !!prepared.store_hourly && result.hourly.length > 0;
            const finish = { run_id: runId, summary: result.summary, hourly_pending: hourlyPending };
            // The days as stored (compact): with the summary in one request
            // when they fit (a year does), else in pieces first
            const days = dailyRows || result.daily;
            if (JSON.stringify(days).length + JSON.stringify(finish).length < this.MAX_BODY) {
                say('Saving results...');
                await this.api('submit_ts_results', { ...finish, daily: days });
            } else {
                const daily = this.pieces(days);
                let sent = 0;
                say('Saving daily results...');
                await this.parallel(daily.map(piece => async () => {
                    await this.api('submit_ts_daily', { run_id: runId, daily: piece });
                    sent++;
                    say(`Saving daily results... ${Math.round(100 * sent / daily.length)}%`);
                }), 3);
                say('Saving results...');
                await this.api('submit_ts_results', finish);
            }
            if (hourlyPending) {
                this.keepLocal(runId, result.hourly);
                HourlySaver.add(runId, label, result.hourly);
            }
            return { result, ms };
        } catch (err) {
            try { await this.api('fail_ts_run', { run_id: runId, message: err.message }); } catch (e) { /* best effort */ }
            throw err;
        }
    },

    // Hourly rows of recent TypeScript runs in this browser: the Details tab
    // reads them instead of the server (also while they are being saved).
    // The newest LOCAL_RUNS are kept, and any still being saved.
    local: new Map(),   // run_id -> { rows, index }
    LOCAL_RUNS: 2,

    keepLocal: function(runId, rows) {
        this.local.set(Number(runId), { rows, index: null });
        this.pruneLocal();
    },

    pruneLocal: function() {
        const ids = [...this.local.keys()];
        for (const id of ids.slice(0, Math.max(0, ids.length - this.LOCAL_RUNS))) {
            if (!HourlySaver.has(id)) this.local.delete(id);
        }
    },

    /** This browser's row for a run's hour ('Y-m-d H:00:00'), or null. */
    localRow: function(runId, timestamp) {
        const e = this.local.get(Number(runId));
        if (!e) return null;
        if (!e.index) {
            e.index = new Map();
            e.rows.forEach((r, i) => { if (!e.index.has(r[0])) e.index.set(r[0], i); });
        }
        const i = e.index.get(timestamp);
        return i === undefined ? null : e.rows[i];
    },

    /**
     * The debug_week response (Thu-Wed week around centerDate) built from
     * this browser's rows of a run, or null when it has none for that week.
     */
    localWeek: function(runId, centerDate) {
        const e = this.local.get(Number(runId));
        if (!e) return null;
        const c = Date.parse(centerDate + 'T00:00:00Z');
        const dow = new Date(c).getUTCDay() || 7;          // 1 = Mon ... 7 = Sun
        const back = dow >= 4 ? dow - 4 : dow + 3;
        const day = n => new Date(c + n * 86400000).toISOString().slice(0, 10);
        const start = day(-back), end = day(6 - back);
        const data = [];
        for (const r of e.rows) {
            const d = r[0].slice(0, 10);
            if (d < start) continue;
            if (d > end) break;
            data.push({
                timestamp: r[0].slice(0, 16), hour: data.length,
                air_temp: r[1], wind_speed: r[2], humidity: r[3], water_temp: r[6],
                total_loss: r[9], net_demand: r[9] - r[10], solar_gain: r[10],
                hp_output: r[11], hp_electric: r[13], hp_cop: r[15],
                boiler_output: r[12], boiler_fuel: r[14],
                is_open: !!r[8], has_cover: !r[8], heating_mode: r[17]
            });
        }
        if (!data.length) return null;
        return { run_id: Number(runId), source: 'browser', start_date: start, end_date: end,
                 center_date: centerDate, hours: data.length, data };
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

// Background saving of TypeScript runs' hourly rows, after the run itself
// (summary + daily) is saved, with a progress panel in the top bar. One
// queue for all runs, oldest first; a few requests at a time (one while a
// server-side simulation runs, so the host is not loaded twice).
const HourlySaver = {
    jobs: [],         // { runId, label, rows, bounds, pending, failed, inFlight, saved, total, state, error, t0 }
    inFlight: 0,
    foregroundCount: 0,
    LIMIT: 3,
    RETRIES: 2,
    note: null,       // { text, kind } shown briefly when nothing is saving
    noteTimer: null,
    leaving: false,

    has: function(runId) { return this.jobs.some(j => j.runId === Number(runId)); },
    failed: function(runId) { return this.jobs.some(j => j.runId === Number(runId) && j.state === 'failed'); },

    add: function(runId, label, rows) {
        const bounds = SimEngine.hourlyBounds(rows);
        this.jobs.push({
            runId: Number(runId), label: label || '', rows, bounds,
            pending: bounds.map((_, i) => i), failed: [], inFlight: 0,
            saved: 0, total: rows.length, state: 'saving', error: null, t0: Date.now()
        });
        this.render();
        this.pump();
    },

    /** Around a request that runs a simulation on the server. */
    foregroundStart: function() { this.foregroundCount++; },
    foregroundEnd: function() {
        this.foregroundCount = Math.max(0, this.foregroundCount - 1);
        this.pump();
    },

    pump: function() {
        const limit = this.foregroundCount > 0 ? 1 : this.LIMIT;
        while (this.inFlight < limit) {
            const job = this.jobs.find(j => j.state === 'saving' && j.pending.length);
            if (!job) break;
            this.send(job, job.pending.shift());
        }
    },

    send: async function(job, piece) {
        this.inFlight++;
        job.inFlight++;
        const [a, b] = job.bounds[piece];
        const rows = job.rows.slice(a, b).map(r => r.slice(0, 17));
        let err = null;
        for (let attempt = 0; attempt <= this.RETRIES; attempt++) {
            try {
                await SimEngine.api('submit_ts_hourly', { run_id: job.runId, rows });
                err = null;
                break;
            } catch (e) {
                err = e;
                // Run no longer saving (409) / hours removed by retention (410)
                if (e.status === 409 || e.status === 410 || !this.jobs.includes(job)) break;
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            }
        }
        this.inFlight--;
        job.inFlight--;
        if (!this.jobs.includes(job)) {
            // dismissed or abandoned meanwhile
        } else if (!err) {
            job.saved += b - a;
            if (job.state === 'saving' && !job.pending.length && !job.inFlight && !job.failed.length) {
                await this.finish(job);
            }
        } else if (err.status === 410) {
            this.notKept(job);
        } else {
            job.failed.push(piece);
            if (job.state !== 'failed') {
                job.state = 'failed';
                job.error = err.message;
                this.changed(job.runId);
            }
        }
        this.render();
        this.pump();
    },

    finish: async function(job) {
        job.state = 'finishing';
        try {
            await SimEngine.api('finish_ts_hourly', { run_id: job.runId });
            this.remove(job);
            this.flash(`Hourly data saved ✓ (run ${job.runId})`, 'ok');
            this.ended(job.runId, true);
        } catch (e) {
            if (e.status === 410) {
                this.notKept(job);
            } else {
                job.state = 'failed';
                job.error = e.message;
                this.changed(job.runId);
            }
        }
    },

    /** Retention removed the run's hours meanwhile (newer runs took their place). */
    notKept: function(job) {
        this.remove(job);
        this.flash(`Run ${job.runId}: hourly data not kept (only the newest 5 runs keep it)`, 'info');
        this.ended(job.runId, false);
    },

    ended: function(runId, saved) {
        if (typeof SimulationsModule !== 'undefined' && SimulationsModule.hourlySaveEnded) {
            SimulationsModule.hourlySaveEnded(runId, saved);
        }
    },

    remove: function(job) {
        this.jobs = this.jobs.filter(j => j !== job);
        SimEngine.pruneLocal();
    },

    retry: function(runId) {
        const job = this.jobs.find(j => j.runId === Number(runId) && j.state === 'failed');
        if (!job) return;
        job.pending = job.failed.concat(job.pending);
        job.failed = [];
        job.error = null;
        job.state = 'saving';
        this.changed(job.runId);
        if (!job.pending.length && !job.inFlight) {
            this.finish(job).then(() => { this.render(); this.pump(); });
        }
        this.render();
        this.pump();
    },

    dismiss: function(runId) {
        const job = this.jobs.find(j => j.runId === Number(runId));
        if (job) this.remove(job);
        this.render();
        this.changed(runId);   // the run now shows as "hours incomplete"
    },

    /** Re-render the run views showing this run's saving state. */
    changed: function(runId) {
        const sm = typeof SimulationsModule !== 'undefined' ? SimulationsModule : null;
        if (sm && sm.currentRun && Number(sm.currentRun.run_id) === Number(runId)) sm.renderRunDetail();
        if (sm && (sm.runs || []).some(r => Number(r.run_id) === Number(runId))) sm.renderRunsList();
    },

    /** Stop everything (project switched: the runs are another site's). */
    abandon: function() {
        this.jobs = [];
        SimEngine.local.clear();
        this.render();
    },

    /** Ask before an action that stops the saving; true = go ahead. leavingPage: no second "leave page?" question. */
    confirmLeave: function(action, leavingPage) {
        if (!this.jobs.length) return true;
        const n = this.jobs.length;
        const ok = confirm(`Hourly data of ${n} run${n > 1 ? 's' : ''} is still being saved in the background.\n\n` +
            `${action} stops it: the hours stay incomplete (Recreate hours can rebuild them). Continue?`);
        if (ok && leavingPage) this.leaving = true;
        return ok;
    },

    flash: function(text, kind) {
        this.note = { text, kind };
        clearTimeout(this.noteTimer);
        this.noteTimer = setTimeout(() => { this.note = null; this.render(); }, kind === 'ok' ? 4000 : 8000);
    },

    open: function(runId) {
        if (typeof app !== 'undefined' && app.navigation) {
            app.navigation.switchSection('simcontrol', false);
            document.querySelectorAll('.nav-item').forEach(a =>
                a.classList.toggle('active', (a.getAttribute('onclick') || '').includes("'simcontrol'")));
        }
        if (typeof SimControlModule !== 'undefined' && SimControlModule.switchTab) SimControlModule.switchTab('history');
        if (typeof SimulationsModule !== 'undefined') SimulationsModule.selectRun(runId);
    },

    render: function() {
        const el = document.getElementById('hourly-saver');
        if (!el) return;
        const active = this.jobs.filter(j => j.state !== 'failed');
        const failed = this.jobs.filter(j => j.state === 'failed');
        if (!this.jobs.length && !this.note) {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }
        el.hidden = false;
        const fmt = n => n.toLocaleString('en-GB');
        let html = '';
        if (active.length) {
            const saved = active.reduce((t, j) => t + j.saved, 0);
            const total = active.reduce((t, j) => t + j.total, 0);
            const pct = total ? Math.floor(100 * saved / total) : 0;
            const tips = active.map(j => {
                const secs = (Date.now() - j.t0) / 1000;
                const eta = j.saved > 0 ? Math.round((j.total - j.saved) * secs / j.saved) : null;
                return `Run ${j.runId} ${j.label}: ${fmt(j.saved)} of ${fmt(j.total)} hours` +
                    (eta !== null ? `, about ${eta < 90 ? eta + ' s' : Math.round(eta / 60) + ' min'} left` : '');
            }).join('\n');
            html += `<div class="hs-line" title="${escapeHtml(tips)}" onclick="HourlySaver.open(${active[0].runId})">
                <span class="hs-spin">⟳</span> Background saving hourly data ${pct}%
                <span class="hs-sub">${active.length > 1 ? `(${active.length} runs)` : `· Run ${active[0].runId}`}</span>
                <div class="hs-bar"><div style="width:${pct}%;"></div></div></div>`;
        }
        for (const j of failed) {
            html += `<div class="hs-line hs-failed" title="${escapeHtml(j.error || '')}">
                <span onclick="HourlySaver.open(${j.runId})">⚠ Hourly saving failed · Run ${j.runId}</span>
                <button class="btn btn-sm" onclick="HourlySaver.retry(${j.runId})">Retry</button>
                <button class="btn btn-sm" onclick="HourlySaver.dismiss(${j.runId})">Dismiss</button></div>`;
        }
        if (!this.jobs.length && this.note) {
            html = `<div class="hs-line hs-${this.note.kind}">${escapeHtml(this.note.text)}</div>`;
        }
        el.innerHTML = html;
    }
};

// Leaving the page stops the saving
window.addEventListener('beforeunload', (e) => {
    if (HourlySaver.jobs.length && !HourlySaver.leaving) {
        e.preventDefault();
        e.returnValue = '';
    }
});
