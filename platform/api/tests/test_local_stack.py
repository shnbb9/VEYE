"""What the local Docker stack and the deployment templates hand to whom.

A setting that works when Python is run by hand and is not passed to the
container is a setting that does not work; one that is passed to the web
container is one the world can read.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from app.core.config import Settings

PLATFORM = Path(__file__).resolve().parents[2]
REPO = PLATFORM.parent
if not (PLATFORM / "compose.local.yaml").exists():  # inside the API image there is only the API
    pytest.skip("the stack's own files are not here", allow_module_level=True)

ASKED_FOR = ("VEYE_LLM_PROVIDER", "VEYE_GEMINI_BACKEND", "VEYE_GEMINI_API_KEY", "VEYE_GEMINI_MODEL", "VEYE_GCP_PROJECT", "VEYE_GCP_LOCATION",
             "VEYE_EMBEDDING_PROVIDER", "VEYE_EMBEDDING_MODEL", "VEYE_EMBEDDING_LOCATION", "VEYE_EMBEDDING_DIMENSIONS", "VEYE_GEMINI_MEMBER_DATA_CLEARED")
COMPOSE = yaml.safe_load((PLATFORM / "compose.local.yaml").read_text(encoding="utf-8"))
VERTEX = yaml.safe_load((PLATFORM / "compose.vertex.yaml").read_text(encoding="utf-8"))


def environment(service: str) -> dict:
    return COMPOSE["services"][service].get("environment") or {}


def test_every_setting_reaches_the_api_container_from_the_env_file_and_none_is_written_here():
    given = environment("api")
    for name in ASKED_FOR:
        assert re.fullmatch(r"\$\{%s:-[^}]*\}" % name, str(given.get(name))), f"{name} is {given.get(name)!r}"
    assert given["VEYE_GEMINI_API_KEY"] == "${VEYE_GEMINI_API_KEY:-}", "a key has no default"
    assert given["VEYE_GEMINI_BACKEND"] == "${VEYE_GEMINI_BACKEND:-}", "nor has the choice of door"


def test_what_the_stack_starts_with_is_what_the_code_starts_with(monkeypatch):
    """A container told nothing behaves as the code says it does: offline."""
    for name in ASKED_FOR:
        monkeypatch.setenv(name, re.search(r":-([^}]*)\}", environment("api")[name]).group(1))
    stack = Settings()
    for name in ASKED_FOR:
        monkeypatch.delenv(name)
    code = Settings()
    for name in ASKED_FOR:
        field = name.removeprefix("VEYE_").lower()
        assert getattr(stack, field) == getattr(code, field), name
    assert (stack.llm_provider, stack.embedding_provider, stack.gemini_backend, stack.gemini_member_data_cleared) == ("mock", "hashing", "", False)


def test_nothing_else_is_given_a_credential_or_an_identity():
    for name in COMPOSE["services"]:
        if name == "api":
            continue
        assert not [key for key in environment(name) if re.search(r"GEMINI|GCP|GOOGLE|GROQ|EMBEDDING|API_KEY|SECRET", key)], name
    assert set(environment("web")) == {"NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_ENVIRONMENT"}
    assert set(VERTEX["services"]) == {"api"}


def test_the_identity_is_one_file_read_only_and_only_when_it_is_asked_for():
    api = VERTEX["services"]["api"]
    [mount] = api["volumes"]
    assert mount["read_only"] is True and mount["type"] == "bind" and mount["bind"] == {"create_host_path": False}
    assert mount["source"].startswith("${VEYE_GOOGLE_IDENTITY_FILE:?"), "never a folder, and never a default"
    assert api["environment"] == {"GOOGLE_APPLICATION_CREDENTIALS": mount["target"]}
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in environment("api") and not [v for v in COMPOSE["services"]["api"]["volumes"] if "gcloud" in str(v)]
    assert environment("api")["NO_GCE_CHECK"] == "true"
    assert "compose.vertex.yaml" in (PLATFORM / "scripts" / "local-up.ps1").read_text(encoding="utf-8")


def test_no_browser_is_given_the_name_of_a_key():
    """Not the web app, not the static demos."""
    named = re.compile(r"GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|AIza[0-9A-Za-z_-]{20}")
    looked = 0
    for folder, patterns in ((PLATFORM / "web", ("app", "lib", "components")), (REPO / "build", ("js", ".")), (REPO / "admin-panel" / "prototype-client", ("js", "."))):
        for pattern in patterns:
            root = folder / pattern
            files = root.glob("*.html") if pattern == "." else (p for p in root.rglob("*") if p.suffix in (".ts", ".tsx", ".js", ".html", ".css"))
            for path in files:
                looked += 1
                assert not named.search(path.read_text(encoding="utf-8", errors="replace")), path
    assert looked > 100, "the folders were not read"


def test_a_deployment_is_vertex_uncleared_and_has_no_key():
    template = (PLATFORM / "deployment" / "gcp" / "api.service.yaml").read_text(encoding="utf-8")
    set_to = dict(re.findall(r"- name: (VEYE_[A-Z_]+)\s*\n\s+value: \"?([^\"\s#]+)", template))
    assert set_to["VEYE_GEMINI_BACKEND"] == "vertex" and set_to["VEYE_GEMINI_MEMBER_DATA_CLEARED"] == "false"
    assert (set_to["VEYE_LLM_PROVIDER"], set_to["VEYE_EMBEDDING_PROVIDER"]) == ("mock", "hashing"), "switched on by a decision, not by a template"
    assert (set_to["VEYE_GCP_LOCATION"], set_to["VEYE_EMBEDDING_LOCATION"]) == ("us", "us-central1")
    for name in ("API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "credentials.json"):
        assert name not in template


def test_the_example_lists_every_setting_and_no_key():
    example = PLATFORM / ".env.local-docker.example"
    if not example.exists():
        pytest.skip("environment files are kept on the machine and not in the repository")
    lines = dict(line.split("=", 1) for line in example.read_text(encoding="utf-8").splitlines() if re.match(r"^[A-Z_]+=", line))
    assert [name for name in ASKED_FOR if name not in lines] == []
    assert lines["VEYE_GEMINI_API_KEY"] == "" and lines["VEYE_GEMINI_BACKEND"] == "" and lines["VEYE_GEMINI_MEMBER_DATA_CLEARED"] == "false"
    assert lines["VEYE_LLM_PROVIDER"] == "mock" and lines["VEYE_EMBEDDING_PROVIDER"] == "hashing"
