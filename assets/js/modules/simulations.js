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
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationsModule;
}
