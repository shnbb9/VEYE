"""Deterministic chunking for text and Markdown documents.

Splits on headings and blank lines, then packs paragraphs into chunks of
roughly `target_chars`. No overlap, no randomness: the same document always
produces the same chunks."""

from __future__ import annotations

import re
from dataclasses import dataclass

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    heading: str | None
    text: str

    @property
    def token_estimate(self) -> int:
        return max(1, len(self.text) // 4)


def chunk_text(text: str, *, target_chars: int = 700, max_chars: int = 1100) -> list[Chunk]:
    blocks: list[tuple[str | None, str]] = []
    heading: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            paragraph = " ".join(line.strip() for line in buffer).strip()
            if paragraph:
                blocks.append((heading, paragraph))
            buffer.clear()

    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = raw_line.rstrip()
        match = _HEADING_RE.match(line)
        if match:
            flush()
            heading = match.group(2).strip()
            continue
        if not line.strip():
            flush()
            continue
        buffer.append(line)
    flush()

    chunks: list[Chunk] = []
    current_heading: str | None = None
    current: list[str] = []
    size = 0

    def emit() -> None:
        nonlocal current, size
        if current:
            chunks.append(Chunk(ordinal=len(chunks), heading=current_heading, text="\n\n".join(current)))
        current, size = [], 0

    for block_heading, paragraph in blocks:
        if current and (block_heading != current_heading or size + len(paragraph) > target_chars):
            emit()
        current_heading = block_heading
        # A single very long paragraph is split on sentence boundaries.
        for piece in _split_long(paragraph, max_chars):
            if current and size + len(piece) > max_chars:
                emit()
                current_heading = block_heading
            current.append(piece)
            size += len(piece)
    emit()
    return chunks


def _split_long(paragraph: str, max_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]
    pieces: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
        if current and len(current) + len(sentence) + 1 > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces
