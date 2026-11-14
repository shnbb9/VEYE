"""Cross-site request forgery protection and the headers every answer carries.

The rule being protected: a page on another origin can make the browser send
VEYE's session cookie, but it cannot read the token that must accompany it.
"""

from __future__ import annotations

from app.auth.csrf import CSRF_COOKIE, CSRF_HEADER
from tests.conftest import MEMBER_PASSWORD, sign_in, sign_up


def test_every_answer_carries_the_headers_that_cost_nothing(client):
    response = client.get("/api/v1/auth/me")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"
    # HSTS belongs to a deployment that actually serves TLS.
    assert "Strict-Transport-Security" not in response.headers


def test_the_browser_is_given_a_token_it_can_read(client):
    response = client.get("/api/v1/auth/me")
    assert CSRF_COOKIE in response.cookies
    header = response.headers.get("set-cookie", "")
    assert "veye_csrf=" in header
    # Readable on purpose: the client has to echo it back.
    assert "HttpOnly" not in header.split("veye_csrf=")[1].split(",")[0]


def test_a_session_request_without_the_token_is_refused(member_client):
    """What a forged cross-site POST looks like: the session cookie rides
    along, but the attacker's page could not read the token to copy it."""
    token = member_client.cookies.get(CSRF_COOKIE)
    assert token, "the browser should have been given a token"

    forged = member_client.post("/api/v1/members/me/requests",
                                json={"kind": "contact_us", "message": "Forged from another origin."},
                                headers={CSRF_HEADER: ""})
    assert forged.status_code == 403
    assert "could not be verified" in forged.json()["detail"]

    wrong = member_client.post("/api/v1/members/me/requests",
                               json={"kind": "contact_us", "message": "Forged with a guessed token."},
                               headers={CSRF_HEADER: "not-the-token"})
    assert wrong.status_code == 403

    # The same request from the real application is accepted.
    allowed = member_client.post("/api/v1/members/me/requests",
                                 json={"kind": "contact_us", "message": "Sent from the Veye application."},
                                 headers={CSRF_HEADER: token})
    assert allowed.status_code == 201, allowed.text


def test_reads_never_need_a_token(member_client):
    for path in ("/api/v1/auth/me", "/api/v1/members/me/sessions", "/api/v1/members/me/requests"):
        assert member_client.get(path).status_code == 200


def test_signing_in_needs_no_token_because_there_is_no_session_to_ride(client):
    """Demanding one here would break the first page anybody ever loads: the
    browser has no session yet, so there is nothing for a forged request to
    ride on."""
    assert sign_up(client).status_code == 201
    # Signing OUT does carry a session, so it is protected like any other
    # state change — a cross-site page must not be able to sign people out.
    token = client.cookies.get(CSRF_COOKIE)
    assert client.post("/api/v1/auth/sign-out", headers={CSRF_HEADER: ""}).status_code == 403
    assert client.post("/api/v1/auth/sign-out", headers={CSRF_HEADER: token}).status_code == 204
    # With no session cookie left, signing in needs no token at all.
    assert sign_in(client, "aditya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 200


def test_the_admin_console_is_protected_the_same_way(admin_client):
    token = admin_client.cookies.get(CSRF_COOKIE)
    forged = admin_client.post("/api/v1/admin/administrators/invite",
                               json={"email": "forged@demo.veye.test", "first_name": "Forged"},
                               headers={CSRF_HEADER: "not-the-token"})
    assert forged.status_code == 403
    allowed = admin_client.post("/api/v1/admin/administrators/invite",
                                json={"email": "real.invite@demo.veye.test", "first_name": "Real"},
                                headers={CSRF_HEADER: token})
    assert allowed.status_code == 201, allowed.text


# ---------------------------------------------------------------------------
# Every state-changing route, not one of them.
#
# The two tests above prove enforcement on a member POST and an admin POST.
# Enforcement is middleware, so it should hold everywhere — but "should,
# because it is middleware" is an argument, not a test, and a router mounted on
# a sub-application would sit outside it without anyone noticing. These read
# the live route table and withhold the token from all of them.
#
# The conftest adds the header to every unsafe request automatically, so the
# whole suite otherwise runs WITH a token; an empty header is left alone by
# that patch, which is how a forged request is expressed here.
# ---------------------------------------------------------------------------

from tests.route_table import (ADMIN_GUARD, MEMBER_GUARD, OPTIONAL_GUARD,  # noqa: E402
                               SAFE_METHODS, call, routes)

_ROUTES = routes()
UNSAFE_MEMBER = [r for r in _ROUTES
                 if r["method"] not in SAFE_METHODS and (MEMBER_GUARD in r["guards"] or OPTIONAL_GUARD in r["guards"])]
UNSAFE_ADMIN = [r for r in _ROUTES if r["method"] not in SAFE_METHODS and ADMIN_GUARD in r["guards"]]


def _accepted_without_a_token(http, rows):
    """Rows this client was NOT refused when the token was withheld."""
    allowed = []
    for row in rows:
        response = call(http, row, headers={CSRF_HEADER: ""})
        # 403 is the refusal. Anything else means the request got past CSRF —
        # including 404 and 422, which are answers from inside the handler.
        if response.status_code != 403:
            allowed.append(f"{row['method']} {row['path']} -> {response.status_code} {response.text[:80]}")
    return allowed


def test_the_route_table_was_read_and_has_state_changing_routes():
    assert len(UNSAFE_MEMBER) > 25 and len(UNSAFE_ADMIN) > 30, (len(UNSAFE_MEMBER), len(UNSAFE_ADMIN))


def test_no_state_changing_member_route_accepts_a_request_without_the_token(member_client):
    allowed = _accepted_without_a_token(member_client, UNSAFE_MEMBER)
    assert allowed == [], (
        f"{len(allowed)} of {len(UNSAFE_MEMBER)} state-changing member routes answered a request carrying "
        "the session cookie but no CSRF token:" + "".join("\n  " + line for line in allowed)
    )


def test_no_state_changing_console_route_accepts_a_request_without_the_token(admin_client):
    allowed = _accepted_without_a_token(admin_client, UNSAFE_ADMIN)
    assert allowed == [], (
        f"{len(allowed)} of {len(UNSAFE_ADMIN)} state-changing console routes answered a request carrying "
        "the session cookie but no CSRF token:" + "".join("\n  " + line for line in allowed)
    )
