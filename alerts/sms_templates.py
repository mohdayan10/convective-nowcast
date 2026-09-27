"""SMS text in English, Hindi and Telugu (brief M10).

Hindi and Telugu are machine-drafted and MUST be reviewed by native speakers
before any real use (flagged in every output).
"""
from __future__ import annotations

HAZ = {
    "en": {"lightning": "Lightning", "hail": "Hail", "downburst": "Strong wind (downburst)", "cloudburst": "Cloudburst"},
    "hi": {"lightning": "आकाशीय बिजली", "hail": "ओलावृष्टि", "downburst": "अचानक तेज़ आँधी", "cloudburst": "बादल फटने"},
    "te": {"lightning": "పిడుగులు", "hail": "వడగళ్ల వాన", "downburst": "ఆకస్మిక బలమైన గాలులు", "cloudburst": "మేఘ విస్ఫోటనం"},
}
ACTION = {
    "en": {"lightning": "Stay indoors, keep away from open fields and tall trees.",
           "hail": "Move people and cattle indoors; cover nursery beds.",
           "downburst": "Secure loose objects; stay away from hoardings and weak structures.",
           "cloudburst": "Avoid river banks and slopes; halt travel."},
    "hi": {"lightning": "घर के अंदर रहें, खुले खेतों और ऊँचे पेड़ों से दूर रहें।",
           "hail": "लोगों और पशुओं को अंदर ले जाएँ; नर्सरी को ढकें।",
           "downburst": "ढीली चीज़ें बाँध दें; होर्डिंग और कमज़ोर ढाँचों से दूर रहें।",
           "cloudburst": "नदी किनारों और ढलानों से दूर रहें; यात्रा रोकें।"},
    "te": {"lightning": "ఇంట్లోనే ఉండండి, బహిరంగ పొలాలు మరియు ఎత్తైన చెట్లకు దూరంగా ఉండండి.",
           "hail": "ప్రజలను, పశువులను లోపలికి తరలించండి; నారుమళ్లను కప్పండి.",
           "downburst": "వదులుగా ఉన్న వస్తువులను కట్టివేయండి; హోర్డింగ్‌లు, బలహీన నిర్మాణాలకు దూరంగా ఉండండి.",
           "cloudburst": "నది ఒడ్డులు, వాలులకు దూరంగా ఉండండి; ప్రయాణం ఆపండి."},
}
REVIEW_NOTE = "Hindi/Telugu machine-drafted — native-speaker review required."


def sms(hazard: str, place: str, start: int, end: int, p: float) -> dict[str, str]:
    pct = f"{round(p * 100)}%"
    when = {
        "en": "now" if start <= 0 else f"in {start}-{end} min",
        "hi": "अभी" if start <= 0 else f"{start}–{end} मिनट में",
        "te": "ఇప్పుడు" if start <= 0 else f"{start}–{end} నిమిషాల్లో",
    }
    return {
        "en": f"{HAZ['en'][hazard]} warning: {place} {when['en']} ({pct}). {ACTION['en'][hazard]}",
        "hi": f"{HAZ['hi'][hazard]} की चेतावनी: {place} में {when['hi']} ({pct})। {ACTION['hi'][hazard]}",
        "te": f"{HAZ['te'][hazard]} హెచ్చరిక: {place} వద్ద {when['te']} ({pct}). {ACTION['te'][hazard]}",
        "review": REVIEW_NOTE,
    }
