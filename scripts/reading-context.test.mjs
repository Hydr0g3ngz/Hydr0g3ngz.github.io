import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform as compileAstro } from '@astrojs/compiler-rs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { build, transform } from 'esbuild';
import { load } from 'js-yaml';
import { JSDOM } from 'jsdom';
import { readingBlockSchema } from '../src/content-schema.ts';

const componentUrl = new URL('../src/components/blocks/ReadingBlock.astro', import.meta.url);
const compiled = compileAstro(await readFile(componentUrl, 'utf8'), {
  filename: componentUrl.pathname,
  internalURL: import.meta.resolve('astro/compiler-runtime'),
  resolvePath: (specifier) => specifier,
});
const javascript = await transform(compiled.code, { loader: 'ts', format: 'esm', target: 'es2022' });
const { default: ReadingBlock } = await import(`data:text/javascript;base64,${Buffer.from(javascript.code).toString('base64')}`);
const page = JSON.parse(await readFile(new URL('../src/content/pages/reading.json', import.meta.url), 'utf8'));
const reading = page.sections.find((block) => block.type === 'reading');
const css = await readFile(new URL('../src/styles/culture.css', import.meta.url), 'utf8');

async function render(block = reading) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(ReadingBlock, { props: { block: readingBlockSchema.parse(block) } });
  return new JSDOM(html, { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
}

test('four brief, cited backgrounds stay collapsed while the complete Chinese poems remain outside', async (t) => {
  const dom = await render(); t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('.poem-context').length, 4);
  for (const [index, figure] of [...document.querySelectorAll('.poem-card')].entries()) {
    const poem = reading.excerpts[index];
    const details = figure.querySelector('details.poem-context');
    assert.equal(details.open, false);
    assert.equal(details.hasAttribute('open'), false);
    assert.equal(details.querySelector('summary').textContent, 'About this poem');
    assert.equal(details.querySelector('.poem-context-body').textContent, poem.context);
    assert.equal(details.querySelector('.poem-context-source').getAttribute('href'), poem.contextSourceUrl);
    assert.equal(poem.contextSourceUrl, poem.sourceUrl, 'each context cites its verified anthology entry');
    assert.ok(poem.contextSourceLabel.startsWith('Background notes'));
    const words = poem.context.split(/\s+/).length;
    assert.ok(words >= 30 && words <= 55, `background ${index + 1} has ${words} words`);
    assert.equal(figure.querySelector('blockquote').closest('details, [hidden]'), null);
    assert.deepEqual([...figure.querySelectorAll('.excerpt-original')].map((p) => p.textContent), poem.text.split(/\n\s*\n/));
    assert.equal(details.querySelector('.personal-reflection'), null);
    assert.equal(figure.querySelector('.personal-reflection'), null, 'no personal opinion has been invented');
  }
});

test('native summaries toggle in edit mode, but background paragraphs retain their content paths', async (t) => {
  const dom = await render(); t.after(() => dom.window.close());
  const { window } = dom;
  const document = window.document;
  document.querySelector('.reading-section').dataset.studioBlock = '0';
  const content = document.createElement('script');
  content.type = 'application/json'; content.id = 'studio-content-data';
  content.dataset.documentId = 'pages/reading.json'; content.dataset.previewRev = 'context-test';
  content.textContent = JSON.stringify({ sections: [reading] });
  document.body.append(content);
  const bridge = await build({ entryPoints: [fileURLToPath(new URL('../studio/preview-bridge.js', import.meta.url))], bundle: true, format: 'iife', platform: 'browser', write: false });
  window.eval(bridge.outputFiles[0].text);
  for (const [index, details] of [...document.querySelectorAll('.poem-context')].entries()) {
    const summary = details.querySelector('summary');
    const paragraph = details.querySelector('.poem-context-body');
    assert.ok(summary.hasAttribute('data-studio-ignore'));
    assert.equal(details.hasAttribute('data-studio-ignore'), false, 'only the control is ignored, not its editable content');
    assert.equal(paragraph.closest('[data-studio-ignore]'), null);
    assert.equal(paragraph.dataset.studioPath, JSON.stringify(['sections', '0', 'excerpts', String(index), 'context']));
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    summary.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false);
    assert.equal(details.open, true, 'native HTML details activation works without custom click code');
    paragraph.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    assert.equal(paragraph.getAttribute('contenteditable'), 'true');
    window.__willStudioInline.cancel();
    summary.click();
    assert.equal(details.open, false);
  }
});

test('legacy and whitespace-only backgrounds render no empty disclosures or orphan source links', async (t) => {
  for (const value of [undefined, '', ' \n\t ']) {
    const block = structuredClone(reading);
    for (const poem of block.excerpts) {
      if (value === undefined) {
        delete poem.context; delete poem.contextSourceLabel; delete poem.contextSourceUrl;
      } else poem.context = value;
    }
    const dom = await render(block); t.after(() => dom.window.close());
    assert.equal(dom.window.document.querySelectorAll('.poem-context, .poem-context-source').length, 0);
    assert.equal(dom.window.document.querySelectorAll('.poem-card').length, 4);
    assert.equal(dom.window.document.querySelectorAll('.poem-source').length, 4);
  }
});

test('context references are optional, use a readable fallback label, and are separate from personal notes', async (t) => {
  const block = structuredClone(reading);
  delete block.excerpts[0].contextSourceUrl;
  delete block.excerpts[1].contextSourceLabel;
  delete block.excerpts[2].contextSourceUrl;
  delete block.excerpts[2].contextSourceLabel;
  block.excerpts[0].reflection = 'An existing personal note.\nPreserved separately.';
  const dom = await render(block); t.after(() => dom.window.close());
  const figures = [...dom.window.document.querySelectorAll('.poem-card')];
  assert.equal(figures[0].querySelector('.poem-context-source'), null);
  assert.equal(figures[1].querySelector('.poem-context-source').textContent, 'Background source ↗');
  assert.equal(figures[2].querySelector('.poem-context-source'), null);
  assert.equal(dom.window.document.querySelectorAll('.poem-context').length, 4);
  const reflection = figures[0].querySelector('.personal-reflection');
  assert.equal(reflection.closest('details'), null);
  assert.equal(reflection.querySelector('p:last-child').textContent, block.excerpts[0].reflection);
});

test('background strings and source labels are escaped; unsafe source URLs are rejected by the shared schema', async (t) => {
  const block = structuredClone(reading);
  const payload = '<img src=x onerror=alert(1)> & “词”\n<script>alert(2)</script>';
  block.excerpts[0].context = payload;
  block.excerpts[0].contextSourceLabel = payload;
  const dom = await render(block); t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(document.querySelector('.poem-context-body').textContent, payload);
  assert.equal(document.querySelector('.poem-context-source').textContent, `${payload} ↗`);
  assert.equal(document.querySelectorAll('img, script, [onerror]').length, 0);
  for (const link of document.querySelectorAll('.poem-context-source')) {
    assert.equal(link.target, '_blank');
    assert.ok(link.relList.contains('noopener'));
    assert.ok(link.relList.contains('noreferrer'));
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'http://example.test', '//example.test', '/local/path', 'https://user:password@example.test/', 'https://example.test/\npath', 'https://example.test/\\path']) {
    block.excerpts[0].contextSourceUrl = url;
    assert.equal(readingBlockSchema.safeParse(block).success, false, `${JSON.stringify(url)} must be rejected`);
  }
  block.excerpts[0].contextSourceUrl = 'https://example.test/source';
  block.excerpts[0].context = 'x'.repeat(2001);
  assert.equal(readingBlockSchema.safeParse(block).success, false, 'background fields remain bounded');
});

test('the editor exposes optional sourced background fields only for reading excerpts', async () => {
  const config = load(await readFile(new URL('../.pages.yml', import.meta.url), 'utf8'));
  const fields = config.components.reading.fields;
  const excerpts = fields.find((field) => field.name === 'excerpts').fields;
  for (const name of ['context', 'contextSourceLabel', 'contextSourceUrl']) {
    const field = excerpts.find((entry) => entry.name === name);
    assert.ok(field);
    assert.notEqual(field.required, true);
    assert.equal(fields.find((entry) => entry.name === 'books').fields.some((entry) => entry.name === name), false);
  }
});

test('context CSS preserves Chinese text and flexible mobile sizing without hiding the poem', async (t) => {
  const result = await transform(css, { loader: 'css' });
  assert.deepEqual(result.warnings, []);
  const block = structuredClone(reading);
  block.excerpts[0].context = '这是独立于个人感想的作品背景。\n中文与 English 可以并排阅读。';
  const dom = await render(block); t.after(() => dom.window.close());
  const style = dom.window.document.createElement('style'); style.textContent = css; dom.window.document.head.append(style);
  const details = dom.window.document.querySelector('.poem-context');
  details.open = true;
  const computed = dom.window.getComputedStyle(details);
  assert.equal(computed.minWidth, '0px');
  assert.equal(computed.maxWidth, '100%');
  const paragraph = details.querySelector('.poem-context-body');
  assert.equal(paragraph.textContent, block.excerpts[0].context);
  assert.equal(dom.window.getComputedStyle(paragraph).overflowWrap, 'anywhere');
  assert.equal(dom.window.getComputedStyle(paragraph).whiteSpace, 'pre-line');
  assert.equal(dom.window.getComputedStyle(details.querySelector('summary')).minHeight, '44px');
  assert.equal(details.closest('.poem-card').querySelector('blockquote').closest('details'), null);
});
