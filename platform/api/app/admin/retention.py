"""Overall member retention (Cara, 25 Nov 2026), from `member_activity_days`.

Every figure states its definition, because a percentage without one is how a
dashboard misleads:

  joined      member accounts created in the window;
  active      members who opened the app on at least one day in the window;
  returned    of members whose sign-up is old enough to judge, those who opened
              the app again on a LATER day within the window after joining;
  inactive    members who have not opened it in the last 30 days;
  engagement  whole days from a member's sign-up to the last day they opened
              the app, for members old enough to judge.

Counting starts on the first recorded day. Members who joined before it are
left out of `returned` and `engagement` — their early days were not recorded —
and the answer says so rather than inferring visits. Archived members and
members being erased are left out of everything."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import UserAccount
from app.members.activity import MemberActivityDay
from app.members.models import Member

RETURN_WINDOWS = (7, 30)
INACTIVE_AFTER = 30
# Wait this long before judging how long somebody stayed: shorter and everyone
# who joined yesterday looks like someone who left.
ENGAGEMENT_JUDGED_AFTER = 30
# (label, first day, last day) — days between joining and the last visit.
BUCKETS = (("Only the first day", 0, 0), ("Under a week", 1, 6), ("1–2 weeks", 7, 13), ("2–4 weeks", 14, 29),
           ("1–2 months", 30, 59), ("2–3 months", 60, 89), ("3 months or more", 90, None))


class ReturnRate(BaseModel):
    days: int
    eligible: int
    returned: int


class EngagementBucket(BaseModel):
    label: str
    members: int


class RetentionOut(BaseModel):
    recorded_since: date | None
    members: int
    joined_last_30_days: int
    active_last_7_days: int
    active_last_30_days: int
    inactive: int | None                # None until 30 days are recorded
    returned: list[ReturnRate]
    engagement_judged_after_days: int = ENGAGEMENT_JUDGED_AFTER
    engagement_members: int
    engagement_median_days: int | None
    engagement: list[EngagementBucket]
    not_measured: int                   # joined before recording began


def _day(value: datetime) -> date:
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).date()


def retention(db: Session, *, today: date | None = None) -> RetentionOut:
    today = today or datetime.now(timezone.utc).date()
    joined = {member_id: _day(at) for member_id, at in
              db.query(Member.id, Member.created_at).join(UserAccount, UserAccount.member_id == Member.id)
              .filter(Member.archived_at.is_(None), Member.erasure_requested_at.is_(None)).all()}
    since = db.query(func.min(MemberActivityDay.day)).scalar()
    days: dict = {}
    for member_id, day in db.query(MemberActivityDay.member_id, MemberActivityDay.day).all():
        if member_id in joined:
            days.setdefault(member_id, set()).add(day)

    def active_within(n: int) -> int:
        first = today - timedelta(days=n - 1)
        return sum(1 for seen in days.values() if any(first <= d <= today for d in seen))

    measured = {m: at for m, at in joined.items() if since is not None and at >= since}
    rates = []
    for window in RETURN_WINDOWS:
        eligible = [m for m, at in measured.items() if (today - at).days >= window]
        back = sum(1 for m in eligible if any(1 <= (d - measured[m]).days <= window for d in days.get(m, ())))
        rates.append(ReturnRate(days=window, eligible=len(eligible), returned=back))

    stayed = sorted(max([(d - at).days for d in days.get(m, ())] + [0]) for m, at in measured.items()
                    if (today - at).days >= ENGAGEMENT_JUDGED_AFTER)
    buckets = [EngagementBucket(label=label, members=sum(1 for s in stayed if s >= low and (high is None or s <= high)))
               for label, low, high in BUCKETS]
    middle = len(stayed) // 2
    median = None if not stayed else stayed[middle] if len(stayed) % 2 else (stayed[middle - 1] + stayed[middle]) // 2
    enough = since is not None and (today - since).days >= INACTIVE_AFTER
    return RetentionOut(
        recorded_since=since, members=len(joined),
        joined_last_30_days=sum(1 for at in joined.values() if (today - at).days < 30),
        active_last_7_days=active_within(7), active_last_30_days=active_within(30),
        inactive=len(joined) - active_within(INACTIVE_AFTER) if enough else None,
        returned=rates, engagement_members=len(stayed), engagement_median_days=median, engagement=buckets,
        not_measured=len(joined) - len(measured))
