"""When to eat: the arithmetic the source asks the AI to do.

"Tell them what time their next meal will be.  The AI needs to  do the math."
(p0298, repeated p0306.) It is arithmetic, so it is done here and tested,
rather than left to a language model that will occasionally add five hours to
7:30 and get 11:30.

The rules, all from `AI Chatbot Training.docx`:

| Rule | Source |
|---|---|
| Ask what time they get up; eat within an hour of getting up, and state that time | p0285-p0289 |
| A meal lasts about 5 hours, a snack about 2 | p0293, p0294, p0302 |
| After a meal the next eating time is 5 hours later; after a snack, 2 | p0300, p0308 |
| If they go to bed within 4 hours after a meal they are done eating | p0316 |
| If they go to bed within 1.5 hours after a snack they are done eating | p0318 |
| The last snack or meal can end within an hour of bedtime | p0314 |

p0314 and p0316/p0318 are not the same test, and the source does not say how
to reconcile them. The numeric rules decide when eating stops, because they
are the ones stated as numbers; p0314 is carried as the wording for the last
occasion of the day. Nothing interpolates between them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from app.food_choices.rules import MEAL, OCCASIONS, SNACK

# ---- the source's figures, in minutes --------------------------------------
WAKE_TO_FIRST_EATING_MINUTES = 60          # p0287: "within an hour of getting up"
DURATION_MINUTES = {MEAL: 5 * 60, SNACK: 2 * 60}        # p0293, p0294
DONE_BEFORE_BED_MINUTES = {MEAL: 4 * 60, SNACK: 90}     # p0316, p0318
LAST_OCCASION_ENDS_WITHIN_MINUTES = 60     # p0314

REFS = {
    "first_eating": "p0287",
    "gap": "p0300, p0308",
    "duration": "p0293, p0294",
    "done": "p0316, p0318",
    "last": "p0314",
}

DAY_MINUTES = 24 * 60


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def as_time(minutes: int) -> time:
    """Minutes since midnight as a clock time, wrapping past midnight."""
    minutes %= DAY_MINUTES
    return time(hour=minutes // 60, minute=minutes % 60)


def _label(minutes: int) -> str:
    """A clock time a member reads, e.g. "7:30 am"."""
    clock = as_time(minutes)
    hour = clock.hour % 12 or 12
    suffix = "am" if clock.hour < 12 else "pm"
    return f"{hour}:{clock.minute:02d} {suffix}"


@dataclass(frozen=True)
class Occasion:
    kind: str           # "meal" or "snack"
    at: time
    at_label: str
    ends_at: time       # at + 5h for a meal, + 2h for a snack
    ends_at_label: str
    # The next eating time, or None when bedtime closes the day.
    next_at: time | None
    next_at_label: str | None
    # Set on the occasion after which the source says eating stops.
    done_after: bool = False
    done_reason: str = ""


@dataclass(frozen=True)
class Day:
    wake: time
    first_eating_at: time
    first_eating_label: str
    occasions: tuple[Occasion, ...]
    bedtime: time | None = None
    # Occasions asked for that bedtime left no room for.
    not_scheduled: tuple[str, ...] = ()
    note: str = ""


def first_eating_minutes(wake: time) -> int:
    """p0287: an hour after getting up, and the AI states the time."""
    return _minutes(wake) + WAKE_TO_FIRST_EATING_MINUTES


def first_eating_time(wake: time) -> time:
    return as_time(first_eating_minutes(wake))


def next_eating_minutes(at_minutes: int, kind: str) -> int:
    """p0300/p0308: 5 hours after a meal, 2 hours after a snack."""
    if kind not in OCCASIONS:
        raise ValueError(f"kind must be one of {OCCASIONS}, not {kind!r}")
    return at_minutes + DURATION_MINUTES[kind]


def done_eating_after(at_minutes: int, kind: str, bedtime_minutes: int | None) -> tuple[bool, str]:
    """p0316 / p0318, read literally.

    A meal closes the day when bedtime falls within 4 hours of it; a snack
    when bedtime falls within 1.5 hours. The day also closes when the next
    eating time would land at or after bedtime - no eating time is ever
    offered after the member has gone to bed.
    """
    if bedtime_minutes is None:
        return False, ""
    window = DONE_BEFORE_BED_MINUTES[kind]
    if bedtime_minutes - at_minutes <= window:
        hours = window / 60
        shown = int(hours) if hours.is_integer() else hours
        return True, (
            f"Bedtime is within {shown} hours of this {kind}, so that is the last "
            f"thing to eat today."
        )
    if next_eating_minutes(at_minutes, kind) >= bedtime_minutes:
        return True, "The next eating time would fall at or after bedtime, so the day is finished."
    return False, ""


def plan_day(*, wake: time, occasions: list[str], bedtime: time | None = None) -> Day:
    """Lay the day out from the time they get up.

    `occasions` is what the member chose, in order — the source asks each time
    whether they want "a snack to last 2 hours, or a meal to last 5 hours"
    (p0302), so the kinds are the member's answers, not a pattern this module
    picks.
    """
    for kind in occasions:
        if kind not in OCCASIONS:
            raise ValueError(f"kind must be one of {OCCASIONS}, not {kind!r}")

    wake_minutes = _minutes(wake)
    bed_minutes = None
    if bedtime is not None:
        bed_minutes = _minutes(bedtime)
        # A bedtime at or before the wake time is that night, not that morning.
        if bed_minutes <= wake_minutes:
            bed_minutes += DAY_MINUTES

    planned: list[Occasion] = []
    not_scheduled: list[str] = []
    at = first_eating_minutes(wake)
    closed = False

    for index, kind in enumerate(occasions):
        if closed:
            not_scheduled.append(kind)
            continue
        if bed_minutes is not None and at >= bed_minutes:
            not_scheduled.append(kind)
            closed = True
            continue

        following = next_eating_minutes(at, kind)
        done, reason = done_eating_after(at, kind, bed_minutes)
        is_last_requested = index == len(occasions) - 1
        planned.append(Occasion(
            kind=kind,
            at=as_time(at),
            at_label=_label(at),
            ends_at=as_time(following),
            ends_at_label=_label(following),
            next_at=None if (done or is_last_requested) else as_time(following),
            next_at_label=None if (done or is_last_requested) else _label(following),
            done_after=done,
            done_reason=reason,
        ))
        if done:
            closed = True
        at = following

    note = ""
    if bedtime is not None and planned:
        note = (
            "The last snack or meal of the day can end within an hour of bedtime."
        )

    return Day(
        wake=wake,
        first_eating_at=as_time(first_eating_minutes(wake)),
        first_eating_label=_label(first_eating_minutes(wake)),
        occasions=tuple(planned),
        bedtime=bedtime,
        not_scheduled=tuple(not_scheduled),
        note=note,
    )


__all__ = [
    "Occasion", "Day", "plan_day", "first_eating_time", "first_eating_minutes",
    "next_eating_minutes", "done_eating_after", "as_time", "DURATION_MINUTES",
    "DONE_BEFORE_BED_MINUTES", "WAKE_TO_FIRST_EATING_MINUTES", "DAY_MINUTES",
]
