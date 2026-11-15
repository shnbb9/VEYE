"""Profile pictures, decoded and rebuilt rather than trusted.

An upload is accepted only if it really decodes as a still JPEG, PNG or WebP
whose bytes start the way that format starts (SVG, GIF and anything animated
are refused). It is then re-encoded from its pixels, which drops EXIF — GPS,
camera serial, timestamps — and any other metadata or trailing payload, after
honouring the EXIF orientation so the picture is not saved sideways.

Two controlled variants are written: `full` (at most 512 px on the long side)
for Settings, and `thumb` (128 px) for the console's navigation and lists.
Decompression bombs are refused before any pixel is decoded.

A profile picture (15 Nov 2026) also keeps its ORIGINAL — rebuilt the same
way, so it carries no metadata either — and the square the person chose in
the circular crop frame. Both avatar variants are cut from exactly that
square of the upright original, so what the frame showed is what the avatar
is, and the picture can be re-cropped later without a new upload.
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


def _encode(image: Image.Image, fmt: str, *, keep: bool = False) -> bytes:
    """`keep` is for an original that is stored to be cut from again: a
    higher quality, so a later crop does not inherit a second generation of
    compression."""
    out = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(out, format="JPEG", quality=92 if keep else 88, optimize=True)
    elif fmt == "PNG":
        image.save(out, format="PNG", optimize=True)
    else:
        image.save(out, format="WEBP", quality=92 if keep else 85, method=4)
    return out.getvalue()


def _decode(data: bytes, *, max_bytes: int) -> tuple[Image.Image, str]:
    """The upright pixels of an accepted still image, and its format. Every
    refusal is an ImageRejected with words a person can act on."""
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
            return image.copy(), fmt
    except ImageRejected:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageRejected(422, "That image is too large to process.") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ImageRejected(415, "That file could not be read as an image.") from exc


def normalise_photo(data: bytes, *, max_bytes: int, full_side: int = FULL_SIDE, thumb_side: int = THUMB_SIDE) -> ProcessedPhoto:
    image, fmt = _decode(data, max_bytes=max_bytes)
    full = image.copy()
    full.thumbnail((full_side, full_side), Image.Resampling.LANCZOS)
    thumb = image.copy()
    thumb.thumbnail((thumb_side, thumb_side), Image.Resampling.LANCZOS)
    return ProcessedPhoto(full=_encode(full, fmt), thumb=_encode(thumb, fmt),
                          content_type=CONTENT_TYPES[fmt], extension=EXTENSIONS[fmt],
                          width=full.width, height=full.height)


# ---- profile pictures: the original and the person's own square ----------------

MIN_CROP_SIDE = 16


@dataclass(frozen=True)
class Crop:
    """A square of the UPRIGHT original, in its pixels: left, top, side."""
    x: int
    y: int
    size: int


@dataclass(frozen=True)
class ProcessedPicture:
    original: bytes
    full: bytes
    thumb: bytes
    content_type: str
    extension: str
    width: int    # the upright original's size
    height: int
    crop: Crop


def default_crop(width: int, height: int) -> Crop:
    """The centred square — what a circle showed before anyone chose."""
    side = min(width, height)
    return Crop(x=(width - side) // 2, y=(height - side) // 2, size=side)


def validate_crop(crop: Crop, width: int, height: int) -> Crop:
    if crop.size < min(MIN_CROP_SIDE, width, height):
        raise ImageRejected(422, "That crop is too small. Zoom out a little and try again.")
    if crop.x < 0 or crop.y < 0 or crop.x + crop.size > width or crop.y + crop.size > height:
        raise ImageRejected(422, "The crop has to stay inside the picture.")
    return crop


def _cut(image: Image.Image, crop: Crop, side: int) -> Image.Image:
    """Exactly the chosen square, resampled once, never enlarged."""
    target = min(side, crop.size)
    return image.resize((target, target), Image.Resampling.LANCZOS,
                        box=(crop.x, crop.y, crop.x + crop.size, crop.y + crop.size))


def prepare_picture(data: bytes, *, max_bytes: int, crop: Crop | None) -> ProcessedPicture:
    image, fmt = _decode(data, max_bytes=max_bytes)
    chosen = validate_crop(crop, image.width, image.height) if crop else default_crop(image.width, image.height)
    return ProcessedPicture(
        original=_encode(image, fmt, keep=True),
        full=_encode(_cut(image, chosen, FULL_SIDE), fmt), thumb=_encode(_cut(image, chosen, THUMB_SIDE), fmt),
        content_type=CONTENT_TYPES[fmt], extension=EXTENSIONS[fmt], width=image.width, height=image.height, crop=chosen,
    )


def recut_picture(original: bytes, crop: Crop) -> tuple[bytes, bytes]:
    """New avatar variants from a stored original (already upright and free
    of metadata). Returns (full, thumb)."""
    image, fmt = _decode(original, max_bytes=len(original) + 1)
    chosen = validate_crop(crop, image.width, image.height)
    return _encode(_cut(image, chosen, FULL_SIDE), fmt), _encode(_cut(image, chosen, THUMB_SIDE), fmt)


def thumb_key(full_key: str) -> str:
    """profile-photos/<id>/<ts>.jpg -> profile-photos/<id>/<ts>.thumb.jpg"""
    stem, dot, ext = full_key.rpartition(".")
    return f"{stem}.thumb.{ext}" if dot else f"{full_key}.thumb"


def original_key(full_key: str) -> str:
    """profile-photos/<id>/<ts>.jpg -> profile-photos/<id>/<ts>.original.jpg"""
    stem, dot, ext = full_key.rpartition(".")
    return f"{stem}.original.{ext}" if dot else f"{full_key}.original"
