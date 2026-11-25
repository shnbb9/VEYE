"""What the independent review of 15 Nov's pictures and links found, held shut:
a website that drips cannot keep a worker, a failed commit loses no picture,
erasure misses no object, and a rebuilt picture carries nothing it arrived
with."""

from __future__ import annotations

import io
import socket
import threading
import time

import pytest
from PIL import Image

from app.core.rate_limit import RateLimitEvent
from app.core.runtime import get_runtime
from app.db.session import SessionLocal
from app.food.models import FoodDiaryEntry
from app.storage import remote_image
from app.storage.images import normalise_photo, prepare_picture
from app.storage.media_changes import MediaChanges, committed_with
from app.storage.remote_image import LinkRefused, RemoteImageFetcher, is_public
from tests.conftest import MEMBER_PASSWORD
from tests.test_meal_photos import DIARY, FakeFetcher, add_meal, keys, picture, put_photo


# ---- one deadline over everything --------------------------------------------------

def drip(behaviour):
    """A server on this machine that does `behaviour(connection)`."""
    server = socket.create_server(("127.0.0.1", 0))

    def run():
        conn, _ = server.accept()
        with conn:
            conn.recv(4096)
            try:
                behaviour(conn)
            except OSError:
                pass

    threading.Thread(target=run, daemon=True).start()
    return server


def slow_headers(conn):
    conn.sendall(b"HTTP/1.1 200 OK\r\nX-Slow: ")
    for _ in range(200):
        conn.sendall(b"a")
        time.sleep(0.1)


def slow_body(conn):
    conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n")
    for _ in range(200):
        conn.sendall(b"a")
        time.sleep(0.1)


def endless_continue(conn):
    while True:
        conn.sendall(b"HTTP/1.1 100 Continue\r\n\r\n")
        time.sleep(0.02)


@pytest.mark.parametrize("behaviour", [slow_headers, slow_body, endless_continue])
def test_a_website_that_drips_is_dropped_at_the_deadline(monkeypatch, behaviour):
    monkeypatch.setattr(remote_image, "DEADLINE", 1.0)
    server = drip(behaviour)
    port = server.getsockname()[1]
    fetcher = RemoteImageFetcher(max_bytes=10_000_000, resolve=lambda h, p: ["93.184.216.34"],
                                 connect=lambda a, p, t: socket.create_connection(("127.0.0.1", port), timeout=t))
    began = time.monotonic()
    with pytest.raises(LinkRefused) as refused:
        fetcher.fetch("http://slow.example.com/a.png")
    assert refused.value.status_code == 504
    assert time.monotonic() - began < 4, "bounded by the deadline, not by the server"
    server.close()


@pytest.mark.parametrize("url", ["http://[::1/", "https://exa℀mple.com/a.png", "https://" + "a" * 70 + "é.com/x.png", "http://host:99999/a"])
def test_a_malformed_address_is_refused_in_words(url):
    with pytest.raises(LinkRefused):
        RemoteImageFetcher(max_bytes=1000, resolve=lambda h, p: ["127.0.0.1"]).fetch(url)


def test_accents_in_an_ordinary_address_work():
    seen = []
    server = drip(lambda conn: conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\nabc"))
    port = server.getsockname()[1]
    fetcher = RemoteImageFetcher(max_bytes=1000, resolve=lambda h, p: seen.append(h) or ["93.184.216.34"],
                                 connect=lambda a, p, t: socket.create_connection(("127.0.0.1", port), timeout=t))
    assert fetcher.fetch("http://münchen.example/café.jpg?q=é") == b"abc"
    assert seen == ["xn--mnchen-3ya.example"]


@pytest.mark.parametrize("address", ["64:ff9b::a9fe:a9fe", "::a9fe:a9fe", "::ffff:0:a9fe:a9fe", "fec0::1", "2002:a9fe:a9fe::1",
                                     "2001:0:a9fe:a9fe::1", "::ffff:169.254.169.254"])
def test_ipv6_that_carries_a_private_ipv4_is_not_public(address):
    assert not is_public(address)
    assert is_public("2606:4700:4700::1111") and is_public("93.184.216.34")


def test_the_hit_is_counted_before_the_fetch_and_the_database_is_let_go(member_client, monkeypatch):
    meal = add_meal(member_client)
    during = {}

    class Watching(FakeFetcher):
        def fetch(self, url):
            with SessionLocal() as db:   # another connection: sees only what is committed
                during["hits"] = db.query(RateLimitEvent).filter(RateLimitEvent.bucket == "meal_photo_link").count()
            raise LinkRefused(422, "no")

    monkeypatch.setattr("app.food.routes.RemoteImageFetcher", Watching)
    assert member_client.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": "https://x.example/a.png"}).status_code == 422
    assert during["hits"] >= 1


def test_a_meal_removed_while_its_link_is_fetched_leaves_no_photo(member_client, monkeypatch):
    meal = add_meal(member_client)

    class Meanwhile(FakeFetcher):
        def fetch(self, url):
            assert member_client.delete(f"{DIARY}/{meal['id']}").status_code == 200
            return picture()

    monkeypatch.setattr("app.food.routes.RemoteImageFetcher", Meanwhile)
    late = member_client.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": "https://x.example/a.png"})
    assert late.status_code == 404
    assert keys(member_client.account["member_id"]) == []


# ---- bytes and rows ---------------------------------------------------------------------

def test_a_failed_commit_keeps_the_old_picture_and_drops_the_new_one():
    media = get_runtime().media_store
    media.put("t/old.jpg", b"old", "image/jpeg")
    changes = MediaChanges(media)

    class Broken:
        def commit(self):
            raise RuntimeError("database went away")

        def rollback(self):
            pass

    with pytest.raises(RuntimeError):
        with committed_with(Broken(), changes):
            changes.put("t/new.jpg", b"new", "image/jpeg")
            changes.retire("t/old.jpg")
    assert media.list_keys("t/") == ["t/old.jpg"]

    class Fine(Broken):
        def commit(self):
            pass

    with committed_with(Fine(), changes):
        changes.put("t/new.jpg", b"new", "image/jpeg")
        changes.retire("t/old.jpg")
    assert media.list_keys("t/") == ["t/new.jpg"]


def test_the_api_names_the_entry_it_made(member_client):
    first = member_client.post(DIARY, json={"entry_date": "2026-11-15", "meal_time": "08:00", "description": "First"}).json()
    second = member_client.post(DIARY, json={"entry_date": "2026-11-15", "meal_time": "09:00", "description": "Second"}).json()
    assert {m["id"]: m["description"] for m in second["meals"]}[second["created_id"]] == "Second" != first["created_id"]
    assert member_client.get(DIARY, params={"date": "2026-11-15"}).json()["created_id"] is None


def test_erasure_removes_pictures_no_row_names_any_more(member_client):
    media = get_runtime().media_store
    user_id, member_id = member_client.account["id"], member_client.account["member_id"]
    member_client.post("/api/v1/members/me/photo", files={"file": ("a.png", io.BytesIO(picture(fmt="PNG", size=(300, 300))), "image/png")})
    media.put(f"profile-photos/{user_id}/orphan.original.jpg", b"the uncropped original", "image/jpeg")
    media.put(f"meal-photos/{member_id}/gone/orphan.jpg", b"x", "image/jpeg")
    gone = member_client.post("/api/v1/members/me/erasure", json={"password": MEMBER_PASSWORD, "confirm": "DELETE"})
    assert gone.status_code in (200, 202), gone.text
    assert media.list_keys(f"profile-photos/{user_id}/") == [] and media.list_keys(f"meal-photos/{member_id}/") == []


# ---- what a rebuilt picture carries ---------------------------------------------------------

def test_no_comment_text_or_metadata_survives_the_rebuild():
    marker = b"zz-left-in-the-file"
    jpeg, png = io.BytesIO(), io.BytesIO()
    Image.new("RGB", (400, 300), (9, 99, 9)).save(jpeg, "JPEG", comment=marker)
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Comment", marker.decode())
    Image.new("RGB", (400, 300), (9, 99, 9)).save(png, "PNG", pnginfo=info)
    for data in (jpeg.getvalue(), png.getvalue()):
        assert marker in data
        kept = prepare_picture(data, max_bytes=10_000_000, crop=None)
        meal = normalise_photo(data, max_bytes=10_000_000, full_side=200, thumb_side=50)
        for out in (kept.original, kept.full, kept.thumb, meal.full, meal.thumb):
            assert marker not in out


def test_a_very_large_picture_is_not_a_minute_of_work():
    noisy = io.BytesIO()
    Image.effect_noise((4900, 4900), 90).convert("1").save(noisy, "PNG")
    began = time.monotonic()
    prepare_picture(noisy.getvalue(), max_bytes=10_000_000, crop=None)
    assert time.monotonic() - began < 15


@pytest.mark.parametrize("path", ["/api/v1/members/me/photo"])
def test_the_members_own_picture_is_rate_limited(member_client, path):
    from app.core.rate_limit import LIMITS

    for _ in range(LIMITS["photo_upload"].per_subject):
        member_client.post(path, files={"file": ("a.txt", io.BytesIO(b"no"), "text/plain")})
    assert member_client.post(path, files={"file": ("a.txt", io.BytesIO(b"no"), "text/plain")}).status_code == 429


def test_pictures_are_handled_off_the_event_loop():
    """An `async def` route would decode on the loop and stall every other request."""
    import inspect

    from app.admin import account_routes
    from app.food import routes as food
    from app.members import routes as members

    for route in (members.upload_photo, members.recrop_photo, account_routes.upload_my_photo, account_routes.recrop_my_photo,
                  food.add_meal_photo, food.add_meal_photo_from_link):
        assert not inspect.iscoroutinefunction(route), route.__name__


def test_put_photo_still_reads_the_whole_upload(member_client):
    meal = add_meal(member_client)
    assert put_photo(member_client, meal["id"], picture()).status_code == 200
    with SessionLocal() as db:
        assert db.query(FoodDiaryEntry).one().photo_object_key


# ---- fitness links and races --------------------------------------------------------------------

def test_fitness_links_that_once_misread_or_crashed():
    from app.fitness.links import VideoLinkError, parse_video_link

    link = parse_video_link("https://vimeo.com/123456789/987654321")
    assert (link.video_id, link.video_hash) == ("123456789", "987654321")
    assert parse_video_link("https://vimeo.com/groups/1234/videos/987654321").video_id == "987654321"
    for bad in ("https://[youtube.com/watch?v=XLlHJ5-vHWw", "https://www.youtube.com/watch?v=XLlHJ5-vHWw%0A"):
        with pytest.raises(VideoLinkError):
            parse_video_link(bad)


def test_hiding_the_main_video_does_not_hand_its_place_to_the_next_one_added(admin_client):
    route = "/api/v1/admin/fitness/videos"
    add = lambda vid, title: admin_client.post(route, json={"goal": "fit", "url": f"https://youtu.be/{vid}", "title": title, "subtitle": ""})
    first = add("AAAAAAAAAA1", "One").json()
    add("AAAAAAAAAA2", "Two")
    main = next(v for v in first["videos"] if v["is_main"])
    admin_client.patch(f"{route}/{main['id']}", json={"published": False})
    after = add("AAAAAAAAAA3", "Three").json()["videos"]
    assert [v["title"] for v in after if v["is_main"]] == []


def test_two_administrators_changing_the_main_video_get_words_not_an_error():
    from sqlalchemy.exc import IntegrityError

    from app.fitness.models import FitnessVideo
    from app.fitness.service import FitnessError, FitnessLibraryService

    with SessionLocal() as db:
        service = FitnessLibraryService(db)
        service.add("fit", "https://youtu.be/AAAAAAAAAA1", "One", "", by="a")
        two = service.add("fit", "https://youtu.be/AAAAAAAAAA2", "Two", "", by="a")
        db.commit()
        # The other administrator's change lands between our read and our write.
        real = db.query(FitnessVideo).filter(FitnessVideo.is_main.is_(True)).all
        assert real()
        two.is_main = True
        with pytest.raises((FitnessError, IntegrityError)):
            service._keep(two, "Another administrator just changed the main video. Reload and try again.")
        db.rollback()
        with SessionLocal() as other:
            assert other.query(FitnessVideo).filter(FitnessVideo.is_main.is_(True)).count() == 1
