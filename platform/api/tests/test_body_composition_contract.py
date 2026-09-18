"""Direct JS-to-Python contract vectors for approved Body Composition behavior."""

import json
import subprocess
from pathlib import Path

from app.progress.body_composition.schemas import BodyCompositionInput
from app.progress.body_composition.service import calculate_body_composition


CONTRACT_HELPER = Path(__file__).parent / "contracts" / "body_composition_vectors.js"


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


def test_body_composition_vectors_match_the_approved_consumer_engine():
    vectors = [
        {"id": "female-anchor", "input": {"sex": "Woman", "weight": 150, "height": 65, "abdomen": 30, "hips": 40}},
        {"id": "female-half-inch-snap", "input": {"sex": "Woman", "weight": 150, "height": 64.9, "abdomen": 30.1, "hips": 40.2}},
        {"id": "female-outside-table", "input": {"sex": "Woman", "weight": 150, "height": 80, "abdomen": 30, "hips": 40}},
        {"id": "male-anchor-low", "input": {"sex": "Man", "weight": 120, "height": 70, "waist": 52, "wrist": 30}},
        {"id": "male-anchor-mid", "input": {"sex": "Man", "weight": 200, "height": 70, "waist": 54, "wrist": 30}},
        {"id": "male-anchor-high", "input": {"sex": "Man", "weight": 300, "height": 70, "waist": 80, "wrist": 30}},
        {"id": "male-five-pound-snap", "input": {"sex": "Man", "weight": 201, "height": 70, "waist": 53.1, "wrist": 30}},
        {"id": "male-blank-cell", "input": {"sex": "Man", "weight": 120, "height": 70, "waist": 70, "wrist": 30}},
        {"id": "male-outside-table", "input": {"sex": "Man", "weight": 310, "height": 70, "waist": 60, "wrist": 30}},
    ]
    js_results = run_js(vectors)
    for vector in vectors:
        result = calculate_body_composition(BodyCompositionInput(**vector["input"]))
        python = {
            "ok": result.body_fat_available,
            "sex": result.sex,
            "reason": result.unavailable_reason,
            "bmi": result.bmi,
            "body_fat_percent": result.body_fat_percent,
            "fat_mass_lb": result.fat_mass_lb,
            "lean_mass_lb": result.lean_mass_lb,
        }
        js = js_results[vector["id"]]
        assert python == {key: js[key] for key in python}
