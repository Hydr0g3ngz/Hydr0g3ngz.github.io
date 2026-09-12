const json = value => JSON.stringify(value);
export const browserDraftKey = id => `will-studio-v1:${id}`;
export const recoveryKey = id => `will-studio-recovery:${id}`;

function storedDraft(storage, id) {
  const raw = storage.getItem(browserDraftKey(id));
  if (raw === null) return { raw, value: null };
  try {
    const value = JSON.parse(raw);
    return { raw, value: value?.data && typeof value.data === 'object' ? value : null };
  } catch { return { raw, value: null }; }
}
const memoryDirty = value => Boolean(value && (value.saving || value.conflict || json(value.data) !== value.saved));
const storageDirty = (entry, document) => entry.raw !== null && (!entry.value || !document || json(entry.value.data) !== json(document.data));

/** Read localStorage independently: another tab can update it after memory was cached. */
export function inspectBrowserDrafts({ ids, documents, drafts, storage }) {
  const entries = new Map();
  const dirtyIds = [];
  const orphanIds = [];
  for (const id of new Set(ids)) {
    const document = documents.find(item => item.id === id);
    const memory = drafts.get(id);
    const stored = storedDraft(storage, id);
    entries.set(id, { raw: stored.raw, memory: memory ? json(memory.data) : null, revision: document?.revision });
    if (memoryDirty(memory) || storageDirty(stored, document)) {
      dirtyIds.push(id);
      if (!document) orphanIds.push(id);
    }
  }
  return { ids: [...entries.keys()], entries, dirtyIds, orphanIds };
}

function remember(storage, id, value, { fromId = id, reason, time }) {
  const key = recoveryKey(id);
  const raw = storage.getItem(key);
  let entries = [];
  if (raw !== null) {
    try { entries = JSON.parse(raw); } catch { throw new Error(`The recovered drafts for ${id} need attention. Existing browser data was kept.`); }
    if (!Array.isArray(entries)) throw new Error(`The recovered drafts for ${id} need attention. Existing browser data was kept.`);
  }
  if (!entries.some(entry => json(entry.data) === json(value.data) && entry.revision === value.revision)) {
    entries.unshift({ time, data: structuredClone(value.data), revision: value.revision, fromId, reason });
    // Do not silently truncate older recoveries. If storage fills up, fail before
    // deleting the live draft so the user can still save or export it.
    storage.setItem(key, json(entries));
  }
}

/** Explicit user action for drafts whose document is currently absent on disk. */
export function archiveOrphanBrowserDrafts({ ids, documents, drafts, storage, now = Date.now }) {
  const captured = [];
  const signature = value => value ? json({ data: value.data, saved: value.saved, revision: value.revision, saving: value.saving, conflict: value.conflict }) : null;
  for (const id of new Set(ids)) {
    if (documents.some(document => document.id === id)) throw new Error(`Save or review ${id} first. Existing-page drafts are not archived by this action.`);
    const memory = drafts.get(id);
    const stored = storedDraft(storage, id);
    if (memory?.saving) throw new Error(`Wait for the pending save of ${id} before reviewing its browser draft.`);
    if (stored.raw !== null && !stored.value) throw new Error(`The browser draft for ${id} is malformed. It was kept unchanged; it cannot be safely archived automatically.`);
    if (memory && (!memory.data || typeof memory.data !== 'object')) throw new Error(`The browser draft for ${id} cannot be safely archived. It was kept unchanged.`);
    captured.push({ id, memory, memorySignature: signature(memory), stored });
  }
  // Archive every distinct memory/storage variant before clearing any live key.
  // A quota or malformed-history failure therefore preserves all original drafts.
  for (const item of captured) {
    for (const variant of [item.memory, item.stored.value].filter(Boolean)) {
      remember(storage, item.id, variant, { reason: 'Explicitly kept before restoring or recreating an absent page.', time: now() });
    }
  }
  const preservedIds = [];
  for (const item of captured) {
    const currentMemory = drafts.get(item.id);
    if (currentMemory === item.memory && signature(currentMemory) === item.memorySignature) drafts.delete(item.id);
    else if (currentMemory) preservedIds.push(item.id);
    const currentRaw = storage.getItem(browserDraftKey(item.id));
    if (currentRaw !== item.stored.raw) preservedIds.push(item.id);
    else if (currentRaw !== null && storage.getItem(browserDraftKey(item.id)) === item.stored.raw) storage.removeItem(browserDraftKey(item.id));
  }
  return { archivedIds: captured.map(item => item.id), preservedIds: [...new Set(preservedIds)] };
}

/** Reconcile the server result without discarding unrelated or late browser work. */
export function reconcileLifecycleDrafts({ previousDocuments, nextDocuments, drafts, storage, changedIds, inspection, oldId, newId, now = Date.now }) {
  const reviewed = new Set(inspection?.ids ?? []);
  const changed = new Set((changedIds ?? []).filter(id => reviewed.has(id)));
  const recovered = [];
  const conflicts = [];
  const preservedStorage = [];
  for (const id of changed) {
    const document = nextDocuments.find(item => item.id === id);
    const memory = drafts.get(id);
    const stored = storedDraft(storage, id);
    const destination = id === oldId && newId && newId !== oldId ? newId : id;
    const reason = newId === null ? 'Kept before moving a page to Trash.' : 'Kept while page addresses or saved files changed.';
    if (memoryDirty(memory)) {
      remember(storage, destination, memory, { fromId: id, reason, time: now() });
      recovered.push(destination);
    }
    if (storageDirty(stored, document)) {
      if (!stored.value) {
        // Unknown data cannot be safely replaced or disguised as a valid draft.
        preservedStorage.push(id);
      } else {
        remember(storage, destination, stored.value, { fromId: id, reason, time: now() });
        recovered.push(destination);
      }
    }
    const expected = inspection.entries.get(id)?.raw;
    const latest = storage.getItem(browserDraftKey(id));
    if (latest !== expected) preservedStorage.push(id);
    else if (latest !== null && stored.value && storage.getItem(browserDraftKey(id)) === expected) storage.removeItem(browserDraftKey(id));
    drafts.delete(id);
  }
  // Returned state can include unrelated edits made before the plan was created.
  // Those are NOT permission to clear a browser draft for that other document.
  for (const previous of previousDocuments) {
    if (changed.has(previous.id)) continue;
    const next = nextDocuments.find(item => item.id === previous.id);
    if (next?.revision === previous.revision) continue;
    const memory = drafts.get(previous.id);
    const stored = storedDraft(storage, previous.id);
    if (memoryDirty(memory) || storageDirty(stored, next)) {
      if (memory) {
        if (!memoryDirty(memory) && stored.value) { memory.data = structuredClone(stored.value.data); memory.revision = stored.value.revision; }
        memory.conflict = true;
      } else if (stored.value) {
        drafts.set(previous.id, { data: structuredClone(stored.value.data), revision: stored.value.revision, saved: json(next?.data ?? previous.data), undo: [], redo: [], restored: true, conflict: true });
      }
      conflicts.push(previous.id);
    } else {
      drafts.delete(previous.id); // Only a clean cache; ensureDraft will read fresh disk content.
    }
  }
  return { recovered: [...new Set(recovered)], conflicts: [...new Set(conflicts)], preservedStorage: [...new Set(preservedStorage)] };
}
