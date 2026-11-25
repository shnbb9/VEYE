"""The one way VEYE reaches Google's models. Two doors, chosen by name.

  developer   the Gemini Developer API, opened with VEYE_GEMINI_API_KEY. Local
              development and synthetic testing, and nothing else.
  vertex      Vertex AI, opened with the identity of whoever is running the
              service (Application Default Credentials: the attached service
              account on Cloud Run, a signed-in developer on a laptop).

VEYE_GEMINI_BACKEND says which, and nothing else does. Not the presence of a
key, not the absence of a project, not an environment variable the SDK reads on
its own. A door that will not open stays shut: a missing identity is never made
up for with the key, and a missing key is never made up for with Vertex AI.

The language model and the embeddings both come through here, so there is one
place that knows how to authenticate, how long to wait, when to try again, and
how to say what went wrong. What goes wrong is said in VEYE's own words. An
error from Google can quote the request it refused, and the request may be
somebody's question about their health.
"""

from __future__ import annotations

import logging
import random
import re
import threading
import time
from collections import deque
from concurrent.futures import Future
from datetime import date, datetime, timezone
from typing import Callable, TypeVar

from app.companion.providers.llm import ProviderFailed, ProviderNotConfigured

log = logging.getLogger("veye.companion.google")

T = TypeVar("T")

DEVELOPER, VERTEX = "developer", "vertex"
BACKENDS = (DEVELOPER, VERTEX)

# What google-genai 2.34 uses when it is not told. Told, so that an upgrade of
# the SDK cannot move VEYE to another version of Google's API on its own (3.x
# changes the default).
API_VERSIONS = {DEVELOPER: "v1beta", VERTEX: "v1beta1"}

# Where VEYE asks for each kind of model on Vertex AI, whatever the model is
# called. From the table of ticks at
# docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations,
# read 25 Nov 2026: gemini-3.8-flash is served from these multi-regions, and
# gemini-embedding-001 from single regions only, of which these are the ones in
# the United States. The two do not overlap, so one setting cannot serve both.
GENERATES_FROM = ("global", "us", "eu")
EMBEDS_FROM = ("us-central1", "us-east1", "us-east4", "us-east5", "us-south1", "us-west1", "us-west4")

# A model is a name. A path would carry its own project and its own place.
_MODEL_NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,60}$")

# US dollars for a million tokens, as published on 25 Nov 2026
# (aistudio.google.com/docs/pricing, cloud.google.com/vertex-ai/pricing):
# (from, input, output). Output includes the model's own thinking. For working
# out what a test cost, never for a bill.
NEW_YEAR = date(2027, 1, 1)
PRICES: dict[str, tuple[tuple[date, float, float], ...]] = {
    "gemini-3.8-flash": ((date(2026, 9, 2), 0.75, 3.75), (NEW_YEAR, 1.50, 7.50)),
    "gemini-embedding-001": ((date(2025, 7, 14), 0.15, 0.0),),
}
# On Vertex AI, `us` and `eu` cost a tenth more than `global` for generation.
REGIONAL = 1.10

SCOPE = "https://www.googleapis.com/auth/cloud-platform"

# Once more, if Google says to try again, and only while the member would have
# been waiting anyway.
ATTEMPTS = 2
FIRST_WAIT = 0.6
LEAST_LEFT = 4.0
# A loop somewhere must not become a bill. (In one process: a job has its own.)
DEVELOPER_CALLS_AN_HOUR = 200
# One request for a token. google-auth would wait two minutes.
IDENTITY_SECONDS = 8.0


# ---- what can go wrong ---------------------------------------------------------------------

class GoogleCallFailed(ProviderFailed):
    category = "provider_error"
    retry = False

    def __init__(self, message: str, *, wait: float | None = None) -> None:
        super().__init__(message)
        self.wait = wait


class NotAuthenticated(GoogleCallFailed, ProviderNotConfigured):
    category = "provider_auth"


class NotPermitted(GoogleCallFailed, ProviderNotConfigured):
    category = "provider_permission"


class NotServed(GoogleCallFailed, ProviderNotConfigured):
    category = "provider_model"


class QuotaExhausted(GoogleCallFailed):
    category = "provider_quota"


class RateLimited(GoogleCallFailed):
    category = "provider_rate_limited"
    retry = True


class TimedOut(GoogleCallFailed):
    category = "provider_timeout"


class Unreachable(GoogleCallFailed):
    category = "provider_unavailable"
    retry = True


class Refused(GoogleCallFailed):
    """The request itself, or what the model would have said."""
    category = "provider_refused"


class CutShort(GoogleCallFailed):
    """It stopped before it had written anything."""
    category = "provider_cut_short"


class SpendingCeiling(GoogleCallFailed):
    category = "provider_budget"


class CallBudget:
    """No more than so many calls in so many seconds, in this process."""

    def __init__(self, limit: int, seconds: float = 3600.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit, self.seconds, self._clock = limit, seconds, clock
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def _forget(self) -> None:
        since = self._clock() - self.seconds
        while self._calls and self._calls[0] <= since:
            self._calls.popleft()

    def spend(self) -> None:
        with self._lock:
            self._forget()
            if len(self._calls) >= self.limit:
                raise SpendingCeiling(f"{self.limit} calls to the Gemini Developer API in an hour is this process's ceiling. "
                                      "Nothing was sent. Wait, or restart the API on purpose.")
            self._calls.append(self._clock())

    def left(self) -> int:
        with self._lock:
            self._forget()
            return self.limit - len(self._calls)


# Shared by the model and the embeddings: it is one key and one bill.
developer_budget = CallBudget(DEVELOPER_CALLS_AN_HOUR)


def endpoint(kind: str, location: str) -> str:
    if kind == DEVELOPER:
        return "https://generativelanguage.googleapis.com/"
    if location == "global":
        return "https://aiplatform.googleapis.com/"
    if location in ("us", "eu"):
        return f"https://aiplatform.{location}.rep.googleapis.com/"
    return f"https://{location}-aiplatform.googleapis.com/"


def estimated_cost(model: str, input_tokens: int | None, output_tokens: int | None, *, location: str = "global",
                   on: date | None = None) -> float | None:
    """In US dollars, at the published price on the day. None where there is
    no published price to work from."""
    day = on or datetime.now(timezone.utc).date()
    price = next(((i, o) for since, i, o in reversed(PRICES.get(model, ())) if since <= day), None)
    if price is None:
        return None
    dollars = ((input_tokens or 0) * price[0] + (output_tokens or 0) * price[1]) / 1_000_000
    return round(dollars * (REGIONAL if location in ("us", "eu") else 1.0), 8)


# ---- whose identity ------------------------------------------------------------------------

def _in_background(work: Callable[[], T]) -> "Future[T]":
    """In a thread nothing waits for at the end, unlike an executor's."""
    future: Future[T] = Future()

    def run() -> None:
        try:
            future.set_result(work())
        except BaseException as exc:  # noqa: BLE001 - whoever waits is given it
            future.set_exception(exc)

    threading.Thread(target=run, name="veye-google-identity", daemon=True).start()
    return future


def _asking():
    """What google-auth asks for a token with, and for no longer than this."""
    from google.auth.transport.requests import Request

    class Bounded(Request):
        def __call__(self, url, method="GET", body=None, headers=None, timeout=None, **kwargs):
            return super().__call__(url, method=method, body=body, headers=headers, timeout=IDENTITY_SECONDS, **kwargs)

    return Bounded()


def _downloaded(credentials) -> bool:
    """A service-account key, or somebody else's credentials built on one."""
    from google.oauth2 import service_account

    while credentials is not None:
        if isinstance(credentials, service_account.Credentials):
            return True
        credentials = getattr(credentials, "_source_credentials", None)
    return False


class Identity:
    """Application Default Credentials, and never a key: not the Developer
    API's, whatever is in the environment, and not a downloaded service-account
    key, which is a password that does not expire.

    Found and refreshed by one thread, and waited for by each caller no longer
    than that caller has. Left to the SDK it is refreshed inside a request and
    under a lock: a token server that does not answer would hold the first
    member for two minutes and everybody else behind them."""

    def __init__(self, project: str) -> None:
        self.project = project
        self._lock = threading.Lock()
        self._credentials = None
        self._work: Future | None = None

    def get(self, seconds: float):
        with self._lock:
            if self._credentials is not None and self._credentials.valid:
                return self._credentials
            if self._work is None or self._work.done():
                self._work = _in_background(self._find)
            work = self._work
        return work.result(timeout=max(seconds, 0.05))

    def forget(self) -> None:
        """Whoever it was may have signed in again."""
        with self._lock:
            self._credentials = None

    def _find(self):
        import google.auth

        credentials, self._credentials = self._credentials, None
        if credentials is None:
            credentials, _ = google.auth.default(scopes=[SCOPE])
            if _downloaded(credentials):
                raise NotAuthenticated(
                    "The credentials found are a downloaded service-account key. VEYE does not use one: run as the service's own "
                    "identity (Cloud Run), or sign in with 'gcloud auth application-default login --impersonate-service-account=...'.")
            # A laptop's credentials can name another project to pay. This one pays.
            if getattr(credentials, "quota_project_id", None) not in (None, self.project):
                credentials = credentials.with_quota_project(self.project)
        if not credentials.valid:
            credentials.refresh(_asking())
        self._credentials = credentials
        return credentials


# ---- the connection ------------------------------------------------------------------------

def _sdk():
    """google-genai and what it authenticates with, or None."""
    try:
        import google.auth.transport.requests  # noqa: F401
        from google import genai
    except ImportError:
        return None
    return genai


class GoogleBackend:
    """One door, already chosen and already checked."""

    def __init__(self, kind: str, *, model: str, project: str = "", location: str = "", api_key: str | None = None,
                 timeout_seconds: float = 30.0, client=None, budget: CallBudget | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> None:
        self.kind, self.model, self.project, self.location = kind, model, project, location
        self.timeout_seconds = timeout_seconds
        self._api_key = api_key
        self._given = client
        self._client = self._client_for = None
        self._identity = Identity(project) if kind == VERTEX else None
        self._lock = threading.Lock()
        self._sleep, self._clock = sleep, clock
        self.budget = budget if budget is not None else (developer_budget if kind == DEVELOPER else None)
        self.last = "not used yet"
        self.calls = self.input_tokens = self.output_tokens = 0
        self.estimated_cost_usd: float | None = 0.0

    @property
    def is_developer(self) -> bool:
        return self.kind == DEVELOPER

    @property
    def label(self) -> str:
        return "the Gemini Developer API" if self.is_developer else f"Vertex AI ({self.location}, project {self.project})"

    # ---- the SDK --------------------------------------------------------------
    def client(self, until: float | None = None):
        if self._given is not None:
            return self._given
        genai = _sdk()
        if genai is None:
            raise ProviderNotConfigured("The 'google-genai' package is not installed (pip install 'veye-api[gemini]').")
        credentials = None
        if self._identity is not None:
            # Fresh, so that the SDK has nothing to refresh by itself.
            credentials = self._identity.get(self.timeout_seconds if until is None else until - self._clock())
        with self._lock:
            if self._client is None or self._client_for is not credentials:
                self._client, self._client_for = self._connect(genai, credentials), credentials
            return self._client

    def _connect(self, genai, credentials):
        from google.genai.client import DebugConfig

        # Every choice is an argument. The SDK reads a dozen environment
        # variables for what it is not given; one of them is an API key, and one
        # would have it write every request to a file.
        shared = {"debug_config": DebugConfig(client_mode=None, replays_directory=None, replay_id=None),
                  "http_options": {"base_url": endpoint(self.kind, self.location), "api_version": API_VERSIONS[self.kind],
                                   "timeout": int(self.timeout_seconds * 1000)}}
        if self.is_developer:
            return genai.Client(vertexai=False, api_key=self._api_key, **shared)
        return genai.Client(vertexai=True, project=self.project, location=self.location, credentials=credentials, **shared)

    # ---- a call ---------------------------------------------------------------
    def call(self, send: Callable[[object, int], T]) -> tuple[T, int]:
        """`send(client, timeout_ms)`, and how many times it took. Tried once
        more when Google says to and there is time, never longer than one
        answer was allowed to take."""
        until = self._clock() + self.timeout_seconds
        failure: GoogleCallFailed | ProviderNotConfigured | None = None
        for attempt in range(1, ATTEMPTS + 1):
            if self.budget is not None:
                self.budget.spend()
            try:
                answer = send(self.client(until), max(1, int((until - self._clock()) * 1000)))
            except ProviderNotConfigured as exc:
                failure = exc                       # said in our own words already
            except Exception as exc:
                failure = explain(exc, self)
            else:
                self.last = "ok"
                return answer, attempt
            self.last = getattr(failure, "category", "provider_not_configured")
            if self._identity is not None and isinstance(failure, NotAuthenticated):
                self._identity.forget()             # looked for again, not refused for good
            wait = getattr(failure, "wait", None)
            wait = wait if wait is not None else FIRST_WAIT * (1 + random.random() / 2)
            if not getattr(failure, "retry", False) or attempt == ATTEMPTS or self._clock() + wait + LEAST_LEFT > until:
                break
            log.info("%s: %s; trying once more in %.1fs", self.model, self.last, wait)
            self._sleep(wait)
        # Raised out here, where Google's own exception is no longer attached.
        raise failure

    def spent(self, input_tokens: int | None, output_tokens: int | None) -> float | None:
        """Count what a call used, and what it came to at the published price.
        Not reported is not nothing: the total is then not known either."""
        cost = None
        if input_tokens is not None or output_tokens is not None:
            cost = estimated_cost(self.model, input_tokens, output_tokens, location=self.location or "global")
        with self._lock:
            self.calls += 1
            self.input_tokens += input_tokens or 0
            self.output_tokens += output_tokens or 0
            self.estimated_cost_usd = None if cost is None or self.estimated_cost_usd is None else round(self.estimated_cost_usd + cost, 8)
        return cost

    # ---- what may be shown ----------------------------------------------------
    def describe(self) -> dict[str, object]:
        shown: dict[str, object] = {
            "backend": self.kind,
            "endpoint": endpoint(self.kind, self.location).removeprefix("https://").rstrip("/"),
            "api_version": API_VERSIONS[self.kind],
            "auth": "developer API key" if self.is_developer else "application default credentials",
        }
        if self.is_developer:
            shown["calls_left_this_hour"] = self.budget.left() if self.budget is not None else None
        else:
            shown |= {"project": self.project, "location": self.location}
        return shown | {"last_call": self.last, "calls": self.calls, "tokens_in": self.input_tokens, "tokens_out": self.output_tokens,
                        "estimated_cost_usd": self.estimated_cost_usd}


def choose_backend(kind: str | None, *, model: str, project: str | None = "", location: str | None = "", api_key: str | None = None,
                   local: bool = False, member_data_cleared: bool = False, timeout_seconds: float = 30.0,
                   places: tuple[str, ...] = GENERATES_FROM, location_setting: str = "VEYE_GCP_LOCATION", **extra) -> GoogleBackend:
    """The backend that was asked for, or a refusal that says what is missing.
    Refused at start-up, not at the first member's message."""
    kind = (kind or "").strip().lower()
    if kind not in BACKENDS:
        raise ProviderNotConfigured(
            "VEYE_GEMINI_BACKEND must be 'developer' or 'vertex'. It is never worked out from which credentials happen to be there.")
    if not _MODEL_NAME.match(model):
        raise ProviderNotConfigured(f"'{model[:80]}' is not a model's name. A path would carry its own project and its own place.")
    if kind == DEVELOPER:
        if not local:
            raise ProviderNotConfigured(
                "The Gemini Developer API and its key are for local development with synthetic data, not a production identity. "
                "This environment uses VEYE_GEMINI_BACKEND=vertex with VEYE_GCP_PROJECT and Application Default Credentials.")
        if member_data_cleared:
            # Configuring both has misunderstood what the clearance means.
            raise ProviderNotConfigured(
                "Member data is never sent through a developer API key. Use Vertex AI with the service identity, "
                "or leave VEYE_GEMINI_MEMBER_DATA_CLEARED off.")
        if not api_key:
            raise ProviderNotConfigured(
                "VEYE_GEMINI_BACKEND is 'developer' and VEYE_GEMINI_API_KEY is not set. Vertex AI was not used instead.")
        return GoogleBackend(DEVELOPER, model=model, api_key=api_key, timeout_seconds=timeout_seconds, **extra)
    if not project:
        raise ProviderNotConfigured(
            "VEYE_GEMINI_BACKEND is 'vertex' and VEYE_GCP_PROJECT is not set. The Developer API key was not used instead.")
    if location not in places:
        # A place that does not serve the model answers NOT_FOUND to every
        # call; one that does, and is somewhere else, answers.
        raise ProviderNotConfigured(f"{model} is not served from '{location}'. {location_setting} must be one of: {', '.join(places)}.")
    if member_data_cleared and location != "us" and not location.startswith("us-"):
        raise ProviderNotConfigured(
            f"VEYE_GEMINI_MEMBER_DATA_CLEARED is on, and {location_setting} is '{location}'. Members' data is processed in the United States: use 'us'.")
    return GoogleBackend(VERTEX, model=model, project=project, location=location, timeout_seconds=timeout_seconds, **extra)


# ---- saying what went wrong ----------------------------------------------------------------

# Google's own tokens ("SERVICE_DISABLED"). Nothing else of an error is repeated.
_TOKEN = re.compile(r"^[A-Z][A-Z0-9_]{2,60}$")
_KEY_REASONS = {"API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED",
                "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED"}
_PERMISSION_HINTS = {
    "SERVICE_DISABLED": "The API is not enabled on the project.",
    "BILLING_DISABLED": "Billing is not enabled on the project.",
    "CONSUMER_SUSPENDED": "The project is suspended.",
    "USER_PROJECT_DENIED": "The identity may not use the project for quota (roles/serviceusage.serviceUsageConsumer).",
}


def _errors_details(exc: Exception) -> list[dict]:
    body = getattr(exc, "details", None)
    if isinstance(body, dict):
        inner = body.get("error", body)
        details = inner.get("details") if isinstance(inner, dict) else None
        if isinstance(details, list):
            return [item for item in details if isinstance(item, dict)]
    return []


def _reasons(details: list[dict]) -> list[str]:
    return [item["reason"] for item in details if isinstance(item.get("reason"), str) and _TOKEN.match(item["reason"])]


def _asked_to_wait(details: list[dict]) -> float | None:
    for item in details:
        delay = re.match(r"^(\d+(?:\.\d+)?)s$", str(item.get("retryDelay", "")))
        if delay:
            return float(delay.group(1))
    return None


def _a_day(details: list[dict]) -> bool:
    named = " ".join(f"{v.get('quotaId', '')} {v.get('quotaMetric', '')}" for item in details
                     for v in (item.get("violations") or []) if isinstance(v, dict))
    return "perday" in re.sub(r"[^a-z]", "", named.lower())


def _named(exc: Exception, *names: str) -> bool:
    """By name, so that no transport library has to be imported to be recognised."""
    return any(cls.__name__ in names for cls in type(exc).__mro__)


def explain(exc: Exception, backend: GoogleBackend) -> GoogleCallFailed | ProviderNotConfigured:
    """What an exception from the SDK, its transport or google-auth means here.
    Nothing of Google's own text is kept: it can quote what was sent."""
    if isinstance(exc, (GoogleCallFailed, ProviderNotConfigured)):
        return exc
    where = f"{backend.model} on {backend.label}"
    if _named(exc, "DefaultCredentialsError"):
        return NotAuthenticated(
            "There is no identity to use: Application Default Credentials were not found. On Cloud Run it is the service's own "
            "account; locally, 'gcloud auth application-default login --impersonate-service-account=...' and mount the file it writes. "
            "The Developer API key was not used instead.")
    if _named(exc, "RefreshError"):
        # Nobody answered is passing. An answer that was no is not.
        cause = exc.__cause__
        unanswered = cause is not None and _named(cause, "TransportError") and not any(hasattr(arg, "status") for arg in cause.args)
        if getattr(exc, "retryable", False) or unanswered:
            return Unreachable(f"The identity for {where} could not be refreshed just now.")
        return NotAuthenticated(
            f"The identity was found and Google would not accept it for {where}. Sign in again; when impersonating, the account needs "
            "roles/iam.serviceAccountTokenCreator on the service account. The Developer API key was not used instead.")
    if _named(exc, "TimeoutException", "Timeout", "TimeoutError"):
        return TimedOut(f"No answer from {where}, or no identity to ask it with, in the {backend.timeout_seconds:g} seconds allowed.")
    if _named(exc, "TransportError", "RequestException", "ConnectionError", "ConnectError"):
        return Unreachable(f"Could not reach {where}.")

    code = getattr(exc, "code", None)
    if not isinstance(code, int):
        return GoogleCallFailed(f"{type(exc).__name__} from {where}.")
    details = _errors_details(exc)
    reasons = _reasons(details)
    status = str(getattr(exc, "status", "") or "")
    said = f"({' '.join([str(code), *([status] if _TOKEN.match(status) else []), *reasons])})"

    if code == 401 or _KEY_REASONS.intersection(reasons) or (code == 400 and "api key" in str(getattr(exc, "message", "")).lower()):
        what = "VEYE_GEMINI_API_KEY is not a key Google accepts" if backend.is_developer else "Google did not accept the identity"
        return NotAuthenticated(f"{what} for {where} {said}.")
    if code in (402, 403):
        hint = next((_PERMISSION_HINTS[r] for r in reasons if r in _PERMISSION_HINTS), None)
        if hint is None:
            hint = ("Check that the key belongs to a project that may use this model." if backend.is_developer
                    else "The identity needs roles/aiplatform.user on the project.")
        return NotPermitted(f"Google refused {where} {said}. {hint}")
    if code == 404:
        return NotServed(f"Google does not serve {where} {said}. Check the model, and the place it is asked for in.")
    if code == 429:
        wait = _asked_to_wait(details)
        if _a_day(details) or (wait is not None and wait > 60):
            return QuotaExhausted(f"The quota for {where} is used up {said}.")
        return RateLimited(f"Too many requests at once for {where} {said}.", wait=wait)
    if code in (408, 504):
        return TimedOut(f"{where} did not answer in time {said}.")
    if code >= 500:
        return Unreachable(f"{where} is not available {said}.")
    if status == "FAILED_PRECONDITION":
        return NotPermitted(f"Google will not serve {where} from here {said}.")
    return Refused(f"Google refused the request to {where} {said}.")
