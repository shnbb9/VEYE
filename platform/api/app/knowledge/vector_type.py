"""A minimal SQLAlchemy type for pgvector's `vector(n)` column.

On PostgreSQL it binds/parses the `[x,y,z]` text form and exposes the cosine
distance operator. On SQLite (the isolated test fixture) it falls back to a
JSON list so the same models load; ranking then happens in Python."""

from __future__ import annotations

import json

from sqlalchemy import JSON
from sqlalchemy.types import UserDefinedType


class Vector(UserDefinedType):
    cache_ok = True

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions

    def get_col_spec(self, **_) -> str:
        return f"vector({self.dimensions})"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            return "[" + ",".join(f"{float(v):.8g}" for v in value) + "]"

        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            if isinstance(value, (list, tuple)):
                return [float(v) for v in value]
            return [float(v) for v in json.loads(value)]

        return process

    class comparator_factory(UserDefinedType.Comparator):
        def cosine_distance(self, other):
            return self.op("<=>", return_type=_Float())(other)


def _Float():
    from sqlalchemy import Float

    return Float()


def vector_column_type(dimensions: int):
    """`vector(n)` on PostgreSQL, JSON everywhere else."""
    return Vector(dimensions).with_variant(JSON(), "sqlite")
