# HeatAQ Roadmap

**Last Updated:** November 2024 (V104+)

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
- [x] Force password change on first login (admin sets initial password)
- [x] Password history prevents reuse of last 5 passwords
- [x] Similar password detection (prevents MyPassword → MyPassword1)

### 3. Documentation
**Priority:** High
**Status:** In Progress (V102)

- [x] Create HEATING_ALGORITHM.md documenting reactive control
- [ ] Update DESIGN_GUIDE.md to V102
- [ ] Update SESSION_SUMMARY.md (outdated at Nov 2024)
- [ ] Create user guide for operators

### 4. Login Improvements (V104)
**Priority:** Medium
**Status:** Complete

- [x] Pre-select last used project on login
- [x] Save last project preference to server (user_preferences table)
- [x] Auto-select single project (skip dropdown if user has only one project)
- [x] login_api.php.example includes last_project_id lookup

**Migration required:** Run `db/migrations/001_add_password_security_columns.sql` to add:
- `force_password_change` column to users table
- `password_history` column to users table (JSON)

---

## Architecture Simplification

### Project → Site → Pool Hierarchy
**Priority:** Medium
**Status:** In Progress

Transitioning to a clean project/site/pool hierarchy with parameters at appropriate levels.

**Target hierarchy:**
```
users → user_projects → projects → sites → pools
```

**In progress:**
- Moving parameters from config_templates to relevant entity level (pool, site, project)
- Some parameters will remain in config (equipment settings, control strategies)
- Updating EnergySimulator, PoolScheduler, APIs to use new structure

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
**Status:** In Progress

- Compare actual vs simulated performance
- Import actual energy consumption data
- Calculate model accuracy

UI tabs implemented in SimControl: History, Compare, Debug

---

## UI Improvements

### Configuration management
**Priority:** Medium
**Status:** Completed

- [x] Configuration selector with create/save/delete
- [x] Config override system in simulation
- [x] Better visualization of active config template

### Dark Mode
**Priority:** Low
**Status:** To Discuss

- Toggle for reduced eye strain
- Respect system preference

---

## Control Modes & Simulation

### Testing
**Priority:** High
**Status:** In Progress

Control mode testing progress:

| Mode | Status | Notes |
|------|--------|-------|
| **Reactive** | Testing | Well along, details remain |
| **Predictive** | Not Started | Next priority |
| **Optimizing** | Planned | Cost optimization based on spot electricity prices |

See `docs/HEATING_ALGORITHM.md` for mode descriptions.

### Optimizing Mode (New)
**Priority:** Medium
**Status:** Planned

New control strategy to minimize cost using spot electricity prices:
- Shift heating to low-price hours
- Pre-heat before price spikes
- Integrate with Nord Pool / electricity price API
- Balance cost vs comfort (temperature constraints)

---

## Known Issues

### Simulation UI
- [ ] Site selector does not load correct site (may show non-existent site)
- [ ] History tab only loads partial data
- [ ] Analysis tab does not show analysis data
- [ ] Debug tab sometimes does not follow main simulation for open/close status

### Login
- [ ] Add option to view password in login form

---

## New Features Planned

### Debug graph interaction
- [ ] Click on graph in Debug tab to see hourly details

### Project templates
- [ ] Create new projects from template

---

## Technical Debt

### Code cleanup
- [ ] Remove deprecated PHP endpoints
- [ ] Consolidate duplicate JavaScript modules
- [ ] Add TypeScript types for better IDE support
- [ ] Review and remove all fallback logic (error instead of silent fallbacks)
- [ ] Move target_heat and bathers from config_templates to pool level

### Testing infrastructure
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
