from dataclasses import dataclass

from app.assessments.schemas import HealthNumberAnswers

CALCULATION_VERSION = "1.5.0"
PLAN_SCORES = {
    "Weight Watchers": 0.5, "Noom": 0.5, "Jenny Craig": 0.5,
    "The Mediterranean Diet": 0.5, "DASH": 0.5, "ATKINS": 1.5,
    "Keto": 1.5, "Intermittent Fasting": 0.5, "Fasting": 0.5,
    "Other": 0.5, "No other plans": 0,
}
ACTIVITY_SCORES = {
    "None": 1, "Light (I work, I walk some)": 0,
    "Moderate (I exercise 1-3 times a week)": -1,
    "Heavy (I exercise 3x+ times per week)": -1,
}
LIFESTYLE_KEYS = ("activity", "meditate", "sleepEnough", "sleepWell", "sleepHours")
FOOD_KEYS = ("plans", "tired", "gainWeight", "abdomenWeight")
TEXT = {
    "good": "You are in very good health \N{EM DASH} join and learn more about optimizing your health, preventing disease, and slowing the aging process.",
    "rel_lifestyle": "You are in relatively good health, and some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.",
    "rel_food": "You are in relatively good health, and some changes to your dietary program will help you optimize your health, prevent disease, and slow the aging process.",
    "rel_mixed": "You are in relatively good health, and some lifestyle changes and adjustments to your dietary program will help you optimize your health, prevent disease, and slow the aging process.",
    "mod_mixed": "Although you are in moderately good health, incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.",
    "mod_lifestyle": "Although you seem to have a working diet plan, some aspects of your lifestyle are putting your health at risk. Incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.",
    "mod_food": "Although you have a healthy lifestyle, your food choices are putting your health at risk. Incorporating a better diet plan will help you optimize your health, prevent disease, and slow the aging process.",
    "high": "You show signs of insulin resistance, which will lead to chronic disease or a worsening of established chronic disease. Join the Program and we can help you make changes so you feel better and live longer.",
}


@dataclass(frozen=True)
class HealthNumberResult:
    raw_score: float
    displayed_score: float
    status: str
    bucket: str
    category: str
    category_rule: str
    interpretation: str
    points: dict[str, float]


def calculate_points(a: HealthNumberAnswers) -> dict[str, float]:
    plans = 0.0 if "No other plans" in a.plans else sum(PLAN_SCORES[p] for p in a.plans)
    return {
        "goals": 0.0,
        "plans": plans,
        "activity": float(ACTIVITY_SCORES[a.activity]),
        "meditate": -0.5 if a.meditate == "yes" else 0.5,
        "tired": 0.5 if a.tired == "yes" else 0.0,
        "gainWeight": 1.0 if a.gainWeight == "yes" else 0.0,
        "abdomenWeight": 0.5 if a.abdomenWeight == "yes" else 0.0,
        "sleepEnough": 1.5 if a.sleepEnough == "no" else 0.0,
        "sleepWell": 1.5 if a.sleepWell == "no" else 0.0,
        "sleepHours": 1.0 if a.sleepHours < 5 or a.sleepHours > 9 else 0.0,
        "diet": 0.0,
        "source": 0.0,
    }


def classify_category(points: dict[str, float]) -> tuple[str, str]:
    life_count = sum(points[k] > 0 for k in LIFESTYLE_KEYS)
    food_count = sum(points[k] > 0 for k in FOOD_KEYS)
    if life_count > food_count:
        return "lifestyle", f"more high Lifestyle answers ({life_count} vs {food_count})"
    if food_count > life_count:
        return "food", f"more high Food answers ({food_count} vs {life_count})"
    return "mixed", f"tied high answers ({life_count} each) -> Mixed"


def interpret_score(displayed: float, category: str) -> tuple[str, str, str]:
    if displayed <= 1:
        bucket, status, copy_key = "good", "Good Health", "good"
    elif displayed <= 3.5:
        bucket, status, copy_key = "relative", "Relatively Good Health", f"rel_{category}"
    elif displayed <= 6:
        bucket, status, copy_key = "moderate", "Moderately Good Health", f"mod_{category}"
    else:
        bucket, status, copy_key = "high", "Insulin Resistance Risk", "high"
    return bucket, status, TEXT[copy_key]


def calculate_health_number(a: HealthNumberAnswers) -> HealthNumberResult:
    points = calculate_points(a)
    raw = sum(points.values())
    displayed = round(max(1.0, min(10.0, raw)) * 2) / 2
    category, rule = classify_category(points)
    bucket, status, interpretation = interpret_score(displayed, category)
    return HealthNumberResult(raw, displayed, status, bucket, category, rule, interpretation, points)
