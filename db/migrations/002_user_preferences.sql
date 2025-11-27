-- User preferences table for storing per-user settings
-- Syncs across devices (iPad, desktop, etc.)

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INT NOT NULL,
    pref_key VARCHAR(50) NOT NULL,
    pref_value VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, pref_key),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Common preference keys:
-- 'selected_config' - last selected config template ID
-- 'selected_ohc' - last selected schedule template ID (Open Hours Calendar)
