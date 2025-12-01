-- Migration 020: Add project_id to user_preferences for per-project preferences
-- This allows users to have different settings for each project they access

-- 1. Add project_id column (nullable first for existing data)
ALTER TABLE user_preferences ADD COLUMN project_id INT NULL AFTER user_id;

-- 2. Set existing preferences to project_id = 1 (default project)
UPDATE user_preferences SET project_id = 1 WHERE project_id IS NULL;

-- 3. Make project_id NOT NULL
ALTER TABLE user_preferences MODIFY COLUMN project_id INT NOT NULL;

-- 4. Drop old primary key and create new one including project_id
ALTER TABLE user_preferences DROP PRIMARY KEY;
ALTER TABLE user_preferences ADD PRIMARY KEY (user_id, project_id, pref_key);

-- 5. Add foreign key to projects table (if it exists)
-- ALTER TABLE user_preferences ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- 6. Extend pref_value to allow longer JSON values (for case_config etc)
ALTER TABLE user_preferences MODIFY COLUMN pref_value TEXT;

-- 7. Add index for faster lookups
CREATE INDEX idx_user_project ON user_preferences (user_id, project_id);
