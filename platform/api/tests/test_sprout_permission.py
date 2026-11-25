"""Two separate choices: who in the Veye team may see a member's health
information, and whether Sprout may use it.

The four combinations are the spine of this file. Each one is asserted at the
places where it can go wrong: what the console is sent (every GET it serves,
not the screens somebody remembered), what is put in front of the model, what
the dashboard's tip is written from, and what the member keeps whatever they
chose, which is all of it.
"""

from __future__ import annotations

import threading
from datetime import date, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.admin.companion_routes import WITHHELD_REPLY
from app.companion.models import CompanionMessage, MemberPersonalTip
from app.companion.personal_tip import FALLBACK_OFF
from app.companion.providers.llm import GroqLLMProvider, LLMRequest, LLMMessage, DataClassification, MockLLMProvider, ProviderNotConfigured, leaves_veye
from app.companion.service import TURNED_OFF_MEANWHILE, CompanionService
from app.core.runtime import configure_runtime, get_runtime
from app.db.session import SessionLocal
from app.health_permission.models import MemberHealthPermission, MemberHealthPermissionEvent
from app.health_permission.service import HealthPermissionService
from app.main import app
from app.members.models import Member
from app.notifications.email import NoEmailProvider
from app.notifications.service import NotificationService
from app.seed.knowledge import seed_knowledge
from app.sprout_permission.models import MemberSproutPermission, MemberSproutPermissionEvent
from app.sprout_permission.service import SproutPermissionService
from app.sprout_permission.terms import POLICY_VERSION, TERMS_VERSION, current_terms
from tests.conftest import decide_sharing, sign_in, sign_up, turn_on_sprout, verify_member_email
from tests.pg import PG_ADMIN_URL, pg_sessionmaker  # noqa: F401 - fixture
from tests.route_table import ADMIN_GUARD, SAFE_METHODS, concrete, routes

MINE = "/api/v1/members/me/sprout-permission"
GRANT, REVOKE = f"{MINE}/grant", f"{MINE}/revoke"
TEAM_REVOKE = "/api/v1/members/me/health-permission/revoke"
ASK = "/api/v1/companion/messages"
TIP = "/api/v1/companion/personal-tip"
CONVERSATIONS = "/api/v1/admin/companion/conversations"

QUESTION = "Explain what my Health Number means"
FROM_RECORDS = "From your saved results"

ANSWERS = {
    "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
    "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes", "tired": "no", "gainWeight": "no",
    "abdomenWeight": "no", "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7, "diet": "No preference",
    "source": "Friends or Family",
}


def member(email: str = "sprout.one@demo.veye.test", first_name: str = "Robin") -> TestClient:
    http = TestClient(app)
    created = sign_up(http, email=email, first_name=first_name)
    assert created.status_code == 201, created.text
    http.account = created.json()["account"]
    assert http.post("/api/v1/health-number/calculate", json={"answers": ANSWERS}).status_code in (200, 201)
    today = date.today()
    for offset in range(3):
        day = (today - timedelta(days=offset)).isoformat()
        assert http.put("/api/v1/members/me/mood", params={"today": today.isoformat()},
                        json={"entry_date": day, "mood": "calm", "note": ""}).status_code == 200
    return http


def member_id_of(http: TestClient) -> str:
    return http.get("/api/v1/auth/me").json()["member"]["member_id"]


def ask(http: TestClient, message: str = QUESTION) -> dict:
    sent = http.post(ASK, json={"message": message})
    assert sent.status_code == 201, sent.text
    return sent.json()


def prompt() -> str:
    """Everything the model was handed for the last turn."""
    payload = get_runtime().llm.last_request.as_payload()
    return payload["system"] + "\n" + "\n".join(m["content"] for m in payload["messages"])


# ---- what it starts as ------------------------------------------------------------

def test_it_starts_off_and_looking_writes_nothing(admin_client):
    http = member()
    body = http.get(MINE).json()
    assert (body["state"], body["personalizes"], body["authorized_at"], body["events"]) == ("off", False, None, [])
    assert body["terms"]["version"] == TERMS_VERSION and body["terms"]["label"] == POLICY_VERSION
    for _ in range(3):
        http.get(MINE)
    with SessionLocal() as db:
        assert db.query(MemberSproutPermission).count() == 0, "reading is not a decision and must not leave a row"


def test_the_words_say_what_is_used_what_never_is_and_how_to_stop(admin_client):
    terms = member().get(MINE).json()["terms"]
    assert terms["title"] == "Personalize Sprout using my health information"
    assert terms["purpose"] and terms["recipient"] and terms["expiry_rule"] == "Until you turn it off."
    assert len(terms["information"]) == 5
    assert "notes" in terms["never"] and "photos" in terms["never"]
    assert "separate from sharing with the Veye team" in terms["separate"]
    assert "outside AI company" in terms["outside_ai"]
    assert "turn this off" in terms["withdrawal"]
    everything = " ".join(v for v in terms.values() if isinstance(v, str)).lower()
    for legal in ("hipaa", "authorization", "authorisation"):
        assert legal not in everything


def test_the_listed_information_is_exactly_what_the_context_can_carry():
    """A sixth kind of summary would need a sixth line, and a new version."""
    from app.companion.context import MemberContext
    from app.companion.policy import MEMBER_DATA_SCOPES
    from app.sprout_permission.terms import INFORMATION

    carried = [name for name in MemberContext.model_fields if name not in ("scopes", "personalization_token")]
    assert len(carried) == len(MEMBER_DATA_SCOPES) == len(INFORMATION) == 5


# ---- turning it on and off ------------------------------------------------------------

def test_turning_it_on_needs_a_verified_address_and_the_words_as_they_are_now(admin_client):
    http = member()
    terms = http.get(MINE).json()["terms"]
    decision = {"terms_version": terms["version"], "terms_hash": terms["hash"]}
    unverified = http.post(GRANT, json=decision)
    assert unverified.status_code == 409 and "Verify your email" in unverified.json()["detail"]
    verify_member_email(http)
    stale = http.post(GRANT, json={**decision, "terms_hash": "0" * 64})
    assert stale.status_code == 409 and "read them again" in stale.json()["detail"]
    assert http.post(GRANT, json={**decision, "terms_version": 99}).status_code == 409
    assert http.post(GRANT, json={}).status_code == 422
    assert http.post(GRANT, json={**decision, "state": "on"}).status_code == 422, "nothing else may be sent"
    with SessionLocal() as db:
        assert db.query(MemberSproutPermission).count() == 0, "a refused yes leaves nothing behind"
    granted = http.post(GRANT, json=decision)
    assert granted.status_code == 200 and granted.json()["personalizes"] is True


def test_the_record_says_when_to_what_and_under_which_words(admin_client):
    http = member()
    body = turn_on_sprout(http).json()
    assert body["state"] == "on" and body["authorized_at"] and body["policy_version"] == POLICY_VERSION
    off = http.post(REVOKE).json()
    assert off["state"] == "turned_off" and off["revoked_at"] and off["authorized_at"] == body["authorized_at"]
    assert [e["to_state"] for e in off["events"]] == ["on", "turned_off"]
    with SessionLocal() as db:
        on, stopped = db.query(MemberSproutPermissionEvent).order_by(MemberSproutPermissionEvent.created_at).all()
        assert (on.from_state, on.to_state, on.policy_version) == ("off", "on", POLICY_VERSION)
        assert on.terms_version == TERMS_VERSION and on.terms_hash == current_terms().hash
        assert len(on.scope) == 5 and on.purpose and on.recipient and on.expiry_rule
        assert on.source == "member_app" and on.actor_name == "Robin Demo" and on.actor_user_id
        assert (stopped.from_state, stopped.to_state, stopped.terms_hash) == ("on", "turned_off", None)


def test_the_same_answer_twice_is_one_answer(admin_client):
    http = member()
    assert turn_on_sprout(http).status_code == turn_on_sprout(http).status_code == 200
    assert http.post(REVOKE).status_code == http.post(REVOKE).status_code == 200
    assert [e["to_state"] for e in http.get(MINE).json()["events"]] == ["on", "turned_off"]
    untouched = member("sprout.two@demo.veye.test")
    assert untouched.post(REVOKE).json()["state"] == "off", "switching off what was never on is not an error"
    assert untouched.get(MINE).json()["events"] == []


def test_only_the_member_decides(client, admin_client):
    """No console route reaches it, and the member's own refuse anybody else."""
    for path in (GRANT, REVOKE):
        assert client.post(path, json={"terms_version": 1, "terms_hash": "0" * 64}).status_code == 401
        assert admin_client.post(path, json={"terms_version": 1, "terms_hash": "0" * 64}).status_code == 401
    assert client.get(MINE).status_code == admin_client.get(MINE).status_code == 401
    paths = [p for p in app.openapi()["paths"] if "sprout-permission" in p]
    assert sorted(paths) == [MINE, GRANT, REVOKE], "there is no way to set somebody else's choice, and no console route"


def test_one_members_choice_is_not_anothers(admin_client):
    first, second = member(), member("sprout.two@demo.veye.test", "Sam")
    assert turn_on_sprout(first).status_code == 200
    assert second.get(MINE).json()["state"] == "off"
    assert ask(second)["health_context"] == "off" and FROM_RECORDS not in ask(second)["reply"]
    assert second.post(REVOKE).status_code == 200
    assert first.get(MINE).json()["state"] == "on"
    used = ask(first)
    assert used["health_context"] == "used" and FROM_RECORDS in used["reply"]


# ---- the four combinations --------------------------------------------------------------

COMBINATIONS = [(False, False), (True, False), (False, True), (True, True)]
NAMES = ["neither", "team only", "Sprout only", "both"]

ADMIN_READS = [r for r in routes() if ADMIN_GUARD in r["guards"] and r["method"] in SAFE_METHODS]


def sweep(admin_client, member_id: str, conversation_id: str, needle: str) -> list[str]:
    found = []
    answered = 0
    for row in ADMIN_READS:
        path = concrete(row["path"].replace("{member_id}", member_id).replace("{conversation_id}", conversation_id))
        response = admin_client.get(path)
        if response.status_code >= 400:
            continue
        answered += 1
        if needle in response.text:
            found.append(row["path"])
    assert answered > 20, answered
    return found


@pytest.mark.parametrize("team,sprout", COMBINATIONS, ids=NAMES)
def test_each_combination_end_to_end(admin_client, team, sprout):
    seed_knowledge()
    http = member()
    mid = member_id_of(http)
    if team:
        assert decide_sharing(http).status_code == 200
    if sprout:
        assert turn_on_sprout(http).status_code == 200

    # --- as it is stored, and as it still is after signing in again
    with TestClient(app) as again:
        assert sign_in(again, http.account["email"]).status_code == 200
        for session in (http, again):
            assert session.get(MINE).json()["personalizes"] is sprout
            assert session.get("/api/v1/members/me/health-permission").json()["shares_health_data"] is team

    # --- Sprout
    answer = ask(http)
    assert answer["outcome"] == "answered", "Sprout answers either way"
    assert (FROM_RECORDS in answer["reply"]) is sprout
    assert answer["health_context"] == ("used" if sprout else "off")
    assert bool(answer["context_scopes"]) is sprout
    prompted = prompt()
    assert ("result(s); latest" in prompted) is sprout
    assert ("not turned on Sprout personalization" in prompted) is not sprout
    assert answer["sources"], "approved knowledge is not health information and stays"

    # --- the Personal tip
    tip = http.get(TIP).json()
    assert (tip["text"] == FALLBACK_OFF) is not sprout

    # --- the console: the records
    page = admin_client.get(f"/api/v1/admin/members/{mid}").json()
    assert page["shares_health_data"] is team
    assert bool(page["health_number"]) is team and bool(page["mood_entries"]) is team
    assert (page["profile"]["health_number"] is not None) is team
    row = admin_client.get("/api/v1/admin/members", params={"q": http.account["email"]}).json()["rows"][0]
    assert (row["health_number"] is not None) is team

    # --- the console: what Sprout wrote
    detail = admin_client.get(f"{CONVERSATIONS}/{answer['conversation_id']}").json()
    mine, sprouts = detail["messages"]
    assert mine["content"] == QUESTION and mine["withheld"] is False, "the member's own words are not part of either choice"
    hidden = sprout and not team
    assert sprouts["withheld"] is hidden
    assert sprouts["content"] == (WITHHELD_REPLY if hidden else answer["reply"])
    assert (detail["member"]["health_number"] != "Not shared") is team

    # --- and nowhere else in it
    if sprout:
        assert bool(sweep(admin_client, mid, answer["conversation_id"], FROM_RECORDS)) is team
        searched = admin_client.get(CONVERSATIONS, params={"filter": "all", "q": FROM_RECORDS}).json()
        assert bool(searched) is team, "a search must not find what the screen may not show"
        http.post(f"{ASK}/{answer['reply_message_id']}/feedback", json={"rating": "helpful"})
        feedback = admin_client.get("/api/v1/admin/companion/feedback").json()[0]
        reviewed = admin_client.post(f"/api/v1/admin/companion/feedback/{feedback['id']}/review").json()
        for row in (feedback, reviewed):
            assert row["reply_withheld"] is hidden
            assert (row["reply_excerpt"] == WITHHELD_REPLY) is hidden
            assert row["reply_excerpt"].startswith("Hey Robin") is not hidden

    # --- the member keeps all of their own, whatever they chose
    assert http.get("/api/v1/members/me/health-number").json()["history"]
    assert http.get("/api/v1/members/me/mood", params={"today": date.today().isoformat()}).json()["stats"]
    shown = http.get("/api/v1/companion/session").json()["conversation"]["messages"]
    assert shown[-1]["content"] == answer["reply"], "their conversation is theirs to read"


@pytest.mark.parametrize("team,sprout", COMBINATIONS, ids=NAMES)
def test_changing_one_choice_never_touches_the_other(admin_client, team, sprout):
    http = member()
    if team:
        decide_sharing(http)
    if sprout:
        turn_on_sprout(http)

    def both() -> tuple[bool, bool]:
        return (http.get("/api/v1/members/me/health-permission").json()["shares_health_data"],
                http.get(MINE).json()["personalizes"])

    assert both() == (team, sprout)
    # the team's, back and forth
    if team:
        assert http.post(TEAM_REVOKE).status_code == 200
    else:
        assert decide_sharing(http).status_code == 200
    assert both() == (not team, sprout)
    # Sprout's, back and forth
    if sprout:
        assert http.post(REVOKE).status_code == 200
    else:
        assert turn_on_sprout(http).status_code == 200
    assert both() == (not team, not sprout)
    # declining the team says nothing about Sprout
    if not team:
        assert http.post(TEAM_REVOKE).status_code == 200
    assert decide_sharing(http, "decline").status_code == 200
    assert both() == (False, not sprout)
    with SessionLocal() as db:
        assert {e.to_state for e in db.query(MemberSproutPermissionEvent)} <= {"on", "turned_off"}
        assert {e.to_state for e in db.query(MemberHealthPermissionEvent)} <= {"granted", "declined", "revoked"}


def test_asking_for_one_is_not_asking_for_the_other(admin_client):
    http = member()
    verify_member_email(http)
    asked = admin_client.post(f"/api/v1/admin/members/{member_id_of(http)}/health-permission/request", json={})
    assert asked.status_code == 200
    assert http.get(MINE).json()["state"] == "off" and http.get(MINE).json()["events"] == []


def test_withdrawing_from_the_team_hides_what_sprout_wrote_and_sharing_again_shows_it(admin_client):
    seed_knowledge()
    http = member()
    decide_sharing(http)
    turn_on_sprout(http)
    answer = ask(http)
    read = lambda: admin_client.get(f"{CONVERSATIONS}/{answer['conversation_id']}").json()["messages"][1]  # noqa: E731
    assert read()["content"] == answer["reply"]
    assert http.post(TEAM_REVOKE).status_code == 200
    assert read()["content"] == WITHHELD_REPLY
    assert decide_sharing(http).status_code == 200
    assert read()["content"] == answer["reply"]


# ---- during a conversation ---------------------------------------------------------------

def test_switched_off_mid_conversation_the_next_prompt_has_none_of_it(admin_client):
    """Not the records, and not what Sprout already said from them: an answer
    it gave yesterday is still the member's information in front of it today."""
    seed_knowledge()
    http = member()
    turn_on_sprout(http)
    first = ask(http)
    assert FROM_RECORDS in first["reply"]
    ask(http, "And what should I eat for lunch?")
    assert FROM_RECORDS in prompt(), "while it is on, the conversation carries on from what was said"
    assert http.post(REVOKE).status_code == 200
    later = ask(http, "What should I eat for dinner?")
    sent = prompt()
    assert FROM_RECORDS not in sent and "result(s); latest" not in sent
    assert "And what should I eat for lunch?" in sent, "the member's own words stay in the conversation"
    assert later["health_context"] == "off" and later["context_scopes"] == []


def test_an_answer_written_from_an_earlier_personal_answer_is_personal_too(admin_client):
    seed_knowledge()
    http = member()
    turn_on_sprout(http)
    ask(http)
    plain = ask(http, "How do I sign in to Veye?")     # a topic that opens no records
    assert plain["context_scopes"] == []
    detail = admin_client.get(f"{CONVERSATIONS}/{plain['conversation_id']}").json()["messages"]
    assert detail[-1]["withheld"] is True, "it was written with their earlier answer in front of Sprout"
    cleared = http.post("/api/v1/companion/conversations/clear").json()
    fresh = http.post(ASK, json={"message": "How do I sign in to Veye?", "conversation_id": cleared["id"]}).json()
    assert admin_client.get(f"{CONVERSATIONS}/{fresh['conversation_id']}").json()["messages"][-1]["withheld"] is False


def test_a_reply_an_older_revision_wrote_is_hidden_and_kept_out_too(admin_client):
    """Independent review: while a new revision rolls out the old one still
    writes, and it does not know the column. The topics it opened say it."""
    seed_knowledge()
    http = member()
    turn_on_sprout(http)
    answer = ask(http)
    with SessionLocal() as db:
        row = db.get(CompanionMessage, UUID(answer["reply_message_id"]))
        assert row.context_scopes and row.personal
        row.personal = False                            # as the older revision leaves it
        db.commit()
    detail = admin_client.get(f"{CONVERSATIONS}/{answer['conversation_id']}").json()["messages"][-1]
    assert detail["withheld"] is True and detail["content"] == WITHHELD_REPLY and detail["context_scopes"] == []
    found = admin_client.get(f"{CONVERSATIONS}?filter=all&q=From your saved results").json()
    assert found == [], "a search finds what a screen may not show"
    http.post(REVOKE)
    ask(http, "What should I eat for dinner?")
    assert FROM_RECORDS not in prompt()


def test_the_console_is_not_told_that_it_was_turned_off(admin_client, monkeypatch):
    """Which of their settings changed is theirs to know. The note under the
    reply tells the member, and only them."""
    seed_knowledge()
    http = member()
    turn_on_sprout(http)
    real = SproutPermissionService.personalizes
    monkeypatch.setattr(SproutPermissionService, "personalizes", lambda self, member_id, *, hold=False, under=None: False if hold else real(self, member_id))
    answer = ask(http)
    assert answer["reply"] == TURNED_OFF_MEANWHILE and answer["health_context"] == "off"
    monitoring = admin_client.get("/api/v1/admin/companion/advanced/ai-monitoring").json()
    said = admin_client.get(f"{CONVERSATIONS}/{answer['conversation_id']}").text + str(monitoring)
    assert "personaliz" not in said.lower() and "settings_changed" in said


def test_switched_off_while_the_model_is_writing_the_answer_is_set_aside(admin_client, monkeypatch):
    """(A real second connection does this on PostgreSQL below.)"""
    seed_knowledge()
    http = member()
    turn_on_sprout(http)
    real, looks = SproutPermissionService.personalizes, []

    def personalizes(self, member_id, *, hold=False, under=None):
        looks.append(hold)
        return False if hold else real(self, member_id)

    monkeypatch.setattr(SproutPermissionService, "personalizes", personalizes)
    answer = ask(http)
    assert looks[-1] is True
    assert answer["reply"] == TURNED_OFF_MEANWHILE and answer["outcome"] == "unavailable"
    assert answer["context_scopes"] == [] and answer["health_context"] == "off"
    with SessionLocal() as db:
        kept = db.get(CompanionMessage, UUID(answer["reply_message_id"]))
        assert kept.personal is False and FROM_RECORDS not in kept.content


def test_a_member_who_asked_to_be_deleted_or_was_archived_gives_sprout_nothing(admin_client):
    http = member()
    turn_on_sprout(http)
    mid = UUID(member_id_of(http))
    from datetime import datetime, timezone

    for column in ("erasure_requested_at", "archived_at"):
        with SessionLocal() as db:
            assert SproutPermissionService(db).personalizes(mid) is True
            setattr(db.get(Member, mid), column, datetime.now(timezone.utc))
            db.commit()
            assert SproutPermissionService(db).personalizes(mid) is False, column
            setattr(db.get(Member, mid), column, None)
            db.commit()


# ---- an outside AI company is a third question, and the answer is no -----------------------

class Outside(MockLLMProvider):
    name = "outside"

    def describe(self):
        return {"provider": self.name, "external": True}


def test_a_real_members_information_stays_out_of_a_prompt_that_leaves_veye(admin_client):
    """Turning Sprout on is not permission for an outside company, however that
    company's adapter has been configured or cleared."""
    seed_knowledge()
    configure_runtime(llm=Outside())
    http = member()
    turn_on_sprout(http)
    answer = ask(http)
    assert answer["health_context"] == "restricted" and answer["context_scopes"] == []
    assert "result(s); latest" not in prompt()
    tip = http.get(TIP).json()
    assert tip["generated"] is False and len(get_runtime().llm.requests) == 1, "no tip was asked for either"


def test_words_that_let_one_in_do_not_reach_back_to_those_who_agreed_before(admin_client, monkeypatch):
    """Second review: on the day the terms cover an outside company, a yes to
    the words that said they did not would have let it in."""
    from app.companion import context as contexts
    from app.sprout_permission.models import MemberSproutPermission

    seed_knowledge()
    configure_runtime(llm=Outside())
    http = member()
    turn_on_sprout(http)
    monkeypatch.setattr(contexts, "COVERS_OUTSIDE_AI", True)
    assert ask(http)["health_context"] == "used", "agreed to these words"
    with SessionLocal() as db:
        db.query(MemberSproutPermission).one().policy_version = "sprout-personalization-of-before"
        db.commit()
    assert ask(http)["health_context"] == "restricted" and "result(s); latest" not in prompt()


def test_an_earlier_answer_is_not_carried_to_an_outside_company_either(admin_client):
    seed_knowledge()
    http = member()
    turn_on_sprout(http)
    assert FROM_RECORDS in ask(http)["reply"]
    configure_runtime(llm=Outside())
    ask(http, "What should I eat for lunch?")
    assert FROM_RECORDS not in prompt()


def test_a_synthetic_member_may_be_used_to_exercise_an_outside_adapter(admin_client):
    from app.auth.models import UserAccount

    seed_knowledge()
    configure_runtime(llm=Outside())
    http = member()
    with SessionLocal() as db:
        db.query(UserAccount).filter(UserAccount.email == http.account["email"]).one().is_synthetic = True
        db.commit()
    assert ask(http)["health_context"] == "off", "being synthetic is not consent"
    turn_on_sprout(http)
    assert ask(http)["health_context"] == "used"


def test_a_provider_that_does_not_say_is_treated_as_outside():
    class Silent:
        def describe(self):
            return {"provider": "silent"}

    assert leaves_veye(Silent()) is True and leaves_veye(MockLLMProvider()) is False


def test_the_development_adapter_refuses_a_real_members_conversation():
    adapter = GroqLLMProvider.__new__(GroqLLMProvider)      # no key, no network
    adapter.model = "x"
    request = LLMRequest(system="s", messages=(LLMMessage("user", "hello"),), classification=DataClassification.REAL_MEMBER)
    with pytest.raises(ProviderNotConfigured):
        adapter.complete(request)


# ---- what else the choice reaches -----------------------------------------------------------

def test_the_members_own_copy_carries_it_and_deletion_removes_it(admin_client):
    http = member()
    turn_on_sprout(http)
    http.post(REVOKE)
    exported = http.get("/api/v1/members/me/export").json()["sprout_personalization"]
    assert exported["state"] == "turned_off" and [e["to_state"] for e in exported["history"]] == ["on", "turned_off"]
    assert exported["policy_version"] == POLICY_VERSION
    assert member("sprout.two@demo.veye.test").get("/api/v1/members/me/export").json()["sprout_personalization"] == {
        "state": "off", "history": []}


def test_two_first_looks_at_the_team_choice_make_one_row(client):
    """The team's row is made on first sight, and two tabs can look at once."""
    http = member()
    mid = UUID(member_id_of(http))
    with SessionLocal() as one, SessionLocal() as two:
        assert HealthPermissionService(one).current(mid) is None and HealthPermissionService(two).current(mid) is None
        HealthPermissionService(one).for_member(mid)
        one.commit()
        assert HealthPermissionService(two).for_member(mid).state == "not_requested"
        two.commit()
        assert two.query(MemberHealthPermission).count() == 1


# ---- at the same moment, on the database it runs on ------------------------------------------

def _pg_member(make_session):
    from app.auth.service import AuthService, SignUpInput
    from app.core.config import settings

    with make_session() as db:
        service = AuthService(db, get_runtime().auth_provider, NotificationService(db, NoEmailProvider()), settings)
        user = service.create_member_account(
            SignUpInput(first_name="Robin", last_name="Demo", email="pg.robin@demo.veye.test", password="correct-horse-battery"),
            email_verified=True)
        db.commit()
        return user.id, user.member_id


def _at_once(*calls):
    """Run each call in its own thread, all released together; their results in order."""
    gate = threading.Barrier(len(calls))
    results: list = [None] * len(calls)

    def run(i, call):
        gate.wait()
        try:
            results[i] = call()
        except Exception as exc:  # noqa: BLE001 - the test reports whatever happened
            results[i] = exc

    threads = [threading.Thread(target=run, args=(i, call)) for i, call in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert not any(t.is_alive() for t in threads), "two changes locked each other out"
    return results


def test_eight_tabs_turning_it_on_at_once_are_one_decision(pg_sessionmaker):  # noqa: F811
    user_id, mid = _pg_member(pg_sessionmaker)

    def turn_on():
        with pg_sessionmaker() as db:
            SproutPermissionService(db).grant(mid, by_user_id=user_id, by_name="Robin Demo", terms=current_terms())
            db.commit()

    assert _at_once(*[turn_on] * 8) == [None] * 8
    with pg_sessionmaker() as db:
        assert db.query(MemberSproutPermission).count() == 1
        assert [e.to_state for e in db.query(MemberSproutPermissionEvent)] == ["on"]


def test_on_and_off_at_once_leave_one_true_answer_and_an_unbroken_history(pg_sessionmaker):  # noqa: F811
    user_id, mid = _pg_member(pg_sessionmaker)

    def turn(on: bool):
        def call():
            with pg_sessionmaker() as db:
                service = SproutPermissionService(db)
                if on:
                    service.grant(mid, by_user_id=user_id, by_name="Robin Demo", terms=current_terms())
                else:
                    service.revoke(mid, by_user_id=user_id, by_name="Robin Demo")
                db.commit()
        return call

    for _ in range(4):
        assert _at_once(turn(True), turn(False), turn(True), turn(False)) == [None] * 4
    with pg_sessionmaker() as db:
        row = db.query(MemberSproutPermission).one()
        events = db.query(MemberSproutPermissionEvent).order_by(MemberSproutPermissionEvent.created_at).all()
        states = ["off"] + [e.to_state for e in events]
        assert [e.from_state for e in events] == states[:-1], "each change started from where the last one ended"
        assert row.state == states[-1]


def test_both_choices_at_once_do_not_disturb_each_other(pg_sessionmaker):  # noqa: F811
    user_id, mid = _pg_member(pg_sessionmaker)

    def team():
        with pg_sessionmaker() as db:
            HealthPermissionService(db).grant(mid, by_user_id=user_id, by_name="Robin Demo")
            db.commit()

    def sprout():
        with pg_sessionmaker() as db:
            SproutPermissionService(db).grant(mid, by_user_id=user_id, by_name="Robin Demo", terms=current_terms())
            db.commit()

    assert _at_once(team, sprout, team, sprout) == [None] * 4
    with pg_sessionmaker() as db:
        assert HealthPermissionService(db).shares_health_data(mid) and SproutPermissionService(db).personalizes(mid)
        assert db.query(MemberHealthPermission).count() == db.query(MemberSproutPermission).count() == 1
        assert len(db.query(MemberHealthPermissionEvent).all()) == 1, "two tabs granting the team are one decision"


class Paused(MockLLMProvider):
    """A model that has been asked and has not answered yet."""

    def __init__(self):
        super().__init__()
        self.asked, self.answer = threading.Event(), threading.Event()

    def complete(self, request):
        self.asked.set()
        assert self.answer.wait(15)
        return super().complete(request)


def _principal(make_session, user_id):
    from app.auth.models import UserAccount
    from app.auth.provider import principal_for

    with make_session() as db:
        return principal_for(db.get(UserAccount, user_id), None, portal="member")


def test_a_member_who_switches_off_while_sprout_is_writing_gets_none_of_it(pg_sessionmaker):  # noqa: F811
    from app.assessments.repository import record_health_number_attempt
    from app.assessments.schemas import HealthNumberAnswers

    user_id, mid = _pg_member(pg_sessionmaker)
    with pg_sessionmaker() as db:
        record_health_number_attempt(db, mid, HealthNumberAnswers(**ANSWERS))
        SproutPermissionService(db).grant(mid, by_user_id=user_id, by_name="Robin Demo", terms=current_terms())
        db.commit()
    model = Paused()
    runtime = get_runtime()
    configure_runtime(llm=model)
    principal = _principal(pg_sessionmaker, user_id)
    out: dict = {}

    def converse():
        with pg_sessionmaker() as db:
            reply = CompanionService(db, get_runtime(), NotificationService(db, NoEmailProvider())).ask(principal, QUESTION)
            db.commit()
            out["reply"] = reply

    talking = threading.Thread(target=converse)
    talking.start()
    try:
        assert model.asked.wait(15), "the model was never asked"
        with pg_sessionmaker() as db:   # the member, in Settings, meanwhile
            SproutPermissionService(db).revoke(mid, by_user_id=user_id, by_name="Robin Demo")
            db.commit()
    finally:
        model.answer.set()
        talking.join(15)
    assert "result(s); latest" in model.last_request.system, "the record really was in front of the model"
    assert out["reply"].reply == TURNED_OFF_MEANWHILE and out["reply"].context_scopes == []
    with pg_sessionmaker() as db:
        kept = db.query(CompanionMessage).filter(CompanionMessage.role == "sprout").one()
        assert kept.personal is False and FROM_RECORDS not in kept.content
    configure_runtime(llm=runtime.llm)


def _switch_off(make_session, user_id, member_id) -> tuple[threading.Thread, threading.Event]:
    done = threading.Event()

    def switch_off():
        with make_session() as db:
            SproutPermissionService(db).revoke(member_id, by_user_id=user_id, by_name="Robin Demo")
            db.commit()
        done.set()

    return threading.Thread(target=switch_off), done


def test_a_reply_holds_the_choice_until_it_is_saved(pg_sessionmaker, monkeypatch):  # noqa: F811
    """The same wait, in a real conversation: between reading the choice again
    and saving the reply, switching off waits its turn."""
    from app.assessments.repository import record_health_number_attempt
    from app.assessments.schemas import HealthNumberAnswers
    from app.companion.safety import OutputSafety

    user_id, mid = _pg_member(pg_sessionmaker)
    with pg_sessionmaker() as db:
        record_health_number_attempt(db, mid, HealthNumberAnswers(**ANSWERS))
        SproutPermissionService(db).grant(mid, by_user_id=user_id, by_name="Robin Demo", terms=current_terms())
        db.commit()
    runtime = get_runtime()
    configure_runtime(llm=MockLLMProvider())
    principal = _principal(pg_sessionmaker, user_id)
    read_again, save = threading.Event(), threading.Event()
    check, out = OutputSafety.check, {}

    def paused(self, text):
        read_again.set()
        assert save.wait(15)
        return check(self, text)

    monkeypatch.setattr(OutputSafety, "check", paused)

    def converse():
        with pg_sessionmaker() as db:
            out["reply"] = CompanionService(db, get_runtime(), NotificationService(db, NoEmailProvider())).ask(principal, QUESTION)
            db.commit()

    talking = threading.Thread(target=converse)
    off, done = _switch_off(pg_sessionmaker, user_id, mid)
    talking.start()
    try:
        assert read_again.wait(15), "the reply was never written"
        off.start()
        assert not done.wait(1.0), "it switched off between the check and the save"
    finally:
        save.set()
        talking.join(15)
    assert done.wait(10)
    off.join(5)
    assert out["reply"].context_scopes, "it was still on when this reply was saved"
    configure_runtime(llm=runtime.llm)


def test_switching_off_waits_for_an_answer_that_is_being_saved(pg_sessionmaker):  # noqa: F811
    """So when "off" has returned, nothing written from their information can
    still arrive. Without the wait it could be saved a moment after."""
    user_id, mid = _pg_member(pg_sessionmaker)
    with pg_sessionmaker() as db:
        SproutPermissionService(db).grant(mid, by_user_id=user_id, by_name="Robin Demo", terms=current_terms())
        db.commit()
    thread, done = _switch_off(pg_sessionmaker, user_id, mid)
    with pg_sessionmaker() as saving:
        assert SproutPermissionService(saving).personalizes(mid, hold=True) is True
        thread.start()
        assert not done.wait(1.0), "it switched off in the middle of an answer being saved"
        saving.add(MemberPersonalTip(member_id=mid, text="Written just before.", context_fingerprint="x", tip_version="x", provider="mock"))
        saving.commit()
        assert done.wait(10)
        thread.join(5)
    with pg_sessionmaker() as db:
        assert db.query(MemberPersonalTip).count() == 0, "the tip saved just before went with the choice"


# ---- what the upgrade does to members who are already here --------------------------------------

UPGRADE_DB = "veye_sprout_upgrade"


@pytest.fixture
def before_the_upgrade():
    """A database at the revision before this one, with members in it."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    url = f"{PG_ADMIN_URL.rpartition('/')[0]}/{UPGRADE_DB}"
    admin = create_engine(PG_ADMIN_URL, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{UPGRADE_DB}" WITH (FORCE)'))
            conn.execute(text(f'CREATE DATABASE "{UPGRADE_DB}"'))
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"PostgreSQL is not reachable: {exc}")
    engine = create_engine(url, pool_pre_ping=True)
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    def migrate(direction: str, revision: str) -> None:
        run = subprocess.run([sys.executable, "-m", "alembic", direction, revision], cwd=str(Path(__file__).resolve().parents[1]),
                             capture_output=True, text=True, env={**os.environ, "VEYE_DATABASE_URL": url})
        assert run.returncode == 0, run.stdout[-1500:] + run.stderr[-1500:]

    migrate("upgrade", "20261125_0031")
    try:
        yield engine, migrate
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{UPGRADE_DB}" WITH (FORCE)'))
        admin.dispose()


def test_the_upgrade_carries_nobody_over_and_keeps_what_they_had_chosen(before_the_upgrade):
    engine, migrate = before_the_upgrade
    shares, quiet = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
    conversation = "33333333-3333-4333-8333-333333333333"
    with engine.begin() as conn:
        for mid, email in ((shares, "shares@demo.veye.test"), (quiet, "quiet@demo.veye.test")):
            conn.execute(text("INSERT INTO members (id, email, display_name, created_at) VALUES (:i, :e, 'Demo', now())"), {"i": mid, "e": email})
            conn.execute(text("INSERT INTO member_personal_tips (id, member_id, text, context_fingerprint, tip_version, provider, created_at) "
                              "VALUES (gen_random_uuid(), :i, 'You logged most days.', 'x', 'x', 'mock', now())"), {"i": mid})
        conn.execute(text("INSERT INTO member_health_permissions (id, member_id, state, policy_version, requested_by_name, decided_at, created_at, updated_at) "
                          "VALUES (gen_random_uuid(), :i, 'granted', 'health-sharing-2026-11-25-v3', '', now(), now(), now())"), {"i": shares})
        conn.execute(text("INSERT INTO companion_conversations (id, member_id, started_at, last_message_at, status, flagged, message_count) "
                          "VALUES (:c, :i, now(), now(), 'open', false, 4)"), {"c": conversation, "i": shares})
        for content, role, scopes in (("How am I doing?", "member", "[]"), ("From your saved results: 4.5", "sprout", '["health_number_summary"]'),
                                      ("Sign in from the home page.", "sprout", "[]"), ("Odd row", "sprout", "null")):
            conn.execute(text("INSERT INTO companion_messages (id, conversation_id, role, content, context_scopes, created_at) "
                              "VALUES (gen_random_uuid(), :c, :r, :t, CAST(:s AS jsonb), now())"),
                         {"c": conversation, "r": role, "t": content, "s": scopes})
    migrate("upgrade", "20261125_0032")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM member_sprout_permissions")).scalar() == 0, "nobody was carried over"
        assert conn.execute(text("SELECT count(*) FROM member_sprout_permission_events")).scalar() == 0
        team = conn.execute(text("SELECT state, policy_version FROM member_health_permissions")).one()
        assert tuple(team) == ("granted", "health-sharing-2026-11-25-v3"), "what they chose about the team stands, under the words they chose it"
        marked = dict(conn.execute(text("SELECT content, personal FROM companion_messages")).all())
        assert marked == {"How am I doing?": False, "From your saved results: 4.5": True, "Sign in from the home page.": False, "Odd row": False}
        assert conn.execute(text("SELECT count(*) FROM member_personal_tips")).scalar() == 0, "written under the old combined choice"
        # A later answer may repeat what an earlier one said of their records.
        for content, provider, when in (("You said 4.5 earlier.", "mock", "now() + interval '1 minute'"), ("Handed over.", None, "now() + interval '2 minutes'")):
            conn.execute(text("INSERT INTO companion_messages (id, conversation_id, role, content, context_scopes, provider, created_at) "
                              f"VALUES (gen_random_uuid(), :c, 'sprout', :t, '[]', :p, {when})"), {"c": conversation, "t": content, "p": provider})
        conn.commit()
    migrate("upgrade", "20261125_0033")
    with engine.connect() as conn:
        marked = dict(conn.execute(text("SELECT content, personal FROM companion_messages WHERE role = 'sprout'")).all())
        assert marked["You said 4.5 earlier."] is True and marked["Handed over."] is False, "a model wrote the first, nobody's records the second"
        assert marked["Sign in from the home page."] is False, "said in the same moment or before, and not from it"
        assert conn.execute(text("SELECT alerted FROM companion_conversations")).scalar() == {}
    migrate("downgrade", "20261125_0031")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM companion_messages")).scalar() == 6
        assert conn.execute(text("SELECT state FROM member_health_permissions")).scalar() == "granted"
