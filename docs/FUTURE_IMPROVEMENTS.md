# Future Improvements

## UI/UX

### Date and Number Format Localization
- Change date display from English format to Nordic format (or user locale-based)
- Currently shows English dates and decimal separators
- Consider reading locale from browser/user settings
- Examples:
  - Current: "Jan 6, 2024" → Nordic: "6. jan 2024"
  - Decimal: "28.5" → "28,5" (Nordic uses comma)

## Simulation

### Open Period HP Rate Application
- Investigate why planned HP rate (from predictive control) may not be applied during open periods
- Debug shows planned rate correctly calculated but simulation output differs

## Deployment

### Automatic Cache Busting
- JS files have manual version query strings (e.g., `?v=98`)
- Should auto-increment on deploy or use content hash
- Consider adding cache clear to deploy process
- Current workaround: manually bump version in index.html and call /api/clear_cache.php

## Performance

(Add items as needed)

## Data/Integration

(Add items as needed)
