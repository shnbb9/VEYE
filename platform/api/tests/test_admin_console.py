"""Production admin console: Home overview, Members, Member 360, Assessments,
Insights, Care Studio and Content — DB-backed, read-only for calculated
results, member-portal sessions refused."""

from tests.conftest import sign_up


def _seed_everything():
    from app.seed.care import seed_care
    from app.seed.users import seed_users

    seed_users()
    seed_care()


def test_overview_is_built_from_the_database(admin_client):
    _seed_everything()
    body = admin_client.get("/api/v1/admin/overview").json()
    # Cara (admin-only) is not a member; Aditya, Maya and Jordan are.
    assert body["members_total"] == 3
    assert body["completions"]["health_number"] == 4          # 2 + 1 + 1
    assert body["completions"]["health_assessment"] == 2      # Aditya only
    assert body["completions"]["simple_quiz"] == 3            # Aditya 2, Maya 1
    assert body["members_completed"]["health_assessment"] == 1
    assert body["members_completed"]["simple_quiz"] == 2
    assert body["members_completed"]["blood_markers"] == 2
    assert {m["email"] for m in body["recent_members"]} == {"aditya.demo@demo.veye.test", "maya.demo@demo.veye.test", "jordan.dual@demo.veye.test"}
    assert body["recent_activity"] and all({"at", "member_name", "kind", "summary"} <= set(row) for row in body["recent_activity"])
    # nothing invented
    assert not any(key for key in body if "revenue" in key or "growth" in key)


def test_members_directory_search_filters_sort_and_member_360(admin_client):
    _seed_everything()
    page = admin_client.get("/api/v1/admin/members").json()
    assert page["total"] == 3 and [r["name"] for r in page["rows"]] == ["Aditya Demo", "Jordan Dual", "Maya Demo"]
    aditya = page["rows"][0]
    assert aditya["health_number"] is not None and aditya["onboarding"] == "Complete" and aditya["trackers_completed"] == 5
    assert aditya["admin_access"] is False
    jordan = page["rows"][1]
    assert jordan["admin_access"] is True and jordan["trackers_completed"] == 1

    assert admin_client.get("/api/v1/admin/members?q=maya").json()["total"] == 1
    assert admin_client.get("/api/v1/admin/members?q=nobody").json()["total"] == 0
    by_hn = admin_client.get("/api/v1/admin/members?sort=health_number&direction=asc").json()["rows"]
    assert [r["health_number"] for r in by_hn] == sorted(r["health_number"] for r in by_hn)
    assert admin_client.get("/api/v1/admin/members?active=never").json()["total"] == 0

    detail = admin_client.get(f"/api/v1/admin/members/{aditya['member_id']}").json()
    assert detail["profile"]["email"] == "aditya.demo@demo.veye.test"
    assert len(detail["health_number"]) == 2 and len(detail["body_composition"]) == 2 and len(detail["blood_markers"]) == 2
    assert [h["total"] for h in detail["health_assessment"]] == [14, 22]
    assert [h["yes_count"] for h in detail["simple_quiz"]] == [2, 5]
    assert detail["guided_sessions"] == [] and detail["conversations"] == []
    assert "Food Choices" in detail["not_connected"]
    # Stored results are exactly what the member's records hold — nothing recalculated.
    assert detail["health_assessment"][1]["status"] == "Moderate Inflammation"
    assert detail["health_assessment"][1]["calculation_version"] == "health-assessment-2026-08-25-v2"

    assert admin_client.get("/api/v1/admin/members/00000000-0000-0000-0000-000000000000").status_code == 404


def test_assessments_index_and_attempts_are_read_only_system_managed(admin_client):
    _seed_everything()
    instruments = {i["key"]: i for i in admin_client.get("/api/v1/admin/assessments").json()}
    assert set(instruments) == {"health_number", "body_composition", "blood_markers", "health_assessment", "simple_quiz"}
    assert all(i["calculation_owner"] == "System managed" for i in instruments.values())
    assert instruments["health_assessment"]["attempts_total"] == 2 and instruments["health_assessment"]["members_scored"] == 1
    assert instruments["simple_quiz"]["attempts_total"] == 3 and instruments["simple_quiz"]["members_scored"] == 2

    attempts = admin_client.get("/api/v1/admin/assessments/simple_quiz/attempts").json()
    assert attempts["total"] == 3 and attempts["rows"][0]["member_name"] in {"Aditya Demo", "Maya Demo"}
    assert all(row["calculation_version"] == "simple-quiz-2026-08-20-v1" for row in attempts["rows"])
    filtered = admin_client.get("/api/v1/admin/assessments/health_assessment/attempts?q=aditya").json()
    assert filtered["total"] == 2 and filtered["rows"][0]["result"].startswith("14 / 33")
    assert admin_client.get("/api/v1/admin/assessments/mood/attempts").status_code == 422
    # No editable weights, bands or formulas exist anywhere in the console API.
    paths = {getattr(route, "path", "") for route in admin_client.app.routes}
    assert not any("weights" in p or "formula" in p for p in paths)


def test_insights_are_real_aggregates(admin_client):
    _seed_everything()
    body = admin_client.get("/api/v1/admin/insights").json()
    assert body["members_total"] == 3
    assert len(body["members_by_month"]) == 12 and sum(m["count"] for m in body["members_by_month"]) == 3
    assert body["attempts"]["health_number"] == 4
    assert sum(m["count"] for m in body["attempts_by_month"]["simple_quiz"]) == 3
    assert {f["flow_key"] for f in body["guided_flows"]} >= set()
    assert body["companion_conversations"] == 0 and body["companion_feedback_helpful"] == 0


def test_care_studio_lifecycle_and_member_read(admin_client, client):
    _seed_everything()
    summary = {s["kind"]: s for s in admin_client.get("/api/v1/admin/care/summary").json()}
    assert summary["fitness"]["published"] == 3 and summary["resource"]["published"] == 0 and summary["resource"]["draft"] == 4

    created = admin_client.post("/api/v1/admin/care/items", json={
        "kind": "fitness", "title": "Mobility warm-up", "description": "Five minutes before any session.",
        "category": "Warm-up", "content_type": "video", "youtube_url": "https://www.youtube.com/watch?v=abc123xyz00", "display_order": 9,
    })
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["status"] == "Draft" and item["youtube_embed_url"] == "https://www.youtube-nocookie.com/embed/abc123xyz00"

    bad = admin_client.post("/api/v1/admin/care/items", json={"kind": "fitness", "title": "x", "youtube_url": "https://vimeo.com/1"})
    assert bad.status_code == 422

    # Members see published items only.
    assert sign_up(client, email="new.member@demo.veye.test", first_name="New").status_code == 201
    titles = [i["title"] for i in client.get("/api/v1/care/fitness").json()]
    assert "Mobility warm-up" not in titles and "Interested in Martial Arts and Boxing?" in titles
    published = admin_client.post(f"/api/v1/admin/care/items/{item['id']}/publish").json()
    assert published["status"] == "Published" and published["published_by"] == "Cara Hogue"
    assert "Mobility warm-up" in [i["title"] for i in client.get("/api/v1/care/fitness").json()]
    member_view = next(i for i in client.get("/api/v1/care/fitness").json() if i["title"] == "Mobility warm-up")
    assert "published_by" not in member_view and member_view["youtube_embed_url"].startswith("https://www.youtube-nocookie.com/")

    edited = admin_client.put(f"/api/v1/admin/care/items/{item['id']}", json={
        "kind": "fitness", "title": "Mobility warm-up (5 min)", "content_type": "video",
        "youtube_url": "https://youtu.be/abc123xyz00", "display_order": 9,
    })
    assert edited.status_code == 200 and edited.json()["title"] == "Mobility warm-up (5 min)"
    assert admin_client.post(f"/api/v1/admin/care/items/{item['id']}/archive").json()["status"] == "Archived"
    assert admin_client.put(f"/api/v1/admin/care/items/{item['id']}", json={"kind": "fitness", "title": "x"}).status_code == 409
    assert admin_client.post(f"/api/v1/admin/care/items/{item['id']}/publish").status_code == 409
    assert admin_client.post(f"/api/v1/admin/care/items/{item['id']}/restore").json()["status"] == "Draft"
    assert client.get("/api/v1/care/mood").status_code == 404
    # member portal sessions cannot administer content
    assert client.get("/api/v1/admin/care/items").status_code == 401
    actions = [e["action"] for e in admin_client.get("/api/v1/admin/companion/advanced/audit").json()]
    assert {"care.create", "care.publish", "care.update", "care.archive", "care.restore"} <= set(actions)


def test_content_entries_lifecycle_and_public_read(admin_client, client):
    _seed_everything()
    summary = {s["group"]: s for s in admin_client.get("/api/v1/admin/content/summary").json()}
    assert summary["help_faq"]["published"] == 22 and summary["member_copy"]["published"] == 5

    public = client.get("/api/v1/content/help_faq").json()
    assert len(public) == 22 and public[0]["title"] == "What is Veye?"
    assert client.get("/api/v1/content/scoring").status_code == 404

    created = admin_client.post("/api/v1/admin/content/entries", json={
        "group": "help_faq", "key": "what_is_sprout", "category": "Using the Platform", "title": "Who is Sprout?",
        "body": "Sprout is the Veye Companion.", "display_order": 99,
    })
    assert created.status_code == 201, created.text
    entry = created.json()
    assert entry["status"] == "Draft"
    assert len(client.get("/api/v1/content/help_faq").json()) == 22
    duplicate = admin_client.post("/api/v1/admin/content/entries", json={"group": "help_faq", "key": "what_is_sprout", "title": "dup"})
    assert duplicate.status_code == 409
    assert admin_client.post(f"/api/v1/admin/content/entries/{entry['id']}/publish").json()["status"] == "Published"
    assert len(client.get("/api/v1/content/help_faq").json()) == 23
    assert admin_client.post(f"/api/v1/admin/content/entries/{entry['id']}/unpublish").json()["status"] == "Draft"
    assert admin_client.post(f"/api/v1/admin/content/entries/{entry['id']}/archive").json()["status"] == "Archived"
    assert admin_client.put(f"/api/v1/admin/content/entries/{entry['id']}", json={"group": "help_faq", "key": "what_is_sprout", "title": "x"}).status_code == 409
    assert client.get("/api/v1/admin/content/entries").status_code == 401


def test_seed_is_idempotent(admin_client):
    from app.seed.care import seed_care
    from app.seed.users import seed_users

    first = seed_users()
    seed_care()
    again = seed_care()
    assert again == {"care_items": 0, "content_entries": 0}
    assert seed_users()["jordan.dual@demo.veye.test"] == "exists" and first["jordan.dual@demo.veye.test"] == "created"
    assert admin_client.get("/api/v1/admin/overview").json()["completions"]["health_assessment"] == 2


def test_seed_backfills_a_tracker_an_older_seed_never_created(admin_client):
    """A member created before a tracker existed receives that tracker's seeded
    history on the next seed run; trackers that already have rows are untouched."""
    from app.db.session import SessionLocal
    from app.progress.health_assessment.models import HealthAssessmentAttempt
    from app.seed.users import ADITYA, seed_users

    first = seed_users()
    assert first[ADITYA.email] == "created"
    with SessionLocal() as db:
        removed = db.query(HealthAssessmentAttempt).delete()
        db.commit()
    assert removed == 2
    again = seed_users()
    assert again[ADITYA.email] == "backfilled health_assessment"
    assert admin_client.get("/api/v1/admin/overview").json()["completions"]["health_assessment"] == 2
    assert seed_users()[ADITYA.email] == "exists"
