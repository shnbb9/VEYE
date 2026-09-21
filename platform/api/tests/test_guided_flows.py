"""Guided flows: Cara's two decision trees, exhaustively.

Every branch of both definitions is exercised deterministically (explicit
choices, mock provider, no external model); versioning, pause/resume, skip,
completion, member-state awareness, UI-action allowlisting, in-flow RAG and
the admin surface are covered as well."""

from __future__ import annotations

import copy

import pytest

from app.db.session import SessionLocal
from app.guided_flows.catalog import BUILTIN_DEFINITIONS, BUILTIN_KEYS, ensure_builtin_flows
from app.guided_flows.definitions.first_time_user import DEFINITION as FIRST
from app.guided_flows.definitions.progress_tracker_guide import DEFINITION as GUIDE
from app.guided_flows.engine import ACTION_TYPES, CHOICE, CHECK_MEMBER_STATE, COMPLETE, MEMBER_STATES, FlowDefinitionError, GuidedFlowDefinition
from app.guided_flows.interpreter import interpret
from app.guided_flows.member_state import MemberStateService
from app.guided_flows.models import STATUS_ACTIVE, STATUS_ARCHIVED, STATUS_DRAFT, GuidedFlow, MemberGuidedFlowSession
from app.seed.knowledge import seed_knowledge
from tests.conftest import sign_up

BASE = "/api/v1/companion/guided-flows"
FT = f"{BASE}/first_time_user"
PG = f"{BASE}/progress_tracker_guide"


def _definition(data: dict) -> GuidedFlowDefinition:
    return GuidedFlowDefinition(copy.deepcopy(data), known_flow_keys=BUILTIN_KEYS)


@pytest.fixture
def flows():
    with SessionLocal() as db:
        outcome = ensure_builtin_flows(db)
        db.commit()
    return outcome


@pytest.fixture
def member(client, flows):
    response = sign_up(client, email="asha.demo@demo.veye.test", first_name="Asha", last_name="Demo")
    assert response.status_code == 201, response.text
    client.account = response.json()["account"]
    return client


def start(client, key=FT):
    response = client.post(f"{key}/start")
    assert response.status_code == 200, response.text
    return response.json()


def answer(client, key=FT, **payload):
    response = client.post(f"{key}/answer", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def node_id(step: dict) -> str | None:
    return step["node"]["id"] if step.get("node") else None


# =============================================================== definitions & engine
class TestDefinitions:
    def test_builtin_definitions_are_valid_and_complete(self, flows):
        for data in BUILTIN_DEFINITIONS:
            definition = _definition(data)
            definition.validate()
            # no undefined node, every branch lands on a defined node, every node reaches COMPLETE
            for _, _, to_node in definition.edges():
                assert to_node in definition.nodes
            assert any(n["type"] == COMPLETE for n in definition.nodes.values())
        assert set(flows) == {"first_time_user v1", "progress_tracker_guide v1"}
        assert all(v.startswith("created (Active)") for v in flows.values())

    def test_first_time_tree_shape_matches_cara_document(self):
        nodes = FIRST["nodes"]
        basics = [k for k, n in nodes.items() if n["section"] == "basics" and n["type"] == CHOICE and k.startswith("b") and k[1:].isdigit()]
        advanced = [k for k, n in nodes.items() if n["section"] == "advanced" and k.startswith("a") and k[1:].isdigit()]
        tips = [k for k, n in nodes.items() if n["section"] == "tips" and k.startswith("t") and k[1:].isdigit()]
        assert len(basics) == 13 and len(advanced) == 9 and len(tips) == 8
        assert nodes["intro"]["text"].startswith("Welcome to the Veye program.")
        assert nodes["b1"]["choices"][1]["next"] == "b_to_how_to"          # first basics 'no' goes straight to HOW TO
        assert all(nodes[f"b{i}"]["choices"][1]["next"] == "b_ready_foods" for i in range(2, 13))
        assert nodes["b13"]["choices"][0]["next"] == "a1" and nodes["b13"]["choices"][1]["next"] == "b_tips_offer"
        assert all(nodes[f"a{i}"]["choices"][1]["next"] == "a_tips_offer" for i in range(1, 9))
        assert nodes["a9"]["choices"] == [{"key": "yes", "label": "Yes", "next": "t1"}, {"key": "no", "label": "No", "next": "a_ready_meals"}]
        assert nodes["t_break"]["pause"] is True and nodes["t_break"]["next"] == "t8"
        assert nodes["how_to"]["type"] == "AI_TASK" and nodes["how_to"]["copy_origin"] == "derived"
        # client copy is marked as client copy, and the education content is flagged pending review
        assert nodes["b5"]["copy_origin"] == "client" and "whole grain bagel" in nodes["b5"]["text"]
        assert FIRST["content_meta"]["client_supplied"] is True and FIRST["content_meta"]["clinical_review_status"] == "pending"
        assert FIRST["content_meta"]["source_version"] == "260627"

    def test_progress_tree_shape_matches_cara_document(self):
        nodes = GUIDE["nodes"]
        assert nodes["labs_q"]["text"].endswith("Do you have any recent lab results you can enter?")
        assert nodes["labs_q"]["choices"][0]["next"] == "blood_nav" and nodes["labs_q"]["choices"][1]["next"] == "bmi_check"
        assert nodes["blood_nav"]["action"] == {"type": "OPEN_TRACKER", "target": "blood_markers"}
        assert nodes["hsr_after_bmi_no"]["text"].startswith("Many people do not have blood tests available")
        assert nodes["sq_suggest"]["text"].startswith("I suggest you take the Simple Quiz")
        assert nodes["food_choices_offer"]["choices"][1]["next"] == "intro_handoff"
        assert nodes["intro_handoff"]["action"] == {"type": "START_FLOW", "target": "first_time_user"}
        assert GUIDE["content_meta"]["aliases"]["health_assessment"] == ["Health Status Report", "HSR", "Health Questionnaire"]

    def test_every_action_is_allowlisted(self):
        for data in BUILTIN_DEFINITIONS:
            for node in data["nodes"].values():
                if node["type"] == "NAVIGATION":
                    action = node["action"]
                    assert action["type"] in ACTION_TYPES
                    rule = ACTION_TYPES[action["type"]]
                    if rule is None:
                        assert "target" not in action
                    elif rule == "flow_key":
                        assert action["target"] in BUILTIN_KEYS
                    else:
                        assert action["target"] in rule
                    assert "url" not in action and "href" not in action

    def test_validation_rejects_undefined_dead_and_unallowed(self):
        broken = copy.deepcopy(FIRST)
        broken["nodes"]["b2"]["choices"][0]["next"] = "nowhere"
        with pytest.raises(FlowDefinitionError, match="undefined"):
            _definition(broken).validate()
        dead = copy.deepcopy(FIRST)
        dead["nodes"]["orphan"] = {"type": "MESSAGE", "section": "basics", "text": "x", "next": "orphan"}
        with pytest.raises(FlowDefinitionError, match="unreachable|dead branch"):
            _definition(dead).validate()
        url_action = copy.deepcopy(GUIDE)
        url_action["nodes"]["blood_nav"]["action"] = {"type": "OPEN_URL", "url": "https://example.com"}
        with pytest.raises(FlowDefinitionError, match="not an allowed UI action"):
            _definition(url_action).validate()
        bad_state = copy.deepcopy(GUIDE)
        bad_state["nodes"]["bmi_check"]["check"]["state"] = "has_anything"
        with pytest.raises(FlowDefinitionError, match="unknown member state"):
            _definition(bad_state).validate()

    def test_engine_walks_every_edge(self):
        for data in BUILTIN_DEFINITIONS:
            definition = _definition(data)
            for from_node, via, to_node in definition.edges():
                node = definition.node(from_node)
                if node["type"] == CHECK_MEMBER_STATE:
                    state_name, value = via.split("=")
                    result = definition.transition(from_node, state={state_name: value == "true"})
                elif node["type"] in (CHOICE, "AI_TASK"):
                    result = definition.transition(from_node, via)
                else:
                    result = definition.transition(from_node)
                assert result.next_node == to_node, (data["key"], from_node, via)

    def test_member_state_service_answers_exactly_the_engine_questions(self, member):
        with SessionLocal() as db:
            account = member.account
            from app.auth.models import UserAccount
            user = db.query(UserAccount).filter(UserAccount.email == account["email"]).one()
            snapshot = MemberStateService(db).snapshot(user.member_id)
        assert set(snapshot) == set(MEMBER_STATES)
        assert snapshot["has_blood_markers"] is False and snapshot["has_health_assessment"] is False
        # Connected trackers (19 Sep 2026): the guide opens them for real.
        assert snapshot["health_assessment_available"] is True and snapshot["simple_quiz_available"] is True
        assert snapshot["food_choices_available"] is False  # still no production slice

    def test_interpreter_is_deterministic_and_never_invents(self):
        yes_no = FIRST["nodes"]["b2"]["choices"]
        assert interpret("yes please", yes_no).choice_key == "yes"
        assert interpret("Nope.", yes_no).choice_key == "no"
        assert interpret("not now thanks", yes_no).choice_key == "no"
        assert interpret("banana", yes_no).choice_key is None
        assert interpret("hmm not sure what you mean", yes_no).choice_key is None   # "not" must not read as "no"
        assert interpret("I know what you mean", yes_no).choice_key is None
        assert interpret("yes, I know", yes_no).choice_key == "yes"
        assert interpret("explore the concepts", FIRST["nodes"]["b13"]["choices"]).choice_key == "explore_concepts"
        assert interpret("the basics please", FIRST["nodes"]["t_review"]["choices"]).choice_key == "basics"
        assert interpret("the why to", FIRST["nodes"]["intro"]["choices"]).choice_key == "why_to"
        assert interpret("something else entirely", FIRST["nodes"]["t_review"]["choices"]).choice_key is None


# =============================================================== first-time flow (API)
class TestFirstTimeFlow:
    def test_offer_then_guide_me_starts_at_the_intro(self, member):
        overview = member.get(BASE).json()
        assert overview["first_arrival_offer"] is True
        assert {f["key"] for f in overview["flows"]} == {"first_time_user", "progress_tracker_guide"}
        step = start(member)
        assert step["status"] == "in_progress" and node_id(step) == "intro" and step["flow_version"] == 1
        assert [c["key"] for c in step["node"]["choices"]] == ["why_to", "how_to"]
        assert step["content_meta"]["clinical_review_status"] == "pending"
        assert member.get(BASE).json()["first_arrival_offer"] is False

    def test_explore_on_my_own_uses_caras_message_and_settles_the_offer(self, member):
        step = member.post(f"{FT}/skip").json()
        assert step["status"] == "skipped" and step["node"] is None
        assert step["messages"][0].startswith("Great, if you want my assistance start a conversation with me in the Veye Bot.")
        overview = member.get(BASE).json()
        assert overview["first_arrival_offer"] is False
        # Sprout stays available: the member can still start either flow later
        later = start(member)
        assert node_id(later) == "intro" and later["session_id"] != step["session_id"]
        assert node_id(start(member, PG)) == "labs_q"

    def test_how_to_from_the_intro_reaches_the_ai_boundary(self, member):
        start(member)
        step = answer(member, choice="how_to")
        assert step["node"]["type"] == "AI_TASK" and step["node"]["task"] == "how_to_meal_planning"
        assert "not connected in the Veye application yet" in step["node"]["text"]
        finished = answer(member, choice="finish")
        assert finished["status"] == "completed" and finished["node"]["type"] == "COMPLETE"
        assert member.post(f"{FT}/answer", json={"choice": "finish"}).status_code == 409

    def test_why_to_full_yes_path_through_basics_advanced_and_tips(self, member):
        start(member)
        step = answer(member, choice="why_to")
        assert node_id(step) == "b1" and step["section_title"].startswith("WHY TO — Basics")
        for i in range(1, 13):
            assert node_id(step) == f"b{i}"
            step = answer(member, choice="yes")
        assert node_id(step) == "b13"
        step = answer(member, choice="explore_concepts")
        for i in range(1, 9):
            assert node_id(step) == f"a{i}" and step["section_title"].startswith("WHY TO — Advanced")
            step = answer(member, choice="yes")
        assert node_id(step) == "a9"
        step = answer(member, choice="yes")  # general tips before creating the program
        for i in range(1, 8):
            assert node_id(step) == f"t{i}" and step["node"]["type"] == "QUESTION"
            step = answer(member, text="I think so")  # every response advances a tip
        assert node_id(step) == "t8"
        step = answer(member, choice="yes")
        assert step["node"]["type"] == "AI_TASK"
        step = answer(member, choice="open_food_choices")
        assert step["actions"] == [{"type": "OPEN_FOOD_CHOICES", "target": None}]
        assert step["status"] == "completed" and step["node"]["type"] == "COMPLETE"
        assert step["steps_taken"] == 1 + 12 + 1 + 8 + 1 + 7 + 1 + 1

    def test_first_basics_no_goes_straight_to_how_to_with_caras_line(self, member):
        start(member); answer(member, choice="why_to")
        step = answer(member, choice="no")
        assert step["messages"] == ["let’s go to the HOW TO section and start your meal plan."]
        assert step["node"]["type"] == "AI_TASK"

    @pytest.mark.parametrize("stop_at", list(range(2, 13)))
    def test_every_basics_no_exit_offers_food_choices_then_start_over(self, member, stop_at):
        start(member); step = answer(member, choice="why_to")
        for _ in range(1, stop_at):
            step = answer(member, choice="yes")
        assert node_id(step) == f"b{stop_at}"
        step = answer(member, choice="no")
        assert node_id(step) == "b_ready_foods" and step["node"]["text"] == "Are you ready to start choosing foods?"
        step = answer(member, choice="no")
        assert step["messages"] == ["Let’s start over"] and node_id(step) == "b1"
        # and the YES exit of the same question reaches HOW TO
        step = answer(member, choice="no")  # b1 no -> straight to HOW TO per the document
        assert step["node"]["type"] == "AI_TASK"

    def test_basics_ready_foods_yes_reaches_how_to(self, member):
        start(member); answer(member, choice="why_to"); answer(member, choice="yes")  # at b2
        answer(member, choice="no")  # -> b_ready_foods
        step = answer(member, choice="yes")
        assert step["node"]["type"] == "AI_TASK"

    def test_basics_end_how_to_branch_tips_offer_and_ready_meals(self, member):
        start(member); step = answer(member, choice="why_to")
        for _ in range(12):
            step = answer(member, choice="yes")
        assert node_id(step) == "b13"
        step = answer(member, choice="how_to")
        assert node_id(step) == "b_tips_offer" and step["node"]["text"] == "Would you like some general tips before we start the “how to?”"
        step = answer(member, choice="no")
        assert node_id(step) == "b_ready_meals"
        step = answer(member, choice="no")
        assert step["messages"] == ["Let’s start over"] and node_id(step) == "b1"
        # tips offer yes -> tips
        for _ in range(12):
            step = answer(member, choice="yes")
        answer(member, choice="how_to")
        assert node_id(answer(member, choice="yes")) == "t1"

    def test_basics_ready_meals_yes_reaches_how_to(self, member):
        start(member); step = answer(member, choice="why_to")
        for _ in range(12):
            step = answer(member, choice="yes")
        answer(member, choice="how_to"); answer(member, choice="no")
        assert answer(member, choice="yes")["node"]["type"] == "AI_TASK"

    @pytest.mark.parametrize("stop_at", list(range(1, 9)))
    def test_every_advanced_no_exit(self, member, stop_at):
        start(member); step = answer(member, choice="why_to")
        for _ in range(12):
            step = answer(member, choice="yes")
        step = answer(member, choice="explore_concepts")
        for _ in range(1, stop_at):
            step = answer(member, choice="yes")
        assert node_id(step) == f"a{stop_at}"
        step = answer(member, choice="no")
        assert node_id(step) == "a_tips_offer"
        step = answer(member, choice="no")
        assert node_id(step) == "a_ready_meals" and step["node"]["text"] == "Are you ready to start choosing foods and creating meals?"
        step = answer(member, choice="no")
        assert step["messages"] == ["Let’s start over"] and node_id(step) == "a1"
        # the other exits
        step = answer(member, choice="no"); assert node_id(step) == "a_tips_offer"
        step = answer(member, choice="yes"); assert node_id(step) == "t1"

    def test_advanced_ready_meals_yes_and_a9_no_paths(self, member):
        start(member); step = answer(member, choice="why_to")
        for _ in range(12):
            step = answer(member, choice="yes")
        step = answer(member, choice="explore_concepts")
        for _ in range(8):
            step = answer(member, choice="yes")
        assert node_id(step) == "a9"
        step = answer(member, choice="no")
        assert node_id(step) == "a_ready_meals"
        step = answer(member, choice="yes")
        assert step["node"]["type"] == "AI_TASK"

    def test_tips_final_review_options_and_break_pauses_and_resumes(self, member):
        start(member); answer(member, choice="why_to"); answer(member, choice="no")  # b1 no -> AI boundary; use tips via restart path instead
        member.post(f"{FT}/restart")
        answer(member, choice="why_to")
        step = None
        for _ in range(12):
            step = answer(member, choice="yes")
        answer(member, choice="how_to"); step = answer(member, choice="yes")  # tips
        for _ in range(7):
            step = answer(member, choice="yes")  # any response advances
        assert node_id(step) == "t8"
        step = answer(member, choice="no")
        assert node_id(step) == "t_review" and set(c["key"] for c in step["node"]["choices"]) == {"basics", "advanced", "tips", "no"}
        for option, target in (("basics", "b1"), ("advanced", "a1"), ("tips", "t1")):
            step = answer(member, choice=option)
            assert node_id(step) == target, option
            # walk back to t_review for the next option
            member.post(f"{FT}/restart"); answer(member, choice="why_to")
            for _ in range(12):
                answer(member, choice="yes")
            answer(member, choice="how_to"); answer(member, choice="yes")
            for _ in range(7):
                answer(member, choice="yes")
            step = answer(member, choice="no")
        step = answer(member, choice="no")  # take a break
        assert step["status"] == "paused" and step["messages"] == ["Let’s take a break until you are ready to resume."] and step["node"] is None
        current = member.get(f"{FT}/session").json()
        assert current["status"] == "paused"
        resumed = start(member)
        assert resumed["status"] == "in_progress" and node_id(resumed) == "t8"

    def test_pause_and_resume_keep_the_step_and_the_version(self, member):
        start(member); answer(member, choice="why_to"); answer(member, choice="yes")
        paused = member.post(f"{FT}/pause").json()
        assert paused["status"] == "paused" and node_id(paused) == "b2"
        assert member.get(f"{FT}/session").json()["status"] == "paused"
        resumed = start(member)
        assert resumed["status"] == "in_progress" and node_id(resumed) == "b2" and resumed["flow_version"] == 1
        overview = member.get(BASE).json()
        first = next(f for f in overview["flows"] if f["key"] == "first_time_user")
        assert first["session"]["status"] == "in_progress" and first["session"]["current_node"] == "b2"

    def test_free_text_maps_to_branches_and_ambiguity_asks_for_clarification(self, member):
        start(member)
        step = answer(member, text="the why to please")
        assert node_id(step) == "b1"
        step = answer(member, text="Yes!")
        assert node_id(step) == "b2"
        unclear = answer(member, text="what a lovely day")
        assert unclear["clarification"] and node_id(unclear) == "b2" and unclear["steps_taken"] == 2
        step = answer(member, text="nope")
        assert node_id(step) == "b_ready_foods"
        assert member.post(f"{FT}/answer", json={"choice": "maybe"}).status_code == 422
        assert member.post(f"{FT}/answer", json={}).status_code == 422

    def test_explanatory_question_mid_step_keeps_the_flow_state(self, member):
        seed_knowledge()
        start(member); answer(member, choice="why_to"); step = answer(member, choice="yes")
        assert node_id(step) == "b2"
        response = member.post(f"{FT}/ask", json={"question": "What does the glycemic index of a carbohydrate tell me?"})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["reply"]["reply"] and data["reply"]["outcome"] in ("answered", "unavailable", "off_topic")
        assert node_id(data["step"]) == "b2" and data["step"]["status"] == "in_progress" and data["step"]["steps_taken"] == 2
        # the question went through the Companion pipeline (a conversation exists) and the step is unchanged afterwards
        conversation = member.get("/api/v1/companion/session").json()["conversation"]
        assert conversation["message_count"] >= 2
        assert node_id(member.get(f"{FT}/session").json()) == "b2"
        with SessionLocal() as db:
            session = db.query(MemberGuidedFlowSession).filter(MemberGuidedFlowSession.flow_key == "first_time_user").one()
            assert session.answers["questions_asked"] == 1
            assert all("text" not in h for h in session.answers["history"])  # free text is never stored


# =============================================================== progress tracker guide (API)
class TestProgressGuide:
    def test_labs_yes_walks_the_full_chain_with_navigation_to_every_connected_tracker(self, member):
        step = start(member, PG)
        assert node_id(step) == "labs_q" and step["section_title"] == "Blood Test Markers"
        step = answer(member, PG, choice="yes")
        assert step["actions"] == [{"type": "OPEN_TRACKER", "target": "blood_markers"}]
        assert node_id(step) == "blood_more_q" and step["node"]["text"] == "Would you like to do more than one progress tracker?"
        step = answer(member, PG, choice="yes")
        assert node_id(step) == "bmi_q"  # no BMI saved yet, so the question is asked
        step = answer(member, PG, choice="yes")
        assert step["actions"] == [{"type": "OPEN_TRACKER", "target": "body_composition"}] and node_id(step) == "bmi_more_q"
        step = answer(member, PG, choice="yes")
        assert node_id(step) == "hsr_q" and step["node"]["text"] == "Would you like to fill in the Health Status Report?"
        step = answer(member, PG, choice="yes")
        # the Health Assessment is a real tracker now: Sprout opens it and the chain continues
        assert step["actions"] == [{"type": "OPEN_TRACKER", "target": "health_assessment"}]
        assert node_id(step) == "sq_after_hsr" and "open the Health Status Report" in step["messages"][0]
        step = answer(member, PG, choice="yes")
        assert step["actions"] == [{"type": "OPEN_TRACKER", "target": "simple_quiz"}] and node_id(step) == "food_choices_q"
        step = answer(member, PG, choice="yes")
        assert step["actions"] == [{"type": "OPEN_FOOD_CHOICES", "target": None}]
        assert step["status"] == "completed" and step["node"]["type"] == "COMPLETE"

    def test_no_labs_no_bmi_no_hsr_no_quiz_no_food_hands_off_to_the_intro_script(self, member):
        start(member, PG)
        step = answer(member, PG, choice="no")
        assert node_id(step) == "bmi_q" and step["node"]["text"] == "Would you like to do a BMI analysis?"
        step = answer(member, PG, choice="no")
        assert node_id(step) == "hsr_after_bmi_no"
        step = answer(member, PG, choice="no")
        assert node_id(step) == "sq_suggest"
        step = answer(member, PG, choice="no")
        assert node_id(step) == "food_choices_offer"
        step = answer(member, PG, choice="no")
        assert step["actions"] == [{"type": "START_FLOW", "target": "first_time_user"}] and step["status"] == "completed"

    def test_hsr_yes_after_bmi_no_and_quiz_suggest_yes(self, member):
        start(member, PG); answer(member, PG, choice="no"); answer(member, PG, choice="no")
        step = answer(member, PG, choice="yes")  # HSR yes -> opens the tracker -> quiz question
        assert node_id(step) == "sq_after_hsr" and step["actions"] == [{"type": "OPEN_TRACKER", "target": "health_assessment"}]
        step = answer(member, PG, choice="no")
        assert node_id(step) == "food_choices_q"
        # quiz suggestion yes
        member.post(f"{PG}/restart"); answer(member, PG, choice="no"); answer(member, PG, choice="no"); answer(member, PG, choice="no")
        step = answer(member, PG, choice="yes")
        assert node_id(step) == "food_choices_q" and step["actions"] == [{"type": "OPEN_TRACKER", "target": "simple_quiz"}]
        # food choices offer yes -> navigation + complete
        member.post(f"{PG}/restart")
        for _ in range(4):
            answer(member, PG, choice="no")
        step = answer(member, PG, choice="yes")
        assert step["actions"] == [{"type": "OPEN_FOOD_CHOICES", "target": None}] and step["status"] == "completed"

    def test_more_trackers_no_and_food_choices_no_wrap_up(self, member):
        start(member, PG); answer(member, PG, choice="yes")
        step = answer(member, PG, choice="no")  # no more trackers
        assert node_id(step) == "food_choices_q"
        step = answer(member, PG, choice="no")
        assert step["status"] == "completed" and step["messages"][0].startswith("That is the end of the progress tracker guide for now.")

    def test_completed_tracker_awareness_skips_the_bmi_question(self, member):
        saved = member.post("/api/v1/body-composition/calculate", json={"input": {"sex": "Woman", "weight": 150, "height": 65, "abdomen": 30, "hips": 40}})
        assert saved.status_code in (200, 201), saved.text
        start(member, PG)
        step = answer(member, PG, choice="no")  # no labs
        assert node_id(step) == "hsr_q"  # BMI already saved: not asked again, chain continues (documented enhancement)
        member.post(f"{PG}/restart"); answer(member, PG, choice="yes")
        step = answer(member, PG, choice="yes")  # more trackers after blood -> straight to HSR
        assert node_id(step) == "hsr_q"

    def test_sq_q_no_and_bmi_more_no_exits(self, member):
        start(member, PG); answer(member, PG, choice="no"); answer(member, PG, choice="yes")  # BMI yes
        step = answer(member, PG, choice="no")  # bmi_more_q no
        assert node_id(step) == "food_choices_q"
        member.post(f"{PG}/restart"); answer(member, PG, choice="no"); answer(member, PG, choice="yes"); answer(member, PG, choice="yes")
        step = answer(member, PG, choice="no")  # hsr_q no -> sq_q
        assert node_id(step) == "sq_q"
        step = answer(member, PG, choice="no")
        assert node_id(step) == "food_choices_q"

    def test_resume_returns_to_the_same_question(self, member):
        start(member, PG); answer(member, PG, choice="no")
        member.post(f"{PG}/pause")
        current = member.get(f"{PG}/session").json()
        assert current["status"] == "paused" and node_id(current) == "bmi_q"
        assert node_id(start(member, PG)) == "bmi_q"
        overview = member.get(BASE).json()
        guide = next(f for f in overview["flows"] if f["key"] == "progress_tracker_guide")
        assert guide["session"]["section_title"] == "BMI Analysis"


# =============================================================== versioning
class TestVersioning:
    def test_sessions_pin_their_version_and_inactive_or_archived_flows_cannot_start(self, member, admin_client):
        start(member); answer(member, choice="why_to")
        # publish v2 with different wording for b1
        with SessionLocal() as db:
            v1 = db.query(GuidedFlow).filter(GuidedFlow.key == "first_time_user", GuidedFlow.version == 1).one()
            v2_def = copy.deepcopy(v1.definition); v2_def["version"] = 2
            v2_def["nodes"]["b1"]["text"] = "REVISED " + v2_def["nodes"]["b1"]["text"]
            v2 = GuidedFlow(key="first_time_user", title=v1.title, version=2, definition=v2_def, status=STATUS_DRAFT, source="test")
            db.add(v2); db.commit(); v2_id, v1_id = str(v2.id), str(v1.id)
        groups = admin_client.get("/api/v1/admin/companion/guided-flows").json()
        first = next(g for g in groups if g["key"] == "first_time_user")
        assert first["active_version"] == 1 and [v["version"] for v in first["versions"]] == [2, 1]
        assert admin_client.post(f"/api/v1/admin/companion/guided-flows/{v2_id}/activate").json()["status"] == STATUS_ACTIVE
        with SessionLocal() as db:
            assert db.get(GuidedFlow, v1.id).status == STATUS_ARCHIVED
        # the member's in-progress session still runs v1 with v1 text
        current = member.get(f"{FT}/session").json()
        assert current["flow_version"] == 1 and node_id(current) == "b1" and not current["node"]["text"].startswith("REVISED")
        step = answer(member, choice="yes")
        assert step["flow_version"] == 1 and node_id(step) == "b2"
        # a new member starts v2
        from tests.conftest import sign_in, sign_up as _sign_up
        from fastapi.testclient import TestClient
        from app.main import app
        with TestClient(app) as other:
            assert _sign_up(other, email="priya.demo@demo.veye.test", first_name="Priya").status_code == 201
            fresh = start(other)
            assert fresh["flow_version"] == 2
            other.post(f"{FT}/answer", json={"choice": "why_to"})
            assert other.get(f"{FT}/session").json()["node"]["text"].startswith("REVISED")
        # an archived version cannot be activated
        assert admin_client.post(f"/api/v1/admin/companion/guided-flows/{v1_id}/activate").status_code == 409
        # deactivate v2: no Active version -> nobody can start, running sessions continue
        assert admin_client.post(f"/api/v1/admin/companion/guided-flows/{v2_id}/deactivate").json()["status"] == STATUS_DRAFT
        with TestClient(app) as third:
            assert _sign_up(third, email="rohan.demo@demo.veye.test", first_name="Rohan").status_code == 201
            assert third.post(f"{FT}/start").status_code == 409
        assert node_id(answer(member, choice="yes")) == "b3"  # pinned v1 session still advances
        assert member.post(f"{BASE}/no_such_flow/start").status_code == 404

    def test_new_version_does_not_mutate_existing_session_rows(self, member):
        start(member); answer(member, choice="why_to")
        with SessionLocal() as db:
            before = db.query(MemberGuidedFlowSession).one()
            flow_id, version, node = before.flow_id, before.flow_version, before.current_node
            v1 = db.get(GuidedFlow, flow_id)
            v2 = GuidedFlow(key=v1.key, title=v1.title, version=2, definition={**copy.deepcopy(v1.definition), "version": 2}, status=STATUS_ACTIVE)
            v1.status = STATUS_ARCHIVED
            db.add(v2); db.commit()
        with SessionLocal() as db:
            after = db.query(MemberGuidedFlowSession).one()
            assert (after.flow_id, after.flow_version, after.current_node) == (flow_id, version, node)


# =============================================================== admin
class TestAdmin:
    def test_admin_lists_previews_and_members_are_forbidden(self, member, admin_client):
        start(member); answer(member, choice="why_to")
        groups = admin_client.get("/api/v1/admin/companion/guided-flows").json()
        assert {g["key"] for g in groups} == {"first_time_user", "progress_tracker_guide"}
        first = next(g for g in groups if g["key"] == "first_time_user")
        version = first["versions"][0]
        assert version["status"] == "Active" and version["sessions_total"] == 1 and version["sessions_in_progress"] == 1
        assert version["content_meta"]["source"] == "Cara Decision Tree" and version["content_meta"]["clinical_review_status"] == "pending"
        detail = admin_client.get(f"/api/v1/admin/companion/guided-flows/{version['id']}").json()
        assert detail["validation"] == "valid" and detail["definition"]["nodes"]["intro"]["type"] == "CHOICE"
        assert {"from_node": "intro", "via": "why_to", "to_node": "b1"} in detail["edges"]
        # a member-portal session carries no admin session at all
        assert member.get("/api/v1/admin/companion/guided-flows").status_code == 401
        assert admin_client.post(f"/api/v1/admin/companion/guided-flows/{version['id']}/activate").status_code == 200  # already active: idempotent


# =============================================================== KNOWLEDGE node (engine path, unused by v1 trees)
class TestKnowledgeNode:
    def test_knowledge_node_renders_approved_passages_then_continues(self, member, admin_client):
        seed_knowledge()
        definition = {
            "key": "knowledge_probe", "title": "Knowledge probe", "version": 1, "start": "k1",
            "content_meta": {"source": "test", "client_supplied": False, "clinical_review_status": "pending"},
            "sections": [{"key": "s", "title": "S", "start": "k1", "kind": "deterministic"}],
            "nodes": {
                "k1": {"type": "KNOWLEDGE", "section": "s", "text": "Here is what Veye says about the Health Number.", "query": "What does my Health Number mean?",
                       "scopes": ["health_number"], "next": "done"},
                "done": {"type": "COMPLETE", "section": "s", "text": "Done."},
            },
        }
        with SessionLocal() as db:
            row = GuidedFlow(key="knowledge_probe", title="Knowledge probe", version=1, definition=definition, status=STATUS_DRAFT, source="test")
            db.add(row); db.commit(); flow_id = str(row.id)
        assert member.post(f"{BASE}/knowledge_probe/start").status_code == 409  # Draft cannot start
        assert admin_client.post(f"/api/v1/admin/companion/guided-flows/{flow_id}/activate").status_code == 200
        step = start(member, f"{BASE}/knowledge_probe")
        assert step["messages"][0] == "Here is what Veye says about the Health Number."
        assert len(step["messages"]) >= 2  # at least one approved passage followed the copy
        assert step["status"] == "completed" and step["node"]["type"] == "COMPLETE"
