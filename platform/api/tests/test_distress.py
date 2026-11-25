"""Is this person all right? What Sprout then does.

What the rules hear is `test_safety_sentences.py`. Here: no model is asked, the
words that come back, who is told and how often, and the same answer when the
model is down, Sprout is switched off, or the member is over their limit.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.admin.companion_routes import WITHHELD_REPLY
from app.companion import safety_copy, second_reading
from app.companion.distress import CHECK_IN, DISTRESS, FEELINGS, IMMINENT, MEDICAL, NONE, OTHER, RANK, SELF, SELF_HARM, UNCLEAR, UNSURE, Assessment, assess
from app.companion.models import CompanionConversation, CompanionMessage, CompanionPolicyDecision
from app.companion.providers.llm import MockLLMProvider, UnconfiguredLLMProvider
from app.companion.safety import OutputSafety
from app.companion.safety_copy import (
    DISTRESS_WORDS, NOT_WATCHED, PROGRAM, SAFETY_COPY_VERSION, STEADIER, STILL_HERE, SUPPORT, UNSURE_LINE, UNSURE_QUESTION, resources_for, urgent_words,
)
from app.core.rate_limit import LIMITS
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.main import app
from app.notifications.models import Notification, NotificationOutbox
from app.seed.knowledge import seed_knowledge
from tests.conftest import sign_up, turn_on_sprout
from tests.pg import pg_sessionmaker  # noqa: F401 - fixture
from tests.test_sprout_permission import Paused, _at_once, _pg_member, _principal

ASK = "/api/v1/companion/messages"

# ---- the words -----------------------------------------------------------------------------

def every_reply() -> list[str]:
    out = []
    for level in (CHECK_IN, SELF_HARM, MEDICAL, IMMINENT):
        for about in (SELF, OTHER, UNCLEAR):
            for past in (False, True):
                for harmed in (False, True):
                    out += [urgent_words(Assessment(level, about, past, harmed), marked=marked) for marked in (True, False)]
    out += [safety_copy.distress_words(Assessment(DISTRESS, about)) for about in (SELF, OTHER)]
    out += [STEADIER, STILL_HERE, SUPPORT, UNSURE_QUESTION, UNSURE_LINE, *safety_copy.ACKNOWLEDGE.values()]
    return out


def test_the_words_never_claim_what_is_not_so():
    for words in every_reply():
        low = words.lower()
        assert not re.search(r"\d", words), f"a number nobody checked: {words}"
        for claim in ("24/7", "around the clock" if "nobody is watching" not in low and "doesn't watch" not in low else "\0", "licensed", "i diagnose",
                      "you have depression", "you are suicidal", "someone is watching", "right away we", "a person will contact you", "hipaa", "guarantee"):
            assert claim not in low, f"{claim!r} in {words}"
        for dose in ("mg", "tablet a", "make them vomit", "induce", "drink water", "take another"):
            assert dose not in low, f"{dose!r} in {words}"


def test_urgent_words_say_what_they_must():
    for level in (SELF_HARM, IMMINENT, CHECK_IN, MEDICAL):
        words = urgent_words(Assessment(level), marked=True)
        assert "local emergency services" in words and "I'm a program" in words
        assert "nobody is watching it around the clock" in words, "marked for the team is not the same as somebody is here"
        assert "marked this conversation" not in urgent_words(Assessment(level), marked=False), "only said when it was"
    assert urgent_words(Assessment(IMMINENT), marked=True).index("emergency services now") < 160, "first, not at the end"
    assert "someone you trust" in urgent_words(Assessment(SELF_HARM), marked=True)
    assert "poison information service" in urgent_words(Assessment(MEDICAL), marked=True)


def test_ordinary_feelings_are_not_answered_with_emergencies():
    for words in (SUPPORT, safety_copy.DISTRESS_WORDS, *safety_copy.ACKNOWLEDGE.values()):
        assert "emergency" not in words.lower() and "crisis" not in words.lower()


def test_a_number_is_given_only_for_a_country_that_is_known_and_checked():
    assert resources_for(None) == resources_for("") == resources_for("IN") == resources_for("somewhere") == ""
    us = resources_for("us")
    assert "988" in us and "911" in us
    assert "988" not in urgent_words(Assessment(SELF_HARM), marked=True)
    assert "988" in urgent_words(Assessment(SELF_HARM), marked=True, country="US")


@pytest.mark.parametrize("text", ["Call 911 now.", "Please call the crisis line at 1-800-555-0100.", "Text HOME to 741741.", "Dial 112.",
                                  "I am a licensed therapist and can help.", "Someone is watching this chat.", "We offer 24/7 support.", "Help is on its way."])
def test_a_model_may_not_invent_help(text):
    checked = OutputSafety(safe_response="SAFE", fallback="FALLBACK").check(text)
    assert (checked.result, checked.text) == ("blocked_help_claim", "FALLBACK")


@pytest.mark.parametrize("text", ["I'm not a doctor, but a doctor can help.", "Try to reach 150 minutes of walking each week.", "In the text, aim for 100 grams.",
                                  "A person from the team will read it.", "You can call your doctor.", "Contact your local emergency services."])
def test_ordinary_replies_are_not_caught_by_that(text):
    assert OutputSafety(safe_response="SAFE", fallback="FALLBACK").check(text).result == "pass"


# ---- what Sprout does ---------------------------------------------------------------------------

@pytest.fixture
def member(client):
    seed_knowledge()
    created = sign_up(client)
    assert created.status_code == 201
    client.account = created.json()["account"]
    return client


def ask(http, message, **extra):
    sent = http.post(ASK, json={"message": message, **extra})
    assert sent.status_code == 201, sent.text
    return sent.json()


@pytest.mark.parametrize("text,category,words", [
    ("I feel suicidal", "wellbeing_concern", "someone you trust"), ("I'm going to kill myself tonight", "wellbeing_concern", "local emergency services now"),
    ("I can't go on", "wellbeing_concern", "I want to be sure I understand you"), ("I took too many pills", "medical", "poison information service"),
    ("My friend is suicidal", "wellbeing_concern", "looking out for them"),
])
def test_somebody_at_risk_is_answered_at_once_from_fixed_words_and_marked(member, admin_client, text, category, words):
    mock: MockLLMProvider = get_runtime().llm
    body = ask(member, text)
    assert (body["outcome"], body["policy_outcome"], body["policy_category"]) == ("escalated", "escalate", category)
    assert words in body["reply"] and body["provider"] is None and body["sources"] == [] and len(mock.requests) == 0
    assert body["safety_result"] == SAFETY_COPY_VERSION, "which words they were given is kept with the reply"
    queue = admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()
    assert [c["id"] for c in queue] == [body["conversation_id"]] and "Handed to a person: possible" in queue[0]["flag_reason"] or "don't feel safe" in queue[0]["flag_reason"]


@pytest.mark.parametrize("text,outcome", [
    ("Is suicide a sin?", "safety"), ("I was suicidal years ago", "safety"), ("My mom died by suicide", "support"), ("I hate myself", "support"),
    ("I feel so sad", "support"), ("my husband is hitting me", "safety"),
])
def test_nobody_is_told_when_nobody_is_at_risk_now(member, admin_client, mailbox, text, outcome):
    before = len(mailbox.sent)
    body = ask(member, text)
    assert (body["outcome"], body["policy_outcome"]) == (outcome, "support")
    assert len(mailbox.sent) == before
    assert admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json() == []
    assert "marked this conversation" not in body["reply"] and "handed this conversation" not in body["reply"]


def test_a_hard_feeling_is_acknowledged_and_still_answered(member):
    body = ask(member, "I'm feeling a bit stressed today.")
    assert body["outcome"] == "answered" and body["safety_level"] == FEELINGS
    assert body["reply"].startswith("That sounds like a lot to carry today. ") and "Hey Aditya" in body["reply"]
    assert "emergency" not in body["reply"]
    off = ask(member, "I feel so lonely")
    assert off["outcome"] == "support" and SUPPORT in off["reply"] and "outside what I can help with" not in off["reply"]
    amount = ask(member, "I'm so stressed, how much magnesium should I take?")
    assert amount["outcome"] == "prohibited" and amount["reply"].startswith("That sounds like a lot") and "coach to confirm" in amount["reply"]


def test_a_denial_is_answered_like_any_other_message(member, admin_client):
    body = ask(member, "I'm not suicidal, what should I eat for lunch?")
    assert body["outcome"] == "answered" and body["safety_level"] is None
    assert admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json() == []


def test_what_the_approved_list_hands_over_is_still_handed_over_and_says_it_is_not_watched(member, admin_client):
    body = ask(member, "I haven't slept properly in a week and nothing is working")
    assert body["outcome"] == "escalated" and body["policy_category"] == "wellbeing_concern"
    assert "handed this conversation" in body["reply"] and NOT_WATCHED in body["reply"]
    medical = ask(member, "Should I change my medication?")
    assert medical["outcome"] == "escalated" and medical["policy_category"] == "medical"
    assert "handed this conversation" in medical["reply"] and NOT_WATCHED in medical["reply"]


def test_the_floor_under_the_rules_still_stands(member, monkeypatch):
    """If every rule above it missed it, the fixed list does not."""
    from app.companion import service

    monkeypatch.setattr(service, "assess", lambda text, **_: Assessment(NONE, residual=text.lower()))
    body = ask(member, "I want to end my life")
    assert body["outcome"] == "escalated" and "someone you trust" in body["reply"] and body["provider"] is None


# ---- it does not depend on anything that can be off --------------------------------------------------

@pytest.mark.parametrize("provider", ["down", "unconfigured"])
def test_the_model_being_unavailable_changes_nothing_for_somebody_at_risk(member, provider):
    class Down(MockLLMProvider):
        def complete(self, request):
            raise RuntimeError("no network")

    configure_runtime(llm=Down() if provider == "down" else UnconfiguredLLMProvider("no key"))
    assert "local emergency services" in ask(member, "I want to kill myself")["reply"]
    hard = ask(member, "I'm feeling a bit stressed today.")
    assert hard["outcome"] == "unavailable" and hard["reply"].startswith("That sounds like a lot") and SUPPORT in hard["reply"]


def test_sprout_switched_off_still_answers_somebody_at_risk_and_nobody_else(member, admin_client):
    settings = admin_client.get("/api/v1/admin/companion/settings").json()
    payload = {k: settings[k] for k in ("enabled", "name", "welcome", "returning_welcome", "safe_response", "fallback", "escalation_response", "quick_prompts", "policy")}
    assert admin_client.put("/api/v1/admin/companion/settings", json={**payload, "enabled": False}).status_code == 200
    assert member.post(ASK, json={"message": "Hello Sprout"}).status_code == 503
    assert member.post(ASK, json={"message": "I feel a bit sad"}).status_code == 503
    assert ask(member, "I feel suicidal")["outcome"] == "escalated"


def test_an_emptied_policy_still_answers_somebody_at_risk(member, admin_client):
    settings = admin_client.get("/api/v1/admin/companion/settings").json()
    payload = {k: settings[k] for k in ("enabled", "name", "welcome", "returning_welcome", "safe_response", "fallback", "escalation_response", "quick_prompts", "policy")}
    payload["policy"] = {**payload["policy"], "prohibited": []}
    assert admin_client.put("/api/v1/admin/companion/settings", json=payload).status_code == 200
    assert ask(member, "nobody would miss me")["outcome"] == "escalated"
    assert ask(member, "I took too many pills")["outcome"] == "escalated"


def test_over_the_limit_somebody_at_risk_is_still_answered(member):
    limit = LIMITS["companion_message"].per_subject
    for _ in range(limit):
        member.post(ASK, json={"message": "What is a Health Number?"})
    assert member.post(ASK, json={"message": "What is a Health Number?"}).status_code == 429
    assert ask(member, "I want to die")["outcome"] == "escalated"
    for _ in range(LIMITS["companion_safety"].per_subject - 1):
        assert member.post(ASK, json={"message": "I want to die"}).status_code == 201
    last = member.post(ASK, json={"message": "I want to die"})
    assert last.status_code == 429 and "local emergency services" in last.json()["detail"], "even the refusal says it"
    assert "local emergency" not in member.post(ASK, json={"message": "What is a Health Number?"}).json()["detail"]


# ---- telling the team -------------------------------------------------------------------------------------

def escalations(mailbox) -> list:
    return [m for m in mailbox.sent if "needs a person" in m.subject]


def test_the_team_is_told_once_until_it_is_read_and_again_if_it_gets_worse(member, admin_client, mailbox):
    for _ in range(4):
        answer = ask(member, "I feel suicidal")
        assert answer["outcome"] == "escalated", "the member is answered every time"
    assert len(escalations(mailbox)) == 1
    ask(member, "I'm going to kill myself tonight")
    assert len(escalations(mailbox)) == 2, "it got worse"
    ask(member, "I feel suicidal")
    assert len(escalations(mailbox)) == 2
    conversation = answer["conversation_id"]
    assert admin_client.post(f"/api/v1/admin/companion/conversations/{conversation}/review", json={"note": "read"}).status_code == 200
    ask(member, "I feel suicidal")
    assert len(escalations(mailbox)) == 3, "read, and then said again"
    assert admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()[0]["id"] == conversation


def alerts(member, mailbox, *messages) -> list[int]:
    """How many people were emailed after each of these."""
    out = []
    for message in messages:
        before = len(escalations(mailbox))
        ask(member, message)
        out.append(len(escalations(mailbox)) - before)
    return out


def hours_pass(hours: int) -> None:
    """As if every email there has been had gone that much earlier."""
    with SessionLocal() as db:
        for conversation in db.query(CompanionConversation):
            sent = {kind: [rank, (datetime.fromisoformat(at) - timedelta(hours=hours)).isoformat()] for kind, (rank, at) in conversation.alerted.get("sent", {}).items()}
            conversation.alerted = {**conversation.alerted, "sent": sent}
        db.commit()


def review(admin_client, conversation_id):
    assert admin_client.post(f"/api/v1/admin/companion/conversations/{conversation_id}/review", json={"note": ""}).status_code == 200


def test_last_months_worry_does_not_keep_this_months_from_being_sent(member, admin_client, mailbox):
    """Independent review: what was once the worst of a conversation kept
    everything after it quiet, even when it had long been read."""
    conversation = ask(member, "I'm going to kill myself tonight")["conversation_id"]
    review(admin_client, conversation)
    assert alerts(member, mailbox, "nothing is working anymore and I haven't slept properly in a week", "I'm going to kill myself tonight") == [1, 1]


def test_another_kind_of_worry_is_another_email(member, admin_client, mailbox):
    assert alerts(member, mailbox, "I took too many pills", "I want to kill myself", "I want to kill myself") == [1, 1, 0]
    assert alerts(member, mailbox, "My friend says he is going to kill himself tonight", "I'm going to kill myself tonight", "I'm going to kill myself tonight") == [1, 1, 0]


def test_nobody_having_read_it_for_half_a_day_is_another_email(member, admin_client, mailbox):
    assert alerts(member, mailbox, "I want to die", "I want to die") == [1, 0]
    hours_pass(13)
    assert alerts(member, mailbox, "I want to die", "I want to die") == [1, 0]


def test_clearing_the_chat_every_few_hours_does_not_stop_the_clock(member, admin_client, mailbox):
    """Second review: a message nobody was emailed about started the twelve
    hours again, so one email in seventy-seven hours was all there ever was."""
    said = []
    for _ in range(8):
        said += alerts(member, mailbox, "I'm going to kill myself tonight")
        member.post("/api/v1/companion/conversations/clear")
        hours_pass(5)
    assert said == [1, 0, 0, 1, 0, 0, 1, 0]


def test_the_emailed_one_being_read_is_the_end_of_it(member, admin_client, mailbox):
    """Second review: the chat was cleared, the next one was marked without an
    email, the first was read, and the next one stayed silent for twelve hours."""
    first = ask(member, "I want to die")["conversation_id"]
    member.post("/api/v1/companion/conversations/clear")
    assert alerts(member, mailbox, "I want to die") == [0]
    review(admin_client, first)
    assert alerts(member, mailbox, "I want to die", "I want to die") == [1, 0]


def test_each_kind_of_worry_has_its_own_clock(member, admin_client, mailbox):
    assert alerts(member, mailbox, "I want to die") == [1]
    hours_pass(11)
    assert alerts(member, mailbox, "Should I change my medication?") == [1]
    hours_pass(2)
    assert alerts(member, mailbox, "I want to die", "Should I change my medication?") == [1, 0]


def test_two_people_they_are_worried_about_are_two_emails(member, admin_client, mailbox):
    assert alerts(member, mailbox, "my son drank bleach", "my friend is going to kill himself", "my friend is going to kill himself") == [1, 1, 0]


def test_the_less_grave_of_two_people_is_still_an_email(member, admin_client, mailbox):
    """Not because it is worse than the last one: because it is somebody else."""
    assert alerts(member, mailbox, "my friend is going to kill himself", "my son drank bleach", "my son drank bleach") == [1, 1, 0]


def test_what_is_kept_of_an_email_is_a_kind_a_number_and_a_time(member, admin_client, mailbox):
    ask(member, "I'm going to kill myself tonight")
    with SessionLocal() as db:
        kept = db.query(CompanionConversation).one().alerted
    assert set(kept) == {"worst", "sent"} and kept["worst"] == 7 and list(kept["sent"]) == ["self"] and kept["sent"]["self"][0] == 7
    assert "tonight" not in json.dumps(kept)


def test_clearing_the_chat_does_not_email_everybody_again_and_is_still_marked(member, admin_client, mailbox):
    assert alerts(member, mailbox, "I want to die") == [1]
    for _ in range(3):
        member.post("/api/v1/companion/conversations/clear")
        assert alerts(member, mailbox, "I want to die") == [0]
    assert len(admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()) == 4
    member.post("/api/v1/companion/conversations/clear")
    assert alerts(member, mailbox, "I'm going to kill myself tonight") == [1], "worse is worth telling"


def test_reading_is_of_what_was_on_the_screen(member, admin_client, mailbox):
    """Second review: the page is opened, the member writes again (the same
    worry, so no email), and "Mark reviewed" took both out of the queue."""
    url = "/api/v1/admin/companion/conversations"
    conversation = ask(member, "I want to die")["conversation_id"]
    seen = admin_client.get(f"{url}/{conversation}").json()["messages"][-1]["id"]
    ask(member, "I want to die")
    for action in ("review", "resolve"):
        refused = admin_client.post(f"{url}/{conversation}/{action}", json={"seen_message_id": seen})
        assert refused.status_code == 409 and "after this page was opened" in refused.json()["detail"]
    assert [c["id"] for c in admin_client.get(f"{url}?filter=needs_review").json()] == [conversation]
    seen = admin_client.get(f"{url}/{conversation}").json()["messages"][-1]["id"]
    ask(member, "What should I eat for lunch?")
    read = admin_client.post(f"{url}/{conversation}/review", json={"seen_message_id": seen})
    assert read.status_code == 200 and read.json()["reviewed_at"], "what came after it was not handed over"
    assert admin_client.get(f"{url}?filter=needs_review").json() == []
    other = TestClient(app)
    sign_up(other, email="other.person@demo.veye.test", first_name="Other")
    theirs = ask(other, "I want to die")["conversation_id"]
    assert admin_client.post(f"{url}/{theirs}/review", json={"seen_message_id": seen}).status_code == 422, "another conversation's"
    assert admin_client.post(f"{url}/{theirs}/review", json={"note": None}).status_code == 200, "and a page from before the change still can"


def test_somebody_who_may_hurt_somebody_else_gets_words_for_that(member, admin_client, mailbox):
    body = ask(member, "I'm going to stab him")
    assert body["outcome"] == "escalated" and "so that everyone stays safe" in body["reply"] and "hurt yourself" not in body["reply"]
    waiting = admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()
    assert waiting[0]["flag_reason"] == "Handed to a person: possible danger to somebody else."
    assert alerts(member, mailbox, "I'm going to kill myself tonight") == [1], "another kind of worry"


def test_the_reason_stays_the_gravest_while_it_waits(member, admin_client):
    conversation = ask(member, "I'm going to kill myself tonight")["conversation_id"]
    ask(member, "Should I change my medication?")
    waiting = admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()
    assert [c["flag_reason"] for c in waiting if c["id"] == conversation] == ["Handed to a person: possible immediate danger."]


def test_a_message_that_is_marked_while_somebody_marks_it_read_is_waiting_again(member, admin_client, mailbox):
    """The row as it is now, not as it was when this request began."""
    from app.companion.service import CompanionService
    from app.notifications.service import NotificationService

    conversation = UUID(ask(member, "I want to die")["conversation_id"])
    with SessionLocal() as db:
        service = CompanionService(db, get_runtime(), NotificationService(db, get_runtime().email))
        as_it_was = db.get(CompanionConversation, conversation)
        decision = service._decide(assess("I want to die"))
        assert as_it_was.reviewed_at is None
        review(admin_client, str(conversation))
        assert as_it_was.reviewed_at is None, "this request still has the copy from before"
        assert service._mark(as_it_was, decision) is True
        db.commit()
    assert [c["id"] for c in admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()] == [str(conversation)]


def test_an_urgent_message_is_not_lost_over_whose_conversation_was_open(member, admin_client):
    """Another account signed in from a second tab: the page still holds the
    first one's conversation."""
    other = TestClient(app)
    sign_up(other, email="other.person@demo.veye.test", first_name="Other")
    theirs = ask(other, "What should I eat for lunch?")["conversation_id"]
    heard = ask(member, "I want to die", conversation_id=theirs)
    assert heard["outcome"] == "escalated" and heard["conversation_id"] != theirs
    assert [c["id"] for c in admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()] == [heard["conversation_id"]]
    assert member.post(ASK, json={"message": "What should I eat for lunch?", "conversation_id": theirs}).status_code == 404
    assert other.get("/api/v1/companion/session").json()["conversation"]["message_count"] == 2


def test_hurt_by_somebody_and_meaning_it_is_both(member, admin_client, mailbox):
    body = ask(member, "My husband hits me and I want to kill myself")
    assert body["outcome"] == "escalated" and "Thank you for telling me" in body["reply"] and "nobody should be hurt" in body["reply"]
    assert len(escalations(mailbox)) == 1


def test_turns_are_counted_where_the_row_is(member):
    conversation = ask(member, "What should I eat for lunch?")["conversation_id"]
    with SessionLocal() as db:
        db.query(CompanionConversation).update({"message_count": 40})
        db.commit()
    ask(member, "What should I eat for dinner?", conversation_id=conversation)
    with SessionLocal() as db:
        assert db.query(CompanionConversation).one().message_count == 42


def test_the_email_carries_a_category_and_a_link_and_nothing_they_said(member, admin_client, mailbox):
    ask(member, "I feel suicidal and my name is Aditya")
    mail = escalations(mailbox)[0]
    for private in ("suicid", "Aditya", "aditya.demo", "demo.veye.test"):
        assert private not in mail.text and private not in (mail.html or "")
    assert "wellbeing_concern" in mail.text and "/admin/companion/conversations?conversation=" in mail.text


def test_everyone_who_can_open_the_console_is_told_and_nobody_who_cannot(member, admin_client, mailbox):
    from app.auth.models import UserAccount

    from app.seed.users import ADMIN_TWO, ensure_admin

    ensure_admin(account=ADMIN_TWO)
    dual = TestClient(app)
    sign_up(dual, email="dual.person@demo.veye.test", first_name="Dual")
    with SessionLocal() as db:
        db.query(UserAccount).filter(UserAccount.email == "dual.person@demo.veye.test").one().admin_access = True   # a member too, role "member"
        second = db.query(UserAccount).filter(UserAccount.email == ADMIN_TWO.email).one()
        second.admin_access = False                                                                                # no console access any more
        db.commit()
    ask(member, "I feel suicidal")
    assert {m.to for m in escalations(mailbox)} == {"cara.hogue@demo.veye.test", "dual.person@demo.veye.test"}


def test_a_mail_server_that_refuses_neither_delays_nor_loses_it(member, admin_client):
    class Refuses:
        name = "refuses"

        def send(self, message):
            raise RuntimeError("no mail server")

    configure_runtime(email=Refuses())
    body = ask(member, "I feel suicidal")
    assert body["outcome"] == "escalated"
    with SessionLocal() as db:
        outbox = db.query(NotificationOutbox).filter(NotificationOutbox.to_email == "cara.hogue@demo.veye.test").one()
        assert outbox.status == "retry" and outbox.next_attempt_at is not None, "it is tried again by the scheduled delivery"


# ---- nothing was said, and it may be meant -----------------------------------------------------------------

SIDEWAYS = "if something happened to me i think id be relieved lol"


def nobody_told(admin_client, mailbox) -> bool:
    return escalations(mailbox) == [] and admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json() == []


def test_sprout_asks_where_it_would_have_said_it_cannot_help(member, admin_client, mailbox):
    body = ask(member, SIDEWAYS)
    assert (body["outcome"], body["policy_outcome"], body["safety_level"]) == ("support", "support", UNSURE)
    assert body["reply"] == f"{UNSURE_QUESTION} {PROGRAM}" and "outside what I can help with" not in body["reply"]
    assert body["safety_result"] == SAFETY_COPY_VERSION and body["provider"] is None and len(get_runtime().llm.requests) == 0
    assert nobody_told(admin_client, mailbox), "a guess is never handed to anybody"


@pytest.mark.parametrize("answer,level,told", [("yes", SELF_HARM, True), ("I do", SELF_HARM, True), ("tonight", IMMINENT, True), ("no", None, False), ("I'm fine", None, False)])
def test_what_they_answer_is_heard_as_the_answer(member, admin_client, mailbox, answer, level, told):
    ask(member, SIDEWAYS)
    body = ask(member, answer)
    assert (body["safety_level"], body["outcome"] == "escalated") == (level, told)
    assert (len(escalations(mailbox)) == 1) is told
    if not told:
        assert body["reply"] == STEADIER and nobody_told(admin_client, mailbox)


def test_the_question_is_open_until_the_next_message_and_no_longer(member, admin_client, mailbox):
    ask(member, SIDEWAYS)
    assert ask(member, "What should I eat for lunch?")["outcome"] == "answered"
    assert ask(member, "yes")["safety_level"] is None
    ask(member, SIDEWAYS)
    with SessionLocal() as db:
        db.query(CompanionPolicyDecision).update({"created_at": datetime.now(timezone.utc) - timedelta(hours=25)})
        db.commit()
    assert ask(member, "yes")["safety_level"] is None
    other = TestClient(app)
    sign_up(other, email="other.person@demo.veye.test", first_name="Other")
    ask(member, SIDEWAYS)
    assert ask(other, "yes")["safety_level"] is None
    assert nobody_told(admin_client, mailbox)


def test_an_ordinary_answer_is_still_given_with_a_line_after_it(member, admin_client, mailbox, monkeypatch):
    plain = ask(member, "What should I eat for lunch?")
    with monkeypatch.context() as unsure:
        unsure.setattr(second_reading, "worried", lambda text: True)
        body = ask(member, "What should I eat for lunch?")
        assert body["outcome"] == "answered" and body["safety_level"] == UNSURE and body["sources"] == plain["sources"]
        assert body["reply"].endswith(UNSURE_LINE) and body["reply"].count(UNSURE_LINE) == 1
        amount = ask(member, "How much magnesium should I take?")
        assert amount["outcome"] == "prohibited" and "coach to confirm" in amount["reply"] and amount["reply"].endswith(UNSURE_LINE)
        urgent = ask(member, "I feel suicidal")
        assert urgent["outcome"] == "escalated" and UNSURE_LINE not in urgent["reply"], "the rules' own words are not added to"
    # It was not a question, so "yes" is not an answer to it.
    other = TestClient(app)
    sign_up(other, email="other.person@demo.veye.test", first_name="Other")
    with monkeypatch.context() as unsure:
        unsure.setattr(second_reading, "worried", lambda text: True)
        assert ask(other, "What should I eat for lunch?")["safety_level"] == UNSURE
    assert ask(other, "yes")["safety_level"] is None


def test_heavy_words_and_unsure_is_both(member, admin_client, mailbox):
    body = ask(member, "I hate myself and nothing helps, what should I eat tonight")
    assert body["safety_level"] == UNSURE and DISTRESS_WORDS in body["reply"] and body["reply"].endswith(UNSURE_LINE)
    assert nobody_told(admin_client, mailbox)


def test_without_the_weights_the_rules_still_stand(member, monkeypatch):
    """The second reading is an extra pair of ears. A file that cannot be read
    must not be a reason to hear nothing."""
    def missing():
        raise FileNotFoundError("second_reading.json")

    monkeypatch.setattr(second_reading, "table", missing)
    assert ask(member, "I feel suicidal")["outcome"] == "escalated"
    assert ask(member, "What should I eat for lunch?")["outcome"] == "answered"


# ---- afterwards -------------------------------------------------------------------------------------------

def test_a_worrying_message_is_remembered_across_conversations_and_is_never_in_a_prompt(member):
    ask(member, "I feel suicidal")
    member.post("/api/v1/companion/conversations/clear")
    assert ask(member, "tonight")["safety_level"] == IMMINENT, "clearing the chat does not clear the worry"
    lunch = ask(member, "What should I eat for lunch?")
    assert lunch["outcome"] == "answered"
    sent = get_runtime().llm.last_request.as_payload()
    flat = json.dumps(sent)
    assert "suicid" not in flat and "tonight" not in flat and "emergency services" not in flat


@pytest.mark.parametrize("worrying", ["I feel suicidal", "I can't go on", "I took too many pills", SIDEWAYS, "Is suicide a sin?", "I was suicidal years ago"])
def test_yes_is_an_answer_to_what_was_just_said_and_to_nothing_later(member, admin_client, mailbox, worrying):
    """Hours after a bad moment, "yes" to "would you like a snack idea?" is not
    a cry for help, and a person must not be told that it was."""
    assert ask(member, worrying)["safety_level"] is not None
    assert RANK[ask(member, "yes")["safety_level"]] >= RANK[SELF_HARM]
    assert ask(member, "What should I eat for lunch?")["outcome"] == "answered"
    before = len(escalations(mailbox))
    for later in ("yes", "maybe", "no", "tonight", "I'm good"):
        body = ask(member, later)
        assert body["safety_level"] is None and body["reply"] != STEADIER, later
        ask(member, "What should I eat for lunch?")
    assert len(escalations(mailbox)) == before
    still = ask(member, "I have the pills")
    assert (still["safety_level"] == IMMINENT) is (worrying != "I took too many pills"), "what they meant is remembered; a body is only straight after"


def test_what_sprout_could_not_take_in_does_not_end_the_question(member, admin_client, mailbox):
    """Second review: "idk" wrote its own decision, so the "yes" after it was
    no longer an answer."""
    assert ask(member, "I can't go on")["safety_level"] == "check_in"
    assert ask(member, "idk")["reply"] == STILL_HERE
    assert ask(member, "yes")["safety_level"] == "self_harm" and len(escalations(mailbox)) == 2
    with SessionLocal() as db:
        db.query(CompanionPolicyDecision).update({"created_at": datetime.now(timezone.utc) - timedelta(hours=2)})
        db.commit()
    ask(member, "idk")
    assert ask(member, "yes")["safety_level"] is None, "but not for ever"


def test_no_to_being_helped_is_not_im_all_right(member):
    """Second review: told to contact emergency services, "no" was answered
    "I'm glad you're all right, and thank you for saying so"."""
    ask(member, "I'm going to kill myself tonight")
    assert ask(member, "no")["reply"] == STILL_HERE
    ask(member, "I can't go on")
    assert ask(member, "no")["reply"] == STILL_HERE, "asked this time, and what they said before it is not undone by a no"
    with SessionLocal() as db:
        db.query(CompanionPolicyDecision).update({"created_at": datetime.now(timezone.utc) - timedelta(days=2)})
        db.commit()
    ask(member, "I can't go on")
    assert ask(member, "no")["reply"] == STEADIER, "asked whether they meant it, and that is all there was"


def test_after_a_day_it_is_not_held_against_what_they_say_next(member):
    ask(member, "I feel suicidal")
    with SessionLocal() as db:
        db.query(CompanionPolicyDecision).update({"created_at": datetime.now(timezone.utc) - timedelta(hours=25)})
        db.commit()
    assert ask(member, "tonight")["outcome"] == "off_topic"


def test_after_a_worrying_message_an_odd_one_is_not_met_coldly(member):
    ask(member, "I feel suicidal")
    fine = ask(member, "I'm fine, just kidding")
    assert fine["reply"] == STEADIER and fine["outcome"] == "support"
    odd = ask(member, "what do you think about the new phone")
    assert odd["reply"] == STILL_HERE


def test_one_members_words_do_not_colour_anothers(member):
    ask(member, "I feel suicidal")
    other = TestClient(app)
    sign_up(other, email="other.person@demo.veye.test", first_name="Other")
    assert ask(other, "tonight")["outcome"] == "off_topic"
    ask(other, "My friend is suicidal")
    assert ask(other, "tonight")["safety_level"] is None, "worry about a friend is not worry about them"


def test_what_the_team_can_read_of_it_is_what_they_could_before(member, admin_client):
    """The conversation, marked; not their health information."""
    turn_on_sprout(member)
    member.post("/api/v1/health-number/calculate", json={"answers": {
        "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"], "activity": "Light (I work, I walk some)", "meditate": "no", "tired": "yes",
        "gainWeight": "no", "abdomenWeight": "no", "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7, "diet": "No preference", "source": "Friends or Family"}})
    ask(member, "Explain my Health Number")
    body = ask(member, "I feel suicidal")
    detail = admin_client.get(f"/api/v1/admin/companion/conversations/{body['conversation_id']}").json()
    contents = [m["content"] for m in detail["messages"]]
    assert contents[1] == WITHHELD_REPLY and contents[2] == "I feel suicidal" and contents[3] == body["reply"]


# ---- a guide is not a way round it -----------------------------------------------------------------------------

GUIDE = "/api/v1/companion/guided-flows/first_time_user"


def test_typed_into_a_guide_it_is_heard_and_the_guide_waits(member, admin_client, mailbox):
    from app.guided_flows.catalog import ensure_builtin_flows
    from app.guided_flows.models import MemberGuidedFlowSession

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    started = member.post(f"{GUIDE}/start").json()
    step = member.post(f"{GUIDE}/answer", json={"choice": "why_to"}).json()
    assert step["reply"] is None and step["steps_taken"] == started["steps_taken"] + 1
    heard = member.post(f"{GUIDE}/answer", json={"text": "I can't go on, I want to die"}).json()
    assert heard["reply"]["outcome"] == "escalated" and "local emergency services" in heard["reply"]["reply"]
    assert heard["steps_taken"] == step["steps_taken"] and heard["node"] == step["node"], "it was not taken as an answer"
    assert len(escalations(mailbox)) == 1
    with SessionLocal() as db:
        assert "want to die" not in json.dumps(db.query(MemberGuidedFlowSession).one().answers), "the guide keeps none of it"
        assert db.query(CompanionMessage).filter(CompanionMessage.content == "I can't go on, I want to die").count() == 1
        assert db.query(CompanionConversation).one().flagged is True
    denied = member.post(f"{GUIDE}/answer", json={"text": "no, I'm not suicidal"}).json()
    assert denied["reply"]["reply"] == STEADIER and denied["node"] == step["node"], "no to what Sprout said is not no to the step"
    onward = member.post(f"{GUIDE}/answer", json={"text": "no"}).json()
    assert onward["reply"] is None and onward["steps_taken"] == step["steps_taken"] + 1, "and the next no is an answer again"


@pytest.mark.parametrize("ended", ["never started", "skipped", "complete"])
def test_a_guide_that_has_ended_still_hears_it(member, admin_client, mailbox, ended):
    """Finished or skipped on the phone, and the laptop still shows a step."""
    from app.guided_flows.catalog import ensure_builtin_flows
    from app.guided_flows.models import MemberGuidedFlowSession

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    if ended != "never started":
        member.post(f"{GUIDE}/start")
        member.post(f"{GUIDE}/skip")
    if ended == "complete":
        with SessionLocal() as db:
            db.query(MemberGuidedFlowSession).update({"status": "completed"})
            db.commit()
    heard = member.post(f"{GUIDE}/answer", json={"text": "I can't go on"})
    assert heard.status_code == 200 and heard.json()["reply"]["outcome"] == "escalated"
    assert len(escalations(mailbox)) == 1 and len(admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()) == 1
    asked = member.post(f"{GUIDE}/ask", json={"question": "should I just kill myself?"})
    assert asked.status_code == 200 and asked.json()["reply"]["outcome"] == "escalated"
    assert member.post(f"{GUIDE}/answer", json={"text": "yes please"}).status_code in (409, 200)
    if ended != "never started":
        assert member.post(f"{GUIDE}/answer", json={"text": "the why to"}).status_code == 409, "and an ordinary answer is refused as before"


def test_a_guide_asks_too_and_never_holds_an_answer_back(member, monkeypatch):
    from app.guided_flows.catalog import ensure_builtin_flows

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    member.post(f"{GUIDE}/start")
    step = member.post(f"{GUIDE}/answer", json={"choice": "why_to"}).json()
    with monkeypatch.context() as unsure:
        unsure.setattr(second_reading, "worried", lambda text: True)
        onward = member.post(f"{GUIDE}/answer", json={"text": step["node"]["choices"][0]["label"]}).json()
    assert onward["reply"] is None and onward["steps_taken"] == step["steps_taken"] + 1, "an answer is an answer"
    assert UNSURE_LINE in onward["messages"]
    asked = member.post(f"{GUIDE}/answer", json={"text": SIDEWAYS}).json()
    assert asked["reply"]["safety_level"] == UNSURE and asked["node"] == onward["node"], "not an option of this step, so Sprout asks instead of guessing"
    answered = member.post(f"{GUIDE}/answer", json={"text": "yes"}).json()
    assert answered["reply"]["outcome"] == "escalated" and answered["node"] == onward["node"], "what Sprout asked last is what yes answers"


def at_step(node: str) -> None:
    from app.guided_flows.models import MemberGuidedFlowSession

    with SessionLocal() as db:
        db.query(MemberGuidedFlowSession).one().current_node = node
        db.commit()


def test_a_guide_hands_over_what_sprout_would(member, admin_client, mailbox):
    """Second review: an open question takes any answer as "continue", so what
    the approved list hands to a person was told to nobody."""
    from app.guided_flows.catalog import ensure_builtin_flows

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    member.post(f"{GUIDE}/start")
    for text in ("I haven't slept properly in a week and nothing is working", "I'm pregnant and spotting", "My doctor said my symptoms are getting worse"):
        at_step("t1")
        heard = member.post(f"{GUIDE}/answer", json={"text": text}).json()
        assert heard["reply"]["outcome"] == "escalated" and heard["node"]["id"] == "t1", text
    assert len(admin_client.get("/api/v1/admin/companion/conversations?filter=needs_review").json()) == 1
    onward = member.post(f"{GUIDE}/answer", json={"text": "I can try to notice why I snack"}).json()
    assert onward["reply"] is None and onward["node"]["id"] == "t2"


def test_yes_to_a_step_is_not_yes_to_what_sprout_said_before_it(member, admin_client, mailbox):
    """Second review: choices write no decision, so a worry an hour and several
    steps ago was still the last thing said."""
    from app.guided_flows.catalog import ensure_builtin_flows

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    member.post(f"{GUIDE}/start")
    assert member.post(f"{GUIDE}/answer", json={"text": "I can't go on"}).json()["reply"]["outcome"] == "escalated"
    step = member.post(f"{GUIDE}/answer", json={"choice": "why_to"}).json()
    assert step["reply"] is None
    after = member.post(f"{GUIDE}/answer", json={"text": "yes"}).json()
    assert after["reply"] is None and len(escalations(mailbox)) == 1


def test_a_guide_that_has_ended_hears_what_is_asked_of_it_too(member):
    from app.guided_flows.catalog import ensure_builtin_flows

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    asked = member.post(f"{GUIDE}/ask", json={"question": "Why am I so hopeless?"})
    assert asked.status_code == 200 and asked.json()["reply"]["outcome"] in ("support", "escalated")
    assert member.post(f"{GUIDE}/ask", json={"question": "What is a Health Number?"}).status_code == 409, "an ordinary one as before"


def test_asking_inside_a_guide_has_the_same_allowance_as_asking_outside_it(member):
    from app.guided_flows.catalog import ensure_builtin_flows

    with SessionLocal() as db:
        ensure_builtin_flows(db)
        db.commit()
    member.post(f"{GUIDE}/start")
    for _ in range(LIMITS["companion_message"].per_subject):
        member.post(ASK, json={"message": "What is a Health Number?"})
    assert member.post(f"{GUIDE}/ask", json={"question": "What is a Health Number?"}).status_code == 429
    assert member.post(f"{GUIDE}/ask", json={"question": "I want to die"}).json()["reply"]["outcome"] == "escalated"


# ---- while something slow is going on, on the database it runs on -----------------------------------------------

def _sprout(db):
    from app.companion.service import CompanionService
    from app.notifications.email import NoEmailProvider
    from app.notifications.service import NotificationService

    return CompanionService(db, get_runtime(), NotificationService(db, NoEmailProvider()))


def test_an_urgent_message_does_not_wait_for_the_answer_before_it(pg_sessionmaker):  # noqa: F811
    """Independent review: the conversation was held from before the model was
    asked until it had answered, so "I want to die" from a second tab waited."""
    import threading

    user_id, mid = _pg_member(pg_sessionmaker)
    model, usual = Paused(), get_runtime().llm
    configure_runtime(llm=model)
    principal = _principal(pg_sessionmaker, user_id)
    heard = threading.Event()

    def lunch():
        with pg_sessionmaker() as db:
            _sprout(db).ask(principal, "What is a Health Number?")
            db.commit()

    def urgent():
        with pg_sessionmaker() as db:
            reply = _sprout(db).ask(principal, "I want to die")
            db.commit()
            assert reply.outcome == "escalated"
        heard.set()

    with pg_sessionmaker() as db:
        _sprout(db).open_conversation(principal)
        db.commit()
    first, second = threading.Thread(target=lunch), threading.Thread(target=urgent)
    first.start()
    try:
        assert model.asked.wait(15), "the model was never asked"
        assert pg_sessionmaker.kw["bind"].pool.checkedout() == 0, "and no connection waits with it (second review)"
        second.start()
        assert heard.wait(8), "it waited for the model"
    finally:
        model.answer.set()
        first.join(15)
        second.join(15)
        configure_runtime(llm=usual)
    with pg_sessionmaker() as db:
        conversation = db.query(CompanionConversation).one()
        assert conversation.flagged and conversation.message_count == 4 and db.query(CompanionMessage).count() == 4


def test_two_urgent_messages_at_once_are_one_email(pg_sessionmaker):  # noqa: F811
    from app.auth.models import UserAccount

    user_id, mid = _pg_member(pg_sessionmaker)
    with pg_sessionmaker() as db:
        db.get(UserAccount, user_id).admin_access = True     # somebody to tell
        _sprout(db).open_conversation(_principal(pg_sessionmaker, user_id))
        db.commit()
    principal = _principal(pg_sessionmaker, user_id)

    def urgent():
        with pg_sessionmaker() as db:
            _sprout(db).ask(principal, "I want to die")
            db.commit()

    assert _at_once(*[urgent] * 4) == [None] * 4
    with pg_sessionmaker() as db:
        assert db.query(Notification).filter(Notification.kind == "companion_escalation").count() == 1
        assert db.query(CompanionConversation).one().message_count == 8


def test_a_session_is_not_held_while_its_request_goes_on(pg_sessionmaker):  # noqa: F811
    """A Personal tip being written held the session row for as long as the
    model took, and the same browser's message to Sprout waited behind it."""
    import threading

    from app.auth.models import AuthSession, UserAccount
    
    user_id, _ = _pg_member(pg_sessionmaker)
    provider = get_runtime().auth_provider
    with pg_sessionmaker() as db:
        issued = provider.issue(db, db.get(UserAccount, user_id), portal="member", remember=False)
        db.commit()
        db.query(AuthSession).update({"last_seen_at": datetime.now(timezone.utc) - timedelta(hours=1)})
        db.commit()
    through = threading.Event()

    def second():
        with pg_sessionmaker() as db:
            assert provider.resolve(db, issued.cookie_value, "member") is not None
        through.set()

    with pg_sessionmaker() as first:
        assert provider.resolve(first, issued.cookie_value, "member") is not None
        first.flush()                                   # and goes on to something slow
        thread = threading.Thread(target=second)
        thread.start()
        assert through.wait(5), "it waited for the first request"
        thread.join(5)
    with pg_sessionmaker() as db:
        seen = db.query(AuthSession.last_seen_at).scalar()
        assert datetime.now(timezone.utc) - seen < timedelta(minutes=5), "and it was seen"
