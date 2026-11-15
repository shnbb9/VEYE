"""Supplements as the approved prototype prints them (owner, 15 Nov 2026),
and the seed's one rule for content Cara can edit: a row the seed wrote and
nobody has touched follows the seed; a row edited in Care Studio never does.
"""

from __future__ import annotations

from app.care.models import STATUS_DRAFT, STATUS_PUBLISHED, CareContentItem
from app.db.session import SessionLocal
from app.seed.care import (
    POLYPHENOL_BODY_BEFORE_15_NOV,
    SEED_BY,
    VITAMIN_OVERVIEW_BODY,
    VITAMIN_OVERVIEW_BODY_BEFORE_15_NOV,
    seed_care,
)

POLY, VITAMINS = "Polyphenol suggested dosage", "Individual vitamin pros and cons"


def row(db, title: str) -> CareContentItem:
    return db.query(CareContentItem).filter(CareContentItem.kind == "supplement", CareContentItem.title == title).one()


def test_a_fresh_install_has_the_prototypes_supplements(member_client):
    seed_care()
    with SessionLocal() as db:
        assert row(db, POLY).body.splitlines() == ["500mg helps reduce oxidative stress", "1000mg helps reduce inflammation"]
        overview = row(db, VITAMINS)
        assert overview.status == STATUS_PUBLISHED and overview.published_at is not None
        assert overview.body.startswith("Here is a quick look at some of the major vitamins and minerals.")
        names = [part.split("**")[1] for part in overview.body.split("\n\n")[1:]]
        assert names == ["Vitamin D", "Vitamin B12", "Vitamin C", "Vitamin A", "Beta-carotene", "Vitamin E", "Zinc",
                         "Boron", "Vitamin K", "Calcium", "Selenium"]
    # Members read it among the section's published items.
    shown = member_client.get("/api/v1/care/supplement")
    assert shown.status_code == 200, shown.text
    titles = [item["title"] for item in shown.json()]
    assert VITAMINS in titles and POLY in titles


def _as_installed_before_15_nov(edited_by: str | None = None) -> None:
    seed_care()
    with SessionLocal() as db:
        poly, overview = row(db, POLY), row(db, VITAMINS)
        poly.body = POLYPHENOL_BODY_BEFORE_15_NOV
        overview.body, overview.status, overview.published_at, overview.published_by = (
            VITAMIN_OVERVIEW_BODY_BEFORE_15_NOV, STATUS_DRAFT, None, None)
        if edited_by:
            poly.updated_by = overview.updated_by = edited_by
        db.commit()


def test_an_untouched_older_install_follows_the_seed():
    _as_installed_before_15_nov()
    assert seed_care().get("care_items_upgraded") == 2
    with SessionLocal() as db:
        assert "1500mg" not in row(db, POLY).body
        overview = row(db, VITAMINS)
        assert overview.body == VITAMIN_OVERVIEW_BODY and overview.status == STATUS_PUBLISHED
        assert overview.published_at is not None and overview.published_by == SEED_BY
    assert not seed_care().get("care_items_upgraded"), "a second run changes nothing"


def test_a_row_cara_edited_is_never_overwritten():
    _as_installed_before_15_nov(edited_by="Cara Hogue")
    assert not seed_care().get("care_items_upgraded")
    with SessionLocal() as db:
        assert row(db, POLY).body == POLYPHENOL_BODY_BEFORE_15_NOV
        assert row(db, VITAMINS).status == STATUS_DRAFT
