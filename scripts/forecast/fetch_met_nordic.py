#!/usr/bin/env python3
"""
Fetch archived MET Nordic weather forecasts for weather stations.

MET Norway keeps every MET Nordic forecast it has issued (1 km grid over the
Nordic countries, hourly steps, 4 runs a day at 00/06/12/18 UTC, about 59
hours long). The archive with temperature, wind, humidity, cloud and solar
starts at the end of November 2019.

For each station and each forecast run, this script reads the 4 grid points
around the station over OPeNDAP (a few kB per request; the files are never
downloaded), interpolates to the station, and appends one row per forecast
hour to a CSV file that HeatAQ imports (Admin -> Weather forecasts).

    python fetch_met_nordic.py --stations stations.csv --from 2023-10-01 --to 2024-04-30
    python fetch_met_nordic.py --station SN10380:62.5773:11.3518:625 --from 2024-01-01

Stations file columns: station_id,name,latitude,longitude,elevation

Only the Python standard library is used. Re-running continues where it
stopped: runs already in the output file are skipped, failed runs are tried
again. See README.md in this folder.
"""

import argparse
import csv
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

THREDDS = "https://thredds.met.no/thredds"
ARCHIVE = "metpparchive"
SOURCE = "met_nordic"
USER_AGENT = "HeatAQ-forecast-fetcher/1.0"

# Variables read from each run (archive name -> short name)
VARIABLES = {
    "air_temperature_2m": "air",
    "wind_speed_10m": "wind",
    "relative_humidity_2m": "rh",
    "cloud_area_fraction": "cloud",
    "integral_of_surface_downwelling_shortwave_flux_in_air_wrt_time": "sw",
}
REQUIRED = ("air_temperature_2m", "wind_speed_10m", "relative_humidity_2m")
# Accumulated since the start of the run (J/m2); differenced to hourly means
SHORTWAVE = "integral_of_surface_downwelling_shortwave_flux_in_air_wrt_time"

CSV_COLUMNS = [
    "station_id", "source", "issued_at", "available_at", "valid_at", "lead_h",
    "air_temperature", "wind_speed", "humidity", "cloud_cover", "solar_w_m2",
]

# A corner counts as land when at least half of its grid cell is land.
LAND_THRESHOLD = 0.5
# Values above this are fill values (missing data).
FILL_LIMIT = 1e20
# When a file does not say when it was made, assume it was available this
# long after its nominal time (typical: 25-35 minutes).
DEFAULT_DELAY = timedelta(hours=1)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

def http_get(url, timeout=120, attempts=4):
    """GET with retries for network errors and server errors.
    Returns the body (str), or None for 404."""
    delay = 2
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code < 500 and e.code != 429:
                raise RuntimeError(f"HTTP {e.code} for {url}")
            err = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            err = str(e)
        if attempt == attempts:
            raise RuntimeError(f"{err} after {attempts} attempts: {url}")
        time.sleep(delay)
        delay *= 2


def dap_url(path, suffix, constraint=None):
    url = f"{THREDDS}/dodsC/{ARCHIVE}/{path}.{suffix}"
    if constraint:
        # THREDDS (Tomcat) rejects unencoded [ ] in the query
        url += "?" + urllib.parse.quote(constraint, safe=",:")
    return url


# --------------------------------------------------------------------------
# OPeNDAP ASCII parsing
# --------------------------------------------------------------------------

def parse_ascii(text):
    """Parse a DAP2 .ascii response into {name: values}.

    1-D arrays and scalars -> list of floats; Grid arrays -> nested lists
    indexed like the request ([t][y][x] or [y][x])."""
    body = text.split("-" * 45, 1)[-1]
    out = {}
    lines = body.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line:
            continue
        # Scalar: "forecast_reference_time, 1.70532E9"
        m = re.match(r"^([A-Za-z_][\w.]*), (\S+)$", line)
        if m and "[" not in line:
            out[m.group(1).split(".")[-1]] = [float(m.group(2))]
            continue
        # Array header: "name[3]" or "grid.name[3][2][2]"
        m = re.match(r"^([A-Za-z_][\w.]*)((?:\[\d+\])+)$", line)
        if not m:
            continue
        full = m.group(1)
        dims = [int(d) for d in re.findall(r"\[(\d+)\]", m.group(2))]
        parts = full.split(".")
        # Skip the map vectors repeated after a grid ("grid.time", "grid.x")
        if len(parts) == 2 and parts[0] != parts[1]:
            # still consume its value line(s)
            if len(dims) == 1 and i < len(lines):
                i += 1
            continue
        name = parts[-1]
        if len(dims) == 1:
            vals = [float(v) for v in lines[i].split(",")]
            i += 1
            out[name] = vals
            continue
        # n-D: rows "[a][b], v1, v2" (last dim on the row)
        n_rows = 1
        for d in dims[:-1]:
            n_rows *= d
        flat = []
        for _ in range(n_rows):
            row = lines[i].split(",")
            i += 1
            flat.append([float(v) for v in row[1:]])
        # reshape rows into nested lists by the leading dims
        def nest(rows, shape):
            if len(shape) == 1:
                return rows
            step = len(rows) // shape[0]
            return [nest(rows[k * step:(k + 1) * step], shape[1:]) for k in range(shape[0])]
        out[name] = nest(flat, dims[:-1]) if len(dims) > 2 else flat
    return out


# --------------------------------------------------------------------------
# Grid: Lambert conformal conic (spherical), from the file's projection_lcc
# --------------------------------------------------------------------------

class Grid:
    def __init__(self, das_text, x0, dx, y0, dy, nx, ny):
        def attr(name, default):
            m = re.search(r"projection_lcc \{(.*?)\}", das_text, re.S)
            block = m.group(1) if m else ""
            m2 = re.search(r"Float64 " + name + r" ([-\d.eE+]+)", block)
            return float(m2.group(1)) if m2 else default
        self.R = attr("earth_radius", 6371000.0)
        self.lat1 = math.radians(attr("standard_parallel", 63.0))
        self.lat0 = math.radians(attr("latitude_of_projection_origin", 63.0))
        self.lon0 = math.radians(attr("longitude_of_central_meridian", 15.0))
        self.n = math.sin(self.lat1)
        self.F = math.cos(self.lat1) * math.tan(math.pi / 4 + self.lat1 / 2) ** self.n / self.n
        self.rho0 = self.R * self.F / math.tan(math.pi / 4 + self.lat0 / 2) ** self.n
        self.x0, self.dx, self.y0, self.dy = x0, dx, y0, dy
        self.nx, self.ny = nx, ny

    def project(self, lat, lon):
        rho = self.R * self.F / math.tan(math.pi / 4 + math.radians(lat) / 2) ** self.n
        theta = self.n * (math.radians(lon) - self.lon0)
        return rho * math.sin(theta), self.rho0 - rho * math.cos(theta)

    def fractional_index(self, lat, lon):
        x, y = self.project(lat, lon)
        return (x - self.x0) / self.dx, (y - self.y0) / self.dy


def km_between(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


# --------------------------------------------------------------------------
# Station cell: 4 corners, weights (bilinear, land points only)
# --------------------------------------------------------------------------

def station_cell(station, grid, sample_path, log):
    """Find the 4 grid points around a station and their weights.

    Same method as the wave forecast validation: full bilinear when all 4
    corners are valid; inverse distance on the valid corners when only some
    are; here 'valid' means land (a station is on land, and sea points have
    a different climate: milder in winter, windier)."""
    fi, fj = grid.fractional_index(station["latitude"], station["longitude"])
    i, j = int(math.floor(fi)), int(math.floor(fj))
    if not (0 <= i < grid.nx - 1 and 0 <= j < grid.ny - 1):
        raise RuntimeError(f"{station['station_id']}: outside the MET Nordic grid")
    u, v = fi - i, fj - j
    sl = f"[{j}:{j + 1}][{i}:{i + 1}]"
    text = http_get(dap_url(sample_path, "ascii",
                            f"latitude{sl},longitude{sl},altitude{sl},land_area_fraction{sl}"))
    if text is None:
        raise RuntimeError(f"sample file missing: {sample_path}")
    d = parse_ascii(text)
    corners = []  # order: (j,i) (j,i+1) (j+1,i) (j+1,i+1)
    bil = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v]
    pos = [(0, 0), (0, 1), (1, 0), (1, 1)]
    for k, (dj, di) in enumerate(pos):
        corners.append({
            "lat": d["latitude"][dj][di], "lon": d["longitude"][dj][di],
            "alt": d["altitude"][dj][di], "land": d["land_area_fraction"][dj][di],
            "bilinear": bil[k],
            "dist": math.hypot(di - u, dj - v),
        })
    # Check the projection: the bilinear position must be the station
    lat_i = sum(c["lat"] * c["bilinear"] for c in corners)
    lon_i = sum(c["lon"] * c["bilinear"] for c in corners)
    err_km = km_between(lat_i, lon_i, station["latitude"], station["longitude"])
    if err_km > 0.5:
        raise RuntimeError(f"{station['station_id']}: grid position off by {err_km:.2f} km")

    land = [c["land"] >= LAND_THRESHOLD for c in corners]
    if all(land) or not any(land):
        weights = [c["bilinear"] for c in corners]
        method = "bilinear" if all(land) else "bilinear (all corners sea)"
    else:
        inv = [(1.0 / max(c["dist"], 1e-6)) if land[k] else 0.0 for k, c in enumerate(corners)]
        s = sum(inv)
        weights = [w / s for w in inv]
        method = f"inverse distance on {sum(land)} land corners"
    total = sum(weights)
    weights = [w / total for w in weights]
    grid_alt = sum(c["alt"] * w for c, w in zip(corners, weights))
    cell = {
        "i": i, "j": j, "weights": weights, "method": method,
        "grid_altitude": round(grid_alt, 1),
        "corners": corners,
    }
    log(f"  {station['station_id']} {station.get('name', '')}: cell x={i} y={j}, {method}, "
        f"grid height {grid_alt:.0f} m vs station {station['elevation']:.0f} m")
    return cell


# --------------------------------------------------------------------------
# Archive listing and one run
# --------------------------------------------------------------------------

def runs_for_day(day, hours):
    """Forecast files in the archive for a day: [(issued_dt, path)]."""
    p = f"{day.year:04d}/{day.month:02d}/{day.day:02d}"
    text = http_get(f"{THREDDS}/catalog/{ARCHIVE}/{p}/catalog.xml")
    if text is None:
        return []
    out = []
    for name in sorted(set(re.findall(r"met_forecast_1_0km_nordic_(\d{8})T(\d{2})Z\.nc", text))):
        ymd, hh = name
        if hours is not None and int(hh) not in hours:
            continue
        issued = datetime(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:]), int(hh), tzinfo=timezone.utc)
        out.append((issued, f"{p}/met_forecast_1_0km_nordic_{ymd}T{hh}Z.nc"))
    return out


_layout_cache = {}


def layout_key(path):
    return path[:7] + path[-7:]  # "YYYY/MM" + "HHZ.nc"


def run_info(path):
    """Variables, number of time steps and creation time of one run file.
    The layout (variables, steps) is read once per month and run hour; if a
    request then fails, work() forgets it and reads the run's own layout."""
    key = layout_key(path)
    layout = _layout_cache.get(key)
    if layout is None:
        dds = http_get(dap_url(path, "dds"))
        if dds is None:
            return None
        m = re.search(r"time\[time = (\d+)\]", dds)
        layout = (set(re.findall(r"Float32 (\w+)\[time = \d+\]", dds)), int(m.group(1)) if m else 0)
        _layout_cache[key] = layout
    variables, steps = layout
    das = http_get(dap_url(path, "das"))
    if das is None:
        return None
    m = re.search(r'String history "Created (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z"', das)
    created = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc) if m else None
    return {"variables": variables, "steps": steps, "created": created, "das": das}


def fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def interp(values, weights):
    """Weighted value of the 4 corners [[a,b],[c,d]]; None if any used corner is missing."""
    flat = [values[0][0], values[0][1], values[1][0], values[1][1]]
    tot = 0.0
    for v, w in zip(flat, weights):
        if w == 0:
            continue
        if v is None or abs(v) > FILL_LIMIT or v != v:
            return None
        tot += v * w
    return tot


def fetch_run(station, cell, issued, path, info, lead_hours, lapse):
    """Rows for one station and one run."""
    have = [v for v in VARIABLES if v in info["variables"]]
    if not all(v in have for v in REQUIRED):
        return None, "missing variables: " + ", ".join(v for v in REQUIRED if v not in have)
    last = min(lead_hours, info["steps"] - 1)
    i, j = cell["i"], cell["j"]
    sl = f"[0:{last}][{j}:{j + 1}][{i}:{i + 1}]"
    text = http_get(dap_url(path, "ascii", f"time[0:{last}]," + ",".join(v + sl for v in have)))
    if text is None:
        return None, "file disappeared"
    d = parse_ascii(text)
    times = d.get("time", [])
    available = info["created"]
    if available is None or not (timedelta(0) <= available - issued <= timedelta(hours=6)):
        available = issued + DEFAULT_DELAY
    w = cell["weights"]
    dz = cell["grid_altitude"] - station["elevation"]
    rows = []
    prev_sw = None
    for k in range(last + 1):
        # ASCII times have ~7 significant digits; round to the whole hour
        valid = datetime.fromtimestamp(round(times[k] / 3600) * 3600, tz=timezone.utc) if k < len(times) \
            else issued + timedelta(hours=k)
        lead = round((valid - issued).total_seconds() / 3600)
        air = interp(d["air_temperature_2m"][k], w)
        wind = interp(d["wind_speed_10m"][k], w)
        rh = interp(d["relative_humidity_2m"][k], w)
        cloud = interp(d["cloud_area_fraction"][k], w) if "cloud_area_fraction" in d else None
        sw_acc = interp(d[SHORTWAVE][k], w) if SHORTWAVE in d else None
        solar = None
        if sw_acc is not None and prev_sw is not None:
            solar = max(0.0, (sw_acc - prev_sw) / 3600.0)  # mean W/m2 over the hour ending at valid
        prev_sw = sw_acc
        if air is None or wind is None or rh is None:
            continue
        air_c = air - 273.15 + lapse * dz
        rows.append({
            "station_id": station["station_id"], "source": SOURCE,
            "issued_at": fmt(issued), "available_at": fmt(available), "valid_at": fmt(valid),
            "lead_h": lead,
            "air_temperature": f"{air_c:.2f}",
            "wind_speed": f"{max(0.0, wind):.2f}",
            "humidity": f"{min(100.0, max(0.0, rh * 100)):.1f}",
            "cloud_cover": "" if cloud is None else f"{min(100.0, max(0.0, cloud * 100)):.0f}",
            "solar_w_m2": "" if solar is None else f"{solar:.1f}",
        })
    return rows, None


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def load_stations(args):
    stations = []
    if args.stations:
        with open(args.stations, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                stations.append({
                    "station_id": r["station_id"].strip(), "name": (r.get("name") or "").strip(),
                    "latitude": float(r["latitude"]), "longitude": float(r["longitude"]),
                    "elevation": float(r.get("elevation") or 0),
                })
    for s in args.station or []:
        parts = s.split(":")
        if len(parts) != 4:
            sys.exit(f"--station must be ID:LAT:LON:ELEVATION, got {s}")
        stations.append({"station_id": parts[0], "name": "", "latitude": float(parts[1]),
                         "longitude": float(parts[2]), "elevation": float(parts[3])})
    if not stations:
        sys.exit("No stations: use --stations FILE or --station ID:LAT:LON:ELEVATION")
    return stations


def done_runs(path):
    if not os.path.exists(path):
        return set()
    with open(path, newline="", encoding="utf-8") as f:
        return {r["issued_at"] for r in csv.DictReader(f)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stations", help="CSV: station_id,name,latitude,longitude,elevation")
    ap.add_argument("--station", action="append", help="ID:LAT:LON:ELEVATION (repeatable)")
    ap.add_argument("--from", dest="start", required=True, help="First day, YYYY-MM-DD")
    ap.add_argument("--to", dest="end", help="Last day, YYYY-MM-DD (default: yesterday)")
    ap.add_argument("--runs", default="0,6,12,18", help="Run hours UTC, or 'all' (default 0,6,12,18)")
    ap.add_argument("--hours", type=int, default=48,
                    help="Forecast hours to keep per run (default 48: a plan looks up to about 30 h "
                         "ahead from a run up to 6.5 h old, plus margin)")
    ap.add_argument("--lapse", type=float, default=0.0065,
                    help="Temperature lapse rate K/m for grid-vs-station height (default 0.0065; 0 = off)")
    ap.add_argument("--out", default="forecasts", help="Output folder (default ./forecasts)")
    ap.add_argument("--workers", type=int, default=4, help="Parallel requests (default 4; be kind to MET)")
    ap.add_argument("--limit", type=int, default=0, help="Stop after this many runs (testing)")
    args = ap.parse_args()

    stations = load_stations(args)
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else date.today() - timedelta(days=1)
    hours = None if args.runs == "all" else {int(h) for h in args.runs.split(",")}
    os.makedirs(args.out, exist_ok=True)

    log_lock = threading.Lock()

    def log(msg):
        with log_lock:
            print(time.strftime("%H:%M:%S"), msg, flush=True)

    # 1. Runs in the archive for the period
    log(f"Listing archive {start} to {end} ...")
    days = [start + timedelta(days=k) for k in range((end - start).days + 1)]
    runs = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for res in ex.map(lambda d: runs_for_day(d, hours), days):
            runs.extend(res)
    runs.sort()
    missing_days = [d.isoformat() for d in days if not any(r[0].date() == d for r in runs)]
    log(f"{len(runs)} runs in the archive; {len(missing_days)} days without any run")
    if not runs:
        return

    # 2. Grid and station cells (once; checked against each run's x/y below)
    sample = runs[-1][1]
    das = http_get(dap_url(sample, "das")) or ""
    xy = parse_ascii(http_get(dap_url(sample, "ascii", "x[0:1],y[0:1]")))
    dds = http_get(dap_url(sample, "dds"))
    nx = int(re.search(r"x\[x = (\d+)\]", dds).group(1))
    ny = int(re.search(r"y\[y = (\d+)\]", dds).group(1))
    grid = Grid(das, xy["x"][0], xy["x"][1] - xy["x"][0], xy["y"][0], xy["y"][1] - xy["y"][0], nx, ny)
    log("Station cells:")
    cells = {s["station_id"]: station_cell(s, grid, sample, log) for s in stations}
    with open(os.path.join(args.out, "met_nordic_cells.json"), "w", encoding="utf-8") as f:
        json.dump({sid: {k: v for k, v in c.items()} for sid, c in cells.items()}, f, indent=1)

    # 3. Runs still to fetch, per station
    files = {s["station_id"]: os.path.join(args.out, f"forecasts_{SOURCE}_{s['station_id']}.csv") for s in stations}
    done = {sid: done_runs(p) for sid, p in files.items()}
    todo = [(issued, path) for issued, path in runs
            if any(fmt(issued) not in done[s["station_id"]] for s in stations)]
    if args.limit:
        todo = todo[:args.limit]
    log(f"{len(todo)} runs to fetch ({len(runs) - len(todo)} already done)")

    writers = {}
    handles = {}
    for sid, p in files.items():
        new = not os.path.exists(p) or os.path.getsize(p) == 0
        handles[sid] = open(p, "a", newline="", encoding="utf-8")
        writers[sid] = csv.DictWriter(handles[sid], fieldnames=CSV_COLUMNS)
        if new:
            writers[sid].writeheader()
    write_lock = threading.Lock()
    problems = {}
    counts = {"ok": 0, "failed": 0, "skipped": 0}
    t0 = time.time()

    def fetch_all(issued, path):
        info = run_info(path)
        if info is None:
            return {}, "file missing"
        results = {}
        for s in stations:
            sid = s["station_id"]
            if fmt(issued) in done[sid]:
                continue
            rows, err = fetch_run(s, cells[sid], issued, path, info, args.hours, args.lapse)
            if err:
                return results, err
            results[sid] = rows
        return results, None

    def work(item):
        issued, path = item
        try:
            results, err = fetch_all(issued, path)
        except RuntimeError:
            # Perhaps this run's layout differs from its month's: read its own
            _layout_cache.pop(layout_key(path), None)
            results, err = fetch_all(issued, path)
        return issued, path, results, err

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(work, item) for item in todo]
        for n, fut in enumerate(as_completed(futures), 1):
            try:
                issued, path, results, err = fut.result()
            except Exception as e:  # network failure after retries: try again next time
                counts["failed"] += 1
                log(f"  failed: {e}")
                continue
            with write_lock:
                for sid, rows in results.items():
                    writers[sid].writerows(rows)
                    handles[sid].flush()
            if err:
                key = "skipped" if err.startswith("missing variables") else "failed"
                counts[key] += 1
                problems[fmt(issued)] = err
            else:
                counts["ok"] += 1
            if n % 50 == 0 or n == len(futures):
                rate = n / max(1e-9, time.time() - t0)
                eta = (len(futures) - n) / max(rate, 1e-9)
                log(f"  {n}/{len(futures)} runs  ({rate * 3600:.0f}/hour, about {eta / 60:.0f} min left)")

    for h in handles.values():
        h.close()
    report = {
        "source": SOURCE, "period": [start.isoformat(), end.isoformat()],
        "finished": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "counts": counts, "days_without_runs": missing_days, "problems": problems,
    }
    with open(os.path.join(args.out, f"fetch_log_{SOURCE}.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    log(f"Done: {counts['ok']} runs fetched, {counts['skipped']} without the needed variables, "
        f"{counts['failed']} failed (run again to retry). Files in {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
