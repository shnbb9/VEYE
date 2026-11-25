"""The processes that are not the web application.

A scheduler runs `python -m app.jobs run all`. Nothing had ever run it: the
tests call the jobs inside a process that has already imported the whole
application, so a job that could not start on its own looked healthy here and
would have failed every night in production (found 25 Nov 2026 by running it).
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.db import registry  # noqa: F401
from app.db.base import Base

API = Path(__file__).resolve().parents[1]


@pytest.fixture
def own_database(tmp_path):
    url = f"sqlite:///{(tmp_path / 'entry.db').as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    return {**os.environ, "VEYE_DATABASE_URL": url, "VEYE_MEDIA_OBJECT_ROOT": str(tmp_path / "media"),
            "VEYE_KNOWLEDGE_OBJECT_ROOT": str(tmp_path / "knowledge")}


def _run(args: list[str], env: dict) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=API, env=env, capture_output=True, text=True, timeout=180)


@pytest.mark.parametrize("job", ["purge-prospects", "deliver-outbox", "process-erasures", "replay-erasures", "all"])
def test_every_scheduled_job_starts_on_its_own(job, own_database):
    result = _run(["-m", "app.jobs", "run", job, "--dry-run"], own_database)
    assert result.returncode == 0, result.stderr[-1500:]
    assert ": ok " in result.stdout and ": error " not in result.stdout, result.stdout


def test_the_whole_schedule_runs_for_real_too(own_database):
    result = _run(["-m", "app.jobs", "run", "all"], own_database)
    assert result.returncode == 0, result.stderr[-1500:] + result.stdout
    assert result.stdout.count(": ok ") == 3, result.stdout


def test_a_production_job_refuses_to_run_on_laptop_defaults(own_database):
    """It would email members links to localhost through a mail server that is
    not there. The run is recorded as failed and the exit status says so."""
    laptop = {**own_database, "VEYE_ENVIRONMENT": "production", "VEYE_WEB_BASE_URL": "http://localhost:3000", "VEYE_EMAIL_PROVIDER": "local-smtp",
              "VEYE_MEDIA_OBJECT_STORE": "local", "VEYE_KNOWLEDGE_OBJECT_STORE": "local"}
    result = _run(["-m", "app.jobs", "run", "deliver-outbox", "--dry-run"], laptop)
    assert result.returncode == 1
    for name in ("VEYE_WEB_BASE_URL", "VEYE_EMAIL_PROVIDER", "VEYE_MEDIA_OBJECT_STORE", "VEYE_KNOWLEDGE_OBJECT_STORE"):
        assert name in result.stdout, result.stdout
    smtp = _run(["-m", "app.jobs", "run", "deliver-outbox", "--dry-run"],
                {**laptop, "VEYE_EMAIL_PROVIDER": "smtp", "VEYE_SMTP_HOST": "127.0.0.1"})
    assert smtp.returncode == 1 and "VEYE_SMTP_HOST" in smtp.stdout and "VEYE_EMAIL_PROVIDER" not in smtp.stdout


# What only a process that answers requests needs.
REQUEST_ONLY = {"VEYE_TRUSTED_PROXY_HOPS", "VEYE_CORS_ORIGINS", "VEYE_LLM_PROVIDER", "VEYE_GEMINI_MEMBER_DATA_CLEARED",
                "VEYE_AUTH_PROVIDER", "VEYE_JOBS_INTERVAL_SECONDS"}


def test_the_maintenance_job_is_given_the_services_own_settings():
    """The job renders and sends the same emails and opens the same stores; a
    value set on the service and forgotten here is the laptop default."""
    import re

    gcp = API.parent / "deployment" / "gcp"
    entries = {name: re.findall(r"- name: (VEYE_[A-Z_]+)[^\n]*\n\s+(value(?:From)?: [^\n#]+)", (gcp / name).read_text(encoding="utf-8"))
               for name in ("api.service.yaml", "maintenance.job.yaml")}
    service = {k: v.strip() for k, v in entries["api.service.yaml"] if k not in REQUEST_ONLY}
    job = {k: v.strip() for k, v in entries["maintenance.job.yaml"]}
    assert len(service) > 12, "the manifest was not read"
    assert {k: v for k, v in service.items() if job.get(k) != v} == {}


def test_the_registry_knows_every_mapped_table():
    """A model file nobody lists here is a relationship that cannot resolve."""
    check = ("import app.db.registry; from app.db.base import Base; from sqlalchemy.orm import configure_mappers; configure_mappers(); "
             "before = set(Base.metadata.tables); import app.main; print(sorted(set(Base.metadata.tables) - before))")
    result = _run(["-c", check], dict(os.environ))
    assert result.returncode == 0 and result.stdout.strip() == "[]", result.stdout + result.stderr[-1500:]
