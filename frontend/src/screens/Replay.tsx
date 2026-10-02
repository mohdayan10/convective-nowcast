// Storm replay: the forecast against what was observed, at the same valid time,
// on the same grid and the same colour ramp. The left half is the forecast the
// package shipped for the current analysis time and lead; the right half is the
// observed VIL at the frame that lead lands on. Drag the divider to compare.

import { useEffect, useRef, useState } from "react";
import maplibregl, { ImageSource, LngLatBoundsLike, Map as MlMap } from "maplibre-gl";

import { MODE_LABEL, obsUrl, rasterUrl } from "../api";
import { lead as leadLabel } from "../fmt";
import { offlineStyle, regionFor } from "../map/basemap";
import { analysisAt, useStore } from "../store";
import { fx } from "../console/Chart";

export default function Replay() {
  const meta = useStore((s) => s.meta);
  const observed = useStore((s) => s.observed);
  const tracks = useStore((s) => s.tracks);
  const verification = useStore((s) => s.verification);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const leadMin = useStore((s) => s.leadMin);
  const mode = useStore((s) => s.mode);
  const events = useStore((s) => s.events);
  const eventId = useStore((s) => s.eventId);
  const openEvent = useStore((s) => s.openEvent);
  const setClock = useStore((s) => s.setClock);
  const [split, setSplit] = useState(50);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const leads = frame?.leads_min ?? [];
  const lead = leads.length
    ? leads.reduce((b, l) => (Math.abs(l - leadMin) < Math.abs(b - leadMin) ? l : b), leads[0])
    : null;
  const validFrame = a !== null && lead !== null && meta ? a + lead / meta.step_min : null;
  // The track error for exactly the analysis frame and lead the split map is showing.
  const trackFrame = tracks?.frames.find((f) => f.analysis_frame === a) ?? null;
  const trackHere = trackFrame?.leads.find((l) => l.lead_min === lead) ?? null;
  const issued = a !== null && meta
    ? new Date(new Date(meta.start_utc).getTime() + a * meta.step_min * 60000)
    : null;
  const valid = validFrame !== null && meta
    ? new Date(new Date(meta.start_utc).getTime() + validFrame * meta.step_min * 60000)
    : null;
  const obsAtValid = observed?.frames.find((f) => f.frame === validFrame) ?? null;

  if (!meta) return <div className="page"><p className="hint">Loading…</p></div>;

  return (
    <div className="screen-split">
      <div className="split-head">
        <div className="tabs" role="tablist" aria-label="Events">
          {events.map((e) => (
            <button key={e.id} role="tab" aria-selected={e.id === eventId}
              onClick={() => openEvent(e.id)}>
              <span className="num">{e.id}</span> · {e.event_type}
            </button>
          ))}
        </div>
        <span className="chip warn">
          {meta.badges.includes("US-SEVIR") ? "US archival event" : "archival"}
        </span>
      </div>

      <main className="split-main">
        {observed ? (
          <SplitMap split={split} analysis={a} lead={lead} validFrame={validFrame} mode={mode}
            onSplit={setSplit} />
        ) : (
          <p className="empty" style={{ margin: 16 }}>
            No observed rasters in this package. Run{" "}
            <code>python -m export.build_observed --event {meta.event}</code> and reload; until
            then there is nothing to compare the forecast against and no comparison is drawn.
          </p>
        )}
        <div className="split-labels">
          <span>
            Model forecast · issued {issued ? issued.toISOString().slice(11, 16) : "—"} UTC ·{" "}
            +{lead === null ? "—" : leadLabel(lead)} · {MODE_LABEL[mode]}
          </span>
          <span>
            Observed · {valid ? valid.toISOString().slice(11, 16) : "—"} UTC · frame{" "}
            <span className="num">{validFrame ?? "—"}</span>
          </span>
        </div>
      </main>

      <aside className="rail-r" aria-label="Event intelligence">
        <section className="panel">
          <div className="panel-head">
            <span>Event {meta.event}</span>
            <span className="hint">{meta.event_type}</span>
          </div>
          <div className="panel-body">
            <p className="hint">
              {meta.dataset} event beginning{" "}
              {new Date(meta.start_utc).toISOString().slice(0, 16).replace("T", " ")} UTC,
              {" "}{((meta.n_frames - 1) * meta.step_min) / 60} h of 5-minute frames on a{" "}
              {meta.grid.size} km tile at {meta.grid.km_per_px} km. The forecast on the left was
              produced by the model from the 13 frames before the analysis time; it had no access
              to anything on the right.
            </p>
            <div className="kv">
              <span className="k">Analysis time</span>
              <span className="num">{a === null ? "—" : `T+${a * meta.step_min} min`}</span>
            </div>
            <div className="kv">
              <span className="k">Valid time</span>
              <span className="num">{valid ? valid.toISOString().slice(11, 16) : "—"} UTC</span>
            </div>
            <div className="kv">
              <span className="k">Observed peak then</span>
              <span className="num">{obsAtValid ? `${obsAtValid.peak_kgm2} kg/m²` : "—"}</span>
            </div>
            <div className="kv">
              <span className="k">Observed core then</span>
              <span className="num">{obsAtValid ? `${obsAtValid.core_area_km2} km²` : "—"}</span>
            </div>
            <div className="kv">
              <span className="k">Forecast peak</span>
              <span className="num">
                {frame?.modes[mode] ? `${frame.modes[mode].vil_max_kgm2} kg/m²` : "—"}
              </span>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              Forecast peak is over all twelve lead frames of this run, not this one lead, so it
              is not a like-for-like comparison with the observed peak beside it.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span>Model against observed</span>
            {!observed && <span className="chip warn">no file</span>}
          </div>
          <div className="panel-body">
            {observed ? (
              <>
                <div className="kv">
                  <span className="k">Arrival error, median</span>
                  <span className="num">
                    {observed.summary.median_error_min === null ? "—"
                      : `${observed.summary.median_error_min > 0 ? "+" : ""}${observed.summary.median_error_min} min`}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Arrival error, median absolute</span>
                  <span className="num">
                    {observed.summary.median_abs_error_min === null ? "—"
                      : `${observed.summary.median_abs_error_min} min`}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Arrivals inside the window</span>
                  <span className="num">
                    {observed.summary.in_window_share === null ? "—"
                      : `${Math.round(observed.summary.in_window_share * 100)}%`}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Forecasts scored</span>
                  <span className="num">{observed.summary.n_forecasts}</span>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>{observed.note}</p>
              </>
            ) : (
              <p className="hint">
                No arrival error until the observed rasters exist: run{" "}
                <code>python -m export.build_observed</code>.
              </p>
            )}
            {trackHere ? (
              <>
                <div className="kv">
                  <span className="k">Track error at {leadLabel(trackHere.lead_min)}, median</span>
                  <span className="num">
                    {trackHere.median_error_km === null ? "—"
                      : `${trackHere.median_error_km} km`}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Cells matched at that lead</span>
                  <span className="num">
                    {trackHere.n_matched}/{trackHere.n_observed_alive}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Forecast cell area over observed</span>
                  <span className="num">
                    {trackHere.median_area_ratio === null ? "—"
                      : `${trackHere.median_area_ratio}×`}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Track error over the event, median</span>
                  <span className="num">
                    {tracks!.summary.median_error_km_all_leads === null ? "—"
                      : `${tracks!.summary.median_error_km_all_leads} km`}
                  </span>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>{tracks!.method}</p>
              </>
            ) : (
              <p className="hint">
                Track error is not computed for this event. Run{" "}
                <code>python -m export.build_tracks</code> to track the forecast fields as
                objects and match them to the observed cells.
              </p>
            )}
          </div>
        </section>

        {observed && (
          <section className="panel">
            <div className="panel-head"><span>Per location</span></div>
            <table className="skill compact">
              <thead>
                <tr><th>Location</th><th>Observed</th><th>Median error</th></tr>
              </thead>
              <tbody>
                {observed.sites.map((s) => (
                  <tr key={s.site}>
                    <td>{s.name}</td>
                    <td className="n">
                      {s.observed_first_min === null ? "never" : `T+${s.observed_first_min}`}
                    </td>
                    <td className="n">
                      {s.median_error_min === null ? "—"
                        : `${s.median_error_min > 0 ? "+" : ""}${s.median_error_min} min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint" style={{ padding: "6px 12px 12px" }}>
              Positive means the forecast was late. A location the storm never reached has no
              error to report.
            </p>
          </section>
        )}

        {verification && (
          <section className="panel">
            <div className="panel-head">
              <span>Alert outcomes</span>
              <span className="hint">{verification.summary.n} issued</span>
            </div>
            <div className="panel-body">
              <div className="kv"><span className="k">Hits</span>
                <span className="num">{verification.summary.hits}</span></div>
              <div className="kv"><span className="k">False alarms</span>
                <span className="num">{verification.summary.false_alarms}</span></div>
              <div className="kv"><span className="k">Median lead achieved</span>
                <span className="num">
                  {verification.summary.median_lead_min === null ? "—"
                    : `${verification.summary.median_lead_min} min`}
                </span></div>
            </div>
          </section>
        )}
      </aside>

      <div className="event-timeline">
        {observed ? (
          <>
            <div className="scrub-labels">
              <span>Observed core area ≥ {observed.core_threshold_kgm2} kg/m², per frame</span>
              <span className="hint">
                click a frame to move the replay · analysis times marked
              </span>
            </div>
            <Ticks />
          </>
        ) : (
          <div className="hint" style={{ padding: "8px 14px" }}>
            No observed intensity series in this package.
          </div>
        )}
      </div>
    </div>
  );

  function Ticks() {
    const obs = observed!;
    const hi = Math.max(...obs.frames.map((f) => f.core_area_km2), 1);
    return (
      <div className="ticks-row">
        {obs.frames.map((f) => {
          const isAnalysis = meta!.analysis_frames.includes(f.frame);
          const isValid = f.frame === validFrame;
          return (
            <button key={f.frame}
              className={`tickbar${isAnalysis ? " analysis" : ""}${isValid ? " valid" : ""}`}
              style={{ ["--h" as string]: `${(f.core_area_km2 / hi) * 100}%` }}
              onClick={() => setClock(f.frame * meta!.step_min)}
              title={`${f.time_utc.slice(11, 16)} UTC · core ${f.core_area_km2} km² · peak ${f.peak_kgm2} kg/m²`}
              aria-label={`frame ${f.frame}, core area ${f.core_area_km2} square km`}>
              <i />
            </button>
          );
        })}
      </div>
    );
  }
}

function SplitMap({ split, analysis, lead, validFrame, mode, onSplit }: {
  split: number;
  analysis: number | null;
  lead: number | null;
  validFrame: number | null;
  mode: ReturnType<typeof useStore.getState>["mode"];
  onSplit: (v: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const leftBox = useRef<HTMLDivElement>(null);
  const rightBox = useRef<HTMLDivElement>(null);
  const left = useRef<MlMap | null>(null);
  const right = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const meta = useStore((s) => s.meta);

  useEffect(() => {
    if (!leftBox.current || !rightBox.current || !meta) return;
    const [w, s, e, n] = meta.bbox;
    const region = regionFor((w + e) / 2, (s + n) / 2);
    // Each map gets its own style object: MapLibre takes ownership of the one it
    // is given, and sharing it between two maps leaves the second one blank.
    const common = {
      bounds: [[w, s], [e, n]] as LngLatBoundsLike,
      fitBoundsOptions: { padding: 16 },
      dragRotate: false,
      maxZoom: 12,
    };
    const l = new maplibregl.Map({
      ...common, container: leftBox.current, style: offlineStyle(region),
      attributionControl: { compact: true },
    });
    const r = new maplibregl.Map({
      ...common, container: rightBox.current, style: offlineStyle(region),
      attributionControl: false,
    });
    left.current = l;
    right.current = r;
    ready.current = false;

    // One camera, two canvases: whichever map the pointer is on leads.
    let syncing = false;
    const sync = (from: MlMap, to: MlMap) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
      syncing = false;
    };
    l.on("move", sync(l, r));
    r.on("move", sync(r, l));
    l.on("mousemove", (ev) =>
      useStore.getState().setCursor([ev.lngLat.lng, ev.lngLat.lat],
        (156543.03392 * Math.cos((ev.lngLat.lat * Math.PI) / 180)) / Math.pow(2, l.getZoom())));

    let loaded = 0;
    const onLoad = (m: MlMap, kind: "forecast" | "observed") => () => {
      m.addSource(kind, { type: "image", url: transparent(), coordinates: meta.corners });
      m.addLayer({ id: kind, type: "raster", source: kind, paint: { "raster-opacity": 0.85 } });
      if (kind === "observed") {
        m.addSource("obs-sites", { type: "geojson", data: siteFc(meta.sites) });
        m.addLayer({
          id: "obs-sites", type: "circle", source: "obs-sites",
          paint: { "circle-radius": 4, "circle-color": "#0e1419", "circle-stroke-color": "#e4ecf2", "circle-stroke-width": 1.2 },
        });
      }
      m.resize();
      if (++loaded === 2) { ready.current = true; refresh(); }
    };
    l.on("load", onLoad(l, "forecast"));
    r.on("load", onLoad(r, "observed"));

    return () => {
      l.remove(); r.remove();
      left.current = right.current = null;
      ready.current = false;
    };
  }, [meta?.event]);

  const refresh = () => {
    if (!meta || !ready.current) return;
    if (analysis !== null && lead !== null) {
      swap(left.current, "forecast", rasterUrl(meta.event, analysis, mode, "vil", lead), meta.corners);
    }
    if (validFrame !== null) {
      swap(right.current, "observed", obsUrl(meta.event, validFrame), meta.corners);
    }
  };
  useEffect(refresh, [meta?.event, analysis, lead, validFrame, mode]);

  const drag = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e);
  };
  const move = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    onSplit(Math.max(4, Math.min(96, ((e.clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className="split-wrap" ref={box}>
      <div ref={leftBox} className="split-pane" />
      <div ref={rightBox} className="split-pane"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
      <div className="split-divider" style={{ left: `${split}%` }}
        role="slider" tabIndex={0} aria-label="Forecast / observed divider"
        aria-valuemin={4} aria-valuemax={96} aria-valuenow={Math.round(split)}
        onPointerDown={drag}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e)}
        onKeyDown={(e) => {
          const d = e.key === "ArrowRight" ? 2 : e.key === "ArrowLeft" ? -2 : 0;
          if (d) { e.preventDefault(); onSplit(Math.max(4, Math.min(96, split + d))); }
        }}>
        <span className="split-grip" aria-hidden="true" />
      </div>
    </div>
  );
}

function swap(m: MlMap | null, id: string, url: string, corners: any) {
  const src = m?.getSource(id) as ImageSource | undefined;
  if (!src) return;
  if ((src as unknown as { url?: string }).url === url) return;
  src.updateImage({ url, coordinates: corners });
  (src as unknown as { url?: string }).url = url;
}

const siteFc = (sites: { id: string; name: string; lon: number; lat: number }[]) => ({
  type: "FeatureCollection" as const,
  features: sites.map((s) => ({
    type: "Feature" as const,
    properties: { id: s.id, name: s.name },
    geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
  })),
});

/** A 1×1 transparent PNG, so a raster layer can exist before its image is chosen. */
const transparent = () =>
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

export { fx };
