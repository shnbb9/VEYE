"""The live route table, read once.

Several suites assert something over *every* route rather than over a chosen
few — who may reach it, whether another member's id is refused, whether a
state-changing call needs its CSRF token. They all need the same two things:
the table, and the guard each route declares. Keeping one copy of that here
means a change in how FastAPI stores routes is a change in one place.

This FastAPI wraps `include_router` in a `_IncludedRouter` rather than
flattening the routes onto the app, so the table is reached through
`original_router`; `app.routes` alone shows one real route.
"""

from __future__ import annotations

import re

from app.main import app

ADMIN_GUARD = "require_admin"
MEMBER_GUARD = "require_member"
OPTIONAL_GUARD = "get_current_principal"
GUARD_NAMES = (ADMIN_GUARD, MEMBER_GUARD, OPTIONAL_GUARD, "require_principal")

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
UUID_SAMPLE = "00000000-0000-4000-8000-000000000000"

_ID_TOKENS = (
    "member_id", "entry_id", "item_id", "request_id", "attempt_id", "source_id",
    "document_id", "version_id", "feedback_id", "conversation_id", "message_id",
    "account_id", "invitation_id", "reply_id", "flow_id", "user_id", "day_id",
    "meal_id", "id",
)


def _walk(router, out):
    for route in getattr(router, "routes", []) or []:
        inner = getattr(route, "original_router", None)
        if inner is not None:
            _walk(inner, out)
        else:
            out.append(route)
    return out


def _guards(route) -> list[str]:
    """Every guard dependency reachable from the route, router-level included."""
    found: list[str] = []
    stack = [getattr(route, "dependant", None)]
    seen: set[int] = set()
    while stack:
        dependant = stack.pop()
        if dependant is None or id(dependant) in seen:
            continue
        seen.add(id(dependant))
        name = getattr(getattr(dependant, "call", None), "__name__", None)
        if name:
            found.append(name)
        stack.extend(getattr(dependant, "dependencies", []) or [])
    return [name for name in GUARD_NAMES if name in found]


def concrete(path: str) -> str:
    """A path with its parameters filled in, so validation cannot answer first.

    The values need only be well-formed. A caller who may not reach the route
    must be refused before anything is looked up, so nothing here has to exist.
    """
    filled = path
    for token in _ID_TOKENS:
        filled = filled.replace("{" + token + "}", UUID_SAMPLE)
    filled = filled.replace("{group}", "help_faq").replace("{key}", "health_number")
    filled = filled.replace("{entry_date}", "2026-11-14").replace("{day}", "2026-11-14")
    filled = filled.replace("{kind}", "fitness").replace("{scope_key}", "using_veye")
    filled = filled.replace("{member_ref}", "me")
    while "{" in filled:
        start = filled.index("{")
        end = filled.index("}", start)
        filled = filled[:start] + "probe" + filled[end + 1:]
    return filled


def routes() -> list[dict]:
    """One row per method+path the API serves, excluding the docs endpoints."""
    rows: list[dict] = []
    for route in _walk(app, []):
        path = getattr(route, "path", None)
        methods = sorted(m for m in (getattr(route, "methods", []) or []) if m not in {"HEAD", "OPTIONS"})
        if not path or not methods:
            continue
        if path.startswith("/openapi") or path in {"/docs", "/redoc", "/docs/oauth2-redirect"}:
            continue
        guards = _guards(route)
        for method in methods:
            rows.append({
                "method": method,
                "path": path,
                "guards": guards,
                "params": set(re.findall(r"{(\w+)}", path)),
                "endpoint": getattr(getattr(route, "endpoint", None), "__name__", ""),
            })
    rows.sort(key=lambda row: (row["path"], row["method"]))
    return rows


def call(http, row, *, headers=None):
    """Make the request this row describes, with a body where one is wanted."""
    body = {} if row["method"] in {"POST", "PUT", "PATCH"} else None
    return http.request(row["method"], concrete(row["path"]), json=body, headers=headers)
