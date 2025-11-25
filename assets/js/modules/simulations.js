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

            // Set default values to last year of data
            const maxDate = new Date(this.weatherRange.max_date);
            const oneYearBefore = new Date(maxDate);
            oneYearBefore.setFullYear(maxDate.getFullYear() - 1);

            startInput.value = oneYearBefore.toISOString().split('T')[0];
            endInput.value = this.weatherRange.max_date;

            // Update weather info display
            const rangeInfo = document.getElementById('weather-range-info');
            if (rangeInfo) {
                rangeInfo.textContent = `Available: ${this.weatherRange.min_date} to ${this.weatherRange.max_date} (${this.weatherRange.days_count} days)`;
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
                    description: description
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
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationsModule;
}
