import test from 'node:test';
import assert from 'node:assert/strict';
import { searchContent, SEARCH_LIMITS } from '../studio/content-search.mjs';

const page = (id, data, kind = 'page') => ({ id: `pages/${id}.json`, kind, name: data.title || id, route: `/${id}`, data });
const search = (documents, query, extra = {}) => searchContent({ documents, query, ...extra });
const highlighted = result => result.excerpt.slice(result.matchStart, result.matchEnd);

test('reading-path prose is searchable while structural book-title references are excluded', () => {
  const doc = page('paths', { title: 'Reading', sections: [{ type: 'reading', readingPaths: [{ title: 'Chosen family', description: 'Care across generations.', bookTitles: ['reference-only-marker'] }] }] });
  assert.deepEqual(search([doc], 'generations').results[0].path, ['sections', '0', 'readingPaths', '0', 'description']);
  assert.deepEqual(search([doc], 'Chosen family').results[0].path, ['sections', '0', 'readingPaths', '0', 'title']);
  assert.equal(search([doc], 'reference-only-marker').results.length, 0);
});

test('poem background can be found independently of its source URL and personal reflection', () => {
  const doc = page('poems', { title: 'Poems', sections: [{ type: 'reading', excerpts: [{ work: 'A poem', context: 'Written in Huangzhou.', contextSourceUrl: 'https://example.com/private-source-marker', reflection: '' }] }] });
  const hit = search([doc], 'Huangzhou').results[0];
  assert.deepEqual(hit.path, ['sections', '0', 'excerpts', '0', 'context']);
  assert.equal(search([doc], 'private-source-marker').results.length, 0);
});

test('Chinese matches navigate to actual section leaves, including array content', () => {
  const doc = page('reading', { title: 'Reading', published: true, sections: [{ heading: 'Intro' }, { type: 'reading', books: [{ title: '一个人的朝圣', blurb: '旅途中遇见普通人的故事。' }] }] });
  const result = search([doc], '普通人').results[0];
  assert.equal(result.id, doc.id);
  assert.deepEqual(result.path, ['sections', '1', 'books', '0', 'blurb']);
  assert.equal(result.sectionIndex, 1);
  assert.equal(highlighted(result), '普通人');
  assert.equal(result.published, true);
  const arrayHit = search([page('about', { title: 'About', sections: [{ paragraphs: ['Hello', '阅读与音乐'] }] })], '音乐').results[0];
  assert.deepEqual(arrayHit.path, ['sections', '0', 'paragraphs', '1']);
});

test('Now snapshots, lyric excerpts and future live records remain searchable in Studio', () => {
  const doc = page('listening', {
    title: 'Listening',
    sections: [
      { type: 'now', groups: [{ label: 'Thinking about', entries: [{ title: 'A lifetime research direction' }] }] },
      { type: 'listening', artists: [{ name: 'An artist', track: 'A song', lyricExcerpt: 'A line worth remembering' }] },
      { type: 'live', emptyNote: 'Photographs will arrive later', records: [{ title: 'A concert', artist: 'A live performer', date: 'September 2026', venue: 'A small hall' }] },
    ],
  });
  assert.deepEqual(search([doc], 'lifetime research').results[0].path, ['sections', '0', 'groups', '0', 'entries', '0', 'title']);
  assert.deepEqual(search([doc], 'worth remembering').results[0].path, ['sections', '1', 'artists', '0', 'lyricExcerpt']);
  assert.deepEqual(search([doc], 'Photographs will arrive').results[0].path, ['sections', '2', 'emptyNote']);
  assert.deepEqual(search([doc], 'small hall').results[0].path, ['sections', '2', 'records', '0', 'venue']);
});

test('document titles rank before nested titles, which rank before prose; one best result per document', () => {
  const docs = [page('body', { title: 'First', body: 'Music' }), page('nested', { title: 'Second', sections: [{ heading: 'Music', body: 'Music' }] }), page('title', { title: 'Music', body: 'Music' })];
  const result = search(docs, 'music');
  assert.deepEqual(result.results.map(hit => hit.id), ['pages/title.json', 'pages/nested.json', 'pages/body.json']);
  assert.deepEqual(result.results[0].path, ['title']);
  assert.equal(result.total, 3);
});

test('case-insensitive canonical Unicode matches retain original UTF-16 highlight boundaries', () => {
  const decomposed = 'Cafe\u0301';
  const result = search([page('unicode', { title: 'Unicode', body: `👩🏽‍🔬 Reading ${decomposed} beside CAFÉ and 中文。` })], 'CAFÉ').results[0];
  assert.equal(highlighted(result), decomposed);
  assert.equal(result.matchStart, result.excerpt.indexOf(decomposed));
  assert.equal(result.matchEnd, result.matchStart + decomposed.length);
  assert.equal(highlighted(search([page('reverse', { title: 'Café' })], 'CAFE\u0301').results[0]), 'Café');
  const emoji = search([page('emoji', { title: 'A 👩🏽‍🔬 scientist' })], '👩🏽‍🔬').results[0];
  assert.equal(highlighted(emoji), '👩🏽‍🔬');
});

test('Markdown body search uses visible prose, not destinations, HTML tags, attributes or scripts', () => {
  const body = '# A heading\n\nSome **thoughtful reading**, [more notes](https://example.org/private-token) and ![forest photograph](/uploads/forest.jpg).\n\n<script>private-script-token</script>\n\n<div data-secret="attribute-token">hidden HTML block</div>\n\n- One list item\n- Another item';
  const doc = page('note', { title: 'Note', body, published: false }, 'note');
  const result = search([doc], 'thoughtful reading').results[0];
  assert.deepEqual(result.path, ['body']);
  assert.equal(result.published, false);
  assert.equal(highlighted(result), 'thoughtful reading');
  assert.doesNotMatch(result.excerpt, /<script|<div|\*\*|https:/);
  for (const query of ['private-token', 'private-script-token', 'attribute-token', 'forest.jpg']) assert.equal(search([doc], query).total, 0);
  for (const query of ['A heading', 'more notes', 'forest photograph', 'Another item']) assert.equal(search([doc], query).total, 1);
});

test('private/config/schema/token properties and unknown subtrees never enter the search index', () => {
  const doc = page('private', { title: 'Public', token: 'secret-a', config: { title: 'secret-b' }, schema: { description: 'secret-c' }, raw: 'secret-d', sections: [{ type: 'text', heading: 'Visible', credentials: { title: 'secret-e' }, href: 'https://site.test/secret-f', body: 'Public prose' }] });
  for (const query of ['secret-a', 'secret-b', 'secret-c', 'secret-d', 'secret-e', 'secret-f']) assert.equal(search([doc], query).total, 0);
  const settings = { id: 'settings/site.json', kind: 'settings', name: 'Settings', route: '/', data: { brand: 'Will Qing', defaultTitle: 'Will’s website', footerText: 'Thanks for reading', description: 'not-indexed-secret', homeLinks: [{ label: 'private-label', href: '/path' }], token: 'private-token' } };
  for (const query of ['Will', 'Thanks for reading']) assert.equal(search([settings], query).results[0].published, true);
  for (const query of ['not-indexed-secret', 'private-label', 'private-token']) assert.equal(search([settings], query).total, 0);
});

test('literal regular-expression characters are never executed as patterns', () => {
  const doc = page('literal', { title: 'Literal', body: 'Characters [a-z]+ (.*) $^ are text.' });
  for (const query of ['[a-z]+', '(.*)', '$^']) assert.equal(highlighted(search([doc], query).results[0]), query);
  assert.equal(search([doc], '.*secret.*').total, 0);
  assert.doesNotThrow(() => search([doc], '[((((('));
});

test('long excerpts retain the exact match with valid bounded offsets and ellipsis context', () => {
  const body = `${'🌲 calm '.repeat(70)}A memory worth keeping${' 🌿 more'.repeat(70)}`;
  const result = search([page('long', { title: 'Long', body })], 'memory worth keeping').results[0];
  assert.ok(result.excerpt.length <= SEARCH_LIMITS.excerpt);
  assert.equal(highlighted(result), 'memory worth keeping');
  assert.ok(result.excerpt.startsWith('…'));
  assert.ok(result.excerpt.endsWith('…'));
  assert.ok(result.matchStart >= 0 && result.matchStart < result.matchEnd && result.matchEnd <= result.excerpt.length);
  assert.equal(result.excerpt.isWellFormed(), true);
});

test('media are deduplicated public assets, with literal paths and no document publication flag', () => {
  const media = [{ path: '/uploads/夕阳-cafe.jpg', name: '夕阳-cafe.jpg' }, { path: '/uploads/夕阳-cafe.jpg', name: '夕阳-cafe.jpg' }, { path: 'C:\\private\\夕阳.jpg', name: '夕阳.jpg' }, { path: '/uploads/../private/夕阳.jpg', name: '夕阳.jpg' }, { path: 'https://example.com/夕阳.jpg', name: '夕阳.jpg' }];
  const response = search([], '夕阳', { media });
  assert.equal(response.total, 1);
  const result = response.results[0];
  assert.equal(result.kind, 'media');
  assert.equal(result.id, 'media:/uploads/夕阳-cafe.jpg');
  assert.equal(result.path, '/uploads/夕阳-cafe.jpg');
  assert.equal(result.route, result.path);
  assert.equal(result.published, undefined);
  assert.equal(highlighted(result), '夕阳');
});

test('canonically expanded long matches still produce bounded well-formed excerpts', () => {
  const decomposed = 'e\u0301'.repeat(200);
  const result = search([page('combining', { title: 'Combining', body: decomposed })], 'é'.repeat(200)).results[0];
  assert.ok(result.excerpt.length <= SEARCH_LIMITS.excerpt);
  assert.ok(result.matchStart < result.matchEnd && result.matchEnd <= result.excerpt.length);
  assert.equal(highlighted(result).length % 2, 0, 'The displayed part ends on a complete e-plus-accent grapheme.');
  assert.equal(result.excerpt.isWellFormed(), true);
});

test('limits, totals, duplicate document IDs, and deterministic result order are explicit', () => {
  const docs = Array.from({ length: 120 }, (_, i) => page(String(i), { title: `Music ${i}` }));
  const response = search([...docs, docs[0]], 'Music', { limit: 4 });
  assert.equal(response.total, 120);
  assert.equal(response.results.length, 4);
  assert.equal(response.truncated, true);
  assert.deepEqual(response.results.map(result => result.title), ['Music 0', 'Music 1', 'Music 2', 'Music 3']);
  assert.equal(search(docs, 'Music', { limit: 10_000 }).results.length, SEARCH_LIMITS.results);
  assert.equal(search(docs, 'Music', { limit: Number.NaN }).results.length, 30);
});

test('invalid, blank, and overlong queries are safe and never return the whole library', () => {
  for (const query of [undefined, null, {}, '', ' \n\t ', 'x'.repeat(201)]) assert.deepEqual(search([], query), { results: [], total: 0, truncated: false });
  assert.equal(search([page('spaces', { title: 'Quiet reading' })], '  QUIET\n reading  ').total, 1);
  assert.doesNotThrow(() => searchContent({ documents: null, media: {}, query: 'x' }));
});

test('scan caps bound large fields and mark partial totals without reading later private data', () => {
  const doc = page('huge', { title: 'A large document', body: `${'a'.repeat(SEARCH_LIMITS.field)}needle-beyond-cap` });
  const response = search([doc], 'needle-beyond-cap');
  assert.equal(response.total, 0);
  assert.equal(response.truncated, true);
  const many = Array.from({ length: SEARCH_LIMITS.documents + 1 }, (_, i) => page(String(i), { title: 'Needle' }));
  const capped = search(many, 'Needle');
  assert.equal(capped.total, SEARCH_LIMITS.documents);
  assert.equal(capped.truncated, true);
});

test('search is read-only, ignores getters/prototypes/cycles, and keeps home publication semantics', () => {
  const data = { title: 'Home', sections: [{ heading: 'Readable' }] };
  data.sections.push(data);
  Object.defineProperty(data, 'body', { enumerable: true, get() { throw new Error('Getter must not execute.'); } });
  Object.freeze(data.sections[0]); Object.freeze(data.sections); Object.freeze(data);
  const doc = Object.freeze({ id: 'home/home.json', kind: 'home', name: 'Home', route: '/', data });
  const result = search([doc], 'Readable').results[0];
  assert.equal(result.published, true);
  assert.deepEqual(result.path, ['sections', '0', 'heading']);
  assert.equal(search([{ ...page('config', { title: 'Needle' }), kind: 'config' }], 'Needle').total, 0);
});
