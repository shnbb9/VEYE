"""The console-editable parts of a health-sharing request (architecture V2 §4).

Three versioned policies, each published through `PolicyStore` so a member's
decision is always recorded against the exact words and rules in force:

  `health_sharing_notification`  Manual or Automatic-after-verified-sign-up,
                                 the minimum interval between asks, and the
                                 display name the email is signed with;
  `health_sharing_email`         the request email: subject + rich-text body;
  `health_sharing_terms`         what the member reads before deciding.

The legally load-bearing elements of the terms — WHAT is shared, for HOW LONG,
how to WITHDRAW and what is NOT covered — are locked constants below, not
fields: an operator can rewrite the explanation around them but cannot remove
or soften them (§4.5). Purpose and recipient are required structured fields;
changing either is flagged as a material change.

All built-in defaults are ENGINEERING DRAFTS pending owner and counsel approval
(§11 decisions 3, 4 and 6). None of the member-facing words says "HIPAA" or
"authorization": no counsel has approved those terms.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.health_permission.models import POLICY_VERSION
from app.policies.richtext import RichDoc, check_plain, paragraphs, render_html, render_text
from app.policies.service import PolicyStore, aware, content_hash

NOTIFICATION_KEY = "health_sharing_notification"
TEMPLATE_KEY = "health_sharing_email"
TERMS_KEY = "health_sharing_terms"

MODE_MANUAL = "manual"
MODE_AUTOMATIC = "automatic"
RESEND_CHOICES = (24, 72, 168, 336)  # hours: 1 day, 3 days, 1 week, 2 weeks

TEMPLATE_VARIABLES = frozenset({"first_name", "organization_name", "support_email", "review_link", "request_expiry"})
TERMS_VARIABLES = frozenset({"organization_name", "support_email"})
CTA_LABEL = "Review sharing request"
DEFAULT_SUBJECT = "VEYE: Review a request to share your health information"

# ---- locked elements of the terms ---------------------------------------------
CATEGORIES = (
    "Your Health Number and its history",
    "Body composition results",
    "Blood marker results",
    "Your Health Assessment and Simple Quiz answers and results",
    "Mood entries and their notes",
    "Food diary entries",
)
COMPANION_USE = ("Veye Companion (Sprout) may use summaries of the same records to answer you about your own "
                 "progress. It never receives your notes or meal descriptions word for word.")
EXPIRY_RULE = "Until you withdraw it."
WITHDRAWAL = ("You can withdraw at any time in Settings, and it stops at once: from that moment the team and "
              "Sprout no longer see your records. Withdrawing cannot undo what was already seen while sharing "
              "was on.")
NOT_COVERED = ("Your name, email address and the messages you send to Veye are not covered by this choice and "
               "stay visible to the team so they can answer you.")
DECLINE_EFFECT = "If you don't allow sharing, nobody at Veye can open your saved results, and Sprout answers without them."


def _single_line(value: str, *, max_length: int, label: str) -> str:
    text = " ".join((value or "").split())
    if not text or len(text) > max_length:
        raise ValueError(f"{label} needs between 1 and {max_length} characters.")
    return text


class NotificationValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["manual", "automatic"] = MODE_MANUAL
    resend_interval_hours: Literal[24, 72, 168, 336] = 72
    sender_name: str = Field(default="VEYE Team", max_length=60)

    @field_validator("sender_name")
    @classmethod
    def _plain_name(cls, value: str) -> str:
        name = _single_line(value, max_length=60, label="The sender name")
        if any(ch in name for ch in "<>@\"\\"):
            raise ValueError("The sender name is a name only — the address is always Veye's own.")
        return name


class TemplateValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(max_length=180)
    body: RichDoc

    @model_validator(mode="after")
    def _variables(self) -> "TemplateValue":
        check_plain(self.subject, TEMPLATE_VARIABLES, max_length=180)
        self.body.check_variables(TEMPLATE_VARIABLES)
        if self.body.is_blank():
            raise ValueError("The email needs some words.")
        return self


class TermsValue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: RichDoc
    details: RichDoc
    purpose: str = Field(max_length=300)
    recipient: str = Field(max_length=160)

    @model_validator(mode="after")
    def _required(self) -> "TermsValue":
        self.purpose = _single_line(self.purpose, max_length=300, label="The purpose")
        self.recipient = _single_line(self.recipient, max_length=160, label="Who receives it")
        self.summary.check_variables(TERMS_VARIABLES)
        self.details.check_variables(TERMS_VARIABLES)
        if self.summary.is_blank():
            raise ValueError("The summary needs some words.")
        return self


DEFAULT_TEMPLATE = TemplateValue(
    subject=DEFAULT_SUBJECT,
    body=paragraphs(
        "Hi {{first_name}},",
        "The Veye team would like your permission to see the health records you keep in Veye, so they can help "
        "you with your program.",
        "Nothing is shared unless you choose to. Open the request in the Veye app to see exactly what would be "
        "shared, with whom and why, and to say yes or no. You can change your mind at any time.",
        "Questions? Write to {{support_email}}.",
    ),
)

DEFAULT_TERMS = TermsValue(
    summary=paragraphs(
        "Sharing lets the Veye team open your saved results when they are helping you, and lets Veye Companion "
        "use them to answer you about your own progress. Until you share them, nobody at Veye can see them."
    ),
    details=paragraphs(
        "The team sees your records only inside the Veye console, only while sharing is on, and every time they "
        "open them it is recorded with who looked and when.",
        "Veye does not sell your records and does not use them for advertising.",
    ),
    purpose="To help you with your Veye program and to answer your questions about your own progress.",
    recipient="The Veye team — the people who run your Veye account",
)


@dataclass(frozen=True)
class NotificationPolicy:
    mode: str
    resend_interval_hours: int
    sender_name: str
    version: int
    published_at: datetime | None = None
    published_by: str = ""


@dataclass(frozen=True)
class Terms:
    """One version of the terms, with the locked elements attached."""

    value: TermsValue
    version: int                 # 0 = the built-in default
    published_at: datetime | None
    published_by: str
    hash: str

    @property
    def label(self) -> str:
        """The version string a decision is recorded against. v0 keeps the
        label decisions were recorded under before the terms became
        editable, so earlier evidence still reads correctly."""
        return POLICY_VERSION if self.version == 0 else f"health-sharing-terms-v{self.version}"

    def snapshot(self) -> dict:
        return {"categories": list(CATEGORIES), "companion_use": COMPANION_USE, "purpose": self.value.purpose,
                "recipient": self.value.recipient, "expiry_rule": EXPIRY_RULE}

    def rendered(self, variables: dict[str, str]) -> dict:
        return {
            "version": self.version, "label": self.label, "hash": self.hash,
            "published_at": self.published_at, "published_by": self.published_by,
            "summary_html": render_html(self.value.summary, variables),
            "summary_text": render_text(self.value.summary, variables),
            "details_html": render_html(self.value.details, variables),
            "purpose": self.value.purpose, "recipient": self.value.recipient,
            "categories": list(CATEGORIES), "companion_use": COMPANION_USE, "expiry_rule": EXPIRY_RULE,
            "withdrawal": WITHDRAWAL, "not_covered": NOT_COVERED, "decline_effect": DECLINE_EFFECT,
        }


def terms_hash(value: TermsValue) -> str:
    """Covers the editable words AND the locked ones, so a change to either is
    a different hash."""
    return content_hash({"value": value.model_dump(mode="json"), "categories": list(CATEGORIES),
                         "companion_use": COMPANION_USE, "expiry_rule": EXPIRY_RULE, "withdrawal": WITHDRAWAL,
                         "not_covered": NOT_COVERED})


def current_notification(db: Session) -> NotificationPolicy:
    row = PolicyStore(db).current(NOTIFICATION_KEY)
    value = NotificationValue.model_validate(row.value) if row is not None else NotificationValue()
    return NotificationPolicy(mode=value.mode, resend_interval_hours=value.resend_interval_hours,
                              sender_name=value.sender_name, version=int(row.version or 0) if row else 0,
                              published_at=aware(row.published_at) if row else None,
                              published_by=(row.published_by_name or "") if row else "")


def current_template(db: Session) -> tuple[TemplateValue, int]:
    row = PolicyStore(db).current(TEMPLATE_KEY)
    if row is None:
        return DEFAULT_TEMPLATE, 0
    return TemplateValue.model_validate(row.value), int(row.version or 0)


def current_terms(db: Session) -> Terms:
    row = PolicyStore(db).current(TERMS_KEY)
    if row is None:
        return Terms(value=DEFAULT_TERMS, version=0, published_at=None, published_by="", hash=terms_hash(DEFAULT_TERMS))
    value = TermsValue.model_validate(row.value)
    return Terms(value=value, version=int(row.version or 0), published_at=aware(row.published_at),
                 published_by=row.published_by_name or "", hash=terms_hash(value))


def is_material_change(old: TermsValue, new: TermsValue) -> bool:
    """Purpose and recipient define what a member agreed to; changing either
    means existing decisions were made against something else."""
    return old.purpose != new.purpose or old.recipient != new.recipient
