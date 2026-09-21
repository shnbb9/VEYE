"""Phase 1 local beta: Requests & Inbox, Mood Tracker, Food Diary, member
profile / photo / export, product settings, QA cleanup and their console
views. Every test drives the public API exactly as the browser does."""

from __future__ import annotations

import io
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import MEMBER_PASSWORD, admin_sign_in, sign_in, sign_up

PNG_1PX = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
           b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x01\x01\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82")


def _second_member(email="maya.demo@demo.veye.test", first="Maya"):
    other = TestClient(app)
    assert sign_up(other, email=email, first_name=first, last_name="Demo").status_code == 201
    return other


# ---------------------------------------------------------------- requests
def test_public_help_question_and_contact_land_in_the_console(client, admin_client):
    sent = client.post("/api/v1/requests", json={"kind": "help_question", "name": "Robert", "email": "robert@demo.veye.test",
                                                 "message": "Where can I update a blood marker?", "page": "/help"})
    assert sent.status_code == 201, sent.text
    assert sent.json()["status"] == "new"
    # too short / wrong kind are refused
    assert client.post("/api/v1/requests", json={"kind": "help_question", "message": "hi"}).status_code == 422
    assert client.post("/api/v1/requests", json={"kind": "join_beta", "message": "please"}).status_code == 422

    inbox = admin_client.get("/api/v1/admin/requests").json()
    assert inbox["total"] == 1 and inbox["counts"]["new"] == 1 and inbox["counts"]["open"] == 1
    row = inbox["rows"][0]
    assert row["kind_label"] == "Help question" and row["source"] == "public" and row["email"] == "robert@demo.veye.test"
    assert row["member_id"] is None


def test_member_requests_carry_the_account_identity_and_join_beta_is_single(member_client, admin_client):
    contact = member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "subject": "History question",
                                                                       "message": "Is my first Health Number kept?", "page": "/app"})
    assert contact.status_code == 201, contact.text
    beta = member_client.post("/api/v1/members/me/requests", json={"kind": "join_beta"})
    assert beta.status_code == 201 and beta.json()["already_open"] is False
    again = member_client.post("/api/v1/members/me/requests", json={"kind": "join_beta"})
    assert again.status_code == 201 and again.json()["already_open"] is True and again.json()["id"] == beta.json()["id"]
    assert member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "x"}).status_code == 422

    mine = member_client.get("/api/v1/members/me/requests").json()
    assert [r["kind"] for r in mine] == ["join_beta", "contact_us"]
    assert all(r["email"] == "aditya.demo@demo.veye.test" and r["name"] == "Aditya Demo" for r in mine)

    inbox = admin_client.get("/api/v1/admin/requests", params={"kind": "join_beta"}).json()
    assert inbox["total"] == 1 and inbox["rows"][0]["subject"] == "Beta application" and inbox["rows"][0]["source"] == "member"

    # lifecycle: in progress → resolved → reopened; every step audited
    request_id = contact.json()["id"]
    progressed = admin_client.post(f"/api/v1/admin/requests/{request_id}/status", json={"status": "in_progress"})
    assert progressed.status_code == 200 and progressed.json()["handled_by"] == "Cara Hogue"
    resolved = admin_client.post(f"/api/v1/admin/requests/{request_id}/status", json={"status": "resolved", "resolution_note": "Answered."})
    assert resolved.json()["status"] == "resolved" and resolved.json()["resolution_note"] == "Answered."
    assert admin_client.get("/api/v1/admin/requests", params={"view": "resolved"}).json()["total"] == 1
    assert admin_client.get("/api/v1/admin/requests", params={"view": "open"}).json()["total"] == 1
    reopened = admin_client.post(f"/api/v1/admin/requests/{request_id}/status", json={"status": "new"})
    assert reopened.json()["status"] == "new" and reopened.json()["handled_by"] is None
    # the member sees the current status, and the member portal cannot read the inbox
    assert [r["status"] for r in member_client.get("/api/v1/members/me/requests").json() if r["id"] == request_id] == ["new"]
    assert member_client.get("/api/v1/admin/requests").status_code == 401
    assert admin_client.get(f"/api/v1/admin/requests/{request_id}").json()["message"] == "Is my first Health Number kept?"
    assert admin_client.get("/api/v1/admin/overview").json()["requests_open"] == 2


# ---------------------------------------------------------------- mood
def test_mood_tracker_one_entry_per_day_with_client_balance_formula(member_client):
    today = date(2026, 9, 21)
    q = {"today": today.isoformat()}
    for days_ago, mood in ((2, "stressed"), (1, "neutral"), (0, "happy")):
        response = member_client.put("/api/v1/members/me/mood", params=q, json={"entry_date": (today - timedelta(days=days_ago)).isoformat(), "mood": mood})
        assert response.status_code == 200, response.text
    # same day again replaces the entry rather than adding one
    assert member_client.put("/api/v1/members/me/mood", params=q, json={"entry_date": today.isoformat(), "mood": "calm", "note": "Good walk"}).status_code == 200
    overview = member_client.get("/api/v1/members/me/mood", params=q).json()
    assert len(overview["entries"]) == 3 and overview["latest"]["mood"] == "calm" and overview["latest"]["note"] == "Good walk"
    stats = overview["stats"]
    assert stats["days_logged_this_month"] == 3 and stats["day_streak"] == 3
    # Balance: (0 + 50 + 100) / 3 = 50 — stressed 0, neutral 50, calm 100
    assert stats["balance_score"] == 50 and stats["balance_entries"] == 3
    assert stats["top_mood"] in {"stressed", "neutral", "calm"}
    # a future day and an unknown mood are refused; no entries → em-dash state (None)
    assert member_client.put("/api/v1/members/me/mood", params=q, json={"entry_date": (today + timedelta(days=1)).isoformat(), "mood": "happy"}).status_code == 422
    assert member_client.put("/api/v1/members/me/mood", params=q, json={"entry_date": today.isoformat(), "mood": "ecstatic"}).status_code == 422
    assert member_client.delete(f"/api/v1/members/me/mood/{today.isoformat()}").status_code == 204
    assert member_client.get("/api/v1/members/me/mood", params=q).json()["stats"]["day_streak"] == 0
    # streak broke, but the 30-day window still averages the two remaining entries: (0 + 50) / 2
    assert member_client.get("/api/v1/members/me/mood", params=q).json()["stats"]["balance_score"] == 25


def test_mood_and_diary_are_isolated_between_members(member_client):
    other = _second_member()
    today = date(2026, 9, 21).isoformat()
    assert member_client.put("/api/v1/members/me/mood", params={"today": today}, json={"entry_date": today, "mood": "happy"}).status_code == 200
    assert member_client.post("/api/v1/members/me/food-diary", json={"entry_date": today, "meal_time": "08:00", "description": "Eggs"}).status_code == 201
    theirs = other.get("/api/v1/members/me/mood", params={"today": today}).json()
    assert theirs["entries"] == [] and theirs["stats"]["balance_score"] is None
    assert other.get("/api/v1/members/me/food-diary", params={"date": today}).json()["meals"] == []
    meal_id = member_client.get("/api/v1/members/me/food-diary", params={"date": today}).json()["meals"][0]["id"]
    # another member cannot edit or remove it
    assert other.delete(f"/api/v1/members/me/food-diary/{meal_id}").status_code == 404
    assert other.put(f"/api/v1/members/me/food-diary/{meal_id}", json={"entry_date": today, "meal_time": "09:00", "description": "Hack"}).status_code == 404


# ---------------------------------------------------------------- food diary
def test_food_diary_day_entries_and_history(member_client):
    day = "2026-09-20"
    first = member_client.post("/api/v1/members/me/food-diary", json={"entry_date": day, "meal_time": "12:30", "description": "Grilled chicken salad",
                                                                       "feelings": ["Rushed", "Hungry"], "notes": "At the desk"})
    assert first.status_code == 201, first.text
    assert first.json()["meals"][0]["feelings"] == ["Hungry", "Rushed"]  # screen order, no duplicates
    assert member_client.post("/api/v1/members/me/food-diary", json={"entry_date": day, "meal_time": "07:45", "description": "Yoghurt"}).status_code == 201
    assert member_client.post("/api/v1/members/me/food-diary", json={"entry_date": day, "meal_time": "25:00", "description": "x"}).status_code == 422
    assert member_client.post("/api/v1/members/me/food-diary", json={"entry_date": day, "meal_time": "10:00", "description": "x", "feelings": ["Elated"]}).status_code == 422
    view = member_client.get("/api/v1/members/me/food-diary", params={"date": day}).json()
    assert [m["meal_time"] for m in view["meals"]] == ["07:45", "12:30"]  # a day reads in time order
    assert view["history"][0]["entry_date"] == day and view["history"][0]["meals"] == 2 and view["days_logged"] == 1
    assert "Hungry" in view["feelings"] and len(view["feelings"]) == 9
    meal = view["meals"][1]
    updated = member_client.put(f"/api/v1/members/me/food-diary/{meal['id']}", json={"entry_date": day, "meal_time": "12:45", "description": "Grilled chicken salad with avocado",
                                                                                     "feelings": ["Hungry"], "notes": ""})
    assert updated.status_code == 200 and updated.json()["meals"][1]["description"].endswith("avocado")
    removed = member_client.delete(f"/api/v1/members/me/food-diary/{meal['id']}")
    assert removed.status_code == 200 and len(removed.json()["meals"]) == 1
    # no nutritional figures are invented anywhere in the payload
    assert not any(key in removed.json()["meals"][0] for key in ("protein", "carbs", "fat", "kcal", "macros"))


# ---------------------------------------------------------------- profile / photo / export
def test_profile_edits_persist_and_reach_the_account_and_console(member_client, admin_client):
    saved = member_client.put("/api/v1/members/me/profile", json={"first_name": "Adi", "last_name": "Demo-Patel", "phone": "+1 555 0100", "postal_code": "94110"})
    assert saved.status_code == 200, saved.text
    me = member_client.get("/api/v1/auth/me").json()["member"]
    assert me["first_name"] == "Adi" and me["last_name"] == "Demo-Patel" and me["phone"] == "+1 555 0100" and me["postal_code"] == "94110"
    assert member_client.put("/api/v1/members/me/profile", json={"first_name": "  ", "last_name": "x"}).status_code == 422
    row = admin_client.get("/api/v1/admin/members", params={"q": "Demo-Patel"}).json()["rows"][0]
    assert row["name"] == "Adi Demo-Patel"
    detail = admin_client.get(f"/api/v1/admin/members/{row['member_id']}").json()
    assert detail["phone"] == "+1 555 0100" and detail["postal_code"] == "94110"
    # the admin portal cannot use the member profile routes
    assert admin_client.put("/api/v1/members/me/profile", json={"first_name": "Cara"}).status_code == 401


def test_profile_photo_is_validated_stored_through_object_storage_and_removable(member_client, admin_client):
    assert member_client.get("/api/v1/auth/me").json()["member"]["photo_version"] is None
    assert member_client.get("/api/v1/members/me/photo").status_code == 404
    # wrong type (declared PNG, actually text) and oversize are refused
    bad = member_client.post("/api/v1/members/me/photo", files={"file": ("x.png", io.BytesIO(b"not an image"), "image/png")})
    assert bad.status_code == 415
    huge = member_client.post("/api/v1/members/me/photo", files={"file": ("x.png", io.BytesIO(PNG_1PX + b"\0" * 2_100_000), "image/png")})
    assert huge.status_code == 413
    ok = member_client.post("/api/v1/members/me/photo", files={"file": ("me.png", io.BytesIO(PNG_1PX), "image/png")})
    assert ok.status_code == 201, ok.text
    version = ok.json()["photo_version"]
    assert version
    photo = member_client.get("/api/v1/members/me/photo")
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/png" and photo.content == PNG_1PX
    # the console sees the same bytes for that member; another member never does
    member_id = member_client.get("/api/v1/auth/me").json()["member"]["member_id"]
    assert admin_client.get(f"/api/v1/admin/members/{member_id}/photo").content == PNG_1PX
    assert admin_client.get("/api/v1/admin/members", params={"q": "aditya"}).json()["rows"][0]["has_photo"] is True
    other = _second_member()
    assert other.get("/api/v1/members/me/photo").status_code == 404
    removed = member_client.delete("/api/v1/members/me/photo")
    assert removed.status_code == 200 and removed.json()["photo_version"] is None
    assert member_client.get("/api/v1/members/me/photo").status_code == 404


def test_member_export_contains_only_that_members_data(member_client):
    today = date(2026, 9, 21).isoformat()
    member_client.put("/api/v1/members/me/mood", params={"today": today}, json={"entry_date": today, "mood": "happy"})
    member_client.post("/api/v1/members/me/requests", json={"kind": "join_beta"})
    other = _second_member()
    other.put("/api/v1/members/me/mood", params={"today": today}, json={"entry_date": today, "mood": "sad", "note": "private"})
    export = member_client.get("/api/v1/members/me/export")
    assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]
    data = export.json()
    assert data["account"]["email"] == "aditya.demo@demo.veye.test"
    assert [m["mood"] for m in data["mood"]] == ["happy"] and "private" not in export.text
    assert data["requests"][0]["kind"] == "join_beta"
    assert set(data) >= {"health_number", "body_composition", "blood_markers", "health_assessment", "simple_quiz", "food_diary", "guided_sessions"}


# ---------------------------------------------------------------- product settings
def test_support_details_are_edited_in_the_console_and_read_publicly(client, admin_client):
    assert client.get("/api/v1/settings/support").json()["support_email"] == "contact@veye.co"
    assert client.put("/api/v1/admin/settings/product", json={"support_email": "x@y.co"}).status_code == 401
    assert admin_client.put("/api/v1/admin/settings/product", json={"support_email": "not-an-email"}).status_code == 422
    saved = admin_client.put("/api/v1/admin/settings/product", json={"support_email": "Help@Veye.co", "support_phone": "+1 555 0199"})
    assert saved.status_code == 200 and saved.json()["support_email"] == "help@veye.co" and saved.json()["updated_by"] == "Cara Hogue"
    public = client.get("/api/v1/settings/support").json()
    assert public["support_email"] == "help@veye.co" and public["support_phone"] == "+1 555 0199"
    features = admin_client.get("/api/v1/admin/settings/features").json()
    states = {f["key"]: f["state"] for f in features}
    assert states["mood"] == "available" and states["food_choices"] == "client_input" and states["requests"] == "available"


# ---------------------------------------------------------------- console views
def test_member_360_shows_mood_diary_and_requests_for_that_member_only(member_client, admin_client):
    today = date(2026, 9, 21).isoformat()
    member_client.put("/api/v1/members/me/mood", params={"today": today}, json={"entry_date": today, "mood": "calm"})
    member_client.post("/api/v1/members/me/food-diary", json={"entry_date": today, "meal_time": "08:00", "description": "Porridge"})
    member_client.post("/api/v1/members/me/requests", json={"kind": "contact_us", "message": "Hello from Aditya"})
    other = _second_member()
    other.put("/api/v1/members/me/mood", params={"today": today}, json={"entry_date": today, "mood": "angry"})
    rows = {r["email"]: r for r in admin_client.get("/api/v1/admin/members").json()["rows"]}
    aditya = admin_client.get(f"/api/v1/admin/members/{rows['aditya.demo@demo.veye.test']['member_id']}").json()
    maya = admin_client.get(f"/api/v1/admin/members/{rows['maya.demo@demo.veye.test']['member_id']}").json()
    assert [m["mood"] for m in aditya["mood_entries"]] == ["calm"] and aditya["mood_stats"]["balance_score"] == 100
    assert [m["description"] for m in aditya["food_diary"]] == ["Porridge"] and aditya["food_diary_days"] == 1
    assert [r["message"] for r in aditya["requests"]] == ["Hello from Aditya"]
    assert [m["mood"] for m in maya["mood_entries"]] == ["angry"] and maya["food_diary"] == [] and maya["requests"] == []
    assert "Mood Tracker" not in aditya["not_connected"] and "Food Choices" in aditya["not_connected"]
    insights = admin_client.get("/api/v1/admin/insights").json()
    assert insights["mood_entries"] == 2 and insights["mood_members"] == 2 and insights["food_diary_entries"] == 1
    assert insights["requests_by_kind"] == {"contact_us": 1}


# ---------------------------------------------------------------- QA cleanup
def test_qa_cleanup_removes_only_stamped_synthetic_members(admin_client):
    from app.seed.users import seed_users

    seed_users()
    e2e = _second_member(email="e2e.mubb7gjx@demo.veye.test", first="Ember")
    today = date(2026, 9, 21).isoformat()
    e2e.put("/api/v1/members/me/mood", params={"today": today}, json={"entry_date": today, "mood": "happy"})
    e2e.post("/api/v1/members/me/requests", json={"kind": "join_beta"})
    e2e.post("/api/v1/members/me/photo", files={"file": ("me.png", io.BytesIO(PNG_1PX), "image/png")})
    real = _second_member(email="someone.real@example.com", first="Real")  # not the synthetic domain
    before = admin_client.get("/api/v1/admin/overview").json()["members_total"]

    # rows the Playwright console spec leaves behind, plus a hand-written one that must survive
    assert admin_client.post("/api/v1/admin/content/entries", json={"group": "help_faq", "key": "e2e_entry_mubb7gjx", "title": "Who is Sprout?", "body": "x"}).status_code == 201
    assert admin_client.post("/api/v1/admin/content/entries", json={"group": "help_faq", "key": "real_question", "title": "Real", "body": "x"}).status_code == 201
    assert admin_client.post("/api/v1/admin/care/items", json={"kind": "fitness", "title": "E2E mobility warm-up mubb7gjx", "content_type": "video", "youtube_url": "https://youtu.be/XLlHJ5-vHWw"}).status_code == 201

    cleaned = admin_client.post("/api/v1/admin/qa/cleanup-synthetic-members", json={"prefixes": ["e2e", "guided"]})
    assert cleaned.status_code == 200, cleaned.text
    assert cleaned.json()["removed"] == ["e2e.mubb7gjx@demo.veye.test"]
    assert cleaned.json()["content_removed"] == 1 and cleaned.json()["care_removed"] == 1
    keys = {e["key"] for e in admin_client.get("/api/v1/admin/content/entries", params={"group": "help_faq"}).json()}
    assert "real_question" in keys and "e2e_entry_mubb7gjx" not in keys
    after = admin_client.get("/api/v1/admin/overview").json()
    assert after["members_total"] == before - 1
    # seeded identities and the real-domain member survive; the E2E member's session is gone; its request is detached, not lost
    emails = {r["email"] for r in admin_client.get("/api/v1/admin/members", params={"page_size": 100}).json()["rows"]}
    assert {"aditya.demo@demo.veye.test", "maya.demo@demo.veye.test", "jordan.dual@demo.veye.test", "someone.real@example.com"} <= emails
    assert e2e.get("/api/v1/auth/me").json()["member"] is None
    assert cleaned.json()["requests_removed"] == 1  # the E2E member's Join Beta went with it
    inbox = admin_client.get("/api/v1/admin/requests", params={"kind": "join_beta", "view": "all"}).json()
    assert not [r for r in inbox["rows"] if r["email"] == "e2e.mubb7gjx@demo.veye.test"]
    assert sign_in(real, "someone.real@example.com").status_code == 200
    # the seed's second administrator has the same plain administrator capability
    other_admin = TestClient(app)
    assert admin_sign_in(other_admin, "priya.ops@demo.veye.test", "PriyaOps!2026-local").status_code == 200
    assert other_admin.get("/api/v1/admin/requests").status_code == 200
    assert other_admin.get("/api/v1/auth/me").json()["admin"]["member_access"] is False
