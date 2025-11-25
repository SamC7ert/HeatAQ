// SimControl module - Handles simulation control with tabs

const SimControlModule = {
    currentTab: 'new',
    initialized: false,

    // Initialize SimControl
    init: function() {
        if (!this.initialized) {
            this.initialized = true;
            // Load OHC options for the dropdown
            this.loadOHCOptions();
            // Load weather range info
            this.loadWeatherRange();
        }

        // Initialize current tab
        this.switchTab(this.currentTab);
    },

    // Switch between tabs
    switchTab: function(tabName) {
        this.currentTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.sim-tab').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`.sim-tab[onclick*="${tabName}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Hide all tab content
        document.querySelectorAll('.sim-tab-content').forEach(content => {
            content.style.display = 'none';
        });

        // Show selected tab content
        const tabContent = document.getElementById(`sim-tab-${tabName}`);
        if (tabContent) {
            tabContent.style.display = '';
        }

        // Load tab-specific data
        switch (tabName) {
            case 'new':
                // New run tab - already loaded in init
                break;
            case 'history':
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.loadRuns();
                }
                break;
            case 'compare':
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.initCompare();
                }
                break;
        }
    },

    // Load OHC options for schedule dropdown
    loadOHCOptions: async function() {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_templates');
            const data = await response.json();

            const select = document.getElementById('sim-ohc-select');
            if (select && data.templates) {
                select.innerHTML = data.templates.map(t =>
                    `<option value="${t.template_id}">${t.name}</option>`
                ).join('');
            }
        } catch (err) {
            console.error('Failed to load OHC options:', err);
        }
    },

    // Load weather data range
    loadWeatherRange: async function() {
        try {
            const response = await fetch('./api/simulation_api.php?action=get_weather_range');
            const data = await response.json();

            const info = document.getElementById('weather-range-info');
            if (info && data.weather_range) {
                const range = data.weather_range;
                info.textContent = `Weather data: ${range.min_date} to ${range.max_date} (${range.hours_count?.toLocaleString() || '-'} hours)`;
            }
        } catch (err) {
            console.error('Failed to load weather range:', err);
        }
    },

    // Show benchmark report
    showBenchmarkReport: function(results) {
        const report = document.getElementById('benchmark-report');
        if (!report) return;

        report.style.display = '';

        // Fill in the values
        const summary = results.summary || {};

        // Config summary
        document.getElementById('bench-config-summary').textContent =
            `${summary.total_hours || 0} hours, Pool: ${results.meta?.pool_config?.area_m2 || 312.5}m², ` +
            `HP: ${results.meta?.equipment?.heat_pump?.capacity_kw || 125}kW, ` +
            `Boiler: ${results.meta?.equipment?.boiler?.capacity_kw || 200}kW`;

        // Thermal losses (convert kWh to MWh)
        const toMWh = (val) => val ? (val / 1000).toFixed(1) : '-';

        // Note: Current simulator stores total_heat_loss_kwh
        // For detailed breakdown, we need to enhance the simulator
        document.getElementById('bench-evap').textContent = toMWh(summary.evaporation_kwh) || '-';
        document.getElementById('bench-conv').textContent = toMWh(summary.convection_kwh) || '-';
        document.getElementById('bench-rad').textContent = toMWh(summary.radiation_kwh) || '-';
        document.getElementById('bench-floor').textContent = toMWh(summary.floor_loss_kwh) || '-';
        document.getElementById('bench-wall').textContent = toMWh(summary.wall_loss_kwh) || '-';
        document.getElementById('bench-solar').textContent = summary.total_solar_gain_kwh
            ? '-' + toMWh(summary.total_solar_gain_kwh)
            : '-';
        document.getElementById('bench-total-loss').textContent = toMWh(summary.total_heat_loss_kwh);

        // Heating delivered
        document.getElementById('bench-hp-thermal').textContent = toMWh(summary.hp_thermal_kwh) || '-';
        document.getElementById('bench-boiler-thermal').textContent = toMWh(summary.boiler_thermal_kwh) || '-';
        document.getElementById('bench-total-delivered').textContent =
            toMWh((summary.hp_thermal_kwh || 0) + (summary.boiler_thermal_kwh || 0));
        document.getElementById('bench-unmet').textContent = toMWh(summary.unmet_kwh) || '-';

        // Electricity
        document.getElementById('bench-hp-elec').textContent = toMWh(summary.total_hp_energy_kwh);
        document.getElementById('bench-boiler-fuel').textContent = toMWh(summary.total_boiler_energy_kwh);
        document.getElementById('bench-shower').textContent = toMWh(summary.shower_heating_kwh) || '-';
        document.getElementById('bench-total-elec').textContent =
            toMWh((summary.total_hp_energy_kwh || 0) + (summary.total_boiler_energy_kwh || 0) + (summary.shower_heating_kwh || 0));

        // Temperature
        document.getElementById('bench-temp-min').textContent = summary.min_water_temp?.toFixed(2) || '-';
        document.getElementById('bench-temp-avg').textContent = summary.avg_water_temp?.toFixed(2) || '-';
        document.getElementById('bench-temp-max').textContent = summary.max_water_temp?.toFixed(2) || '-';
        document.getElementById('bench-days-27').textContent = summary.days_below_27 || '0';
        document.getElementById('bench-days-26').textContent = summary.days_below_26 || '0';
    },

    // Hide benchmark report
    hideBenchmarkReport: function() {
        const report = document.getElementById('benchmark-report');
        if (report) {
            report.style.display = 'none';
        }
    }
};

// Export for use in app
window.SimControlModule = SimControlModule;
