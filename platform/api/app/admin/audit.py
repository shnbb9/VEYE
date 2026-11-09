from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.admin.models import AdminAuditEntry
from app.auth.principal import CurrentPrincipal


def record_audit(db: Session, principal: CurrentPrincipal, action: str, entity_type: str, entity_id: str | None = None,
                 details: dict | None = None) -> AdminAuditEntry:
    entry = AdminAuditEntry(actor_user_id=principal.user_id, actor_name=principal.display_name, action=action,
                            entity_type=entity_type, entity_id=entity_id, details=details or {})
    db.add(entry)
    db.flush()
    return entry


ACCOUNT_ACTIONS = {
    "administrator.invited": "Invited to the console",
    "administrator.invitation_resent": "Invitation resent",
    "administrator.invitation_revoked": "Invitation withdrawn",
    "administrator.deactivated": "Console access deactivated",
    "administrator.reactivated": "Console access reactivated",
    "member_account.deactivated": "Account deactivated",
    "member_account.reactivated": "Account reactivated",
    "member_account.verification_resent": "Verification email resent",
    "member_account.password_reset_sent": "Password-reset link sent",
}


class AccountActivityRow(BaseModel):
    """One account action, in the words the console uses for it."""

    id: UUID
    at: datetime
    actor_name: str
    action: str
    label: str
    user_id: str | None
    email: str | None


def account_activity(db: Session, *, user_id: UUID | None = None, limit: int = 20) -> list[AccountActivityRow]:
    """Who changed access, and when. The same rows the Advanced audit screen
    shows, narrowed to account actions so they can sit beside the controls
    that caused them — an administrator should not have to go looking under
    Companion to find out who deactivated someone."""
    query = (db.query(AdminAuditEntry)
             .filter(AdminAuditEntry.entity_type == "user_account",
                     AdminAuditEntry.action.in_(tuple(ACCOUNT_ACTIONS)))
             .order_by(AdminAuditEntry.created_at.desc()))
    if user_id is not None:
        query = query.filter(AdminAuditEntry.entity_id == str(user_id))
    rows = query.limit(max(1, min(limit, 200))).all()
    return [
        AccountActivityRow(
            id=row.id,
            at=row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc),
            actor_name=row.actor_name, action=row.action,
            label=ACCOUNT_ACTIONS.get(row.action, row.action),
            user_id=row.entity_id, email=(row.details or {}).get("email"),
        )
        for row in rows
    ]
