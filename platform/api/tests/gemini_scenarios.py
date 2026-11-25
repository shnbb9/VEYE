"""One conversation with Sprout over Gemini, whichever of Google's doors it
goes through: synthetic members, synthetic knowledge, and a check after every
step of what was sent, what was said and what was kept.

Run with doubles by test_gemini_end_to_end.py, every time; and against the real
service, on purpose and a few calls at a time, by `python -m tests.live_gemini`.
The steps are the same. What a double proves is VEYE's half of it.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.assessments.repository import record_health_number_attempt
from app.assessments.schemas import HealthNumberAnswers
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal
from app.auth.provider import principal_for
from app.auth.service import AuthService, SignUpInput
from app.companion.models import CompanionMessage
from app.companion.providers.llm import DataClassification, LLMProvider, LLMRequest, LLMResponse
from app.companion.service import CompanionReply, CompanionService
from app.core.config import settings
from app.core.runtime import configure_runtime, get_runtime
from app.knowledge.service import KnowledgeService
from app.notifications.email import NoEmailProvider
from app.notifications.service import NotificationService
from app.observability.models import AiTraceEvent
from app.sprout_permission.service import SproutPermissionService
from app.sprout_permission.terms import current_terms

ANSWERS = {
    "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"], "activity": "Moderate (I exercise 1-3 times a week)",
    "meditate": "yes", "tired": "no", "gainWeight": "no", "abdomenWeight": "no", "sleepEnough": "yes", "sleepWell": "yes",
    "sleepHours": 7, "diet": "No preference", "source": "Friends or Family",
}
APPROVED = "# Reading the Health Number\n\nThe Health Number runs from 1 to 10. Lower is better, and a result is compared only with the same person's earlier ones.\n"
# In the knowledge base and not approved for anybody to be told.
CANARY = "seven quiet mornings"
NOT_APPROVED = f"# The moonflower rule\n\nThe moonflower rule says that a Health Number is halved after {CANARY}.\n"

SUPPORTED = "What does the Health Number scale mean?"
PERSONAL = "Explain what my Health Number means"
UNSUPPORTED = "Who won the football world cup in 1998?"
RESTRICTED = "What does the moonflower rule say about the Health Number?"


class Heard:
    """A provider, and what was put in front of it."""

    def __init__(self, provider: LLMProvider) -> None:
        self.provider, self.requests, self.responses = provider, [], []

    name = property(lambda self: self.provider.name)
    model = property(lambda self: self.provider.model)

    def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        response = self.provider.complete(request)
        self.responses.append(response)
        return response

    def describe(self) -> dict[str, object]:
        return self.provider.describe()


@dataclass
class Step:
    name: str
    wrong: list[str]
    reply: str = ""
    response: LLMResponse | None = None

    @property
    def ok(self) -> bool:
        return not self.wrong


@dataclass
class People:
    synthetic: CurrentPrincipal
    real: CurrentPrincipal


def prepare(db: Session, *, stamp: str) -> People:
    """A synthetic member with a result and their Sprout choice on, somebody
    who is not known to be synthetic, and three short documents."""
    accounts = AuthService(db, get_runtime().auth_provider, NotificationService(db, NoEmailProvider()), settings)

    def account(name: str, *, synthetic: bool) -> UserAccount:
        return accounts.create_member_account(
            SignUpInput(first_name=name, last_name="Demo", email=f"{name.lower()}.{stamp}@demo.veye.test", password="correct-horse-battery"),
            synthetic=synthetic, email_verified=True)

    wren, real = account("Wren", synthetic=True), account("Robin", synthetic=False)
    record_health_number_attempt(db, wren.member_id, HealthNumberAnswers(**ANSWERS))
    SproutPermissionService(db).grant(wren.member_id, by_user_id=wren.id, by_name="Wren Demo", terms=current_terms())
    knowledge = KnowledgeService(db, get_runtime().object_store, get_runtime().embeddings)
    for title, scope, words, approved in (("Reading the Health Number", "health_number", APPROVED, True), ("The moonflower rule", "health_number", NOT_APPROVED, False),
                                          ("Signing in", "help", "# Signing in\n\nUse the show and hide control to check your password.\n", True)):
        source = knowledge.create_source(title=title, type="VEYE educational document", scope_key=scope, synthetic=True)
        knowledge.attach_document(source, filename="note.md", content_type="text/markdown", data=words.encode(), synthetic=True)
        knowledge.activate(source, approved_by="synthetic")
        if not approved:
            knowledge.deactivate(source)
    db.commit()
    return People(principal_for(wren, None, portal="member"), principal_for(real, None, portal="member"))


def converse(db: Session, principal: CurrentPrincipal, message: str) -> CompanionReply:
    reply = CompanionService(db, get_runtime(), NotificationService(db, NoEmailProvider())).ask(principal, message)
    db.commit()
    return reply


def kept(db: Session, reply: CompanionReply) -> tuple[CompanionMessage, dict]:
    message = db.get(CompanionMessage, reply.reply_message_id)
    trace = db.query(AiTraceEvent).filter(AiTraceEvent.trace_id == message.trace_id).one()
    return message, trace.payload


def run(db: Session, people: People, heard: Heard, *, backend: str, unavailable) -> list[Step]:
    """`unavailable`: a context in which the model cannot be reached."""
    steps: list[Step] = []
    configure_runtime(llm=heard)

    def step(name: str, message: str, *, who: CurrentPrincipal = people.synthetic, asked: bool = True) -> tuple[Step, CompanionReply, LLMRequest | None]:
        before = len(heard.requests), len(heard.responses)
        reply = converse(db, who, message)
        now = Step(name, [], reply.reply, heard.responses[-1] if len(heard.responses) > before[1] else None)
        steps.append(now)
        if (len(heard.requests) > before[0]) is not asked:
            now.wrong.append("the model was asked" if not asked else "the model was never asked")
        return now, reply, heard.requests[-1] if asked and heard.requests else None

    def expect(now: Step, true: bool, otherwise: str) -> None:
        if not true:
            now.wrong.append(otherwise)

    # 1. A question approved knowledge answers.
    now, reply, request = step("a supported question, from an approved passage", SUPPORTED)
    expect(now, reply.outcome == "answered", f"outcome {reply.outcome}")
    expect(now, bool(reply.reply.strip()), "an empty reply")
    expect(now, request is not None and "Lower is better" in request.system, "the approved passage was not in front of the model")
    expect(now, request is not None and request.classification is DataClassification.SYNTHETIC_MEMBER, "classified as something else")
    expect(now, request is not None and request.client_content is False, "synthetic documents were taken for the client's")
    message, trace = kept(db, reply)
    expect(now, (message.provider, message.model) == ("gemini", heard.model), f"kept as {message.provider}/{message.model}")
    expect(now, trace["backend"] == backend, f"the trace says {trace['backend']}")
    expect(now, bool(message.input_tokens) and bool(message.output_tokens) and trace["estimated_cost_usd"] is not None, "what it used was not recorded")
    expect(now, [source["title"] for source in reply.sources][:1] == ["Reading the Health Number"], "not answered from the approved source")

    # 2. One it does not.
    now, reply, _ = step("an unsupported question never reaches the model", UNSUPPORTED, asked=False)
    expect(now, reply.outcome == "off_topic", f"outcome {reply.outcome}")

    # 3. Something in the knowledge base that is not approved.
    now, reply, request = step("what is not approved is neither sent nor said", RESTRICTED)
    expect(now, reply.outcome in ("answered", "prohibited"), f"outcome {reply.outcome}")
    expect(now, request is not None and CANARY not in request.system, "an inactive source was in front of the model")
    expect(now, CANARY not in reply.reply.lower(), "it was said")

    # 4. The member's own result, which they allowed.
    now, reply, request = step("a personal question, with the synthetic member's own summary", PERSONAL)
    expect(now, reply.outcome == "answered" and reply.health_context == "used", f"{reply.outcome}, health {reply.health_context}")
    expect(now, request is not None and "result(s); latest" in request.system, "the summary was not in front of the model")
    expect(now, request is not None and "Wren" not in request.system and "demo.veye.test" not in request.system, "a name or an address was")
    expect(now, kept(db, reply)[0].personal is True, "not kept as personal")

    # 5. Their choice, off.
    SproutPermissionService(db).revoke(people.synthetic.member_id, by_user_id=people.synthetic.user_id, by_name="Wren Demo")
    db.commit()
    now, reply, request = step("the same question with their choice off", PERSONAL)
    expect(now, reply.health_context == "off" and not reply.context_scopes, f"health {reply.health_context}")
    expect(now, request is not None and "result(s); latest" not in request.system, "the summary was in front of the model")

    # 6. Somebody who is not known to be synthetic.
    now, reply, _ = step("somebody who may be real: nothing is sent", SUPPORTED, who=people.real, asked=get_runtime().embeddings.name != "google")
    expect(now, reply.outcome == "unavailable", f"outcome {reply.outcome}")
    expect(now, now.response is None, "an answer came back")

    # 7. The service cannot be reached.
    with unavailable():
        configured = get_runtime().llm
        reply = converse(db, people.synthetic, SUPPORTED)
        now = Step("the service cannot be reached", [], reply.reply)
        steps.append(now)
        expect(now, configured is not None and reply.outcome == "unavailable", f"outcome {reply.outcome}")
        message, trace = kept(db, reply)
        expect(now, message.outcome == "unavailable" and str(trace["error_category"]).startswith("provider_"), f"recorded as {trace['error_category']}")
    configure_runtime(llm=heard)
    return steps
