// Configuration module - Handles project configuration loading and saving

const ConfigurationModule = {

    // Current selected config
    currentConfigId: null,
    configs: [],

    // Default configuration values (matching Python benchmark)
    defaults: {
        pool: {
            volume_m3: 625,
            area_m2: 312.5,
            depth_m: 2.0,
            wind_exposure: 0.5,
            years_operating: 3      // Years since startup (affects ground thermal)
        },
        cover: {
            has_cover: true,
            u_value: 5.0,           // W/m²K
            solar_transmittance: 10 // %
        },
        solar: {
            absorption: 60          // %
        },
        equipment: {
            hp_capacity_kw: 125,
            hp_cop: 4.6,
            boiler_capacity_kw: 200,
            boiler_efficiency: 0.99,
            boiler_type: 'electric',
            showers_use_hp: true
        },
        control: {
            target_temp: 28,
            upper_tolerance: 1,     // °C above target
            strategy: 'predictive'  // reactive, predictive, cost_optimizing
        },
        bathers: {
            per_day: 100,
            refill_liters: 30,
            shower_liters: 60,
            activity_factor: 1.1
        },
        water_temps: {
            cold_water: 5,          // °C - mains water
            shower_target: 40,      // °C - mixed shower output
            hot_water_tank: 60,     // °C - if separate heater
            hp_max_dhw: 35          // °C - HP can only heat DHW to this
        },
        costs: {
            electricity_nok_kwh: 1.20,
            gas_nok_kwh: 0.80
        }
    },

    // Initialize configuration page
    init: function() {
        this.setupEventListeners();
        this.updateCalculatedFields();
    },

    // Load configuration page
    load: async function() {
        this.init();
        await this.loadWeatherStations();
        await this.loadConfigs();
    },

    // Load weather stations for dropdown
    loadWeatherStations: async function() {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_weather_stations');
            const data = await response.json();
            const select = document.getElementById('cfg-weather-station');
            if (select && data.stations) {
                select.innerHTML = '<option value="">-- Select Station --</option>';
                data.stations.forEach(station => {
                    const option = document.createElement('option');
                    option.value = station.station_id;
                    option.textContent = station.name;
                    select.appendChild(option);
                });
            }
        } catch (err) {
            console.error('Failed to load weather stations:', err);
        }
    },

    // Load all configs from API
    loadConfigs: async function() {
        try {
            // Get current project ID and pass explicitly to ensure correct filtering
            const projectId = localStorage.getItem('heataq_project') || '';
            console.log('[Config] Loading configs for project_id:', projectId);
            const response = await fetch(`./api/heataq_api.php?action=get_project_configs&project_id=${projectId}`);
            const data = await response.json();
            console.log('[Config] API response:', data);

            if (data.configs) {
                this.configs = data.configs;
                this.renderConfigSelector();

                if (this.configs.length > 0) {
                    // Auto-select first config if none selected
                    if (!this.currentConfigId) {
                        this.currentConfigId = this.configs[0].template_id;
                    }
                    document.getElementById('config-selector').value = this.currentConfigId;
                    // Always reload selected config to reflect latest saved values
                    this.loadSelected();
                } else {
                    this.loadDefaults();
                }
            }
        } catch (err) {
            console.error('Failed to load configs:', err);
            this.loadDefaults();
        }
    },

    // Render config selector dropdown
    renderConfigSelector: function() {
        const select = document.getElementById('config-selector');
        if (!select) return;

        select.innerHTML = '<option value="">-- Select Configuration --</option>';
        this.configs.forEach(config => {
            const option = document.createElement('option');
            option.value = config.template_id;
            option.textContent = config.name;
            select.appendChild(option);
        });
    },

    // Load selected configuration
    loadSelected: function() {
        const select = document.getElementById('config-selector');
        const configId = select ? select.value : null;

        if (!configId) {
            this.currentConfigId = null;
            this.loadDefaults();
            return;
        }

        const config = this.configs.find(c => c.template_id == configId);
        if (config && config.config) {
            this.currentConfigId = configId;
            this.populateForm(config.config);
        } else {
            // Config exists but has no json_config - load defaults for this config
            this.currentConfigId = configId;
            this.loadDefaults();
        }
    },

    // Populate form from config object
    // Editor fields: [id, label, required]. Cleared before a config is shown,
    // so a field the config lacks shows blank instead of the previous
    // config's value, and checked before saving.
    FIELDS: [
        ['cfg-hp-capacity', 'Heat pump capacity', true],
        ['cfg-hp-cop', 'Heat pump COP', true],
        ['cfg-boiler-capacity', 'Boiler capacity', true],
        ['cfg-boiler-type', 'Boiler type', false],
        ['cfg-boiler-eff', 'Boiler efficiency', true],
        ['cfg-showers-hp', 'Showers use HP', false],
        ['cfg-target-temp', 'Default temp', true],
        ['cfg-upper-tolerance', 'Max overheat', true],
        ['cfg-strategy', 'Strategy', false],
        ['cfg-standby-temp', 'Min temp when closed', false],
        ['cfg-bathers', 'Bathers per day', true],
        ['cfg-refill-liters', 'Refill litres', true],
        ['cfg-shower-liters', 'Shower litres', true],
        ['cfg-activity-factor', 'Activity factor', true],
        ['cfg-cold-water-temp', 'Cold water temperature', true],
        ['cfg-shower-target-temp', 'Shower temperature', true],
        ['cfg-hot-water-temp', 'Hot water tank temperature', true],
        ['cfg-hp-max-dhw-temp', 'HP max DHW temperature', true],
        ['cfg-elec-cost', 'Electricity price', true],
        ['cfg-gas-cost', 'Gas/oil price', true]
    ],

    clearForm: function() {
        this.FIELDS.forEach(([id]) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.tagName === 'SELECT') el.selectedIndex = 0;
            else el.value = '';
        });
    },

    // Number from a field: decimal comma accepted, blank/text -> null
    numVal: function(id) {
        const raw = (this.getVal(id) ?? '').trim().replace(',', '.');
        if (raw === '') return null;
        const v = Number(raw);
        return Number.isFinite(v) ? v : null;
    },

    // Labels of required fields that are blank or not a number. The boiler
    // type must be chosen when there is a boiler; the fuel price is needed
    // only for a fossil-fuel boiler.
    invalidFields: function() {
        const boilerType = this.getVal('cfg-boiler-type');
        const hasBoiler = (this.numVal('cfg-boiler-capacity') || 0) > 0;
        const invalid = this.FIELDS
            .filter(([id, , required]) => required && document.getElementById(id) && this.numVal(id) === null)
            .filter(([id]) => id !== 'cfg-gas-cost' || boilerType === 'fuel')
            .map(([, label]) => label);
        if (hasBoiler && !boilerType) invalid.unshift('Boiler type (electric or fossil fuel)');
        return invalid;
    },

    // Show the fuel price only for a fossil-fuel boiler, and a typical
    // efficiency for the chosen type
    toggleBoilerType: function() {
        const type = this.getVal('cfg-boiler-type');
        const row = document.getElementById('cfg-gas-cost-row');
        if (row) row.style.display = type === 'electric' ? 'none' : '';
        const hint = document.getElementById('cfg-boiler-eff-hint');
        if (hint) {
            hint.textContent = type === 'electric' ? '0-1, electric ≈ 0.99 (input is electricity)'
                : type === 'fuel' ? '0-1, gas ≈ 0.92, oil ≈ 0.85-0.90'
                : '0-1, e.g. 0.92';
        }
    },

    populateForm: function(config) {
        this.clearForm();

        // Pool Physical
        if (config.pool) {
            this.setVal('cfg-pool-volume', config.pool.volume_m3);
            this.setVal('cfg-pool-area', config.pool.area_m2);
            this.setVal('cfg-pool-depth', config.pool.depth_m);
            this.setVal('cfg-wind-factor', config.pool.wind_exposure);
            this.setVal('cfg-years-operating', config.pool.years_operating || 3);
        }

        // Cover & Environment
        if (config.cover) {
            this.setVal('cfg-has-cover', config.cover.has_cover ? '1' : '0');
            this.setVal('cfg-cover-u', config.cover.u_value);
            this.setVal('cfg-cover-solar', config.cover.solar_transmittance);
        }
        if (config.solar) {
            this.setVal('cfg-solar-absorb', config.solar.absorption);
        }

        // Weather Station
        if (config.weather_station_id) {
            this.setVal('cfg-weather-station', config.weather_station_id);
        }

        // Equipment
        if (config.equipment) {
            this.setVal('cfg-hp-capacity', config.equipment.hp_capacity_kw);
            this.setVal('cfg-hp-cop', config.equipment.hp_cop);
            this.setVal('cfg-boiler-capacity', config.equipment.boiler_capacity_kw);
            this.setVal('cfg-boiler-eff', config.equipment.boiler_efficiency);
            this.setVal('cfg-boiler-type', config.equipment.boiler_type ?? '');
            this.setVal('cfg-showers-hp', config.equipment.showers_use_hp ? '1' : '0');
        }

        // Control Settings
        if (config.control) {
            this.setVal('cfg-target-temp', config.control.target_temp);
            // Handle both old single tolerance and new upper/lower tolerances
            if (config.control.upper_tolerance !== undefined) {
                this.setVal('cfg-upper-tolerance', config.control.upper_tolerance);
            } else if (config.control.temp_tolerance !== undefined) {
                this.setVal('cfg-upper-tolerance', config.control.temp_tolerance);
            }
            this.setVal('cfg-strategy', config.control.strategy);
            this.setVal('cfg-standby-temp', config.control.standby_temp ?? '');
        }

        // Bather Load
        if (config.bathers) {
            this.setVal('cfg-bathers', config.bathers.per_day);
            this.setVal('cfg-refill-liters', config.bathers.refill_liters);
            this.setVal('cfg-shower-liters', config.bathers.shower_liters);
            this.setVal('cfg-activity-factor', config.bathers.activity_factor);
        }

        // Water Temperatures
        if (config.water_temps) {
            this.setVal('cfg-cold-water-temp', config.water_temps.cold_water);
            this.setVal('cfg-shower-target-temp', config.water_temps.shower_target);
            this.setVal('cfg-hot-water-temp', config.water_temps.hot_water_tank);
            this.setVal('cfg-hp-max-dhw-temp', config.water_temps.hp_max_dhw);
        }

        // Energy Costs
        if (config.costs) {
            this.setVal('cfg-elec-cost', config.costs.electricity_nok_kwh);
            this.setVal('cfg-gas-cost', config.costs.gas_nok_kwh);
        }

        // Update visibility and calculated fields
        this.toggleBoilerType();
        this.toggleCover();
        this.updateCalculatedFields();
    },

    // Load default values into form fields
    loadDefaults: function() {
        this.populateForm(this.defaults);
    },

    // Toggle new config form
    toggleNewForm: function() {
        const form = document.getElementById('new-config-form');
        if (form) {
            form.style.display = form.style.display === 'none' ? '' : 'none';
        }
    },

    // Create new configuration
    createNew: async function() {
        const name = document.getElementById('new-config-name')?.value?.trim();
        const description = document.getElementById('new-config-description')?.value?.trim() || '';

        if (!name) {
            alert('Please enter a name');
            return;
        }

        const invalid = this.invalidFields();
        if (invalid.length) {
            alert('Please fill in: ' + invalid.join(', '));
            return;
        }
        const config = this.getConfig();

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_project_config',
                    project_id: localStorage.getItem('heataq_project'),
                    name: name,
                    description: description,
                    config: config
                })
            });
            const result = await response.json();

            if (result.success) {
                this.currentConfigId = result.config_id;
                this.toggleNewForm();
                document.getElementById('new-config-name').value = '';
                document.getElementById('new-config-description').value = '';
                await this.loadConfigs();
                document.getElementById('config-selector').value = this.currentConfigId;
                alert('Configuration created successfully');
            } else {
                alert('Failed to create: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Failed to create config:', err);
            alert('Failed to create configuration');
        }
    },

    // Helper to set form field value
    setVal: function(id, value) {
        const el = document.getElementById(id);
        if (el && value !== undefined && value !== null) el.value = value;
    },

    // Helper to get form field value
    getVal: function(id) {
        const el = document.getElementById(id);
        return el ? el.value : null;
    },

    // Setup event listeners for dynamic updates
    setupEventListeners: function() {
        // Temperature range updates
        const targetTemp = document.getElementById('cfg-target-temp');
        const upperTol = document.getElementById('cfg-upper-tolerance');

        if (targetTemp) {
            targetTemp.addEventListener('change', () => this.updateTempRange());
            targetTemp.addEventListener('input', () => this.updateTempRange());
        }
        if (upperTol) {
            upperTol.addEventListener('change', () => this.updateTempRange());
            upperTol.addEventListener('input', () => this.updateTempRange());
        }
    },

    // Toggle cover-related fields visibility
    toggleCover: function() {
        const hasCover = this.getVal('cfg-has-cover') === '1';
        const uRow = document.getElementById('cover-u-row');
        const solarRow = document.getElementById('cover-solar-row');

        if (uRow) uRow.style.display = hasCover ? '' : 'none';
        if (solarRow) solarRow.style.display = hasCover ? '' : 'none';
    },

    // Update the calculated max temperature (default temp + max overheat)
    updateTempRange: function() {
        const targetStr = this.getVal('cfg-target-temp');
        const target = parseFloat(targetStr);
        const upperTol = parseFloat(this.getVal('cfg-upper-tolerance')) || 1;
        const rangeEl = document.getElementById('cfg-temp-range');
        if (!rangeEl) return;

        // Don't silently default - show warning if target not set
        if (!targetStr || isNaN(target)) {
            rangeEl.textContent = '-- °C (default temp required)';
            rangeEl.style.color = 'red';
            return;
        }
        rangeEl.textContent = `${target + upperTol} °C`;
        rangeEl.style.color = '';
    },

    // Update all calculated fields
    updateCalculatedFields: function() {
        this.updateTempRange();
    },

    // Get current configuration as object
    // Only the sections the editor has fields for (pool, cover and solar
    // live on the pool/site since migration 024).
    getConfig: function() {
        const n = (id) => this.numVal(id);
        return {
            equipment: {
                hp_capacity_kw: n('cfg-hp-capacity'),
                hp_cop: n('cfg-hp-cop'),
                boiler_capacity_kw: n('cfg-boiler-capacity'),
                boiler_efficiency: n('cfg-boiler-eff'),
                boiler_type: this.getVal('cfg-boiler-type') || null,
                showers_use_hp: this.getVal('cfg-showers-hp') === '1'
            },
            control: {
                target_temp: n('cfg-target-temp'),
                upper_tolerance: n('cfg-upper-tolerance'),
                strategy: this.getVal('cfg-strategy'),
                // Min temp when closed; blank = no minimum (null)
                standby_temp: n('cfg-standby-temp')
            },
            bathers: {
                per_day: n('cfg-bathers'),
                refill_liters: n('cfg-refill-liters'),
                shower_liters: n('cfg-shower-liters'),
                activity_factor: n('cfg-activity-factor')
            },
            water_temps: {
                cold_water: n('cfg-cold-water-temp'),
                shower_target: n('cfg-shower-target-temp'),
                hot_water_tank: n('cfg-hot-water-temp'),
                hp_max_dhw: n('cfg-hp-max-dhw-temp')
            },
            costs: {
                electricity_nok_kwh: n('cfg-elec-cost'),
                gas_nok_kwh: n('cfg-gas-cost')
            }
        };
    },

    // Save configuration to server
    save: async function() {
        if (!this.currentConfigId) {
            alert('Please select a configuration or create a new one first');
            return;
        }

        const invalid = this.invalidFields();
        if (invalid.length) {
            alert('Please fill in: ' + invalid.join(', '));
            return;
        }
        const config = this.getConfig();
        const currentConfig = this.configs.find(c => c.template_id == this.currentConfigId);

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_project_config',
                    project_id: localStorage.getItem('heataq_project'),
                    config_id: this.currentConfigId,
                    name: currentConfig?.name || 'Configuration',
                    description: currentConfig?.description || '',
                    config: config
                })
            });
            const result = await response.json();

            if (result.success) {
                await this.loadConfigs();
                document.getElementById('config-selector').value = this.currentConfigId;
                alert('Configuration saved successfully');
            } else {
                alert('Failed to save: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Save failed:', err);
            alert('Failed to save configuration');
        }
    },

    // Delete configuration
    deleteConfig: async function() {
        if (!this.currentConfigId) {
            alert('Please select a configuration to delete');
            return;
        }

        if (!confirm('Are you sure you want to delete this configuration?')) {
            return;
        }

        try {
            const response = await fetch(`./api/heataq_api.php?action=delete_project_config&config_id=${encodeURIComponent(this.currentConfigId)}`, { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                this.currentConfigId = null;
                await this.loadConfigs();
                alert('Configuration deleted');
            } else {
                alert('Failed to delete: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Delete failed:', err);
            alert('Failed to delete configuration');
        }
    }
};

// Export for use in app
window.ConfigurationModule = ConfigurationModule;

// Also add to app namespace when available
if (typeof app !== 'undefined') {
    app.configuration = ConfigurationModule;
}
