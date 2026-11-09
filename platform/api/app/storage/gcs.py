"""Google Cloud Storage for member media.

The same `ObjectStorage` interface the local file store implements, so nothing
above it changes: a row still keeps only the object key, and the bytes still
never go into PostgreSQL.

Two things this does differently from the obvious version.

**No long-lived key file.** Authentication is Application Default Credentials,
so a Cloud Run service uses its own identity. A service-account JSON key in a
container image or an environment variable is a credential that cannot be
rotated, cannot be audited per-caller, and has a habit of ending up in a
repository — and this one is public.

**Keys are validated here too.** `validate_key` already guards the local
store against traversal; a bucket has no directories to escape, but the same
rule keeps the two implementations interchangeable and stops a caller
inventing key shapes that only work on one of them.

Nothing here runs until `VEYE_MEDIA_OBJECT_STORE=gcs` and a bucket exist. The
client's Google Cloud project does not exist yet, so the default stays local.
"""

from __future__ import annotations

import hashlib
import logging

from app.storage.object_storage import ObjectNotFound, StoredObject, validate_key

log = logging.getLogger("veye.storage.gcs")


class ObjectStorageNotConfigured(RuntimeError):
    pass


class GcsObjectStorage:
    """Imported lazily so google-cloud-storage stays an optional extra."""

    name = "gcs"

    def __init__(self, bucket: str, *, prefix: str = "", client=None) -> None:
        if not bucket:
            raise ObjectStorageNotConfigured("VEYE_MEDIA_BUCKET is required for the gcs object store.")
        self.bucket_name = bucket
        # A prefix lets staging and production share a bucket without sharing
        # objects. They should not share one, but if they must, this is how.
        self.prefix = prefix.strip("/")
        self._client = client
        self._bucket = None

    def _ensure_bucket(self):
        if self._bucket is not None:
            return self._bucket
        if self._client is None:
            try:  # pragma: no cover - depends on the optional extra
                from google.cloud import storage
            except ImportError as exc:  # pragma: no cover
                raise ObjectStorageNotConfigured(
                    "The 'google-cloud-storage' package is not installed (pip install 'veye-api[gcs]').") from exc
            # Application Default Credentials: the service's own identity.
            self._client = storage.Client()
        self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def _blob_name(self, key: str) -> str:
        safe = validate_key(key)
        return f"{self.prefix}/{safe}" if self.prefix else safe

    # ---- ObjectStorage -------------------------------------------------------
    def put(self, key: str, data: bytes, content_type: str) -> StoredObject:
        blob = self._ensure_bucket().blob(self._blob_name(key))
        blob.upload_from_string(data, content_type=content_type)
        return StoredObject(key=key, byte_size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                            content_type=content_type)

    def get(self, key: str) -> bytes:
        blob = self._ensure_bucket().blob(self._blob_name(key))
        if not blob.exists():
            # The same error the local store raises, so a caller cannot tell
            # the two apart — which is the point of the interface.
            raise ObjectNotFound(key)
        return blob.download_as_bytes()

    def delete(self, key: str) -> None:
        blob = self._ensure_bucket().blob(self._blob_name(key))
        if blob.exists():
            blob.delete()

    def exists(self, key: str) -> bool:
        return bool(self._ensure_bucket().blob(self._blob_name(key)).exists())

    def describe(self) -> dict[str, object]:
        return {
            "provider": self.name,
            "bucket": self.bucket_name,
            "prefix": self.prefix or "(none)",
            "auth": "application default credentials",
            "configured": True,
        }
