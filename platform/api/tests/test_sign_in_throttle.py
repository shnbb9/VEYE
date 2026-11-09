"""Brute-force protection for sign-in.

The product rule being protected: guessing a password must get expensive, and
the refusal must never become a way to find out which addresses exist.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import MEMBER_PASSWORD, admin_sign_in, sign_in, sign_up

WRONG = "not-the-password"


def _fail(client: TestClient, email: str, times: int) -> list[int]:
    return [sign_in(client, email, WRONG).status_code for _ in range(times)]


def test_repeated_wrong_passwords_lock_that_identity_out(member_client, client):
    email = "aditya.demo@demo.veye.test"
    # The default limit is ten failures in fifteen minutes.
    assert _fail(client, email, 9) == [401] * 9
    # The tenth failure is still an ordinary refusal…
    assert sign_in(client, email, WRONG).status_code == 401
    # …and the next attempt is refused before the password is looked at.
    locked = sign_in(client, email, WRONG)
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers
    assert int(locked.headers["Retry-After"]) > 0
    assert "Try again in about" in locked.json()["detail"]
    # Even the CORRECT password is refused while the lock holds: that is the
    # point of it, and it is also why the limit is generous.
    assert sign_in(client, email, MEMBER_PASSWORD).status_code == 429


def test_the_lockout_says_nothing_about_whether_the_account_exists(client):
    """An address nobody has registered locks out exactly the same way, so the
    message cannot be used to enumerate members."""
    unknown = "nobody.here@demo.veye.test"
    assert _fail(client, unknown, 10) == [401] * 10
    locked = sign_in(client, unknown, WRONG)
    assert locked.status_code == 429
    known = TestClient(app)
    assert sign_up(known).status_code == 201
    other = TestClient(app)
    assert _fail(other, "aditya.demo@demo.veye.test", 10) == [401] * 10
    known_locked = sign_in(other, "aditya.demo@demo.veye.test", WRONG)
    assert known_locked.status_code == 429
    assert known_locked.json()["detail"] == locked.json()["detail"]


def test_a_correct_password_clears_that_identity(member_client, client):
    email = "aditya.demo@demo.veye.test"
    assert _fail(client, email, 5) == [401] * 5
    # Signing in correctly forgives the typos…
    assert sign_in(client, email, MEMBER_PASSWORD).status_code == 200
    # …so the next five failures start from zero rather than tipping over.
    assert _fail(client, email, 5) == [401] * 5
    assert sign_in(client, email, MEMBER_PASSWORD).status_code == 200


def test_one_identity_being_locked_does_not_lock_another(client):
    first = TestClient(app)
    assert sign_up(first).status_code == 201
    second = TestClient(app)
    assert sign_up(second, email="maya.demo@demo.veye.test", first_name="Maya").status_code == 201

    assert _fail(client, "aditya.demo@demo.veye.test", 10) == [401] * 10
    assert sign_in(client, "aditya.demo@demo.veye.test", WRONG).status_code == 429
    # Maya is untouched: the counter is per identity, not global.
    assert sign_in(client, "maya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 200


def test_the_admin_portal_shares_the_same_protection(admin_client, client):
    email = "cara.hogue@demo.veye.test"
    for _ in range(10):
        assert admin_sign_in(client, email, WRONG).status_code == 401
    locked = admin_sign_in(client, email, WRONG)
    assert locked.status_code == 429
    # The console door and the member door count the same identity together:
    # an attacker does not get a fresh ten attempts by switching portals.
    assert sign_in(client, email, WRONG).status_code == 429


def test_a_refused_portal_counts_as_an_attempt(admin_client, member_client, client):
    """Right password, wrong door is still an attempt on that identity — it is
    exactly what credential stuffing against the console looks like."""
    for _ in range(10):
        assert admin_sign_in(client, "aditya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 403
    assert admin_sign_in(client, "aditya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 429


def test_the_limit_can_be_switched_off_for_a_deployment_that_fronts_it(client, member_client):
    """A deployment with its own edge protection sets the limit to 0 rather
    than being throttled twice."""
    from app.core.runtime import configure_runtime, get_runtime

    runtime = get_runtime()
    configure_runtime(settings=runtime.settings.model_copy(update={"sign_in_max_failures": 0}))
    try:
        assert _fail(client, "aditya.demo@demo.veye.test", 20) == [401] * 20
        assert sign_in(client, "aditya.demo@demo.veye.test", MEMBER_PASSWORD).status_code == 200
    finally:
        configure_runtime(settings=runtime.settings)


# ---------------------------------------------------------------- housekeeping
def test_signing_in_tidies_the_rows_authentication_leaves_behind(member_client, client):
    """Dead sessions, spent tokens and counted attempts are pruned on the one
    event that proves the account is in use. A live session is never touched —
    tidying must not sign anybody out."""
    from datetime import datetime, timedelta, timezone

    from app.auth.models import AuthSession, AuthToken
    from app.auth.throttle import SignInAttempt
    from app.db.session import SessionLocal

    email = "aditya.demo@demo.veye.test"
    long_ago = datetime.now(timezone.utc) - timedelta(days=30)
    db = SessionLocal()
    try:
        user_id = db.query(AuthSession).first().user_id
        live_before = db.query(AuthSession).filter(AuthSession.user_id == user_id,
                                                   AuthSession.revoked_at.is_(None)).count()
        for n in range(3):
            db.add(AuthSession(user_id=user_id, token_hash=f"dead-session-{n}" * 3, portal="member",
                               expires_at=long_ago, created_at=long_ago))
        db.add(AuthToken(user_id=user_id, purpose="verify_email", token_hash="spent-token" * 4,
                         expires_at=long_ago, used_at=long_ago, created_at=long_ago))
        db.add(SignInAttempt(email=email, client_ip="203.0.113.9", portal="member",
                             succeeded=False, created_at=long_ago))
        db.commit()
        assert db.query(AuthSession).filter(AuthSession.user_id == user_id).count() == live_before + 3
    finally:
        db.close()

    assert sign_in(client, email, MEMBER_PASSWORD).status_code == 200

    db = SessionLocal()
    try:
        remaining = db.query(AuthSession).filter(AuthSession.user_id == user_id).all()
        # SQLite hands back naive datetimes; compare them as UTC.
        expiries = [row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
                    for row in remaining]
        assert all(expiry > long_ago for expiry in expiries), "a dead session survived"
        assert db.query(AuthToken).filter(AuthToken.token_hash == "spent-token" * 4).count() == 0
        assert db.query(SignInAttempt).filter(SignInAttempt.created_at == long_ago).count() == 0
        # the session this test just created is still usable
        assert member_client.get("/api/v1/members/me/sessions").status_code == 200
    finally:
        db.close()
