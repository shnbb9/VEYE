import pytest
from pydantic import ValidationError

from app.assessments.schemas import HealthNumberAnswers
from app.assessments.service import (
    CALCULATION_VERSION,
    PLAN_SCORES,
    TEXT,
    calculate_health_number,
    calculate_points,
    classify_category,
    interpret_score,
)


def answer_data(**overrides):
    values = {
        "goals": ["Live a Healthier Lifestyle"],
        "plans": ["No other plans"],
        "activity": "Moderate (I exercise 1-3 times a week)",
        "meditate": "yes",
        "tired": "no",
        "gainWeight": "no",
        "abdomenWeight": "no",
        "sleepEnough": "yes",
        "sleepWell": "yes",
        "sleepHours": 7,
        "diet": "No preference",
        "source": "Friends or Family",
    }
    values.update(overrides)
    return values


def result(**overrides):
    return calculate_health_number(HealthNumberAnswers(**answer_data(**overrides)))


@pytest.mark.parametrize("plan, expected", list(PLAN_SCORES.items()))
def test_each_plan_matches_the_approved_points(plan, expected):
    points = calculate_points(HealthNumberAnswers(**answer_data(plans=[plan])))
    assert points["plans"] == expected


def test_multiple_plans_sum_and_other_text_is_metadata_only():
    without_text = result(plans=["Weight Watchers", "Keto", "Other"])
    with_text = result(plans=["Weight Watchers", "Keto", "Other"], other_plan="A plan I made for myself")
    assert without_text.points["plans"] == 2.5
    assert with_text.raw_score == without_text.raw_score
    assert result(goals=["Other"], other_goal="Feel more energetic").points["goals"] == 0


def test_no_other_plans_is_exclusive():
    with pytest.raises(ValidationError, match="cannot be combined"):
        HealthNumberAnswers(**answer_data(plans=["No other plans", "Keto"]))


@pytest.mark.parametrize("activity, expected", [
    ("None", 1),
    ("Light (I work, I walk some)", 0),
    ("Moderate (I exercise 1-3 times a week)", -1),
    ("Heavy (I exercise 3x+ times per week)", -1),
])
def test_activity_points(activity, expected):
    assert result(activity=activity).points["activity"] == expected


@pytest.mark.parametrize("field, answer, expected", [
    ("meditate", "yes", -0.5), ("meditate", "no", 0.5),
    ("tired", "yes", 0.5), ("tired", "no", 0),
    ("gainWeight", "yes", 1), ("gainWeight", "no", 0),
    ("abdomenWeight", "yes", 0.5), ("abdomenWeight", "no", 0),
    ("sleepEnough", "yes", 0), ("sleepEnough", "no", 1.5),
    ("sleepWell", "yes", 0), ("sleepWell", "no", 1.5),
])
def test_boolean_points(field, answer, expected):
    assert result(**{field: answer}).points[field] == expected


@pytest.mark.parametrize("hours, expected", [(4.999, 1), (5, 0), (9, 0), (9.001, 1)])
def test_sleep_hour_boundaries(hours, expected):
    assert result(sleepHours=hours).points["sleepHours"] == expected


def test_raw_floor_ceiling_and_half_point_display():
    assert result().raw_score == -1.5
    assert result().displayed_score == 1
    assert result(meditate="no", tired="yes", gainWeight="yes", abdomenWeight="yes").displayed_score == 1.5
    worst = result(
        plans=[plan for plan in PLAN_SCORES if plan != "No other plans"], activity="None", meditate="no",
        tired="yes", gainWeight="yes", abdomenWeight="yes", sleepEnough="no", sleepWell="no", sleepHours=4,
    )
    assert worst.raw_score > 10
    assert worst.displayed_score == 10


@pytest.mark.parametrize("score, bucket, status", [
    (1, "good", "Good Health"), (1.5, "relative", "Relatively Good Health"),
    (3.5, "relative", "Relatively Good Health"), (4, "moderate", "Moderately Good Health"),
    (6, "moderate", "Moderately Good Health"), (6.5, "high", "Insulin Resistance Risk"),
    (10, "high", "Insulin Resistance Risk"),
])
def test_interpretation_boundaries_and_exact_copy(score, bucket, status):
    actual_bucket, actual_status, copy = interpret_score(score, "mixed")
    assert (actual_bucket, actual_status) == (bucket, status)
    expected_key = "good" if bucket == "good" else "high" if bucket == "high" else f"{'rel' if bucket == 'relative' else 'mod'}_mixed"
    assert copy == TEXT[expected_key]


def test_category_majority_tie_and_high_bucket_do_not_recalculate_records():
    assert classify_category({"activity": 1, "meditate": 0.5, "sleepEnough": 0, "sleepWell": 0, "sleepHours": 0,
                              "plans": 0, "tired": 0, "gainWeight": 0, "abdomenWeight": 0})[0] == "lifestyle"
    assert classify_category({"activity": 0, "meditate": 0, "sleepEnough": 0, "sleepWell": 0, "sleepHours": 0,
                              "plans": 0.5, "tired": 0.5, "gainWeight": 0, "abdomenWeight": 0})[0] == "food"
    assert classify_category({"activity": 1, "meditate": 0, "sleepEnough": 0, "sleepWell": 0, "sleepHours": 0,
                              "plans": 0, "tired": 0, "gainWeight": 1, "abdomenWeight": 0})[0] == "mixed"
    assert interpret_score(6.5, "lifestyle") == interpret_score(6.5, "food")


def test_calculation_version_is_pinned():
    assert CALCULATION_VERSION == "1.5.0"
