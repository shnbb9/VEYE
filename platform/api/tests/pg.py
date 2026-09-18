"""Optional real-PostgreSQL fixture for pgvector tests.

Uses the local Docker database (the documented local-only credentials) and a
separate `veye_test` database so the development data is never touched.
Skips cleanly when PostgreSQL is not reachable."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.base import Base

PG_ADMIN_URL = os.environ.get("VEYE_TEST_PG_ADMIN_URL", "postgresql+psycopg://veye_local:veye_local_dev_only@127.0.0.1:5432/veye")
PG_TEST_URL = os.environ.get("VEYE_TEST_DATABASE_URL", "postgresql+psycopg://veye_local:veye_local_dev_only@127.0.0.1:5432/veye_test")


def _ensure_test_database() -> None:
    admin = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = 'veye_test'")).scalar()
            if not exists:
                conn.execute(text("CREATE DATABASE veye_test"))
    finally:
        admin.dispose()


@pytest.fixture
def pg_sessionmaker():
    try:
        _ensure_test_database()
        engine = create_engine(PG_TEST_URL, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"PostgreSQL with pgvector is not reachable for tests: {exc}")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    try:
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
