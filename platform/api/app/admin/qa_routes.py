"""Local QA housekeeping for the Playwright suite.

Repeated end-to-end runs sign up fresh members (unique `*.<stamp>@demo.veye.test`
addresses). This endpoint lets the suite's teardown remove exactly those
accounts so PostgreSQL does not fill with test identities and paging stops
drifting. It is deliberately narrow:

- never available when the API runs as production;
- an administrator session is required;
- only accounts in the reserved synthetic domain `demo.veye.test` whose
  local part matches the E2E stamp pattern can be removed;
- the seeded QA identities (Cara, Aditya, Maya, Jordan, Priya) are never
  touched, whatever the request says.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.models import UserAccount
from app.auth.principal import CurrentPrincipal, require_admin
from app.core.runtime import Runtime, get_runtime
from app.db.session import get_db
from app.care.models import CareContentItem
from app.content.models import ContentEntry
from app.members.service import MemberProfileService
from app.requests.models import MemberRequest
from app.seed.users import DEMO_ACCOUNTS

router = APIRouter(prefix="/api/v1/admin/qa", tags=["admin-qa"], dependencies=[Depends(require_admin)])

SYNTHETIC_DOMAIN = "@demo.veye.test"
# e2e.mubb7gjx@…, guided.k3z9@…, probe.<stamp>@… — a prefix, a dot, a stamp.
E2E_LOCAL_PART = re.compile(r"^[a-z][a-z0-9-]{0,30}\.[a-z0-9]{4,24}$")
PROTECTED = {account.email.lower() for account in DEMO_ACCOUNTS}
# Content and Care Studio rows the suite creates carry an unmistakable stamp:
# key `e2e_<stamp>` / title starting "E2E " and ending in the stamp.
E2E_CONTENT_KEY = re.compile(r"^e2e_[a-z0-9_]{4,40}$")
E2E_CARE_TITLE = re.compile(r"^E2E .* [a-z0-9]{6,24}$")


class CleanupIn(BaseModel):
    prefixes: list[str] = Field(default_factory=lambda: ["e2e", "guided", "probe", "iso", "journey"], max_length=20)


class CleanupOut(BaseModel):
    removed: list[str]
    skipped_protected: list[str]
    requests_removed: int = 0
    content_removed: int = 0
    care_removed: int = 0


@router.post("/cleanup-synthetic-members", response_model=CleanupOut)
def cleanup_synthetic_members(payload: CleanupIn, principal: CurrentPrincipal = Depends(require_admin),
                              db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)) -> CleanupOut:
    if runtime.settings.is_production:
        raise HTTPException(status_code=403, detail="QA housekeeping is not available in production.")
    prefixes = {p.strip().lower() for p in payload.prefixes if p.strip()}
    if not prefixes or any(not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", p) for p in prefixes):
        raise HTTPException(status_code=422, detail="Prefixes must be short lowercase words.")

    service = MemberProfileService(db, runtime.media_store)
    removed: list[str] = []
    protected: list[str] = []
    candidates = db.query(UserAccount).filter(UserAccount.email.like(f"%{SYNTHETIC_DOMAIN}")).all()
    for user in candidates:
        email = user.email.lower()
        local = email[: -len(SYNTHETIC_DOMAIN)]
        if email in PROTECTED:
            continue
        if not E2E_LOCAL_PART.match(local) or local.split(".", 1)[0] not in prefixes:
            continue
        if user.admin_access:
            protected.append(email)
            continue
        service.delete_member_account(user)
        removed.append(email)
    # Requests those members sent, and public Help questions left with a stamped
    # synthetic address, go too — otherwise the inbox fills with test traffic.
    requests_removed = 0
    for req in db.query(MemberRequest).filter(MemberRequest.email.like(f"%{SYNTHETIC_DOMAIN}")).all():
        local = req.email.lower()[: -len(SYNTHETIC_DOMAIN)]
        if req.email.lower() in PROTECTED or not E2E_LOCAL_PART.match(local) or local.split(".", 1)[0] not in prefixes:
            continue
        db.delete(req)
        requests_removed += 1
    # Content entries and Care Studio items the suite created (never seeded or hand-written rows).
    content_removed = 0
    for entry in db.query(ContentEntry).filter(ContentEntry.key.startswith("e2e_", autoescape=True)).all():
        if E2E_CONTENT_KEY.match(entry.key):
            db.delete(entry)
            content_removed += 1
    care_removed = 0
    for item in db.query(CareContentItem).filter(CareContentItem.title.like("E2E %")).all():
        if E2E_CARE_TITLE.match(item.title):
            db.delete(item)
            care_removed += 1
    if removed or requests_removed or content_removed or care_removed:
        record_audit(db, principal, "qa.cleanup_synthetic_members", "user_account", None,
                     {"removed": len(removed), "requests_removed": requests_removed, "content_removed": content_removed, "care_removed": care_removed})
    db.commit()
    return CleanupOut(removed=sorted(removed), skipped_protected=sorted(protected), requests_removed=requests_removed,
                      content_removed=content_removed, care_removed=care_removed)
