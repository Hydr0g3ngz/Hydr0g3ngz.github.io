import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { workspaceStorage } from '../studio/web/workspace-storage.js';

const built = await build({ entryPoints: ['studio/preview-bridge.js'], bundle: true, format: 'iife', platform: 'browser', write: false });
const bridgeScript = built.outputFiles[0].text;
const identity = { id: 'home/home.json', rev: 'a'.repeat(24) };

function preparePreview(window, data = { sections: [{ heading: 'First version' }] }, activeIdentity = identity, beforeBridge = () => {}) {
  const document = window.document;
  document.open();
  document.write('<!doctype html><html><body><section data-studio-block="0"><h2></h2></section></body></html>');
  document.close();
  document.querySelector('h2').textContent = data.sections[0].heading;
  const content = document.createElement('script');
  content.type = 'application/json'; content.id = 'studio-content-data';
  content.dataset.documentId = activeIdentity.id; content.dataset.previewRev = activeIdentity.rev;
  content.textContent = JSON.stringify(data); document.body.append(content);
  beforeBridge(document);
  window.eval(bridgeScript);
  return document.querySelector('h2');
}

function begin(window, element) { element.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true })); }
function type(window, element, value) { element.textContent = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); }

test('each inline edit gets fresh Escape rollback and removes old keyboard listeners', () => {
  const browser = new JSDOM('', { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
  const { window } = browser;
  const events = []; window.addEventListener('message', event => events.push(event.data));
  try {
    const element = preparePreview(window);
    begin(window, element); type(window, element, 'Committed once');
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(events.filter(event => event.type === 'edit').length, 1);
    begin(window, element); type(window, element, 'Cancel this second edit');
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(element.textContent, 'Committed once');
    assert.equal(events.filter(event => event.type === 'edit').length, 1);
    assert.equal(element.hasAttribute('contenteditable'), false);
    begin(window, element); type(window, element, 'Third edit');
    window.__willStudioInline.flush();
    assert.equal(events.filter(event => event.type === 'edit').length, 2);
    assert.equal(events.filter(event => event.type === 'edit').at(-1).value, 'Third edit');
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(element.textContent, 'Third edit');
  } finally { browser.window.close(); }
});

test('every paste in one inline session inserts plain text and never rich HTML', () => {
  const browser = new JSDOM('', { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
  const { window } = browser;
  try {
    const element = preparePreview(window); begin(window, element);
    const emptyPaste = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(emptyPaste, 'clipboardData', { value: { getData: () => '' } });
    element.dispatchEvent(emptyPaste);
    assert.equal(element.textContent, 'First version');
    for (const plain of ['A clean first paste ', '<img src=x onerror=alert(1)>', ' and a third']) {
      const event = new window.Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/plain' ? plain : '<img src=x onerror=alert(1)><b>Rich HTML</b>' } });
      assert.equal(element.dispatchEvent(event), false);
      assert.equal(element.children.length, 0);
    }
    assert.equal(element.textContent, 'A clean first paste <img src=x onerror=alert(1)> and a third');
    window.__willStudioInline.flush();
    assert.equal(element.querySelector('img'), null);
  } finally { browser.window.close(); }
});

test('IME confirmation Enter does not finish an inline edit; the subsequent Enter does', () => {
  const browser = new JSDOM('', { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
  const { window } = browser;
  const edits = []; window.addEventListener('message', event => { if (event.data.type === 'edit') edits.push(event.data); });
  try {
    const element = preparePreview(window); begin(window, element);
    element.dispatchEvent(new window.Event('compositionstart', { bubbles: true }));
    type(window, element, '新的想法');
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    assert.equal(window.__willStudioInline.active, true);
    assert.equal(edits.length, 0);
    element.dispatchEvent(new window.Event('compositionend', { bubbles: true }));
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(window.__willStudioInline.active, false);
    assert.equal(edits[0].value, '新的想法');
  } finally { browser.window.close(); }
});

test('only uniquely matched content paths become inline editable', () => {
  const browser = new JSDOM('', { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
  try {
    const element = preparePreview(browser.window, { sections: [{ heading: 'Shared words', summary: 'Shared words' }] });
    assert.equal(element.hasAttribute('data-studio-path'), false);
    begin(browser.window, element);
    assert.equal(element.hasAttribute('contenteditable'), false);
  } finally { browser.window.close(); }
});

test('reading navigation is not editable and cannot steal a matching content field', () => {
  const browser = new JSDOM('', { url: 'http://127.0.0.1:4310/preview/', runScripts: 'outside-only' });
  try {
    const { window } = browser;
    const element = preparePreview(window, undefined, identity, document => {
      const nav = document.createElement('nav'); nav.dataset.studioIgnore = '';
      const jump = document.createElement('a'); jump.textContent = 'First version'; jump.href = '#first'; nav.append(jump);
      document.querySelector('section').append(nav);
    });
    const jump = window.document.querySelector('nav a');
    assert.equal(jump.hasAttribute('data-studio-path'), false);
    assert.equal(element.dataset.studioPath, '["sections","0","heading"]');
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    jump.dispatchEvent(click); assert.equal(click.defaultPrevented, false, 'Native fragment navigation remains available in edit mode.');
    jump.dataset.studioPath = element.dataset.studioPath;
    begin(window, jump); assert.equal(jump.hasAttribute('contenteditable'), false, 'Even an already marked ignored navigation leaf is not editable.');
    begin(window, element); assert.equal(element.getAttribute('contenteditable'), 'true');
  } finally { browser.window.close(); }
});

test('real Studio page switch, Save locally and modal opening synchronously keep the last inline text', async () => {
  const html = await readFile(new URL('../studio/web/index.html', import.meta.url), 'utf8');
  const browser = new JSDOM(html, { url: 'http://127.0.0.1:4310/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = browser;
  const savedGlobals = new Map();
  for (const name of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'Element', 'Node']) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
  }
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const timers = new Set();
  globalThis.setTimeout = (callback, delay, ...args) => { const timer = originalSetTimeout(callback, delay, ...args); timers.add(timer); return timer; };
  const docs = [
    { id: identity.id, kind: 'home', name: 'Home', route: '/', revision: 'home-1', data: { title: 'Home', sections: [{ type: 'text', heading: 'First version' }] } },
    { id: 'pages/about.json', kind: 'page', name: 'About', route: '/about/', revision: 'about-1', data: { title: 'About', sections: [{ type: 'text', heading: 'About version' }] } }
  ];
  const workspace = { id: 'a'.repeat(24), project: { name: 'Test project' }, originalProject: false, launchpadUrl: 'http://127.0.0.1:4410' };
  const scopedStorage = workspaceStorage(window.localStorage, workspace.id);
  const requests = []; let previewNumber = 0; let saveGate;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, method: options.method });
    let response;
    if (url === '/api/state') response = { documents: structuredClone(docs), media: [], config: { content: [], components: {} }, token: 'test-session', workspace };
    else if (url === '/api/preview') { const rev = (++previewNumber).toString(16).padStart(24, '0'); response = { rev, url: `/preview/__studio/preview?rev=${rev}` }; }
    else if (url === '/api/document') { if (saveGate) await saveGate; const doc = docs.find(item => item.id === body.id); doc.data = body.data; doc.revision += '-saved'; response = { document: structuredClone(doc) }; }
    else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const delay = ms => new Promise(resolve => originalSetTimeout(resolve, ms));
  const waitForPreview = async previous => {
    for (let i = 0; i < 40; i++) { const src = window.document.querySelector('#preview').src; if (src !== previous && src.includes('rev=')) return; await delay(5); }
    throw new Error('Studio did not load a new test preview.');
  };
  const installCurrent = () => {
    const frame = window.document.querySelector('#preview');
    const request = requests.filter(item => item.url === '/api/preview').at(-1);
    const rev = new URL(frame.src).searchParams.get('rev');
    return { element: preparePreview(frame.contentWindow, request.body.data, { id: request.body.id, rev }), frame, rev };
  };
  try {
    const app = await import(`../studio/web/app.js?inline-regression=${Date.now()}`);
    await waitForPreview('about:blank');
    const chooser = window.document.querySelector('#workspace-launchpad');
    assert.equal(chooser.hidden, false); assert.equal(chooser.href, workspace.launchpadUrl + '/'); assert.equal(chooser.target, '_blank'); assert.match(chooser.rel, /noopener/);
    let { element, frame } = installCurrent();
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept before returning to project chooser');
    chooser.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(JSON.parse(scopedStorage.getItem(`will-studio-v1:${identity.id}`)).data.sections[0].heading, 'Kept before returning to project chooser');
    assert.equal(requests.filter(item => item.url === '/api/document').length, 0, 'Opening the chooser does not save or publish.');
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept when switching directly');
    assert.equal(window.document.querySelector('#save').disabled, false);
    const previous = frame.src;
    app.selectDocument('pages/about.json');
    const stored = JSON.parse(scopedStorage.getItem(`will-studio-v1:${identity.id}`));
    assert.equal(stored.data.sections[0].heading, 'Kept when switching directly');
    await waitForPreview(previous);
    ({ element, frame } = installCurrent());
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Saved final inline text');
    await app.save();
    const saveRequest = requests.filter(item => item.url === '/api/document').at(-1);
    assert.equal(saveRequest.body.id, 'pages/about.json');
    assert.equal(saveRequest.body.data.sections[0].heading, 'Saved final inline text');
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Submitted before a slow save');
    let releaseSave;
    saveGate = new Promise(resolve => { releaseSave = resolve; });
    const pendingSave = app.save();
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Typed while that save was running');
    releaseSave(); await pendingSave; saveGate = undefined;
    assert.equal(window.document.querySelector('#save').disabled, false);
    app.flushInlineEdit();
    assert.equal(JSON.parse(scopedStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Typed while that save was running');
    await app.save();
    assert.equal(requests.filter(item => item.url === '/api/document').at(-1).body.data.sections[0].heading, 'Typed while that save was running');
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept before opening a modal');
    app.openModal('Test action', window.document.createElement('div'));
    assert.equal(window.__willStudioInline?.active ?? frame.contentWindow.__willStudioInline.active, false);
    assert.equal(JSON.parse(scopedStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Kept before opening a modal');
    window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { source: 'will-studio-preview', id: 'pages/about.json', rev: 'wrong-revision', type: 'edit', path: ['sections', '0', 'heading'], value: 'Must be rejected' } }));
    assert.equal(JSON.parse(scopedStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Kept before opening a modal');
    window.document.querySelector('#modal').close();
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept before leaving Studio');
    const unload = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    assert.equal(JSON.parse(scopedStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Kept before leaving Studio');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
    browser.window.close();
    for (const [name, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});

test('real Studio search keeps inline edits, locates fields, preserves rich-text shortcuts and rejects stale navigation intents', async () => {
  const html = await readFile(new URL('../studio/web/index.html', import.meta.url), 'utf8');
  const browser = new JSDOM(html, { url: 'http://127.0.0.1:4310/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = browser;
  const savedGlobals = new Map();
  for (const name of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'Element', 'Node']) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
  }
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const timers = new Set();
  globalThis.setTimeout = (callback, delay, ...args) => { const timer = originalSetTimeout(callback, delay, ...args); timers.add(timer); return timer; };
  const workspace = { id: 'a'.repeat(24), project: { name: 'Test project' }, originalProject: false };
  const scopedStorage = workspaceStorage(window.localStorage, workspace.id);
  const targetId = 'pages/reading/deeper.json';
  const targetPath = ['sections', '0', 'cards', '0', 'title'];
  const docs = [
    { id: identity.id, kind: 'home', name: 'Home', route: '/', revision: 'home-1', data: { title: 'Home', sections: [{ type: 'text', heading: 'First version' }] } },
    { id: targetId, kind: 'page', name: 'A nested page', route: '/reading/deeper/', revision: 'page-1', data: { title: 'A nested page', sections: [{ type: 'text', heading: 'Books', cards: [{ title: 'A seed of an idea' }] }] } }
  ];
  const config = {
    content: [{ path: 'src/content/pages', type: 'collection', fields: [{ name: 'title', type: 'string' }] }],
    components: { text: { fields: [{ name: 'heading', type: 'string' }, { name: 'cards', type: 'object', list: true, fields: [{ name: 'title', type: 'string' }] }] } }
  };
  const requests = [];
  const stateLookups = [];
  let previewNumber = 0;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, options });
    let response;
    if (url === '/api/state') response = stateLookups.length ? await stateLookups.shift() : { documents: structuredClone(docs), media: [], config, token: 'test-session', workspace };
    else if (url === '/api/preview') { const rev = (++previewNumber).toString(16).padStart(24, '0'); response = { rev, url: `/preview/__studio/preview?rev=${rev}` }; }
    else if (url.startsWith('/api/search?')) {
      const query = new URL(url, window.location.origin).searchParams.get('q');
      response = { results: [{ id: targetId, kind: 'page', title: 'A nested page', route: '/reading/deeper/', path: query === 'title' ? ['title'] : targetPath, ...(query === 'title' ? {} : { sectionIndex: 0 }), excerpt: query === 'title' ? 'A nested page' : 'A seed of an idea', matchStart: 2, matchEnd: 6, published: true }], total: 1, truncated: false };
    } else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  const delay = ms => new Promise(resolve => originalSetTimeout(resolve, ms));
  const until = async check => { for (let count = 0; count < 100; count++) { if (check()) return; await delay(5); } throw new Error('Expected Studio state did not arrive.'); };
  const key = (target, key, extra = {}) => { const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }); target.dispatchEvent(event); return event; };
  try {
    const app = await import(`../studio/web/app.js?search-regression=${Date.now()}`);
    const doc = window.document;
    await until(() => doc.querySelector('#preview').src.includes('rev='));
    const frame = doc.querySelector('#preview');
    const request = requests.filter(item => item.url === '/api/preview').at(-1);
    const rev = new URL(frame.src).searchParams.get('rev');
    const heading = preparePreview(frame.contentWindow, request.body.data, { id: identity.id, rev });
    begin(frame.contentWindow, heading); type(frame.contentWindow, heading, 'Keep these words before searching');
    const launch = doc.querySelector('#commands'); launch.focus(); launch.click();
    assert.equal(frame.contentWindow.__willStudioInline.active, false);
    assert.equal(JSON.parse(scopedStorage.getItem(`will-studio-v1:${identity.id}`)).data.sections[0].heading, 'Keep these words before searching');
    assert.equal(window.localStorage.getItem(`will-studio-v1:${identity.id}`), null, 'new edits never use the legacy cross-project key');
    const palette = doc.querySelector('.command-dialog');
    const searchInput = palette.querySelector('[role="combobox"]');
    assert.equal(palette.open, true);
    searchInput.value = 'seed'; searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await until(() => palette.querySelector('.command-option-excerpt mark')?.textContent === 'seed');
    const searchRequest = requests.find(item => item.url === '/api/search?q=seed');
    assert.equal(searchRequest.options.headers['x-studio-token'], 'test-session');
    key(searchInput, 'Enter');
    await until(() => doc.querySelector('#page-name').textContent === 'A nested page' && doc.querySelector('.field-highlight'));
    assert.equal(palette.open, false);
    const field = [...doc.querySelectorAll('#inspector [data-field-path]')].find(node => node.dataset.fieldPath === JSON.stringify(targetPath));
    assert.ok(field.classList.contains('field-highlight'));
    assert.equal(field.querySelector('input').value, 'A seed of an idea');
    let parent = field.parentElement;
    while (parent && parent.id !== 'inspector') { if (parent.tagName === 'DETAILS') assert.equal(parent.open, true); parent = parent.parentElement; }
    assert.ok(scrolled.includes(field));
    assert.ok(doc.querySelector('#structure-tab').classList.contains('active'));

    // A top-level title result should open Page details, not a nonexistent section.
    key(doc.body, 'k', { ctrlKey: true });
    searchInput.value = 'title'; searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await until(() => requests.some(item => item.url === '/api/search?q=title') && palette.dataset.state === 'ready');
    palette.querySelector('[role="option"]').click();
    await until(() => doc.querySelector('#details-tab').classList.contains('active'));
    assert.equal(doc.querySelector('.field-highlight').dataset.fieldPath, '["title"]');

    // The host shortcut must not override the link shortcut inside a rich writer.
    const writer = doc.createElement('div'); writer.className = 'studio-writer';
    const writerInput = doc.createElement('textarea'); writer.append(writerInput); doc.body.append(writer);
    writerInput.focus();
    assert.equal(key(writerInput, 'k', { metaKey: true }).defaultPrevented, false);
    assert.equal(palette.open, false);
    assert.equal(key(doc.body, 'k', { ctrlKey: true }).defaultPrevented, true);
    assert.equal(palette.open, true);
    key(searchInput, 'Escape');
    assert.equal(doc.activeElement, writerInput);

    // Search may find a just-created page that is not in the app's loaded list.
    // Its slow lookup must not override a later sidebar choice or search intent.
    const newDocument = (slug, title) => ({ id: `pages/${slug}.json`, kind: 'page', name: title, route: `/${slug}/`, revision: `${slug}-1`, data: { title, sections: [{ type: 'text', heading: title }] } });
    const lookupGate = (...newDocuments) => {
      let release;
      stateLookups.push(new Promise(resolve => { release = () => resolve({ documents: structuredClone([...docs, ...newDocuments]), media: [], config, token: 'test-session', workspace }); }));
      return release;
    };
    const late = newDocument('late-result', 'A slow result');
    const releaseLate = lookupGate(late);
    const lateLookup = app.openSearchDocument(late.id);
    app.selectDocument(identity.id);
    releaseLate();
    assert.equal(await lateLookup, false);
    assert.equal(doc.querySelector('#page-name').textContent, 'Home');
    assert.equal([...doc.querySelectorAll('.page-label')].some(label => label.textContent === late.name), false);

    for (const responseOrder of ['older-first', 'newer-first']) {
      const older = newDocument(`${responseOrder}-older`, `${responseOrder} older`);
      const newer = newDocument(`${responseOrder}-newer`, `${responseOrder} newer`);
      const releaseOlder = lookupGate(older, newer);
      const releaseNewer = lookupGate(older, newer);
      const priorPage = doc.querySelector('#page-name').textContent;
      const olderLookup = app.openSearchDocument(older.id);
      const newerLookup = app.openSearchDocument(newer.id);
      if (responseOrder === 'older-first') {
        releaseOlder();
        assert.equal(await olderLookup, false);
        assert.equal(doc.querySelector('#page-name').textContent, priorPage, 'a newer pending intent already supersedes the old result');
        releaseNewer();
        assert.equal(await newerLookup, true);
      } else {
        releaseNewer();
        assert.equal(await newerLookup, true);
        releaseOlder();
        assert.equal(await olderLookup, false);
      }
      assert.equal(doc.querySelector('#page-name').textContent, newer.name);
      assert.equal([...doc.querySelectorAll('.page-label')].some(label => label.textContent === older.name), false);
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
    browser.window.close();
    for (const [name, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
