import { useMemo } from "react";
import { Check, FileCode2, MessageSquareText, X, Clock3, CircleAlert } from "lucide-react";
import { clockLabel } from "../model/grid";
import {
  Alert, AlertSet, AUDIENCE_LABEL, AUDIENCE_RULES, Countdown, HAZARD_LABEL, Window,
  outcome, reasonsFor, windowText,
} from "../model/derive";
import { Mode } from "../model/physics";
import { AUDIENCES, Audience, HAZARDS, Hazard } from "../model/scenario";
import { HAZARD_COLOR } from "../map/raster";
import type { Selection } from "../map/MapView";
import { Badge, HazardIcon, Segmented, SiteIcon, pct } from "./ui";
import StormCard from "./StormCard";

export type Tab = "alerts" | "arrivals" | "storm";

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  t: number;
  mode: Mode;
  audience: Audience;
  onAudience: (a: Audience) => void;
  set: AlertSet;
  /** Extrapolation-baseline alerts, for the per-alert comparison. */
  baseline: Alert[];
  countdowns: Countdown[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  onOpenAlert: (a: Alert, view: "cap" | "sms") => void;
}

export default function SidePanel(p: Props) {
  const issued = p.set.alerts.filter((a) => a.t <= p.t);
  const activeCount = (aud: Audience) => issued.filter((a) => a.audience === aud && outcome(a, p.t) === "pending").length;

  return (
    <aside className="side" aria-label="Alerts and details">
      <div className="side-tabs" role="tablist">
        {(["alerts", "arrivals", "storm"] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={p.tab === k} className={p.tab === k ? "on" : ""} onClick={() => p.onTab(k)}>
            {k === "alerts" ? "Alerts" : k === "arrivals" ? "Arrivals" : "Storm"}
            {k === "alerts" && AUDIENCES.reduce((n, a) => n + activeCount(a), 0) > 0 && (
              <span className="count">{AUDIENCES.reduce((n, a) => n + activeCount(a), 0)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="side-body">
        {p.tab === "alerts" && <AlertsTab {...p} activeCount={activeCount} />}
        {p.tab === "arrivals" && <ArrivalsTab {...p} />}
        {p.tab === "storm" && <StormCard t={p.t} mode={p.mode} selected={p.selected} onSelect={p.onSelect} />}
      </div>
    </aside>
  );
}

// ---- alerts -----------------------------------------------------------------

function AlertsTab(p: Props & { activeCount: (a: Audience) => number }) {
  const rule = AUDIENCE_RULES[p.audience];
  const list = useMemo(() => {
    const mine = p.set.alerts.filter((a) => a.audience === p.audience && a.t <= p.t);
    const rank = (a: Alert) => (outcome(a, p.t) === "pending" ? 0 : 1);
    return mine.sort((a, b) => rank(a) - rank(b) || b.t - a.t);
  }, [p.set, p.audience, p.t]);
  const misses = p.set.misses.filter((m) => m.audience === p.audience && m.onset <= p.t);

  return (
    <>
      <Segmented<Audience>
        label="Audience"
        value={p.audience}
        onChange={p.onAudience}
        options={AUDIENCES.map((a) => ({
          value: a,
          label: <>{AUDIENCE_LABEL[a]}{p.activeCount(a) > 0 && <span className="seg-count">{p.activeCount(a)}</span>}</>,
        }))}
      />
      <div className="rule">
        <span>Threshold <b>{pct(rule.threshold)}</b></span>
        <span className="rule-note">{rule.note}</span>
        <span className="rule-haz">{rule.hazards.map((h) => <HazardIcon key={h} h={h} size={13} />)}</span>
      </div>

      {list.length === 0 && misses.length === 0 && (
        <div className="empty">
          <Clock3 size={20} />
          <div>No alerts for {AUDIENCE_LABEL[p.audience].toLowerCase()} yet.</div>
          <div className="muted">Alerts fire when a hazard's probability at a site crosses {pct(rule.threshold)} within the next 2 h.</div>
        </div>
      )}

      {misses.map((m) => (
        <div key={`${m.site.id}${m.hazard}${m.onset}`} className="alert miss" style={{ "--hz": HAZARD_COLOR[m.hazard] } as React.CSSProperties}>
          <div className="alert-top">
            <HazardIcon h={m.hazard} />
            <span className="alert-title">{HAZARD_LABEL[m.hazard]} — {m.site.short}</span>
            <Badge tone="bad"><X size={11} /> MISSED</Badge>
          </div>
          <div className="alert-sub">Observed from {clockLabel(m.onset)} with no warning issued in advance.</div>
        </div>
      ))}

      {list.map((a) => <AlertCard key={a.id} a={a} t={p.t} mode={p.mode} baseline={p.baseline} onOpen={p.onOpenAlert} onSelect={p.onSelect} />)}
    </>
  );
}

function baselineNote(a: Alert, t: number, baseline: Alert[]) {
  // The baseline's matching alert: same site, hazard and audience, issued up to 30 min
  // before ours and no later than the event. Only what it had issued by `t` is shown.
  const until = a.onset ?? a.expires;
  const b = baseline
    .filter((x) => x.site === a.site && x.hazard === a.hazard && x.audience === a.audience && x.t >= a.t - 30 && x.t <= until && x.t <= t)
    .sort((x, y) => x.t - y.t)[0];
  if (b) {
    const d = b.t - a.t;
    return { good: d > 0, text: d > 0 ? `warned ${clockLabel(b.t)} · ${d} min after us` : d < 0 ? `warned ${clockLabel(b.t)} · ${-d} min before us` : `warned at the same time` };
  }
  if (a.onset !== null && t >= a.onset) return { good: true, text: "no warning before onset" };
  return { good: true, text: "no warning yet" };
}

function AlertCard({ a, t, mode, baseline, onOpen, onSelect }: { a: Alert; t: number; mode: Mode; baseline: Alert[]; onOpen: Props["onOpenAlert"]; onSelect: Props["onSelect"] }) {
  const bn = baselineNote(a, t, baseline);
  const o = outcome(a, t);
  const reasons = useMemo(() => reasonsFor(a.site, a.hazard, a.t, a.peakLead, mode), [a, mode]);
  const age = t - a.t;
  // Countdown from the issue time: window shifts as the replay clock advances.
  const s = Math.max(0, a.start - age), e = a.end - age;
  const live = o === "pending";
  return (
    <article className={`alert ${o}`} style={{ "--hz": HAZARD_COLOR[a.hazard] } as React.CSSProperties}>
      <div className="alert-top">
        <HazardIcon h={a.hazard} />
        <button className="alert-title link" onClick={() => onSelect({ kind: "site", id: a.site.id })}>
          {HAZARD_LABEL[a.hazard]} — {a.site.short}
        </button>
        {a.hazard === "downburst" && <Badge tone="proxy">PROXY</Badge>}
        {o === "hit" && <Badge tone="ok"><Check size={11} /> HIT · {Math.max(0, (a.onset ?? a.t) - a.t)} min lead</Badge>}
        {o === "false-alarm" && <Badge tone="bad"><CircleAlert size={11} /> FALSE ALARM</Badge>}
      </div>

      <div className="alert-main">
        <div className="alert-window">
          <div className="k">{live ? (e <= 0 ? "expected now" : "arrival") : "forecast window"}</div>
          <div className="v">{live ? (e <= 0 ? "now" : windowText(s, e)) : windowText(a.start, a.end)}</div>
        </div>
        <div className="alert-prob">
          <div className="k">probability</div>
          <div className="v">{pct(a.p)}</div>
        </div>
      </div>

      <div className="alert-meta">Issued {clockLabel(a.t)}{age > 0 ? ` · ${age} min ago` : " · now"} · valid to {clockLabel(a.expires)}</div>
      <div className={`alert-base ${bn.good ? "good" : ""}`}>Extrapolation baseline: {bn.text}</div>

      {reasons.length > 0 && (
        <ul className="why" aria-label="Why this alert">
          {reasons.map((r) => (
            <li key={r.label}>
              <span className="why-bar"><span style={{ width: `${Math.max(8, r.weight * 100)}%` }} /></span>
              <span className="why-l">{r.label}</span>
              <span className="why-v">{r.value}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="alert-actions">
        <button onClick={() => onOpen(a, "cap")}><FileCode2 size={14} /> CAP XML</button>
        <button onClick={() => onOpen(a, "sms")}><MessageSquareText size={14} /> SMS</button>
      </div>
    </article>
  );
}

// ---- arrivals ---------------------------------------------------------------

function ArrivalsTab(p: Props) {
  const selId = p.selected?.kind === "site" ? p.selected.id : null;
  return (
    <>
      <p className="tab-intro">
        Arrival windows per location from the forecast, 0–3 h. The window is where the hazard probability stays near its peak;
        it narrows as the storm approaches.
      </p>
      {p.countdowns.map((c) => (
        <ArrivalCard key={c.site.id} c={c} sel={selId === c.site.id} onSelect={() => p.onSelect({ kind: "site", id: c.site.id })} />
      ))}
    </>
  );
}

const SPAN = 180;

function ArrivalCard({ c, sel, onSelect }: { c: Countdown; sel: boolean; onSelect: () => void }) {
  const top: Window | undefined = c.windows[0];
  return (
    <article className={`arrival ${sel ? "sel" : ""} ${top ? "" : "quiet"}`} onClick={onSelect}>
      <div className="arr-head">
        <span className="arr-icon"><SiteIcon k={c.site.kind} /></span>
        <div className="arr-name">
          <div>{c.site.name}</div>
          <div className="muted">{c.site.audiences.map((a) => AUDIENCE_LABEL[a]).join(" · ")}{c.site.population ? ` · ${c.site.population}` : ""}</div>
        </div>
        {top ? (
          <div className="arr-big" style={{ color: HAZARD_COLOR[top.hazard] }}>
            <div className="v">{top.start <= 0 ? "now" : `${top.start}–${top.end}`}<small>{top.start <= 0 ? "" : " min"}</small></div>
            <div className="k">{HAZARD_LABEL[top.hazard]} · {pct(top.p)}</div>
          </div>
        ) : (
          <div className="arr-big quiet"><div className="k">no hazard ≥ 30%</div></div>
        )}
      </div>
      <div className="ribbons" aria-label="Hazard probability by lead time">
        {HAZARDS.map((h) => <Ribbon key={h} h={h} values={c.curve[h]} win={c.windows.find((w) => w.hazard === h)} />)}
        <div className="ribbon-axis"><span>now</span><span>+1 h</span><span>+2 h</span><span>+3 h</span></div>
      </div>
    </article>
  );
}

function Ribbon({ h, values, win }: { h: Hazard; values: number[]; win?: Window }) {
  const n = values.length;
  return (
    <div className="ribbon" title={`${HAZARD_LABEL[h]}: peak ${pct(Math.max(...values))}`}>
      <HazardIcon h={h} size={12} />
      <div className="ribbon-cells">
        {values.slice(0, n - 1).map((v, i) => (
          <span key={i} style={{ background: HAZARD_COLOR[h], opacity: v < 0.05 ? 0.06 : 0.15 + 0.85 * v }} title={`+${i * 10} min: ${pct(v)}`} />
        ))}
        {win && (
          <span className="ribbon-win" style={{ left: `${(win.start / SPAN) * 100}%`, width: `${(Math.min(SPAN, win.end) - win.start) / SPAN * 100}%` }} />
        )}
      </div>
    </div>
  );
}
