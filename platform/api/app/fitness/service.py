"""Fitness library rules (owner, 15 Nov 2026).

* Each of the four goals has its own videos, in the console's order.
* One MAIN video per goal plays in the big player at the top. The first
  video added to a goal becomes its main video; the console can choose
  another at any time. Hiding or removing the main video leaves the goal
  without one, and members then see the first shown video in its place.
* Members see shown videos only: the main one first, then the rest in
  order, nine to a page.
"""

from __future__ import annotations

import json
import logging
import math
import urllib.parse
import urllib.request
from typing import Callable
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.fitness.links import VideoLink, VideoLinkError, parse_video_link
from app.fitness.models import GOALS, PAGE_SIZE, FitnessVideo

log = logging.getLogger("veye.fitness")


class FitnessError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def vimeo_thumbnail(link: VideoLink) -> str | None:
    """Vimeo's still, from its public oEmbed endpoint — a fixed host, asked once
    when the video is added. Best effort: no thumbnail is not an error."""
    query = urllib.parse.urlencode({"url": link.canonical, "width": 640})
    try:
        with urllib.request.urlopen(f"https://vimeo.com/api/oembed.json?{query}", timeout=4) as response:  # noqa: S310 - fixed https host
            data = json.loads(response.read(64_000).decode("utf-8"))
        thumbnail = data.get("thumbnail_url")
        return thumbnail if isinstance(thumbnail, str) and thumbnail.startswith("https://i.vimeocdn.com/") else None
    except Exception as exc:  # network, JSON, anything: the video still plays
        log.info("no Vimeo thumbnail for %s: %s", link.video_id, type(exc).__name__)
        return None


def _goal(goal: str) -> str:
    if goal not in GOALS:
        raise FitnessError(422, "Choose one of the four goals.")
    return goal


class FitnessLibraryService:
    def __init__(self, db: Session, *, thumbnailer: Callable[[VideoLink], str | None] | None = None) -> None:
        self.db = db
        self.thumbnailer = thumbnailer or vimeo_thumbnail

    # ---- reading ---------------------------------------------------------------------
    def videos(self, goal: str, *, shown_only: bool = False) -> list[FitnessVideo]:
        query = self.db.query(FitnessVideo).filter(FitnessVideo.goal == _goal(goal))
        if shown_only:
            query = query.filter(FitnessVideo.published.is_(True))
        return query.order_by(FitnessVideo.is_main.desc(), FitnessVideo.position.asc(), FitnessVideo.created_at.asc()).all()

    def get(self, video_id: UUID) -> FitnessVideo:
        video = self.db.get(FitnessVideo, video_id)
        if video is None:
            raise FitnessError(404, "That video is not in the library.")
        return video

    def counts(self, *, shown_only: bool) -> dict[str, int]:
        query = self.db.query(FitnessVideo.goal, func.count(FitnessVideo.id))
        if shown_only:
            query = query.filter(FitnessVideo.published.is_(True))
        found = dict(query.group_by(FitnessVideo.goal).all())
        return {goal: int(found.get(goal, 0)) for goal in GOALS}

    def member_page(self, goal: str, page: int) -> dict:
        shown = self.videos(goal, shown_only=True)
        total = len(shown)
        pages = max(1, math.ceil(total / PAGE_SIZE))
        page = min(max(1, page), pages)
        main = next((v for v in shown if v.is_main), shown[0] if shown else None)
        start = (page - 1) * PAGE_SIZE
        return {"goal": goal, "main": main, "videos": shown[start:start + PAGE_SIZE], "page": page, "pages": pages,
                "total": total, "page_size": PAGE_SIZE}

    # ---- changing ---------------------------------------------------------------------
    def add(self, goal: str, url: str, title: str, subtitle: str, *, by: str) -> FitnessVideo:
        goal = _goal(goal)
        try:
            link = parse_video_link(url)
        except VideoLinkError as exc:
            raise FitnessError(422, str(exc)) from exc
        title, subtitle = (title or "").strip(), (subtitle or "").strip()
        if not title:
            raise FitnessError(422, "Give the video a title members will see.")
        if len(title) > 160 or len(subtitle) > 200:
            raise FitnessError(422, "Keep the title under 160 characters and the subtitle under 200.")
        exists = (self.db.query(FitnessVideo.id)
                  .filter(FitnessVideo.goal == goal, FitnessVideo.provider == link.provider, FitnessVideo.video_id == link.video_id).first())
        if exists:
            raise FitnessError(409, f"That video is already in {GOALS[goal]}.")
        last = self.db.query(func.max(FitnessVideo.position)).filter(FitnessVideo.goal == goal).scalar()
        has_main = self.db.query(FitnessVideo.id).filter(FitnessVideo.goal == goal, FitnessVideo.is_main.is_(True)).first()
        video = FitnessVideo(goal=goal, provider=link.provider, video_id=link.video_id, video_hash=link.video_hash,
                             url=link.canonical, title=title, subtitle=subtitle,
                             thumbnail_url=link.thumbnail_url or self.thumbnailer(link),
                             position=(last + 1) if last is not None else 0, is_main=not has_main, published=True, updated_by=by)
        self.db.add(video)
        self.db.flush()
        return video

    def update(self, video: FitnessVideo, *, title: str | None, subtitle: str | None, published: bool | None, by: str) -> FitnessVideo:
        if title is not None:
            title = title.strip()
            if not title or len(title) > 160:
                raise FitnessError(422, "Give the video a title members will see (under 160 characters).")
            video.title = title
        if subtitle is not None:
            if len(subtitle.strip()) > 200:
                raise FitnessError(422, "Keep the subtitle under 200 characters.")
            video.subtitle = subtitle.strip()
        if published is not None:
            video.published = published
            if not published:
                video.is_main = False  # members fall back to the first shown video
        video.updated_by = by
        self.db.flush()
        return video

    def set_main(self, video: FitnessVideo, *, by: str) -> FitnessVideo:
        if not video.published:
            raise FitnessError(422, "Show this video to members before making it the main one.")
        current = (self.db.query(FitnessVideo)
                   .filter(FitnessVideo.goal == video.goal, FitnessVideo.is_main.is_(True), FitnessVideo.id != video.id).all())
        for other in current:
            other.is_main = False
        self.db.flush()  # the one-main-per-goal index sees the old main cleared first
        video.is_main = True
        video.updated_by = by
        self.db.flush()
        return video

    def reorder(self, goal: str, ids: list[UUID], *, by: str) -> list[FitnessVideo]:
        videos = {v.id: v for v in self.db.query(FitnessVideo).filter(FitnessVideo.goal == _goal(goal)).all()}
        if len(ids) != len(set(ids)) or set(ids) != set(videos):
            raise FitnessError(422, "The order has to list every video in this goal exactly once.")
        for position, video_id in enumerate(ids):
            videos[video_id].position = position
            videos[video_id].updated_by = by
        self.db.flush()
        return self.videos(goal)

    def remove(self, video: FitnessVideo) -> str:
        goal = video.goal
        self.db.delete(video)
        self.db.flush()
        return goal
