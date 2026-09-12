import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['studio/preview-bridge.js'], bundle: true, format: 'iife', platform: 'browser', write: false });
const bridgeScript = built.outputFiles[0].text;
const identity = { id: 'home/home.json', rev: 'a'.repeat(24) };

function preparePreview(window, data = { sections: [{ heading: 'First version' }] }, activeIdentity = identity) {
  const document = window.document;
  document.open();
  document.write('<!doctype html><html><body><section data-studio-block="0"><h2></h2></section></body></html>');
  document.close();
  document.querySelector('h2').textContent = data.sections[0].heading;
  const content = document.createElement('script');
  content.type = 'application/json'; content.id = 'studio-content-data';
  content.dataset.documentId = activeIdentity.id; content.dataset.previewRev = activeIdentity.rev;
  content.textContent = JSON.stringify(data); document.body.append(content);
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
  const requests = []; let previewNumber = 0; let saveGate;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, method: options.method });
    let response;
    if (url === '/api/state') response = { documents: structuredClone(docs), media: [], config: { content: [], components: {} }, token: 'test-session' };
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
    let { element, frame } = installCurrent();
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept when switching directly');
    assert.equal(window.document.querySelector('#save').disabled, false);
    const previous = frame.src;
    app.selectDocument('pages/about.json');
    const stored = JSON.parse(window.localStorage.getItem(`will-studio-v1:${identity.id}`));
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
    assert.equal(JSON.parse(window.localStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Typed while that save was running');
    await app.save();
    assert.equal(requests.filter(item => item.url === '/api/document').at(-1).body.data.sections[0].heading, 'Typed while that save was running');
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept before opening a modal');
    app.openModal('Test action', window.document.createElement('div'));
    assert.equal(window.__willStudioInline?.active ?? frame.contentWindow.__willStudioInline.active, false);
    assert.equal(JSON.parse(window.localStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Kept before opening a modal');
    window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { source: 'will-studio-preview', id: 'pages/about.json', rev: 'wrong-revision', type: 'edit', path: ['sections', '0', 'heading'], value: 'Must be rejected' } }));
    assert.equal(JSON.parse(window.localStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Kept before opening a modal');
    window.document.querySelector('#modal').close();
    begin(frame.contentWindow, element); type(frame.contentWindow, element, 'Kept before leaving Studio');
    const unload = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    assert.equal(JSON.parse(window.localStorage.getItem('will-studio-v1:pages/about.json')).data.sections[0].heading, 'Kept before leaving Studio');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
    browser.window.close();
    for (const [name, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
