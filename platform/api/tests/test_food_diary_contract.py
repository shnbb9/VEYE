"""The Food Diary macro estimate is the approved prototype's: the API's port
(app.food.estimate) must give exactly what the prototype's fdxEstimate gives,
run from the unmodified build/dashboard.html — keyword hits, multi-keyword
sums, the text-seeded fallback, whitespace and non-ASCII text."""

import json
import subprocess
from pathlib import Path

from app.food.estimate import estimate

CONTRACT_HELPER = Path(__file__).parent / "contracts" / "food_diary_vectors.js"

TEXTS = [
    "", "   ", "Eggs", "2 eggs on toast", "Grilled chicken salad with avocado", "Greek yoghurt with walnuts",
    "Baked salmon, broccoli and quinoa", "Porridge", "eggplant parmigiana", "BEEF steak", "Ham and cheese sandwich",
    "rice and beans", "Smoothie with protein powder", "Pizza", "Burger and fries", "tofu stir fry with noodles",
    "Latte", "olive oil", "my mum's stew", "something unusual", "Lentil soup", "apple", "berries", "doughnut",
    "Café au lait", "naïve kumquat", "寿司", "🍣 sushi roll", " spaced out ", "nutella crepe", "chickpea curry",
    "ham", "hamburger", "coconut", "Banana bread", "a" * 500,
]


def run_js(texts):
    completed = subprocess.run(["node", str(CONTRACT_HELPER)], input=json.dumps({"texts": texts}), text=True,
                               encoding="utf-8", capture_output=True, check=True)
    return json.loads(completed.stdout)["results"]


def test_estimate_matches_the_prototype_exactly():
    for text, js in zip(TEXTS, run_js(TEXTS), strict=True):
        py = estimate(text)
        if js is None:
            assert py is None, text
        else:
            assert py is not None, text
            assert (py.protein_g, py.carbs_g, py.fat_g, py.kcal) == (js["p"], js["c"], js["f"], js["k"]), text


def test_known_values():
    # a keyword hit and a multi-keyword sum, worked out by hand from the table
    chicken = estimate("chicken")
    assert (chicken.protein_g, chicken.carbs_g, chicken.fat_g, chicken.kcal) == (26, 0, 3, 131)
    salad = estimate("Grilled chicken salad with avocado")  # chicken + salad + avocado
    assert (salad.protein_g, salad.carbs_g, salad.fat_g) == (30, 17, 18)
    assert estimate("   ") is None
