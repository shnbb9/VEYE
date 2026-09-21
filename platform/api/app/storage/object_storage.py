"""ObjectStorage: where member media bytes live.

The application stores only an object key (plus size, hash and content type)
in PostgreSQL and hands the bytes to this boundary. Development keeps files
on disk under the API's `var/` folder (a Docker volume locally); production
will point the same interface at a bucket — GCS is the client's probable
choice, but nothing is wired until the cloud project and its access exist.
Keys are validated so a caller can never escape the store's root."""

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


class ObjectNotFound(KeyError):
    pass


class ObjectStorage(Protocol):
    name: str

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def exists(self, key: str) -> bool: ...

    def describe(self) -> dict[str, object]: ...


def validate_key(key: str) -> str:
    if not key or not _SAFE_KEY.match(key) or ".." in key or key.startswith("/"):
        raise ValueError("Invalid object key.")
    return key


class LocalFileObjectStorage:
    """Development implementation: files under one root directory."""

    name = "local-file"

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / validate_key(key)).resolve()
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

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.is_file():
            path.unlink()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "root": str(self.root), "external": False}


class UnconfiguredCloudObjectStorage:
    """Placeholder for the production bucket. It exists so configuration can
    name the target now; every call states honestly that the cloud project is
    not connected instead of pretending to store anything."""

    def __init__(self, kind: str) -> None:
        self.name = kind

    def _refuse(self) -> RuntimeError:
        return RuntimeError(
            f"The '{self.name}' object storage is not connected: the production cloud project, bucket and credentials "
            "are client decisions that have not been made yet. Use the local store for development."
        )

    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        raise self._refuse()

    def get(self, key: str) -> bytes:
        raise self._refuse()

    def delete(self, key: str) -> None:
        raise self._refuse()

    def exists(self, key: str) -> bool:
        raise self._refuse()

    def describe(self) -> dict[str, object]:
        return {"provider": self.name, "external": True, "connected": False}


def build_media_storage(kind: str, *, local_root: str) -> ObjectStorage:
    if kind == "local":
        return LocalFileObjectStorage(local_root)
    if kind in {"gcs", "s3"}:
        return UnconfiguredCloudObjectStorage(kind)
    raise ValueError(f"Unknown media object storage '{kind}'.")
