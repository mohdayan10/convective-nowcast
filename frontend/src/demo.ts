// Guided demo: the §10 demo script as steps. Every number in a caption is
// computed from the scenario at build time, never typed in.

import type { View } from "./components/TopBar";
import type { Tab } from "./components/SidePanel";
import type { Selection } from "./map/MapView";
import { clockLabel } from "./model/grid";
import { Layer, Mode, TERRAIN, ciDetectTime, setTerrain } from "./model/physics";
import { Alert, allAlerts, countdowns, HAZARD_LABEL, score, windowText } from "./model/derive";
import { Audience, stormById } from "./model/scenario";

export interface DemoState {
  view: View;
  t: number;
  lead: number;
  mode: Mode;
  terrain: boolean;
  layers: Layer[];
  tab: Tab;
  audience: Audience;
  selected: Selection;
}

export interface Step { title: string; say: string; state: DemoState }

const first = (xs: Alert[], f: (a: Alert) => boolean) => xs.filter(f).sort((a, b) => a.t - b.t)[0];

export function buildSteps(): Step[] {
  const was = TERRAIN.on;
  setTerrain(true);
  const ours = allAlerts("all");
  const noradar = allAlerts("noradar");
  const base = allAlerts("baseline");
  const cbOn = first(ours.alerts, (a) => a.site.id === "nh7" && a.hazard === "cloudburst" && a.audience === "district");
  setTerrain(false);
  const off = allAlerts("all");
  const cbOffMissed = off.misses.some((m) => m.site.id === "nh7" && m.hazard === "cloudburst");
  setTerrain(true);
  const cd = countdowns(140, "all").find((c) => c.site.id === "ded");
  setTerrain(was);

  const s14 = stormById.get(14)!;
  const d14 = ciDetectTime(s14, "all") ?? s14.tEcho;
  const hailAv = first(ours.alerts, (a) => a.site.id === "ded" && a.hazard === "hail" && a.audience === "aviation");
  const hailDi = first(ours.alerts, (a) => a.site.id === "ded" && a.hazard === "hail" && a.audience === "district");
  const hailBase = first(base.alerts, (a) => a.site.id === "ded" && a.hazard === "hail");
  const lead = (a?: Alert) => (a?.onset != null ? a.onset - a.t : null);
  const mAll = score(ours, "all").medianLead, mNr = score(noradar, "all").medianLead, mBase = score(base, "all").medianLead;
  const top = cd?.windows[0];

  const S = (p: Partial<DemoState>): DemoState => ({
    view: "ops", t: 140, lead: 0, mode: "all", terrain: true,
    layers: ["ir", "vil", "lightning", "hail", "cloudburst"], tab: "alerts", audience: "district", selected: null, ...p,
  });

  return [
    {
      title: "Before radar sees anything",
      say: `${clockLabel(30)} IST. No echo on radar yet, so the extrapolation baseline has nothing to move and issues no warning. Satellite IR already shows cumulus growing over the Doon valley.`,
      state: S({ t: 30, layers: ["ir", "vil", "lightning"], tab: "storm" }),
    },
    {
      title: "Storm birth detected",
      say: `The CI score for the cell that becomes 14 crosses 50 at ${clockLabel(d14)}, driven by cloud-top cooling. The first radar echo arrives at ${clockLabel(s14.tEcho)}, ${s14.tEcho - d14} min later.`,
      state: S({ t: d14, layers: ["ir", "vil", "lightning"], tab: "storm", selected: { kind: "storm", id: 14 } }),
    },
    {
      title: "Tracking through a merge",
      say: "Cells 14 and 19 merge into 27. Lineage is kept, so an alert raised for 14 stays attached to the storm that actually arrives.",
      state: S({ t: 140, tab: "storm", selected: { kind: "storm", id: 27 } }),
    },
    {
      title: "Four hazards, 0–6 h, 1 km",
      say: "Lightning, hail, downburst (proxy) and cloudburst, each as a probability on the 1 km grid. Drag the lead slider: beyond 3 h the ML nowcast fades into the NCUM blend, which is labelled as not yet validated.",
      state: S({ t: 140, lead: 30, layers: ["vil", "lightning", "hail", "downburst", "cloudburst"] }),
    },
    {
      title: "Arrival windows, not single numbers",
      say: top
        ? `Jolly Grant Airport: ${HAZARD_LABEL[top.hazard].toLowerCase()} ${windowText(top.start, top.end)} at ${Math.round(top.p * 100)}%. The window narrows as the storm gets closer.`
        : "Each location gets an arrival window with a probability, and the window narrows as the storm gets closer.",
      state: S({ t: 140, tab: "arrivals", selected: { kind: "site", id: "ded" } }),
    },
    {
      title: "One storm, three audiences",
      say: `Aviation alerts at 30% (few misses); districts and farmers at 60% (few false alarms). Hail at the airport: aviation warned at ${hailAv ? clockLabel(hailAv.t) : "—"}, the district at ${hailDi ? clockLabel(hailDi.t) : "—"}. Every alert exports as CAP XML and SMS.`,
      state: S({ t: 145, tab: "alerts", audience: "aviation" }),
    },
    {
      title: "The replay reveals the truth",
      say: `Hail reached the airport at ${hailAv?.onset != null ? clockLabel(hailAv.onset) : "—"}: ${lead(hailAv) ?? "—"} min after the aviation alert. The extrapolation baseline ${hailBase ? `warned at ${clockLabel(hailBase.t)}` : "never warned"}.`,
      state: S({ t: 175, tab: "alerts", audience: "aviation" }),
    },
    {
      title: "Radar-denied mode",
      say: `Same scene with the radar removed: the nowcast keeps running on satellite and lightning. In this scenario the median warning lead is ${mAll ?? "—"} min with all sources, ${mNr ?? "—"} min with no radar, and ${mBase ?? "—"} min for the baseline.`,
      state: S({ t: 150, mode: "noradar", lead: 20 }),
    },
    {
      title: "Terrain-aware cloudburst",
      say: cbOn
        ? `Moist air forced up the slopes along NH-7 will re-intensify the storm after it splits. With terrain features on, the model sees this coming and warns at ${clockLabel(cbOn.t)}${cbOn.onset != null ? `, ${cbOn.onset - cbOn.t} min before onset` : ""}.`
        : "With terrain features on, the model sees orographic re-intensification along NH-7.",
      state: S({ t: cbOn?.t ?? 250, lead: 60, layers: ["vil", "cloudburst"], selected: { kind: "site", id: "nh7" } }),
    },
    {
      title: "Ablation: terrain off",
      say: cbOffMissed
        ? "The same model without terrain features: the NH-7 cloudburst is missed. The Verification page reports this ablation next to the other modes."
        : "The same model without terrain features loses skill on the NH-7 cloudburst.",
      state: S({ t: cbOn?.t ?? 250, lead: 60, terrain: false, layers: ["vil", "cloudburst"], selected: { kind: "site", id: "nh7" } }),
    },
    {
      title: "Verification",
      say: "Every alert is scored as a hit, miss or false alarm against what happened, next to the baseline and each input mode. Model skill appears only once the evaluation harness has written results.",
      state: S({ view: "verify" }),
    },
  ];
}
