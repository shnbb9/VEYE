"""Food Diary and Meal Planning at parity with the approved prototype
(build/dashboard.html): the stored prototype estimate, the day's Save and
History, the rule-based feedback, and Meal Planning's saved days and sample
days — each through the public API exactly as the browser drives it."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.food.models import FoodDiaryDay, FoodDiaryEntry
from app.main import app
from app.meal_plans.models import MealPlanDay
from app.meal_plans.samples import COPY_NOTE
from tests.conftest import sign_up

DIARY = "/api/v1/members/me/food-diary"
PLANS = "/api/v1/members/me/meal-plans"


def _second_member(email="maya.demo@demo.veye.test", first="Maya"):
    other = TestClient(app)
    assert sign_up(other, email=email, first_name=first, last_name="Demo").status_code == 201
    return other


def _meal(client, day, time, what, feelings=(), notes=""):
    response = client.post(DIARY, json={"entry_date": day, "meal_time": time, "description": what, "feelings": list(feelings), "notes": notes})
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------- food diary
def test_estimate_preview_is_calculated_not_stored(member_client, client):
    preview = member_client.post(f"{DIARY}/estimate", json={"description": "chicken"})
    assert preview.status_code == 200 and preview.json()["estimate"] == {"protein_g": 26, "carbs_g": 0, "fat_g": 3, "kcal": 131}
    assert member_client.post(f"{DIARY}/estimate", json={"description": "   "}).json()["estimate"] is None
    with SessionLocal() as db:
        assert db.query(FoodDiaryEntry).count() == 0
    anonymous = TestClient(app)
    assert anonymous.post(f"{DIARY}/estimate", json={"description": "chicken"}).status_code == 401


def test_entries_store_the_estimate_and_the_day_totals(member_client):
    day = "2026-10-01"
    _meal(member_client, day, "08:00", "2 eggs on toast")            # egg + toast
    view = _meal(member_client, day, "12:30", "Grilled chicken salad with avocado", ["Hungry"])
    first, second = view["meals"]
    assert (first["protein_g"], first["carbs_g"], first["fat_g"], first["kcal"]) == (14, 31, 9, 261)
    assert (second["protein_g"], second["carbs_g"], second["fat_g"], second["kcal"]) == (30, 17, 18, 350)
    assert view["totals"] == {"protein_g": 44, "carbs_g": 48, "fat_g": 27, "kcal": 611}
    assert view["history"][0] == {**view["history"][0], "entry_date": day, "meals": 2, "kcal": 611, "saved": False}
    with SessionLocal() as db:
        stored = db.query(FoodDiaryEntry).filter(FoodDiaryEntry.description == "2 eggs on toast").one()
        assert (stored.protein_g, stored.kcal, stored.estimate_version) == (14, 261, "fdx-prototype-1")


def test_editing_an_entry_re_estimates_it(member_client):
    day = "2026-10-02"
    meal = _meal(member_client, day, "08:00", "Porridge")["meals"][0]
    updated = member_client.put(f"{DIARY}/{meal['id']}", json={"entry_date": day, "meal_time": "08:15", "description": "Salmon"}).json()
    assert (updated["meals"][0]["protein_g"], updated["meals"][0]["kcal"]) == (22, 142)


def test_rows_saved_before_the_estimate_existed_are_estimated_on_read(member_client):
    member_id = UUID(member_client.account["member_id"])
    with SessionLocal() as db:
        db.add(FoodDiaryEntry(member_id=member_id, entry_date=date(2026, 9, 1), meal_time="09:00", description="Eggs",
                              feelings=[], notes=""))
        db.commit()
    meal = member_client.get(DIARY, params={"date": "2026-09-01"}).json()["meals"][0]
    assert (meal["protein_g"], meal["carbs_g"], meal["fat_g"], meal["kcal"]) == (6, 1, 5, 73)


def test_save_marks_the_day_and_history_shows_it(member_client):
    day = "2026-10-03"
    _meal(member_client, day, "08:00", "Eggs")
    saved = member_client.post(f"{DIARY}/days/{day}/save")
    assert saved.status_code == 200 and saved.json()["saved_at"] is not None
    row = saved.json()["history"][0]
    assert (row["entry_date"], row["meals"], row["kcal"], row["saved"]) == (day, 1, 73, True)
    # saving an empty day lists it with no meals (the prototype does the same)
    empty = member_client.post(f"{DIARY}/days/2026-10-04/save").json()
    assert [(h["entry_date"], h["meals"], h["saved"]) for h in empty["history"]] == [("2026-10-04", 0, True), (day, 1, True)]


def test_removing_the_last_meal_forgets_the_day_and_its_save(member_client):
    day = "2026-10-05"
    meal = _meal(member_client, day, "08:00", "Eggs")["meals"][0]
    member_client.post(f"{DIARY}/days/{day}/save")
    after = member_client.delete(f"{DIARY}/{meal['id']}").json()
    assert after["meals"] == [] and after["saved_at"] is None and after["history"] == []
    with SessionLocal() as db:
        assert db.query(FoodDiaryDay).count() == 0


def test_feedback_is_the_prototype_text(member_client):
    day = "2026-10-06"
    empty = member_client.get(f"{DIARY}/feedback", params={"date": day}).json()
    assert empty["text"] == "Nothing is logged for this day yet — add a meal on the left and ask again."
    _meal(member_client, day, "08:00", "Eggs", ["Tired", "Hungry"])
    _meal(member_client, day, "12:00", "chicken", ["Hungry"])
    text = member_client.get(f"{DIARY}/feedback", params={"date": day}).json()["text"]
    assert text == ('You logged 2 meals — roughly 32g protein, 1g carbs and 8g fat (204 kcal). '
                    'Before eating you most often felt "hungry" — noting that pattern over time is exactly what the diary is for. '
                    'Keep logging each day and your entries build the picture your Veye plan works from.')
    single = "2026-10-07"
    _meal(member_client, single, "08:00", "Eggs")
    assert member_client.get(f"{DIARY}/feedback", params={"date": single}).json()["text"] == (
        "You logged 1 meal — roughly 6g protein, 1g carbs and 5g fat (73 kcal). "
        "Keep logging each day and your entries build the picture your Veye plan works from.")


def test_save_and_feedback_are_per_member(member_client):
    other = _second_member()
    day = "2026-10-08"
    _meal(member_client, day, "08:00", "Eggs")
    member_client.post(f"{DIARY}/days/{day}/save")
    theirs = other.get(DIARY, params={"date": day}).json()
    assert theirs["meals"] == [] and theirs["saved_at"] is None and theirs["history"] == []
    assert other.get(f"{DIARY}/feedback", params={"date": day}).json()["text"].startswith("Nothing is logged")


# ---------------------------------------------------------------- meal planning
DAY = {"name": "Regular work day", "notes": "Office", "describe": "Early meeting", "mode": "manual",
       "meals": [{"name": "Breakfast", "type": "Meal", "time": "07:00", "notes": "Oatmeal"},
                 {"name": "Lunch", "type": "Meal", "time": "12:30", "notes": ""}]}


def test_create_list_and_validate_days(member_client):
    assert member_client.get(f"{PLANS}/days").json()["days"] == []
    created = member_client.post(f"{PLANS}/days", json=DAY)
    assert created.status_code == 201, created.text
    body = created.json()
    day = body["days"][0]
    assert body["created_id"] == day["id"] and day["name"] == "Regular work day" and day["assigned_date"] is None
    assert [m["name"] for m in day["meals"]] == ["Breakfast", "Lunch"] and day["meals"][0]["notes"] == "Oatmeal"
    # newest first
    member_client.post(f"{PLANS}/days", json={**DAY, "name": "Weekend"})
    assert [d["name"] for d in member_client.get(f"{PLANS}/days").json()["days"]] == ["Weekend", "Regular work day"]
    for bad in ({**DAY, "name": "  "}, {**DAY, "meals": []}, {**DAY, "mode": "magic"},
                {**DAY, "meals": [{"name": "x", "type": "Feast", "time": ""}]}, {**DAY, "meals": [{"name": "x", "type": "Meal", "time": "7am"}]}):
        assert member_client.post(f"{PLANS}/days", json=bad).status_code == 422
    # empty meal name and time are allowed, as in the prototype's editor
    assert member_client.post(f"{PLANS}/days", json={**DAY, "name": "Bare", "meals": [{"name": "", "type": "Snack", "time": ""}]}).status_code == 201


def test_assign_edit_duplicate_and_delete(member_client):
    day_id = member_client.post(f"{PLANS}/days", json=DAY).json()["created_id"]
    assigned = member_client.post(f"{PLANS}/days/{day_id}/assign", json={"date": "2026-10-20"}).json()["days"][0]
    assert assigned["assigned_date"] == "2026-10-20"
    # saving an edit resets the assignment, exactly as the prototype's save payload does
    edited = member_client.put(f"{PLANS}/days/{day_id}", json={**DAY, "name": "Work day v2", "mode": "ai"}).json()["days"][0]
    assert edited["name"] == "Work day v2" and edited["mode"] == "ai" and edited["assigned_date"] is None
    member_client.post(f"{PLANS}/days/{day_id}/assign", json={"date": "2026-10-21"})
    dup = member_client.post(f"{PLANS}/days/{day_id}/duplicate")
    assert dup.status_code == 201
    first = dup.json()["days"][0]
    assert first["name"] == "Work day v2 (copy)" and first["assigned_date"] is None and first["id"] == dup.json()["created_id"]
    assert len(first["meals"]) == 2
    remaining = member_client.delete(f"{PLANS}/days/{day_id}").json()["days"]
    assert [d["name"] for d in remaining] == ["Work day v2 (copy)"]


def test_sample_days_and_copy_naming(member_client):
    samples = member_client.get(f"{PLANS}/samples").json()
    assert [s["label"] for s in samples] == ["Work day", "Work day with morning exercise", "Work day, exercise after work",
                                             "Weekend day", "Weekend day with morning exercise"]
    assert [o["label"] for o in samples[4]["options"]] == ["Option 1", "Option 2"]
    first = member_client.post(f"{PLANS}/samples/copy", json={"key": "wd", "option": 0}).json()["days"][0]
    assert first["name"] == "Work day" and first["notes"] == COPY_NOTE and first["mode"] == "manual"
    assert [(m["name"], m["time"]) for m in first["meals"]][:2] == [("Wake up", "06:30"), ("Snack", "07:00")]
    again = member_client.post(f"{PLANS}/samples/copy", json={"key": "wd", "option": 0}).json()["days"][0]
    assert again["name"] == "Work day (2)"  # never overwrites
    option2 = member_client.post(f"{PLANS}/samples/copy", json={"key": "wkdx", "option": 1}).json()["days"][0]
    assert option2["name"] == "Weekend day with morning exercise — Option 2"
    assert member_client.post(f"{PLANS}/samples/copy", json={"key": "nope", "option": 0}).status_code == 404
    assert member_client.post(f"{PLANS}/samples/copy", json={"key": "wd", "option": 3}).status_code == 404


def test_days_are_private_to_their_member(member_client):
    other = _second_member()
    day_id = member_client.post(f"{PLANS}/days", json=DAY).json()["created_id"]
    assert other.get(f"{PLANS}/days").json()["days"] == []
    for call in (lambda: other.put(f"{PLANS}/days/{day_id}", json=DAY), lambda: other.delete(f"{PLANS}/days/{day_id}"),
                 lambda: other.post(f"{PLANS}/days/{day_id}/duplicate"),
                 lambda: other.post(f"{PLANS}/days/{day_id}/assign", json={"date": "2026-10-20"})):
        assert call().status_code == 404
    assert TestClient(app).get(f"{PLANS}/days").status_code == 401


def test_export_and_account_deletion_cover_the_new_records(member_client):
    member_client.post(f"{PLANS}/days", json=DAY)
    _meal(member_client, "2026-10-09", "08:00", "Eggs")
    member_client.post(f"{DIARY}/days/2026-10-09/save")
    export = member_client.get("/api/v1/members/me/export").json()
    assert export["meal_plans"][0]["name"] == "Regular work day"
    assert export["food_diary"][0]["kcal"] == 73 and export["food_diary_saved_days"][0]["entry_date"] == "2026-10-09"

    from app.auth.models import UserAccount
    from app.core.runtime import get_runtime
    from app.members.service import MemberProfileService

    with SessionLocal() as db:
        user = db.query(UserAccount).filter(UserAccount.email == member_client.account["email"]).one()
        MemberProfileService(db, get_runtime().media_store).delete_member_account(user)
        db.commit()
        assert db.query(MealPlanDay).count() == 0 and db.query(FoodDiaryDay).count() == 0 and db.query(FoodDiaryEntry).count() == 0
