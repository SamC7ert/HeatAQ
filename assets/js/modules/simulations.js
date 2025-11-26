/**
 * HeatAQ Simulations Module
 * Handles simulation UI and API interactions
 */

const SimulationsModule = {
    // State
    runs: [],
    currentRun: null,
    weatherRange: null,

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
     * Render runs list
     */
    renderRunsList: function() {
        const container = document.getElementById('simulation-runs-list');
        if (!container) return;

        if (this.runs.length === 0) {
            container.innerHTML = '<p class="no-runs">No simulation runs yet. Create your first simulation above.</p>';
            return;
        }

        const html = this.runs.map(run => `
            <div class="run-item ${run.status}" onclick="SimulationsModule.viewRun(${run.run_id})">
                <div class="run-header">
                    <span class="run-name">${this.escapeHtml(run.scenario_name)}</span>
                    <span class="run-status status-${run.status}">${run.status}</span>
                </div>
                <div class="run-details">
                    <span class="run-dates">${run.start_date} to ${run.end_date}</span>
                    <span class="run-created">${this.formatDate(run.created_at)}</span>
                </div>
                ${run.summary ? this.renderRunSummary(run.summary) : ''}
            </div>
        `).join('');

        container.innerHTML = html;
    },

    /**
     * Render mini summary for run list item
     */
    renderRunSummary: function(summary) {
        if (!summary) return '';
        return `
            <div class="run-summary-mini">
                <span>Cost: ${this.formatCurrency(summary.total_cost)}</span>
                <span>HP: ${this.formatEnergy(summary.total_hp_energy_kwh)}</span>
                <span>Boiler: ${this.formatEnergy(summary.total_boiler_energy_kwh)}</span>
            </div>
        `;
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
        btn.disabled = true;
        btn.textContent = 'Running...';

        const progressDiv = document.getElementById('simulation-progress');
        progressDiv.innerHTML = '<div class="progress-message">Starting simulation...</div>';
        progressDiv.style.display = 'block';

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

            // Show success
            progressDiv.innerHTML = `
                <div class="progress-success">
                    Simulation completed!<br>
                    <span class="summary-line">Total Cost: ${this.formatCurrency(data.summary?.total_cost || 0)}</span>
                    <span class="summary-line">Hours Simulated: ${data.hourly_count?.toLocaleString() || 0}</span>
                </div>
            `;

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
            progressDiv.innerHTML = `<div class="progress-error">Error: ${error.message}</div>`;
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
     * Render daily energy chart
     */
    renderDailyChart: function(dailyResults) {
        const canvas = document.getElementById('daily-energy-chart');
        if (!canvas || typeof Chart === 'undefined') {
            // Chart.js not loaded, show table instead
            this.renderDailyTable(dailyResults);
            return;
        }

        // Prepare data
        const labels = dailyResults.map(d => d.date);
        const hpData = dailyResults.map(d => parseFloat(d.total_hp_kwh));
        const boilerData = dailyResults.map(d => parseFloat(d.total_boiler_kwh));
        const lossData = dailyResults.map(d => parseFloat(d.total_loss_kwh));

        new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Heat Loss (kWh)',
                        data: lossData,
                        borderColor: '#dc3545',
                        backgroundColor: 'rgba(220, 53, 69, 0.1)',
                        fill: false
                    },
                    {
                        label: 'Heat Pump (kWh)',
                        data: hpData,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        fill: false
                    },
                    {
                        label: 'Boiler (kWh)',
                        data: boilerData,
                        borderColor: '#fd7e14',
                        backgroundColor: 'rgba(253, 126, 20, 0.1)',
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: true,
                        title: { display: true, text: 'Date' }
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
                            <th>HP (kWh)</th>
                            <th>Boiler (kWh)</th>
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
                                <td>${parseFloat(d.total_hp_kwh).toFixed(1)}</td>
                                <td>${parseFloat(d.total_boiler_kwh).toFixed(1)}</td>
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
                                <td>${parseFloat(d.total_hp_kwh).toFixed(1)}</td>
                                <td>${parseFloat(d.total_boiler_kwh).toFixed(1)}</td>
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

            // Build CSV
            const headers = ['date', 'hours_count', 'open_hours', 'avg_air_temp', 'avg_water_temp',
                           'total_loss_kwh', 'total_solar_kwh', 'total_hp_kwh', 'total_boiler_kwh', 'total_cost'];
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
     * Toggle config override fields
     */
    toggleOverride: function() {
        const checkbox = document.getElementById('sim-use-override');
        const overrideFields = document.getElementById('sim-override-fields');
        const projectConfig = document.getElementById('sim-project-config');

        if (checkbox && overrideFields && projectConfig) {
            if (checkbox.checked) {
                overrideFields.style.display = 'block';
                projectConfig.style.display = 'none';
            } else {
                overrideFields.style.display = 'none';
                projectConfig.style.display = 'block';
            }
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
        console.log('V52 debugHour called');
        const dateEl = document.getElementById('debug-date');
        const hourEl = document.getElementById('debug-hour');
        const waterTempEl = document.getElementById('debug-water-temp');
        const resultsDiv = document.getElementById('debug-results');

        // Debug: check which elements are missing
        if (!dateEl || !hourEl || !waterTempEl || !resultsDiv) {
            const missing = [];
            if (!dateEl) missing.push('debug-date');
            if (!hourEl) missing.push('debug-hour');
            if (!waterTempEl) missing.push('debug-water-temp');
            if (!resultsDiv) missing.push('debug-results');
            alert('Missing elements: ' + missing.join(', ') + '\n\nTry refreshing with Ctrl+Shift+R to clear cache.');
            return;
        }

        const date = dateEl.value;
        const hour = hourEl.value;
        const waterTemp = waterTempEl.value;
        const configId = document.getElementById('debug-config-select')?.value || null;

        if (!date) {
            alert('Please select a date');
            return;
        }

        resultsDiv.innerHTML = '<p class="loading">Calculating...</p>';
        resultsDiv.style.display = 'block';

        try {
            let url = `/api/simulation_api.php?action=debug_hour&date=${date}&hour=${hour}`;
            if (waterTemp) url += `&water_temp=${waterTemp}`;
            if (configId) url += `&config_id=${configId}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.renderDebugResults(data);

        } catch (error) {
            resultsDiv.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        }
    },

    /**
     * Render debug calculation results - populates new UI structure
     */
    renderDebugResults: function(data) {
        console.log('V59 renderDebugResults called', data);

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

        // ===== Populate Heat Balance Summary (top right) =====
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

        // Net demand
        setEl('debug-net-demand', `${hs.net_demand_kw?.toFixed(1) || '0'} kW`);

        // Heat pump output
        setEl('debug-hp-output', `${hs.hp_output_kw?.toFixed(1) || '0'} kW`);
        setEl('debug-hp-detail', `COP ${hp.cop || '-'} | ${hp.electricity_kw?.toFixed(1) || '0'} kW elec`);

        // Boiler output
        setEl('debug-boiler-output', `${hs.boiler_output_kw?.toFixed(1) || '0'} kW`);
        setEl('debug-boiler-detail', `${((boiler.efficiency || 0.92) * 100).toFixed(0)}% eff | ${boiler.fuel_kw?.toFixed(1) || '0'} kW fuel`);

        // Input summary bar
        const inp = data.input || {};
        setEl('debug-air-temp', `${inp.weather?.air_temp_c || '-'}°C`);
        setEl('debug-wind', `${inp.weather?.wind_speed_ms || '-'} m/s`);
        setEl('debug-solar-val', `${inp.weather?.solar_ghi_wm2 || '-'} W/m²`);
        setEl('debug-status', inp.config?.is_open ? 'Open' : 'Closed');

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
        const configSelect = document.getElementById('debug-config-select');

        if (!dateInput || !dateInput.value) {
            alert('Please select a date first');
            return;
        }

        const date = dateInput.value;
        const configId = configSelect?.value || '';

        // Show loading
        const placeholder = document.getElementById('debug-weekly-chart-placeholder');
        const chartsDiv = document.getElementById('debug-weekly-charts');
        if (placeholder) placeholder.innerHTML = '<span style="color: #666;">Loading weekly data...</span>';

        try {
            const url = `/api/simulation_api.php?action=debug_week&date=${date}&config_id=${configId}`;
            const response = await fetch(url);
            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            if (!result.data || result.data.length === 0) {
                throw new Error('No data returned for this week');
            }

            // Hide placeholder, show charts
            if (placeholder) placeholder.style.display = 'none';
            if (chartsDiv) chartsDiv.style.display = 'block';

            // Render charts
            this.renderWeeklyProductionChart(result);
            this.renderWeeklyWeatherChart(result);

        } catch (error) {
            console.error('Failed to load weekly data:', error);
            if (placeholder) {
                placeholder.innerHTML = `<span style="color: #dc3545;">Error: ${error.message}</span>`;
            }
        }
    },

    /**
     * Render production chart (HP + Boiler stacked vs heat loss line, with water temp)
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
        const labels = data.map((d, i) => {
            // Show day abbreviation every 24 hours
            if (i % 24 === 0) {
                const date = new Date(d.timestamp);
                return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            }
            return '';
        });

        this.weeklyCharts.production = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Water Temp',
                        data: data.map(d => d.water_temp),
                        borderColor: 'rgb(33, 150, 243)',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.2,
                        yAxisID: 'yTemp',
                        order: 0
                    },
                    {
                        label: 'Heat Demand',
                        data: data.map(d => d.net_demand > 0 ? d.net_demand : 0),
                        borderColor: '#333',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1,
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        label: 'Boiler',
                        data: data.map(d => d.boiler_output),
                        backgroundColor: 'rgba(220, 53, 69, 0.8)',
                        borderColor: 'rgba(220, 53, 69, 1)',
                        borderWidth: 0,
                        fill: true,
                        pointRadius: 0,
                        yAxisID: 'y',
                        stack: 'heating',
                        order: 3
                    },
                    {
                        label: 'Heat Pump',
                        data: data.map(d => d.hp_output),
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: 'rgba(40, 167, 69, 1)',
                        borderWidth: 0,
                        fill: true,
                        pointRadius: 0,
                        yAxisID: 'y',
                        stack: 'heating',
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
                        grid: {
                            display: true,
                            color: function(context) {
                                // Major gridline every 24 hours (day boundary)
                                if (context.index % 24 === 0) {
                                    return 'rgba(0, 0, 0, 0.3)';
                                }
                                // Minor gridline every 6 hours
                                if (context.index % 6 === 0) {
                                    return 'rgba(0, 0, 0, 0.1)';
                                }
                                return 'transparent';
                            },
                            lineWidth: function(context) {
                                return context.index % 24 === 0 ? 1.5 : 1;
                            }
                        },
                        ticks: { maxRotation: 0, font: { size: 9 } }
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
            }
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
        const labels = data.map((d, i) => {
            if (i % 24 === 0) {
                const date = new Date(d.timestamp);
                return date.toLocaleDateString('en-US', { weekday: 'short' });
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
                            color: function(context) {
                                if (context.index % 24 === 0) return 'rgba(0, 0, 0, 0.3)';
                                if (context.index % 6 === 0) return 'rgba(0, 0, 0, 0.1)';
                                return 'transparent';
                            },
                            lineWidth: function(context) {
                                return context.index % 24 === 0 ? 1.5 : 1;
                            }
                        },
                        ticks: { maxRotation: 0, font: { size: 9 } }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '°C', font: { size: 10 } },
                        ticks: { font: { size: 9 } }
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
            }
        });
    },

    /**
     * Initialize debug section
     */
    initDebug: function() {
        // Restore saved config selection (dropdown populated by SimControlModule.loadConfigOptions)
        const select = document.getElementById('debug-config-select');
        const savedConfig = localStorage.getItem('heataq_selected_config') || '';
        if (select && savedConfig) {
            select.value = savedConfig;
        }
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationsModule;
}
