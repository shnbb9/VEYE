"""Do the migrations build the schema the models declare?

CI already proves the chain *applies* to an empty database. That is a different
claim: a column added to a model with no migration written for it passes
`alembic upgrade head` without complaint and then fails at runtime, on the
first request that selects it, with "column does not exist". The local stack
never notices either, because it migrated once when it was first created.

So this migrates an empty database and compares what came out with
`Base.metadata`, in both directions:

  * every table and column the models declare exists after migrating — the
    direction that breaks production;
  * every migrated table and column is still declared by a model — the
    direction that leaves dead columns behind after a model is edited.

Needs the real PostgreSQL: the chain uses pgvector and `JSONB`, which SQLite
cannot represent. Skips cleanly when it is not reachable, so it costs nothing
on a machine without the local stack up.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, inspect, text

from app.db.base import Base

PG_ADMIN_URL = os.environ.get(
    "VEYE_TEST_PG_ADMIN_URL",
    "postgresql+psycopg://veye_local:veye_local_dev_only@127.0.0.1:5432/veye")
DRIFT_DB = "veye_migration_drift"

# Alembic's own bookkeeping table is not a model and never will be.
NOT_A_MODEL = {"alembic_version"}


def _drift_url() -> str:
    base, _, _ = PG_ADMIN_URL.rpartition("/")
    return f"{base}/{DRIFT_DB}"


def _recreate_drift_database() -> None:
    admin = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{DRIFT_DB}" WITH (FORCE)'))
            conn.execute(text(f'CREATE DATABASE "{DRIFT_DB}"'))
    finally:
        admin.dispose()


def _drop_drift_database() -> None:
    admin = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{DRIFT_DB}" WITH (FORCE)'))
    finally:
        admin.dispose()


@pytest.fixture
def migrated_engine():
    """An empty database with the whole chain applied — nothing else."""
    import subprocess
    import sys
    from pathlib import Path

    url = _drift_url()
    try:
        _recreate_drift_database()
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"PostgreSQL with pgvector is not reachable: {exc}")

    # A subprocess, not `alembic.command` in-process: `alembic/env.py` sets the
    # URL from `app.core.config.settings`, a singleton already imported with
    # the SQLite test URL, so an in-process run would migrate the wrong
    # database. This is also the path CI takes.
    root = Path(__file__).resolve().parents[1]
    migrate = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(root), capture_output=True, text=True,
        env={**os.environ, "VEYE_DATABASE_URL": url},
    )
    assert migrate.returncode == 0, (
        "alembic upgrade head failed against an empty database:\n"
        f"{migrate.stdout[-2000:]}\n{migrate.stderr[-2000:]}"
    )
    try:
        yield engine
    finally:
        engine.dispose()
        _drop_drift_database()


def _declared() -> dict[str, set[str]]:
    return {name: {column.name for column in table.columns} for name, table in Base.metadata.tables.items()}


def _migrated(engine) -> dict[str, set[str]]:
    inspector = inspect(engine)
    return {name: {column["name"] for column in inspector.get_columns(name)}
            for name in inspector.get_table_names()
            if name not in NOT_A_MODEL}


def test_the_chain_really_applied(migrated_engine):
    """A fixture that silently created nothing would make the rest vacuous."""
    migrated = _migrated(migrated_engine)
    assert len(migrated) > 20, f"only {len(migrated)} tables after migrating: {sorted(migrated)}"
    with migrated_engine.connect() as conn:
        revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert revision, "no revision was stamped"


def test_every_table_and_column_a_model_declares_exists_after_migrating(migrated_engine):
    declared, migrated = _declared(), _migrated(migrated_engine)

    missing_tables = sorted(set(declared) - set(migrated))
    assert missing_tables == [], (
        "models declare tables that no migration creates — every request touching one would fail "
        f"at runtime: {missing_tables}"
    )

    missing_columns = sorted(
        f"{table}.{column}"
        for table, columns in declared.items()
        for column in columns - migrated.get(table, set())
    )
    assert missing_columns == [], (
        "models declare columns that no migration creates. `alembic upgrade head` succeeds and the "
        f"first query selecting one fails with \"column does not exist\": {missing_columns}"
    )


def test_every_migrated_table_and_column_is_still_declared_by_a_model(migrated_engine):
    """The other direction: a column left behind when a model was edited. Not a
    failure in production, but it is schema nobody owns, and it is how a
    migration chain stops describing the application."""
    declared, migrated = _declared(), _migrated(migrated_engine)

    orphan_tables = sorted(set(migrated) - set(declared))
    assert orphan_tables == [], f"migrated tables that no model declares: {orphan_tables}"

    orphan_columns = sorted(
        f"{table}.{column}"
        for table, columns in migrated.items()
        for column in columns - declared.get(table, set())
    )
    assert orphan_columns == [], f"migrated columns that no model declares: {orphan_columns}"
