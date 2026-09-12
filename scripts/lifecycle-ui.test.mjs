import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLifecycle } from '../studio/web/lifecycle.js';

function fixture({ dirty = [], orphans = [], blocked = false, kind = 'page', id, applyDelay, inspectionDirty = [] } = {}) {
  const dom = new JSDOM('<main></main>'); const { document, Node } = dom.window;
  const node = (tag, attrs = {}, children = []) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') el.textContent = value;
      else if (key === 'on') for (const [event, handler] of Object.entries(value)) el.addEventListener(event, handler);
      else if (key === 'disabled') el.disabled = value;
      else if (key === 'value') el.value = value;
      else el.setAttribute(key === 'class' ? 'class' : key, value);
    }
    for (const child of [children].flat(Infinity)) if (child != null) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return el;
  };
  const button = (text, action, attrs = {}) => node('button', { type: 'button', text, on: { click: action }, ...attrs });
  const calls = [], notices = [];
  const doc = { id: id || (kind === 'home' ? 'home/home.json' : 'pages/testing.json'), kind, route: '/testing', name: 'Testing', revision: '123', data: { title: 'Testing' } };
  const fixture = { document, calls, notices, dirty, orphans, applied: 0, close: () => dom.window.close() };
  fixture.ui = createLifecycle({ node, button,
    api: async (url, method, payload) => {
      calls.push({ url, method, payload });
      if (url === '/api/lifecycle/plan') return { planId: 'abc', summary: 'Delete Testing', changes: [{ id: doc.id, action: 'remove', detail: 'Move to trash' }], references: blocked ? [{ id: 'pages/other.json', path: 'body', href: '/testing', public: true }] : [], blocked };
      if (url === '/api/trash') return [{ trashId: 'trash123', id: doc.id, name: doc.name, route: doc.route, deletedAt: new Date().toISOString() }];
      if (url.endsWith('/apply') && applyDelay) await applyDelay;
      return { documents: [] };
    },
    openModal: (title, content) => document.querySelector('main').replaceChildren(node('h1', { text: title }), content),
    closeModal: () => {}, toast: (...args) => notices.push(args), currentDoc: () => doc,
    dirtyIds: () => fixture.dirty, orphanIds: () => fixture.orphans,
    archiveOrphans: async ids => { calls.push({ url: 'archive-orphans', payload: ids }); fixture.orphans = []; fixture.dirty = fixture.dirty.filter(id => !ids.includes(id)); return { archivedIds: ids, preservedIds: [] }; },
    beforeApply: () => ({ dirtyIds: inspectionDirty }), onApplied: async () => { fixture.applied++; }
  });
  fixture.click = (text) => { const el = [...document.querySelectorAll('button')].find(button => button.textContent === text); assert(el, text); el.click(); return el; };
  return fixture;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('page lifecycle blocks destructive apply for linked references and dirty drafts', async t => {
  for (const options of [{ blocked: true }, { dirty: ['pages/testing.json'] }]) {
    const f = fixture(options); t.after(f.close); f.ui.showActions(); f.click('Move to trash'); await settle();
    assert.equal(f.click('Move to trash').disabled, true);
    assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 0);
  }
});
test('new browser edits after a reviewed plan are checked again before apply', async t => {
  const f = fixture(); t.after(f.close); f.ui.showActions(); f.click('Move to trash'); await settle();
  f.dirty = ['pages/testing.json']; f.click('Move to trash'); await settle();
  assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 0);
  assert(f.notices[0][0].includes('browser draft has changed'));
});
test('page lifecycle applies only the reviewed plan and core controls stay disabled', async t => {
  const f = fixture(); t.after(f.close); f.ui.showActions(); f.click('Move to trash'); await settle();
  f.click('Move to trash'); await settle();
  assert.deepEqual(f.calls.at(-1).payload, { planId: 'abc' }); assert.equal(f.applied, 1);
  const core = fixture({ kind: 'home' }); t.after(core.close); core.ui.showActions();
  assert([...core.document.querySelectorAll('button')].every(button => button.disabled));
});
test('trash restore always goes through a new review', async t => {
  const f = fixture(); t.after(f.close); await f.ui.showTrash(); f.click('Review restore'); await settle();
  assert.deepEqual(f.calls.at(-1).payload, { operation: 'restore', trashId: 'trash123' });
  assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 0);
});

test('Cancel, Escape, and the heading close button are locked while apply is pending', async t => {
  let release;
  const f = fixture({ applyDelay: new Promise(resolve => { release = resolve; }) }); t.after(f.close);
  const dialog = f.document.createElement('dialog');
  const headingClose = f.document.createElement('button'); headingClose.textContent = 'Heading close';
  const main = f.document.querySelector('main');
  f.document.body.append(dialog); dialog.append(headingClose, main);
  f.ui.showActions(); f.click('Move to trash'); await settle(); f.click('Move to trash'); await settle();
  assert.equal(headingClose.disabled, true);
  assert.equal(f.click('Cancel').disabled, true);
  const cancel = new f.document.defaultView.Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(dialog.getAttribute('aria-busy'), 'true');
  release(); await settle();
  assert.equal(headingClose.disabled, false);
  assert.equal(dialog.hasAttribute('aria-busy'), false);
  const after = new f.document.defaultView.Event('cancel', { cancelable: true }); dialog.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});

test('About can be copied safely while its own address and deletion remain protected', t => {
  const f = fixture({ id: 'pages/about.json' }); t.after(f.close); f.ui.showActions();
  assert.equal(f.click('Move / change address').disabled, true);
  assert.equal(f.click('Move to trash').disabled, true);
  const copy = [...f.document.querySelectorAll('button')].find(button => button.textContent === 'Duplicate as a draft');
  assert.equal(copy.disabled, false);
});

test('a draft appearing during final inspection prevents apply', async t => {
  const f = fixture({ inspectionDirty: ['pages/testing.json'] }); t.after(f.close);
  f.ui.showActions(); f.click('Move to trash'); await settle(); f.click('Move to trash'); await settle();
  assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 0);
  assert.ok(f.notices[0][0].includes('Another browser draft changed'));
});

test('orphan drafts have an explicit recovery action followed by a fresh review', async t => {
  const f = fixture({ dirty: ['pages/testing.json'], orphans: ['pages/testing.json'] }); t.after(f.close);
  await f.ui.showTrash(); f.click('Review restore'); await settle();
  assert.equal(f.click('Apply local changes').disabled, true);
  assert.ok(f.document.body.textContent.includes('After restoring or recreating the page, open History'));
  f.click('Keep browser draft in History and review again'); await settle();
  assert.deepEqual(f.calls.find(call => call.url === 'archive-orphans').payload, ['pages/testing.json']);
  assert.equal(f.calls.filter(call => call.url.endsWith('/plan')).length, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith('/apply')).length, 0);
  assert.equal([...f.document.querySelectorAll('button')].find(button => button.textContent === 'Apply local changes').disabled, false);
});

test('ordinary existing-page drafts are directed to save instead of orphan archival', async t => {
  const f = fixture({ dirty: ['pages/testing.json'] }); t.after(f.close);
  f.ui.showActions(); f.click('Move to trash'); await settle();
  assert.ok(f.document.body.textContent.includes('Save or review these browser drafts first'));
  assert.equal([...f.document.querySelectorAll('button')].some(button => button.textContent.includes('Keep browser draft in History')), false);
});
