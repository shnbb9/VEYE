"""One member's rows, addressed by another member — all of them.

Every member route reads `principal.member_id`, and a row id arriving from a
browser is only ever looked up *within* that member's rows. Where that holds,
another member's id is a 404: not a 403, which would confirm the row exists,
and certainly not a 200.

Individual slices already assert this for the food diary and for a Companion
conversation. This reads the live route table instead, so every member route
that takes a client-supplied reference has to be either probed here or named as
something else — a new one fails
`test_every_client_supplied_reference_is_accounted_for` on the day it is added.

`{member_ref}` is the other half: the five history routes take a member
reference, and `resolve_member_route` accepts the string `me` and nothing else,
so another member's real UUID must not read their history either.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.route_table import MEMBER_GUARD, OPTIONAL_GUARD, routes as _routes

ROW_REFERENCE_PARAMS = {"meal_id", "day_id", "message_id", "member_ref"}
# Path parameters that are not references to a stored row: a content group, a
# guided-flow key, a care kind, a calendar date. None of them can address
# another member's data, because the member is still taken from the session.
NON_REFERENCE_PARAMS = {"kind", "key", "entry_date", "group", "day", "scope_key"}

def _member_routes_with_params() -> list[tuple[str, str, set[str]]]:
    return sorted((row["method"], row["path"], row["params"]) for row in _routes()
                  if row["params"] and (MEMBER_GUARD in row["guards"] or OPTIONAL_GUARD in row["guards"]))


MEMBER_ROUTES_WITH_PARAMS = _member_routes_with_params()

# Every member route that takes a reference to a stored row, and the probe that
# covers it. "elsewhere" means an existing test already addresses it.
COVERED_HERE = {
    ("PUT", "/api/v1/members/me/meal-plans/days/{day_id}"),
    ("DELETE", "/api/v1/members/me/meal-plans/days/{day_id}"),
    ("POST", "/api/v1/members/me/meal-plans/days/{day_id}/assign"),
    ("POST", "/api/v1/members/me/meal-plans/days/{day_id}/duplicate"),
    ("POST", "/api/v1/companion/messages/{message_id}/feedback"),
    ("GET", "/api/v1/members/{member_ref}/blood-markers"),
    ("GET", "/api/v1/members/{member_ref}/body-composition"),
    ("GET", "/api/v1/members/{member_ref}/health-assessment"),
    ("GET", "/api/v1/members/{member_ref}/health-number"),
    ("GET", "/api/v1/members/{member_ref}/simple-quiz"),
}
COVERED_ELSEWHERE = {
    # test_phase1_beta.py::test_mood_and_diary_are_isolated_between_members
    ("PUT", "/api/v1/members/me/food-diary/{meal_id}"),
    ("DELETE", "/api/v1/members/me/food-diary/{meal_id}"),
}

MEMBER_PASSWORD = "IsolationProbe!2026-local"


def _member(email: str) -> TestClient:
    http = TestClient(app)
    http.__enter__()
    created = http.post("/api/v1/auth/sign-up", json={
        "email": email, "first_name": "Iso", "last_name": "Probe", "password": MEMBER_PASSWORD})
    assert created.status_code == 201, created.text
    http.member_id = created.json()["account"]["member_id"]
    return http


def test_the_route_table_was_actually_read():
    assert len(MEMBER_ROUTES_WITH_PARAMS) > 15, MEMBER_ROUTES_WITH_PARAMS


def test_every_client_supplied_reference_is_accounted_for():
    """A member route taking a row reference is a place another member's id
    could be tried. Each one is probed here, probed elsewhere, or is not a row
    reference at all — and saying which is the point."""
    unaccounted = []
    for method, path, params in MEMBER_ROUTES_WITH_PARAMS:
        references = params - NON_REFERENCE_PARAMS
        if not references:
            continue
        unknown = references - ROW_REFERENCE_PARAMS
        if unknown:
            unaccounted.append(f"{method} {path} — parameter(s) {sorted(unknown)} are neither declared "
                               "row references nor declared harmless")
        elif (method, path) not in COVERED_HERE | COVERED_ELSEWHERE:
            unaccounted.append(f"{method} {path} — takes {sorted(references)} and no isolation probe covers it")
    assert unaccounted == [], (
        "member routes take a client-supplied reference with nothing asserting that another member's id "
        "is refused:" + "".join("\n  " + line for line in unaccounted)
    )


def test_another_members_meal_plan_day_cannot_be_read_changed_or_removed():
    a = _member("iso.a@demo.veye.test")
    b = _member("iso.b@demo.veye.test")
    try:
        day = a.post("/api/v1/members/me/meal-plans/days", json={
            "name": "Monday", "notes": "", "describe": "", "mode": "manual",
            "meals": [{"name": "Porridge", "type": "Breakfast", "time": "08:00", "notes": ""}]})
        assert day.status_code in (200, 201), day.text
        day_id = day.json()["id"] if "id" in day.json() else day.json()["days"][0]["id"]

        # B's own list does not show it.
        theirs = b.get("/api/v1/members/me/meal-plans/days")
        assert theirs.status_code == 200, theirs.text
        body = theirs.json()
        rows = body["days"] if isinstance(body, dict) and "days" in body else body
        assert all(row["id"] != day_id for row in rows), rows

        # 404 on every route that takes the id — never 403, which would confirm it.
        # The PUT body has to be VALID, or the body validator answers 422 first
        # and the ownership check is never reached. (That ordering leaks
        # nothing: 422 depends on the body alone, never on whether the row
        # exists — asserted below.)
        refusals = {
            "PUT": b.put(f"/api/v1/members/me/meal-plans/days/{day_id}", json={
                "name": "Taken", "notes": "", "describe": "", "mode": "manual",
                "meals": [{"name": "Toast", "type": "Breakfast", "time": "07:00", "notes": ""}]}),
            "DELETE": b.delete(f"/api/v1/members/me/meal-plans/days/{day_id}"),
            "assign": b.post(f"/api/v1/members/me/meal-plans/days/{day_id}/assign", json={"date": "2026-11-16"}),
            "duplicate": b.post(f"/api/v1/members/me/meal-plans/days/{day_id}/duplicate", json={}),
        }
        for what, response in refusals.items():
            assert response.status_code == 404, f"{what} on another member's day -> {response.status_code}: {response.text[:120]}"

        # An invalid body answers 422 whether the day is the caller's or not,
        # so the ordering of validation and ownership tells an outsider nothing.
        empty = {"name": "x", "notes": "", "describe": "", "mode": "manual", "meals": []}
        assert b.put(f"/api/v1/members/me/meal-plans/days/{day_id}", json=empty).status_code == 422
        assert a.put(f"/api/v1/members/me/meal-plans/days/{day_id}", json=empty).status_code == 422
        import uuid as _uuid
        assert a.put(f"/api/v1/members/me/meal-plans/days/{_uuid.uuid4()}", json=empty).status_code == 422

        # And A's day is untouched by any of that.
        after = a.get("/api/v1/members/me/meal-plans/days").json()
        rows = after["days"] if isinstance(after, dict) and "days" in after else after
        mine = [row for row in rows if row["id"] == day_id]
        assert len(mine) == 1 and mine[0]["name"] == "Monday", rows
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_another_members_companion_message_cannot_be_given_feedback():
    a = _member("iso.c@demo.veye.test")
    b = _member("iso.d@demo.veye.test")
    try:
        sent = a.post("/api/v1/companion/messages", json={"message": "What should I eat today?"})
        assert sent.status_code == 201, sent.text
        # Feedback is left on Sprout's reply — what the console's Feedback
        # screen shows as "Sprout said".
        message_id = sent.json()["reply_message_id"]

        refused = b.post(f"/api/v1/companion/messages/{message_id}/feedback", json={"rating": "helpful"})
        assert refused.status_code == 404, f"feedback on another member's message -> {refused.status_code}: {refused.text[:160]}"

        # A can, so the 404 above is about ownership and not about the payload.
        mine = a.post(f"/api/v1/companion/messages/{message_id}/feedback", json={"rating": "helpful"})
        assert mine.status_code == 200, mine.text
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_the_only_member_reference_a_browser_may_use_is_me():
    """`resolve_member_route` takes the string `me` and nothing else, so a real
    member UUID — including the caller's own — reads nobody's history."""
    a = _member("iso.e@demo.veye.test")
    b = _member("iso.f@demo.veye.test")
    try:
        histories = ["blood-markers", "body-composition", "health-assessment", "health-number", "simple-quiz"]
        for slice_name in histories:
            assert a.get(f"/api/v1/members/me/{slice_name}").status_code == 200, slice_name
            # Another member's id.
            other = b.get(f"/api/v1/members/{a.member_id}/{slice_name}")
            assert other.status_code == 404, f"{slice_name} by another member's UUID -> {other.status_code}"
            # And the caller's OWN id is equally unavailable: only `me` works,
            # so nothing can be enumerated by trying ids at all.
            own = a.get(f"/api/v1/members/{a.member_id}/{slice_name}")
            assert own.status_code == 404, f"{slice_name} by the caller's own UUID -> {own.status_code}"
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)
