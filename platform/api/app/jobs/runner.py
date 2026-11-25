"""Run maintenance jobs and record what they did.

Each job takes a Session and a `dry_run` flag and returns a dict of counts.
The run record is written in its own transaction, so a job that fails still
leaves "failed at 03:00 with this error" behind instead of nothing.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Callable

from sqlalchemy.orm import Session

from app.jobs.models import ScheduledJobRun

log = logging.getLogger("veye.jobs")

JobFn = Callable[[Session, bool], dict]


def _purge_prospects(db: Session, dry_run: bool) -> dict:
    from app.core.runtime import get_runtime
    from app.prospects.routes import cipher_for
    from app.prospects.service import ProspectService

    runtime = get_runtime()
    return ProspectService(db, cipher=cipher_for(runtime.settings), now=runtime.clock).purge_expired(dry_run=dry_run)


def _deliver_outbox(db: Session, dry_run: bool) -> dict:
    from app.core.runtime import get_runtime
    from app.notifications.service import NotificationService

    return NotificationService(db, get_runtime().email).dispatch_due(dry_run=dry_run)


def _process_erasures(db: Session, dry_run: bool) -> dict:
    from app.erasure.service import process_pending_erasures

    return process_pending_erasures(db, dry_run=dry_run)


def _replay_erasures(db: Session, dry_run: bool) -> dict:
    """After a database restore: re-apply every erasure the ledger (kept in
    object storage, outside the database) records. Harmless otherwise."""
    from app.erasure.service import replay_erasure_ledger

    return replay_erasure_ledger(db, dry_run=dry_run)


def _reindex_knowledge(db: Session, dry_run: bool) -> dict:
    """After the embedding provider is changed: write the approved sources into
    the index it searches, beside the one they are in already."""
    from app.core.runtime import get_runtime
    from app.knowledge.service import KnowledgeService

    runtime = get_runtime()
    return KnowledgeService(db, runtime.object_store, runtime.embeddings).reindex(dry_run=dry_run)


_LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")


def _refuse_laptop_settings() -> None:
    """A production job with a setting nobody passed runs on the development
    default: retried emails would go to a mail server on 127.0.0.1 with links
    to localhost in them. Failing loudly is the better night."""
    from app.core.config import settings

    if not settings.is_production:
        return
    local = []
    if any(host in settings.web_base_url for host in _LOCAL_HOSTS):
        local.append("VEYE_WEB_BASE_URL")
    if settings.email_provider != "smtp":
        local.append("VEYE_EMAIL_PROVIDER")
    elif settings.smtp_host in _LOCAL_HOSTS:
        local.append("VEYE_SMTP_HOST")
    if settings.media_object_store == "local":
        local.append("VEYE_MEDIA_OBJECT_STORE")
    if settings.knowledge_object_store == "local":
        local.append("VEYE_KNOWLEDGE_OBJECT_STORE")
    if local:
        raise RuntimeError("Not configured for production: " + ", ".join(local) + " still has its development default.")


JOBS: dict[str, JobFn] = {
    "purge-prospects": _purge_prospects,
    "deliver-outbox": _deliver_outbox,
    "process-erasures": _process_erasures,
}
# Run on demand (`python -m app.jobs run replay-erasures`) as part of every
# restore runbook, not on a schedule: it reads the whole ledger.
ON_DEMAND: dict[str, JobFn] = {
    "replay-erasures": _replay_erasures,
    # Once, when somebody has decided to search with another embedding provider.
    "reindex-knowledge": _reindex_knowledge,
}


def latest_run(db: Session, job: str) -> ScheduledJobRun | None:
    return (db.query(ScheduledJobRun).filter(ScheduledJobRun.job == job)
            .order_by(ScheduledJobRun.started_at.desc(), ScheduledJobRun.id.desc()).first())


def run_job(session_factory: Callable[[], Session], job: str, *, dry_run: bool = False,
            triggered_by: str = "scheduler") -> ScheduledJobRun:
    fn = JOBS.get(job) or ON_DEMAND[job]
    with session_factory() as db:
        run = ScheduledJobRun(job=job, dry_run=dry_run, triggered_by=triggered_by[:160])
        db.add(run)
        db.commit()
        run_id = run.id
    with session_factory() as db:
        try:
            _refuse_laptop_settings()
            counts = fn(db, dry_run)
            if dry_run:
                db.rollback()
            else:
                db.commit()
            status, error = "ok", None
        except Exception as exc:  # recorded, not swallowed: the run row says what broke
            db.rollback()
            counts, status = getattr(exc, "counts", {}), "error"    # what was done all the same
            error = f"{type(exc).__name__}: {str(exc)[:500]}"
            log.exception("job %s failed", job)
    with session_factory() as db:
        run = db.get(ScheduledJobRun, run_id)
        run.status = status
        run.error = error
        run.counts = counts
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
        return run


class JobLoop:
    """The local stand-in for Cloud Scheduler: every `interval` seconds, run
    every job. Off unless VEYE_JOBS_INTERVAL_SECONDS is set; never used by the
    test suite, which calls the jobs directly with a controlled clock."""

    def __init__(self, session_factory: Callable[[], Session], interval: float) -> None:
        self.session_factory = session_factory
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="veye-jobs", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            for job in JOBS:
                try:
                    run_job(self.session_factory, job, triggered_by="in-process loop")
                except Exception:  # pragma: no cover - run_job records its own failures
                    log.exception("job loop could not run %s", job)
