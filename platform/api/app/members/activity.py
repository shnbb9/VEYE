"""One row per member per day they opened the member application — nothing
about what they did there.

This exists because retention cannot be read from anything else VEYE keeps:
sessions are pruned and hold only the last visit, and the dates on health
records say what was saved, not who came back. History before the first row
does not exist and is reported as unavailable, never inferred."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy import Date, ForeignKey, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.auth.principal import CurrentPrincipal, require_member
from app.db.base import Base
from app.db.session import get_db

router = APIRouter(prefix="/api/v1/members/me/activity", tags=["members"])


class MemberActivityDay(Base):
    __tablename__ = "member_activity_days"
    __table_args__ = (UniqueConstraint("member_id", "day", name="uq_member_activity_days"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)


def record_activity(db: Session, member_id: uuid.UUID, day: date | None = None) -> bool:
    day = day or datetime.now(timezone.utc).date()
    if db.query(MemberActivityDay.id).filter(MemberActivityDay.member_id == member_id, MemberActivityDay.day == day).first():
        return False
    try:
        with db.begin_nested():
            db.add(MemberActivityDay(member_id=member_id, day=day))
    except IntegrityError:  # two tabs opened together
        return False
    return True


@router.post("", status_code=204)
def opened_the_app(principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> Response:
    assert principal.member_id is not None
    record_activity(db, principal.member_id)
    db.commit()
    return Response(status_code=204)
