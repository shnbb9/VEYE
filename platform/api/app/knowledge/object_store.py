"""KnowledgeObjectStore: where original source files live.

Production target: S3 for the original file, PostgreSQL for metadata,
pgvector for approved chunk text and embeddings. The local implementation
keeps files on disk under the API's `var/` folder so no AWS account or
emulator is needed. Chunks never carry the original binary."""

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


class S3KnowledgeObjectStore:
    """Boundary for the production object store. It is intentionally thin and
    imports boto3 lazily; it has not been exercised against a live bucket
    (bucket ownership, region and credentials are client decisions)."""

    name = "s3"

    def __init__(self, bucket: str, prefix: str = "knowledge/") -> None:
        if not bucket:
            raise ValueError("VEYE_S3_KNOWLEDGE_BUCKET is not set.")
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError("boto3 is not installed; the S3 object store is not available in this environment.") from exc
        self.bucket = bucket
        self.prefix = prefix
        self._client = boto3.client("s3")

    def _key(self, key: str) -> str:
        return self.prefix + _validate_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:  # pragma: no cover - needs AWS
        self._client.put_object(Bucket=self.bucket, Key=self._key(key), Body=data, ContentType=content_type)
        return StoredObject(key=key, byte_size=len(data), sha256=hashlib.sha256(data).hexdigest(), content_type=content_type)

    def get(self, key: str) -> bytes:  # pragma: no cover - needs AWS
        response = self._client.get_object(Bucket=self.bucket, Key=self._key(key))
        return response["Body"].read()

    def exists(self, key: str) -> bool:  # pragma: no cover - needs AWS
        try:
            self._client.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except Exception:
            return False

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "bucket": self.bucket, "external": True}


def build_object_store(kind: str, *, local_root: str, s3_bucket: str | None) -> KnowledgeObjectStore:
    if kind == "local":
        return LocalFileKnowledgeObjectStore(local_root)
    if kind == "s3":
        return S3KnowledgeObjectStore(s3_bucket or "")
    raise ValueError(f"Unknown knowledge object store '{kind}'.")
