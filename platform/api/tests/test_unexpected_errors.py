"""What a person and their browser are told when something breaks.

With the database stopped, sign-in answered a bare 500 from outside the CORS
layer; the browser could not read it and the page said "Failed to fetch"
(found 25 Nov 2026 by stopping PostgreSQL)."""

import logging

import pytest
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.db.session import get_db
from app.main import app

ORIGIN = settings.cors_origin_list[0]


@pytest.fixture
def breaking(client):
    """Every route's database session fails the way it is told to."""
    def broken(exc):
        def _get_db():
            raise exc
            yield  # pragma: no cover
        app.dependency_overrides[get_db] = _get_db
        return client
    kept = dict(app.dependency_overrides)
    yield broken
    app.dependency_overrides.clear()
    app.dependency_overrides.update(kept)


def _sign_in(client):
    return client.post("/api/v1/auth/sign-in", json={"email": "somebody@demo.veye.test", "password": "not-a-real-password"},
                       headers={"Origin": ORIGIN})


def test_a_database_that_is_away_is_a_503_in_words_that_the_browser_can_read(breaking):
    response = _sign_in(breaking(OperationalError("SELECT secret_column FROM user_accounts", {}, Exception("connection refused to db:5432"))))
    assert response.status_code == 503 and response.headers["Retry-After"] == "5"
    assert response.json() == {"detail": "Veye is not available right now. Please try again in a moment."}
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"


def test_anything_else_is_a_500_in_words_and_the_reason_stays_in_the_log(breaking, caplog):
    with caplog.at_level(logging.ERROR, logger="veye.api"):
        response = _sign_in(breaking(RuntimeError("the password column was renamed")))
    assert response.status_code == 500
    assert response.json() == {"detail": "Something went wrong on our side. Please try again in a moment."}
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert "password column" not in response.text
    assert "unhandled error on POST /api/v1/auth/sign-in" in caplog.text
    assert "not-a-real-password" not in caplog.text


def test_an_unexpected_answer_still_carries_the_safety_headers(breaking):
    response = _sign_in(breaking(RuntimeError("x")))
    assert response.headers["X-Content-Type-Options"] == "nosniff" and response.headers["X-Frame-Options"] == "DENY"
