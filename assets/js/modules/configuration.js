// Configuration module - Handles project configuration loading and saving

const ConfigurationModule = {

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
        this.loadDefaults();
        this.setupEventListeners();
        this.updateCalculatedFields();
    },

    // Load default values into form fields
    loadDefaults: function() {
        const d = this.defaults;

        // Pool Physical
        this.setVal('cfg-pool-volume', d.pool.volume_m3);
        this.setVal('cfg-pool-area', d.pool.area_m2);
        this.setVal('cfg-pool-depth', d.pool.depth_m);
        this.setVal('cfg-wind-factor', d.pool.wind_exposure);

        // Cover & Environment
        this.setVal('cfg-has-cover', d.cover.has_cover ? '1' : '0');
        this.setVal('cfg-cover-u', d.cover.u_value);
        this.setVal('cfg-cover-solar', d.cover.solar_transmittance);
        this.setVal('cfg-solar-absorb', d.solar.absorption);

        // Equipment
        this.setVal('cfg-hp-capacity', d.equipment.hp_capacity_kw);
        this.setVal('cfg-hp-cop', d.equipment.hp_cop);
        this.setVal('cfg-boiler-capacity', d.equipment.boiler_capacity_kw);
        this.setVal('cfg-boiler-eff', d.equipment.boiler_efficiency);
        this.setVal('cfg-showers-hp', d.equipment.showers_use_hp ? '1' : '0');

        // Control Settings
        this.setVal('cfg-target-temp', d.control.target_temp);
        this.setVal('cfg-temp-tolerance', d.control.temp_tolerance);
        this.setVal('cfg-strategy', d.control.strategy);

        // Bather Load
        this.setVal('cfg-bathers', d.bathers.per_day);
        this.setVal('cfg-refill-liters', d.bathers.refill_liters);
        this.setVal('cfg-shower-liters', d.bathers.shower_liters);
        this.setVal('cfg-activity-factor', d.bathers.activity_factor);

        // Water Temperatures
        this.setVal('cfg-cold-water-temp', d.water_temps.cold_water);
        this.setVal('cfg-shower-target-temp', d.water_temps.shower_target);
        this.setVal('cfg-hot-water-temp', d.water_temps.hot_water_tank);
        this.setVal('cfg-hp-max-dhw-temp', d.water_temps.hp_max_dhw);

        // Energy Costs
        this.setVal('cfg-elec-cost', d.costs.electricity_nok_kwh);
        this.setVal('cfg-gas-cost', d.costs.gas_nok_kwh);

        // Update visibility
        this.toggleCover();
    },

    // Helper to set form field value
    setVal: function(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
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

    // Load configuration from server (future)
    load: function() {
        // For now, just initialize with defaults
        this.init();

        // TODO: Load from API
        // fetch('/api/config.php?action=get&site_id=...')
        //     .then(response => response.json())
        //     .then(data => this.populateForm(data))
        //     .catch(err => console.error('Failed to load config:', err));
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
        const config = this.getConfig();
        console.log('Saving configuration:', config);

        // TODO: Save to API
        // try {
        //     const response = await fetch('/api/config.php', {
        //         method: 'POST',
        //         headers: { 'Content-Type': 'application/json' },
        //         body: JSON.stringify({ action: 'save', config: config })
        //     });
        //     const result = await response.json();
        //     if (result.success) {
        //         alert('Configuration saved successfully');
        //     } else {
        //         alert('Failed to save: ' + result.error);
        //     }
        // } catch (err) {
        //     console.error('Save failed:', err);
        //     alert('Failed to save configuration');
        // }

        alert('Configuration saved (local only - API not yet implemented)');
    }
};

// Export for use in app
window.ConfigurationModule = ConfigurationModule;

// Also add to app namespace when available
if (typeof app !== 'undefined') {
    app.configuration = ConfigurationModule;
}
