import { Editor, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import createDOMPurify from 'dompurify';
import { marked } from 'marked';

const escapeLabel = (value) => String(value).replace(/([\\\[\]])/g, '\\$1');
const escapeDestination = (value) => String(value).replace(/[\\()<>\s]/g, (character) => `%${character.codePointAt(0).toString(16).toUpperCase()}`);
const escapeTitle = (value) => String(value).replace(/([\\"])/g, '\\$1').replace(/\r?\n/g, ' ');

export function isWriterUrl(value, image = false) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (!image && value.startsWith('#')) return value.length > 1;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}

/** Keep unsupported Markdown intact instead of silently discarding it in a visual conversion. */
export function writerSourceIssues(source) {
  const issues = new Set();
  const visit = (tokens) => {
    for (const token of tokens ?? []) {
      if (token.type === 'html') issues.add('embedded HTML');
      if (token.type === 'table') issues.add('tables');
      if (token.task) issues.add('checklists');
      if (token.type === 'link' && !isWriterUrl(token.href)) issues.add('a link with an unsupported address');
      if (token.type === 'image' && !isWriterUrl(token.href, true)) issues.add('an image with an unsupported address');
      if (token.tokens) visit(token.tokens);
      if (token.items) visit(token.items);
    }
  };
  visit(marked.lexer(String(source ?? ''), { gfm: true }));
  return [...issues];
}

export function createWriterExtensions({ resolveImage = (src) => /^(?:\/images\/|\/uploads\/)/.test(src) ? `/preview${src}` : src } = {}) {
  const WriterImage = Image.extend({
    parseMarkdown(token, helpers) {
      const text = (nodes) => (nodes ?? []).map((node) => node.text ?? text(node.content)).join('');
      return helpers.createNode('image', { src: token.href, title: token.title ?? null, alt: token.tokens ? text(helpers.parseInline(token.tokens)) : token.text });
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        src: { default: null, parseHTML: (element) => (element.getAttribute('src') ?? '').replace(/^\/preview(?=\/(?:images|uploads)\/)/, '') }
      };
    },
    renderHTML({ HTMLAttributes }) {
      const src = isWriterUrl(HTMLAttributes.src, true) ? resolveImage(HTMLAttributes.src) : '';
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src, loading: 'lazy' })];
    },
    renderMarkdown(node) {
      const { src = '', alt = '', title = '' } = node.attrs ?? {};
      return `![${escapeLabel(alt)}](${escapeDestination(src)}${title ? ` "${escapeTitle(title)}"` : ''})`;
    }
  });
  const WriterLink = Link.extend({
    renderMarkdown(node, helpers) {
      const { href = '', title = '' } = node.attrs ?? {};
      return `[${helpers.renderChildren(node)}](${escapeDestination(href)}${title ? ` "${escapeTitle(title)}"` : ''})`;
    }
  });
  const WriterCode = CodeBlock.extend({
    renderMarkdown(node) {
      const text = (node.content ?? []).map((child) => child.text ?? '').join('');
      const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      return `${fence}${node.attrs?.language ?? ''}\n${text}\n${fence}`;
    }
  });
  const WriterParagraph = Paragraph.extend({
    parseMarkdown(token, helpers) {
      // StarterKit unwraps an image-only paragraph as a block image. Our images are inline,
      // so preserve its paragraph to keep the ProseMirror document schema valid.
      if (token.tokens?.length === 1 && token.tokens[0].type === 'image') return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens));
      return this.parent(token, helpers);
    }
  });
  return [
    StarterKit.configure({ link: false, codeBlock: false, paragraph: false, underline: false, trailingNode: false }),
    WriterParagraph,
    WriterLink.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: (url) => isWriterUrl(url), HTMLAttributes: { target: null, rel: 'noopener noreferrer' } }),
    WriterCode,
    WriterImage.configure({ allowBase64: false, inline: true }),
    Placeholder.configure({ placeholder: 'Start with a thought…' }),
    Markdown.configure({ markedOptions: { gfm: true }, indentation: { style: 'space', size: 2 } })
  ];
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * A local Markdown-backed writer. Source strings are unchanged until the user edits.
 * onChooseImage optionally resolves {src, alt, title}; choosing is separate from insertion.
 */
export function mountWriter({ container, value = '', onChange = () => {}, onChooseImage, resolveImage, label = 'Note body' }) {
  if (!(container instanceof HTMLElement)) throw new TypeError('mountWriter needs an HTML container.');
  const clean = createDOMPurify(window);
  clean.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'href' && !isWriterUrl(data.attrValue)) data.keepAttr = false;
    if (data.attrName === 'src' && !isWriterUrl(data.attrValue, true)) data.keepAttr = false;
  });
  let source = String(value ?? '');
  let mode = writerSourceIssues(source).length ? 'markdown' : 'visual';
  let destroyed = false;
  let suppress = false;
  let editor;
  let expanded = false;
  let popover;
  let previousOverflow = '';
  let expansionFocus;
  let sourceDirty = false;
  let composition = false;
  let pendingValue;
  const shell = el('section', 'studio-writer');
  shell.setAttribute('aria-label', `${label} writer`);
  shell.dataset.mode = mode;
  const top = el('div', 'writer-top');
  const tabs = el('div', 'writer-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Writing mode');
  const buttons = new Map();
  const status = el('div', 'writer-status');
  const message = el('p', 'writer-message');
  message.setAttribute('role', 'status');
  message.hidden = true;
  const toolbar = el('div', 'writer-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Text formatting');
  const visual = el('div', 'writer-visual');
  const raw = el('textarea', 'writer-source');
  raw.setAttribute('aria-label', `${label} Markdown`);
  raw.spellcheck = false;
  raw.value = source;
  const count = el('span', 'writer-count');
  const hint = el('span', 'writer-hint', 'Select text to format · Shift+Enter for a line break');
  const foot = el('div', 'writer-foot');
  foot.append(count, hint);

  function notify(next) {
    if (next === source) return;
    source = next;
    raw.value = source;
    updateCount();
    onChange(source);
  }
  function updateCount() {
    const text = mode === 'visual' && editor ? editor.getText() : source;
    const words = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike).length
      : (text.trim().match(/\S+/g) ?? []).length;
    count.textContent = `${words.toLocaleString()} words · ${[...text].length.toLocaleString()} characters`;
  }
  function setMessage(text = '') { message.textContent = text; message.hidden = !text; }
  function closePopover() { popover?.remove(); popover = undefined; }
  function button(text, title, action, stateName) {
    const item = el('button', 'writer-tool', text);
    item.type = 'button';
    item.title = title;
    item.setAttribute('aria-label', title);
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => { if (!destroyed) action(); });
    if (stateName) buttons.set(stateName, item);
    return item;
  }
  function editorState() {
    if (!editor || destroyed) return;
    for (const [name, item] of buttons) {
      if (name === 'undo' || name === 'redo') item.disabled = !editor.can()[name]();
      else item.setAttribute('aria-pressed', String(editor.isActive(name)));
    }
    const heading = editor.getAttributes('heading').level;
    style.value = editor.isActive('heading') ? String(heading) : 'paragraph';
  }
  function renderMode() {
    shell.dataset.mode = mode;
    visual.hidden = mode !== 'visual';
    raw.hidden = mode !== 'markdown';
    toolbar.hidden = mode !== 'visual';
    for (const tab of tabs.children) {
      const selected = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    const issues = writerSourceIssues(source);
    setMessage(mode === 'markdown' && issues.length ? `This note contains ${issues.join(', ')}. Keep editing in Markdown to preserve it. Visual mode becomes available when those elements are removed.` : '');
    hint.textContent = mode === 'visual' ? 'Select text to format · Shift+Enter for a line break' : 'Markdown is saved as written · Preview shows the published result';
    updateCount();
  }
  function switchMode(next) {
    if (mode === next || destroyed) return;
    closePopover();
    if (next === 'visual') {
      const issues = writerSourceIssues(source);
      if (issues.length) { renderMode(); return; }
      if (sourceDirty || !editor) {
        suppress = true;
        editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false });
        suppress = false;
        sourceDirty = false;
      }
    }
    mode = next;
    renderMode();
    if (mode === 'visual') editor.commands.focus(); else raw.focus();
  }
  for (const [id, title] of [['visual', 'Visual'], ['markdown', 'Markdown']]) {
    const tab = button(title, `${title} writing mode`, () => switchMode(id));
    tab.dataset.mode = id;
    tab.setAttribute('role', 'tab');
    tabs.append(tab);
  }
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'visual' : event.key === 'End' ? 'markdown' : mode === 'visual' ? 'markdown' : 'visual';
    switchMode(next);
    tabs.querySelector(`[data-mode="${mode}"]`).focus();
  });
  function setExpanded(next) {
    if (expanded === next) return;
    expanded = next;
    if (expanded) {
      expansionFocus = document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      shell.setAttribute('role', 'dialog');
      shell.setAttribute('aria-modal', 'true');
    } else {
      document.body.style.overflow = previousOverflow;
      shell.removeAttribute('role');
      shell.removeAttribute('aria-modal');
    }
    shell.classList.toggle('writer-expanded', expanded);
    expand.textContent = expanded ? 'Return to page ↙' : 'Expand ↗';
    expand.setAttribute('aria-label', expanded ? 'Return to page editor' : 'Expand writing space');
    expand.setAttribute('aria-expanded', String(expanded));
    if (!expanded && expansionFocus?.isConnected) expansionFocus.focus();
    else if (mode === 'visual') editor?.commands.focus(); else raw.focus();
  }
  const expand = button('Expand ↗', 'Expand writing space', () => setExpanded(!expanded));
  expand.classList.add('writer-expand');
  expand.setAttribute('aria-expanded', 'false');
  top.append(tabs, expand);
  const style = el('select', 'writer-style');
  style.setAttribute('aria-label', 'Paragraph style');
  for (const [id, title] of [['paragraph', 'Paragraph'], ['1', 'Heading 1'], ['2', 'Heading 2'], ['3', 'Heading 3'], ['4', 'Heading 4'], ['5', 'Heading 5'], ['6', 'Heading 6']]) {
    const option = el('option', '', title); option.value = id; style.append(option);
  }
  style.addEventListener('change', () => {
    const chain = editor.chain().focus();
    (style.value === 'paragraph' ? chain.setParagraph() : chain.setHeading({ level: Number(style.value) })).run();
  });
  toolbar.append(style);
  const commands = [
    ['B', 'Bold (Ctrl/⌘ B)', 'toggleBold', 'bold'],
    ['I', 'Italic (Ctrl/⌘ I)', 'toggleItalic', 'italic'],
    ['S̶', 'Strikethrough', 'toggleStrike', 'strike'],
    ['• List', 'Bulleted list', 'toggleBulletList', 'bulletList'],
    ['1. List', 'Numbered list', 'toggleOrderedList', 'orderedList'],
    ['“ ”', 'Block quote', 'toggleBlockquote', 'blockquote'],
    ['‹/›', 'Inline code', 'toggleCode', 'code'],
    ['Code', 'Code block', 'toggleCodeBlock', 'codeBlock']
  ];
  for (const [text, title, command, state] of commands) toolbar.append(button(text, title, () => editor.chain().focus()[command]().run(), state));
  function showForm(kind) {
    closePopover();
    setMessage();
    const isImage = kind === 'image';
    const selected = editor.isActive(isImage ? 'image' : 'link');
    const attrs = editor.getAttributes(isImage ? 'image' : 'link');
    const position = { from: editor.state.selection.from, to: editor.state.selection.to };
    const form = el('form', 'writer-popover');
    popover = form;
    form.setAttribute('aria-label', isImage ? 'Image details' : 'Link details');
    form.append(el('strong', '', isImage ? 'Add an image' : 'Add a link'));
    const fields = {};
    for (const [name, title, initial] of isImage ? [['src', 'Image address', attrs.src], ['alt', 'Alt text — describe the image', attrs.alt], ['title', 'Image title (optional)', attrs.title]] : [['href', 'Link address', attrs.href], ['text', 'Link text', editor.state.doc.textBetween(position.from, position.to, ' ')], ['title', 'Title (optional)', attrs.title]]) {
      const labelNode = el('label', '', title);
      const input = el('input');
      input.name = name;
      input.value = initial ?? '';
      input.autocomplete = 'off';
      input.required = name !== 'title';
      input.placeholder = name === 'src' ? '/images/your-photo.jpg' : name === 'href' ? 'https://… or /reading/' : '';
      if (name === 'text' && selected) input.disabled = true;
      labelNode.append(input);
      fields[name] = input;
      form.append(labelNode);
    }
    const error = el('p', 'writer-form-error');
    error.setAttribute('role', 'alert');
    form.append(error);
    const actions = el('div', 'writer-form-actions');
    if (isImage && onChooseImage) {
      const browse = button('Browse media', 'Choose an image from the media library', async () => {
        browse.disabled = true;
        try {
          const choice = await onChooseImage();
          if (!choice || destroyed || !form.isConnected) return;
          fields.src.value = choice.src ?? choice.url ?? '';
          if (choice.alt) fields.alt.value = choice.alt;
          if (choice.title) fields.title.value = choice.title;
          fields.alt.focus();
        } catch (problem) { error.textContent = problem?.message || 'Could not open the media library.'; }
        finally { browse.disabled = false; }
      });
      actions.append(browse);
    }
    if (selected) actions.append(button(isImage ? 'Remove image' : 'Remove link', isImage ? 'Remove selected image' : 'Remove selected link', () => {
      const chain = editor.chain().focus();
      if (isImage) chain.setNodeSelection(position.from); else chain.setTextSelection(position);
      if (isImage) chain.deleteSelection().run(); else chain.extendMarkRange('link').unsetLink().run();
      closePopover();
    }));
    actions.append(button('Cancel', 'Cancel details', () => { closePopover(); editor.commands.focus(); }));
    const submit = el('button', 'writer-form-submit', selected ? 'Update' : 'Insert');
    submit.type = 'submit';
    actions.append(submit);
    form.append(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const address = fields[isImage ? 'src' : 'href'].value.trim();
      if (!isWriterUrl(address, isImage)) { error.textContent = 'Use an HTTPS address or a path inside this site.'; return; }
      if (isImage && !fields.alt.value.trim()) { error.textContent = 'Add a short image description for readers using a screen reader.'; return; }
      const chain = editor.chain().focus();
      if (isImage && selected) chain.setNodeSelection(position.from); else chain.setTextSelection(position);
      if (isImage) {
        const next = { src: address, alt: fields.alt.value.trim(), title: fields.title.value.trim() || null };
        if (selected) chain.updateAttributes('image', next).run(); else chain.setImage(next).run();
      } else {
        const attrs = { href: address, title: fields.title.value.trim() || null };
        if (selected) chain.extendMarkRange('link').setLink(attrs).run();
        else if (position.from === position.to || fields.text.value !== editor.state.doc.textBetween(position.from, position.to, ' ')) chain.insertContent({ type: 'text', text: fields.text.value || address, marks: [{ type: 'link', attrs }] }).run();
        else chain.setLink(attrs).run();
      }
      closePopover();
    });
    toolbar.after(form);
    fields[isImage ? 'alt' : 'href'].focus();
  }
  toolbar.append(button('Link', 'Add or edit link (Ctrl/⌘ K)', () => showForm('link'), 'link'));
  toolbar.append(button('Image', 'Add or edit image', () => showForm('image'), 'image'));
  toolbar.append(button('—', 'Horizontal divider', () => editor.chain().focus().setHorizontalRule().run()));
  toolbar.append(button('↶', 'Undo writing change (Ctrl/⌘ Z)', () => editor.chain().focus().undo().run(), 'undo'));
  toolbar.append(button('↷', 'Redo writing change (Ctrl/⌘ Shift Z)', () => editor.chain().focus().redo().run(), 'redo'));
  toolbar.append(button('Tx', 'Clear inline formatting', () => editor.chain().focus().unsetAllMarks().run()));
  shell.append(top, message, toolbar, visual, raw, foot, status);
  container.append(shell);
  editor = new Editor({
    element: visual,
    extensions: createWriterExtensions({ resolveImage }),
    content: mode === 'visual' ? source : '',
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'writer-prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': `${label} visual editor`, spellcheck: 'true' },
      transformPastedHTML: (html) => clean.sanitize(html, {
        ALLOWED_TAGS: ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 's', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'br', 'hr', 'img'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'start'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false
      }),
      handleDOMEvents: {
        compositionstart: () => { composition = true; return false; },
        compositionend: () => {
          composition = false;
          // Let ProseMirror finish the IME transaction before applying an external update.
          if (pendingValue !== undefined) { const next = pendingValue; pendingValue = undefined; queueMicrotask(() => api.setValue(next)); }
          return false;
        }
      }
    },
    onUpdate: ({ editor: active }) => { if (!suppress && !destroyed) notify(active.getMarkdown()); },
    onSelectionUpdate: editorState,
    onTransaction: editorState
  });
  sourceDirty = mode === 'markdown';
  raw.addEventListener('input', () => { sourceDirty = true; notify(raw.value); renderMode(); });
  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover) { event.preventDefault(); event.stopPropagation(); closePopover(); editor.commands.focus(); }
    else if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setExpanded(false); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && mode === 'visual') { event.preventDefault(); event.stopPropagation(); showForm('link'); }
    // The host application also has document history: text undo belongs to this editor.
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
    if (event.key === 'Tab' && expanded && !event.defaultPrevented) {
      const focusables = [...shell.querySelectorAll('button, input, select, textarea, [contenteditable="true"]')].filter((node) => !node.disabled && !node.closest('[hidden]'));
      const first = focusables[0]; const last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  renderMode();
  editorState();
  const api = {
    setValue(next) {
      if (destroyed || String(next ?? '') === source) return;
      if (composition) { pendingValue = String(next ?? ''); return; }
      closePopover();
      source = String(next ?? '');
      raw.value = source;
      sourceDirty = true;
      if (writerSourceIssues(source).length) mode = 'markdown';
      else if (mode === 'visual') {
        suppress = true;
        editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false });
        suppress = false;
        sourceDirty = false;
      }
      renderMode();
    },
    getValue: () => source,
    focus: () => { if (!destroyed) mode === 'visual' ? editor.commands.focus() : raw.focus(); },
    expand: () => setExpanded(true),
    destroy() {
      if (destroyed) return;
      setExpanded(false);
      destroyed = true;
      closePopover();
      editor.destroy();
      clean.removeAllHooks();
      shell.remove();
    }
  };
  return api;
}
