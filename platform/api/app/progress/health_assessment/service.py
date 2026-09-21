"""Health Assessment — the deterministic domain calculation.

Source of truth: the approved consumer engine (`build/js/veye-calculations.js`,
`VeyeCalculations.hsr`) and the approved screen (`build/dashboard.html`,
ASSESSMENT_QUESTIONS / ASSESS_INFO), both derived from Cara's
`Health Assessment.docx` (25 Aug 2026):

- 11 questions, three choices each: the first (healthiest) choice scores 1,
  the middle 2, the third 3.
- Total 11–33, LOWER IS BETTER ("I needed to reverse the numbers so 11 is
  low inflammation and 33 is high inflammation", Functional Edits 260824).
- Six interpretation bands with verbatim wording.
- EPA/DHA suggested dosage by score: 11–17 → 2.5g · 18–21 → 5g · 22–33 → 7.5g.
  Polyphenols are the same three lines for every score. The 10g row is
  condition-based (neurological disorders) and is NEVER assigned here.

The member-facing name is a client clarification (Cara's documents say
Health Status Report / HSR / Health Questionnaire; the approved product says
Health Assessment). The internal id is `health_assessment` throughout.

Every number and every line of interpretation lives here and nowhere else in
the API; the browser renders what it is given."""

from __future__ import annotations

from dataclasses import dataclass

HEALTH_ASSESSMENT_CALCULATION_VERSION = "health-assessment-2026-08-25-v2"

MIN_TOTAL = 11
MAX_TOTAL = 33
TIER_VALUES = (1, 2, 3)  # best, middle, worst


@dataclass(frozen=True)
class Question:
    key: str
    label: str
    best: str
    middle: str
    worst: str
    info: str

    @property
    def options(self) -> tuple[tuple[int, str], ...]:
        return ((1, self.best), (2, self.middle), (3, self.worst))


# Labels and choices exactly as the approved screen prints them; the info
# texts are the 11 information icons, verbatim from Health Assessment.docx.
QUESTIONS: tuple[Question, ...] = (
    Question("daily_performance", "Daily performance", "Very good", "Acceptable", "Poor",
             "Increases in daily physical performance (especially increased energy) indicate inflammation control and good activation of AMPK, promoting both increased oxygen transfer and better use of stored body fat. Any decrease in daily performance indicates decreased activation of AMPK."),
    Question("appetite_for_carbohydrates", "Appetite for carbohydrates", "Eats carbs but no cravings", "Crave carbs sometimes", "Crave carbs often",
             "Carbohydrate cravings decrease, and are often eliminated, with a balanced nutritional program."),
    Question("appetite_suppression_between_meals", "Appetite suppression between meals", "Good · not hungry between meals", "OK · a little hungry before meals", "Poor · often hungry soon after eating",
             "The goal is to stabilize blood glucose and suppress hunger for up to 5 hours."),
    Question("stool_density", "Stool density", "Floats", "Sinks", "Constipated",
             "The water content of the stool is controlled by the balance of vasodilators to vasoconstrictors in the colon. When the stool is iso-dense with water (i.e. it floats), that is a good indicator of low inflammation."),
    Question("sleep_quality", "Sleep quality", "Good", "OK", "Poor",
             "The need for sleep is determined by the amount of time required to re-establish neurotransmitter equilibrium. This process speeds up when inflammation is under control."),
    Question("grogginess_upon_waking", "Grogginess upon waking", "Rarely", "Sometimes", "Yes, usually",
             "Grogginess upon waking indicates inflammation that affects the central nervous system."),
    Question("sense_of_well_being", "Sense of well-being", "Very good", "OK", "Poor",
             "Low inflammation leads to a state of well-being as opposed to the depression/anxiety/irritability associated with high inflammation."),
    Question("mental_concentration", "Mental concentration", "Very good", "OK", "Poor",
             "This is controlled by the maintenance of blood sugar levels, which are mobilized by glucagon. The right balance of protein, carbohydrates and fats will increase mental concentration. One of the first signs of hypoglycemia is decreased mental concentration."),
    Question("fatigue", "Fatigue", "Rarely", "Sometimes", "Often",
             "Often the result of an unbalanced diet. This can happen with either too much protein (inflammation is too low) or too many carbohydrates (inflammation is too high)."),
    Question("skin_quality", "Skin quality", "Very good", "OK", "Poor",
             "High inflammation will lead to skin dryness and eczema (caused by increased leukotriene formation). On the other hand, controlling inflammation can help stimulate collagen synthesis and improve microcirculation caused by increased vasodilation."),
    Question("headaches", "Headaches", "Rarely", "Sometimes", "Often",
             "This is similar to fatigue because you can have either a vasodilation headache (inflammation is too low) or a vasoconstriction headache (inflammation is too high). As with fatigue, you have to look at other parameters to gain a clear picture of eicosanoid status."),
)
QUESTION_KEYS: tuple[str, ...] = tuple(q.key for q in QUESTIONS)

SCALE_SENTENCE = "On a scale of 11 to 33, where 11 is low inflammation and 33 is high inflammation, "

# (upper bound inclusive, bucket, status, wording after the scale sentence)
BANDS: tuple[tuple[int, str, str, str], ...] = (
    (11, "verylow", "Very Low Inflammation",
     "you have very low inflammation, what you are eating is working well for you and few adjustments are needed."),
    (16, "low", "Low Inflammation",
     "you have low inflammation. What you are eating is good, making some improvements and following the Veye guidelines will decrease inflammation even more."),
    (22, "moderate", "Moderate Inflammation",
     "you have moderate inflammation. You can improve your health with the Veye guidelines."),
    (27, "high", "High Inflammation",
     "your inflammation is high - you may already have a chronic disease, and if not you are at risk of developing a chronic disease. Following the Veye guidelines will significantly improve your health."),
    (32, "significant", "Significant Inflammation",
     "you have significant inflammation. You may already have a chronic disease, and if not you are at risk of developing a chronic disease. The Veye guidelines can help you make the foods you already eat healthier by combining the right ratios of proteins, carbohydrates and fats. Then when you are ready you can begin to choose healthier foods."),
    (MAX_TOTAL, "poor", "High Inflammation / Poor Health",
     "your inflammation is high and your health is poor. Try incorporating the Veye program as much as possible. Start with small changes: first make the food you eat healthier and combine them properly, then over time choose healthier foods."),
)

# The approved screen's colour tone for a band (result-status color-*).
TONE_BY_BUCKET = {"verylow": "good", "low": "good", "moderate": "moderate", "high": "elevated",
                  "significant": "significant", "poor": "significant"}

POLYPHENOL_LINES: tuple[tuple[str, str], ...] = (
    ("500mg", "helps reduce oxidative stress"),
    ("1000mg", "helps reduce inflammation"),
    ("1500mg", "helps reduce the rate of aging and increases mitochondrial synthesis"),
)
NEUROLOGICAL_ROW = {"epa_dha_dose": "10g", "condition": "Neurological disorders",
                    "note": "condition-based; this assessment does not establish that condition"}


@dataclass(frozen=True)
class HealthAssessmentResult:
    answers: dict[str, int]
    total: int
    bucket: str
    status: str
    interpretation: str
    tone: str
    epa_dha_dose: str
    polyphenol_lines: tuple[tuple[str, str], ...]


def interpret_total(total: int) -> tuple[str, str, str]:
    """(bucket, status, interpretation) for a total on the 11–33 scale."""
    for upper, bucket, status, wording in BANDS:
        if total <= upper:
            return bucket, status, SCALE_SENTENCE + wording
    bucket, status, wording = BANDS[-1][1:]
    return bucket, status, SCALE_SENTENCE + wording


def epa_dha_dose(total: int) -> str:
    if total <= 17:
        return "2.5g"
    if total <= 21:
        return "5g"
    return "7.5g"


def calculate_health_assessment(answers: dict[str, int]) -> HealthAssessmentResult:
    """`answers` maps every question key to 1 (best), 2 (middle) or 3 (worst).
    Validation of shape happens in the schema; this is pure arithmetic."""
    missing = [key for key in QUESTION_KEYS if key not in answers]
    extra = [key for key in answers if key not in QUESTION_KEYS]
    if missing or extra:
        raise ValueError(f"answers must cover exactly the 11 questions (missing {missing}, unknown {extra})")
    for key, value in answers.items():
        if value not in TIER_VALUES:
            raise ValueError(f"{key}: each answer is 1, 2 or 3")
    ordered = {key: int(answers[key]) for key in QUESTION_KEYS}
    total = sum(ordered.values())
    bucket, status, interpretation = interpret_total(total)
    return HealthAssessmentResult(
        answers=ordered, total=total, bucket=bucket, status=status, interpretation=interpretation,
        tone=TONE_BY_BUCKET[bucket], epa_dha_dose=epa_dha_dose(total), polyphenol_lines=POLYPHENOL_LINES,
    )
