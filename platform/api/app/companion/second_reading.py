"""A second reading of a message the rules saw nothing in.

`distress.py` hears what is said. People also say it without saying it, and no
list of phrases has that in it. This adds up the words instead: each word, each
pair of words, and each few letters of a word (so that a word it has not met,
or cannot spell, still counts for something) is worth a little towards or away,
learnt once from the sentences the rules are tested on
(`tests/train_second_reading.py`) and kept in `second_reading.json` as plain
numbers. No model runs and nothing leaves; the same message always reads the
same.

It is a guess, so it may only ever be gentle. It adds a sentence to an ordinary
answer, or asks, where Sprout would have said a question is outside what it can
help with. It never tells anybody, never marks a conversation, and never stands
in the way of an answer.

ENGINEERING DRAFT, with everything it was measured on: Cara's to approve.
"""

from __future__ import annotations

import json
import logging
import math
import re
from functools import lru_cache
from importlib.resources import files

log = logging.getLogger(__name__)
_WORD = re.compile(r"[a-z]+")
FEWEST = 5      # a word or two is not enough to guess from
LETTERS = range(3, 6)


@lru_cache(maxsize=1)
def table() -> dict:
    return json.loads(files("app.companion").joinpath("second_reading.json").read_text(encoding="utf-8"))


def features(text: str) -> tuple[set[str], set[str]]:
    """What is said, and the letters it is said with."""
    words = _WORD.findall(re.sub(r"[~']", "", text))
    letters = {"#" + word[at:at + n] for word in (f" {w} " for w in set(words)) for n in LETTERS for at in range(len(word) - n + 1)}
    return {*words, *(f"{a} {b}" for a, b in zip(words, words[1:]))}, letters


def score(text: str) -> float:
    """From 0 to 1, over words whose sayings and denials were already set aside."""
    weights = table()["weights"]
    total = table()["bias"]
    for block, fewest in zip(features(text), (FEWEST, 1)):
        known = sorted(feature for feature in block if feature in weights)
        if len(known) < fewest:
            return 0.0
        total += sum(weights[feature] for feature in known) / math.sqrt(len(known))
    return 1 / (1 + math.exp(-total))


def worried(text: str) -> bool:
    """An extra pair of ears: if it cannot be read, the rules still stand."""
    try:
        return score(text) >= table()["threshold"]
    except (OSError, ValueError, KeyError):
        log.exception("the second reading could not be read")
        return False
