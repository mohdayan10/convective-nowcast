# SIH 26084 — Team Deadlock. Brief §4: make data / baselines / train / infer / demo
PY := .venv/bin/python

.PHONY: setup data data-dev check baselines baselines-quick test frontend demo status \
        model modes track-skill calibrate hazards tracks cells relief replay-india ci alerts replay observed xai api console

setup:                 ## Python env (CUDA 12.6 torch) + frontend deps
	uv venv --python 3.11 .venv
	uv pip install --python $(PY) -r pyproject.toml --extra dev
	uv pip install --python $(PY) torch --index-url https://download.pytorch.org/whl/cu126
	cd frontend && npm install

data-dev:              ## 80-event SEVIR subset for development (~1.2 GB)
	$(PY) -m data.download_sevir --dev

data:                  ## full SEVIR subset (config: n_train / n_test); resumable
	$(PY) -m data.download_sevir

check:                 ## M2 acceptance: shapes + aligned channel plot → docs/m2_alignment.png
	$(PY) -m data.sevir_dataset --check

baselines:             ## M3: persistence / optical flow / S-PROG → eval/results/baselines.json
	$(PY) -m eval.evaluate baselines

baselines-quick:
	$(PY) -m eval.evaluate baselines --limit 5

test:
	$(PY) -m pytest -q

model:                 ## M5: score the trained U-Net against the baselines → eval/results/model.json
	$(PY) -m eval.evaluate model

modes:                 ## radar-denied skill: re-score the model per coverage mode → modes.json
	$(PY) -m eval.evaluate modes

track-skill:           ## object track error vs lead over the test split → track.json
	$(PY) -m eval.evaluate track

calibrate:             ## M8: reliability + isotonic recalibration → eval/results/calibration.json
	$(PY) -m pipeline.calibrate

hazards:               ## M6: train hail/downburst cell models → eval/results/hazards.json
	$(PY) -m pipeline.hazards

ci:                    ## M7: convective-initiation models → eval/results/ci.json
	$(PY) -m pipeline.initiation

alerts:                ## M10: tune audience thresholds → eval/results/alerts.json (needs hazards)
	$(PY) -m alerts.severity

replay:                ## M9: precompute a replay package for the best demo event
	$(PY) -m export.build_replay --auto 1
	$(MAKE) observed tracks xai

observed:              ## observed rasters + arrival error for every built package
	$(PY) -m export.build_observed --all

replay-india:          ## the same event with its grid georeferenced onto Karnataka
	$(PY) -m export.build_replay --event S852920 --relocate karnataka
	$(MAKE) observed tracks xai

cells:                 ## tracked cells at every 5 min frame for every built package (no GPU)
	$(PY) -m export.build_cells --all

relief:                ## 3-D relief of the VIL field for every built package (no GPU)
	$(PY) -m export.build_relief --all

tracks:                ## per-event object track error for every built package (needs the GPU)
	$(PY) -m export.build_tracks --all

xai:                   ## SHAP attributions from the cell models for every built package
	$(PY) -m export.build_xai --all

frontend:              ## build the dashboard
	cd frontend && npm run build

api:                   ## serve the replay API + console on :8000 (needs a replay package)
	$(PY) -m uvicorn services.api.main:app --port 8000

console: frontend api  ## build the dashboard, then serve it

demo:                  ## one command for the judges: docker compose up → localhost:8000
	docker compose up --build
