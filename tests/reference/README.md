# Engine reference set

A fixed set of simulation scenarios with **frozen inputs**, and the results
each simulator version gives for them. It answers two questions:

1. **Is this engine correct?** A version must reproduce its own stored
   results exactly, in PHP (`lib/EnergySimulator.php`) and in the
   TypeScript port (`sim-ts/`), locally and on the live server.
2. **What did a new version change?** The stored results of two versions
   show exactly which scenarios changed and by how much (cost, boiler heat,
   comfort...).

Because the inputs never change (weather, solar data, configuration and
schedule are saved with each scenario), a difference between two versions
comes from the engine only.

## Files

| File | Content |
|------|---------|
| `scenarios.json` | The scenarios: `id`, `title`, `description`, period. |
| `inputs/<id>.json.gz` | Frozen inputs of a scenario, as `EnergySimulator::exportRunInputs()` writes them (the same data the TypeScript engine runs on). |
| `results/<version>.json.gz` | Results of every scenario for one simulator version, in the "reference result" form below. **Never changed once the version is released.** |
| `reference.php` | Command-line tool (PHP engine). |
| `../../sim-ts/test/reference.mjs` | Command-line check of the TypeScript engine. |
| `../../lib/ReferenceCheck.php`, `../../sim-ts/src/reference.ts` | The reference form and the comparison, identical in both languages. |

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
only in the last rounded digit, 0.011 at most, e.g. between the PHP and the
TypeScript engine), or `differs`.

## Commands

```
php tests/reference/reference.php check        # PHP engine vs this version's stored results
node sim-ts/test/reference.mjs                 # TypeScript engine (after: cd sim-ts && npm run build)
php tests/reference/reference.php changes 3.17.0 3.17.1   # what a version changed
php tests/reference/reference.php write        # store this version's results
php tests/reference/reference.php add ID "Title" "Description" inputs.json   # new scenario
```

In the app, **Admin → System → Engine Verification** runs every scenario
with the server's PHP engine and with the TypeScript engine in the browser,
compares them with the stored results, and shows what the current version
changed compared with the previous one. Run it after each deployment: it
confirms the live server gives exactly the reference results.

## Releasing a new simulator version

When the simulation logic changes:

1. Make the change in **both** engines (`lib/EnergySimulator.php`,
   `sim-ts/src/`) and bump `EnergySimulator::VERSION` and
   `PORT_OF_VERSION` (`sim-ts/src/engine.ts`) to the same new version.
2. `cd sim-ts && npm run typecheck && npm run build`.
3. `php tests/reference/reference.php check`. With no stored results for
   the new version yet, it compares with the previous version and lists
   every scenario that changed. **Each change must be explained by the
   change you made.** An unexplained change is a bug.
4. `php tests/reference/reference.php write` stores the new version's
   results. Then `node sim-ts/test/reference.mjs` must report **All
   scenarios match** (TypeScript reproduces PHP).
5. Record the effect: `reference.php changes OLD NEW`, and summarise it
   in the docs (e.g. `docs/PREDICTIVE_CONTROL.md` §8 for control changes).
6. Commit the code, the bundle (`assets/js/sim/`) and `results/NEW.json.gz`
   together. After deploying, run Engine Verification in Admin.

A released version's results file is never rewritten. `write` refuses to
overwrite one; `--force` exists only for a version that has not been
released yet.

## Adding a scenario

Use run detail → **Export inputs** (History tab) to download a run's inputs,
then `reference.php add ID "Title" "Description" file.json`. Earlier
versions' results do not include the new scenario. It is compared from the
next stored version on, or from the current one if you store it with
`write --force` before release.

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
