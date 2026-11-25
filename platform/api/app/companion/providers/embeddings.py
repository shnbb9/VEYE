"""EmbeddingProvider: text -> vector, independent of the LLMProvider.

The hashing provider is a deterministic local embedding (feature hashing of
normalised word and bigram tokens into a fixed-width vector). It gives real
pgvector cosine retrieval without any external service, which is all the
development environment needs.

**An embedding call is a disclosure, and one of the two callers carries a
member's own words.** Ingestion embeds approved knowledge documents, which is
nobody's personal data. Retrieval embeds the member's question — and the
Companion retrieves *before* it runs the outbound privacy filter, so that text
is the member's raw words, not redacted ones. With the local hashing provider
nothing leaves the machine and the ordering does not matter. With an external
provider it matters completely, which is why `embed` takes the same
`DataClassification` the language model takes and an external provider refuses
real-member text unless the deployment has declared that clearance.

An earlier version of this docstring claimed the query text was "already
privacy-filtered". It is not, and a provider written against that claim would
have sent a member's question to a third party in the clear.

`purpose` distinguishes the two callers for providers that ask: a corpus
passage and a search query are embedded differently by Google's models
(RETRIEVAL_DOCUMENT against RETRIEVAL_QUERY), and using one for the other
measurably costs recall.

**`index` names what a vector may be compared with.** Two vectors mean nothing
to each other unless the same model wrote them, at the same width, through the
same door. The knowledge base writes it beside every vector and only ever
searches its own, so a change of provider never mixes two kinds: it asks for an
index that has not been built yet, and says so.
"""

from __future__ import annotations

import hashlib
import math
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, Protocol

from app.companion.providers.google_backend import DEVELOPER, EMBEDS_FROM, VERTEX, Refused, choose_backend
from app.companion.providers.llm import ClientContentNotAllowed, DataClassification, MemberDataNotCleared, ProviderNotConfigured
from app.core.config import reveal

# A corpus passage, or a member's search query.
Purpose = Literal["document", "query"]

# However long an answer may take.
MOST_SECONDS = 12.0

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have how i in is it its my of on or that the this to was what "
    "when where which who will with you your can do does should could would about me".split()
)


class EmbeddingProvider(Protocol):
    name: str
    model: str
    index: str          # what its vectors may be compared with; at most 64 characters
    dimensions: int

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER,
              client_content: bool = False) -> list[list[float]]: ...

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
        self.model = self.index = f"veye-hashing-{dimensions}"

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER,
              client_content: bool = False) -> list[list[float]]:
        # Local and deterministic: nothing leaves this process, so neither the
        # purpose nor whose text it is changes what it computes. All are
        # accepted so that swapping in an external provider is a configuration
        # change and not a change to every caller.
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


class UnconfiguredEmbeddingProvider:
    """Explicit absence: the API boots, and whatever needs an embedding is told
    why there is none instead of being answered without one."""

    name = "unconfigured"
    model = index = "none"

    def __init__(self, reason: str, dimensions: int = 0) -> None:
        self.reason, self.dimensions = reason, dimensions

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER,
              client_content: bool = False) -> list[list[float]]:
        raise ProviderNotConfigured(self.reason)

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "model": None, "configured": False, "external": False, "reason": self.reason}


class GoogleEmbeddingProvider:
    """Google's text embeddings, through whichever door VEYE_GEMINI_BACKEND names.

    The same decisions as the language provider shape this one, and the same
    code makes them (`google_backend`).

    **Member data does not reach it by accident.** Retrieval embeds the
    member's question before the outbound privacy filter has run, so that text
    is their raw words. This provider refuses it on a developer key, always,
    and on Vertex AI unless the deployment has declared the same clearance the
    language model requires. The refusal is a hard failure: silently embedding
    it would be the disclosure the clearance exists to govern, and silently
    skipping retrieval would answer the member from nothing.

    **The vector has to fit the column.** `knowledge_chunks.embedding` is
    `vector(n)`, fixed at migration time, so the requested dimensionality is
    the deployment's configured one and a mismatch in Google's answer is a
    hard failure rather than a database error deep inside ingestion.

    **What is already stored is not converted.** See `index` above, and
    `python -m app.jobs run reindex-knowledge`, which writes the new vectors
    beside the old ones so that going back is going back.
    """

    name = "google"

    # Checked against Google's documentation on 25 Nov 2026: 128 to 3072
    # dimensions, 2,048 tokens a text, task types, and a shutdown on
    # 14 May 2028. Its successor, gemini-embedding-2, is not a change of
    # configuration: it takes no `task_type` (the task is written into the
    # text) and its vectors cannot be compared with these.
    DEFAULT_MODEL = "gemini-embedding-001"
    # Served from single regions only. `us`, which serves the language model,
    # does not serve this one.
    DEFAULT_LOCATION = "us-central1"
    NARROWEST, WIDEST = 128, 3072

    # A corpus passage and a search query are embedded differently by this
    # model, and using one for the other costs recall.
    TASK_TYPES = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY"}

    # Texts in one request. Vertex AI: "each request can only include a single
    # input text" for this model. And requests at once, so that a document is a
    # matter of seconds all the same.
    TOGETHER = {VERTEX: 1, DEVELOPER: 32}
    AT_ONCE = {VERTEX: 8, DEVELOPER: 2}

    def __init__(self, *, backend: str, dimensions: int, project: str = "", location: str = "", model: str = "",
                 api_key: str | None = None, member_data_cleared: bool = False, local: bool = False,
                 timeout_seconds: float = 30.0, **extra) -> None:
        self.dimensions = dimensions
        self.model = model or self.DEFAULT_MODEL
        self.member_data_cleared = bool(member_data_cleared)
        if self.model != self.DEFAULT_MODEL:
            raise ProviderNotConfigured(
                f"VEYE_EMBEDDING_MODEL '{self.model}' is not one VEYE embeds with. {self.DEFAULT_MODEL} is: retrieval relies on its "
                "task types, and another model's vectors cannot be compared with it.")
        if not self.NARROWEST <= dimensions <= self.WIDEST:
            raise ProviderNotConfigured(f"{self.model} gives {self.NARROWEST} to {self.WIDEST} dimensions, not {dimensions} (VEYE_EMBEDDING_DIMENSIONS).")
        self.backend = choose_backend(
            backend, model=self.model, project=project, location=location or self.DEFAULT_LOCATION, api_key=api_key, local=local,
            member_data_cleared=self.member_data_cleared, timeout_seconds=timeout_seconds,
            places=EMBEDS_FROM, location_setting="VEYE_EMBEDDING_LOCATION", **extra)
        self.index = f"{self.model}@{dimensions}/{self.backend.kind}"

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER,
              client_content: bool = False) -> list[list[float]]:
        if not texts:
            return []
        if classification is DataClassification.REAL_MEMBER and (self.backend.is_developer or not self.member_data_cleared):
            raise MemberDataNotCleared(
                "That text is a member's own words, and this deployment has not been cleared to send "
                "member data to Google. Nothing was sent.")
        if client_content and self.backend.is_developer:
            raise ClientContentNotAllowed(
                "That document is not marked synthetic, and this deployment is using a developer API key. "
                "The client's own documents go only through Vertex AI. Nothing was sent.")
        together = self.TOGETHER[self.backend.kind]
        requests = [list(texts[start:start + together]) for start in range(0, len(texts), together)]
        vectors: list[list[float]] = []
        if len(requests) == 1:
            vectors = self._embed_some(requests[0], purpose)
        else:
            with ThreadPoolExecutor(max_workers=self.AT_ONCE[self.backend.kind]) as pool:
                asked = [pool.submit(self._embed_some, request, purpose) for request in requests]
                try:
                    for answer in asked:        # in the order they were asked for
                        vectors += answer.result()
                except BaseException:
                    for answer in asked:
                        answer.cancel()
                    raise
        # A truncated embedding is not unit length, and a corpus of mixed
        # magnitudes makes the PostgreSQL and Python ranking paths disagree.
        # Both are cosine, so normalising costs nothing and removes the doubt.
        return [_unit(v) for v in vectors]

    def _embed_some(self, texts: list[str], purpose: Purpose) -> list[list[float]]:
        response, _ = self.backend.call(lambda client, timeout_ms: client.models.embed_content(
            model=self.model, contents=texts, config=self._config(purpose, timeout_ms)))
        answered = list(getattr(response, "embeddings", None) or [])
        counted = [getattr(getattr(item, "statistics", None), "token_count", None) for item in answered]
        if any(getattr(getattr(item, "statistics", None), "truncated", None) for item in answered):
            # The end of it would never be found, and nothing would say so.
            raise Refused(f"A text is too long for {self.model}, which read only the beginning of it.")
        self.backend.spent(int(sum(counted)) if answered and all(c is not None for c in counted) else None, None)
        vectors = [list(getattr(item, "values", None) or []) for item in answered]
        if len(vectors) != len(texts):
            raise Refused(f"Google returned {len(vectors)} embeddings for {len(texts)} inputs.")
        for vector in vectors:
            if len(vector) != self.dimensions:
                raise Refused(
                    f"Google returned a {len(vector)}-dimension vector but this deployment stores "
                    f"vector({self.dimensions}). Change VEYE_EMBEDDING_DIMENSIONS and migrate the "
                    f"column together, then re-ingest every source.")
        return vectors

    def _config(self, purpose: Purpose, timeout_ms: int) -> dict:
        config = {"task_type": self.TASK_TYPES[purpose], "output_dimensionality": self.dimensions, "http_options": {"timeout": timeout_ms}}
        # Refused, rather than read as far as it fits. (The other door takes no
        # such instruction; what it answers is looked at above.)
        return config if self.backend.is_developer else config | {"auto_truncate": False}

    def describe(self) -> dict[str, object]:
        return {
            "provider": self.name, "model": self.model, "configured": True, "external": True,
            "dimensions": self.dimensions, "index": self.index,
            **self.backend.describe(),
            "member_data_cleared": self.member_data_cleared,
        }


def _unit(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector] if norm else vector


def build_embedding_provider(kind: str, *, dimensions: int, settings=None) -> EmbeddingProvider:
    if kind == "hashing":
        return HashingEmbeddingProvider(dimensions)
    if kind == "google":
        if settings is None:
            raise ValueError("The Google embedding provider needs the application settings.")
        try:
            return GoogleEmbeddingProvider(
                backend=settings.gemini_backend,
                dimensions=dimensions,
                project=settings.gcp_project or "",
                location=settings.embedding_location or "",
                model=settings.embedding_model or "",
                api_key=reveal(settings.gemini_api_key),
                member_data_cleared=settings.gemini_member_data_cleared,
                local=settings.is_local,
                # A member waits for this and then for the answer.
                timeout_seconds=min(settings.llm_timeout_seconds, MOST_SECONDS),
            )
        except ProviderNotConfigured as exc:
            return UnconfiguredEmbeddingProvider(str(exc), dimensions)
    raise ValueError(
        f"Unknown embedding provider '{kind}'. Supported: hashing (local), google (through VEYE_GEMINI_BACKEND).")
