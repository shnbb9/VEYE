"""Who can reach every route — all of them, not a sample.

The two-portal rule is the whole of this application's authorisation model:
`require_member` reads only `veye_member_session`, `require_admin` reads only
`veye_admin_session`, and nothing else decides access. Individual journeys test
individual routes; this reads the live route table and asserts the rule over
every one, so a route added without a guard, or with the wrong one, fails here
on the day it is written rather than whenever someone thinks to look.

Three things are asserted for all of them:

  * every route either declares a guard or is named in PUBLIC_ROUTES below;
  * no guarded route answers an anonymous caller with anything but 401/403 —
    not 404, which would say whether the thing exists;
  * a session for the other portal is no session at all.

A new route with no guard fails `test_every_route_is_guarded_or_declared_public`
until someone writes it into PUBLIC_ROUTES, which is the point: making a route
public becomes a deliberate line in a test rather than an omission.
"""

from __future__ import annotations

# (no pytest decorators: the probes loop inside one test each, so a failure
# names every offending route rather than one test id per route)

from app.main import app
from tests.route_table import (ADMIN_GUARD, MEMBER_GUARD, OPTIONAL_GUARD, call as _call,
                              routes as _routes)

# Deliberately reachable without a session. Each one is a door into the
# product, a published read, or the public site writing in.
PUBLIC_ROUTES: set[tuple[str, str]] = {
    ("GET", "/health"),
    # Entering, leaving and recovering an account.
    ("POST", "/api/v1/auth/sign-up"),
    ("POST", "/api/v1/auth/sign-in"),
    ("POST", "/api/v1/auth/sign-out"),
    ("POST", "/api/v1/auth/admin/sign-in"),
    ("POST", "/api/v1/auth/admin/sign-out"),
    ("POST", "/api/v1/auth/identity/sign-in"),
    ("POST", "/api/v1/auth/admin/identity/sign-in"),
    ("POST", "/api/v1/auth/forgot-password"),
    ("POST", "/api/v1/auth/reset-password"),
    ("POST", "/api/v1/auth/verify-email"),
    ("POST", "/api/v1/auth/confirm-email-change"),
    # An invited administrator has no session until they have a password.
    ("GET", "/api/v1/auth/admin-invitation"),
    ("POST", "/api/v1/auth/admin-invitation/accept"),
    # Answers "who is signed in", for nobody as readily as for someone.
    ("GET", "/api/v1/auth/me"),
    # Published content the public Help page renders.
    ("GET", "/api/v1/content/{group}"),
    # The support address the public pages and the dashboard print.
    ("GET", "/api/v1/settings/support"),
    # The public assessment scores before an account exists, and stores nothing.
    ("POST", "/api/v1/health-number/preview"),
    # Contact Us / Help / Join Beta from the public site.
    ("POST", "/api/v1/requests"),
}

ROUTES = _routes()
GUARDED = [r for r in ROUTES if r["guards"]]
# `get_current_principal` reads the same member cookie as `require_member` and
# differs only by omitting the `is_member` check, so these are member routes
# too: they are account operations rather than member-profile ones.
MEMBER_ONLY = [r for r in ROUTES if MEMBER_GUARD in r["guards"] or OPTIONAL_GUARD in r["guards"]]
ADMIN_ONLY = [r for r in ROUTES if ADMIN_GUARD in r["guards"]]

# Routes that authenticate with `get_current_principal`: signed in through the
# member portal, member profile or not. Named here so a fourth one has to be
# considered rather than slipping in.
OPTIONAL_PRINCIPAL_ROUTES = {
    ("GET", "/api/v1/auth/notification-preferences"),
    ("PUT", "/api/v1/auth/notification-preferences"),
    ("POST", "/api/v1/auth/resend-verification"),
}




def test_the_route_table_was_actually_read():
    """A walker that found nothing would make every test below vacuous."""
    assert len(ROUTES) > 150, f"only {len(ROUTES)} routes found"
    assert len(ADMIN_ONLY) > 60 and len(MEMBER_ONLY) > 50, (len(ADMIN_ONLY), len(MEMBER_ONLY))


def test_every_route_is_guarded_or_declared_public():
    """An unguarded route is either a mistake or a decision. Write it down."""
    unguarded = [f"{r['method']} {r['path']} ({r['endpoint']})" for r in ROUTES
                 if not r["guards"] and (r["method"], r["path"]) not in PUBLIC_ROUTES]
    assert unguarded == [], (
        "These routes have no guard and are not named in PUBLIC_ROUTES. Add the guard, "
        "or add the route to that set with a line saying why it is public:\n  "
        + "\n  ".join(unguarded)
    )


def test_public_routes_set_has_no_stale_entries():
    """A path that no longer exists, kept in the set, silently excuses a typo."""
    live = {(r["method"], r["path"]) for r in ROUTES}
    stale = sorted(f"{m} {p}" for m, p in PUBLIC_ROUTES if (m, p) not in live)
    assert stale == [], f"PUBLIC_ROUTES names routes that do not exist: {stale}"


def test_the_weaker_member_guard_is_used_on_exactly_three_routes():
    """`get_current_principal` is `require_member` without the `is_member`
    check, so a route using it is open to an account holding a member session
    that has no member profile.

    That is unreachable today — `sign_in` and `sign_in_with_identity` both
    refuse the member portal when `not user.member_access`, so a member session
    implies a member profile — and all three routes are account operations
    rather than member-record ones. It is still the weaker of the two, so the
    list is pinned: a fourth route choosing it has to be justified here.
    """
    using = {(r["method"], r["path"]) for r in ROUTES
             if OPTIONAL_GUARD in r["guards"] and MEMBER_GUARD not in r["guards"] and ADMIN_GUARD not in r["guards"]}
    assert using == OPTIONAL_PRINCIPAL_ROUTES, (
        "the set of routes using get_current_principal has changed.\n"
        f"  added:   {sorted(using - OPTIONAL_PRINCIPAL_ROUTES)}\n"
        f"  removed: {sorted(OPTIONAL_PRINCIPAL_ROUTES - using)}\n"
        "Prefer require_member unless the route is an ACCOUNT operation, and say so here."
    )


def test_neither_portal_mints_a_session_for_the_other(client):
    """Why the weaker guard above is safe: a member session cannot exist for an
    account with no member profile, and the console cannot be entered by an
    account that has not been provisioned for it.

    Both sign-in paths apply these two checks, in this order, before issuing
    anything.
    """
    from app.seed.users import ensure_admin

    ensure_admin()
    # The seeded administrator has no member profile.
    refused = client.post("/api/v1/auth/sign-in", json={
        "email": "cara.hogue@demo.veye.test", "password": "CaraAdmin!2026-local", "remember": True})
    assert refused.status_code == 403, refused.text
    assert "member profile" in refused.text
    assert "veye_member_session" not in refused.cookies

    # And a plain member cannot enter the console.
    signed_up = client.post("/api/v1/auth/sign-up", json={
        "email": "portal.probe@demo.veye.test", "first_name": "Portal", "last_name": "Probe",
        "password": "PortalProbe!2026-local"})
    assert signed_up.status_code == 201, signed_up.text
    denied = client.post("/api/v1/auth/admin/sign-in", json={
        "email": "portal.probe@demo.veye.test", "password": "PortalProbe!2026-local", "remember": True})
    assert denied.status_code == 403, denied.text
    assert "administrator access" in denied.text
    assert "veye_admin_session" not in denied.cookies


def _violations(http, rows, allowed=(401, 403)):
    """Every route in `rows` this client was NOT refused, with what it got."""
    bad = []
    for row in rows:
        response = _call(http, row)
        if response.status_code not in allowed:
            bad.append(f"{row['method']} {row['path']} -> {response.status_code} {response.text[:90]}")
    return bad


def _no_violations(bad, total, what):
    assert bad == [], f"{len(bad)} of {total} {what}:" + "".join("\n  " + line for line in bad)


def test_no_guarded_route_answers_an_anonymous_caller(client):
    """401 or 403 — never 404, which would say whether the thing exists, and
    never 422, which would mean the body was read before the guard ran."""
    _no_violations(_violations(client, GUARDED), len(GUARDED),
                   "guarded routes answered an anonymous caller")


def test_admin_routes_refuse_a_plain_member_session(member_client):
    _no_violations(_violations(member_client, ADMIN_ONLY), len(ADMIN_ONLY),
                   "console routes accepted a member session")


def test_member_routes_refuse_an_administrator_only_session(admin_client):
    _no_violations(_violations(admin_client, MEMBER_ONLY), len(MEMBER_ONLY),
                   "member routes accepted a console session")


# ---------------------------------------------------------------------------
# The dual-access account: the only identity that can tell the two guards apart.
#
# A plain member is refused by `require_admin` twice over — no admin cookie,
# and `is_admin` is False — so it cannot show WHICH check did the refusing.
# Reintroducing one shared session (`principal = admin or member`) was tried
# against the three tests above and every one still passed, on the `is_admin`
# check alone.
#
# An account holding a member profile AND administrator access, signed in at
# one portal only, removes that second line of defence: if either guard read
# the other portal's cookie, these would answer 200. That is the portal
# boundary itself, and nothing else in the suite states it.
# ---------------------------------------------------------------------------

DUAL_EMAIL = "dual.matrix@demo.veye.test"
DUAL_PASSWORD = "DualMatrix!2026-local"


def _dual_session(portal: str):
    """A client holding a session for `portal` only, on an account with both
    kinds of access."""
    from fastapi.testclient import TestClient

    from app.auth.models import UserAccount
    from app.db.session import SessionLocal

    with TestClient(app) as setup:
        created = setup.post("/api/v1/auth/sign-up", json={
            "email": DUAL_EMAIL, "first_name": "Dual", "last_name": "Matrix", "password": DUAL_PASSWORD})
        assert created.status_code == 201, created.text
    with SessionLocal() as db:
        user = db.query(UserAccount).filter(UserAccount.email == DUAL_EMAIL).one()
        user.admin_access = True
        db.commit()

    # A clean jar, so only the one portal's cookie is held.
    http = TestClient(app)
    http.__enter__()
    path = "/api/v1/auth/admin/sign-in" if portal == "admin" else "/api/v1/auth/sign-in"
    signed_in = http.post(path, json={"email": DUAL_EMAIL, "password": DUAL_PASSWORD, "remember": True})
    assert signed_in.status_code == 200, signed_in.text
    held = set(http.cookies.keys())
    assert ("veye_admin_session" in held) == (portal == "admin"), held
    assert ("veye_member_session" in held) == (portal == "member"), held
    return http


def test_a_member_session_on_an_administrator_account_opens_no_console_route():
    http = _dual_session("member")
    try:
        # The account really does hold both, so a refusal below is about the
        # portal rather than about the account.
        assert http.get("/api/v1/members/me/health-permission").status_code == 200
        _no_violations(_violations(http, ADMIN_ONLY), len(ADMIN_ONLY),
                       "console routes answered the MEMBER cookie of an account that also has "
                       "administrator access - require_admin is reading the member session")
    finally:
        http.__exit__(None, None, None)


def test_an_admin_session_on_a_member_account_opens_no_member_route():
    http = _dual_session("admin")
    try:
        assert http.get("/api/v1/admin/overview").status_code == 200
        _no_violations(_violations(http, MEMBER_ONLY), len(MEMBER_ONLY),
                       "member routes answered the ADMIN cookie of an account that also has "
                       "a member profile - require_member is reading the admin session")
    finally:
        http.__exit__(None, None, None)
