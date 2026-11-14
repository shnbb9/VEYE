/* ============================================================================
   Veye Admin — rich-text editor
   ----------------------------------------------------------------------------
   The console's small WYSIWYG editor (platform/web components/admin/
   rich-text-editor.tsx): H2, H3, paragraphs, bold, italic, underline,
   bulleted and numbered lists, safe links and a quote. What leaves it is a
   document tree — never HTML — the same shape the API validates
   (app/policies/richtext.py); everything rendered back is built with
   textContent, so no markup from anywhere can come in.

   Pasting inserts plain text only, and dropping files is refused.
   ============================================================================ */

(function () {

const UI = window.Veye.UI;
const H = () => window.Veye.H;
const esc = UI.esc;

const MARK_TAGS = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', U: 'underline' };

function isSafeHref(href) {
  const value = String(href || '').trim();
  if (!value || /\s/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  if (/^mailto:[^@\s<>"']+@[^@\s<>"']+\.[A-Za-z]{2,}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch (e) { return false; }
}

/* ---- DOM -> tree ---------------------------------------------------------- */
function inlines(node, marks, out) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent || '').replace(/ /g, ' ');
      if (text) out.push({ type: 'text', text, marks: [...marks] });
      return;
    }
    if (!(child instanceof HTMLElement)) return;
    if (child.tagName === 'BR') { out.push({ type: 'text', text: '\n', marks: [...marks] }); return; }
    if (child.tagName === 'A') {
      const href = child.getAttribute('href') || '';
      const runs = [];
      inlines(child, marks, runs);
      const textRuns = runs.filter((r) => r.type === 'text');
      if (isSafeHref(href) && textRuns.length) out.push({ type: 'link', href: href.trim(), children: textRuns });
      else out.push(...textRuns);
      return;
    }
    const mark = MARK_TAGS[child.tagName];
    const styled = [];
    if (child.style && (child.style.fontWeight === 'bold' || Number(child.style.fontWeight) >= 600)) styled.push('bold');
    if (child.style && child.style.fontStyle === 'italic') styled.push('italic');
    if (child.style && (child.style.textDecorationLine || '').includes('underline')) styled.push('underline');
    inlines(child, Array.from(new Set([...marks, ...(mark ? [mark] : []), ...styled])), out);
  });
}

function merge(runs) {
  const out = [];
  runs.forEach((run) => {
    const last = out[out.length - 1];
    if (run.type === 'text' && last && last.type === 'text' && last.marks.join() === run.marks.join()) last.text += run.text;
    else out.push(run);
  });
  while (out.length && out[0].type === 'text' && !out[0].text.trim()) out.shift();
  while (out.length && out[out.length - 1].type === 'text' && !out[out.length - 1].text.trim()) out.pop();
  return out;
}

function domToDoc(root) {
  const blocks = [];
  let loose = [];
  const flush = () => { const children = merge(loose); if (children.length) blocks.push({ type: 'paragraph', children }); loose = []; };
  Array.from(root.childNodes).forEach((child) => {
    if (child instanceof HTMLElement && ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL'].includes(child.tagName)) {
      flush();
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        const items = Array.from(child.children).filter((li) => li.tagName === 'LI').map((li) => { const runs = []; inlines(li, [], runs); return merge(runs); }).filter((r) => r.length);
        if (items.length) blocks.push({ type: child.tagName === 'UL' ? 'bullet_list' : 'ordered_list', items });
        return;
      }
      const runs = [];
      inlines(child, [], runs);
      const children = merge(runs);
      if (!children.length) return;
      if (child.tagName === 'H2' || child.tagName === 'H1') blocks.push({ type: 'heading', level: 2, children });
      else if (child.tagName === 'H3' || child.tagName === 'H4') blocks.push({ type: 'heading', level: 3, children });
      else if (child.tagName === 'BLOCKQUOTE') blocks.push({ type: 'blockquote', children });
      else blocks.push({ type: 'paragraph', children });
    } else {
      inlines({ childNodes: [child] }, [], loose);
    }
  });
  flush();
  return { blocks };
}

/* ---- tree -> DOM (createElement / textContent; no innerHTML) ------------- */
function appendInline(parent, run) {
  if (run.type === 'link') {
    const a = document.createElement('a');
    a.setAttribute('href', run.href);
    run.children.forEach((c) => appendInline(a, c));
    parent.appendChild(a);
    return;
  }
  let node = document.createTextNode(run.text);
  (run.marks || []).forEach((mark) => {
    const el = document.createElement(mark === 'bold' ? 'strong' : mark === 'italic' ? 'em' : 'u');
    el.appendChild(node);
    node = el;
  });
  parent.appendChild(node);
}

function docToDom(root, doc) {
  root.replaceChildren();
  (doc.blocks || []).forEach((block) => {
    if (block.type === 'bullet_list' || block.type === 'ordered_list') {
      const list = document.createElement(block.type === 'bullet_list' ? 'ul' : 'ol');
      block.items.forEach((item) => { const li = document.createElement('li'); item.forEach((r) => appendInline(li, r)); list.appendChild(li); });
      root.appendChild(list);
      return;
    }
    const tag = block.type === 'heading' ? 'h' + block.level : block.type === 'blockquote' ? 'blockquote' : 'p';
    const el = document.createElement(tag);
    block.children.forEach((r) => appendInline(el, r));
    root.appendChild(el);
  });
  if (!root.childNodes.length) root.appendChild(document.createElement('p'));
}

/* ---- tree -> safe markup for previews (every text node escaped) ---------- */
const EMAIL_STYLE = {
  p: 'margin:0 0 14px;font-size:16px;line-height:1.5;color:#2E4A1A',
  h2: 'margin:18px 0 10px;font-size:20px;line-height:1.3;color:#2E4A1A',
  h3: 'margin:16px 0 8px;font-size:17px;line-height:1.3;color:#2E4A1A',
  ul: 'margin:0 0 14px 20px;padding:0;font-size:16px;line-height:1.5;color:#2E4A1A',
  blockquote: 'margin:0 0 14px;padding:0 0 0 12px;border-left:3px solid #C9D8B4;color:#3D5A26',
  a: 'color:#446514;text-decoration:underline',
};
const substitute = (text, vars) => String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in (vars || {}) ? vars[k] : m));

function docToHtml(doc, vars, email) {
  const style = (tag) => (email ? ` style="${EMAIL_STYLE[tag]}"` : '');
  const inline = (runs) => runs.map((r) => {
    if (r.type === 'link') return `<a href="${esc(substitute(r.href, vars))}"${style('a')}>${inline(r.children)}</a>`;
    let out = esc(substitute(r.text, vars)).replace(/\n/g, '<br>');
    (r.marks || []).forEach((m) => { const t = m === 'bold' ? 'strong' : m === 'italic' ? 'em' : 'u'; out = `<${t}>${out}</${t}>`; });
    return out;
  }).join('');
  return (doc.blocks || []).map((b) => {
    if (b.type === 'heading') return `<h${b.level}${style('h' + b.level)}>${inline(b.children)}</h${b.level}>`;
    if (b.type === 'bullet_list' || b.type === 'ordered_list') {
      const t = b.type === 'bullet_list' ? 'ul' : 'ol';
      return `<${t}${style('ul')}>${b.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${t}>`;
    }
    if (b.type === 'blockquote') return `<blockquote${style('blockquote')}>${inline(b.children)}</blockquote>`;
    return `<p${style('p')}>${inline(b.children)}</p>`;
  }).join('');
}

function docToText(doc, vars) {
  const inline = (runs) => runs.map((r) => {
    if (r.type === 'link') { const label = r.children.map((c) => substitute(c.text, vars)).join(''); const href = substitute(r.href, vars); return label === href ? label : `${label} (${href})`; }
    return substitute(r.text, vars);
  }).join('');
  const lines = [];
  (doc.blocks || []).forEach((b) => {
    if (b.type === 'bullet_list' || b.type === 'ordered_list') {
      b.items.forEach((item, i) => lines.push(b.type === 'ordered_list' ? `${i + 1}. ${inline(item)}` : `- ${inline(item)}`));
      lines.push('');
    } else if (b.type === 'blockquote') { lines.push('> ' + inline(b.children)); lines.push(''); }
    else { lines.push(inline(b.children)); lines.push(''); }
  });
  return lines.join('\n').trim() + '\n';
}

const isBlank = (doc) => !(doc.blocks || []).some((b) => (b.children || b.items.flat()).some((r) => (r.text || (r.children || []).map((c) => c.text).join('')).trim()));

/* ---- the component -------------------------------------------------------- */
let seq = 0;
/**
 * @param {HTMLElement} host
 * @param {{id:string,label:string,value:object,onChange:function,variables?:string[],testId?:string}} o
 */
function mount(host, o) {
  const id = o.id || 'rte' + (++seq);
  host.innerHTML = `<div class="rte" ${o.testId ? `data-testid="${esc(o.testId)}"` : ''}>
    <div class="field__label" id="${id}-label">${esc(o.label)}</div>
    <div class="rte__toolbar" role="toolbar" aria-label="${esc(o.label)} formatting">
      ${[['H2', 'Heading'], ['H3', 'Subheading'], ['¶', 'Paragraph'], ['B', 'Bold'], ['I', 'Italic'], ['U', 'Underline'], ['•', 'Bulleted list'],
         ['1.', 'Numbered list'], ['❝', 'Quote'], ['Link', 'Add link'], ['Unlink', 'Remove link']]
        .map(([glyph, name]) => `<button type="button" class="rte__tool" aria-label="${name}" title="${name}" data-tool="${name}">${esc(glyph)}</button>`).join('')}
    </div>
    <div id="${id}" class="rte__area" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="${id}-label" tabindex="0"></div>
    ${o.variables && o.variables.length ? `<p class="field__hint">Variables you can type: ${o.variables.map((v) => `<code style="margin-right:6px">{{${esc(v)}}}</code>`).join('')}</p>` : ''}
  </div>`;
  const area = host.querySelector('.rte__area');
  docToDom(area, o.value || { blocks: [] });

  const emit = () => o.onChange(domToDoc(area));
  const command = (name, arg) => { area.focus(); document.execCommand(name, false, arg); emit(); };
  let saved = null;

  const actions = {
    Heading: () => command('formatBlock', '<h2>'),
    Subheading: () => command('formatBlock', '<h3>'),
    Paragraph: () => command('formatBlock', '<p>'),
    Bold: () => command('bold'),
    Italic: () => command('italic'),
    Underline: () => command('underline'),
    'Bulleted list': () => command('insertUnorderedList'),
    'Numbered list': () => command('insertOrderedList'),
    Quote: () => command('formatBlock', '<blockquote>'),
    'Remove link': () => command('unlink'),
    'Add link': () => {
      const sel = window.getSelection();
      saved = sel.rangeCount && area.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      UI.modal({
        title: 'Add a link',
        body: H().field({ id: 'rteHref', label: 'Link address (https://…, mailto:…, or a page on this site such as /privacy)', placeholder: 'https://' }),
        actions: [
          { label: 'Cancel', variant: 'secondary', value: false },
          { label: 'Add link', variant: 'primary', value: true, autofocus: false, onClick: (ref) => {
            const href = ref.el.querySelector('#rteHref').value.trim();
            if (!isSafeHref(href)) { H().fieldError(ref.el, 'rteHref', 'Only https://, mailto: and site links (starting with /) are allowed.'); return false; }
            area.focus();
            if (saved) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
            document.execCommand('createLink', false, href);
            emit();
          } },
        ],
      });
    },
  };
  host.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => actions[b.dataset.tool]());
  });
  area.addEventListener('input', emit);
  area.addEventListener('blur', emit);
  area.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    emit();
  });
  area.addEventListener('drop', (e) => e.preventDefault());
  area.addEventListener('dragover', (e) => e.preventDefault());
  return { set: (doc) => docToDom(area, doc) };
}

window.Veye.RTE = { mount, domToDoc, docToDom, docToHtml, docToText, isSafeHref, isBlank, substitute };

})();
