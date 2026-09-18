"""Direct JS-to-Python contract vectors for the approved Health Number engine."""

import json
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.assessments.schemas import HealthNumberAnswers
from app.assessments.service import calculate_health_number


CONTRACT_HELPER = Path(__file__).parent / "contracts" / "health_number_vectors.js"


def answers(**overrides):
    value = {
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
    value.update(overrides)
    return value


def run_js(vectors):
    completed = subprocess.run(
        ["node", str(CONTRACT_HELPER)],
        input=json.dumps({"vectors": vectors}),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    return {item["id"]: item for item in json.loads(completed.stdout)["results"]}


def python_result(payload):
    result = calculate_health_number(HealthNumberAnswers(**payload))
    return {
        "points": result.points,
        "raw_score": result.raw_score,
        "displayed_score": result.displayed_score,
        "bucket": result.bucket,
        "category": result.category,
        "interpretation": result.interpretation,
    }


def test_canonical_health_number_vectors_match_the_consumer_engine():
    # The two intentionally cleaner API representations are normalized here:
    # legacy sleep{} becomes its three canonical fields; unknown free-text plans
    # become the approved "Other" option plus other_plan metadata.
    legacy_sleep = answers()
    legacy_sleep.pop("sleepEnough")
    legacy_sleep.pop("sleepWell")
    legacy_sleep.pop("sleepHours")
    legacy_sleep["sleep"] = {"enough": "no", "well": "no", "hours": 3}

    vectors = [
        {"id": "healthy-floor", "answers": answers()},
        {"id": "worst-ceiling", "answers": answers(
            plans=["Weight Watchers", "Noom", "Jenny Craig", "The Mediterranean Diet", "DASH", "ATKINS", "Keto", "Intermittent Fasting", "Fasting", "Other"],
            activity="None", meditate="no", tired="yes", gainWeight="yes", abdomenWeight="yes",
            sleepEnough="no", sleepWell="no", sleepHours=4,
        )},
        {"id": "multiple-plans", "answers": answers(plans=["Weight Watchers", "Keto"])},
        {"id": "unknown-plan", "answers": answers(plans=["A free-text plan"])},
        {"id": "activity-label-spacing", "answers": answers(activity="Heavy (I exercise 3x + times per week)")},
        {"id": "legacy-sleep", "answers": legacy_sleep},
        {"id": "metadata-does-not-score", "answers": answers(
            goals=["Other"], goalsOther="Better sleep", plans=["Other"], plansOther="My personal plan",
            diet="Vegan", source="Instagram", simpleQuiz={"yes": 8},
        )},
        {"id": "one-point-five", "answers": answers(activity="None", meditate="no")},
        {"id": "three-point-five", "answers": answers(activity="None", meditate="no", plans=["Keto"], tired="yes")},
        {"id": "four-point", "answers": answers(activity="None", meditate="no", plans=["Keto"], tired="yes", abdomenWeight="yes")},
        {"id": "six-point", "answers": answers(activity="None", meditate="no", plans=["Keto", "Weight Watchers", "Noom"], tired="yes", abdomenWeight="yes", gainWeight="yes")},
        {"id": "six-point-five", "answers": answers(activity="None", meditate="no", plans=["Keto", "Weight Watchers"], tired="yes", abdomenWeight="yes", gainWeight="yes", sleepHours=4)},
        {"id": "lifestyle-majority", "answers": answers(activity="None", meditate="no", sleepEnough="no")},
        {"id": "food-majority", "answers": answers(plans=["Keto"], tired="yes", gainWeight="yes")},
        {"id": "relative-tie", "answers": answers(activity="None", tired="yes", gainWeight="yes")},
        {"id": "high-band-lifestyle", "answers": answers(activity="None", meditate="no", sleepEnough="no", sleepWell="no", sleepHours=4)},
        # The approved screens offer a written-in Other for Q11/Q12; both score 0.
        {"id": "diet-source-other", "answers": answers(diet="Other", other_diet="Pescatarian", source="Other", other_source="A podcast")},
    ]
    for plan in ["Weight Watchers", "Noom", "Jenny Craig", "The Mediterranean Diet", "DASH", "ATKINS", "Keto", "Intermittent Fasting", "Fasting", "Other", "No other plans"]:
        vectors.append({"id": f"plan-{plan}", "answers": answers(plans=[plan])})
    for activity in ["None", "Light (I work, I walk some)", "Moderate (I exercise 1-3 times a week)", "Heavy (I exercise 3x+ times per week)"]:
        vectors.append({"id": f"activity-{activity}", "answers": answers(activity=activity)})
    for name, field, value in [
        ("meditation", "meditate", "no"), ("tired", "tired", "yes"), ("gain-weight", "gainWeight", "yes"),
        ("abdomen", "abdomenWeight", "yes"), ("sleep-enough", "sleepEnough", "no"), ("sleep-well", "sleepWell", "no"),
    ]:
        vectors.append({"id": name, "answers": answers(**{field: value})})
    for hours in [4.9, 5, 9, 9.1]:
        vectors.append({"id": f"sleep-{hours}", "answers": answers(sleepHours=hours)})

    js_results = run_js(vectors)
    expected_scores = {
        "healthy-floor": 1, "one-point-five": 1.5, "three-point-five": 3.5,
        "four-point": 4, "six-point": 6, "six-point-five": 6.5, "worst-ceiling": 10,
    }
    for vector in vectors:
        source = vector["answers"]
        canonical = dict(source)
        if vector["id"] == "unknown-plan":
            canonical["plans"] = ["Other"]
            canonical["other_plan"] = "A free-text plan"
        if vector["id"] == "activity-label-spacing":
            canonical["activity"] = "Heavy (I exercise 3x+ times per week)"
        if vector["id"] == "legacy-sleep":
            canonical.pop("sleep", None)
            canonical.update({"sleepEnough": "no", "sleepWell": "no", "sleepHours": 3})
        canonical.pop("goalsOther", None)
        canonical.pop("plansOther", None)
        canonical.pop("simpleQuiz", None)
        result = python_result(canonical)
        js = js_results[vector["id"]]
        assert result == {key: js[key] for key in result}
        if vector["id"] in expected_scores:
            assert result["displayed_score"] == expected_scores[vector["id"]]


def test_other_diet_and_source_require_their_write_in():
    with pytest.raises(ValidationError, match="dietary preference"):
        HealthNumberAnswers(**answers(diet="Other"))
    with pytest.raises(ValidationError, match="found out about Veye"):
        HealthNumberAnswers(**answers(source="Other", other_source="  "))


def test_no_other_plans_remains_exclusive_in_the_api_canonical_shape():
    with pytest.raises(ValidationError, match="cannot be combined"):
        HealthNumberAnswers(**answers(plans=["No other plans", "Keto"]))
