"""Google Cloud Identity Platform: authentication only.

The division of labour this module exists to keep:

    Identity Platform  ->  proves who the person is (password, MFA, recovery)
    VEYE FastAPI       ->  decides what they may do (member_id, admin_access,
                           portal isolation, session revocation, audit)

So a verified token is never a session and never an authorization. It is one
fact — "Google says this is subject X, and a second factor was or was not
used" — which `AuthService` then maps onto a VEYE account that already exists.
A token cannot create an account, cannot grant administrator access and cannot
reach a portal the account is not entitled to. Every guard that protects the
console today keeps protecting it afterwards.

Nothing here talks to Google Cloud except to fetch public signing keys, so the
whole module is provable on a developer machine against a throwaway key.

PHI never goes into an Identity Platform custom claim: the token carries a
subject and an email address, and every health fact stays in VEYE's database.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

import jwt
from jwt import PyJWKClient

log = logging.getLogger("veye.identity")

# Identity Platform signs with RS256. Pinning it is the point: accepting the
# token's own idea of its algorithm is how "alg: none" and HMAC-with-the-public-key
# forgeries get in.
ALGORITHMS = ["RS256"]
ISSUER_TEMPLATE = "https://securetoken.google.com/{project}"


class IdentityError(Exception):
    """A token that cannot be trusted. Deliberately carries a developer-facing
    reason; the sign-in route answers the browser with one fixed wording so a
    caller cannot learn which check failed."""


@dataclass(frozen=True)
class VerifiedIdentity:
    """What a trusted token actually tells us — nothing more."""

    subject: str
    email: str | None
    email_verified: bool
    second_factor: str | None
    sign_in_provider: str | None
    tenant: str | None
    auth_time: datetime | None

    @property
    def has_second_factor(self) -> bool:
        return bool(self.second_factor)


class IdentityVerifier(Protocol):
    name: str

    def verify(self, id_token: str) -> VerifiedIdentity: ...

    def describe(self) -> dict[str, object]: ...


class GoogleIdentityPlatformVerifier:
    """Verifies an Identity Platform ID token offline against Google's
    published signing keys.

    `key_resolver` exists for tests, which mint tokens with a throwaway RSA key
    rather than reaching Google. It is the only seam: every claim check below
    runs identically in a test and in production.
    """

    name = "identity-platform"

    def __init__(self, *, project_id: str, tenant_id: str | None = None,
                 jwks_url: str | None = None, leeway_seconds: int = 30, key_resolver=None) -> None:
        if not project_id:
            raise IdentityError("VEYE_IDENTITY_PROJECT_ID is required for the identity-platform auth provider.")
        self.project_id = project_id
        self.tenant_id = tenant_id or None
        self.issuer = ISSUER_TEMPLATE.format(project=project_id)
        self.leeway_seconds = int(leeway_seconds)
        self._jwks_url = jwks_url
        self._key_resolver = key_resolver
        self._jwk_client: PyJWKClient | None = None

    # ---- keys ---------------------------------------------------------------
    def _signing_key(self, id_token: str):
        if self._key_resolver is not None:
            return self._key_resolver(id_token)
        if self._jwk_client is None:
            if not self._jwks_url:
                raise IdentityError("No JWKS endpoint is configured for the identity provider.")
            # Google rotates these keys; the client caches them and refetches.
            self._jwk_client = PyJWKClient(self._jwks_url, cache_keys=True, lifespan=3600)
        return self._jwk_client.get_signing_key_from_jwt(id_token).key

    # ---- verification -------------------------------------------------------
    def verify(self, id_token: str) -> VerifiedIdentity:
        if not id_token or not isinstance(id_token, str):
            raise IdentityError("No ID token was presented.")
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise IdentityError(f"Malformed ID token: {type(exc).__name__}") from exc
        if header.get("alg") not in ALGORITHMS:
            raise IdentityError(f"Unexpected signing algorithm {header.get('alg')!r}.")

        try:
            key = self._signing_key(id_token)
            claims = jwt.decode(
                id_token, key, algorithms=ALGORITHMS,
                audience=self.project_id, issuer=self.issuer,
                leeway=self.leeway_seconds,
                options={"require": ["exp", "iat", "aud", "iss", "sub"], "verify_signature": True},
            )
        except jwt.PyJWTError as exc:
            raise IdentityError(f"ID token rejected: {type(exc).__name__}") from exc

        subject = str(claims.get("sub") or "").strip()
        if not subject:
            raise IdentityError("ID token carries no subject.")

        firebase = claims.get("firebase") or {}
        if not isinstance(firebase, dict):
            firebase = {}
        tenant = firebase.get("tenant") or None
        # A token minted for another tenant is a token for another deployment.
        if (self.tenant_id or None) != (tenant or None):
            raise IdentityError("ID token belongs to a different Identity Platform tenant.")

        auth_time = _timestamp(claims.get("auth_time"))
        if auth_time is not None and auth_time > datetime.now(timezone.utc) + timedelta(seconds=self.leeway_seconds):
            raise IdentityError("ID token claims it was authenticated in the future.")

        return VerifiedIdentity(
            subject=subject,
            email=(str(claims["email"]).strip().lower() if claims.get("email") else None),
            email_verified=bool(claims.get("email_verified")),
            second_factor=(str(firebase.get("sign_in_second_factor")) if firebase.get("sign_in_second_factor") else None),
            sign_in_provider=(str(firebase.get("sign_in_provider")) if firebase.get("sign_in_provider") else None),
            tenant=tenant,
            auth_time=auth_time,
        )

    def describe(self) -> dict[str, object]:
        return {
            "provider": self.name,
            "project": self.project_id,
            "tenant": self.tenant_id or "(default)",
            "algorithms": ",".join(ALGORITHMS),
            "keys": "google jwks" if self._key_resolver is None else "injected (test)",
        }


def _timestamp(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError):
        return None


def second_factor_accepted(identity: VerifiedIdentity, *, required: bool, accepted: frozenset[str]) -> bool:
    """Whether this sign-in satisfies the console's MFA rule.

    Kept apart from the token checks because it is a VEYE policy decision, not
    a fact about the token: the deployment says which factors it trusts, and
    the default is TOTP. SMS is never implied — a deployment that wants
    "phone" has to name it, because an SMS-only second factor is barely a
    second factor against the people who target an administrator console.
    """
    if not required:
        return True
    factor = (identity.second_factor or "").strip().lower()
    return bool(factor) and factor in accepted


def build_identity_verifier(settings) -> IdentityVerifier | None:
    """None for the development provider — there is no token to verify."""
    if settings.auth_provider == "development":
        return None
    if settings.auth_provider == "identity-platform":
        return GoogleIdentityPlatformVerifier(
            project_id=settings.identity_project_id or "",
            tenant_id=settings.identity_tenant_id,
            jwks_url=settings.identity_jwks_url,
            leeway_seconds=settings.identity_clock_leeway_seconds,
        )
    raise IdentityError(
        f"Auth provider '{settings.auth_provider}' is not implemented. "
        "Use 'development' or 'identity-platform'."
    )
