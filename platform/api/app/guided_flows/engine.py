"""GuidedFlowDefinition: validation and deterministic transitions.

A definition is plain data (see `definitions/`). The engine knows the node
types, the UI actions the application allows, and the member-state checks the
application can answer. Nothing here talks to a database or a model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

# ---- node types -------------------------------------------------------------------------
MESSAGE = "MESSAGE"               # copy, then continue (auto-chains into the next node)
QUESTION = "QUESTION"             # copy that invites any response; every response advances
CHOICE = "CHOICE"                 # copy with explicit options; each option names the next node
CHECK_MEMBER_STATE = "CHECK_MEMBER_STATE"  # deterministic branch on approved application state
NAVIGATION = "NAVIGATION"         # emits one allowed UI action, then continues
KNOWLEDGE = "KNOWLEDGE"           # copy plus approved-knowledge passages for a fixed query, then continue
AI_TASK = "AI_TASK"               # reserved boundary for genuine AI functions (HOW TO meal planning)
COMPLETE = "COMPLETE"             # terminal
NODE_TYPES = (MESSAGE, QUESTION, CHOICE, CHECK_MEMBER_STATE, NAVIGATION, KNOWLEDGE, AI_TASK, COMPLETE)
INTERACTIVE = (QUESTION, CHOICE, AI_TASK, COMPLETE)   # the loop stops here and waits for the member

# ---- the only UI actions a flow may emit; the frontend maps them to routes ----------------
TRACKERS = ("blood_markers", "body_composition", "health_assessment", "simple_quiz")
ACTION_TYPES = {
    "OPEN_DASHBOARD": None, "OPEN_PROGRESS": None, "OPEN_FOOD_CHOICES": None, "OPEN_MEAL_PLANNING": None, "OPEN_COMPANION": None,
    "OPEN_TRACKER": TRACKERS,          # target required, from TRACKERS
    "START_FLOW": "flow_key",           # target required: another flow key
}

# ---- member-state questions the application can answer (see member_state.py) --------------
MEMBER_STATES = (
    "has_blood_markers", "has_body_composition", "has_health_number", "has_health_assessment", "has_simple_quiz", "has_food_choices",
    "blood_markers_available", "body_composition_available", "health_assessment_available", "simple_quiz_available", "food_choices_available",
)


class FlowDefinitionError(ValueError):
    pass


@dataclass(frozen=True)
class Transition:
    next_node: str | None
    action: dict | None = None


@dataclass
class GuidedFlowDefinition:
    data: dict
    known_flow_keys: tuple[str, ...] = field(default_factory=tuple)

    # ---- accessors ------------------------------------------------------------------------
    @property
    def key(self) -> str: return str(self.data["key"])
    @property
    def title(self) -> str: return str(self.data["title"])
    @property
    def version(self) -> int: return int(self.data["version"])
    @property
    def start(self) -> str: return str(self.data["start"])
    @property
    def nodes(self) -> dict: return self.data["nodes"]
    @property
    def sections(self) -> list[dict]: return list(self.data.get("sections", []))
    @property
    def content_meta(self) -> dict: return dict(self.data.get("content_meta", {}))

    def node(self, node_id: str) -> dict:
        try:
            return self.nodes[node_id]
        except KeyError as exc:
            raise FlowDefinitionError(f"Unknown node '{node_id}' in flow '{self.key}'.") from exc

    def section_title(self, node_id: str) -> str:
        section = self.node(node_id).get("section")
        for entry in self.sections:
            if entry.get("key") == section:
                return str(entry.get("title", section))
        return str(section or "")

    def choices(self, node_id: str) -> list[dict]:
        return list(self.node(node_id).get("choices", []))

    # ---- transitions ----------------------------------------------------------------------
    def transition(self, node_id: str, choice_key: str | None = None, *, state: dict[str, bool] | None = None) -> Transition:
        node = self.node(node_id)
        kind = node["type"]
        if kind in (MESSAGE, QUESTION, KNOWLEDGE):
            return Transition(node.get("next"))
        if kind == NAVIGATION:
            return Transition(node.get("next"), dict(node["action"]))
        if kind in (CHOICE, AI_TASK):
            for choice in node.get("choices", []):
                if choice["key"] == choice_key:
                    return Transition(choice["next"])
            raise FlowDefinitionError(f"'{choice_key}' is not an option at node '{node_id}'.")
        if kind == CHECK_MEMBER_STATE:
            check = node["check"]
            value = bool((state or {}).get(check["state"], False))
            return Transition(check["if_true"] if value else check["if_false"])
        if kind == COMPLETE:
            return Transition(None)
        raise FlowDefinitionError(f"Unsupported node type '{kind}'.")

    def successors(self, node_id: str) -> list[str]:
        node = self.node(node_id)
        kind = node["type"]
        if kind in (MESSAGE, QUESTION, KNOWLEDGE, NAVIGATION):
            return [node["next"]] if node.get("next") else []
        if kind in (CHOICE, AI_TASK):
            return [c["next"] for c in node.get("choices", [])]
        if kind == CHECK_MEMBER_STATE:
            return [node["check"]["if_true"], node["check"]["if_false"]]
        return []

    # ---- validation -----------------------------------------------------------------------
    def validate(self) -> None:
        problems: list[str] = []
        for required in ("key", "title", "version", "start", "nodes"):
            if required not in self.data:
                problems.append(f"missing '{required}'")
        if problems:
            raise FlowDefinitionError("; ".join(problems))
        nodes = self.nodes
        if self.start not in nodes:
            problems.append(f"start node '{self.start}' is undefined")
        for node_id, node in nodes.items():
            kind = node.get("type")
            if kind not in NODE_TYPES:
                problems.append(f"{node_id}: unknown type '{kind}'"); continue
            if kind != CHECK_MEMBER_STATE and not str(node.get("text", "")).strip():
                problems.append(f"{node_id}: empty text")
            if kind in (MESSAGE, QUESTION, KNOWLEDGE, NAVIGATION):
                if node.get("next") not in nodes:
                    problems.append(f"{node_id}: next '{node.get('next')}' is undefined")
            if kind in (CHOICE, AI_TASK):
                choices = node.get("choices", [])
                if len(choices) < (2 if kind == CHOICE else 1):
                    problems.append(f"{node_id}: needs at least {'two options' if kind == CHOICE else 'one option'}")
                keys = [c.get("key") for c in choices]
                if len(set(keys)) != len(keys):
                    problems.append(f"{node_id}: duplicate option keys")
                for choice in choices:
                    if not choice.get("label"):
                        problems.append(f"{node_id}: option '{choice.get('key')}' has no label")
                    if choice.get("next") not in nodes:
                        problems.append(f"{node_id}: option '{choice.get('key')}' leads to undefined '{choice.get('next')}'")
            if kind == CHECK_MEMBER_STATE:
                check = node.get("check", {})
                if check.get("state") not in MEMBER_STATES:
                    problems.append(f"{node_id}: unknown member state '{check.get('state')}'")
                for branch in ("if_true", "if_false"):
                    if check.get(branch) not in nodes:
                        problems.append(f"{node_id}: {branch} '{check.get(branch)}' is undefined")
            if kind == NAVIGATION:
                problems.extend(f"{node_id}: {p}" for p in self._action_problems(node.get("action")))
            if kind == KNOWLEDGE and not str(node.get("query", "")).strip():
                problems.append(f"{node_id}: KNOWLEDGE node needs a query")
            if kind == COMPLETE and node.get("next"):
                problems.append(f"{node_id}: COMPLETE must not have a next")
        # reachability: every node is reachable from start, and every node can reach a COMPLETE
        reachable = self._reachable_from(self.start)
        for node_id in nodes:
            if node_id not in reachable:
                problems.append(f"{node_id}: unreachable from start")
        terminal = {n for n, node in nodes.items() if node.get("type") == COMPLETE}
        if not terminal:
            problems.append("no COMPLETE node")
        for node_id in nodes:
            if node_id in terminal:
                continue
            if not (self._reachable_from(node_id) & terminal):
                problems.append(f"{node_id}: dead branch — cannot reach a COMPLETE node")
        if problems:
            raise FlowDefinitionError(f"Flow '{self.data.get('key')}' v{self.data.get('version')}: " + "; ".join(problems))

    def _action_problems(self, action: dict | None) -> list[str]:
        if not isinstance(action, dict) or action.get("type") not in ACTION_TYPES:
            return [f"action '{action}' is not an allowed UI action"]
        rule = ACTION_TYPES[action["type"]]
        target = action.get("target")
        if rule is None:
            return [f"action {action['type']} takes no target"] if target else []
        if rule == "flow_key":
            if not target or (self.known_flow_keys and target not in self.known_flow_keys):
                return [f"START_FLOW target '{target}' is not a known flow"]
            return []
        if target not in rule:
            return [f"{action['type']} target '{target}' is not one of {rule}"]
        return []

    def _reachable_from(self, node_id: str) -> set[str]:
        seen: set[str] = set()
        stack = [node_id]
        while stack:
            current = stack.pop()
            if current in seen or current not in self.nodes:
                continue
            seen.add(current)
            stack.extend(self.successors(current))
        return seen

    # ---- exhaustive branch enumeration (tests, admin preview) ------------------------------
    def edges(self) -> Iterable[tuple[str, str | None, str]]:
        """(from_node, option or check outcome, to_node) for every branch."""
        for node_id, node in self.nodes.items():
            kind = node["type"]
            if kind in (CHOICE, AI_TASK):
                for choice in node.get("choices", []):
                    yield node_id, choice["key"], choice["next"]
            elif kind == CHECK_MEMBER_STATE:
                yield node_id, f"{node['check']['state']}=true", node["check"]["if_true"]
                yield node_id, f"{node['check']['state']}=false", node["check"]["if_false"]
            elif node.get("next"):
                yield node_id, None, node["next"]
