# HeatAQ Simulation Storage Strategy

## Overview

This document outlines storage recommendations for simulation results, addressing the challenge of storing ~87,000+ hourly data points per 10-year simulation run.

## Data Volume Analysis

### Per Simulation Run (10 years)
| Data Type | Rows | Est. Size | Description |
|-----------|------|-----------|-------------|
| Hourly Results | 87,672 | 7-10 MB | Detailed hourly values |
| Daily Results | 3,653 | 100 KB | Daily aggregates |
| Run Metadata | 1 | 2 KB | Config + summary |
| **Total** | ~91,326 | **~10 MB** | Per run |

### Projected Growth
| Scenario | Runs/Year | Annual Storage |
|----------|-----------|----------------|
| Light Use | 10 | 100 MB |
| Medium Use | 50 | 500 MB |
| Heavy Use | 200 | 2 GB |

## Recommended Storage Strategy

### Option 1: Full Storage (Recommended for Start)
Store all hourly data in the database.

**Pros:**
- Simple implementation
- Full data access for any analysis
- Easy to query specific hours/days

**Cons:**
- Higher storage use
- Slower queries on large datasets

**When to use:** Starting out, <100 runs expected

### Option 2: Summary + On-Demand
Store daily summaries only; regenerate hourly on demand.

**Pros:**
- 99% storage reduction
- Fast queries

**Cons:**
- Must re-run simulation for hourly detail
- Computation cost on retrieval

**When to use:** High volume, rarely need hourly detail

### Option 3: Tiered Retention (Best Long-term)
- Keep hourly data for recent runs (e.g., 90 days)
- Archive to daily-only after retention period
- Delete very old runs based on policy

**Pros:**
- Balanced storage/access
- Automatic cleanup

**Cons:**
- More complex implementation

## What Data to Store Per Run

### Always Store (Metadata)
```json
{
  "run_id": 123,
  "scenario_name": "Winter High-Temp",
  "start_date": "2014-01-01",
  "end_date": "2023-12-31",
  "status": "completed",
  "config_snapshot": { ... },
  "summary": {
    "total_hours": 87672,
    "open_hours": 35000,
    "total_heat_loss_kwh": 1234567,
    "total_solar_gain_kwh": 456789,
    "total_hp_energy_kwh": 234567,
    "total_boiler_energy_kwh": 123456,
    "total_cost": 987654,
    "avg_water_temp": 26.5,
    "avg_cop": 3.8
  }
}
```

### Daily Summary (Always Store)
- Date, hours open
- Average temperatures (air, water)
- Total energy (loss, solar, HP, boiler)
- Total cost

### Hourly Detail (Optional/Tiered)
- Weather conditions
- Pool temperatures
- Heat loss components
- Heat gain components
- Energy consumption
- Cost

## Implementation Recommendations

### For Immediate Implementation
1. **Use Full Storage (Option 1)** for simplicity
2. Database tables as defined in `database_schema_simulation.sql`
3. Batch inserts for performance (500 rows per insert)

### For Future Optimization
1. Add indexes on `run_id + timestamp`
2. Consider table partitioning by `run_id`
3. Implement retention policy cleanup job
4. Add data compression (MySQL InnoDB compression)

## API Design for Large Results

### Pagination
```
GET /api/simulation_api.php?action=get_results&run_id=123&limit=1000&offset=0
```

### Date Filtering
```
GET /api/simulation_api.php?action=get_results&run_id=123&date=2020-06-15
```

### Aggregation Endpoints
```
GET /api/simulation_api.php?action=get_daily_results&run_id=123
GET /api/simulation_api.php?action=get_summary&run_id=123
```

## Database Maintenance

### Regular Cleanup (Monthly)
```sql
-- Delete runs older than 1 year with status 'failed'
DELETE FROM simulation_runs
WHERE status = 'failed'
AND created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

### Storage Monitoring
```sql
-- Check storage per run
SELECT
    sr.run_id,
    sr.scenario_name,
    COUNT(shr.result_id) as hourly_rows,
    COUNT(sdr.result_id) as daily_rows
FROM simulation_runs sr
LEFT JOIN simulation_hourly_results shr ON sr.run_id = shr.run_id
LEFT JOIN simulation_daily_results sdr ON sr.run_id = sdr.run_id
GROUP BY sr.run_id;
```

## Discussion Points

1. **Retention Period**: How long should hourly data be kept?
2. **Max Concurrent Runs**: Limit parallel simulations to prevent overload?
3. **Export Format**: Support CSV/JSON export for offline analysis?
4. **Comparison Feature**: Store runs for scenario comparison?
5. **Cost Tracking**: Track electricity prices over time for cost analysis?

## Questions for Next Session

1. Expected number of simulation runs per month?
2. Need for hourly detail after initial analysis?
3. Multi-site support needed?
4. User access control requirements?
5. Integration with external reporting tools?
