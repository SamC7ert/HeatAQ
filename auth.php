<?php
/**
 * HeatAQ Authentication Layer
 * Session and permission management
 */

require_once __DIR__ . '/config.php';

class HeatAQAuth {
    /**
     * Check if user is authenticated
     * Returns user context or false
     */
    public static function check() {
        // If auth is not required, create default context
        if (!Config::requiresAuth()) {
            return self::getDefaultContext();
        }

        $sessionId = self::getSessionId();

        if (!$sessionId) {
            return false;
        }

        try {
            $pdo = Config::getDatabase();

            $stmt = $pdo->prepare("
                SELECT
                    s.session_id,
                    s.user_id,
                    s.project_id,
                    u.name as user_name,
                    u.email,
                    p.name as project_name,
                    p.site_id,
                    up.role
                FROM user_sessions s
                JOIN users u ON s.user_id = u.user_id
                JOIN projects p ON s.project_id = p.project_id
                JOIN user_projects up ON u.user_id = up.user_id AND p.project_id = up.project_id
                WHERE s.session_id = :session_id
                  AND s.expires_at > NOW()
                  AND u.is_active = 1
                LIMIT 1
            ");

            $stmt->execute(['session_id' => $sessionId]);
            $session = $stmt->fetch();

            if (!$session) {
                return false;
            }

            return $session;

        } catch (Exception $e) {
            error_log("Auth check failed: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Get session ID from various sources
     */
    private static function getSessionId() {
        // Try Authorization header
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            if (preg_match('/Bearer\s+(.*)$/i', $_SERVER['HTTP_AUTHORIZATION'], $matches)) {
                return $matches[1];
            }
        }

        // Try X-Session-ID header
        if (isset($_SERVER['HTTP_X_SESSION_ID'])) {
            return $_SERVER['HTTP_X_SESSION_ID'];
        }

        // Try request parameter
        if (isset($_REQUEST['session_id'])) {
            return $_REQUEST['session_id'];
        }

        // Try PHP session
        if (isset($_SESSION['session_id'])) {
            return $_SESSION['session_id'];
        }

        return null;
    }

    /**
     * Get default context when auth is disabled
     */
    private static function getDefaultContext() {
        try {
            $pdo = Config::getDatabase();

            // Get first site
            $stmt = $pdo->query("
                SELECT
                    ps.site_id,
                    ps.site_name,
                    p.project_id,
                    p.name as project_name
                FROM pool_sites ps
                LEFT JOIN projects p ON ps.site_id = p.site_id
                LIMIT 1
            ");

            $site = $stmt->fetch();

            return [
                'session_id' => 'no-auth',
                'user_id' => null,
                'user_name' => 'Guest',
                'email' => null,
                'project_id' => $site['project_id'] ?? null,
                'project_name' => $site['project_name'] ?? 'Default Project',
                'site_id' => $site['site_id'] ?? null,
                'role' => 'admin' // Full access when auth disabled
            ];

        } catch (Exception $e) {
            error_log("Failed to get default context: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if user has specific role
     */
    public static function hasRole($context, $requiredRole) {
        if (!$context) {
            return false;
        }

        $roles = ['viewer', 'operator', 'admin', 'owner'];
        $userLevel = array_search($context['role'], $roles);
        $requiredLevel = array_search($requiredRole, $roles);

        return $userLevel !== false && $userLevel >= $requiredLevel;
    }

    /**
     * Log user action
     */
    public static function audit($context, $action, $entityType, $entityId, $details = null) {
        if (!$context || !isset($context['user_id'])) {
            return;
        }

        try {
            $pdo = Config::getDatabase();

            $stmt = $pdo->prepare("
                INSERT INTO audit_log (
                    user_id, action, entity_type, entity_id,
                    details, ip_address, created_at
                ) VALUES (
                    :user_id, :action, :entity_type, :entity_id,
                    :details, :ip_address, NOW()
                )
            ");

            $stmt->execute([
                'user_id' => $context['user_id'],
                'action' => $action,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'details' => $details ? json_encode($details) : null,
                'ip_address' => $_SERVER['REMOTE_ADDR'] ?? null
            ]);

        } catch (Exception $e) {
            error_log("Audit log failed: " . $e->getMessage());
        }
    }
}
