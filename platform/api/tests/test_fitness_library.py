"""The Fitness library (owner request, 15 Nov 2026): the console pastes YouTube
or Vimeo links per goal and picks one main video per goal; members see the
main video first and the rest nine to a page. Links only, and only links to
one video on the two providers' own hosts.
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.admin.models import AdminAuditEntry
from app.db.session import SessionLocal
from app.fitness.links import VideoLinkError, parse_video_link
from app.fitness.models import FitnessVideo

ADMIN = "/api/v1/admin/fitness/videos"
MEMBER = "/api/v1/fitness/library"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Vimeo's still comes from its oEmbed endpoint; never reach it in tests."""
    monkeypatch.setattr("app.fitness.service.vimeo_thumbnail", lambda link: f"https://i.vimeocdn.com/video/{link.video_id}-d_640")


def yt(n: int) -> str:
    return f"https://youtu.be/{'v' + str(n).zfill(10)}"


def add(client, goal="weight", n=1, title=None, url=None):
    return client.post(ADMIN, json={"goal": goal, "url": url or yt(n), "title": title or f"Workout {n}", "subtitle": f"Session {n}"})


# ---- the link ------------------------------------------------------------------------

@pytest.mark.parametrize("url, provider, video_id, video_hash", [
    ("https://www.youtube.com/watch?v=XLlHJ5-vHWw", "youtube", "XLlHJ5-vHWw", None),
    ("https://youtu.be/7YLttuiwGvw?t=42", "youtube", "7YLttuiwGvw", None),
    ("youtube.com/shorts/abcdefghijk", "youtube", "abcdefghijk", None),
    ("https://m.youtube.com/watch?v=XLlHJ5-vHWw&list=PL123", "youtube", "XLlHJ5-vHWw", None),
    ("https://www.youtube-nocookie.com/embed/XLlHJ5-vHWw", "youtube", "XLlHJ5-vHWw", None),
    ("https://vimeo.com/76979871", "vimeo", "76979871", None),
    ("https://vimeo.com/123456789/abcdef1234", "vimeo", "123456789", "abcdef1234"),
    ("https://player.vimeo.com/video/123456789?h=abc123def", "vimeo", "123456789", "abc123def"),
    ("https://vimeo.com/channels/staffpicks/76979871", "vimeo", "76979871", None),
])
def test_youtube_and_vimeo_links_are_read(url, provider, video_id, video_hash):
    link = parse_video_link(url)
    assert (link.provider, link.video_id, link.video_hash) == (provider, video_id, video_hash)
    assert link.embed_url.startswith(("https://www.youtube-nocookie.com/embed/", "https://player.vimeo.com/video/"))


@pytest.mark.parametrize("url", [
    "https://example.com/watch?v=XLlHJ5-vHWw",            # not a provider
    "https://youtube.com.evil.example/watch?v=XLlHJ5-vHWw",  # look-alike host
    "https://evil.example/youtube.com/watch?v=XLlHJ5-vHWw",
    "https://www.youtube.com/playlist?list=PL123",       # not one video
    "https://www.youtube.com/watch?v=short",             # not an id
    "https://vimeo.com/channels/staffpicks",
    "javascript:alert(1)", "ftp://youtu.be/XLlHJ5-vHWw", "", "https://user:pw@youtu.be/XLlHJ5-vHWw",
])
def test_anything_else_is_refused(url):
    with pytest.raises(VideoLinkError):
        parse_video_link(url)


# ---- the console -----------------------------------------------------------------------

def test_the_first_video_of_a_goal_is_its_main_video_and_the_rest_follow(admin_client):
    first = add(admin_client, n=1)
    assert first.status_code == 201, first.text
    add(admin_client, n=2)
    library = add(admin_client, n=3).json()
    assert [(v["title"], v["is_main"], v["position"]) for v in library["videos"]] == [
        ("Workout 1", True, 0), ("Workout 2", False, 1), ("Workout 3", False, 2)]
    assert library["videos"][0]["thumbnail_url"] == "https://i.ytimg.com/vi/v0000000001/hqdefault.jpg"
    assert {g["key"]: g["count"] for g in library["goals"]} == {"stronger": 0, "weight": 3, "fit": 0, "performance": 0}


def test_a_vimeo_video_gets_its_still_from_vimeo(admin_client):
    library = add(admin_client, goal="fit", url="https://vimeo.com/123456789/abcdef1234", title="Mobility").json()
    video = library["videos"][0]
    assert video["provider"] == "vimeo" and video["thumbnail_url"] == "https://i.vimeocdn.com/video/123456789-d_640"
    assert video["embed_url"] == "https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234"


def test_wrong_links_duplicates_and_missing_titles_are_refused(admin_client):
    assert add(admin_client, url="https://example.com/video.mp4").json()["detail"].startswith("Only YouTube and Vimeo links")
    assert add(admin_client, n=1).status_code == 201
    duplicate = add(admin_client, n=1, title="Again")
    assert duplicate.status_code == 409 and "already in Lose Weight" in duplicate.json()["detail"]
    assert add(admin_client, goal="stronger", n=1).status_code == 201, "the same video may serve another goal"
    assert admin_client.post(ADMIN, json={"goal": "weight", "url": yt(9), "title": "   "}).status_code == 422
    assert admin_client.post(ADMIN, json={"goal": "cardio", "url": yt(9), "title": "x"}).status_code == 422


def test_the_main_video_can_be_changed_and_there_is_only_ever_one(admin_client):
    for n in range(1, 4):
        add(admin_client, n=n)
    videos = admin_client.get(f"{ADMIN}?goal=weight").json()["videos"]
    third = videos[2]["id"]
    library = admin_client.post(f"{ADMIN}/{third}/main").json()
    assert [v["title"] for v in library["videos"] if v["is_main"]] == ["Workout 3"]
    assert library["videos"][0]["title"] == "Workout 3", "the main video leads"
    with SessionLocal() as db:
        assert db.query(FitnessVideo).filter(FitnessVideo.goal == "weight", FitnessVideo.is_main.is_(True)).count() == 1
        # The database holds the rule too, not only the service.
        with pytest.raises(IntegrityError):
            db.query(FitnessVideo).filter(FitnessVideo.goal == "weight", FitnessVideo.title == "Workout 1").update({"is_main": True})
        db.rollback()


def test_hiding_or_removing_the_main_video_falls_back_to_the_first_shown(admin_client, member_client):
    for n in range(1, 4):
        add(admin_client, n=n)
    videos = admin_client.get(f"{ADMIN}?goal=weight").json()["videos"]
    main_id, second_id = videos[0]["id"], videos[1]["id"]
    hidden = admin_client.patch(f"{ADMIN}/{main_id}", json={"published": False}).json()
    assert not any(v["is_main"] for v in hidden["videos"])
    refused = admin_client.post(f"{ADMIN}/{main_id}/main")
    assert refused.status_code == 422 and "Show this video" in refused.json()["detail"]
    seen = member_client.get(f"{MEMBER}?goal=weight").json()
    assert seen["main"]["id"] == second_id and seen["total"] == 2
    assert main_id not in [v["id"] for v in seen["videos"]], "a hidden video never reaches members"
    admin_client.delete(f"{ADMIN}/{second_id}")
    assert member_client.get(f"{MEMBER}?goal=weight").json()["main"]["title"] == "Workout 3"


def test_reordering_lists_every_video_once_and_members_see_the_new_order(admin_client, member_client):
    for n in range(1, 5):
        add(admin_client, n=n)
    ids = [v["id"] for v in admin_client.get(f"{ADMIN}?goal=weight").json()["videos"]]
    new = [ids[0], ids[3], ids[1], ids[2]]
    assert admin_client.put(f"{ADMIN}/order", json={"goal": "weight", "ids": new}).status_code == 200
    assert [v["id"] for v in member_client.get(f"{MEMBER}?goal=weight").json()["videos"]] == new
    assert admin_client.put(f"{ADMIN}/order", json={"goal": "weight", "ids": new[:3]}).status_code == 422
    assert admin_client.put(f"{ADMIN}/order", json={"goal": "weight", "ids": new + [new[0]]}).status_code == 422


# ---- members ------------------------------------------------------------------------------

def test_members_page_through_nine_at_a_time_with_the_main_video_first(admin_client, member_client):
    for n in range(1, 12):
        add(admin_client, goal="performance", n=n)
    first = member_client.get(f"{MEMBER}?goal=performance").json()
    assert (first["total"], first["pages"], first["page"], first["page_size"]) == (11, 2, 1, 9)
    assert len(first["videos"]) == 9 and first["videos"][0]["is_main"] and first["main"]["title"] == "Workout 1"
    second = member_client.get(f"{MEMBER}?goal=performance&page=2").json()
    assert [v["title"] for v in second["videos"]] == ["Workout 10", "Workout 11"]
    assert member_client.get(f"{MEMBER}?goal=performance&page=99").json()["page"] == 2, "a page past the end shows the last"
    # Without a goal: the first goal (in the screen's order) that has videos.
    assert member_client.get(MEMBER).json()["goal"] == "performance"
    empty = member_client.get(f"{MEMBER}?goal=stronger").json()
    assert empty["main"] is None and empty["videos"] == [] and empty["pages"] == 1


def test_members_get_players_on_the_providers_privacy_domains_only(admin_client, member_client):
    add(admin_client, n=1)
    add(admin_client, url="https://vimeo.com/76979871", title="Vimeo one")
    for video in member_client.get(f"{MEMBER}?goal=weight").json()["videos"]:
        assert video["embed_url"].startswith(("https://www.youtube-nocookie.com/embed/", "https://player.vimeo.com/video/"))
        assert "url" not in video and "published" not in video, "the console's fields stay in the console"


def test_only_the_console_manages_the_library_and_every_change_is_audited(admin_client, member_client):
    assert member_client.post(ADMIN, json={"goal": "weight", "url": yt(1), "title": "x"}).status_code in (401, 403)
    assert member_client.get(ADMIN).status_code in (401, 403)
    video = add(admin_client, n=1).json()["videos"][0]
    admin_client.patch(f"{ADMIN}/{video['id']}", json={"title": "Renamed"})
    admin_client.delete(f"{ADMIN}/{video['id']}")
    with SessionLocal() as db:
        actions = [e.action for e in db.query(AdminAuditEntry).filter(AdminAuditEntry.action.like("fitness.%")).order_by(AdminAuditEntry.created_at).all()]
    assert actions == ["fitness.video_added", "fitness.video_changed", "fitness.video_removed"]
