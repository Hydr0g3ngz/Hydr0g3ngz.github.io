import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform as compileAstro } from '@astrojs/compiler-rs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';

// Compile the real component with Astro's installed compiler, then render with its
// container. This exercises template conditions/escaping without a build or server.
const componentUrl = new URL('../src/components/blocks/ReadingBlock.astro', import.meta.url);
const compiled = compileAstro(await readFile(componentUrl, 'utf8'), {
  filename: componentUrl.pathname,
  internalURL: import.meta.resolve('astro/compiler-runtime'),
  resolvePath: (specifier) => specifier,
});
const javascript = await transform(compiled.code, { loader: 'ts', format: 'esm', target: 'es2022' });
const { default: ReadingBlock } = await import(`data:text/javascript;base64,${Buffer.from(javascript.code).toString('base64')}`);
const reading = JSON.parse(await readFile(new URL('../src/content/pages/reading.json', import.meta.url), 'utf8')).sections.find((block) => block.type === 'reading');

async function render(blocks = [reading]) {
  const container = await AstroContainer.create();
  const locals = {};
  const fragments = [];
  for (const block of blocks) {
    fragments.push(await container.renderToString(ReadingBlock, { props: { block }, locals }));
  }
  return new JSDOM(fragments.join(''), { url: 'https://example.test/reading/' });
}

function assertLocalTargets(document) {
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'every generated ID is unique');
  for (const link of document.querySelectorAll('.reading-nav a, .poem-permalink')) {
    const href = link.getAttribute('href');
    assert.ok(href.startsWith('#'), 'navigation uses native local fragment links');
    const target = document.getElementById(href.slice(1));
    assert.ok(target, `target ${href} exists`);
    assert.equal(target.getAttribute('tabindex'), '-1', 'native jumps can move keyboard focus to the target');
    assert.equal(target.closest('.reading-section'), link.closest('.reading-section'), 'jump stays in its own block');
  }
}

test('Reading renders accessible Books, Song ci and all four poem jumps to real targets', async (t) => {
  const dom = await render(); t.after(() => dom.window.close());
  const { document } = dom.window;
  const nav = document.querySelector('nav.reading-nav');
  assert.ok(nav.hasAttribute('data-studio-ignore'));
  assert.ok(nav.getAttribute('aria-label').includes(reading.heading));
  assert.deepEqual([...nav.querySelectorAll('.reading-nav-sections a')].map((a) => a.textContent), ['Books', 'Song ci']);
  assert.equal(reading.excerpts.length, 4, 'the current reading page keeps all four chosen poems');
  assert.deepEqual([...nav.querySelectorAll('.reading-nav-poems a [lang]')].map((a) => a.textContent), reading.excerpts.map((poem) => poem.work));
  assertLocalTargets(document);
  assert.equal(document.querySelector('.book-grid').id, 'reading-shelf-reading-books');
  assert.equal(document.querySelector('.poetry-collection').id, 'reading-shelf-reading-song-ci');
});

test('permalinks leave original headings, full stanzas, books and reflections unchanged', async (t) => {
  const block = structuredClone(reading);
  block.books[0].reflection = 'An existing personal note.\nKept word for word.';
  block.excerpts[0].reflection = 'An existing margin note.';
  const dom = await render([block]); t.after(() => dom.window.close());
  const { document } = dom.window;
  const poems = [...document.querySelectorAll('.poem-card')];
  poems.forEach((figure, index) => {
    const source = block.excerpts[index];
    const title = figure.querySelector('h3');
    const permalink = figure.querySelector('.poem-permalink');
    assert.equal(title.textContent, source.work, 'the authored heading has no added permalink text');
    assert.equal(figure.getAttribute('aria-labelledby'), title.id);
    assert.equal(permalink.getAttribute('href'), `#${figure.id}`);
    assert.equal(permalink.getAttribute('aria-label'), `Permalink to ${source.work}`);
    assert.ok(permalink.hasAttribute('data-studio-ignore'));
    assert.deepEqual([...figure.querySelectorAll('.excerpt-original')].map((p) => p.textContent), source.text.split(/\n\s*\n/));
    assert.equal(figure.querySelector('blockquote').getAttribute('cite'), source.sourceUrl);
    assert.equal(figure.querySelector('.poem-source').getAttribute('href'), source.sourceUrl);
  });
  assert.deepEqual([...document.querySelectorAll('.book-copy h3')].map((node) => node.textContent), block.books.map((book) => book.title));
  assert.deepEqual([...document.querySelectorAll('.book-blurb')].map((node) => node.textContent), block.books.map((book) => book.blurb));
  assert.deepEqual([...document.querySelectorAll('.personal-reflection > p:last-child')].map((node) => node.textContent), [block.books[0].reflection, block.excerpts[0].reflection]);
  assert.equal(document.querySelectorAll('.poem-stanzas').length, 4);
  assert.ok([...document.querySelectorAll('.poem-stanzas')].every(poem => !poem.closest('details, [hidden]')), 'the complete poems stay expanded, independently of optional background disclosures');
  assert.equal(document.querySelectorAll('script').length, 0, 'reading navigation needs no script');
});

test('named block anchors are distinct and stable when reading blocks are reordered', async (t) => {
  const second = { ...structuredClone(reading), id: 'later-shelf' };
  const dom = await render([reading, second]); t.after(() => dom.window.close());
  const reversed = await render([second, reading]); t.after(() => reversed.window.close());
  assertLocalTargets(dom.window.document);
  assertLocalTargets(reversed.window.document);
  for (const block of [reading, second]) {
    const ids = (document) => [...document.getElementById(block.id).querySelectorAll('[id]')].map((node) => node.id);
    assert.deepEqual(ids(dom.window.document), ids(reversed.window.document));
  }
});

test('poem permalinks stay attached to their author and title when poems are reordered', async (t) => {
  const reordered = { ...structuredClone(reading), excerpts: [...reading.excerpts].reverse() };
  const dom = await render(); t.after(() => dom.window.close());
  const reversed = await render([reordered]); t.after(() => reversed.window.close());
  assertLocalTargets(reversed.window.document);
  const identityLinks = (document) => Object.fromEntries([...document.querySelectorAll('.poem-card')].map((figure) => [
    `${figure.querySelector('.poem-byline > span:last-child').textContent}\0${figure.querySelector('h3').textContent}`,
    figure.querySelector('.poem-permalink').getAttribute('href'),
  ]));
  assert.deepEqual(identityLinks(dom.window.document), identityLinks(reversed.window.document));
});

test('repeated author/title pairs get collision suffixes without changing other poem links', async (t) => {
  const block = { ...structuredClone(reading), excerpts: [reading.excerpts[0], reading.excerpts[0], ...reading.excerpts.slice(1)] };
  const dom = await render([block]); t.after(() => dom.window.close());
  const original = await render(); t.after(() => original.window.close());
  assertLocalTargets(dom.window.document);
  const ids = [...dom.window.document.querySelectorAll('.poem-card')].map((node) => node.id);
  const originalIds = [...original.window.document.querySelectorAll('.poem-card')].map((node) => node.id);
  assert.equal(ids[0], originalIds[0]);
  assert.equal(ids[1], `${ids[0]}-2`);
  assert.deepEqual(ids.slice(2), originalIds.slice(1));
});

test('unnamed blocks keep full content but omit generated IDs, navigation and permalinks', async (t) => {
  const unnamed = { ...structuredClone(reading), id: undefined };
  const dom = await render([unnamed, unnamed]); t.after(() => dom.window.close());
  const { document } = dom.window;
  assertLocalTargets(document);
  assert.equal(document.querySelectorAll('[id], [tabindex], [aria-labelledby], .reading-nav, .poem-permalink').length, 0);
  assert.equal(document.querySelectorAll('.book-card').length, reading.books.length * 2);
  assert.equal(document.querySelectorAll('.poem-card').length, reading.excerpts.length * 2);
  for (const section of document.querySelectorAll('.reading-section')) {
    assert.deepEqual([...section.querySelectorAll('.excerpt-original')].map((p) => p.textContent), reading.excerpts.flatMap((poem) => poem.text.split(/\n\s*\n/)));
  }
});

test('empty collections omit only their own navigation and never create dead links', async (t) => {
  for (const block of [
    { ...reading, books: [] },
    { ...reading, excerpts: [] },
    { ...reading, books: [], excerpts: [] },
  ]) {
    const dom = await render([block]); t.after(() => dom.window.close());
    const { document } = dom.window;
    assertLocalTargets(document);
    assert.equal(document.querySelectorAll('.reading-nav-sections a').length, Number(block.books.length > 0) + Number(block.excerpts.length > 0));
    assert.equal(document.querySelectorAll('.reading-nav-poems a').length, block.excerpts.length);
    assert.equal(document.querySelectorAll('.reading-nav').length, Number(block.books.length > 0 || block.excerpts.length > 0));
  }
});

test('authored titles are escaped and produce only safe hashed anchor IDs', async (t) => {
  const block = structuredClone(reading);
  block.excerpts[0].work = '<img src=x onerror=alert(1)> & “词”';
  const dom = await render([block]); t.after(() => dom.window.close());
  const { document } = dom.window;
  assertLocalTargets(document);
  assert.equal(document.querySelectorAll('img, [onerror]').length, 0);
  assert.equal(document.querySelector('.poem-title-line h3').textContent, block.excerpts[0].work);
  assert.match(document.querySelector('.poem-card').id, /^reading-shelf-reading-poem-[a-f0-9]{12}$/);
});

test('culture stylesheet parses with the navigation additions', async () => {
  const css = await readFile(new URL('../src/styles/culture.css', import.meta.url), 'utf8');
  const result = await transform(css, { loader: 'css' });
  assert.deepEqual(result.warnings, []);
});
