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
