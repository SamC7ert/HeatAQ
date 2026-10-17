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

## Fetching in the app (normal way)

Admin → Weather → Weather Forecasts: choose the station and period, press
**Fetch from MET Norway**. The server reads each day's 4 runs from MET's
archive (`lib/MetNordicForecast.php`, same method as below) and stores them;
the page sends 3 days at a time and shows progress. Days already fetched are
skipped, so it can be stopped and continued later. MET's server is the limit:
about 10 seconds a day, so about an hour per year, with the page open.

MET's archive sometimes answers "not found" for a run it has (a passing
fault), and some runs are really missing (about 70 from 2019 to 2026).
Days with runs not found are tried again during the fetch, spread over
time: when a fifth, two fifths ... of the days are done, and at the end
(after a minute's pause) until each such run has had 5 tries. The tries are
recorded per run (`weather_forecast_misses`, migration 043); a run not found
in 5 tries counts as not in the archive (the "Not in archive" column) and is
not asked for again. A retry fetches only the runs a day still lacks.

The app fetches what the planner uses: temperature, wind and humidity, 36
hours ahead of each run (a plan looks at most about 35 hours ahead of the
forecast it uses). Cloud and solar are left empty.

## fetch_met_nordic.py (alternative: on a PC)

For fetching without the app (e.g. overnight on a PC), with cloud and solar
and 48 hours ahead. Runs locally (Python 3.8+, standard library only, no
installs), and the CSV files are imported in the same card ("Import CSV
files instead"):

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

Forecasts are stored in `weather_forecasts`. The simulation then has a
**Planning weather** choice (Simulate tab): actual weather (hindsight) or
forecast. See `docs/PREDICTIVE_CONTROL.md` §11.
