# HeatAQ Heating Control Algorithm

**Version:** V103
**Last Updated:** November 2024

---

## Overview

HeatAQ uses a simplified reactive heating algorithm with 100% schedule foresight. The system maintains target water temperature by calculating hourly heat requirements and prioritizing the heat pump for efficiency.

---

## Control Strategies

Only two strategies are supported:

### 1. Reactive (Default)

- Maintains target temperature **always**, regardless of schedule
- Ignores "closed" periods - keeps heating to target 24/7
- Use when pool must always be ready

### 2. Predictive

- Follows schedule: uses target temp when open, setback temp when closed
- During closed hours, maintains a lower "setback" temperature (default 26°C)
- Reduces energy costs by allowing temp to drop when not in use
- Automatically reheats before scheduled opening

---

## Algorithm Logic

The algorithm runs hourly and is straightforward:

```
FOR each hour:
    1. Calculate heat losses (evaporation, convection, radiation, conduction)
    2. Calculate solar gains
    3. Net requirement = losses - solar gains

    4. Compare current temp to target:

       IF currentTemp < targetTemp:
           # Below target - need extra heat to recover
           tempDeficit = targetTemp - currentTemp
           heatToRaise = energy to raise pool by tempDeficit in 1 hour
           requiredHeat = netRequirement + heatToRaise

       ELSE (currentTemp >= targetTemp):
           # At or above target - excess temp offsets losses
           tempExcess = currentTemp - targetTemp
           heatCredit = energy value of excess temp
           requiredHeat = max(0, netRequirement - heatCredit)

    5. Apply heating (always HP first):
       - Heat pump provides up to its capacity
       - Boiler handles overflow if HP capacity exceeded

    6. Update water temperature based on heat balance
```

---

## Key Principles

### No Deadband
Unlike traditional systems with min/max bounds around target, HeatAQ uses direct comparison:
- Below target → Heat to recover
- At/above target → Let excess offset losses

### Temperature Convergence
The algorithm may have small errors because heat loss depends on temperature, which changes as you heat. However, the hourly iteration naturally converges to the correct temperature.

### HP Priority
Heat pump is always used first because:
- Higher efficiency (COP 4.6 vs boiler 0.92)
- Lower operating cost
- Boiler only activates when HP capacity is exceeded

---

## Heat Calculation Formulas

### Energy to Raise Pool Temperature

```
Energy (kJ) = mass × specific_heat × temp_diff
Power (kW)  = Energy / (hours × 3600)

Where:
  mass = volume × density = 625 m³ × 1000 kg/m³ = 625,000 kg
  specific_heat = 4186 J/(kg·K)
  temp_diff = target - current (°C)
  hours = 1 (recover in one hour)
```

**Example:** Raise 625 m³ pool by 1°C in 1 hour:
```
Energy = 625,000 × 4186 × 1 = 2,616 MJ
Power  = 2,616,000 / 3600 = 727 kW
```

### Heat Losses

**Evaporation** (dominant):
```
Q_evap = (25 + 19×v) × A × (P_water - φ×P_air) / 3600
```

**Convection**:
```
Q_conv = h × A × (T_water - T_air)
```

**Radiation**:
```
Q_rad = ε × σ × A × (T_water⁴ - T_sky⁴)
```

---

## Equipment

### Heat Pump (Primary)

| Parameter | Typical Value |
|-----------|---------------|
| Type | Ground source (borehole) |
| Capacity | 125 kW |
| COP | 4.6 (constant for ground source) |

Ground source HP has constant COP regardless of air temperature.
Air source HP has variable COP (degrades in cold weather).

### Boiler (Backup)

| Parameter | Typical Value |
|-----------|---------------|
| Capacity | 200 kW |
| Efficiency | 92% |
| Fuel | Natural gas |

Boiler only runs when HP capacity exceeded.

---

## Configuration

### Pool Properties (from `pools` table)

| Parameter | Description |
|-----------|-------------|
| area_m2 | Pool surface area |
| volume_m3 | Water volume |
| wind_exposure | 0-1 factor for wind protection |
| solar_absorption | Water solar absorption (typically 0.6) |

### Control Settings

| Parameter | Description |
|-----------|-------------|
| control_strategy | 'reactive' or 'predictive' |
| target_temp | Target water temperature (°C) |
| setback_temp | Temperature during closed hours (predictive mode) |

---

## Version History

| Version | Changes |
|---------|---------|
| V103 | Simplified: removed deadband, only reactive/predictive, always HP first |
| V102 | Aggressive recovery: full deficit in 1 hour |
| V101 | Initial documentation |
