// Configuration module - API settings and constants

const config = {
    // App version - update this when releasing new versions
    APP_VERSION: 'V85',

    API_BASE_URL: '/api/heataq_api.php',
    
    // Template descriptions
    templateDescriptions: {
        1: "Complex schedule with Norwegian holidays and seasonal variations",
        2: "Simple baseline: 10:00-20:00 every day, no holidays",
        3: "Algorithm test: 10:00-13:00 & 14:00-20:00 with lunch break"
    },
    
    // Default values
    defaults: {
        targetTemp: 28.0,
        minTemp: 27.0,
        maxTemp: 29.0,
        openHour: 10,
        closeHour: 20
    },
    
    // UI Settings
    ui: {
        loadingDelay: 300,
        saveDelay: 500,
        maxRetries: 3
    },
    
    // Feature flags
    features: {
        enableSave: true,
        enableDelete: true,
        enableValidation: true,
        showDebugInfo: false
    }
};

// Make config immutable
Object.freeze(config);
Object.freeze(config.templateDescriptions);
Object.freeze(config.defaults);
Object.freeze(config.ui);
Object.freeze(config.features);
