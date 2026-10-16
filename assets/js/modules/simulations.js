/**
 * HeatAQ Simulations Module
 * Handles simulation UI and API interactions
 */

const SimulationsModule = {
    // State
    runs: [],
    currentRun: null,
    // Run the Details tab inspects: the run selected in History or the run
    // just executed ({run_id, start_date, end_date}). Null = server default.
    inspectRun: null,
    weatherRange: null,
    debugTimestamp: null,  // Current debug date+hour for chart highlighting
    dailyChart: null,      // Chart instance for History tab

    /**
     * Initialize simulations module
     */
    init: function() {
        // Set default dates immediately
        const startInput = document.getElementById('sim-start-date');
        const endInput = document.getElementById('sim-end-date');
        if (startInput) startInput.value = '2024-01-01';
        if (endInput) endInput.value = '2024-12-31';

        this.loadWeatherRange();
        this.loadRuns();
    },

    /**
     * Load available weather data range
     */
    loadWeatherRange: async function() {
        try {
            const response = await fetch('/api/simulation_api.php?action=get_weather_range');
            const data = await response.json();
            if (data.weather_range) {
                this.weatherRange = data.weather_range;
                this.updateDateInputs();
            }
        } catch (error) {
            console.error('Failed to load weather range:', error);
        }
    },

    /**
     * Update date input constraints based on weather data
     */
    updateDateInputs: function() {
        const startInput = document.getElementById('sim-start-date');
        const endInput = document.getElementById('sim-end-date');

        if (this.weatherRange && startInput && endInput) {
            startInput.min = this.weatherRange.min_date;
            startInput.max = this.weatherRange.max_date;
            endInput.min = this.weatherRange.min_date;
            endInput.max = this.weatherRange.max_date;

            // Set default to last full year of data using string manipulation
            // to avoid timezone issues
            const maxDateStr = this.weatherRange.max_date; // "YYYY-MM-DD"
            const maxYear = parseInt(maxDateStr.substring(0, 4));

            // Default: full previous year (e.g., if max is 2023-12-31, use 2023-01-01 to 2023-12-31)
            startInput.value = `${maxYear}-01-01`;
            endInput.value = `${maxYear}-12-31`;

            // Update weather info display
            const rangeInfo = document.getElementById('weather-range-info');
            if (rangeInfo) {
                rangeInfo.textContent = `Weather data: ${this.weatherRange.min_date} to ${this.weatherRange.max_date} (${this.weatherRange.days_count} days)`;
            }
        }
    },

    /**
     * Load simulation runs
     */
    loadRuns: async function() {
        try {
            // Newest 20 runs, plus every baseline (they stay listed however
            // many runs follow)
            const [recent, baselines] = await Promise.all([
                fetch('/api/simulation_api.php?action=get_runs&limit=20').then(r => r.json()),
                fetch('/api/simulation_api.php?action=get_runs&baseline=1&limit=100').then(r => r.json()).catch(() => ({}))
            ]);
            if (recent.runs) {
                const base = baselines.runs || [];
                const ids = new Set(base.map(r => r.run_id));
                this.runs = [...base, ...recent.runs.filter(r => !ids.has(r.run_id))];
                this.renderRunsList();
            }
        } catch (error) {
            console.error('Failed to load runs:', error);
        }
    },

    // Currently selected run in history table
    selectedRunId: null,

    /**
     * Render runs list as metrics table
     */
    renderRunsList: function() {
        const container = document.getElementById('simulation-runs-list');
        if (!container) return;

        if (this.runs.length === 0) {
            container.innerHTML = '<p class="no-runs">No simulation runs yet. Create your first simulation above.</p>';
            return;
        }

        // Build table with key metrics
        const html = `
            <table class="data-table history-table">
                <thead>
                    <tr>
                        <th title="Baseline: kept permanently to compare against">★</th>
                        <th>Scenario</th>
                        <th>Dates</th>
                        <th>Schedule</th>
                        <th>HP (kW)</th>
                        <th>Boiler (kW)</th>
                        <th>Elec (MWh)</th>
                        <th title="Days with an open hour more than 1 °C below its target">&lt;1°C</th>
                        <th title="Days with an open hour more than 2 °C below its target">&lt;2°C</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.runs.map(run => {
                        const s = run.summary || {};
                        const config = run.config || {};
                        const equip = config.equipment || {};
                        const hpCap = equip.heat_pump?.capacity_kw || equip.hp_capacity_kw || '-';
                        const boilerCap = equip.boiler?.capacity_kw || equip.boiler_capacity_kw || '-';
                        const scheduleName = config.schedule_template_name || '-';
                        // All electricity (HP, plus an electric boiler since 3.16)
                        const elecKwh = s.total_electricity_kwh ?? s.total_hp_energy_kwh;
                        const elecMwh = elecKwh ? (elecKwh / 1000).toFixed(1) : '-';
                        const isBaseline = Number(run.is_baseline) === 1;
                        const days1 = s.days_below_27 ?? '-';
                        const days2 = s.days_below_26 ?? '-';
                        const isSelected = this.selectedRunId === run.run_id;

                        return `
                            <tr class="run-row ${escapeHtml(run.status)}${isSelected ? ' selected' : ''}"
                                data-run-id="${escapeHtml(run.run_id)}"
                                onclick="SimulationsModule.selectRun(${run.run_id})"
                                style="cursor: pointer;">
                                <td>${run.status === 'completed'
                                    ? `<span class="baseline-star${isBaseline ? ' on' : ''}" title="${isBaseline ? 'Baseline - click to unmark' : 'Mark as baseline'}"
                                         onclick="event.stopPropagation(); SimulationsModule.toggleBaseline(${Number(run.run_id)}, ${isBaseline ? 0 : 1})">${isBaseline ? '★' : '☆'}</span>`
                                    : ''}</td>
                                <td class="run-name">${this.escapeHtml(run.scenario_name)}</td>
                                <td class="run-dates">${escapeHtml(run.start_date.substring(5))} - ${escapeHtml(run.end_date.substring(5))}</td>
                                <td class="run-schedule" title="${this.escapeHtml(scheduleName)}">${this.escapeHtml(scheduleName.substring(0, 15))}</td>
                                <td>${escapeHtml(hpCap)}</td>
                                <td>${escapeHtml(boilerCap)}</td>
                                <td>${elecMwh}</td>
                                <td class="${days1 > 10 ? 'bad' : days1 > 0 ? 'warning' : ''}">${escapeHtml(days1)}</td>
                                <td class="${days2 > 5 ? 'bad' : days2 > 0 ? 'warning' : ''}">${escapeHtml(days2)}</td>
                                <td><span class="status-badge status-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>${run.hourly_purged_at
                                    ? ' <span class="text-muted" title="Hourly data removed (only the newest 5 runs keep it); summary and daily results are kept" style="font-size:11px;">no hours</span>'
                                    : run.summary?.hourly_saving
                                    ? (HourlySaver.failed(run.run_id)
                                        ? ' <span title="Saving of the hourly data failed: Retry in the top bar" style="font-size:11px; color:#dc3545;">saving failed</span>'
                                        : HourlySaver.has(run.run_id)
                                        ? ' <span class="text-muted" title="Hourly data is being saved in the background" style="font-size:11px;">saving hours</span>'
                                        : ' <span title="Saving of the hourly data was interrupted; Recreate hours rebuilds them" style="font-size:11px; color:#b8860b;">hours incomplete</span>')
                                    : ''}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;

        // Auto-select first run if none selected
        if (!this.selectedRunId && this.runs.length > 0) {
            this.selectRun(this.runs[0].run_id);
        }
    },

    /**
     * Select a run in history table and show its detail
     */
    selectRun: async function(runId) {
        // Update selection state
        this.selectedRunId = runId;

        // Update row highlighting
        document.querySelectorAll('.history-table .run-row').forEach(row => {
            row.classList.toggle('selected', parseInt(row.dataset.runId) === runId);
        });

        // Fetch full run data and show detail
        try {
            const response = await fetch(`/api/simulation_api.php?action=get_run&run_id=${runId}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // Store current run and render detail
            this.currentRun = data.run;
            this.setInspectRun(data.run);
            this.renderRunDetail();

            // Show the detail container
            const detail = document.getElementById('simulation-detail');
            if (detail) detail.style.display = '';

            // Load and render the daily chart
            this.loadDailyResults(runId);

        } catch (error) {
            console.error('Failed to load run:', error);
        }
    },

    /**
     * Start a new simulation
     */
    startSimulation: async function() {
        const scenarioName = document.getElementById('sim-scenario-name').value || 'Unnamed Scenario';
        // Remembered per project: the Simulate tab shows it again after a project switch
        if (typeof SimControlModule !== 'undefined' && document.getElementById('sim-scenario-name').value) {
            SimControlModule.savePreference('last_scenario_name', document.getElementById('sim-scenario-name').value);
        }
        const startDate = document.getElementById('sim-start-date').value;
        const endDate = document.getElementById('sim-end-date').value;
        const description = document.getElementById('sim-description').value || '';
        const configId = document.getElementById('sim-config-select')?.value || null;
        const ohcId = document.getElementById('sim-ohc-select')?.value || null;

        // Validation
        if (!startDate || !endDate) {
            alert('Please select start and end dates');
            return;
        }
        if (!ohcId) {
            alert('Please select a schedule (Open Hours Calendar). If the list is empty, create one under Schedules first.');
            return;
        }

        if (new Date(endDate) < new Date(startDate)) {
            alert('End date must be after start date');
            return;
        }

        // Read the overrides first: invalid input stops here with a message
        // instead of being sent as 0, a truncated number or null.
        const statusEl = document.getElementById('simulation-status');
        let configOverride;
        try {
            configOverride = this.buildConfigOverride();
        } catch (error) {
            if (statusEl) {
                statusEl.textContent = `Run not started: ${error.message}`;
                statusEl.style.color = '#dc3545';
            }
            return;
        }

        // Engine: php (server), compare (PHP, then TypeScript on the same
        // inputs), typescript (simulated in this browser) - see simengine.js
        const engine = document.getElementById('sim-engine')?.value || 'php';
        const compareEl = document.getElementById('engine-compare-report');
        if (compareEl) compareEl.innerHTML = '';

        // Disable button and show progress
        const btn = document.getElementById('run-simulation-btn');
        btn.disabled = true;
        btn.textContent = 'Running...';

        // Get simulator version to display
        let simVersion = 'unknown';
        try {
            const versionRes = await fetch('/api/simulation_api.php?action=get_version');
            const versionData = await versionRes.json();
            simVersion = versionData.simulator_version || 'unknown';
        } catch (e) { /* ignore */ }

        if (statusEl) {
            statusEl.textContent = `Simulation v${simVersion} started — loading weather, solar and schedule data...`;
            statusEl.style.color = '#666';
        }

        // Live progress: the run is one long POST, so poll the server-side
        // progress (written once per simulated month) while it is in flight.
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (this._progressTimer) clearInterval(this._progressTimer);
        this._progressTimer = setInterval(async () => {
            try {
                const r = await fetch('/api/simulation_api.php?action=get_run_progress');
                const d = await r.json();
                if (d.running && d.progress && d.progress.period && statusEl) {
                    const [y, m] = d.progress.period.split('-');
                    statusEl.textContent = `Simulating ${monthNames[parseInt(m, 10) - 1]} ${y}... (${d.progress.pct}% of period)`;
                }
            } catch (e) { /* polling is best-effort */ }
        }, 3000);  // progress is written once per simulated month; 3s keeps request rate low
        const stopProgressPoll = () => {
            if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
        };

        try {
            // Get pool_id from SimControl selection
            const poolId = typeof SimControlModule !== 'undefined' ? SimControlModule.currentPoolId : null;

            // Get store_hourly option
            const storeHourly = document.getElementById('sim-store-hourly')?.checked ?? false;

            // A server-side run: background hourly saving slows down meanwhile
            let data;
            HourlySaver.foregroundStart();
            try {
                const response = await fetch('/api/simulation_api.php?action=run_simulation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        scenario_name: scenarioName,
                        start_date: startDate,
                        end_date: endDate,
                        description: description,
                        config_id: configId,
                        template_id: ohcId,
                        pool_id: poolId,
                        config_override: configOverride,
                        store_hourly: storeHourly,
                        engine: engine === 'typescript' ? 'typescript' : 'php'
                    })
                });
                data = await response.json();
            } finally {
                HourlySaver.foregroundEnd();
            }
            stopProgressPoll();

            if (data.error) {
                throw new Error(data.error);
            }

            // TypeScript engine: the server prepared the run and sent its
            // inputs; simulate here and submit the results.
            if (data.status === 'prepared') {
                const setStatus = (t) => { if (statusEl) { statusEl.textContent = t; statusEl.style.color = '#666'; } };
                setStatus('TypeScript engine running in this browser...');
                const { result, ms } = await SimEngine.runPrepared(data, scenarioName, (period, pct) => {
                    const [y, m] = period.split('-');
                    setStatus(`TypeScript: simulating ${monthNames[parseInt(m, 10) - 1]} ${y}... (${pct}%)`);
                }, setStatus);
                data.simulator_version = (data.inputs.simulator_version || '') + ' (TypeScript, ' + ms + ' ms)';
                data.summary = result.summary;
            }

            // DEBUG: Log schedule resolution info
            console.log('[Simulation] Run completed:', data);
            if (data.meta?.schedule_debug) {
                console.log('[Simulation] Schedule Debug:', data.meta.schedule_debug);
                console.log(`  Requested template_id: ${data.meta.schedule_debug.requested_template_id}`);
                console.log(`  Loaded template: ${data.meta.schedule_debug.loaded_template_name} (ID: ${data.meta.schedule_debug.loaded_template_id})`);
                console.log(`  Test date: ${data.meta.schedule_debug.test_date}`);
                console.log(`  Schedule for test date: ${data.meta.schedule_debug.test_schedule_name}`);
            }

            // Show success with date/time and version
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const version = data.simulator_version || 'unknown';
            if (statusEl) {
                statusEl.textContent = `${data.run_id ? `Run #${data.run_id} · ` : ''}Simulation v${version} completed ${dateStr} - ${timeStr}`;
                statusEl.style.color = '#28a745';
            }

            // Compare: run TypeScript on this run's inputs and report differences
            if (engine === 'compare' && data.run_id && compareEl) {
                compareEl.innerHTML = '<p class="text-muted" style="font-size:12px;">Comparing with the TypeScript engine...</p>';
                try {
                    const [inp, dailyRes] = await Promise.all([
                        SimEngine.api(`get_sim_inputs&run_id=${encodeURIComponent(data.run_id)}`),
                        fetch(`/api/simulation_api.php?action=get_daily_results&run_id=${encodeURIComponent(data.run_id)}`).then(r => r.json())
                    ]);
                    const { result, ms } = await SimEngine.run(inp.inputs);
                    const report = SimEngine.compare(data.summary, dailyRes.daily_results || [], result);
                    compareEl.innerHTML = SimEngine.renderComparison(report, data.summary, result, ms);
                } catch (err) {
                    compareEl.innerHTML = `<p class="error">Comparison failed: ${escapeHtml(err.message)}</p>`;
                }
            }

            // Show the new run in the Simulate tab: report, summary cards and
            // yearly chart (the same view as on tab entry).
            if (data.run_id) {
                await this.autoLoadLastRun(data.run_id, { keepStatus: true });
            } else if (typeof SimControlModule !== 'undefined' && data.summary) {
                SimControlModule.showBenchmarkReport({
                    summary: data.summary,
                    meta: data.meta || {}
                });
            }

            // Reload runs list
            this.loadRuns();

            // Refresh the Monthly Surface Heat Loss report for the new run
            // (it otherwise only loads the latest run at page init, so it
            // would keep showing the previous run's data).
            if (typeof SimControlModule !== 'undefined' && data.run_id && SimControlModule.loadMonthlyReport) {
                SimControlModule.loadMonthlyReport(data.run_id);
                // Keep the report's run-info label in sync with the table.
                const mInfo = document.getElementById('monthly-report-run-info');
                if (mInfo) mInfo.textContent = `${scenarioName || 'Unnamed'} (${startDate} to ${endDate})`;
            }

            // View the new run
            if (data.run_id) {
                // and inspect it in Details (hours computed on demand if not saved)
                setTimeout(() => this.viewRun(data.run_id, { inspect: true }), 1000);
            }

        } catch (error) {
            stopProgressPoll();
            if (statusEl) {
                statusEl.textContent = `Error: ${error.message}`;
                statusEl.style.color = '#dc3545';
            }
        } finally {
            btn.disabled = false;
            btn.textContent = 'Run Simulation';
        }
    },

    /**
     * View a simulation run
     */
    viewRun: async function(runId, options = {}) {
        try {
            const response = await fetch(`/api/simulation_api.php?action=get_run&run_id=${runId}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.currentRun = data.run;
            if (options.inspect !== false) this.setInspectRun(data.run);
            this.renderRunDetail();

            // Also load daily results for charts
            this.loadDailyResults(runId);

        } catch (error) {
            console.error('Failed to load run:', error);
            alert('Failed to load simulation run');
        }
    },

    setInspectRun: function(run) {
        if (run && run.run_id && run.status === 'completed') {
            this.inspectRun = { run_id: run.run_id, start_date: run.start_date, end_date: run.end_date };
        }
    },

    /**
     * "&run_id=N" for debug_hour/debug_week when the date lies in the
     * inspected run, so the hour panel and week chart show that run (and the
     * same one). Otherwise '' and the server picks the newest completed run
     * with hourly data covering the date - the same rule for both calls.
     */
    debugRunParam: function(date) {
        const r = this.inspectRun;
        if (r && date >= r.start_date && date <= r.end_date) {
            return `&run_id=${encodeURIComponent(r.run_id)}`;
        }
        return '';
    },

    /**
     * Project switched: forget everything that belongs to the previous
     * project's runs (selected / inspected run, run detail, Details hours,
     * Simulate status and comparisons). The tabs reload their data for the
     * new project when opened.
     */
    resetProjectState: function() {
        this.runs = [];
        this.selectedRunId = null;
        this.currentRun = null;
        this.inspectRun = null;
        this.hoursSource = {};
        this.hoursPending = {};
        const clear = (id, html = '') => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
        clear('simulation-status');
        clear('engine-compare-report');
        hide('sim-last-run-results');
        clear('simulation-detail');
        hide('simulation-detail');
        clear('comparison-results');
        // Overrides belong to the project: the new project's are loaded with
        // its configuration (loadSavedOverrides); the engine choice stays
        ['sim-hp-override', 'sim-boiler-override', 'sim-target-offset', 'sim-upper-tol-override',
         'sim-bathers-override', 'sim-activity-override', 'sim-wind-override', 'sim-solar-override',
         'sim-strategy', 'sim-planning-weather'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        // Details: run info, hours note, hour panel cards and the week chart
        clear('debug-run-display');
        ['debug-config-display', 'debug-ohc-display'].forEach(id => clear(id, '-'));
        clear('debug-hours-note');
        ['debug-input', 'debug-evaporation', 'debug-convection', 'debug-radiation', 'debug-solar',
         'debug-structural', 'debug-cover', 'debug-heatpump', 'debug-boiler', 'debug-summary'].forEach(id => clear(id));
        hide('debug-weekly-charts');
        hide('week-nav-buttons');
        const placeholder = document.getElementById('debug-weekly-chart-placeholder');
        if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'Press Calculate to load weekly data'; }
    },

    /** HourlySaver finished (or gave up on) a run's hours: update the run views. */
    hourlySaveEnded: function(runId, saved) {
        const update = (r) => {
            if (!r || Number(r.run_id) !== Number(runId)) return false;
            if (r.summary) delete r.summary.hourly_saving;
            if (saved) r.has_hourly = true;
            else r.hourly_purged_at = r.hourly_purged_at || 'now';
            return true;
        };
        if (update(this.currentRun)) this.renderRunDetail();
        if ((this.runs || []).some(update)) this.renderRunsList();
    },

    /**
     * Hours on demand: make sure this browser holds the hours of the run the
     * Details tab shows for this date (the inspected run). If it does not,
     * they are computed from the run's saved inputs (get_sim_inputs; the
     * TypeScript engine gives the same hours as PHP), unless the run was made
     * with another simulator version and has its own saved hours - those are
     * the exact record and are read from the database instead. A recomputed
     * run is checked against its saved daily results (debug-hours-note).
     */
    hoursPending: {},

    ensureHours: async function(date) {
        const r = this.inspectRun;
        if (!r || date < r.start_date || date > r.end_date) return null;
        const id = Number(r.run_id);
        if (SimEngine.local.has(id)) { this.showHoursNote(id); return id; }
        if (!this.hoursPending[id]) {
            this.hoursPending[id] = this.computeHours(id).finally(() => { delete this.hoursPending[id]; });
        }
        return this.hoursPending[id];
    },

    computeHours: async function(id) {
        const note = document.getElementById('debug-hours-note');
        try {
            const runResp = await SimEngine.api(`get_run&run_id=${encodeURIComponent(id)}`);
            const run = runResp.run || {};
            const runVersion = run.config?.simulator_version || null;
            if (!run.config?.has_schedule_copy) {
                this.hoursSource[id] = { kind: 'database', reason: 'This run has no saved copy of its schedule (made before V239): hours from the database, if kept.' };
                this.showHoursNote(id);
                return null;
            }
            this.engineVersion = this.engineVersion || (await SimEngine.api('get_version')).simulator_version;
            const engineVersion = this.engineVersion;
            if (run.has_hourly && runVersion && engineVersion && runVersion !== engineVersion) {
                // The run's own saved hours are the exact record of that version
                this.hoursSource[id] = { kind: 'database', reason: `Hours from the database, as saved by simulator ${runVersion} (this engine is ${engineVersion}).` };
                this.showHoursNote(id);
                return null;
            }
            if (note) note.innerHTML = `<span class="text-muted">Computing the hours of run #${escapeHtml(id)} in this browser...</span>`;
            const inp = await SimEngine.api(`get_sim_inputs&run_id=${encodeURIComponent(id)}`);
            const t0 = Date.now();
            const { result } = await SimEngine.run(inp.inputs);
            const ms = Date.now() - t0;
            SimEngine.keepLocal(id, result.hourly, inp.inputs);
            // Do the recomputed days match what the run saved?
            let check = null;
            try {
                const dailyRes = await fetch(`/api/simulation_api.php?action=get_daily_results&run_id=${encodeURIComponent(id)}`).then(x => x.json());
                check = SimEngine.compare(run.summary || {}, dailyRes.daily_results || [], result);
            } catch (e) { /* check unavailable */ }
            this.hoursSource[id] = { kind: 'computed', ms, runVersion, engineVersion, check };
            this.showHoursNote(id);
            return id;
        } catch (err) {
            this.hoursSource[id] = { kind: 'error', reason: `Could not compute the hours: ${err.message}` };
            this.showHoursNote(id);
            return null;
        }
    },

    hoursSource: {},

    /** Where the Details hours of a run come from, under the week chart heading. */
    showHoursNote: function(id) {
        const note = document.getElementById('debug-hours-note');
        if (!note) return;
        const s = this.hoursSource[id];
        if (!s) {
            note.innerHTML = SimEngine.local.has(Number(id))
                ? `<span class="text-muted">Run #${escapeHtml(id)}: hours from this browser (latest run).</span>` : '';
            return;
        }
        if (s.kind !== 'computed') {
            note.innerHTML = `<span class="${s.kind === 'error' ? 'error' : 'text-muted'}">Run #${escapeHtml(id)}: ${escapeHtml(s.reason)}</span>`;
            return;
        }
        const other = s.runVersion && s.engineVersion && s.runVersion !== s.engineVersion;
        const base = `Run #${escapeHtml(id)}: hours computed in this browser from the run's saved inputs (${escapeHtml(s.ms)} ms)`;
        if (s.check && !s.check.ok) {
            note.innerHTML = `<span style="color:#b8860b;">${base}, with simulator ${escapeHtml(s.engineVersion)}. `
                + `They do not match the run's saved results (${escapeHtml(s.check.daysDiffering)} of ${escapeHtml(s.check.days)} days differ`
                + `${other ? `; the run was made with ${escapeHtml(s.runVersion)}` : '; weather or solar data may have changed since'}). `
                + `Re-run the scenario to compare like with like.</span>`;
        } else {
            note.innerHTML = `<span class="text-muted">${base}${other ? `, with simulator ${escapeHtml(s.engineVersion)} (run made with ${escapeHtml(s.runVersion)}; results match)` : ''}.</span>`;
        }
    },

    /** The inspected run, if this browser holds its hours (TypeScript run) and it covers the date. */
    localDebugRun: function(date) {
        const r = this.inspectRun;
        if (r && date >= r.start_date && date <= r.end_date && SimEngine.local.has(Number(r.run_id))) {
            return Number(r.run_id);
        }
        return null;
    },

    /**
     * The Details hour panel's data. The server gives the run (the inspected
     * one, else the newest covering the date), its settings, the day's
     * schedule and the hour's saved row if its hours are saved; the run's
     * values for the hour come from this browser's copy of its hours when
     * there is one. The hour's losses, gains and heating are then computed
     * here from the run's inputs (HeatAQSim.debugHour), at the hour's start
     * water temperature and the run's open state.
     */
    loadHourData: async function(date, hour) {
        const ts = `${date} ${String(hour).padStart(2, '0')}:00:00`;
        const res = await fetch(`/api/simulation_api.php?action=debug_hour&date=${date}&hour=${hour}${this.debugRunParam(date)}`);
        const info = await api.parseJson(res);
        if (info.error) throw new Error(info.error);
        const runId = Number(info.run_id);
        if (!this.debugRunParam(date) && info.start_date) {
            // No run inspected for this date: the one the server chose
            this.inspectRun = { run_id: runId, start_date: info.start_date, end_date: info.end_date };
        }
        await this.ensureHours(date);
        const row = SimEngine.localRow(runId, ts);
        let stored = info.stored;
        if (row) {
            // HourlyRow: [ts, air, wind, hum, solar, target, water, water_start, is_open, loss,
            //   solar_kw, hp, boiler, hp_elec, boiler_fuel, cop, cost, mode, hold level]
            stored = { water_temp: row[6], water_temp_start: row[7], is_open: !!row[8], total_loss_kw: row[9],
                       solar_gain_kw: row[10], hp_heat_kw: row[11], boiler_heat_kw: row[12], hp_cop: row[15],
                       heating_mode: row[17], hold_temp: row[18] };
        }
        if (!stored) throw new Error(`Run #${runId} has no hours for ${ts}`);
        const inputs = await SimEngine.inputsFor(runId);
        if (!inputs) {
            throw new Error(`Run #${runId} was made before runs saved their inputs (V239): re-run it to inspect its hours.`);
        }
        const calc = HeatAQSim.debugHour(inputs, ts, stored.water_temp_start, stored.is_open);
        if (calc.error) throw new Error(calc.error);
        const data = {
            ...calc,
            stored: { ...stored, run_id: runId, simulator_version: info.simulator_version, source: row ? 'browser' : 'database' },
            config_info: info.config_info,
            schedule_debug: info.schedule_debug,
        };
        const storedNet = stored.total_loss_kw - stored.solar_gain_kw;
        const diff = Math.abs(storedNet - calc.summary.net_requirement_kw);
        if (diff > 1.0) {
            data.validation_warning = `Recalc differs from the run: run=${storedNet.toFixed(1)} kW, recalc=${calc.summary.net_requirement_kw.toFixed(1)} kW (diff=${diff.toFixed(1)})`;
        }
        return data;
    },

    /** Download a run's saved inputs as JSON (get_sim_inputs). */
    exportInputs: async function(runId) {
        try {
            const data = await SimEngine.api(`get_sim_inputs&run_id=${encodeURIComponent(runId)}`);
            const blob = new Blob([JSON.stringify(data.inputs)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `heataq-run-${runId}-inputs.json`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (err) {
            alert('Could not export the inputs: ' + err.message);
        }
    },

    /** Mark (1) or unmark (0) a run as a baseline. */
    toggleBaseline: async function(runId, flag) {
        try {
            const response = await fetch('/api/simulation_api.php?action=set_baseline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ run_id: runId, baseline: flag })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            await this.loadRuns();
            if (this.currentRun && Number(this.currentRun.run_id) === Number(runId)) {
                this.currentRun.is_baseline = flag;
                this.renderRunDetail();
            }
        } catch (err) {
            alert('Could not change baseline: ' + err.message);
        }
    },

    /** Re-run a run from its saved inputs with hourly data (as a new run). */
    recreateHourly: async function(runId) {
        const btn = document.getElementById('recreate-hourly-btn');
        const notice = document.getElementById('run-detail-notice');
        if (btn) { btn.disabled = true; btn.textContent = 'Re-running...'; }
        HourlySaver.foregroundStart();
        try {
            const response = await fetch('/api/simulation_api.php?action=recreate_hourly', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ run_id: runId })
            }).finally(() => HourlySaver.foregroundEnd());
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            const msgs = [`Hours recreated as run ${data.run_id}` + (data.matches_source ? ' - same results as the original.' : '.')]
                .concat(data.warnings || []);
            await this.loadRuns();
            await this.selectRun(data.run_id);
            const newNotice = document.getElementById('run-detail-notice');
            if (newNotice) newNotice.innerHTML = msgs.map(m => `<p class="${data.matches_source ? 'text-muted' : 'error'}" style="margin:4px 0;">${escapeHtml(m)}</p>`).join('');
        } catch (err) {
            if (notice) notice.innerHTML = `<p class="error">Could not recreate hours: ${escapeHtml(err.message)}</p>`;
            if (btn) { btn.disabled = false; btn.textContent = 'Recreate hours'; }
        }
    },

    /**
     * Render run detail view
     */
    renderRunDetail: function() {
        const container = document.getElementById('simulation-detail');
        if (!container || !this.currentRun) return;

        const run = this.currentRun;
        const summary = run.summary || {};
        const config = run.config || {};
        const scheduleName = config.schedule_template_name || 'Unknown';
        // A TypeScript run's hours: saved in the background, or interrupted
        const savingHours = !!summary.hourly_saving && !run.hourly_purged_at && HourlySaver.has(run.run_id);
        const hoursIncomplete = !!summary.hourly_saving && !run.hourly_purged_at && !savingHours;
        // summary.*_kwh / total_cost are cumulative over the run: per year
        // for runs of a year or more, period totals for shorter runs.
        const basis = annualBasis(summary.total_hours);
        const years = basis.divisor;
        const sfx = basis.suffix;

        container.innerHTML = `
            <div class="run-detail-header">
                <h3>${Number(run.is_baseline) === 1 ? '★ ' : ''}${this.escapeHtml(run.scenario_name)}</h3>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    ${run.status === 'completed' ? `<button class="btn btn-secondary btn-sm" onclick="SimulationsModule.toggleBaseline(${Number(run.run_id)}, ${Number(run.is_baseline) === 1 ? 0 : 1})">${Number(run.is_baseline) === 1 ? 'Unmark baseline' : 'Mark as baseline'}</button>` : ''}
                    ${run.status === 'completed' && (hoursIncomplete || (!run.has_hourly && !config.has_schedule_copy)) ? `<button class="btn btn-secondary btn-sm" id="recreate-hourly-btn" title="Re-run from this run's saved inputs with hourly data, as a new run" onclick="SimulationsModule.recreateHourly(${Number(run.run_id)})">Recreate hours</button>` : ''}
                    ${run.status === 'completed' && config.has_schedule_copy ? `<button class="btn btn-secondary btn-sm" title="Download this run's complete inputs (weather, solar, configuration, schedule), e.g. to add it to the engine reference set (tests/reference)" onclick="SimulationsModule.exportInputs(${Number(run.run_id)})">Export inputs</button>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="SimulationsModule.closeDetail()">Close</button>
                </div>
            </div>
            <div id="run-detail-notice">${savingHours && HourlySaver.failed(run.run_id)
                ? '<p style="margin:4px 0; color:#dc3545;">Saving the hourly data failed: use Retry in the top bar. The Details tab still shows the hours from this browser.</p>'
                : savingHours
                ? '<p class="text-muted" style="margin:4px 0;">Hourly data is being saved in the background (see the top bar); the Details tab already shows it.</p>'
                : hoursIncomplete
                ? '<p style="margin:4px 0; color:#b8860b;">The saving of this run\'s hourly data was interrupted, so its hours are incomplete. Recreate hours rebuilds them.</p>'
                : !run.has_hourly && config.has_schedule_copy
                ? '<p class="text-muted" style="margin:4px 0;">Hourly data not saved in the database: the Details tab computes it from the run\'s saved inputs.</p>'
                : ''}</div>

            <div class="run-detail-info">
                <div class="info-row">
                    <span class="label">Period:</span>
                    <span class="value">${escapeHtml(run.start_date)} to ${escapeHtml(run.end_date)}</span>
                </div>
                <div class="info-row">
                    <span class="label">Schedule:</span>
                    <span class="value">${this.escapeHtml(scheduleName)}</span>
                </div>
                <div class="info-row">
                    <span class="label">Status:</span>
                    <span class="value status-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
                </div>
                <div class="info-row">
                    <span class="label">Created:</span>
                    <span class="value">${escapeHtml(this.runTime(run) ? this.formatDate(this.runTime(run)) : '')}</span>
                </div>
            </div>

            <div class="run-summary-cards">
                <div class="summary-card">
                    <div class="card-value">${this.formatCurrency((summary.total_cost || 0) / years)}</div>
                    <div class="card-label">Total Cost${sfx}</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy((summary.total_heat_loss_kwh || 0) / years)}</div>
                    <div class="card-label">Heat Loss${sfx}</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy((summary.total_solar_gain_kwh || 0) / years)}</div>
                    <div class="card-label">Solar Gain${sfx}</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy((summary.total_hp_energy_kwh || 0) / years)}</div>
                    <div class="card-label">Heat Pump${sfx}</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy((summary.total_boiler_energy_kwh || 0) / years)}</div>
                    <div class="card-label">Boiler${sfx}</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${summary.avg_cop?.toFixed(2) || '-'}</div>
                    <div class="card-label">Avg COP</div>
                </div>
            </div>

            <div class="run-charts">
                <h4>Daily Energy</h4>
                <div id="daily-chart-container">
                    <canvas id="daily-energy-chart"></canvas>
                </div>
            </div>

            <div class="run-actions">
                <button class="btn btn-secondary" onclick="SimulationsModule.exportResults(${run.run_id})">
                    Export CSV
                </button>
                <button class="btn btn-danger" onclick="SimulationsModule.deleteRun(${run.run_id})">
                    Delete Run
                </button>
            </div>
        `;

        container.style.display = 'block';
    },

    /**
     * Close detail view
     */
    closeDetail: function() {
        const container = document.getElementById('simulation-detail');
        if (container) {
            container.style.display = 'none';
        }
        this.currentRun = null;
    },

    /**
     * Load daily results for charts
     */
    loadDailyResults: async function(runId) {
        try {
            const response = await fetch(`/api/simulation_api.php?action=get_daily_results&run_id=${runId}`);
            const data = await response.json();

            if (data.daily_results) {
                this.renderDailyChart(data.daily_results);
            }
        } catch (error) {
            console.error('Failed to load daily results:', error);
        }
    },

    /**
     * Render daily energy chart (stacked area: HP bottom, Boiler on top)
     */
    renderDailyChart: function(dailyResults) {
        const canvas = document.getElementById('daily-energy-chart');
        if (!canvas || typeof Chart === 'undefined') {
            // Chart.js not loaded, show table instead
            this.renderDailyTable(dailyResults);
            return;
        }

        // Destroy existing chart if any
        if (this.dailyChart) {
            this.dailyChart.destroy();
            this.dailyChart = null;
        }

        // Prepare data - use thermal output (heat delivered)
        const labels = dailyResults.map(d => d.date);
        const heatLabels = this.dailyHeatLabels(dailyResults);
        const hpData = dailyResults.map(d => this.dailyHeat(d).hp);
        const boilerData = dailyResults.map(d => this.dailyHeat(d).boiler);

        this.dailyChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: heatLabels.hp,
                        data: hpData,
                        borderColor: 'rgba(40, 167, 69, 1)',
                        backgroundColor: 'rgba(40, 167, 69, 0.7)',
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 1,
                        tension: 0.1,
                        order: 1
                    },
                    {
                        label: heatLabels.boiler,
                        data: boilerData,
                        borderColor: 'rgba(220, 53, 69, 1)',
                        backgroundColor: 'rgba(220, 53, 69, 0.7)',
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 1,
                        tension: 0.1,
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    }
                },
                scales: {
                    x: SimulationsModule.dateAxis(labels),
                    y: {
                        display: true,
                        stacked: true,
                        title: { display: true, text: 'Energy (kWh)' }
                    }
                }
            }
        });
    },

    /**
     * Render daily results as table (fallback if no Chart.js)
     */
    renderDailyTable: function(dailyResults) {
        const container = document.getElementById('daily-chart-container');
        if (!container) return;

        // Show first and last 10 days
        const first10 = dailyResults.slice(0, 10);
        const last10 = dailyResults.slice(-10);

        const html = `
            <div class="daily-table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Hrs Open</th>
                            <th>Avg Temp</th>
                            <th>Loss (kWh)</th>
                            <th>HP Heat (kWh)</th>
                            <th>Boiler Heat (kWh)</th>
                            <th>Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${first10.map(d => `
                            <tr>
                                <td>${escapeHtml(d.date)}</td>
                                <td>${escapeHtml(d.open_hours)}</td>
                                <td>${parseFloat(d.avg_water_temp).toFixed(1)}°C</td>
                                <td>${parseFloat(d.total_loss_kwh).toFixed(1)}</td>
                                <td>${this.dailyHeat(d).stored ? this.dailyHeat(d).hp.toFixed(1) : '-'}</td>
                                <td>${this.dailyHeat(d).stored ? this.dailyHeat(d).boiler.toFixed(1) : '-'}</td>
                                <td>${this.formatCurrency(d.total_cost)}</td>
                            </tr>
                        `).join('')}
                        ${dailyResults.length > 20 ? `
                            <tr class="ellipsis-row">
                                <td colspan="7">... ${dailyResults.length - 20} more days ...</td>
                            </tr>
                        ` : ''}
                        ${last10.map(d => `
                            <tr>
                                <td>${escapeHtml(d.date)}</td>
                                <td>${escapeHtml(d.open_hours)}</td>
                                <td>${parseFloat(d.avg_water_temp).toFixed(1)}°C</td>
                                <td>${parseFloat(d.total_loss_kwh).toFixed(1)}</td>
                                <td>${this.dailyHeat(d).stored ? this.dailyHeat(d).hp.toFixed(1) : '-'}</td>
                                <td>${this.dailyHeat(d).stored ? this.dailyHeat(d).boiler.toFixed(1) : '-'}</td>
                                <td>${this.formatCurrency(d.total_cost)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    },

    /**
     * Export results as CSV
     */
    exportResults: async function(runId) {
        try {
            const response = await fetch(`/api/simulation_api.php?action=get_daily_results&run_id=${runId}`);
            const data = await response.json();

            if (!data.daily_results || data.daily_results.length === 0) {
                alert('No results to export');
                return;
            }

            // Build CSV - include both consumed energy and thermal output
            const headers = ['date', 'hours_count', 'open_hours', 'avg_air_temp', 'avg_water_temp',
                           'total_loss_kwh', 'total_solar_kwh', 'total_hp_kwh', 'total_boiler_kwh',
                           'hp_thermal_kwh', 'boiler_thermal_kwh', 'total_cost'];
            const csv = [
                headers.join(','),
                ...data.daily_results.map(row =>
                    headers.map(h => row[h] || '').join(',')
                )
            ].join('\n');

            // Download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `simulation_${runId}_daily.csv`;
            a.click();
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export results');
        }
    },

    /**
     * Delete a simulation run
     */
    deleteRun: async function(runId) {
        if (!confirm('Are you sure you want to delete this simulation run? This cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/simulation_api.php?action=delete_run&run_id=${runId}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            alert('Simulation run deleted');
            this.closeDetail();
            this.loadRuns();

        } catch (error) {
            console.error('Delete failed:', error);
            alert('Failed to delete run: ' + error.message);
        }
    },

    // Utility functions
    /**
     * X axis for a chart with one point per day (labels 'YYYY-MM-DD...').
     * Ticks sit on calendar boundaries chosen from the run length: every New
     * Year for runs over 3 years ("Jan 2016"), half years over 1.5 years,
     * quarters over ~13 months, months up to a year, weeks below 2 months.
     * (A fixed 12 ticks used to give arbitrary dates such as "Sep 2", "Jul 4"
     * on a 10-year run.)
     */
    dateAxis: function(labels) {
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const days = labels.length;
        const stepMonths = days > 3 * 366 ? 12 : days > 1.5 * 366 ? 6 : days > 400 ? 3 : days > 62 ? 1 : 0;
        const parse = l => {
            const t = String(l);
            return { y: +t.slice(0, 4), m: +t.slice(5, 7), d: +t.slice(8, 10) };
        };
        const ticks = [];
        labels.forEach((l, i) => {
            const p = parse(l);
            if (stepMonths ? (p.d === 1 && (p.m - 1) % stepMonths === 0) : i % 7 === 0) ticks.push(i);
        });
        const format = (i, first) => {
            const p = parse(labels[i]);
            if (!stepMonths) return `${MONTHS[p.m - 1]} ${p.d}`;
            // Year on every tick for yearly ticks, otherwise on January and the first tick
            return (stepMonths === 12 || p.m === 1 || first) ? `${MONTHS[p.m - 1]} ${p.y}` : MONTHS[p.m - 1];
        };
        return {
            display: true,
            afterBuildTicks: axis => { axis.ticks = ticks.map(v => ({ value: v })); },
            ticks: {
                autoSkip: false,
                maxRotation: 0,
                font: { size: 10 },
                callback: value => {
                    const k = ticks.indexOf(value);
                    return k < 0 ? '' : format(value, k === 0);
                }
            }
        };
    },

    /**
     * Daily heat output for charts/tables. Runs stored before migration 038
     * have no daily thermal values (null): return the electricity instead and
     * say so (stored: false) - never an estimate from a fixed COP.
     */
    dailyHeat: function(d) {
        const hp = d.hp_thermal_kwh, boiler = d.boiler_thermal_kwh;
        const stored = hp !== null && hp !== undefined && boiler !== null && boiler !== undefined;
        return stored
            ? { hp: parseFloat(hp) || 0, boiler: parseFloat(boiler) || 0, stored: true }
            : { hp: parseFloat(d.total_hp_kwh) || 0, boiler: parseFloat(d.total_boiler_kwh) || 0, stored: false };
    },

    // Dataset labels for dailyHeat values
    dailyHeatLabels: function(dailyResults) {
        const stored = dailyResults.every(d => this.dailyHeat(d).stored);
        return stored
            ? { hp: 'Heat Pump (kWh)', boiler: 'Boiler (kWh)', stored }
            : { hp: 'Heat Pump electricity (kWh) - heat output not stored for this run', boiler: 'Boiler energy input (kWh)', stored };
    },

    // 'YYYY-MM-DD' plus n days, computed in UTC so a DST change in the
    // browser's time zone cannot skip or repeat a day.
    addDays: function(ymd, n) {
        const [y, m, d] = ymd.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
    },

    // A percentage field (e.g. wind exposure "40" or "40%") as a fraction (0.40).
    // Values up to 1 are taken as already being a fraction.
    percentToFraction: function(value) {
        return value > 1 ? value / 100 : value;
    },

    escapeHtml: function(text) {
        return escapeHtml(text);  // shared helper (config.js); also escapes quotes
    },

    formatDate: function(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    },

    /**
     * When a run was created / completed, as a Date in the user's time zone.
     * created_at / completed_at are the database server's clock time (its
     * own zone); the API adds the exact moment as created_ts / completed_ts.
     */
    runTime: function(run, which = 'created') {
        const ts = run?.[which + '_ts'];
        if (ts !== undefined && ts !== null && ts !== '') return new Date(Number(ts) * 1000);
        const s = run?.[which + '_at'];
        return s ? new Date(String(s).replace(' ', 'T')) : null;
    },

    formatCurrency: function(value) {
        if (value === null || value === undefined) return '-';
        return new Intl.NumberFormat('nb-NO', {
            style: 'currency',
            currency: 'NOK',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    },

    formatEnergy: function(kwh) {
        if (kwh === null || kwh === undefined) return '-';
        if (kwh > 1000000) {
            return (kwh / 1000000).toFixed(2) + ' GWh';
        } else if (kwh > 1000) {
            return (kwh / 1000).toFixed(1) + ' MWh';
        }
        return kwh.toFixed(0) + ' kWh';
    },

    // ============================================
    // TWO-TIER STRUCTURE METHODS
    // ============================================

    /**
     * Initialize New Run section
     */
    initNewRun: function() {
        // Set default dates
        const startInput = document.getElementById('sim-start-date');
        const endInput = document.getElementById('sim-end-date');
        if (startInput && !startInput.value) startInput.value = '2024-01-01';
        if (endInput && !endInput.value) endInput.value = '2024-12-31';

        // Load weather range
        this.loadWeatherRange();
    },

    /**
     * Initialize Compare/Analyse section
     */
    initCompare: async function() {
        // Populate site and pool context from ProjectModule
        if (typeof ProjectModule !== 'undefined') {
            const siteNameEl = document.getElementById('analyse-site-name');
            const poolNameEl = document.getElementById('analyse-pool-name');

            if (siteNameEl && ProjectModule.currentSite) {
                siteNameEl.textContent = ProjectModule.currentSite.name || '-';
            }
            if (poolNameEl && ProjectModule.currentPool) {
                poolNameEl.textContent = ProjectModule.currentPool.name || '-';
            }
        }

        // Load schedule templates for Analyse tab dropdowns (do this first)
        await this.loadAnalyseSchedules();

        // Load runs for comparison dropdowns (optional feature)
        const select1 = document.getElementById('compare-run-1');
        const select2 = document.getElementById('compare-run-2');

        if (select1 && select2) {
            try {
                const response = await fetch('/api/simulation_api.php?action=get_runs&status=completed&limit=50');
                const data = await response.json();

                if (data.runs) {
                    const optionsHtml = data.runs.map(run =>
                        `<option value="${escapeHtml(run.run_id)}">${this.escapeHtml(run.scenario_name)} (${escapeHtml(run.start_date)} - ${escapeHtml(run.end_date)})</option>`
                    ).join('');

                    select1.innerHTML = '<option value="">Select Run 1...</option>' + optionsHtml;
                    select2.innerHTML = '<option value="">Select Run 2...</option>' + optionsHtml;
                }
            } catch (error) {
                console.error('Failed to load runs for comparison:', error);
            }
        }
    },

    /**
     * Load schedule templates for Analyse tab dropdowns
     */
    loadAnalyseSchedules: async function() {
        try {
            console.log('[Analyse] Loading schedule templates...');
            const response = await fetch('/api/heataq_api.php?action=get_templates');
            const data = await response.json();
            console.log('[Analyse] Templates response:', data);

            if (data.templates && data.templates.length > 0) {
                const optionsHtml = data.templates.map(t =>
                    `<option value="${escapeHtml(t.template_id)}">${this.escapeHtml(t.name)}</option>`
                ).join('');

                // Populate all 5 analyse schedule dropdowns
                let populated = 0;
                for (let i = 1; i <= 5; i++) {
                    const select = document.getElementById(`analyse-schedule-${i}`);
                    if (select) {
                        select.innerHTML = optionsHtml;
                        populated++;
                    }
                }
                console.log(`[Analyse] Populated ${populated} schedule dropdowns with ${data.templates.length} templates`);
            } else {
                console.warn('[Analyse] No templates returned from API');
            }
        } catch (error) {
            console.error('[Analyse] Failed to load schedule templates:', error);
        }
    },

    /**
     * Populate config values in the override table
     * Called when config is loaded or changed
     */
    populateConfigValues: function(config) {
        if (!config) return;

        // Get pool data from ProjectModule (has wind_exposure, solar_absorption from pools table)
        const pool = (typeof ProjectModule !== 'undefined') ? ProjectModule.currentPool : null;

        // Wind exposure: check pools table first, then config template
        const windValue = pool?.wind_exposure ?? config.pool?.wind_exposure;
        const windDisplay = (windValue !== undefined && windValue !== null) ? (windValue * 100).toFixed(1) + '%' : undefined;

        // Solar absorption: check pools table first, then config template
        const solarValue = pool?.solar_absorption ?? config.solar?.absorption;
        const solarDisplay = (solarValue !== undefined && solarValue !== null) ? solarValue.toFixed(1) + '%' : undefined;

        // Map config values to display elements
        const mappings = {
            'cfg-val-hp-capacity': config.equipment?.hp_capacity_kw,
            'cfg-val-boiler-capacity': config.equipment?.boiler_capacity_kw,
            'cfg-val-target-temp': config.control?.target_temp,
            'cfg-val-upper-tol': config.control?.upper_tolerance ?? config.control?.temp_tolerance,
            'cfg-val-bathers': config.bathers?.per_day,
            'cfg-val-activity': config.bathers?.activity_factor,
            'cfg-val-wind': windDisplay,
            'cfg-val-solar': solarDisplay
        };

        // A value the config lacks shows '-' (not the previous config's value)
        for (const [id, value] of Object.entries(mappings)) {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = (value !== undefined && value !== null && value !== '') ? value : '-';
            }
        }

        // Load any saved overrides from localStorage
        this.loadSavedOverrides();
    },

    /**
     * Re-read the pool-derived config values (Wind Exposure, Solar Absorption)
     * from the live pool object. Call after the pool settings are edited so the
     * "From Pool Settings" display refreshes without reloading the whole config.
     */
    refreshPoolValues: function() {
        const pool = (typeof ProjectModule !== 'undefined') ? ProjectModule.currentPool : null;
        if (!pool) return;
        const wind = Number(pool.wind_exposure);
        const solar = Number(pool.solar_absorption);
        const windEl = document.getElementById('cfg-val-wind');
        const solarEl = document.getElementById('cfg-val-solar');
        if (windEl && Number.isFinite(wind)) windEl.textContent = (wind * 100).toFixed(1) + '%';
        if (solarEl && Number.isFinite(solar)) solarEl.textContent = solar.toFixed(1) + '%';
    },

    /**
     * Load saved override values from server (with localStorage fallback)
     */
    loadSavedOverrides: async function() {
        const fields = [
            'sim-hp-override', 'sim-boiler-override', 'sim-target-offset',
            'sim-upper-tol-override', 'sim-bathers-override',
            'sim-activity-override', 'sim-wind-override', 'sim-solar-override', 'sim-strategy', 'sim-engine', 'sim-planning-weather'
        ];

        // Overrides are saved per project. Every field takes the saved value
        // or is cleared, so one project's overrides (e.g. HP capacity) never
        // carry over into another; the engine choice is kept when the project
        // has none saved.
        const apply = (overrides) => {
            fields.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (overrides[id]) el.value = overrides[id];
                else if (id !== 'sim-engine') el.value = '';
            });
        };
        const key = this.overridesKey();
        try {
            const response = await fetch('/api/heataq_api.php?action=get_preferences');
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            const json = data.preferences?.sim_overrides || '';
            apply(json ? JSON.parse(json) : {});
            if (json) localStorage.setItem(key, json); else localStorage.removeItem(key);
            return;
        } catch (e) {
            console.log('Server preferences not available, using this browser\'s copy');
        }
        try {
            apply(JSON.parse(localStorage.getItem(key) || '{}'));
        } catch (e) {
            console.error('Failed to load saved overrides:', e);
        }
    },

    /** Browser cache key of the overrides: per user and project (the server copy is per project too). */
    overridesKey: function() {
        const project = localStorage.getItem('heataq_project') || '';
        return this.getUserKey(`sim_overrides_p${project}`);
    },

    /**
     * Save override values to server and localStorage
     */
    saveOverrides: function() {
        const fields = [
            'sim-hp-override', 'sim-boiler-override', 'sim-target-offset',
            'sim-upper-tol-override', 'sim-bathers-override',
            'sim-activity-override', 'sim-wind-override', 'sim-solar-override', 'sim-strategy', 'sim-engine', 'sim-planning-weather'
        ];
        const overrides = {};
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value) {
                overrides[id] = el.value;
            }
        });

        const overridesJson = JSON.stringify(overrides);

        // Save to localStorage (cache)
        localStorage.setItem(this.overridesKey(), overridesJson);

        // Save to server (async, don't wait)
        fetch('/api/heataq_api.php?action=save_preference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'sim_overrides', value: overridesJson })
        }).catch(e => console.log('Failed to save overrides to server:', e));
    },

    /**
     * Clear all override fields
     */
    clearAllOverrides: function() {
        const ids = [
            'sim-hp-override', 'sim-boiler-override', 'sim-target-offset',
            'sim-upper-tol-override', 'sim-bathers-override',
            'sim-activity-override', 'sim-wind-override', 'sim-solar-override', 'sim-strategy', 'sim-engine', 'sim-planning-weather'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        // Clear saved overrides from localStorage
        localStorage.removeItem(this.overridesKey());

        // Clear from server too
        fetch('/api/heataq_api.php?action=save_preference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'sim_overrides', value: '{}' })
        }).catch(e => console.log('Failed to clear overrides on server:', e));
    },

    /**
     * Clear a single override field
     */
    /**
     * Read the SimControl target offset (°C added to every open hour's target).
     * Accepts "+1", "-0.5", "1,5". Returns null when blank. Throws on values
     * outside ±5 °C or not a multiple of 0.5, so a typo (e.g. "29" from the old
     * absolute field) can't turn into a 57 °C run. Server validates too.
     */
    readTargetOffset: function() {
        const el = document.getElementById('sim-target-offset');
        const raw = el ? el.value.trim().replace(',', '.') : '';
        if (raw === '') return null;
        const v = Number(raw);
        if (!Number.isFinite(v) || Math.abs(v) > 5 || Math.abs(v * 2 - Math.round(v * 2)) > 1e-9) {
            throw new Error(`Target offset "${el.value}" is not valid: use -5 to +5 °C in steps of 0.5 (e.g. +1, -0.5)`);
        }
        return v === 0 ? null : v;
    },

    clearOverride: function(fieldId) {
        const el = document.getElementById(fieldId);
        if (el) {
            el.value = '';
            this.saveOverrides();
        }
    },

    // Override fields: [id, label, min, max, integer]. Wind and solar are
    // typed as percentages, like the Config column shows them.
    OVERRIDE_FIELDS: [
        ['sim-hp-override', 'HP capacity (kW)', 0, 100000],
        ['sim-boiler-override', 'Boiler capacity (kW)', 0, 100000],
        ['sim-upper-tol-override', 'Max overheat (°C)', 0, 5],
        ['sim-bathers-override', 'Bathers per day', 0, 100000, true],
        ['sim-activity-override', 'Activity factor', 0, 5],
        ['sim-wind-override', 'Wind exposure (%)', 0, 100],
        ['sim-solar-override', 'Solar absorption (%)', 0, 100]
    ],

    /**
     * Read one override field. Blank = null (use the config). Accepts a
     * decimal comma and a trailing "%". Throws a readable error for text or
     * out-of-range values instead of sending 0, a truncated number or null.
     */
    readOverride: function(id) {
        const field = this.OVERRIDE_FIELDS.find(f => f[0] === id);
        const el = document.getElementById(id);
        const raw = el ? el.value.trim().replace(',', '.').replace(/%$/, '').trim() : '';
        if (raw === '') return null;
        const v = Number(raw);
        const [, label, min, max, integer] = field;
        if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
            throw new Error(`${label} "${el.value}" is not valid: use ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}, or leave it blank`);
        }
        return v;
    },

    /** Strategy override from the Simulate tab ('' = use the config's). */
    readStrategy: function() {
        return document.getElementById('sim-strategy')?.value || null;
    },

    /**
     * Build config override object from override fields
     * Returns an object with only the overridden values for API
     * (throws on invalid input - see readOverride)
     */
    buildConfigOverride: function() {
        const getOverride = (id) => this.readOverride(id);

        const override = {};

        // Equipment overrides
        const hpOverride = getOverride('sim-hp-override');
        const boilerOverride = getOverride('sim-boiler-override');
        if (hpOverride !== null || boilerOverride !== null) {
            override.equipment = {};
            if (hpOverride !== null) override.equipment.hp_capacity_kw = hpOverride;
            if (boilerOverride !== null) override.equipment.boiler_capacity_kw = boilerOverride;
        }

        // Control overrides
        const targetOffset = SimulationsModule.readTargetOffset();
        const upperTolOverride = getOverride('sim-upper-tol-override');
        const strategy = this.readStrategy();
        const planningWeather = document.getElementById('sim-planning-weather')?.value || null;
        if (targetOffset !== null || upperTolOverride !== null || strategy || planningWeather) {
            override.control = {};
            if (targetOffset !== null) override.control.target_offset = targetOffset;
            if (upperTolOverride !== null) override.control.upper_tolerance = upperTolOverride;
            if (strategy) override.control.strategy = strategy;
            if (planningWeather) override.control.planning_weather = planningWeather;
        }

        // Bathers overrides
        const bathersOverride = getOverride('sim-bathers-override');
        const activityOverride = getOverride('sim-activity-override');
        if (bathersOverride !== null || activityOverride !== null) {
            override.bathers = {};
            if (bathersOverride !== null) override.bathers.per_day = bathersOverride;
            if (activityOverride !== null) override.bathers.activity_factor = activityOverride;
        }

        // Pool overrides
        const windOverride = getOverride('sim-wind-override');
        if (windOverride !== null) {
            // Typed as a percentage like the base value (50.0%); send a fraction
            override.pool = { wind_exposure: SimulationsModule.percentToFraction(windOverride) };
        }

        // Solar overrides
        const solarOverride = getOverride('sim-solar-override');
        if (solarOverride !== null) {
            override.solar = { absorption: solarOverride };
        }

        // Save overrides for next time
        this.saveOverrides();

        // Return null if no overrides set
        return Object.keys(override).length > 0 ? override : null;
    },

    /**
     * Get effective config with overrides applied
     */
    getEffectiveConfig: function(baseConfig) {
        const config = JSON.parse(JSON.stringify(baseConfig)); // Deep clone

        // Apply overrides if set
        const getOverride = (id) => this.readOverride(id);

        const hpOverride = getOverride('sim-hp-override');
        const boilerOverride = getOverride('sim-boiler-override');
        const targetOffset = SimulationsModule.readTargetOffset();
        const upperTolOverride = getOverride('sim-upper-tol-override');
        const bathersOverride = getOverride('sim-bathers-override');
        const activityOverride = getOverride('sim-activity-override');
        const windOverride = getOverride('sim-wind-override');
        const solarOverride = getOverride('sim-solar-override');

        if (hpOverride !== null) config.equipment.hp_capacity_kw = hpOverride;
        if (boilerOverride !== null) config.equipment.boiler_capacity_kw = boilerOverride;
        if (targetOffset !== null) config.control.target_offset = targetOffset;
        if (upperTolOverride !== null) config.control.upper_tolerance = upperTolOverride;
        if (bathersOverride !== null) config.bathers.per_day = bathersOverride;
        if (activityOverride !== null) config.bathers.activity_factor = activityOverride;
        if (windOverride !== null) config.pool.wind_exposure = SimulationsModule.percentToFraction(windOverride);
        if (solarOverride !== null) config.solar.absorption = solarOverride;

        // Save overrides for next time
        this.saveOverrides();

        return config;
    },

    /**
     * Run multi-scenario analysis (Analyse tab)
     * Runs all 5 scenarios in parallel and displays results
     */
    runAnalysis: async function() {
        const statusEl = document.getElementById('analyse-status');
        const btn = document.getElementById('analyse-calculate-btn');

        // Clear previous results and show loading
        for (let i = 1; i <= 5; i++) {
            ['hp', 'boiler', 'elec', 'days1', 'days2'].forEach(metric => {
                const cell = document.getElementById(`result-${metric}-${i}`);
                if (cell) {
                    cell.textContent = '...';
                    cell.className = 'result-cell loading';
                }
            });
        }

        if (btn) btn.disabled = true;
        if (statusEl) statusEl.textContent = 'Running scenarios...';

        try {
            // Build scenario configs
            const scenarios = [];
            for (let i = 1; i <= 5; i++) {
                scenarios.push({
                    case: i,
                    hp_capacity: parseFloat(document.getElementById(`analyse-hp-${i}`).value) || 125,
                    boiler_capacity: parseFloat(document.getElementById(`analyse-boiler-${i}`).value) || 200,
                    strategy: document.getElementById(`analyse-strategy-${i}`).value || 'predictive',
                    schedule_id: document.getElementById(`analyse-schedule-${i}`).value || '1'
                });
            }

            // Get date range from Simulate tab
            const startDate = document.getElementById('sim-start-date')?.value || '2024-01-01';
            const endDate = document.getElementById('sim-end-date')?.value || '2024-12-31';

            // Get pool_id from SimControl selection
            const poolId = typeof SimControlModule !== 'undefined' ? SimControlModule.currentPoolId : null;

            // Run all scenarios in parallel
            const promises = scenarios.map(async (scenario, idx) => {
                try {
                    const response = await fetch('/api/simulation_api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'run_simulation',
                            scenario_name: `Analysis Case ${scenario.case}`,
                            start_date: startDate,
                            end_date: endDate,
                            pool_id: poolId,
                            config_override: {
                                equipment: {
                                    hp_capacity_kw: scenario.hp_capacity,
                                    boiler_capacity_kw: scenario.boiler_capacity
                                },
                                control: {
                                    strategy: scenario.strategy
                                }
                            },
                            template_id: scenario.schedule_id,
                            save_run: true // Save to history - timestamp tracks each case
                        })
                    });
                    return await response.json();
                } catch (err) {
                    return { error: err.message, case: scenario.case };
                }
            });

            const results = await Promise.all(promises);

            // Display results
            results.forEach((result, idx) => {
                const caseNum = idx + 1;
                if (result.error) {
                    // Show error
                    ['hp', 'boiler', 'elec', 'days1', 'days2'].forEach(metric => {
                        const cell = document.getElementById(`result-${metric}-${caseNum}`);
                        if (cell) {
                            cell.textContent = 'ERR';
                            cell.className = 'result-cell bad';
                        }
                    });
                } else {
                    // Extract summary data
                    const summary = result.summary || result.run?.summary || {};

                    // HP Use (MWh) - thermal output
                    const hpCell = document.getElementById(`result-hp-${caseNum}`);
                    if (hpCell) {
                        const hpMwh = (summary.hp_thermal_kwh || 0) / 1000;
                        hpCell.textContent = hpMwh.toFixed(1);
                        hpCell.className = 'result-cell';
                    }

                    // Boiler Use (MWh) - thermal output
                    const boilerCell = document.getElementById(`result-boiler-${caseNum}`);
                    if (boilerCell) {
                        const boilerMwh = (summary.boiler_thermal_kwh || 0) / 1000;
                        boilerCell.textContent = boilerMwh.toFixed(1);
                        boilerCell.className = boilerMwh > 50 ? 'result-cell warning' : 'result-cell';
                    }

                    // Electricity (MWh) - HP electricity consumption
                    const elecCell = document.getElementById(`result-elec-${caseNum}`);
                    if (elecCell) {
                        const elecMwh = (summary.total_hp_energy_kwh || 0) / 1000;
                        elecCell.textContent = elecMwh.toFixed(1);
                        elecCell.className = 'result-cell';
                    }

                    // Days below target (1°C = below 27°C when target is 28°C)
                    const days1Cell = document.getElementById(`result-days1-${caseNum}`);
                    if (days1Cell) {
                        const days1 = summary.days_below_27 || 0;
                        days1Cell.textContent = days1;
                        days1Cell.className = days1 > 10 ? 'result-cell bad' : days1 > 0 ? 'result-cell warning' : 'result-cell good';
                    }

                    // Days below target (2°C = below 26°C when target is 28°C)
                    const days2Cell = document.getElementById(`result-days2-${caseNum}`);
                    if (days2Cell) {
                        const days2 = summary.days_below_26 || 0;
                        days2Cell.textContent = days2;
                        days2Cell.className = days2 > 5 ? 'result-cell bad' : days2 > 0 ? 'result-cell warning' : 'result-cell good';
                    }
                }
            });

            if (statusEl) statusEl.textContent = 'Analysis complete';

        } catch (error) {
            console.error('Analysis failed:', error);
            if (statusEl) statusEl.textContent = 'Error: ' + error.message;
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    /**
     * Compare two runs
     */
    compareRuns: async function() {
        const runId1 = document.getElementById('compare-run-1').value;
        const runId2 = document.getElementById('compare-run-2').value;

        if (!runId1 || !runId2) {
            alert('Please select two runs to compare');
            return;
        }

        if (runId1 === runId2) {
            alert('Please select two different runs');
            return;
        }

        const resultsDiv = document.getElementById('comparison-results');
        resultsDiv.innerHTML = '<p class="loading">Loading comparison...</p>';
        resultsDiv.style.display = 'block';

        try {
            // Fetch both runs
            const [response1, response2] = await Promise.all([
                fetch(`/api/simulation_api.php?action=get_summary&run_id=${runId1}`),
                fetch(`/api/simulation_api.php?action=get_summary&run_id=${runId2}`)
            ]);

            const data1 = await response1.json();
            const data2 = await response2.json();

            if (data1.error || data2.error) {
                throw new Error(data1.error || data2.error);
            }

            this.renderComparison(data1, data2);

        } catch (error) {
            resultsDiv.innerHTML = `<p class="error">Error: ${escapeHtml(error.message)}</p>`;
        }
    },

    /**
     * Render comparison table
     */
    renderComparison: function(data1, data2) {
        const resultsDiv = document.getElementById('comparison-results');
        const run1 = data1.run;
        const run2 = data2.run;
        const sum1 = run1.summary || {};
        const sum2 = run2.summary || {};

        const formatDiff = (val1, val2, unit = '') => {
            if (val1 === null || val2 === null) return '-';
            const diff = val2 - val1;
            const pct = val1 !== 0 ? ((diff / val1) * 100).toFixed(1) : '-';
            const sign = diff > 0 ? '+' : '';
            const color = diff > 0 ? 'red' : (diff < 0 ? 'green' : 'gray');
            return `<span style="color:${color}">${sign}${diff.toFixed(1)}${unit} (${sign}${pct}%)</span>`;
        };

        resultsDiv.innerHTML = `
            <div class="card">
                <h3>Comparison: ${this.escapeHtml(run1.scenario_name)} vs ${this.escapeHtml(run2.scenario_name)}</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>${this.escapeHtml(run1.scenario_name)}</th>
                            <th>${this.escapeHtml(run2.scenario_name)}</th>
                            <th>Difference</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Period</td>
                            <td>${escapeHtml(run1.start_date)} - ${escapeHtml(run1.end_date)}</td>
                            <td>${escapeHtml(run2.start_date)} - ${escapeHtml(run2.end_date)}</td>
                            <td>-</td>
                        </tr>
                        <tr>
                            <td>Total Cost</td>
                            <td>${this.formatCurrency(sum1.total_cost)}</td>
                            <td>${this.formatCurrency(sum2.total_cost)}</td>
                            <td>${formatDiff(sum1.total_cost, sum2.total_cost, ' NOK')}</td>
                        </tr>
                        <tr>
                            <td>Heat Pump Energy</td>
                            <td>${this.formatEnergy(sum1.total_hp_energy_kwh)}</td>
                            <td>${this.formatEnergy(sum2.total_hp_energy_kwh)}</td>
                            <td>${formatDiff(sum1.total_hp_energy_kwh, sum2.total_hp_energy_kwh, ' kWh')}</td>
                        </tr>
                        <tr>
                            <td>Boiler Energy</td>
                            <td>${this.formatEnergy(sum1.total_boiler_energy_kwh)}</td>
                            <td>${this.formatEnergy(sum2.total_boiler_energy_kwh)}</td>
                            <td>${formatDiff(sum1.total_boiler_energy_kwh, sum2.total_boiler_energy_kwh, ' kWh')}</td>
                        </tr>
                        <tr>
                            <td>Total Loss</td>
                            <td>${this.formatEnergy(sum1.total_heat_loss_kwh)}</td>
                            <td>${this.formatEnergy(sum2.total_heat_loss_kwh)}</td>
                            <td>${formatDiff(sum1.total_heat_loss_kwh, sum2.total_heat_loss_kwh, ' kWh')}</td>
                        </tr>
                        <tr>
                            <td>Solar Gain</td>
                            <td>${this.formatEnergy(sum1.total_solar_gain_kwh)}</td>
                            <td>${this.formatEnergy(sum2.total_solar_gain_kwh)}</td>
                            <td>${formatDiff(sum1.total_solar_gain_kwh, sum2.total_solar_gain_kwh, ' kWh')}</td>
                        </tr>
                        <tr>
                            <td>Avg COP</td>
                            <td>${sum1.avg_cop?.toFixed(2) || '-'}</td>
                            <td>${sum2.avg_cop?.toFixed(2) || '-'}</td>
                            <td>${formatDiff(sum1.avg_cop, sum2.avg_cop)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    },

    // ============================================
    // DEBUG HOUR METHODS
    // ============================================

    /**
     * Run debug calculation for a single hour
     */
    debugHour: async function() {
        console.log('V69 debugHour called');
        const dateEl = document.getElementById('debug-date');
        const hourEl = document.getElementById('debug-hour');
        const resultsDiv = document.getElementById('debug-results');

        // Debug: check which elements are missing
        if (!dateEl || !hourEl || !resultsDiv) {
            const missing = [];
            if (!dateEl) missing.push('debug-date');
            if (!hourEl) missing.push('debug-hour');
            if (!resultsDiv) missing.push('debug-results');
            alert('Missing elements: ' + missing.join(', ') + '\n\nTry refreshing with Ctrl+Shift+R to clear cache.');
            return;
        }

        const date = dateEl.value;
        const hour = hourEl.value;

        if (!date) {
            alert('Please select a date');
            return;
        }

        // Set button to loading state
        this.setDebugButtonState('loading');

        // Save date to server preferences (with localStorage fallback)
        if (typeof SimControlModule !== 'undefined') {
            SimControlModule.savePreference('debug_date', date);
        } else {
            localStorage.setItem(this.getUserKey('debug_date'), date);
        }

        // Store current debug timestamp for chart highlighting (no seconds to match chart data format)
        this.debugTimestamp = `${date} ${hour.padStart(2, '0')}:00`;

        // Visibility is controlled by CSS based on debug mode (body.debug-mode-on .debug-only)
        // Don't set inline style - it overrides the CSS class-based visibility

        // Clear individual card contents to show loading state
        ['debug-input', 'debug-evaporation', 'debug-convection', 'debug-radiation',
         'debug-solar', 'debug-structural', 'debug-cover', 'debug-heatpump', 'debug-boiler', 'debug-summary'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span style="color: #999;">Loading...</span>';
        });

        try {
            const data = await this.loadHourData(date, hour);
            this.renderDebugResults(data);

            // Also load weekly chart automatically
            await this.loadWeeklyChart();

            // Success - button green (data in sync)
            this.setDebugButtonState('synced');

        } catch (error) {
            // Show error in summary card without destroying structure
            const summaryEl = document.getElementById('debug-summary');
            if (summaryEl) {
                summaryEl.innerHTML = `<p class="error" style="color: #dc3545;">Error: ${escapeHtml(error.message)}</p>`;
            }
            // Error - button red (needs recalculation)
            this.setDebugButtonState('changed');
        }
    },

    /**
     * Navigate to previous hour and recalculate
     */
    debugPrevHour: function() {
        const hourEl = document.getElementById('debug-hour');
        const dateEl = document.getElementById('debug-date');
        if (!hourEl || !dateEl) return;

        let hour = parseInt(hourEl.value);

        if (hour > 0) {
            hour--;
        } else {
            // Go to previous day, hour 23
            hour = 23;
            dateEl.value = SimulationsModule.addDays(dateEl.value, -1);
        }
        hourEl.value = hour;
        this.debugHour();
    },

    /**
     * Navigate to next hour and recalculate
     */
    debugNextHour: function() {
        const hourEl = document.getElementById('debug-hour');
        const dateEl = document.getElementById('debug-date');
        if (!hourEl || !dateEl) return;

        let hour = parseInt(hourEl.value);

        if (hour < 23) {
            hour++;
        } else {
            // Go to next day, hour 0
            hour = 0;
            dateEl.value = SimulationsModule.addDays(dateEl.value, 1);
        }
        hourEl.value = hour;
        this.debugHour();
    },

    /**
     * Load run info to display config and schedule names in debug panel
     */
    loadRunInfoForDebug: async function(runId) {
        const configDisplay = document.getElementById('debug-config-display');
        const ohcDisplay = document.getElementById('debug-ohc-display');
        const runDisplay = document.getElementById('debug-run-display');
        if (runDisplay) { runDisplay.textContent = `Run #${runId}`; runDisplay.title = ''; }

        try {
            const response = await fetch(`/api/simulation_api.php?action=get_run&run_id=${runId}`);
            const data = await response.json();

            if (data.error) {
                console.warn('Error loading run info:', data.error);
                if (configDisplay) configDisplay.textContent = 'Run not found';
                if (ohcDisplay) ohcDisplay.textContent = '-';
                return;
            }

            if (data.run) {
                const config = data.run.config || {};
                const equipment = config.equipment || {};

                // Which run: number and when it was made; its name and
                // description on mouse-over
                if (runDisplay) {
                    const r = data.run;
                    const made = this.runTime(r);
                    let when = '';
                    if (made && !isNaN(made)) {
                        // "Today 10:02", "Y'day 10:02", else "Tue 14 Oct 10:02"
                        const time = made.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                        const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(made).setHours(0, 0, 0, 0)) / 86400000);
                        const day = days === 0 ? 'Today' : days === 1 ? "Y'day"
                            : made.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
                        when = `${day} ${time}`;
                    }
                    runDisplay.innerHTML = `Run #${escapeHtml(runId)}${when ? '<br>' + escapeHtml(when) : ''}`;
                    const tip = [r.scenario_name, r.description,
                        r.start_date && r.end_date ? `Period: ${r.start_date} to ${r.end_date}` : ''].filter(Boolean).join('\n');
                    runDisplay.title = tip;
                    runDisplay.style.cursor = tip ? 'help' : '';
                    runDisplay.style.borderBottom = tip ? '1px dotted #999' : '';
                }

                // Display config template name
                if (configDisplay) {
                    const configName = config.config_template_name;
                    if (configName) {
                        configDisplay.textContent = configName;
                    } else {
                        // Fallback: show equipment summary or scenario name
                        const hpCap = equipment.hp_capacity_kw;
                        const boilerCap = equipment.boiler_capacity_kw;
                        if (hpCap && boilerCap) {
                            configDisplay.textContent = `HP: ${hpCap}kW, Boiler: ${boilerCap}kW`;
                        } else {
                            configDisplay.textContent = data.run.scenario_name || `Run #${runId}`;
                        }
                    }
                }

                // Display schedule/OHC name
                if (ohcDisplay) {
                    ohcDisplay.textContent = config.schedule_template_name || 'Default';
                }
            }
        } catch (err) {
            console.warn('Failed to load run info for debug:', err);
            if (configDisplay) configDisplay.textContent = 'Error loading';
            if (ohcDisplay) ohcDisplay.textContent = '-';
        }
    },

    /**
     * Render debug calculation results - populates new UI structure
     */
    renderDebugResults: function(data) {
        console.log('[V80 renderDebugResults]', data);

        // Log schedule debug info prominently
        if (data.schedule_debug) {
            console.log('[Schedule Debug]', data.schedule_debug);
            console.log(`  Template: ${data.schedule_debug.template_name} (ID: ${data.schedule_debug.template_id})`);
            console.log(`  Day: ${data.schedule_debug.day_of_week}, Schedule: ${data.schedule_debug.schedule_name}`);
            console.log(`  Periods:`, data.schedule_debug.periods);
            console.log(`  Open Hours: ${data.schedule_debug.open_hours}`);
        }
        if (data.config_info) {
            console.log('[Config Info]', data.config_info);
            console.log(`  Schedule Template Stored: ${data.config_info.schedule_template_id_stored}`);
            console.log(`  Schedule Template Used: ${data.config_info.schedule_template_id_used}`);
        }

        // Helper to render a table from object
        const renderTable = (obj) => {
            if (!obj) return '<p class="text-muted">No data</p>';
            let html = '<table class="data-table compact" style="font-size: 11px;">';
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'object' && value !== null) continue;
                const displayKey = key.replace(/_/g, ' ');
                const displayVal = typeof value === 'number' ? value.toLocaleString() : value;
                html += `<tr><td>${escapeHtml(displayKey)}</td><td><code>${escapeHtml(displayVal)}</code></td></tr>`;
            }
            html += '</table>';
            return html;
        };

        // ===== Use STORED values as primary source (matches chart data) =====
        const stored = data.stored || {};
        const hs = data.heating_summary || {};
        const hp = data.heat_pump || {};
        const boiler = data.boiler || {};

        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        const setHtml = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = val;
        };

        // Net demand - use stored value (matches chart)
        const storedNetDemand = stored.total_loss_kw - stored.solar_gain_kw;
        setEl('debug-net-demand', `${storedNetDemand?.toFixed(1) || hs.net_demand_kw?.toFixed(1) || '0'} kW`);

        // Show validation warning if recalc differs
        if (data.validation_warning) {
            console.warn('[Validation]', data.validation_warning);
        }

        // Heat pump output - use stored value (matches chart)
        const hpOutput = stored.hp_heat_kw ?? hs.hp_output_kw ?? 0;
        setEl('debug-hp-output', `${hpOutput?.toFixed(1)} kW`);
        setEl('debug-hp-detail', `COP ${stored.hp_cop || hp.cop || '-'} | ${hp.electricity_kw?.toFixed(1) || '0'} kW elec`);

        // Boiler output - use stored value (matches chart)
        const boilerOutput = stored.boiler_heat_kw ?? hs.boiler_output_kw ?? 0;
        setEl('debug-boiler-output', `${boilerOutput?.toFixed(1)} kW`);
        setEl('debug-boiler-detail', `${((boiler.efficiency || 0.92) * 100).toFixed(0)}% eff | ${boiler.fuel_kw?.toFixed(1) || '0'} kW ${boiler.type === 'fuel' ? 'fuel' : 'electricity'}`);

        // Input summary bar
        const inp = data.input || {};
        setEl('debug-air-temp', `${inp.weather?.air_temp_c || '-'}°C`);
        setEl('debug-wind', `${inp.weather?.wind_speed_ms || '-'} m/s`);
        setEl('debug-solar-val', `${inp.weather?.solar_ghi_wm2 || '-'} W/m²`);

        // Status (Open/Closed) - USE STORED VALUE (matches chart)
        const isOpen = stored.is_open !== undefined ? stored.is_open : inp.config?.is_open;
        const statusEl = document.getElementById('debug-status');
        if (statusEl) {
            statusEl.textContent = isOpen ? 'Open' : 'Closed';
            statusEl.style.color = isOpen ? '#28a745' : '#dc3545';
        }

        // Cover status (Cover On/Off) - use actual calculated value from debug API
        const coverOn = data.cover?.is_covered ?? (inp.config?.has_cover && !isOpen);
        setEl('debug-cover-status', coverOn ? 'Cover On' : 'Cover Off');

        // Water temperature display (from stored simulation data)
        const waterTemp = stored.water_temp || inp.pool?.water_temp_c;
        const waterTempDisplay = document.getElementById('debug-water-temp-display');
        if (waterTempDisplay && waterTemp) {
            waterTempDisplay.textContent = `${parseFloat(waterTemp).toFixed(1)}°C`;
        }

        // Config and Schedule display (from run info)
        if (stored.run_id) {
            this.loadRunInfoForDebug(stored.run_id);
        }

        // Show schedule debug info (actual periods being used)
        const schedDebug = data.schedule_debug;
        if (schedDebug) {
            const ohcDisplay = document.getElementById('debug-ohc-display');
            if (ohcDisplay) {
                const periods = schedDebug.periods || [];
                const periodsStr = periods.map(p => `${p.from}:00-${p.to}:00`).join(', ') || 'Closed';
                ohcDisplay.innerHTML = `${escapeHtml(schedDebug.template_name || 'Default')} <span style="font-size:11px;color:#666;">(${escapeHtml(periodsStr)}, ${escapeHtml(schedDebug.open_hours)}h)</span>`;
            }
        }

        // Update chart comparison display with stored run info
        const comparisonEl = document.getElementById('chart-data-comparison');
        if (comparisonEl && stored.run_id) {
            comparisonEl.innerHTML = `<strong>From Run #${escapeHtml(stored.run_id)}:</strong> ${isOpen ? 'Open' : 'Closed'}, ` +
                `Loss: ${stored.total_loss_kw?.toFixed(1)} kW, HP: ${stored.hp_heat_kw?.toFixed(1)} kW, ` +
                `Boiler: ${stored.boiler_heat_kw?.toFixed(1)} kW` +
                (data.validation_warning ? ` <span style="color: orange;">⚠ ${escapeHtml(data.validation_warning)}</span>` : '');
        }

        // ===== Populate Detail Cards =====
        const windPct = inp.config?.wind_factor ? (inp.config.wind_factor * 100).toFixed(1) + '%' : '-';
        setHtml('debug-input', `
            <strong>Weather:</strong> ${escapeHtml(inp.weather?.air_temp_c)}°C, Wind: ${escapeHtml(inp.weather?.wind_speed_ms)} m/s, RH: ${escapeHtml(inp.weather?.humidity_pct)}%<br>
            <strong>Pool:</strong> ${escapeHtml(inp.pool?.water_temp_c)}°C, ${escapeHtml(inp.pool?.area_m2)} m²<br>
            <strong>Config:</strong> Wind: ${escapeHtml(windPct)} exposure, has_cover: ${escapeHtml(inp.config?.has_cover)}, is_covered: ${escapeHtml(data.cover?.is_covered)}
        `);
        setHtml('debug-evaporation', renderTable(data.evaporation));
        setHtml('debug-convection', renderTable(data.convection));
        setHtml('debug-radiation', renderTable(data.radiation));
        setHtml('debug-solar', renderTable(data.solar_gain));
        setHtml('debug-structural', renderTable(data.structural));
        setHtml('debug-cover', renderTable(data.cover));

        // Heat pump detail
        setHtml('debug-heatpump', `
            <table class="data-table compact" style="font-size: 11px;">
                <tr><td>Strategy</td><td><code>${escapeHtml(hp.strategy || 'reactive')}</code></td></tr>
                <tr><td>Capacity</td><td><code>${escapeHtml(hp.capacity_kw)} kW</code></td></tr>
                <tr><td>COP @ ${escapeHtml(inp.weather?.air_temp_c)}°C</td><td><code>${escapeHtml(hp.cop)}</code></td></tr>
                <tr><td>Output</td><td><code><strong>${escapeHtml(hp.output_kw)} kW</strong></code></td></tr>
                <tr><td>Electricity</td><td><code>${escapeHtml(hp.electricity_kw)} kW</code></td></tr>
            </table>
        `);

        // Boiler detail
        setHtml('debug-boiler', `
            <table class="data-table compact" style="font-size: 11px;">
                <tr><td>Capacity</td><td><code>${escapeHtml(boiler.capacity_kw)} kW</code></td></tr>
                <tr><td>Efficiency</td><td><code>${((boiler.efficiency || 0.92) * 100).toFixed(0)}%</code></td></tr>
                <tr><td>Output</td><td><code><strong>${escapeHtml(boiler.output_kw)} kW</strong></code></td></tr>
                <tr><td>${boiler.type === 'fuel' ? 'Fuel input (gas/oil)' : 'Electricity input'}</td><td><code>${escapeHtml(boiler.fuel_kw)} kW</code></td></tr>
            </table>
        `);

        // Predictive control: the run's heating mode this hour and the level
        // it held (docs/PREDICTIVE_CONTROL.md)
        const preheatCard = document.getElementById('debug-preheat-card');
        const strategy = hp.strategy || 'reactive';
        const isPredictive = strategy === 'predictive';
        const MODES = {
            preheat_coast: 'Closed: heat pump off or holding the floor, water coasts (late start)',
            preheat_ramp: 'Closed: heat pump heats so the water reaches the opening temperature at opening',
            open_preheat: 'Open: heat pump at full, banking heat for a coming short hour; boiler keeps target',
            open_hold: 'Open: hold target (heat pump first, boiler backstop)',
            standby: 'Long closure: hold Min temp when closed',
            reactive: 'Heat to target when needed',
        };

        if (preheatCard) {
            preheatCard.style.display = '';
            if (isPredictive) {
                const mode = stored.heating_mode || null;
                const hold = typeof stored.hold_temp === 'number' ? stored.hold_temp : null;
                setHtml('debug-preheat', `
                    <table class="data-table compact" style="font-size: 11px;">
                        <tr><td>Strategy</td><td><code style="color:#9c27b0;"><strong>PREDICTIVE</strong></code></td></tr>
                        <tr><td>Pool State</td><td><code>${isOpen ? 'OPEN' : 'CLOSED'}</code></td></tr>
                        <tr><td>Mode</td><td><code>${escapeHtml(mode || '?')}</code></td></tr>
                        ${mode && MODES[mode] ? `<tr><td colspan="2" style="color:#555;">${escapeHtml(MODES[mode])}</td></tr>` : ''}
                        ${hold !== null ? `<tr><td title="The temperature the run heated towards this hour (target, the plan's opening temperature, the floor or max)">Held towards</td><td><code>${hold.toFixed(2)}°C</code></td></tr>` : ''}
                        <tr><td>HP Output</td><td><code>${(stored.hp_heat_kw || 0).toFixed(1)} kW</code></td></tr>
                    </table>
                    <div style="margin-top:6px;font-size:10px;color:#888;">The cards above recompute this hour's losses; their heating is the steady-state hold. The run's own heating is in the chart and in Mode.</div>
                `);
            } else {
                setHtml('debug-preheat', `
                    <table class="data-table compact" style="font-size: 11px;">
                        <tr><td>Strategy</td><td><code>REACTIVE</code></td></tr>
                        <tr><td>Mode</td><td><code>Heat to target when needed</code></td></tr>
                    </table>
                `);
            }
        }

        // Summary
        const sum = data.summary || {};
        const coverLoss = sum.cover_loss_kw || 0;
        setHtml('debug-summary', `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
                <div>Evap: <strong>${escapeHtml(sum.evaporation_kw)}</strong> kW</div>
                <div>Conv: <strong>${escapeHtml(sum.convection_kw)}</strong> kW</div>
                <div>Rad: <strong>${escapeHtml(sum.radiation_kw)}</strong> kW</div>
                <div>Cover: <strong>${coverLoss.toFixed ? coverLoss.toFixed(3) : escapeHtml(coverLoss)}</strong> kW</div>
                <div>Cond: <strong>${(sum.wall_loss_kw + sum.floor_loss_kw).toFixed(3)}</strong> kW</div>
                <div>Solar: <strong>-${escapeHtml(sum.solar_gain_kw)}</strong> kW</div>
                <div><strong>Net: ${escapeHtml(sum.net_requirement_kw)} kW</strong></div>
                <div style="color: #2196F3;">HP: <strong>${escapeHtml(hs.hp_output_kw)}</strong> kW</div>
                <div style="color: #ff9800;">Boiler: <strong>${escapeHtml(hs.boiler_output_kw)}</strong> kW</div>
            </div>
        `);

        // Comparison card: the run's values for the hour vs this hour recomputed
        const storedWaterTemp = stored.water_temp_start ?? stored.water_temp;
        const calcWaterTemp = data.pool?.water_temp ?? 0;
        const storedLosses = stored.total_loss_kw ?? 0;
        const calcLosses = sum.total_loss_kw || 0;
        const storedSolar = stored.solar_gain_kw ?? 0;
        const calcSolar = sum.solar_gain_kw || 0;
        const storedNet = storedLosses - storedSolar;
        const calcNet = sum.net_requirement_kw || 0;
        const tick = (diff, tol, digits) => diff > tol ? `<span style="color:orange;">${diff.toFixed(digits)}</span>` : '✓';

        const comparisonCard = document.getElementById('debug-comparison');
        if (comparisonCard) {
            comparisonCard.innerHTML = `
                <h4 style="margin: 0 0 8px 0; font-size: 12px;">Run vs Recalculated <span style="font-weight:normal;color:#666;">(Run #${escapeHtml(stored.run_id || '?')} v${escapeHtml(stored.simulator_version || '?')}, hour from ${stored.source === 'database' ? 'its saved hours' : 'this browser'})</span></h4>
                <table class="data-table compact" style="font-size: 11px; width: 100%;">
                    <tr style="background: #f5f5f5;"><th></th><th>Run</th><th>Recalculated</th><th>Δ</th></tr>
                    <tr><td>Water Temp Start</td><td><code>${storedWaterTemp?.toFixed(2) ?? '?'}°C</code></td><td><code>${calcWaterTemp.toFixed(2)}°C</code></td><td>${tick(Math.abs(storedWaterTemp - calcWaterTemp), 0.1, 2)}</td></tr>
                    <tr><td>Total Losses</td><td><code>${storedLosses.toFixed(1)} kW</code></td><td><code>${calcLosses.toFixed(1)} kW</code></td><td>${tick(Math.abs(storedLosses - calcLosses), 2, 1)}</td></tr>
                    <tr><td>Solar Gain</td><td><code>${storedSolar.toFixed(1)} kW</code></td><td><code>${calcSolar.toFixed(1)} kW</code></td><td>${tick(Math.abs(storedSolar - calcSolar), 1, 1)}</td></tr>
                    <tr style="background: #f9f9f9;"><td><strong>Net Demand</strong></td><td><code><strong>${storedNet.toFixed(1)} kW</strong></code></td><td><code><strong>${calcNet.toFixed(1)} kW</strong></code></td><td>${tick(Math.abs(storedNet - calcNet), 5, 1)}</td></tr>
                    <tr style="background: #f0f8ff;"><td><strong>HP Output</strong></td><td><code><strong>${(stored.hp_heat_kw || 0).toFixed(1)} kW</strong></code></td><td><code><strong>${(hs.hp_output_kw || 0).toFixed(1)} kW</strong></code></td><td>-</td></tr>
                    <tr><td>Boiler</td><td><code>${(stored.boiler_heat_kw || 0).toFixed(1)} kW</code></td><td><code>${(hs.boiler_output_kw || 0).toFixed(1)} kW</code></td><td>-</td></tr>
                </table>
                <div style="font-size:10px;margin-top:6px;padding:4px;background:#f0f0f0;border-radius:3px;">
                    <strong>Run mode:</strong> ${escapeHtml(stored.heating_mode || '?')}
                    | <strong>Recalculated as:</strong> ${escapeHtml(hs.debug_mode || '?')} (steady-state; heating differs from the run in coast, ramp and banking hours)
                </div>
            `;
            comparisonCard.style.display = 'block';
        }

        // Visibility of debug-results is controlled by CSS (body.debug-mode-on .debug-only)
    },

    // Weekly chart instances (for cleanup)
    weeklyCharts: {
        production: null,
        weather: null
    },

    /**
     * Load weekly chart data and render charts
     */
    loadWeeklyChart: async function() {
        const dateInput = document.getElementById('debug-date');

        if (!dateInput || !dateInput.value) {
            alert('Please select a date first');
            return;
        }

        const date = dateInput.value;

        // Show loading
        const placeholder = document.getElementById('debug-weekly-chart-placeholder');
        const chartsDiv = document.getElementById('debug-weekly-charts');
        if (placeholder) placeholder.innerHTML = '<span style="color: #666;">Loading weekly data...</span>';

        try {
            // This browser's copy of a TypeScript run (no download, and
            // usable while its hours are still being saved), else the server
            await this.ensureHours(date);
            const localRunId = this.localDebugRun(date);
            let result = localRunId ? SimEngine.localWeek(localRunId, date) : null;
            if (!result) {
                const url = `/api/simulation_api.php?action=debug_week&date=${date}${this.debugRunParam(date)}`;
                const response = await fetch(url);
                result = await response.json();
            }

            if (result.error) {
                throw new Error(result.error);
            }

            if (!result.data || result.data.length === 0) {
                throw new Error('No data returned for this week');
            }

            // Hide placeholder, show charts and nav buttons
            if (placeholder) placeholder.style.display = 'none';
            if (chartsDiv) chartsDiv.style.display = 'block';
            const navButtons = document.getElementById('week-nav-buttons');
            if (navButtons) navButtons.style.display = 'block';

            // Render charts
            this.renderWeeklyProductionChart(result);
            this.renderWeeklyWeatherChart(result);

            // Calculate and display top 3 peak demand periods
            this.displayTopHeatLossPeriods(result.data);

        } catch (error) {
            console.error('Failed to load weekly data:', error);
            if (placeholder) {
                placeholder.innerHTML = `<span style="color: #dc3545;">Error: ${escapeHtml(error.message)}</span>`;
            }
        }
    },

    /**
     * Navigate week forward or backward
     */
    navigateWeek: function(direction) {
        const dateInput = document.getElementById('debug-date');
        if (!dateInput || !dateInput.value) return;

        const newDate = SimulationsModule.addDays(dateInput.value, direction * 7);
        dateInput.value = newDate;

        // Save to server preferences and reload
        if (typeof SimControlModule !== 'undefined') {
            SimControlModule.savePreference('debug_date', newDate);
        } else {
            localStorage.setItem(this.getUserKey('debug_date'), newDate);
        }
        this.loadWeeklyChart();
    },

    /**
     * Display top 3 heat loss periods with clickable links
     */
    displayTopHeatLossPeriods: function(data) {
        const container = document.getElementById('peak-periods-list');
        if (!container || !data || data.length === 0) return;

        // Sort by net_demand descending and take top 3
        const sorted = [...data]
            .filter(d => d.net_demand > 0)
            .sort((a, b) => b.net_demand - a.net_demand)
            .slice(0, 3);

        if (sorted.length === 0) {
            container.innerHTML = '<em>No heating demand in this period</em>';
            return;
        }

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const links = sorted.map((d, i) => {
            const dt = new Date(d.timestamp);
            const day = dt.getDate();
            const month = monthNames[dt.getMonth()];
            const hour = dt.getHours().toString().padStart(2, '0');
            const displayDate = `${day}.${month}`;
            const kw = d.net_demand.toFixed(1);
            return `<a href="#" onclick="app.simulations.jumpToTime(${escapeJsArg(d.timestamp)}); return false;"
                       style="color: #1976d2; text-decoration: none; margin-left: ${i > 0 ? '10px' : '5px'};"
                       title="Click to analyze this hour">${displayDate} ${hour}h (${kw} kW)</a>`;
        });

        container.innerHTML = links.join(' | ');
    },

    /**
     * Jump to a specific timestamp and recalculate
     */
    jumpToTime: function(timestamp) {
        const parts = timestamp.split(' ');
        const date = parts[0];
        const hour = parseInt(parts[1]?.split(':')[0] || '0');

        const dateInput = document.getElementById('debug-date');
        const hourSelect = document.getElementById('debug-hour');

        if (dateInput) {
            dateInput.value = date;
            // Save to server preferences
            if (typeof SimControlModule !== 'undefined') {
                SimControlModule.savePreference('debug_date', date);
            } else {
                localStorage.setItem(this.getUserKey('debug_date'), date);
            }
        }
        if (hourSelect) {
            hourSelect.value = hour;
            // Save hour to server preferences too
            if (typeof SimControlModule !== 'undefined') {
                SimControlModule.savePreference('debug_hour', hour);
            }
        }

        // Trigger recalculation
        this.debugHour();
    },

    /**
     * Render production chart (HP + Boiler stacked bars vs heat demand line, with water temp)
     */
    renderWeeklyProductionChart: function(weekData) {
        const canvas = document.getElementById('weekly-production-chart');
        if (!canvas || typeof Chart === 'undefined') {
            console.error('Chart.js not loaded or canvas not found');
            return;
        }

        // Destroy existing chart
        if (this.weeklyCharts.production) {
            this.weeklyCharts.production.destroy();
        }

        const data = weekData.data;

        // Debug: Log schedule status pattern (show first day's is_open values)
        const firstDayOpen = data.slice(0, 24).map((d, h) => d.is_open ? 'O' : 'C');
        console.log('[Schedule Debug] First day is_open pattern by hour (0-23):', firstDayOpen.join(''));
        console.log('[Schedule Debug] Expected for 10-20: CCCCCCCCCCOOOOOOOOOOOCCCCC (10 open hours from h10-h19)');
        const openCount = data.filter(d => d.is_open).length;
        console.log(`[Schedule Debug] Total open hours: ${openCount}/${data.length} (${(openCount/data.length*100).toFixed(1)}%)`);

        // Find index of current debug hour for highlighting
        const debugIndex = this.debugTimestamp ?
            data.findIndex(d => d.timestamp === this.debugTimestamp) : -1;

        // Log and display chart data for verification against debug output
        if (debugIndex >= 0) {
            const d = data[debugIndex];
            console.log('[Chart vs Debug] Highlighted hour data from chart:', {
                timestamp: d.timestamp,
                is_open: d.is_open,
                net_demand: d.net_demand?.toFixed(1),
                hp_output: d.hp_output?.toFixed(1),
                boiler_output: d.boiler_output?.toFixed(1)
            });

            // Update comparison display in UI (if mismatch, show warning)
            const comparisonEl = document.getElementById('chart-data-comparison');
            if (comparisonEl) {
                const chartStatus = d.is_open ? 'Open' : 'Closed';
                const chartDemand = d.net_demand?.toFixed(1) || '0';
                comparisonEl.innerHTML = `<strong>Chart data:</strong> ${chartStatus}, ${chartDemand} kW demand, HP: ${d.hp_output?.toFixed(1) || '0'} kW`;
                comparisonEl.style.color = '#666';
            }
        } else if (this.debugTimestamp) {
            console.log('[Chart vs Debug] Debug timestamp not found in chart data:', this.debugTimestamp);
            console.log('[Chart vs Debug] Chart timestamps sample:', data.slice(0, 3).map(d => d.timestamp));

            const comparisonEl = document.getElementById('chart-data-comparison');
            if (comparisonEl) {
                comparisonEl.innerHTML = `<span style="color: orange;">⚠ Hour not found in chart data</span>`;
            }
        }

        const labels = data.map((d, i) => {
            // Show day label at hour 3 (centered under day's data)
            const date = new Date(d.timestamp);
            const hour = date.getHours();
            if (hour === 3) {
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = date.getDate();
                return `${dayName} ${dayNum}`;
            }
            return '';
        });

        this.weeklyCharts.production = new Chart(canvas, {
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Water Temp',
                        data: data.map(d => d.water_temp),
                        segment: {
                            borderColor: ctx => {
                                // Red when pool is closed, blue when open
                                const idx = ctx.p0DataIndex;
                                return data[idx]?.is_open ? 'rgb(33, 150, 243)' : 'rgb(220, 53, 69)';
                            }
                        },
                        borderColor: 'rgb(33, 150, 243)',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0,
                        yAxisID: 'yTemp',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Heat Demand',
                        data: data.map(d => d.net_demand > 0 ? d.net_demand : 0),
                        borderColor: '#333',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        stepped: 'middle',
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: 'Heat Pump',
                        data: data.map(d => d.hp_output),
                        backgroundColor: 'rgba(40, 167, 69, 0.85)',
                        borderColor: 'rgba(40, 167, 69, 1)',
                        borderWidth: 0,
                        yAxisID: 'y',
                        stack: 'heating',
                        order: 2,
                        barPercentage: 1.0,
                        categoryPercentage: 1.0
                    },
                    {
                        type: 'bar',
                        label: 'Boiler',
                        data: data.map(d => d.boiler_output),
                        backgroundColor: 'rgba(220, 53, 69, 0.85)',
                        borderColor: 'rgba(220, 53, 69, 1)',
                        borderWidth: 0,
                        yAxisID: 'y',
                        stack: 'heating',
                        order: 3,
                        barPercentage: 1.0,
                        categoryPercentage: 1.0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    title: {
                        display: true,
                        text: `Heat Production: ${weekData.start_date} to ${weekData.end_date}`,
                        font: { size: 12 }
                    },
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                const idx = context[0].dataIndex;
                                return data[idx]?.timestamp || '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        offset: true,
                        grid: {
                            display: true,
                            drawTicks: true,
                            offset: false,
                            color: function(context) {
                                // Major gridline every 24 hours (day boundary)
                                if (context.index % 24 === 0) {
                                    return 'rgba(0, 0, 0, 0.3)';
                                }
                                // Minor gridline every 6 hours (6, 12, 18)
                                if (context.index % 6 === 0) {
                                    return 'rgba(0, 0, 0, 0.15)';
                                }
                                return 'transparent';
                            },
                            lineWidth: function(context) {
                                return context.index % 24 === 0 ? 1.5 : 1;
                            }
                        },
                        ticks: {
                            maxRotation: 0,
                            font: { size: 10 },
                            padding: 4,
                            autoSkip: false,
                            callback: function(value, index) {
                                // Show labels where they exist (at hour 3 positions)
                                const label = this.getLabelForValue(value);
                                return label || '';
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        stacked: true,
                        title: { display: true, text: 'kW', font: { size: 10 } },
                        beginAtZero: true,
                        ticks: { font: { size: 9 } },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    yTemp: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: '°C', font: { size: 10 } },
                        min: 20,
                        max: 32,
                        ticks: { font: { size: 9 } },
                        grid: { drawOnChartArea: false }
                    }
                }
            },
            plugins: [{
                id: 'debugHourHighlight',
                beforeDraw: (chart) => {
                    if (debugIndex < 0) return;

                    const ctx = chart.ctx;
                    const xAxis = chart.scales.x;
                    const yAxis = chart.scales.y;

                    // Get the pixel position for this bar
                    const barWidth = xAxis.width / data.length;
                    const x = xAxis.left + (debugIndex * barWidth);

                    // Draw highlight with left/right borders (more visible than fill)
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255, 152, 0, 0.9)';  // Orange border
                    ctx.lineWidth = 3;
                    // Left border
                    ctx.beginPath();
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.stroke();
                    // Right border
                    ctx.beginPath();
                    ctx.moveTo(x + barWidth, yAxis.top);
                    ctx.lineTo(x + barWidth, yAxis.bottom);
                    ctx.stroke();
                    // Light fill between borders
                    ctx.fillStyle = 'rgba(255, 235, 59, 0.15)';
                    ctx.fillRect(x, yAxis.top, barWidth, yAxis.bottom - yAxis.top);
                    ctx.restore();
                }
            }]
        });
    },

    /**
     * Render weather chart (temperature + wind with dual y-axis)
     */
    renderWeeklyWeatherChart: function(weekData) {
        const canvas = document.getElementById('weekly-weather-chart');
        if (!canvas || typeof Chart === 'undefined') {
            console.error('Chart.js not loaded or canvas not found');
            return;
        }

        // Destroy existing chart
        if (this.weeklyCharts.weather) {
            this.weeklyCharts.weather.destroy();
        }

        const data = weekData.data;

        // Find index of current debug hour for highlighting
        const debugIndex = this.debugTimestamp ?
            data.findIndex(d => d.timestamp === this.debugTimestamp) : -1;

        const labels = data.map((d, i) => {
            // Show day label at hour 3 (centered under day's data)
            const date = new Date(d.timestamp);
            const hour = date.getHours();
            if (hour === 3) {
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = date.getDate();
                return `${dayName} ${dayNum}`;
            }
            return '';
        });

        this.weeklyCharts.weather = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Air Temp (°C)',
                        data: data.map(d => d.air_temp),
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.1)',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Wind (m/s)',
                        data: data.map(d => d.wind_speed),
                        borderColor: 'rgba(0, 188, 212, 0.7)',
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderDash: [3, 3],
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                const idx = context[0].dataIndex;
                                return data[idx]?.timestamp || '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            display: true,
                            drawTicks: true,
                            color: function(context) {
                                // Match production chart gridlines
                                if (context.index % 24 === 0) return 'rgba(0, 0, 0, 0.25)';
                                if (context.index % 6 === 0) return 'rgba(0, 0, 0, 0.15)';
                                return 'transparent';
                            },
                            lineWidth: function(context) {
                                return context.index % 24 === 0 ? 1.5 : 1;
                            }
                        },
                        ticks: {
                            maxRotation: 0,
                            font: { size: 10 },
                            padding: 4,
                            autoSkip: false,
                            callback: function(value, index) {
                                // Show labels where they exist (at hour 3 positions)
                                const label = this.getLabelForValue(value);
                                return label || '';
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '°C', font: { size: 10 } },
                        ticks: { font: { size: 10 } },
                        grid: { color: 'rgba(0, 0, 0, 0.08)' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'm/s', font: { size: 10 } },
                        grid: { drawOnChartArea: false },
                        ticks: { font: { size: 10 } }
                    }
                }
            },
            plugins: [{
                id: 'debugHourHighlight',
                beforeDraw: (chart) => {
                    if (debugIndex < 0) return;

                    const ctx = chart.ctx;
                    const xAxis = chart.scales.x;
                    const yAxis = chart.scales.y;

                    // Get the pixel position for this data point
                    const barWidth = xAxis.width / data.length;
                    const x = xAxis.left + (debugIndex * barWidth);

                    // Draw highlight with left/right borders (more visible than fill)
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255, 152, 0, 0.9)';  // Orange border
                    ctx.lineWidth = 3;
                    // Left border
                    ctx.beginPath();
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.stroke();
                    // Right border
                    ctx.beginPath();
                    ctx.moveTo(x + barWidth, yAxis.top);
                    ctx.lineTo(x + barWidth, yAxis.bottom);
                    ctx.stroke();
                    // Light fill between borders
                    ctx.fillStyle = 'rgba(255, 235, 59, 0.15)';
                    ctx.fillRect(x, yAxis.top, barWidth, yAxis.bottom - yAxis.top);
                    ctx.restore();
                }
            }]
        });
    },

    /**
     * Get user-specific localStorage key
     */
    getUserKey: function(key) {
        // Use username from header for per-user storage
        const userEl = document.getElementById('current-user');
        const username = userEl?.textContent?.trim() || 'default';
        return `heataq_${username}_${key}`;
    },

    /**
     * Initialize debug section
     */
    initDebug: function() {
        const self = this;

        // Restore saved debug date (from server preferences or localStorage)
        const dateInput = document.getElementById('debug-date');
        const hourSelect = document.getElementById('debug-hour');

        // Try server preferences first, fall back to localStorage
        let savedDate = null;
        let savedHour = null;
        if (typeof SimControlModule !== 'undefined') {
            savedDate = SimControlModule.getPreference('debug_date');
            savedHour = SimControlModule.getPreference('debug_hour');
        }
        if (!savedDate) {
            savedDate = localStorage.getItem(this.getUserKey('debug_date'));
        }

        if (dateInput && savedDate) {
            dateInput.value = savedDate;
        }
        if (hourSelect && savedHour) {
            hourSelect.value = savedHour;
        }

        // Track parameter changes to update button state and save preference
        const paramInputs = ['debug-date', 'debug-hour'];
        paramInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    self.setDebugButtonState('changed');
                    // Save to server preferences (with localStorage fallback)
                    const prefKey = id === 'debug-date' ? 'debug_date' : 'debug_hour';
                    if (typeof SimControlModule !== 'undefined') {
                        SimControlModule.savePreference(prefKey, this.value);
                    } else {
                        localStorage.setItem(self.getUserKey(prefKey), this.value);
                    }
                });
            }
        });

        // Auto-load last run data if we have a date
        if (dateInput && dateInput.value) {
            this.autoLoadDebugData();
        }
    },

    /**
     * Set debug Calculate button state
     * @param {string} state - 'synced' (green), 'changed' (red), 'loading' (disabled)
     */
    setDebugButtonState: function(state) {
        const btn = document.getElementById('debug-calculate-btn');
        if (!btn) return;

        btn.classList.remove('btn-success', 'btn-danger', 'btn-secondary');
        btn.disabled = false;

        switch (state) {
            case 'synced':
                btn.classList.add('btn-success');
                btn.textContent = 'Calculate';
                break;
            case 'changed':
                btn.classList.add('btn-danger');
                btn.textContent = 'Calculate';
                break;
            case 'loading':
                btn.classList.add('btn-secondary');
                btn.textContent = 'Loading...';
                btn.disabled = true;
                break;
        }
    },

    /**
     * Auto-load last simulation run results for Simulate tab
     */
    autoLoadLastRun: async function(runId = null, options = {}) {
        try {
            // The given run, or the most recent COMPLETED run (a running or
            // failed run has no results and would show as all zeros)
            const query = runId
                ? `run_id=${encodeURIComponent(runId)}`
                : 'status=completed&limit=1';
            const response = await fetch(`/api/simulation_api.php?action=get_runs&${query}`);
            const data = await response.json();

            if (!data.runs || data.runs.length === 0) {
                // No runs yet - hide the results section
                const resultsDiv = document.getElementById('sim-last-run-results');
                if (resultsDiv) resultsDiv.style.display = 'none';
                const statusEl = document.getElementById('simulation-status');
                if (statusEl && !options.keepStatus) statusEl.textContent = '';
                return;
            }

            const lastRun = data.runs[0];

            // Show results section
            const resultsDiv = document.getElementById('sim-last-run-results');
            if (resultsDiv) resultsDiv.style.display = 'block';

            // Show run info
            const infoEl = document.getElementById('sim-last-run-info');
            if (infoEl) {
                const dateStr = lastRun.start_date && lastRun.end_date
                    ? `${lastRun.start_date} - ${lastRun.end_date}`
                    : '';
                infoEl.textContent = `${lastRun.scenario_name} (${dateStr})`;
            }

            // Show benchmark report (same as after running simulation)
            // Note: API returns decoded config in lastRun.config (not config_snapshot)
            if (typeof SimControlModule !== 'undefined' && lastRun.summary) {
                // Dates live on the run record, not in its saved config - without
                // them the reopened report showed "Period: to (365 days ...)".
                SimControlModule.showBenchmarkReport({
                    summary: lastRun.summary,
                    meta: {
                        ...(lastRun.config || {}),
                        start_date: lastRun.config?.start_date || lastRun.start_date,
                        end_date: lastRun.config?.end_date || lastRun.end_date
                    }
                });
            }

            // Render summary cards
            this.renderSimSummaryCards(lastRun.summary || {});

            // Load and render yearly chart
            await this.loadYearlyChart(lastRun.run_id);

            // Show last run completion time in status with version
            const statusEl = document.getElementById('simulation-status');
            if (statusEl && lastRun.completed_at && !options.keepStatus) {
                const completed = this.runTime(lastRun, 'completed');
                const dateStr = completed.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
                const timeStr = completed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const version = lastRun.config?.simulator_version || 'unknown';
                statusEl.textContent = `Last run #${lastRun.run_id}, v${version}: ${dateStr} - ${timeStr}`;
                statusEl.style.color = '#28a745';
            }

        } catch (error) {
            console.error('[Simulate] Failed to auto-load last run:', error);
        }
    },

    /**
     * Render summary cards for Simulate tab
     */
    renderSimSummaryCards: function(summary) {
        const container = document.getElementById('sim-summary-cards');
        if (!container) return;

        // Thermal output (heat delivered), not electricity consumed. Very old
        // runs without it show '-' rather than an estimate from a fixed COP.
        const hpThermal = summary.hp_thermal_kwh ?? null;
        const boilerThermal = summary.boiler_thermal_kwh ?? null;

        // Show per-year figures (summary.*_kwh / total_cost are cumulative over
        // the whole simulated period) so these cards match the annualized
        // Simulation Report instead of showing 10x-larger period totals.
        const basis = annualBasis(summary.total_hours);
        const years = basis.divisor;
        const sfx = basis.suffix;
        const cards = [
            { label: 'Total Cost' + sfx, value: this.formatCurrency((summary.total_cost || 0) / years) },
            { label: 'Heat Loss' + sfx, value: this.formatEnergy((summary.total_heat_loss_kwh || 0) / years) },
            { label: 'Solar Gain' + sfx, value: this.formatEnergy((summary.total_solar_gain_kwh || 0) / years) },
            { label: 'HP Thermal' + sfx, value: hpThermal === null ? '-' : this.formatEnergy(hpThermal / years) },
            { label: 'Boiler Thermal' + sfx, value: boilerThermal === null ? '-' : this.formatEnergy(boilerThermal / years) },
            { label: 'Avg COP', value: summary.avg_cop?.toFixed(2) || '-' }
        ];

        container.innerHTML = cards.map(c => `
            <div class="summary-card">
                <div class="card-value">${c.value}</div>
                <div class="card-label">${c.label}</div>
            </div>
        `).join('');
    },

    // Store yearly chart instance
    yearlyChart: null,

    /**
     * Load and render yearly chart for Simulate tab
     */
    loadYearlyChart: async function(runId) {
        try {
            const response = await fetch(`/api/simulation_api.php?action=get_daily_results&run_id=${runId}`);
            const data = await response.json();

            if (data.daily_results) {
                this.renderYearlyChart(data.daily_results);
            }
        } catch (error) {
            console.error('[Simulate] Failed to load yearly chart:', error);
        }
    },

    /**
     * Render yearly chart (daily energy stacked area)
     */
    renderYearlyChart: function(dailyResults) {
        const canvas = document.getElementById('sim-yearly-chart');
        if (!canvas || typeof Chart === 'undefined') {
            console.error('Chart.js not loaded or canvas not found');
            return;
        }

        // Destroy existing chart
        if (this.yearlyChart) {
            this.yearlyChart.destroy();
        }

        // Prepare data - use thermal output (heat delivered), NOT electricity consumed
        const labels = dailyResults.map(d => d.date);
        const heatLabels = this.dailyHeatLabels(dailyResults);
        const hpData = dailyResults.map(d => this.dailyHeat(d).hp);
        const boilerData = dailyResults.map(d => this.dailyHeat(d).boiler);

        this.yearlyChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: heatLabels.hp,
                        data: hpData,
                        borderColor: 'rgba(40, 167, 69, 1)',
                        backgroundColor: 'rgba(40, 167, 69, 0.7)',
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 1,
                        tension: 0.1,
                        order: 1
                    },
                    {
                        label: heatLabels.boiler,
                        data: boilerData,
                        borderColor: 'rgba(220, 53, 69, 1)',
                        backgroundColor: 'rgba(220, 53, 69, 0.7)',
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 1,
                        tension: 0.1,
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return context[0].label;
                            }
                        }
                    }
                },
                scales: {
                    x: SimulationsModule.dateAxis(labels),
                    y: {
                        display: true,
                        stacked: true,
                        title: { display: true, text: 'Energy (kWh)' }
                    }
                }
            }
        });
    },

    /**
     * Auto-load debug data from last simulation run
     */
    autoLoadDebugData: async function() {
        const dateInput = document.getElementById('debug-date');
        const hourSelect = document.getElementById('debug-hour');
        if (!dateInput || !dateInput.value) return;

        // Update formatted date display
        if (typeof updateDateDisplay === 'function') updateDateDisplay();

        const date = dateInput.value;
        const hour = hourSelect ? hourSelect.value : '12';

        // Set debugTimestamp so chart highlight appears on initial load
        this.debugTimestamp = `${date} ${hour.padStart(2, '0')}:00`;

        this.setDebugButtonState('loading');

        try {
            // Load debug hour data
            let data;
            try {
                data = await this.loadHourData(date, hour);
            } catch (e) {
                console.log('[Debug] No run for this date:', e.message);
                this.setDebugButtonState('changed'); // Red - needs calculation
                return;
            }

            // Render results
            this.renderDebugResults(data);

            // Load weekly chart
            await this.loadWeeklyChart();

            // Button green - data is in sync
            this.setDebugButtonState('synced');

        } catch (err) {
            console.error('[Debug] Auto-load failed:', err);
            this.setDebugButtonState('changed');
        }
    }
};

// Global function to update date display
window.updateDateDisplay = function() {
    const dateInput = document.getElementById('debug-date');
    const display = document.getElementById('debug-date-display');
    if (dateInput && display && dateInput.value) {
        const date = new Date(dateInput.value + 'T12:00:00');
        display.textContent = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationsModule;
}
