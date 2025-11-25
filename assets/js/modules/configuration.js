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
            wind_exposure: 0.535
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
            boiler_efficiency: 0.92,
            showers_use_hp: true
        },
        control: {
            target_temp: 28,
            temp_tolerance: 2,      // ±°C
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
        await this.loadConfigs();
    },

    // Load all configs from API
    loadConfigs: async function() {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_project_configs');
            const data = await response.json();

            if (data.configs) {
                this.configs = data.configs;
                this.renderConfigSelector();

                // Auto-select first config if available
                if (this.configs.length > 0 && !this.currentConfigId) {
                    this.currentConfigId = this.configs[0].template_id;
                    document.getElementById('config-selector').value = this.currentConfigId;
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
            this.loadDefaults();
        }
    },

    // Populate form from config object
    populateForm: function(config) {
        // Pool Physical
        if (config.pool) {
            this.setVal('cfg-pool-volume', config.pool.volume_m3);
            this.setVal('cfg-pool-area', config.pool.area_m2);
            this.setVal('cfg-pool-depth', config.pool.depth_m);
            this.setVal('cfg-wind-factor', config.pool.wind_exposure);
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

        // Equipment
        if (config.equipment) {
            this.setVal('cfg-hp-capacity', config.equipment.hp_capacity_kw);
            this.setVal('cfg-hp-cop', config.equipment.hp_cop);
            this.setVal('cfg-boiler-capacity', config.equipment.boiler_capacity_kw);
            this.setVal('cfg-boiler-eff', config.equipment.boiler_efficiency);
            this.setVal('cfg-showers-hp', config.equipment.showers_use_hp ? '1' : '0');
        }

        // Control Settings
        if (config.control) {
            this.setVal('cfg-target-temp', config.control.target_temp);
            this.setVal('cfg-temp-tolerance', config.control.temp_tolerance);
            this.setVal('cfg-strategy', config.control.strategy);
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

        const config = this.getConfig();

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_project_config',
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
        const tolerance = document.getElementById('cfg-temp-tolerance');

        if (targetTemp) {
            targetTemp.addEventListener('change', () => this.updateTempRange());
            targetTemp.addEventListener('input', () => this.updateTempRange());
        }
        if (tolerance) {
            tolerance.addEventListener('change', () => this.updateTempRange());
            tolerance.addEventListener('input', () => this.updateTempRange());
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

    // Update calculated temperature range display
    updateTempRange: function() {
        const target = parseFloat(this.getVal('cfg-target-temp')) || 28;
        const tolerance = parseFloat(this.getVal('cfg-temp-tolerance')) || 2;

        const minTemp = target - tolerance;
        const maxTemp = target + tolerance;

        const rangeEl = document.getElementById('cfg-temp-range');
        if (rangeEl) {
            rangeEl.textContent = `${minTemp} - ${maxTemp}°C`;
        }
    },

    // Update all calculated fields
    updateCalculatedFields: function() {
        this.updateTempRange();
    },

    // Get current configuration as object
    getConfig: function() {
        return {
            pool: {
                volume_m3: parseFloat(this.getVal('cfg-pool-volume')),
                area_m2: parseFloat(this.getVal('cfg-pool-area')),
                depth_m: parseFloat(this.getVal('cfg-pool-depth')),
                wind_exposure: parseFloat(this.getVal('cfg-wind-factor'))
            },
            cover: {
                has_cover: this.getVal('cfg-has-cover') === '1',
                u_value: parseFloat(this.getVal('cfg-cover-u')),
                solar_transmittance: parseFloat(this.getVal('cfg-cover-solar'))
            },
            solar: {
                absorption: parseFloat(this.getVal('cfg-solar-absorb'))
            },
            equipment: {
                hp_capacity_kw: parseFloat(this.getVal('cfg-hp-capacity')),
                hp_cop: parseFloat(this.getVal('cfg-hp-cop')),
                boiler_capacity_kw: parseFloat(this.getVal('cfg-boiler-capacity')),
                boiler_efficiency: parseFloat(this.getVal('cfg-boiler-eff')),
                showers_use_hp: this.getVal('cfg-showers-hp') === '1'
            },
            control: {
                target_temp: parseFloat(this.getVal('cfg-target-temp')),
                temp_tolerance: parseFloat(this.getVal('cfg-temp-tolerance')),
                strategy: this.getVal('cfg-strategy')
            },
            bathers: {
                per_day: parseInt(this.getVal('cfg-bathers')),
                refill_liters: parseInt(this.getVal('cfg-refill-liters')),
                shower_liters: parseInt(this.getVal('cfg-shower-liters')),
                activity_factor: parseFloat(this.getVal('cfg-activity-factor'))
            },
            water_temps: {
                cold_water: parseInt(this.getVal('cfg-cold-water-temp')),
                shower_target: parseInt(this.getVal('cfg-shower-target-temp')),
                hot_water_tank: parseInt(this.getVal('cfg-hot-water-temp')),
                hp_max_dhw: parseInt(this.getVal('cfg-hp-max-dhw-temp'))
            },
            costs: {
                electricity_nok_kwh: parseFloat(this.getVal('cfg-elec-cost')),
                gas_nok_kwh: parseFloat(this.getVal('cfg-gas-cost'))
            }
        };
    },

    // Save configuration to server
    save: async function() {
        if (!this.currentConfigId) {
            alert('Please select a configuration or create a new one first');
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
            const response = await fetch(`./api/heataq_api.php?action=delete_project_config&config_id=${this.currentConfigId}`);
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
