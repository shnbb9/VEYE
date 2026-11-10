"""The HOW TO meal-building rules, deterministic.

The client's training document sets out how a meal is assembled: what order to
ask in, what counts as a protein, what to say when an unfavourable
carbohydrate is chosen, when a fat is unnecessary. Those are decisions, not
prose, so they are decided here and tested — the language model is never the
thing that remembers whether beans are a protein.

Every rule carries its paragraph reference. Nothing is added that the document
does not state: where it defines no rule, this module offers none.

Two things in here must never reach a member, and both are enforced by tests
rather than by discipline:

- the 40/30/30 composition, which the document marks "This is information for
  the AI, do not state this to the user" (p0247);
- calories, which "Do not discuss or mention calories or the calories in a
  food choice" (p0245) rules out of the HOW TO entirely.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.food_choices import catalog
from app.food_choices.catalog import (
    CARB_FAVORABLE,
    CARB_FAVORABLE_FRUIT,
    CARB_FAVORABLE_GRAIN,
    CARB_SUPER_FAVORABLE,
    CARB_UNFAVORABLE_GRAIN,
    CARB_VERY_FAVORABLE,
    CARBOHYDRATE,
    FAT,
    FAT_AVOID,
    FAT_POOR,
    PROTEIN,
    FoodItem,
)

# ---- occasions --------------------------------------------------------------
MEAL = "meal"
SNACK = "snack"
OCCASIONS = (MEAL, SNACK)

# ---- the order to ask in (p0265, p0267, p0271, p0275, p0277) ----------------
# "Do not ask about proteins, carbs and fats all at once." - one group at a
# time, protein first, and the meal is not finished until all three are
# chosen (p0263).
ASK_ORDER = (PROTEIN, CARBOHYDRATE, FAT)

# ---- AI-only, never stated to a member (p0247) ------------------------------
# "Each meal should have approximately 40% carbs, 30% protein, and 30% fat.
# This is information for the AI, do not state this to the user. Do not state
# snacks are 20% carbs, 15% protein, and 15% fat because it makes no sense.
# percentages are not amounts so they do not change based on the size of a
# meal or what is chosen."
INTERNAL_COMPOSITION = {CARBOHYDRATE: 40, PROTEIN: 30, FAT: 30}
INTERNAL_COMPOSITION_REF = "p0247"
# Proportions do not change between a meal and a snack. The *amount* does:
# "A snack is half of that" (p0249, p0463, p0495).
SNACK_IS_HALF_A_MEAL_REF = "p0249"

# ---- subjects the HOW TO does not discuss (p0245) ---------------------------
FORBIDDEN_SUBJECTS = ("calorie", "calories", "kcal")
FORBIDDEN_SUBJECTS_REF = "p0245"


@dataclass(frozen=True)
class Advice:
    """One thing the source says to tell (or not tell) the member."""

    code: str
    text: str
    ref: str


@dataclass(frozen=True)
class Chosen:
    item: FoodItem
    portion: str | None
    portion_ref: str


@dataclass(frozen=True)
class Correction:
    """A food offered for a group the source says it does not belong to."""

    name: str
    offered_as: str
    actually: str
    text: str
    ref: str


@dataclass(frozen=True)
class MealAssessment:
    occasion: str
    sex: str
    chosen: dict[str, tuple[Chosen, ...]]
    corrections: tuple[Correction, ...] = ()
    unknown: tuple[str, ...] = ()
    advice: tuple[Advice, ...] = ()
    _satisfied: frozenset[str] = field(default_factory=frozenset)

    def has(self, group: str) -> bool:
        return bool(self.chosen.get(group))

    @property
    def satisfied(self) -> frozenset[str]:
        """Groups that need nothing further.

        A group is satisfied when something was chosen for it — or, for fat,
        when the protein is cheese: "there is already fat in the cheese and
        they do not need to choose additional fat" (p0283).
        """
        return self._satisfied

    @property
    def complete(self) -> bool:
        return all(group in self.satisfied for group in ASK_ORDER)

    @property
    def next_group(self) -> str | None:
        """The one group to ask about next, in the source's order."""
        for group in ASK_ORDER:
            if group not in self.satisfied:
                return group
        return None


def portion_for(item: FoodItem, sex: str, occasion: str) -> tuple[str | None, str]:
    """The amount of this food for this person at this occasion.

    Returns the source's own wording and the paragraph it came from. A snack is
    rendered as "half of <meal portion>" rather than halved arithmetically:
    the source's rule is "half a meal size" (p0463, p0495), and halving
    "9 nuts" or "1/4 avocado" would invent figures it never wrote.
    """
    amount = item.portion(sex)
    ref = item.ref
    if amount is None and item.group == CARBOHYDRATE:
        allowance = catalog.TIER_ALLOWANCE.get(item.tier)
        if allowance is not None:
            amount = allowance[0] if sex == "female" else allowance[1]
            ref = allowance[2]
    if amount is None:
        return None, ref
    if occasion == SNACK:
        # Half of an unlimited allowance is still unlimited; saying "half of
        # unlimited" would be nonsense rather than caution.
        if "unlimited" in amount:
            return amount, ref
        return f"half of {amount}", f"{ref} + {SNACK_IS_HALF_A_MEAL_REF}"
    return amount, ref


def _classify(names, group):
    """Sort offered names into this group's choices, corrections and unknowns."""
    chosen, corrections, unknown = [], [], []
    for name in names:
        item = catalog.find(name)
        if item is None:
            unknown.append(name)
        elif item.group == group:
            chosen.append(item)
        else:
            corrections.append((name, item))
    return chosen, corrections, unknown


def _correction(name: str, item: FoodItem, offered_as: str) -> Correction:
    if offered_as == PROTEIN:
        text = catalog.NOT_PROTEIN_NOTE
        ref = ", ".join(catalog.NOT_PROTEIN_REFS)
    else:
        text = (
            f"{item.name} is on the {item.group} list, not the "
            f"{offered_as} list. Choose from the lists."
        )
        ref = "p0253, p0255"
    return Correction(name=name, offered_as=offered_as, actually=item.group, text=text, ref=ref)


def assess(
    *,
    sex: str,
    occasion: str = MEAL,
    proteins: list[str] | None = None,
    carbohydrates: list[str] | None = None,
    fats: list[str] | None = None,
    cooked: bool = False,
) -> MealAssessment:
    """Evaluate a part-built or finished meal against the HOW TO rules.

    `cooked` means the member is cooking the protein, which the source answers
    with a specific fat: "advise the fat to be light olive oil to cook in. This
    is true for all meals" (p0296).
    """
    if occasion not in OCCASIONS:
        raise ValueError(f"occasion must be one of {OCCASIONS}, not {occasion!r}")
    if sex not in ("female", "male"):
        raise ValueError(f"sex must be 'female' or 'male', not {sex!r}")

    offered = {PROTEIN: proteins or [], CARBOHYDRATE: carbohydrates or [], FAT: fats or []}
    chosen: dict[str, tuple[Chosen, ...]] = {}
    corrections: list[Correction] = []
    unknown: list[str] = []

    for group in ASK_ORDER:
        picked, wrong_group, missing = _classify(offered[group], group)
        chosen[group] = tuple(
            Chosen(item, *portion_for(item, sex, occasion)) for item in picked
        )
        corrections.extend(_correction(name, item, group) for name, item in wrong_group)
        unknown.extend(missing)

    advice = _advise(chosen, occasion=occasion, cooked=cooked)
    satisfied = {group for group in ASK_ORDER if chosen[group]}
    # p0283: cheese as the protein already carries its fat.
    if any(c.item.is_cheese for c in chosen[PROTEIN]):
        satisfied.add(FAT)

    return MealAssessment(
        occasion=occasion,
        sex=sex,
        chosen=chosen,
        corrections=tuple(corrections),
        unknown=tuple(dict.fromkeys(unknown)),
        advice=advice,
        _satisfied=frozenset(satisfied),
    )


def _advise(chosen, *, occasion, cooked) -> tuple[Advice, ...]:
    out: list[Advice] = []
    carbs = [c.item for c in chosen[CARBOHYDRATE]]
    proteins = [c.item for c in chosen[PROTEIN]]
    fats = [c.item for c in chosen[FAT]]

    # p0257 / p0261: an unfavourable carbohydrate is named as unfavourable,
    # limited, and paired with as much super favourable as possible.
    unfavorable = [i for i in carbs if i.favorable is False]
    if unfavorable:
        names = ", ".join(i.name for i in unfavorable)
        out.append(Advice(
            "unfavorable_carb",
            f"{names} is an unfavourable carbohydrate. Keep the amount small - about "
            f"one quarter cup cooked - and have it with as much super favourable "
            f"carbohydrate as possible.",
            "p0257, p0261",
        ))
    grains = [i for i in unfavorable if i.tier == CARB_UNFAVORABLE_GRAIN]
    if grains:
        out.append(Advice("whole_grain", catalog.WHOLE_GRAIN_NOTE, ", ".join(catalog.WHOLE_GRAIN_REFS)))

    # p0259 / p0273: super and very favourable carbohydrates carry little
    # glucose, so something favourable goes alongside to feed the brain.
    if carbs and all(i.tier in (CARB_SUPER_FAVORABLE, CARB_VERY_FAVORABLE) for i in carbs):
        out.append(Advice(
            "needs_favorable_carb",
            "Those are all super or very favourable carbohydrates. Add a favourable "
            "carbohydrate as well - chickpeas, lentils or a fruit - so there is enough "
            "glucose to feed the brain.",
            "p0259, p0273, p0326",
        ))

    # p0283: cheese brings its own fat.
    cheese = [i for i in proteins if i.is_cheese]
    if cheese:
        out.append(Advice(
            "cheese_has_fat",
            f"{cheese[0].name} already contains fat, so there is no need to add a "
            f"separate fat to this {occasion}.",
            "p0283",
        ))

    # p0281 / p0296: the cooking fat is light olive oil.
    if cooked:
        out.append(Advice(
            "cooking_fat",
            "Use light olive oil to cook the protein or saute the carbohydrates.",
            "p0281, p0296",
        ))

    # p0566 / p0571: the fat tiers the source marks poor and avoid.
    for item in fats:
        if item.tier == FAT_AVOID:
            out.append(Advice("avoid_fat", f"{item.name} is on the avoid list.", "p0571"))
        elif item.tier == FAT_POOR:
            out.append(Advice(
                "poor_fat",
                f"{item.name} is an omega-6 fat, which is the poor choice of the three "
                f"groups. A monounsaturated omega-9 fat is the best choice.",
                "p0566",
            ))

    # p0253: variety from the favourable lists.
    if carbs and all(i.favorable for i in carbs) and len(carbs) == 1:
        out.append(Advice("variety", "Choose a variety of foods from the favourable lists.", "p0253"))

    return tuple(out)


def suggested_favorable_carbs() -> tuple[str, ...]:
    """What the source names when a meal needs a favourable carbohydrate.

    "suggest chickpeas, lentils, or fruit to go with it" (p0273).
    """
    return ("Chickpeas", "Lentils") + tuple(
        i.name for i in catalog.items(CARBOHYDRATE, CARB_FAVORABLE_FRUIT) if i.portion_woman
    )


def recap(assessment: MealAssessment) -> list[str]:
    """"Then put it altogether, sum up the choices for the user." (p0279)

    One line per chosen food with its amount, in the order the source asks for
    them. No percentages and no calories.
    """
    lines: list[str] = []
    for group in ASK_ORDER:
        for pick in assessment.chosen[group]:
            amount = pick.portion or "amount not specified in the food lists"
            lines.append(f"{pick.item.name} - {amount}")
    return lines


def is_cheese_protein(assessment: MealAssessment) -> bool:
    return any(c.item.is_cheese for c in assessment.chosen[PROTEIN])


__all__ = [
    "MEAL", "SNACK", "OCCASIONS", "ASK_ORDER", "INTERNAL_COMPOSITION",
    "FORBIDDEN_SUBJECTS", "Advice", "Chosen", "Correction", "MealAssessment",
    "assess", "portion_for", "recap", "suggested_favorable_carbs", "is_cheese_protein",
    "CARB_FAVORABLE", "CARB_FAVORABLE_GRAIN",
]
