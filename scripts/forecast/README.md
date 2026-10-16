# Weather forecasts for predictive control

The predictive controller plans each night from the weather ahead. In a
simulation it can plan on the **actual** weather (hindsight: the best case) or
on the **forecasts that were available at the time**, as a real controller
would. This folder holds the tool that gets those archived forecasts.

## Source: MET Nordic (MET Norway)

MET Norway archives every MET Nordic forecast it has issued:

- 1 km grid over the Nordic countries, built from the MEPS model (2.5 km)
  with elevation correction and observations (MET, Netatmo) in the first hours;
  the same data behind yr.no and api.met.no Locationforecast;
- runs at 00, 06, 12 and 18 UTC, each with 59 hourly steps;
- each file records when it was created, about 30 minutes after its nominal
  time: the forecast's **available_at**;
- with temperature, wind, humidity, cloud and solar from late November 2019
  (earlier files have temperature only and are skipped).

Archive: `https://thredds.met.no/thredds/catalog/metpparchive/` (OPeNDAP;
licence CC BY 4.0, credit MET Norway).

## fetch_met_nordic.py

Runs locally (Python 3.8+, standard library only, no installs):

```
python fetch_met_nordic.py --stations stations.csv --from 2023-10-01 --to 2024-04-30
python fetch_met_nordic.py --station SN10380:62.5773:11.3518:625 --from 2019-11-28
```

`stations.csv`: `station_id,name,latitude,longitude,elevation` (the
`weather_stations` values in HeatAQ; Admin → Weather forecasts lists them).

For each station and run it:

1. finds the 4 grid points around the station (Lambert projection read from
   the file; the position is checked against the file's own latitude and
   longitude);
2. interpolates bilinearly, using **land points only** when the station is
   near the sea (sea points are milder in winter and windier); with 1-3 land
   corners it uses inverse distance on those, as in the wave forecast
   validation;
3. corrects the temperature for the height difference between the grid and
   the station (`--lapse`, default 0.0065 K/m; `--lapse 0` turns it off);
4. reads only those 4 points over OPeNDAP (a few kB), never whole files.

Output, per station, in `--out` (default `./forecasts`):

| File | Content |
|------|---------|
| `forecasts_met_nordic_<station>.csv` | One row per run and forecast hour (UTC): `issued_at, available_at, valid_at, lead_h, air_temperature (°C), wind_speed (m/s), humidity (%), cloud_cover (%), solar_w_m2` (mean over the hour ending at valid_at). Import into HeatAQ. |
| `met_nordic_cells.json` | Grid cell, corners, weights and grid height per station (for checking). |
| `fetch_log_met_nordic.json` | Counts, days with no runs in the archive, runs that failed. |

Start a day before the first day you will simulate: the first plan of a
run needs a forecast issued before it (otherwise that plan uses the actual
weather and the report counts it as "without forecast").

Re-running continues where it stopped: runs already in the CSV are skipped,
failed runs are tried again. `--hours` (default 48) sets how many forecast
hours are kept per run; `--workers` (default 4) the parallel requests.

**Time:** about 700-1,400 runs an hour for two stations (4 runs a day, so a
year is about 1,460 runs). The whole archive since 2019 takes one night.
`--limit 10` tests a few runs first.

## In HeatAQ

Admin → Weather forecasts imports the CSV files into `weather_forecasts`.
The simulation then has a **Planning weather** choice (Configuration):
actual weather (hindsight) or forecast. See `docs/PREDICTIVE_CONTROL.md`
§ Planning on forecasts.
