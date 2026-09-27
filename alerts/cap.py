"""CAP 1.2 XML per alert, with coverage and confidence text (brief M10)."""
from __future__ import annotations

from datetime import datetime, timedelta
from xml.sax.saxutils import escape

HAZARD_EVENT = {"lightning": "Lightning", "hail": "Hail", "downburst": "Downburst (proxy)", "cloudburst": "Cloudburst"}
INSTRUCTION = {
    "lightning": "Stay indoors, keep away from open fields and tall trees.",
    "hail": "Move people and cattle indoors; cover nursery beds.",
    "downburst": "Secure loose objects; stay away from hoardings and weak structures.",
    "cloudburst": "Avoid river banks and slopes; halt travel on the route.",
}
COVERAGE_TEXT = {
    "full": "Radar coverage full.",
    "partial": "Radar coverage partial: storm cores may be underestimated.",
    "none": "No radar coverage: forecast from satellite and lightning only.",
}


def cap_xml(alert: dict, status: str = "Exercise") -> str:
    """alert: id, sent (datetime UTC), hazard, audience, p, start_min, end_min, site {name, lat, lon, radius_km},
    tier, calibrated (bool). Status stays 'Exercise' for replays."""
    sent: datetime = alert["sent"]
    onset, expires = sent + timedelta(minutes=alert["start_min"]), sent + timedelta(minutes=alert["end_min"] + 30)
    p = alert["p"]
    certainty = "Likely" if p >= 0.5 else "Possible"
    urgency = "Immediate" if alert["start_min"] <= 30 else "Expected"
    severity = "Severe" if alert["hazard"] in ("cloudburst", "downburst") or p >= 0.7 else "Moderate"
    conf = f"Probability {round(p * 100)}%{' (calibrated)' if alert.get('calibrated') else ''}. {COVERAGE_TEXT[alert['tier']]}"
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    s = alert["site"]
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>{escape(alert['id'])}</identifier>
  <sender>nowcast@deadlock.example</sender>
  <sent>{iso(sent)}</sent>
  <status>{status}</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>Replay of a recorded event (US-SEVIR); not an operational warning.</note>
  <info>
    <language>en</language>
    <category>Met</category>
    <event>{HAZARD_EVENT[alert['hazard']]}</event>
    <responseType>Shelter</responseType>
    <urgency>{urgency}</urgency>
    <severity>{severity}</severity>
    <certainty>{certainty}</certainty>
    <audience>{alert['audience']}</audience>
    <onset>{iso(onset)}</onset>
    <expires>{iso(expires)}</expires>
    <senderName>Deadlock Nowcast (SIH 26084 prototype)</senderName>
    <headline>{escape(f"{HAZARD_EVENT[alert['hazard']]} {alert['start_min']}-{alert['end_min']} min — {s['name']}")}</headline>
    <description>{escape(conf)}</description>
    <instruction>{escape(INSTRUCTION[alert['hazard']])}</instruction>
    <parameter><valueName>probability</valueName><value>{p:.2f}</value></parameter>
    <parameter><valueName>radarCoverage</valueName><value>{alert['tier']}</value></parameter>
    <area>
      <areaDesc>{escape(s['name'])}</areaDesc>
      <circle>{s['lat']:.4f},{s['lon']:.4f} {s.get('radius_km', 5):.1f}</circle>
    </area>
  </info>
</alert>"""
