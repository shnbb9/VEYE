"""Exact deterministic counterpart to the approved consumer Body Composition engine."""

from dataclasses import dataclass
from math import floor

from app.progress.body_composition.schemas import BodyCompositionInput
from app.progress.body_composition.tables import (
    FEMALE_ABDOMEN_B,
    FEMALE_HEIGHT_C,
    FEMALE_HIPS_A,
    MALE_COLS,
    MALE_ROWS,
)


BODY_COMPOSITION_CALCULATION_VERSION = "1.0.0"


@dataclass(frozen=True)
class BodyCompositionCalculation:
    sex: str
    bmi: float | None
    body_fat_percent: int | None
    fat_mass_lb: float | None
    lean_mass_lb: float | None
    unavailable_reason: str | None

    @property
    def body_fat_available(self) -> bool:
        return self.body_fat_percent is not None


def round_half(value: float) -> float:
    return floor(value * 2 + 0.5) / 2


def round_five(value: float) -> int:
    return floor(value / 5 + 0.5) * 5


def round_one(value: float) -> float:
    return floor(value * 10 + 0.5) / 10


def calculate_bmi(weight: float, height: float) -> float | None:
    if weight <= 0 or height <= 0:
        return None
    return round_one(703 * weight / (height * height))


def female_body_fat(input: BodyCompositionInput) -> tuple[int | None, str | None]:
    hips = round_half(input.hips or 0)
    abdomen = round_half(input.abdomen or 0)
    height = round_half(input.height)
    a = FEMALE_HIPS_A.get(hips)
    b = FEMALE_ABDOMEN_B.get(abdomen)
    c = FEMALE_HEIGHT_C.get(height)
    if a is None or b is None or c is None:
        return None, "outside the client table"
    return floor(a + b - c + 0.5), None


def male_body_fat(input: BodyCompositionInput) -> tuple[int | None, str | None]:
    weight = round_five(input.weight)
    waist_minus_wrist = round_half((input.waist or 0) - (input.wrist or 0))
    row = MALE_ROWS.get(weight)
    if row is None or waist_minus_wrist not in MALE_COLS:
        return None, "outside the client table"
    value = row[MALE_COLS.index(waist_minus_wrist)]
    if not value:
        return None, "combination not covered by the client table"
    return value, None


def calculate_body_composition(input: BodyCompositionInput) -> BodyCompositionCalculation:
    body_fat_percent, unavailable_reason = (
        female_body_fat(input) if input.sex == "Woman" else male_body_fat(input)
    )
    bmi = calculate_bmi(input.weight, input.height)
    if body_fat_percent is None:
        return BodyCompositionCalculation(
            sex=input.sex,
            bmi=bmi,
            body_fat_percent=None,
            fat_mass_lb=None,
            lean_mass_lb=None,
            unavailable_reason=unavailable_reason,
        )

    fat_mass_lb = round_one(input.weight * (body_fat_percent / 100))
    return BodyCompositionCalculation(
        sex=input.sex,
        bmi=bmi,
        body_fat_percent=body_fat_percent,
        fat_mass_lb=fat_mass_lb,
        lean_mass_lb=round_one(input.weight - fat_mass_lb),
        unavailable_reason=None,
    )
