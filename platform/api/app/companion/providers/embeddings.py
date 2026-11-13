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
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Literal, Protocol

from app.companion.providers.llm import DataClassification

# A corpus passage, or a member's search query.
Purpose = Literal["document", "query"]

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have how i in is it its my of on or that the this to was what "
    "when where which who will with you your can do does should could would about me".split()
)


class EmbeddingProvider(Protocol):
    name: str
    model: str
    dimensions: int

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER) -> list[list[float]]: ...

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

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER) -> list[list[float]]:
        # Local and deterministic: nothing leaves this process, so neither the
        # purpose nor the classification changes what it computes. Both are
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


class GoogleEmbeddingProvider:
    """Google's text embeddings on Vertex AI.

    The same two decisions as the language provider shape this one.

    **Vertex AI with Application Default Credentials**, not a personal API
    key: the running service's own identity is what Google sees, and it can be
    rotated and audited. An API key is accepted for local experimentation and
    refused in production.

    **Member data does not reach it by accident.** Retrieval embeds the
    member's question before the outbound privacy filter has run, so that text
    is their raw words. This provider refuses it unless the deployment has
    declared the same clearance the language model requires. The refusal is a
    hard failure: silently embedding it would be the disclosure the clearance
    exists to govern, and silently skipping retrieval would answer the member
    from nothing.

    **The vector has to fit the column.** `knowledge_chunks.embedding` is
    `vector(n)`, fixed at migration time, so the requested dimensionality is
    the deployment's configured one and a mismatch in Google's answer is a
    hard failure rather than a database error deep inside ingestion.

    Switching an existing deployment to this provider does not convert what is
    already stored: retrieval filters on `embedding_model`, so previously
    ingested documents simply stop matching until they are re-ingested. That
    is the safe failure, but it is a silent one, so it is said here and in the
    deployment notes.
    """

    name = "google"

    # Checked against Google's Vertex AI "Get text embeddings" documentation on
    # 14 Nov 2026, which uses this model in its current Python example and
    # documents `task_type` and `output_dimensionality` on EmbedContentConfig.
    # Its native width is 3072 and it may be asked for fewer.
    #
    # gemini-embedding-2 went GA on Vertex AI on 22 April 2026 and is the
    # newer, multimodal model. Moving to it is a configuration change, not a
    # code one, but confirm the exact id against the project's model garden
    # first and re-ingest: changing the model changes every stored vector.
    DEFAULT_MODEL = "gemini-embedding-001"
    SUPPORTED_LOCATIONS = ("global", "us", "eu")
    DEFAULT_LOCATION = "us"

    # A corpus passage and a search query are embedded differently by these
    # models, and using one for the other costs recall.
    TASK_TYPES = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY"}

    def __init__(self, *, dimensions: int, project: str = "", location: str = "", model: str = "",
                 member_data_cleared: bool = False, api_key: str | None = None,
                 production: bool = False, client=None) -> None:
        from app.companion.providers.llm import ProviderNotConfigured

        self.dimensions = dimensions
        self.model = model or self.DEFAULT_MODEL
        self.location = location or self.DEFAULT_LOCATION
        self.project = project
        self.member_data_cleared = bool(member_data_cleared)
        self._api_key = api_key or None
        self._client = client

        if self._api_key and production:
            raise ProviderNotConfigured(
                "An API key is a developer convenience, not a production identity. Production uses "
                "Vertex AI with VEYE_GCP_PROJECT and Application Default Credentials.")
        if not self._api_key and not project:
            raise ProviderNotConfigured("VEYE_GCP_PROJECT is required for the Google embedding provider.")
        if not self._api_key and self.location not in self.SUPPORTED_LOCATIONS:
            raise ProviderNotConfigured(
                f"Google embeddings are not served from '{self.location}'. VEYE_GCP_LOCATION must be "
                f"one of: {', '.join(self.SUPPORTED_LOCATIONS)}.")
        if self._api_key and self.member_data_cleared:
            raise ProviderNotConfigured(
                "Member data is never sent through a personal API key. Use Vertex AI with a service "
                "identity, or leave VEYE_GEMINI_MEMBER_DATA_CLEARED off.")

    def _ensure_client(self):
        from app.companion.providers.llm import ProviderNotConfigured

        if self._client is not None:
            return self._client
        try:  # pragma: no cover - depends on the optional extra
            from google import genai
        except ImportError as exc:  # pragma: no cover
            raise ProviderNotConfigured(
                "The 'google-genai' package is not installed (pip install 'veye-api[gemini]').") from exc
        if self._api_key:
            self._client = genai.Client(api_key=self._api_key)
        else:
            self._client = genai.Client(vertexai=True, project=self.project, location=self.location)
        return self._client

    def embed(self, texts: list[str], *, purpose: Purpose = "document",
              classification: DataClassification = DataClassification.REAL_MEMBER) -> list[list[float]]:
        from app.companion.providers.gemini import MemberDataNotCleared

        if not texts:
            return []
        if classification is DataClassification.REAL_MEMBER and not self.member_data_cleared:
            raise MemberDataNotCleared(
                "That text is a member's own words, and this deployment has not been cleared to send "
                "member data to Google. Nothing was sent.")

        client = self._ensure_client()
        response = client.models.embed_content(
            model=self.model, contents=list(texts), config=self._config(purpose))
        vectors = [list(item.values) for item in response.embeddings]

        if len(vectors) != len(texts):
            raise ValueError(f"Google returned {len(vectors)} embeddings for {len(texts)} inputs.")
        for vector in vectors:
            if len(vector) != self.dimensions:
                raise ValueError(
                    f"Google returned a {len(vector)}-dimension vector but this deployment stores "
                    f"vector({self.dimensions}). Change VEYE_EMBEDDING_DIMENSIONS and migrate the "
                    f"column together, then re-ingest every source.")
        # A truncated embedding is not unit length, and a corpus of mixed
        # magnitudes makes the PostgreSQL and Python ranking paths disagree.
        # Both are cosine, so normalising costs nothing and removes the doubt.
        return [_unit(v) for v in vectors]

    def _config(self, purpose: Purpose):
        from google.genai import types  # pragma: no cover - optional extra

        return types.EmbedContentConfig(
            task_type=self.TASK_TYPES[purpose],
            output_dimensionality=self.dimensions,
        )

    def describe(self) -> dict[str, object]:
        return {
            "provider": self.name, "model": self.model, "configured": True, "external": True,
            "project": self.project or None, "location": self.location,
            "dimensions": self.dimensions, "member_data_cleared": self.member_data_cleared,
            "auth": "api-key" if self._api_key else "application-default-credentials",
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
        return GoogleEmbeddingProvider(
            dimensions=dimensions,
            project=getattr(settings, "gcp_project", "") or "",
            location=getattr(settings, "gcp_location", "") or "",
            model=getattr(settings, "embedding_model", "") or "",
            member_data_cleared=bool(getattr(settings, "gemini_member_data_cleared", False)),
            api_key=getattr(settings, "gemini_api_key", None),
            production=bool(getattr(settings, "is_production", False)),
        )
    raise ValueError(
        f"Unknown embedding provider '{kind}'. Supported: hashing (local), google (Vertex AI).")
