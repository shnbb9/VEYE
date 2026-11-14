"""Food Choices as the approved prototype shows it: the four checklists.

The owner chose the prototype's screen on 14 Nov 2026. What is tested here is
that the lists the API serves are the prototype's own (read from
`build/dashboard.html`, not from a second copy), that a ticked food must be a
name on its category's list, that a food the member adds keeps the member's
words and label and nothing more, and that one member's checklist is theirs.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.food_choices import checklist
from app.main import app
from tests.conftest import sign_up

BASE = "/api/v1/members/me/food-choices/checklist"
PROTOTYPE = Path(__file__).resolve().parents[3] / "build" / "dashboard.html"


def _prototype_lists() -> dict:
    """FOOD_CATEGORIES and FC_TIER_INFO as written in the prototype's script."""
    if not PROTOTYPE.exists():
        pytest.skip("the approved prototype is not in this checkout")
    source = PROTOTYPE.read_text(encoding="utf-8")
    block = source[source.index("const FOOD_CATEGORIES = {"):source.index("const FC_ORDER")]
    tier_info_block = source[source.index("const FC_TIER_INFO = {"):source.index("function renderFcContent")]
    order = re.findall(r"'(\w+)'", source[source.index("const FC_ORDER = ["):].split("]", 1)[0])
    quoted = r"'((?:[^'\\]|\\.)*)'"
    lists: dict = {}
    for key, body in re.findall(r"\n    (\w+): \{\n(.*?)\n    \}", block, flags=re.S):
        groups = [
            {"tier": tier, "label": label, "items": re.findall(quoted, items)}
            for tier, label, items in re.findall(
                r"\{ tier: '(\w+)', label: " + quoted + r",\s*items: \[(.*?)\] \}", body)
        ]
        lists[key] = {
            "label": re.search(r"label: " + quoted, body).group(1),
            "info": re.search(r"info: " + quoted, body).group(1),
            "groups": groups,
        }
    for key, text in re.findall(r"(\w+): " + quoted, tier_info_block):
        lists[key]["tier_info"] = text
    return {"order": order, "lists": lists}


# ---- the lists ---------------------------------------------------------------

def test_the_lists_are_the_prototypes_own(member_client):
    expected = _prototype_lists()
    body = member_client.get(f"{BASE}/catalog").json()
    assert [c["key"] for c in body["categories"]] == expected["order"]
    for served in body["categories"]:
        source = expected["lists"][served["key"]]
        assert served["label"] == source["label"]
        assert served["info"] == source["info"]
        assert served["tier_info"] == source["tier_info"]
        assert served["groups"] == source["groups"]
    assert body["custom_tiers"] == ["best", "fair", "limit"]


def test_the_lists_hold_every_food_once(member_client):
    body = member_client.get(f"{BASE}/catalog").json()
    counts = {}
    for served in body["categories"]:
        names = [item for group in served["groups"] for item in group["items"]]
        assert len(names) == len(set(names)), served["key"]
        counts[served["key"]] = len(names)
    assert counts == {"proteins": 32, "fats": 30, "favorable_carbs": 50, "unfavorable_carbs": 53}


# ---- the member's checklist --------------------------------------------------

def test_a_member_starts_with_an_empty_checklist(member_client):
    body = member_client.get(BASE).json()
    assert body["selections"] == {key: [] for key in checklist.ORDER}
    assert body["custom"] == {key: [] for key in checklist.ORDER}
    assert body["gotit"] == {key: False for key in checklist.ORDER}
    assert body["saved_at"] is None


def test_the_checklist_saves_and_reads_back(member_client):
    saved = member_client.put(BASE, json={
        "selections": {"proteins": ["Fish", "Egg whites"], "fats": ["Avocado"]},
        "custom": {"proteins": [{"name": "Venison jerky", "tier": "fair"}]},
        "gotit": {"proteins": True},
    })
    assert saved.status_code == 200, saved.text
    body = member_client.get(BASE).json()
    assert body["selections"]["proteins"] == ["Fish", "Egg whites"]
    assert body["selections"]["fats"] == ["Avocado"]
    assert body["selections"]["favorable_carbs"] == []
    assert body["custom"]["proteins"] == [{"name": "Venison jerky", "tier": "fair", "status": "pending"}]
    assert body["gotit"] == {"proteins": True, "fats": False, "favorable_carbs": False, "unfavorable_carbs": False}
    assert body["saved_at"]


def test_the_whole_checklist_is_replaced_and_a_category_left_out_is_saved_empty(member_client):
    member_client.put(BASE, json={"selections": {"proteins": ["Fish"], "fats": ["Avocado"]}})
    member_client.put(BASE, json={"selections": {"fats": ["Olives"]}})
    body = member_client.get(BASE).json()
    assert body["selections"]["proteins"] == []
    assert body["selections"]["fats"] == ["Olives"]


def test_a_food_from_another_list_is_refused_rather_than_stored(member_client):
    refused = member_client.put(BASE, json={"selections": {"proteins": ["Avocado"]}})
    assert refused.status_code == 422
    assert "not on the Proteins list" in refused.text
    assert member_client.get(BASE).json()["selections"]["proteins"] == []


def test_a_name_spelled_differently_from_the_list_is_refused(member_client):
    """Two spellings of one option once scored 0 elsewhere in this product."""
    assert member_client.put(BASE, json={"selections": {"proteins": ["egg whites"]}}).status_code == 422
    assert member_client.put(BASE, json={"selections": {"proteins": ["Egg whites "]}}).status_code == 422


def test_duplicates_collapse(member_client):
    member_client.put(BASE, json={
        "selections": {"proteins": ["Fish", "Fish"]},
        "custom": {"fats": [{"name": "Ghee", "tier": "fair"}, {"name": "Ghee", "tier": "limit"}]},
    })
    body = member_client.get(BASE).json()
    assert body["selections"]["proteins"] == ["Fish"]
    # The first is kept, as the prototype adds a name only once.
    assert body["custom"]["fats"] == [{"name": "Ghee", "tier": "fair", "status": "pending"}]


def test_a_food_of_your_own_needs_a_name_and_one_of_the_three_labels(member_client):
    for food in ({"name": "Ghee"}, {"name": "Ghee", "tier": ""}, {"name": "Ghee", "tier": "super"},
                 {"name": "   ", "tier": "best"}, {"name": "x" * 121, "tier": "best"}):
        assert member_client.put(BASE, json={"custom": {"fats": [food]}}).status_code == 422, food
    assert "Choose Best, Fair or Limit" in member_client.put(
        BASE, json={"custom": {"fats": [{"name": "Ghee", "tier": "poor"}]}}).text


def test_a_food_of_your_own_is_kept_as_written_and_its_review_is_not_the_members_to_set(member_client):
    member_client.put(BASE, json={"custom": {"proteins": [{"name": "  Bison burger ", "tier": "best"}]}})
    assert member_client.get(BASE).json()["custom"]["proteins"] == [
        {"name": "Bison burger", "tier": "best", "status": "pending"}]
    claimed = member_client.put(BASE, json={"custom": {"proteins": [
        {"name": "Bison burger", "tier": "best", "status": "approved"}]}})
    assert claimed.status_code == 422


def test_an_unknown_category_or_field_is_refused(member_client):
    assert member_client.put(BASE, json={"selections": {"vitamins": []}}).status_code == 422
    assert member_client.put(BASE, json={"custom": {"vitamins": []}}).status_code == 422
    assert member_client.put(BASE, json={"gotit": {"vitamins": True}}).status_code == 422
    assert member_client.put(BASE, json={"updated": "2026-11-15"}).status_code == 422


def test_one_members_checklist_is_not_anothers(member_client):
    member_client.put(BASE, json={"selections": {"proteins": ["Fish"]},
                                  "custom": {"fats": [{"name": "Ghee", "tier": "fair"}]},
                                  "gotit": {"fats": True}})
    other = TestClient(app)
    assert sign_up(other, email="foodchecklist@demo.veye.test", first_name="Other").status_code == 201
    theirs = other.get(BASE).json()
    assert theirs["selections"]["proteins"] == []
    assert theirs["custom"]["fats"] == []
    assert theirs["gotit"]["fats"] is False


def test_the_checklist_needs_a_member_session(admin_client):
    anonymous = TestClient(app)
    assert anonymous.get(f"{BASE}/catalog").status_code == 401
    assert anonymous.get(BASE).status_code == 401
    assert anonymous.put(BASE, json={}).status_code in (401, 403)
    assert admin_client.get(BASE).status_code in (401, 403)
    assert admin_client.put(BASE, json={}).status_code in (401, 403)


def test_ticking_a_food_counts_as_having_used_food_choices(member_client):
    from app.db.session import SessionLocal
    from app.food_choices.models import has_food_choices
    from app.members.models import Member

    with SessionLocal() as db:
        member_id = db.query(Member).one().id
        assert has_food_choices(db, member_id) is False
    member_client.put(BASE, json={"custom": {"fats": [{"name": "Ghee", "tier": "fair"}]}})
    with SessionLocal() as db:
        assert has_food_choices(db, member_id) is True
    member_client.put(BASE, json={})
    with SessionLocal() as db:
        assert has_food_choices(db, member_id) is False
    member_client.put(BASE, json={"selections": {"fats": ["Olives"]}})
    with SessionLocal() as db:
        assert has_food_choices(db, member_id) is True
