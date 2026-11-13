"""Reading Word files and PDFs into the knowledge base.

Until this existed the console accepted plain text and Markdown only, so none
of the client's actual source material could be loaded — her documents are
.docx and .pdf. The tests build real files byte by byte rather than committing
fixtures: a .docx is a zip of XML and a minimal PDF is a few hundred bytes, so
the inputs stay inspectable and the client's own documents stay out of the
repository, where the .gitignore wants them.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from app.knowledge import extract
from app.knowledge.extract import ExtractionError

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# ---- builders ---------------------------------------------------------------

def make_docx(paragraphs: list[str], *, table: list[list[str]] | None = None,
              with_image: bool = False, body: str | None = None) -> bytes:
    """A .docx with exactly the parts the reader looks at."""
    if body is None:
        parts = []
        for text in paragraphs:
            if text == "":
                parts.append("<w:p/>")
            else:
                parts.append(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>")
        if table:
            rows = "".join(
                "<w:tr>" + "".join(
                    f"<w:tc><w:p><w:r><w:t>{cell}</w:t></w:r></w:p></w:tc>" for cell in row
                ) + "</w:tr>"
                for row in table
            )
            parts.append(f"<w:tbl>{rows}</w:tbl>")
        body = "".join(parts)
    document = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        z.writestr("word/document.xml", document)
        if with_image:
            z.writestr("word/media/image1.png", b"\x89PNG\r\n\x1a\n" + b"\0" * 32)
    return buffer.getvalue()


def make_pdf(pages: list[str]) -> bytes:
    """A minimal one-font PDF with a text stream per page."""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    for text in pages:
        page = writer.add_blank_page(width=612, height=792)
        escaped = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1"))
        font = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)}),
        })
        page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


# ---- which reader ------------------------------------------------------------

@pytest.mark.parametrize("filename,content_type,expected", [
    ("notes.txt", "text/plain", "text"),
    ("notes.md", "text/markdown", "text"),
    ("Cara.docx", DOCX_TYPE, "docx"),
    ("Cara.pdf", "application/pdf", "pdf"),
    # Browsers and operating systems disagree about Office types often enough
    # that the extension has to count as well as the header.
    ("Cara.docx", "application/octet-stream", "docx"),
    ("Cara.pdf", "", "pdf"),
    ("photo.png", "image/png", None),
])
def test_the_reader_is_chosen_by_type_or_extension(filename, content_type, expected):
    assert extract.kind_of(filename, content_type) == expected


def test_an_unsupported_type_is_refused_with_the_list_of_what_works():
    with pytest.raises(ExtractionError) as refused:
        extract.extract("diagram.png", "image/png", b"\x89PNG")
    assert refused.value.status_code == 415
    assert ".docx" in refused.value.detail and ".pdf" in refused.value.detail


def test_the_old_doc_format_says_what_to_do_about_it():
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Cara.doc", "application/msword", b"\xd0\xcf\x11\xe0")
    assert refused.value.status_code == 415
    assert "Save the file as .docx" in refused.value.detail


# ---- text --------------------------------------------------------------------

def test_plain_text_is_unchanged():
    result = extract.extract("notes.md", "text/markdown", b"# Heading\n\nBody text.")
    assert result.text == "# Heading\n\nBody text."
    assert result.kind == "text"


def test_text_that_is_not_utf8_is_refused_rather_than_mangled():
    with pytest.raises(ExtractionError) as refused:
        extract.extract("notes.txt", "text/plain", b"\xff\xfe\x00bad")
    assert refused.value.status_code == 422


# ---- docx --------------------------------------------------------------------

def test_a_word_document_reads_as_paragraphs_in_order():
    data = make_docx(["Protein Food Choices", "", "Best choices", "Fish 5oz woman, 7oz man"])
    result = extract.extract("Protein.docx", DOCX_TYPE, data)
    assert result.kind == "docx"
    assert result.text.splitlines() == [
        "Protein Food Choices", "", "Best choices", "Fish 5oz woman, 7oz man",
    ]
    # Three of the four carry text; the fourth is Word's spacing paragraph.
    assert "3 paragraphs with text" in result.note


def test_table_cells_are_read_in_place_not_dropped():
    """Cara's documents put real content in tables; losing them silently would
    index a document that looks complete and is not."""
    data = make_docx(["Blood markers"], table=[["Marker", "Range"], ["hs-CRP", "under 1.0"]])
    result = extract.extract("Markers.docx", DOCX_TYPE, data)
    for cell in ("Marker", "Range", "hs-CRP", "under 1.0"):
        assert cell in result.text
    assert "1 table(s) read in place" in result.note


def test_runs_of_empty_paragraphs_collapse_so_the_chunker_still_works():
    """Word files are full of empty spacing paragraphs. Left alone they split
    the text into fragments, because the chunker breaks on blank lines."""
    data = make_docx(["One", "", "", "", "Two"])
    result = extract.extract("Spaced.docx", DOCX_TYPE, data)
    assert result.text == "One\n\nTwo"


def test_a_word_document_with_images_says_they_were_not_read():
    data = make_docx(["Some text"], with_image=True)
    assert "Images were not read" in extract.extract("Figures.docx", DOCX_TYPE, data).note


def test_a_word_document_with_no_text_is_a_failure_not_an_empty_source():
    """Indexing nothing while reporting success is how an administrator comes
    to believe content is loaded when it is not."""
    data = make_docx([], with_image=True)
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Scan.docx", DOCX_TYPE, data)
    assert refused.value.status_code == 422
    assert "OCR" in refused.value.detail


def test_something_that_is_not_a_zip_is_refused_as_not_a_docx():
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Broken.docx", DOCX_TYPE, b"this is not a zip")
    assert refused.value.status_code == 422
    assert "zip archive" in refused.value.detail


def test_a_zip_without_a_document_body_is_refused():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("hello.txt", "not a word file")
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Odd.docx", DOCX_TYPE, buffer.getvalue())
    assert refused.value.status_code == 422


def test_a_zip_bomb_is_refused_before_it_is_read():
    """An upload is untrusted input. The stored bytes are already bounded; this
    bounds what they expand into."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", "A" * (extract.MAX_UNCOMPRESSED_BYTES + 1))
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Bomb.docx", DOCX_TYPE, buffer.getvalue())
    assert refused.value.status_code == 413


# ---- pdf ---------------------------------------------------------------------

def test_a_pdf_reads_page_by_page():
    data = make_pdf(["Health Number interpretation", "Bands and wording"])
    result = extract.extract("Health.pdf", "application/pdf", data)
    assert result.kind == "pdf"
    assert "Health Number interpretation" in result.text
    assert "Bands and wording" in result.text
    assert "2 of 2 page(s)" in result.note


def test_a_pdf_with_no_text_layer_says_it_needs_ocr():
    data = make_pdf([])
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Scan.pdf", "application/pdf", buffer.getvalue())
    assert refused.value.status_code == 422
    assert "OCR" in refused.value.detail
    assert data is not None


def test_a_file_that_is_not_a_pdf_is_refused():
    with pytest.raises(ExtractionError) as refused:
        extract.extract("Broken.pdf", "application/pdf", b"not a pdf at all")
    assert refused.value.status_code == 422


def test_line_breaks_from_the_page_are_rejoined_into_sentences():
    """PDF extraction breaks lines where the page did. "inflamm-\\nation" is
    not a word, and the embedder works on words."""
    tidy = extract._tidy_pdf_text("chronic inflamm-\nation is the\ntarget.\n\nNext block.")
    assert "inflammation" in tidy
    assert "is the target." in tidy
    assert "\n\nNext block." in tidy


def test_a_numbered_or_bulleted_line_keeps_its_own_line():
    tidy = extract._tidy_pdf_text("Choose a protein:\n- Fish\n- Chicken\n1. First\n2. Second")
    assert "- Fish\n- Chicken" in tidy
    assert "1. First\n2. Second" in tidy


def test_a_type_with_no_reader_is_refused_and_lists_what_works():
    """The refusal names the formats that do work, so an administrator with a
    .png of a table knows what to do rather than only that it failed."""
    with pytest.raises(ExtractionError) as refused:
        extract.extract("chart.png", "image/png", b"not-a-known-type")
    assert refused.value.status_code == 415
    detail = refused.value.detail
    for works in (".docx", ".pdf", ".md", ".txt"):
        assert works in detail
