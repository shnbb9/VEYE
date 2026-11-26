"""Personalization tokens.

The prompt never carries the member's name. It carries an application-defined
placeholder; when the model's reply contains that exact token, VEYE replaces
it inside its own trust boundary after the response returns. Only tokens
listed here are ever substituted — an arbitrary `{{SOMETHING}}` the model
invents is left untouched."""

from __future__ import annotations

import re
from dataclasses import dataclass

MEMBER_FIRST_NAME_TOKEN = "{{MEMBER_FIRST_NAME}}"
KNOWN_TOKENS = frozenset({MEMBER_FIRST_NAME_TOKEN})

_TOKEN_RE = re.compile(r"\{\{[A-Z_]+\}\}")


@dataclass(frozen=True)
class PersonalizationResult:
    text: str
    substituted: tuple[str, ...]
    unknown_tokens: tuple[str, ...]


def substitute(text: str, values: dict[str, str]) -> PersonalizationResult:
    substituted: list[str] = []
    unknown: list[str] = []

    def replace(match: re.Match) -> str:
        token = match.group(0)
        if token in KNOWN_TOKENS and token in values:
            substituted.append(token)
            return values[token]
        unknown.append(token)
        return token

    result = _TOKEN_RE.sub(replace, text)
    return PersonalizationResult(text=result, substituted=tuple(substituted), unknown_tokens=tuple(unknown))


def as_written(text: str, first_name: str | None) -> str:
    """Sprout's own earlier reply, as the model wrote it.

    VEYE filled the member's first name in where the model had written the
    token. Sent back in a later prompt, the name would reach the outbound
    filter and become a redaction mark, and a model copies what it is shown:
    the member would read "Hello [REDACTED:identifier]". So the token goes
    back instead. Exact case and whole words only: for somebody called May,
    "you may" stays a word."""
    name = (first_name or "").strip()
    if len(name) < 2:
        return text
    return re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", MEMBER_FIRST_NAME_TOKEN, text)


# A mark the outbound filter or the output check left, with or without a kind.
_MARK_RE = re.compile(r"\[REDACTED(?::([a-z_]+))?\]")
# What a member reads instead. Their own identifier is, in a reply to them, their
# first name: the token, which VEYE fills in a moment later.
_MARK_WORDS = {"identifier": MEMBER_FIRST_NAME_TOKEN, "email": "your email address", "phone": "your phone number",
               "id": "that number", "number": "that number"}


def without_marks(text: str) -> tuple[str, int]:
    """A model that was shown a redaction mark may write one; a member must
    never read one. Runs after the output safety check, on what it passed."""
    count = 0

    def word(match: re.Match) -> str:
        nonlocal count
        count += 1
        return _MARK_WORDS.get(match.group(1) or "", "that detail")

    return _MARK_RE.sub(word, text), count
