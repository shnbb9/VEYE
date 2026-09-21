"""`python -m app.seed` — synthetic LOCAL demo data: accounts, member
histories, Companion settings and approved knowledge. Idempotent; refuses to
run against a production environment."""

import json

from app.companion.settings import get_or_create_settings
from app.db.session import SessionLocal
from app.guided_flows.catalog import ensure_builtin_flows
from app.seed.care import seed_care
from app.seed.knowledge import seed_knowledge
from app.seed.users import seed_users


def main() -> None:
    with SessionLocal() as db:
        users = seed_users(db)
        get_or_create_settings(db)
        flows = ensure_builtin_flows(db)
        db.commit()
        care = seed_care(db)
        knowledge = seed_knowledge(db)
    print(json.dumps({"users": users, "companion_settings": "ready", "guided_flows": flows, "care": care, "knowledge": knowledge}, indent=2))


if __name__ == "__main__":
    main()
