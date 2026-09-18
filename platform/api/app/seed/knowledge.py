"""Synthetic approved-knowledge seed: five sources in the lifecycle states the
admin model defines (Active, Inactive, Archived). The documents are Markdown
files written from the product's own published wording — no client files,
no member data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.runtime import get_runtime
from app.db.session import SessionLocal
from app.knowledge.models import STATUS_ACTIVE, STATUS_ARCHIVED, STATUS_INACTIVE, KnowledgeSource
from app.knowledge.service import KnowledgeService

CONTENT_DIR = Path(__file__).parent / "knowledge_content"
DEMO_APPROVER = "Cara Hogue (local demo)"


@dataclass(frozen=True)
class SeedSource:
    title: str
    type: str
    scope_key: str
    description: str
    reference_label: str
    filename: str
    target_status: str


SEED_SOURCES = (
    SeedSource("Health Number guide", "VEYE educational document", "health_number",
               "Plain-language explanation of the Health Number and what a lower result means.",
               "health-number-guide.md", "health-number-guide.md", STATUS_ACTIVE),
    SeedSource("Help and FAQs", "FAQ / Help", "help",
               "Approved answers to common member questions about using VEYE.",
               "help-and-faqs.md", "help-and-faqs.md", STATUS_ACTIVE),
    SeedSource("How Sprout helps", "Companion guidance", "companion",
               "What the Companion can and cannot do, and how member data is handled.",
               "companion-guidance.md", "companion-guidance.md", STATUS_ACTIVE),
    SeedSource("Food Choices reference", "Food Choices reference", "food_choices",
               "Approved food-category wording used when members ask about their selections.",
               "food-choices-reference.md", "food-choices-reference.md", STATUS_INACTIVE),
    SeedSource("Superseded welcome note", "Companion guidance", "companion",
               "An earlier welcome wording retained as an archived record.",
               "superseded-welcome-note.md", "superseded-welcome-note.md", STATUS_ARCHIVED),
)


def seed_knowledge(db: Session | None = None) -> dict[str, str]:
    if settings.is_production:
        raise RuntimeError("The synthetic knowledge seed must not run against a production environment.")
    own = db is None
    db = db or SessionLocal()
    runtime = get_runtime()
    outcome: dict[str, str] = {}
    try:
        service = KnowledgeService(db, runtime.object_store, runtime.embeddings)
        existing = {source.title: source for source in service.list_sources()}
        for spec in SEED_SOURCES:
            if spec.title in existing:
                outcome[spec.title] = "exists"
                continue
            source: KnowledgeSource = service.create_source(
                title=spec.title, type=spec.type, scope_key=spec.scope_key, description=spec.description,
                reference_label=spec.reference_label, synthetic=True,
            )
            data = (CONTENT_DIR / spec.filename).read_bytes()
            document = service.attach_document(source, filename=spec.filename, content_type="text/markdown", data=data)
            if document.ingestion_status != "ingested":
                raise RuntimeError(f"Seed document {spec.filename} failed to ingest: {document.ingestion_error}")
            # Every seed source is approved once; the target lifecycle state is then applied.
            service.activate(source, approved_by=DEMO_APPROVER)
            if spec.target_status == STATUS_INACTIVE:
                service.deactivate(source)
            elif spec.target_status == STATUS_ARCHIVED:
                service.archive(source)
            outcome[spec.title] = f"created:{spec.target_status}"
        db.commit()
        return outcome
    finally:
        if own:
            db.close()
