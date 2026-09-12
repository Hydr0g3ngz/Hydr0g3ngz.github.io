import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCommandPalette } from '../studio/web/command-palette.js';

const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const pageResult = (title = 'Reading', extras = {}) => ({ id: 'pages/reading.json', kind: 'page', title, route: '/reading/', path: ['sections', '0', 'books', '2', 'title'], sectionIndex: 0, excerpt: 'A book about a small discovery.', matchStart: 2, matchEnd: 6, published: true, ...extras });

function setup(t, callbacks = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="launch">Search</button><textarea id="writer"></textarea></body>', { url: 'http://127.0.0.1:4310/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const doc = dom.window.document;
  // JSDOM has the real native-dialog element but not all browser top-layer APIs.
  if (!dom.window.HTMLDialogElement.prototype.showModal) dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  if (!dom.window.HTMLDialogElement.prototype.close) dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new dom.window.Event('close')); };
  const palettes = [];
  const make = options => { const palette = createCommandPalette({ search: async () => ({ results: [], total: 0, truncated: false }), openDocument: () => {}, ...callbacks, ...options }); palettes.push(palette); return palette; };
  const palette = make();
  const dialog = doc.querySelector('.command-dialog');
  const input = dialog.querySelector('[role="combobox"]');
  const status = dialog.querySelector('[role="status"]');
  const list = dialog.querySelector('[role="listbox"]');
  const key = (key, target = input, extra = {}) => { const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }); target.dispatchEvent(event); return event; };
  const type = value => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  t.after(() => { palettes.forEach(item => item.destroy()); dom.window.close(); globalThis.document = previous; });
  return { dom, doc, palette, make, dialog, input, list, status, key, type };
}

test('empty query shows commands; keyboard skips disabled rows, wraps, runs once and restores focus', async t => {
  const calls = [];
  const ui = setup(t, { listCommands: () => [
    { id: 'blocked', label: 'Unavailable', run: () => calls.push('blocked'), disabled: true },
    { id: 'save', label: 'Save locally', description: 'Keep your current draft.', run: () => calls.push('save') },
    { id: 'media', label: 'Open image library', run: () => calls.push('media') }
  ], search: async query => { calls.push(query); return { results: [] }; } });
  const launch = ui.doc.querySelector('#launch'); launch.focus();
  ui.palette.open();
  assert.ok(ui.dialog.open);
  assert.equal(ui.doc.activeElement, ui.input);
  assert.equal(ui.input.getAttribute('aria-expanded'), 'true');
  const options = [...ui.list.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 3);
  assert.equal(options[0].getAttribute('aria-disabled'), 'true');
  assert.equal(ui.input.getAttribute('aria-activedescendant'), options[1].id);
  ui.key('ArrowUp');
  assert.equal(options[2].getAttribute('aria-selected'), 'true');
  ui.key('ArrowDown');
  assert.equal(options[1].getAttribute('aria-selected'), 'true');
  ui.key('Enter'); ui.key('Enter');
  await pause();
  assert.deepEqual(calls, ['save']);
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.doc.activeElement, launch);
  assert.equal(ui.input.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.input.hasAttribute('aria-activedescendant'), false);
});

test('search is debounced and older success/failure cannot replace a newer response', async t => {
  const calls = [];
  const old = deferred(), current = deferred(), ancient = deferred();
  const ui = setup(t, { search: query => { calls.push(query); return query === 'old' ? old.promise : query === 'ancient' ? ancient.promise : current.promise; } });
  ui.palette.open('ancient');
  ui.type('o'); ui.type('old');
  assert.equal(ui.dialog.dataset.state, 'loading');
  await pause(180);
  ui.type('current'); await pause(180);
  assert.deepEqual(calls, ['ancient', 'old', 'current']);
  current.resolve({ results: [pageResult('Current result')], total: 1 }); await pause();
  assert.match(ui.list.textContent, /Current result/);
  old.resolve({ results: [pageResult('Old result')], total: 1 });
  ancient.reject(new Error('Ancient failure')); await pause();
  assert.match(ui.list.textContent, /Current result/);
  assert.doesNotMatch(ui.list.textContent, /Old result/);
  assert.equal(ui.dialog.dataset.state, 'ready');
  assert.equal(ui.list.getAttribute('aria-busy'), 'false');
});

test('result click awaits opening, selects exact field path and shows the source-provided excerpt range', async t => {
  const calls = [];
  const opening = deferred();
  const hit = pageResult('My book', { excerpt: 'Mixed 中文 book text.', matchStart: 6, matchEnd: 8 });
  const ui = setup(t, { search: async () => ({ results: [hit], total: 1 }), openDocument: id => { calls.push(['open', id]); return opening.promise; }, selectField: (path, section) => calls.push(['field', path, section]) });
  ui.palette.open('book'); await pause();
  assert.equal(ui.list.querySelector('.command-option-title mark').textContent, 'book');
  assert.equal(ui.list.querySelector('.command-option-excerpt mark').textContent, '中文');
  ui.list.querySelector('[role="option"]').click();
  assert.deepEqual(calls, [['open', 'pages/reading.json']]);
  assert.equal(ui.dialog.open, false);
  opening.resolve(); await pause();
  assert.deepEqual(calls[1], ['field', hit.path, 0]);
  assert.notEqual(calls[1][1], hit.path, 'callback gets a path copy');
});

test('untrusted titles, excerpts, routes, commands and regex-like queries stay inert text', async t => {
  const payload = '<img src=x onerror="window.attack=true"><script>window.attack=true</script>';
  const ui = setup(t, { search: async () => ({ results: [pageResult(payload, { excerpt: `Before ${payload} after [.*`, route: payload, matchStart: 7, matchEnd: 11 })], total: 1 }), listCommands: () => [{ id: 'html', label: payload, description: payload, run() {} }] });
  ui.palette.open();
  assert.equal(ui.list.querySelector('img,script'), null);
  ui.type('[.*'); await pause(180);
  assert.equal(ui.dom.window.attack, undefined);
  assert.equal(ui.dialog.querySelector('img,script'), null);
  assert.equal(ui.list.querySelector('.command-option-title').textContent, payload);
  assert.equal(ui.list.querySelector('.command-option-location').textContent, payload);
  assert.equal(ui.list.querySelector('mark').textContent, '<img');
  assert.match(ui.list.textContent, /\[\.\*/);
});

test('loading, empty, error, malformed response and truncation have accessible states; clear restores commands', async t => {
  let outcome = deferred();
  const ui = setup(t, { search: () => outcome.promise, listCommands: () => [{ id: 'save', label: 'Save locally', run() {} }] });
  ui.palette.open('missing');
  assert.equal(ui.dialog.dataset.state, 'loading');
  assert.match(ui.status.textContent, /Searching/);
  outcome.resolve({ results: [], total: 0 }); await pause();
  assert.equal(ui.dialog.dataset.state, 'empty');
  assert.match(ui.status.textContent, /No saved content/);
  assert.equal(ui.input.hasAttribute('aria-activedescendant'), false);
  outcome = deferred(); ui.type('failure'); await pause(180);
  outcome.reject(new Error('Search unavailable <script>')); await pause();
  assert.equal(ui.dialog.dataset.state, 'error');
  assert.match(ui.status.textContent, /Search unavailable <script>/);
  assert.equal(ui.status.querySelector('script'), null);
  outcome = deferred(); ui.type('broken'); await pause(180);
  outcome.resolve({ results: 'not-an-array' }); await pause();
  assert.match(ui.status.textContent, /unreadable response/);
  outcome = deferred(); ui.type('many'); await pause(180);
  outcome.resolve({ results: [pageResult()], total: 99, truncated: true }); await pause();
  assert.match(ui.status.textContent, /Showing 1 content result/);
  assert.match(ui.status.textContent, /More matches may be available/);
  ui.dialog.querySelector('.command-clear').click();
  assert.equal(ui.input.value, '');
  assert.equal(ui.doc.activeElement, ui.input);
  assert.equal(ui.dialog.querySelector('.command-clear').hidden, true);
  assert.match(ui.list.textContent, /Save locally/);
  assert.match(ui.status.textContent, /Choose an action/);
});

test('IME composition does not search or activate until committed; Escape cancels afterward and no global Ctrl+K is claimed', async t => {
  const calls = [];
  const ui = setup(t, { search: async query => { calls.push(query); return { results: [pageResult()] }; } });
  ui.palette.open();
  ui.input.dispatchEvent(new ui.dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  ui.type('读');
  ui.key('Enter', ui.input, { isComposing: true });
  ui.key('Escape', ui.input, { keyCode: 229 });
  await pause(180);
  assert.deepEqual(calls, []);
  assert.equal(ui.dialog.open, true);
  ui.input.dispatchEvent(new ui.dom.window.CompositionEvent('compositionend', { bubbles: true }));
  await pause(180);
  assert.deepEqual(calls, ['读']);
  assert.equal(ui.key('k', ui.input, { ctrlKey: true }).defaultPrevented, false);
  ui.key('Escape');
  assert.equal(ui.dialog.open, false);
  const writer = ui.doc.querySelector('#writer'); writer.focus();
  assert.equal(ui.key('k', writer, { metaKey: true }).defaultPrevented, false);
  assert.equal(ui.dialog.open, false);
});

test('media paths use the media callback; a missing callback disables the row', async t => {
  const calls = [];
  const media = { id: 'media:/images/library.jpg', kind: 'media', title: 'Library', route: '/images/library.jpg', path: '/images/library.jpg', excerpt: 'library.jpg', matchStart: 0, matchEnd: 7 };
  const ui = setup(t, { search: async () => ({ results: [media], total: 1 }), onMedia: path => calls.push(path), openDocument: () => assert.fail('media must not open a document') });
  ui.palette.open('library'); await pause(); ui.key('Enter'); await pause();
  assert.deepEqual(calls, ['/images/library.jpg']);
  const second = ui.make({ onMedia: undefined });
  second.open('library'); await pause();
  const row = ui.doc.querySelectorAll('.command-dialog')[1].querySelector('[role="option"]');
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  row.click();
  assert.deepEqual(calls, ['/images/library.jpg']);
});

test('cancelled opening skips field selection; action errors report through toast and reopening supersedes slow selection', async t => {
  const calls = [];
  let opening = false;
  const ui = setup(t, { search: async () => ({ results: [pageResult()], total: 1 }), openDocument: () => opening, selectField: () => calls.push('field'), toast: (...args) => calls.push(args), listCommands: () => [{ id: 'fail', label: 'Fail', run: () => { throw new Error('Could not save'); } }] });
  ui.palette.open('book'); await pause(); ui.key('Enter'); await pause();
  assert.deepEqual(calls, []);
  ui.palette.open(); ui.key('Enter'); await pause();
  assert.deepEqual(calls, [['Could not save', true]]);
  const delayed = deferred(); opening = delayed.promise;
  ui.palette.open('book'); await pause(); ui.key('Enter');
  ui.palette.open();
  delayed.resolve(true); await pause();
  assert.deepEqual(calls, [['Could not save', true]]);
  assert.equal(ui.doc.activeElement, ui.input);
  assert.equal(ui.dialog.open, true);
});

test('instances have separate ARIA identities; destroy removes listeners and pending responses never resurrect closed UI', async t => {
  const response = deferred();
  let requests = 0;
  const ui = setup(t, { search: () => { requests++; return response.promise; } });
  const second = ui.make();
  ui.palette.open('first');
  const dialogs = [...ui.doc.querySelectorAll('.command-dialog')];
  const ids = [...ui.doc.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length);
  second.open();
  assert.equal(dialogs[0].open, true);
  assert.equal(dialogs[1].open, true);
  second.close();
  assert.equal(ui.doc.activeElement, ui.input);
  ui.palette.close();
  response.resolve({ results: [pageResult('Late')], total: 1 }); await pause();
  assert.equal(ui.dialog.open, false);
  assert.doesNotMatch(ui.list.textContent, /Late/);
  ui.palette.open(); ui.type('pending timer'); ui.palette.destroy();
  ui.type('detached input'); ui.key('Enter');
  await pause(180);
  assert.equal(requests, 1);
  assert.equal(ui.dialog.isConnected, false);
  ui.palette.open();
  assert.equal(ui.doc.querySelectorAll('.command-dialog').length, 1);
  second.destroy();
  assert.equal(ui.doc.querySelectorAll('.command-dialog').length, 0);
});
