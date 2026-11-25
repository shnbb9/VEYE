"""Food Diary photos through the API (owner request, 15 Nov 2026).

Snap a photo, Choose file and a pasted link all end in one kept picture per
meal: rebuilt (no EXIF, no GPS), bounded in size, replaced or removed
cleanly, never visible to another member, visible to the console only while
the member shares their records, and gone when the member deletes their data.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.runtime import get_runtime
from app.db.session import SessionLocal
from app.food.models import FoodDiaryEntry
from app.food.photos import member_prefix
from app.main import app
from app.storage.remote_image import LinkRefused
from tests.conftest import MEMBER_PASSWORD, decide_sharing, sign_up, verify_member_email

DIARY = "/api/v1/members/me/food-diary"


def picture(size=(2400, 1800), color=(30, 160, 60), fmt="JPEG", exif: bytes | None = None) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format=fmt, **({"exif": exif} if exif else {}))
    return out.getvalue()


def gps_exif() -> bytes:
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (51.0, 30.0, 0.0)}  # GPSInfo
    exif[0x0110] = "Kitchen Camera 9"              # Model
    return exif.tobytes()


def add_meal(client: TestClient, description="Lentil soup") -> dict:
    day = client.post(DIARY, json={"entry_date": "2026-11-15", "meal_time": "12:30", "description": description,
                                   "feelings": ["Hungry"], "notes": ""})
    assert day.status_code == 201, day.text
    return [m for m in day.json()["meals"] if m["description"] == description][-1]


def put_photo(client: TestClient, meal_id: str, data: bytes, mime="image/jpeg", name="meal.jpg"):
    return client.put(f"{DIARY}/{meal_id}/photo", files={"file": (name, io.BytesIO(data), mime)})


def keys(member_id: str) -> list[str]:
    return sorted(get_runtime().media_store.list_keys(member_prefix(member_id)))


def decode(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        return image.copy()


# ---- a kept photo --------------------------------------------------------------------

def test_a_meal_keeps_one_photo_rebuilt_without_its_metadata(member_client):
    meal = add_meal(member_client)
    assert meal["photo_version"] is None
    original = picture(exif=gps_exif())
    with Image.open(io.BytesIO(original)) as check:
        assert check.getexif(), "precondition: the upload really carries GPS and the camera"
    day = put_photo(member_client, meal["id"], original)
    assert day.status_code == 200, day.text
    kept = next(m for m in day.json()["meals"] if m["id"] == meal["id"])
    assert kept["photo_version"]

    full = member_client.get(f"{DIARY}/{meal['id']}/photo?size=full")
    thumb = member_client.get(f"{DIARY}/{meal['id']}/photo?size=thumb")
    assert full.status_code == thumb.status_code == 200
    assert full.headers["cache-control"].startswith("private") and full.headers["x-content-type-options"] == "nosniff"
    assert max(decode(full.content).size) == 1600 and max(decode(thumb.content).size) == 400
    assert not decode(full.content).getexif() and b"Kitchen Camera" not in full.content
    assert len(keys(member_client.account["member_id"])) == 2  # the photo and its thumbnail, nothing else


def test_a_new_photo_replaces_the_old_and_removing_it_leaves_nothing(member_client):
    meal = add_meal(member_client)
    member_id = member_client.account["member_id"]
    first = put_photo(member_client, meal["id"], picture(color=(200, 10, 10))).json()
    before = keys(member_id)
    second = put_photo(member_client, meal["id"], picture(color=(10, 10, 200), fmt="PNG", size=(300, 200)), "image/png", "b.png").json()
    after = keys(member_id)
    assert len(after) == 2 and not set(before) & set(after), "the earlier photo's files are gone"
    version = lambda day: next(m for m in day["meals"] if m["id"] == meal["id"])["photo_version"]  # noqa: E731
    assert version(first) != version(second)
    assert decode(member_client.get(f"{DIARY}/{meal['id']}/photo").content).getpixel((10, 10))[:3] == (10, 10, 200)

    removed = member_client.delete(f"{DIARY}/{meal['id']}/photo")
    assert removed.status_code == 200 and version(removed.json()) is None
    assert keys(member_id) == []
    assert member_client.get(f"{DIARY}/{meal['id']}/photo").status_code == 404


def test_removing_the_meal_removes_its_photo(member_client):
    meal = add_meal(member_client)
    assert put_photo(member_client, meal["id"], picture()).status_code == 200
    assert member_client.delete(f"{DIARY}/{meal['id']}").status_code == 200
    assert keys(member_client.account["member_id"]) == []


@pytest.mark.parametrize("data, mime, status", [
    (b"just some text", "text/plain", 415),
    (picture(fmt="GIF", size=(20, 20)), "image/gif", 415),
    (b"\xff\xd8\xff not really a jpeg", "image/jpeg", 415),
    (b"", "image/jpeg", 422),
])
def test_only_real_still_pictures_are_kept(member_client, data, mime, status):
    meal = add_meal(member_client)
    assert put_photo(member_client, meal["id"], data, mime).status_code == status
    assert keys(member_client.account["member_id"]) == []


def test_another_member_can_neither_see_nor_change_my_meal_photo(member_client, monkeypatch):
    monkeypatch.setattr("app.food.routes.RemoteImageFetcher", FakeFetcher)
    FakeFetcher.result, FakeFetcher.calls = picture(color=(9, 9, 9)), []
    meal = add_meal(member_client)
    assert put_photo(member_client, meal["id"], picture()).status_code == 200
    mine = member_client.get(f"{DIARY}/{meal['id']}/photo").content
    missing = __import__("uuid").uuid4()
    with TestClient(app) as other:
        assert sign_up(other, email="someone.else@demo.veye.test").status_code == 201
        add_meal(other, "Their own lunch")
        for size in ("full", "thumb"):
            theirs = other.get(f"{DIARY}/{meal['id']}/photo?size={size}")
            nothing = other.get(f"{DIARY}/{missing}/photo?size={size}")
            # Word for word what a meal that never existed answers.
            assert (theirs.status_code, theirs.json()) == (404, nothing.json())
        assert put_photo(other, meal["id"], picture(color=(0, 0, 0))).status_code == 404
        assert other.delete(f"{DIARY}/{meal['id']}/photo").status_code == 404
        assert other.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": "https://images.example.com/a.png"}).status_code == 404
        assert FakeFetcher.calls == [], "refused before anything is fetched on the caller's behalf"
    with TestClient(app) as nobody:
        assert nobody.get(f"{DIARY}/{meal['id']}/photo").status_code == 401
    assert len(keys(member_client.account["member_id"])) == 2
    assert member_client.get(f"{DIARY}/{meal['id']}/photo").content == mine


# ---- a photo from a link -------------------------------------------------------------

class FakeFetcher:
    calls: list[str] = []
    result: bytes | LinkRefused = b""

    def __init__(self, **_):
        pass

    def fetch(self, url: str) -> bytes:
        FakeFetcher.calls.append(url)
        if isinstance(FakeFetcher.result, LinkRefused):
            raise FakeFetcher.result
        return FakeFetcher.result


def test_a_photo_from_a_link_is_fetched_once_and_kept_as_veyes_own_copy(member_client, monkeypatch):
    monkeypatch.setattr("app.food.routes.RemoteImageFetcher", FakeFetcher)
    FakeFetcher.calls, FakeFetcher.result = [], picture(size=(800, 600), color=(240, 180, 20))
    meal = add_meal(member_client)
    day = member_client.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": "https://images.example.com/soup.jpg"})
    assert day.status_code == 200, day.text
    assert FakeFetcher.calls == ["https://images.example.com/soup.jpg"]
    assert next(m for m in day.json()["meals"] if m["id"] == meal["id"])["photo_version"]
    kept = decode(member_client.get(f"{DIARY}/{meal['id']}/photo").content)
    assert kept.size == (800, 600) and kept.getpixel((5, 5))[:3] == pytest.approx((240, 180, 20), abs=6)


def test_a_refused_link_says_why_and_the_meal_stays(member_client, monkeypatch):
    monkeypatch.setattr("app.food.routes.RemoteImageFetcher", FakeFetcher)
    FakeFetcher.result = LinkRefused(415, "That link opens a web page, not a picture. Open the picture itself and copy its address.")
    meal = add_meal(member_client)
    refused = member_client.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": "https://blog.example.com/recipe"})
    assert refused.status_code == 415 and "web page, not a picture" in refused.json()["detail"]
    day = member_client.get(f"{DIARY}?date=2026-11-15").json()
    assert next(m for m in day["meals"] if m["id"] == meal["id"])["photo_version"] is None

    # A link that fetched something that is not a picture says so in its own words.
    FakeFetcher.result = b"<html>hello</html>"
    refused = member_client.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": "https://images.example.com/x.jpg"})
    assert refused.status_code == 415 and "did not lead to a JPG, PNG or WebP" in refused.json()["detail"]


def test_the_real_fetcher_never_reaches_this_machine(member_client):
    meal = add_meal(member_client)
    for url in ("http://127.0.0.1/photo.png", "http://localhost/photo.png", "http://169.254.169.254/latest/meta-data/",
                "file:///etc/passwd", "http://[::1]/photo.png"):
        refused = member_client.post(f"{DIARY}/{meal['id']}/photo/link", json={"url": url})
        assert refused.status_code == 422, (url, refused.text)
    assert keys(member_client.account["member_id"]) == []


# ---- who sees it ------------------------------------------------------------------------

def test_the_console_sees_a_meal_photo_with_its_diary_entry_and_only_under_its_own_member(member_client, admin_client):
    """The diary is outside the sharing choice (Cara, 25 Nov 2026): no
    permission is asked, and none of it is reachable through another member."""
    meal = add_meal(member_client)
    assert put_photo(member_client, meal["id"], picture()).status_code == 200
    member_id = member_client.account["member_id"]
    route = f"/api/v1/admin/members/{member_id}/food-diary/{meal['id']}/photo"

    shown = admin_client.get(route)
    assert shown.status_code == 200 and max(decode(shown.content).size) == 400, "the thumbnail by default"
    assert max(decode(admin_client.get(route + "?size=full").content).size) == 1600
    assert admin_client.get(f"/api/v1/admin/members/{member_id}").json()["food_diary"][0]["photo_version"]
    assert TestClient(app).get(route).status_code == 401

    with TestClient(app) as other:
        created = sign_up(other, email="also.sharing@demo.veye.test")
        assert created.status_code == 201
        other_id = created.json()["account"]["member_id"]
        assert other.get(route).status_code == 401, "a member session opens no console route"
    assert admin_client.get(f"/api/v1/admin/members/{other_id}/food-diary/{meal['id']}/photo").status_code == 404

    # A member who asked to be deleted: closed at once, before the purge.
    with SessionLocal() as db:
        from datetime import datetime, timezone

        from app.members.models import Member

        db.get(Member, __import__("uuid").UUID(member_id)).erasure_requested_at = datetime.now(timezone.utc)
        db.commit()
    assert admin_client.get(route).status_code == 404
    assert admin_client.get(f"/api/v1/admin/members/{member_id}").json()["food_diary"] == []


# ---- erasure ------------------------------------------------------------------------------

def test_deleting_my_data_removes_every_meal_photo(member_client):
    for description in ("Porridge", "Salad", "Stew"):
        meal = add_meal(member_client, description)
        assert put_photo(member_client, meal["id"], picture(size=(120, 90))).status_code == 200
    member_id = member_client.account["member_id"]
    # A stray object under the member's prefix (a delete that once failed) goes too.
    get_runtime().media_store.put(f"{member_prefix(member_id)}orphan/old.jpg", picture(size=(10, 10)), "image/jpeg")
    assert len(keys(member_id)) == 7

    verify_member_email(member_client)
    done = member_client.post("/api/v1/members/me/erasure", json={"password": MEMBER_PASSWORD, "confirm": "DELETE"})
    assert done.status_code == 202, done.text
    assert done.json()["state"] == "erased"
    assert done.json()["receipt"]["meal_photo_objects"] == 7
    assert keys(member_id) == []
