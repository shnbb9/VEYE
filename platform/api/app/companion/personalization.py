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
