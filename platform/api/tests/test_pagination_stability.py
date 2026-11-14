"""Paged queries must ask for a total order.

`ORDER BY created_at DESC` with `OFFSET`/`LIMIT` is only a total order when
`created_at` is unique. Where it is not, the database may break the tie however
it likes — and it breaks it separately for the page-1 query and the page-2
query. A row is then served on both pages while another is served on neither,
and nothing reports a problem. The audit log hit this because `record_audit`
writes several rows inside one request; member requests are seeded with
`_days_ago(days, hour=10)`, which zeroes the minute and the second, so any two
seeded the same number of days ago are stamped identically.

WHY THIS IS ASSERTED ON THE SQL AND NOT ON THE ROWS

The obvious test — page through a tied list and check every row appears exactly
once — was written first, and it passes whether or not the tiebreaker is there.
It was watched passing with `.id.desc()` deliberately removed. SQLite returns
tied rows in rowid order, so the defect is invisible to it, and PostgreSQL is
free to return a stable order too for a small table read by a sequential scan.
"Unspecified" means a test cannot rely on seeing it go wrong.

What IS decidable is the question the database was asked. So this captures the
SQL the ORM emits while the console's paged screens are read, and asserts that
every paged SELECT orders by something unique. That is the property which makes
the row-level behaviour true, and it holds on any engine.
"""

from __future__ import annotations

import re

from sqlalchemy import event

from app.db.session import engine

# A paged query is one the database is asked to slice.
PAGED = re.compile(r"\bLIMIT\b", re.IGNORECASE)
ORDER_BY = re.compile(r"\bORDER BY\b(?P<terms>.*?)(?=\bLIMIT\b|\bOFFSET\b|$)", re.IGNORECASE | re.DOTALL)
# Unique enough to be a total order: a primary key, or a column named id.
UNIQUE_TERM = re.compile(r"\b[\w.\"]*\bid\b", re.IGNORECASE)

# Screens the console pages. Each is read twice, because the bug is a
# disagreement BETWEEN page queries.
PAGED_SCREENS = [
    ("/api/v1/admin/requests", {"view": "all", "page_size": 2}),
    ("/api/v1/admin/members", {"page_size": 2}),
    ("/api/v1/admin/companion/advanced/audit", {"limit": 2}),
    ("/api/v1/admin/assessments/health_number/attempts", {"page_size": 2}),
]


class _Captured:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def __enter__(self):
        @event.listens_for(engine, "before_cursor_execute")
        def _record(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
            self.statements.append(" ".join(statement.split()))

        self._handler = _record
        return self

    def __exit__(self, *exc):
        event.remove(engine, "before_cursor_execute", self._handler)
        return False

    @property
    def paged_selects(self) -> list[str]:
        return [s for s in self.statements if s.upper().startswith("SELECT") and PAGED.search(s)]


def _without_a_total_order(statements: list[str]) -> list[str]:
    """Paged SELECTs whose ORDER BY cannot distinguish two tied rows."""
    offenders = []
    for statement in statements:
        # A LIMIT with no ORDER BY at all is a different smell: the rows come
        # back in whatever order the engine likes, every time.
        match = ORDER_BY.search(statement)
        if match is None:
            offenders.append(f"no ORDER BY: {statement[:150]}")
            continue
        if not UNIQUE_TERM.search(match.group("terms")):
            offenders.append(f"ORDER BY{match.group('terms')[:90]} — nothing unique: {statement[:110]}")
    return offenders


def test_the_capture_sees_the_queries_at_all(admin_client):
    """A listener that recorded nothing would make the test below vacuous."""
    with _Captured() as captured:
        response = admin_client.get("/api/v1/admin/requests", params={"view": "all", "page": 1, "page_size": 2})
        assert response.status_code == 200, response.text
    assert captured.statements, "no SQL was captured"
    assert captured.paged_selects, f"no paged SELECT among {len(captured.statements)} statements"


def test_every_paged_query_the_console_runs_orders_by_something_unique(admin_client):
    with _Captured() as captured:
        for path, params in PAGED_SCREENS:
            for page in (1, 2):
                response = admin_client.get(path, params={**params, "page": page})
                # 404 is fine — a screen that needs data this fixture has not
                # created still must not be ordered ambiguously when it works.
                assert response.status_code in (200, 404, 422), f"{path} -> {response.status_code}: {response.text[:120]}"

    paged = captured.paged_selects
    assert len(paged) >= 4, f"only {len(paged)} paged selects captured: {paged}"
    offenders = _without_a_total_order(paged)
    assert offenders == [], (
        f"{len(offenders)} of {len(paged)} paged queries do not ask for a total order, so which rows land on "
        "which page is up to the engine:" + "".join("\n  " + line for line in offenders)
    )


def test_paging_a_tied_list_returns_every_row_once(member_client, admin_client):
    """Kept as a sanity property, NOT as the guard: it passes with the
    tiebreaker removed, because SQLite orders tied rows by rowid. The SQL-shape
    test above is what would fail."""
    from datetime import datetime, timezone

    from app.db.session import SessionLocal
    from app.requests.models import MemberRequest

    for index in range(10):
        created = member_client.post("/api/v1/members/me/requests", json={
            "kind": "contact_us", "subject": f"Tied {index}", "message": f"Message number {index}."})
        assert created.status_code == 201, created.text

    stamp = datetime(2026, 11, 14, 10, 0, 0, tzinfo=timezone.utc)
    with SessionLocal() as db:
        for row in db.query(MemberRequest).all():
            row.created_at = stamp
            row.updated_at = stamp
        db.commit()

    seen: list[str] = []
    page = 1
    while True:
        body = admin_client.get("/api/v1/admin/requests",
                                params={"view": "all", "page": page, "page_size": 3}).json()
        seen.extend(row["id"] for row in body["rows"])
        if page * body["page_size"] >= body["total"]:
            break
        page += 1
        assert page < 50, "paging did not terminate"

    assert len({row_id for row_id in seen if seen.count(row_id) > 1}) == 0, "a request was served on two pages"
    assert len(seen) == body["total"], f"paging showed {len(seen)} of {body['total']} requests"
