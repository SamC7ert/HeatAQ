/**
 * HeatAQ Configuration
 * Global settings and constants
 */

const CONFIG = {
    // API Configuration
    API_BASE_URL: 'api/heataq_api.php',
    LOGIN_API_URL: 'login_api.php',

    // Feature Flags
    enableSimulation: false,
    enableReports: false,
    debugMode: false,

    // Default Values
    DEFAULT_TARGET_TEMP: 28,
    DEFAULT_MIN_TEMP: 27,
    DEFAULT_MAX_TEMP: 29,

    // System Constants
    SESSION_CHECK_INTERVAL: 300000, // 5 minutes

    // Temperature Ranges
    TEMP_MIN: 15,
    TEMP_MAX: 35,

    // Time Format
    TIME_FORMAT: '24h',

    // UI Settings
    TOAST_DURATION: 3000,
    ANIMATION_DURATION: 300
};

// Freeze config to prevent accidental modifications
Object.freeze(CONFIG);
