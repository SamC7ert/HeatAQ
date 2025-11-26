# HeatAQ Roadmap

Long-term architectural improvements and technical debt items.

## Architecture Simplification

### Eliminate site_id, use project_id directly
**Priority:** Medium
**Status:** Planned

Currently the system has both `projects` and `pool_sites` tables with a 1:1 relationship. This adds unnecessary complexity.

**Current flow:**
```
users → user_projects → projects (project_id) → pool_sites (site_id)
```

**Proposed simplification:**
```
users → user_projects → projects (project_id)
```

**Changes needed:**
- Merge pool_sites columns into projects table
- Update all foreign keys from site_id to project_id
- Update EnergySimulator, PoolScheduler, APIs
- Migrate existing data

---

### Move location data to projects
**Priority:** Low
**Status:** Planned

Solar lat/lon currently on pool_sites. Should move to projects table when site_id is eliminated.

---

## Data & Calculations

### Solar data improvements
**Priority:** High
**Status:** In Progress (V56)

- [x] Create site_solar_daily table (raw NASA data)
- [x] Create site_solar_hourly table (calculated with solar position)
- [x] Implement proper solar elevation distribution (matches Python script)
- [ ] Add UI for configuring site location
- [ ] Add UI button to fetch NASA solar data

---

### Weather data source flexibility
**Priority:** Low
**Status:** Planned

Allow multiple weather data sources per project, not just one station.

---

## UI Improvements

### Configuration management
**Priority:** Medium
**Status:** Planned

- Better visualization of which config template is active
- Side-by-side config comparison
- Config versioning/history

---

## Notes

This document is maintained to track long-term goals across development sessions.
Last updated: 2025-11-26 (V56)
