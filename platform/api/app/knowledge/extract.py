"""Turning an uploaded document into the text the knowledge base indexes.

Until now this environment ingested plain text and Markdown only, which meant
an administrator could not load any of the client's actual source material:
Cara's documents are Word files and PDFs. A knowledge base that refuses the
documents it exists to hold is not a knowledge base.

Three formats, and a refusal for everything else:

- **text / Markdown** — decoded as UTF-8, unchanged from before.
- **DOCX** — read with the standard library. A .docx is a zip of XML, so this
  needs no dependency at all: paragraphs and table cells in document order.
- **PDF** — read with `pypdf`, page by page.

What is deliberately *not* done here:

- **No OCR.** A scanned PDF has no text layer, and silently indexing an empty
  document would leave an administrator believing the content was loaded. An
  empty extraction is reported as a failure that names the likely cause.
- **No images, no charts, no embedded objects.** The extractor says so in its
  note rather than leaving a reader to assume a diagram was understood.
- **No .doc.** The old binary format is a different problem entirely; the
  refusal says to save as .docx rather than failing obscurely.

Uploads are untrusted input, so both readers are bounded: a zip is checked for
its uncompressed size before anything is read out of it, and a PDF is capped
at a page count. The caller has already bounded the stored bytes; these bounds
are about what the bytes expand into.
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

TEXT_CONTENT_TYPES = {"text/plain", "text/markdown", "text/x-markdown"}
TEXT_EXTENSIONS = {".txt", ".md", ".markdown"}

DOCX_CONTENT_TYPES = {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
DOCX_EXTENSIONS = {".docx"}

PDF_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}
PDF_EXTENSIONS = {".pdf"}

SUPPORTED_EXTENSIONS = sorted(TEXT_EXTENSIONS | DOCX_EXTENSIONS | PDF_EXTENSIONS)

# A .docx that expands to more than this is not a document anyone wrote.
MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
MAX_PDF_PAGES = 400


class ExtractionError(Exception):
    """The bytes could not be turned into text. `status_code` is how the API
    should answer: 415 for a format, 422 for a file that is the right format
    but unreadable."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class Extracted:
    text: str
    kind: str   # "text" | "docx" | "pdf"
    # What was taken and what was not, kept with the document so an
    # administrator can see why a source reads thinner than the original.
    note: str


def extension_of(filename: str) -> str:
    return "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def kind_of(filename: str, content_type: str) -> str | None:
    """Which reader handles this, by declared type or by extension.

    The extension is consulted as well as the content type because browsers
    and operating systems disagree about Office types often enough that
    trusting the header alone rejects real documents.
    """
    declared = (content_type or "").split(";")[0].strip().lower()
    extension = extension_of(filename)
    if declared in TEXT_CONTENT_TYPES or extension in TEXT_EXTENSIONS:
        return "text"
    if declared in DOCX_CONTENT_TYPES or extension in DOCX_EXTENSIONS:
        return "docx"
    if declared in PDF_CONTENT_TYPES or extension in PDF_EXTENSIONS:
        return "pdf"
    return None


def extract(filename: str, content_type: str, data: bytes) -> Extracted:
    kind = kind_of(filename, content_type)
    if kind is None:
        if extension_of(filename) == ".doc":
            raise ExtractionError(
                415, "The old .doc format is not read. Save the file as .docx and upload it again.")
        raise ExtractionError(
            415,
            "That file type is not ingested. Supported: "
            + ", ".join(SUPPORTED_EXTENSIONS) + ".")
    if kind == "text":
        return _extract_text(data)
    if kind == "docx":
        return _extract_docx(data)
    return _extract_pdf(data)


# ---- text -------------------------------------------------------------------

def _extract_text(data: bytes) -> Extracted:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ExtractionError(422, "The document is not UTF-8 text.") from exc
    return Extracted(text=text, kind="text", note="Plain text, taken whole.")


# ---- docx -------------------------------------------------------------------

def _extract_docx(data: bytes) -> Extracted:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ExtractionError(422, "That file is not a readable .docx (a .docx is a zip archive).") from exc

    with archive:
        total = sum(info.file_size for info in archive.infolist())
        if total > MAX_UNCOMPRESSED_BYTES:
            raise ExtractionError(413, "That .docx expands to more than 60 MB and was not read.")
        if "word/document.xml" not in archive.namelist():
            raise ExtractionError(422, "That .docx has no document body (word/document.xml is missing).")
        try:
            root = ET.fromstring(archive.read("word/document.xml"))
        except ET.ParseError as exc:
            raise ExtractionError(422, "The .docx body could not be parsed.") from exc
        has_images = any(name.startswith("word/media/") for name in archive.namelist())

    # Paragraphs in document order. `iter` is recursive, so paragraphs inside
    # tables and text boxes come through in place rather than being lost.
    paragraphs = []
    for node in root.iter(W + "p"):
        text = "".join(t.text or "" for t in node.iter(W + "t")).strip()
        paragraphs.append(text)

    tables = sum(1 for _ in root.iter(W + "tbl"))
    body = _collapse_blank_runs(paragraphs)
    if not body.strip():
        raise ExtractionError(
            422,
            "No text was found in that .docx. If the content is images of text, it needs to be "
            "typed or run through OCR before it can be indexed.")

    note = f"Word document: {sum(1 for p in paragraphs if p)} paragraphs with text"
    if tables:
        note += f", {tables} table(s) read in place"
    if has_images:
        note += ". Images were not read"
    note += "."
    return Extracted(text=body, kind="docx", note=note)


def _collapse_blank_runs(paragraphs: list[str]) -> str:
    """One blank line between blocks, never three.

    The chunker splits on blank lines, so a Word file full of empty spacing
    paragraphs would otherwise chunk into fragments.
    """
    out: list[str] = []
    for text in paragraphs:
        if text:
            out.append(text)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()


# ---- pdf --------------------------------------------------------------------

def _extract_pdf(data: bytes) -> Extracted:
    try:  # pragma: no cover - import guard
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as exc:  # pragma: no cover
        raise ExtractionError(
            415, "PDF reading is not available in this deployment (the 'pypdf' package is missing).") from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # An empty password opens most "protected" PDFs; a real one does not.
            try:
                reader.decrypt("")
            except Exception:  # pragma: no cover - depends on the file
                raise ExtractionError(422, "That PDF is password protected and was not read.")
        pages = reader.pages
    except ExtractionError:
        raise
    except PdfReadError as exc:
        raise ExtractionError(422, "That PDF could not be read.") from exc
    except Exception as exc:  # pragma: no cover - pypdf raises a wide range
        raise ExtractionError(422, "That PDF could not be read.") from exc

    count = len(pages)
    if count > MAX_PDF_PAGES:
        raise ExtractionError(413, f"That PDF has {count} pages; the limit is {MAX_PDF_PAGES}.")

    blocks: list[str] = []
    for page in pages:
        try:
            text = page.extract_text() or ""
        except Exception:  # pragma: no cover - a single bad page
            text = ""
        text = _tidy_pdf_text(text)
        if text:
            blocks.append(text)

    body = "\n\n".join(blocks).strip()
    if not body:
        raise ExtractionError(
            422,
            f"No text was found in those {count} page(s). A scanned PDF has no text layer and "
            f"needs OCR before it can be indexed.")

    note = f"PDF: {len(blocks)} of {count} page(s) carried text. Images and figures were not read."
    return Extracted(text=body, kind="pdf", note=note)


_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_SOFT_WRAP = re.compile(r"(?<![\n.:;!?])\n(?![\n\s•\-\d])")


def _tidy_pdf_text(text: str) -> str:
    """PDF extraction breaks lines where the page did, not where the sentence
    does. Rejoining them matters because the chunker works on paragraphs and
    the embedder works on words: "inflamm-\\nation" is not a word."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    text = _SOFT_WRAP.sub(" ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
