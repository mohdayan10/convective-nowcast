"""Thin replay server (app build spec §6): serves precomputed packages, computes nothing.

    uvicorn services.api.main:app --port 8000

Routes
    GET  /api/events                     the replay index
    GET  /api/events/{id}/meta           meta.json
    GET  /api/events/{id}/frames/{a}     one analysis frame
    GET  /api/events/{id}/alerts         alerts.json
    GET  /api/events/{id}/verification   verification.json (the end-of-replay reveal)
    GET  /api/events/{id}/observed       observed.json (observed intensity + arrival error)
    GET  /api/events/{id}/xai            xai.json (SHAP attributions for the cell models)
    GET  /api/events/{id}/cells/{f}      tracked cells at one 5 min frame
    GET  /api/events/{id}/relief/{f}     VIL contours for the 3-D relief
    GET  /api/events/{id}/tracks         per-lead object track error for that event
    GET  /api/results                    eval/results/*.json, merged, for the results page
    WS   /ws/replay/{id}?speed=20        streams the replay clock while playing
    GET  /files/{id}/...                 package rasters (PNG)
    GET  /                               the built dashboard
"""
from __future__ import annotations

import asyncio
import math
import json

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pipeline.settings import ROOT, path

REPLAY = path("replay")
RESULTS = path("results")
DIST = ROOT / "frontend" / "dist"
TICK_S = 1.0 / 8          # clock updates per second; the client interpolates between them

app = FastAPI(title="Deadlock Nowcast replay API")


def _finite(o):
    """NaN/Infinity are valid in Python's JSON but not in the spec, and a strict
    encoder refuses them. A metric that is genuinely undefined — FAR with no
    forecast positives, AUC on a single-class slice — becomes null, which the
    console renders as an em dash rather than a number it cannot justify.
    """
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _finite(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_finite(v) for v in o]
    return o


def _read(p):
    if not p.exists():
        raise HTTPException(404, f"{p.name} not found")
    return _finite(json.loads(p.read_text()))


@app.get("/api/events")
def events():
    idx = REPLAY / "index.json"
    if not idx.exists():
        return {"events": []}
    return _read(idx)


@app.get("/api/events/{eid}/meta")
def meta(eid: str):
    return _read(REPLAY / eid / "meta.json")


@app.get("/api/events/{eid}/frames/{a}")
def frame(eid: str, a: int):
    return _read(REPLAY / eid / "frames" / f"{a}.json")


@app.get("/api/events/{eid}/cells/{f}")
def cells(eid: str, f: int):
    """Tracked cells at one 5 min frame, between the 20 min analysis times."""
    return _read(REPLAY / eid / "cells" / f"{f}.json")


@app.get("/api/events/{eid}/relief/{f}")
def relief(eid: str, f: int):
    """Contours of the observed VIL field at one frame, for the 3-D relief."""
    return _read(REPLAY / eid / "relief" / f"{f}.json")


@app.get("/api/events/{eid}/alerts")
def alerts(eid: str):
    return _read(REPLAY / eid / "alerts.json")


@app.get("/api/events/{eid}/verification")
def verification(eid: str):
    return _read(REPLAY / eid / "verification.json")


@app.get("/api/events/{eid}/observed")
def observed(eid: str):
    """What actually happened: per-frame observed intensity and per-site arrival error."""
    return _read(REPLAY / eid / "observed.json")


@app.get("/api/events/{eid}/tracks")
def tracks(eid: str):
    """Where the forecast put the storm: per-lead centroid error against the observation."""
    return _read(REPLAY / eid / "tracks.json")


@app.get("/api/events/{eid}/xai")
def xai(eid: str):
    """Exact SHAP attributions from the gradient-boosted cell models."""
    return _read(REPLAY / eid / "xai.json")


@app.get("/api/results")
def results():
    """Every evaluation file, so the results page can show what exists and name what doesn't."""
    out = {}
    for p in sorted(RESULTS.glob("*.json")):
        try:
            out[p.stem] = _finite(json.loads(p.read_text()))
        except json.JSONDecodeError:
            continue
    return JSONResponse(out)


@app.websocket("/ws/replay/{eid}")
async def replay(ws: WebSocket, eid: str, speed: float = 20.0):
    """Advance the replay clock in real time ÷ speed; the client renders from the package.

    Only the clock is streamed. Frames are fetched over HTTP and cached by the
    browser, which keeps the socket cheap and the replay resumable.
    """
    await ws.accept()
    try:
        m = json.loads((REPLAY / eid / "meta.json").read_text())
    except FileNotFoundError:
        await ws.close(code=1008)
        return
    step_min, n = m["step_min"], m["n_frames"]
    # Start paused at the first analysis time: a presenter opens the console and
    # talks before anything moves, and there is no forecast before then anyway.
    t = float(m["analysis_frames"][0] * step_min) if m.get("analysis_frames") else 0.0
    playing = False
    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=TICK_S)
                if "speed" in msg:
                    speed = max(1.0, float(msg["speed"]))
                if "playing" in msg:
                    playing = bool(msg["playing"])
                if "seek_min" in msg:
                    t = max(0.0, min(float(msg["seek_min"]), (n - 1) * step_min))
            except asyncio.TimeoutError:
                pass
            except (json.JSONDecodeError, ValueError):
                pass
            if playing:
                t = min(t + TICK_S * speed / 60.0, (n - 1) * step_min)   # replay minutes
            await ws.send_json({"t_min": round(t, 3), "playing": playing, "speed": speed,
                                "end": t >= (n - 1) * step_min})
            if t >= (n - 1) * step_min:
                playing = False
    except WebSocketDisconnect:
        return


app.mount("/files", StaticFiles(directory=REPLAY), name="files")

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        p = DIST / full_path
        if full_path and p.is_file():
            return FileResponse(p)
        return FileResponse(DIST / "index.html")
