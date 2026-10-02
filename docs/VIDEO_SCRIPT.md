# Video Script — SIH 26084: Convective Nowcasting (Team Deadlock)

**Length:** about 18 minutes (cut Part 12 down to ~2 minutes for a short version) · **Speakers:** 1–3 (split the parts however you like)
**How to read this:** 🎬 = what to show on screen. 🗣️ = what to say. Speak slowly; pause where there's a line break.

> **Before you record — checklist**
> 1. Start the dashboard: `cd frontend && npx vite preview --port 4173`, open **http://localhost:4173** in a full-screen browser window (1920×1080 is best).
> 2. Keep these ready in other tabs/windows: the GitHub repo, `docs/m2_alignment.png`, `docs/m4_masks.png`, `docs/m7_lineage.png`, and a terminal in the project folder.
> 3. Numbers in Part 7 come from our **early 20-storm test**. If you re-run `make baselines` on the full test set before recording, read the new numbers from the dashboard's **Verification → Model skill** chart instead.
> 4. The dashboard shows a **SYNTHETIC SCENARIO** badge. Always say so on camera (the script does this for you) — judges respect honesty.

---

## Part 1 — The hook (0:00 – 0:45)

🎬 Title card: *"Convective Nowcasting for Thunderstorms, Hail & Cloudbursts — SIH 26084 — Team Deadlock (ID 156116)"*. Then the dashboard map, playing.

🗣️
Every year in India, thunderstorms, hailstorms, sudden violent winds and cloudbursts kill people and destroy crops, roads and homes.

The problem is not that we don't have weather models. The problem is **speed and size**.

These storms are born in **minutes**, and they are only **a few kilometres wide**. The big national weather models look at the atmosphere in boxes that are too large, and they take hours to run. By the time they finish, the storm has already formed, hit and gone.

So a district officer, an airport, or a farmer often gets **no useful warning at all**.

We are Team Deadlock, and this is our answer to problem statement **26084** from the **Ministry of Earth Sciences and NCMRWF**.

---

## Part 2 — What the problem asks for (0:45 – 1:45)

🎬 A simple slide with the requirements as a checklist.

🗣️
NCMRWF asked for a system that does five things:

**One** — watch the atmosphere *right now* using three sources: **Doppler weather radar**, the **INSAT satellite**, and the **ground lightning network**.

**Two** — automatically detect a storm **as it is being born**.

**Three** — forecast **four hazards**: lightning, hail, downbursts — those are sudden crushing downward winds — and cloudbursts.

**Four** — do this for the **next 0 to 6 hours**, at **1 to 3 kilometre** detail.

**Five** — show it all on a **live map** with **countdowns** to when the storm will arrive, for three kinds of users: **aviation**, **district administration**, and **farmers**.

That is what we built towards. Let me show you how.

---

## Part 3 — Our idea in one line, and what makes it different (1:45 – 3:00)

🎬 Slide: the one-line pitch, then the five differentiators appearing one by one.

🗣️
Here is our idea in one line:

> *India's deadliest cloudbursts happen where radar can't see. Our system fuses radar, satellite and lightning, keeps forecasting when radar is missing, and turns forecasts into clear, explainable warnings — with every number checked.*

Most teams will build "radar plus satellite plus deep learning, put it on a map". We focused on the problems **India actually has**:

**First — it works when radar is missing.** India has radar gaps, especially in the Himalayas and the North-East, which is exactly where cloudbursts are deadliest. Our model knows, for every single pixel, whether radar can see there fully, partly, or not at all — and it keeps forecasting either way.

**Second — terrain-aware cloudbursts.** Himalayan cloudbursts happen when moist air is pushed up mountain slopes. Our model can use terrain to catch that.

**Third — warnings that name what is at risk.** Not "grid cell 4-5-2", but "hail at the airport in 25 to 40 minutes".

**Fourth — every alert explains *why*.** An officer can check our reasoning against their own judgement.

**Fifth — honesty.** Every number we show comes from evaluation code. If our model loses to a simpler method somewhere, we show that too.

---

## Part 4 — How the system works, end to end (3:00 – 4:15)

🎬 Architecture slide: a left-to-right chain of boxes.
`Data in → Clean & align → Find storms & storm births → ML forecast → Four hazards → Alerts → Dashboard`, with an arrow looping back: `Verification → Recalibrate`.

🗣️
Think of our system as a pipeline — a chain of steps.

**Step 1, data in.** Radar, satellite and lightning arrive every 5 minutes.

**Step 2, clean and align.** Each source has a different grid and different units. We put everything on **one common map grid**, so pixel number 100 in the radar image is the same place as pixel number 100 in the satellite image.

**Step 3, find storms.** We draw an outline around every storm, give it an ID, and follow it over time. We also watch for storms that are **about to be born**.

**Step 4, forecast.** A deep-learning model predicts what the radar and lightning will look like over the next hour.

**Step 5, hazards.** From that forecast we work out the four hazards.

**Step 6, alerts.** We turn hazards into warnings for each type of user, in standard formats, and in three languages.

**Step 7, the dashboard.** Everything shows up on an interactive map.

And there's a loop at the end: after the event, we compare what we predicted with what actually happened, and use that to **tune the system**.

All of this is written in **Python** for the science side — PyTorch, pysteps, LightGBM — and **React with MapLibre** for the dashboard. The code is on GitHub.

🎬 Briefly show the GitHub repo page and folder list.

---

## Part 5 — The data: where we learn from (4:15 – 5:45)

🎬 Show `docs/m2_alignment.png` (four panels: radar, two satellite images, lightning).

🗣️
To train a forecasting model you need **years of storms** where radar, satellite and lightning are all recorded **together and aligned**.

India's archives exist, but getting them needs data agreements — we've started that through **MOSDAC**. So to build and test right now, we use **SEVIR** — a public dataset from MIT with more than **10,000 real storm events** from the USA. Each event is a 384 by 384 kilometre square, 4 hours long, one picture every 5 minutes, with radar, satellite and lightning together.

We selected **1,000 events** — 800 for training, 200 for testing. And we followed a strict rule: everything **before June 2019 is for training**, everything **after is for testing**. The model never sees the test storms. We also picked **extra severe storms** — hail, damaging winds and flash floods — so the model learns the dangerous cases.

Here's one engineering detail we're proud of. SEVIR's files are **4 to 16 gigabytes each**, and our internet connection was about **1 megabyte per second**. Downloading whole files would take days. So we worked out exactly **where each storm sits inside the file** and downloaded **only those bytes** — about 14 megabytes per storm instead of gigabytes.

🎬 Point at the four panels of the alignment image.

We also checked the data very carefully. Look here — the yellow dots are lightning strikes, and they sit **exactly on top of the strongest radar cores**. That proves our four data sources are aligned. While checking, we even **caught an 8-kilometre error** in how the dataset stores lightning positions, and fixed it by using each flash's real latitude and longitude.

Finally, we linked every storm to the official **US Storm Events reports** — the real record of where hail fell and how strong the wind was. **All 393** storm events matched. That gives us true answers to learn hail and wind from.

---

## Part 6 — Radar gaps: teaching the model to work without radar (5:45 – 6:45)

🎬 Show `docs/m4_masks.png` (top row: real radar; middle: coverage map; bottom: what the model sees).

🗣️
Now our first big idea: **radar gaps**.

A radar beam goes out in a straight line, but the Earth curves away underneath it. So far from the radar, the beam is **too high** to see the bottom of a storm. And mountains **block** the beam completely in some directions.

So we sort every pixel into three levels:
**green — full coverage**, **amber — partial coverage**, where the beam is too high, and **red — no coverage at all**.

🎬 Point at the three rows.

The top row is the real radar. The middle row is a coverage map. The bottom row is what our model is allowed to see — radar is **removed** in the red areas, and **weakened** in the amber areas.

We train the model on thousands of these, so it learns to **fill the gaps using satellite and lightning**.

To be clear and honest: right now these coverage maps are **simulated** from real radar physics — beam height and Earth's curve — because the tool that computes India's real coverage map is still being finalised. When it's ready, it plugs straight into the same place.

---

## Part 7 — The forecast, and how we measure it (6:45 – 8:15)

🎬 Open the dashboard → **Verification** tab → scroll to **Model skill**. Hover over the chart.

🗣️
Before building a fancy AI model, you need something to **beat**. We built three standard methods that forecasters already use:

**Persistence** — just assume the storm stays exactly where it is.
**Optical flow** — work out which way the storm is moving and slide it forward.
**S-PROG** — a smarter version that also lets small storm details fade out realistically over time.

To score them, we use **CSI — Critical Success Index**. In simple words: out of all the places where either the forecast or reality had a storm, what fraction did the forecast get right? 1 is perfect, 0 is useless.

🎬 Hover at 30 minutes.

On our first test of 20 storms, at 30 minutes ahead, S-PROG scores about **0.37**, optical flow **0.33**, and persistence only **0.23**. You can see every method gets worse as we look further ahead — that's why short-range forecasting is hard.

Our own model is a **U-Net** — a type of neural network that's very good with images. It looks at the **last hour** of radar, two satellite channels, lightning, and the coverage map, and it predicts the **next hour** of radar **and** lightning together.

We also run it **10 times with small random changes** — this is called an **ensemble**. If all 10 runs agree, we're confident. If they disagree, we're not — and that turns into a **probability**, not just a yes or no.

Because we trained on a small laptop graphics card, we run the model at **2-kilometre** detail — still inside the 1-to-3 km requirement.

🎬 (Only if model results exist in the chart:) Point at the ML line.
*(If the ML line isn't there yet, say:)* The model's final test results will appear on this same chart, from the same evaluation code — nothing is typed in by hand.

---

## Part 8 — Tracking storms and catching them being born (8:15 – 9:30)

🎬 Show `docs/m7_lineage.png`.

🗣️
Next: **tracking**. We draw an outline around every storm and give it an ID. The hard part is when storms **merge** into one, or **split** into two. Many systems lose track at exactly that moment — which is often the most dangerous moment.

We based our tracker on **TITAN**, a well-known method, and extended it: when storms merge or split, the **main storm keeps its ID**. Here, storm number 11 keeps the same ID for almost **four hours**, even as smaller cells split off and join back — those are the orange lines. That matters because an alert raised for storm 11 **stays attached** to the storm that actually arrives.

🎬 Switch to the dashboard, Operations tab. Click **Demo**, go to step 2 ("Storm birth detected").

Now **storm birth** — we call it **convective initiation**. Before a storm shows up on radar, the satellite sees clouds **growing upward fast** — their tops get very cold, very quickly. Our detector looks for exactly that: cloud-top cooling, the coldest cloud tops, cloud tops pushing through the top of the weather layer, and the first lightning.

🎬 Point at the CI ring and the "Why" bars on the right.

Here the ring is the storm-birth score. And on the right is the **"why"** — the top reasons, like "cloud-top cooling" and "lightning onset". An officer can check each one.

We also test this detector with the satellite made **coarser and slower** — like India's INSAT, which scans every 15 to 30 minutes instead of every 5 — so we know how it will behave on Indian data.

---

## Part 9 — The four hazards (9:30 – 10:45)

🎬 Dashboard: Demo step 4 ("Four hazards"). Turn on the hazard layers on the left. Drag the **Lead** slider.

🗣️
Now the four hazards the problem asked for.

**Lightning** — comes straight from our model's lightning output: how many flashes per square kilometre to expect.

**Hail** — a machine-learning classifier looks at each storm: how intense its core is, how cold its cloud top is, how fast its lightning is increasing. It learned from real hail reports.

**Downburst** — see this **PROXY** badge? Measuring wind directly needs Doppler radar wind data, which our training data doesn't have. So for now we use a well-known warning sign: a very strong storm core that **suddenly collapses** — the falling air is what hits the ground. It's clearly labelled as a proxy. In the final version, we'll use Doppler wind from IMD radars.

**Cloudburst** — India defines a cloudburst as about **100 millimetres of rain in one hour** over roughly 20 to 30 square kilometres. We convert our forecast into rain rate using a standard physics formula, add it up over an hour and over a 25-square-kilometre area, and give the **probability** of crossing 100 millimetres. We also state the uncertainty of that formula openly.

🎬 Drag the lead slider past 3 hours; point at the hatched "NCUM blend — not validated" section.

The problem asks for **0 to 6 hours**. Our ML model is strongest up to about 3 hours. Beyond that, the plan is to **blend** smoothly into NCMRWF's own NCUM weather model. We've marked that part as "**designed, not validated**", because our training data is only 4 hours long and we refuse to show numbers we haven't earned.

---

## Part 10 — Confidence you can trust (10:45 – 11:15)

🎬 Show `docs/m8_reliability.png` if it exists; otherwise stay on the dashboard.

🗣️
A forecast that says "70 percent" should be right about 70 percent of the time. We check this with **reliability diagrams**, separately for each hazard and for each level of radar coverage, and we **correct** any over- or under-confidence using a method called **isotonic regression**. So when we say 70 percent, it means 70 percent.

---

## Part 11 — Alerts for real people (11:15 – 12:45)

🎬 Dashboard: Demo step 6 ("One storm, three audiences"). Click through **Aviation / District / Farmers** tabs.

🗣️
A forecast only saves lives when the **right person** gets a **clear message** at the **right time**.

Different users need different things:
**Aviation** can't afford to miss a hailstorm over a runway, so their alerts fire **earlier**, at a lower threshold — a few extra false alarms are acceptable.
**District officers and farmers** stop trusting alerts if there are too many false alarms, so their alerts fire only when we're **more confident**.

We tune these thresholds on data, and we measure how many alerts each group gets and how many were false.

🎬 Point at an alert card: window, probability, the "why" rows, and the baseline line.

Every alert card shows: **what** hazard, **where**, **when** — as a time window like "20 to 50 minutes", never a fake-precise single number — the **probability**, the **reasons**, and even what a simple forecasting method would have done: here it says the baseline warned **10 minutes later** than us.

We also rank alerts by **impact**: hazard probability, times the chance it arrives, times **what is exposed** — an airport, a city of a million people, a farm cluster.

🎬 Click **CAP XML**, then **SMS**, switch to हिन्दी and తెలుగు.

Alerts come out as **CAP** — the international Common Alerting Protocol that India's national alert system, **SACHET**, uses — so they can plug straight into existing channels. And as SMS in **English, Hindi and Telugu**. The Hindi and Telugu are marked for review by native speakers before any real use.

---

## Part 12 — The full dashboard tour, feature by feature (12:45 – 17:00)

> Take this part slowly — it's where judges see everything working. Each block below is one feature: do the 🎬 action, then say the 🗣️ line.

### 12a. The honesty badges and the top bar

🎬 Point at the top bar: clock, **REPLAY** and **SYNTHETIC SCENARIO** badges.

🗣️
First, notice these badges. **REPLAY** means we're playing back recorded time, not a live feed. **SYNTHETIC SCENARIO** means this storm day is **made up, over real places** — Dehradun, Rishikesh, Jolly Grant Airport, the NH-7 Char Dham route. We built it so we could design and test the whole experience before our model runs on Indian data. Everything on screen — alerts, countdowns, scores — is **calculated** from that scenario, never typed in.

The big clock shows the replay time in IST. There are two pages: **Operations**, which is the live control-room view, and **Verification**, where we check how well we did.

### 12b. The map and its layers

🎬 On the left panel, turn **Satellite IR**, **Radar VIL** and **Lightning** on and off one at a time. Then the three hazard layers.

🗣️
The map in the middle shows real terrain shading, so you can see the Himalayan valleys the storms move through.

On the left are the **layers**:
**Satellite IR** — shows cloud tops; the whiter, the colder and taller the cloud.
**Radar VIL** — shows how much water and ice is in each storm; brighter means stronger.
**Lightning** — each yellow dot is a real strike in the last 10 minutes. When we look into the future, it becomes a **forecast lightning density** instead.

Below that are the **hazard layers** — hail, downburst and cloudburst. The shading is the **probability**, and the solid line marks where the probability crosses **50 percent** — a clear "danger zone" outline. Each layer has its own colour key with units, so nothing is guesswork.

We chose the hazard colours carefully: we **tested them for colour-blindness**, and changed hail to magenta because the original purple was nearly impossible to tell apart from the cloudburst blue.

🎬 Move the mouse slowly over a storm.

And if you **hover anywhere**, a small box shows the exact numbers at that spot — radar strength, cloud-top temperature, lightning, and the probability of each hazard.

### 12c. Storms, tracks and storm births on the map

🎬 Point at a white storm ID chip, its solid past track, the dashed forecast track and the faint cone. Then point at a green CI ring.

🗣️
Every storm has a **white ID tag**. If it came from a merge, the tag shows its parents — like "27, from 14 and 19".

The **solid line** behind a storm is where it has been in the last hour. The **dashed line** is where we think it's going in the next hour, with a dot every 10 minutes, and the **faint cone** around it shows our uncertainty — it gets wider the further ahead we look, because the future is less certain.

These **green rings** are **storm births** — clouds the satellite says are about to become storms, before radar sees anything. The ring fills up as the score rises, and it pulses once it crosses 50.

Places at risk — the airport, district headquarters, towns, the pilgrimage route and farm clusters — are marked with icons. When a place has an active alert, its icon gets a **pulsing ring** in the hazard's colour.

### 12d. The two time sliders

🎬 Press **Play**, change speed to **2×**, pause. Drag the **Replay** slider. Then drag the **Lead** slider to 30 min, 2 h, and 4 h. Point at the "Valid" time on the right and the chip at the top-left of the map.

🗣️
At the bottom are two sliders.

The **Replay** slider moves through the day. You can press play, pause, step forward and back five minutes at a time, and choose 1, 2 or 4 times speed. The little **diamonds** are key moments — a storm being born, a first radar echo, a merge, a split — and the **coloured ticks** are alerts being issued, in each hazard's colour.

The **Lead** slider looks **into the future** — from now up to 6 hours ahead. The first half, up to 3 hours, is our **ML forecast**. The striped second half is where we'd **blend into NCMRWF's NCUM model** — and it's labelled "not validated", because we won't claim numbers we haven't tested.

On the right, **"Valid"** shows exactly what time the map is showing, and the chip on the map always says whether you're looking at **observed** reality or a **forecast** — so no one ever confuses the two.

For operators, there are keyboard shortcuts too: space to play or pause, arrow keys to step, and square brackets to move the forecast lead.

### 12e. No-radar modes and the terrain switch

🎬 Switch the top-right control: **All sources → No radar → Satellite only**. Point at the yellow banner on the map. Then on the left, switch **Terrain features** off and on.

🗣️
Up here, you can switch between **all sources**, **no radar**, and **satellite only**. Watch: the forecast keeps going. A yellow banner tells you which mode you're in, and without radar the radar layer is marked "estimated from satellite and lightning". The forecast gets less sharp and less certain — which is exactly what should happen — but it **doesn't stop**. That's the whole point for India's radar gaps.

The **Terrain features** switch shows our terrain idea. With terrain on, the cloudburst on the Char Dham route is warned well ahead. Switch it off, and that same cloudburst is **missed**. That's the difference terrain makes.

### 12f. The right-hand panel: Alerts, Arrivals, Storm

🎬 **Alerts** tab: switch Aviation / District / Farmers; point at a HIT badge, a FALSE ALARM badge, and a MISSED card. **Arrivals** tab: click a place. **Storm** tab: click a storm, then a storm-birth ring.

🗣️
The right-hand panel has three tabs.

**Alerts** — pick the audience at the top, and you see that group's threshold and which hazards they get. Active alerts are on top. As the replay reveals the truth, each alert gets a badge: **HIT** with how many minutes of warning it gave, or **FALSE ALARM**. If a hazard happened with **no** warning, it shows up honestly as a **MISSED** card.

**Arrivals** — a card for every place, with its biggest threat and arrival window in large text. Underneath are four small **hazard strips** — one per hazard — showing the probability every 10 minutes for the next 3 hours, with a white box around the arrival window. Clicking a card highlights that place on the map.

**Storm** — click any storm and you get its **vital signs**: strength and whether it's growing or collapsing, speed and direction, cloud-top temperature, and lightning flash rate compared with 10 minutes ago. Then the chance of each hazard in the next 30 minutes, its **family tree** of merges and splits, and its **origin** — for example, "storm birth flagged at 12:40, first radar echo at 13:00: 20 minutes before radar."

Click a **storm-birth ring** instead, and you see the birth score as a gauge, a small chart of how the score rose over time, and the reasons behind it.

### 12g. The Verification page

🎬 Click **Verification**. Switch the audience chips. Scroll to **Model skill**, change the **Metric** dropdown, hover over the chart, and open **Table view**.

🗣️
The **Verification** page is our report card.

The top table scores every alert from the full replay — hits, misses, false alarms, and three standard scores:
**POD** — out of all real events, how many did we warn about;
**FAR** — out of all our warnings, how many were false;
**CSI** — both combined.
It also shows the **median warning time**, and compares every mode — all sources, no radar, satellite only, terrain off — against a simple baseline. Because this part uses the synthetic day, it's labelled as a demo of the checking process, **not** as proof of skill.

Below that, **Model skill** is the real science. This chart is drawn **directly from our evaluation code's output files** — nothing is typed in. You can switch the score in this dropdown: average CSI, CSI at each storm-strength level, or the **Fractions Skill Score**, which gives credit for being "nearly right" at 1, 5 and 15 kilometres. Hover to read exact values, or open the **table view** for the raw numbers.

### 12h. Built for the real world

🎬 Click **Demo** and press **PageDown** a few times. Then copy the URL. Then show the dashboard at phone size (or on a phone) and open the **Layers** drawer. Optionally click **3D**.

🗣️
A few things we built for real use.

**Guided demo mode** — one button walks through the whole story in 11 steps, with captions. Every number in the captions is calculated live. It even works with a presentation clicker.

**Shareable links** — the web address remembers the exact time, forecast lead and mode. Send it to a colleague, and they see exactly what you see.

**Fully offline** — the maps, place names and terrain are built into the app, because control rooms and hackathon venues don't always have good internet. We tested it with the internet completely switched off.

**Works on a phone** — the layout rearranges itself, and the layers open from a button on the map.

And a **3D view**, which tilts the map so you can see storms moving along the mountain valleys.

### 12i. Built to be checked

🎬 Terminal: run `make test`, then show the `Makefile` briefly.

🗣️
Behind the dashboard, the science side is built to be **re-checked by anyone**. One command downloads the data, one runs the baselines, one checks the data alignment, and there are **automatic tests** for the scoring maths and the alert formats. All settings live in one config file, and all results are saved as files — which is how the dashboard can show only numbers that code actually produced.

---

## Part 13 — Honest limitations (17:00 – 17:45)

🎬 Simple slide with bullet points.

🗣️
We want to be upfront about what's not finished yet:

- Our model is trained on **US data** for now. Moving to India needs **INSAT, IMD radar and IMD lightning data** — we've started the MOSDAC process.
- The radar coverage maps are **simulated** until India's real coverage map is ready.
- **Downburst** is a proxy until we have Doppler wind data.
- **3 to 6 hours** is designed but **not yet validated**.
- The dashboard's storm day is **synthetic**; the next step is to replay **real recorded storms** through the same screens.
- Hindi and Telugu messages need **native-speaker review**.

We'd rather show you exactly where we are than claim more than we've done.

---

## Part 14 — What's next, and closing (17:45 – 18:30)

🎬 Roadmap slide, then back to the dashboard map for the final line.

🗣️
Our next steps:
run the full model evaluation on all 200 test storms;
replay real recorded storms in the dashboard;
compute India's real radar coverage map;
and, as soon as the data arrives, run a **real Indian storm** — ideally a Himalayan cloudburst — through the whole system.

To sum up:
we built a system that watches radar, satellite and lightning together,
spots storms **before radar sees them**,
keeps forecasting **where radar is missing**,
forecasts **all four hazards**,
and turns them into **clear, explainable warnings** for the people who need them —
with **every number checked**.

We're Team Deadlock. Thank you.

🎬 End card: team name, Team ID 156116, GitHub link.

---

### Quick glossary (if a teammate needs it while recording)

| Word | Simple meaning |
|---|---|
| Nowcasting | Forecasting the next few hours using what's happening right now |
| VIL | How much water/ice a storm column holds — a radar measure of storm strength |
| CSI | Score from 0 to 1: how well the forecast storm area matches the real one |
| Ensemble | Running the model several times to see how sure it is |
| Convective initiation (CI) | A new storm being born |
| Downburst | A sudden, very strong downward wind from a collapsing storm |
| Cloudburst | ~100 mm of rain in one hour over a small area |
| CAP | Common Alerting Protocol — the standard alert format used by SACHET |
| Proxy | An indirect sign used when the direct measurement isn't available |

---

## Appendix — Complete feature checklist

Use this to make sure nothing is left out of the video (✅ = built, 🧪 = built, results still coming, ⏳ = planned).

**Data and science pipeline**
- ✅ SEVIR subset downloader — fetches only each storm's bytes, resumes if interrupted
- ✅ Train/test split by date (before / after 1 June 2019), extra severe storms
- ✅ Data alignment check (radar, two satellite channels, lightning on one grid)
- ✅ Lightning placed from each flash's real lat/lon (fixed an 8 km offset)
- ✅ Link to US Storm Events reports (hail size, wind speed) — 393/393 matched
- ✅ Three baselines: persistence, optical flow, S-PROG
- ✅ Scores: CSI, POD, FAR, bias, Fractions Skill Score, amplitude bias, per lead time
- ✅ Radar coverage tiers (full / partial / none) — simulated until India's real map is ready
- ✅ Tier-aware U-Net: radar + 2 satellite channels + lightning + coverage → next hour of radar and lightning
- ✅ 10-run ensemble → probabilities
- 🧪 Full test-set evaluation per lead time and per coverage tier
- ✅ Storm tracking with IDs kept through merges and splits; family-tree image
- ✅ Arrival windows from many slightly different storm paths
- 🧪 Storm-birth detector (satellite-first, reasons via SHAP), also tested at INSAT-like 4 km and 15/30-min scans
- 🧪 Hail and downburst (proxy) classifiers per coverage tier; downburst wind band
- ✅ Cloudburst: rain-rate formula, 1-hour and 25 km² total, probability of ≥ 100 mm, stated uncertainty
- ✅ Downburst hidden where there's no radar coverage (tier gating)
- 🧪 Reliability check and isotonic correction per hazard and tier
- ✅ Impact score = hazard × arrival × exposure (cities by population, airports)
- 🧪 Audience thresholds tuned on data; alert count and false-alarm rate vs one fixed threshold
- ✅ CAP 1.2 alerts with coverage and confidence text
- ✅ SMS in English, Hindi, Telugu (Hindi/Telugu flagged for review)
- ✅ Automatic tests, Makefile, single config file, results saved as files
- ⏳ 3–6 h blend with NWP (designed, not validated)
- ⏳ Real Indian storm case (needs MOSDAC/IMD data)
- ⏳ Replay of real recorded storms in the dashboard + API server

**Dashboard**
- ✅ Honesty badges: REPLAY, SYNTHETIC SCENARIO, PROXY, US-SEVIR
- ✅ Map with real terrain shading; layers for satellite, radar, lightning, hail, downburst, cloudburst
- ✅ 50 % danger-zone outlines; colour keys with units; colour-blind-tested colours
- ✅ Hover readout of exact values at any point
- ✅ Storm ID tags with merge parents; past track, forecast track, uncertainty cone
- ✅ Storm-birth rings that fill with the score
- ✅ Places at risk with pulsing alert rings
- ✅ Replay slider with play/pause/step/speed, event diamonds, alert ticks
- ✅ Forecast-lead slider 0–6 h (ML 0–3 h, NWP blend 3–6 h marked "not validated")
- ✅ Observed/forecast indicator and valid time
- ✅ All sources / No radar / Satellite only switch with banner
- ✅ Terrain features on/off (ablation)
- ✅ Alerts tab: audiences, thresholds, window, probability, reasons, HIT / FALSE ALARM / MISSED, baseline comparison, CAP XML and SMS preview
- ✅ Arrivals tab: countdown card per place with 3-hour hazard strips
- ✅ Storm tab: vital signs, hazard chances, family tree, origin; storm-birth gauge and history chart
- ✅ Verification page: replay scores per mode vs baseline; Model skill chart from evaluation files with metric switch, hover and table view
- ✅ Guided demo mode (11 steps, clicker support)
- ✅ Shareable links; keyboard shortcuts
- ✅ Fully offline maps; phone layout with layers drawer; 3D view

