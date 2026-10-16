"""Food Diary estimate and day feedback — the approved prototype's own rules
(build/dashboard.html, Food Diary: FDX_FOODS / fdxEstimate and the "Give me
feedback" handler), reproduced exactly so the application shows what the
client approved. Both are deterministic and labelled on screen as prototype
estimates / rule-based feedback — never a nutritional analysis or a live AI.

`tests/contracts/food_diary_vectors.js` runs the prototype's JavaScript and
`tests/test_food_diary_contract.py` holds this module to the same outputs."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

ESTIMATE_VERSION = "fdx-prototype-1"

# JavaScript regular expressions without the `u` flag: \b and case folding are
# ASCII-only, which re.ASCII reproduces.
_FLAGS = re.IGNORECASE | re.ASCII

# (pattern, protein g, carbs g, fat g) — the prototype's fixed keyword table.
FOODS: tuple[tuple[re.Pattern[str], int, int, int], ...] = tuple(
    (re.compile(pattern, _FLAGS), p, c, f) for pattern, p, c, f in (
        (r"\begg", 6, 1, 5), (r"chicken|turkey", 26, 0, 3), (r"salmon|tuna|fish|cod", 22, 0, 6),
        (r"beef|steak", 25, 0, 15), (r"pork|ham|bacon", 18, 1, 14), (r"tofu", 10, 2, 6),
        (r"yogurt|yoghurt", 10, 8, 4), (r"cheese", 7, 1, 9), (r"milk|latte", 8, 12, 5),
        (r"rice", 4, 45, 1), (r"pasta|noodle", 8, 43, 2), (r"bread|toast|sandwich|wrap|bagel", 8, 30, 4),
        (r"oat|porridge|granola", 5, 27, 3), (r"potato", 3, 26, 0), (r"quinoa", 6, 30, 3),
        (r"salad|greens|spinach|broccoli|vegetable|veggie", 2, 8, 0), (r"soup", 6, 15, 5),
        (r"avocado|guacamole", 2, 9, 15), (r"nut|almond|walnut|cashew|peanut", 6, 6, 14),
        (r"fruit|apple|banana|berr|orange|grape|melon", 1, 20, 0),
        (r"smoothie|shake|protein powder", 15, 25, 5), (r"oil|butter|ghee", 0, 0, 12),
        (r"bean|lentil|chickpea|hummus", 8, 20, 3), (r"pizza", 12, 35, 12), (r"burger", 20, 30, 18),
    )
)

# String.prototype.trim: ECMAScript WhiteSpace + LineTerminator.
_JS_SPACE = "\t\n\v\f\r                  　﻿"


@dataclass(frozen=True)
class MacroEstimate:
    protein_g: int
    carbs_g: int
    fat_g: int
    kcal: int


def _utf16_units(text: str) -> Iterable[int]:
    """charCodeAt: JavaScript strings are UTF-16 code units."""
    data = text.encode("utf-16-le", "surrogatepass")
    return (data[i] | (data[i + 1] << 8) for i in range(0, len(data), 2))


def estimate(description: str | None) -> MacroEstimate | None:
    """fdxEstimate: the keyword table; a description that matches nothing gets
    the prototype's text-seeded fallback, so the same words always give the
    same estimate. None for an empty description."""
    text = str(description or "").strip(_JS_SPACE)
    if not text:
        return None
    protein = carbs = fat = 0
    hit = False
    for pattern, p, c, f in FOODS:
        if pattern.search(text):
            protein += p
            carbs += c
            fat += f
            hit = True
    if not hit:
        h = 0
        for unit in _utf16_units(text):
            h = (h * 31 + unit) % 9973
        protein = 8 + (h % 18)
        carbs = 15 + ((h >> 2) % 30)
        fat = 5 + ((h >> 4) % 15)
    return MacroEstimate(protein, carbs, fat, protein * 4 + carbs * 4 + fat * 9)


def day_feedback(meals: list[tuple[MacroEstimate, list[str]]]) -> str:
    """The "Give me feedback" text over a day's saved entries, in screen order.
    Each meal is (its macro estimate, its feelings in the order chosen)."""
    if not meals:
        return "Nothing is logged for this day yet — add a meal on the left and ask again."
    p = sum(m.protein_g for m, _ in meals)
    c = sum(m.carbs_g for m, _ in meals)
    f = sum(m.fat_g for m, _ in meals)
    k = sum(m.kcal for m, _ in meals)
    count = len(meals)
    bits = [f"You logged {count} meal{'' if count == 1 else 's'} — roughly {p}g protein, {c}g carbs and {f}g fat ({k} kcal)."]
    feelings = [feeling for _, chosen in meals for feeling in chosen]
    if feelings:
        counts: dict[str, int] = {}
        for feeling in feelings:  # insertion order = first appearance, as a JS object
            counts[feeling] = counts.get(feeling, 0) + 1
        top = sorted(counts, key=lambda key: -counts[key])[0]  # stable, like Array.prototype.sort
        bits.append(f'Before eating you most often felt "{top.lower()}" — noting that pattern over time is exactly what the diary is for.')
    bits.append("Keep logging each day and your entries build the picture your Veye plan works from.")
    return " ".join(bits)
