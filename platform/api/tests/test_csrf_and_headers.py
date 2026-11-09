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
