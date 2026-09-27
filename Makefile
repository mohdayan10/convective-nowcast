# SIH 26084 — Team Deadlock. Brief §4: make data / baselines / train / infer / demo
PY := .venv/bin/python

.PHONY: setup data data-dev check baselines baselines-quick test frontend demo status

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

frontend:              ## build the dashboard
	cd frontend && npm run build

demo: frontend         ## serve the built dashboard on :4173
	cd frontend && npx vite preview --port 4173

train infer:
	@echo "M5 not implemented yet — see docs/STATUS.md"; exit 1
