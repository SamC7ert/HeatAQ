# Technical basis for the simulation model

The three appendices here are the analytical foundation the simulator
implements. Added to git July 2026 (they previously lived outside the repo).

| Document | Establishes | Where it lives in code |
|---|---|---|
| **Vedlegg 1 — Temperaturutvikling av grunnen (v3.1)** | Transient ground-warming model under the pool: initial ground 5 °C, pool 28 °C, GRP sandwich R=1.73 m²K/W (U≈0.58), moist crushed rock k=1.0 W/mK. Heat flux decays 13.29 W/m² (yr 0) → **1.51 W/m² (yr 3)** → 0.87 W/m² (yr 10). | `EnergySimulator::Q_POOL_FLUX = 1.51` (yr-3 steady state), `T_REF_LOW = 5`, `T_REF_HIGH = 28`, `U_WALLS = 0.58`, `years_operating` / `ground_thermal_lookup` ladder |
| **Vedlegg 2 — Tunnelanalyse (v3.1)** | 2×2 m insulated GRP service tunnel (87 m) around the pool; tunnel temperature vs outdoor temp with/without 75 W/m floor heating; ground under tunnel 21.6 °C after 3 yrs; condensation margins. | `has_tunnel`, `tunnel_temperature` input, the `tunnelTemp ?? 15.0` wall-loss reference (conservative vs the analysis' 19.1 °C base case) |
| **Vedlegg 3 — Overflatevarmetap og solinnstråling (v3.6)** | Surface-loss methods: Inan & Atayilmaz (2022) evaporation `E=(0.28+0.784·v)·Δp^0.695/L_v` (L_v=2 454 000), Bowen-coupled convection, activity factor (1.0 none / 1.25 light / 1.5 moderate; >1.5 not recommended outdoors, Buscemi 2024), wind as the dominant uncertainty. Validated to ~16 % vs Greek empirical data. | `calculateEvaporationLoss` / `calculateConvectionLoss` constants, `bathers.activity_factor`, `wind_exposure` |

## Implications for open review items (`docs/CODE_REVIEW_2026-07.md`)

- **B3 (parked, ground temperature):** the 5 °C anchor and 1.51 W/m² flux are
  *documented* model choices from Vedlegg 1 — valid for mainland Norway with
  the GRP + tunnel design. The parked improvement is correctly scoped as
  "make the initial ground temperature configurable" (permafrost sites), not
  "the model is arbitrary".
- **Physics test suite (`docs/TEST_STRATEGY.md` Layer 1):** Vedlegg 3 is the
  spec — its formulas/constants are the reference for the known-value tests,
  and Vedlegg 1's year-0/3/10 flux table is a golden series for the ground
  model.
- **Activity factor:** Vedlegg 3 recommends 1.0/1.25/1.5 by usage; current
  Svalbard config uses 1.1.
