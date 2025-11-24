<?php
/**
 * HeatAQ Login API
 * Handles user authentication and project selection
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

require_once __DIR__ . '/config.php';

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

try {
    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input) {
        throw new Exception('Invalid JSON input');
    }

    $action = $input['action'] ?? '';

    switch ($action) {
        case 'login':
            handleLogin($input);
            break;

        case 'select_project':
            handleProjectSelection($input);
            break;

        case 'logout':
            handleLogout($input);
            break;

        default:
            throw new Exception('Invalid action');
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'error' => $e->getMessage(),
        'debug' => Config::isDebug() ? $e->getTraceAsString() : null
    ]);
}

/**
 * Step 1: Verify credentials and return available projects
 */
function handleLogin($input) {
    if (!isset($input['email']) || !isset($input['password'])) {
        throw new Exception('Email and password required');
    }

    $pdo = Config::getDatabase();

    // Get user
    $stmt = $pdo->prepare("
        SELECT user_id, email, password_hash, name, is_active
        FROM users
        WHERE email = :email
        LIMIT 1
    ");

    $stmt->execute(['email' => $input['email']]);
    $user = $stmt->fetch();

    if (!$user || !$user['is_active']) {
        throw new Exception('Invalid credentials');
    }

    // Verify password
    if (!password_verify($input['password'], $user['password_hash'])) {
        throw new Exception('Invalid credentials');
    }

    // Get available projects
    $stmt = $pdo->prepare("
        SELECT
            p.project_id,
            p.name as project_name,
            p.site_id,
            ps.site_name,
            up.role
        FROM projects p
        JOIN user_projects up ON p.project_id = up.project_id
        JOIN pool_sites ps ON p.site_id = ps.site_id
        WHERE up.user_id = :user_id
        ORDER BY p.name
    ");

    $stmt->execute(['user_id' => $user['user_id']]);
    $projects = $stmt->fetchAll();

    if (empty($projects)) {
        throw new Exception('No projects available for this user');
    }

    echo json_encode([
        'success' => true,
        'user_id' => $user['user_id'],
        'user_name' => $user['name'],
        'projects' => $projects,
        'message' => 'Please select a project'
    ]);
}

/**
 * Step 2: Create session for selected project
 */
function handleProjectSelection($input) {
    if (!isset($input['user_id']) || !isset($input['project_id'])) {
        throw new Exception('User ID and project ID required');
    }

    $pdo = Config::getDatabase();

    // Verify user has access to project
    $stmt = $pdo->prepare("
        SELECT
            u.user_id,
            u.name as user_name,
            u.email,
            p.project_id,
            p.name as project_name,
            p.site_id,
            up.role
        FROM users u
        JOIN user_projects up ON u.user_id = up.user_id
        JOIN projects p ON up.project_id = p.project_id
        WHERE u.user_id = :user_id
          AND p.project_id = :project_id
          AND u.is_active = 1
        LIMIT 1
    ");

    $stmt->execute([
        'user_id' => $input['user_id'],
        'project_id' => $input['project_id']
    ]);

    $access = $stmt->fetch();

    if (!$access) {
        throw new Exception('Access denied to this project');
    }

    // Create session
    $sessionId = bin2hex(random_bytes(32));
    $sessionLifetime = Config::get('SESSION_LIFETIME', 'app', 28800);

    $stmt = $pdo->prepare("
        INSERT INTO user_sessions (
            session_id, user_id, project_id, expires_at, created_at
        ) VALUES (
            :session_id, :user_id, :project_id,
            DATE_ADD(NOW(), INTERVAL :lifetime SECOND), NOW()
        )
    ");

    $stmt->execute([
        'session_id' => $sessionId,
        'user_id' => $input['user_id'],
        'project_id' => $input['project_id'],
        'lifetime' => $sessionLifetime
    ]);

    // Log login
    $stmt = $pdo->prepare("
        INSERT INTO audit_log (
            user_id, action, entity_type, entity_id, ip_address, created_at
        ) VALUES (
            :user_id, 'login', 'project', :project_id, :ip_address, NOW()
        )
    ");

    $stmt->execute([
        'user_id' => $input['user_id'],
        'project_id' => $input['project_id'],
        'ip_address' => $_SERVER['REMOTE_ADDR'] ?? null
    ]);

    echo json_encode([
        'success' => true,
        'session_id' => $sessionId,
        'user_name' => $access['user_name'],
        'project_name' => $access['project_name'],
        'site_id' => $access['site_id'],
        'role' => $access['role']
    ]);
}

/**
 * Logout: Invalidate session
 */
function handleLogout($input) {
    if (!isset($input['session_id'])) {
        throw new Exception('Session ID required');
    }

    $pdo = Config::getDatabase();

    // Delete session
    $stmt = $pdo->prepare("
        DELETE FROM user_sessions
        WHERE session_id = :session_id
    ");

    $stmt->execute(['session_id' => $input['session_id']]);

    echo json_encode([
        'success' => true,
        'message' => 'Logged out successfully'
    ]);
}
