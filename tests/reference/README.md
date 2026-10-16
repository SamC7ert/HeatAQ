# Engine reference set

A fixed set of simulation scenarios with **frozen inputs**, the results
each simulator version gives for them, and **strategy rules** every hour
must satisfy. It answers three questions:

1. **Is this engine correct for its version?** A version must reproduce its
   own stored results exactly, here and in every browser (Admin → Engine
   Verification), including on the live site.
2. **Does the heating strategy do what it should?** The strategy rules
   (`sim-ts/src/rules.ts`) are checked on every hour of every scenario:
   late start, no boiler while closed, boiler only with the heat pump at
   full, no heating above the level aimed for, banking only before holding
   target, opening temperature reached when the heat pump could, and the
   heat balance of every hour.
3. **What did a new version change?** The stored results of two versions
   show exactly which scenarios changed and by how much (cost, boiler heat,
   comfort...).

Because the inputs never change (weather, solar data, configuration and
schedule are saved with each scenario), a difference between two versions
comes from the engine only.

There is one engine, the TypeScript one in `sim-ts/` (it runs in the
browser). Results up to 3.19.0 were also produced, identically, by the
former PHP engine.

## Files

| File | Content |
|------|---------|
| `scenarios.json` | The scenarios: `id`, `title`, `description`, period. |
| `inputs/<id>.json.gz` | Frozen inputs of a scenario, as `EnergySimulator::exportRunInputs()` writes them (what the engine runs on). |
| `results/<version>.json.gz` | Results of every scenario for one simulator version, in the "reference result" form below. **Never changed once the version is released.** |
| `../../sim-ts/test/reference.mjs` | Command-line tool. |
| `../../sim-ts/test/rules.mjs` | Checks that each strategy rule catches a deliberately broken run. |
| `../../sim-ts/src/reference.ts`, `../../sim-ts/src/rules.ts` | The reference form, its comparison, and the strategy rules. `lib/ReferenceCheck.php` serves the files to the Admin page and compares two stored versions with the same rules. |

**Reference result** of a scenario:
- `summary`: every summary value;
- `days`: the daily results as stored (`simulation_daily_results` rounding):
  `[date, hours, open_hours, avg_air, avg_water, loss, solar, hp_elec,
  boiler_fuel, hp_heat, boiler_heat, cost]`;
- `hours`: per hour, water temperature, heat pump heat and boiler heat
  (2 decimals), and the heating mode as one letter (`c` preheat_coast,
  `r` preheat_ramp, `p` open_preheat, `h` open_hold, `s` standby,
  `x` reactive, `k` closed_hold).

**Comparison:** `identical` (every value equal), `rounding` (values differ
only in the last rounded digit, 0.011 at most, e.g. between browsers), or
`differs`.

## Commands

From `sim-ts/`, after `npm run build`:

```
node test/reference.mjs check                  # engine vs this version's stored results + strategy rules
node test/reference.mjs changes 3.17.0 3.17.1  # what a version changed
node test/reference.mjs write                  # store this version's results (refused if a rule breaks)
node test/reference.mjs add ID "Title" "Description" inputs.json   # new scenario
node test/rules.mjs                            # every rule catches its case
npm test                                       # build, rules.mjs, reference check
```

In the app, **Admin → System → Engine Verification** runs every scenario in
the browser, compares it with the stored results, checks the strategy rules,
and shows what the current version changed compared with the previous one.
Run it after each deployment, and once in each browser you use.

## Releasing a new simulator version

When the simulation logic changes:

1. Make the change in `sim-ts/src/` and bump `PORT_OF_VERSION`
   (`sim-ts/src/engine.ts`).
2. `npm run typecheck && npm run build`.
3. `node test/reference.mjs check`. With no stored results for the new
   version yet, it compares with the previous version and lists every
   scenario that changed. **Each change must be explained by the change you
   made.** An unexplained change is a bug. Every strategy rule must hold;
   if the change is meant to alter a rule, change the rule in `rules.ts`
   (and its case in `test/rules.mjs`) in the same commit, with the reason.
4. `node test/reference.mjs write` stores the new version's results.
5. Record the effect: `node test/reference.mjs changes OLD NEW`, and
   summarise it in the docs (e.g. `docs/PREDICTIVE_CONTROL.md` §8 for
   control changes).
6. Commit the code, the bundle (`assets/js/sim/`) and `results/NEW.json.gz`
   together. After deploying, run Engine Verification in Admin.

A released version's results file is never rewritten. `write` refuses to
overwrite one; `--force` exists only for a version that has not been
released yet.

## Adding a scenario

Use run detail → **Export inputs** (History tab) to download a run's inputs,
then `node test/reference.mjs add ID "Title" "Description" file.json`.
Earlier versions' results do not include the new scenario. It is compared
from the next stored version on, or from the current one if you store it
with `write --force` before release.

## History

- **3.16.1**: results produced with the TypeScript port of 3.16.1, which is
  identical to the PHP engine of that version; the reference set was
  introduced after it.
- **3.17.0**: predictive control: late start every night, hourly buffer,
  banking only to the last short hour (`docs/PREDICTIVE_CONTROL.md` §8).
- **3.17.1**: while banking during open hours, the boiler also restores
  target when the water is below it. In 3.17.0 the water could stay below
  target whenever the heat pump covered the losses alone. Only the no-cover
  scenario changed noticeably: days more than 1 °C below target 84 → 70,
  cost +6.4 %.
- **3.18.0**: one floor for closed hours, "Min temp when closed" (standby
  temp); the lower tolerance is gone. Changed: predictive-standby-2y −0.8 %
  and predictive-new-pool −1.7 % cost (closures of several days),
  predictive-no-cover marginally; comfort unchanged everywhere.
- **3.19.0**: Planning weather (`docs/PREDICTIVE_CONTROL.md` §11): plans can
  read the forecasts available at the time. All 13 earlier scenarios are
  identical to 3.18.0 (they plan on the actual weather). New scenario
  `predictive-forecast` (January-February 2025, MET Nordic forecasts in its
  inputs) covers planning on forecasts and re-planning. Its weather is the
  test database's, which does not match the real Røros weather the forecasts
  are for, so its forecast errors are large: it tests the engine, not the
  cost of forecast error.
