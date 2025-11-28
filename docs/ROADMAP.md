# HeatAQ Roadmap

**Last Updated:** November 2024 (V104)

Long-term architectural improvements and technical debt items.

---

## Priority Items

### 1. UI/UX Improvements
**Priority:** High
**Status:** In Progress

- [x] Apply brand colors from example.ppt to login/sidebar (V103)
- [x] Collapsible sidebar - icons only when not hovered (V103)
- [x] Sidebar logo (V103)
- [ ] Migration result display improvements
- [ ] Better error feedback for users

### 2. Security & Permissions
**Priority:** High
**Status:** Completed (V104)

- [x] Admin section hidden from non-admin users
- [x] User management API endpoints require admin role
- [x] Role-based UI visibility

### 3. Documentation
**Priority:** High
**Status:** In Progress (V102)

- [x] Create HEATING_ALGORITHM.md documenting reactive control
- [ ] Update DESIGN_GUIDE.md to V102
- [ ] Update SESSION_SUMMARY.md (outdated at Nov 2024)
- [ ] Create user guide for operators

### 4. Login Improvements (V104)
**Priority:** Medium
**Status:** Partially Complete

- [x] Pre-select last used project on login
- [x] Save last project preference to server (user_preferences table)
- [ ] **TODO:** Update login_api.php to return `last_project_id` from user_preferences

**Note:** login_api.php needs this code added after validating credentials:
```php
// Look up user's last project preference
$stmt = $pdo->prepare("SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = 'last_project_id'");
$stmt->execute([$user['user_id']]);
$lastProject = $stmt->fetchColumn();

// Include in response
$response['last_project_id'] = $lastProject ?: null;
```

---

## Architecture Simplification

### Eliminate site_id, use project_id directly
**Priority:** Medium
**Status:** Planned

Currently the system has both `projects` and `pool_sites` tables with near 1:1 relationship.

**Current flow:**
```
users → user_projects → projects (project_id) → pool_sites (site_id)
```

**Proposed simplification:**
```
users → user_projects → projects (project_id) → pools
```

**Changes needed:**
- Merge pool_sites columns into projects table
- Update foreign keys from site_id to project_id
- Update EnergySimulator, PoolScheduler, APIs
- Migrate existing data

---

## Completed Items

### Solar Data (V56-V102)
- [x] Create site_solar_daily table (raw NASA data)
- [x] Create site_solar_hourly table (calculated with solar position)
- [x] Implement proper solar elevation distribution
- [x] Add UI for configuring site location (Project section)
- [x] Add UI button to fetch NASA solar data (Edit Site modal)
- [x] Migration 009_site_solar_tables.sql

### Pools Table (V97-V102)
- [x] Create pools table with physical properties
- [x] Migration 007_pools_table.sql
- [x] Move pool physical settings from Configuration to pools table
- [x] SimControl uses Project site/pool selection

### Deployment Workflow (V96)
- [x] Merge & Deploy button (replaces GitHub PR workflow)
- [x] Hard Refresh button for cache bypass
- [x] Git merge via API endpoint

### User Preferences Sync (V90-V95)
- [x] Server-side user preferences table
- [x] Cross-device settings sync
- [x] Fallback to localStorage

---

## Data & Calculations

### Weather data source flexibility
**Priority:** Low
**Status:** Planned

Allow multiple weather data sources per project, not just one station.

### Historical simulation comparison
**Priority:** Medium
**Status:** Planned

- Compare actual vs simulated performance
- Import actual energy consumption data
- Calculate model accuracy

---

## UI Improvements

### Configuration management
**Priority:** Medium
**Status:** Planned

- Better visualization of which config template is active
- Side-by-side config comparison
- Config versioning/history

### Dark Mode
**Priority:** Low
**Status:** Planned

- Toggle for reduced eye strain
- Respect system preference

---

## Technical Debt

### Code cleanup
- [ ] Remove deprecated PHP endpoints
- [ ] Consolidate duplicate JavaScript modules
- [ ] Add TypeScript types for better IDE support

### Testing
- [ ] Unit tests for EnergySimulator
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical workflows

### Performance
- [ ] Lazy load simulation results
- [ ] Database query optimization
- [ ] Frontend bundle optimization

---

## Brand Colors (from example.pptx)

Reference colors for UI updates:

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Blue | `#4472C4` | Buttons, links |
| Orange | `#ED7D31` | Warnings, boiler |
| Gold | `#FFC000` | Solar, highlights |
| Light Blue | `#5B9BD5` | Heat pump, info |
| Green | `#70AD47` | Success, positive |
| Dark Blue-Gray | `#44546A` | Sidebar background |

---

## Notes

This document is maintained to track long-term goals across development sessions.
