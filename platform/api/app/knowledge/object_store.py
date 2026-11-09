"""KnowledgeObjectStore: where original source files live.

Production target: Google Cloud Storage for the original file, PostgreSQL for
metadata, pgvector for approved chunk text and embeddings. The local
implementation keeps files on disk under the API's `var/` folder so no cloud
account or emulator is needed. Chunks never carry the original binary.

The source files live in their own bucket, separate from member media: they
have different lifecycles, audiences and retention, and sharing one bucket
would mean a single IAM grant covers both."""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

_SAFE_KEY = re.compile(r"^[A-Za-z0-9._/-]+$")


@dataclass(frozen=True)
class StoredObject:
    key: str
    byte_size: int
    sha256: str
    content_type: str


class KnowledgeObjectStore(Protocol):
    name: str

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject: ...

    def get(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def describe(self) -> dict[str, object]: ...


class ObjectNotFound(KeyError):
    pass


def _validate_key(key: str) -> str:
    if not key or not _SAFE_KEY.match(key) or ".." in key or key.startswith("/"):
        raise ValueError("Invalid object key.")
    return key


class LocalFileKnowledgeObjectStore:
    name = "local-file"

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / _validate_key(key)).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid object key.")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return StoredObject(key=key, byte_size=len(data), sha256=hashlib.sha256(data).hexdigest(), content_type=content_type)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise ObjectNotFound(key)
        return path.read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "root": str(self.root), "external": False}


class GcsKnowledgeObjectStore:
    """Google Cloud Storage for the original source files.

    Its own bucket, not the one holding member photos. They have different
    lifecycles, different audiences and different retention: approved source
    documents are long-lived reference material the whole team may read, and a
    member's photo is theirs. Sharing a bucket would mean one IAM grant covers
    both, which is the wrong default even when it is convenient.

    Application Default Credentials, so a Cloud Run service uses its own
    identity. Imported lazily; nothing here runs until a bucket exists.
    """

    name = "gcs"

    def __init__(self, bucket: str, *, prefix: str = "knowledge/", client=None) -> None:
        if not bucket:
            raise ValueError("VEYE_KNOWLEDGE_BUCKET is required for the gcs knowledge store.")
        self.bucket_name = bucket
        self.prefix = prefix.strip("/") + "/" if prefix.strip("/") else ""
        self._client = client
        self._bucket = None

    def _ensure_bucket(self):
        if self._bucket is not None:
            return self._bucket
        if self._client is None:
            try:  # pragma: no cover - depends on the optional extra
                from google.cloud import storage
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "The 'google-cloud-storage' package is not installed (pip install 'veye-api[gcs]').") from exc
            self._client = storage.Client()
        self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def _blob_name(self, key: str) -> str:
        return self.prefix + _validate_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        blob = self._ensure_bucket().blob(self._blob_name(key))
        blob.upload_from_string(data, content_type=content_type)
        return StoredObject(key=key, byte_size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                            content_type=content_type)

    def get(self, key: str) -> bytes:
        blob = self._ensure_bucket().blob(self._blob_name(key))
        if not blob.exists():
            raise ObjectNotFound(key)
        return blob.download_as_bytes()

    def exists(self, key: str) -> bool:
        return bool(self._ensure_bucket().blob(self._blob_name(key)).exists())

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "bucket": self.bucket_name, "prefix": self.prefix or "(none)",
                "auth": "application default credentials", "external": True, "configured": True}


class UnconfiguredKnowledgeObjectStore:
    """Named but not usable. The API still boots and says so, rather than
    starting with a store that fails on the first ingestion."""

    def __init__(self, name: str, reason: str) -> None:
        self.name = name
        self.reason = reason

    def _refuse(self) -> RuntimeError:
        return RuntimeError(f"The '{self.name}' knowledge object store is not connected: {self.reason}")

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        raise self._refuse()

    def get(self, key: str) -> bytes:
        raise self._refuse()

    def exists(self, key: str) -> bool:
        raise self._refuse()

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "external": True, "configured": False, "reason": self.reason}


def build_object_store(kind: str, *, local_root: str, bucket: str | None = None,
                       prefix: str = "knowledge/") -> KnowledgeObjectStore:
    if kind == "local":
        return LocalFileKnowledgeObjectStore(local_root)
    if kind == "gcs":
        try:
            return GcsKnowledgeObjectStore(bucket or "", prefix=prefix)
        except ValueError as exc:
            return UnconfiguredKnowledgeObjectStore("gcs", str(exc))
    if kind == "s3":
        # Google Cloud is the architecture (9 Nov 2026) and the production
        # image does not install boto3. The value is still accepted so an old
        # deployment setting does not take the API down on start-up, but there
        # is no S3 implementation behind it any more.
        return UnconfiguredKnowledgeObjectStore(
            "s3", "Google Cloud Storage is the production target; set VEYE_KNOWLEDGE_OBJECT_STORE=gcs.")
    raise ValueError(f"Unknown knowledge object store '{kind}'.")
