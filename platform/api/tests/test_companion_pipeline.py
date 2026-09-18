"""Sprout pipeline: policy gate, approved retrieval, minimum-necessary member
context, outbound privacy filter, personalization inside the trust boundary,
output safety, provenance, feedback and masked telemetry."""

import os
import re

import pytest
from fastapi.testclient import TestClient

from app.companion.context import MemberContext, MemberContextService, UnavailableSummary
from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN, substitute
from app.companion.policy import OUTCOME_ALLOW, PolicyEngine, default_policy
from app.companion.privacy import OutboundPrivacyFilter, PrivacyViolation, known_identifiers_for
from app.companion.providers.llm import LLMMessage, LLMRequest, MockLLMProvider, UnconfiguredLLMProvider
from app.companion.safety import OutputSafety
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.main import app
from app.observability.masking import KnownIdentifiers, contains_identifier, mask_payload
from app.observability.telemetry import InMemoryTraceExporter, TelemetryRecorder
from app.seed.knowledge import seed_knowledge
from tests.conftest import sign_up

ADITYA = {"email": "aditya.demo@demo.veye.test", "first_name": "Aditya", "last_name": "Demo"}


def _answers(**overrides):
    values = {
        "goals": ["Lose Body Fat"], "plans": ["No other plans"], "activity": "Light (I work, I walk some)", "meditate": "no",
        "tired": "yes", "gainWeight": "yes", "abdomenWeight": "yes", "sleepEnough": "no", "sleepWell": "yes", "sleepHours": 6,
        "diet": "No preference", "source": "Friends or Family",
    }
    values.update(overrides)
    return values


@pytest.fixture
def memory_traces():
    """Route telemetry into memory (in addition to the database exporter) and
    capture prompt/response content so masking can be proven on the worst case."""
    exporter = InMemoryTraceExporter()
    runtime = get_runtime()
    recorder = TelemetryRecorder([*runtime.telemetry.exporters, exporter], pseudonym_key="test-pepper", environment="test",
                                 capture_content=True)
    configure_runtime(telemetry=recorder)
    return exporter


@pytest.fixture
def aditya(client, memory_traces):
    seed_knowledge()
    response = sign_up(client, **ADITYA)
    assert response.status_code == 201, response.text
    client.account = response.json()["account"]
    client.post("/api/v1/health-number/calculate", json={"answers": _answers()})
    client.post("/api/v1/health-number/calculate", json={"answers": _answers(tired="no", sleepEnough="yes")})
    client.post("/api/v1/blood-markers/calculate", json={"input": {"tg": 95, "hdl": 60, "insulin": 5, "glucose": 85, "aa": 9, "epa": 4, "hba1c": 5.0}})
    return client


# ---- policy ------------------------------------------------------------------------------------------
def test_policy_allow_prohibit_escalate_and_off_topic():
    engine = PolicyEngine(default_policy())
    allowed = engine.evaluate("Explain what my Health Number means in plain language")
    assert allowed.outcome == OUTCOME_ALLOW and allowed.category == "assessments"
    assert "health_number" in allowed.retrieval_scopes and "health_number_summary" in allowed.member_data_scopes

    prohibited = engine.evaluate("How much EPA should I take each day?")
    assert prohibited.outcome == "prohibit" and prohibited.category == "supplement_amounts"

    escalated = engine.evaluate("My doctor said I might need medication for my blood sugar, what do you think?")
    assert escalated.outcome == "escalate" and escalated.category == "medical"

    wellbeing = engine.evaluate("I haven't slept properly in a week and I feel like nothing is working.")
    assert wellbeing.outcome == "escalate" and wellbeing.category == "wellbeing_concern"

    off_topic = engine.evaluate("What do you think about the new phone that came out?")
    assert off_topic.outcome == "off_topic"

    # Escalation wins over prohibition when both match; a switched-off topic is prohibited.
    both = engine.evaluate("How much of my medication dose should I take?")
    assert both.outcome == "escalate"
    policy = default_policy()
    policy["topics"][0]["allowed"] = False
    assert PolicyEngine(policy).evaluate("What should I eat for lunch today?").outcome == "prohibit"


# ---- member context + privacy -----------------------------------------------------------------------------
def test_member_context_is_minimum_necessary_and_identifier_free(aditya):
    with SessionLocal() as db:
        from app.auth.models import UserAccount
        from app.auth.provider import principal_for

        user = db.query(UserAccount).filter(UserAccount.email == ADITYA["email"]).one()
        principal = principal_for(user, None)
        decision = PolicyEngine().evaluate("Explain my Health Number and my blood markers")
        context = MemberContextService(db).build(principal, decision.member_data_scopes, decision)

        assert set(context.scopes) == {"health_number_summary", "body_composition_summary", "blood_marker_summary"}
        assert context.health_number.attempts == 2 and context.health_number.trend == "improved"
        assert isinstance(context.body_composition, UnavailableSummary)
        assert context.blood_markers.recommendation_state == "ok"
        assert context.mood is None and context.food_pattern is None  # not requested by this topic

        # The structural allowlist: identifiers have no field to live in.
        dumped = context.model_dump_json()
        assert not contains_identifier(dumped, known_identifiers_for(principal))
        assert "Aditya" not in dumped and "demo.veye.test" not in dumped and str(principal.member_id) not in dumped
        with pytest.raises(Exception):
            MemberContext(scopes=(), email="leak@demo.veye.test")  # extra="forbid"

        # A topic that permits no member data gets no member data.
        none = MemberContextService(db).build(principal, ("health_number_summary",), PolicyEngine().evaluate("How do I sign in to Veye?"))
        assert none.scopes == () and none.health_number is None


def test_outbound_filter_strips_direct_identifiers_from_free_text():
    known = KnownIdentifiers(names=("Aditya", "Demo", "Aditya Demo"), emails=("aditya.demo@demo.veye.test",),
                             ids=("6f1c0e2a-1111-4222-8333-444455556666",))
    request = LLMRequest(system="## MEMBER CONTEXT\n- health_number: 4.5", messages=(
        LLMMessage("user", "Hi, I am Aditya Demo, my email is aditya.demo@demo.veye.test and my id is "
                           "6f1c0e2a-1111-4222-8333-444455556666, call me on (555) 123-4567 about my meal plan"),))
    filtered, report = OutboundPrivacyFilter(known).filter_request(request)
    content = filtered.messages[0].content
    assert "Aditya" not in content and "demo.veye.test" not in content and "6f1c0e2a" not in content and "123-4567" not in content
    assert "meal plan" in content
    # name x2 + email + id are known identifiers; the phone is caught by the generic detector.
    assert report.redactions["identifier"] >= 3 and report.redactions["phone"] == 1 and report.total >= 4
    assert not contains_identifier(content, known)

    # A detector that misses something cannot let the request through: the final assertion refuses it.
    class NoopDetector:
        name = "noop"

        def find(self, text):
            return []

    with pytest.raises(PrivacyViolation):
        OutboundPrivacyFilter(known, detectors=[NoopDetector()]).filter_request(request)


# ---- the full pipeline through the API ----------------------------------------------------------------------
def test_allowed_question_is_answered_from_approved_knowledge_with_personalization(aditya, memory_traces):
    response = aditya.post("/api/v1/companion/messages", json={"message": "Explain what my Health Number means in plain language"})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["outcome"] == "answered" and body["policy_outcome"] == "allow" and body["policy_category"] == "assessments"
    assert body["provider"] == "mock" and body["personalized"] is True
    assert body["reply"].startswith("Hey Aditya,")
    assert MEMBER_FIRST_NAME_TOKEN not in body["reply"]
    assert body["sources"] and body["sources"][0]["title"] == "Health Number guide"
    assert {"source_id", "document_id", "chunk_id", "source_version", "score"} <= set(body["sources"][0])
    assert "health_number_summary" in body["context_scopes"]
    assert body["safety_result"] == "pass" and body["trace_id"]

    # What actually left the trust boundary: the token, never the name/email/ids.
    mock: MockLLMProvider = get_runtime().llm
    payload = mock.last_request.as_payload()
    flat = payload["system"] + " ".join(m["content"] for m in payload["messages"]) + " ".join(payload["metadata"].values())
    assert MEMBER_FIRST_NAME_TOKEN in flat
    assert "Aditya" not in flat and "Demo" not in flat and "demo.veye.test" not in flat
    assert aditya.account["member_id"] not in flat and aditya.account["id"] not in flat
    assert "## APPROVED KNOWLEDGE" in payload["system"] and "Health Number guide" in payload["system"]
    assert "- health_number:" in payload["system"] and "improved" in payload["system"]

    # Telemetry: masked, pseudonymous, with provenance — and no identifier even with content capture on.
    trace = memory_traces.payloads[-1]
    assert trace["trace_id"] == body["trace_id"]
    assert trace["member_ref"] != aditya.account["member_id"] and re.fullmatch(r"[0-9a-f]{16}", trace["member_ref"])
    assert trace["policy"] == {"outcome": "allow", "category": "assessments"}
    assert trace["retrieved_sources"][0]["source_id"] == body["sources"][0]["source_id"]
    assert trace["provider"] == "mock" and trace["safety_result"] == "pass"
    serialised = str(trace)
    for secret in ("Aditya", "Demo", "demo.veye.test", aditya.account["member_id"], aditya.account["id"]):
        assert secret not in serialised
    assert "content" in trace and trace["content"]["capture"] == "development-only"


def test_session_history_feedback_and_sources_persist(aditya, memory_traces):
    first = aditya.post("/api/v1/companion/messages", json={"message": "What should I eat for lunch today?"}).json()
    assert first["outcome"] == "answered"
    session = aditya.get("/api/v1/companion/session").json()
    assert session["enabled"] and session["name"] == "Sprout"
    assert session["welcome"].startswith("Welcome back")
    assert [m["role"] for m in session["conversation"]["messages"]] == ["member", "sprout"]
    assert session["conversation"]["messages"][1]["sources"] == first["sources"]
    assert len(session["quick_prompts"]) == 5

    feedback = aditya.post(f"/api/v1/companion/messages/{first['reply_message_id']}/feedback",
                           json={"rating": "not_helpful", "reason": "Not relevant", "comment": "I wanted a specific snack."})
    assert feedback.status_code == 200 and feedback.json()["rating"] == "not_helpful"
    assert memory_traces.payloads[-1]["feedback"] == "not_helpful"
    again = aditya.get("/api/v1/companion/session").json()
    assert again["conversation"]["messages"][1]["feedback"]["rating"] == "not_helpful"

    # Feedback on a member message or a foreign id is refused.
    assert aditya.post(f"/api/v1/companion/messages/{first['member_message_id']}/feedback", json={"rating": "helpful"}).status_code == 404

    cleared = aditya.post("/api/v1/companion/conversations/clear").json()
    assert cleared["message_count"] == 0 and cleared["id"] != first["conversation_id"]


def test_prohibited_and_off_topic_questions_never_reach_the_model(aditya):
    mock: MockLLMProvider = get_runtime().llm
    before = len(mock.requests)
    prohibited = aditya.post("/api/v1/companion/messages", json={"message": "How much EPA should I take each day?"}).json()
    assert prohibited["outcome"] == "prohibited" and prohibited["policy_category"] == "supplement_amounts"
    assert "needs your coach to confirm" in prohibited["reply"] and prohibited["sources"] == [] and prohibited["provider"] is None
    off = aditya.post("/api/v1/companion/messages", json={"message": "What do you think about the new phone that came out?"}).json()
    assert off["outcome"] == "off_topic" and off["reply"].startswith("That is outside what I can help with")
    assert len(mock.requests) == before


def test_escalation_flags_the_conversation_and_notifies_the_admin(aditya, admin_client, mailbox):
    before = len(mailbox.sent)
    response = aditya.post("/api/v1/companion/messages", json={"message": "I haven't slept properly in a week and I feel like nothing is working."}).json()
    assert response["outcome"] == "escalated" and response["policy_category"] == "wellbeing_concern"
    assert "handed this conversation" in response["reply"]
    escalation_mail = mailbox.sent[-1]
    assert len(mailbox.sent) == before + 1 and escalation_mail.to == "cara.hogue@demo.veye.test"
    assert "needs a person" in escalation_mail.subject
    assert "Aditya" not in escalation_mail.text and "slept" not in escalation_mail.text  # minimum necessary

    queue = admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()
    assert [c["id"] for c in queue] == [response["conversation_id"]]
    assert queue[0]["flagged"] and "Handed to a person" in queue[0]["flag_reason"]
    detail = admin_client.get(f"/api/v1/admin/companion/conversations/{response['conversation_id']}").json()
    assert detail["member"]["name"] == "Aditya Demo"
    assert detail["messages"][0]["policy_decision"]["outcome"] == "escalate"
    reviewed = admin_client.post(f"/api/v1/admin/companion/conversations/{response['conversation_id']}/review", json={"note": "Coach followed up."})
    assert reviewed.status_code == 200 and reviewed.json()["reviewed_by"] == "Cara Hogue"
    assert admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json() == []
    audit = admin_client.get("/api/v1/admin/companion/advanced/audit").json()
    assert audit[0]["action"] == "conversation.reviewed"


def test_member_b_cannot_use_member_a_conversation(aditya):
    mine = aditya.post("/api/v1/companion/messages", json={"message": "Explain my Health Number"}).json()
    with TestClient(app) as other:
        sign_up(other, email="maya.demo@demo.veye.test", first_name="Maya")
        stolen = other.post("/api/v1/companion/messages", json={"message": "Hi", "conversation_id": mine["conversation_id"]})
        assert stolen.status_code == 404
        assert other.post(f"/api/v1/companion/messages/{mine['reply_message_id']}/feedback", json={"rating": "helpful"}).status_code == 404
        # Maya's own context is Maya's: no saved results, so the prompt says so instead of borrowing Aditya's.
        reply = other.post("/api/v1/companion/messages", json={"message": "Explain my Health Number"}).json()
        assert reply["outcome"] == "answered" and reply["reply"].startswith("Hey Maya,")
        mock: MockLLMProvider = get_runtime().llm
        assert "no Health Number saved yet" in mock.last_request.system and "improved" not in mock.last_request.system


def test_unconfigured_provider_is_honest_not_fabricated(aditya):
    configure_runtime(llm=UnconfiguredLLMProvider("VEYE_GROQ_API_KEY is not set."))
    response = aditya.post("/api/v1/companion/messages", json={"message": "Explain my Health Number"}).json()
    assert response["outcome"] == "unavailable" and "not connected to a language model" in response["reply"]
    assert response["sources"]  # retrieval still ran and is recorded honestly


def test_companion_can_be_switched_off(aditya, admin_client):
    settings = admin_client.get("/api/v1/admin/companion/settings").json()
    payload = {k: settings[k] for k in ("enabled", "name", "welcome", "returning_welcome", "safe_response", "fallback",
                                        "escalation_response", "quick_prompts", "policy")}
    payload["enabled"] = False
    assert admin_client.put("/api/v1/admin/companion/settings", json=payload).status_code == 200
    assert aditya.post("/api/v1/companion/messages", json={"message": "Hello Sprout"}).status_code == 503


# ---- units -----------------------------------------------------------------------------------------------------
def test_output_safety_blocks_amounts_and_redacts_identifiers():
    safety = OutputSafety(safe_response="SAFE", fallback="FALLBACK", known=KnownIdentifiers(emails=("x@demo.veye.test",)))
    assert safety.check("Try 400 mg of magnesium tonight.").result == "blocked_dosage"
    assert safety.check("Take 3.5g of EPA/DHA daily.").text == "SAFE"
    assert safety.check("30g of protein has the same effect as new GLP1 drugs.").result == "pass"
    assert safety.check("").text == "FALLBACK"
    redacted = safety.check("Write to x@demo.veye.test for help.")
    assert redacted.result == "redacted_identifier" and "demo.veye.test" not in redacted.text


def test_personalization_only_replaces_known_tokens():
    result = substitute("Hey {{MEMBER_FIRST_NAME}}, your {{MEMBER_EMAIL}} and {{SOMETHING}} stay put.",
                        {"{{MEMBER_FIRST_NAME}}": "Aditya", "{{MEMBER_EMAIL}}": "leak@demo.veye.test"})
    assert result.text == "Hey Aditya, your {{MEMBER_EMAIL}} and {{SOMETHING}} stay put."
    assert result.substituted == ("{{MEMBER_FIRST_NAME}}",) and set(result.unknown_tokens) == {"{{MEMBER_EMAIL}}", "{{SOMETHING}}"}


def test_masking_function_drops_denied_keys_and_scrubs_strings():
    known = KnownIdentifiers(names=("Maya",), emails=("maya.demo@demo.veye.test",), ids=("11111111-2222-4333-8444-555555555555",))
    masked = mask_payload({
        "email": "maya.demo@demo.veye.test", "first_name": "Maya", "member_id": "11111111-2222-4333-8444-555555555555",
        "nested": {"phone": "555-000-1234", "note": "Maya wrote from maya.demo@demo.veye.test about 11111111-2222-4333-8444-555555555555 and 5551234567"},
        "scores": [0.9, "ok"], "kept": "a lower Health Number is better",
    }, known)
    assert set(masked) == {"nested", "scores", "kept"}
    # Known identifiers are redacted first (unlabelled); generic patterns catch the rest.
    assert masked["nested"] == {"note": "[REDACTED] wrote from [REDACTED] about [REDACTED] and [REDACTED:phone]"}
    stranger = mask_payload({"note": "Ping x@demo.veye.test or 22222222-2222-4333-8444-555555555555", "source_id": "33333333-2222-4333-8444-555555555555"})
    assert stranger == {"note": "Ping [REDACTED:email] or [REDACTED:id]", "source_id": "33333333-2222-4333-8444-555555555555"}
    assert masked["scores"] == [0.9, "ok"] and masked["kept"] == "a lower Health Number is better"


def test_langfuse_stays_disabled_without_configuration(client):
    runtime = get_runtime()
    assert runtime.langfuse_status == "disabled"
    assert [e.name for e in runtime.telemetry.exporters] == ["database"]


def test_langfuse_exporter_receives_only_masked_payload():
    from app.observability.langfuse_exporter import LangfuseTraceExporter, sdk_mask

    class FakeObservation:
        def __init__(self, log, **kwargs):
            self.log = log
            self.trace_id = "lf-trace-1"
            log.append(kwargs)

        def start_observation(self, **kwargs):
            return FakeObservation(self.log, **kwargs)

        def update(self, **kwargs):
            self.log.append({"update": kwargs})

        def end(self):
            self.log.append({"end": True})

    class FakeClient:
        def __init__(self):
            self.log = []
            self.scores = []

        def start_observation(self, **kwargs):
            return FakeObservation(self.log, **kwargs)

        def create_score(self, **kwargs):
            self.scores.append(kwargs)

        def flush(self):
            pass

    known = KnownIdentifiers(names=("Aditya",), emails=("aditya.demo@demo.veye.test",), ids=("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",))
    fake = FakeClient()
    recorder = TelemetryRecorder([LangfuseTraceExporter(fake)], pseudonym_key="pepper", environment="test", capture_content=True)
    from app.observability.telemetry import CompanionTrace

    trace = CompanionTrace(member_id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", conversation_id="bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                           message_id=None, policy_outcome="allow", policy_category="assessments", safety_result="pass",
                           provider="mock", model="veye-mock-1", latency_ms=12, input_tokens=100, output_tokens=40,
                           retrieved_sources=[{"source_id": "s1", "document_id": "d1", "chunk_id": "c1", "source_version": 1, "score": 0.8}],
                           prompt={"system": "Aditya is aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "messages": [{"role": "user", "content": "mail aditya.demo@demo.veye.test"}]},
                           response_text="Hey {{MEMBER_FIRST_NAME}}, lower is better.")
    recorder.record(trace, known)
    recorder.record_feedback(trace.trace_id, "helpful")
    exported = str(fake.log)
    for secret in ("Aditya", "demo.veye.test", "aaaaaaaa-bbbb", "bbbbbbbb-bbbb"):
        assert secret not in exported
    assert "sprout.turn" in exported and "sprout.generation" in exported and "[REDACTED" in exported
    assert fake.scores and fake.scores[0]["trace_id"] == "lf-trace-1" and fake.scores[0]["value"] == 1.0
    # The SDK-level hook applies the same masking a second time.
    assert sdk_mask(data={"email": "x@demo.veye.test", "note": "call 555-000-1234"}) == {"note": "call [REDACTED:phone]"}


@pytest.mark.skipif(not os.environ.get("VEYE_GROQ_API_KEY"), reason="Groq smoke test runs only when a development key is explicitly configured")
def test_groq_provider_smoke_synthetic_only():
    from app.companion.providers.llm import GroqLLMProvider

    provider = GroqLLMProvider(os.environ["VEYE_GROQ_API_KEY"], os.environ.get("VEYE_GROQ_MODEL", "llama-3.3-70b-versatile"))
    response = provider.complete(LLMRequest(system="You are Sprout, a concise assistant for a synthetic test. Reply in one sentence.",
                                            messages=(LLMMessage("user", "Say hello to {{MEMBER_FIRST_NAME}} and mention that a lower Health Number is better."),)))
    assert response.text and response.provider == "groq" and response.latency_ms >= 0
