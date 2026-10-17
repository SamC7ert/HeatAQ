# HeatAQ Predictive Control Strategy

**Status:** Implemented. Simulator **3.19.0** (`sim-ts/src/engine.ts`, the
only engine; it runs in the browser).
**Last updated:** 2026-10-16

This is the reference for how the **predictive** control strategy behaves and
why. Read §0 first if you are going to change the code.
`HEATING_ALGORITHM.md` covers the loss/gain physics and the reactive
strategy.

---

## 0. Where the code is

All in `sim-ts/src/engine.ts` (until 3.19.0 a PHP engine,
`lib/EnergySimulator.php`, mirrored it; it now only prepares runs: data
loading, validation, `exportRunInputs()`).

| What | Where |
|------|------|
| Hourly loop, close/open transitions, choice of heating mode | `Run.run()` |
| Collect planning inputs at a close | `Run.planClosedPeriod()` |
| **The plan itself (pure math)** | `computeClosedPlan()` (exported) |
| Closed hour: heat pump to a hold level | `Run.heatPumpToHold()` |
| Open hour while banking | `Run.openPreheatHeating()` |
| Open hour, hold target (also reactive) | `Run.calculateHeating()` |
| Long closure | `Run.standbyHeating()`, `Run.standbyPlanStart()` |
| Planning on forecasts (§11) | `Run.newestRunAt()`, `selectPlanRun()`, `planningRow()` |
| Details hour panel | `debugHour()` (exported) |
| Strategy rules every hour must satisfy | `sim-ts/src/rules.ts` |

**Rules for changing it.**
1. Make the change in `sim-ts/src/` and bump `PORT_OF_VERSION`.
2. Run the plan unit test: `node sim-ts/test/closed_plan.mjs`.
3. Follow "Releasing a new simulator version" in `tests/reference/README.md`.
   The engine reference set lists every scenario the change affects, and
   checks the strategy rules on every hour. Every change it reports must be
   explained; a change meant to alter a rule changes the rule
   (`rules.ts`) in the same commit, with the reason.

---

## 1. Goal and principles

**Goal: minimise heating cost** while the pool is at least at target
temperature whenever it is open.

1. **Heat while the cover is on.** Losses are low when the pool is closed
   (cover on) and high when it is open. Heat stored in the water before
   opening carries open hours the heat pump cannot cover alone.
2. **Heat pump only for storing heat.** Stored heat ("buffer") is always made
   by the heat pump. **The boiler never runs to build a buffer.** It is only
   a backstop during open hours, to hold target.
3. **Heat as late as possible.** Warmer water loses more. In **every** closed
   period the water coasts down (not below the minimum) and the heat pump
   starts at the latest hour that still reaches the opening temperature.
   This also applies when the opening temperature is just the target.
4. **Store only what is needed, only while it is needed.** The opening
   temperature is sized hour by hour over the coming open period. During
   the open period the heat pump banks extra heat only up to the period's
   last hour it cannot cover alone. After that hour the pool just holds
   target.

> **Open vs. closed, not day vs. night.** Closed periods are not only at
> night; a pool may close at midday. Everything keys off the cover
> (open/closed), never the time of day.

> **Local time.** Weather and solar data are stored in UTC. Schedules are
> local clock times, so each weather hour is converted to the site's local
> time (zone from the site's coordinates, `lib/SiteTimezone.php`) for
> schedule lookups, daily totals and the hours reported.

---

## 2. Vocabulary

| Term | Meaning |
|------|---------|
| **Open period** | Cover off, pool in use, high heat loss. Water must stay **≥ target**. |
| **Closed period** | Cover on, low heat loss. Water may float between **min** and **max**. |
| **Target** | The open period's temperature: schedule period target, or config default, plus the SimControl offset (§7.1). |
| **Max temp** | `target + Max overheat` (`upper_tolerance`, default 1 °C; `maxTemp()`). Caps the opening temperature and banking. |
| **Min temp** | "Min temp when closed" (`standby_temp`), else the 5 °C frost floor, never above target (`closedFloor()`). The lowest the water may drop while closed: overnight, over a weekend or during a long closure. |
| **Thermal mass rate (tmr)** | kWh to change the pool 1 °C (from volume). Converts °C ↔ kWh. |
| **Deficit** (open hour *k*) | `demand[k] − hp_full[k]`, in kW (= kWh in the hour). Demand = losses − solar (cover off); `hp_full` = heat pump output at full capacity (hourly COP / limits). |
| **Short hour** | An open hour with a positive deficit: the heat pump alone cannot cover it. |
| **t_req** | Temperature the water must have at opening. ≥ target, ≤ max. |
| **Buffer energy** | `(need − target) × tmr`: the kWh above target needed at opening, before the max cap. |
| **Late start** | The latest closed hour from which the heat pump at full still reaches t_req at opening. |
| **Bank hours** | Open hours, counted from the opening, up to and including the last short hour. |

---

## 3. One cycle at a glance

```
 CLOSE ───────────────────────────────────────── OPEN ─────────────────────────────── CLOSE
   │  preheat_coast            │ preheat_ramp      │ open_preheat         │ open_hold     │
   │  heat pump off; water     │ heat pump towards │ heat pump towards    │ hold target   │
   │  drifts down, held at     │ t_req, reached at │ max (banking); boiler│ (heat pump,   │
   │  min_temp if it gets there│ opening           │ only if water ≤ target│ boiler backup)│
   │                           │                   │← bank hours: up to   │               │
   │                           │                   │  the last short hour→│               │
```

`heating_mode` values (recorded in each simulated hour, shown in Details):

| Mode | When | Heating |
|------|------|---------|
| `preheat_coast` | Closed, before the late start | Heat pump only if the water would fall below `min_temp` |
| `preheat_ramp` | Closed, from the late start to opening | Heat pump to reach `t_req` (never above it) |
| `open_preheat` | Open, up to and including the last short hour | Heat pump towards `max_temp`; boiler only when the water is at or below target |
| `open_hold` | Open, no short hour ahead (or after the last one) | Heat pump to hold target, boiler for what it cannot cover; water above target drifts down |
| `standby` | Long closure, opening beyond the planning horizon | Hold `standby_temp` (heat pump, boiler backup), if one is set |
| `reactive` | Reactive strategy, or no plan possible | Hold target always |
| `closed_hold` | Not produced by a run; appears in the Details replay when the stored hours end before the next opening, and in the one-hour debug recalculation (steady-state approximation) | – |

The first opening of a run that starts closed gets a plan too: a plan is
made at the first hour if the run starts in a closed period.

---

## 4. Planning a closed period (at the CLOSE transition)

`planClosedPeriod()` runs once when the pool closes, and at the first hour
of a run that starts closed. It assumes full foresight of the weather (the
simulation has it; a live controller would use a forecast). Losses in the
plan are computed at the target temperature.

```
1. Next opening: from the schedule. Its target gives target / min / max.

2. Closed hours, until the opening (cover on):
     closedLoss[i]  = losses − solar
     closedHpOut[i] = heat pump output at full

3. Open hours, from the opening while the pool stays open, max 48 (cover off):
     deficit[k] = (losses − solar) − heat pump output at full

4. computeClosedPlan():

   a. Opening temperature, worked BACKWARD over the open hours:
          need = target
          for k = last … first:   need = max(target, need + deficit[k] / tmr)
          t_req         = min(need, max_temp)
          buffer_energy = (need − target) × tmr
      need is the temperature required at the start of hour k so that,
      with the heat pump at full, the water never drops below target from
      there on. A short hour raises it; a surplus hour (deficit < 0) before
      it lowers it, because the heat pump banks heat in that hour. If every
      hour is covered, t_req = target.

   b. Late start (heat pump only, also when t_req = target):
          coast[i] = water temperature with the heat pump off,
                     floored at min_temp
          start    = latest closed hour s from which the heat pump at full
                     (capped at max) reaches t_req − 0.01 at opening
      If no hour reaches it (closed period too short): start = 0, and the
      water gets as high as it can.

   c. bank_hours = index of the last short hour + 1  (0 if none).
```

**Why hour by hour, not totals.** The old planner (before 3.17.0) compared
the open period's total demand with the heat pump's total output. If the
totals balanced it planned nothing, yet a single cold hour can still exceed
the heat pump while other hours have spare capacity. That hour then fell
below target and the boiler came on.

**Worked example** (`sim-ts/test/closed_plan.mjs`, cases C3/C4): tmr = 100
kWh/°C, target 27 °C, an open period of two hours whose totals balance.

| Open hours (deficit, kW) | need at opening | t_req | bank hours | Why |
|---|---|---|---|---|
| `[+100, −100]` (short hour first) | 27 + 100/100 = **28** | 28 | 1 | The first hour needs 1 °C stored before opening |
| `[−100, +100]` (short hour last) | max(27, 28 − 1) = **27** | 27 | 2 | Heat banked in hour 1 carries hour 2 |

The old total-based planner planned no buffer for either.

---

## 5. Executing an open period

At the OPEN transition the plan's `bank_hours` is carried into the open
period (`openPreheat = bank_hours > 0`, banking ends at opening index +
`bank_hours`). Then, per hour:

```
IF the hour is before the end of banking  →  open_preheat:
     heat pump towards max_temp (it never throttles because the water is
     above target: the banked heat is needed for the short hour still to
     come); when the water is at or below target, the boiler supplies what
     the heat pump does not to bring it back to target this hour.
ELSE                                      →  open_hold:
     hold target with heat pump first, boiler backup; water above target
     drifts down to it.
```

**Why stop banking after the last short hour.** Nothing ahead needs the
extra heat, and a warmer pool only loses more. Until 3.17.0 banking ran to
the end of the open period, and the pool closed up to about 1 °C above
target.

---

## 6. Edge cases

| Situation | Behaviour |
|-----------|-----------|
| Heat pump covers every open hour | `t_req = target`, no banking; still coast and late start. |
| `t_req` would exceed `max_temp` | Capped at `max_temp`; the boiler backstops the open hours the buffer cannot carry. |
| Closed period too short to reach `t_req` | Heat pump from the first closed hour; the boiler backstops at opening. |
| Coast would drop below `min_temp` | Heat pump holds `min_temp` until the late start. |
| Boiler during a closed period | **Never** for a buffer; only to hold the min temp during a long closure (below). |
| Long closure (next opening beyond 30 days) | No plan can be made. The pool holds the min temp when closed (`standby_temp`; heat pump, boiler backup) if set, else is unheated (5 °C floor). Once a day the simulator estimates how long the heat pump needs to reach the next opening's target; when that time (+12 h) has come, the normal plan starts. |
| No heat pump | No buffer is possible; the run uses reactive control (`strategy_used` in the summary). |
| Open period longer than 48 h | The plan looks at the first 48 open hours. |

---

## 7. Known disconnects

1. **Target source: resolved (3.12.0).** Every open hour's target is
   `(schedule period target ?? config default target) + SimControl offset`,
   resolved in one place (`PoolScheduler::setTargetSettings`, fed by
   `EnergySimulator::syncSchedulerTargets`). Hourly control, planning,
   Details and the comfort statistics all use it. Comfort statistics count
   days with an open hour more than 1 / 2 °C below that hour's target.
2. **Min/max representation: resolved (3.18.0).** Max = target + Max
   overheat; min while closed = "Min temp when closed". The former lower
   tolerance (a second, relative floor) and the unused pool-level
   `max_temp` / `min_temp` overrides are gone.
3. **Bather loads are not in the heat balance (decided: leave for now, do
   not forget).** Bathers/day, refill and shower water are config inputs,
   but neither the hourly balance nor the planner adds the refill/shower
   load. Only `activity_factor` (an evaporation multiplier) has an effect.
4. **Planning approximations.** The plan computes losses at the target
   temperature, while the water is warmer while banking. Losses are
   therefore slightly underestimated, and the boiler may make up a small
   remainder. With Planning weather = Actual the plan knows the weather
   exactly (hindsight, the best case); with Forecast it plans on the
   forecasts available at the time, as a live controller would (§11).

---

## 8. History of the strategy

**3.19.0** added Planning weather (§11): plans can read the forecasts that
were available at the time instead of the actual weather, and plan again
when a newer forecast arrives. With Planning weather = Actual (the default)
every result is identical to 3.18.0.

**3.17.0 (October 2026)** fixed three faults found on cold winter nights:

| Before | Now |
|--------|-----|
| When the heat pump could cover the open period's **total**, the closed period **held target all night**: it heated at once after closing and kept the pool warm. | Every closed period coasts and starts the heat pump as late as possible (§4b). |
| Buffer sized on totals (open demand − heat pump output): no buffer when totals balanced, even with short hours, so the boiler ran. | Buffer sized hour by hour (§4a). |
| After a preheat, the heat pump banked towards max for the **whole** open period. | Banking stops after the last short hour (§5). |

**3.18.0** merged the two floors for closed hours into one setting,
"Min temp when closed" (formerly Standby temp). The lower tolerance (target
− 2 °C) was a second floor. With the late start it was hardly ever reached
overnight, and on closures of several days it kept the water warmer than
needed. Effect: long-closure scenarios −0.8 % and −1.7 % cost, everything
else identical, same comfort.

**3.17.1** fixed a fault the reference set exposed. While banking, the
boiler only covered the losses the heat pump could not. Water already below
target (after a night the heat pump could not keep up) stayed below it
whenever the heat pump covered the losses alone. The boiler now restores
target, as when holding target.

Effect of 3.16.1 → 3.17.1 on the engine reference set (`tests/reference`,
Røros weather; `reference.php changes 3.16.1 3.17.1`):

| Scenario | Cost | Boiler heat | Days > 1 °C below target |
|---|---|---|---|
| Predictive, 2 years | −5.6 % | −51 % | 0 → 0 |
| Predictive, target offset +1.5 °C | −5.4 % | −30 % | 0 → 0 |
| Predictive, air-source heat pump | −3.1 % | −52 % | 0 → 0 |
| Predictive with long closures | −2.0 % | −20 % | 0 → 0 |
| Predictive without cover (plant too small in winter) | +2.7 % | +7 % | 81 → 70 |
| Predictive, undersized (80 kW, no boiler) | +0.2 % | – | 245 → 244 |
| Reactive, no heat pump | unchanged | unchanged | – |

Earlier: 3.12.0 resolved targets per hour (§7.1). The first implementation
of this strategy replaced an older "setback temperature" model, which
`HEATING_ALGORITHM.md` used to describe.

---

## 9. Config parameters

| Parameter | Role in predictive control |
|-----------|----------------------------|
| `control_strategy` | Must be `predictive`. |
| `target_temp` | Default target for open periods whose schedule has none (§7.1). |
| schedule period target | Target of that open period. |
| `target_offset` | SimControl adjustment added to every resolved target (−5…+5 °C). |
| Max overheat (`upper_tolerance`) | Max temp = target + this: cap on the opening temperature and on banking. |
| Min temp when closed (`standby_temp`) | The lowest the water may drop while closed: coast floor on every closure, held during long closures (blank = none, 5 °C frost floor). |
| heat pump capacity / type / limits | Hourly heat pump output: decides the short hours and the late start. |
| `boiler_capacity_kw` | Open-period backstop only. |
| pool volume | Thermal mass rate: converts °C ↔ kWh. |
| Planning weather (`planning_weather`) | `actual` (default): plans read the actual weather ahead. `forecast`: the forecasts available at the time (§11). Set per run on the Simulate tab; saved with the run. |

---

## 10. Checking the behaviour

- **Unit test of the plan:** `node sim-ts/test/closed_plan.mjs` (late start
  without buffer, cap at max, short hour first/last, too-short closure,
  coast floor).
- **Engine reference set and strategy rules:** `node sim-ts/test/reference.mjs
  check` (scenarios with frozen inputs, and the strategy rules checked on
  every hour; `node sim-ts/test/rules.mjs` checks each rule catches a broken
  run; see `tests/reference/README.md`). In the app: Admin → System → Engine
  Verification, in the browser on the live site.
- **Look at a night in the app:** Details tab, week chart (heat pump and
  boiler bars, water temperature). The hours are computed in the browser
  from the run's saved inputs when they are not saved. With debug mode on,
  the hour panel shows the heating mode.
- **Hour by hour from the command line** (TypeScript engine, inputs from
  `get_sim_inputs`):
  ```js
  const sim = require('./sim-ts/dist/heataq-sim.cjs');
  const r = sim.runSimulation(inputs);
  // r.hourly rows: [timestamp, air, wind, humidity, solar, target, water,
  //   water_start, is_open, loss_kw, solar_kw, hp_kw, boiler_kw, hp_elec,
  //   boiler_fuel, cop, cost, heating_mode, effective_target]
  ```

---

## 11. Planning on forecasts

A plan looks at the weather of the hours ahead (§4): the closed hours until
opening and the coming open period. With **Planning weather = Actual** it
reads the actual weather of those hours. A real controller cannot: it only
has the forecast. Actual is therefore the best case (hindsight). With
**Planning weather = Forecast** the plan reads the forecast that was
available at the time, so the result shows what a real controller would
achieve. Comparing two runs that differ only in this setting gives the cost
of forecast error (e.g. extra electricity) for that site and period.

**Data.** Archived MET Nordic forecasts (MET Norway, 1 km, runs at 00, 06,
12 and 18 UTC, hourly steps), interpolated to the site's weather station and
stored in `weather_forecasts` (migration 042). Fetched by the server from
MET's archive in Admin → Weather → Weather Forecasts
(`lib/MetNordicForecast.php`), or on a PC with
`scripts/forecast/fetch_met_nordic.py` and imported there; see
`scripts/forecast/README.md` (also for runs missing from the archive,
`weather_forecast_misses`). Each run has an
**available_at** time (its file's creation time, about 30 minutes after the
nominal run time).

**What changes in the engine** (`sim-ts/src/engine.ts`: `newestRunAt`,
`selectPlanRun`, `planningRow`; the forecasts are loaded by
`EnergySimulator::getForecastData` when the run is prepared):

1. **Which forecast.** A plan made at hour T reads the newest run with
   `available_at <= T` whose hours still reach T. If there is none (a gap
   in the archive), the plan reads the actual weather and is counted as
   "without forecast" in the report.
2. **What it replaces.** Air temperature, wind and humidity of the planned
   hours. Solar gain and the tunnel temperature are still the actual ones
   (the solar data are NASA values, and the forecast's solar is not used
   yet). Past the run's last hour the last forecast hour is held (counted).
3. **Re-planning.** During a closed period, when a newer run becomes
   available, the plan is made again from the current water temperature
   (§4: coast, late start, t_req, bank_hours), as a live controller would.
   The last plan before opening decides the opening temperature and
   bank_hours.
4. **Long closures.** The daily check of when to start planning
   (`standbyPlanStart`) reads the newest forecast too.
5. **Everything else** (losses, heat pump, boiler, water temperature of
   each hour) uses the actual weather, as before.

With Planning weather = Actual, none of this runs: results are identical to
3.18.0 (all reference scenarios).

**Report.** Simulation Report → "Planning weather: Forecast (MET Nordic)";
the mouse-over gives the number of plans, re-plans, average forecast age
and hours past a forecast's end. Plans without a forecast appear as a data
quality warning. Summary fields: `planning_weather`, `forecast_source`,
`forecast_plans`, `forecast_replans`, `forecast_plans_without`,
`forecast_age_h_avg`, `forecast_hours_beyond` (only on forecast runs).

**Saved runs.** The setting is saved with the run (configuration snapshot),
and the run's inputs (`exportRunInputs`: what the engine runs on, Details
and the reference set) include the forecast runs. Details recomputes the
hours with the forecasts in the database at that time: a re-import that
changes them makes the recomputed hours differ from the stored days (the
hours-on-demand check reports it).
