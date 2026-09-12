import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const browser = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4310/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser', 'MutationObserver', 'Event', 'KeyboardEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { value: browser.window[name], configurable: true });
}
globalThis.requestAnimationFrame = browser.window.requestAnimationFrame.bind(browser.window);
globalThis.cancelAnimationFrame = browser.window.cancelAnimationFrame.bind(browser.window);
globalThis.innerHeight = 900;
globalThis.innerWidth = 1200;
const { Editor } = await import('@tiptap/core');
const { createWriterExtensions, mountWriter, writerSourceIssues } = await import('../studio/web/writer.js');
const { marked } = await import('marked');

function editorFor(markdown) {
  const element = document.createElement('div');
  document.body.append(element);
  return new Editor({ element, extensions: createWriterExtensions(), content: markdown, contentType: 'markdown' });
}

test('visual writer preserves standard note semantics through parse, edit and Markdown serialization', () => {
  const markdown = '# Title\n\nA **bold** and *italic* thought with ~~a change~~, `inline code`, and [a link](/reading/ "Reading").\n\n## Books\n\n- One\n  - Nested\n- Two\n\n3. Third\n4. Fourth\n\n> A quote\n>\n> Another paragraph\n\nLine one  \nLine two\n\n---\n\n```js\nconst answer = 42;\n```\n\n![Photo](/images/library.jpg "A photo")';
  const editor = editorFor(markdown);
  try {
    editor.state.doc.check();
    assert.deepEqual(writerSourceIssues(markdown), []);
    const html = marked.parse(editor.getMarkdown());
    for (const expression of [/<h1>Title<\/h1>/, /<strong>bold<\/strong>/, /<em>italic<\/em>/, /<del>a change<\/del>/, /<code>inline code<\/code>/, /href="\/reading\/" title="Reading"/, /<h2>Books<\/h2>/, /<li>Nested<\/li>/, /<ol start="3">/, /<blockquote>/, /Line one<br>\n?Line two/, /<hr>/, /language-js/, /const answer = 42;/, /alt="Photo" title="A photo"/]) assert.match(html, expression);
    assert.match(editor.view.dom.querySelector('img').getAttribute('src'), /^\/preview\/images\/library.jpg$/);
    assert.match(editor.getMarkdown(), /\]\(\/images\/library.jpg/);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' appended');
    const output = editor.getMarkdown();
    const reparsed = editorFor(output);
    try { assert.deepEqual(reparsed.getJSON(), editor.getJSON()); } finally { reparsed.destroy(); }
  } finally { editor.destroy(); }
});

test('image alt/title delimiters, link title and nested code fences survive a roundtrip', () => {
  const editor = editorFor('');
  try {
    editor.commands.setContent({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'image', attrs: { src: '/images/a(photo).jpg', alt: 'Book [with] \\ marks', title: 'A "quoted" title' } }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A link', marks: [{ type: 'link', attrs: { href: 'https://example.com/a(b)', title: 'A "quoted" link' } }] }] },
      { type: 'codeBlock', attrs: { language: 'md' }, content: [{ type: 'text', text: '```js\nconst x = `one`;\n```' }] }
    ] });
    const output = editor.getMarkdown();
    assert.match(output, /````md/);
    const reparsed = editorFor(output);
    try {
      const nodes = reparsed.getJSON().content;
      assert.ok(nodes[0]?.content?.[0]?.attrs, JSON.stringify({ output, nodes }, null, 2));
      assert.equal(nodes[0].content[0].attrs.alt, 'Book [with] \\ marks');
      assert.equal(nodes[0].content[0].attrs.title, 'A "quoted" title');
      assert.equal(decodeURIComponent(nodes[0].content[0].attrs.src), '/images/a(photo).jpg');
      assert.equal(nodes[1].content[0].marks[0].attrs.title, 'A "quoted" link');
      assert.equal(nodes[2].content[0].text, '```js\nconst x = `one`;\n```');
    } finally { reparsed.destroy(); }
  } finally { editor.destroy(); }
});

test('untouched source stays byte-for-byte intact across mount, modes and external updates', () => {
  const container = document.createElement('div'); document.body.append(container);
  const calls = [];
  const source = 'A __bold__ sentence.\r\n\r\n* One\r\n* Two\r\n';
  const writer = mountWriter({ container, value: source, onChange: (value) => calls.push(value) });
  try {
    assert.equal(writer.getValue(), source);
    container.querySelector('[data-mode="markdown"][role="tab"]').click();
    container.querySelector('[data-mode="visual"][role="tab"]').click();
    assert.equal(writer.getValue(), source);
    assert.equal(calls.length, 0);
    writer.setValue('## Changed\n\n*From outside.*\n');
    assert.equal(calls.length, 0);
    assert.equal(writer.getValue(), '## Changed\n\n*From outside.*\n');
    assert.equal(container.querySelector('h2').textContent, 'Changed');
  } finally { writer.destroy(); container.remove(); }
});

test('unsupported structures stay editable in source without silent data loss', () => {
  const source = '| A | B |\n| --- | --- |\n| One | Two |\n\n- [ ] A task\n\n<div>Keep this markup</div>';
  assert.deepEqual(writerSourceIssues(source), ['tables', 'checklists', 'embedded HTML']);
  const container = document.createElement('div'); document.body.append(container);
  const writer = mountWriter({ container, value: source });
  try {
    assert.equal(container.querySelector('.studio-writer').dataset.mode, 'markdown');
    container.querySelector('[data-mode="visual"][role="tab"]').click();
    assert.equal(container.querySelector('.studio-writer').dataset.mode, 'markdown');
    assert.equal(writer.getValue(), source);
    assert.match(container.querySelector('.writer-message').textContent, /preserve/);
    writer.setValue('A **simple** note.');
    container.querySelector('[data-mode="visual"][role="tab"]').click();
    assert.equal(container.querySelector('.studio-writer').dataset.mode, 'visual');
    assert.equal(container.querySelector('.writer-prose strong').textContent, 'simple');
  } finally { writer.destroy(); container.remove(); }
});

test('unsafe raw content never mounts active HTML and rich paste removes scripts and unsafe attributes', () => {
  const container = document.createElement('div'); document.body.append(container);
  const source = '<script>alert(1)</script>\n\n![Bad](javascript:alert)';
  const writer = mountWriter({ container, value: source });
  try {
    assert.equal(container.querySelector('script'), null);
    assert.equal(container.querySelector('img'), null);
    assert.equal(writer.getValue(), source);
    writer.setValue('Clean text');
    container.querySelector('[data-mode="visual"][role="tab"]').click();
    const editorElement = container.querySelector('.writer-prose');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [], getData: (type) => type === 'text/html' ? '<p style="color:red">Clean <strong>paste</strong><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(2)">bad link</a></p>' : type === 'text/plain' ? 'Clean paste' : '' } });
    editorElement.dispatchEvent(paste);
    assert.doesNotMatch(editorElement.innerHTML, /<script|onerror|style=|href="javascript:|src="javascript:/);
    assert.match(editorElement.innerHTML, /<strong>paste<\/strong>/);
  } finally { writer.destroy(); container.remove(); }
});

test('typing and editor undo update Markdown, and do not bubble into host document undo', () => {
  const container = document.createElement('div'); document.body.append(container);
  const calls = [];
  const writer = mountWriter({ container, value: 'A thought.', onChange: (value) => calls.push(value) });
  try {
    container.querySelector('[data-mode="markdown"][role="tab"]').click();
    const input = container.querySelector('.writer-source');
    input.value = '## A thought\n\nA **new** sentence.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(calls.at(-1), input.value);
    container.querySelector('[data-mode="visual"][role="tab"]').click();
    assert.equal(container.querySelector('.writer-prose h2').textContent, 'A thought');
    let hostUndo = false;
    const listener = () => { hostUndo = true; };
    document.addEventListener('keydown', listener);
    container.querySelector('.writer-prose').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true }));
    document.removeEventListener('keydown', listener);
    assert.equal(hostUndo, false);
    assert.equal(writer.getValue(), 'A thought.');
  } finally { writer.destroy(); container.remove(); }
});

test('image form uses local media, requires alt text and preserves selected-image edits', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const writer = mountWriter({ container, value: 'An image: ', onChooseImage: async () => ({ src: '/images/selected.jpg', alt: 'Leaves after rain' }) });
  try {
    container.querySelector('[aria-label="Add or edit image"]').click();
    container.querySelector('[aria-label="Choose an image from the media library"]').click();
    await Promise.resolve();
    const form = container.querySelector('.writer-popover');
    assert.equal(form.elements.src.value, '/images/selected.jpg');
    assert.equal(form.elements.alt.value, 'Leaves after rain');
    form.elements.alt.value = '';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    assert.match(form.querySelector('.writer-form-error').textContent, /description/);
    assert.equal(container.querySelector('.writer-prose img'), null);
    form.elements.alt.value = 'Leaves after rain';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    assert.match(writer.getValue(), /!\[Leaves after rain\]\(\/images\/selected.jpg\)/);
    assert.equal(container.querySelector('.writer-prose img').getAttribute('alt'), 'Leaves after rain');
    assert.equal(container.querySelector('.writer-prose img').getAttribute('src'), '/preview/images/selected.jpg');
    const editor = container.querySelector('.writer-prose').editor;
    let imagePosition;
    editor.state.doc.descendants((node, position) => { if (node.type.name === 'image') imagePosition = position; });
    editor.commands.setNodeSelection(imagePosition);
    container.querySelector('[aria-label="Add or edit image"]').click();
    const editForm = container.querySelector('.writer-popover');
    editForm.elements.alt.value = 'Rain on green leaves';
    editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    assert.match(writer.getValue(), /!\[Rain on green leaves\]/);
    assert.equal(container.querySelectorAll('.writer-prose img').length, 1);
    editor.state.doc.check();
  } finally { writer.destroy(); container.remove(); }
});

test('expanded writing preserves content and restores body scrolling on Escape and destroy', () => {
  const container = document.createElement('div'); document.body.append(container);
  const writer = mountWriter({ container, value: 'A quiet place to write.' });
  const before = document.body.style.overflow;
  try {
    writer.expand();
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(container.querySelector('.studio-writer').getAttribute('aria-modal'), 'true');
    container.querySelector('.writer-prose').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(document.body.style.overflow, before);
    assert.equal(container.querySelector('.studio-writer').classList.contains('writer-expanded'), false);
    assert.equal(writer.getValue(), 'A quiet place to write.');
    writer.expand();
  } finally { writer.destroy(); container.remove(); }
  assert.equal(document.body.style.overflow, before);
});

test('external content replacement waits for an in-progress IME composition', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const writer = mountWriter({ container, value: 'An original thought.' });
  try {
    const prose = container.querySelector('.writer-prose');
    prose.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    writer.setValue('新的想法。');
    assert.equal(writer.getValue(), 'An original thought.');
    prose.dispatchEvent(new Event('compositionend', { bubbles: true }));
    await Promise.resolve();
    assert.equal(writer.getValue(), '新的想法。');
    assert.equal(prose.textContent, '新的想法。');
  } finally { writer.destroy(); container.remove(); }
});
