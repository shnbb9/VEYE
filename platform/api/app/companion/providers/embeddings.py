"""EmbeddingProvider: text -> vector, independent of the LLMProvider.

The hashing provider is a deterministic local embedding (feature hashing of
normalised word and bigram tokens into a fixed-width vector). It gives real
pgvector cosine retrieval without any external service, which is all the
development environment needs. An external provider (a client decision) would
implement the same protocol and would only ever see approved, non-member
content: knowledge documents and the already privacy-filtered query text.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have how i in is it its my of on or that the this to was what "
    "when where which who will with you your can do does should could would about me".split()
)


class EmbeddingProvider(Protocol):
    name: str
    model: str
    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...

    def describe(self) -> dict[str, object]: ...


def normalise_tokens(text: str) -> list[str]:
    words = [w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS and len(w) > 1]
    stems = [_stem(w) for w in words]
    bigrams = [f"{a}_{b}" for a, b in zip(stems, stems[1:])]
    return stems + bigrams


def _stem(word: str) -> str:
    for suffix in ("ing", "ies", "ed", "es", "s"):
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            return word[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return word


class HashingEmbeddingProvider:
    name = "hashing"

    def __init__(self, dimensions: int = 256) -> None:
        self.dimensions = dimensions
        self.model = f"veye-hashing-{dimensions}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for token in normalise_tokens(text):
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] & 1 else -1.0
            weight = 0.5 if "_" in token else 1.0  # bigrams count for less than words
            vector[index] += sign * weight
        norm = math.sqrt(sum(v * v for v in vector))
        return [v / norm for v in vector] if norm else vector

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "model": self.model, "configured": True, "external": False}


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def build_embedding_provider(kind: str, *, dimensions: int) -> EmbeddingProvider:
    if kind == "hashing":
        return HashingEmbeddingProvider(dimensions)
    raise ValueError(f"Unknown embedding provider '{kind}'. The production embedding provider is a client decision.")
