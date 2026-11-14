"""Profile pictures, decoded and rebuilt rather than trusted.

An upload is accepted only if it really decodes as a still JPEG, PNG or WebP
whose bytes start the way that format starts (SVG, GIF and anything animated
are refused). It is then re-encoded from its pixels, which drops EXIF — GPS,
camera serial, timestamps — and any other metadata or trailing payload, after
honouring the EXIF orientation so the picture is not saved sideways.

Two controlled variants are written: `full` (at most 512 px on the long side)
for Settings, and `thumb` (128 px) for the console's navigation and lists.
Decompression bombs are refused before any pixel is decoded.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

FULL_SIDE = 512
THUMB_SIDE = 128
MAX_INPUT_SIDE = 6000
# Pillow raises DecompressionBombError above twice this many pixels (25 M,
# about 100 MB decoded). Set once, here: the setting is process-global, and
# changing it per request would race between concurrent uploads.
Image.MAX_IMAGE_PIXELS = 12_500_000

MAGIC = {"JPEG": (b"\xff\xd8\xff",), "PNG": (b"\x89PNG\r\n\x1a\n",), "WEBP": (b"RIFF",)}
CONTENT_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


class ImageRejected(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class ProcessedPhoto:
    full: bytes
    thumb: bytes
    content_type: str
    extension: str
    width: int
    height: int


def _sniff(data: bytes) -> str | None:
    for fmt, magics in MAGIC.items():
        if any(data.startswith(m) for m in magics):
            if fmt == "WEBP" and data[8:12] != b"WEBP":
                continue
            return fmt
    return None


def _encode(image: Image.Image, fmt: str) -> bytes:
    out = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(out, format="JPEG", quality=88, optimize=True)
    elif fmt == "PNG":
        image.save(out, format="PNG", optimize=True)
    else:
        image.save(out, format="WEBP", quality=85, method=4)
    return out.getvalue()


def normalise_photo(data: bytes, *, max_bytes: int) -> ProcessedPhoto:
    if not data:
        raise ImageRejected(422, "Choose an image file.")
    if len(data) > max_bytes:
        raise ImageRejected(413, f"The photo is too large. Please use an image under {max_bytes // 1_000_000} MB.")
    fmt = _sniff(data)
    if fmt is None:
        raise ImageRejected(415, "Please choose a JPG, PNG or WebP image.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format != fmt:
                raise ImageRejected(415, "The file's contents do not match an image type we accept.")
            if getattr(probe, "is_animated", False) or getattr(probe, "n_frames", 1) > 1:
                raise ImageRejected(415, "Please choose a still image, not an animation.")
            width, height = probe.size
            if width < 1 or height < 1 or width > MAX_INPUT_SIDE or height > MAX_INPUT_SIDE:
                raise ImageRejected(422, f"The image must be at most {MAX_INPUT_SIDE} pixels on each side.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            if image.mode not in ("RGB", "RGBA", "L", "LA"):
                image = image.convert("RGBA" if "A" in image.getbands() or image.mode == "P" else "RGB")
            full = image.copy()
            full.thumbnail((FULL_SIDE, FULL_SIDE), Image.Resampling.LANCZOS)
            thumb = image.copy()
            thumb.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.Resampling.LANCZOS)
            return ProcessedPhoto(full=_encode(full, fmt), thumb=_encode(thumb, fmt),
                                  content_type=CONTENT_TYPES[fmt], extension=EXTENSIONS[fmt],
                                  width=full.width, height=full.height)
    except ImageRejected:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageRejected(422, "That image is too large to process.") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ImageRejected(415, "That file could not be read as an image.") from exc


def thumb_key(full_key: str) -> str:
    """profile-photos/<id>/<ts>.jpg -> profile-photos/<id>/<ts>.thumb.jpg"""
    stem, dot, ext = full_key.rpartition(".")
    return f"{stem}.thumb.{ext}" if dot else f"{full_key}.thumb"
