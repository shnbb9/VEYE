FROM python:3.12-slim

LABEL io.veye.local=true

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Dependencies first, from the hashed lock: the runtime set plus the [ai]
# extra (the optional Groq and Langfuse SDKs, so a development key in the
# ignored env file is enough to switch them on; neither is required). pip
# refuses any file whose hash is not in the lock, and this layer is rebuilt
# only when the lock changes, not on every source edit. To change a
# dependency: edit pyproject.toml, then run platform/scripts/lock-api-deps.ps1.
COPY requirements/dev.lock ./requirements/dev.lock
RUN pip install --no-cache-dir --require-hashes -r requirements/dev.lock

# The source. The app runs from /app (alembic's prepend_sys_path, python -m
# and uvicorn all import from here), so the project itself is not installed
# and nothing in this image resolves from the index.
COPY . .

EXPOSE 8000
