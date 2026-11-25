"""Reading a YouTube or Vimeo link the console pasted into what a player needs.

Only the two providers the owner chose (15 Nov 2026). The parse is strict —
an id of the provider's own shape, on the provider's own hosts — so a link to
anywhere else can never become an iframe on a member's screen. YouTube plays
through its privacy-enhanced domain (as Cara's existing fitness videos do);
Vimeo with `dnt=1` (do not track).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be",
                 "youtube-nocookie.com", "www.youtube-nocookie.com"}
VIMEO_HOSTS = {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}
YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}", re.ASCII)
VIMEO_ID = re.compile(r"[0-9]{4,12}")
VIMEO_HASH = re.compile(r"[A-Za-z0-9]{6,32}", re.ASCII)


class VideoLinkError(ValueError):
    pass


@dataclass(frozen=True)
class VideoLink:
    provider: str
    video_id: str
    video_hash: str | None = None

    @property
    def canonical(self) -> str:
        if self.provider == "youtube":
            return f"https://www.youtube.com/watch?v={self.video_id}"
        return f"https://vimeo.com/{self.video_id}" + (f"/{self.video_hash}" if self.video_hash else "")

    @property
    def embed_url(self) -> str:
        if self.provider == "youtube":
            return f"https://www.youtube-nocookie.com/embed/{self.video_id}"
        return f"https://player.vimeo.com/video/{self.video_id}?dnt=1" + (f"&h={self.video_hash}" if self.video_hash else "")

    @property
    def watch_url(self) -> str:
        return f"https://youtu.be/{self.video_id}" if self.provider == "youtube" else self.canonical

    @property
    def thumbnail_url(self) -> str | None:
        """YouTube's still is derivable; Vimeo's is fetched once when the video is added."""
        return f"https://i.ytimg.com/vi/{self.video_id}/hqdefault.jpg" if self.provider == "youtube" else None


def parse_video_link(raw: str) -> VideoLink:
    text = (raw or "").strip()
    if not text or len(text) > 500 or any(ch.isspace() for ch in text):
        raise VideoLinkError("Paste a YouTube or Vimeo link.")
    if "://" not in text:
        text = "https://" + text
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
    except ValueError as exc:
        raise VideoLinkError("Paste a YouTube or Vimeo link.") from exc
    if parts.scheme.lower() not in ("http", "https") or parts.username or parts.password:
        raise VideoLinkError("Paste a YouTube or Vimeo link.")
    segments = [s for s in parts.path.split("/") if s]
    query = parse_qs(parts.query)

    if host in YOUTUBE_HOSTS:
        candidate = None
        if host.endswith("youtu.be"):
            candidate = segments[0] if segments else None
        elif segments[:1] == ["watch"]:
            candidate = (query.get("v") or [None])[0]
        elif len(segments) >= 2 and segments[0] in ("embed", "shorts", "live", "v"):
            candidate = segments[1]
        if candidate and YOUTUBE_ID.fullmatch(candidate):
            return VideoLink("youtube", candidate)
        raise VideoLinkError("That YouTube link does not point to one video. Open the video and copy its address.")

    if host in VIMEO_HOSTS:
        # The first numeric part is the video. A private link's hash follows it
        # and may happen to be all digits (vimeo.com/123456789/987654321).
        numeric = [i for i, s in enumerate(segments) if VIMEO_ID.fullmatch(s)]
        if numeric and segments[0] == "groups" and len(numeric) > 1:
            numeric = numeric[1:]  # /groups/<group>/videos/<video>
        if numeric:
            index = numeric[0]
            video_id = segments[index]
            follow = segments[index + 1] if index + 1 < len(segments) else None
            video_hash = (query.get("h") or [None])[0] or (follow if follow and VIMEO_HASH.fullmatch(follow) else None)
            if video_hash and not VIMEO_HASH.fullmatch(video_hash):
                video_hash = None
            return VideoLink("vimeo", video_id, video_hash)
        raise VideoLinkError("That Vimeo link does not point to one video. Open the video and copy its address.")

    raise VideoLinkError("Only YouTube and Vimeo links can be added. Paste a YouTube or Vimeo link.")
