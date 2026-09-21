"""Product settings routes: the console edits support contact details, every
surface reads them from one public endpoint; the console also sees an honest,
derived list of feature states (nothing here is a switch)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.principal import CurrentPrincipal, require_admin
from app.auth.schemas import EmailAddress
from app.care.models import CareContentItem
from app.db.session import get_db
from app.guided_flows.models import GuidedFlow
from app.product_settings.models import DEFAULTS, KEYS, SUPPORT_EMAIL, SUPPORT_PHONE, ProductSetting

admin_router = APIRouter(prefix="/api/v1/admin/settings", tags=["admin-settings"], dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class SupportDetails(BaseModel):
    support_email: str
    support_phone: str
    updated_at: datetime | None = None
    updated_by: str | None = None


class SupportDetailsIn(BaseModel):
    support_email: EmailAddress
    support_phone: str = Field(default="", max_length=40)


class FeatureState(BaseModel):
    key: str
    label: str
    state: str         # available | holding | client_input | phase_2
    state_label: str
    note: str


def read_support(db: Session) -> SupportDetails:
    rows = {row.key: row for row in db.query(ProductSetting).filter(ProductSetting.key.in_(KEYS)).all()}
    email = rows[SUPPORT_EMAIL].value.get("value") if SUPPORT_EMAIL in rows else DEFAULTS[SUPPORT_EMAIL]
    phone = rows[SUPPORT_PHONE].value.get("value") if SUPPORT_PHONE in rows else DEFAULTS[SUPPORT_PHONE]
    def aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)

    ordered = sorted(rows.values(), key=lambda r: aware(r.updated_at), reverse=True)
    latest = aware(ordered[0].updated_at) if ordered else None
    by = ordered[0].updated_by if ordered else None
    return SupportDetails(support_email=str(email or DEFAULTS[SUPPORT_EMAIL]), support_phone=str(phone or ""), updated_at=latest, updated_by=by)


def write_support(db: Session, data: SupportDetailsIn, *, by: str) -> SupportDetails:
    for key, value in ((SUPPORT_EMAIL, str(data.support_email).strip().lower()), (SUPPORT_PHONE, data.support_phone.strip())):
        row = db.get(ProductSetting, key)
        if row is None:
            row = ProductSetting(key=key, value={"value": value}, updated_by=by)
            db.add(row)
        else:
            row.value = {"value": value}
            row.updated_by = by
    db.flush()
    return read_support(db)


@public_router.get("/support", response_model=SupportDetails)
def support_details(db: Session = Depends(get_db)) -> SupportDetails:
    return read_support(db)


@admin_router.get("/product", response_model=SupportDetails)
def get_product_settings(db: Session = Depends(get_db)) -> SupportDetails:
    return read_support(db)


@admin_router.put("/product", response_model=SupportDetails)
def put_product_settings(payload: SupportDetailsIn, principal: CurrentPrincipal = Depends(require_admin),
                         db: Session = Depends(get_db)) -> SupportDetails:
    out = write_support(db, payload, by=principal.display_name)
    record_audit(db, principal, "settings.support.update", "product_setting", "support", {"support_email": out.support_email})
    db.commit()
    return out


STATE_LABELS = {"available": "Available", "holding": "In development", "client_input": "Client input required", "phase_2": "Phase 2"}


@admin_router.get("/features", response_model=list[FeatureState])
def feature_states(db: Session = Depends(get_db)) -> list[FeatureState]:
    """Derived, read-only: what the application can do today and why the rest
    waits. There is deliberately no switch here — availability follows from
    what is built and what the client has supplied."""
    published = dict(db.query(CareContentItem.kind, func.count(CareContentItem.id))
                     .filter(CareContentItem.status == "Published").group_by(CareContentItem.kind).all())
    flows = db.query(GuidedFlow).all()
    active_flows = sum(1 for f in flows if getattr(f, "status", "active") == "active")
    rows = [
        ("health_number", "Health Number", "available", "12-question deterministic assessment with dated history."),
        ("body_composition", "Body Composition / BMI", "available", "Client body-fat tables; unsupported combinations report not available."),
        ("blood_markers", "Blood Test Markers", "available", "Member entry, goal flags, client supplement table."),
        ("health_assessment", "Health Assessment", "available", "11 questions, 11–33 lower is better, EPA/DHA by score."),
        ("simple_quiz", "Simple Quiz", "available", "8 yes/no count; never touches the Health Number."),
        ("mood", "Mood Tracker", "available", "One mood per day with a note; Balance score by the client formula."),
        ("food_diary", "Food Diary", "available", "Meal entries and history. Nutritional analysis is a client decision."),
        ("food_choices", "Food Choices", "client_input", "Decision tree / business logic not supplied."),
        ("meal_planning", "Meal Planning", "client_input", "HOW TO / AI meal-planning specification not supplied."),
        ("mindfulness", "Mindfulness", "client_input", "No content supplied; section stays in development."),
        ("fitness", "Fitness", "available", f"{published.get('fitness', 0)} published Care Studio item(s)."),
        ("supplements", "Supplements", "available", f"{published.get('supplement', 0)} published; Vitamin Overview awaits citations."),
        ("resources", "Resources", "client_input", f"{published.get('resource', 0)} published; card content not supplied."),
        ("companion", "Veye Companion (Sprout)", "available", f"{active_flows} guided experience(s) active; local mock provider by default."),
        ("requests", "Requests & Inbox", "available", "Contact Us, Help questions and Join Beta land in the console."),
        ("activity_tracker", "Activity Tracker (Exercise, Meditation)", "client_input", "Data source not chosen (manual, phone health, wearable)."),
        ("production_email", "Production email (Google Workspace)", "client_input", "Mailpit locally; sender/relay details listed in the access doc."),
        ("production_ai", "Production AI provider", "client_input", "Cara's provider preference pending; no external provider receives member data."),
    ]
    return [FeatureState(key=k, label=l, state=s, state_label=STATE_LABELS[s], note=n) for k, l, s, n in rows]
