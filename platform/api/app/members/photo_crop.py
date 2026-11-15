"""The square a person chose in the circular crop frame, as the two portals'
picture routes accept it. Shared so the member and the console endpoints
cannot drift apart: one shape, one set of bounds, one refusal wording."""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.storage.images import MAX_INPUT_SIDE, Crop


class CropIn(BaseModel):
    """Left, top and side of the square, in the upright original's pixels."""
    model_config = ConfigDict(extra="forbid")
    x: int = Field(ge=0, le=MAX_INPUT_SIDE)
    y: int = Field(ge=0, le=MAX_INPUT_SIDE)
    size: int = Field(ge=1, le=MAX_INPUT_SIDE)

    def crop(self) -> Crop:
        return Crop(x=self.x, y=self.y, size=self.size)


def form_crop(x: int | None, y: int | None, size: int | None) -> Crop | None:
    """The optional crop sent with an upload: all three numbers or none."""
    given = [value is not None for value in (x, y, size)]
    if not any(given):
        return None
    if not all(given):
        raise HTTPException(status_code=422, detail="Send the whole crop (left, top and size), or none of it.")
    if min(x, y) < 0 or size < 1 or max(x, y, size) > MAX_INPUT_SIDE:  # type: ignore[type-var]
        raise HTTPException(status_code=422, detail="The crop has to stay inside the picture.")
    return Crop(x=x, y=y, size=size)  # type: ignore[arg-type]
