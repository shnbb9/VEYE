"""Food Choices over HTTP: the lists, the member's checklist, the HOW TO plan.

The rules themselves are tested without a database in
`test_food_choices_rules.py` and `test_food_choices_how_to.py`. What is tested
here is the boundary: that the routes belong to one member, that a food from
the wrong list is refused rather than stored, and that a write-in is kept as
the member wrote it and gains nothing the source never gave it.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.food_choices import catalog
from app.main import app
from tests.conftest import sign_up

BASE = "/api/v1/members/me/food-choices"


# ---- the lists --------------------------------------------------------------

def test_the_lists_need_to_know_who_they_are_for(member_client):
    """Every portion in the source is stated for a woman or for a man, so
    picking one would be inventing the member's amounts."""
    assert member_client.get(f"{BASE}/catalog").status_code == 422
    assert member_client.get(f"{BASE}/catalog", params={"sex": "other"}).status_code == 422
    assert member_client.get(f"{BASE}/catalog", params={"sex": "woman"}).status_code == 200


def test_the_lists_come_back_grouped_by_the_sources_own_tiers(member_client):
    body = member_client.get(f"{BASE}/catalog", params={"sex": "woman"}).json()
    assert body["sex"] == "woman"
    assert "AI Chatbot Training" in body["source"]
    groups = {g["group"]: g for g in body["groups"]}
    assert set(groups) == set(catalog.GROUPS)

    protein_tiers = [t["tier"] for t in groups["protein"]["tiers"]]
    assert protein_tiers == ["best", "fair", "poor"]
    best = next(t for t in groups["protein"]["tiers"] if t["tier"] == "best")
    assert best["label"] == "Best choices"
    fish = next(f for f in best["foods"] if f["name"] == "Fish")
    assert fish["portion"] == "5oz"
    assert fish["source_ref"] == "p0507"


def test_the_amounts_follow_the_person_and_the_occasion(member_client):
    def fish(sex, occasion):
        body = member_client.get(f"{BASE}/catalog", params={"sex": sex, "occasion": occasion}).json()
        proteins = next(g for g in body["groups"] if g["group"] == "protein")
        best = next(t for t in proteins["tiers"] if t["tier"] == "best")
        return next(f for f in best["foods"] if f["name"] == "Fish")["portion"]

    assert fish("woman", "meal") == "5oz"
    assert fish("man", "meal") == "7oz"
    assert fish("woman", "snack") == "half of 5oz"


def test_a_food_the_source_gives_no_amount_for_comes_back_as_null(member_client):
    body = member_client.get(f"{BASE}/catalog", params={"sex": "woman"}).json()
    carbs = next(g for g in body["groups"] if g["group"] == "carbohydrate")
    fruits = next(t for t in carbs["tiers"] if t["tier"] == "favorable_fruit")
    lemon = next(f for f in fruits["foods"] if f["name"] == "Lemon")
    assert lemon["portion"] is None, "an amount was invented for a food that has none"


def test_the_tier_allowance_is_returned_where_the_source_states_one(member_client):
    body = member_client.get(f"{BASE}/catalog", params={"sex": "man"}).json()
    carbs = next(g for g in body["groups"] if g["group"] == "carbohydrate")
    tiers = {t["tier"]: t for t in carbs["tiers"]}
    assert tiers["super_favorable"]["allowance"] == "unlimited raw or cooked"
    assert tiers["very_favorable"]["allowance"] == "6 cups per meal"
    assert tiers["unfavorable_grain"]["allowance"] is None


def test_the_lists_carry_the_exclusions_the_source_insists_on(member_client):
    notes = member_client.get(f"{BASE}/catalog", params={"sex": "woman"}).json()["notes"]
    assert "not proteins" in notes["not_protein"]
    assert "Whole grains" in notes["whole_grain"]
    assert "raw tofu" in notes["raw_tofu"]


def test_an_unknown_occasion_is_refused(member_client):
    assert member_client.get(f"{BASE}/catalog", params={"sex": "woman", "occasion": "brunch"}).status_code == 422


# ---- the member's checklist --------------------------------------------------

def test_a_member_starts_with_an_empty_checklist(member_client):
    body = member_client.get(f"{BASE}/selections").json()
    assert body["sex"] == ""
    assert body["selections"] == {"protein": [], "carbohydrate": [], "fat": []}
    assert body["write_ins"] == {}


def test_the_checklist_saves_and_reads_back(member_client):
    saved = member_client.put(f"{BASE}/selections", json={
        "sex": "woman",
        "selections": {"protein": ["Fish", "Egg whites"], "carbohydrate": ["Broccoli"], "fat": ["Olives"]},
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["selections"]["protein"] == ["Fish", "Egg whites"]
    assert member_client.get(f"{BASE}/selections").json() == saved.json()


def test_a_food_on_another_list_is_refused_rather_than_stored(member_client):
    refused = member_client.put(f"{BASE}/selections", json={
        "selections": {"protein": ["Lentils"]}})
    assert refused.status_code == 422
    assert "carbohydrate list" in refused.text


def test_a_food_on_no_list_is_refused_and_points_at_the_write_in(member_client):
    refused = member_client.put(f"{BASE}/selections", json={
        "selections": {"protein": ["Ostrich jerky"]}})
    assert refused.status_code == 422
    assert "write-in" in refused.text


def test_a_write_in_is_kept_as_the_member_wrote_it_and_gains_nothing(member_client):
    saved = member_client.put(f"{BASE}/selections", json={
        "sex": "man",
        "selections": {"protein": ["Fish"]},
        "write_ins": {"protein:best": ["my grandmother's lentil stew", "biltong"]},
    })
    assert saved.status_code == 200
    body = saved.json()
    assert body["write_ins"]["protein:best"] == ["my grandmother's lentil stew", "biltong"]
    # No tier, no portion, no verdict anywhere near it.
    assert "amounts and favourability only for the foods on them" in body["write_in_note"]


def test_a_blank_write_in_is_dropped_and_duplicates_collapse(member_client):
    body = member_client.put(f"{BASE}/selections", json={
        "write_ins": {"fat:best": ["  ", "biltong", "biltong", ""]}}).json()
    assert body["write_ins"] == {"fat:best": ["biltong"]}


def test_a_write_in_belongs_to_one_section_of_the_lists(member_client):
    """"best" and "poor" are tier names on both the protein list and the fat
    list, so a tier-only key filed one member's own food under two sections of
    the screen. The key names the group as well."""
    refused = member_client.put(f"{BASE}/selections", json={"write_ins": {"best": ["biltong"]}})
    assert refused.status_code == 422
    assert "not a section of the food lists" in refused.text

    assert member_client.put(f"{BASE}/selections", json={
        "write_ins": {"protein:best": ["biltong"]}}).status_code == 200
    # A real group with a tier that is not one of its own is refused too.
    assert member_client.put(f"{BASE}/selections", json={
        "write_ins": {"protein:super_favorable": ["biltong"]}}).status_code == 422


def test_an_unknown_group_is_refused(member_client):
    assert member_client.put(f"{BASE}/selections", json={"selections": {"vitamins": []}}).status_code == 422


def test_one_members_checklist_is_not_anothers(member_client):
    member_client.put(f"{BASE}/selections", json={"sex": "woman", "selections": {"protein": ["Fish"]}})

    other = TestClient(app)
    assert sign_up(other, email="foodlists@demo.veye.test", first_name="Other").status_code == 201
    theirs = other.get(f"{BASE}/selections").json()
    assert theirs["selections"]["protein"] == []
    assert theirs["sex"] == ""


def test_the_lists_and_the_checklist_need_a_member_session():
    anonymous = TestClient(app)
    assert anonymous.get(f"{BASE}/catalog", params={"sex": "woman"}).status_code == 401
    assert anonymous.get(f"{BASE}/selections").status_code == 401
    assert anonymous.post(f"{BASE}/how-to", json={"sex": "woman"}).status_code == 401


def test_an_administrator_session_is_not_a_member_session(admin_client):
    assert admin_client.get(f"{BASE}/selections").status_code in (401, 403)


# ---- the HOW TO plan ---------------------------------------------------------

def test_there_is_no_plan_until_one_is_started(member_client):
    assert member_client.get(f"{BASE}/how-to").json() is None


def test_starting_a_plan_asks_what_time_they_get_up(member_client):
    started = member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    assert started.status_code == 201, started.text
    body = started.json()
    assert body["step"] == "wake_time"
    assert body["prompt"]["answer"] == "time"
    assert body["prompt"]["source_ref"] == "p0285"
    assert body["occasions"] == []


def test_a_plan_needs_a_sex_because_the_portions_differ(member_client):
    assert member_client.post(f"{BASE}/how-to", json={"sex": "other"}).status_code == 422
    assert member_client.post(f"{BASE}/how-to", json={}).status_code == 422


def test_starting_a_plan_remembers_the_sex_on_the_checklist(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "man"})
    assert member_client.get(f"{BASE}/selections").json()["sex"] == "man"


def test_the_plan_walks_protein_then_carbohydrate_then_fat(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})

    def answer(**payload):
        response = member_client.post(f"{BASE}/how-to/answer", json=payload)
        assert response.status_code == 200, response.text
        return response.json()

    after_wake = answer(time="07:00")
    assert after_wake["step"] == "occasion"
    assert any("8:00 am" in note for note in after_wake["prompt"]["notes"])

    after_kind = answer(choice="meal")
    assert after_kind["step"] == "protein"
    assert "Fish" in after_kind["prompt"]["candidates"]

    after_protein = answer(foods=["Fish"], cooked=True)
    assert after_protein["step"] == "carbohydrate"

    after_carbs = answer(foods=["Broccoli", "Chickpeas"])
    assert after_carbs["step"] == "fat"
    assert any("light olive oil" in note for note in after_carbs["prompt"]["notes"])

    after_fat = answer(foods=["Olives"])
    assert after_fat["step"] == "confirm"
    assert after_fat["prompt"]["recap"] == [
        "Fish - 5oz", "Broccoli - unlimited raw or cooked",
        "Chickpeas - 1 cup per meal", "Olives - 9 olives",
    ]
    assert after_fat["occasions"][0]["at_label"] == "8:00 am"


def test_a_legume_offered_as_a_protein_is_corrected_and_not_stored(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    member_client.post(f"{BASE}/how-to/answer", json={"time": "07:00"})
    member_client.post(f"{BASE}/how-to/answer", json={"choice": "meal"})
    corrected = member_client.post(f"{BASE}/how-to/answer", json={"foods": ["Lentils"]}).json()
    assert corrected["step"] == "protein"
    assert corrected["occasions"][0]["proteins"] == []
    assert any("not proteins" in note for note in corrected["prompt"]["notes"])


def test_an_answer_the_step_cannot_take_is_refused(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    refused = member_client.post(f"{BASE}/how-to/answer", json={"time": "whenever"})
    assert refused.status_code == 422
    assert "HH:MM" in refused.text


def test_answering_with_no_plan_is_a_404(member_client):
    assert member_client.post(f"{BASE}/how-to/answer", json={"time": "07:00"}).status_code == 404


def test_a_finished_plan_is_still_there_after_a_reload(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    for payload in ({"time": "07:00"}, {"choice": "meal"}, {"foods": ["Fish"]},
                    {"foods": ["Broccoli", "Chickpeas"]}, {"foods": ["Olives"]},
                    {"choice": "yes"}, {"choice": "finished"}, {"time": "11:00"}):
        assert member_client.post(f"{BASE}/how-to/answer", json=payload).status_code == 200, payload

    reloaded = member_client.get(f"{BASE}/how-to").json()
    assert reloaded["complete"] is True
    assert reloaded["bedtime"] == "11:00"
    # The screen shows a clock a member reads, not a stored HH:MM.
    assert reloaded["bedtime_label"] == "11:00 am"
    assert reloaded["wake_label"] == "7:00 am"
    assert "within 4 hours" in reloaded["done_eating_reason"]      # p0316
    assert reloaded["occasions"][0]["confirmed"] is True


def test_a_finished_plan_cannot_be_answered_again(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    for payload in ({"time": "07:00"}, {"choice": "meal"}, {"foods": ["Fish"]},
                    {"foods": ["Broccoli", "Chickpeas"]}, {"foods": ["Olives"]},
                    {"choice": "yes"}, {"choice": "finished"}, {"time": "23:00"}):
        member_client.post(f"{BASE}/how-to/answer", json=payload)
    assert member_client.post(f"{BASE}/how-to/answer", json={"choice": "another"}).status_code == 422


def test_starting_a_second_plan_replaces_the_first(member_client):
    first = member_client.post(f"{BASE}/how-to", json={"sex": "woman"}).json()
    member_client.post(f"{BASE}/how-to/answer", json={"time": "07:00"})
    second = member_client.post(f"{BASE}/how-to", json={"sex": "man"}).json()
    assert second["id"] != first["id"]
    assert second["step"] == "wake_time"
    assert member_client.get(f"{BASE}/how-to").json()["id"] == second["id"]


def test_a_plan_can_be_discarded(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    assert member_client.delete(f"{BASE}/how-to").status_code == 204
    assert member_client.get(f"{BASE}/how-to").json() is None


def test_one_members_plan_is_not_anothers(member_client):
    member_client.post(f"{BASE}/how-to", json={"sex": "woman"})
    member_client.post(f"{BASE}/how-to/answer", json={"time": "07:00"})

    other = TestClient(app)
    assert sign_up(other, email="howtoplan@demo.veye.test", first_name="Other").status_code == 201
    assert other.get(f"{BASE}/how-to").json() is None
    assert other.post(f"{BASE}/how-to/answer", json={"time": "09:00"}).status_code == 404
