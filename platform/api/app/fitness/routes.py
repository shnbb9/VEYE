"""Fitness library routes: the console manages the videos of each goal; a
member reads one goal a page at a time (nine videos, main first)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin.audit import record_audit
from app.auth.principal import CurrentPrincipal, require_admin, require_member
from app.db.session import get_db
from app.fitness.links import VideoLink
from app.fitness.models import GOALS, FitnessVideo
from app.fitness.service import FitnessError, FitnessLibraryService

admin_router = APIRouter(prefix="/api/v1/admin/fitness", tags=["admin-fitness"], dependencies=[Depends(require_admin)])
member_router = APIRouter(prefix="/api/v1/fitness", tags=["fitness"])

Goal = Literal["stronger", "weight", "fit", "performance"]


class VideoOut(BaseModel):
    id: UUID
    goal: str
    provider: str
    title: str
    subtitle: str
    embed_url: str
    watch_url: str
    thumbnail_url: str | None
    is_main: bool


class AdminVideoOut(VideoOut):
    url: str
    position: int
    published: bool
    updated_at: datetime
    updated_by: str | None


class GoalOut(BaseModel):
    key: str
    label: str
    count: int


class AdminLibraryOut(BaseModel):
    goal: str
    goals: list[GoalOut]
    videos: list[AdminVideoOut]


class MemberLibraryOut(BaseModel):
    goal: str
    goals: list[GoalOut]
    main: VideoOut | None
    videos: list[VideoOut]
    page: int
    pages: int
    total: int
    page_size: int


class VideoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal: Goal
    url: str = Field(min_length=1, max_length=500)
    title: str = Field(min_length=1, max_length=160)
    subtitle: str = Field(default="", max_length=200)


class VideoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=160)
    subtitle: str | None = Field(default=None, max_length=200)
    published: bool | None = None


class OrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal: Goal
    ids: list[UUID] = Field(max_length=500)


def _link(video: FitnessVideo) -> VideoLink:
    return VideoLink(video.provider, video.video_id, video.video_hash)


def video_out(video: FitnessVideo, main_id: UUID | None = None) -> VideoOut:
    link = _link(video)
    return VideoOut(id=video.id, goal=video.goal, provider=video.provider, title=video.title, subtitle=video.subtitle,
                    embed_url=link.embed_url, watch_url=link.watch_url, thumbnail_url=video.thumbnail_url,
                    is_main=video.is_main if main_id is None else video.id == main_id)


def admin_video_out(video: FitnessVideo) -> AdminVideoOut:
    base = video_out(video).model_dump()
    return AdminVideoOut(**base, url=video.url, position=video.position, published=video.published,
                         updated_at=video.updated_at, updated_by=video.updated_by)


def _goals(service: FitnessLibraryService, *, shown_only: bool) -> list[GoalOut]:
    counts = service.counts(shown_only=shown_only)
    return [GoalOut(key=key, label=label, count=counts[key]) for key, label in GOALS.items()]


def _raise(exc: FitnessError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _library(service: FitnessLibraryService, goal: str) -> AdminLibraryOut:
    return AdminLibraryOut(goal=goal, goals=_goals(service, shown_only=False), videos=[admin_video_out(v) for v in service.videos(goal)])


# ---- the console -----------------------------------------------------------------------

@admin_router.get("/videos", response_model=AdminLibraryOut)
def admin_videos(goal: Goal = "weight", db: Session = Depends(get_db)) -> AdminLibraryOut:
    return _library(FitnessLibraryService(db), goal)


@admin_router.post("/videos", response_model=AdminLibraryOut, status_code=201)
def add_video(payload: VideoIn, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> AdminLibraryOut:
    service = FitnessLibraryService(db)
    try:
        video = service.add(payload.goal, payload.url, payload.title, payload.subtitle, by=principal.display_name)
    except FitnessError as exc:
        _raise(exc)
    record_audit(db, principal, "fitness.video_added", "fitness_video", str(video.id),
                 {"goal": video.goal, "provider": video.provider, "main": video.is_main})
    db.commit()
    return _library(service, payload.goal)


@admin_router.patch("/videos/{video_id}", response_model=AdminLibraryOut)
def update_video(video_id: UUID, payload: VideoUpdate, principal: CurrentPrincipal = Depends(require_admin),
                 db: Session = Depends(get_db)) -> AdminLibraryOut:
    service = FitnessLibraryService(db)
    try:
        video = service.update(service.get(video_id), title=payload.title, subtitle=payload.subtitle,
                               published=payload.published, by=principal.display_name)
    except FitnessError as exc:
        _raise(exc)
    record_audit(db, principal, "fitness.video_changed", "fitness_video", str(video.id),
                 {"goal": video.goal, "fields": sorted(payload.model_dump(exclude_none=True))})
    db.commit()
    return _library(service, video.goal)


@admin_router.post("/videos/{video_id}/main", response_model=AdminLibraryOut)
def make_main(video_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> AdminLibraryOut:
    service = FitnessLibraryService(db)
    try:
        video = service.set_main(service.get(video_id), by=principal.display_name)
    except FitnessError as exc:
        _raise(exc)
    record_audit(db, principal, "fitness.main_video_set", "fitness_video", str(video.id), {"goal": video.goal})
    db.commit()
    return _library(service, video.goal)


@admin_router.put("/videos/order", response_model=AdminLibraryOut)
def reorder(payload: OrderIn, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> AdminLibraryOut:
    service = FitnessLibraryService(db)
    try:
        service.reorder(payload.goal, payload.ids, by=principal.display_name)
    except FitnessError as exc:
        _raise(exc)
    record_audit(db, principal, "fitness.videos_reordered", "fitness_goal", payload.goal, {"count": len(payload.ids)})
    db.commit()
    return _library(service, payload.goal)


@admin_router.delete("/videos/{video_id}", response_model=AdminLibraryOut)
def remove_video(video_id: UUID, principal: CurrentPrincipal = Depends(require_admin), db: Session = Depends(get_db)) -> AdminLibraryOut:
    service = FitnessLibraryService(db)
    try:
        goal = service.remove(service.get(video_id))
    except FitnessError as exc:
        _raise(exc)
    record_audit(db, principal, "fitness.video_removed", "fitness_video", str(video_id), {"goal": goal})
    db.commit()
    return _library(service, goal)


# ---- members -----------------------------------------------------------------------------

@member_router.get("/library", response_model=MemberLibraryOut)
def library(goal: Goal | None = None, page: int = Query(default=1, ge=1, le=1000),
            principal: CurrentPrincipal = Depends(require_member), db: Session = Depends(get_db)) -> MemberLibraryOut:
    """One goal's shown videos, main first, nine to a page. Without a goal:
    the first goal that has any (in the screen's order), else Lose Weight —
    the tab the approved prototype opens on."""
    service = FitnessLibraryService(db)
    goals = _goals(service, shown_only=True)
    chosen = goal or next((g.key for g in goals if g.count), "weight")
    view = service.member_page(chosen, page)
    main = view["main"]
    main_id = main.id if main is not None else None
    return MemberLibraryOut(goal=chosen, goals=goals, main=video_out(main, main_id) if main is not None else None,
                            videos=[video_out(v, main_id) for v in view["videos"]], page=view["page"], pages=view["pages"],
                            total=view["total"], page_size=view["page_size"])
