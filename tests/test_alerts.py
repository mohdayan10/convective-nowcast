import xml.etree.ElementTree as ET
from datetime import datetime

from alerts.cap import cap_xml
from alerts.sms_templates import sms


def test_cap_is_well_formed_and_carries_coverage():
    x = cap_xml({"id": "t-1", "sent": datetime(2019, 6, 19, 22, 0), "hazard": "hail", "audience": "aviation",
                 "p": 0.72, "start_min": 20, "end_min": 45, "tier": "partial", "calibrated": True,
                 "site": {"name": "Test & Field", "lat": 36.1, "lon": -97.2, "radius_km": 5}})
    root = ET.fromstring(x)
    ns = {"c": "urn:oasis:names:tc:emergency:cap:1.2"}
    assert root.find("c:status", ns).text == "Exercise"
    assert "partial" in root.find("c:info/c:description", ns).text
    assert root.find("c:info/c:certainty", ns).text == "Likely"


def test_sms_all_languages():
    s = sms("cloudburst", "Town", 10, 30, 0.61)
    assert set(s) == {"en", "hi", "te", "review"} and "61%" in s["hi"]
