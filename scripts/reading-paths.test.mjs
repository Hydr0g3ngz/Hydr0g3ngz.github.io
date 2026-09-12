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

async function render(blocks = [reading]) {
  const container = await AstroContainer.create();
  const html = [];
  for (const block of blocks) html.push(await container.renderToString(ReadingBlock, { props: { block: readingBlockSchema.parse(block) } }));
  return new JSDOM(html.join(''), { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
}

function assertTargets(document) {
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const link of document.querySelectorAll('.reading-path a, .book-permalink')) {
    const href = link.getAttribute('href');
    assert.ok(href.startsWith('#'));
    const target = document.getElementById(href.slice(1));
    assert.ok(target, `local target ${href} exists`);
    assert.equal(target.tabIndex, -1);
    assert.equal(target.closest('.reading-section'), link.closest('.reading-section'));
    assert.ok(link.closest('[data-studio-ignore]'));
  }
}

function bookIdentities(document) {
  return Object.fromEntries([...document.querySelectorAll('.book-card')].map((card) => [
    JSON.stringify([card.querySelector('.culture-meta').textContent, card.querySelector('h3').textContent]), card.id,
  ]));
}

test('three editable reading paths link only to the four selected books and the existing Song ci collection', async (t) => {
  const dom = await render(); t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(reading.readingPaths.length, 3);
  const paths = [...document.querySelectorAll('.reading-path')];
  assert.equal(paths.length, 3);
  for (const [index, path] of paths.entries()) {
    const source = reading.readingPaths[index];
    assert.equal(path.querySelector('h3').textContent, source.title);
    assert.equal(path.querySelector('p').textContent, source.description);
    assert.deepEqual([...path.querySelectorAll('li a')].map((a) => a.textContent), source.bookTitles);
    for (const a of path.querySelectorAll('li a')) {
      assert.equal(document.getElementById(a.hash.slice(1)).querySelector('h3').textContent, a.textContent);
    }
    assert.equal(path.querySelectorAll('.reading-path-poems').length, Number(Boolean(source.includePoems)));
  }
  assertTargets(document);
  assert.equal(document.querySelectorAll('.book-card').length, 4);
  assert.equal(document.querySelectorAll('.reading-path a[target], script').length, 0, 'the index uses native in-page links, no external request or runtime');
  const order = [...document.querySelector('.reading-section').children];
  assert.ok(order.indexOf(document.querySelector('.book-grid')) < order.indexOf(document.querySelector('.reading-paths')));
  assert.ok(order.indexOf(document.querySelector('.reading-paths')) < order.indexOf(document.querySelector('.poetry-collection')));
});

test('per-book links stay attached to author and title through book and block reordering', async (t) => {
  const dom = await render(); t.after(() => dom.window.close());
  const other = { ...structuredClone(reading), id: 'another-shelf' };
  const reordered = { ...structuredClone(reading), books: [...reading.books].reverse() };
  const changed = await render([other, reordered]); t.after(() => changed.window.close());
  assertTargets(changed.window.document);
  assert.deepEqual(bookIdentities(dom.window.document), bookIdentities(changed.window.document.getElementById(reading.id)));
  const ids = [...changed.window.document.getElementById(reading.id).querySelectorAll('.book-card')].map((card) => card.id);
  for (const id of ids) assert.match(id, /^reading-shelf-reading-book-[a-f0-9]{12}$/);
  for (const card of dom.window.document.querySelectorAll('.book-card')) {
    const title = card.querySelector('h3');
    assert.equal(card.getAttribute('aria-labelledby'), title.id);
    assert.equal(card.querySelector('.book-permalink').getAttribute('aria-label'), `Permalink to ${title.textContent}`);
  }
});

test('title normalization supports composed accents and Chinese without putting authored strings into IDs', async (t) => {
  const block = structuredClone(reading);
  block.books = [{ ...block.books[0], title: 'Café · 宋词', author: 'Renée' }];
  block.readingPaths = [{ title: '中英书架', description: '一个可编辑的关联。', bookTitles: ['  Cafe\u0301 · 宋词  ', 'Café · 宋词'] }];
  const dom = await render([block]); t.after(() => dom.window.close());
  assertTargets(dom.window.document);
  assert.equal(dom.window.document.querySelectorAll('.reading-path li').length, 1);
  assert.equal(dom.window.document.querySelector('.reading-path li a').textContent, block.books[0].title);
  const decomposed = structuredClone(block);
  decomposed.books[0].title = decomposed.books[0].title.normalize('NFD');
  decomposed.books[0].author = decomposed.books[0].author.normalize('NFD');
  const second = await render([decomposed]); t.after(() => second.window.close());
  assert.equal(second.window.document.querySelector('.book-card').id, dom.window.document.querySelector('.book-card').id);
});

test('duplicate book identities receive suffixes and ambiguous title references never guess a target', async (t) => {
  const block = structuredClone(reading);
  block.books = [block.books[0], block.books[0], { ...block.books[0], author: 'A different author' }, block.books[1]];
  block.readingPaths = [{ title: 'A path', description: 'Only unique book titles are linked.', bookTitles: [block.books[0].title, block.books[3].title, block.books[3].title] }];
  const dom = await render([block]); t.after(() => dom.window.close());
  assertTargets(dom.window.document);
  const cards = [...dom.window.document.querySelectorAll('.book-card')];
  assert.equal(cards[1].id, `${cards[0].id}-2`);
  assert.notEqual(cards[2].id, cards[0].id);
  assert.deepEqual([...dom.window.document.querySelectorAll('.reading-path li a')].map((a) => a.textContent), [block.books[3].title]);
});

test('missing, renamed and case-mismatched references are skipped, and paths with no book target disappear', async (t) => {
  const block = structuredClone(reading);
  const selected = block.books[0].title;
  block.books[0].title = 'An edited title';
  block.readingPaths = [
    { title: 'Outdated', description: 'This path must not lead to another book.', bookTitles: [selected], includePoems: true },
    { title: 'Missing', description: 'This path is hidden.', bookTitles: ['Not on this shelf', block.books[1].title.toLowerCase()] },
    { title: 'Partly valid', description: 'The remaining link is still useful.', bookTitles: ['Not on this shelf', block.books[2].title] },
  ];
  const dom = await render([block]); t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelectorAll('.reading-path').length, 1);
  assert.equal(dom.window.document.querySelector('.reading-path h3').textContent, 'Partly valid');
  assert.equal(dom.window.document.querySelector('.reading-path li a').textContent, block.books[2].title);
  assertTargets(dom.window.document);
});

test('legacy, empty and anonymous reading sections retain their contents without an unusable index', async (t) => {
  const legacy = structuredClone(reading); delete legacy.readingPaths;
  for (const block of [legacy, { ...reading, readingPaths: [] }, { ...reading, books: [] }, { ...reading, id: undefined }]) {
    const dom = await render([block]); t.after(() => dom.window.close());
    assert.equal(dom.window.document.querySelector('.reading-paths'), null);
    assert.equal(dom.window.document.querySelectorAll('.book-card').length, block.books.length);
    assert.equal(dom.window.document.querySelectorAll('.poem-card').length, block.excerpts.length);
    assertTargets(dom.window.document);
  }
  const unnamed = { ...reading, id: undefined };
  const two = await render([unnamed, unnamed]); t.after(() => two.window.close());
  assert.equal(two.window.document.querySelectorAll('[id], .book-permalink, .reading-paths').length, 0);
});

test('optional Song ci links are omitted when there are no poems', async (t) => {
  const dom = await render([{ ...reading, excerpts: [] }]); t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelectorAll('.reading-path').length, 3);
  assert.equal(dom.window.document.querySelectorAll('.reading-path-poems').length, 0);
  assertTargets(dom.window.document);
});

test('books, full poem text and existing personal notes remain unchanged and outside the index', async (t) => {
  const block = structuredClone(reading);
  block.books[0].reflection = 'A personal note supplied separately.';
  block.excerpts[0].reflection = 'A poem margin note supplied separately.';
  const dom = await render([block]); t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.deepEqual([...document.querySelectorAll('.book-copy h3')].map((el) => el.textContent), block.books.map((book) => book.title));
  assert.deepEqual([...document.querySelectorAll('.book-blurb')].map((el) => el.textContent), block.books.map((book) => book.blurb));
  assert.deepEqual([...document.querySelectorAll('.excerpt-original')].map((el) => el.textContent), block.excerpts.flatMap((poem) => poem.text.split(/\n\s*\n/)));
  assert.ok([...document.querySelectorAll('.poem-stanzas')].every((el) => !el.closest('details, [hidden]')));
  assert.deepEqual([...document.querySelectorAll('.personal-reflection > p:last-child')].map((el) => el.textContent), [block.books[0].reflection, block.excerpts[0].reflection]);
  assert.equal(document.querySelector('.reading-paths .personal-reflection'), null);
});

test('authored index titles, descriptions and linked book titles are escaped', async (t) => {
  const block = structuredClone(reading);
  const payload = '<img src=x onerror=alert(1)> & “书”';
  block.books[0].title = payload;
  block.readingPaths = [{ title: payload, description: '<script>alert(2)</script>', bookTitles: [payload] }];
  const dom = await render([block]); t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('img, script, [onerror]').length, 0);
  assert.equal(document.querySelector('.reading-path h3').textContent, payload);
  assert.equal(document.querySelector('.reading-path p').textContent, block.readingPaths[0].description);
  assert.equal(document.querySelector('.reading-path li a').textContent, payload);
  assertTargets(document);
});

test('the real Studio bridge maps book titles and editable path prose while leaving reference links native', async (t) => {
  const dom = await render(); t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  document.querySelector('.reading-section').dataset.studioBlock = '0';
  const content = document.createElement('script');
  content.type = 'application/json'; content.id = 'studio-content-data';
  content.dataset.documentId = 'pages/reading.json'; content.dataset.previewRev = 'paths-test';
  content.textContent = JSON.stringify({ sections: [reading] }); document.body.append(content);
  const bridge = await build({ entryPoints: [fileURLToPath(new URL('../studio/preview-bridge.js', import.meta.url))], bundle: true, format: 'iife', platform: 'browser', write: false });
  window.eval(bridge.outputFiles[0].text);
  for (const [index, title] of [...document.querySelectorAll('.book-copy h3')].entries()) {
    assert.equal(title.dataset.studioPath, JSON.stringify(['sections', '0', 'books', String(index), 'title']));
    title.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    assert.equal(title.getAttribute('contenteditable'), 'true');
    window.__willStudioInline.cancel();
  }
  for (const [index, path] of [...document.querySelectorAll('.reading-path')].entries()) {
    for (const [selector, key] of [['h3', 'title'], ['p', 'description']]) {
      const element = path.querySelector(selector);
      assert.equal(element.closest('[data-studio-ignore]'), null);
      assert.equal(element.dataset.studioPath, JSON.stringify(['sections', '0', 'readingPaths', String(index), key]));
    }
    assert.equal(path.querySelector('nav [data-studio-path]'), null);
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    path.querySelector('a').dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, 'the native local jump is not consumed as an edit');
  }
});

test('the shared schema and CMS expose optional bounded paths with explicit reference maintenance help', async () => {
  const legacy = structuredClone(reading); delete legacy.readingPaths;
  assert.equal(readingBlockSchema.parse(legacy).readingPaths, undefined);
  const path = { title: 'A path', description: 'A connection.', bookTitles: [reading.books[0].title] };
  assert.equal(readingBlockSchema.parse({ ...reading, readingPaths: [path] }).readingPaths[0].includePoems, false);
  for (const bad of [
    { ...path, title: ' ' }, { ...path, title: 'x'.repeat(101) },
    { ...path, description: ' ' }, { ...path, description: 'x'.repeat(361) },
    { ...path, bookTitles: [] }, { ...path, bookTitles: [' '] },
    { ...path, bookTitles: Array(25).fill('A') }, { ...path, includePoems: 'yes' },
  ]) assert.equal(readingBlockSchema.safeParse({ ...reading, readingPaths: [bad] }).success, false);
  assert.equal(readingBlockSchema.safeParse({ ...reading, readingPaths: Array(7).fill(path) }).success, false);
  const config = load(await readFile(new URL('../.pages.yml', import.meta.url), 'utf8'));
  const field = config.components.reading.fields.find((entry) => entry.name === 'readingPaths');
  assert.notEqual(field.required, true);
  assert.equal(field.list.max, 6);
  assert.match(field.description, /Anchor ID/);
  assert.deepEqual(field.fields.map((entry) => entry.name), ['title', 'description', 'bookTitles', 'includePoems']);
  assert.match(field.fields.find((entry) => entry.name === 'bookTitles').description, /rename.*update/i);
});

test('index styles parse and permit wrapped text, narrow grid columns and keyboard-sized links', async (t) => {
  const result = await transform(css, { loader: 'css' });
  assert.deepEqual(result.warnings, []);
  const dom = await render(); t.after(() => dom.window.close());
  const { document } = dom.window;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const computed = (selector) => dom.window.getComputedStyle(document.querySelector(selector));
  assert.equal(computed('.reading-path').minWidth, '0px');
  assert.equal(computed('.reading-path > p').overflowWrap, 'anywhere');
  assert.equal(computed('.reading-path a').minHeight, '44px');
  assert.equal(computed('.reading-path a').maxWidth, '100%');
  assert.equal(computed('.reading-path a').overflowWrap, 'anywhere');
  const mobile = [...style.sheet.cssRules].find((rule) => rule.conditionText === '(max-width: 760px)');
  assert.ok(mobile);
  assert.equal([...mobile.cssRules].find((rule) => rule.selectorText === '.reading-paths-grid').style.getPropertyValue('grid-template-columns'), '1fr');
});

test('reading-path navigation overrides global desktop and mobile navigation layout without hiding its final link', async (t) => {
  const globalCss = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  for (const width of [1440, 390, 320]) {
    const dom = await render(); t.after(() => dom.window.close());
    const { document } = dom.window;
    // jsdom does not evaluate viewport media queries. Apply the matching rules
    // from the real stylesheets in their original order to test the cascade.
    const source = document.createElement('style');
    source.textContent = globalCss + '\n' + css;
    document.head.append(source);
    const atWidth = (rules) => [...rules].map((rule) => {
      if (rule.type !== dom.window.CSSRule.MEDIA_RULE) return rule.cssText;
      const max = rule.conditionText.match(/^\(max-width:\s*(\d+)px\)$/);
      const min = rule.conditionText.match(/^\(min-width:\s*(\d+)px\)$/);
      return (max && width <= Number(max[1])) || (min && width >= Number(min[1])) ? atWidth(rule.cssRules) : '';
    }).join('\n');
    const resolvedCss = atWidth(source.sheet.cssRules);
    source.remove();
    const applied = document.createElement('style');
    // Guard against the former mobile primary-nav rule as well, even if it is
    // reintroduced later. This rule deliberately follows the scoped stylesheet.
    applied.textContent = resolvedCss + (width <= 480 ? '\nnav a:last-child { display: none; }' : '');
    document.head.append(applied);
    for (const nav of document.querySelectorAll('.reading-path nav')) {
      const computed = dom.window.getComputedStyle(nav);
      assert.equal(computed.display, 'block', `paths remain a single column at ${width}px`);
      assert.equal(computed.maxWidth, 'none');
      assert.equal(computed.overflow, 'visible');
      assert.equal(computed.whiteSpace, 'normal');
      for (const link of nav.querySelectorAll('a')) assert.equal(dom.window.getComputedStyle(link).display, 'inline-flex', `all book and continuation links remain visible at ${width}px`);
    }
    const continuation = document.querySelector('.reading-path-poems');
    const computed = dom.window.getComputedStyle(continuation);
    assert.equal(computed.width, 'fit-content');
    assert.equal(computed.whiteSpace, 'nowrap');
    assert.equal(computed.justifyContent, 'flex-start');
    assert.equal(computed.gap, '6px');
    assert.equal(dom.window.getComputedStyle(continuation.querySelector('span')).flex, '0 0 auto');
    assert.equal(continuation.previousElementSibling.tagName, 'UL', 'the continuation stays after the book list in the same navigation column');
  }
});
