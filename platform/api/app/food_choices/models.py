"""Food Choices storage: what the member says they eat, and a HOW TO plan.

Two rows, both belonging to exactly one member.

`member_food_selections` is the four checklists — "Please check the foods you
commonly eat" — which is what the client's `* Food Choices*.xlsx` templates
are for. The checked foods are names from the lists; the write-ins are the
member's own words from each section's "Other: (write in)" row.

**A write-in is recorded, never classified.** The source supplies a tier and a
portion for the foods on its lists and for nothing else, so a member's own
entry gets no tier, no portion and no favourable/unfavourable verdict. It is
kept so Cara can see what people are adding, and so the member's list is their
own. It never reaches the rules engine.

`member_how_to_plans` holds one HOW TO conversation as the JSON state the
state machine in `how_to.py` produces, so a plan survives a page reload.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MemberFoodSelection(Base):
    """One row per member: the foods they say they commonly eat."""

    __tablename__ = "member_food_selections"
    __table_args__ = (UniqueConstraint("member_id", name="uq_member_food_selections_member"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    # "woman" or "man" — every portion in the client's lists is stated for one
    # or the other, so a plan cannot give amounts without it. Empty until the
    # member says, and never guessed.
    sex: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    # {"protein": [name, ...], "carbohydrate": [...], "fat": [...]} — names
    # from the lists, which are the keys.
    selections: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # {"<tier>": ["the member's own words", ...]} — recorded, never scored.
    write_ins: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class MemberHowToPlan(Base):
    """One HOW TO conversation.

    `state` is `how_to.HowTo.to_dict()`. The newest row with no `completed_at`
    is the plan in progress; there is at most one, because starting a new one
    finishes the old.
    """

    __tablename__ = "member_how_to_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), index=True, nullable=False)
    state: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def has_food_choices(db, member_id) -> bool:
    """Has this member used Food Choices at all?

    Either half counts: ticking foods on the checklists, or building a plan.
    The guided flows ask this to avoid offering a section the member has
    already filled in.
    """
    row = (db.query(MemberFoodSelection)
           .filter(MemberFoodSelection.member_id == member_id).one_or_none())
    if row is not None and any((row.selections or {}).get(group) for group in ("protein", "carbohydrate", "fat")):
        return True
    if row is not None and (row.write_ins or {}):
        return True
    return db.query(MemberHowToPlan).filter(MemberHowToPlan.member_id == member_id).count() > 0
