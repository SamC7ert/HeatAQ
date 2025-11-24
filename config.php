<?php
/**
 * HeatAQ Configuration Loader
 * Secure configuration management from environment file
 */

class Config {
    private static $config = null;
    private static $configPath = '../config_heataq/database.env';

    /**
     * Load configuration from .env file
     */
    private static function load() {
        if (self::$config !== null) {
            return;
        }

        $fullPath = __DIR__ . '/' . self::$configPath;

        if (!file_exists($fullPath)) {
            throw new Exception("Configuration file not found: {$fullPath}");
        }

        self::$config = parse_ini_file($fullPath, true);

        if (self::$config === false) {
            throw new Exception("Failed to parse configuration file");
        }
    }

    /**
     * Get configuration value
     */
    public static function get($key, $section = 'database', $default = null) {
        self::load();

        if (isset(self::$config[$section][$key])) {
            return self::$config[$section][$key];
        }

        return $default;
    }

    /**
     * Get database connection
     */
    public static function getDatabase() {
        self::load();

        $host = self::get('DB_HOST');
        $dbname = self::get('DB_NAME');
        $user = self::get('DB_USER');
        $pass = self::get('DB_PASS');
        $charset = self::get('DB_CHARSET', 'database', 'utf8mb4');

        $dsn = "mysql:host={$host};dbname={$dbname};charset={$charset}";

        try {
            $pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]);
            return $pdo;
        } catch (PDOException $e) {
            if (self::get('APP_DEBUG', 'app', false)) {
                throw $e;
            } else {
                throw new Exception('Database connection failed');
            }
        }
    }

    /**
     * Check if authentication is required
     */
    public static function requiresAuth() {
        return self::get('REQUIRE_AUTH', 'app', 'true') === 'true';
    }

    /**
     * Check if debug mode is enabled
     */
    public static function isDebug() {
        return self::get('APP_DEBUG', 'app', 'false') === 'true';
    }
}
