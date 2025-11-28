-- Password Reset Table
-- Migration: 006_password_reset.sql
-- Date: 2024-11-28
-- Description: Adds password reset functionality with rate limiting

-- ============================================
-- PASSWORD RESET TOKENS TABLE
-- Stores password reset requests with expiry
-- ============================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(64) NOT NULL,           -- SHA256 hash of the actual token
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,                -- Set when token is used
    ip_address VARCHAR(45),               -- IPv4 or IPv6

    -- Indexes
    UNIQUE INDEX idx_token (token),
    INDEX idx_user_id (user_id),
    INDEX idx_expires (expires_at),

    -- Foreign key
    CONSTRAINT fk_reset_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- PASSWORD RESET RATE LIMITING TABLE
-- Tracks reset attempts for rate limiting
-- ============================================
CREATE TABLE IF NOT EXISTS password_reset_attempts (
    attempt_id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Indexes for efficient lookups
    INDEX idx_email_time (email, attempted_at),
    INDEX idx_ip_time (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- CLEANUP OLD TOKENS (Run periodically)
-- ============================================
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL;
-- DELETE FROM password_reset_attempts WHERE attempted_at < DATE_SUB(NOW(), INTERVAL 1 DAY);
