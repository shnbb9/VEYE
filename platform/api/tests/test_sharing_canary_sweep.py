"""A member who has not shared, looked for in every console answer there is.

`test_health_permission.py` asserts this thoroughly for the four surfaces it
names — the Home feed, Insights, the Assessments index and Member 360. Those
are the surfaces that existed when it was written. A new console route that
reads a health table and forgets `_apply_sharing` would not appear in any of
them, and CLAUDE.md records that gating one screen and not another is exactly
how this went wrong once already.

So this does not name surfaces. It plants values nothing else in the system
would produce — a diary description, a mood note, two laboratory figures, a
weight — and then reads **every GET route the console serves**, asserting that
none of them comes back anywhere. Adding a console route puts it in this sweep
automatically.

The same sweep then runs with the permission granted, which has to find the
canaries: otherwise an application that simply stored nothing would pass.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.route_table import ADMIN_GUARD, SAFE_METHODS, concrete, routes

# Strings and figures that could not arise from the seed, a default, or any
# other member. Short enough to survive a truncated excerpt.
DIARY_CANARY = "zzqqx-diary-canary"
MOOD_CANARY = "zzqqx-mood-canary"
TG_CANARY = 137.137          # triglycerides, a value nobody would type twice
WEIGHT_CANARY = 177.177      # lb
CANARIES = (DIARY_CANARY, MOOD_CANARY, "137.137", "177.177")

ADMIN_READS = [r for r in routes() if ADMIN_GUARD in r["guards"] and r["method"] in SAFE_METHODS]

MEMBER_EMAIL = "canary.sweep@demo.veye.test"
MEMBER_PASSWORD = "CanarySweep!2026-local"

HEALTH_NUMBER_ANSWERS = {
    "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
    "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes",
    "tired": "no", "gainWeight": "no", "abdomenWeight": "no",
    "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
    "diet": "No preference", "source": "Friends or Family",
}


def _member_with_every_health_slice() -> TestClient:
    """One member carrying a record in each slice the permission covers."""
    http = TestClient(app)
    http.__enter__()
    created = http.post("/api/v1/auth/sign-up", json={
        "email": MEMBER_EMAIL, "first_name": "Canary", "last_name": "Sweep", "password": MEMBER_PASSWORD})
    assert created.status_code == 201, created.text

    saved = http.post("/api/v1/health-number/calculate", json={"answers": HEALTH_NUMBER_ANSWERS})
    assert saved.status_code in (200, 201), saved.text

    markers = http.post("/api/v1/blood-markers/calculate", json={"input": {"tg": TG_CANARY, "hdl": 50}})
    assert markers.status_code in (200, 201), markers.text

    day = "2026-11-14"
    mood = http.put("/api/v1/members/me/mood", params={"today": day},
                    json={"entry_date": day, "mood": "calm", "note": MOOD_CANARY})
    assert mood.status_code == 200, mood.text

    diary = http.post("/api/v1/members/me/food-diary",
                      json={"entry_date": day, "meal_time": "08:00", "description": DIARY_CANARY})
    assert diary.status_code == 201, diary.text
    return http


def _sweep(admin_client, member_id: str) -> tuple[dict[str, list[str]], int]:
    """Every canary found, and where, plus how many routes actually answered.

    `member_id` is substituted for the member parameter, so the per-member
    routes — Member 360 and its tabs, where these records would appear — are
    really addressed. Filling it with a sample UUID made every one of them 404
    and the sweep look clean while reading nothing: the positive control below
    is what caught that.
    """
    found: dict[str, list[str]] = {canary: [] for canary in CANARIES}
    answered = 0
    for row in ADMIN_READS:
        path = concrete(row["path"].replace("{member_id}", member_id))
        response = admin_client.get(path)
        if response.status_code >= 400:
            continue          # not reachable with these ids; nothing to leak
        answered += 1
        body = response.text
        for canary in CANARIES:
            if canary in body:
                found[canary].append(f"{row['path']} ({response.status_code})")
    return {canary: where for canary, where in found.items() if where}, answered


def test_the_route_table_was_read():
    assert len(ADMIN_READS) > 25, len(ADMIN_READS)


def test_the_member_really_stored_all_of_it(admin_client):
    """Otherwise the sweep below would pass on an application that stores
    nothing, which is the failure mode this test exists to rule out."""
    member = _member_with_every_health_slice()
    try:
        assert "137.137" in member.get("/api/v1/members/me/blood-markers").text
        assert MOOD_CANARY in member.get("/api/v1/members/me/mood", params={"today": "2026-11-14"}).text
        assert DIARY_CANARY in member.get("/api/v1/members/me/food-diary", params={"date": "2026-11-14"}).text
        assert member.get("/api/v1/members/me/health-number").json()["history"], "no Health Number stored"
    finally:
        member.__exit__(None, None, None)


def test_no_console_route_returns_the_records_of_a_member_who_has_not_shared(admin_client):
    member = _member_with_every_health_slice()
    try:
        member_id = member.get("/api/v1/auth/me").json()["member"]["member_id"]
        state = member.get("/api/v1/members/me/health-permission").json()
        assert state["state"] == "not_requested", state
        leaked, answered = _sweep(admin_client, member_id)
        assert answered > 20, f"only {answered} console routes answered — the sweep is not reading enough to mean anything"
        assert leaked == {}, (
            "console routes returned the records of a member whose Health Data Sharing Permission "
            "has never been granted:" + "".join(
                f"\n  {canary!r} in {', '.join(where)}" for canary, where in leaked.items())
        )
    finally:
        member.__exit__(None, None, None)


def test_the_sweep_can_actually_see_the_records_once_the_member_shares(admin_client):
    """The other half of the claim. A sweep that found nothing either way would
    be measuring its own selectors, not the permission."""
    member = _member_with_every_health_slice()
    try:
        member_id = member.get("/api/v1/auth/me").json()["member"]["member_id"]
        asked = admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request", json={})
        assert asked.status_code in (200, 201), asked.text
        granted = member.post("/api/v1/members/me/health-permission/grant", json={})
        assert granted.status_code in (200, 201), granted.text

        visible, answered = _sweep(admin_client, member_id)
        assert answered > 20, answered
        assert visible, (
            "with the permission granted the sweep still found nothing — it is not looking anywhere, "
            "which would make the test above vacuous"
        )
    finally:
        member.__exit__(None, None, None)
