"""One person, two portals, one picture (architecture V2 §5).

  * an administrator-only account can give itself its own member profile —
    the same account and password, re-authenticated, idempotent, audited —
    and the member door then shows that person their own records only;
  * each administrator has their own picture, changed only by themselves, and
    a person with both kinds of access has one picture in both portals;
  * a picture is accepted only if it really decodes as a still JPEG/PNG/WebP,
    and it is rebuilt from its pixels, so metadata such as GPS never survives.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.admin.models import AdminAuditEntry
from app.auth.models import UserAccount
from app.db.session import SessionLocal
from app.main import app
from app.members.models import Member
from tests.conftest import admin_sign_in, sign_in

CARA = ("cara.hogue@demo.veye.test", "CaraAdmin!2026-local")
PRIYA = ("priya.ops@demo.veye.test", "PriyaOps!2026-local")


def image(fmt: str = "PNG", size=(64, 48), color=(120, 160, 60), exif: bytes | None = None) -> bytes:
    out = io.BytesIO()
    picture = Image.new("RGB", size, color)
    kwargs = {"exif": exif} if exif else {}
    picture.save(out, format=fmt, **kwargs)
    return out.getvalue()


def upload(client: TestClient, data: bytes, name="me.png", mime="image/png"):
    return client.post("/api/v1/admin/account/photo", files={"file": (name, io.BytesIO(data), mime)})


@pytest.fixture
def priya_client():
    from app.seed.users import ADMIN_TWO, ensure_admin

    ensure_admin(account=ADMIN_TWO)
    with TestClient(app) as http:
        assert admin_sign_in(http, *PRIYA).status_code == 200
        yield http


# ---- create my member profile ----------------------------------------------------------------

def test_an_admin_only_account_gets_its_own_member_profile_on_the_same_account(admin_client):
    # Before: the member door refuses this account.
    door = TestClient(app)
    assert sign_in(door, CARA[0], CARA[1]).status_code == 403

    wrong = admin_client.post("/api/v1/admin/account/member-profile", json={"password": "not-it", "understood": True})
    assert wrong.status_code == 403
    unread = admin_client.post("/api/v1/admin/account/member-profile", json={"password": CARA[1]})
    assert unread.status_code == 422, "the explanation must be acknowledged"
    with SessionLocal() as db:
        assert db.query(UserAccount).filter(UserAccount.email == CARA[0]).one().member_id is None

    made = admin_client.post("/api/v1/admin/account/member-profile", json={"password": CARA[1], "understood": True})
    assert made.status_code == 201, made.text
    member_id = made.json()["member_id"]
    again = admin_client.post("/api/v1/admin/account/member-profile", json={"password": CARA[1], "understood": True})
    assert again.status_code == 200 and again.json() == {**again.json(), "member_id": member_id, "created": False}
    with SessionLocal() as db:
        accounts = db.query(UserAccount).filter(UserAccount.email == CARA[0]).all()
        assert len(accounts) == 1, "no second identity"
        assert str(accounts[0].member_id) == member_id and accounts[0].admin_access is True
        assert db.query(Member).filter(Member.email == CARA[0]).count() == 1
        assert db.query(AdminAuditEntry).filter(AdminAuditEntry.action == "account.member_profile_created").count() == 1

    # After: the same password opens the member door, which shows her own records only.
    signed = sign_in(door, CARA[0], CARA[1])
    assert signed.status_code == 200, signed.text
    me = door.get("/api/v1/auth/me").json()
    assert me["member"]["member_id"] == member_id and me["admin"] is None, "the member door gives no console session"
    assert door.get("/api/v1/members/me/health-number").json()["history"] == []
    assert door.get("/api/v1/admin/members").status_code == 401
    # The console session is untouched.
    assert admin_client.get("/api/v1/auth/me").json()["admin"]["email"] == CARA[0]


def test_a_member_session_cannot_reach_the_console_profile_route(member_client):
    refused = member_client.post("/api/v1/admin/account/member-profile", json={"password": "x", "understood": True})
    assert refused.status_code == 401


# ---- pictures ---------------------------------------------------------------------------------

def test_two_administrators_keep_their_own_pictures(admin_client, priya_client):
    red, blue = image(color=(200, 30, 30)), image(color=(30, 30, 200))
    assert upload(admin_client, red).status_code == 201
    assert upload(priya_client, blue).status_code == 201
    cara_photo = admin_client.get("/api/v1/admin/account/photo?size=full").content
    priya_photo = priya_client.get("/api/v1/admin/account/photo?size=full").content
    with Image.open(io.BytesIO(cara_photo)) as a, Image.open(io.BytesIO(priya_photo)) as b:
        assert a.convert("RGB").getpixel((5, 5))[0] > 150 and b.convert("RGB").getpixel((5, 5))[2] > 150
    rows = {r["email"]: r for r in admin_client.get("/api/v1/admin/administrators").json()["rows"]}
    assert rows[CARA[0]]["photo_version"] and rows[PRIYA[0]]["photo_version"]
    assert rows[CARA[0]]["photo_version"] != rows[PRIYA[0]]["photo_version"]
    # Cara can SEE Priya's picture in the list…
    seen = admin_client.get(f"/api/v1/admin/administrators/{rows[PRIYA[0]]['user_id']}/photo")
    assert seen.status_code == 200
    # …and has no way to change it: the only writable photo route is her own.
    for method in ("post", "put", "delete"):
        attempt = getattr(admin_client, method)(f"/api/v1/admin/administrators/{rows[PRIYA[0]]['user_id']}/photo")
        assert attempt.status_code == 405
    assert priya_client.get("/api/v1/admin/account/photo?size=full").content == priya_photo


def test_a_members_picture_is_not_served_as_an_administrators(admin_client, member_client):
    member_client.post("/api/v1/members/me/photo", files={"file": ("me.png", io.BytesIO(image()), "image/png")})
    member_user = member_client.get("/api/v1/auth/me").json()["member"]["id"]
    assert admin_client.get(f"/api/v1/admin/administrators/{member_user}/photo").status_code == 404


def test_replacing_and_removing_a_picture_cleans_up_its_objects(admin_client):
    from app.core.runtime import get_runtime
    from app.storage.images import thumb_key

    assert upload(admin_client, image(color=(10, 200, 10))).status_code == 201
    with SessionLocal() as db:
        first = db.query(UserAccount).filter(UserAccount.email == CARA[0]).one().photo_object_key
    store = get_runtime().media_store
    assert store.get(first) and store.get(thumb_key(first))
    upload(admin_client, image(color=(200, 200, 10)))
    with pytest.raises(KeyError):
        store.get(first)
    with pytest.raises(KeyError):
        store.get(thumb_key(first))
    removed = admin_client.delete("/api/v1/admin/account/photo")
    assert removed.status_code == 200 and removed.json()["photo_version"] is None
    assert admin_client.get("/api/v1/admin/account/photo").status_code == 404


def test_variants_are_bounded_and_metadata_does_not_survive(admin_client):
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (51.0, 30.0, 0.0)}  # GPSInfo
    exif[0x0110] = "Secret Camera 3000"            # Model
    original = image("JPEG", size=(2000, 1500), exif=exif.tobytes())
    with Image.open(io.BytesIO(original)) as check:
        assert check.getexif(), "precondition: the upload really carries EXIF"
    assert upload(admin_client, original, "me.jpg", "image/jpeg").status_code == 201
    full = admin_client.get("/api/v1/admin/account/photo?size=full").content
    thumb = admin_client.get("/api/v1/admin/account/photo?size=thumb").content
    with Image.open(io.BytesIO(full)) as f, Image.open(io.BytesIO(thumb)) as t:
        assert max(f.size) == 512 and max(t.size) == 128
        assert not f.getexif() and not t.getexif()
    assert b"Secret Camera" not in full and b"Exif" not in full


GIF = image("GIF")


def animated_png() -> bytes:
    out = io.BytesIO()
    first, second = Image.new("RGB", (16, 16), (255, 0, 0)), Image.new("RGB", (16, 16), (0, 0, 255))
    first.save(out, format="PNG", save_all=True, append_images=[second], duration=100, loop=0)
    return out.getvalue()


APNG = animated_png()
SVG = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.mark.parametrize(("name", "data", "mime", "status"), [
    ("x.svg", SVG, "image/svg+xml", 415),
    ("x.png", SVG, "image/png", 415),
    ("x.gif", GIF, "image/gif", 415),
    ("x.png", GIF, "image/png", 415),
    ("x.png", b"not an image at all", "image/png", 415),
    ("x.png", image()[:40], "image/png", 415),
    ("x.png", image() + b"\0" * 2_100_000, "image/png", 413),
    ("x.png", image(size=(7000, 4)), "image/png", 422),
    ("x.png", APNG, "image/png", 415),
    ("x.jpg", image("PNG"), "image/jpeg", 201),  # the bytes decide the type, consistently, not the label
], ids=["svg", "svg-labelled-png", "gif", "gif-labelled-png", "text", "truncated", "oversize", "too-wide",
        "animated-png", "png-labelled-jpeg"])
def test_only_real_still_images_are_accepted(admin_client, name, data, mime, status):
    response = upload(admin_client, data, name, mime)
    assert response.status_code == status, response.text


def test_a_dual_access_person_has_one_picture_in_both_portals(admin_client):
    """Created through the console's own invitation of an existing member."""
    from tests.conftest import sign_up

    member = TestClient(app)
    member.__enter__()
    sign_up(member, email="dual.picture@demo.veye.test", password="DualPicture!2026-local")
    invited = admin_client.post("/api/v1/admin/administrators/invite",
                                json={"email": "dual.picture@demo.veye.test", "first_name": "Dual", "last_name": "Picture"})
    assert invited.status_code in (200, 201), invited.text
    member.post("/api/v1/members/me/photo", files={"file": ("me.png", io.BytesIO(image(color=(250, 120, 0))), "image/png")})
    with SessionLocal() as db:
        user = db.query(UserAccount).filter(UserAccount.email == "dual.picture@demo.veye.test").one()
        assert user.photo_object_key and user.admin_access
    seen_by_console = admin_client.get(f"/api/v1/admin/administrators/{user.id}/photo?size=full").content
    assert seen_by_console == member.get("/api/v1/members/me/photo").content
