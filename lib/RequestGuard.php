<?php
/**
 * Shared request checks for the API entry points (heataq_api, simulation_api,
 * frost_api, clear_cache).
 *
 * In development mode (Config::requiresAuth() false) every check passes, as
 * the rest of the API already behaves.
 */
class RequestGuard {
    const ROLE_RANK = ['viewer' => 1, 'operator' => 2, 'admin' => 3, 'owner' => 4];

    /**
     * Authenticate the request (auth mode) and return the auth context,
     * or null in development mode. Exits with 401 when not logged in.
     */
    public static function authenticate() {
        if (!Config::requiresAuth()) {
            return null;
        }
        if (!class_exists('HeatAQAuth')) {
            require_once __DIR__ . '/../auth.php';
        }
        return HeatAQAuth::check(true);
    }

    /** Role of the authenticated user ('viewer' when unknown). */
    public static function role($auth) {
        return $auth['user']['role'] ?? 'viewer';
    }

    /** True when the user's role is at least $minRole. Always true in dev mode. */
    public static function hasRole($auth, $minRole) {
        if (!Config::requiresAuth()) {
            return true;
        }
        $have = self::ROLE_RANK[self::role($auth)] ?? 0;
        return $have >= (self::ROLE_RANK[$minRole] ?? PHP_INT_MAX);
    }

    /** Exit with 403 unless the user's role is at least $minRole. */
    public static function requireRole($auth, $minRole) {
        if (!self::hasRole($auth, $minRole)) {
            self::deny(403, 'Permission denied');
        }
    }

    /**
     * A request that changes data must be a POST/DELETE sent by the app itself:
     * - not GET, so links, images and redirects cannot trigger it;
     * - carrying the X-Session-ID header the app adds to every API call. A form
     *   or link on another site cannot add a custom header, and a cross-site
     *   script cannot send one with the user's cookies (the CORS preflight
     *   fails), so this blocks cross-site request forgery;
     * - when the browser sends an Origin header, it must be this site.
     */
    public static function requireWriteRequest() {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if (!in_array($method, ['POST', 'DELETE'], true)) {
            self::deny(405, 'This action must be sent as POST');
        }
        if (!Config::requiresAuth()) {
            return;
        }
        if (empty($_SERVER['HTTP_X_SESSION_ID'])) {
            self::deny(403, 'Request rejected: missing session header');
        }
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && $origin !== 'null') {
            $originHost = parse_url($origin, PHP_URL_HOST);
            $host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
            if (!$originHost || strcasecmp($originHost, $host) !== 0) {
                self::deny(403, 'Request rejected: cross-site request');
            }
        }
    }

    /**
     * session_start() with safe cookie settings: not readable by scripts
     * (HttpOnly), HTTPS-only when the site is on HTTPS, not sent on cross-site
     * POSTs (SameSite=Lax), and strict mode (unknown session ids rejected).
     * Used by auth.php and login_api.php (see the .example files).
     */
    public static function startSession() {
        if (session_status() !== PHP_SESSION_NONE) {
            return;
        }
        ini_set('session.use_strict_mode', '1');
        session_set_cookie_params([
            'path' => '/',
            'httponly' => true,
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'samesite' => 'Lax',
        ]);
        session_start();
    }

    /** First line of an error message without file paths, for responses. */
    public static function publicMessage($message) {
        $line = strtok((string) $message, "\n");
        return trim(preg_replace('#\s+in\s+/\S+(:\d+)?#', '', $line));
    }

    private static function deny($code, $message) {
        if (!headers_sent()) {
            http_response_code($code);
            header('Content-Type: application/json');
        }
        echo json_encode(['error' => $message]);
        exit;
    }
}
