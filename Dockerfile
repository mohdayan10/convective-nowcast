# The demo image serves precomputed replay packages and the built console.
# It deliberately has no torch: inference, tracking and hazard scoring all run
# offline (python -m export.build_replay) and their output is what ships here.

FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
# Playwright is a dev-only verification tool; never fetch browsers for this build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir "fastapi>=0.110" "uvicorn[standard]>=0.29" "pyyaml>=6.0"

COPY config.yaml ./
COPY pipeline/__init__.py pipeline/settings.py pipeline/
COPY services/ services/
COPY eval/results/ eval/results/
COPY replay_packages/ replay_packages/
COPY --from=web /web/dist frontend/dist

EXPOSE 8000
CMD ["uvicorn", "services.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
