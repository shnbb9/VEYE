import os
import shutil

os.environ["VEYE_DATABASE_URL"] = "sqlite:///./test-veye.db"
os.environ["VEYE_ENVIRONMENT"] = "test"
os.environ["VEYE_EMAIL_PROVIDER"] = "memory"
os.environ["VEYE_LLM_PROVIDER"] = "mock"
os.environ["VEYE_KNOWLEDGE_OBJECT_ROOT"] = "./var/test-knowledge-objects"
os.environ["VEYE_LANGFUSE_ENABLED"] = "false"
os.environ["VEYE_WEB_BASE_URL"] = "http://web.test"

import pytest
from fastapi.testclient import TestClient

from app.core.runtime import get_runtime, reset_runtime
from app.db.base import Base
from app.db.session import engine
from app.main import app

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
    return client.post("/api/v1/auth/sign-in", json={"email": email, "password": password, "remember": remember})


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
        response = sign_in(admin, "cara.hogue@demo.veye.test", "CaraAdmin!2026-local")
        assert response.status_code == 200, response.text
        admin.account = response.json()["account"]
        yield admin
