"""What Gemini is configured to be, and a few real requests to it, on purpose.

    python -m tests.live_gemini            says what is configured; sends nothing
    python -m tests.live_gemini --live     sends a dozen or so real requests

In the Docker stack, where the settings and the identity are:

    docker compose --env-file .env.local-docker -f compose.local.yaml exec api python -m tests.live_gemini --live

The requests carry synthetic people and synthetic documents and nothing else:
the conversation is the one test_gemini_end_to_end.py runs with doubles, in a
database and a folder made for it and deleted afterwards. What the API itself
uses is never opened. The number of requests is capped, and what they used and
what that comes to at Google's published price is printed. No credential is
printed, and nothing of one is.

It is not collected by pytest and no test imports it: a double is not a live
service, and a pass there is not a pass here.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

GENERATIONS, EMBEDDINGS = 10, 24


def _line(mark: str, what: str, detail: str = "") -> None:
    print(f"  {mark:<5} {what}{': ' + detail if detail else ''}", flush=True)


def _configured() -> tuple[object, object]:
    from app.core.config import settings
    from app.core.runtime import get_runtime

    runtime = get_runtime()
    try:
        sdk = importlib.metadata.version("google-genai")
    except importlib.metadata.PackageNotFoundError:
        sdk = "not installed"
    identity = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    print(f"environment {settings.environment}; google-genai {sdk}; "
          f"identity file {'mounted' if identity and os.path.isfile(identity) else 'not mounted'}")
    for name, described in (("language model", runtime.llm.describe()), ("embeddings", runtime.embeddings.describe())):
        print(f"{name}:")
        for key, value in described.items():
            print(f"    {key.replace('_', ' ')}: {value}")
    return settings, runtime


def _refuse(why: str) -> int:
    print(f"\nNothing was sent. {why}")
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tests.live_gemini", description="What Gemini is configured to be.")
    parser.add_argument("--live", action="store_true", help="send a few real requests, synthetic data only")
    parser.add_argument("--in-its-own-database", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.in_its_own_database:
        return _live()
    settings, runtime = _configured()
    unusable = [d["reason"] for d in (runtime.llm.describe(), runtime.embeddings.describe()) if not d["configured"]]
    if unusable:
        return _refuse(" ".join(dict.fromkeys(str(reason) for reason in unusable)))
    if not args.live:
        print("\nNothing was sent. Add --live to send a few real requests.")
        return 0
    if not settings.is_local:
        return _refuse("This is for somebody's own machine: a deployment has real members in it.")
    if runtime.llm.name != "gemini":
        return _refuse("VEYE_LLM_PROVIDER is not 'gemini', so there is no live model to ask. A double is not a live service.")
    sys.stdout.flush()
    with tempfile.TemporaryDirectory(prefix="veye-live-") as folder:
        own = {**os.environ, "VEYE_DATABASE_URL": f"sqlite:///{(Path(folder) / 'live.db').as_posix()}", "VEYE_LANGFUSE_ENABLED": "false",
               "VEYE_EMAIL_PROVIDER": "none", "VEYE_KNOWLEDGE_OBJECT_ROOT": str(Path(folder) / "knowledge"), "VEYE_MEDIA_OBJECT_ROOT": str(Path(folder) / "media")}
        code = subprocess.run([sys.executable, "-m", "tests.live_gemini", "--in-its-own-database"], env=own, cwd=Path(__file__).resolve().parents[1]).returncode
        shutil.rmtree(folder, ignore_errors=True)
    return code


def _live() -> int:
    from app.companion.providers.google_backend import CallBudget, GoogleCallFailed, endpoint
    from app.companion.providers.llm import DataClassification, LLMMessage, LLMRequest, ProviderFailed, ProviderNotConfigured
    from app.core.config import reveal, settings
    from app.core.runtime import configure_runtime, get_runtime
    from app.db import registry  # noqa: F401
    from app.db.base import Base
    from app.db.session import SessionLocal, engine
    from app.knowledge.service import KnowledgeError

    assert settings.database_url.startswith("sqlite:///") and "veye-live-" in settings.database_url, "only ever in a database of its own"
    runtime = get_runtime()
    llm, embeddings = runtime.llm, runtime.embeddings
    llm.backend.budget = CallBudget(GENERATIONS)
    outside = embeddings.name == "google"
    if outside:
        embeddings.backend.budget = CallBudget(EMBEDDINGS)
    Base.metadata.create_all(engine)
    ok = True
    print(f"\nReal requests to {endpoint(llm.backend.kind, llm.backend.location)}"
          + (f" and {endpoint(embeddings.backend.kind, embeddings.backend.location)}" if outside else "") + "; synthetic data only.")

    # Asked the way it is used: that a model is listed is not that this identity
    # may use it here.
    print("available:")
    try:
        said = llm.complete(LLMRequest(system="Answer with one word.", messages=(LLMMessage("user", "Are you there?"),), max_tokens=16,
                                       client_content=False, classification=DataClassification.GENERAL))
        _line("ok", llm.model, f"\"{said.text[:40]}\" {said.input_tokens} in, {said.output_tokens} out (of which {said.thinking_tokens} thinking), {said.latency_ms} ms")
    except (ProviderFailed, ProviderNotConfigured) as exc:
        ok = False
        _line("FAIL", llm.model, f"{exc.category}. {exc}")
    if outside:
        ok = _meaning(embeddings) and ok
    if not ok:
        print("\nFAILED.")
        return 1

    from tests import gemini_scenarios as scenarios
    from app.companion.providers.gemini import GeminiLLMProvider

    @contextmanager
    def unavailable():
        hurried = GeminiLLMProvider(backend=llm.backend.kind, project=settings.gcp_project or "", location=settings.gcp_location, model=settings.gemini_model,
                                    api_key=reveal(settings.gemini_api_key), local=True, timeout_seconds=0.002, budget=CallBudget(2))
        configure_runtime(llm=hurried)
        yield

    print("conversation:")
    heard = scenarios.Heard(llm)
    try:
        with SessionLocal() as db:
            people = scenarios.prepare(db, stamp=f"live{int(time.time())}")
            steps = scenarios.run(db, people, heard, backend=llm.backend.kind, unavailable=unavailable)
    except (GoogleCallFailed, KnowledgeError, ProviderNotConfigured) as exc:
        _line("FAIL", "stopped", f"{getattr(exc, 'category', type(exc).__name__)}. {exc}")
        print("\nFAILED.")
        return 1
    for step in steps:
        ok = ok and step.ok
        _line("ok" if step.ok else "FAIL", step.name, "; ".join(step.wrong))
        if step.response is not None:
            r = step.response
            print(f"          {r.input_tokens} in, {r.output_tokens} out (of which {r.thinking_tokens} thinking), {r.latency_ms} ms, finish {r.finish_reason}, tries {r.attempts}")
        print(f"          \"{step.reply[:260]}\"")

    print("used:")
    total = 0.0
    for name, provider in (("model", llm), *([("embeddings", embeddings)] if outside else [])):
        shown = provider.describe()
        cost = shown["estimated_cost_usd"]
        total += cost or 0.0
        print(f"    {name}: {shown['calls']} answered calls, {shown['tokens_in']} tokens in, {shown['tokens_out']} out, "
              + (f"about ${cost:.6f}" if cost is not None else "cost not known (tokens are not reported through this door)"))
    print(f"    in all about ${total:.6f} of what was reported, at Google's published price of 25 Nov 2026")
    print("\nPASSED, live." if ok else "\nFAILED.")
    return 0 if ok else 1


def _meaning(embeddings) -> bool:
    """Three real vectors: are they the right width, and do they mean anything?"""
    from app.companion.providers.embeddings import cosine_similarity
    from app.companion.providers.llm import DataClassification, ProviderFailed, ProviderNotConfigured

    general = DataClassification.GENERAL
    try:
        [passage] = embeddings.embed(["The Health Number runs from 1 to 10 and lower is better."], purpose="document", classification=general)
        near, far = embeddings.embed(["Is a low Health Number good?", "How do I change my password?"], purpose="query", classification=general)
    except (ProviderFailed, ProviderNotConfigured) as exc:
        _line("FAIL", embeddings.model, f"{exc.category}. {exc}")
        return False
    close, distant = cosine_similarity(passage, near), cosine_similarity(passage, far)
    right = len(passage) == embeddings.dimensions and abs(sum(v * v for v in passage) - 1) < 1e-6 and close > distant
    _line("ok" if right else "FAIL", embeddings.model, f"{len(passage)} dimensions, unit length; a related question {close:.3f}, an unrelated one {distant:.3f}")
    return right


if __name__ == "__main__":
    sys.exit(main())
