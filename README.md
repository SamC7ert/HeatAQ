# HeatAQ - Pool Energy Design System

## Overview
HeatAQ is a comprehensive web-based pool energy simulation and analysis system designed for outdoor swimming pools in Norway. The system provides design tools for comparing heating scenarios and optimizing energy consumption.

## Features
- **Schedule Management**: Day, week, and calendar-based scheduling with Norwegian holidays
- **Multi-Project Support**: Manage multiple pool sites with role-based access
- **Weather Integration**: 10 years of historical weather data
- **Energy Simulation**: Heat pump and boiler optimization
- **Secure Authentication**: Project-based access control with forced password change
- **Role-Based Access**: Operator and Admin roles with appropriate permissions

## Tech Stack
- **Frontend**: HTML5, JavaScript (ES6+), CSS3
- **Backend**: PHP 8.2+
- **Database**: MySQL 5.7+
- **Simulator**: Python 3.8+ (numpy, pandas)

## Project Structure
```
heataq/
├── api/                  # API endpoints
│   └── heataq_api.php
├── assets/              # Static assets
│   ├── css/            # Stylesheets
│   └── js/             # JavaScript modules
│       └── modules/
├── docs/               # Documentation
├── simulator/          # Python simulation engine
├── index.html         # Main application
├── login.html         # Authentication
└── config.php.example # Configuration template
```

## Installation

### 1. Clone Repository
```bash
git clone https://github.com/SamC7ert/HeatAQ.git
cd HeatAQ
```

### 2. Configure Database
1. Copy `database.env.example` to `/config_heataq/database.env`
2. Update with your database credentials
3. Import database schema from `/docs/schema.sql`

### 3. Configure Application
1. Copy `config.php.example` to `config.php`
2. Ensure `/config_heataq/` is outside web root

### 4. Set Permissions
```bash
chmod 755 .
chmod 644 *.php
chmod 644 *.html
```

## Security Notes
- **NEVER** commit `database.env` or files with credentials
- Keep `/config_heataq/` outside public web directory
- Use HTTPS in production
- Enable `REQUIRE_AUTH=true` for production

### Password Security (V104)
- Users must change password on first login (admin-set passwords)
- Password history prevents reuse of last 5 passwords
- Similar password detection blocks trivial modifications
- Minimum 8 characters required

### User Roles
| Role | Permissions |
|------|-------------|
| **operator** | Edit schedules, calendars, run simulations |
| **admin** | Full access including user management and system settings |

## Development Workflow

### Local Development
```bash
# Make changes
git add .
git commit -m "Description of changes"
git push origin main
```

### Deployment
```bash
# On server
cd /public_html/heataq
git pull origin main
```

## Documentation
- [System Architecture](docs/SYSTEM_ARCHITECTURE.md)
- [Database Structure](docs/DATABASE_STRUCTURE.md)
- [Design Guide](docs/DESIGN_GUIDE.md)
- [Heating Algorithm](docs/HEATING_ALGORITHM.md)
- [Roadmap](docs/ROADMAP.md)

---

## Claude Code Handover Notes

This section helps Claude (AI assistant) maintain context across sessions.

### Database Hierarchy
```
users → user_projects → projects → pool_sites → pools
                            ↓            ↓
                   schedule_templates    simulation_runs
                   day_schedules         site_solar_daily/hourly
                   week_schedules
```

- **Schedules** belong to `projects` (via `project_id`) - shared across all sites/pools in project
- **Simulation/solar data** belong to `pool_sites` (via `pool_site_id`) - site-specific
- The VARCHAR `pool_sites.site_id` is kept only for display names

### Development Principles

1. **No silent fallbacks** - Never use patterns like `$value ?? 'default'` for critical data. Fail with a clear error instead. Silent fallbacks hide bugs and cause data inconsistencies.

2. **Thorough over quick** - Fix root causes, not symptoms. If a bug appears, trace it back to understand why before patching.

3. **INT foreign keys** - All relationships use INT FKs. No VARCHAR lookups for data relationships.

4. **Versioning** - Increment version in commits. Current version tracked in this file footer.

5. **Test migrations first** - Run migrations on staging/test before production. Check for duplicate methods, syntax errors.

### Recent Context (Dec 2024)

- Schedule tables (templates, day, week) now use `project_id` FK (not pool_site_id)
- Simulation/solar tables use `pool_site_id` FK
- User preferences are project-scoped (user_id + project_id + pref_key)
- Migration archive function commits directly to master branch
- Admin UI has separate Active/Inactive user cards

### Pending Items

See [Roadmap](docs/ROADMAP.md) for full list. Key items:
- Move target_heat and bathers from config_templates to pool level

---

## Authors
- Developed for Aquarious AS, Norway
- Pool energy optimization specialists

## License
Proprietary - All rights reserved

## Support
For support, contact Aquarious AS

---
*Version 106 - December 2024*
