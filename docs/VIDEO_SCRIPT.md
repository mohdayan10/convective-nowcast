# Video script — SIH 26084, Deadlock Nowcast

**Length:** about 16 minutes at a calm pace. Part numbers are cut points — drop
Parts 9, 11 and 12 for a 7-minute version and the demo still stands on its own.

**How to read this:** 🎬 is what to show. 🗣️ is what to say. A blank line is a
breath. Numbers in bold are read from files in the repo and are listed with their
source, so if you re-run anything before recording, read the new number off the
screen instead of this page.

---

## Before you record

1. `docker compose up --build`, then open **http://localhost:8000** full screen at
   1680×950 or wider.
2. The console opens on the **relocated Karnataka package** (`S852920-IN-KA`).
   Check the status bar says `Relocated grid`.
3. Set the transport to **20×** and leave the replay paused at the start.
4. Have a second window on the repo, and a terminal in the project folder.
5. Read the honesty line out loud at least twice in the video. It is the strongest
   thing you have: **every number on screen comes from a file in the repo, and
   anything not computed says so instead of showing a number.**

---

## Part 1 — The problem (0:00 – 1:10)

🎬 Title card, then the console on `NOW` with the storm over Karnataka, paused.

🗣️
Thunderstorms, hail, sudden violent winds and cloudbursts kill people in India
every year. The difficulty is not that we have no weather models — it is that
these storms are born in minutes and are only a few kilometres across.

A national forecast model runs on a grid too coarse to see one, and takes hours
to produce. By the time it finishes, the storm has formed, hit, and gone.

So the people who need the warning — a district officer, an airport, a farmer —
often get nothing useful at all.

This is problem statement **26084** from the Ministry of Earth Sciences. It asks
for a nowcast: zero to six hours ahead, one to three kilometres across, built by
fusing radar, satellite and lightning.

We are Team Deadlock. This is what we built, and — just as important — this is
what we measured, including the places where our model loses.

---

## Part 2 — What this is, honestly (1:10 – 2:10)

🎬 Click `OVW · Overview`. Let the relocation banner fill the frame.

🗣️
Start with what you are looking at, because it decides how much to trust
everything after it.

This is a **replay console**. One recorded storm, played back from files that
were computed in advance. The browser does no forecasting at all — the only
arithmetic it does is subtracting two clocks for the countdowns.

The storm is a real event: a thunderstorm-wind case from the **SEVIR** dataset,
17 August 2019, four hours of radar at five-minute steps on a 384-kilometre tile.

But read this banner, because a judge will ask. That storm happened over the
United States. We have georeferenced its grid onto **Karnataka**, centred on
Bengaluru, so the console can be read against Indian terrain and Indian cities.

What moved is the georeference, and with it the named locations — and those are
the **real** Bengaluru, Mysuru, Mandya, Tumakuru, Salem, Vellore and Kempegowda
airport, because they come from the same global exposure tables.

What did not move: the forecast, the storm cells, the arrival windows, every
metric, and the timestamps. All of those are computed on the grid, and the grid
is unchanged. No number on any screen changes when we move it.

We are badged `RELOCATED` and we say this on the opening screen, because the
honest version of "we have no Indian radar data yet" is to show you exactly
that.

🎬 Scroll to **What this console shows** and **What is not computed**.

🗣️
These two lists are generated from the package itself, not typed by hand. On the
left, what exists. On the right, what does not — and the command that would fill
it. You will see that second list again on the validation screen.

---

## Part 3 — The main console, and the two required outputs (2:10 – 4:00)

🎬 Click `NOW · Live nowcast`. Press play at 20×.

🗣️
This is the operational screen, and it carries the two outputs the problem
statement demands: a **GIS hazard map**, and **countdowns to named locations**.

🎬 Point at the map.

🗣️
Two radar layers are drawn here, named apart in the panel on the left.

Underneath is the **observed radar** at the replay clock — sharp, cellular, what
the radar actually sees. Over it is the **model's forecast** at the lead on the
transport bar — smoother, because that is genuinely what the model produces. We
do not sharpen it. The difference between the two is the thing a forecaster is
judging, so we show both.

Both use the same reflectivity heat ramp: dark teal for a weak echo, through
green and yellow, to deep red in a core.

🎬 Point at the hazard strip along the top.

🗣️
The four hazard parameters the statement names. **Extreme rainfall** as peak
forecast accumulation in millimetres per hour. **Severe wind**. **Lightning
density**. **Hail**.

Severe wind carries the word "proxy" on its face, and hovering tells you why: we
detect it as a collapse of the vertically integrated liquid core, not from
Doppler velocity, because this dataset has no Doppler. That is a weaker method
and we label it everywhere it appears.

🎬 Point at the countdowns on the right as they tick.

🗣️
Here are the countdowns — Salem, Bengaluru, the airport, Tumakuru — ticking down
to arrival, each with a window and a confidence.

The confidence is not a guess. For each storm cell we take its tracked motion,
perturb the speed and direction across an ensemble, and see what fraction of
those perturbed storms reach the location — and when. That gives the window and
the probability. The browser only subtracts the clock.

🎬 Click a storm cell on the map.

🗣️
Click a cell and you get its identity: how long it has been tracked, its peak
intensity, its footprint, the area of its core, and the radar coverage where it
sits. Cells keep their identity through merges and splits, so an alert raised
for a storm stays attached to that storm.

🎬 Scroll the right rail to the alert feed, open one alert.

🗣️
Alerts are issued per audience, because the right threshold is not the same for
everyone. Aviation is tuned to miss as little as possible. A district officer is
tuned against false alarms, because evacuating a town on a false alarm costs
real trust.

Open one and you get the **CAP 1.2 XML** — the international alerting format —
and an SMS in **English, Hindi and Telugu**. In this replay **8** alerts were
issued, **5** hits and **3** false alarms, median lead **15 minutes**.

---

## Part 4 — The differentiator: forecasting where radar cannot see (4:00 – 5:30)

🎬 Point at the coverage block in the left panel, then switch **No radar**, then
**Satellite only**, then back to **All sources**.

🗣️
This is the part I most want you to see, because it is our answer to a real
Indian problem: the Doppler radar network does not cover the whole country.

The panel says **39%** of this tile has full radar, **29%** partial, **31%**
none. Those tiers are simulated — we never received the radar-overlap grid — and
every panel that uses them says so.

Now watch the switch. **No radar** is not the same forecast restyled. It is a
separate forward pass with the radar input actually taken away, through the
modality-dropout path the model was trained on. **Satellite only** removes the
lightning channel as well.

🎬 Let the transport counters change as you switch.

🗣️
And here is the measurement, over the whole **218-event** held-out test split,
not just this storm.

Mean critical success index at sixty minutes: **0.166** with every source,
**0.149** with the radar denied — about **90%** of the skill kept — and
**0.121** from satellite alone.

Now the number that matters. Optical flow, the standard extrapolation baseline,
scores **0.000** on that same denied input. With no radar there is nothing to
extrapolate. Whatever skill the model keeps there comes from satellite and
lightning, and that is the gap this project is aimed at.

---

## Part 5 — Storm relief in three dimensions (5:30 – 6:30)

🎬 Click `3DX · 3D storm relief`. Click **Orbit**. Let it turn.

🗣️
The same storm seen as a body. This is the observed liquid-water field drawn in
relief — thirty translucent shells, each raised to its own intensity level, so
they compose into a mass: pale where the cloud is thin, warm and dense through
the cores.

Read the caption, because it is a limit, not a decoration. **Height is a drawing
scale, not cloud-top altitude.** SEVIR gives vertically integrated liquid — one
number per column, no vertical slices. So an altitude-slice inspector would need
a radar volume we do not have, and rather than fake one, the panel on the left
explains exactly what is missing and what would fill it.

The camera orbits; the storm itself advances with the replay clock every five
minutes. Nothing between those steps is invented.

---

## Part 6 — Forecast timeline and the honest decay (6:30 – 7:15)

🎬 Click `FTM · Forecast timeline`.

🗣️
Every lead time the model produces, side by side, with the measured skill at
each one.

Two things to notice, and both are losses we chose to show.

Skill falls as lead time grows — that is physics, every nowcast does this.

And past sixty minutes the bar is hatched and the panel says "no forecast". We
trained to sixty minutes. The problem statement asks for six hours. We do not
have the three-to-six hour blend, so rather than drawing a line that fades into
nothing, we show nothing and name what it would take: an NWP blend we have no
access to yet.

---

## Part 7 — Data fusion (7:15 – 8:30)

🎬 Click `FUS · Data fusion`.

🗣️
The three input rasters at the top are not an illustration of fusion. They are
the actual arrays the network was fed for this analysis time: **radar** liquid
water, **satellite** cloud-top temperature, and **lightning** flash density.

Below them, the model's outputs — the heads it produces. The two that were never
trained are marked "not trained" rather than being given a plausible percentage.

🎬 Scroll to **Take a source away** and the two tables.

🗣️
And here is the fusion evidence, which we split into two questions because they
are genuinely different.

This table scores the same forecast over the pixels radar can and cannot see —
full **0.174**, partial **0.185**, no radar **0.155**. Notice the ordering is not
clean: partial scores above full. We do not hide that; it is why we call it a
coverage breakdown rather than proof.

The table below it answers the other question: the model re-run with the input
actually removed, over the same 218 events — the **0.166 / 0.149 / 0.121** we
just saw, with extrapolation at zero. That one is the evidence for fusion.

---

## Part 8 — Explainability (8:30 – 9:45)

🎬 Click `XAI · Explain`. Pick the strongest cell.

🗣️
Judges ask "why did it say that", so here is the answer for a specific cell.

These are **exact SHAP values** from the gradient-boosted hail and downburst
models — not an illustration shaped like an explanation. The contributions sum
with the base value to the model's own log-odds, which means you can add them up
and arrive at precisely the probability shown on the map. On this cell, lightning
rate and cloud-top temperature carry the decision.

🎬 Scroll to **Convective initiation**.

🗣️
Initiation — spotting a storm before there is any echo to track. The model sees
satellite, not radar, which is the point: it can flag a growing cloud before
radar has anything to find. Median lead before first echo, **45 minutes**.

And the honest half: at the operating threshold its critical success index is
**0.055** with a false-alarm ratio of **0.90**. It finds storms early and it
cries wolf. We report it as a research signal, not as an alert source, and the
validation screen says the same.

🎬 Scroll to the per-source ablation.

🗣️
And the same removal again, for this one event and this one analysis time, with
a link through to the split-wide measurement. One event is a demonstration. The
split is the evidence. We keep them labelled apart.

---

## Part 9 — Storm replay: the model against what happened (9:45 – 11:00)

🎬 Click `REP · Storm replay`. Drag the divider slowly.

🗣️
This is the most persuasive screen, and the hardest on us.

Same valid time. On the left, what the model forecast. On the right, what the
radar actually observed. Same grid, same colour ramp, same scale — so this is a
comparison of fields, not of two different renderings.

Drag the divider. The model has the position and the shape of the system. It is
smoother and weaker than the observation — and the next panel measures exactly
that rather than letting you squint at it.

🎬 Read the **Model against observed** panel.

🗣️
Arrival error, median **0 minutes**, median absolute **0 minutes**, with **71%**
of observed arrivals falling inside the forecast window, over **24** site
forecasts on this event.

Below it, track error: how far the forecast put the storm from where it went,
and beside it the ratio of forecast cell area to observed. That ratio is the
whole story of this model's weakness, and it leads straight into the next
screen.

---

## Part 10 — Validation, including where we lose (11:00 – 13:30)

🎬 Click `VAL · Validation`. Start at the banner.

🗣️
This screen is why I would back this project over a prettier one.

It opens by separating what is measured from what is not. Everything below is
measured over **218 held-out events**, split by date, so no event we trained on
appears here.

🎬 Scroll to the skill chart.

🗣️
Mean skill against three extrapolation baselines — persistence, optical flow and
S-PROG. At sixty minutes: model **0.166**, S-PROG **0.125**, optical flow
**0.115**, persistence **0.094**.

Now look at five minutes, and read it out loud, because the page does.
S-PROG **0.370**, optical flow **0.360**, model **0.311**. **We lose below about
twenty minutes.** A sharp echo moved along a motion field beats a learned model
at very short lead. We say that on the page rather than cropping the chart.

🎬 Scroll to **Reliability · calibration**.

🗣️
Reliability, per hazard and per coverage tier. Grey is the raw probability, teal
is after an isotonic recalibration fitted on validation and judged on test.
Brier score for the one-hour rainfall threshold goes **0.050 to 0.027** over
full-radar pixels, and **0.126 to 0.039** where there is no radar.

And then the sentence that matters: these curves **measure** the probabilities,
they are not applied to them. The package ships raw model output, so a
probability anywhere in this console is a ranking, not a frequency — and every
screen that shows one says that.

🎬 Scroll to **Skill with the radar taken away**, then **Object track error**.

🗣️
Radar-denied skill, which we just saw.

And then this one, which goes against us. Median centroid error at sixty
minutes: model **36.9 km**, optical flow **21.0 km**, persistence **38.1 km**.
The model keeps only **45%** of cells as objects where optical flow keeps
**95%**.

The column beside it explains why: a matched forecast cell is about **five
times** the area of the observed one. The model's field is smooth, so it merges
neighbouring storms into one blob, and that blob's centre sits between the
storms it merged. Part of that error is merging, not misplacement — and a
weakened cell drops below the detection threshold and vanishes as an object even
where its pixels still score well.

So: we beat the baselines on pixels and lose to them on object position. The page
says so in those words. Nothing in the product depends on the model's object
tracks — the cells, the arrival windows and the alerts are all tracked on
observed radar.

🎬 Scroll through latency, hazard models, initiation.

🗣️
Inference latency, measured: **0.59 seconds** per event for ten ensemble members
over a 384-kilometre tile on a GTX 1050 Ti. Not a target — a timing.

Hail and downburst, scored per coverage tier. Downburst at full radar, area under
curve **0.75**. Hail **0.72** — and with no radar hail falls to **0.50**, which
is a coin toss, so we say the hail model needs radar and the console gates it.

---

## Part 11 — Alerts that are tuned, not thresholded (13:30 – 14:15)

🎬 Back to `NOW`, the alert feed; or the alerts section on `VAL`.

🗣️
One number that shows the thinking. A fixed hail threshold across every audience
issues **52** alerts to catch **6** real events. Tuned for a district officer,
where a false alarm is expensive, that becomes **13** alerts — fewer catches,
far fewer false alarms.

Same model, same storm, different cost of being wrong. That is what the audience
tabs do.

---

## Part 12 — The system behind it (14:15 – 15:15)

🎬 Click `SYS · System`.

🗣️
The pipeline, end to end: radar, satellite and lightning aligned onto one grid,
fused by a tier-aware U-Net, probabilistic output over twelve lead frames,
delivered as tracks, arrival times and uncertainty.

The API that serves it — FastAPI, every endpoint the console actually calls,
with a live round-trip time measured against this server, not a figure we typed.

And this session's event log. Nothing live, nothing sent anywhere.

🎬 Switch briefly to a terminal, run `make test`.

🗣️
And the repository backs this. The evaluation files the console reads are written
by commands in the Makefile — `make model`, `make modes`, `make track-skill`,
`make calibrate` — so every number on every screen is reproducible from a clean
checkout, with the event ids, the split date and the git commit recorded inside
each file.

---

## Part 13 — Close (15:15 – 16:00)

🎬 Back to `NOW`, playing, storm moving toward Bengaluru.

🗣️
To finish, what we claim and what we do not.

We claim: a nowcast trained to one hour at one to three kilometres, fusing three
sources, that keeps **90%** of its skill when the radar is taken away while
extrapolation keeps none. Hazard probabilities per storm cell with exact
attributions. Arrival countdowns with calibrated windows. Alerts in CAP and in
three languages, tuned per audience. Every screen reproducible from files.

We do not claim: an Indian case — the dataset is American and we show you where
the grid was moved. Real coverage tiers — ours are simulated. Calibrated
probabilities — we measured the calibration, we have not applied it. Anything
beyond sixty minutes. And we do not claim to beat extrapolation at very short
lead or at object position, because we measured both and we do not.

A forecast you cannot check is not a forecast. Everything here can be checked,
including the parts that are not flattering.

Thank you.

---

## Numbers in this script, and where they come from

| Claim | Source |
|---|---|
| Mean CSI at 60 min: 0.166 / 0.125 / 0.115 / 0.094 | `eval/results/model.json` |
| At 5 min: S-PROG 0.370, optical flow 0.360, model 0.311 | `eval/results/model.json` |
| Radar-denied 0.166 / 0.149 / 0.121, baseline 0.000 | `eval/results/modes.json` |
| Per-tier 0.174 full, 0.185 partial, 0.155 none | `eval/results/model.json` |
| Track error 36.9 / 21.0 / 38.1 km, 45% vs 95% matched, 5× area | `eval/results/track.json` |
| Brier 0.050→0.027 full, 0.126→0.039 none | `eval/results/calibration.json` |
| Latency 0.59 s per event | `eval/results/modes.json` |
| Hail AUC 0.72 full, 0.50 no radar; downburst 0.75 | `eval/results/hazards.json` |
| Initiation: 45 min median lead, CSI 0.055, FAR 0.90 | `eval/results/ci.json` |
| Hail alerts 52 → 13 when tuned for districts | `eval/results/alerts.json` |
| Coverage 39% full, 29% partial, 31% none | `replay_packages/S852920-IN-KA/meta.json` |
| Arrival error 0 min median, 71% in window, 24 forecasts | `…/observed.json` |
| 8 alerts, 5 hits, 3 false alarms, 15 min median lead | `…/verification.json` |

If you re-run any of these before recording, read the new value off the screen —
the console always shows the file, never this page.
