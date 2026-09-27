# Deadlock Nowcast — dashboard

Operations dashboard for SIH 26084 (convective nowcasting, 0–6 h).

```bash
npm install
npm run dev        # http://localhost:5173
```

Keys: `space` play/pause · `←/→` step 5 min · `[` / `]` forecast lead.

## What drives it today

There is no trained model or ingested data yet, so `src/model/` holds a **synthetic
scenario**: invented storms over the real Dehradun – Rishikesh – Tehri geography,
labelled SYNTHETIC on screen. Everything downstream of the storm definitions is computed rather than typed in:
hazard fields, arrival windows, audience alerts, CAP/SMS output and replay verification
(hit / miss / false alarm vs an extrapolation baseline).

| File | Role |
|---|---|
| `model/scenario.ts` | Storm life cycles, CI candidates, exposure sites, synthetic terrain |
| `model/physics.ts` | Truth, the ML-nowcast stand-in, baseline; per-layer grids |
| `model/derive.ts` | Site curves, arrival windows, alerts, verification, CAP 1.2, SMS |
| `map/` | MapLibre map, raster colour ramps, 50% hazard contours |
| `components/` | Panels, timeline, storm card, CAP/SMS modal, verification page |

Replacing the scenario with real output means swapping `statesAt`/`gridsFor` for the
backend's frames; the panels only consume grids, site curves and alerts.

The **Model skill** panel reads `public/results/index.json` and shows nothing until the
evaluation harness writes it — no hand-entered numbers.

Basemap (CARTO) and terrain (AWS Terrarium) need internet; without it the map falls
back to a plain background and every nowcast layer still works.
