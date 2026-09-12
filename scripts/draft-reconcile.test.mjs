import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveOrphanBrowserDrafts, inspectBrowserDrafts, reconcileLifecycleDrafts, browserDraftKey, recoveryKey } from '../studio/web/draft-reconcile.js';

class Storage {
  map = new Map();
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
const doc = (id, value = 'Saved', revision = 'one') => ({ id, revision, data: { title: value } });
const memory = (document, value = document.data.title) => ({ data: { title: value }, saved: JSON.stringify(document.data), revision: document.revision, undo: [], redo: [], conflict: false });
const putDraft = (storage, id, value, revision = 'one') => storage.setItem(browserDraftKey(id), JSON.stringify({ data: { title: value }, revision }));
const inspect = (ids, documents, drafts, storage) => inspectBrowserDrafts({ ids, documents, drafts, storage });

test('dirty inspection sees orphan drafts and another tab even when memory is clean', () => {
  const current = doc('pages/current.json');
  const storage = new Storage();
  const drafts = new Map([[current.id, memory(current)]]);
  putDraft(storage, current.id, 'Other tab work');
  putDraft(storage, 'pages/removed.json', 'Orphan draft');
  assert.deepEqual(inspect([current.id, 'pages/removed.json'], [current], drafts, storage).dirtyIds, [current.id, 'pages/removed.json']);
});

test('an unrelated newer disk version never discards its dirty browser draft', () => {
  const current = doc('pages/reading.json');
  const unrelated = doc('pages/about.json');
  const next = doc(unrelated.id, 'Changed externally', 'two');
  const storage = new Storage();
  putDraft(storage, unrelated.id, 'Unsaved introduction');
  const drafts = new Map([[current.id, memory(current)], [unrelated.id, memory(unrelated, 'Unsaved introduction')]]);
  const inspection = inspect([current.id, 'pages/library.json'], [current, unrelated], drafts, storage);
  const result = reconcileLifecycleDrafts({ previousDocuments: [current, unrelated], nextDocuments: [doc('pages/library.json'), next], changedIds: [current.id, 'pages/library.json'], inspection, drafts, storage, oldId: current.id, newId: 'pages/library.json' });
  assert.equal(drafts.get(unrelated.id).data.title, 'Unsaved introduction');
  assert.equal(drafts.get(unrelated.id).conflict, true);
  assert.equal(JSON.parse(storage.getItem(browserDraftKey(unrelated.id))).data.title, 'Unsaved introduction');
  assert.deepEqual(result.conflicts, [unrelated.id]);
});

test('only reviewed changed IDs can be cleared, even if a response lists more changes', () => {
  const a = doc('pages/a.json'), b = doc('pages/b.json');
  const storage = new Storage();
  const drafts = new Map([[a.id, memory(a)], [b.id, memory(b, 'Keep me')]]);
  const inspection = inspect([a.id], [a, b], drafts, storage);
  reconcileLifecycleDrafts({ previousDocuments: [a, b], nextDocuments: [doc(a.id, 'New', 'two'), b], changedIds: [a.id, b.id], inspection, drafts, storage, oldId: a.id, newId: a.id });
  assert.equal(drafts.get(b.id).data.title, 'Keep me');
  assert.equal(drafts.has(a.id), false);
});

test('late edits during a move are recovered under the new ID and newer storage survives', () => {
  const old = doc('pages/old.json');
  const next = doc('pages/new.json', 'Moved', 'two');
  const storage = new Storage();
  const drafts = new Map([[old.id, memory(old)]]);
  const inspection = inspect([old.id, next.id], [old], drafts, storage);
  drafts.get(old.id).data.title = 'Late typing';
  putDraft(storage, old.id, 'Late typing');
  const raw = storage.getItem(browserDraftKey(old.id));
  const result = reconcileLifecycleDrafts({ previousDocuments: [old], nextDocuments: [next], changedIds: [old.id, next.id], inspection, drafts, storage, oldId: old.id, newId: next.id, now: () => 123 });
  assert.equal(JSON.parse(storage.getItem(recoveryKey(next.id)))[0].data.title, 'Late typing');
  assert.equal(storage.getItem(browserDraftKey(old.id)), raw);
  assert.deepEqual(result.recovered, [next.id]);
  assert.deepEqual(result.preservedStorage, [old.id]);
});

test('late trash edits stay recoverable at their original ID for a later restore', () => {
  const old = doc('pages/removed.json');
  const storage = new Storage();
  const drafts = new Map([[old.id, memory(old)]]);
  const inspection = inspect([old.id], [old], drafts, storage);
  drafts.get(old.id).data.title = 'Do not lose these words';
  reconcileLifecycleDrafts({ previousDocuments: [old], nextDocuments: [], changedIds: [old.id], inspection, drafts, storage, oldId: old.id, newId: null });
  assert.equal(JSON.parse(storage.getItem(recoveryKey(old.id)))[0].data.title, 'Do not lose these words');
});

test('restore cannot erase a new orphan draft that appeared after review', () => {
  const restored = doc('pages/restored.json', 'Restored file');
  const storage = new Storage();
  const drafts = new Map();
  const inspection = inspect([restored.id], [], drafts, storage);
  putDraft(storage, restored.id, 'Another session’s recovered draft');
  const raw = storage.getItem(browserDraftKey(restored.id));
  reconcileLifecycleDrafts({ previousDocuments: [], nextDocuments: [restored], changedIds: [restored.id], inspection, drafts, storage, oldId: restored.id, newId: restored.id });
  assert.equal(storage.getItem(browserDraftKey(restored.id)), raw);
  assert.equal(JSON.parse(storage.getItem(recoveryKey(restored.id)))[0].data.title, 'Another session’s recovered draft');
});

test('storage failure preserves the active late draft instead of silently clearing it', () => {
  const current = doc('pages/current.json');
  const storage = new Storage();
  const drafts = new Map([[current.id, memory(current)]]);
  const inspection = inspect([current.id], [current], drafts, storage);
  drafts.get(current.id).data.title = 'Late words';
  storage.setItem = () => { throw new Error('Storage is full'); };
  assert.throws(() => reconcileLifecycleDrafts({ previousDocuments: [current], nextDocuments: [], changedIds: [current.id], inspection, drafts, storage, oldId: current.id, newId: null }), /Storage is full/);
  assert.equal(drafts.get(current.id).data.title, 'Late words');
});

test('malformed browser storage is never silently removed', () => {
  const current = doc('pages/current.json');
  const storage = new Storage();
  const drafts = new Map();
  const inspection = inspect([current.id], [current], drafts, storage);
  storage.setItem(browserDraftKey(current.id), '{ incomplete data');
  reconcileLifecycleDrafts({ previousDocuments: [current], nextDocuments: [], changedIds: [current.id], inspection, drafts, storage, oldId: current.id, newId: null });
  assert.equal(storage.getItem(browserDraftKey(current.id)), '{ incomplete data');
});

test('explicit orphan archival keeps distinct variants and every previous recovery before clearing', () => {
  const removed = doc('pages/removed.json');
  const storage = new Storage();
  const drafts = new Map([[removed.id, memory(removed, 'Memory version')]]);
  putDraft(storage, removed.id, 'Other tab version');
  const earlier = Array.from({ length: 12 }, (_, index) => ({ time: index, data: { title: `Earlier ${index}` }, revision: `old-${index}` }));
  storage.setItem(recoveryKey(removed.id), JSON.stringify(earlier));
  const result = archiveOrphanBrowserDrafts({ ids: [removed.id], documents: [], drafts, storage, now: () => 200 });
  const recovered = JSON.parse(storage.getItem(recoveryKey(removed.id)));
  assert.equal(recovered.length, 14);
  assert.ok(recovered.some(item => item.data.title === 'Memory version'));
  assert.ok(recovered.some(item => item.data.title === 'Other tab version'));
  assert.ok(recovered.some(item => item.data.title === 'Earlier 0'));
  assert.equal(drafts.has(removed.id), false);
  assert.equal(storage.getItem(browserDraftKey(removed.id)), null);
  assert.deepEqual(result.preservedIds, []);
  assert.deepEqual(inspect([removed.id], [], drafts, storage).dirtyIds, []);
});

test('orphan archival preserves memory and storage that change while recovery is written', () => {
  const removed = doc('pages/removed.json');
  const storage = new Storage();
  const drafts = new Map([[removed.id, memory(removed, 'Captured version')]]);
  putDraft(storage, removed.id, 'Captured version');
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    originalSet(key, value);
    if (key === recoveryKey(removed.id)) {
      drafts.get(removed.id).data.title = 'Newer memory';
      originalSet(browserDraftKey(removed.id), JSON.stringify({ data: { title: 'Newer storage' }, revision: 'one' }));
    }
  };
  const result = archiveOrphanBrowserDrafts({ ids: [removed.id], documents: [], drafts, storage });
  assert.equal(drafts.get(removed.id).data.title, 'Newer memory');
  assert.equal(JSON.parse(storage.getItem(browserDraftKey(removed.id))).data.title, 'Newer storage');
  assert.deepEqual(result.preservedIds, [removed.id]);
  assert.ok(JSON.parse(storage.getItem(recoveryKey(removed.id))).some(item => item.data.title === 'Captured version'));
});

test('existing-page drafts cannot be cleared through the orphan-only action', () => {
  const current = doc('pages/current.json');
  const storage = new Storage();
  const drafts = new Map([[current.id, memory(current, 'Unsaved words')]]);
  putDraft(storage, current.id, 'Unsaved words');
  assert.throws(() => archiveOrphanBrowserDrafts({ ids: [current.id], documents: [current], drafts, storage }), /Save or review/);
  assert.equal(drafts.get(current.id).data.title, 'Unsaved words');
  assert.notEqual(storage.getItem(browserDraftKey(current.id)), null);
  assert.equal(storage.getItem(recoveryKey(current.id)), null);
});

test('orphan archival fails safely on malformed drafts and quota failures', () => {
  for (const issue of ['malformed', 'quota']) {
    const removed = doc('pages/removed.json');
    const storage = new Storage();
    const drafts = new Map([[removed.id, memory(removed, 'Keep these words')]]);
    putDraft(storage, removed.id, 'Keep these words');
    if (issue === 'malformed') storage.setItem(browserDraftKey(removed.id), '{ incomplete');
    else storage.setItem = () => { throw new Error('Quota exceeded'); };
    const before = storage.getItem(browserDraftKey(removed.id));
    assert.throws(() => archiveOrphanBrowserDrafts({ ids: [removed.id], documents: [], drafts, storage }), issue === 'malformed' ? /malformed/ : /Quota/);
    assert.equal(storage.getItem(browserDraftKey(removed.id)), before);
    assert.equal(drafts.get(removed.id).data.title, 'Keep these words');
  }
});
