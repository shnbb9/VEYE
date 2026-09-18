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
