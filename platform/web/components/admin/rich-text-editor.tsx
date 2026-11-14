"use client";

import { useEffect, useRef } from "react";

/* A small WYSIWYG editor for the console (architecture V2 §4.5): H2, H3,
   paragraphs, bold, italic, underline, bulleted and numbered lists, safe
   links and a quote. It never sends HTML. What leaves this component is a
   document tree (the same shape app/policies/richtext.py validates); the
   server renders all markup from that tree with every text node escaped.

   Pasting inserts plain text only, and dropping files or images is refused,
   so formatting, images, scripts and styles from elsewhere cannot come in
   that way either. Unknown elements the browser produces are flattened to
   their text. */

export type TextRun = { type: "text"; text: string; marks: ("bold" | "italic" | "underline")[] };
export type LinkRun = { type: "link"; href: string; children: TextRun[] };
export type Inline = TextRun | LinkRun;
export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "bullet_list" | "ordered_list"; items: Inline[][] }
  | { type: "blockquote"; children: Inline[] };
export type RichDoc = { blocks: Block[] };

const MARK_TAGS: Record<string, TextRun["marks"][number]> = { B: "bold", STRONG: "bold", I: "italic", EM: "italic", U: "underline" };

export function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (!value || /\s/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  if (/^mailto:[^@\s<>"']+@[^@\s<>"']+\.[A-Za-z]{2,}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

/* ---- DOM -> tree ---------------------------------------------------------- */

function inlines(node: Node, marks: TextRun["marks"], out: Inline[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/ /g, " ");
      if (text) out.push({ type: "text", text, marks: [...marks] });
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "BR") { out.push({ type: "text", text: "\n", marks: [...marks] }); continue; }
    if (child.tagName === "A") {
      const href = child.getAttribute("href") ?? "";
      const runs: Inline[] = [];
      inlines(child, marks, runs);
      const textRuns = runs.filter((r): r is TextRun => r.type === "text");
      if (isSafeHref(href) && textRuns.length) out.push({ type: "link", href: href.trim(), children: textRuns });
      else out.push(...textRuns);
      continue;
    }
    const mark = MARK_TAGS[child.tagName];
    // execCommand sometimes expresses bold/italic as styled spans.
    const styled: TextRun["marks"] = [];
    if (child.style?.fontWeight === "bold" || Number(child.style?.fontWeight) >= 600) styled.push("bold");
    if (child.style?.fontStyle === "italic") styled.push("italic");
    if (child.style?.textDecorationLine?.includes("underline")) styled.push("underline");
    const next = Array.from(new Set([...marks, ...(mark ? [mark] : []), ...styled]));
    inlines(child, next, out);
  }
}

function merge(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (run.type === "text" && last?.type === "text" && last.marks.join() === run.marks.join()) last.text += run.text;
    else out.push(run);
  }
  // Leading/trailing line breaks inside a block are noise from the editor.
  while (out.length && out[0].type === "text" && !(out[0] as TextRun).text.trim()) out.shift();
  while (out.length && out[out.length - 1].type === "text" && !(out[out.length - 1] as TextRun).text.trim()) out.pop();
  return out;
}

export function domToDoc(root: HTMLElement): RichDoc {
  const blocks: Block[] = [];
  let loose: Inline[] = [];
  const flush = () => { const children = merge(loose); if (children.length) blocks.push({ type: "paragraph", children }); loose = []; };
  for (const child of Array.from(root.childNodes)) {
    if (child instanceof HTMLElement && ["P", "DIV", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "UL", "OL"].includes(child.tagName)) {
      flush();
      if (child.tagName === "UL" || child.tagName === "OL") {
        const items = Array.from(child.children).filter((li) => li.tagName === "LI").map((li) => { const runs: Inline[] = []; inlines(li, [], runs); return merge(runs); }).filter((r) => r.length);
        if (items.length) blocks.push({ type: child.tagName === "UL" ? "bullet_list" : "ordered_list", items });
        continue;
      }
      const runs: Inline[] = [];
      inlines(child, [], runs);
      const children = merge(runs);
      if (!children.length) continue;
      if (child.tagName === "H2" || child.tagName === "H1") blocks.push({ type: "heading", level: 2, children });
      else if (child.tagName === "H3" || child.tagName === "H4") blocks.push({ type: "heading", level: 3, children });
      else if (child.tagName === "BLOCKQUOTE") blocks.push({ type: "blockquote", children });
      else blocks.push({ type: "paragraph", children });
    } else {
      inlines({ childNodes: [child] } as unknown as Node, [], loose);
    }
  }
  flush();
  return { blocks };
}

/* ---- tree -> DOM (built with createElement/textContent; no innerHTML) ---- */

function appendInline(parent: HTMLElement, run: Inline) {
  if (run.type === "link") {
    const a = document.createElement("a");
    a.setAttribute("href", run.href);
    run.children.forEach((child) => appendInline(a, child));
    parent.appendChild(a);
    return;
  }
  let node: Node = document.createTextNode(run.text);
  for (const mark of run.marks) {
    const el = document.createElement(mark === "bold" ? "strong" : mark === "italic" ? "em" : "u");
    el.appendChild(node);
    node = el;
  }
  parent.appendChild(node);
}

export function docToDom(root: HTMLElement, doc: RichDoc) {
  root.replaceChildren();
  for (const block of doc.blocks) {
    if (block.type === "bullet_list" || block.type === "ordered_list") {
      const list = document.createElement(block.type === "bullet_list" ? "ul" : "ol");
      block.items.forEach((item) => { const li = document.createElement("li"); item.forEach((run) => appendInline(li, run)); list.appendChild(li); });
      root.appendChild(list);
      continue;
    }
    const tag = block.type === "heading" ? `h${block.level}` : block.type === "blockquote" ? "blockquote" : "p";
    const el = document.createElement(tag);
    (block as { children: Inline[] }).children.forEach((run) => appendInline(el, run));
    root.appendChild(el);
  }
  if (!root.childNodes.length) root.appendChild(document.createElement("p"));
}

/* ---- the component ---------------------------------------------------------- */

export function RichTextEditor({ id, label, value, onChange, testId, variables }: {
  id: string; label: string; value: RichDoc; onChange: (doc: RichDoc) => void; testId?: string; variables?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useRef<string>("");

  // Render the incoming value only when it differs from what the editor last
  // produced, so typing never resets the caret.
  useEffect(() => {
    const serialised = JSON.stringify(value);
    if (ref.current && serialised !== loaded.current) {
      docToDom(ref.current, value);
      loaded.current = serialised;
    }
  }, [value]);

  function emit() {
    if (!ref.current) return;
    const doc = domToDoc(ref.current);
    loaded.current = JSON.stringify(doc);
    onChange(doc);
  }

  function command(name: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  }

  function link() {
    const href = window.prompt("Link address (https://…, mailto:…, or a page on this site such as /privacy)");
    if (href === null) return;
    if (!isSafeHref(href)) { window.alert("Only https://, mailto: and site links (starting with /) are allowed."); return; }
    command("createLink", href.trim());
  }

  const tools: [string, string, () => void][] = [
    ["H2", "Heading", () => command("formatBlock", "<h2>")],
    ["H3", "Subheading", () => command("formatBlock", "<h3>")],
    ["¶", "Paragraph", () => command("formatBlock", "<p>")],
    ["B", "Bold", () => command("bold")],
    ["I", "Italic", () => command("italic")],
    ["U", "Underline", () => command("underline")],
    ["•", "Bulleted list", () => command("insertUnorderedList")],
    ["1.", "Numbered list", () => command("insertOrderedList")],
    ["❝", "Quote", () => command("formatBlock", "<blockquote>")],
    ["Link", "Add link", link],
    ["Unlink", "Remove link", () => command("unlink")],
  ];

  return (
    <div className="rte" data-testid={testId}>
      <div className="field__label" id={`${id}-label`}>{label}</div>
      <div className="rte__toolbar" role="toolbar" aria-label={`${label} formatting`}>
        {tools.map(([glyph, name, run]) => (
          <button key={name} type="button" className="rte__tool" aria-label={name} title={name}
                  onMouseDown={(event) => event.preventDefault()} onClick={run}>{glyph}</button>
        ))}
      </div>
      <div ref={ref} id={id} className="rte__area" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
           aria-labelledby={`${id}-label`} tabIndex={0} onInput={emit} onBlur={emit}
           onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); emit(); }}
           onDrop={(event) => event.preventDefault()} onDragOver={(event) => event.preventDefault()} />
      {variables && variables.length > 0 && (
        <p className="field__hint">Variables you can type: {variables.map((v) => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}</p>
      )}
    </div>
  );
}
