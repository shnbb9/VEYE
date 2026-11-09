"""Member media in Google Cloud Storage, without a bucket.

The client is injected, so what is tested is the part VEYE owns: that the two
stores are interchangeable, that keys are validated the same way in both, and
that naming the store without configuring it does not stop the API booting.
"""

from __future__ import annotations

import pytest

from app.storage.gcs import GcsObjectStorage, ObjectStorageNotConfigured
from app.storage.object_storage import LocalFileObjectStorage, build_media_storage


class FakeBlob:
    def __init__(self, store: dict, name: str):
        self.store = store
        self.name = name

    def upload_from_string(self, data, content_type=None):
        self.store[self.name] = (data, content_type)

    def download_as_bytes(self):
        return self.store[self.name][0]

    def exists(self):
        return self.name in self.store

    def delete(self):
        self.store.pop(self.name, None)


class FakeBucket:
    def __init__(self, store: dict):
        self.store = store

    def blob(self, name: str):
        return FakeBlob(self.store, name)


class FakeClient:
    def __init__(self):
        self.store: dict = {}

    def bucket(self, name: str):
        return FakeBucket(self.store)


def test_the_two_stores_behave_the_same_way(tmp_path):
    local = LocalFileObjectStorage(tmp_path)
    cloud = GcsObjectStorage("veye-media", client=FakeClient())
    key = "profile-photos/abc/20261109T120000.jpg"
    for store in (local, cloud):
        assert store.exists(key) is False
        store.put(key, b"bytes", "image/jpeg")
        assert store.exists(key) is True
        assert store.get(key) == b"bytes"
        store.delete(key)
        assert store.exists(key) is False


def test_a_key_that_tries_to_escape_is_refused_in_the_cloud_store_too():
    cloud = GcsObjectStorage("veye-media", client=FakeClient())
    for bad in ("../secrets", "/etc/passwd", "a/../../b", ""):
        with pytest.raises(ValueError):
            cloud.put(bad, b"x", "image/jpeg")


def test_a_prefix_separates_environments_without_changing_the_stored_key():
    client = FakeClient()
    staging = GcsObjectStorage("veye-media", prefix="staging", client=client)
    key = "profile-photos/abc/one.jpg"
    staging.put(key, b"s", "image/jpeg")
    # The object is namespaced in the bucket...
    assert "staging/profile-photos/abc/one.jpg" in client.store
    # ...but the row still keeps the plain key.
    assert staging.get(key) == b"s"


def test_a_missing_object_raises_rather_than_returning_empty_bytes():
    cloud = GcsObjectStorage("veye-media", client=FakeClient())
    with pytest.raises(KeyError):
        cloud.get("profile-photos/abc/missing.jpg")


def test_it_authenticates_as_the_service_not_with_a_key_file():
    described = GcsObjectStorage("veye-media", client=FakeClient()).describe()
    assert described["auth"] == "application default credentials"
    assert described["bucket"] == "veye-media"
    assert described["configured"] is True


def test_naming_the_cloud_store_without_a_bucket_does_not_stop_the_api_booting():
    store = build_media_storage("gcs", local_root="var/x", bucket=None)
    assert store.describe()["connected"] is False
    with pytest.raises(RuntimeError):
        store.put("profile-photos/a/b.jpg", b"x", "image/jpeg")


def test_a_bucket_is_required_when_constructing_directly():
    with pytest.raises(ObjectStorageNotConfigured):
        GcsObjectStorage("")


def test_the_default_store_is_still_local(tmp_path):
    assert isinstance(build_media_storage("local", local_root=str(tmp_path)), LocalFileObjectStorage)


def test_an_old_s3_value_reports_itself_instead_of_crashing():
    """Google Cloud is the chosen platform; a stale deployment value must not
    take the API down on start-up."""
    store = build_media_storage("s3", local_root="var/x")
    assert store.describe()["connected"] is False


# ---- the knowledge store: the same shape, its own bucket --------------------

def test_the_knowledge_store_behaves_the_same_locally_and_in_a_bucket(tmp_path):
    from app.knowledge.object_store import (
        GcsKnowledgeObjectStore,
        LocalFileKnowledgeObjectStore,
        ObjectNotFound,
    )

    local = LocalFileKnowledgeObjectStore(tmp_path)
    cloud = GcsKnowledgeObjectStore("veye-knowledge", client=FakeClient())
    key = "sources/abc/health-number.md"
    for store in (local, cloud):
        assert store.exists(key) is False
        stored = store.put(key, b"# Health Number", "text/markdown")
        assert stored.byte_size == len(b"# Health Number")
        assert stored.sha256
        assert store.get(key) == b"# Health Number"
        assert store.exists(key) is True
        with pytest.raises(ObjectNotFound):
            store.get("sources/abc/missing.md")


def test_source_documents_do_not_share_the_bucket_that_holds_member_photos():
    """Different lifecycle, different audience, different retention. Sharing a
    bucket would mean one IAM grant covers both."""
    from app.core.config import Settings
    from app.knowledge.object_store import GcsKnowledgeObjectStore

    defaults = Settings(database_url="sqlite:///unused")
    assert defaults.knowledge_bucket is None and defaults.media_bucket is None
    # They are separate settings, so a deployment cannot accidentally point
    # both at one bucket without saying so twice.
    assert "knowledge_bucket" in Settings.model_fields and "media_bucket" in Settings.model_fields

    client = FakeClient()
    GcsKnowledgeObjectStore("veye-knowledge", client=client).put("sources/a/one.md", b"x", "text/markdown")
    assert "knowledge/sources/a/one.md" in client.store


def test_naming_the_knowledge_bucket_store_without_a_bucket_still_boots():
    from app.knowledge.object_store import build_object_store

    store = build_object_store("gcs", local_root="var/x", bucket=None)
    assert store.describe()["configured"] is False
    with pytest.raises(RuntimeError):
        store.put("sources/a/one.md", b"x", "text/markdown")


def test_s3_is_no_longer_a_knowledge_target_but_does_not_crash_a_deployment():
    """Google Cloud is the architecture and the production image does not
    install boto3. An old setting must not take the API down on start-up."""
    import app.knowledge.object_store as store_module
    from app.knowledge.object_store import build_object_store

    assert not hasattr(store_module, "S3KnowledgeObjectStore")
    store = build_object_store("s3", local_root="var/x")
    described = store.describe()
    assert described["configured"] is False
    assert "Google Cloud Storage" in described["reason"]
