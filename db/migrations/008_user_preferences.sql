-- User Preferences Migration
-- Migration: 008_user_preferences.sql
-- Description: Stores user preferences to persist across devices

-- ============================================
-- USER PREFERENCES TABLE
-- Key-value store for user preferences
-- ============================================
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INT NOT NULL,
    pref_key VARCHAR(50) NOT NULL,
    pref_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, pref_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SUPPORTED KEYS:
-- - selected_config: config template ID
-- - selected_ohc: OHC schedule template ID
-- - selected_site: site_id string
-- - selected_pool: pool_id integer
-- - selected_tab: last active main tab
-- - sim_sub_tab: last active simulate sub-tab
-- - sim_overrides: JSON of override values
-- - last_scenario_name: last used scenario name
-- ============================================
