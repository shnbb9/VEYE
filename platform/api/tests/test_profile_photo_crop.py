"""Profile pictures: the person's own crop, and the original kept to crop again.

The owner asked (15 Nov 2026) for an Instagram-style circular crop: the
avatar must be EXACTLY the square chosen in the frame, the original must not
be thrown away, and the picture must be re-croppable without a new upload.

Every image here is real (decoded by Pillow), and each test checks pixels,
not just status codes: a picture in four coloured quadrants makes a crop that
lands in the wrong place show up as the wrong colour.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.auth.models import UserAccount
from app.core.runtime import get_runtime
from app.db.session import SessionLocal
from app.main import app
from tests.conftest import admin_sign_in

RED, GREEN, BLUE, YELLOW = (220, 30, 30), (30, 200, 60), (40, 60, 220), (240, 220, 20)


def quadrants(width=400, height=300, fmt="PNG", split=(200, 150), exif: bytes | None = None) -> bytes:
    """Top-left red, top-right green, bottom-left blue, bottom-right yellow."""
    picture = Image.new("RGB", (width, height), YELLOW)
    sx, sy = split
    picture.paste(RED, (0, 0, sx, sy))
    picture.paste(GREEN, (sx, 0, width, sy))
    picture.paste(BLUE, (0, sy, sx, height))
    out = io.BytesIO()
    picture.save(out, format=fmt, **({"exif": exif} if exif else {}), **({"quality": 95} if fmt == "JPEG" else {}))
    return out.getvalue()


def near(pixel, colour, tolerance=40) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(pixel[:3], colour))


def decode(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as picture:
        picture.load()
        return picture.convert("RGB")


def at(picture: Image.Image, fx: float, fy: float):
    return picture.getpixel((int(picture.width * fx), int(picture.height * fy)))


def upload(client: TestClient, data: bytes, crop: dict | None = None, *, admin=False, mime="image/png", name="me.png"):
    route = "/api/v1/admin/account/photo" if admin else "/api/v1/members/me/photo"
    fields = {f"crop_{k}": str(v) for k, v in (crop or {}).items()}
    return client.post(route, files={"file": (name, io.BytesIO(data), mime)}, data=fields)


def stored(email: str) -> UserAccount:
    with SessionLocal() as db:
        user = db.query(UserAccount).filter(UserAccount.email == email).one()
        db.expunge(user)
        return user


# ---- the avatar is the chosen square -------------------------------------------

def test_the_avatar_is_exactly_the_square_chosen_in_the_frame(member_client):
    # A square straddling all four quadrants: x 100..300, y 0..200. In the
    # avatar the colour boundary must sit at 50% across and 75% down.
    response = upload(member_client, quadrants(), {"x": 100, "y": 0, "size": 200})
    assert response.status_code == 201, response.text
    assert response.json()["photo_crop"] == {"width": 400, "height": 300, "x": 100, "y": 0, "size": 200}

    full = decode(member_client.get("/api/v1/members/me/photo?size=full").content)
    thumb = decode(member_client.get("/api/v1/members/me/photo?size=thumb").content)
    assert full.size == (200, 200), "never enlarged: a 200 px square stays 200 px"
    assert thumb.size == (128, 128)
    for variant in (full, thumb):
        assert near(at(variant, 0.25, 0.35), RED) and near(at(variant, 0.75, 0.35), GREEN)
        assert near(at(variant, 0.25, 0.90), BLUE) and near(at(variant, 0.75, 0.90), YELLOW)


def test_without_a_crop_the_avatar_is_the_centred_square(member_client):
    assert upload(member_client, quadrants()).status_code == 201
    crop = member_client.get("/api/v1/auth/me").json()["member"]["photo_crop"]
    assert crop == {"width": 400, "height": 300, "x": 50, "y": 0, "size": 300}
    full = decode(member_client.get("/api/v1/members/me/photo").content)
    assert full.size == (300, 300)
    assert near(at(full, 0.2, 0.2), RED) and near(at(full, 0.8, 0.8), YELLOW)


def test_a_large_crop_is_scaled_down_to_the_bounded_variants(member_client):
    big = quadrants(width=2400, height=1800, split=(1200, 900), fmt="JPEG")
    response = upload(member_client, big, {"x": 1000, "y": 700, "size": 400}, mime="image/jpeg", name="big.jpg")
    assert response.status_code == 201, response.text
    full = decode(member_client.get("/api/v1/members/me/photo?size=full").content)
    assert full.size == (400, 400)
    response = upload(member_client, big, {"x": 0, "y": 0, "size": 1800}, mime="image/jpeg", name="big.jpg")
    full = decode(member_client.get("/api/v1/members/me/photo?size=full").content)
    thumb = decode(member_client.get("/api/v1/members/me/photo?size=thumb").content)
    assert full.size == (512, 512) and thumb.size == (128, 128)
    # 1800 px square from the top-left: red occupies x<1200 (2/3), y<900 (1/2).
    assert near(at(full, 0.3, 0.25), RED) and near(at(full, 0.85, 0.25), GREEN) and near(at(full, 0.3, 0.75), BLUE)


def test_a_sideways_phone_photo_is_cropped_the_way_people_see_it(member_client):
    # What the person sees: 200 wide, 300 tall; red on top, blue below. The
    # camera stored it rotated, with EXIF orientation 6 (turn 90° clockwise).
    seen = Image.new("RGB", (200, 300), BLUE)
    seen.paste(RED, (0, 0, 200, 150))
    stored_pixels = seen.transpose(Image.Transpose.ROTATE_90)  # 300 x 200 as the sensor wrote it
    exif = Image.Exif()
    exif[0x0112] = 6
    out = io.BytesIO()
    stored_pixels.save(out, format="JPEG", quality=95, exif=exif.tobytes())

    response = upload(member_client, out.getvalue(), {"x": 0, "y": 0, "size": 140}, mime="image/jpeg", name="phone.jpg")
    assert response.status_code == 201, response.text
    assert response.json()["photo_crop"]["width"] == 200 and response.json()["photo_crop"]["height"] == 300
    full = decode(member_client.get("/api/v1/members/me/photo").content)
    assert near(at(full, 0.5, 0.5), RED), "the top of the photo as seen, not as the sensor stored it"
    original = member_client.get("/api/v1/members/me/photo?size=original").content
    with Image.open(io.BytesIO(original)) as kept:
        assert kept.size == (200, 300) and not kept.getexif(), "kept upright, and with no metadata"


# ---- the original stays, and only its owner reads it ----------------------------

def test_the_original_is_kept_whole_and_only_for_its_owner(member_client, admin_client):
    assert upload(member_client, quadrants(), {"x": 0, "y": 0, "size": 150}).status_code == 201
    original = decode(member_client.get("/api/v1/members/me/photo?size=original").content)
    assert original.size == (400, 300), "the whole picture, not the crop"
    assert near(at(original, 0.9, 0.9), YELLOW)

    member_id = member_client.account["member_id"]
    console = decode(admin_client.get(f"/api/v1/admin/members/{member_id}/photo").content)
    assert console.size == (150, 150), "the console sees the avatar, never the original"
    assert near(at(console, 0.5, 0.5), RED)


def test_recropping_cuts_again_from_the_original_without_a_new_upload(member_client):
    first = upload(member_client, quadrants(), {"x": 0, "y": 0, "size": 150}).json()
    original_before = member_client.get("/api/v1/members/me/photo?size=original").content

    again = member_client.put("/api/v1/members/me/photo/crop", json={"x": 250, "y": 150, "size": 150})
    assert again.status_code == 200, again.text
    assert again.json()["photo_version"] != first["photo_version"], "a new crop is a new avatar for every cache"
    assert again.json()["photo_crop"] == {"width": 400, "height": 300, "x": 250, "y": 150, "size": 150}
    assert near(at(decode(member_client.get("/api/v1/members/me/photo").content), 0.5, 0.5), YELLOW)
    assert near(at(decode(member_client.get("/api/v1/members/me/photo?size=thumb").content), 0.5, 0.5), YELLOW)
    assert member_client.get("/api/v1/members/me/photo?size=original").content == original_before

    # The variants of the earlier crop are gone; the original is not.
    user = stored(member_client.account["email"])
    store = get_runtime().media_store
    assert store.exists(user.photo_original_key)
    assert sum(1 for key in store.list_keys(f"profile-photos/{user.id}/")) == 3


@pytest.mark.parametrize("crop, status", [
    ({"x": 300, "y": 0, "size": 150}, 422),     # runs off the right edge
    ({"x": 0, "y": 200, "size": 150}, 422),     # runs off the bottom
    ({"x": 0, "y": 0, "size": 301}, 422),       # larger than the picture
    ({"x": 0, "y": 0, "size": 8}, 422),         # too small to be a picture of anyone
    ({"x": -1, "y": 0, "size": 100}, 422),
    ({"x": 0, "y": 0}, 422),                    # half a crop
])
def test_a_crop_must_stay_inside_the_picture(member_client, crop, status):
    assert upload(member_client, quadrants(), crop).status_code == status
    assert member_client.get("/api/v1/members/me/photo").status_code == 404, "nothing was saved"
    assert upload(member_client, quadrants()).status_code == 201
    if set(crop) == {"x", "y", "size"}:
        assert member_client.put("/api/v1/members/me/photo/crop", json=crop).status_code == status


def test_removing_the_picture_removes_its_original_too(member_client):
    assert upload(member_client, quadrants(), {"x": 10, "y": 10, "size": 100}).status_code == 201
    user = stored(member_client.account["email"])
    store = get_runtime().media_store
    assert store.exists(user.photo_original_key)
    removed = member_client.delete("/api/v1/members/me/photo")
    assert removed.status_code == 200 and removed.json()["photo_crop"] is None
    assert not store.exists(user.photo_original_key)
    assert list(store.list_keys(f"profile-photos/{user.id}/")) == []
    assert member_client.get("/api/v1/members/me/photo?size=original").status_code == 404


def test_a_picture_saved_before_cropping_says_why_it_cannot_be_recropped(member_client):
    assert upload(member_client, quadrants()).status_code == 201
    with SessionLocal() as db:
        user = db.query(UserAccount).filter(UserAccount.email == member_client.account["email"]).one()
        user.photo_original_key = None  # the shape of every picture saved before 15 Nov
        db.commit()
    assert member_client.get("/api/v1/auth/me").json()["member"]["photo_crop"] is None
    refused = member_client.put("/api/v1/members/me/photo/crop", json={"x": 0, "y": 0, "size": 100})
    assert refused.status_code == 409 and "Upload it again" in refused.json()["detail"]


# ---- the console's own picture works the same way ---------------------------------

def test_an_administrator_crops_their_own_picture_and_peers_never_get_the_original(admin_client):
    response = upload(admin_client, quadrants(), {"x": 200, "y": 0, "size": 150}, admin=True)
    assert response.status_code == 201, response.text
    assert near(at(decode(admin_client.get("/api/v1/admin/account/photo").content), 0.5, 0.5), GREEN)
    assert admin_client.put("/api/v1/admin/account/photo/crop", json={"x": 0, "y": 150, "size": 150}).status_code == 200
    assert near(at(decode(admin_client.get("/api/v1/admin/account/photo?size=thumb").content), 0.5, 0.5), BLUE)
    assert decode(admin_client.get("/api/v1/admin/account/photo?size=original").content).size == (400, 300)

    me_id = admin_client.get("/api/v1/auth/me").json()["admin"]["id"]
    from app.seed.users import ADMIN_TWO, ensure_admin

    ensure_admin(account=ADMIN_TWO)
    with TestClient(app) as priya:
        assert admin_sign_in(priya, ADMIN_TWO.email, ADMIN_TWO.password).status_code == 200
        assert priya.get(f"/api/v1/admin/administrators/{me_id}/photo?size=original").status_code == 422
        seen = decode(priya.get(f"/api/v1/admin/administrators/{me_id}/photo?size=full").content)
        assert seen.size == (150, 150) and near(at(seen, 0.5, 0.5), BLUE)
    admin_client.delete("/api/v1/admin/account/photo")
