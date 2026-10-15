# HeatAQ Heating Control Algorithm

**Version:** V104 (predictive section and control settings updated for simulator 3.17.0)
**Last Updated:** October 2026

> **Predictive control** is specified in [`PREDICTIVE_CONTROL.md`](PREDICTIVE_CONTROL.md)
> (the authoritative description, with a map of the code). This document
> covers the reactive hold-to-target logic and the heat physics; the
> physics code is `lib/EnergySimulator.php` and its TypeScript port
> `sim-ts/src/physics.ts`, which are the reference where this text and the
> code differ.

---

## Overview

The simulator steps hour by hour. Each hour it computes the losses and solar gain, decides the heat to deliver (control strategy), heat pump first and boiler as backup, and updates the water temperature.

---

## Control Strategies

Only two strategies are supported:

### 1. Reactive (Default)

- Maintains target temperature **always**, regardless of schedule
- Ignores "closed" periods - keeps heating to target 24/7
- Use when pool must always be ready

### 2. Predictive

Plans each closed period at closing, with foresight of the weather and the
schedule (full description: [`PREDICTIVE_CONTROL.md`](PREDICTIVE_CONTROL.md)):

- While closed (cover on) the water **coasts down**, not below the minimum,
  and the heat pump starts **as late as possible** so the water reaches the
  required opening temperature exactly at opening.
- The opening temperature is the target, or higher (up to the maximum) when
  some coming open hours need more heat than the heat pump can deliver.
  The boiler never builds this buffer.
- While open, the heat pump banks heat only up to the last such hour, then
  the pool holds target. The boiler only backs up the target.

(There is no "setback temperature": that was an older model.)

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

**Evaporation** (dominant) — Inan & Atayilmaz (2022):
```
E      = (0.28 + 0.784×v_eff) × Δp^0.695 / L_v      [kg/(m²·s)],  L_v = 2 454 000 J/kg
Q_evap = E × A × L_v / 1000                          [kW]
```
where `Δp = P_water − φ×P_air` (Magnus formula), `v_eff = wind × exposure_factor`,
and an activity factor is applied while the pool is open.

**Convection** — Bowen ratio (coupled to evaporation):
```
Q_conv = Bo × Q_evap,   Bo = (c_p × p_atm × ΔT) / (0.622 × L_v × Δp)
```

**Radiation**:
```
Q_rad = ε × σ × A × (T_water⁴ - T_sky⁴),   T_sky ≈ T_air − 10 °C,  ε = 0.95
```

### Cover Heat Loss Reduction

Pool covers significantly reduce heat losses. The simulator calculates reduction factors for each loss type:

| Cover Type | Evaporation | Convection | Radiation | Conduction |
|------------|-------------|------------|-----------|------------|
| None | 0% | 0% | 0% | 0% |
| Bubble | 95% | 50% | 40% | 30% |
| Foam | 98% | 70% | 60% | 50% |
| Automatic | 90% | 60% | 50% | 40% |
| Liquid | 40% | 10% | 5% | 0% |

The cover breakdown is shown in the Details tab when debug mode is enabled:
- **Evaporation saved**: Heat retained by reducing evaporation
- **Convection saved**: Heat retained by reducing convective transfer
- **Radiation saved**: Heat retained by reducing radiative losses
- **Total saved**: Sum of all cover savings (subtracted from gross losses)

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
| target_temp | Default target water temperature (°C); schedule periods may set their own |
| target_offset | SimControl offset added to every target |
| upper_tolerance / lower_tolerance | Max / min temperature around the target (predictive), unless the pool sets max_temp / min_temp |
| standby_temp | Temperature held during long closures (predictive) |

---

## Version History

| Version | Changes |
|---------|---------|
| Simulator 3.17.0 | Predictive: late start in every closed period, buffer sized hour by hour, banking only to the last short hour (see PREDICTIVE_CONTROL.md §8) |
| V104 | Added cover heat loss breakdown documentation |
| V103 | Simplified: removed deadband, only reactive/predictive, always HP first |
| V102 | Aggressive recovery: full deficit in 1 hour |
| V101 | Initial documentation |
