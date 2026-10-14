<?php
/**
 * Brute-force protection for login_api.php (table from migration 036).
 *
 * After MAX_PER_EMAIL failed logins for one email, or MAX_PER_IP from one IP
 * address, within WINDOW_MINUTES, further attempts are refused until the
 * window has passed. A successful login clears that email's failures.
 * If the table does not exist yet, the throttle stays out of the way.
 */
class LoginThrottle {
    const WINDOW_MINUTES = 15;
    const MAX_PER_EMAIL = 5;
    const MAX_PER_IP = 20;

    public static function isBlocked(PDO $pdo, $email, $ip) {
        try {
            $stmt = $pdo->prepare("
                SELECT
                    SUM(email = ?) AS by_email,
                    SUM(ip_address = ?) AS by_ip
                FROM login_attempts
                WHERE attempted_at > NOW() - INTERVAL " . (int) self::WINDOW_MINUTES . " MINUTE
                  AND (email = ? OR ip_address = ?)
            ");
            $stmt->execute([$email, $ip, $email, $ip]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return (int) ($row['by_email'] ?? 0) >= self::MAX_PER_EMAIL
                || (int) ($row['by_ip'] ?? 0) >= self::MAX_PER_IP;
        } catch (PDOException $e) {
            return false;
        }
    }

    public static function recordFailure(PDO $pdo, $email, $ip) {
        try {
            $pdo->prepare("INSERT INTO login_attempts (email, ip_address) VALUES (?, ?)")
                ->execute([$email, $ip]);
            // Keep the table small
            $pdo->exec("DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL 1 DAY");
        } catch (PDOException $e) {
            // table missing: no throttling until migration 036 is applied
        }
    }

    public static function clear(PDO $pdo, $email) {
        try {
            $pdo->prepare("DELETE FROM login_attempts WHERE email = ?")->execute([$email]);
        } catch (PDOException $e) {
        }
    }
}
