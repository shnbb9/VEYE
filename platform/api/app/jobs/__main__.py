"""`python -m app.jobs run <job|all> [--dry-run]`

The command a scheduler runs. Exits non-zero when any job failed, so a Cloud
Run Job execution is marked failed and alerting can see it.
"""

from __future__ import annotations

import argparse
import sys

from app.db import registry  # noqa: F401 — this process imports no routes, so no models either
from app.db.session import SessionLocal
from app.jobs.runner import JOBS, ON_DEMAND, run_job


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.jobs")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run one job, or all of them")
    run.add_argument("job", choices=sorted(JOBS) + sorted(ON_DEMAND) + ["all"])
    run.add_argument("--dry-run", action="store_true", help="count what would be done and change nothing")
    args = parser.parse_args(argv)

    jobs = sorted(JOBS) if args.job == "all" else [args.job]
    failed = False
    for job in jobs:
        record = run_job(SessionLocal, job, dry_run=args.dry_run, triggered_by="command line")
        print(f"{job}: {record.status} {record.counts}{' — ' + record.error if record.error else ''}")
        failed = failed or record.status != "ok"
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
