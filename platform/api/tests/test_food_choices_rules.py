"""The HOW TO rules, checked against the client's own document.

Each test names the paragraph it pins. The point is not coverage for its own
sake: these are the numbers and exclusions that a language model would
otherwise be trusted to remember, and the prototype has already been bitten
once by a scoring table that drifted from the source while looking fine.

Source: `veye copy/veye copy/VeyeDocuments/AI Chatbot Training.docx` (250804)
and the four `* Food Choices*.xlsx` checklists beside it.
"""

from __future__ import annotations

from datetime import time

import pytest

from app.food_choices import catalog, rules, schedule
from app.food_choices.catalog import (
    CARB_FAVORABLE,
    CARB_FAVORABLE_FRUIT,
    CARB_SUPER_FAVORABLE,
    CARB_UNFAVORABLE_GRAIN,
    CARB_VERY_FAVORABLE,
    CARBOHYDRATE,
    FAT,
    PROTEIN,
)

# ---------------------------------------------------------------------------
# The catalog: transcription fidelity
# ---------------------------------------------------------------------------

def test_every_food_carries_the_source_it_came_from():
    """A figure nobody can trace is a figure nobody can check."""
    untraceable = [i.name for i in catalog.ALL_ITEMS if not i.ref]
    assert untraceable == []


def test_no_food_is_listed_twice():
    names = [i.name.casefold() for i in catalog.ALL_ITEMS]
    assert len(names) == len(set(names)), "a duplicate name would make the lookup ambiguous"


def test_the_protein_list_matches_the_members_checklist():
    """`Protein Food Choices.xlsx` has 39 rows: one instruction, three tier
    headings, one write-in row, and 34 foods."""
    assert len(catalog.PROTEINS) == 34
    assert len(catalog.items(PROTEIN, catalog.PROTEIN_BEST)) == 11
    assert len(catalog.items(PROTEIN, catalog.PROTEIN_FAIR)) == 15
    assert len(catalog.items(PROTEIN, catalog.PROTEIN_POOR)) == 8


def test_protein_powder_is_grams_which_is_what_settles_p0249():
    """p0504 carries the same numbers p0249 calls ounces, in grams - which is
    why p0249's aggregate figure is not implemented at all."""
    powder = catalog.find("Protein Powder")
    assert (powder.portion_woman, powder.portion_man) == ("30 grams", "40 grams")
    assert "grams" in catalog.PROTEIN_PORTION_NOTE
    assert "p0504" in catalog.PROTEIN_PORTION_NOTE


def test_a_food_the_source_gives_no_amount_for_reports_none():
    """Lemon and Lime are on the favourable-fruit checklist with no portion
    anywhere in the source. A blank cell is not an invitation to interpolate."""
    for name in ("Lemon", "Lime"):
        item = catalog.find(name)
        assert item is not None and item.tier == CARB_FAVORABLE_FRUIT
        assert item.portion("female") is None
        assert rules.portion_for(item, "female", rules.MEAL)[0] is None


def test_no_whole_grain_or_quinoa_is_favourable(): # p0241, p0257, p0334
    quinoa = catalog.find("Quinoa")
    assert quinoa.tier == CARB_UNFAVORABLE_GRAIN
    assert quinoa.favorable is False
    for item in catalog.items(CARBOHYDRATE, CARB_UNFAVORABLE_GRAIN):
        assert item.favorable is False


def test_the_only_favourable_grains_are_barley_and_slow_cooked_oatmeal(): # p0407
    grains = catalog.items(CARBOHYDRATE, catalog.CARB_FAVORABLE_GRAIN)
    assert sorted(i.name for i in grains) == ["Barley", "Slow cooked oatmeal"]
    assert catalog.find("Barley").portion("female") == "1/2 cup per meal"
    assert catalog.find("Slow cooked oatmeal").portion("male") == "1 cup per meal"


def test_favourable_and_unfavourable_is_a_carbohydrate_distinction(): # p0330
    assert catalog.find("Fish").favorable is None
    assert catalog.find("Butter").favorable is None
    assert catalog.find("Broccoli").favorable is True
    assert catalog.find("Corn").favorable is False


# ---------------------------------------------------------------------------
# What is not a protein (p0255, p0269, p0491)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["Lentils", "Chickpeas", "Black beans", "Kidney beans", "Hummus"])
def test_legumes_and_beans_offered_as_a_protein_are_corrected(name):
    assessed = rules.assess(sex="female", proteins=[name])
    assert assessed.chosen[PROTEIN] == (), f"{name} was accepted as a protein"
    assert [c.name for c in assessed.corrections] == [name]
    assert assessed.corrections[0].actually == CARBOHYDRATE
    assert not assessed.has(PROTEIN)


@pytest.mark.parametrize("name", ["Almonds- slivered, whole", "Cashews", "Walnuts", "Almond butter", "Tahini"])
def test_nuts_and_nut_butters_are_fats_not_proteins(name):
    assessed = rules.assess(sex="female", proteins=[name])
    assert assessed.chosen[PROTEIN] == ()
    assert assessed.corrections[0].actually == FAT
    assert "fats" in assessed.corrections[0].text


def test_a_food_that_is_on_no_list_is_reported_as_unknown_not_guessed():
    assessed = rules.assess(sex="female", proteins=["Ostrich jerky"])
    assert assessed.unknown == ("Ostrich jerky",)
    assert assessed.chosen[PROTEIN] == ()
    assert assessed.corrections == ()


# ---------------------------------------------------------------------------
# The order of the questions (p0263, p0265, p0267, p0271, p0275, p0277)
# ---------------------------------------------------------------------------

def test_the_first_question_is_always_protein():
    assert rules.assess(sex="female").next_group == PROTEIN
    assert rules.ASK_ORDER == (PROTEIN, CARBOHYDRATE, FAT)


def test_carbohydrate_is_asked_only_after_a_protein_is_chosen():
    assessed = rules.assess(sex="female", proteins=["Fish"])
    assert assessed.next_group == CARBOHYDRATE
    assert not assessed.complete


def test_fat_is_asked_last():
    assessed = rules.assess(sex="female", proteins=["Fish"], carbohydrates=["Broccoli"])
    assert assessed.next_group == FAT
    assert not assessed.complete


def test_the_meal_is_finished_only_when_all_three_are_chosen(): # p0263
    assessed = rules.assess(sex="female", proteins=["Fish"], carbohydrates=["Broccoli"], fats=["Olives"])
    assert assessed.complete
    assert assessed.next_group is None


def test_a_carbohydrate_offered_before_a_protein_still_leaves_protein_next():
    """Choosing out of order does not reorder the questions."""
    assessed = rules.assess(sex="female", carbohydrates=["Broccoli"])
    assert assessed.next_group == PROTEIN


# ---------------------------------------------------------------------------
# Cheese carries its own fat (p0283)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("cheese", [
    "Cottage cheese", "Cheese - low fat", "Mozzarella cheese (skim)",
    "Ricotta cheese (skim)", "Hard cheese or full fat cheese",
])
def test_cheese_as_the_protein_means_no_fat_is_asked_for(cheese):
    assessed = rules.assess(sex="female", proteins=[cheese], carbohydrates=["Spinach"])
    assert assessed.complete, "a fat was still being asked for after cheese"
    assert FAT in assessed.satisfied
    assert any(a.code == "cheese_has_fat" for a in assessed.advice)


def test_a_protein_that_is_not_cheese_still_needs_a_fat():
    assessed = rules.assess(sex="female", proteins=["Fish"], carbohydrates=["Spinach"])
    assert not assessed.complete
    assert assessed.next_group == FAT
    assert not any(a.code == "cheese_has_fat" for a in assessed.advice)


# ---------------------------------------------------------------------------
# Carbohydrate rules (p0253, p0257, p0259, p0261, p0273)
# ---------------------------------------------------------------------------

def test_an_unfavourable_carbohydrate_is_named_limited_and_paired():
    assessed = rules.assess(sex="female", proteins=["Fish"], carbohydrates=["Potatoes (baked, mashed, boiled, chips)"])
    advice = {a.code: a.text for a in assessed.advice}
    assert "unfavorable_carb" in advice
    assert "unfavourable" in advice["unfavorable_carb"]
    assert "one quarter cup" in advice["unfavorable_carb"]       # p0261
    assert "super favourable" in advice["unfavorable_carb"]      # p0261


def test_quinoa_and_grains_add_the_whole_grain_refusal():
    assessed = rules.assess(sex="female", carbohydrates=["Quinoa"])
    codes = {a.code for a in assessed.advice}
    assert "whole_grain" in codes
    assert "unfavorable_carb" in codes
    text = next(a.text for a in assessed.advice if a.code == "whole_grain")
    assert "not favourable" in text and "not recommended" in text


def test_all_super_favourable_carbs_ask_for_something_favourable_alongside():
    """p0259/p0273: there has to be enough glucose to feed the brain."""
    assessed = rules.assess(sex="female", proteins=["Fish"],
                            carbohydrates=["Broccoli", "Spinach", "Cauliflower"])
    advice = {a.code: a.text for a in assessed.advice}
    assert "needs_favorable_carb" in advice
    for suggestion in ("chickpeas", "lentils", "fruit"):
        assert suggestion in advice["needs_favorable_carb"].lower()


def test_all_very_favourable_carbs_ask_for_the_same():
    assessed = rules.assess(sex="female", carbohydrates=["Kale", "Zucchini"])
    assert any(a.code == "needs_favorable_carb" for a in assessed.advice)


def test_a_favourable_carb_alongside_settles_it():
    assessed = rules.assess(sex="female", proteins=["Fish"], carbohydrates=["Broccoli", "Chickpeas"])
    assert not any(a.code == "needs_favorable_carb" for a in assessed.advice)


def test_a_fruit_alongside_settles_it_too():
    assessed = rules.assess(sex="female", proteins=["Fish"], carbohydrates=["Spinach", "Apple"])
    assert not any(a.code == "needs_favorable_carb" for a in assessed.advice)


def test_the_suggestions_the_source_names_are_the_ones_offered(): # p0273
    suggested = rules.suggested_favorable_carbs()
    assert suggested[:2] == ("Chickpeas", "Lentils")
    assert "Apple" in suggested
    # Lemon and Lime have no portion, so they are not offered as the thing
    # that makes up a shortfall.
    assert "Lemon" not in suggested


# ---------------------------------------------------------------------------
# Fat rules (p0281, p0296, p0566, p0571)
# ---------------------------------------------------------------------------

def test_cooking_the_protein_means_light_olive_oil():
    assessed = rules.assess(sex="female", proteins=["Chicken breast, skinless or deli-style"],
                            carbohydrates=["Broccoli", "Chickpeas"], cooked=True)
    text = next(a.text for a in assessed.advice if a.code == "cooking_fat")
    assert "light olive oil" in text
    assert "saute" in text      # p0281: cook the protein or saute the carbs


def test_a_fat_on_the_avoid_list_is_called_out():
    assessed = rules.assess(sex="female", fats=["Vegetable shortening"])
    assert any(a.code == "avoid_fat" for a in assessed.advice)


def test_an_omega_6_fat_is_called_the_poor_choice():
    assessed = rules.assess(sex="female", fats=["Peanuts & Peanut butter (natural)"])
    text = next(a.text for a in assessed.advice if a.code == "poor_fat")
    assert "omega-6" in text and "omega-9" in text


def test_omega_3_fish_oil_is_not_a_meal_fat(): # p0539
    assert "not one of the fats added to a meal" in catalog.OMEGA3_NOT_A_MEAL_FAT_NOTE
    assert catalog.find("Fish oil") is None, "fish oil is not on the fats-to-add list"


# ---------------------------------------------------------------------------
# Portions (p0411, p0428, p0453, p0463, p0495)
# ---------------------------------------------------------------------------

def test_a_meal_portion_is_the_sources_own_wording():
    fish = catalog.find("Fish")
    assert rules.portion_for(fish, "female", rules.MEAL)[0] == "5oz"
    assert rules.portion_for(fish, "male", rules.MEAL)[0] == "7oz"


def test_a_snack_is_half_a_meal_portion_said_not_computed(): # p0463, p0495
    amount, ref = rules.portion_for(catalog.find("Fish"), "female", rules.SNACK)
    assert amount == "half of 5oz"
    assert "p0249" in ref
    # Halving "9 nuts" arithmetically would invent 4.5 nuts.
    assert rules.portion_for(catalog.find("Cashews"), "female", rules.SNACK)[0] == "half of 9 nuts"


def test_super_favourable_is_unlimited_at_both_occasions(): # p0411
    broccoli = catalog.find("Broccoli")
    assert rules.portion_for(broccoli, "female", rules.MEAL)[0] == "unlimited raw or cooked"
    # Half of an unlimited allowance is still unlimited.
    assert rules.portion_for(broccoli, "female", rules.SNACK)[0] == "unlimited raw or cooked"


def test_very_favourable_falls_back_to_the_tier_allowance(): # p0428
    kale = catalog.find("Kale")
    assert rules.portion_for(kale, "female", rules.MEAL)[0] == "4 cups per meal"
    assert rules.portion_for(kale, "male", rules.MEAL)[0] == "6 cups per meal"


def test_the_favourable_tier_allowance(): # p0453
    assert rules.portion_for(catalog.find("Lentils"), "female", rules.MEAL)[0] == "1 cup per meal"
    assert rules.portion_for(catalog.find("Lentils"), "male", rules.MEAL)[0] == "1.5 cups per meal"


def test_portions_differ_by_sex_where_the_source_says_so():
    for name in ("Apple", "Blueberries", "Egg whites", "Cottage cheese"):
        item = catalog.find(name)
        assert item.portion_woman != item.portion_man, name


def test_the_recap_lists_every_choice_with_its_amount(): # p0279
    assessed = rules.assess(sex="male", proteins=["Fish"], carbohydrates=["Broccoli", "Chickpeas"], fats=["Olives"])
    lines = rules.recap(assessed)
    assert lines == [
        "Fish - 7oz",
        "Broccoli - unlimited raw or cooked",
        "Chickpeas - 1.5 cups per meal",
        "Olives - 9 olives",
    ]


def test_a_recap_line_for_a_food_with_no_amount_says_so_rather_than_inventing_one():
    assessed = rules.assess(sex="female", carbohydrates=["Lemon"])
    assert rules.recap(assessed) == ["Lemon - amount not specified in the food lists"]


# ---------------------------------------------------------------------------
# What must never be said (p0245, p0247)
# ---------------------------------------------------------------------------

def _every_assessment():
    """A spread wide enough to exercise every advice branch."""
    cases = [
        dict(proteins=["Fish"], carbohydrates=["Broccoli"], fats=["Olives"]),
        dict(proteins=["Hard cheese or full fat cheese"], carbohydrates=["Quinoa"]),
        dict(proteins=["Lentils"], carbohydrates=["Potatoes (baked, mashed, boiled, chips)"]),
        dict(proteins=["Chicken breast, skinless or deli-style"], carbohydrates=["Kale"], cooked=True),
        dict(fats=["Vegetable shortening", "Peanuts & Peanut butter (natural)"]),
        dict(carbohydrates=["Lemon", "Sugar (all kinds)"]),
    ]
    for sex in ("female", "male"):
        for occasion in rules.OCCASIONS:
            for case in cases:
                yield rules.assess(sex=sex, occasion=occasion, **case)


def test_no_member_facing_line_mentions_calories():
    """p0245: "Do not discuss or mention calories or the calories in a food
    choice." The rule is enforced here rather than asked of a prompt."""
    for assessed in _every_assessment():
        lines = [a.text for a in assessed.advice] + rules.recap(assessed)
        lines += [c.text for c in assessed.corrections]
        for line in lines:
            lowered = line.lower()
            for banned in rules.FORBIDDEN_SUBJECTS:
                assert banned not in lowered, f"{banned!r} appeared in: {line}"


def test_no_member_facing_line_states_the_composition_percentages():
    """p0247 marks 40/30/30 as AI training, not something to tell the user."""
    for assessed in _every_assessment():
        lines = [a.text for a in assessed.advice] + rules.recap(assessed)
        for line in lines:
            assert "%" not in line
            for number in ("40", "30", "20", "15"):
                assert f"{number} percent" not in line.lower()


def test_the_composition_is_the_same_for_a_snack_as_for_a_meal(): # p0247
    """"percentages are not amounts so they do not change based on the size of
    a meal or what is chosen." There is only one table, so there is nothing to
    drift."""
    assert rules.INTERNAL_COMPOSITION == {CARBOHYDRATE: 40, PROTEIN: 30, FAT: 30}
    assert sum(rules.INTERNAL_COMPOSITION.values()) == 100


def test_an_unknown_occasion_or_sex_is_refused_rather_than_defaulted():
    with pytest.raises(ValueError):
        rules.assess(sex="female", occasion="brunch")
    with pytest.raises(ValueError):
        rules.assess(sex="unspecified")


# ---------------------------------------------------------------------------
# The clock (p0287, p0293, p0300, p0308, p0314, p0316, p0318)
# ---------------------------------------------------------------------------

def test_the_first_meal_is_an_hour_after_getting_up(): # p0287
    assert schedule.first_eating_time(time(7, 0)) == time(8, 0)
    assert schedule.first_eating_time(time(5, 30)) == time(6, 30)
    assert schedule.first_eating_time(time(23, 30)) == time(0, 30)


def test_a_meal_lasts_five_hours_and_a_snack_two(): # p0293, p0294
    assert schedule.DURATION_MINUTES[rules.MEAL] == 300
    assert schedule.DURATION_MINUTES[rules.SNACK] == 120


def test_the_next_eating_time_is_five_hours_after_a_meal(): # p0300
    day = schedule.plan_day(wake=time(7, 0), occasions=[rules.MEAL, rules.MEAL])
    assert day.first_eating_label == "8:00 am"
    assert day.occasions[0].at == time(8, 0)
    assert day.occasions[0].next_at == time(13, 0)
    assert day.occasions[1].at == time(13, 0)


def test_the_next_eating_time_is_two_hours_after_a_snack(): # p0308
    day = schedule.plan_day(wake=time(7, 0), occasions=[rules.SNACK, rules.SNACK])
    assert day.occasions[0].at == time(8, 0)
    assert day.occasions[0].next_at == time(10, 0)
    assert day.occasions[1].at == time(10, 0)


def test_a_mixed_day_adds_the_right_gap_for_each_occasion():
    day = schedule.plan_day(wake=time(6, 30),
                            occasions=[rules.MEAL, rules.SNACK, rules.MEAL, rules.SNACK])
    assert [o.at for o in day.occasions] == [time(7, 30), time(12, 30), time(14, 30), time(19, 30)]


def test_bedtime_within_four_hours_of_a_meal_ends_the_day(): # p0316
    day = schedule.plan_day(wake=time(7, 0),
                            occasions=[rules.MEAL, rules.MEAL, rules.MEAL, rules.SNACK],
                            bedtime=time(22, 0))
    assert [o.at for o in day.occasions] == [time(8, 0), time(13, 0), time(18, 0)]
    last = day.occasions[-1]
    assert last.done_after and "within 4 hours" in last.done_reason
    assert last.next_at is None
    assert day.not_scheduled == (rules.SNACK,)


def test_bedtime_within_ninety_minutes_of_a_snack_ends_the_day(): # p0318
    day = schedule.plan_day(wake=time(7, 0), occasions=[rules.SNACK, rules.SNACK], bedtime=time(9, 30))
    assert len(day.occasions) == 1
    assert day.occasions[0].done_after
    assert "1.5 hours" in day.occasions[0].done_reason
    assert day.not_scheduled == (rules.SNACK,)


def test_no_eating_time_is_ever_offered_after_bedtime():
    day = schedule.plan_day(wake=time(7, 0), occasions=[rules.MEAL] * 3, bedtime=time(23, 0))
    assert [o.at for o in day.occasions] == [time(8, 0), time(13, 0), time(18, 0)]
    assert day.occasions[-1].done_after
    assert "at or after bedtime" in day.occasions[-1].done_reason


def test_a_bedtime_after_midnight_is_that_night_not_that_morning():
    day = schedule.plan_day(wake=time(8, 0), occasions=[rules.MEAL] * 3, bedtime=time(0, 30))
    assert [o.at for o in day.occasions] == [time(9, 0), time(14, 0), time(19, 0)]
    assert day.not_scheduled == ()


def test_the_day_carries_the_sources_wording_about_the_last_occasion(): # p0314
    day = schedule.plan_day(wake=time(7, 0), occasions=[rules.MEAL], bedtime=time(22, 0))
    assert "within an hour of bedtime" in day.note


def test_without_a_bedtime_nothing_is_assumed_about_when_eating_stops():
    day = schedule.plan_day(wake=time(7, 0), occasions=[rules.MEAL] * 5)
    assert len(day.occasions) == 5
    assert day.not_scheduled == ()
    assert all(not o.done_after for o in day.occasions)
    assert day.note == ""


def test_the_clock_labels_are_the_ones_a_member_reads():
    day = schedule.plan_day(wake=time(6, 5), occasions=[rules.MEAL, rules.MEAL])
    assert day.occasions[0].at_label == "7:05 am"
    assert day.occasions[1].at_label == "12:05 pm"


def test_an_unknown_occasion_kind_is_refused():
    with pytest.raises(ValueError):
        schedule.plan_day(wake=time(7, 0), occasions=["brunch"])
