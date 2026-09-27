"""Copy eval/results/*.json into the frontend so the Model skill panel can read them.

    python -m eval.publish      # → frontend/public/results/{index.json, *.json}

The dashboard renders only what is published here — no numbers are typed into the UI.
"""
from __future__ import annotations

import json
import shutil

from pipeline.settings import ROOT, path


def main():
    src = path("results")
    dst = ROOT / "frontend" / "public" / "results"
    dst.mkdir(parents=True, exist_ok=True)
    files = sorted(p.name for p in src.glob("*.json"))
    for name in files:
        shutil.copy2(src / name, dst / name)
    (dst / "index.json").write_text(json.dumps({"files": files}, indent=1))
    print(f"published {len(files)} result file(s) → {dst.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
