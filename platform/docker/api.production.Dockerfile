# VEYE API — production image. Built and pushed, never run locally.
#
# Separate from api.Dockerfile on purpose. That one is the development image:
# it installs the dev extras, runs as root and carries the whole working tree,
# all of which are fine on a laptop and none of which belong in production.
#
# Nothing here is deployed by this file. It builds an artifact; where it runs
# and with what identity is a Cloud Run decision, documented in
# platform/docs/PRODUCTION_INFRASTRUCTURE.md.

# ---- build ---------------------------------------------------------------
FROM python:3.12-slim AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# Dependencies resolve from the project metadata first, so a source-only change
# does not re-resolve the world on every build.
COPY pyproject.toml README.md* ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

# A virtualenv rather than --user, so exactly one directory is copied forward
# and the runtime image carries no build tooling at all.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# The production extras only. `[ai]` (Groq, Langfuse) is development tooling
# and is deliberately absent: Gemini is the chosen provider and `[gemini]`
# brings it. `[gcs]` is member media.
RUN pip install ".[gemini,gcs]"

# ---- runtime -------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Cloud Run supplies PORT; the default matches it so the image behaves the
    # same if something else runs it.
    PORT=8080

# Not root. A container that never needs to write to its own filesystem should
# not be able to, and an image that runs as root makes every later mistake
# worse than it had to be.
RUN groupadd --system --gid 1001 veye \
 && useradd --system --uid 1001 --gid veye --home /app --shell /usr/sbin/nologin veye

WORKDIR /app

COPY --from=build /opt/venv /opt/venv
COPY --chown=veye:veye app ./app
COPY --chown=veye:veye alembic ./alembic
COPY --chown=veye:veye alembic.ini ./

USER veye

EXPOSE 8080

# The API's own readiness endpoint. Cloud Run probes the port itself, so this
# is for anything else that runs the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8080\")}/health', timeout=4).status==200 else 1)"

# Explicit, and deliberately not a shell form: the process must be PID 1 so a
# stop signal reaches uvicorn rather than a shell that ignores it.
#
# Migrations are NOT run here. A container that migrates on start races every
# other container in the revision; `alembic upgrade head` is a separate,
# single-run job. See PRODUCTION_INFRASTRUCTURE.md.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
