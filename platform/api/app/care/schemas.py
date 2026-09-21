from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Kind = Literal["fitness", "supplement", "resource"]
ContentType = Literal["video", "program", "article", "link", "copy"]

_URL_PREFIXES = ("https://", "http://")


def _url(value: str | None) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    if not value.startswith(_URL_PREFIXES):
        raise ValueError("Enter a full web address starting with https://")
    return value


class CareItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Kind
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    category: str | None = Field(default=None, max_length=80)
    content_type: ContentType = "copy"
    youtube_url: str | None = Field(default=None, max_length=300)
    external_url: str | None = Field(default=None, max_length=500)
    video_object_key: str | None = Field(default=None, max_length=300)
    body: str = Field(default="", max_length=20000)
    cautions: str | None = Field(default=None, max_length=4000)
    references: str | None = Field(default=None, max_length=4000)
    display_order: int = Field(default=0, ge=0, le=10000)

    @field_validator("youtube_url")
    @classmethod
    def youtube(cls, value: str | None) -> str | None:
        value = _url(value)
        if value and "youtube.com" not in value and "youtu.be" not in value:
            raise ValueError("The YouTube address must be on youtube.com or youtu.be.")
        return value

    @field_validator("external_url")
    @classmethod
    def external(cls, value: str | None) -> str | None:
        return _url(value)


class CareItemOut(BaseModel):
    id: UUID
    kind: str
    title: str
    description: str
    category: str | None
    content_type: str
    youtube_url: str | None
    youtube_embed_url: str | None
    external_url: str | None
    video_object_key: str | None
    body: str
    cautions: str | None
    references: str | None
    display_order: int
    status: str
    source: str | None
    created_at: datetime
    updated_at: datetime
    updated_by: str | None
    published_at: datetime | None
    published_by: str | None


class CareKindSummary(BaseModel):
    kind: str
    label: str
    total: int
    published: int
    draft: int
    archived: int


class MemberCareItem(BaseModel):
    """What a member sees: published metadata only."""

    id: UUID
    kind: str
    title: str
    description: str
    category: str | None
    content_type: str
    youtube_embed_url: str | None
    external_url: str | None
    body: str
    cautions: str | None
    references: str | None
    display_order: int
