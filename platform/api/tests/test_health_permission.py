"""Health Data Sharing Permission.

The point of these tests is that the console is not *shown* less — it is
*sent* less. Every assertion below reads the API's own answer, because a
screen that hides a field it was given has not protected anything.
"""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from app.health_permission.models import POLICY_VERSION
from app.main import app
from tests.conftest import MEMBER_PASSWORD, sign_up

GRANT = "/api/v1/members/me/health-permission/grant"
DECLINE = "/api/v1/members/me/health-permission/decline"
REVOKE = "/api/v1/members/me/health-permission/revoke"
MINE = "/api/v1/members/me/health-permission"


def _member_id(admin_client, email: str) -> str:
    page = admin_client.get("/api/v1/admin/members", params={"q": email}).json()
    assert page["rows"], f"no member row for {email}"
    return page["rows"][0]["member_id"]


def _save_a_health_number(member_client) -> None:
    """A real saved result, so there is something to withhold. A fresh member
    has none, and an empty history proves nothing about a permission."""
    answers = {
        "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
        "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes",
        "tired": "no", "gainWeight": "no", "abdomenWeight": "no",
        "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
        "diet": "No preference", "source": "Friends or Family",
    }
    saved = member_client.post("/api/v1/health-number/calculate", json={"answers": answers})
    assert saved.status_code in (200, 201), saved.text


def test_a_member_starts_not_requested_and_nothing_is_shared(member_client, admin_client):
    mine = member_client.get(MINE)
    assert mine.status_code == 200
    body = mine.json()
    assert body["state"] == "not_requested"
    assert body["shares_health_data"] is False
    # The words the member will be asked to agree to travel with the state.
    assert body["current_policy_version"] == POLICY_VERSION
    assert "withdraw" in body["explanation"].lower()
    # Nothing has been decided, so no version is recorded against them yet.
    assert body["policy_version"] == ""


def test_the_console_is_sent_no_health_records_until_the_member_shares(member_client, admin_client):
    _save_a_health_number(member_client)
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    withheld = admin_client.get(f"/api/v1/admin/members/{member_id}").json()
    assert withheld["shares_health_data"] is False
    assert withheld["sharing_state"] == "not_requested"
    for slice_name in ("health_number", "body_composition", "blood_markers",
                       "health_assessment", "simple_quiz", "mood_entries", "food_diary"):
        assert withheld[slice_name] == [], f"{slice_name} was sent without permission"
    assert withheld["food_diary_days"] == 0
    # The summary figure on the profile row is the same record as the history,
    # and was once withheld in the list but not here. One rule, both screens.
    assert withheld["profile"]["health_number"] is None
    assert withheld["profile"]["health_number_status"] is None
    assert withheld["profile"]["health_number_at"] is None
    assert withheld["profile"]["shares_health_data"] is False
    # Basic identity is NOT locked: the team still has to be able to answer them.
    assert withheld["profile"]["email"] == "aditya.demo@demo.veye.test"
    assert withheld["profile"]["name"]
    assert withheld["account"]["email"] == "aditya.demo@demo.veye.test"
    assert withheld["requests"] == [] or isinstance(withheld["requests"], list)

    assert member_client.post(GRANT).status_code == 200
    shared = admin_client.get(f"/api/v1/admin/members/{member_id}").json()
    assert shared["shares_health_data"] is True
    assert shared["sharing_state"] == "granted"
    assert len(shared["health_number"]) >= 1, "a granted member's saved results should be visible"
    assert shared["profile"]["health_number"] is not None


def test_withdrawing_re_locks_the_records_on_the_very_next_request(member_client, admin_client):
    _save_a_health_number(member_client)
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    assert member_client.post(GRANT).status_code == 200
    assert len(admin_client.get(f"/api/v1/admin/members/{member_id}").json()["health_number"]) >= 1

    assert member_client.post(REVOKE).status_code == 200
    after = admin_client.get(f"/api/v1/admin/members/{member_id}").json()
    assert after["shares_health_data"] is False
    assert after["sharing_state"] == "revoked"
    assert after["health_number"] == []
    assert after["mood_entries"] == []


def test_declining_shares_nothing_and_is_not_the_same_as_never_being_asked(member_client, admin_client):
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request").status_code == 200
    requested = member_client.get(MINE).json()
    assert requested["state"] == "requested"
    assert requested["shares_health_data"] is False
    assert requested["requested_by_name"]

    declined = member_client.post(DECLINE)
    assert declined.status_code == 200
    assert declined.json()["state"] == "declined"
    assert admin_client.get(f"/api/v1/admin/members/{member_id}").json()["health_number"] == []


def test_the_console_can_ask_but_can_never_decide(member_client, admin_client):
    """The asymmetry is the whole design: there is no admin route that sets a
    member's permission, and the member's own routes refuse an admin session."""
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request").status_code == 200

    # No admin route grants. The member's routes are member-only.
    for path in (GRANT, DECLINE, REVOKE):
        assert admin_client.post(path).status_code == 401, f"{path} accepted an admin session"
    paths = [p for p in app.openapi()["paths"] if "health-permission" in p]
    admin_paths = [p for p in paths if p.startswith("/api/v1/admin")]
    assert sorted(admin_paths) == [
        "/api/v1/admin/members/{member_id}/health-permission",
        "/api/v1/admin/members/{member_id}/health-permission/request",
    ], "the console gained a route that can decide for a member"


def test_asking_again_after_a_refusal_is_allowed_but_asking_a_sharer_is_not(member_client, admin_client):
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    assert member_client.post(DECLINE).status_code == 200
    assert admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request").status_code == 200

    assert member_client.post(GRANT).status_code == 200
    again = admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request")
    assert again.status_code == 409


def test_nothing_to_withdraw_is_refused_rather_than_silently_accepted(member_client):
    assert member_client.post(REVOKE).status_code == 409
    assert member_client.post(DECLINE).status_code == 200
    assert member_client.post(REVOKE).status_code == 409


def test_every_transition_is_kept_as_evidence_with_its_wording_and_source(member_client, admin_client):
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    admin_client.post(f"/api/v1/admin/members/{member_id}/health-permission/request")
    member_client.post(GRANT)
    member_client.post(REVOKE)

    events = member_client.get(MINE).json()["events"]
    assert [e["to_state"] for e in events] == ["requested", "granted", "revoked"]
    assert [e["actor"] for e in events] == ["administrator", "member", "member"]
    # A permission is never granted by replying to an email: the source says
    # where each decision was actually made.
    assert [e["source"] for e in events] == ["admin_console", "member_app", "member_app"]
    assert all(e["policy_version"] == POLICY_VERSION for e in events)
    assert all(e["actor_name"] for e in events)
    # The console sees the same evidence.
    theirs = admin_client.get(f"/api/v1/admin/members/{member_id}/health-permission").json()
    assert len(theirs["events"]) == 3


def test_the_members_list_withholds_the_health_number_and_says_why(member_client, admin_client):
    _save_a_health_number(member_client)
    page = admin_client.get("/api/v1/admin/members", params={"q": "aditya.demo@demo.veye.test"}).json()
    row = page["rows"][0]
    assert row["health_number"] is None
    assert row["shares_health_data"] is False
    assert row["sharing_label"]

    assert member_client.post(GRANT).status_code == 200
    row = admin_client.get("/api/v1/admin/members", params={"q": "aditya.demo@demo.veye.test"}).json()["rows"][0]
    assert row["health_number"] is not None
    assert row["shares_health_data"] is True


def test_sorting_by_health_number_cannot_leak_one_that_was_withheld(admin_client):
    """A withheld figure must not come back through an ordering."""
    page = admin_client.get("/api/v1/admin/members",
                            params={"sort": "health_number", "direction": "desc", "page_size": 100}).json()
    for row in page["rows"]:
        if not row["shares_health_data"]:
            assert row["health_number"] is None
            assert row["health_number_at"] is None
            assert row["health_number_status"] is None


def test_the_attempts_screen_is_not_a_way_around_member_360(member_client, admin_client):
    _save_a_health_number(member_client)
    before = admin_client.get("/api/v1/admin/assessments/health_number/attempts").json()
    assert all(r["member_id"] != _member_id(admin_client, "aditya.demo@demo.veye.test") for r in before["rows"])

    assert member_client.post(GRANT).status_code == 200
    after = admin_client.get("/api/v1/admin/assessments/health_number/attempts").json()
    assert any(r["member_id"] == _member_id(admin_client, "aditya.demo@demo.veye.test") for r in after["rows"])


def test_one_members_permission_never_opens_another_members_records(member_client, admin_client):
    """Cross-member isolation: sharing is per member, and granting is not a
    global switch."""
    other = TestClient(app)
    assert sign_up(other, email="private@demo.veye.test", first_name="Private").status_code == 201

    assert member_client.post(GRANT).status_code == 200
    private_id = _member_id(admin_client, "private@demo.veye.test")
    assert admin_client.get(f"/api/v1/admin/members/{private_id}").json()["shares_health_data"] is False
    assert admin_client.get(f"/api/v1/admin/members/{private_id}").json()["health_number"] == []
    # And the other member's own view is their own.
    assert other.get(MINE).json()["state"] == "not_requested"


def test_a_member_can_only_ever_read_and_change_their_own_permission(member_client):
    """There is no member route that takes someone else's id, so there is
    nothing to attempt — the absence is the guarantee."""
    member_paths = [p for p in app.openapi()["paths"]
                    if "health-permission" in p and p.startswith("/api/v1/members")]
    assert all("{" not in p for p in member_paths), "a member route accepts an id from the client"


def test_looking_at_a_members_records_is_audited_without_copying_them(member_client, admin_client):
    member_id = _member_id(admin_client, "aditya.demo@demo.veye.test")
    admin_client.get(f"/api/v1/admin/members/{member_id}")          # withheld
    assert member_client.post(GRANT).status_code == 200
    admin_client.get(f"/api/v1/admin/members/{member_id}")          # viewed

    audit = admin_client.get("/api/v1/admin/companion/advanced/audit", params={"limit": 200}).json()["rows"]
    health = [e for e in audit if e["action"] in ("health.viewed", "health.withheld")
              and e["entity_id"] == member_id]
    assert {e["action"] for e in health} == {"health.viewed", "health.withheld"}
    for entry in health:
        assert entry["actor_name"], "an audit entry must name the administrator"
        assert entry["entity_type"] == "member"
        assert entry["created_at"]
        assert "permission" in entry["details"]
        # The values themselves are not copied into the log.
        body = str(entry["details"]).lower()
        for leak in ("score", "displayed", "mood", "marker", "meal"):
            assert leak not in body


def test_an_unauthenticated_caller_gets_nothing_from_either_half(client):
    assert client.get(MINE).status_code == 401
    assert client.post(GRANT).status_code == 401
    assert client.get("/api/v1/admin/members/00000000-0000-0000-0000-000000000000/health-permission").status_code == 401


def test_the_member_facing_words_never_call_it_a_hipaa_authorization(member_client):
    """A legal term with legal consequences, and no counsel has approved it."""
    body = member_client.get(MINE).json()
    text = f"{body['explanation']} {body['state_label']}".lower()
    assert "hipaa" not in text
    assert "authorization" not in text
    assert "authorisation" not in text


def test_a_members_export_carries_what_they_were_given_as_well_as_what_they_entered(member_client, admin_client):
    """The export promises "everything the member has entered or been given".
    An answer Veye sent them, and their own sharing decisions, are both part of
    that — the console's internal note and the delivery result are not."""
    sent = member_client.post("/api/v1/members/me/requests",
                              json={"kind": "contact_us", "subject": "A question", "message": "Is my history kept?"})
    request_id = sent.json()["id"]
    assert admin_client.post(f"/api/v1/admin/requests/{request_id}/reply",
                             json={"body": "Yes, every result is kept."}).status_code == 200
    assert admin_client.post(f"/api/v1/admin/requests/{request_id}/status",
                             json={"status": "resolved", "resolution_note": "Internal only."}).status_code == 200
    assert member_client.post(GRANT).status_code == 200
    assert member_client.post(REVOKE).status_code == 200

    export = member_client.get("/api/v1/members/me/export").json()
    thread = [r for r in export["requests"] if r["subject"] == "A question"][0]
    assert [reply["body"] for reply in thread["replies"]] == ["Yes, every result is kept."]
    assert "resolution_note" not in thread
    for reply in thread["replies"]:
        assert set(reply) == {"body", "created_at"}

    sharing = export["health_data_sharing"]
    assert sharing["state"] == "revoked"
    assert [e["to_state"] for e in sharing["history"]] == ["granted", "revoked"]
    assert all(e["policy_version"] == POLICY_VERSION for e in sharing["history"])

    # The export is still the member's own data and nothing else.
    assert "password_hash" not in str(export)
    assert "token" not in str(export).lower()


# ---- the gate across every admin analytics surface --------------------------
# Member 360 and the members list were gated first. An independent review found
# the aggregate surfaces were not, and the Home feed was the worst of them: it
# pairs a member's name with their health result outright.

def _overview(admin_client):
    return admin_client.get("/api/v1/admin/overview").json()


def _insights(admin_client):
    return admin_client.get("/api/v1/admin/insights").json()


def test_a_member_who_has_not_shared_is_absent_from_every_admin_health_surface(member_client, admin_client):
    _save_a_health_number(member_client)
    today = date.today().isoformat()
    member_client.put("/api/v1/members/me/mood", params={"today": today},
                      json={"entry_date": today, "mood": "calm"})
    member_client.post("/api/v1/members/me/food-diary",
                       json={"entry_date": today, "meal_time": "08:00", "description": "Porridge"})

    overview = _overview(admin_client)
    # 1. Not named beside a health result in the Home feed.
    health_kinds = {"health_number", "body_composition", "blood_markers", "health_assessment", "simple_quiz"}
    named = [row for row in overview["recent_activity"] if row["kind"] in health_kinds]
    assert named == [], "a member who has not shared appeared in the named health feed"
    # 2. Not counted in protected totals.
    assert overview["completions"]["health_number"] == 0
    assert overview["members_completed"]["health_number"] == 0
    assert overview["mood_entries_total"] == 0
    assert overview["food_diary_entries_total"] == 0

    insights = _insights(admin_client)
    assert insights["attempts"]["health_number"] == 0
    assert insights["members_completed"]["health_number"] == 0
    # _by_month returns zero-filled buckets rather than an empty list, so the
    # claim is that every bucket is empty, not that the series is.
    assert all(bucket["count"] == 0 for bucket in insights["attempts_by_month"]["health_number"])
    assert insights["mood_entries"] == 0 and insights["mood_members"] == 0
    assert insights["food_diary_entries"] == 0 and insights["food_diary_members"] == 0

    # 3. Not counted on the Assessments index.
    instruments = {i["key"]: i for i in admin_client.get("/api/v1/admin/assessments").json()}
    assert instruments["health_number"]["attempts_total"] == 0
    assert instruments["health_number"]["members_scored"] == 0
    assert instruments["health_number"]["last_completed_at"] is None

    # 4. Non-health figures are untouched — they carry no health content.
    assert insights["members_total"] >= 1
    assert overview["members_total"] >= 1


def test_granting_includes_them_at_once_and_revoking_removes_them_again(member_client, admin_client):
    _save_a_health_number(member_client)
    today = date.today().isoformat()
    member_client.put("/api/v1/members/me/mood", params={"today": today},
                      json={"entry_date": today, "mood": "calm"})

    assert _overview(admin_client)["completions"]["health_number"] == 0
    assert member_client.post(GRANT).status_code == 200

    after = _overview(admin_client)
    assert after["completions"]["health_number"] >= 1
    assert any(row["kind"] == "health_number" for row in after["recent_activity"])
    assert _insights(admin_client)["mood_entries"] >= 1
    assert {i["key"]: i for i in admin_client.get("/api/v1/admin/assessments").json()}["health_number"]["attempts_total"] >= 1

    assert member_client.post(REVOKE).status_code == 200
    back = _overview(admin_client)
    assert back["completions"]["health_number"] == 0
    assert not any(row["kind"] == "health_number" for row in back["recent_activity"])
    assert _insights(admin_client)["mood_entries"] == 0


def test_one_member_sharing_does_not_expose_another_in_the_aggregates(member_client, admin_client):
    """An aggregate is not a safe harbour: a total over a population of two
    tells you about the one who did not share."""
    from fastapi.testclient import TestClient

    from app.main import app
    from tests.conftest import sign_up

    _save_a_health_number(member_client)
    assert member_client.post(GRANT).status_code == 200

    quiet = TestClient(app)
    assert sign_up(quiet, email="quiet@demo.veye.test", first_name="Quiet").status_code == 201
    _save_a_health_number(quiet)

    insights = _insights(admin_client)
    # Exactly one member's results are counted, not two.
    assert insights["members_completed"]["health_number"] == 1
    quiet_id = _member_id(admin_client, "quiet@demo.veye.test")
    assert all(row["member_id"] != quiet_id for row in _overview(admin_client)["recent_activity"]
               if row["kind"] == "health_number")
