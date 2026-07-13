# HeatAQ Predictive Control Strategy

**Status:** Target specification (agreed design). Parts of this are **not yet
implemented** — see [Current code vs. this spec](#current-code-vs-this-spec).
**Last updated:** 2026-07-13

This document describes how the **predictive** control strategy is *intended* to
behave. It exists because the behaviour comes up regularly and the previous
notes (`HEATING_ALGORITHM.md`) describe an older "setback temperature" model that
no longer reflects the design.

---

## 1. Goal and principles

**Goal: minimise heating cost** while guaranteeing the pool is at least at
target temperature whenever it is open.

The core levers:

1. **Build a thermal buffer while the cover is on.** When the pool is *closed*
   the cover is on and heat loss is low, so heating then is cheap. When the pool
   is *open* the cover is off and loss is high. So we pre-store heat in the water
   during closed periods to carry the pool through open periods the heat pump
   cannot cover on its own.
2. **Heat pump only for buffering.** The buffer is *always* built with the heat
   pump. **The boiler never runs to build buffer.** The boiler is only a
   backstop *during open periods*, used when even a fully-primed buffer plus the
   heat pump cannot hold target.
3. **Heat as late as possible.** A warmer pool loses heat faster. So during a
   closed period we let the water coast down (never below the configured
   minimum) and start the heat-pump ramp at the *latest* moment that still
   reaches the required temperature by opening. This minimises the time spent
   hot, and therefore the loss.

> **Open vs. closed, not day vs. night.** Closed periods are *not* only at
> night — a pool may close midday. Everything here keys off the cover
> (open/closed), never the time of day.

---

## 2. Vocabulary

| Term | Meaning |
|------|---------|
| **Open period** | Cover off, pool in use. High heat loss. Must stay **≥ target**. |
| **Closed period** | Cover on. Low heat loss. Free to float between **min** and **max**. The window in which buffer is built. |
| **Target** | Desired pool temperature (from config; see [known disconnects](#7-known-disconnects)). |
| **Max temp** | Configured maximum allowable pool temperature. Hard cap on preheat. |
| **Min temp** | Configured minimum allowable pool temperature. Floor the water may coast down to while closed. |
| **Thermal mass rate** | kWh needed to change the pool temperature by 1 °C. Converts between °C of buffer and kWh of stored energy. |
| **Buffer** | Stored energy = `(water_temp − target) × thermal_mass_rate`. Positive above target. |
| **Preheat flag** | Per-closed-period boolean set by the planner: "this closed period must build buffer for the coming open period." Carried into the open period. |

---

## 3. The two regimes

Every closed→open cycle falls into one of two regimes, decided at the **close**
transition by looking ahead to the next opening.

### Regime A — No preheat  (open demand ≤ heat-pump capacity)

The heat pump can cover the whole open period by itself.

- **Closed:** hold at target. No buffer built. `preheat = false`.
- **Open:** heat pump modulates to match losses. Water fluctuates around target
  and ends the open period at target.

This is correct in the current code and does not change.

### Regime B — Preheat  (open demand > heat-pump capacity)

The heat pump *cannot* keep up once the pool opens, so we bank a buffer first.

- **Closed:** compute how much buffer is needed, raise the water to that level
  with the **heat pump only**, as **late as possible**. `preheat = true`.
- **Open:** run the **heat pump at full** for the whole period; the water coasts
  down from its elevated start toward target, the buffer covering the gap the
  heat pump can't. If the buffer was capped (see below) and still runs out, the
  **boiler** holds target for the remainder of the open period.

---

## 4. Planning a closed period (the CLOSE transition)

Executed once, the moment the pool closes. Full foresight over the closed period
and the next open period is assumed (hourly forecast available; live forecasts
are a later addition).

> **What counts as demand.** Demand is `losses − solar`, exactly what the
> hourly balance heats for. Bather/refill load is **not** included: the
> current simulation does not add it to the pool heat balance, so preheating
> for it would push the water above target. Folding refill cooling into the
> hourly balance (and hence the plan) is a separate, larger change.

```
1. Find the next opening. Get its duration and hourly forecast.

2. Estimate the OPEN-period demand:
     open_demand   = Σ (losses − solar) over the open hours   [cover OFF]
     hp_deliverable = Σ heat-pump output over the open hours   [hourly COP]

3. IF open_demand ≤ hp_deliverable:
     REGIME A — preheat = false. Hold at target through the closed period. DONE.

4. ELSE  (REGIME B — preheat = true):

   a. Size the buffer:
        buffer_energy = open_demand − hp_deliverable            [kWh the HP can't supply]
        T_req         = target + buffer_energy / thermal_mass_rate
        T_req         = min(T_req, max_temp)                     [cap]

   b. Late-start schedule (heat pump only):
        Working BACKWARD from the opening, find the latest hour t_start such that
        running the heat pump flat-out from t_start reaches T_req by opening,
        given each hour's losses (cover on) and COP.
        Before t_start the water is allowed to COAST DOWN — but never below
        min_temp. If the coast would breach min_temp, the heat pump maintains
        min_temp until t_start (lowest-loss holding point).

   c. If even starting immediately at full heat pump cannot reach T_req by
      opening (closed period too short): reach as high as possible; the shortfall
      is carried by the BOILER during the open period (step 6b).

5. Set preheat flag + T_req on the plan; carry both into the open period.
```

Phases of a Regime B closed period, in order: **coast down → (hold at min if
reached) → ramp to T_req with full heat pump → open at T_req.**

---

## 5. Executing an open period

```
6. IF preheat flag is set (Regime B):
     a. Run the HEAT PUMP AT FULL every hour. Do NOT throttle because the water
        is currently above target — the buffer must survive to the end of the
        period. (See "why full", below.)
     b. Water coasts from T_req toward target. If the buffer is exhausted before
        the period ends (only happens when T_req was capped at max_temp), the
        BOILER makes up the difference to hold target.

   ELSE (Regime A):
     Heat pump modulates to match losses; hold target.
```

### Why full, not a reduced average rate

The buffer is only built because open demand exceeds heat-pump capacity. If the
controller throttles the heat pump early — "I'm above target, I can ease off" —
it spends the buffer up front. When demand is **back-loaded** (a colder, windier
afternoon), the water is already down at target with no buffer left, and the
only option is the boiler (or undershooting target). Running the heat pump at
full from the start banks the buffer for the late peak. This is why the decision
is a **flag set at close time**, not something the open planner re-infers hour by
hour from `water_temp − target`.

---

## 6. Edge cases

| Situation | Behaviour |
|-----------|-----------|
| Open demand ≤ HP capacity | Regime A. No preheat, hold target. |
| `T_req` exceeds `max_temp` | Cap at `max_temp`. Buffer will be insufficient; boiler backstops during the open period. |
| Closed period too short to reach `T_req` | Heat as high as the heat pump can; boiler backstops during the open period. |
| Coast would drop below `min_temp` | Heat pump holds `min_temp` until the late-start ramp begins. |
| Boiler during a closed period | **Never.** Buffer is heat-pump-only. |

---

## 7. Known disconnects

These are acknowledged gaps to resolve later; documented so they are not
mistaken for the intended design.

1. **Target source: schedule vs. config.** The correct source of target
   temperature is the **schedule** (each period can carry its own target). Today
   the predictive planner reads the **config** target. Intended future state:
   drive from the schedule, with config as an option. **For now, config is
   used** — this document assumes config target/min/max.
2. **Min/max representation.** In the config UI the allowed range is derived as
   `target − lower_tolerance … target + upper_tolerance`
   (`configuration.js:353`), while the simulator reads standalone
   `poolConfig['min_temp']` / `['max_temp']` fields
   (`EnergySimulator.php:1530`). These two representations need to be reconciled
   into one source of truth.

---

## 8. Current code vs. this spec

As of this writing the implementation is a simplified stand-in and **diverges**
from the strategy above. The divergences:

| Area | This spec | Current code |
|------|-----------|--------------|
| Preheat decision | Conditional on `open_demand > hp_capacity` | **Unconditional** — always preheats (`planClosedPeriod`, `EnergySimulator.php:1575`) |
| Preheat level | `min(target + deficit/thermal_mass, max_temp)` | Fixed `target + upper_tolerance` (`:1575`) |
| Closed-period start | Latest possible (late-start) | **Immediate** — "start heating immediately" (`:679`) |
| Closed-period boiler | Never | Has a boiler path (`:1615`) |
| Open-period, preheated | Heat pump at **full** | Reduced **average** rate spread over the period (`calculateOpenPlanRates`, `:1676`) |
| No-preheat regime | Hold target, modulate | ✅ Matches |
| Coast floor | Config `min_temp` | Not applied in the closed plan |
| Preheat flag | Explicit flag carried close→open | Open planner re-infers from `water_temp − target` |

The stored `case` numbers in the current plan (`:1610`) decide only whether the
*closed-period* heating needs the boiler; they are **not** the demand-driven
regimes described here.

### Symptom this explains

"Target is 27 but the pool sits at 28." The current code preheats every closed
period to `target + upper_tolerance` (27 + 1 = 28) and holds it there, rather
than only preheating when the open period actually needs it. Under this spec a
pool whose open demand fits within the heat pump would stay at 27 (Regime A).

---

## 9. Config parameters

| Parameter | Role in predictive control |
|-----------|----------------------------|
| `control_strategy` | Must be `predictive`. |
| `target_temp` | Setpoint the pool holds when open; floor of the buffer. |
| `max_temp` | Hard cap on preheat temperature. |
| `min_temp` | Floor the water may coast to while closed. |
| `hp_capacity_kw` | Determines whether a given open period needs preheat. |
| `boiler_capacity_kw` | Open-period backstop only. |
| thermal mass (from pool volume) | Converts °C of buffer ↔ kWh of stored energy. |

---

*Companion docs: `HEATING_ALGORITHM.md` (loss/gain physics — note its
"predictive/setback" section predates this design), `SYSTEM_ARCHITECTURE.md`.*
