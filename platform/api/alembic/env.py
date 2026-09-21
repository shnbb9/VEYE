from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.base import Base
from app.members import models as member_models  # noqa: F401
from app.assessments import models as assessment_models  # noqa: F401
from app.progress.body_composition import models as body_composition_models  # noqa: F401
from app.progress.blood_markers import models as blood_marker_models  # noqa: F401
from app.progress.health_assessment import models as health_assessment_models  # noqa: F401
from app.progress.simple_quiz import models as simple_quiz_models  # noqa: F401
from app.guided_flows import models as guided_flow_models  # noqa: F401
from app.auth import models as auth_models  # noqa: F401
from app.notifications import models as notification_models  # noqa: F401
from app.observability import models as observability_models  # noqa: F401
from app.knowledge import models as knowledge_models  # noqa: F401
from app.companion import models as companion_models  # noqa: F401
from app.admin import models as admin_models  # noqa: F401
from app.care import models as care_models  # noqa: F401
from app.content import models as content_models  # noqa: F401
from app.requests import models as request_models  # noqa: F401
from app.mood import models as mood_models  # noqa: F401
from app.food import models as food_models  # noqa: F401
from app.product_settings import models as product_setting_models  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_offline() if context.is_offline_mode() else run_migrations_online()
