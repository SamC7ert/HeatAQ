# HeatAQ Code Review - Potential Issues & Fixes

**Last Updated:** V63 - November 2025

## EXECUTIVE SUMMARY

This document provides a comprehensive security and code quality review of the HeatAQ pool energy management system. The application consists of a PHP backend API, JavaScript frontend modules, and a MySQL database.

### Security Status Overview

| Category | Status | Priority |
|----------|--------|----------|
| PHP Code Exposure | **SAFE** | - |
| Database Credentials | **NEEDS ATTENTION** | High |
| SQL Injection | **MITIGATED** | Medium |
| Input Validation | **PARTIAL** | Medium |
| Authentication | **BASIC** | Medium |
| Frontend Security | **SAFE** | - |

### Key Finding: PHP Code is NOT Exposed

**IMPORTANT:** The PHP source code is NOT visible to users in the browser. When users open F12 Developer Tools:
- They can only see HTML, CSS, and JavaScript (client-side code)
- PHP code executes on the server and only returns JSON responses
- The simulator logic, database queries, and business logic remain hidden
- Users cannot see the API implementation, only the API endpoints they call

---

## 1. API SECURITY ISSUES

### CRITICAL: Database credentials exposed
**File:** heataq_api.php (lines 14-20)
**Issue:** Database password is hardcoded in plain text
**Risk:** Anyone who can access the PHP file can see your database password
**Fix:** Move credentials to a separate config file outside web root:
```php
// config/database.php (outside public_html)
return [
    'host' => 'sdb-86.hosting.stackcp.net',
    'database' => 'heataq_pool-353130302dd2',
    'username' => 'heataq_pool-353130302dd2',
    'password' => 'hxpzxqu82w'
];

// In API file:
$config = require_once('../config/database.php');
```

### SQL Injection vulnerabilities
**Issue:** Some queries use direct variable insertion instead of prepared statements
**Example:** In getDaySchedules() - the GROUP BY fix might have issues
**Fix:** Always use prepared statements with bound parameters

### Missing input validation
**Issue:** No validation on incoming data
**Risk:** Could insert invalid data causing application errors
**Fix examples:**
```php
// Validate date format
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    throw new Exception('Invalid date format');
}

// Validate temperature ranges
if ($temp < 20 || $temp > 35) {
    throw new Exception('Temperature out of range');
}
```

### No authentication/authorization
**Issue:** Anyone can call any API endpoint
**Risk:** Anyone can modify your schedules
**Fix:** Add API key or session-based authentication

## 2. API FUNCTIONAL ISSUES

### getDaySchedules() GROUP BY problem
**Issue:** MySQL strict mode requires all non-aggregated columns in GROUP BY
**Current code has two versions - make sure using the fixed one**
**Fix already provided but verify it's using:**
```php
GROUP BY ds.day_schedule_id, ds.name, ds.description, ds.is_closed
// OR use the separate query approach from fix_getDaySchedules.php
```

### Missing error handling
**Issue:** Functions don't consistently handle errors
**Example:** What if schedule_template doesn't exist?
**Fix:** Add try-catch blocks and proper error responses:
```php
try {
    // code
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error', 'message' => $e->getMessage()]);
    return;
}
```

### Incomplete DELETE functions
**Issue:** Missing delete functions for some entities
**Fix:** Add delete functions for all CRUD operations

### Easter calculation fallback
**Issue:** MySQL function might not exist, PHP backup not always used
**Fix:** Always use PHP calculation since MySQL function creation may fail:
```php
function resolveSchedule($date) {
    // Always use PHP Easter calculation
    $easter = calculate_easter_php($year);
    // Don't rely on MySQL function
}
```

## 3. UI/HTML ISSUES

### No loading indicators
**Issue:** User doesn't know when data is loading
**Fix:** Add loading spinners:
```javascript
async function loadDaySchedules() {
    const selector = document.getElementById('day-schedule-selector');
    selector.innerHTML = '<option>Loading...</option>';
    try {
        // load data
    } catch(e) {
        selector.innerHTML = '<option>Error loading schedules</option>';
    }
}
```

### No error display to user
**Issue:** Errors only show in console
**Fix:** Add visible error messages:
```javascript
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-danger';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
}
```

### Missing form validation
**Issue:** Can submit invalid times, temperatures
**Fix:** Add HTML5 validation attributes and JS validation:
```html
<input type="time" required min="06:00" max="23:00">
<input type="number" required min="20" max="35" step="0.5">
```

### No unsaved changes warning
**Issue:** User might lose changes by navigating away
**Fix:** Track form changes and warn on navigation:
```javascript
let hasUnsavedChanges = false;
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
    }
});
```

## 4. DATA INTEGRITY ISSUES

### Period overlap not checked
**Issue:** Can create overlapping time periods for same day
**Fix:** Validate periods don't overlap before saving:
```php
function validatePeriods($periods) {
    usort($periods, function($a, $b) {
        return strcmp($a['start_time'], $b['start_time']);
    });
    
    for ($i = 0; $i < count($periods) - 1; $i++) {
        if ($periods[$i]['end_time'] > $periods[$i + 1]['start_time']) {
            throw new Exception('Periods overlap');
        }
    }
}
```

### Missing cascade deletes
**Issue:** Deleting schedule might leave orphan periods
**Fix:** Already handled by ON DELETE CASCADE in foreign keys

### No duplicate name checking
**Issue:** Can create multiple schedules with same name
**Fix:** Check for duplicates before insert:
```php
$stmt = $pdo->prepare("SELECT COUNT(*) FROM day_schedules WHERE name = ? AND day_schedule_id != ?");
$stmt->execute([$name, $id]);
if ($stmt->fetchColumn() > 0) {
    throw new Exception('Schedule name already exists');
}
```

## 5. PERFORMANCE ISSUES

### N+1 query problem in getDaySchedules
**Issue:** Fixed version queries periods for each schedule separately
**Impact:** With 16 schedules = 17 queries instead of 1
**Fix:** Use single query with proper grouping or accept the performance hit for correctness

### No caching
**Issue:** Queries database every time even for static data
**Fix:** Cache rarely changing data:
```php
// Simple file cache
$cacheFile = '/tmp/schedules_cache.json';
if (file_exists($cacheFile) && time() - filemtime($cacheFile) < 3600) {
    echo file_get_contents($cacheFile);
    return;
}
```

### Loading all data at once
**Issue:** No pagination for large datasets
**Fix:** Add pagination for future scalability

## 6. CORS & SSL ISSUES

### CORS headers might not work with preflight
**Issue:** Missing OPTIONS handling
**Fix already in code but verify:**
```php
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit();
}
```

### Mixed content after SSL
**Issue:** Hardcoded HTTP URLs
**Fix:** Use protocol-relative URLs or always HTTPS:
```javascript
const API_BASE_URL = 'https://heataq.syvertsen.com/heataq_api.php';
```

## 7. MISSING FEATURES

### No audit log
**Issue:** No record of who changed what and when
**Fix:** Add audit table and log all changes

### No backup/restore
**Issue:** No way to backup schedule configurations
**Fix:** Add export/import functionality

### No bulk operations
**Issue:** Can't apply same schedule to multiple days
**Fix:** Add bulk update operations

### No schedule templates
**Issue:** Can't save commonly used configurations
**Fix:** Add template system

## 8. IMMEDIATE FIXES NEEDED

1. **Fix getDaySchedules() in production** - Use the corrected version
2. **Add input validation** - Prevent invalid data entry
3. **Add error handling** - Catch and display errors properly
4. **Fix CORS for HTTPS** - Ensure headers work with SSL
5. **Add loading indicators** - Improve UX

## 9. DATABASE SCHEMA ISSUES

### Missing indexes
**Issue:** No indexes on foreign keys for week_schedules day columns
**Fix:** Add indexes for better join performance:
```sql
ALTER TABLE week_schedules ADD INDEX idx_monday (monday_schedule_id);
ALTER TABLE week_schedules ADD INDEX idx_tuesday (tuesday_schedule_id);
-- etc for all days
```

### No unique constraints
**Issue:** No uniqueness enforced at database level
**Fix:** Add unique constraints where needed:
```sql
ALTER TABLE day_schedules ADD UNIQUE KEY unique_name_site (name, site_id);
```

## 10. RECOMMENDED IMMEDIATE ACTIONS

1. **Replace getDaySchedules() function** with the fixed version
2. **Test SSL tomorrow** when certificate is active  
3. **Add basic input validation** to prevent crashes
4. **Move database credentials** to separate config file
5. **Add error display** in UI instead of just console

## CODE TO ADD TO API FOR BETTER ERROR HANDLING:

```php
// Add at top of file after database connection
set_error_handler(function($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Wrap main switch statement
try {
    switch($action) {
        // ... existing cases
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Server error',
        'message' => $e->getMessage(),
        'debug' => DEBUG_MODE ? $e->getTrace() : null
    ]);
}
```

This review identifies the main issues. The system works but needs security and robustness improvements before production use. The most critical items are the exposed database credentials and lack of input validation.

---

## 11. WHAT USERS CAN SEE (F12 Developer Tools)

### Visible to Users:
- **HTML Structure:** The complete DOM including element IDs, classes, and structure
- **CSS Styles:** All styling rules and CSS files
- **JavaScript Code:** All frontend modules (navigation.js, simulations.js, etc.)
- **API Endpoints:** The URLs being called (e.g., `heataq_api.php?action=runSimulation`)
- **API Responses:** JSON data returned from the server
- **Network Traffic:** All HTTP requests and responses
- **LocalStorage:** Session data, project settings, override values

### NOT Visible to Users:
- **PHP Source Code:** All `.php` files execute server-side
- **Database Connection:** Credentials, host, database name
- **Database Queries:** SQL statements and query logic
- **Simulator Algorithms:** Heat loss calculations, COP curves, control logic
- **Schedule Resolution:** Priority-based scheduling logic
- **Server File System:** No access to server directories

### Security Implication:
The separation between client (visible) and server (hidden) code means:
- Business logic is protected
- Proprietary algorithms remain confidential
- Database structure is not directly exposed
- Users can see WHAT data is sent/received but not HOW it's processed

---

## 12. SCHEDULER COMPARISON (Python vs PHP)

A detailed comparison of the Python and PHP scheduler implementations was performed. See `docs/SCHEDULER_COMPARISON.md` for full details.

### Issues Found and Fixed:

1. **Holiday Column Name (FIXED):** Added COALESCE to handle both `easter_date` and `easter_sunday` column names
2. **is_recurring Flag (FIXED):** Now reads from database instead of hardcoding `true`
3. **Country Filter (NOTED):** PHP loads all countries; acceptable if single-country database

### Verified Logic (Identical in Both):
- Priority resolution: Exceptions → Date Ranges → Base Week
- Day of week mapping (0-6)
- Year-crossing date range handling
- Easter calculation algorithm
- Period time matching (including overnight periods)

---

## 13. FRONTEND MODULE REVIEW

### Module Structure (V63):
```
assets/js/
├── config.js         - API base URL, constants
├── app.js            - Main application controller
└── modules/
    ├── api.js        - API wrapper functions
    ├── navigation.js - Section switching
    ├── schedules.js  - OHC management
    ├── calendar.js   - Date ranges, exceptions
    ├── simulations.js - Simulation runner, debug, analyse
    ├── simcontrol.js - Tab management
    ├── configuration.js - Project config forms
    ├── admin.js      - Admin sections
    └── project.js    - Project management (NEW in V63)
```

### Security Notes:
- All modules use the global `config.apiBaseUrl` for API calls
- Session token stored in localStorage and sent via fetch headers
- Override values persist locally (user-specific, not shared)
- No sensitive data stored in frontend code

---

## 14. RECOMMENDED PRIORITY ORDER

### Immediate (Before Production):
1. Move database credentials to environment file outside web root
2. Add input validation for all form fields
3. Implement rate limiting on API endpoints

### Short-term:
4. Add API authentication tokens
5. Implement audit logging
6. Add HTTPS-only headers

### Long-term:
7. Add role-based access control
8. Implement data export/import functionality
9. Add automated backup system