"""Rich text the console can edit, without HTML ever being accepted.

The editor in the browser sends a small document tree — headings (H2/H3),
paragraphs, bold / italic / underline, bulleted and numbered lists, links and
an optional quote — and that tree is validated here against an explicit
allowlist (every model is `extra="forbid"`). HTML for the web page and the
email is then *generated* from the tree, with every text node escaped. No
submitted markup is parsed, so none can survive: there is no `<script>`,
`style`, `iframe`, image, event handler or attribute for an attacker to smuggle
through, because nothing here ever copies markup from input to output.

Links are restricted to https://, mailto: and site-relative paths. Variables
are `{{name}}` from a fixed allowlist, substituted BEFORE escaping, so a value
containing markup is escaped like any other text.
"""

from __future__ import annotations

import re
from html import escape
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MARKS = ("bold", "italic", "underline")
MAX_TEXT = 4000
MAX_DOC_BLOCKS = 80
VARIABLE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
# Control characters other than the newline a text run may legitimately hold.
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(text: str, allowed: frozenset[str]) -> str:
    if CONTROL.search(text):
        raise ValueError("Text contains control characters.")
    for name in VARIABLE.findall(text):
        if name not in allowed:
            raise ValueError(f"Unknown variable {{{{{name}}}}}. Allowed: {', '.join(sorted(allowed)) or 'none'}.")
    if "{{" in VARIABLE.sub("", text) or "}}" in VARIABLE.sub("", text):
        raise ValueError("A variable is written {{name}}.")
    return text


def safe_href(value: str) -> str:
    """https://host/…, mailto:address, or /path. Anything else is refused —
    javascript:, data:, vbscript:, plain http:, protocol-relative //host,
    credentials in the URL, and whitespace or control characters anywhere."""
    href = (value or "").strip()
    if not href or len(href) > 2000 or CONTROL.search(href) or any(ch.isspace() for ch in href):
        raise ValueError("A link needs a web address without spaces.")
    if href.startswith("/") and not href.startswith("//") and "\\" not in href:
        return href
    if href.lower().startswith("mailto:"):
        address = href[7:]
        if re.fullmatch(r"[^@\s<>\"']+@[^@\s<>\"']+\.[A-Za-z]{2,}", address):
            return href
        raise ValueError("That email link is not a valid address.")
    parts = urlsplit(href)
    if parts.scheme.lower() != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("Links must start with https:// (or be an email address or a page on this site).")
    return href


class Context:
    """Which variables a document may use. Set per document kind."""

    allowed: frozenset[str] = frozenset()


class TextRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["text"] = "text"
    text: str = Field(max_length=MAX_TEXT)
    marks: list[Literal["bold", "italic", "underline"]] = Field(default_factory=list, max_length=3)

    @field_validator("marks")
    @classmethod
    def _unique_marks(cls, value: list[str]) -> list[str]:
        return sorted(set(value), key=MARKS.index)


class LinkRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["link"] = "link"
    href: str = Field(max_length=2000)
    children: list[TextRun] = Field(min_length=1, max_length=20)

    @field_validator("href")
    @classmethod
    def _href(cls, value: str) -> str:
        return safe_href(value)


Inline = Annotated[TextRun | LinkRun, Field(discriminator="type")]


class Paragraph(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["paragraph"] = "paragraph"
    children: list[Inline] = Field(default_factory=list, max_length=200)


class Heading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["heading"] = "heading"
    level: Literal[2, 3] = 2
    children: list[Inline] = Field(min_length=1, max_length=50)


class ListBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["bullet_list", "ordered_list"]
    items: list[list[Inline]] = Field(min_length=1, max_length=60)


class Quote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["blockquote"] = "blockquote"
    children: list[Inline] = Field(min_length=1, max_length=200)


Block = Annotated[Paragraph | Heading | ListBlock | Quote, Field(discriminator="type")]


class RichDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blocks: list[Block] = Field(default_factory=list, max_length=MAX_DOC_BLOCKS)

    def runs(self):
        for block in self.blocks:
            groups = block.items if isinstance(block, ListBlock) else [block.children]
            for group in groups:
                for inline in group:
                    if isinstance(inline, LinkRun):
                        yield from inline.children
                    else:
                        yield inline

    def check_variables(self, allowed: frozenset[str]) -> "RichDoc":
        for run in self.runs():
            _clean(run.text, allowed)
        return self

    def is_blank(self) -> bool:
        return not any(run.text.strip() for run in self.runs())

    @model_validator(mode="after")
    def _no_control_characters(self) -> "RichDoc":
        for run in self.runs():
            if CONTROL.search(run.text):
                raise ValueError("Text contains control characters.")
        return self


def check_plain(text: str, allowed: frozenset[str], *, max_length: int) -> str:
    """A one-line field (an email subject): no newlines, allowlisted variables."""
    value = (text or "").strip()
    if not value or len(value) > max_length:
        raise ValueError(f"Write between 1 and {max_length} characters.")
    if "\n" in value or "\r" in value:
        raise ValueError("This field is a single line.")
    return _clean(value, allowed)


def substitute(text: str, variables: dict[str, str]) -> str:
    return VARIABLE.sub(lambda m: variables.get(m.group(1), ""), text)


# ---- rendering ---------------------------------------------------------------------

_TAGS = {"bold": "strong", "italic": "em", "underline": "u"}
_STYLE = {
    "p": "margin:0 0 14px;font-size:16px;line-height:1.5;color:#2E4A1A",
    "h2": "margin:18px 0 10px;font-size:20px;line-height:1.3;color:#2E4A1A",
    "h3": "margin:16px 0 8px;font-size:17px;line-height:1.3;color:#2E4A1A",
    "ul": "margin:0 0 14px 20px;padding:0;font-size:16px;line-height:1.5;color:#2E4A1A",
    "blockquote": "margin:0 0 14px;padding:0 0 0 12px;border-left:3px solid #C9D8B4;color:#3D5A26",
    "a": "color:#446514;text-decoration:underline",
}


def _run_html(run: TextRun, variables: dict[str, str]) -> str:
    out = escape(substitute(run.text, variables)).replace("\n", "<br />")
    for mark in run.marks:
        out = f"<{_TAGS[mark]}>{out}</{_TAGS[mark]}>"
    return out


def _inline_html(children, variables: dict[str, str], *, email: bool) -> str:
    parts = []
    for inline in children:
        if isinstance(inline, LinkRun):
            href = escape(substitute(inline.href, variables), quote=True)
            style = f' style="{_STYLE["a"]}"' if email else ""
            parts.append(f'<a href="{href}"{style} rel="noopener noreferrer">'
                         + "".join(_run_html(c, variables) for c in inline.children) + "</a>")
        else:
            parts.append(_run_html(inline, variables))
    return "".join(parts)


def render_html(doc: RichDoc, variables: dict[str, str] | None = None, *, email: bool = False) -> str:
    """Markup generated from the validated tree. `email=True` inlines the
    styles mail clients need; the web version carries none (the page styles
    it)."""
    variables = variables or {}
    style = (lambda tag: f' style="{_STYLE[tag]}"') if email else (lambda tag: "")
    out = []
    for block in doc.blocks:
        if isinstance(block, Heading):
            tag = f"h{block.level}"
            out.append(f"<{tag}{style(tag)}>{_inline_html(block.children, variables, email=email)}</{tag}>")
        elif isinstance(block, ListBlock):
            tag = "ul" if block.type == "bullet_list" else "ol"
            items = "".join(f"<li>{_inline_html(item, variables, email=email)}</li>" for item in block.items)
            out.append(f"<{tag}{style('ul')}>{items}</{tag}>")
        elif isinstance(block, Quote):
            out.append(f"<blockquote{style('blockquote')}>{_inline_html(block.children, variables, email=email)}</blockquote>")
        else:
            out.append(f"<p{style('p')}>{_inline_html(block.children, variables, email=email)}</p>")
    return "".join(out)


def render_text(doc: RichDoc, variables: dict[str, str] | None = None) -> str:
    """The plain-text twin, for the text/plain part of an email and for any
    reader that does not render HTML."""
    variables = variables or {}

    def inline(children) -> str:
        parts = []
        for item in children:
            if isinstance(item, LinkRun):
                label = "".join(substitute(c.text, variables) for c in item.children)
                href = substitute(item.href, variables)
                parts.append(label if label == href else f"{label} ({href})")
            else:
                parts.append(substitute(item.text, variables))
        return "".join(parts)

    lines: list[str] = []
    for block in doc.blocks:
        if isinstance(block, ListBlock):
            for index, item in enumerate(block.items, start=1):
                lines.append(f"{index}. {inline(item)}" if block.type == "ordered_list" else f"- {inline(item)}")
            lines.append("")
        elif isinstance(block, Quote):
            lines.append("> " + inline(block.children))
            lines.append("")
        else:
            lines.append(inline(block.children))
            lines.append("")
    return "\n".join(lines).strip() + "\n"


def paragraphs(*texts: str) -> RichDoc:
    """Build a plain document from paragraphs (for built-in defaults)."""
    return RichDoc(blocks=[Paragraph(children=[TextRun(text=t)]) for t in texts])
