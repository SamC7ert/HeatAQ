-- 036: Failed-login log for brute-force protection
-- Description: lib/LoginThrottle.php records each failed login here and
-- refuses further attempts for 15 minutes after 5 failures for one email or
-- 20 from one IP address. Successful logins clear the email's failures.

CREATE TABLE IF NOT EXISTS login_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_attempts_email (email, attempted_at),
    INDEX idx_login_attempts_ip (ip_address, attempted_at)
);
