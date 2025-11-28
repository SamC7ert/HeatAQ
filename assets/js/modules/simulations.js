/**
 * HeatAQ Simulations Module
 * Handles simulation UI and API interactions
 */

const SimulationsModule = {
    // State
    runs: [],
    currentRun: null,
    weatherRange: null,
    debugTimestamp: null,  // Current debug date+hour for chart highlighting

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
            const response = await fetch('/api/simulation_api.php?action=get_runs&limit=20');
            const data = await response.json();
            if (data.runs) {
                this.runs = data.runs;
                this.renderRunsList();
            }
        } catch (error) {
            console.error('Failed to load runs:', error);
        }
    },

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
                        <th>Scenario</th>
                        <th>Dates</th>
                        <th>Schedule</th>
                        <th>HP (kW)</th>
                        <th>Boiler (kW)</th>
                        <th>Elec (MWh)</th>
                        <th>&lt;1°C</th>
                        <th>&lt;2°C</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.runs.map(run => {
                        const s = run.summary || {};
                        const config = run.config || {};
                        const hpCap = config.equipment?.hp_capacity_kw || '-';
                        const boilerCap = config.equipment?.boiler_capacity_kw || '-';
                        const scheduleName = config.schedule_template_name || '-';
                        const elecMwh = s.total_hp_electricity_kwh ? (s.total_hp_electricity_kwh / 1000).toFixed(1) : '-';
                        const days1 = s.days_below_target_1c ?? '-';
                        const days2 = s.days_below_target_2c ?? '-';

                        return `
                            <tr class="run-row ${run.status}" onclick="SimulationsModule.viewRun(${run.run_id})" style="cursor: pointer;">
                                <td class="run-name">${this.escapeHtml(run.scenario_name)}</td>
                                <td class="run-dates">${run.start_date.substring(5)} - ${run.end_date.substring(5)}</td>
                                <td class="run-schedule" title="${this.escapeHtml(scheduleName)}">${this.escapeHtml(scheduleName.substring(0, 15))}</td>
                                <td>${hpCap}</td>
                                <td>${boilerCap}</td>
                                <td>${elecMwh}</td>
                                <td class="${days1 > 10 ? 'bad' : days1 > 0 ? 'warning' : ''}">${days1}</td>
                                <td class="${days2 > 5 ? 'bad' : days2 > 0 ? 'warning' : ''}">${days2}</td>
                                <td><span class="status-badge status-${run.status}">${run.status}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    /**
     * Start a new simulation
     */
    startSimulation: async function() {
        const scenarioName = document.getElementById('sim-scenario-name').value || 'Unnamed Scenario';
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

        if (new Date(endDate) < new Date(startDate)) {
            alert('End date must be after start date');
            return;
        }

        // Disable button and show progress
        const btn = document.getElementById('run-simulation-btn');
        const statusEl = document.getElementById('simulation-status');
        btn.disabled = true;
        btn.textContent = 'Running...';
        if (statusEl) {
            statusEl.textContent = 'Starting simulation...';
            statusEl.style.color = '#666';
        }

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
                    template_id: ohcId
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // Show success with date/time
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            if (statusEl) {
                statusEl.textContent = `Simulation completed ${dateStr} - ${timeStr}`;
                statusEl.style.color = '#28a745';
            }

            // Show benchmark report
            if (typeof SimControlModule !== 'undefined' && data.summary) {
                SimControlModule.showBenchmarkReport({
                    summary: data.summary,
                    meta: data.meta || {}
                });
            }

            // Reload runs list
            this.loadRuns();

            // View the new run
            if (data.run_id) {
                setTimeout(() => this.viewRun(data.run_id), 1000);
            }

        } catch (error) {
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
    viewRun: async function(runId) {
        try {
            const response = await fetch(`/api/simulation_api.php?action=get_run&run_id=${runId}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.currentRun = data.run;
            this.renderRunDetail();

            // Also load daily results for charts
            this.loadDailyResults(runId);

        } catch (error) {
            console.error('Failed to load run:', error);
            alert('Failed to load simulation run');
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

        container.innerHTML = `
            <div class="run-detail-header">
                <h3>${this.escapeHtml(run.scenario_name)}</h3>
                <button class="btn btn-secondary btn-sm" onclick="SimulationsModule.closeDetail()">Close</button>
            </div>

            <div class="run-detail-info">
                <div class="info-row">
                    <span class="label">Period:</span>
                    <span class="value">${run.start_date} to ${run.end_date}</span>
                </div>
                <div class="info-row">
                    <span class="label">Schedule:</span>
                    <span class="value">${this.escapeHtml(scheduleName)}</span>
                </div>
                <div class="info-row">
                    <span class="label">Status:</span>
                    <span class="value status-${run.status}">${run.status}</span>
                </div>
                <div class="info-row">
                    <span class="label">Created:</span>
                    <span class="value">${this.formatDate(run.created_at)}</span>
                </div>
            </div>

            <div class="run-summary-cards">
                <div class="summary-card">
                    <div class="card-value">${this.formatCurrency(summary.total_cost)}</div>
                    <div class="card-label">Total Cost</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy(summary.total_heat_loss_kwh)}</div>
                    <div class="card-label">Heat Loss</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy(summary.total_solar_gain_kwh)}</div>
                    <div class="card-label">Solar Gain</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy(summary.total_hp_energy_kwh)}</div>
                    <div class="card-label">Heat Pump</div>
                </div>
                <div class="summary-card">
                    <div class="card-value">${this.formatEnergy(summary.total_boiler_energy_kwh)}</div>
                    <div class="card-label">Boiler</div>
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
     * Render daily energy chart (area chart matching debug colors)
     */
    renderDailyChart: function(dailyResults) {
        const canvas = document.getElementById('daily-energy-chart');
        if (!canvas || typeof Chart === 'undefined') {
            // Chart.js not loaded, show table instead
            this.renderDailyTable(dailyResults);
            return;
        }

        // Prepare data - use thermal output (heat delivered), NOT electricity/fuel consumed
        // For old runs without thermal columns, estimate using typical COP/efficiency
        const labels = dailyResults.map(d => d.date);
        const hpData = dailyResults.map(d => {
            const thermal = parseFloat(d.hp_thermal_kwh);
            if (thermal > 0) return thermal;
            const elec = parseFloat(d.total_hp_kwh) || 0;
            return elec * 3.5;  // Estimated thermal output
        });
        const boilerData = dailyResults.map(d => {
            const thermal = parseFloat(d.boiler_thermal_kwh);
            if (thermal > 0) return thermal;
            const fuel = parseFloat(d.total_boiler_kwh) || 0;
            return fuel * 0.92;  // Estimated thermal output
        });
        const lossData = dailyResults.map(d => parseFloat(d.total_loss_kwh) || 0);

        new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Heat Demand (kWh)',
                        data: lossData,
                        borderColor: 'rgba(100, 100, 100, 0.8)',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 1.5,
                        tension: 0.1,
                        order: 0  // Draw on top
                    },
                    {
                        label: 'Boiler (kWh)',
                        data: boilerData,
                        borderColor: 'rgba(220, 53, 69, 1)',
                        backgroundColor: 'rgba(220, 53, 69, 0.7)',
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 0,
                        tension: 0.1,
                        stack: 'heating',
                        order: 2
                    },
                    {
                        label: 'Heat Pump (kWh)',
                        data: hpData,
                        borderColor: 'rgba(40, 167, 69, 1)',
                        backgroundColor: 'rgba(40, 167, 69, 0.7)',
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 0,
                        tension: 0.1,
                        stack: 'heating',
                        order: 1
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
                    x: {
                        display: true,
                        ticks: {
                            maxTicksLimit: 12,
                            font: { size: 9 }
                        }
                    },
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
                                <td>${d.date}</td>
                                <td>${d.open_hours}</td>
                                <td>${parseFloat(d.avg_water_temp).toFixed(1)}°C</td>
                                <td>${parseFloat(d.total_loss_kwh).toFixed(1)}</td>
                                <td>${parseFloat(d.hp_thermal_kwh || d.total_hp_kwh).toFixed(1)}</td>
                                <td>${parseFloat(d.boiler_thermal_kwh || d.total_boiler_kwh).toFixed(1)}</td>
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
                                <td>${d.date}</td>
                                <td>${d.open_hours}</td>
                                <td>${parseFloat(d.avg_water_temp).toFixed(1)}°C</td>
                                <td>${parseFloat(d.total_loss_kwh).toFixed(1)}</td>
                                <td>${parseFloat(d.hp_thermal_kwh || d.total_hp_kwh).toFixed(1)}</td>
                                <td>${parseFloat(d.boiler_thermal_kwh || d.total_boiler_kwh).toFixed(1)}</td>
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
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    },

    formatDate: function(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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
     * Initialize Compare section
     */
    initCompare: async function() {
        const select1 = document.getElementById('compare-run-1');
        const select2 = document.getElementById('compare-run-2');

        if (!select1 || !select2) return;

        // Load runs for dropdowns
        try {
            const response = await fetch('/api/simulation_api.php?action=get_runs&limit=50');
            const data = await response.json();

            if (data.runs) {
                const optionsHtml = data.runs.map(run =>
                    `<option value="${run.run_id}">${this.escapeHtml(run.scenario_name)} (${run.start_date} - ${run.end_date})</option>`
                ).join('');

                select1.innerHTML = '<option value="">Select Run 1...</option>' + optionsHtml;
                select2.innerHTML = '<option value="">Select Run 2...</option>' + optionsHtml;
            }
        } catch (error) {
            console.error('Failed to load runs for comparison:', error);
        }
    },

    /**
     * Populate config values in the override table
     * Called when config is loaded or changed
     */
    populateConfigValues: function(config) {
        if (!config) return;

        // Map config values to display elements
        const mappings = {
            'cfg-val-hp-capacity': config.equipment?.hp_capacity_kw,
            'cfg-val-boiler-capacity': config.equipment?.boiler_capacity_kw,
            'cfg-val-target-temp': config.control?.target_temp,
            'cfg-val-upper-tol': config.control?.upper_tolerance ?? config.control?.temp_tolerance,
            'cfg-val-lower-tol': config.control?.lower_tolerance ?? config.control?.temp_tolerance,
            'cfg-val-bathers': config.bathers?.per_day,
            'cfg-val-activity': config.bathers?.activity_factor,
            'cfg-val-wind': config.pool?.wind_exposure,
            'cfg-val-solar': config.solar?.absorption
        };

        for (const [id, value] of Object.entries(mappings)) {
            const el = document.getElementById(id);
            if (el && value !== undefined) {
                el.textContent = value;
            }
        }

        // Load any saved overrides from localStorage
        this.loadSavedOverrides();
    },

    /**
     * Load saved override values from localStorage
     */
    loadSavedOverrides: function() {
        const key = this.getUserKey('sim_overrides');
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const overrides = JSON.parse(saved);
                const fields = [
                    'sim-hp-override', 'sim-boiler-override', 'sim-target-override',
                    'sim-upper-tol-override', 'sim-lower-tol-override', 'sim-bathers-override',
                    'sim-activity-override', 'sim-wind-override', 'sim-solar-override'
                ];
                fields.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && overrides[id]) {
                        el.value = overrides[id];
                    }
                });
            } catch (e) {
                console.error('Failed to load saved overrides:', e);
            }
        }
    },

    /**
     * Save override values to localStorage
     */
    saveOverrides: function() {
        const fields = [
            'sim-hp-override', 'sim-boiler-override', 'sim-target-override',
            'sim-upper-tol-override', 'sim-lower-tol-override', 'sim-bathers-override',
            'sim-activity-override', 'sim-wind-override', 'sim-solar-override'
        ];
        const overrides = {};
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value) {
                overrides[id] = el.value;
            }
        });
        const key = this.getUserKey('sim_overrides');
        localStorage.setItem(key, JSON.stringify(overrides));
    },

    /**
     * Get effective config with overrides applied
     */
    getEffectiveConfig: function(baseConfig) {
        const config = JSON.parse(JSON.stringify(baseConfig)); // Deep clone

        // Apply overrides if set
        const getOverride = (id) => {
            const el = document.getElementById(id);
            return el && el.value ? parseFloat(el.value) : null;
        };

        const hpOverride = getOverride('sim-hp-override');
        const boilerOverride = getOverride('sim-boiler-override');
        const targetOverride = getOverride('sim-target-override');
        const upperTolOverride = getOverride('sim-upper-tol-override');
        const lowerTolOverride = getOverride('sim-lower-tol-override');
        const bathersOverride = getOverride('sim-bathers-override');
        const activityOverride = getOverride('sim-activity-override');
        const windOverride = getOverride('sim-wind-override');
        const solarOverride = getOverride('sim-solar-override');

        if (hpOverride !== null) config.equipment.hp_capacity_kw = hpOverride;
        if (boilerOverride !== null) config.equipment.boiler_capacity_kw = boilerOverride;
        if (targetOverride !== null) config.control.target_temp = targetOverride;
        if (upperTolOverride !== null) config.control.upper_tolerance = upperTolOverride;
        if (lowerTolOverride !== null) config.control.lower_tolerance = lowerTolOverride;
        if (bathersOverride !== null) config.bathers.per_day = Math.round(bathersOverride);
        if (activityOverride !== null) config.bathers.activity_factor = activityOverride;
        if (windOverride !== null) config.pool.wind_exposure = windOverride;
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
                            save_run: false // Don't save to history
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

                    // HP Use (MWh)
                    const hpCell = document.getElementById(`result-hp-${caseNum}`);
                    if (hpCell) {
                        const hpMwh = (summary.total_hp_heat_kwh || 0) / 1000;
                        hpCell.textContent = hpMwh.toFixed(1);
                        hpCell.className = 'result-cell';
                    }

                    // Boiler Use (MWh)
                    const boilerCell = document.getElementById(`result-boiler-${caseNum}`);
                    if (boilerCell) {
                        const boilerMwh = (summary.total_boiler_heat_kwh || 0) / 1000;
                        boilerCell.textContent = boilerMwh.toFixed(1);
                        boilerCell.className = boilerMwh > 50 ? 'result-cell warning' : 'result-cell';
                    }

                    // Electricity (MWh)
                    const elecCell = document.getElementById(`result-elec-${caseNum}`);
                    if (elecCell) {
                        const elecMwh = (summary.total_hp_electricity_kwh || 0) / 1000;
                        elecCell.textContent = elecMwh.toFixed(1);
                        elecCell.className = 'result-cell';
                    }

                    // Days below target (1°C)
                    const days1Cell = document.getElementById(`result-days1-${caseNum}`);
                    if (days1Cell) {
                        const days1 = summary.days_below_target_1c || 0;
                        days1Cell.textContent = days1;
                        days1Cell.className = days1 > 10 ? 'result-cell bad' : days1 > 0 ? 'result-cell warning' : 'result-cell good';
                    }

                    // Days below target (2°C)
                    const days2Cell = document.getElementById(`result-days2-${caseNum}`);
                    if (days2Cell) {
                        const days2 = summary.days_below_target_2c || 0;
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
            resultsDiv.innerHTML = `<p class="error">Error: ${error.message}</p>`;
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
                            <td>${run1.start_date} - ${run1.end_date}</td>
                            <td>${run2.start_date} - ${run2.end_date}</td>
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

        // Save date to localStorage for persistence (user-specific)
        localStorage.setItem(this.getUserKey('debug_date'), date);

        // Store current debug timestamp for chart highlighting (no seconds to match chart data format)
        this.debugTimestamp = `${date} ${hour.padStart(2, '0')}:00`;

        // Show results section without destroying card structure
        resultsDiv.style.display = 'block';

        // Clear individual card contents to show loading state
        ['debug-input', 'debug-evaporation', 'debug-convection', 'debug-radiation',
         'debug-solar', 'debug-conduction', 'debug-heatpump', 'debug-boiler', 'debug-summary'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span style="color: #999;">Loading...</span>';
        });

        try {
            // Use stored water temp from simulation (no override)
            const url = `/api/simulation_api.php?action=debug_hour&date=${date}&hour=${hour}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.renderDebugResults(data);

            // Also load weekly chart automatically
            await this.loadWeeklyChart();

            // Success - button green (data in sync)
            this.setDebugButtonState('synced');

        } catch (error) {
            // Show error in summary card without destroying structure
            const summaryEl = document.getElementById('debug-summary');
            if (summaryEl) {
                summaryEl.innerHTML = `<p class="error" style="color: #dc3545;">Error: ${error.message}</p>`;
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
        let date = new Date(dateEl.value);

        if (hour > 0) {
            hour--;
        } else {
            // Go to previous day, hour 23
            hour = 23;
            date.setDate(date.getDate() - 1);
            dateEl.value = date.toISOString().split('T')[0];
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
        let date = new Date(dateEl.value);

        if (hour < 23) {
            hour++;
        } else {
            // Go to next day, hour 0
            hour = 0;
            date.setDate(date.getDate() + 1);
            dateEl.value = date.toISOString().split('T')[0];
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
        console.log('[V79 renderDebugResults]', data);

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
                html += `<tr><td>${displayKey}</td><td><code>${displayVal}</code></td></tr>`;
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
        setEl('debug-boiler-detail', `${((boiler.efficiency || 0.92) * 100).toFixed(0)}% eff | ${boiler.fuel_kw?.toFixed(1) || '0'} kW fuel`);

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

        // Cover status (Cover On/Off)
        const hasCover = inp.config?.has_cover;
        const coverOn = hasCover && !isOpen;
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
                ohcDisplay.innerHTML = `${schedDebug.template_name || 'Default'} <span style="font-size:11px;color:#666;">(${periodsStr}, ${schedDebug.open_hours}h)</span>`;
            }
        }

        // Update chart comparison display with stored run info
        const comparisonEl = document.getElementById('chart-data-comparison');
        if (comparisonEl && stored.run_id) {
            comparisonEl.innerHTML = `<strong>From Run #${stored.run_id}:</strong> ${isOpen ? 'Open' : 'Closed'}, ` +
                `Loss: ${stored.total_loss_kw?.toFixed(1)} kW, HP: ${stored.hp_heat_kw?.toFixed(1)} kW, ` +
                `Boiler: ${stored.boiler_heat_kw?.toFixed(1)} kW` +
                (data.validation_warning ? ` <span style="color: orange;">⚠ ${data.validation_warning}</span>` : '');
        }

        // ===== Populate Detail Cards =====
        setHtml('debug-input', `
            <strong>Weather:</strong> ${inp.weather?.air_temp_c}°C, Wind: ${inp.weather?.wind_speed_ms} m/s, RH: ${inp.weather?.humidity_pct}%<br>
            <strong>Pool:</strong> ${inp.pool?.water_temp_c}°C, ${inp.pool?.area_m2} m²<br>
            <strong>Config:</strong> Wind×${inp.config?.wind_factor}, Cover: ${inp.config?.has_cover ? 'Yes' : 'No'}
        `);
        setHtml('debug-evaporation', renderTable(data.evaporation));
        setHtml('debug-convection', renderTable(data.convection));
        setHtml('debug-radiation', renderTable(data.radiation));
        setHtml('debug-solar', renderTable(data.solar_gain));
        setHtml('debug-conduction', renderTable(data.conduction));

        // Heat pump detail
        setHtml('debug-heatpump', `
            <table class="data-table compact" style="font-size: 11px;">
                <tr><td>Strategy</td><td><code>${hp.strategy || 'reactive'}</code></td></tr>
                <tr><td>Capacity</td><td><code>${hp.capacity_kw} kW</code></td></tr>
                <tr><td>COP @ ${inp.weather?.air_temp_c}°C</td><td><code>${hp.cop}</code></td></tr>
                <tr><td>Output</td><td><code><strong>${hp.output_kw} kW</strong></code></td></tr>
                <tr><td>Electricity</td><td><code>${hp.electricity_kw} kW</code></td></tr>
            </table>
        `);

        // Boiler detail
        setHtml('debug-boiler', `
            <table class="data-table compact" style="font-size: 11px;">
                <tr><td>Capacity</td><td><code>${boiler.capacity_kw} kW</code></td></tr>
                <tr><td>Efficiency</td><td><code>${((boiler.efficiency || 0.92) * 100).toFixed(0)}%</code></td></tr>
                <tr><td>Output</td><td><code><strong>${boiler.output_kw} kW</strong></code></td></tr>
                <tr><td>Fuel input</td><td><code>${boiler.fuel_kw} kW</code></td></tr>
            </table>
        `);

        // Summary
        const sum = data.summary || {};
        setHtml('debug-summary', `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
                <div>Evap: <strong>${sum.evaporation_kw}</strong> kW</div>
                <div>Conv: <strong>${sum.convection_kw}</strong> kW</div>
                <div>Rad: <strong>${sum.radiation_kw}</strong> kW</div>
                <div>Cond: <strong>${(sum.wall_loss_kw + sum.floor_loss_kw).toFixed(3)}</strong> kW</div>
                <div>Solar: <strong>-${sum.solar_gain_kw}</strong> kW</div>
                <div><strong>Net: ${sum.net_requirement_kw} kW</strong></div>
                <div style="color: #2196F3;">HP: <strong>${hs.hp_output_kw}</strong> kW</div>
                <div style="color: #ff9800;">Boiler: <strong>${hs.boiler_output_kw}</strong> kW</div>
            </div>
        `);

        // Show results
        const resultsDiv = document.getElementById('debug-results');
        if (resultsDiv) resultsDiv.style.display = 'block';
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
            const url = `/api/simulation_api.php?action=debug_week&date=${date}`;
            const response = await fetch(url);
            const result = await response.json();

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
                placeholder.innerHTML = `<span style="color: #dc3545;">Error: ${error.message}</span>`;
            }
        }
    },

    /**
     * Navigate week forward or backward
     */
    navigateWeek: function(direction) {
        const dateInput = document.getElementById('debug-date');
        if (!dateInput || !dateInput.value) return;

        const currentDate = new Date(dateInput.value);
        currentDate.setDate(currentDate.getDate() + (direction * 7));

        // Format as YYYY-MM-DD
        const newDate = currentDate.toISOString().split('T')[0];
        dateInput.value = newDate;

        // Save to localStorage and reload (user-specific)
        localStorage.setItem(this.getUserKey('debug_date'), newDate);
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
            return `<a href="#" onclick="app.simulations.jumpToTime('${d.timestamp}'); return false;"
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
            localStorage.setItem(this.getUserKey('debug_date'), date);
        }
        if (hourSelect) {
            hourSelect.value = hour;
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
            // Show day label at start of each day (hour 0)
            if (i % 24 === 0) {
                const date = new Date(d.timestamp);
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
                            font: { size: 9 },
                            padding: 2,
                            autoSkip: false,
                            callback: function(value, index) {
                                // Show day label at hour 0
                                if (index % 24 === 0) {
                                    return this.getLabelForValue(value);
                                }
                                return '';
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
            // Show day label at start of each day (hour 0)
            if (i % 24 === 0) {
                const date = new Date(d.timestamp);
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
                            font: { size: 9 },
                            padding: 2,
                            autoSkip: false,
                            callback: function(value, index) {
                                if (index % 24 === 0) {
                                    return this.getLabelForValue(value);
                                }
                                return '';
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '°C', font: { size: 10 } },
                        ticks: { font: { size: 9 } },
                        grid: { color: 'rgba(0, 0, 0, 0.08)' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'm/s', font: { size: 10 } },
                        grid: { drawOnChartArea: false },
                        ticks: { font: { size: 9 } }
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

        // Restore saved debug date
        const dateInput = document.getElementById('debug-date');
        const savedDate = localStorage.getItem(this.getUserKey('debug_date'));
        if (dateInput && savedDate) {
            dateInput.value = savedDate;
        }

        // Track parameter changes to update button state
        const paramInputs = ['debug-date', 'debug-hour'];
        paramInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    self.setDebugButtonState('changed');
                    if (id === 'debug-date') {
                        localStorage.setItem(self.getUserKey('debug_date'), this.value);
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
    autoLoadLastRun: async function() {
        try {
            // Get the most recent completed run
            const response = await fetch('/api/simulation_api.php?action=get_runs&limit=1');
            const data = await response.json();

            if (!data.runs || data.runs.length === 0) {
                // No runs yet - hide the results section
                const resultsDiv = document.getElementById('sim-last-run-results');
                if (resultsDiv) resultsDiv.style.display = 'none';
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
            if (typeof SimControlModule !== 'undefined' && lastRun.summary) {
                SimControlModule.showBenchmarkReport({
                    summary: lastRun.summary,
                    meta: lastRun.config_snapshot || {}
                });
            }

            // Render summary cards
            this.renderSimSummaryCards(lastRun.summary || {});

            // Load and render yearly chart
            await this.loadYearlyChart(lastRun.run_id);

            // Show last run completion time in status
            const statusEl = document.getElementById('simulation-status');
            if (statusEl && lastRun.completed_at) {
                const completed = new Date(lastRun.completed_at);
                const dateStr = completed.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
                const timeStr = completed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                statusEl.textContent = `Last run: ${dateStr} - ${timeStr}`;
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

        // Calculate thermal output (heat delivered), not electricity/fuel consumed
        // For old runs without thermal columns, estimate using typical COP/efficiency
        const hpThermal = summary.hp_thermal_kwh > 0
            ? summary.hp_thermal_kwh
            : (summary.total_hp_energy_kwh || 0) * 3.5;
        const boilerThermal = summary.boiler_thermal_kwh > 0
            ? summary.boiler_thermal_kwh
            : (summary.total_boiler_energy_kwh || 0) * 0.92;

        const cards = [
            { label: 'Total Cost', value: this.formatCurrency(summary.total_cost) },
            { label: 'Heat Loss', value: this.formatEnergy(summary.total_heat_loss_kwh) },
            { label: 'Solar Gain', value: this.formatEnergy(summary.total_solar_gain_kwh) },
            { label: 'HP Thermal', value: this.formatEnergy(hpThermal) },
            { label: 'Boiler Thermal', value: this.formatEnergy(boilerThermal) },
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
        // For old runs without thermal columns, estimate: HP thermal ≈ electricity × COP (assume 3.5)
        const labels = dailyResults.map(d => d.date);
        const hpData = dailyResults.map(d => {
            const thermal = parseFloat(d.hp_thermal_kwh);
            if (thermal > 0) return thermal;
            // Fallback: estimate from electricity × average COP
            const elec = parseFloat(d.total_hp_kwh) || 0;
            return elec * 3.5;  // Estimated thermal output
        });
        const boilerData = dailyResults.map(d => {
            const thermal = parseFloat(d.boiler_thermal_kwh);
            if (thermal > 0) return thermal;
            // Fallback: estimate from fuel × efficiency (assume 92%)
            const fuel = parseFloat(d.total_boiler_kwh) || 0;
            return fuel * 0.92;  // Estimated thermal output
        });
        const lossData = dailyResults.map(d => parseFloat(d.total_loss_kwh) || 0);

        // Stack data: Boiler on top of HP
        const stackedBoilerData = boilerData.map((b, i) => b + hpData[i]);

        this.yearlyChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Heat Demand (kWh)',
                        data: lossData,
                        borderColor: 'rgba(100, 100, 100, 0.8)',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 1.5,
                        tension: 0.1,
                        order: 0  // Draw on top
                    },
                    {
                        label: 'Boiler (kWh)',
                        data: stackedBoilerData,
                        borderColor: 'rgba(220, 53, 69, 1)',
                        backgroundColor: 'rgba(220, 53, 69, 0.7)',
                        fill: '-1',  // Fill down to HP dataset
                        pointRadius: 0,
                        borderWidth: 0,
                        tension: 0.1,
                        order: 1
                    },
                    {
                        label: 'Heat Pump (kWh)',
                        data: hpData,
                        borderColor: 'rgba(40, 167, 69, 1)',
                        backgroundColor: 'rgba(40, 167, 69, 0.7)',
                        fill: 'origin',  // Fill down to x-axis
                        pointRadius: 0,
                        borderWidth: 0,
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
                    x: {
                        display: true,
                        ticks: {
                            maxTicksLimit: 12,
                            font: { size: 9 }
                        }
                    },
                    y: {
                        display: true,
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
            const url = `/api/simulation_api.php?action=debug_hour&date=${date}&hour=${hour}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                console.log('[Debug] No stored run for this date:', data.error);
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
