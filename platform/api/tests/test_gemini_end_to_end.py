"""The whole of Sprout's pipeline over Gemini, through each door, with Google's
half a double. The same steps run against the real service with
`python -m tests.live_gemini`; a pass here is not a live one."""

from __future__ import annotations

from contextlib import contextmanager
from uuid import uuid4

import pytest

from app.companion.models import CompanionMessage, CompanionMessageSource
from app.companion.providers.embeddings import GoogleEmbeddingProvider, HashingEmbeddingProvider
from app.companion.providers.gemini import GeminiLLMProvider
from app.companion.providers.google_backend import BACKENDS, CallBudget
from app.companion.providers.llm import MockLLMProvider
from app.companion.service import CompanionService
from app.core.runtime import configure_runtime, get_runtime, reset_runtime
from app.db.session import SessionLocal
from app.knowledge.service import KnowledgeService
from app.notifications.email import NoEmailProvider
from app.notifications.service import NotificationService
from app.observability.models import AiTraceEvent
from tests import gemini_scenarios as scenarios
from tests.gemini_scenarios import Heard


class Google:
    """generate_content and embed_content, as the SDK answers them."""

    def __init__(self):
        self.models, self.local, self.generated, self.embedded, self.down = self, HashingEmbeddingProvider(256), [], [], False

    def generate_content(self, *, model, contents, config):
        if self.down:
            raise type("APIError", (Exception,), {"code": 503, "status": "UNAVAILABLE"})("down")
        self.generated.append((contents, config))
        usage = type("U", (), {"prompt_token_count": 420, "candidates_token_count": 40, "thoughts_token_count": 90})()
        return type("R", (), {"text": "Hey {{MEMBER_FIRST_NAME}}, lower is better on that scale.", "usage_metadata": usage,
                              "candidates": [type("C", (), {"finish_reason": "STOP"})()], "prompt_feedback": None})()

    def embed_content(self, *, model, contents, config):
        self.embedded.append(list(contents))
        return type("R", (), {"embeddings": [type("E", (), {"values": self.local._embed_one(t)[::-1], "statistics": None})() for t in contents]})()


@contextmanager
def down(google):
    google.down = True
    try:
        yield
    finally:
        google.down = False


def providers(backend: str, google: Google):
    shared = dict(backend=backend, project="veye-demo", api_key="k", local=True, client=google, budget=CallBudget(200), sleep=lambda _: None)
    return GeminiLLMProvider(**shared), GoogleEmbeddingProvider(dimensions=256, **shared)


@pytest.mark.parametrize("embeddings", ["hashing", "google"])
@pytest.mark.parametrize("backend", BACKENDS)
def test_a_conversation_through_each_door(client, backend, embeddings):
    google = Google()
    llm, embedder = providers(backend, google)
    if embeddings == "google":
        configure_runtime(embeddings=embedder)
    heard = Heard(llm)
    with SessionLocal() as db:
        people = scenarios.prepare(db, stamp=f"{backend}-{embeddings}")
        steps = scenarios.run(db, people, heard, backend=backend, unavailable=lambda: down(google))
        failed = db.query(AiTraceEvent).order_by(AiTraceEvent.created_at.desc()).first()
        assert (failed.error_category, failed.provider, failed.model) == ("provider_unavailable", "gemini", "gemini-3.8-flash")
    assert {step.name: step.wrong for step in steps if not step.ok} == {}
    assert len(steps) == 7
    described = llm.describe()
    assert described["calls"] == 4 and described["tokens_out"] == 4 * 130, "the four that were answered, thinking included"
    if embeddings == "google":
        # Three short documents, then the member's questions; nothing of
        # anybody who might be real.
        assert sum(len(sent) for sent in google.embedded) == 3 + 5


def test_changing_the_provider_changes_nothing_that_was_kept(client):
    """Developer, Vertex, and back to the mock: one conversation, every turn of
    it still there, and each says what wrote it."""
    with SessionLocal() as db:
        people = scenarios.prepare(db, stamp="switching")
        conversation = None
        for backend in BACKENDS:
            llm, _ = providers(backend, Google())
            configure_runtime(llm=llm)
            reply = scenarios.converse(db, people.synthetic, scenarios.SUPPORTED)
            assert reply.outcome == "answered" and conversation in (None, reply.conversation_id)
            conversation = reply.conversation_id
        model = MockLLMProvider()
        configure_runtime(llm=model)
        assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).conversation_id == conversation
        turns = [m.content for m in model.last_request.messages]
        assert turns.count(scenarios.SUPPORTED) == 3 and len(turns) == 5, "the earlier turns came along"
        wrote = [m.provider for m in db.query(CompanionMessage).filter(CompanionMessage.role == "sprout").order_by(CompanionMessage.created_at)]
        assert wrote == ["gemini", "gemini", "mock"]
        traces = [t.payload["backend"] for t in db.query(AiTraceEvent).order_by(AiTraceEvent.created_at)]
        assert traces == ["developer", "vertex", None]


def test_what_an_earlier_reply_quoted_does_not_leave_through_a_developer_key(client):
    """The mock repeats a passage word for word. So the client's document is in
    the conversation, where it is not a passage any more."""
    words = "Only the client has written that cardamom counts twice."
    google = Google()
    llm, _ = providers("developer", google)
    with SessionLocal() as db:
        people = scenarios.prepare(db, stamp="quoted")
        knowledge = KnowledgeService(db, get_runtime().object_store, get_runtime().embeddings)
        # Searched for the first question and not for the second.
        theirs = knowledge.create_source(title="Theirs", type="VEYE educational document", scope_key="companion", synthetic=False)
        knowledge.attach_document(theirs, filename="n.md", content_type="text/markdown", data=f"# Signing in\n\n{words} Help with signing in and passwords.\n".encode())
        knowledge.activate(theirs, approved_by="test")
        db.commit()
        configure_runtime(llm=MockLLMProvider())
        first = scenarios.converse(db, people.synthetic, "How do I change my password?")
        assert words in first.reply, "the stand-in quoted it"
        configure_runtime(llm=llm)
        refused = scenarios.converse(db, people.synthetic, scenarios.SUPPORTED)     # answered from a demonstration
        assert refused.outcome == "unavailable" and google.generated == []
        assert db.query(AiTraceEvent).order_by(AiTraceEvent.created_at.desc()).first().error_category == "client_content_not_allowed"
        # Vertex may be given it; and a conversation without it goes on.
        vertex, _ = providers("vertex", google)
        configure_runtime(llm=vertex)
        assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).outcome == "answered"
        assert words in str(google.generated[-1])
        # Long after: the reply that quoted it no longer fits in a prompt, and
        # the ones written with it in front of them do.
        for _ in range(4):
            assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).outcome == "answered"
        configure_runtime(llm=llm)
        before = len(google.generated)
        assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).outcome == "unavailable" and len(google.generated) == before
        CompanionService(db, get_runtime(), NotificationService(db, NoEmailProvider())).clear_conversation(people.synthetic)
        assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).outcome == "answered"
        assert words not in str(google.generated[-1])
        # A question that meets it is refused; the ones after it, which do not,
        # are not: what was said instead were fixed words.
        assert scenarios.converse(db, people.synthetic, "How do I change my password?").outcome == "unavailable"
        assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).outcome == "answered"
        # And when a source is not known any more, nor is whose it was.
        db.query(CompanionMessageSource).update({"source_id": uuid4()})
        db.commit()
        before = len(google.generated)
        assert scenarios.converse(db, people.synthetic, "What are the assessments for?").outcome == "unavailable" and len(google.generated) == before


def test_an_answer_that_was_not_one_is_on_the_bill_all_the_same(client):
    google = Google()
    llm, _ = providers("vertex", google)
    real = google.generate_content

    def cut(**kwargs):
        answer = real(**kwargs)
        answer.candidates[0].finish_reason = "MAX_TOKENS"
        return answer

    google.generate_content = cut
    with SessionLocal() as db:
        people = scenarios.prepare(db, stamp="bill")
        configure_runtime(llm=llm)
        reply = scenarios.converse(db, people.synthetic, scenarios.SUPPORTED)
        assert reply.outcome == "unavailable" and reply.reply.startswith("Sprout could not reach its language model")
        trace = db.query(AiTraceEvent).order_by(AiTraceEvent.created_at.desc()).first()
        assert (trace.error_category, trace.input_tokens, trace.output_tokens) == ("provider_cut_short", 420, 130)
        assert trace.payload["backend"] == "vertex" and trace.payload["thinking_tokens"] == 90 and trace.payload["estimated_cost_usd"] > 0


def test_a_member_is_not_told_to_try_again_when_it_will_not_help(client):
    """Not cleared, not connected, not indexed: it is the same in a moment."""
    for backend, embeddings in (("vertex", "hashing"), ("vertex", "google"), ("developer", "google")):
        llm, embedder = providers(backend, Google())
        with SessionLocal() as db:
            configure_runtime(llm=MockLLMProvider(), **({"embeddings": embedder} if embeddings == "google" else {}))
            people = scenarios.prepare(db, stamp=f"real{backend}{embeddings}")
            configure_runtime(llm=llm)
            reply = scenarios.converse(db, people.real, scenarios.SUPPORTED)
            assert reply.outcome == "unavailable" and reply.reply.startswith("Sprout is not connected to a language model"), (backend, embeddings)
            reset_runtime()


def test_the_connection_to_the_database_is_not_held_while_google_is_asked(client, monkeypatch):
    """Both calls can take half a minute. What was said is saved first, so the
    next message, and an urgent one most of all, waits for neither."""
    google = Google()
    llm, embedder = providers("vertex", google)
    configure_runtime(embeddings=embedder)
    with SessionLocal() as db:
        people = scenarios.prepare(db, stamp="held")
        configure_runtime(llm=llm)
        held: list[tuple[str, bool]] = []
        for name in ("generate_content", "embed_content"):
            real = getattr(google, name)

            def watched(_name=name, _real=real, **kwargs):
                held.append((_name, db.in_transaction()))
                return _real(**kwargs)

            monkeypatch.setattr(google, name, watched)
        assert scenarios.converse(db, people.synthetic, scenarios.SUPPORTED).outcome == "answered"
    assert held == [("embed_content", False), ("generate_content", False)]
    assert get_runtime().llm is llm
