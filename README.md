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

## Authors
- Developed for Aquarious AS, Norway
- Pool energy optimization specialists

## License
Proprietary - All rights reserved

## Support
For support, contact Aquarious AS

---
*Version 104 - November 2024*
