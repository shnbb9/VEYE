import os
import shutil

os.environ["VEYE_DATABASE_URL"] = "sqlite:///./test-veye.db"
os.environ["VEYE_ENVIRONMENT"] = "test"
os.environ["VEYE_EMAIL_PROVIDER"] = "memory"
os.environ["VEYE_LLM_PROVIDER"] = "mock"
# Whatever a developer has in their own .env: no test uses their credentials.
os.environ.update({"VEYE_EMBEDDING_PROVIDER": "hashing", "VEYE_EMBEDDING_DIMENSIONS": "256", "VEYE_GEMINI_BACKEND": "", "VEYE_GEMINI_API_KEY": "",
                   "VEYE_GEMINI_MEMBER_DATA_CLEARED": "false", "VEYE_GCP_PROJECT": "", "VEYE_GROQ_API_KEY": "",
                   "NO_GCE_CHECK": "true"})     # nor looks for a machine of Google's to be on
os.environ["VEYE_KNOWLEDGE_OBJECT_ROOT"] = "./var/test-knowledge-objects"
# Member photos and the erasure ledger: their own root, emptied after every
# test, instead of the development media folder.
os.environ["VEYE_MEDIA_OBJECT_ROOT"] = "./var/test-media-objects"
os.environ["VEYE_LANGFUSE_ENABLED"] = "false"
os.environ["VEYE_WEB_BASE_URL"] = "http://web.test"

import pytest
from fastapi.testclient import TestClient

from app.core.runtime import get_runtime, reset_runtime
from app.db.base import Base
from app.db.session import engine
from app.main import app

# ---- the test client behaves like the browser client -------------------------
# lib/api.ts adds the CSRF token to every state-changing call automatically, so
# a TestClient that did not would be testing a client nobody ships. Patching
# the class covers the suite's many direct TestClient(app) constructions; a
# test that wants to prove enforcement passes its own X-Veye-Csrf header and
# this leaves it alone (see test_csrf_and_headers.py).
from app.auth.csrf import CSRF_COOKIE, CSRF_HEADER, SAFE_METHODS  # noqa: E402

_request_without_csrf = TestClient.request


def _request_with_csrf(self, method, url, *args, headers=None, **kwargs):
    if str(method).upper() not in SAFE_METHODS:
        explicit = headers is not None and any(key.lower() == CSRF_HEADER for key in headers)
        token = self.cookies.get(CSRF_COOKIE)
        if token and not explicit:
            headers = {**(headers or {}), "X-Veye-Csrf": token}
    return _request_without_csrf(self, method, url, *args, headers=headers, **kwargs)


TestClient.request = _request_with_csrf

MEMBER_PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    reset_runtime()
    yield
    Base.metadata.drop_all(bind=engine)
    reset_runtime()
    shutil.rmtree("./var/test-knowledge-objects", ignore_errors=True)
    shutil.rmtree("./var/test-media-objects", ignore_errors=True)


OUTSIDE = ("googleapis.com", "google.internal", "groq.com", "langfuse.com")


@pytest.fixture(autouse=True)
def nothing_reaches_an_outside_service(monkeypatch):
    """A double that is forgotten becomes a real request, with whatever
    credentials this machine has. Stopped where a name is looked up, and said
    at the end even if the code under test swallowed it."""
    import socket

    asked: list[str] = []
    look_up = socket.getaddrinfo

    def guarded(host, *args, **kwargs):
        name = (host.decode() if isinstance(host, bytes) else str(host or "")).rstrip(".").lower()
        if name.endswith(OUTSIDE):
            asked.append(name)
            raise OSError(f"a test tried to reach {name}")
        return look_up(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", guarded)
    yield
    assert asked == [], "a test tried to reach an outside service"


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mailbox():
    """The in-memory EmailProvider the test runtime is built with."""
    return get_runtime().email


def sign_up(client: TestClient, *, email="aditya.demo@demo.veye.test", first_name="Aditya", last_name="Demo",
            password=MEMBER_PASSWORD, **extra):
    payload = {"first_name": first_name, "last_name": last_name, "email": email, "password": password, **extra}
    return client.post("/api/v1/auth/sign-up", json=payload)


def sign_in(client: TestClient, email: str, password: str = MEMBER_PASSWORD, remember: bool = True):
    """MEMBER portal sign-in."""
    return client.post("/api/v1/auth/sign-in", json={"email": email, "password": password, "remember": remember})


def verify_member_email(client: TestClient) -> None:
    """Use the verification link the sign-up emailed, as the member would."""
    import re

    account = client.get("/api/v1/auth/me").json()["member"]
    if account is None or account["email_verified"]:
        return
    sent = [m for m in get_runtime().email.sent if m.to == account["email"] and "verify-email?token=" in m.text]
    assert sent, f"no verification email for {account['email']}"
    token = re.search(r"verify-email\?token=([A-Za-z0-9_\-]+)", sent[-1].text).group(1)
    verified = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verified.status_code == 200, verified.text


def decide_sharing(client: TestClient, decision: str = "grant", **extra):
    """Grant or decline Health Data Sharing the way the app does: a verified
    address, and the decision sent with the terms it was made against."""
    verify_member_email(client)
    terms = client.get("/api/v1/members/me/health-permission").json()["terms"]
    return client.post(f"/api/v1/members/me/health-permission/{decision}",
                       json={"terms_version": terms["version"], "terms_hash": terms["hash"], **extra})


def turn_on_sprout(client: TestClient):
    """Switch Sprout personalization on the way the app does: the member's
    other choice, with its own words and its own route."""
    verify_member_email(client)
    terms = client.get("/api/v1/members/me/sprout-permission").json()["terms"]
    return client.post("/api/v1/members/me/sprout-permission/grant",
                       json={"terms_version": terms["version"], "terms_hash": terms["hash"]})


def admin_sign_in(client: TestClient, email: str, password: str, remember: bool = True):
    """ADMIN portal sign-in."""
    return client.post("/api/v1/auth/admin/sign-in", json={"email": email, "password": password, "remember": remember})


def me(client: TestClient) -> dict:
    """Both portal sessions on this client: {"member": …|None, "admin": …|None}."""
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def member_client(client):
    response = sign_up(client)
    assert response.status_code == 201, response.text
    client.account = response.json()["account"]
    return client


@pytest.fixture
def admin_client():
    from app.seed.users import ensure_admin

    ensure_admin()
    with TestClient(app) as admin:
        response = admin_sign_in(admin, "cara.hogue@demo.veye.test", "CaraAdmin!2026-local")
        assert response.status_code == 200, response.text
        admin.account = response.json()["account"]
        yield admin
