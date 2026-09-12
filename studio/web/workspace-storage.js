const prefixes = ['will-studio-v1:', 'will-studio-recovery:'];
const allowed = key => typeof key === 'string' && prefixes.some(prefix => key.startsWith(prefix));

/** Keep draft IDs portable inside the app, but isolate their storage per checkout. */
export function workspaceStorage(storage, workspaceId) {
  if (!/^[a-f0-9]{24}$/.test(workspaceId)) throw new Error('Studio needs a valid workspace identity. Restart Studio and reload this tab.');
  const prefix = `will-studio-workspace:${workspaceId}:`;
  const physical = key => {
    if (!allowed(key)) throw new Error('Unsupported Studio draft key.');
    return prefix + key;
  };
  const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key?.startsWith(prefix)).map(key => key.slice(prefix.length));
  return {
    getItem: key => storage.getItem(physical(key)),
    setItem: (key, value) => storage.setItem(physical(key), value),
    removeItem: key => storage.removeItem(physical(key)),
    key: index => keys()[index] ?? null,
    get length() { return keys().length; }
  };
}

/** Only the original bundled checkout may claim pre-workspace browser drafts. */
export function migrateLegacyDrafts(storage, workspaceId, { originalProject = false } = {}) {
  if (!originalProject) return { migrated: 0 };
  const scoped = workspaceStorage(storage, workspaceId);
  const marker = `will-studio-workspace-migrated:${workspaceId}`;
  if (storage.getItem(marker) === '1') return { migrated: 0 };
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(allowed);
  let migrated = 0;
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw !== null && scoped.getItem(key) === null) { scoped.setItem(key, raw); migrated++; }
  }
  storage.setItem(marker, '1');
  // Retain legacy source bytes, including malformed drafts, for manual recovery.
  return { migrated };
}
