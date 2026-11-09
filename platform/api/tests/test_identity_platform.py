"""Production authentication: Google Identity Platform proves who, VEYE still
decides what.

Every test here mints its own RS256 tokens with a throwaway key, so the whole
production sign-in path — signature, issuer, audience, tenant, expiry, MFA,
account mapping and portal isolation — is proven on a developer machine with
no Google Cloud project in existence. What a real deployment adds is the key
endpoint, not the logic.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.auth.identity import (
    GoogleIdentityPlatformVerifier,
    IdentityError,
    VerifiedIdentity,
    second_factor_accepted,
)
from app.auth.models import UserAccount
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.main import app
from tests.conftest import sign_up

PROJECT = "veye-platform-test"
ISSUER = f"https://securetoken.google.com/{PROJECT}"


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def verifier(signing_key):
    """A verifier wired to the throwaway key instead of Google's endpoint."""
    return GoogleIdentityPlatformVerifier(
        project_id=PROJECT, tenant_id=None, leeway_seconds=30,
        key_resolver=lambda _token: signing_key.public_key(),
    )


def mint(signing_key, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER, "aud": PROJECT, "sub": "google-uid-aditya",
        "iat": now, "exp": now + 3600, "auth_time": now,
        "email": "aditya.demo@demo.veye.test", "email_verified": True,
        "firebase": {"sign_in_provider": "password"},
    }
    firebase = overrides.pop("firebase", None)
    claims.update(overrides)
    if firebase is not None:
        claims["firebase"] = firebase
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, signing_key, algorithm=overrides.pop("alg", "RS256"))


# ---- the token itself ------------------------------------------------------

def test_a_well_formed_token_yields_exactly_the_facts_it_carries(verifier, signing_key):
    identity = verifier.verify(mint(signing_key, firebase={"sign_in_provider": "password",
                                                           "sign_in_second_factor": "totp"}))
    assert identity.subject == "google-uid-aditya"
    assert identity.email == "aditya.demo@demo.veye.test"
    assert identity.email_verified is True
    assert identity.second_factor == "totp"
    assert identity.sign_in_provider == "password"
    assert identity.tenant is None
    assert identity.has_second_factor


@pytest.mark.parametrize("overrides, why", [
    ({"iss": "https://securetoken.google.com/some-other-project"}, "another project's issuer"),
    ({"aud": "some-other-project"}, "another project's audience"),
    ({"exp": int(time.time()) - 120}, "expired"),
    ({"sub": ""}, "no subject"),
])
def test_a_token_that_fails_any_check_is_refused(verifier, signing_key, overrides, why):
    with pytest.raises(IdentityError):
        verifier.verify(mint(signing_key, **overrides))


def test_a_token_signed_by_somebody_else_is_refused(verifier):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = mint(other)
    with pytest.raises(IdentityError):
        verifier.verify(forged)


def test_an_unsigned_token_is_refused(verifier, signing_key):
    """The alg is pinned, so `alg: none` never reaches the signature check."""
    now = int(time.time())
    unsigned = jwt.encode({"iss": ISSUER, "aud": PROJECT, "sub": "x", "iat": now, "exp": now + 60},
                          key="", algorithm="none")
    with pytest.raises(IdentityError) as refused:
        verifier.verify(unsigned)
    assert "algorithm" in str(refused.value).lower()


def test_a_token_for_another_tenant_is_refused(signing_key):
    """One Identity Platform tenant per environment: a staging token must not
    open production."""
    production = GoogleIdentityPlatformVerifier(project_id=PROJECT, tenant_id="veye-production",
                                                key_resolver=lambda _t: signing_key.public_key())
    staging_token = mint(signing_key, firebase={"sign_in_provider": "password", "tenant": "veye-staging"})
    with pytest.raises(IdentityError):
        production.verify(staging_token)
    # Its own tenant is accepted.
    own = mint(signing_key, firebase={"sign_in_provider": "password", "tenant": "veye-production"})
    assert production.verify(own).tenant == "veye-production"


def test_garbage_is_refused_without_raising_anything_but_identity_error(verifier):
    for rubbish in ("", "not-a-token", "a.b.c", "x" * 200):
        with pytest.raises(IdentityError):
            verifier.verify(rubbish)


# ---- the MFA policy --------------------------------------------------------

def _identity(second_factor):
    return VerifiedIdentity(subject="s", email="a@b.c", email_verified=True, second_factor=second_factor,
                            sign_in_provider="password", tenant=None, auth_time=None)


def test_the_console_requires_a_second_factor_and_sms_is_never_implied():
    totp_only = frozenset({"totp"})
    assert second_factor_accepted(_identity("totp"), required=True, accepted=totp_only)
    assert not second_factor_accepted(_identity(None), required=True, accepted=totp_only)
    # A deployment that has not asked for SMS does not get SMS.
    assert not second_factor_accepted(_identity("phone"), required=True, accepted=totp_only)
    # It has to be named on purpose.
    assert second_factor_accepted(_identity("phone"), required=True, accepted=frozenset({"totp", "phone"}))
    # And the requirement can be switched off for the member portal.
    assert second_factor_accepted(_identity(None), required=False, accepted=totp_only)


def test_the_default_accepted_factor_is_totp_not_sms():
    from app.core.config import Settings

    defaults = Settings(database_url="sqlite:///./unused.db")
    assert defaults.admin_mfa_required is True
    assert defaults.admin_second_factors == frozenset({"totp"})
    assert "sms" not in defaults.admin_second_factors
    assert "phone" not in defaults.admin_second_factors


# ---- signing in through the real routes ------------------------------------

@pytest.fixture
def identity_runtime(verifier):
    """The API running on the identity-platform provider, with the throwaway
    verifier in place of Google."""
    before = get_runtime()
    configure_runtime(identity=verifier)
    yield
    configure_runtime(identity=before.identity)


def _link(email: str, subject: str) -> None:
    db = SessionLocal()
    try:
        user = db.query(UserAccount).filter(UserAccount.email == email).one()
        user.identity_subject = subject
        db.commit()
    finally:
        db.close()


def test_a_linked_member_signs_in_with_a_token_and_gets_the_member_cookie(member_client, identity_runtime, signing_key):
    _link("aditya.demo@demo.veye.test", "google-uid-aditya")
    client = TestClient(app)
    answer = client.post("/api/v1/auth/identity/sign-in", json={"id_token": mint(signing_key)})
    assert answer.status_code == 200, answer.text
    assert answer.json()["account"]["email"] == "aditya.demo@demo.veye.test"
    assert "veye_member_session" in answer.cookies or "veye_member_session" in client.cookies
    # The session is VEYE's own, so VEYE's own routes accept it.
    assert client.get("/api/v1/auth/me").status_code == 200


def test_a_token_never_opens_the_console_for_an_account_without_admin_access(member_client, identity_runtime, signing_key):
    """Authentication is Google's; administrator access is not. No claim in a
    token can grant it."""
    _link("aditya.demo@demo.veye.test", "google-uid-aditya")
    token = mint(signing_key, firebase={"sign_in_provider": "password", "sign_in_second_factor": "totp"})
    refused = TestClient(app).post("/api/v1/auth/admin/identity/sign-in", json={"id_token": token})
    assert refused.status_code == 403
    assert "administrator access" in refused.json()["detail"]


def test_the_console_refuses_a_token_with_no_second_factor(admin_client, identity_runtime, signing_key):
    _link("cara.hogue@demo.veye.test", "google-uid-cara")
    without = mint(signing_key, sub="google-uid-cara", email="cara.hogue@demo.veye.test",
                   firebase={"sign_in_provider": "password"})
    refused = TestClient(app).post("/api/v1/auth/admin/identity/sign-in", json={"id_token": without})
    assert refused.status_code == 403
    assert "second factor" in refused.json()["detail"]

    with_totp = mint(signing_key, sub="google-uid-cara", email="cara.hogue@demo.veye.test",
                     firebase={"sign_in_provider": "password", "sign_in_second_factor": "totp"})
    allowed = TestClient(app).post("/api/v1/auth/admin/identity/sign-in", json={"id_token": with_totp})
    assert allowed.status_code == 200, allowed.text


def test_an_identity_nobody_has_an_account_for_is_refused_and_creates_nothing(identity_runtime, signing_key):
    """A token is not a sign-up. Members sign up through VEYE and
    administrator access is provisioned."""
    stranger = mint(signing_key, sub="google-uid-stranger", email="stranger@demo.veye.test")
    refused = TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": stranger})
    assert refused.status_code == 401
    db = SessionLocal()
    try:
        assert db.query(UserAccount).filter(UserAccount.email == "stranger@demo.veye.test").one_or_none() is None
    finally:
        db.close()


def test_first_sign_in_links_a_verified_address_but_an_unverified_one_never_does(identity_runtime, signing_key):
    client = TestClient(app)
    assert sign_up(client, email="linkme@demo.veye.test", first_name="Link").status_code == 201

    unverified = mint(signing_key, sub="google-uid-unverified", email="linkme@demo.veye.test", email_verified=False)
    assert TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": unverified}).status_code == 401

    verified = mint(signing_key, sub="google-uid-link", email="linkme@demo.veye.test", email_verified=True)
    linked = TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": verified})
    assert linked.status_code == 200, linked.text

    db = SessionLocal()
    try:
        user = db.query(UserAccount).filter(UserAccount.email == "linkme@demo.veye.test").one()
        assert user.identity_subject == "google-uid-link"
        assert user.identity_linked_at is not None
    finally:
        db.close()

    # A second Google identity cannot claim an account that is already linked.
    other = mint(signing_key, sub="google-uid-impostor", email="linkme@demo.veye.test", email_verified=True)
    assert TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": other}).status_code == 401


def test_a_deactivated_account_cannot_sign_in_with_a_perfectly_good_token(identity_runtime, signing_key):
    client = TestClient(app)
    assert sign_up(client, email="switchedoff@demo.veye.test", first_name="Off").status_code == 201
    _link("switchedoff@demo.veye.test", "google-uid-off")
    db = SessionLocal()
    try:
        user = db.query(UserAccount).filter(UserAccount.email == "switchedoff@demo.veye.test").one()
        user.is_active = False
        db.commit()
    finally:
        db.close()
    token = mint(signing_key, sub="google-uid-off", email="switchedoff@demo.veye.test")
    assert TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": token}).status_code == 401


def test_every_refusal_says_the_same_thing(identity_runtime, signing_key):
    """Expired, forged, unknown and wrong-audience must not be distinguishable
    from outside — a refusal is not a lookup service."""
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    tokens = [
        mint(signing_key, exp=int(time.time()) - 60),
        mint(other_key),
        mint(signing_key, sub="google-uid-nobody", email="nobody@demo.veye.test"),
        mint(signing_key, aud="another-project"),
    ]
    answers = [TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": t}) for t in tokens]
    assert {a.status_code for a in answers} == {401}
    assert len({a.json()["detail"] for a in answers}) == 1


def test_the_development_provider_has_no_verifier_and_refuses_token_sign_in(signing_key):
    """Default deployment: there is no token to verify, and saying so is better
    than pretending the route does not exist."""
    before = get_runtime()
    configure_runtime(identity=None)
    try:
        answer = TestClient(app).post("/api/v1/auth/identity/sign-in", json={"id_token": mint(signing_key)})
        assert answer.status_code == 409
    finally:
        configure_runtime(identity=before.identity)
