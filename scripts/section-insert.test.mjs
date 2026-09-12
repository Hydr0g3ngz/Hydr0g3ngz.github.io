import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { workspaceStorage } from '../studio/web/workspace-storage.js';

async function fixture(t, { max = 8, min = 0 } = {}) {
  const browser = new JSDOM(await readFile(new URL('../studio/web/index.html', import.meta.url), 'utf8'), { url: 'http://127.0.0.1:4310/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = browser, doc = window.document;
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'Element', 'Node']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
  }
  const originalFetch = globalThis.fetch, originalSetTimeout = globalThis.setTimeout, timers = new Set();
  globalThis.setTimeout = (fn, delay, ...args) => { const handle = originalSetTimeout(fn, delay, ...args); timers.add(handle); return handle; };
  const originalData = { title: 'Home', sections: [{ type: 'text', id: 'block', visible: true, heading: 'First', body: 'Existing content' }, { type: 'text', id: 'block-2', heading: 'Second', body: 'Keep this too', visible: false }] };
  const documents = [
    { id: 'home/home.json', kind: 'home', name: 'Home', route: '/', revision: 'home-1', data: originalData },
    { id: 'pages/empty.json', kind: 'page', name: 'Empty', route: '/empty/', revision: 'empty-1', data: { title: 'Empty', published: false, sections: [] } }
  ];
  const components = { text: { type: 'object', label: 'Text', fields: [{ name: 'id', type: 'string', default: 'block' }, { name: 'visible', type: 'boolean', default: true }, { name: 'heading', type: 'string', required: true }, { name: 'body', type: 'text', required: true }] } };
  const blocks = [{ name: 'text' }, { name: 'project-card', component: 'text' }, { name: 'missing-component' }, { name: 'text' }];
  const config = { components, content: documents.map(item => ({ path: `src/content/${item.id}`, fields: [{ name: 'title', type: 'string' }, { name: 'sections', type: 'block', blocks, list: { max, min } }] })) };
  const workspace = { id: 'a'.repeat(24), project: { name: 'Test workspace' }, originalProject: false };
  const storage = workspaceStorage(window.localStorage, workspace.id), requests = [];
  let preview = 0; const creations = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, method: options.method });
    let result;
    if (url === '/api/state') result = { documents: structuredClone(documents), media: [], config, workspace, token: 'fixture-token' };
    else if (url === '/api/preview') { const rev = String(++preview); result = { rev, url: `/preview/__studio/preview?rev=${rev}` }; }
    else if (url === '/api/document' && options.method === 'POST') result = await new Promise(resolve => creations.push({ resolve, payload: body }));
    else throw new Error(`Unexpected request ${url}`);
    return new Response(JSON.stringify(result), { status: 200 });
  };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const until = async condition => {
    for (let i = 0; i < 150; i++) { if (condition()) return; await new Promise(resolve => originalSetTimeout(resolve, 5)); }
    assert.fail('The editor did not reach the expected state.');
  };
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = originalSetTimeout; globalThis.fetch = originalFetch;
    browser.window.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const app = await import(`../studio/web/app.js?section-insert=${Date.now()}-${Math.random()}`);
  await until(() => doc.querySelector('#page-name').textContent === 'Home');
  const savedDraft = (id = 'home/home.json') => JSON.parse(storage.getItem(`will-studio-v1:${id}`))?.data;
  const choose = type => doc.querySelector(`[data-section-type="${type}"]`).click();
  const add = () => [...doc.querySelectorAll('#modal button')].find(button => button.textContent.trim() === 'Add section').click();
  const position = value => { const select = doc.querySelector('#modal select'); const label = { start: 'At the beginning', end: 'At the end', 'after-selected': 'After section' }[value]; select.value = [...select.options].find(option => option.textContent.startsWith(label)).value; select.dispatchEvent(new window.Event('change', { bubbles: true })); };
  return { app, doc, window, requests, originalData, storage, savedDraft, choose, add, position, until, creations };
}

test('the real library selects without mutation, inserts after selection in the browser draft and supports undo', async t => {
  const f = await fixture(t);
  f.doc.querySelector('.block-select').click();
  f.app.showPalette();
  assert.equal(f.doc.querySelector('#modal').open, true);
  assert.equal(f.doc.querySelectorAll('[data-section-type]').length, 2, 'duplicate and missing component entries are not offered');
  f.choose('text');
  assert.equal(f.savedDraft(), undefined, 'selecting a sketch does not change any content');
  f.add();
  await f.until(() => !f.doc.querySelector('#modal').open);
  const draft = f.savedDraft();
  assert.deepEqual(draft.sections.map(section => section.id), ['block', 'block-3', 'block-2']);
  assert.equal(draft.sections[1].type, 'text');
  assert.equal(f.requests.some(request => request.url === '/api/document'), false, 'insertion never saves or publishes');
  assert.equal(f.doc.querySelector('#save').disabled, false);
  f.doc.querySelector('#undo').click();
  assert.equal(f.savedDraft(), undefined);
});

test('duplicate and removal actions respect the same page section limits', async t => {
  const f = await fixture(t, { min: 2, max: 2 });
  f.doc.querySelector('.block-select').click();
  f.doc.querySelector('[title="Duplicate section"]').click();
  assert.equal(f.savedDraft(), undefined);
  f.doc.querySelector('[title="Remove section — undo is available"]').click();
  assert.equal(f.savedDraft(), undefined);
  assert.match(f.doc.querySelector('#toast').textContent, /at least 2/);
});

test('a late creation adds the draft to the list without closing a newer form or changing the current page', async t => {
  const f = await fixture(t), newButton = f.doc.querySelector('#new-page');
  const submit = () => f.doc.querySelector('#modal-content form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  const fill = (name, title) => {
    f.doc.querySelector('#modal-content [name=title]').value = title;
    f.doc.querySelector('#modal-content [name=slug]').value = name;
  };
  const result = (slug, title) => ({ document: { id: `pages/${slug}.json`, name: title, kind: 'page', route: `/${slug}/`, revision: 'new', data: { title, sections: [], published: false } } });
  newButton.click(); fill('alpha', 'Alpha'); submit(); submit();
  assert.equal(f.creations.length, 1, 'repeated submit does not create duplicate requests');
  [...f.doc.querySelectorAll('#modal button')].find(button => button.textContent === 'Close dialog').click();
  newButton.click(); fill('beta', 'Beta');
  f.creations[0].resolve(result('alpha', 'Alpha'));
  await f.until(() => [...f.doc.querySelectorAll('.page-label')].some(label => label.textContent === 'Alpha'));
  assert.equal(f.doc.querySelector('#modal').open, true);
  assert.equal(f.doc.querySelector('#modal-content [name=title]').value, 'Beta');
  assert.equal(f.doc.querySelector('#page-name').textContent, 'Home');
  submit(); assert.equal(f.creations.length, 2);
  f.creations[1].resolve(result('beta', 'Beta'));
  await f.until(() => f.doc.querySelector('#page-name').textContent === 'Beta');
  assert.equal(f.doc.querySelector('#modal').open, false);
  assert.equal(f.requests.filter(request => request.url === '/api/document').length, 2);
});

test('beginning/end positions and empty pages preserve the selected project block type', async t => {
  const f = await fixture(t);
  f.app.showPalette(); f.choose('project-card'); f.position('start'); f.add();
  await f.until(() => !f.doc.querySelector('#modal').open);
  assert.equal(f.savedDraft().sections[0].type, 'project-card');
  const aliasHeading = f.doc.querySelector('#f-sections-0-heading'), aliasBody = f.doc.querySelector('#f-sections-0-body');
  assert.ok(aliasHeading, 'the alias resolves its project component heading field');
  assert.ok(aliasBody, 'the alias resolves its project component body field');
  aliasHeading.value = 'Edited project card'; aliasHeading.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  aliasBody.value = 'Words written through the aliased inspector.'; aliasBody.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.savedDraft().sections[0].heading, 'Edited project card');
  assert.equal(f.savedDraft().sections[0].body, 'Words written through the aliased inspector.');
  assert.equal(f.savedDraft().sections[0].type, 'project-card', 'editing fields never changes the selected discriminator');
  assert.equal(f.savedDraft().sections[1].heading, 'First', 'editing the alias does not change its neighboring section');
  f.app.selectDocument('pages/empty.json');
  f.app.showPalette(); f.choose('text'); f.position('end'); f.add();
  await f.until(() => !f.doc.querySelector('#modal').open);
  assert.equal(f.savedDraft('pages/empty.json').sections.length, 1);
  assert.equal(f.savedDraft('pages/empty.json').published, false);
});

test('limits, cancellation, page switches and replaced draft versions never insert a stale section', async t => {
  const f = await fixture(t, { max: 2 });
  f.app.showPalette(); f.choose('text');
  assert.equal([...f.doc.querySelectorAll('#modal button')].find(button => button.textContent.trim() === 'Add section').disabled, true);
  assert.equal(f.savedDraft(), undefined);
  f.doc.querySelector('#modal').close();
  f.app.selectDocument('pages/empty.json'); f.app.showPalette(); f.choose('text');
  const oldButton = [...f.doc.querySelectorAll('#modal button')].find(button => button.textContent.trim() === 'Add section');
  f.app.selectDocument('home/home.json'); oldButton.click();
  assert.equal(f.savedDraft(), undefined); assert.equal(f.savedDraft('pages/empty.json'), undefined);
  assert.equal(f.doc.querySelector('#modal').open, false);
  f.app.selectDocument('pages/empty.json'); f.app.showPalette(); f.choose('text'); f.add();
  await f.until(() => !f.doc.querySelector('#modal').open);
  f.app.showPalette(); f.choose('text'); f.doc.querySelector('#undo').click();
  f.add();
  await f.until(() => f.doc.querySelector('#modal').textContent.includes('page changed'));
  assert.equal(f.savedDraft('pages/empty.json'), undefined);
  assert.equal(f.doc.querySelector('#modal').open, true);
});
