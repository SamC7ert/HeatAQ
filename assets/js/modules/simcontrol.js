// SimControl module - Handles simulation control with tabs

const SimControlModule = {
    currentTab: 'new',
    initialized: false,
    userPreferences: {},  // Cached preferences from server

    // Initialize SimControl
    init: async function() {
        if (!this.initialized) {
            this.initialized = true;
            // Load user preferences from server first (syncs across devices)
            await this.loadUserPreferences();
            // Load sites and pools for selection
            await this.loadSites();
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

    // Currently selected site and pool
    currentSiteId: null,
    currentPoolId: null,
    sites: [],
    pools: [],

    // Load sites from API
    loadSites: async function() {
        const select = document.getElementById('sim-site-select');
        if (!select) return;

        try {
            const response = await fetch('./api/heataq_api.php?action=get_sites');
            const data = await response.json();

            if (data.sites && data.sites.length > 0) {
                this.sites = data.sites;

                select.innerHTML = data.sites.map(site =>
                    `<option value="${site.site_id}">${site.name}</option>`
                ).join('');

                // Auto-select first site (or saved preference)
                const savedSite = this.getPreference('sim_site_id');
                if (savedSite && data.sites.find(s => s.site_id === savedSite)) {
                    select.value = savedSite;
                }

                this.currentSiteId = select.value;
                await this.loadPools(this.currentSiteId);
            } else {
                select.innerHTML = '<option value="">No sites available</option>';
            }
        } catch (err) {
            console.error('Failed to load sites:', err);
            select.innerHTML = '<option value="">Error loading sites</option>';
        }
    },

    // Load pools for selected site
    loadPools: async function(siteId) {
        const select = document.getElementById('sim-pool-select');
        if (!select) return;

        if (!siteId) {
            select.innerHTML = '<option value="">Select a site first</option>';
            return;
        }

        try {
            const response = await fetch(`./api/heataq_api.php?action=get_pools&site_id=${encodeURIComponent(siteId)}`);
            const data = await response.json();

            if (data.notice) {
                // Pools table doesn't exist yet
                select.innerHTML = '<option value="">Run migration first</option>';
                console.warn(data.notice);
                return;
            }

            if (data.pools && data.pools.length > 0) {
                this.pools = data.pools;

                select.innerHTML = data.pools.map(pool =>
                    `<option value="${pool.pool_id}">${pool.name} (${pool.area_m2}m², ${pool.volume_m3}m³)</option>`
                ).join('');

                // Auto-select first pool (or saved preference)
                const savedPool = this.getPreference('sim_pool_id');
                if (savedPool && data.pools.find(p => p.pool_id == savedPool)) {
                    select.value = savedPool;
                }

                this.currentPoolId = select.value;
            } else {
                select.innerHTML = '<option value="">No pools at this site</option>';
                this.pools = [];
            }
        } catch (err) {
            console.error('Failed to load pools:', err);
            select.innerHTML = '<option value="">Error loading pools</option>';
        }
    },

    // Handle site selection change
    onSiteChange: async function() {
        const select = document.getElementById('sim-site-select');
        if (!select) return;

        this.currentSiteId = select.value;
        this.savePreference('sim_site_id', this.currentSiteId);

        await this.loadPools(this.currentSiteId);
    },

    // Handle pool selection change
    onPoolChange: function() {
        const select = document.getElementById('sim-pool-select');
        if (!select) return;

        this.currentPoolId = select.value;
        this.savePreference('sim_pool_id', this.currentPoolId);

        // Update config values display with pool's physical data
        const pool = this.pools.find(p => p.pool_id == this.currentPoolId);
        if (pool) {
            this.updatePoolConfigDisplay(pool);
        }
    },

    // Update config display with pool's physical properties
    updatePoolConfigDisplay: function(pool) {
        // These could be shown in the config overrides section
        // For now, just log - can expand later
        console.log('[SimControl] Selected pool:', pool.name, pool);
    },

    // Load user preferences from server (syncs across iPad, desktop, etc.)
    loadUserPreferences: async function() {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_preferences');
            const data = await response.json();
            this.userPreferences = data.preferences || {};
        } catch (err) {
            console.warn('Failed to load user preferences from server:', err);
            this.userPreferences = {};
        }
    },

    // Save a preference to server (with localStorage fallback)
    savePreference: async function(key, value) {
        // Always save to localStorage as fallback
        localStorage.setItem('heataq_' + key, value);

        // Try to save to server for cross-device sync
        try {
            await fetch('./api/heataq_api.php?action=save_preference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key, value: value })
            });
            this.userPreferences[key] = value;
        } catch (err) {
            console.warn('Failed to save preference to server:', err);
        }
    },

    // Get preference value (server preference takes priority over localStorage)
    getPreference: function(key) {
        return this.userPreferences[key] || localStorage.getItem('heataq_' + key) || '';
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

                // Restore saved selection (from server or localStorage)
                const savedOHC = this.getPreference('selected_ohc');
                if (savedOHC) {
                    select.value = savedOHC;
                }

                // Save selection on change (to server + localStorage)
                select.addEventListener('change', () => {
                    this.savePreference('selected_ohc', select.value);
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

            console.log('[SimControl] Populating dropdown with', data.configs.length, 'configs:',
                data.configs.map(c => ({ id: c.template_id, name: c.name })));

            const optionsHtml = '<option value="">-- Use Project Config --</option>' +
                data.configs.map(c =>
                    `<option value="${c.template_id}">${c.name}</option>`
                ).join('');

            // Populate config dropdown (simulation only - debug uses run info)
            const simSelect = document.getElementById('sim-config-select');
            console.log('[SimControl] sim-config-select element:', simSelect ? 'found' : 'NOT FOUND');

            if (simSelect) {
                simSelect.innerHTML = optionsHtml;
                console.log('[SimControl] Dropdown populated, options count:', simSelect.options.length);
            }

            // Restore saved selection (from server or localStorage)
            const savedConfig = this.getPreference('selected_config');
            if (simSelect) simSelect.value = savedConfig;

            // Load config values on change
            if (simSelect) {
                simSelect.addEventListener('change', () => {
                    this.savePreference('selected_config', simSelect.value);
                    this.loadSelectedConfig(simSelect.value);
                });

                // Load initial config if one is selected
                if (savedConfig) {
                    this.loadSelectedConfig(savedConfig);
                }
            }
        } catch (err) {
            console.error('Failed to load config options:', err);
        }
    },

    // Load and display selected config values
    loadSelectedConfig: async function(configId) {
        if (!configId) {
            // Clear config values if no config selected
            document.querySelectorAll('[id^="cfg-val-"]').forEach(el => el.textContent = '-');
            return;
        }

        try {
            const response = await fetch(`./api/heataq_api.php?action=get_project_config&config_id=${configId}`);
            const data = await response.json();
            console.log('[SimControl] Config data received:', data);

            if (data.config && typeof SimulationsModule !== 'undefined') {
                // The config object is nested: data.config.config contains the actual values
                const configValues = data.config.config || data.config;
                console.log('[SimControl] Populating with:', configValues);
                SimulationsModule.populateConfigValues(configValues);
            }
        } catch (err) {
            console.error('Failed to load config:', err);
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
            <div><strong>Wind:</strong> ${((config.wind_exposure_factor || 1) * 100).toFixed(1)}% exposure</div>
            <div><strong>Cover:</strong> R=${config.cover_r_value || 5} m²K/W, ${((config.cover_solar_transmittance || 0.1) * 100).toFixed(1)}% transmit</div>
            <div><strong>Solar abs:</strong> ${((config.solar_absorption || 0.6) * 100).toFixed(1)}%, Years: ${config.years_operating || 3}</div>
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
