"""The HOW TO conversation, as a state machine.

The client's document describes a conversation with a fixed shape: ask the time
they get up, state when they will eat, ask snack or meal, then protein, then
carbohydrate, then fat — "Ask about one thing at a time" (p0277) — recap, state
the next eating time, and after dinner ask about bedtime.

That shape is decided here rather than asked of a language model, because
every step of it is either a question in a fixed order or arithmetic. A model
that is asked to "follow the script" will eventually ask about protein and fat
in the same breath, or add five hours and get the wrong clock time. The model's
job in this flow is to recognise which food a member meant, nothing more.

The state is a plain JSON-serialisable dict so it can be stored on the member's
session row and replayed.

Step order and the wording's provenance:

| Step | Source |
|---|---|
| `wake_time` — "Start with breakfast. Ask what time they get up, wait for an answer." | p0285 |
| state the eating time, an hour after waking, *before* asking anything else | p0287, p0289 |
| `occasion` — "ask if they want a snack or meal" | p0291, p0302 |
| `protein` — first, on its own | p0267, p0277 |
| `carbohydrate` — only once the protein is chosen | p0271, p0277 |
| `fat` — last, and skipped when the protein is cheese | p0275, p0283 |
| `confirm` — "sum up the choices", ask whether it is ok, wait | p0279, p0310 |
| `fix` — "If no, ask what is wrong and fix" | p0312 |
| `bedtime` — asked only after a confirmed dinner | p0310, p0314 |
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time

from app.food_choices import catalog, rules, schedule
from app.food_choices.catalog import CARBOHYDRATE, FAT, PROTEIN

# ---- steps ------------------------------------------------------------------
STEP_WAKE_TIME = "wake_time"
STEP_OCCASION = "occasion"
STEP_PROTEIN = "protein"
STEP_CARBOHYDRATE = "carbohydrate"
STEP_FAT = "fat"
STEP_CONFIRM = "confirm"
STEP_FIX = "fix"
STEP_CONTINUE = "continue"
STEP_BEDTIME = "bedtime"
STEP_COMPLETE = "complete"

STEPS = (
    STEP_WAKE_TIME, STEP_OCCASION, STEP_PROTEIN, STEP_CARBOHYDRATE, STEP_FAT,
    STEP_CONFIRM, STEP_FIX, STEP_CONTINUE, STEP_BEDTIME, STEP_COMPLETE,
)

GROUP_FOR_STEP = {STEP_PROTEIN: PROTEIN, STEP_CARBOHYDRATE: CARBOHYDRATE, STEP_FAT: FAT}
STEP_FOR_GROUP = {group: step for step, group in GROUP_FOR_STEP.items()}

# "Always keep answers simple and succinct. No more then couple sentences. End
# the answer with a question so client will continue conversation." (p0579)
STYLE_REF = "p0579"


class HowToError(ValueError):
    """An answer the step cannot take."""


@dataclass
class Prompt:
    """What to say next, and what kind of answer it expects."""

    step: str
    text: str
    ref: str
    # "time" | "choice" | "foods" | "none"
    answer: str = "none"
    options: tuple[str, ...] = ()
    # Lines the source tells us to say alongside the question.
    notes: tuple[str, ...] = ()
    recap: tuple[str, ...] = ()
    # The foods this step can accept, for the step that picks foods.
    candidates: tuple[str, ...] = ()


@dataclass
class Occasion:
    kind: str                       # "meal" | "snack"
    proteins: list[str] = field(default_factory=list)
    carbohydrates: list[str] = field(default_factory=list)
    fats: list[str] = field(default_factory=list)
    cooked: bool = False
    confirmed: bool = False
    at: str | None = None           # "HH:MM", set when the occasion is placed

    def foods(self, group: str) -> list[str]:
        return {PROTEIN: self.proteins, CARBOHYDRATE: self.carbohydrates, FAT: self.fats}[group]


@dataclass
class HowTo:
    """The member's HOW TO session."""

    sex: str
    step: str = STEP_WAKE_TIME
    wake: str | None = None
    bedtime: str | None = None
    occasions: list[Occasion] = field(default_factory=list)
    done_eating_reason: str = ""
    # What to say about the previous answer, when it named a food that belongs
    # to another list. Nothing is stored for a rejected answer, so without this
    # the repeated step would be silent about why (p0255, p0269).
    correction: str = ""

    # ---- serialisation ------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "sex": self.sex,
            "step": self.step,
            "wake": self.wake,
            "bedtime": self.bedtime,
            "done_eating_reason": self.done_eating_reason,
            "correction": self.correction,
            "occasions": [
                {
                    "kind": o.kind, "proteins": list(o.proteins),
                    "carbohydrates": list(o.carbohydrates), "fats": list(o.fats),
                    "cooked": o.cooked, "confirmed": o.confirmed, "at": o.at,
                }
                for o in self.occasions
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "HowTo":
        state = cls(sex=data["sex"], step=data.get("step", STEP_WAKE_TIME),
                    wake=data.get("wake"), bedtime=data.get("bedtime"),
                    done_eating_reason=data.get("done_eating_reason", ""),
                    correction=data.get("correction", ""))
        for raw in data.get("occasions", []):
            state.occasions.append(Occasion(
                kind=raw["kind"], proteins=list(raw.get("proteins", [])),
                carbohydrates=list(raw.get("carbohydrates", [])), fats=list(raw.get("fats", [])),
                cooked=bool(raw.get("cooked", False)), confirmed=bool(raw.get("confirmed", False)),
                at=raw.get("at"),
            ))
        return state

    # ---- the occasion being built ------------------------------------------
    @property
    def current(self) -> Occasion | None:
        return self.occasions[-1] if self.occasions else None

    def assessment(self) -> rules.MealAssessment | None:
        occasion = self.current
        if occasion is None:
            return None
        return rules.assess(
            sex=self.sex, occasion=occasion.kind,
            proteins=occasion.proteins, carbohydrates=occasion.carbohydrates,
            fats=occasion.fats, cooked=occasion.cooked,
        )

    def day(self) -> schedule.Day | None:
        """The day as planned so far, from the confirmed occasions."""
        if self.wake is None:
            return None
        kinds = [o.kind for o in self.occasions]
        return schedule.plan_day(wake=_time(self.wake), occasions=kinds,
                                 bedtime=_time(self.bedtime) if self.bedtime else None)


def _time(value: str) -> time:
    try:
        hour, minute = value.split(":")
        return time(hour=int(hour), minute=int(minute))
    except Exception as exc:
        raise HowToError("Give the time as HH:MM, for example 07:30.") from exc


def _ordinal_name(index: int, kind: str) -> str:
    """What to call this occasion.

    "Try and plan breakfast, lunch and dinner and snacks as the user
    indicates" (p0304) — so meals get the familiar names in order and snacks
    stay snacks.
    """
    if kind == rules.SNACK:
        return "snack"
    meals = ("breakfast", "lunch", "dinner")
    position = index
    return meals[position] if position < len(meals) else "meal"


# ---------------------------------------------------------------------------
# What to ask next
# ---------------------------------------------------------------------------

def prompt(state: HowTo) -> Prompt:
    step = state.step

    if step == STEP_WAKE_TIME:
        # p0285: "Start with breakfast. Ask what time they get up, wait for an answer."
        return Prompt(step, "Let's start with breakfast. What time do you get up?",
                      "p0285", answer="time")

    if step == STEP_OCCASION:
        # p0289: the time is stated BEFORE the snack-or-meal question.
        index = len(state.occasions)
        notes: list[str] = []
        if index == 0:
            at = schedule.first_eating_time(_time(state.wake))
            notes.append(
                f"Eat within an hour of getting up, so around {_label(at)}."
            )
            ref = "p0287, p0289, p0291"
        else:
            previous = state.occasions[-1]
            at = _next_time(state, previous)
            if at is None:
                # Bedtime has already closed the day; there is nothing to ask.
                return Prompt(STEP_COMPLETE, "That is your day planned.", "p0316, p0318",
                              notes=(state.done_eating_reason,) if state.done_eating_reason else ())
            notes.append(f"Your next time to eat is {_label(at)}.")
            ref = "p0298, p0302, p0306"
        return Prompt(STEP_OCCASION,
                      "Would you like a snack to last 2 hours, or a meal to last 5 hours?",
                      ref, answer="choice", options=(rules.SNACK, rules.MEAL), notes=tuple(notes))

    if step in (STEP_PROTEIN, STEP_CARBOHYDRATE, STEP_FAT):
        return _food_prompt(state, step)

    if step == STEP_CONFIRM:
        occasion = state.current
        assessed = state.assessment()
        name = _ordinal_name(_meal_index(state), occasion.kind)
        notes = [a.text for a in assessed.advice]
        at = _at_label(state, len(state.occasions) - 1)
        following = _next_time(state, occasion)
        if state.done_eating_reason:
            notes.append(state.done_eating_reason)
        elif following is not None:
            notes.append(f"Your next time to eat is {_label(following)}.")
        return Prompt(STEP_CONFIRM,
                      f"That is your {name} at {at}. Is that ok?",
                      "p0279, p0310", answer="choice", options=("yes", "no"),
                      notes=tuple(notes), recap=tuple(rules.recap(assessed)))

    if step == STEP_FIX:
        # p0312: "ask what is wrong and fix the dinner."
        return Prompt(STEP_FIX, "What would you like to change?", "p0312",
                      answer="choice", options=(PROTEIN, CARBOHYDRATE, FAT))

    if step == STEP_CONTINUE:
        return Prompt(STEP_CONTINUE,
                      "Would you like to plan something else to eat today, or are you finished?",
                      "p0302, p0304", answer="choice", options=("another", "finished"))

    if step == STEP_BEDTIME:
        # p0314: asked only once the meal has been confirmed.
        return Prompt(STEP_BEDTIME, "What time do you go to bed?", "p0314", answer="time")

    if step == STEP_COMPLETE:
        day = state.day()
        notes = [state.done_eating_reason] if state.done_eating_reason else []
        if day is not None and day.note:
            notes.append(day.note)
        return Prompt(STEP_COMPLETE, "That is your day planned. Shall we look at anything else?",
                      "p0579", notes=tuple(notes))

    raise HowToError(f"Unknown step {step!r}.")


def _food_prompt(state: HowTo, step: str) -> Prompt:
    group = GROUP_FOR_STEP[step]
    occasion = state.current
    assessed = state.assessment()
    notes: list[str] = []
    candidates: tuple[str, ...] = ()

    if group == PROTEIN:
        text = "What protein would you like?"
        ref = "p0267"
        notes.append(catalog.NOT_PROTEIN_NOTE)
        candidates = tuple(i.name for i in catalog.items(PROTEIN, catalog.PROTEIN_BEST))
    elif group == CARBOHYDRATE:
        text = "And what carbohydrate would you like with it?"
        ref = "p0271"
        notes.append(catalog.WHOLE_GRAIN_NOTE)
        candidates = tuple(
            i.name for i in catalog.CARBOHYDRATES
            if i.tier in (catalog.CARB_SUPER_FAVORABLE, catalog.CARB_VERY_FAVORABLE, catalog.CARB_FAVORABLE)
        )
    else:
        text = "And what fat would you like?"
        ref = "p0275"
        if occasion is not None and occasion.cooked:
            notes.append("Use light olive oil to cook the protein or saute the carbohydrates.")
        candidates = tuple(i.name for i in catalog.items(FAT, catalog.FAT_BEST))

    # Why the previous answer was not usable, if it was not.
    if state.correction:
        notes.insert(0, state.correction)

    # Anything the rules already have to say about what is chosen so far.
    if assessed is not None:
        notes.extend(a.text for a in assessed.advice if a.code != "cooking_fat" or group == FAT)
        notes.extend(c.text for c in assessed.corrections)

    return Prompt(step, text, ref, answer="foods",
                  notes=tuple(dict.fromkeys(notes)), candidates=candidates,
                  recap=tuple(rules.recap(assessed)) if assessed else ())


# ---------------------------------------------------------------------------
# Applying an answer
# ---------------------------------------------------------------------------

def advance(state: HowTo, answer: dict) -> HowTo:
    """Take one answer and move to the next step.

    Returns the same object, mutated — the caller stores `to_dict()`.
    """
    step = state.step
    # A correction belongs to the answer that caused it and to the single
    # prompt that follows; it must not persist into the step after that.
    state.correction = ""

    if step == STEP_WAKE_TIME:
        state.wake = _normalise_time(answer.get("time"))
        state.step = STEP_OCCASION
        return state

    if step == STEP_OCCASION:
        kind = (answer.get("choice") or "").strip().lower()
        if kind not in rules.OCCASIONS:
            raise HowToError("Choose a snack or a meal.")
        at = (schedule.first_eating_time(_time(state.wake)) if not state.occasions
              else _next_time(state, state.occasions[-1]))
        if at is None:
            state.step = STEP_COMPLETE
            return state
        state.occasions.append(Occasion(kind=kind, at=_hhmm(at)))
        state.step = STEP_PROTEIN
        return state

    if step in (STEP_PROTEIN, STEP_CARBOHYDRATE, STEP_FAT):
        return _take_foods(state, step, answer)

    if step == STEP_CONFIRM:
        choice = (answer.get("choice") or "").strip().lower()
        if choice not in ("yes", "no"):
            raise HowToError("Answer yes or no.")
        if choice == "no":
            state.step = STEP_FIX          # p0312
            return state
        state.current.confirmed = True
        # p0316/p0318: if a bedtime is already known, it may close the day.
        state.step = STEP_COMPLETE if state.done_eating_reason else STEP_CONTINUE
        return state

    if step == STEP_FIX:
        group = (answer.get("choice") or "").strip().lower()
        if group not in (PROTEIN, CARBOHYDRATE, FAT):
            raise HowToError("Choose the protein, the carbohydrate or the fat.")
        state.current.foods(group).clear()
        state.step = STEP_FOR_GROUP[group]
        return state

    if step == STEP_CONTINUE:
        choice = (answer.get("choice") or "").strip().lower()
        if choice == "another":
            state.step = STEP_OCCASION
            return state
        if choice == "finished":
            # p0314: bedtime is asked after a confirmed meal, not before.
            state.step = STEP_BEDTIME
            return state
        raise HowToError("Choose whether to plan something else or finish.")

    if step == STEP_BEDTIME:
        state.bedtime = _normalise_time(answer.get("time"))
        last = state.current
        if last is not None and last.at is not None:
            done, reason = schedule.done_eating_after(
                _minutes_of(last.at), last.kind, _bed_minutes(state))
            state.done_eating_reason = reason if done else ""
        state.step = STEP_COMPLETE
        return state

    if step == STEP_COMPLETE:
        raise HowToError("This plan is finished. Start again to plan another day.")

    raise HowToError(f"Unknown step {step!r}.")


def _take_foods(state: HowTo, step: str, answer: dict) -> HowTo:
    group = GROUP_FOR_STEP[step]
    occasion = state.current
    if occasion is None:  # pragma: no cover - only reachable by hand-editing state
        raise HowToError("Choose a snack or a meal first.")

    names = [str(n).strip() for n in (answer.get("foods") or []) if str(n).strip()]
    if not names:
        raise HowToError("Name at least one food from the list.")

    # The rules decide whether these belong to this group. A food on another
    # list is not stored: the member is told and asked again (p0255, p0269).
    probe = rules.assess(sex=state.sex, occasion=occasion.kind,
                         **{_kwarg(group): names})
    accepted = [c.item.name for c in probe.chosen[group]]
    if not accepted:
        # Nothing usable. The step repeats, carrying the reason: a food on
        # another list (p0255, p0269), or a name that is on no list at all.
        occasion.foods(group).clear()
        if probe.corrections:
            state.correction = probe.corrections[0].text
        else:
            unknown = ", ".join(probe.unknown)
            state.correction = (
                f"{unknown} is not on the {group} list, so I cannot use it. "
                f"Choose from the list."
            )
        return state

    stored = occasion.foods(group)
    for name in accepted:
        if name not in stored:
            stored.append(name)

    # Part of the answer was usable and part was not. The usable part is kept
    # and the rest is still corrected — saying nothing would leave the member
    # believing the legume went into the meal (p0255, p0269).
    if probe.corrections:
        state.correction = probe.corrections[0].text
    elif probe.unknown:
        state.correction = (
            f"{', '.join(probe.unknown)} is not on the {group} list, so I have not "
            f"included it."
        )

    if group == PROTEIN and "cooked" in answer:
        occasion.cooked = bool(answer["cooked"])

    state.step = _next_food_step(state)
    return state


def _kwarg(group: str) -> str:
    return {PROTEIN: "proteins", CARBOHYDRATE: "carbohydrates", FAT: "fats"}[group]


def _next_food_step(state: HowTo) -> str:
    """The next group to ask about, or the recap.

    The source's order, with the one exception it states: cheese as the protein
    needs no fat (p0283).
    """
    assessed = state.assessment()
    group = assessed.next_group
    if group is None:
        return STEP_CONFIRM
    return STEP_FOR_GROUP[group]


# ---------------------------------------------------------------------------
# clock helpers
# ---------------------------------------------------------------------------

def _normalise_time(value) -> str:
    if value is None:
        raise HowToError("Give the time as HH:MM, for example 07:30.")
    parsed = _time(str(value))
    return _hhmm(parsed)


def _hhmm(value: time) -> str:
    return f"{value.hour:02d}:{value.minute:02d}"


def _label(value: time) -> str:
    hour = value.hour % 12 or 12
    suffix = "am" if value.hour < 12 else "pm"
    return f"{hour}:{value.minute:02d} {suffix}"


def _minutes_of(hhmm: str) -> int:
    parsed = _time(hhmm)
    return parsed.hour * 60 + parsed.minute


def _bed_minutes(state: HowTo) -> int | None:
    if state.bedtime is None or state.wake is None:
        return None
    bed = _minutes_of(state.bedtime)
    wake = _minutes_of(state.wake)
    return bed + schedule.DAY_MINUTES if bed <= wake else bed


def _meal_index(state: HowTo) -> int:
    """How many meals precede the current occasion, for breakfast/lunch/dinner."""
    return sum(1 for o in state.occasions[:-1] if o.kind == rules.MEAL)


def _at_label(state: HowTo, index: int) -> str:
    occasion = state.occasions[index]
    return _label(_time(occasion.at)) if occasion.at else ""


def _next_time(state: HowTo, previous: Occasion) -> time | None:
    """p0300/p0308, with bedtime able to close the day."""
    if previous.at is None:
        return None
    following = schedule.next_eating_minutes(_minutes_of(previous.at), previous.kind)
    bed = _bed_minutes(state)
    if bed is not None and following >= bed:
        return None
    return schedule.as_time(following)


def start(sex: str) -> HowTo:
    if sex not in ("female", "male"):
        raise HowToError("The food lists give amounts for a woman and for a man.")
    return HowTo(sex=sex)


__all__ = [
    "HowTo", "HowToError", "Occasion", "Prompt", "STEPS", "STEP_WAKE_TIME",
    "STEP_OCCASION", "STEP_PROTEIN", "STEP_CARBOHYDRATE", "STEP_FAT",
    "STEP_CONFIRM", "STEP_FIX", "STEP_CONTINUE", "STEP_BEDTIME",
    "STEP_COMPLETE", "advance", "prompt", "start",
]
