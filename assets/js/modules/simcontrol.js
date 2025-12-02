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
            // Restore saved dates and add listeners
            this.initDateInputs();
        }

        // Initialize current tab
        this.switchTab(this.currentTab);
    },

    // Initialize date inputs - restore saved values and add change listeners
    initDateInputs: function() {
        const startInput = document.getElementById('sim-start-date');
        const endInput = document.getElementById('sim-end-date');

        // Restore saved dates
        const savedStart = this.getPreference('sim_start_date');
        const savedEnd = this.getPreference('sim_end_date');

        if (savedStart && startInput) {
            startInput.value = savedStart;
        }
        if (savedEnd && endInput) {
            endInput.value = savedEnd;
        }

        // Add change listeners to save dates
        if (startInput) {
            startInput.addEventListener('change', () => {
                this.savePreference('sim_start_date', startInput.value);
            });
        }
        if (endInput) {
            endInput.addEventListener('change', () => {
                this.savePreference('sim_end_date', endInput.value);
            });
        }
    },

    // Currently selected site and pool
    currentSiteId: null,
    currentPoolId: null,
    sites: [],
    pools: [],

    // Load sites from API - NO FALLBACKS, must match project's site
    loadSites: async function() {
        console.log('[SimControl] loadSites starting...');
        const select = document.getElementById('sim-site-select');
        if (!select) {
            console.error('[SimControl] sim-site-select element not found');
            return;
        }

        try {
            // Get project's site_id from localStorage (Project module stores it there)
            // This is the source of truth for which site the user is working with
            let projectSiteId = null;
            const siteData = localStorage.getItem('heataq_site');
            if (siteData) {
                try {
                    const site = JSON.parse(siteData);
                    projectSiteId = site.site_id;
                    console.log('[SimControl] Site from localStorage:', projectSiteId);
                } catch (e) {
                    console.warn('[SimControl] Failed to parse localStorage site data');
                }
            }

            // Fallback to API if localStorage empty
            if (!projectSiteId) {
                const projResponse = await fetch('./api/heataq_api.php?action=get_project_site');
                const projData = await projResponse.json();
                projectSiteId = projData.site_id;
                console.log('[SimControl] Site from API fallback:', projectSiteId);
            }

            if (!projectSiteId) {
                console.error('[SimControl] No site_id configured for project');
                select.innerHTML = '<option value="">ERROR: No site configured for project</option>';
                return;
            }
            console.log('[SimControl] Project site_id:', projectSiteId);

            // Get all sites
            const response = await fetch('./api/heataq_api.php?action=get_sites');
            const data = await response.json();

            if (!data.sites || data.sites.length === 0) {
                console.error('[SimControl] No sites returned from API');
                select.innerHTML = '<option value="">ERROR: No sites defined in database</option>';
                return;
            }

            console.log('[SimControl] Sites from API:', data.sites.length);
            this.sites = data.sites;

            // Find the project's site - must exist
            const projectSite = data.sites.find(s => s.site_id === projectSiteId);
            if (!projectSite) {
                console.error('[SimControl] Project site not found:', projectSiteId);
                select.innerHTML = `<option value="">ERROR: Site "${projectSiteId}" not in database</option>`;
                return;
            }

            // Populate dropdown with all sites, select project's site
            select.innerHTML = data.sites.map(site =>
                `<option value="${site.site_id}" ${site.site_id === projectSiteId ? 'selected' : ''}>${site.name}</option>`
            ).join('');

            this.currentSiteId = projectSiteId;
            console.log('[SimControl] Selected site:', projectSite.name);

            // Set cookie for backend API to read (expires in 1 year)
            // Use pool_site_id (INT) - look up from site data
            const poolSiteId = projectSite.id;  // pool_sites.id
            document.cookie = `heataq_pool_site_id=${poolSiteId}; path=/; max-age=31536000`;

            await this.loadPools(this.currentSiteId);

        } catch (err) {
            console.error('[SimControl] Failed to load sites:', err);
            select.innerHTML = '<option value="">ERROR: ' + err.message + '</option>';
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
                    `<option value="${pool.pool_id}">${pool.name}</option>`
                ).join('');

                // Priority: 1) Project's pool, 2) Saved preference, 3) First pool
                let selectedPool = null;

                // Try to get from ProjectModule
                if (typeof ProjectModule !== 'undefined' && ProjectModule.currentPoolId) {
                    console.log('[SimControl] ProjectModule.currentPoolId:', ProjectModule.currentPoolId);
                    if (data.pools.find(p => p.pool_id == ProjectModule.currentPoolId)) {
                        selectedPool = ProjectModule.currentPoolId;
                        console.log('[SimControl] Using project pool id:', selectedPool);
                    }
                } else {
                    console.log('[SimControl] ProjectModule.currentPoolId not available');
                }

                // Fall back to saved preference
                if (!selectedPool) {
                    const savedPool = this.getPreference('sim_pool_id');
                    if (savedPool && data.pools.find(p => p.pool_id == savedPool)) {
                        selectedPool = savedPool;
                    }
                }

                // Set selection
                if (selectedPool) {
                    select.value = selectedPool;
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

        // Find selected site to get pool_site_id (INT)
        const site = this.sites.find(s => s.site_id === this.currentSiteId);
        if (site) {
            // Set cookie for backend API to read (expires in 1 year)
            document.cookie = `heataq_pool_site_id=${site.id}; path=/; max-age=31536000`;
        }

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
                // Re-apply debug mode visibility when switching to Details tab
                if (typeof AdminModule !== 'undefined' && AdminModule.applyDebugMode) {
                    const debugEnabled = localStorage.getItem('heataq_debug_mode') === '1';
                    AdminModule.applyDebugMode(debugEnabled);
                }
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

    // Show benchmark report (in both Simulate and Debug tabs)
    showBenchmarkReport: function(results) {
        const report = document.getElementById('benchmark-report');
        const reportDebug = document.getElementById('benchmark-report-debug');

        if (report) report.style.display = '';
        if (reportDebug) reportDebug.style.display = '';

        if (!report && !reportDebug) return;

        // Fill in the values
        const summary = results.summary || {};

        // Config summary - detailed multi-column layout
        const config = results.meta?.pool_config || {};
        const equip = results.meta?.equipment || {};
        // Control values are stored directly in equipment (target_temp, temp_tolerance)
        const control = results.meta?.control || equip.control || {};
        // Bathers: NO DEFAULTS - must be configured, show '-' if missing
        const bathers = results.meta?.bathers || equip.bathers || config.bathers || {};
        const overrides = results.meta?.config_override || {};
        const startDate = results.meta?.start_date || '';
        const endDate = results.meta?.end_date || '';
        const hours = summary.total_hours || 0;
        const days = Math.round(hours / 24);

        // Calculate pool dimensions from area (approximate)
        const area = config.area_m2 || 312.5;
        const volume = config.volume_m3 || 625;
        const depth = config.depth_m || 2;

        // Helper to format values with override highlighting
        const fmt = (value, unit = '', decimals = 1) => {
            if (value === undefined || value === null || value === 'not set') return '-';
            const num = typeof value === 'number' ? value.toFixed(decimals) : value;
            return `${num}${unit}`;
        };

        const withOverride = (baseValue, overrideValue, unit = '', decimals = 1) => {
            if (overrideValue !== undefined && overrideValue !== null) {
                return `<span style="color:#0d6efd;font-weight:600" title="Override applied">${fmt(overrideValue, unit, decimals)} ✓</span>`;
            }
            return fmt(baseValue, unit, decimals);
        };

        // Equipment values (check for overrides)
        const hpKw = withOverride(
            equip.heat_pump?.capacity_kw,
            overrides.equipment?.hp_capacity_kw,
            ' kW', 0
        );
        const boilerKw = withOverride(
            equip.boiler?.capacity_kw,
            overrides.equipment?.boiler_capacity_kw,
            ' kW', 0
        );
        const hpCop = fmt(equip.heat_pump?.cop_nominal, '', 1);
        const boilerEff = equip.boiler?.efficiency ? fmt(equip.boiler.efficiency * 100, '%', 0) : '-';

        // Control values - check equipment directly first, then control sub-object
        const targetTemp = withOverride(
            equip.target_temp || control.target_temp || config.target_temp,
            overrides.control?.target_temp,
            '°C', 1
        );
        // Tolerance: check equipment (from PHP) then control section (from config_json)
        const upperTol = withOverride(
            equip.upper_tolerance || control.upper_tolerance || equip.temp_tolerance || control.temp_tolerance,
            overrides.control?.upper_tolerance,
            '°C', 1
        );
        const lowerTol = withOverride(
            equip.lower_tolerance || control.lower_tolerance || equip.temp_tolerance || control.temp_tolerance,
            overrides.control?.lower_tolerance,
            '°C', 1
        );

        // Bathers values
        const bathersPerDay = withOverride(bathers.per_day, overrides.bathers?.per_day, '', 0);
        const activityFactor = withOverride(bathers.activity_factor, overrides.bathers?.activity_factor, '', 1);

        // Pool/environment values
        const windExp = withOverride(
            config.wind_exposure_factor,
            overrides.pool?.wind_exposure,
            '', 2
        );
        const solarAbs = withOverride(
            config.solar_absorption ? config.solar_absorption * 100 : null,
            overrides.solar?.absorption,
            '%', 1
        );

        const strategy = equip.control_strategy || config.control_strategy || 'reactive';
        const hasOverrides = Object.keys(overrides).length > 0;

        // Build config HTML with clear sections
        const configHtml = `
            <div style="grid-column:1/-1;border-bottom:1px solid #dee2e6;padding-bottom:8px;margin-bottom:8px;">
                <strong>Period:</strong> ${startDate} to ${endDate} (${days} days, ${hours.toLocaleString()} hours)
            </div>
            <div><strong>Pool:</strong> ${area} m², ${volume} m³, ${depth}m deep</div>
            <div><strong>Heat Pump:</strong> ${hpKw}, COP ${hpCop}</div>
            <div><strong>Boiler:</strong> ${boilerKw}, ${boilerEff} eff</div>
            <div><strong>Target:</strong> ${targetTemp}</div>
            <div><strong>Tolerance:</strong> +${upperTol} / -${lowerTol}</div>
            <div><strong>Strategy:</strong> ${strategy}</div>
            <div><strong>Bathers/day:</strong> ${bathersPerDay}</div>
            <div><strong>Activity:</strong> ${activityFactor}</div>
            <div><strong>Wind exp:</strong> ${windExp}</div>
            <div><strong>Solar abs:</strong> ${solarAbs}</div>
            <div><strong>Cover R:</strong> ${fmt(config.cover_r_value, ' m²K/W', 1)}</div>
            ${hasOverrides ? '<div style="grid-column:1/-1;margin-top:8px;padding-top:8px;border-top:1px solid #dee2e6;color:#0d6efd;font-size:12px;">✓ = Override value applied (from config overrides)</div>' : ''}
        `;
        // Helper to set both main and debug elements
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            const elDebug = document.getElementById(id + '-debug');
            if (el) el.textContent = value;
            if (elDebug) elDebug.textContent = value;
        };
        const setHtml = (id, html) => {
            const el = document.getElementById(id);
            const elDebug = document.getElementById(id + '-debug');
            if (el) el.innerHTML = html;
            if (elDebug) elDebug.innerHTML = html;
        };

        setHtml('bench-config-summary', configHtml);

        // Thermal losses (convert kWh to MWh)
        const toMWh = (val) => val ? (val / 1000).toFixed(1) : '-';

        setEl('bench-evap', toMWh(summary.evaporation_kwh) || '-');
        setEl('bench-conv', toMWh(summary.convection_kwh) || '-');
        setEl('bench-rad', toMWh(summary.radiation_kwh) || '-');
        setEl('bench-cover', toMWh(summary.cover_loss_kwh) || '-');
        setEl('bench-floor', toMWh(summary.floor_loss_kwh) || '-');
        setEl('bench-wall', toMWh(summary.wall_loss_kwh) || '-');
        setEl('bench-solar', summary.total_solar_gain_kwh ? '-' + toMWh(summary.total_solar_gain_kwh) : '-');
        setEl('bench-total-loss', toMWh(summary.total_heat_loss_kwh));

        // Heating delivered
        setEl('bench-hp-thermal', toMWh(summary.hp_thermal_kwh) || '-');
        setEl('bench-boiler-thermal', toMWh(summary.boiler_thermal_kwh) || '-');
        setEl('bench-total-delivered', toMWh((summary.hp_thermal_kwh || 0) + (summary.boiler_thermal_kwh || 0)));
        setEl('bench-unmet', toMWh(summary.unmet_kwh) || '-');

        // Electricity
        setEl('bench-hp-elec', toMWh(summary.total_hp_energy_kwh));
        setEl('bench-boiler-fuel', toMWh(summary.total_boiler_energy_kwh));
        setEl('bench-shower', toMWh(summary.shower_heating_kwh) || '-');
        setEl('bench-total-elec', toMWh((summary.total_hp_energy_kwh || 0) + (summary.total_boiler_energy_kwh || 0) + (summary.shower_heating_kwh || 0)));

        // Temperature
        setEl('bench-temp-min', summary.min_water_temp?.toFixed(2) || '-');
        setEl('bench-temp-avg', summary.avg_water_temp?.toFixed(2) || '-');
        setEl('bench-temp-max', summary.max_water_temp?.toFixed(2) || '-');
        setEl('bench-days-27', summary.days_below_27 || '0');
        setEl('bench-days-26', summary.days_below_26 || '0');
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
