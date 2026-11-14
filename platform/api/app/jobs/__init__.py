"""Scheduled maintenance: retention purge, outbox delivery, erasure processing.

Run by Cloud Scheduler -> a Cloud Run Job in a deployment (`python -m app.jobs
run all`), optionally by the in-process loop locally, and on demand from the
console. Every job is idempotent, so running it twice, or from two places at
once, does the work once.
"""
