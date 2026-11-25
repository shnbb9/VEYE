"""Which address a limit counts. The one thing it must never be is whatever
the caller typed."""

import pytest
from starlette.requests import Request

from app.auth import throttle
from app.core import rate_limit
from app.core.config import settings


def request(forwarded=None, client="10.0.0.9"):
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (client, 1234)})


@pytest.mark.parametrize("hops,header,expected", [
    (0, "1.2.3.4", "10.0.0.9"),                       # no proxy of ours: only a caller could have written it
    (1, "198.51.100.7", "198.51.100.7"),
    (1, "1.2.3.4, 198.51.100.7", "198.51.100.7"),     # the first entry is the caller's own invention
    (1, "6.6.6.6, 7.7.7.7, 198.51.100.7", "198.51.100.7"),
    (2, "1.2.3.4, 198.51.100.7, 35.191.0.1", "198.51.100.7"),
    (1, None, "10.0.0.9"),
])
def test_only_what_our_own_proxies_wrote_is_believed(monkeypatch, hops, header, expected):
    monkeypatch.setattr(settings, "trusted_proxy_hops", hops)
    assert rate_limit.client_address(request(header)) == expected
    assert throttle.client_address is rate_limit.client_address


def test_inventing_addresses_does_not_reset_the_sign_in_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    codes = []
    for i in range(80):
        answer = client.post("/api/v1/auth/sign-in", json={"email": f"nobody{i}@demo.veye.test", "password": "wrong-password-here"},
                             headers={"X-Forwarded-For": f"203.0.113.{i}, 198.51.100.7"})
        codes.append(answer.status_code)
    assert 429 in codes, "eighty guesses from one address, each claiming to be someone new"
