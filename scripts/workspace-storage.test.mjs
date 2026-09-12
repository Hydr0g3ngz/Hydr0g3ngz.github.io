import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceStorage, migrateLegacyDrafts } from '../studio/web/workspace-storage.js';
const a = 'a'.repeat(24), b = 'b'.repeat(24), key = 'will-studio-v1:pages/about.json';
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
}
test('identical document IDs in different workspaces never share drafts or recovery', () => {
  const native = storage(), first = workspaceStorage(native, a), second = workspaceStorage(native, b);
  first.setItem(key, 'first'); second.setItem(key, 'second');
  first.setItem('will-studio-recovery:pages/about.json', 'history');
  assert.equal(first.getItem(key), 'first'); assert.equal(second.getItem(key), 'second');
  assert.equal(second.getItem('will-studio-recovery:pages/about.json'), null);
  first.removeItem(key); assert.equal(second.getItem(key), 'second');
  assert.equal(first.length, 1); assert.equal(first.key(0), 'will-studio-recovery:pages/about.json');
  assert.throws(() => workspaceStorage(native, '../outside'), /identity/);
  assert.throws(() => first.setItem('unrelated', 'x'), /Unsupported/);
});
test('only the original project migrates legacy drafts once and leaves source bytes recoverable', () => {
  const native = storage(); native.setItem(key, 'old bytes');
  assert.equal(migrateLegacyDrafts(native, b).migrated, 0);
  assert.equal(workspaceStorage(native, b).getItem(key), null);
  assert.equal(migrateLegacyDrafts(native, a, { originalProject: true }).migrated, 1);
  const scoped = workspaceStorage(native, a); assert.equal(scoped.getItem(key), 'old bytes');
  scoped.removeItem(key);
  assert.equal(migrateLegacyDrafts(native, a, { originalProject: true }).migrated, 0);
  assert.equal(scoped.getItem(key), null); assert.equal(native.getItem(key), 'old bytes');
});
test('failed migration does not erase or overwrite newer drafts and can be retried', () => {
  const native = storage(), scoped = workspaceStorage(native, a); native.setItem(key, 'older'); scoped.setItem(key, 'newer');
  const recovery = 'will-studio-recovery:pages/about.json'; native.setItem(recovery, 'not even valid JSON');
  const set = native.setItem; native.setItem = () => { throw new Error('quota'); };
  assert.throws(() => migrateLegacyDrafts(native, a, { originalProject: true }), /quota/);
  assert.equal(native.getItem(recovery), 'not even valid JSON'); assert.equal(scoped.getItem(key), 'newer');
  native.setItem = set; migrateLegacyDrafts(native, a, { originalProject: true });
  assert.equal(scoped.getItem(recovery), 'not even valid JSON'); assert.equal(scoped.getItem(key), 'newer');
});
