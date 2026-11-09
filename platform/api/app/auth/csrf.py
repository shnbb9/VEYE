"""Cross-site request forgery protection.

Sessions here are cookies, so a page on another origin can make the browser
send them. `SameSite=Lax` stops the obvious cases and the CORS allow-list
stops scripted ones, but neither is a guarantee: Lax still permits top-level
form posts, and a CORS mistake would be silent.

So every state-changing request must also carry a value the attacker's page
cannot read — the double-submit pattern. The API sets `veye_csrf`, readable
by the browser on purpose, and the client echoes it in `X-Veye-Csrf`. A
cross-site page can make the browser SEND the cookie but cannot READ it, so
it cannot produce the header.

Deliberately not covered:
  * safe methods (GET/HEAD/OPTIONS), which change nothing;
  * requests with no session cookie at all — sign-in, sign-up, the single-use
    token links — because there is no session to ride on, and demanding a
    token there would only break the first page someone ever loads.
"""

from __future__ import annotations

import hmac
import secrets

from fastapi import HTTPException, Request, Response

CSRF_COOKIE = "veye_csrf"
CSRF_HEADER = "x-veye-csrf"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def issue(response: Response, request: Request, *, secure: bool) -> str:
    """Give this browser a token if it does not already have one. Readable by
    script by design: the client has to be able to echo it."""
    existing = request.cookies.get(CSRF_COOKIE)
    token = existing or secrets.token_urlsafe(32)
    if not existing:
        response.set_cookie(CSRF_COOKIE, token, httponly=False, samesite="lax",
                            secure=secure, path="/", max_age=60 * 60 * 24 * 30)
    return token


def enforce(request: Request, session_cookie_names: tuple[str, ...]) -> None:
    """Refuse a state-changing request that carries a session but no matching
    token. Raises 403; never says which cookie was found."""
    if request.method.upper() in SAFE_METHODS:
        return
    if not any(name in request.cookies for name in session_cookie_names):
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status_code=403, detail="This request could not be verified. Reload the page and try again.")
