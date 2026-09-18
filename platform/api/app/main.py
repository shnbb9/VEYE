from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.advanced_routes import router as admin_advanced_router
from app.admin.companion_routes import router as admin_companion_router
from app.admin.knowledge_routes import router as admin_knowledge_router
from app.assessments.routes import member_router, router as health_number_router
from app.auth.routes import router as auth_router
from app.companion.routes import router as companion_router
from app.core.config import settings
from app.core.runtime import get_runtime
from app.guided_flows.admin_routes import router as admin_guided_flows_router
from app.guided_flows.routes import router as guided_flows_router
from app.progress.blood_markers.routes import (
    member_router as blood_markers_member_router,
    router as blood_markers_router,
)
from app.progress.body_composition.routes import (
    member_router as body_composition_member_router,
    router as body_composition_router,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Provider absence never stops the API: an unconfigured LLM or a missing
    # Langfuse key becomes an honest status, not a boot failure.
    get_runtime()
    yield


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(auth_router)
app.include_router(health_number_router)
app.include_router(member_router)
app.include_router(body_composition_router)
app.include_router(body_composition_member_router)
app.include_router(blood_markers_router)
app.include_router(blood_markers_member_router)
app.include_router(companion_router)
app.include_router(guided_flows_router)
app.include_router(admin_companion_router)
app.include_router(admin_guided_flows_router)
app.include_router(admin_knowledge_router)
app.include_router(admin_advanced_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "veye-api"}
