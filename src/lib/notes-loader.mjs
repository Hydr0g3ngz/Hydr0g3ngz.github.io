import { readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'astro/loaders';

const DEFAULT_BASE = './src/content/notes';

async function hasNotes(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && /\.mdx?$/.test(entry.name)) return true;
    if (entry.isDirectory() && await hasNotes(resolve(directory, entry.name))) return true;
  }
  return false;
}

/**
 * Own the notes watcher, including when the folder starts empty. Astro's glob
 * loader returns before installing its watcher for an empty collection. A
 * serialized rescan also covers files arriving during a scan and the last
 * note being deleted. Glob still performs parsing, validation and rendering.
 *
 * @param {import('astro/loaders').Loader} loader
 * @param {{ base?: string | URL }} options
 * @returns {import('astro/loaders').Loader}
 */
export function withNotesWatcher(loader, { base = DEFAULT_BASE } = {}) {
  let disposePrevious = async () => {};
  return {
    ...loader,
    name: 'notes-loader',
    async load(context) {
      await disposePrevious();
      const directory = fileURLToPath(new URL(base, context.config.root));
      const watcher = context.watcher;
      let stopped = false, pending = false, running = false;
      let background = Promise.resolve();

      const refresh = async () => {
        if (await hasNotes(directory)) {
          // Only this wrapper registers listeners; repeated delegates cannot
          // accumulate callbacks or miss a file during watcher hand-off.
          await loader.load({ ...context, watcher: undefined });
        } else {
          context.store.clear();
        }
      };
      const drain = async (throwErrors = false) => {
        running = true;
        try {
          do {
            pending = false;
            try { await refresh(); }
            catch (error) {
              if (throwErrors) throw error;
              context.logger.error(`Could not reload notes: ${error instanceof Error ? error.message : String(error)}`);
            }
          } while (pending && !stopped);
        } finally { running = false; }
      };
      const onFile = (path) => {
        if (stopped || typeof path !== 'string') return;
        const within = relative(directory, resolve(path));
        if (!within || isAbsolute(within) || within.split(sep).some(part => part.startsWith('.')) || !/\.mdx?$/.test(within)) return;
        pending = true;
        if (!running) background = drain();
      };
      disposePrevious = async () => {
        stopped = true;
        for (const event of ['add', 'change', 'unlink']) watcher?.off(event, onFile);
        await background.catch(() => {});
      };
      for (const event of ['add', 'change', 'unlink']) watcher?.on(event, onFile);
      watcher?.add(directory);
      background = drain(true);
      try { await background; }
      catch (error) { await disposePrevious(); throw error; }
    }
  };
}

/** @param {{ base?: string | URL }} options */
export function notesLoader({ base = DEFAULT_BASE } = {}) {
  return withNotesWatcher(glob({ base, pattern: '**/*.{md,mdx}' }), { base });
}
