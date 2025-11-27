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
            // Load configuration options
            this.loadConfigOptions();
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
                // Auto-load last simulation results
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.autoLoadLastRun();
                }
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
            case 'debug':
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.initDebug();
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

                // Restore saved selection
                const savedOHC = localStorage.getItem('heataq_selected_ohc') || '';
                if (savedOHC) {
                    select.value = savedOHC;
                }

                // Save selection on change
                select.addEventListener('change', () => {
                    localStorage.setItem('heataq_selected_ohc', select.value);
                });
            }
        } catch (err) {
            console.error('Failed to load OHC options:', err);
        }
    },

    // Load configuration options (shared between New Run and Debug Hour)
    loadConfigOptions: async function() {
        console.log('[SimControl] Loading config options...');
        try {
            const response = await fetch('./api/heataq_api.php?action=get_project_configs');
            const data = await response.json();
            console.log('[SimControl] Config response:', data);

            if (!data.configs) {
                console.warn('[SimControl] No configs in response');
                return;
            }

            const optionsHtml = '<option value="">-- Use Project Config --</option>' +
                data.configs.map(c =>
                    `<option value="${c.template_id}">${c.name}</option>`
                ).join('');

            // Populate both dropdowns
            const simSelect = document.getElementById('sim-config-select');
            const debugSelect = document.getElementById('debug-config-select');

            if (simSelect) simSelect.innerHTML = optionsHtml;
            if (debugSelect) debugSelect.innerHTML = optionsHtml;

            // Restore saved selection
            const savedConfig = localStorage.getItem('heataq_selected_config') || '';
            if (simSelect) simSelect.value = savedConfig;
            if (debugSelect) debugSelect.value = savedConfig;

            // Sync dropdowns on change
            if (simSelect) {
                simSelect.addEventListener('change', () => {
                    localStorage.setItem('heataq_selected_config', simSelect.value);
                    if (debugSelect) debugSelect.value = simSelect.value;
                });
            }
            if (debugSelect) {
                debugSelect.addEventListener('change', () => {
                    localStorage.setItem('heataq_selected_config', debugSelect.value);
                    if (simSelect) simSelect.value = debugSelect.value;
                });
            }
        } catch (err) {
            console.error('Failed to load config options:', err);
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

        // Config summary - detailed multi-column layout
        const config = results.meta?.pool_config || {};
        const equip = results.meta?.equipment || {};
        const startDate = results.meta?.start_date || '';
        const endDate = results.meta?.end_date || '';
        const year = startDate ? startDate.substring(0, 4) : '';
        const hours = summary.total_hours || 0;
        const days = Math.round(hours / 24);

        // Calculate pool dimensions from area (approximate)
        const area = config.area_m2 || 312.5;
        const volume = config.volume_m3 || 625;
        const depth = config.depth_m || 2;

        // Build config HTML - show actual values to verify config is being applied
        const hpKw = equip.heat_pump?.capacity_kw ?? 'not set';
        const boilerKw = equip.boiler?.capacity_kw ?? 'not set';
        const hpCop = equip.heat_pump?.cop_nominal ?? '-';
        const boilerEff = equip.boiler?.efficiency ? (equip.boiler.efficiency * 100).toFixed(0) + '%' : '-';
        const strategy = equip.heat_pump?.strategy || config.control_strategy || 'reactive';
        const targetTemp = config.target_temp || equip.control?.target_temp || 28;

        const configHtml = `
            <div><strong>Period:</strong> ${year} (${days} days, ${hours.toLocaleString()} hours)</div>
            <div><strong>Pool:</strong> ${area} m², ${volume} m³, depth ${depth}m</div>
            <div><strong>Heat Pump:</strong> ${hpKw} kW, COP ${hpCop}</div>
            <div><strong>Boiler:</strong> ${boilerKw} kW, ${boilerEff} efficiency</div>
            <div><strong>Strategy:</strong> ${strategy}, target ${targetTemp}°C</div>
            <div><strong>Wind:</strong> ${((config.wind_exposure_factor || 1) * 100).toFixed(0)}% exposure</div>
            <div><strong>Cover:</strong> R=${config.cover_r_value || 5} m²K/W, ${((config.cover_solar_transmittance || 0.1) * 100).toFixed(0)}% transmit</div>
            <div><strong>Solar abs:</strong> ${((config.solar_absorption || 0.6) * 100).toFixed(0)}%, Years: ${config.years_operating || 3}</div>
        `;
        document.getElementById('bench-config-summary').innerHTML = configHtml;

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
