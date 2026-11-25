"""The console changes Cara confirmed on 25 Nov 2026: health sharing in the
directory, trends, archiving, questions needing attention, retention and
started-but-unfinished assessments — and what each must not reveal."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.admin.models import AdminAuditEntry
from app.admin.retention import retention
from app.assessments.models import HealthNumberAttempt
from app.companion.models import CompanionConversation
from app.db.session import SessionLocal
from app.main import app
from app.members.activity import MemberActivityDay, record_activity
from app.members.models import Member
from app.progress.starts import AssessmentStart
from tests.conftest import admin_sign_in, decide_sharing, me, sign_in, sign_up, verify_member_email

MEMBERS = "/api/v1/admin/members"
ANSWERS = {"goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"], "activity": "Moderate (I exercise 1-3 times a week)",
           "meditate": "yes", "tired": "no", "gainWeight": "no", "abdomenWeight": "no", "sleepEnough": "yes", "sleepWell": "yes",
           "sleepHours": 7, "diet": "No preference", "source": "Friends or Family"}


def member(email="trend.one@demo.veye.test", first="Trend"):
    http = TestClient(app)
    assert sign_up(http, email=email, first_name=first, last_name="Person").status_code == 201
    http.member_id = me(http)["member"]["member_id"]
    return http


def quiz(http):
    saved = http.post("/api/v1/health-number/calculate", json={"answers": ANSWERS})
    assert saved.status_code in (200, 201), saved.text


def results(http, *rows):
    """(score, days ago, version) — one real attempt copied and dated."""
    quiz(http)
    with SessionLocal() as db:
        base = db.query(HealthNumberAttempt).filter(HealthNumberAttempt.member_id == UUID(http.member_id)).one()
        fields = {c.name: getattr(base, c.name) for c in HealthNumberAttempt.__table__.columns if c.name not in ("id", "completed_at", "created_at")}
        db.delete(base)
        for score, ago, version in rows:
            at = datetime.now(timezone.utc) - timedelta(days=ago)
            db.add(HealthNumberAttempt(**{**fields, "displayed_score": score, "calculation_version": version, "completed_at": at}))
        db.commit()


def row_for(admin, http, **params):
    rows = admin.get(MEMBERS, params=params).json()["rows"]
    return next((r for r in rows if r["member_id"] == http.member_id), None)


# ---- health sharing in the directory -------------------------------------------------

def test_the_directory_names_every_sharing_state_and_filters_by_it(admin_client):
    people = {state: member(f"share.{state}@demo.veye.test") for state in ("asked", "shared", "declined", "revoked", "never")}
    for http in people.values():
        verify_member_email(http)
    admin_client.post(f"{MEMBERS}/{people['asked'].member_id}/health-permission/request", json={})
    decide_sharing(people["shared"])
    decide_sharing(people["declined"], "decline")
    decide_sharing(people["revoked"])
    people["revoked"].post("/api/v1/members/me/health-permission/revoke")
    expected = {"asked": ("requested", "Requested"), "shared": ("granted", "Shared"), "declined": ("declined", "Declined"),
                "revoked": ("revoked", "Revoked"), "never": ("not_requested", "Not requested")}
    for name, (state, label) in expected.items():
        row = row_for(admin_client, people[name])
        assert (row["sharing_state"], row["sharing_label"]) == (state, label)
        listed = admin_client.get(MEMBERS, params={"sharing": state}).json()
        assert people[name].member_id in [r["member_id"] for r in listed["rows"]]
        assert all(r["sharing_state"] == state for r in listed["rows"])


def test_nothing_about_a_record_can_be_read_or_inferred_without_permission(admin_client):
    http = member()
    results(http, (3.0, 1, "1.5.0"), (7.5, 40, "1.5.0"))
    row = row_for(admin_client, http)
    assert row["health_number"] is None and row["trackers_completed"] is None
    assert row["trend"] == {"state": "not_shared", "delta": None, "current": None, "previous": None, "current_at": None, "previous_at": None}
    # No filter finds them by their result either.
    for params in ({"trend": "improved"}, {"result_within": 30}, {"sort": "trend"}, {"sort": "health_number", "direction": "desc"}):
        answer = admin_client.get(MEMBERS, params=params)
        mine = [r for r in answer.json()["rows"] if r["member_id"] == http.member_id]
        assert all(r["trend"]["state"] == "not_shared" for r in mine)
        if "sort" not in params:
            assert mine == []
    assert "7.5" not in admin_client.get(MEMBERS).text


# ---- trends -----------------------------------------------------------------------------

@pytest.mark.parametrize("rows,state,delta", [
    ([(3.0, 1, "1.5.0"), (4.5, 30, "1.5.0")], "improved", -1.5),
    ([(6.5, 1, "1.5.0"), (6.0, 30, "1.5.0")], "worsened", 0.5),
    ([(4.0, 1, "1.5.0"), (4.0, 30, "1.5.0")], "unchanged", 0.0),
    ([(4.0, 1, "1.5.0")], "first", None),
    ([(4.0, 1, "1.5.0"), (6.0, 30, "1.4.0")], "not_comparable", None),
    ([(4.0, 1, "1.5.0"), (6.0, 30, "1.5.0"), (2.0, 60, "1.5.0")], "improved", -2.0),
])
def test_a_trend_is_the_latest_two_results_and_lower_is_better(admin_client, rows, state, delta):
    http = member()
    results(http, *rows)
    decide_sharing(http)
    trend = row_for(admin_client, http)["trend"]
    assert trend["state"] == state and trend["delta"] == delta and trend["current"] == rows[0][0]
    found = admin_client.get(MEMBERS, params={"trend": state}).json()
    assert [r["member_id"] for r in found["rows"]] == [http.member_id] and found["trends"][state] == 1


def test_withdrawing_closes_the_trend_on_the_next_request(admin_client):
    http = member()
    results(http, (3.0, 1, "1.5.0"), (4.5, 30, "1.5.0"))
    decide_sharing(http)
    assert row_for(admin_client, http)["trend"]["state"] == "improved"
    http.post("/api/v1/members/me/health-permission/revoke")
    assert row_for(admin_client, http)["trend"]["state"] == "not_shared"
    assert admin_client.get(f"{MEMBERS}/{http.member_id}").json()["profile"]["trend"]["state"] == "not_shared"


def test_the_time_range_is_about_the_latest_result(admin_client):
    recent, old = member("recent@demo.veye.test"), member("old@demo.veye.test")
    results(recent, (3.0, 5, "1.5.0"), (4.0, 200, "1.5.0"))
    results(old, (3.0, 100, "1.5.0"), (4.0, 200, "1.5.0"))
    for http in (recent, old):
        decide_sharing(http)
    ids = lambda days: {r["member_id"] for r in admin_client.get(MEMBERS, params={"result_within": days}).json()["rows"]}
    assert ids(30) == {recent.member_id} and ids(365) == {recent.member_id, old.member_id}


def test_members_with_nothing_to_sort_by_are_last_both_ways_and_paging_loses_nobody(admin_client):
    for i in range(5):
        member(f"page.{i}@demo.veye.test", first="Same")
    shared = member("shared.page@demo.veye.test")
    results(shared, (3.0, 1, "1.5.0"), (4.0, 9, "1.5.0"))
    decide_sharing(shared)
    for direction in ("asc", "desc"):
        first = admin_client.get(MEMBERS, params={"sort": "trend", "direction": direction}).json()["rows"][0]
        assert first["member_id"] == shared.member_id
        seen = []
        for page in (1, 2, 3):
            seen += [r["member_id"] for r in admin_client.get(MEMBERS, params={"sort": "name", "direction": direction, "page": page, "page_size": 2}).json()["rows"]]
        assert len(seen) == len(set(seen)) == 6


# ---- unfinished --------------------------------------------------------------------------

def test_people_who_started_and_did_not_finish_are_three_different_groups(admin_client):
    unverified, verified, done = member("u@demo.veye.test"), member("v@demo.veye.test"), member("d@demo.veye.test")
    verify_member_email(verified)
    verify_member_email(done)
    quiz(done)
    segments = admin_client.get(MEMBERS).json()["segments"]
    assert segments == {"prospects": 0, "unverified": 1, "onboarding_incomplete": 1, "invitations_pending": 0, "archived": 0}
    admin_client.post("/api/v1/admin/member-invitations", json={"email": "waiting@demo.veye.test"})
    assert admin_client.get(MEMBERS).json()["segments"]["invitations_pending"] == 1


# ---- archive ------------------------------------------------------------------------------

def test_archiving_closes_the_member_door_and_every_total_and_restoring_reopens_it(admin_client):
    http = member()
    results(http, (3.0, 1, "1.5.0"), (4.0, 9, "1.5.0"))
    decide_sharing(http)
    before = admin_client.get("/api/v1/admin/overview").json()["members_total"]
    done = admin_client.post(f"{MEMBERS}/{http.member_id}/archive", json={"reason": "  Moved   away "})
    assert done.status_code == 200 and done.json()["archive_reason"] == "Moved away"

    assert http.get("/api/v1/members/me/health-number").status_code == 401, "signed out at once"
    refused = sign_in(TestClient(app), "trend.one@demo.veye.test")
    assert refused.status_code == 403 and "archived" in refused.json()["detail"]
    assert row_for(admin_client, http) is None
    only = admin_client.get(MEMBERS, params={"archived": "only"}).json()["rows"]
    assert [r["member_id"] for r in only] == [http.member_id] and only[0]["health_number"] is None
    assert row_for(admin_client, http, archived="include") is not None
    assert admin_client.get("/api/v1/admin/overview").json()["members_total"] == before - 1
    view = admin_client.get(f"{MEMBERS}/{http.member_id}").json()
    assert view["shares_health_data"] is False and view["health_number"] == [] and view["profile"]["archived_by"] == "Cara Hogue"
    assert admin_client.get("/api/v1/admin/assessments/health_number/attempts").json()["total"] == 0
    assert admin_client.post(f"{MEMBERS}/{http.member_id}/archive", json={}).status_code == 409

    assert admin_client.post(f"{MEMBERS}/{http.member_id}/restore").status_code == 200
    assert sign_in(http, "trend.one@demo.veye.test").status_code == 200
    assert row_for(admin_client, http)["health_number"] == 3.0, "their own decision applies again"
    assert admin_client.post(f"{MEMBERS}/{http.member_id}/restore").status_code == 409


def test_a_session_that_outlived_the_archiving_opens_nothing():
    """Archiving ends sessions; the guard also refuses one it did not know of."""
    http = member()
    assert http.get("/api/v1/members/me/health-number").status_code == 200
    with SessionLocal() as db:
        db.get(Member, UUID(http.member_id)).archived_at = datetime.now(timezone.utc)
        db.commit()
    assert http.get("/api/v1/members/me/health-number").status_code == 401
    assert me(http)["member"] is None


def test_restoring_never_revives_a_permission_the_member_withdrew(admin_client):
    http = member()
    decide_sharing(http)
    http.post("/api/v1/members/me/health-permission/revoke")
    admin_client.post(f"{MEMBERS}/{http.member_id}/archive", json={})
    admin_client.post(f"{MEMBERS}/{http.member_id}/restore")
    assert row_for(admin_client, http)["sharing_state"] == "revoked"


def test_archiving_a_person_who_also_has_the_console_leaves_the_console(admin_client):
    made = admin_client.post("/api/v1/admin/account/member-profile", json={"password": "CaraAdmin!2026-local", "understood": True})
    assert made.status_code == 201
    member_id = made.json()["member_id"]
    assert admin_client.post(f"{MEMBERS}/{member_id}/archive", json={}).status_code == 200
    assert me(admin_client)["admin"]["email"] == "cara.hogue@demo.veye.test"
    assert admin_sign_in(TestClient(app), "cara.hogue@demo.veye.test", "CaraAdmin!2026-local").status_code == 200
    assert sign_in(TestClient(app), "cara.hogue@demo.veye.test", "CaraAdmin!2026-local").status_code == 403


def test_archiving_is_recorded_and_belongs_to_administrators(admin_client):
    http = member()
    assert http.post(f"{MEMBERS}/{http.member_id}/archive", json={}).status_code == 401
    admin_client.post(f"{MEMBERS}/{http.member_id}/archive", json={})
    admin_client.post(f"{MEMBERS}/{http.member_id}/restore")
    with SessionLocal() as db:
        actions = sorted(a for (a,) in db.query(AdminAuditEntry.action).filter(AdminAuditEntry.entity_id == http.member_id))
    assert actions == ["member.archived", "member.restored"]


# ---- the food diary is the team's to see (Cara, 25 Nov 2026) -------------------------------

def test_the_food_diary_is_visible_without_permission_and_the_mood_is_not(admin_client):
    http = member()
    day = date.today().isoformat()
    http.post("/api/v1/members/me/food-diary", json={"entry_date": day, "meal_time": "08:00", "description": "Oat porridge"})
    http.put("/api/v1/members/me/mood", params={"today": day}, json={"entry_date": day, "mood": "calm", "note": "private note"})
    view = admin_client.get(f"{MEMBERS}/{http.member_id}").json()
    assert view["shares_health_data"] is False
    assert [m["description"] for m in view["food_diary"]] == ["Oat porridge"] and view["food_diary_days"] == 1
    assert view["mood_entries"] == [] and "private note" not in str(view)
    terms = http.get("/api/v1/members/me/health-permission").json()["terms"]
    assert not any("diary" in c.lower() for c in terms["categories"])
    assert "food diary" in terms["not_covered"], "the words a member reads say so"


# ---- needs your attention --------------------------------------------------------------------

def ask(http, text="How do I log a meal?"):
    sent = http.post("/api/v1/members/me/requests", json={"kind": "help_question", "subject": "Logging", "message": text})
    assert sent.status_code == 201, sent.text
    return sent.json()["id"]


def attention(admin, **params):
    return admin.get("/api/v1/admin/attention", params=params).json()


def test_answered_reviewed_and_resolved_are_different_things(admin_client):
    http = member()
    request_id = ask(http)
    with SessionLocal() as db:
        talk = CompanionConversation(member_id=UUID(http.member_id), flagged=True, flag_reason="Handed to a person", message_count=2)
        db.add(talk)
        db.commit()
        talk_id = str(talk.id)
    states = lambda: {(r["source"], r["state"]) for r in attention(admin_client, state="all")["rows"]}
    assert states() == {("request", "reply_needed"), ("conversation", "review_needed")}
    home = admin_client.get("/api/v1/admin/overview").json()
    assert (home["questions_awaiting_reply"], home["attention_waiting"]) == (1, 2)

    # Moving the status answers nobody.
    admin_client.post(f"/api/v1/admin/requests/{request_id}/status", json={"status": "in_progress"})
    assert ("request", "reply_needed") in states()
    admin_client.post(f"/api/v1/admin/requests/{request_id}/reply", json={"body": "Open Food Diary and press Add Entry."})
    assert ("request", "replied") in states()
    admin_client.post(f"/api/v1/admin/companion/conversations/{talk_id}/review", json={"note": None})
    assert ("conversation", "reviewed") in states()
    assert attention(admin_client)["total"] == 0 and attention(admin_client, state="reviewed")["total"] == 1

    admin_client.post(f"/api/v1/admin/requests/{request_id}/status", json={"status": "resolved"})
    admin_client.post(f"/api/v1/admin/companion/conversations/{talk_id}/resolve")
    assert states() == {("request", "resolved"), ("conversation", "resolved")}
    admin_client.post(f"/api/v1/admin/companion/conversations/{talk_id}/reopen")
    assert ("conversation", "reviewed") in states()


def test_a_reply_that_never_left_is_not_an_answer(admin_client, mailbox, monkeypatch):
    from app.notifications.email import DeliveryResult

    http = member()
    request_id = ask(http)
    monkeypatch.setattr(type(mailbox), "send", lambda self, message: DeliveryResult(accepted=False, provider="memory", error="refused"))
    admin_client.post(f"/api/v1/admin/requests/{request_id}/reply", json={"body": "An answer nobody received."})
    assert [r["state"] for r in attention(admin_client)["rows"]] == ["reply_failed"]
    waiting = admin_client.get("/api/v1/admin/requests", params={"view": "awaiting_reply"}).json()
    assert [r["id"] for r in waiting["rows"]] == [request_id] and waiting["rows"][0]["reply_state"] == "failed"


def test_a_conversation_handed_over_again_is_waiting_again(admin_client):
    handed = "My doctor said I might need medication for my blood sugar, what do you think?"
    http = member()
    first = http.post("/api/v1/companion/messages", json={"message": handed})
    assert first.status_code == 201 and first.json()["outcome"] == "escalated", first.text
    (conversation,) = admin_client.get("/api/v1/admin/companion/conversations", params={"filter": "needs_review"}).json()
    talk = conversation["id"]
    admin_client.post(f"/api/v1/admin/companion/conversations/{talk}/resolve")
    assert attention(admin_client)["total"] == 0
    http.post("/api/v1/companion/messages", json={"message": handed, "conversation_id": talk})
    assert attention(admin_client)["counts"]["review_needed"] == 1


def test_importance_is_set_by_a_person_ordered_and_recorded(admin_client):
    http = member()
    low, plain, high = ask(http, "first question"), ask(http, "second question"), ask(http, "third question")
    for request_id, value in ((low, "low"), (high, "high")):
        assert admin_client.put(f"/api/v1/admin/requests/{request_id}/priority", json={"priority": value}).json()["priority"] == value
    assert [r["id"] for r in attention(admin_client)["rows"]] == [high, plain, low]
    assert [r["id"] for r in admin_client.get("/api/v1/admin/requests", params={"view": "awaiting_reply"}).json()["rows"]] == [high, plain, low]
    assert [r["id"] for r in attention(admin_client, priority="unassigned")["rows"]] == [plain]
    assert admin_client.put(f"/api/v1/admin/requests/{high}/priority", json={"priority": "urgent"}).status_code == 422
    assert admin_client.put(f"/api/v1/admin/requests/{high}/priority", json={"priority": None}).json()["priority"] is None
    with SessionLocal() as db:
        details = [d for (d,) in db.query(AdminAuditEntry.details).filter(AdminAuditEntry.action == "requests.priority_set", AdminAuditEntry.entity_id == high)]
    assert {"from": "", "to": "high"} in details and {"from": "high", "to": ""} in details
    # A member never sees it.
    assert "priority" not in http.get("/api/v1/members/me/requests").text


def test_attention_tells_members_from_visitors_and_leaves_out_the_archived(admin_client):
    http = member()
    ask(http)
    TestClient(app).post("/api/v1/requests", json={"kind": "contact_us", "name": "Visitor", "email": "v@example.com", "message": "Hello there"})
    assert {r["person_kind"] for r in attention(admin_client)["rows"]} == {"member", "visitor"}
    assert [r["person_kind"] for r in attention(admin_client, who="visitor")["rows"]] == ["visitor"]
    admin_client.post(f"{MEMBERS}/{http.member_id}/archive", json={})
    assert [r["person_kind"] for r in attention(admin_client)["rows"]] == ["visitor"]
    assert http.get("/api/v1/admin/attention").status_code == 401


# ---- retention ----------------------------------------------------------------------------------

def joined(http, ago: int, *active: int):
    today = datetime.now(timezone.utc).date()
    with SessionLocal() as db:
        db.get(Member, UUID(http.member_id)).created_at = datetime.now(timezone.utc) - timedelta(days=ago)
        for days in active:
            record_activity(db, UUID(http.member_id), today - timedelta(days=days))
        db.commit()


def test_opening_the_app_counts_once_a_day_and_holds_nothing_else(client):
    sign_up(client)
    for _ in range(3):
        assert client.post("/api/v1/members/me/activity").status_code == 204
    with SessionLocal() as db:
        rows = db.query(MemberActivityDay).all()
    assert len(rows) == 1 and rows[0].day == datetime.now(timezone.utc).date()
    assert set(MemberActivityDay.__table__.columns.keys()) == {"id", "member_id", "day"}


def test_nothing_is_measured_before_anything_was_recorded(admin_client):
    member()
    r = admin_client.get("/api/v1/admin/insights").json()["retention"]
    assert r["recorded_since"] is None and r["inactive"] is None and r["engagement_members"] == 0 and r["engagement_median_days"] is None
    assert all(rate["eligible"] == 0 for rate in r["returned"])


def test_retention_is_exactly_its_definition():
    # joined 60 days ago; seen on days 0, 3 and 45 after joining
    stayed = member("stay@demo.veye.test")
    joined(stayed, 60, 60, 57, 15)
    left = member("left@demo.veye.test")       # only ever the first day
    joined(left, 40, 40)
    late = member("late@demo.veye.test")       # came back, but on day 12
    joined(late, 40, 40, 28)
    new = member("new@demo.veye.test")         # joined three days ago, back yesterday
    joined(new, 3, 3, 1)
    before = member("before@demo.veye.test")   # joined before recording began
    joined(before, 200, 2)
    with SessionLocal() as db:
        r = retention(db)
    assert r.recorded_since == datetime.now(timezone.utc).date() - timedelta(days=60) and r.members == 5
    assert (r.joined_last_30_days, r.active_last_7_days, r.active_last_30_days, r.inactive) == (1, 2, 4, 1)
    assert [(x.days, x.eligible, x.returned) for x in r.returned] == [(7, 3, 1), (30, 3, 2)]
    assert r.not_measured == 1
    assert r.engagement_members == 3 and r.engagement_median_days == 12
    assert {b.label: b.members for b in r.engagement if b.members} == {"Only the first day": 1, "1–2 weeks": 1, "1–2 months": 1}


def test_archived_members_are_out_of_retention(admin_client):
    http = member()
    joined(http, 40, 40, 2)
    assert admin_client.get("/api/v1/admin/insights").json()["retention"]["members"] == 1
    admin_client.post(f"{MEMBERS}/{http.member_id}/archive", json={})
    r = admin_client.get("/api/v1/admin/insights").json()["retention"]
    assert r["members"] == 0 and r["active_last_30_days"] == 0 and r["engagement_members"] == 0


# ---- started and not finished ------------------------------------------------------------------

def instrument(admin, key="health_number"):
    return next(i for i in admin.get("/api/v1/admin/assessments").json() if i["key"] == key)


def start(http, key="health_number"):
    return http.post("/api/v1/members/me/assessment-starts", json={"instrument": key})


def age_starts(hours: int):
    with SessionLocal() as db:
        for row in db.query(AssessmentStart).all():
            row.started_at = datetime.now(timezone.utc) - timedelta(hours=hours)
        db.commit()


def test_a_start_is_finished_by_a_result_and_abandoned_without_one(admin_client):
    http = member()
    decide_sharing(http)
    assert start(http).status_code == 204 and start(http).status_code == 204
    with SessionLocal() as db:
        assert db.query(AssessmentStart).count() == 1, "reopening the same form is the same attempt"
    assert instrument(admin_client)["starts"] == 0, "a form open right now is not abandoned"
    age_starts(2)
    assert (instrument(admin_client)["starts"], instrument(admin_client)["starts_unfinished"]) == (1, 1)
    quiz(http)
    assert (instrument(admin_client)["starts"], instrument(admin_client)["starts_unfinished"]) == (1, 0)
    start(http)
    age_starts(0)
    with SessionLocal() as db:
        assert db.query(AssessmentStart).count() == 2, "starting again after a result is a new attempt"
    assert start(http, "not_an_instrument").status_code == 422


def test_unfinished_counts_only_members_who_share(admin_client):
    http, shares = member(), member("shares.start@demo.veye.test")
    decide_sharing(shares)
    start(http)
    age_starts(5)
    assert (instrument(admin_client)["starts"], instrument(admin_client)["starts_unfinished"]) == (0, 0)
    decide_sharing(http)
    assert instrument(admin_client)["starts_unfinished"] == 1


# ---- scales --------------------------------------------------------------------------------------

def test_the_charts_bands_are_the_scorings_own(client):
    from app.assessments.service import interpret_score
    from app.progress.blood_markers.service import in_range
    from app.progress.health_assessment.service import interpret_total

    assert client.get("/api/v1/progress-scales").status_code == 401
    sign_up(client)
    scales = client.get("/api/v1/progress-scales").json()
    for tenth in range(10, 101):
        value = tenth / 10
        band = next(b for b in scales["health_number"]["bands"] if value <= b["upto"])
        assert interpret_score(value, "food")[:2] == (band["bucket"], band["label"]), value
    for total in range(11, 34):
        band = next(b for b in scales["health_assessment"]["bands"] if total <= b["upto"])
        assert interpret_total(total)[:2] == (band["bucket"], band["label"]), total
    for goal in scales["blood_markers"]:
        assert in_range(goal["key"], (goal["low"] or 0) + 0.01)
        assert not in_range(goal["key"], goal["high"] + 0.01)
    assert [in_range("tg_hdl", 1), in_range("aa_epa", 1.5), in_range("aa_epa", 3), in_range("hba1c", 4.9), in_range("hba1c", 5.1), in_range("homa_ir", 1)] == [False, True, True, True, True, False]
