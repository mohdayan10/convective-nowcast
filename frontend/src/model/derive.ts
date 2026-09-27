// Everything the panels show is derived here from the model: per-site hazard
// curves, arrival windows, audience alerts, verification against truth, and
// the extrapolation-baseline comparison.

import { FRAME, T_END, clockLabel, fromLngLat, interp } from "./grid";
import {
  Mode, Model, TERRAIN, brightnessTemp, ciDetectTime, flashRate, sample, statesAt, truthState,
} from "./physics";
import {
  AUDIENCES, Audience, HAZARDS, Hazard, SITES, STORMS, Site, siteById, stormById, upslope,
} from "./scenario";

export const HAZARD_LABEL: Record<Hazard, string> = {
  lightning: "Lightning",
  hail: "Hail",
  downburst: "Downburst",
  cloudburst: "Cloudburst",
};

export const AUDIENCE_LABEL: Record<Audience, string> = {
  aviation: "Aviation",
  district: "District",
  farmers: "Farmers",
};

/** Aviation tolerates false alarms to avoid misses; districts & farmers the reverse. */
export const AUDIENCE_RULES: Record<Audience, { threshold: number; hazards: Hazard[]; note: string }> = {
  aviation: { threshold: 0.3, hazards: ["lightning", "hail", "downburst"], note: "High POD — low-miss threshold" },
  district: { threshold: 0.6, hazards: ["hail", "downburst", "cloudburst", "lightning"], note: "Low FAR — high-confidence threshold" },
  farmers: { threshold: 0.6, hazards: ["hail", "cloudburst", "lightning"], note: "Low FAR — high-confidence threshold" },
};

const ALERT_HORIZON = 120;

// ---- per-site probability curves -------------------------------------------

function sitePoints(s: Site): [number, number][] {
  const pts: [number, number][] = [[s.x, s.y]];
  if (s.kind === "route" && s.shape) {
    for (const [lng, lat] of s.shape) pts.push(fromLngLat(lng, lat));
    return pts;
  }
  const r = s.radius * 0.7;
  for (let k = 0; k < 4; k++) pts.push([s.x + r * Math.cos((k * Math.PI) / 2), s.y + r * Math.sin((k * Math.PI) / 2)]);
  return pts;
}
const POINTS = new Map(SITES.map((s) => [s.id, sitePoints(s)]));

export type Curve = Record<Hazard, number[]>;

const curveCache = new Map<string, Curve>();

/** Max hazard probability over the site, per lead (step `step` min, 0..maxLead). */
export function siteCurve(site: Site, t: number, model: Model, maxLead = 180, step = 10): Curve {
  const key = `${site.id}|${t}|${model}|${TERRAIN.on}|${maxLead}|${step}`;
  const hit = curveCache.get(key);
  if (hit) return hit;
  const c: Curve = { lightning: [], hail: [], downburst: [], cloudburst: [] };
  for (let l = 0; l <= maxLead; l += step) {
    const m = { lightning: 0, hail: 0, downburst: 0, cloudburst: 0 };
    for (const [x, y] of POINTS.get(site.id)!) {
      const h = sample(t, l, model, x, y);
      for (const hz of HAZARDS) m[hz] = Math.max(m[hz], h[hz]);
    }
    for (const hz of HAZARDS) c[hz].push(m[hz]);
  }
  if (curveCache.size > 6000) curveCache.clear();
  curveCache.set(key, c);
  return c;
}

export interface Window {
  hazard: Hazard;
  /** Minutes from now; start 0 = already occurring. */
  start: number;
  end: number;
  p: number;
  peakLead: number;
}

/** Arrival window for one hazard: span of leads where p ≥ 0.8·threshold around the peak. */
export function windowFor(curve: number[], hazard: Hazard, threshold: number, step = 10): Window | null {
  let pk = -1, p = 0;
  curve.forEach((v, i) => { if (v > p) { p = v; pk = i; } });
  if (pk < 0 || p < threshold) return null;
  const cut = threshold * 0.8;
  let a = pk, b = pk;
  while (a > 0 && curve[a - 1] >= cut) a--;
  while (b < curve.length - 1 && curve[b + 1] >= cut) b++;
  return { hazard, start: a * step, end: b * step + step, p, peakLead: pk * step };
}

export interface Countdown {
  site: Site;
  windows: Window[];
  curve: Curve;
}

export function countdowns(t: number, mode: Mode): Countdown[] {
  return SITES.map((site) => {
    const curve = siteCurve(site, t, mode, 180, 10);
    const windows = HAZARDS.map((h) => windowFor(curve[h], h, 0.3)).filter(Boolean) as Window[];
    windows.sort((a, b) => b.p - a.p);
    return { site, windows, curve };
  }).sort((a, b) => {
    const pa = a.windows[0]?.p ?? 0, pb = b.windows[0]?.p ?? 0;
    return pb - pa || (a.windows[0]?.start ?? 999) - (b.windows[0]?.start ?? 999);
  });
}

// ---- reasons ("why") --------------------------------------------------------

export interface Reason { label: string; value: string; weight: number }

function nearestStorm(site: Site, t: number, lead: number, model: Model) {
  let best: { id: number; d: number } | null = null;
  for (const st of statesAt(t, lead, model === "truth" ? "all" : model)) {
    const d = Math.hypot(st.x - site.x, st.y - site.y);
    if (!best || d < best.d) best = { id: st.id, d };
  }
  return best ? stormById.get(best.id)! : null;
}

export function reasonsFor(site: Site, hazard: Hazard, t: number, lead: number, mode: Mode): Reason[] {
  const s = nearestStorm(site, t, lead, mode);
  // Read features where the hazard peaks within the site (a route spans ~35 km).
  const h = POINTS.get(site.id)!
    .map(([x, y]) => sample(t, lead, mode, x, y))
    .reduce((a, b) => (b[hazard] > a[hazard] ? b : a));
  const r: Reason[] = [];
  const now = s ? truthState(s, t) : null;
  if (hazard === "hail" || hazard === "lightning") {
    const tb = s && now ? brightnessTemp(t, now.x, now.y) : 250;
    r.push({ label: "Cold cloud top", value: `${(tb - 273.15).toFixed(0)} °C`, weight: Math.max(0, (243 - tb) / 40) });
  }
  if (s && now && (hazard === "hail" || hazard === "lightning")) {
    const f0 = flashRate(s, t - 10), f1 = flashRate(s, t);
    const jump = f0 > 0.5 ? f1 / f0 : f1 > 0.5 ? 3 : 1;
    r.push({ label: "Lightning jump", value: `×${jump.toFixed(1)} in 10 min`, weight: Math.min(1, Math.max(0, jump - 1) / 1.5) });
    r.push({ label: "Flash rate", value: `${f1.toFixed(0)} /min`, weight: Math.min(1, f1 / 25) });
  }
  if (hazard === "lightning") {
    r.push({ label: "Forecast flash density", value: `${h.lightningDensity.toFixed(1)} fl km⁻² h⁻¹`, weight: Math.min(1, h.lightningDensity / 4) });
  }
  if (hazard === "hail") {
    r.push({ label: "Forecast core VIL", value: `${h.vil.toFixed(0)} kg/m²`, weight: Math.min(1, Math.max(0, (h.vil - 30) / 30)) });
  }
  if (hazard === "cloudburst") {
    r.push({ label: "1-h rain forecast", value: `${h.accum.toFixed(0)} mm`, weight: Math.min(1, h.accum / 120) });
    const up = upslope(site.x, site.y);
    r.push({ label: "Moist upslope flow", value: up > 0.3 ? "strong" : up > 0.1 ? "moderate" : "weak", weight: Math.min(1, up * 1.5) });
    if (now) r.push({ label: "Slow storm motion", value: `${(now.speed * 60).toFixed(0)} km/h`, weight: Math.max(0, 1 - now.speed * 60 / 30) });
  }
  if (hazard === "downburst" && s) {
    const tv = t + lead;
    const a = interp(s.vil, tv), b = interp(s.vil, tv + 15);
    r.push({ label: "Core collapse (proxy)", value: `−${Math.max(0, ((a - b) / Math.max(a, 1)) * 100).toFixed(0)}% VIL / 15 min`, weight: Math.min(1, Math.max(0, (a - b) / Math.max(a, 1)) * 2) });
    r.push({ label: "Recent core VIL", value: `${Math.max(a, interp(s.vil, tv - 20)).toFixed(0)} kg/m²`, weight: Math.min(1, Math.max(a, interp(s.vil, tv - 20)) / 60) });
  }
  return r.filter((x) => x.weight >= 0.05).sort((a, b) => b.weight - a.weight).slice(0, 3);
}

// ---- alerts -----------------------------------------------------------------

export type Outcome = "pending" | "hit" | "false-alarm";

export interface Alert {
  id: string;
  t: number;
  site: Site;
  hazard: Hazard;
  audience: Audience;
  p: number;
  start: number;
  end: number;
  expires: number;
  peakLead: number;
  stormId: number | null;
  /** First truth onset inside the alert's validity, if any. */
  onset: number | null;
}

export interface Miss { site: Site; hazard: Hazard; audience: Audience; onset: number }

/** Onset times (min) where truth first crosses 0.5 after ≥ 30 min without the hazard. */
const truthOnsetCache = new Map<string, number[]>();
export function truthOnsets(site: Site, hazard: Hazard): number[] {
  const key = `${site.id}|${hazard}`;
  const hit = truthOnsetCache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  let last = -999;
  for (let t = 0; t <= T_END; t += FRAME) {
    const p = siteCurve(site, t, "truth", 0, 10)[hazard][0];
    if (p >= 0.5) {
      if (t - last > 30) out.push(t);
      last = t;
    }
  }
  truthOnsetCache.set(key, out);
  return out;
}

export interface AlertSet { alerts: Alert[]; misses: Miss[] }

const alertCache = new Map<string, AlertSet>();

/** Every alert the model would issue over the replay, with its verification. */
export function allAlerts(model: Mode | "baseline"): AlertSet {
  const ck = `${model}|${TERRAIN.on}`;
  const hit = alertCache.get(ck);
  if (hit) return hit;
  const alerts: Alert[] = [];
  const active = new Map<string, Alert>();
  for (let t = 0; t <= T_END; t += FRAME) {
    for (const site of SITES) {
      const curve = siteCurve(site, t, model, ALERT_HORIZON, 10);
      for (const audience of site.audiences) {
        const rule = AUDIENCE_RULES[audience];
        for (const hazard of rule.hazards) {
          const key = `${site.id}|${hazard}|${audience}`;
          const cur = active.get(key);
          if (cur && cur.expires > t) continue;
          const w = windowFor(curve[hazard], hazard, rule.threshold);
          if (!w) continue;
          const s = nearestStorm(site, t, w.peakLead, model === "baseline" ? "all" : model);
          const a: Alert = {
            id: `${key}|${t}`, t, site, hazard, audience, p: w.p,
            start: w.start, end: w.end, expires: t + w.end + 30, peakLead: w.peakLead,
            stormId: s?.id ?? null, onset: null,
          };
          active.set(key, a);
          alerts.push(a);
        }
      }
    }
  }
  // An alert verifies if the hazard is observed at the site at any time in its validity
  // (an alert issued while the hazard is already under way verifies with zero lead).
  for (const a of alerts)
    for (let t = a.t; t <= Math.min(a.expires, T_END); t += FRAME)
      if (siteCurve(a.site, t, "truth", 0, 10)[a.hazard][0] >= 0.5) { a.onset = t; break; }
  // A miss is an onset with no alert issued in advance of it.
  const misses: Miss[] = [];
  for (const site of SITES)
    for (const audience of site.audiences)
      for (const hazard of AUDIENCE_RULES[audience].hazards)
        for (const onset of truthOnsets(site, hazard)) {
          const warned = alerts.some(
            (a) => a.site === site && a.hazard === hazard && a.audience === audience && a.t <= onset && onset <= a.expires,
          );
          if (!warned) misses.push({ site, hazard, audience, onset });
        }
  const set = { alerts, misses };
  alertCache.set(ck, set);
  return set;
}

export function outcome(a: Alert, now: number): Outcome {
  if (a.onset !== null && a.onset <= now) return "hit";
  if (now >= a.expires) return a.onset !== null ? "hit" : "false-alarm";
  return "pending";
}

export interface Score {
  hits: number;
  misses: number;
  falseAlarms: number;
  alerts: number;
  medianLead: number | null;
}

/** Verification restricted to what has been revealed by `now` (T_END = full replay). */
export function score(set: AlertSet, audience: Audience | "all", now = T_END): Score {
  const al = set.alerts.filter((a) => (audience === "all" || a.audience === audience) && a.t <= now);
  const hits = al.filter((a) => outcome(a, now) === "hit");
  const fa = al.filter((a) => outcome(a, now) === "false-alarm").length;
  const ms = set.misses.filter((m) => (audience === "all" || m.audience === audience) && m.onset <= now).length;
  const leads = hits.map((a) => (a.onset ?? a.t) - a.t).sort((x, y) => x - y);
  return {
    hits: hits.length, misses: ms, falseAlarms: fa, alerts: al.length,
    medianLead: leads.length ? leads[Math.floor(leads.length / 2)] : null,
  };
}

// ---- CI summary -------------------------------------------------------------

export function ciLeads(mode: Mode) {
  return STORMS.filter((s) => s.ci).map((s) => {
    const d = ciDetectTime(s, mode);
    return { id: s.id, detect: d, echo: s.tEcho, lead: d === null ? null : s.tEcho - d };
  });
}

// ---- CAP 1.2 + SMS ----------------------------------------------------------

const HAZ_HI: Record<Hazard, string> = {
  lightning: "आकाशीय बिजली", hail: "ओलावृष्टि", downburst: "अचानक तेज़ आँधी", cloudburst: "बादल फटने",
};
const HAZ_TE: Record<Hazard, string> = {
  lightning: "పిడుగులు", hail: "వడగళ్ల వాన", downburst: "ఆకస్మిక బలమైన గాలులు", cloudburst: "మేఘ విస్ఫోటనం",
};
const ACTION: Record<Hazard, { en: string; hi: string; te: string }> = {
  lightning: {
    en: "Stay indoors, keep away from open fields and tall trees.",
    hi: "घर के अंदर रहें, खुले खेतों और ऊँचे पेड़ों से दूर रहें।",
    te: "ఇంట్లోనే ఉండండి, బహిరంగ పొలాలు మరియు ఎత్తైన చెట్లకు దూరంగా ఉండండి.",
  },
  hail: {
    en: "Move people and cattle indoors; cover nursery beds.",
    hi: "लोगों और पशुओं को अंदर ले जाएँ; नर्सरी को ढकें।",
    te: "ప్రజలను, పశువులను లోపలికి తరలించండి; నారుమళ్లను కప్పండి.",
  },
  downburst: {
    en: "Secure loose objects; stay away from hoardings and weak structures.",
    hi: "ढीली चीज़ें बाँध दें; होर्डिंग और कमज़ोर ढाँचों से दूर रहें।",
    te: "వదులుగా ఉన్న వస్తువులను కట్టివేయండి; హోర్డింగ్‌లు, బలహీన నిర్మాణాలకు దూరంగా ఉండండి.",
  },
  cloudburst: {
    en: "Avoid river banks and slopes; halt travel on the route.",
    hi: "नदी किनारों और ढलानों से दूर रहें; मार्ग पर यात्रा रोकें।",
    te: "నది ఒడ్డులు, వాలులకు దూరంగా ఉండండి; మార్గంలో ప్రయాణం ఆపండి.",
  },
};

const pct = (p: number) => `${Math.round(p * 100)}%`;
export const windowText = (start: number, end: number) =>
  start <= 0 ? `now – ${end} min` : `${start}–${end} min`;

export function sms(a: Alert) {
  const w = windowText(a.start, a.end);
  const wHi = a.start <= 0 ? `अभी से ${a.end} मिनट तक` : `${a.start}–${a.end} मिनट में`;
  const wTe = a.start <= 0 ? `ఇప్పటి నుండి ${a.end} నిమిషాల వరకు` : `${a.start}–${a.end} నిమిషాల్లో`;
  const act = ACTION[a.hazard];
  return {
    en: `${HAZARD_LABEL[a.hazard]} warning: ${a.site.short} in ${w} (${pct(a.p)}). ${act.en}`,
    hi: `${HAZ_HI[a.hazard]} की चेतावनी: ${a.site.hi} में ${wHi} (${pct(a.p)})। ${act.hi}`,
    te: `${HAZ_TE[a.hazard]} హెచ్చరిక: ${a.site.te} వద్ద ${wTe} (${pct(a.p)}). ${act.te}`,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function capXml(a: Alert, lngLat: [number, number]) {
  const iso = (t: number) => `2026-05-18T${clockLabel(t)}:00+05:30`;
  const severity = a.hazard === "cloudburst" || a.p > 0.7 ? "Severe" : "Moderate";
  const certainty = a.p >= 0.5 ? "Likely" : "Possible";
  const act = ACTION[a.hazard].en;
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>deadlock-nowcast-${esc(a.id.replace(/\|/g, "-"))}</identifier>
  <sender>nowcast@deadlock.example</sender>
  <sent>${iso(a.t)}</sent>
  <status>Exercise</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>Synthetic scenario — not an operational warning</note>
  <info>
    <language>en-IN</language>
    <category>Met</category>
    <event>${HAZARD_LABEL[a.hazard]}</event>
    <responseType>Shelter</responseType>
    <urgency>${a.start <= 30 ? "Immediate" : "Expected"}</urgency>
    <severity>${severity}</severity>
    <certainty>${certainty}</certainty>
    <audience>${AUDIENCE_LABEL[a.audience]}</audience>
    <onset>${iso(a.t + a.start)}</onset>
    <expires>${iso(a.expires)}</expires>
    <senderName>Deadlock Nowcast (SIH 26084 prototype)</senderName>
    <headline>${esc(`${HAZARD_LABEL[a.hazard]} ${windowText(a.start, a.end)} — ${a.site.name}`)}</headline>
    <description>${esc(`Probability ${pct(a.p)} within the window. Issued from the 0–2 h nowcast.`)}</description>
    <instruction>${esc(act)}</instruction>
    <parameter><valueName>probability</valueName><value>${a.p.toFixed(2)}</value></parameter>
    <area>
      <areaDesc>${esc(a.site.name)}</areaDesc>
      <circle>${lngLat[1].toFixed(4)},${lngLat[0].toFixed(4)} ${a.site.radius.toFixed(1)}</circle>
    </area>
  </info>
</alert>`;
}

export { siteById, AUDIENCES };
