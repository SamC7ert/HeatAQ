<?php
/**
 * HeatAQ Authentication API
 * Handles password reset, account security
 *
 * Endpoints:
 * - POST request_reset: Request password reset email
 * - POST verify_token: Verify reset token is valid
 * - POST reset_password: Set new password with token
 */

// Include configuration
require_once __DIR__ . '/../config.php';

// CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

class AuthAPI {
    private $db;

    // Rate limiting: 5 requests per 5 minutes per email or IP
    const RATE_LIMIT_COUNT = 5;
    const RATE_LIMIT_WINDOW = 300; // 5 minutes in seconds

    // Token expiry: 15 minutes
    const TOKEN_EXPIRY_MINUTES = 15;

    // Password complexity requirements
    const PASSWORD_MIN_LENGTH = 8;
    const PASSWORD_REQUIRE_UPPERCASE = true;
    const PASSWORD_REQUIRE_LOWERCASE = true;
    const PASSWORD_REQUIRE_NUMBER = true;
    const PASSWORD_REQUIRE_SPECIAL = false; // Optional but recommended

    public function __construct() {
        try {
            $this->db = Config::getDatabase();
        } catch (Exception $e) {
            $this->sendError('Database connection failed', 500);
        }
    }

    public function handleRequest() {
        $action = $_GET['action'] ?? $_POST['action'] ?? '';

        switch ($action) {
            case 'request_reset':
                $this->requestReset();
                break;
            case 'verify_token':
                $this->verifyToken();
                break;
            case 'reset_password':
                $this->resetPassword();
                break;
            case 'check_complexity':
                $this->checkPasswordComplexity();
                break;
            default:
                $this->sendError('Invalid action', 400);
        }
    }

    /**
     * Request password reset - sends email with reset link
     */
    private function requestReset() {
        $input = $this->getInput();
        $email = trim($input['email'] ?? '');
        $ipAddress = $this->getClientIP();

        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->sendError('Valid email address is required');
        }

        // Check rate limiting
        if ($this->isRateLimited($email, $ipAddress)) {
            $this->sendError('Too many reset requests. Please wait 5 minutes before trying again.', 429);
        }

        // Log the attempt (for rate limiting)
        $this->logResetAttempt($email, $ipAddress);

        // Check if user exists
        $stmt = $this->db->prepare("SELECT user_id, name, email FROM users WHERE email = ? AND is_active = 1");
        $stmt->execute([$email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        // Always return success to prevent email enumeration
        // But only send email if user exists
        if ($user) {
            // Generate secure token
            $token = bin2hex(random_bytes(32)); // 64 character hex string
            $tokenHash = hash('sha256', $token); // Store hash in DB
            $expiresAt = date('Y-m-d H:i:s', strtotime('+' . self::TOKEN_EXPIRY_MINUTES . ' minutes'));

            // Invalidate any existing tokens for this user
            $stmt = $this->db->prepare("DELETE FROM password_reset_tokens WHERE user_id = ?");
            $stmt->execute([$user['user_id']]);

            // Store new token
            $stmt = $this->db->prepare("
                INSERT INTO password_reset_tokens (user_id, token, expires_at, ip_address)
                VALUES (?, ?, ?, ?)
            ");
            $stmt->execute([$user['user_id'], $tokenHash, $expiresAt, $ipAddress]);

            // Send reset email
            $this->sendResetEmail($user, $token);
        }

        // Always return success (security: don't reveal if email exists)
        $this->sendResponse([
            'success' => true,
            'message' => 'If an account exists with this email, a reset link has been sent.'
        ]);
    }

    /**
     * Verify if a reset token is valid
     */
    private function verifyToken() {
        $input = $this->getInput();
        $token = $input['token'] ?? '';

        if (empty($token)) {
            $this->sendError('Token is required');
        }

        $tokenHash = hash('sha256', $token);

        $stmt = $this->db->prepare("
            SELECT t.token_id, t.expires_at, t.used_at, u.email, u.name
            FROM password_reset_tokens t
            JOIN users u ON t.user_id = u.user_id
            WHERE t.token = ? AND u.is_active = 1
        ");
        $stmt->execute([$tokenHash]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$result) {
            $this->sendError('Invalid or expired reset link', 400);
        }

        if ($result['used_at']) {
            $this->sendError('This reset link has already been used', 400);
        }

        if (strtotime($result['expires_at']) < time()) {
            $this->sendError('This reset link has expired. Please request a new one.', 400);
        }

        $this->sendResponse([
            'valid' => true,
            'email' => $this->maskEmail($result['email']),
            'name' => $result['name']
        ]);
    }

    /**
     * Reset password with valid token
     */
    private function resetPassword() {
        $input = $this->getInput();
        $token = $input['token'] ?? '';
        $password = $input['password'] ?? '';
        $confirmPassword = $input['confirm_password'] ?? '';

        if (empty($token)) {
            $this->sendError('Token is required');
        }

        // Validate password complexity
        $complexityResult = $this->validatePasswordComplexity($password);
        if (!$complexityResult['valid']) {
            $this->sendError($complexityResult['message']);
        }

        if ($password !== $confirmPassword) {
            $this->sendError('Passwords do not match');
        }

        $tokenHash = hash('sha256', $token);

        // Get and validate token
        $stmt = $this->db->prepare("
            SELECT t.token_id, t.user_id, t.expires_at, t.used_at
            FROM password_reset_tokens t
            JOIN users u ON t.user_id = u.user_id
            WHERE t.token = ? AND u.is_active = 1
        ");
        $stmt->execute([$tokenHash]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$result) {
            $this->sendError('Invalid reset link', 400);
        }

        if ($result['used_at']) {
            $this->sendError('This reset link has already been used', 400);
        }

        if (strtotime($result['expires_at']) < time()) {
            $this->sendError('This reset link has expired', 400);
        }

        // Update password
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);

        $this->db->beginTransaction();
        try {
            // Update user password
            $stmt = $this->db->prepare("UPDATE users SET password_hash = ? WHERE user_id = ?");
            $stmt->execute([$passwordHash, $result['user_id']]);

            // Mark token as used
            $stmt = $this->db->prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE token_id = ?");
            $stmt->execute([$result['token_id']]);

            // Invalidate all sessions for this user (force re-login)
            $stmt = $this->db->prepare("DELETE FROM user_sessions WHERE user_id = ?");
            $stmt->execute([$result['user_id']]);

            $this->db->commit();

            $this->sendResponse([
                'success' => true,
                'message' => 'Password has been reset successfully. You can now log in with your new password.'
            ]);

        } catch (Exception $e) {
            $this->db->rollBack();
            $this->sendError('Failed to reset password. Please try again.', 500);
        }
    }

    /**
     * Check password complexity (for real-time validation)
     */
    private function checkPasswordComplexity() {
        $input = $this->getInput();
        $password = $input['password'] ?? '';

        $result = $this->validatePasswordComplexity($password);
        $this->sendResponse($result);
    }

    /**
     * Validate password against complexity requirements
     */
    private function validatePasswordComplexity($password) {
        $errors = [];

        if (strlen($password) < self::PASSWORD_MIN_LENGTH) {
            $errors[] = 'at least ' . self::PASSWORD_MIN_LENGTH . ' characters';
        }

        if (self::PASSWORD_REQUIRE_UPPERCASE && !preg_match('/[A-Z]/', $password)) {
            $errors[] = 'an uppercase letter';
        }

        if (self::PASSWORD_REQUIRE_LOWERCASE && !preg_match('/[a-z]/', $password)) {
            $errors[] = 'a lowercase letter';
        }

        if (self::PASSWORD_REQUIRE_NUMBER && !preg_match('/[0-9]/', $password)) {
            $errors[] = 'a number';
        }

        if (self::PASSWORD_REQUIRE_SPECIAL && !preg_match('/[!@#$%^&*(),.?":{}|<>]/', $password)) {
            $errors[] = 'a special character';
        }

        if (count($errors) > 0) {
            return [
                'valid' => false,
                'message' => 'Password must contain ' . implode(', ', $errors),
                'requirements' => [
                    'min_length' => self::PASSWORD_MIN_LENGTH,
                    'require_uppercase' => self::PASSWORD_REQUIRE_UPPERCASE,
                    'require_lowercase' => self::PASSWORD_REQUIRE_LOWERCASE,
                    'require_number' => self::PASSWORD_REQUIRE_NUMBER,
                    'require_special' => self::PASSWORD_REQUIRE_SPECIAL
                ]
            ];
        }

        return ['valid' => true, 'message' => 'Password meets requirements'];
    }

    /**
     * Check if request is rate limited
     */
    private function isRateLimited($email, $ipAddress) {
        $windowStart = date('Y-m-d H:i:s', time() - self::RATE_LIMIT_WINDOW);

        // Check by email
        $stmt = $this->db->prepare("
            SELECT COUNT(*) FROM password_reset_attempts
            WHERE email = ? AND attempted_at > ?
        ");
        $stmt->execute([$email, $windowStart]);
        $emailCount = $stmt->fetchColumn();

        if ($emailCount >= self::RATE_LIMIT_COUNT) {
            return true;
        }

        // Check by IP
        $stmt = $this->db->prepare("
            SELECT COUNT(*) FROM password_reset_attempts
            WHERE ip_address = ? AND attempted_at > ?
        ");
        $stmt->execute([$ipAddress, $windowStart]);
        $ipCount = $stmt->fetchColumn();

        if ($ipCount >= self::RATE_LIMIT_COUNT) {
            return true;
        }

        return false;
    }

    /**
     * Log reset attempt for rate limiting
     */
    private function logResetAttempt($email, $ipAddress) {
        $stmt = $this->db->prepare("
            INSERT INTO password_reset_attempts (email, ip_address)
            VALUES (?, ?)
        ");
        $stmt->execute([$email, $ipAddress]);
    }

    /**
     * Send password reset email
     */
    private function sendResetEmail($user, $token) {
        // Build reset URL
        $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $basePath = dirname($_SERVER['REQUEST_URI'] ?? '/');
        $basePath = rtrim($basePath, '/api');

        $resetUrl = "{$protocol}://{$host}{$basePath}/reset_password.html?token={$token}";

        $subject = "HeatAQ Password Reset";
        $message = "
Hello {$user['name']},

You requested to reset your password for your HeatAQ account.

Click the link below to reset your password:
{$resetUrl}

This link will expire in " . self::TOKEN_EXPIRY_MINUTES . " minutes.

If you did not request this reset, please ignore this email.
Your password will not be changed unless you click the link above.

Best regards,
HeatAQ System
";

        $headers = [
            'From: noreply@heataq.com',
            'Reply-To: noreply@heataq.com',
            'X-Mailer: PHP/' . phpversion(),
            'Content-Type: text/plain; charset=UTF-8'
        ];

        // Try to send email
        try {
            // Check if we have mail configuration
            if (method_exists('Config', 'getMailConfig')) {
                $mailConfig = Config::getMailConfig();
                // Use configured mail settings if available
                // For now, fall back to PHP mail()
            }

            $sent = @mail($user['email'], $subject, $message, implode("\r\n", $headers));

            if (!$sent) {
                // Log failure but don't tell user (security)
                error_log("Failed to send password reset email to: " . $user['email']);
            }
        } catch (Exception $e) {
            error_log("Email error: " . $e->getMessage());
        }
    }

    /**
     * Mask email for display (security)
     */
    private function maskEmail($email) {
        $parts = explode('@', $email);
        if (count($parts) !== 2) return '***';

        $name = $parts[0];
        $domain = $parts[1];

        $maskedName = substr($name, 0, 2) . str_repeat('*', max(0, strlen($name) - 2));

        return $maskedName . '@' . $domain;
    }

    /**
     * Get client IP address
     */
    private function getClientIP() {
        $headers = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'];

        foreach ($headers as $header) {
            if (!empty($_SERVER[$header])) {
                $ip = $_SERVER[$header];
                // Handle comma-separated IPs (X-Forwarded-For)
                if (strpos($ip, ',') !== false) {
                    $ip = trim(explode(',', $ip)[0]);
                }
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        }

        return '0.0.0.0';
    }

    /**
     * Get input from POST body
     */
    private function getInput() {
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';

        if (strpos($contentType, 'application/json') !== false) {
            return json_decode(file_get_contents('php://input'), true) ?: [];
        }

        return $_POST;
    }

    /**
     * Send JSON response
     */
    private function sendResponse($data) {
        echo json_encode($data);
        exit;
    }

    /**
     * Send error response
     */
    private function sendError($message, $code = 400) {
        http_response_code($code);
        echo json_encode(['error' => $message]);
        exit;
    }
}

// Handle the request
$api = new AuthAPI();
$api->handleRequest();
