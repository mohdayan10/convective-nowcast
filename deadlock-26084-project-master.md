# SIH 26084 — Convective Nowcasting for Thunderstorms, Hail & Cloudbursts (0–6 h)
**Team Deadlock · Team ID 156116 · MoES / NCMRWF · Theme: Disaster Management · Category: Software**

> Master reference for the project: the problem, requirements, design, data, validation, demo, pitch-deck fixes and judge Q&A. Confidence tags: **[Certain]** hard evidence, **[Likely]** strong inference, **[Verify]** check before presenting.

---

## 1. The problem in plain words

Thunderstorms, hail, downbursts (sudden violent downward winds) and cloudbursts kill many people in India, mostly in the pre-monsoon and monsoon seasons. They are hard to forecast because they **form in minutes** and are **only a few km wide**. National physics-based models (NWP) use grid boxes too coarse to capture them and take too long to run. So district officials, airports and farmers often get no useful warning.

**What NCMRWF wants:** a system that watches the atmosphere *right now* from three sources, detects storms as they form, forecasts four hazards for the next **0–6 hours** at **1–3 km** detail, and shows it on a **live map with countdowns** to storm arrival.

**One-line pitch:**
> India's deadliest cloudbursts happen where radar can't see. Our system fuses radar, satellite and lightning, keeps forecasting when radar is missing, accounts for terrain, forecasts all four hazards out to 6 h, and turns them into audience-specific, explainable warnings — with every number verified.

---

## 2. Requirements checklist (from the statement)

| # | Requirement | Where we meet it |
|---|---|---|
| R1 | Lead time 0–6 h | ML nowcast 0–~3 h + NWP blending 3–6 h (§6.4) |
| R2 | 1–3 km resolution | Common 1 km / 5 min grid (§6.1) |
| R3 | Real-time operation | Streaming pipeline; demo uses labelled replay; latency target (§6.9) |
| R4 | Fuse DWR reflectivity **and velocity** | VIL/reflectivity now; velocity for downburst at finale (§5) |
| R5 | Fuse INSAT-3D/3DR IR imagery | Satellite branch; Indian port via MOSDAC (§5) |
| R6 | Fuse ground lightning network | Lightning branch; GLM for training, Indian network for port (§5) |
| R7 | Automatic convective-initiation detection | CI classifier (§6.2) |
| R8 | Forecast lightning strike density | Second output head of nowcast model (§7.1) |
| R9 | Forecast hail probability | Hail classifier (§7.2) |
| R10 | Forecast downburst velocity | Proxy now, Doppler at finale (§7.3) |
| R11 | Forecast cloudburst thresholds | 1 h / area-accumulated probability (§7.4) |
| R12 | Interactive GIS dashboard, hazard zones | React + MapLibre (§9) |
| R13 | Live countdowns to storm arrival | Arrival windows with uncertainty (§6.6) |
| R14 | Serve admin, aviation, farmers | Audience-specific thresholds and channels (§6.8) |

---

## 3. What makes this project different

Most teams will build "radar + satellite → deep learning → map." We compete on the problems India actually has:

1. **Works when radar is missing (radar-denied mode).** India's radar coverage has gaps, especially over the Himalayas and the Northeast, where cloudbursts are deadliest [Likely]. The model is trained with *modality dropout* so one model runs with all sources, satellite + lightning, or satellite only — and we report the skill of each mode.
2. **Terrain-aware cloudburst forecasting.** Himalayan cloudbursts are driven by moist air forced upslope. Elevation, slope and an upslope-flow feature feed the cloudburst model; we show an ablation (with vs without terrain).
3. **Impact-based warnings.** Alerts name what is threatened (airport, highway, pilgrimage route, farm cluster), not just a grid cell. Severity = hazard probability × arrival probability × exposure.
4. **Real Indian disaster replay.** One documented Indian event run through the system, showing the lead time actually achieved.
5. **Explainable, audience-specific alerts.** Every alert has a plain-language "why" from SHAP; aviation gets low-miss thresholds, districts and farmers get low-false-alarm thresholds; CAP XML output compatible with NDMA's SACHET format; SMS text in English, Hindi and Telugu.
6. **Verification as a deliverable.** CSI, POD, FAR, FSS by lead time against persistence and optical-flow baselines. Every number comes from evaluation code.

---

## 4. Architecture

```
INGEST → PREPROCESS → CELL DETECT + CI → NOWCAST (ML) → BLEND (NWP) → HAZARDS → IMPACT + ALERTS → DASHBOARD
                                                                                        ↓
                                                                        VERIFICATION + FEEDBACK → recalibrate
```

| Layer | What it does | Tech |
|---|---|---|
| Ingest | One adapter per source → common schema `{time, grid, var, values, data_age}`; replay engine emits frames at 5 min cadence | Python, Redis Streams |
| Preprocess | QC (clutter, gaps, duplicates), parallax correction for satellite, regrid to 1 km / 5 min, feature extraction | xarray, rasterio |
| Detect + CI | Cell detection, persistent IDs with merge/split lineage, initiation classifier | scikit-learn / LightGBM, SHAP |
| Nowcast | Multi-output U-Net (VIL + lightning), modality dropout, ensemble | PyTorch |
| Blend | Nowcast → NWP fade for 3–6 h | Python |
| Hazards | Lightning, hail, downburst, cloudburst scorers | PyTorch / LightGBM |
| Impact + alerts | Exposure overlay, audience thresholds, CAP XML, multilingual SMS | Python |
| Serve | Live/replay state, history, API | Redis, PostgreSQL/PostGIS, FastAPI + WebSocket |
| Dashboard | Map, time slider, modes, countdowns, alerts, verification | React, Vite, MapLibre GL, deck.gl |
| Infra | One-command demo | Docker Compose, single GPU |

---

## 5. Data plan

### 5.1 Build and validation: SEVIR (US)
- Public on AWS Open Data, no usage restrictions; loaders in `MIT-AI-Accelerator/eie-sevir`.
- 10,000+ storm events, 384 × 384 km, 4 h at 5 min steps, aligned: GOES-16 visible + IR (C02, C09, C13), NEXRAD VIL (1 km), GOES-16 GLM lightning.
- Standard split: train before 2019-06-01, test on/after.
- **Limits** [Certain]: 4 h sequences (so ~3 h max forecast with 1 h input); no Doppler velocity; no reflectivity (VIL only); no terrain.
- Events link to NOAA Storm Events reports (hail size, wind speed) [Verify field names in the catalog] → labels for hail and downburst.
- Download only a subset (VIL + IR + lightning for a few thousand events), not the full ~1 TB.

### 5.2 Indian port target
| Source | Where | Notes |
|---|---|---|
| INSAT-3DR / 3DS IR | MOSDAC (free SSO registration) | Register immediately; IR at 4 km, WV at 8 km [Certain]; check which satellites are operational [Verify] |
| DWR reflectivity + velocity | MOSDAC radar section / IMD | Access via order/API or request; velocity needed for downburst |
| Lightning | IMD network / IITM (Damini) | Request needed; mostly cloud-to-ground [Likely] |
| NWP (CAPE, CIN, freezing level, winds) | NCMRWF NCUM | Needed for 3–6 h blend and hail/terrain features |
| Verification rainfall | GPM IMERG (half-hourly, ~10 km, open) or IMD AWS/ARG | **Not** IMD 0.25° daily (too coarse for 1 h cloudbursts) |

### 5.3 Supporting layers
- Terrain: SRTM or Copernicus DEM.
- Exposure: WorldPop (population), OpenStreetMap (roads, airports), land-cover (farmland), hand-marked pilgrimage/trekking routes for the Indian demo region.
- US NWP for blending on SEVIR events: HRRR archives on AWS (if reachable).

### 5.4 Domain shift when porting to India (state this openly)
- INSAT scans every 15–30 min vs GOES 5 min → cooling-rate features must be recomputed at INSAT cadence [Likely].
- Ground lightning networks see mostly cloud-to-ground strikes vs GLM total lightning → lightning-jump thresholds need recalibration [Likely].
- No geostationary lightning imager over India → lightning comes only from ground networks.

### 5.5 This week
1. Register on MOSDAC; request INSAT and DWR products for the chosen Indian event.
2. Pull SEVIR samples and run the `eie-sevir` tutorial.
3. Pick the Indian event (documented timing and impact).
4. Ask about NCUM data access.

---

## 6. Components in detail

### 6.1 Preprocessing
- Regrid all sources to 1 km / 5 min. Satellite IR is natively 2–4 km: resampling doesn't add detail, so radar carries the fine-scale structure and satellite gives early-warning signals.
- Parallax correction for cloud tops at 10–12 km.
- Tag every value with data age so stale observations are down-weighted.

### 6.2 Convective initiation (CI)
- **Goal:** flag a storm before it appears on radar.
- **Label:** a new cell (not advected from an existing one) appears on VIL within 15 / 30 / 60 min.
- **Features:** IR cooling rate, minimum brightness temperature, lightning onset and jump, growth signals.
- **Model:** gradient-boosted classifier; output = calibrated probability shown as a 0–100 CI score, with SHAP reasons.
- **Report:** POD, FAR and median lead time before the first radar echo.

### 6.3 Nowcast model
- **Baselines (to beat):** persistence, pysteps optical flow, pysteps S-PROG.
- **Primary:** U-Net, 13 input frames → future frames; two output heads (VIL, lightning density). Upgrade path: ConvLSTM, then a DGMR-style generative model.
- **Modality dropout:** randomly mask radar and/or lightning in training with a mask channel.
- **Avoid smoothing:** weight high-VIL pixels in the loss; track amplitude bias.
- **Ensemble:** perturbed runs → probabilities.
- **Claim:** beats extrapolation baselines — not operational NWP.

### 6.4 0–6 h extension (NWP blending)
- SEVIR cannot validate beyond ~3 h [Certain]. The blend fades from the ML nowcast to NWP as lead time grows (skill-based weights).
- NCUM for Indian events; HRRR for US events if reachable.
- If NWP is unavailable, 3–6 h is shown as "designed, not validated" — no skill numbers invented.

### 6.5 Tracking
- VIL threshold (in kg/m², not dBZ) → connected components → IDs matched by overlap + predicted motion.
- Merge/split lineage kept (parent/child IDs), in the style of TITAN. Presented as adopted and extended, not invented.

### 6.6 Arrival countdown
- Per named location: time window and probability from ensemble tracks, e.g. "arrival 25–40 min, 70%". The window narrows as the storm approaches. Never a single precise number.

### 6.7 Explainability
- Hazard and CI decisions come from tabular models over interpretable features; SHAP → top 3 reasons in plain language that an officer can check against their own judgment.

### 6.8 Alerting
- Audience thresholds tuned on validation data: aviation (high POD), district admin and farmers (low FAR).
- Measure alert count and FAR per audience vs one fixed threshold.
- Outputs: CAP 1.2 XML, plain-language reason, SMS text in English / Hindi / Telugu (native-speaker reviewed).
- Feedback: hit / miss / false alarm → recalibrate thresholds over time.

### 6.9 Latency
- Target: data arrival → alert under 2 min [set by team; measure and report actual].

---

## 7. The four hazards

| Hazard | Method | Labels / verification | Status |
|---|---|---|---|
| **Lightning density** | Forecast by the nowcast model's lightning head | GLM (US); Indian network (port) | Prototype |
| **Hail probability** | Classifier on VIL stats, cold cloud tops, lightning rate, freezing level (NWP) | Storm Events hail reports | Prototype |
| **Downburst** | Proxy: high-VIL core followed by rapid VIL collapse + environment; outputs probability and gust-speed band | Storm Events wind reports (with speeds) | Proxy now; Doppler radial-velocity divergence at finale |
| **Cloudburst** | Nowcast VIL → rain rate (documented relation + uncertainty), accumulated over 1 h and ~20–30 km² → P(≥100 mm/h over area) | MRMS (US, if reachable); IMERG / AWS gauges (India) | Prototype; terrain features added |

---

## 8. Validation plan

- **Split:** SEVIR published split; nothing from test used for tuning.
- **Baselines:** persistence, optical flow, S-PROG.
- **Metrics:** CSI, POD, FAR at standard SEVIR VIL thresholds [Verify exact values in the SEVIR paper]; FSS at 1 / 5 / 15 km; reliability diagrams; amplitude bias — all **per lead-time bucket**.
- **Additional results:**
  - skill per mode (all sources / no radar / satellite only)
  - CI lead time before first radar echo
  - per-hazard verification
  - terrain ablation for cloudburst
  - alert-fatigue comparison (audience thresholds vs fixed)
  - Indian hindcast: lead time achieved vs documented impact time
- **Rule:** every number shown anywhere comes from `eval/results/*.json`. If the model loses somewhere, show it.

---

## 9. Dashboard

- **Center:** map with IR, radar, lightning and hazard layers.
- **Bottom:** 0–6 h time slider.
- **Top-right:** mode toggle — All sources / No radar / Satellite only.
- **Right:** alert feed with audience tabs (Aviation / District / Farmers).
- **Cards:** CI "why" card, storm lineage tree, countdown cards for named locations.
- **End of replay:** verification panel (hit / miss / false alarm, actual lead time vs baseline).
- **Badges on every panel:** REPLAY / US-SEVIR / INDIA / PROXY.
- **Results page:** skill charts from evaluation files.

---

## 10. Demo script (6–7 min)

| Time | What judges see | What we say |
|---|---|---|
| 0:00 | Region map, T−90 min before impact, no storm on radar; baseline panel: "no warning" | The problem: storms form in minutes; current extrapolation sees nothing yet |
| 0:45 | CI score rises before any radar echo; SHAP card explains why | Initiation detected from cloud-top cooling and lightning, before radar |
| 1:45 | Cell gets an ID; a merge/split keeps lineage | Tracking doesn't lose storms at the most dangerous moment |
| 2:30 | Four hazard layers; slider moved 0 → 6 h | All four required hazards, 0–6 h, 1 km |
| 3:15 | Countdown windows for airport, district HQ, farms, route | Warnings name what's threatened, with honest uncertainty |
| 4:00 | Alerts fire at different times per audience; CAP XML; Hindi/Telugu SMS | Audience-specific, explainable, ready for existing channels |
| 4:45 | Replay reveals truth; verification panel | Real lead time achieved vs baseline |
| 5:15 | Toggle "No radar" and re-run | Still forecasts where India has no radar, with measured skill |
| 5:45 | Indian event replay (or "pending data" if not available) | Ported to Indian data |
| 6:15 | Results page | Skill by lead time vs baselines; limitations stated |

**Fallback:** a 90-second screen recording in case the live demo fails.

---

## 11. Build priority

**Must have (above the cut line):**
1. Scaffold + SEVIR replay
2. Baselines + evaluation harness
3. Multi-output U-Net with modality dropout, beating baselines at short lead times
4. NWP blending for 3–6 h (or labelled "not validated")
5. CI detection
6. Merge/split tracking
7. All four hazards (downburst as proxy)
8. Terrain features + ablation

**Strong to have (below the cut line):**
9. Impact layer + audience alerts + CAP + multilingual SMS
10. Indian event hindcast (**move above the line if MOSDAC data arrives in time**)
11. Full dashboard polish
12. Demo package (script, presets, results, limitations, recording)

Detailed build instructions: `deadlock-26084-demo-build-prompt.md`.

---

## 12. Fixes needed in the current pitch deck

1. **Missing outputs:** add methods for lightning density forecast, hail probability and downburst — the deck only details cloudburst.
2. **Copy-paste error (slide 4):** remove "Normal industrial heat can resemble emergency events, creating false emergency alarms" — it is from the fire-detection project.
3. **Empty "Expected Output" (slide 6):** fill with a dashboard mockup (map, hazard polygons, storm track with uncertainty cone, countdown window).
4. **Year:** title says SIH 2025; the statement page shows 2026 [Verify template]. Remove the stray map-pin icon on slide 1.
5. **Merge/split as "innovation":** TITAN already does this and is in your references. Reword to "adopted and extended for alert continuity."
6. **"Common 1 km grid":** INSAT IR is 4 km; say radar gives 1 km detail and satellite gives early signals.
7. **Lightning data source:** name the network and access plan; MOSDAC/IMD open portals don't provide archived strikes [Likely].
8. **CAPE/CIN and NWP:** name NCUM as the source and add 3–6 h blending.
9. **Forecast split:** the deck says optical flow 0–2 h and ML 2–6 h; the build uses ML at all lead times with optical flow as the baseline. Make the deck match.
10. **"Hours to minutes" claim:** IMD already issues nowcasts [Likely]; claim improved lead time and specificity instead.
11. **Citations:** cite IMD/PIB for "47 DWRs, ~87% coverage" and IMD (not Mongabay) for the cloudburst definition; check the INSAT rapid-scan claim [Verify].
12. **Duplication:** challenges and innovations each appear twice across slides 2 and 4; cut one copy and use the space for items 1 and 8.
13. **Add the differentiators:** radar-denied mode, terrain-aware cloudburst, impact-based alerts, Indian event replay.

---

## 13. Judge Q&A preparation

Answers must use your real numbers. Where it says `[your result]`, fill in from `RESULTS.md`.

| Likely question | Honest answer |
|---|---|
| Why train on US data? | SEVIR is the only public, aligned radar + satellite + lightning dataset of convective events. We register Indian data on MOSDAC and port; the Indian replay shows [your result]. |
| How do you handle INSAT's slower scan? | Features recomputed at INSAT cadence; we report skill at that cadence rather than assuming GOES performance transfers. |
| How do you reach 6 h? | ML nowcast to ~3 h, then blend toward NWP (NCUM); weights based on skill by lead time. |
| Does your model beat pySTEPS? | [your result, by lead time — including where it doesn't]. |
| How do you avoid blurry forecasts? | Loss weighting on intense pixels, amplitude bias tracked; generative model on the roadmap. |
| Where is downburst velocity from? | Prototype: proxy (VIL collapse) validated on wind reports. Finale: Doppler radial-velocity divergence from DWR. |
| How do you define a cloudburst? | IMD: ≥100 mm in 1 h over ~20–30 km²; we forecast the accumulated probability, verified against IMERG / gauges. |
| What if radar is down? | Radar-denied mode: skill drops from [x] to [y] but forecasts continue. |
| How is this different from IMD's current nowcasts? | Adds initiation before radar echoes, radar-denied operation, terrain-aware cloudburst risk, impact-based and audience-specific alerts. We complement IMD, not replace it. |
| How many false alarms? | FAR by audience: [your result]; audience thresholds cut alerts by [your result] vs one fixed threshold. |
| Is the demo live? | No — it is a labelled replay of recorded events; the pipeline is built to take live feeds once data agreements exist. |

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| No Indian data in time | Register MOSDAC now; demo stands on SEVIR; Indian panel shows "pending" honestly |
| Model doesn't beat baseline | Report it; focus the claim where it wins; CI, radar-denied mode and alerting still add value |
| 3–6 h unvalidated | NWP blending; if no NWP, label clearly |
| Overclaiming | Honesty rules: computed metrics only, badges on every panel, `LIMITATIONS.md` |
| Rare severe events | Oversample severe events; report skill per lead-time bucket |
| Compute limits | SEVIR subset; single GPU; U-Net before heavier models |
| Scope too big | Cut line; build above it first |
| Live demo fails | Screen-recording fallback |

---

## 15. References

- SEVIR dataset — https://registry.opendata.aws/sevir/ ; tooling — https://github.com/MIT-AI-Accelerator/eie-sevir ; Veillette et al., NeurIPS 2020
- pysteps — https://pysteps.github.io/ ; Pulkkinen et al., GMD 2019, https://doi.org/10.5194/gmd-12-4185-2019
- TITAN storm tracking — https://ral.ucar.edu/
- Fractions Skill Score — Roberts & Lean (2008); ECMWF verification resources
- GOES-R GLM lightning jump — https://ntrs.nasa.gov/citations/20110008658
- Parallax correction for geostationary satellites and radar — https://doi.org/10.3390/rs12030365
- MOSDAC (INSAT, DWR) — https://www.mosdac.gov.in/
- NCMRWF data services — https://rds.ncmrwf.gov.in/
- GPM IMERG — NASA GES DISC
- NDMA SACHET (CAP-based alerts)
- IMD cloudburst definition — cite the IMD source directly [Verify]
- DGMR — Ravuri et al., Nature 2021
