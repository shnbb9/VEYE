"""Learn the word weights in `app/companion/second_reading.json`, and say how far
to trust them. Run it after changing a sentence set, or what the rules set aside:

    python -m tests.train_second_reading --write             # learn, and write the weights (a few minutes)
    python -m tests.train_second_reading --across            # how it does on an author it has not read (longer)
    python -m tests.train_second_reading --unseen            # and on the sentences held back

No dependency and no randomness: the same sentences always give the same file.
The `unseen` sets are never trained on: the numbers in `test_safety_sentences.py`
are measured with them, once, before anybody reads them.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

from app.companion.distress import second_reading_text
from app.companion.second_reading import FEWEST, features

CONTRACTS = Path(__file__).parent / "contracts"
TRAINED_ON = ("safety_sentences.json", "safety_sentences_2.json", "safety_sentences_3.json", "safety_sentences_4.json", "safety_sentences_5.json",
              "safety_sentences_own.json")
UNSEEN = ("safety_sentences_unseen.json", "safety_sentences_unseen_2.json")
AT_RISK = ("imminent", "self_harm", "check_in", "medical_emergency")
OUT = Path(__file__).parents[1] / "app" / "companion" / "second_reading.json"

STRENGTH, THRESHOLD, ROUNDS = 2.0, 0.65, 160
SEEN_AT_LEAST = (3, 10)                 # a word or a pair; a few letters
STEPS = 14                              # of the power iteration for the step size


def rows(name: str) -> list[dict]:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def fingerprint() -> str:
    """Of the sentences, not of the file they are in."""
    text = "\n".join(f"{row['want']}\t{row['text']}" for name in TRAINED_ON for row in rows(name))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def learn(sentences: list[dict]) -> tuple[float, dict[str, float]]:
    """Regularised logistic regression on words, pairs of words and letters, each
    sentence the same length in both and each side the same weight in total."""
    read = [features(second_reading_text(row["text"])) for row in sentences]
    seen: dict[str, int] = {}
    for blocks in read:
        for block in blocks:
            for feature in block:
                seen[feature] = seen.get(feature, 0) + 1
    names = sorted(feature for feature, n in seen.items() if n >= SEEN_AT_LEAST[feature.startswith("#")])
    index = {name: i for i, name in enumerate(names)}
    x: list[list[tuple[float, list[int]]]] = []
    for blocks in read:
        known = [sorted(index[f] for f in block if f in index) for block in blocks]
        x.append([(1 / math.sqrt(len(found)), found) for found in known if found])
    y = [1 if row["want"] in AT_RISK else 0 for row in sentences]
    sides = {1: len(y) / (2 * sum(y)), 0: len(y) / (2 * (len(y) - sum(y)))}
    n = len(names)

    def dot(row: list[tuple[float, list[int]]], w: list[float]) -> float:
        return sum(s * sum(w[i] for i in found) for s, found in row)

    # How steep it can be, then accelerated descent with that step.
    v, steep = [1.0] * n, 1.0
    for _ in range(STEPS):
        out = [0.0] * n
        for row, label in zip(x, y):
            pull = dot(row, v) * sides[label]
            for s, found in row:
                push = pull * s
                for i in found:
                    out[i] += push
        steep = math.sqrt(sum(value * value for value in out)) or 1.0
        v = [value / steep for value in out]
    step = 1 / (1 + STRENGTH * 0.25 * (steep + len(y)))

    w, bias = [0.0] * n, 0.0
    ahead, ahead_bias, t = list(w), bias, 1.0
    for _ in range(ROUNDS):
        grad, grad_bias = list(ahead), 0.0
        for row, label in zip(x, y):
            p = 1 / (1 + math.exp(-(ahead_bias + dot(row, ahead))))
            pull = STRENGTH * sides[label] * (p - label)
            grad_bias += pull
            for s, found in row:
                push = pull * s
                for i in found:
                    grad[i] += push
        new = [a - step * g for a, g in zip(ahead, grad)]
        new_bias = ahead_bias - step * grad_bias
        t_next = (1 + math.sqrt(1 + 4 * t * t)) / 2
        push = (t - 1) / t_next
        ahead = [b + push * (b - a) for a, b in zip(w, new)]
        ahead_bias = new_bias + push * (new_bias - bias)
        w, bias, t = new, new_bias, t_next
    return round(bias, 3), {name: round(value, 2) for name, value in zip(names, w)}


def read_with(bias: float, weights: dict[str, float], text: str) -> float:
    total = bias
    for block, fewest in zip(features(second_reading_text(text)), (FEWEST, 1)):
        known = sorted(f for f in block if f in weights)
        if len(known) < fewest:
            return 0.0
        total += sum(weights[f] for f in known) / math.sqrt(len(known))
    return 1 / (1 + math.exp(-total))


def measure(name: str, bias: float, weights: dict[str, float], test: list[dict]) -> None:
    scored = [(read_with(bias, weights, row["text"]), row["want"]) for row in test]
    parts = []
    for threshold in (0.6, 0.65, 0.7, 0.75, 0.8):
        share = lambda wants: sum(p >= threshold for p, want in scored if want in wants) / max(1, sum(want in wants for _, want in scored))  # noqa: E731
        parts.append(f"{threshold}: at risk {share(AT_RISK):.2f}, ordinary {share(('none',)):.3f}")
    print(f"{name:34} {'   '.join(parts)}", flush=True)


def main() -> None:
    sets = {name: rows(name) for name in TRAINED_ON}
    if "--across" in sys.argv:
        for held_out in TRAINED_ON:
            bias, weights = learn([row for name, found in sets.items() if name != held_out for row in found])
            measure(f"without {held_out}", bias, weights, sets[held_out])
        return
    bias, weights = learn([row for found in sets.values() for row in found])
    print(f"{len(weights)} weights from {sum(len(found) for found in sets.values())} sentences")
    if "--unseen" in sys.argv:
        for name in UNSEEN:
            measure(name, bias, weights, rows(name))
    if "--write" in sys.argv:
        OUT.write_text(json.dumps({"about": "Written by tests/train_second_reading.py. Do not edit.", "sentences": fingerprint(),
                                   "threshold": THRESHOLD, "bias": bias, "weights": weights}, indent=0, ensure_ascii=True) + "\n",
                       encoding="utf-8", newline="\n")
        print("written", OUT)


if __name__ == "__main__":
    main()
