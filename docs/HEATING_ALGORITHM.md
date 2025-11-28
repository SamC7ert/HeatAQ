# HeatAQ Heating Control Algorithm

**Version:** V102
**Last Updated:** November 2024

---

## Overview

HeatAQ simulates pool heating using a reactive control strategy that maintains target water temperature while minimizing energy costs. The system supports multiple heating sources (heat pump primary, boiler backup) and operates with deadband temperature control.

---

## Control Strategies

### 1. HP Priority (Default: `hp_priority`)

Heat pump is always used first due to higher efficiency (COP ~4.6 for ground source).
Boiler is only used when:
- Heat pump capacity is exceeded
- Air source HP is outside operating range (air_source type only)

### 2. Boiler Priority (`boiler_priority`)

Boiler is used first (faster response, useful for emergencies).
Heat pump is backup when boiler capacity exceeded.

### 3. Reactive (`reactive`)

Same as HP Priority but maintains target temperature 24/7 (ignores schedule closed hours).
Does NOT use setback temperature during closed periods.

### 4. Predictive (`predictive`)

During closed hours, maintains a lower "setback" temperature (default 26°C) instead of full target.
This prevents massive reheat costs when pool reopens.

---

## Temperature Control Logic

### Deadband Control

The system uses deadband control to avoid hunting:

```
Target Temperature: 28°C
├── Max Temp (target + 2): 30°C → Stop heating (allow natural cooling)
├── Target Temp: 28°C → Compensate for losses only
├── Min Temp (target - 2): 26°C → Start active heating
└── Below Min: Emergency heating at max capacity
```

### Decision Flow (Each Hour)

```
1. Calculate Heat Losses
   ├── Evaporation (dominant for outdoor pools)
   ├── Convection (wind-dependent)
   ├── Radiation (to sky)
   └── Conduction (to ground/walls)

2. Calculate Heat Gains
   └── Solar radiation (through cover if present)

3. Net Requirement = Losses - Solar Gain

4. Temperature Check:
   if (waterTemp >= maxTemp):
       → No heating (allow natural cooling)

   elif (waterTemp < minTemp):
       → Emergency: Heat to recover full deficit in 1 hour
       → Required = NetLoss + HeatToRaiseTemp(deficit)

   elif (waterTemp < targetTemp):
       → Active Recovery: Heat to close gap quickly
       → Required = NetLoss + HeatToRaiseTemp(deficit)

   else:
       → Maintain: Just compensate for losses
       → Required = max(0, NetLoss)

5. Apply Equipment:
   HP first → Boiler for remainder
```

---

## Heat Calculation Formulas

### Heat Required to Raise Temperature

```
Energy (kJ) = mass × specific_heat × temp_diff
Power (kW)  = Energy / (hours × 3600)

Where:
  mass = volume × density = 625 m³ × 1000 kg/m³ = 625,000 kg
  specific_heat = 4186 J/(kg·K)
  temp_diff = target - current (°C)
  hours = 1 (one hour recovery time)
```

Example: Raise 625 m³ pool by 1°C in 1 hour:
```
Energy = 625,000 × 4186 × 1 = 2,616,250,000 J = 2,616,250 kJ
Power  = 2,616,250 / 3600 = 727 kW
```

### Heat Losses

#### Evaporation (Carrier Equation)
```
Q_evap = (25 + 19×v) × A × (P_water - φ×P_air) / 3600

Where:
  v = wind speed (m/s)
  A = surface area (m²)
  P_water = saturation pressure at water temp
  P_air = saturation pressure at air temp
  φ = relative humidity (decimal)
```

#### Convection
```
Q_conv = h × A × (T_water - T_air)

Where:
  h = convection coefficient (wind-dependent)
  A = surface area (m²)
```

#### Radiation
```
Q_rad = ε × σ × A × (T_water⁴ - T_sky⁴)

Where:
  ε = emissivity (0.95 for water)
  σ = Stefan-Boltzmann constant
  T = temperatures in Kelvin
```

---

## Equipment Models

### Heat Pump

```php
// Ground Source (Borehole)
- Constant COP regardless of air temperature
- Typical COP: 4.6
- No temperature limits

// Air Source
- COP varies with air temperature
- Reference temp: 15°C
- Below 15°C: COP degrades 2.5% per degree
- Above 15°C: COP improves up to 20%
- Minimum COP floor: 2.0
- Operating range: -20°C to 35°C
```

### Boiler

```php
- Constant efficiency (typically 92%)
- Fuel consumption = heat_output / efficiency
- Always available (no temperature limits)
- Higher operating cost than heat pump
```

---

## Cover Effects

When pool is closed, cover is applied (if configured):

### Heat Loss Reduction
- Evaporation: Reduced to ~5% of open rate
- Convection: Reduced based on cover R-value
- Radiation: Reduced through cover

### Solar Transmission
- Cover transmittance (default 10%)
- Reduced solar gain when covered

---

## Configuration Parameters

### Pool Physical Properties (from `pools` table)
| Parameter | Default | Description |
|-----------|---------|-------------|
| area_m2 | 312.5 | Pool surface area |
| volume_m3 | 625 | Water volume |
| depth_m | 2.0 | Average depth |
| wind_exposure | 0.535 | Wind exposure factor (0-1) |
| solar_absorption | 0.60 | Water solar absorption (60%) |

### Cover Properties (from `pools` table)
| Parameter | Default | Description |
|-----------|---------|-------------|
| has_cover | true | Whether cover is used |
| cover_r_value | 5.0 | Thermal resistance (m²K/W) |
| cover_solar_transmittance | 0.10 | Solar transmission (10%) |

### Equipment (from `project_configs` table)
| Parameter | Default | Description |
|-----------|---------|-------------|
| hp_capacity_kw | 125 | Heat pump capacity |
| hp_cop | 4.6 | Heat pump COP |
| boiler_capacity_kw | 200 | Boiler capacity |
| boiler_efficiency | 0.92 | Boiler efficiency (92%) |

### Control (from `project_configs` table)
| Parameter | Default | Description |
|-----------|---------|-------------|
| target_temp | 28.0 | Target water temperature |
| temp_tolerance | 2.0 | Deadband range (±2°C) |
| strategy | hp_priority | Control strategy |

---

## Simulation Output

Each hour produces:
```json
{
  "timestamp": "2024-06-15 14:00:00",
  "air_temp": 18.5,
  "wind_speed": 3.2,
  "solar_wh_m2": 450,
  "is_open": true,
  "target_temp": 28.0,
  "water_temp_start": 27.2,
  "water_temp_end": 27.8,
  "heat_loss_kw": 85.3,
  "solar_gain_kw": 45.2,
  "hp_heat_kw": 95.0,
  "hp_electricity_kw": 20.7,
  "boiler_heat_kw": 0,
  "unmet_kw": 0
}
```

---

## Best Practices

### Temperature Targets
- Public pool: 26-28°C
- Competition pool: 25-26°C
- Therapy pool: 32-35°C

### Cover Usage
- Always use cover during closed hours
- Reduces evaporation by 95%
- Reduces overnight losses by 60-70%

### Heat Pump Sizing
- Size for 60-70% of peak load
- Boiler handles peaks and emergencies
- Oversized HP = lower efficiency at partial load

---

## Version History

| Version | Changes |
|---------|---------|
| 3.8.0 | Aggressive recovery: recover full deficit in 1 hour |
| 3.7.0 | Initial PHP port from Python v3.6.0.3 |
