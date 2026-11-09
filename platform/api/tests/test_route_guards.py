"""Structural guarantees about the routing table itself.

Everything else in this suite tests behaviour one route at a time, which is
fine until somebody adds a route and forgets the guard — the one failure mode
a behavioural test cannot see, because nobody writes a test for the endpoint
they forgot about.

So these walk every registered route and assert the shape rather than the
answer. They are cheap, and they fail the moment a new endpoint is added
without the protection its neighbours have.
"""

from __future__ import annotations

from fastapi.routing import APIRoute

from app.main import app


def _all_routes() -> list[APIRoute]:
    """FastAPI wraps included routers, so the table has to be walked rather
    than read off `app.routes`."""
    found: list[APIRoute] = []

    def collect(items) -> None:
        for route in items:
            if isinstance(route, APIRoute):
                found.append(route)
            elif type(route).__name__ == "_IncludedRouter":
                collect(route.original_router.routes)

    collect(app.routes)
    return found


def _guards(route: APIRoute) -> set[str]:
    names: set[str] = set()

    def walk(dependant) -> None:
        for sub in dependant.dependencies:
            call = getattr(sub, "call", None)
            if call is not None:
                names.add(getattr(call, "__name__", str(call)))
            walk(sub)

    walk(route.dependant)
    return names


def test_the_routing_table_is_not_empty():
    """If the walk ever stops finding routes, every assertion below would pass
    vacuously — which is worse than failing."""
    routes = _all_routes()
    assert len(routes) > 100, f"only {len(routes)} routes found; the walk is broken"


def test_every_admin_route_requires_an_administrator():
    missing = [f"{sorted(r.methods)} {r.path}" for r in _all_routes()
               if r.path.startswith("/api/v1/admin") and "require_admin" not in _guards(r)]
    assert missing == [], "admin routes without require_admin"


def test_every_member_route_identifies_the_member_from_their_session():
    """A member route must take the member from the session, never from the
    client. `require_member` and friends are what put it there."""
    member_guards = {"require_member", "get_current_principal", "get_member_principal"}
    missing = [f"{sorted(r.methods)} {r.path}" for r in _all_routes()
               if (r.path.startswith("/api/v1/members/me") or "/members/{member_ref}" in r.path)
               and not (member_guards & _guards(r))]
    assert missing == [], "member routes without a session guard"


def test_no_member_route_takes_another_members_identifier():
    """`{member_ref}` resolves only to `me`; anything else in a member path has
    to be a row id, which the handler scopes to that member's own rows."""
    offenders = [r.path for r in _all_routes()
                 if r.path.startswith("/api/v1/members/")
                 and "{member_id}" in r.path]
    assert offenders == [], "a member route accepts a member id from the client"


def test_the_local_qa_endpoint_is_never_reachable_without_an_administrator():
    qa = [r for r in _all_routes() if "/qa/" in r.path]
    assert qa, "the QA route has moved; this guard needs updating"
    for route in qa:
        assert "require_admin" in _guards(route), route.path
