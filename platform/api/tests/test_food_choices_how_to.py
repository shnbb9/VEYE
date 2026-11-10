"""The HOW TO conversation, step by step.

The source describes a conversation with a fixed shape, and the shape is the
part that goes wrong when a model is asked to remember it: asking about
protein and fat in the same breath (p0265 forbids it), asking about bedtime
before the dinner is agreed (p0312 forbids it), or getting the clock arithmetic
wrong (p0298 asks for it explicitly). Each of those is pinned here.
"""

from __future__ import annotations

import pytest

from app.food_choices import how_to, rules
from app.food_choices.catalog import CARBOHYDRATE, FAT, PROTEIN


def _say(state, **answer):
    return how_to.advance(state, answer)


def _run_to_first_meal(sex="female", kind=rules.MEAL, wake="07:00"):
    state = how_to.start(sex)
    _say(state, time=wake)
    _say(state, choice=kind)
    return state


# ---------------------------------------------------------------------------
# The opening: the time is stated before anything is asked (p0285-p0291)
# ---------------------------------------------------------------------------

def test_the_first_question_is_what_time_they_get_up(): # p0285
    state = how_to.start("female")
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_WAKE_TIME
    assert asked.answer == "time"
    assert "what time do you get up" in asked.text.lower()


def test_the_eating_time_is_stated_before_snack_or_meal_is_asked(): # p0287, p0289
    state = how_to.start("female")
    _say(state, time="07:00")
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_OCCASION
    assert any("8:00 am" in note for note in asked.notes), asked.notes
    assert any("within an hour of getting up" in note for note in asked.notes)
    # and only then the question
    assert "snack" in asked.text.lower() and "meal" in asked.text.lower()


def test_the_occasion_question_states_both_durations(): # p0302
    state = how_to.start("male")
    _say(state, time="06:30")
    asked = how_to.prompt(state)
    assert "2 hours" in asked.text and "5 hours" in asked.text
    assert asked.options == (rules.SNACK, rules.MEAL)


def test_a_time_that_is_not_a_time_is_refused_rather_than_guessed():
    state = how_to.start("female")
    with pytest.raises(how_to.HowToError):
        _say(state, time="when the sun comes up")
    with pytest.raises(how_to.HowToError):
        _say(state, time=None)


def test_a_session_needs_a_sex_because_the_portions_differ():
    with pytest.raises(how_to.HowToError):
        how_to.start("unspecified")


# ---------------------------------------------------------------------------
# One thing at a time, protein first (p0263, p0265, p0267, p0277)
# ---------------------------------------------------------------------------

def test_protein_is_asked_first_and_on_its_own():
    state = _run_to_first_meal()
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_PROTEIN
    assert "protein" in asked.text.lower()
    assert "carbohydrate" not in asked.text.lower()
    assert "fat" not in asked.text.lower()


def test_the_protein_question_says_what_is_not_a_protein(): # p0255, p0269
    asked = how_to.prompt(_run_to_first_meal())
    assert any("not proteins" in note for note in asked.notes)


def test_the_protein_question_offers_the_best_choices_only():
    asked = how_to.prompt(_run_to_first_meal())
    assert "Fish" in asked.candidates
    assert "Salami" not in asked.candidates, "a poor choice was offered as a suggestion"


def test_carbohydrate_is_asked_next_and_mentions_neither_of_the_others():
    state = _run_to_first_meal()
    _say(state, foods=["Fish"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_CARBOHYDRATE
    assert "carbohydrate" in asked.text.lower()
    assert "protein" not in asked.text.lower()


def test_the_carbohydrate_question_says_whole_grains_are_not_recommended(): # p0241, p0257
    state = _run_to_first_meal()
    _say(state, foods=["Fish"])
    asked = how_to.prompt(state)
    assert any("Whole grains" in note for note in asked.notes)
    assert "Quinoa" not in asked.candidates
    assert "Broccoli" in asked.candidates


def test_fat_is_asked_last():
    state = _run_to_first_meal()
    _say(state, foods=["Fish"])
    _say(state, foods=["Broccoli", "Chickpeas"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_FAT
    assert "fat" in asked.text.lower()


def test_the_recap_comes_only_when_all_three_are_chosen(): # p0263, p0279
    state = _run_to_first_meal()
    _say(state, foods=["Fish"])
    _say(state, foods=["Broccoli", "Chickpeas"])
    _say(state, foods=["Olives"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_CONFIRM
    assert asked.recap == (
        "Fish - 5oz", "Broccoli - unlimited raw or cooked",
        "Chickpeas - 1 cup per meal", "Olives - 9 olives",
    )


# ---------------------------------------------------------------------------
# Cheese (p0283)
# ---------------------------------------------------------------------------

def test_cheese_as_the_protein_skips_the_fat_question_entirely():
    state = _run_to_first_meal()
    _say(state, foods=["Hard cheese or full fat cheese"])
    _say(state, foods=["Spinach", "Lentils"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_CONFIRM, "the member was asked for a fat after cheese"
    assert any("already contains fat" in note for note in asked.notes)


# ---------------------------------------------------------------------------
# A food on another list (p0255, p0269)
# ---------------------------------------------------------------------------

def test_lentils_as_a_protein_repeats_the_question_with_the_reason():
    state = _run_to_first_meal()
    _say(state, foods=["Lentils"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_PROTEIN, "a legume was accepted as the protein"
    assert any("not proteins" in note for note in asked.notes)
    assert state.current.proteins == []


def test_a_food_on_no_list_repeats_the_question_and_says_so():
    state = _run_to_first_meal()
    _say(state, foods=["Ostrich jerky"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_PROTEIN
    assert any("Ostrich jerky" in note and "not on the protein list" in note for note in asked.notes)


def test_the_correction_does_not_follow_the_member_into_the_next_step():
    state = _run_to_first_meal()
    _say(state, foods=["Lentils"])          # refused
    _say(state, foods=["Fish"])             # accepted
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_CARBOHYDRATE
    assert not any("not proteins" in note for note in asked.notes)


def test_an_empty_answer_is_refused():
    state = _run_to_first_meal()
    with pytest.raises(how_to.HowToError):
        _say(state, foods=[])


def test_the_usable_part_of_a_mixed_answer_is_kept_and_the_rest_corrected():
    state = _run_to_first_meal()
    _say(state, foods=["Fish", "Lentils"])
    assert state.current.proteins == ["Fish"]
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_CARBOHYDRATE
    # Silence here would leave the member thinking the lentils went in.
    assert any("not proteins" in note for note in asked.notes), asked.notes


def test_a_partly_unknown_answer_keeps_what_it_can_and_says_what_it_dropped():
    state = _run_to_first_meal()
    _say(state, foods=["Fish", "Ostrich jerky"])
    assert state.current.proteins == ["Fish"]
    asked = how_to.prompt(state)
    assert any("Ostrich jerky" in note and "not included" in note for note in asked.notes)


# ---------------------------------------------------------------------------
# Cooking the protein (p0281, p0296)
# ---------------------------------------------------------------------------

def test_cooking_the_protein_names_light_olive_oil_at_the_fat_step():
    state = _run_to_first_meal()
    _say(state, foods=["Chicken breast, skinless or deli-style"], cooked=True)
    _say(state, foods=["Broccoli", "Chickpeas"])
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_FAT
    assert any("light olive oil" in note for note in asked.notes)


# ---------------------------------------------------------------------------
# Confirm, and fixing it (p0279, p0310, p0312)
# ---------------------------------------------------------------------------

def _complete_a_meal(state, protein="Fish", carb="Broccoli", carb2="Chickpeas", fat="Olives"):
    _say(state, foods=[protein])
    _say(state, foods=[carb, carb2])
    if how_to.prompt(state).step == how_to.STEP_FAT:
        _say(state, foods=[fat])
    return state


def test_the_recap_names_the_meal_and_its_time(): # p0279, p0304
    state = _complete_a_meal(_run_to_first_meal())
    asked = how_to.prompt(state)
    assert "breakfast" in asked.text
    assert "8:00 am" in asked.text


def test_the_next_eating_time_is_stated_with_the_recap(): # p0298
    state = _complete_a_meal(_run_to_first_meal())
    asked = how_to.prompt(state)
    assert any("1:00 pm" in note for note in asked.notes), asked.notes


def test_a_snack_puts_the_next_time_two_hours_later(): # p0308
    state = _complete_a_meal(_run_to_first_meal(kind=rules.SNACK))
    asked = how_to.prompt(state)
    assert any("10:00 am" in note for note in asked.notes), asked.notes


def test_saying_no_asks_what_to_change_and_does_not_ask_about_bedtime(): # p0312
    state = _complete_a_meal(_run_to_first_meal())
    _say(state, choice="no")
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_FIX
    assert "change" in asked.text.lower()
    assert "bed" not in asked.text.lower()


def test_fixing_a_group_clears_only_that_group_and_asks_again():
    state = _complete_a_meal(_run_to_first_meal())
    _say(state, choice="no")
    _say(state, choice=CARBOHYDRATE)
    assert state.step == how_to.STEP_CARBOHYDRATE
    assert state.current.carbohydrates == []
    assert state.current.proteins == ["Fish"], "the protein was cleared too"
    assert state.current.fats == ["Olives"]


def test_bedtime_is_not_asked_until_a_meal_is_confirmed(): # p0310, p0314
    state = _complete_a_meal(_run_to_first_meal())
    assert how_to.prompt(state).step == how_to.STEP_CONFIRM
    _say(state, choice="yes")
    asked = how_to.prompt(state)
    assert asked.step == how_to.STEP_CONTINUE
    _say(state, choice="finished")
    assert how_to.prompt(state).step == how_to.STEP_BEDTIME


def test_a_confirm_answer_that_is_neither_yes_nor_no_is_refused():
    state = _complete_a_meal(_run_to_first_meal())
    with pytest.raises(how_to.HowToError):
        _say(state, choice="maybe")


# ---------------------------------------------------------------------------
# A whole day
# ---------------------------------------------------------------------------

def test_a_three_meal_day_lands_on_the_right_clock_times():
    state = how_to.start("male")
    _say(state, time="07:00")
    for _ in range(3):
        _say(state, choice=rules.MEAL)
        _complete_a_meal(state)
        _say(state, choice="yes")
        if state.step == how_to.STEP_CONTINUE:
            _say(state, choice="another")
    assert [o.at for o in state.occasions] == ["08:00", "13:00", "18:00"]
    assert all(o.confirmed for o in state.occasions)


def test_bedtime_within_four_hours_of_the_last_meal_closes_the_day(): # p0316
    state = how_to.start("female")
    _say(state, time="07:00")
    _say(state, choice=rules.MEAL)
    _complete_a_meal(state)
    _say(state, choice="yes")
    _say(state, choice="finished")
    _say(state, time="11:00")           # 3 hours after the 08:00 meal
    assert state.step == how_to.STEP_COMPLETE
    assert "within 4 hours" in state.done_eating_reason
    assert "last thing to eat today" in state.done_eating_reason


def test_bedtime_well_clear_of_the_last_meal_does_not_claim_they_are_done():
    state = how_to.start("female")
    _say(state, time="07:00")
    _say(state, choice=rules.MEAL)
    _complete_a_meal(state)
    _say(state, choice="yes")
    _say(state, choice="finished")
    _say(state, time="23:00")
    assert state.step == how_to.STEP_COMPLETE
    assert state.done_eating_reason == ""


def test_bedtime_within_ninety_minutes_of_a_snack_closes_the_day(): # p0318
    state = how_to.start("female")
    _say(state, time="07:00")
    _say(state, choice=rules.SNACK)
    _complete_a_meal(state)
    _say(state, choice="yes")
    _say(state, choice="finished")
    _say(state, time="09:00")           # 1 hour after the 08:00 snack
    assert "1.5 hours" in state.done_eating_reason


def test_a_bedtime_after_midnight_is_that_night():
    state = how_to.start("female")
    _say(state, time="08:00")
    _say(state, choice=rules.MEAL)
    _complete_a_meal(state)
    _say(state, choice="yes")
    _say(state, choice="finished")
    _say(state, time="00:30")
    assert state.done_eating_reason == "", "a bedtime after midnight was read as the same morning"


def test_the_finished_plan_cannot_be_advanced_again():
    state = how_to.start("female")
    _say(state, time="07:00")
    _say(state, choice=rules.MEAL)
    _complete_a_meal(state)
    _say(state, choice="yes")
    _say(state, choice="finished")
    _say(state, time="23:00")
    with pytest.raises(how_to.HowToError):
        _say(state, choice="another")


def test_the_day_can_be_read_back_as_a_schedule():
    state = how_to.start("female")
    _say(state, time="07:00")
    _say(state, choice=rules.MEAL)
    _complete_a_meal(state)
    _say(state, choice="yes")
    _say(state, choice="another")
    _say(state, choice=rules.SNACK)
    day = state.day()
    assert [o.at_label for o in day.occasions] == ["8:00 am", "1:00 pm"]


# ---------------------------------------------------------------------------
# The state survives a round trip (it is stored on the member's row)
# ---------------------------------------------------------------------------

def test_the_state_round_trips_through_json():
    import json

    state = _complete_a_meal(_run_to_first_meal(sex="male", kind=rules.SNACK, wake="06:15"))
    state.correction = "something to carry"
    restored = how_to.HowTo.from_dict(json.loads(json.dumps(state.to_dict())))
    assert restored.to_dict() == state.to_dict()
    assert how_to.prompt(restored).recap == how_to.prompt(state).recap


# ---------------------------------------------------------------------------
# What must never be said (p0245, p0247)
# ---------------------------------------------------------------------------

def _every_prompt():
    """Walk the conversation widely enough to see every line it can emit."""
    seen = []
    for sex in ("female", "male"):
        for kind in rules.OCCASIONS:
            for protein in ("Fish", "Hard cheese or full fat cheese"):
                for carbs in (["Broccoli"], ["Quinoa"], ["Spinach", "Chickpeas"],
                              ["Potatoes (baked, mashed, boiled, chips)"]):
                    state = how_to.start(sex)
                    seen.append(how_to.prompt(state))
                    _say(state, time="07:00")
                    seen.append(how_to.prompt(state))
                    _say(state, choice=kind)
                    seen.append(how_to.prompt(state))
                    _say(state, foods=[protein], cooked=True)
                    seen.append(how_to.prompt(state))
                    _say(state, foods=carbs)
                    seen.append(how_to.prompt(state))
                    if state.step == how_to.STEP_FAT:
                        _say(state, foods=["Vegetable shortening"])
                        seen.append(how_to.prompt(state))
                    _say(state, choice="yes")
                    seen.append(how_to.prompt(state))
                    _say(state, choice="finished")
                    seen.append(how_to.prompt(state))
                    _say(state, time="22:30")
                    seen.append(how_to.prompt(state))
    return seen


def test_nothing_the_conversation_says_mentions_calories(): # p0245
    for asked in _every_prompt():
        for line in (asked.text, *asked.notes, *asked.recap):
            lowered = line.lower()
            for banned in rules.FORBIDDEN_SUBJECTS:
                assert banned not in lowered, f"{banned!r} appeared in: {line}"


def test_nothing_the_conversation_says_states_the_composition(): # p0247
    """It is the percentages that are AI-only. A portion that happens to be
    "40 grams" is the source's own per-food figure (p0504) and belongs in a
    recap, so the test looks for percentage shapes rather than bare numbers -
    an earlier version of this assertion let "40" through on an `or` and was
    therefore pinning nothing."""
    import re

    percentage = re.compile(r"\d+\s*(?:%|percent)", re.IGNORECASE)
    for asked in _every_prompt():
        for line in (asked.text, *asked.notes, *asked.recap):
            assert "%" not in line, line
            assert not percentage.search(line), line
            for part in ("40 carb", "30 protein", "30 fat", "20 carb", "15 protein"):
                assert part not in line.lower()


def test_every_prompt_carries_the_paragraph_it_came_from():
    for asked in _every_prompt():
        assert asked.ref, f"step {asked.step} has no source reference"
