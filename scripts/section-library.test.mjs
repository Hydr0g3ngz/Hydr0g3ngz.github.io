import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mountSectionLibrary } from '../studio/web/section-library.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const entries = [
  { type: 'text', label: 'Text', description: 'A heading and a few paragraphs.' },
  { type: 'list', label: 'Collection', description: 'A collection of repeated cards.' },
  { type: 'profile', label: 'Profile', description: 'A small personal introduction.' },
  { type: 'new_layout', label: '实验布局', description: 'An unfamiliar layout supplied by this project.' }
];
const positions = [{ value: 'after:selected', label: 'After the selected section' }, { value: 'end', label: 'At the end' }, { value: 0, label: 'At the beginning' }];

function setup(t, options = {}) {
  const browser = new JSDOM('<!doctype html><body><div id="modal-content"><span id="host-owned">Host content</span></div></body>', { pretendToBeVisual: true, runScripts: 'dangerously' });
  const doc = browser.window.document, container = doc.querySelector('#modal-content'), calls = [];
  const api = mountSectionLibrary({ container, entries, positions, defaultPosition: 'end', onInsert: value => calls.push(value), ...options });
  const root = container.querySelector('.sl-root'), search = root.querySelector('[aria-label="Search section layouts"]'), position = root.querySelector('[aria-label="Insert position"]'), add = root.querySelector('[aria-label="Add section"]');
  const card = type => [...root.querySelectorAll('[role="radio"]')].find(node => node.dataset.sectionType === type);
  const type = value => { search.value = value; search.dispatchEvent(new browser.window.Event('input', { bubbles: true })); };
  const key = (node, value, extra = {}) => { const event = new browser.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }); node.dispatchEvent(event); return event; };
  const setPosition = index => { position.value = String(index); position.dispatchEvent(new browser.window.Event('change', { bubbles: true })); };
  t.after(() => { api.destroy(); browser.window.close(); });
  return { browser, doc, container, root, search, position, add, card, type, key, setPosition, api, calls };
}

test('a card only selects a layout; Add uses the host position and does not close the host container', async t => {
  const ui = setup(t);
  assert.equal(ui.add.disabled, true);
  assert.equal(ui.position.selectedOptions[0].textContent, 'At the end');
  ui.card('text').click();
  assert.deepEqual(ui.calls, []);
  assert.equal(ui.card('text').getAttribute('aria-checked'), 'true');
  assert.equal(ui.root.querySelector('.sl-description h3').textContent, 'Text');
  assert.equal(ui.root.querySelector('.sl-description p').textContent, entries[0].description);
  assert.equal(ui.add.disabled, false);
  ui.setPosition(2); ui.add.click(); await pause();
  assert.deepEqual(ui.calls, [{ type: 'text', position: 0 }], 'numeric host positions remain numeric');
  assert.equal(ui.root.isConnected, true);
  assert.equal(ui.doc.querySelector('#host-owned').textContent, 'Host content');
  assert.equal(ui.add.disabled, true);
  ui.add.click(); assert.equal(ui.calls.length, 1, 'completed insert is not replayed');
});

test('categories, literal Unicode search, and unknown types remain discoverable without discarding a selection', t => {
  const ui = setup(t);
  assert.deepEqual([...ui.root.querySelectorAll('.sl-filter')].map(node => node.textContent), ['All', 'Basics', 'Collections', 'Personal', 'Other']);
  ui.card('text').click(); ui.setPosition(0);
  ui.root.querySelector('[data-category="Other"]').click();
  assert.equal(ui.root.querySelectorAll('.sl-card').length, 1);
  assert.ok(ui.card('new_layout'));
  assert.equal(ui.add.disabled, true, 'a filtered-out selection cannot be inserted accidentally');
  assert.equal(ui.root.querySelector('.sl-hidden-choice').hidden, false);
  ui.root.querySelector('.sl-clear').click();
  assert.equal(ui.card('text').getAttribute('aria-checked'), 'true');
  assert.equal(ui.position.value, '0');
  ui.type('ｔＥＸＴ');
  assert.equal(ui.root.querySelectorAll('.sl-card').length, 1); assert.ok(ui.card('text'));
  ui.type('new_layout');
  assert.ok(ui.card('new_layout'));
  ui.type('[.*');
  assert.equal(ui.root.querySelector('.sl-empty').hidden, false);
  assert.match(ui.root.querySelector('.sl-empty').textContent, /No layouts match/);
  assert.equal(ui.add.disabled, true);
});

test('hostile labels, types, descriptions, positions and restriction text never become HTML or network assets', t => {
  const attack = '<img src=x onerror="window.attacked=true"><script>window.attacked=true</script>';
  const ui = setup(t, { entries: [{ type: attack, label: attack, description: attack }, { type: '__proto__', label: 'Prototype-shaped custom type', description: 'Still a plain entry.' }], positions: [{ value: attack, label: attack }], disabledReason: attack });
  ui.card(attack).click();
  assert.equal(ui.root.querySelector('img,script,iframe,svg,canvas'), null);
  assert.equal(ui.browser.window.attacked, undefined);
  assert.equal(ui.root.querySelector('.sl-description h3').textContent, attack);
  assert.equal(ui.root.querySelector('.sl-limit').textContent, attack);
  assert.equal(ui.position.selectedOptions[0].textContent, attack);
  assert.equal(ui.card(attack).dataset.sectionType, attack);
  assert.ok(ui.card('__proto__').querySelector('.sl-sketch-custom'));
  assert.equal(ui.add.disabled, true);
  assert.match(ui.root.querySelector('.sl-sketch-note').textContent, /sketches only/);
  assert.match(ui.root.querySelector('.sl-sketch-note').textContent, /real page preview/);
});

test('no entries, no positions, explicit limits and missing host insertion all have safe disabled states', async t => {
  await t.test('empty library', t => {
    const ui = setup(t, { entries: [] });
    assert.match(ui.root.querySelector('.sl-empty').textContent, /No section layouts/);
    assert.equal(ui.add.disabled, true); assert.equal(ui.search.disabled, true);
    ui.api.focus(); assert.equal(ui.doc.activeElement, ui.root.querySelector('.sl-empty'));
  });
  await t.test('no positions', t => {
    const ui = setup(t, { positions: [] }); ui.card('text').click();
    assert.match(ui.root.querySelector('.sl-limit').textContent, /No insertion positions/);
    assert.equal(ui.position.disabled, true); assert.equal(ui.add.disabled, true);
  });
  await t.test('maximum reached', t => {
    const ui = setup(t, { disabledReason: 'This page already has its maximum number of sections.' }); ui.card('text').click();
    assert.equal(ui.root.querySelector('.sl-limit').hidden, false); assert.equal(ui.add.disabled, true);
    ui.add.click(); assert.deepEqual(ui.calls, []);
  });
  await t.test('no insertion callback', t => {
    const ui = setup(t, { onInsert: undefined }); ui.card('text').click();
    assert.match(ui.root.querySelector('.sl-limit').textContent, /unavailable/); assert.equal(ui.add.disabled, true);
  });
});

test('false or thrown insertion preserves the exact selected layout and position for retry', async t => {
  let attempt = 0;
  const payloads = [];
  const ui = setup(t, { onInsert: async payload => { payloads.push(payload); attempt++; if (attempt === 1) return false; if (attempt === 2) throw new Error('Choose an image first <img src=x>'); return true; } });
  ui.card('profile').click(); ui.setPosition(0); ui.add.click(); await pause();
  assert.match(ui.root.querySelector('.sl-status').textContent, /No section was added/);
  assert.equal(ui.card('profile').getAttribute('aria-checked'), 'true'); assert.equal(ui.position.value, '0'); assert.equal(ui.add.disabled, false);
  ui.add.click(); await pause();
  assert.match(ui.root.querySelector('.sl-status').textContent, /Choose an image first <img src=x>/);
  assert.equal(ui.root.querySelector('.sl-status img'), null);
  assert.equal(ui.root.querySelector('.sl-status').classList.contains('sl-error'), true);
  assert.equal(ui.card('profile').getAttribute('aria-checked'), 'true'); assert.equal(ui.position.value, '0'); assert.equal(ui.add.disabled, false);
  ui.add.click(); await pause();
  assert.equal(ui.add.disabled, true); assert.match(ui.root.querySelector('.sl-status').textContent, /Section added/);
  assert.deepEqual(payloads, Array.from({ length: 3 }, () => ({ type: 'profile', position: 'after:selected' })));
});

test('busy insertion is single-flight and a destroyed instance cannot mutate its replacement', async t => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  let calls = 0;
  const ui = setup(t, { onInsert: () => { calls++; return pending; } });
  ui.card('text').click(); ui.add.click(); ui.add.click();
  assert.equal(calls, 1); assert.equal(ui.root.getAttribute('aria-busy'), 'true');
  for (const control of ui.root.querySelectorAll('input,select,button')) assert.equal(control.disabled, true);
  const oldCard = ui.card('text');
  ui.api.destroy();
  const replacement = mountSectionLibrary({ container: ui.container, entries, positions, onInsert: () => assert.fail('old events must not invoke a new instance') });
  try {
    const newRoot = ui.container.querySelector('.sl-root'); const before = newRoot.textContent;
    resolve(false); await pause(); oldCard.click(); ui.type('new_layout'); ui.add.click();
    assert.equal(newRoot.textContent, before); assert.equal(calls, 1);
    assert.equal(ui.container.querySelectorAll('.sl-root').length, 1);
    assert.equal(ui.doc.querySelector('#host-owned').isConnected, true);
  } finally { replacement.destroy(); }
});

test('radio keyboard navigation selects only; Escape belongs to the host and focus begins in search', t => {
  const ui = setup(t); ui.api.focus(); assert.equal(ui.doc.activeElement, ui.search);
  ui.key(ui.search, 'ArrowDown'); assert.equal(ui.doc.activeElement, ui.card('text'));
  assert.equal(ui.card('text').getAttribute('aria-checked'), 'false');
  ui.key(ui.card('text'), 'ArrowRight'); assert.equal(ui.doc.activeElement, ui.card('list'));
  assert.equal(ui.card('list').getAttribute('aria-checked'), 'true');
  ui.key(ui.card('list'), 'Enter'); ui.key(ui.card('list'), ' '); assert.deepEqual(ui.calls, []);
  ui.key(ui.card('list'), 'End'); assert.equal(ui.doc.activeElement, ui.card('new_layout'));
  ui.key(ui.card('new_layout'), 'ArrowDown'); assert.equal(ui.doc.activeElement, ui.card('text'));
  ui.key(ui.card('text'), 'Home'); assert.equal(ui.doc.activeElement, ui.card('text'));
  let escaped = false;
  ui.doc.addEventListener('keydown', event => { if (event.key === 'Escape') escaped = true; });
  assert.equal(ui.key(ui.card('text'), 'Escape').defaultPrevented, false); assert.equal(escaped, true);
  assert.equal(ui.root.isConnected, true);
  assert.equal(ui.root.querySelectorAll('[role="radio"][tabindex="0"]').length, 1);
});

test('IME search waits for committed input and confirmation Enter never inserts a section', t => {
  const ui = setup(t); ui.card('text').click(); ui.search.focus();
  ui.search.dispatchEvent(new ui.browser.window.CompositionEvent('compositionstart', { bubbles: true }));
  ui.type('实验');
  assert.equal(ui.root.querySelectorAll('.sl-card').length, 4);
  assert.equal(ui.add.disabled, true);
  assert.equal(ui.key(ui.search, 'Enter', { isComposing: true }).defaultPrevented, false, 'IME confirmation is not cancelled');
  ui.add.click(); assert.deepEqual(ui.calls, []);
  ui.search.dispatchEvent(new ui.browser.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(ui.root.querySelectorAll('.sl-card').length, 1); assert.ok(ui.card('new_layout'));
  ui.card('new_layout').click(); assert.equal(ui.add.disabled, false);
  ui.key(ui.search, 'Enter'); assert.deepEqual(ui.calls, []);
});

test('all built-in sketches are inert, IDs stay unique across instances, and entry inputs are snapshotted', async t => {
  const types = ['hero', 'text', 'image_text', 'quote', 'marquee', 'closing', 'list', 'reading', 'listening', 'shelf', 'profile', 'work'];
  const supplied = types.map(type => ({ type, label: type, description: 'A layout sketch.' }));
  const places = [{ value: 'end', label: 'End' }];
  const ui = setup(t, { entries: [...supplied, supplied[0], { type: '', label: 'Invalid' }], positions: places, defaultPosition: 'missing' });
  assert.equal(ui.root.querySelectorAll('.sl-card').length, types.length);
  for (const type of types) assert.equal(ui.card(type).querySelector('.sl-sketch').getAttribute('aria-hidden'), 'true');
  assert.equal(ui.root.querySelector('img,iframe,svg,canvas'), null);
  assert.equal(ui.card('hero').querySelector('.sl-picture,.sl-avatar'), null);
  assert.ok(ui.card('hero').querySelector('.sl-small-button'));
  assert.equal(ui.card('profile').querySelector('.sl-picture,.sl-avatar,.sl-small-button'), null);
  assert.equal(ui.card('profile').querySelectorAll('.sl-profile-fact').length, 3);
  assert.equal(ui.card('closing').querySelector('.sl-small-button,.sl-picture,.sl-avatar'), null);
  assert.ok(ui.card('closing').querySelector('.sl-line-heading'));
  supplied[0].type = 'changed'; places[0].value = 'changed';
  ui.card('hero').click(); ui.add.click(); await pause();
  assert.deepEqual(ui.calls, [{ type: 'hero', position: 'end' }]);
  const other = mountSectionLibrary({ container: ui.container, entries, positions, onInsert() {} });
  try {
    const ids = [...ui.container.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const label of ui.container.querySelectorAll('label[for]')) assert.ok(ui.doc.getElementById(label.htmlFor));
    ui.api.destroy(); other.focus();
    assert.equal(ui.doc.activeElement, ui.container.querySelector('.sl-search'));
  } finally { other.destroy(); }
});

test('a host may close and destroy synchronously inside a successful insertion callback', async t => {
  let api;
  const ui = setup(t, { onInsert() { api.destroy(); return true; } }); api = ui.api;
  ui.card('text').click(); ui.add.click(); await pause();
  assert.equal(ui.root.isConnected, false);
  assert.equal(ui.container.querySelector('.sl-root'), null);
  assert.equal(ui.doc.querySelector('#host-owned').isConnected, true);
});
