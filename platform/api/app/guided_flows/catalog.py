"""The built-in guided flows and how they reach the database.

`ensure_builtin_flows` is idempotent: a (key, version) that already exists is
left alone (a Draft is refreshed from code); a missing version is inserted and
becomes Active when the key has no Active version yet. It never archives or
mutates a published version — that is an administrator's decision."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.guided_flows.definitions.first_time_user import DEFINITION as FIRST_TIME_USER
from app.guided_flows.definitions.progress_tracker_guide import DEFINITION as PROGRESS_TRACKER_GUIDE
from app.guided_flows.engine import GuidedFlowDefinition
from app.guided_flows.models import STATUS_ACTIVE, STATUS_DRAFT, GuidedFlow

BUILTIN_DEFINITIONS: tuple[dict, ...] = (FIRST_TIME_USER, PROGRESS_TRACKER_GUIDE)
BUILTIN_KEYS: tuple[str, ...] = tuple(d["key"] for d in BUILTIN_DEFINITIONS)


def validate_all() -> list[GuidedFlowDefinition]:
    definitions = [GuidedFlowDefinition(d, known_flow_keys=BUILTIN_KEYS) for d in BUILTIN_DEFINITIONS]
    for definition in definitions:
        definition.validate()
    return definitions


def ensure_builtin_flows(db: Session) -> dict[str, str]:
    outcome: dict[str, str] = {}
    for definition in validate_all():
        row = (db.query(GuidedFlow).filter(GuidedFlow.key == definition.key, GuidedFlow.version == definition.version).one_or_none())
        active_exists = db.query(GuidedFlow).filter(GuidedFlow.key == definition.key, GuidedFlow.status == STATUS_ACTIVE).count() > 0
        source = definition.content_meta.get("source_file")
        if row is None:
            status = STATUS_DRAFT if active_exists else STATUS_ACTIVE
            row = GuidedFlow(key=definition.key, title=definition.title, version=definition.version, definition=definition.data,
                             status=status, source=source,
                             published_at=datetime.now(timezone.utc) if status == STATUS_ACTIVE else None,
                             published_by="seed" if status == STATUS_ACTIVE else None)
            db.add(row)
            outcome[f"{definition.key} v{definition.version}"] = f"created ({status})"
        elif row.status == STATUS_DRAFT and row.definition != definition.data:
            row.definition = definition.data
            row.title = definition.title
            row.source = source
            outcome[f"{definition.key} v{definition.version}"] = "draft refreshed"
        else:
            outcome[f"{definition.key} v{definition.version}"] = f"unchanged ({row.status})"
    db.flush()
    return outcome
