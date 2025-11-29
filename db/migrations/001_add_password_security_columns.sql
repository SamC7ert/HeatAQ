-- Migration: Add password security columns to users table
-- Version: 104
-- Date: 2024-11-29
-- Description: Adds force_password_change flag and password_history for security

-- Add force_password_change column (1 = must change password on next login)
-- Default to 1 so existing users or new users must change password
ALTER TABLE users
ADD COLUMN IF NOT EXISTS force_password_change TINYINT(1) NOT NULL DEFAULT 1
AFTER password_hash;

-- Add password_history column (JSON array of previous password hashes)
-- Used to prevent password reuse
ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_history JSON DEFAULT NULL
AFTER force_password_change;

-- Set existing users to NOT require password change (they already set their own passwords)
-- Only new users created by admin should be forced to change
UPDATE users SET force_password_change = 0 WHERE force_password_change = 1;

-- Add comment to table
ALTER TABLE users COMMENT = 'User accounts with password security features';
