# Wind Correction — Design

Status: **in progress** (station side being implemented; pool side + derivation still open)

## Motivation

Today the model damps wind with a single opaque factor `pools.wind_exposure`
(default 0.5): `v_eff = wind × wind_exposure`, applied to both the Inan &
Atayilmaz evaporation term and the convection term. The factor is hand-set per
pool with no physical basis, and it's the dominant uncertainty in the surface
heat balance (see `reference/technical_basis` Vedlegg 3).

The goal is to *derive* the effective wind at the pool from physical inputs — a
standard log-law wind-profile transfer from the weather station to the pool
site, plus a fence-shelter factor — while keeping it overridable.

## Physical model

Standard site-to-site log-law transfer via a blending height `H` (≈ 60 m, above
which local terrain differences vanish):

```
v_H    = v_station × ln(H / z0_s) / ln(z_s / z0_s)      # up from station over its terrain
v_pool = v_H       × ln(z_p / z0_p) / ln(H / z0_p)      # down to pool over pool terrain
v_eff  = v_pool × f_fence                                # fence shelter (near-surface)
```

Where:
- `z_s`  = station anemometer height (`weather_stations.wind_height_m`)
- `z0_s` = station terrain roughness (`weather_stations.terrain_roughness`)
- `z_p`  = pool reference height (new pool field)
- `z0_p` = pool terrain roughness (new pool field)
- `f_fence` = fence shelter factor 0–1 (new pool field)

**Key property:** every log term is constant for a given (station, pool) pair, so
`v_eff = E × v_station` where `E` is a single constant. The whole model therefore
**collapses into the multiplier the code already has** (`wind_exposure_factor`);
we just *derive* `E` at simulation setup instead of storing `0.5`. Minimal blast
radius, and the debug view can later show the transfer breakdown
(v_station → v_H → v_pool → v_eff) alongside the loss terms.

## Data model — what lives where

Wind-correction inputs are properties of physical objects, so none belongs in the
per-project config template (consistent with migration 024: pool physics lives on
the pools table, config templates hold only equipment/control/bathers).

| Input | Home | Status |
|---|---|---|
| `z_s` anemometer height | `weather_stations.wind_height_m` | exists |
| `z0_s` station roughness | `weather_stations.terrain_roughness` | exists (precision widened, migration 033) |
| `z_p` pool reference height | pools (new) | **TODO (pool phase)** |
| `z0_p` pool roughness | pools (new) | **TODO (pool phase)** |
| `f_fence` fence shelter | pools (new) | **TODO (pool phase)** |
| derived `E` | computed at sim setup | **TODO (derivation phase)** |

### Per-pool vs per-project

The config screen is per-project, but every simulation resolves to one specific
pool (project → site → pool). Resolution: **keep wind inputs per-pool/per-station;
the per-project config screen only *surfaces* the resolved pool's derived `E`**
(with a transparent breakdown) and offers an override. Storage stays per-pool.

### Overrides
- **Pool-level manual override:** `pools.wind_exposure` becomes the optional manual
  value (NULL/flag ⇒ use computed `E`; value ⇒ force it).
- **Per-simulation override:** already implemented via `config_override`.

## Station side — locked decisions (this phase)

1. **Roughness = required terrain-class selector, no default.** Free-number field +
   `0.03` default replaced by a Davenport class dropdown; blank until chosen.

   | Class | z₀ (m) |
   |---|---|
   | Water / ice | 0.0002 |
   | Open sea, smooth | 0.005 |
   | Open flat (grass, few obstacles) | 0.03 |
   | Farmland, low crops | 0.10 |
   | Suburban (scattered buildings & trees) | 0.30 |
   | Urban / dense | 0.50 |

2. **Wind height from Frost, else mandatory manual.** `availableTimeSeries` exposes
   the sensor `level`s; the recommendation now **defaults to 10 m** (standard),
   flipped from the previous silent 2 m preference. If Frost returns no wind level,
   the height must be entered manually — no silent `10 m` fallback.

3. **Gate the import.** Weather-data download (`fetch_and_store_year`) is refused
   until the station has both a valid `wind_height_m` and `terrain_roughness`
   — don't pull records we can't correctly interpret. Enforced server-side and
   surfaced in the UI (`Update Data`).

4. **Location map** to the right of the data panel, reusing the pool-site
   OpenStreetMap embed (`project.updateMapPreview`).

5. **Precision:** `terrain_roughness` widened to `DECIMAL(6,4)` (migration 033) so
   the canonical water value 0.0002 is storable — `DECIMAL(5,3)` truncated it to
   0.000, which would make `z₀ = 0` and break `ln(z/z₀)`.

## Open decisions (pool + derivation phases)

1. **Reference height `z_p` and the height basis of the Inan correlation** — the
   single most important modeling choice; if the fit assumes near-surface wind the
   fence dominates, if 10 m it barely matters. Confirm from Vedlegg 3.
2. **Fence model** — separate empirical shelter factor (preferred) vs. elevated
   local roughness.
3. **Blending height `H`** — 60 m textbook default, hardcode vs. config.
4. **Migration of existing pools** — Hisøy/Arendal 0.535, Svalbard 0.5 kept as
   manual overrides; populate physical fields, compare derived-vs-manual before
   switching each pool to computed.
5. **Computed-vs-manual toggle** — per-pool flag vs. "NULL means computed".
