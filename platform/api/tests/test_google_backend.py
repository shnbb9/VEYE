"""Which of Google's doors, whose identity, and what can go wrong.

Two kinds of proof. Where the question is what VEYE decides, the SDK is a
double and nothing is imported. Where the question is what the installed SDK
would really send, the SDK is real and stopped at its HTTP transport: the host,
the path, the credential and the body are read off the request it was about to
make. Nothing here reaches Google, and conftest fails any test that tries.
"""

from __future__ import annotations

import builtins
import json
import logging
import sys
import threading
import time
import traceback
from datetime import date

import pytest

from app.companion.providers import google_backend
from app.companion.providers.embeddings import GoogleEmbeddingProvider, UnconfiguredEmbeddingProvider, build_embedding_provider
from app.companion.providers.gemini import THINKING_ROOM, GeminiLLMProvider
from app.companion.providers.google_backend import (
    ATTEMPTS,
    BACKENDS,
    DEVELOPER,
    DEVELOPER_CALLS_AN_HOUR,
    VERTEX,
    CallBudget,
    CutShort,
    GoogleBackend,
    GoogleCallFailed,
    NotAuthenticated,
    NotPermitted,
    NotServed,
    QuotaExhausted,
    RateLimited,
    Refused,
    SpendingCeiling,
    TimedOut,
    Unreachable,
    choose_backend,
    endpoint,
    estimated_cost,
)
from app.companion.providers.llm import (
    DataClassification,
    LLMMessage,
    LLMRequest,
    ProviderNotConfigured,
    UnconfiguredLLMProvider,
    build_llm_provider,
)
from app.core.config import Settings
from app.core.runtime import build_runtime

MODEL = "gemini-3.8-flash"
KEY = "configured-key-canary"
TOKEN = "service-token-canary"
STRAY = {"GOOGLE_API_KEY": "stray-google-key-canary", "GEMINI_API_KEY": "stray-gemini-key-canary"}
SECRET = "my glucose is 240 and I feel faint"


def ask(system: str = "You are Sprout.", text: str = "Hello", *, max_tokens: int = 400) -> LLMRequest:
    return LLMRequest(system=system, messages=(LLMMessage(role="user", content=text),), max_tokens=max_tokens,
                      client_content=False, classification=DataClassification.GENERAL)


def chosen(kind: str, **kwargs) -> GoogleBackend:
    return choose_backend(kind, **{"model": MODEL, "project": "veye-test-project", "location": "us", "api_key": KEY, "local": True, **kwargs})


# ---- the choice is said, never worked out ---------------------------------------------------

@pytest.mark.parametrize("kind", ["", None, "auto", "vertexai", "google", "developer,vertex"])
def test_nothing_is_chosen_by_what_happens_to_be_there(kind):
    """With every credential of both present, and no choice, nothing is used."""
    with pytest.raises(ProviderNotConfigured) as refused:
        chosen(kind)
    assert "VEYE_GEMINI_BACKEND must be 'developer' or 'vertex'" in str(refused.value)


@pytest.mark.parametrize("kind", BACKENDS)
def test_the_setting_decides_whatever_else_is_configured(kind):
    backend = chosen(f"  {kind.upper()} ")
    assert backend.kind == kind
    assert backend._api_key == (KEY if kind == DEVELOPER else None), "the key belongs to one of them"
    assert backend.project == ("" if kind == DEVELOPER else "veye-test-project")


def test_a_missing_developer_key_never_becomes_vertex():
    with pytest.raises(ProviderNotConfigured) as refused:
        chosen(DEVELOPER, api_key=None)
    assert "VEYE_GEMINI_API_KEY is not set" in str(refused.value) and "Vertex AI was not used instead" in str(refused.value)


def test_a_missing_project_never_becomes_the_developer_key():
    with pytest.raises(ProviderNotConfigured) as refused:
        chosen(VERTEX, project="")
    assert "VEYE_GCP_PROJECT is not set" in str(refused.value) and "key was not used instead" in str(refused.value)


def configured(environment: str, **kwargs) -> Settings:
    return Settings(database_url="sqlite://", environment=environment, llm_provider="gemini", gemini_backend="developer", gemini_api_key=KEY,
                    email_provider="smtp", smtp_host="relay.example", smtp_username="u", smtp_password="p", email_from="Veye <no-reply@veye.example>", **kwargs)


def test_the_developer_key_is_refused_wherever_it_is_not_somebodys_own_machine():
    """Named one by one: an environment nobody thought of is a deployment."""
    for environment in ("production", "prod", "Production", "staging", "stage", "preview", "local-docker-prod", "", "qa"):
        runtime = build_runtime(configured(environment, embedding_provider="google", gcp_project="veye-test-project"))
        for provider in (runtime.llm, runtime.embeddings):
            described = provider.describe()
            assert described["configured"] is False and "not a production identity" in described["reason"], environment
            assert KEY not in str(described)
        with pytest.raises(ProviderNotConfigured):
            runtime.llm.complete(ask())
        with pytest.raises(ProviderNotConfigured):
            runtime.embeddings.embed(["x"], classification=DataClassification.GENERAL)


def test_nor_on_cloud_run_whatever_it_was_told(monkeypatch):
    """"development" is also what a deployment is that was told nothing."""
    for name in ("K_SERVICE", "CLOUD_RUN_JOB"):
        monkeypatch.setenv(name, "veye-api")
        assert "not a production identity" in build_runtime(configured("development")).llm.describe()["reason"]
        monkeypatch.delenv(name)
    assert build_runtime(configured("development")).llm.describe()["configured"] is True


def test_and_allowed_where_it_is():
    for environment in ("development", "local", "local-docker", " Local-Docker ", "test"):
        assert build_runtime(configured(environment)).llm.describe()["backend"] == "developer", environment


def test_clearance_for_member_data_and_a_developer_key_are_a_contradiction():
    with pytest.raises(ProviderNotConfigured) as refused:
        chosen(DEVELOPER, member_data_cleared=True)
    assert "service identity" in str(refused.value)


def test_changing_the_setting_is_all_it_takes():
    """The same code, the same process, five configurations."""
    base = dict(database_url="sqlite://", environment="local-docker", gemini_api_key=KEY, gcp_project="veye-test-project")
    seen = {}
    for name, change in {"mock": {}, "developer": {"llm_provider": "gemini", "gemini_backend": "developer"},
                         "vertex": {"llm_provider": "gemini", "gemini_backend": "vertex"},
                         "developer embeddings": {"embedding_provider": "google", "gemini_backend": "developer"},
                         "vertex embeddings": {"embedding_provider": "google", "gemini_backend": "vertex"}}.items():
        runtime = build_runtime(Settings(**base, **change))
        seen[name] = (runtime.llm.describe().get("backend"), runtime.embeddings.describe().get("backend"), runtime.embeddings.index)
    assert seen == {"mock": (None, None, "veye-hashing-256"), "developer": ("developer", None, "veye-hashing-256"),
                    "vertex": ("vertex", None, "veye-hashing-256"),
                    "developer embeddings": (None, "developer", "gemini-embedding-001@256/developer"),
                    "vertex embeddings": (None, "vertex", "gemini-embedding-001@256/vertex")}


def test_the_settings_come_from_the_environment_and_blank_means_unset(monkeypatch):
    for name, value in {"VEYE_LLM_PROVIDER": "gemini", "VEYE_GEMINI_BACKEND": "vertex", "VEYE_GEMINI_API_KEY": "", "VEYE_GCP_PROJECT": "veye-test-project",
                        "VEYE_GCP_LOCATION": "us", "VEYE_GEMINI_MODEL": MODEL, "VEYE_EMBEDDING_PROVIDER": "google", "VEYE_EMBEDDING_MODEL": "",
                        "VEYE_EMBEDDING_LOCATION": "us-east4", "VEYE_EMBEDDING_DIMENSIONS": "256", "VEYE_GEMINI_MEMBER_DATA_CLEARED": "false"}.items():
        monkeypatch.setenv(name, value)
    settings = Settings()
    runtime = build_runtime(settings)
    assert settings.gemini_api_key is None and settings.gemini_member_data_cleared is False
    assert (runtime.llm.describe()["location"], runtime.embeddings.describe()["location"]) == ("us", "us-east4")
    assert runtime.embeddings.model == "gemini-embedding-001"


# ---- where each model is served ---------------------------------------------------------------

def test_the_two_models_are_served_from_different_places_and_neither_setting_stands_in_for_the_other():
    for place in ("us", "eu", "global"):
        assert chosen(VERTEX, location=place).location == place
        with pytest.raises(ProviderNotConfigured) as refused:
            GoogleEmbeddingProvider(backend=VERTEX, dimensions=256, project="p", location=place)
        assert "VEYE_EMBEDDING_LOCATION" in str(refused.value) and "us-central1" in str(refused.value)
    for place in ("us-central1", "us-east1", "us-east4", "us-east5", "us-south1", "us-west1", "us-west4"):
        assert GoogleEmbeddingProvider(backend=VERTEX, dimensions=256, project="p", location=place).backend.location == place
        with pytest.raises(ProviderNotConfigured) as refused:
            chosen(VERTEX, location=place)
        assert "VEYE_GCP_LOCATION" in str(refused.value) and "global, us, eu" in str(refused.value)


def test_each_place_has_its_own_address():
    for place, host in (("us", "aiplatform.us.rep.googleapis.com"), ("eu", "aiplatform.eu.rep.googleapis.com"),
                        ("global", "aiplatform.googleapis.com"), ("us-central1", "us-central1-aiplatform.googleapis.com")):
        assert endpoint(VERTEX, place) == f"https://{host}/"
        assert endpoint(DEVELOPER, place) == "https://generativelanguage.googleapis.com/"


def test_the_places_are_ours_whatever_the_model_is_called():
    """A retired default is a change of one setting, not of code. It is not a
    way to another country, and a path is not a name: it would bring its own
    project and its own place."""
    assert chosen(VERTEX, model="gemini-9-flash", location="us").model == "gemini-9-flash"
    for model in (MODEL, "gemini-9-flash", "gemini-2.5-flash"):
        for place in ("asia-south1", "us-central1", "europe-west4", "", "US"):
            with pytest.raises(ProviderNotConfigured) as refused:
                chosen(VERTEX, model=model, location=place)
            assert "global, us, eu" in str(refused.value)
    for kind in BACKENDS:
        for path in ("models/gemini-3.8-flash", "projects/somebody-else/locations/asia-south1/publishers/google/models/gemini-3.8-flash",
                     "publishers/google/models/gemini-3.8-flash", "tunedModels/x", "gemini 3", "Gemini-3.8", "../x", ""):
            with pytest.raises(ProviderNotConfigured) as refused:
                chosen(kind, model=path)
            assert "not a model's name" in str(refused.value)


def test_members_data_is_processed_in_the_united_states_or_not_at_all():
    for place in ("global", "eu"):
        with pytest.raises(ProviderNotConfigured) as refused:
            chosen(VERTEX, location=place, member_data_cleared=True)
        assert "United States" in str(refused.value)
        assert chosen(VERTEX, location=place).location == place, "synthetic tests may go there"
    assert chosen(VERTEX, location="us", member_data_cleared=True).location == "us"
    assert GoogleEmbeddingProvider(backend=VERTEX, dimensions=256, project="p", location="us-east4", member_data_cleared=True).backend.location == "us-east4"


# ---- what the installed SDK would send --------------------------------------------------------

@pytest.fixture
def wire(monkeypatch):
    """The real SDK, stopped at its transport, in an environment full of other
    people's credentials and addresses."""
    pytest.importorskip("google.genai")
    import google.auth
    import google.auth.credentials
    import httpx

    class Identity(google.auth.credentials.CredentialsWithQuotaProject):
        def __init__(self, quota="a-laptops-other-project"):
            super().__init__()
            self.token, self._quota_project_id = TOKEN, quota

        def refresh(self, request):
            self.token = TOKEN

        def with_quota_project(self, quota):
            return Identity(quota)

        @property
        def valid(self):
            return True

    for name, value in {**STRAY, "GOOGLE_GENAI_USE_VERTEXAI": "true", "GOOGLE_GENAI_USE_ENTERPRISE": "true", "GOOGLE_CLOUD_PROJECT": "stray-project",
                        "GOOGLE_CLOUD_LOCATION": "europe-west4", "GOOGLE_VERTEX_BASE_URL": "https://elsewhere.example/",
                        "GOOGLE_GEMINI_BASE_URL": "https://elsewhere.example/"}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(google.auth, "default", lambda **_: (Identity(), "a-laptops-other-project"))
    sent: list = []

    def send(self, request, **_):
        sent.append(request)
        body = json.loads(request.content) if request.content else {}
        if "generateContent" in str(request.url):
            answer = {"candidates": [{"content": {"role": "model", "parts": [{"text": "Hello."}]}, "finishReason": "STOP"}],
                      "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 3, "thoughtsTokenCount": 20}}
        elif "predict" in str(request.url):
            answer = {"predictions": [{"embeddings": {"values": [0.1] * 256, "statistics": {"token_count": 5}}} for _ in body["instances"]]}
        else:
            answer = {"embeddings": [{"values": [0.1] * 256} for _ in body["requests"]]}
        return httpx.Response(200, json=answer, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    return sent


def _everything(sent) -> str:
    return "\n".join(f"{r.url} {dict(r.headers)} {r.content.decode()}" for r in sent)


def test_the_developer_door_takes_its_own_key_and_nothing_else(wire):
    llm = GeminiLLMProvider(backend=DEVELOPER, project="veye-test-project", api_key=KEY, local=True)
    assert llm.complete(ask()).text == "Hello."
    [request] = wire
    assert str(request.url) == f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    assert request.headers["x-goog-api-key"] == KEY and "authorization" not in request.headers
    sent = _everything(wire)
    assert TOKEN not in sent and "stray" not in sent and "veye-test-project" not in sent and "elsewhere" not in sent
    assert KEY not in str(request.url), "a key in an address is a key in a log"


def test_the_vertex_door_takes_the_services_identity_and_never_a_key(wire):
    """Even with the key configured, and two more in the environment."""
    llm = GeminiLLMProvider(backend=VERTEX, project="veye-test-project", location="us", api_key=KEY, local=True)
    assert llm.complete(ask()).text == "Hello."
    [request] = wire
    assert str(request.url) == f"https://aiplatform.us.rep.googleapis.com/v1beta1/projects/veye-test-project/locations/us/publishers/google/models/{MODEL}:generateContent"
    assert request.headers["authorization"] == f"Bearer {TOKEN}" and "x-goog-api-key" not in request.headers
    assert request.headers["x-goog-user-project"] == "veye-test-project", "this project pays, not whichever the laptop was last used for"
    sent = _everything(wire)
    assert KEY not in sent and "stray" not in sent and "elsewhere" not in sent and "other-project" not in sent


@pytest.mark.parametrize("backend, together", [(DEVELOPER, [32, 8]), (VERTEX, [1] * 40)])
def test_embeddings_go_through_the_same_door_as_many_at_a_time_as_it_takes(wire, backend, together):
    """Vertex AI takes one text of this model's in a request, and refuses two."""
    google = GoogleEmbeddingProvider(backend=backend, dimensions=256, project="veye-test-project", api_key=KEY, local=True)
    vectors = google.embed([f"passage {n}" for n in range(40)], classification=DataClassification.GENERAL)
    assert len(vectors) == 40 and all(abs(sum(v * v for v in vector) - 1) < 1e-9 for vector in vectors)
    bodies = [json.loads(r.content) for r in wire]
    assert sorted(len(b.get("requests", b.get("instances"))) for b in bodies) == sorted(together)
    google.embed(["a question"], purpose="query", classification=DataClassification.GENERAL)
    asked = json.loads(wire[-1].content)
    if backend == DEVELOPER:
        assert sorted(together) == sorted([8, 32])
        assert bodies[0]["requests"][0] | {"content": ""} == {"content": "", "taskType": "RETRIEVAL_DOCUMENT", "outputDimensionality": 256,
                                                              "model": "models/gemini-embedding-001"}
        assert asked["requests"][0]["taskType"] == "RETRIEVAL_QUERY"
        assert {r.url.host for r in wire} == {"generativelanguage.googleapis.com"} and all(r.headers["x-goog-api-key"] == KEY for r in wire)
        assert google.describe()["estimated_cost_usd"] is None, "this door does not say what it read, and that is not nothing"
    else:
        assert {"instances": [{"content": "passage 0", "task_type": "RETRIEVAL_DOCUMENT"}],
                "parameters": {"outputDimensionality": 256, "autoTruncate": False}} in bodies
        assert asked["instances"][0]["task_type"] == "RETRIEVAL_QUERY"
        assert {r.url.host for r in wire} == {"us-central1-aiplatform.googleapis.com"}
        assert all("x-goog-api-key" not in r.headers and r.headers["authorization"] == f"Bearer {TOKEN}" for r in wire)
        assert google.describe()["tokens_in"] == 41 * 5, "counted from what Google said it read"


def test_an_answer_has_room_to_think_and_goes_to_nothing_but_the_model(wire):
    """Google counts the model's reasoning against this number and stops dead
    at it: a guide's one-word answer asks for twelve."""
    GeminiLLMProvider(backend=VERTEX, project="p", location="us").complete(ask(max_tokens=12))
    body = json.loads(wire[0].content)
    assert body["generationConfig"] == {"maxOutputTokens": 12 + THINKING_ROOM}
    assert body["tools"] == [] and body["systemInstruction"]["parts"] == [{"text": "You are Sprout."}]
    assert set(body) == {"contents", "systemInstruction", "tools", "generationConfig"}, "no grounding, no sampling parameters, no thinking level"


def test_the_sdks_own_idea_of_each_address_is_ours(monkeypatch):
    """Given explicitly, so an environment variable cannot move it; kept equal
    to the SDK's, so an upgrade that moves it is a failing test."""
    genai = pytest.importorskip("google.genai")
    from google.auth.credentials import AnonymousCredentials

    for name in ("GOOGLE_VERTEX_BASE_URL", "GOOGLE_GEMINI_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    for place in ("global", "us", "eu", "us-central1"):
        options = genai.Client(vertexai=True, project="p", location=place, credentials=AnonymousCredentials())._api_client._http_options
        assert (options.base_url, options.api_version) == (endpoint(VERTEX, place), google_backend.API_VERSIONS[VERTEX])
    options = genai.Client(vertexai=False, api_key="k")._api_client._http_options
    assert (options.base_url, options.api_version) == (endpoint(DEVELOPER, ""), google_backend.API_VERSIONS[DEVELOPER])


# ---- an identity that is not there, or is not one -----------------------------------------------

@pytest.fixture
def no_identity(monkeypatch):
    pytest.importorskip("google.genai")
    import google.auth
    from google.auth.exceptions import DefaultCredentialsError

    for name, value in STRAY.items():
        monkeypatch.setenv(name, value)

    def default(**_):
        raise DefaultCredentialsError("File C:/Users/somebody/secret-place/key.json was not found.")

    monkeypatch.setattr(google.auth, "default", default)


def test_no_identity_is_said_plainly_and_no_key_is_used_instead(no_identity, wire_guard):
    for provider in (GeminiLLMProvider(backend=VERTEX, project="p", location="us", api_key=KEY, local=True),
                     GoogleEmbeddingProvider(backend=VERTEX, dimensions=256, project="p", api_key=KEY, local=True)):
        with pytest.raises(NotAuthenticated) as refused:
            provider.complete(ask()) if hasattr(provider, "complete") else provider.embed(["x"], classification=DataClassification.GENERAL)
        said = str(refused.value)
        assert "Application Default Credentials were not found" in said and "gcloud auth application-default login" in said
        assert "Developer API key was not used instead" in said and "secret-place" not in said
        assert isinstance(refused.value, ProviderNotConfigured), "Sprout says it is not connected, not that it is busy"
        assert provider.describe()["last_call"] == "provider_auth"
    assert wire_guard == []


@pytest.fixture
def wire_guard(monkeypatch):
    httpx = pytest.importorskip("httpx")
    sent: list = []
    monkeypatch.setattr(httpx.Client, "send", lambda self, request, **_: sent.append(request) or httpx.Response(500, request=request))
    return sent


def test_a_downloaded_service_account_key_is_not_an_identity(monkeypatch, wire_guard):
    pytest.importorskip("google.genai")
    import google.auth
    from google.oauth2 import service_account

    class Downloaded(service_account.Credentials):
        def __init__(self):
            pass

    monkeypatch.setattr(google.auth, "default", lambda **_: (Downloaded(), "p"))
    with pytest.raises(NotAuthenticated) as refused:
        GeminiLLMProvider(backend=VERTEX, project="p", location="us").complete(ask())
    assert "downloaded service-account key" in str(refused.value) and wire_guard == []


def test_the_identity_is_looked_for_again_until_it_is_there(monkeypatch, wire):
    """A sign-in a minute later, or a metadata server that was slow to start,
    needs no restart."""
    import google.auth
    from google.auth.exceptions import DefaultCredentialsError

    there, llm = google.auth.default, GeminiLLMProvider(backend=VERTEX, project="p", location="us")

    def missing(**_):
        raise DefaultCredentialsError("nothing here")

    monkeypatch.setattr(google.auth, "default", missing)
    with pytest.raises(NotAuthenticated):
        llm.complete(ask())
    monkeypatch.setattr(google.auth, "default", there)
    assert llm.complete(ask()).text == "Hello."


def test_nor_is_one_built_on_it(monkeypatch, wire_guard):
    """Credentials for another account, whose own are a downloaded key."""
    pytest.importorskip("google.genai")
    import google.auth
    from google.oauth2 import service_account

    class Downloaded(service_account.Credentials):
        def __init__(self):
            pass

    class Wrapped:
        valid, quota_project_id, _source_credentials = True, None, None

    middle, outer = Wrapped(), Wrapped()
    middle._source_credentials, outer._source_credentials = Downloaded(), middle
    monkeypatch.setattr(google.auth, "default", lambda **_: (outer, "p"))
    with pytest.raises(NotAuthenticated) as refused:
        GeminiLLMProvider(backend=VERTEX, project="p", location="us").complete(ask())
    assert "downloaded service-account key" in str(refused.value) and wire_guard == []


class Token:
    """Credentials whose token is asked for. `asked` is what happens then."""

    def __init__(self, asked=lambda: None, valid=False):
        self.valid, self.asked, self.times, self.quota_project_id, self.token, self.expired = valid, asked, 0, None, None, False

    def refresh(self, request):
        self.times += 1
        self.asked()
        self.valid, self.token = True, TOKEN

    def with_quota_project(self, _):
        return self


@pytest.fixture
def identities(monkeypatch, wire):
    """What google-auth finds, one after another; the last one for ever."""
    import google.auth

    found: list = []

    def default(**_):
        default.times += 1
        return found[min(default.times, len(found)) - 1], "p"

    default.times = 0
    monkeypatch.setattr(google.auth, "default", default)
    found_by = default
    return found, found_by


def test_a_token_that_does_not_come_holds_nobody_longer_than_they_had(identities):
    """google-auth would wait two minutes, inside the SDK's lock, with every
    other member behind."""
    found, _ = identities
    came = threading.Event()
    found.append(Token(lambda: came.wait(30)))
    llm = GeminiLLMProvider(backend=VERTEX, project="p", location="us", timeout_seconds=0.6)
    said: list = []

    def member():
        started = time.monotonic()
        try:
            llm.complete(ask())
        except GoogleCallFailed as exc:
            said.append((type(exc), time.monotonic() - started))

    members = [threading.Thread(target=member) for _ in range(4)]
    for thread in members:
        thread.start()
    for thread in members:
        thread.join(10)
    assert [kind for kind, _ in said] == [TimedOut] * 4 and max(took for _, took in said) < 3, said
    came.set()
    for _ in range(50):
        if found[0].valid:
            break
        time.sleep(0.05)
    assert llm.complete(ask()).text == "Hello." and found[0].times == 1, "one asked, for all of them"


def test_an_identity_that_has_run_out_is_looked_for_again(identities):
    """Signed in again a minute later: no restart."""
    found, looked = identities
    RefreshError = type("RefreshError", (Exception,), {"retryable": False})

    def refused():
        raise RefreshError(f"invalid_grant {SECRET}")

    found += [Token(refused), Token()]
    llm = GeminiLLMProvider(backend=VERTEX, project="p", location="us")
    with pytest.raises(NotAuthenticated) as first:
        llm.complete(ask())
    assert "Sign in again" in str(first.value) and SECRET not in str(first.value)
    assert llm.complete(ask()).text == "Hello." and looked.times == 2
    assert llm.complete(ask()).text == "Hello." and looked.times == 2, "and then kept"


def test_a_token_server_that_is_down_is_not_a_wrong_identity(identities):
    found, _ = identities
    TransportError = type("TransportError", (Exception,), {})
    RefreshError = type("RefreshError", (Exception,), {"retryable": False})

    def down():
        try:
            raise TransportError("the metadata server did not answer")
        except TransportError as exc:
            raise RefreshError("could not refresh") from exc

    def busy():
        raise type("RefreshError", (Exception,), {"retryable": True})("internal_failure")

    for going_wrong in (down, busy):
        found[:] = [Token(going_wrong)]
        llm, _, clock = None, None, Time()
        llm = GeminiLLMProvider(backend=VERTEX, project="p", location="us", sleep=clock.sleep)
        with pytest.raises(Unreachable):
            llm.complete(ask())
        assert len(clock.slept) == 1, "and tried once more"


def test_a_token_server_that_says_no_is_not_passing(identities):
    """No account attached to this machine: it will be the same in a moment."""
    found, _ = identities
    TransportError = type("TransportError", (Exception,), {})
    RefreshError = type("RefreshError", (Exception,), {"retryable": False})

    def no():
        try:
            raise TransportError("Status: 404", type("Response", (), {"status": 404})())
        except TransportError as exc:
            raise RefreshError("no account") from exc

    found.append(Token(no))
    clock = Time()
    with pytest.raises(NotAuthenticated):
        GeminiLLMProvider(backend=VERTEX, project="p", location="us", sleep=clock.sleep).complete(ask())
    assert clock.slept == []


def test_a_token_is_asked_for_and_not_waited_for_two_minutes(monkeypatch):
    """Whatever google-auth would have allowed it."""
    pytest.importorskip("google.genai")
    from google.auth.transport import requests as transport

    waited: list = []
    monkeypatch.setattr(transport.Request, "__call__", lambda self, url, **kwargs: waited.append(kwargs["timeout"]))
    asking = google_backend._asking()
    asking("https://token.example")
    asking("https://token.example", method="POST", body=b"x", timeout=120)
    assert waited == [google_backend.IDENTITY_SECONDS] * 2 and google_backend.IDENTITY_SECONDS <= 10


def test_an_identity_google_refuses_is_looked_for_again(identities, monkeypatch):
    import httpx

    found, looked = identities
    found += [Token(valid=True), Token(valid=True)]
    llm = GeminiLLMProvider(backend=VERTEX, project="p", location="us")
    answer = httpx.Client.send
    found[0].token = found[1].token = TOKEN
    monkeypatch.setattr(httpx.Client, "send", lambda self, request, **_: httpx.Response(401, json={"error": {"code": 401, "status": "UNAUTHENTICATED"}}, request=request))
    with pytest.raises(NotAuthenticated):
        llm.complete(ask())
    monkeypatch.setattr(httpx.Client, "send", answer)
    assert llm.complete(ask()).text == "Hello." and looked.times == 2


@pytest.mark.parametrize("kind", BACKENDS)
def test_nothing_in_the_environment_can_have_the_requests_written_down(monkeypatch, wire, kind, tmp_path):
    for name, value in (("GOOGLE_GENAI_CLIENT_MODE", "record"), ("GOOGLE_GENAI_REPLAYS_DIRECTORY", str(tmp_path)), ("GOOGLE_GENAI_REPLAY_ID", "x")):
        monkeypatch.setenv(name, value)
    llm = GeminiLLMProvider(backend=kind, project="p", location="us", api_key=KEY, local=True)
    assert llm.complete(ask(text=SECRET)).text == "Hello."
    assert type(llm.backend.client()._api_client).__name__ == "BaseApiClient" and list(tmp_path.rglob("*")) == []


@pytest.mark.parametrize("kind", BACKENDS)
def test_without_the_sdk_it_says_what_to_install(monkeypatch, kind):
    real = builtins.__import__

    def without(name, *args, **kwargs):
        if name == "google" or name.startswith("google.genai"):
            raise ImportError("No module named 'google.genai'")
        return real(name, *args, **kwargs)

    monkeypatch.setitem(sys.modules, "google.genai", None)
    monkeypatch.setattr(builtins, "__import__", without)
    llm = GeminiLLMProvider(backend=kind, project="p", location="us", api_key=KEY, local=True)
    with pytest.raises(ProviderNotConfigured) as refused:
        llm.complete(ask())
    assert "veye-api[gemini]" in str(refused.value)
    assert llm.describe()["configured"] is True, "configured; what is missing is the package"


# ---- what goes wrong, in our words -------------------------------------------------------------

class FromGoogle(Exception):
    """Shaped as google.genai.errors.APIError is, and full of things that must
    not be repeated."""

    def __init__(self, code, status="", *, reasons=(), details=(), message=""):
        body = {"error": {"code": code, "status": status, "message": f"{message} {SECRET} {KEY} {TOKEN}",
                          "details": [*({"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": r, "metadata": {"key": KEY}} for r in reasons), *details]}}
        super().__init__(f"{code} {status}. {body}")
        self.code, self.status, self.message, self.details = code, status, body["error"]["message"], body


def wait_for(seconds):
    return {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": f"{seconds}s"}


def quota(quota_id):
    return {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaMetric": "generate_requests", "quotaId": quota_id}]}


def named(name, *bases):
    """An exception of somebody else's library, known by its name."""
    cls: type = Exception
    for base in reversed(bases):
        cls = type(base, (cls,), {})
    return type(name, (cls,), {})(f"{SECRET} {KEY}")


class Models:
    """Answers with what it was given, in order; the last one for ever."""

    def __init__(self, *answers):
        self.answers, self.asked = list(answers), 0

    def generate_content(self, **_):
        answer = self.answers[min(self.asked, len(self.answers) - 1)]
        self.asked += 1
        if isinstance(answer, Exception):
            raise answer
        return answer

    embed_content = generate_content


def answered(text="Hello.", finish="STOP", *, read=10, written=5, thought=None, block=None):
    usage = type("U", (), {"prompt_token_count": read, "candidates_token_count": written, "thoughts_token_count": thought})()
    candidate = type("C", (), {"finish_reason": finish})()
    return type("R", (), {"text": text, "usage_metadata": usage, "candidates": [candidate] if finish else [],
                          "prompt_feedback": type("F", (), {"block_reason": block})() if block else None})()


class Time:
    def __init__(self):
        self.now, self.slept = 1000.0, []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def gemini(*answers, kind=VERTEX, **kwargs):
    models, clock = Models(*answers), Time()
    if kind == DEVELOPER and "budget" not in kwargs:
        kwargs["budget"] = CallBudget(500)      # not this process's own
    llm = GeminiLLMProvider(backend=kind, project="veye-test-project", location="us", api_key=KEY, local=True,
                            client=type("Client", (), {"models": models})(), sleep=clock.sleep, clock=clock, **kwargs)
    return llm, models, clock


WRONG = [
    (FromGoogle(401, "UNAUTHENTICATED"), NotAuthenticated, "provider_auth"),
    (FromGoogle(400, "INVALID_ARGUMENT", reasons=["API_KEY_INVALID"]), NotAuthenticated, "provider_auth"),
    (FromGoogle(400, "INVALID_ARGUMENT", message="API key not valid. Please pass a valid API key."), NotAuthenticated, "provider_auth"),
    (FromGoogle(403, "PERMISSION_DENIED", reasons=["API_KEY_SERVICE_BLOCKED"]), NotAuthenticated, "provider_auth"),
    (named("RefreshError"), NotAuthenticated, "provider_auth"),
    (named("DefaultCredentialsError"), NotAuthenticated, "provider_auth"),
    (FromGoogle(403, "PERMISSION_DENIED", reasons=["IAM_PERMISSION_DENIED"]), NotPermitted, "provider_permission"),
    (FromGoogle(403, "PERMISSION_DENIED", reasons=["SERVICE_DISABLED"]), NotPermitted, "provider_permission"),
    (FromGoogle(403, "PERMISSION_DENIED", reasons=["BILLING_DISABLED"]), NotPermitted, "provider_permission"),
    (FromGoogle(402, "PAYMENT_REQUIRED"), NotPermitted, "provider_permission"),
    (FromGoogle(400, "FAILED_PRECONDITION", message="User location is not supported for the API use."), NotPermitted, "provider_permission"),
    (FromGoogle(404, "NOT_FOUND"), NotServed, "provider_model"),
    (FromGoogle(429, "RESOURCE_EXHAUSTED", details=[quota("GenerateRequestsPerMinutePerProjectPerModel"), wait_for(2)]), RateLimited, "provider_rate_limited"),
    (FromGoogle(429, "RESOURCE_EXHAUSTED"), RateLimited, "provider_rate_limited"),
    (FromGoogle(429, "RESOURCE_EXHAUSTED", details=[quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), wait_for(2)]), QuotaExhausted, "provider_quota"),
    (FromGoogle(429, "RESOURCE_EXHAUSTED", details=[wait_for(3600)]), QuotaExhausted, "provider_quota"),
    (FromGoogle(504, "DEADLINE_EXCEEDED"), TimedOut, "provider_timeout"),
    (FromGoogle(408), TimedOut, "provider_timeout"),
    (named("ReadTimeout", "TimeoutException", "TransportError"), TimedOut, "provider_timeout"),     # httpx's own family
    (named("Timeout"), TimedOut, "provider_timeout"),
    (TimeoutError(SECRET), TimedOut, "provider_timeout"),
    (named("ConnectError", "NetworkError", "TransportError"), Unreachable, "provider_unavailable"),
    (named("ConnectionError", "RequestException"), Unreachable, "provider_unavailable"),            # and requests'
    (ConnectionError(SECRET), Unreachable, "provider_unavailable"),
    (FromGoogle(500, "INTERNAL"), Unreachable, "provider_unavailable"),
    (FromGoogle(503, "UNAVAILABLE"), Unreachable, "provider_unavailable"),
    (FromGoogle(400, "INVALID_ARGUMENT"), Refused, "provider_refused"),
    (ValueError(SECRET), GoogleCallFailed, "provider_error"),
]


@pytest.mark.parametrize("kind", BACKENDS)
def test_everything_that_goes_wrong_has_a_name_and_repeats_nothing(kind, caplog):
    """Google's own text can quote the request it refused. None of it is in the
    message, the representation, the traceback or the log."""
    caplog.set_level(logging.DEBUG)
    for exc, cls, category in WRONG:
        caplog.clear()
        llm, _, _ = gemini(exc, kind=kind)
        with pytest.raises(GoogleCallFailed) as failed:
            llm.complete(ask(text=SECRET))
        what = f"{category}: {type(exc).__name__} {getattr(exc, 'code', '')}"
        assert type(failed.value) is cls and failed.value.category == category, what
        assert llm.describe()["last_call"] == category, what
        printed = "".join(traceback.format_exception(failed.value)) + repr(failed.value) + str(failed.value) + caplog.text + str(llm.describe())
        for secret in (SECRET, KEY, TOKEN):
            assert secret not in printed, f"{secret!r} was repeated ({what})"
        assert failed.value.__context__ is None and failed.value.__cause__ is None, f"Google's exception came along with ours ({what})"
        assert MODEL in str(failed.value) or category == "provider_auth", what


def test_a_refusal_says_what_to_do_about_it():
    for reason, hint in (("SERVICE_DISABLED", "API is not enabled"), ("BILLING_DISABLED", "Billing is not enabled"),
                         ("IAM_PERMISSION_DENIED", "roles/aiplatform.user"), ("USER_PROJECT_DENIED", "serviceUsageConsumer")):
        llm, _, _ = gemini(FromGoogle(403, "PERMISSION_DENIED", reasons=[reason]))
        with pytest.raises(NotPermitted) as refused:
            llm.complete(ask())
        assert hint in str(refused.value) and reason in str(refused.value) and "403" in str(refused.value)


def test_only_google_s_own_tokens_are_repeated():
    llm, _, _ = gemini(FromGoogle(403, f"PERMISSION {SECRET}", reasons=[f"reason {SECRET}", "lower_case", 7, "OK_TOKEN"]))
    with pytest.raises(NotPermitted) as refused:
        llm.complete(ask())
    assert "(403 OK_TOKEN)" in str(refused.value)


# ---- trying again ---------------------------------------------------------------------------

def test_once_more_when_google_says_to_and_not_a_third_time():
    llm, models, clock = gemini(FromGoogle(503, "UNAVAILABLE"), answered())
    reply = llm.complete(ask())
    assert (reply.text, reply.attempts, models.asked) == ("Hello.", 2, 2)
    assert len(clock.slept) == 1 and 0.6 <= clock.slept[0] <= 0.9
    llm, models, _ = gemini(FromGoogle(503, "UNAVAILABLE"))
    with pytest.raises(Unreachable):
        llm.complete(ask())
    assert models.asked == ATTEMPTS == 2


def test_it_waits_as_long_as_it_was_asked_to():
    llm, _, clock = gemini(FromGoogle(429, "RESOURCE_EXHAUSTED", details=[wait_for("3.5")]), answered())
    assert llm.complete(ask()).attempts == 2 and clock.slept == [3.5]


def test_and_does_not_try_when_that_is_longer_than_the_member_would_have_waited():
    llm, models, clock = gemini(FromGoogle(429, "RESOURCE_EXHAUSTED", details=[wait_for(28)]), answered(), timeout_seconds=30.0)
    with pytest.raises(RateLimited):
        llm.complete(ask())
    assert models.asked == 1 and clock.slept == []


def test_nothing_that_will_not_get_better_is_tried_twice():
    """A timeout least of all: it has had all the time there was."""
    for exc, cls, _ in WRONG:
        llm, models, clock = gemini(exc, answered())
        if cls in (RateLimited, Unreachable):
            assert llm.complete(ask()).attempts == 2, exc
            continue
        with pytest.raises(GoogleCallFailed):
            llm.complete(ask())
        assert models.asked == 1 and clock.slept == [], exc


def test_the_second_try_has_only_what_is_left_of_the_time():
    asked = []

    class Slow:
        def generate_content(self, *, config, **_):
            asked.append(config["http_options"]["timeout"])
            clock.now += 10
            raise FromGoogle(503, "UNAVAILABLE")

    clock = Time()
    llm = GeminiLLMProvider(backend=VERTEX, project="p", location="us", client=type("C", (), {"models": Slow()})(), sleep=clock.sleep, clock=clock,
                            timeout_seconds=30.0)
    with pytest.raises(Unreachable):
        llm.complete(ask())
    assert asked[0] == 30_000 and 19_000 <= asked[1] < 19_500, asked


# ---- an answer that is not one ----------------------------------------------------------------

def test_half_an_answer_is_not_an_answer():
    """Half a sentence about somebody's health can say the opposite of the
    whole one."""
    for response, cls in ((answered("", "MAX_TOKENS"), CutShort), (answered("Take two tablets and", "MAX_TOKENS"), CutShort),
                          (answered("", "SAFETY"), Refused), (answered("half of it", "SAFETY"), Refused),
                          (answered("", None, block="PROHIBITED_CONTENT"), Refused), (answered("", "STOP"), Refused),
                          (answered(None, "STOP"), Refused), (answered("x", "RECITATION"), Refused)):
        llm, _, _ = gemini(response)
        with pytest.raises(cls) as failed:
            llm.complete(ask(text=SECRET))
        assert SECRET not in str(failed.value) and "tablets" not in str(failed.value)
        assert llm.describe()["tokens_in"] == 10, "it was paid for all the same"
        assert (failed.value.spent.input_tokens, failed.value.spent.text, failed.value.spent.backend) == (10, "", VERTEX), "and whoever traces it is told"


def test_google_s_enumerations_are_words():
    from enum import Enum

    class Finish(str, Enum):
        STOP = "STOP"

    llm, _, _ = gemini(answered("Hello.", Finish.STOP))
    assert llm.complete(ask()).finish_reason == "STOP"


# ---- what it used, and what that came to --------------------------------------------------------

def test_the_thinking_is_counted_because_it_is_billed():
    llm, _, _ = gemini(answered(read=1000, written=200, thought=800))
    reply = llm.complete(ask())
    assert (reply.input_tokens, reply.output_tokens, reply.thinking_tokens) == (1000, 1000, 800)
    described = llm.describe()
    assert (described["calls"], described["tokens_in"], described["tokens_out"]) == (1, 1000, 1000)
    assert reply.estimated_cost_usd == described["estimated_cost_usd"] == estimated_cost(MODEL, 1000, 1000, location="us")


def test_the_cost_is_the_published_price_on_the_day():
    """By hand, from Google's pages of 25 Nov 2026."""
    for model, read, wrote, place, day, dollars in (
            (MODEL, 1_000_000, 0, "global", date(2026, 11, 25), 0.75), (MODEL, 0, 1_000_000, "global", date(2026, 12, 31), 3.75),
            (MODEL, 1_000_000, 1_000_000, "global", date(2027, 1, 1), 9.0), (MODEL, 1_000_000, 1_000_000, "us", date(2026, 11, 25), 4.95),
            ("gemini-embedding-001", 1_000_000, None, "us-central1", date(2026, 11, 25), 0.15), (MODEL, None, None, "us", date(2026, 11, 25), 0.0),
            ("a-model-with-no-price", 1_000_000, 1, "us", date(2026, 11, 25), None), (MODEL, 1, 1, "us", date(2026, 1, 1), None)):
        assert estimated_cost(model, read, wrote, location=place, on=day) == (None if dollars is None else pytest.approx(dollars)), (model, place, day)


def test_the_developer_key_has_a_ceiling_and_the_model_and_the_embeddings_share_it(monkeypatch):
    monkeypatch.setattr(google_backend, "developer_budget", CallBudget(3))
    llm, models, _ = gemini(answered(), kind=DEVELOPER, budget=None)
    emb = GoogleEmbeddingProvider(backend=DEVELOPER, dimensions=256, api_key=KEY, local=True,
                                  client=type("C", (), {"models": Models(type("E", (), {"embeddings": [type("V", (), {"values": [1.0] * 256})()]})())})())
    llm.complete(ask())
    emb.embed(["x"], classification=DataClassification.GENERAL)
    assert llm.describe()["calls_left_this_hour"] == emb.describe()["calls_left_this_hour"] == 1
    llm.complete(ask())
    for spent in (lambda: llm.complete(ask()), lambda: emb.embed(["x"], classification=DataClassification.GENERAL)):
        with pytest.raises(SpendingCeiling) as stopped:
            spent()
        assert "Nothing was sent" in str(stopped.value) and stopped.value.category == "provider_budget"
    assert models.asked == 2


def test_the_ceiling_is_an_hour_s_and_a_retry_counts():
    clock = Time()
    budget = CallBudget(2, 3600.0, clock)
    llm, models, _ = gemini(FromGoogle(503, "UNAVAILABLE"), answered(), kind=DEVELOPER, budget=budget)
    assert llm.complete(ask()).attempts == 2
    with pytest.raises(SpendingCeiling):
        llm.complete(ask())
    clock.now += 3601
    assert llm.complete(ask()).text == "Hello." and models.asked == 3
    assert DEVELOPER_CALLS_AN_HOUR == google_backend.developer_budget.limit == 200


def test_vertex_has_no_ceiling_of_ours():
    llm, models, _ = gemini(answered())
    for _ in range(DEVELOPER_CALLS_AN_HOUR + 5):
        llm.complete(ask())
    assert models.asked == DEVELOPER_CALLS_AN_HOUR + 5 and "calls_left_this_hour" not in llm.describe()


# ---- what may be shown ------------------------------------------------------------------------

@pytest.mark.parametrize("kind", BACKENDS)
def test_what_is_shown_names_the_door_and_never_the_key(kind):
    llm = GeminiLLMProvider(backend=kind, project="veye-test-project", location="us", api_key=KEY, local=True)
    emb = GoogleEmbeddingProvider(backend=kind, dimensions=256, project="veye-test-project", api_key=KEY, local=True)
    for provider in (llm, emb):
        shown = provider.describe()
        assert shown["backend"] == kind and shown["external"] is True and shown["last_call"] == "not used yet"
        assert shown["auth"] == ("developer API key" if kind == DEVELOPER else "application default credentials")
        assert KEY not in str(shown) + repr(provider) + repr(provider.backend)
    assert llm.describe()["accepts"] == "general, synthetic_member"


def test_the_consoles_status_page_is_told_the_door_and_not_the_key(admin_client):
    from app.core.runtime import configure_runtime

    configure_runtime(llm=GeminiLLMProvider(backend=DEVELOPER, api_key=KEY, local=True),
                      embeddings=GoogleEmbeddingProvider(backend=VERTEX, dimensions=256, project="veye-test-project", api_key=KEY))
    answer = admin_client.get("/api/v1/admin/companion/advanced/provider-status")
    assert answer.status_code == 200 and KEY not in answer.text
    shown = answer.json()
    assert shown["llm"]["backend"] == "developer" and shown["embeddings"]["backend"] == "vertex"
    assert shown["embeddings"]["location"] == "us-central1"


def test_a_backend_that_cannot_be_used_says_why_on_the_status_page(admin_client):
    from app.core.runtime import configure_runtime

    runtime = build_runtime(Settings(database_url="sqlite://", environment="local-docker", llm_provider="gemini", gemini_backend="developer",
                                     embedding_provider="google", gcp_project="veye-test-project"))
    configure_runtime(llm=runtime.llm, embeddings=runtime.embeddings)
    shown = admin_client.get("/api/v1/admin/companion/advanced/provider-status").json()
    for part in ("llm", "embeddings"):
        assert shown[part]["configured"] is False and "VEYE_GEMINI_API_KEY is not set" in shown[part]["reason"]


# ---- the factories ----------------------------------------------------------------------------

def test_a_misconfigured_backend_boots_and_reports_itself():
    llm = build_llm_provider("gemini", groq_api_key=None, groq_model="x", timeout_seconds=5, gemini={"backend": "", "api_key": KEY, "project": "p", "local": True})
    assert isinstance(llm, UnconfiguredLLMProvider) and "VEYE_GEMINI_BACKEND" in llm.describe()["reason"]
    emb = build_embedding_provider("google", dimensions=256, settings=Settings(database_url="sqlite://", environment="test", gemini_api_key=KEY, gcp_project="p"))
    assert isinstance(emb, UnconfiguredEmbeddingProvider) and "VEYE_GEMINI_BACKEND" in emb.describe()["reason"]
    with pytest.raises(ProviderNotConfigured):
        emb.embed(["x"], classification=DataClassification.GENERAL)


def test_a_gemini_provider_built_without_naming_a_backend_is_refused_too():
    llm = build_llm_provider("gemini", groq_api_key=None, groq_model="x", timeout_seconds=5, gemini={"project": "p", "location": "us"})
    assert isinstance(llm, UnconfiguredLLMProvider)
    runtime = build_runtime(Settings(database_url="sqlite://", environment="local-docker", llm_provider="gemini", embedding_provider="google",
                                     gemini_api_key=KEY, gcp_project="veye-test-project"))
    for provider in (runtime.llm, runtime.embeddings):
        assert "VEYE_GEMINI_BACKEND must be" in provider.describe()["reason"]


def test_one_answer_is_one_request():
    """The SDK can call functions and carry on an answer by itself, where
    nothing counts it. It is told not to."""
    class Asked:
        def generate_content(self, *, config, **_):
            self.config = config
            return answered()

    models = Asked()
    GeminiLLMProvider(backend=VERTEX, project="p", location="us", client=type("C", (), {"models": models})()).complete(ask())
    assert models.config["automatic_function_calling"] == {"disable": True} and models.config["automatic_continuation"] is False
