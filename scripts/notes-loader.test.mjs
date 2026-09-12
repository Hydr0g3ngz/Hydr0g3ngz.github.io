import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load as yaml } from 'js-yaml';
import { withNotesWatcher } from '../src/lib/notes-loader.mjs';
import { noteSchema } from '../src/content-schema.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await tick(); }
  assert.fail('The notes refresh did not finish.');
}
const note = title => `---\ntitle: ${JSON.stringify(title)}\ndescription: A short observation.\ndate: 2026-01-01\ncategory: Other\npublished: true\n---\n\nA note body.\n`;
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(path);
  }
  return files;
}
async function fixture(t, options = {}) {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(parent, 'will-notes-loader-')));
  const directory = join(root, 'src/content/notes');
  await mkdir(directory, { recursive: true });
  const watcher = new EventEmitter(); watcher.add = () => watcher;
  const data = new Map(), errors = [], calls = [];
  let active = 0, maximum = 0, barrier = null;
  const context = {
    config: { root: pathToFileURL(`${root}/`) }, watcher,
    store: { clear: () => data.clear() },
    logger: { error: message => errors.push(message) }
  };
  const loader = withNotesWatcher({
    name: 'fixture-glob',
    async load(current) {
      calls.push(current); active++; maximum = Math.max(maximum, active);
      try {
        const paths = await markdownFiles(directory), hold = barrier; barrier = null;
        if (hold) await hold;
        const parsed = [];
        for (const path of paths) {
          const raw = await readFile(path, 'utf8');
          const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw);
          if (!frontmatter) throw new Error('Missing frontmatter');
          parsed.push([relative(directory, path).replaceAll('\\', '/'), noteSchema.parse(yaml(frontmatter[1]))]);
        }
        data.clear(); for (const entry of parsed) data.set(...entry);
      } finally { active--; }
    }
  });
  const put = async (path, text = note(path)) => { const target = join(directory, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text); return target; };
  const emit = (event, path) => watcher.emit(event, join(directory, path));
  t.after(async () => {
    await until(() => active === 0);
    watcher.removeAllListeners();
    assert.equal(dirname(root), parent); assert.match(basename(root), /^will-notes-loader-/);
    await rm(root, { recursive: true, force: true });
  });
  return { root, directory, watcher, data, errors, calls, context, loader, put, emit,
    load: () => loader.load(options.build ? { ...context, watcher: undefined } : context),
    active: () => active, maximum: () => maximum,
    hold() { let release; barrier = new Promise(resolve => { release = resolve; }); return release; }
  };
}

test('an empty notes folder loads its first real note without restarting or adding a placeholder', async t => {
  const f = await fixture(t); await f.load();
  assert.equal(f.calls.length, 0); assert.equal(f.data.size, 0);
  for (const event of ['add', 'change', 'unlink']) assert.equal(f.watcher.listenerCount(event), 1);
  await f.put('first.md'); f.emit('add', 'first.md');
  await until(() => f.data.has('first.md'));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].watcher, undefined);
  assert.equal(f.data.get('first.md').published, true); assert.deepEqual(f.errors, []);
});

test('existing notes and build loading delegate the same content without installing nested watchers', async t => {
  const f = await fixture(t, { build: true }); await f.put('existing.mdx', note('Existing')); await f.load();
  assert.equal(f.data.get('existing.mdx').title, 'Existing');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].watcher, undefined);
  assert.equal(f.watcher.eventNames().length, 0);
});

test('a malformed first note reports the validation error and a later correction retries safely', async t => {
  const f = await fixture(t); await f.load();
  await f.put('first.md', 'Not frontmatter'); f.emit('add', 'first.md');
  await until(() => f.errors.length === 1);
  assert.match(f.errors[0], /Missing frontmatter/); assert.equal(f.data.size, 0);
  await f.put('first.md', note('Corrected')); f.emit('change', 'first.md');
  await until(() => f.data.get('first.md')?.title === 'Corrected');
  for (const event of ['add', 'change', 'unlink']) assert.equal(f.watcher.listenerCount(event), 1);
});

test('files arriving during the first scan are coalesced and loaded without parallel delegates', async t => {
  const f = await fixture(t); await f.load();
  const release = f.hold(); await f.put('first.md'); f.emit('add', 'first.md');
  await until(() => f.active() === 1);
  await f.put('nested/second.md'); f.emit('add', 'nested/second.md');
  f.emit('change', 'nested/second.md'); f.emit('change', 'first.md');
  release(); await until(() => f.data.has('nested/second.md') && f.active() === 0);
  assert.equal(f.calls.length, 2); assert.equal(f.maximum(), 1); assert.equal(f.data.size, 2);
  assert.deepEqual(f.errors, []);
});

test('deleting the last note clears stale entries, and a later note still loads', async t => {
  const f = await fixture(t); await f.put('first.md'); await f.load();
  await unlink(join(f.directory, 'first.md')); f.emit('unlink', 'first.md');
  await until(() => f.data.size === 0);
  await f.put('later.md'); f.emit('add', 'later.md');
  await until(() => f.data.has('later.md'));
  assert.equal(f.data.size, 1); assert.deepEqual(f.errors, []);
});

test('deletion during a scan drains the queued unlink and cannot leave a stale published note', async t => {
  const f = await fixture(t); await f.put('first.md'); await f.load();
  const release = f.hold(); f.emit('change', 'first.md');
  await until(() => f.active() === 1);
  await unlink(join(f.directory, 'first.md')); f.emit('unlink', 'first.md');
  release(); await until(() => f.data.size === 0 && f.active() === 0);
  assert.equal(f.maximum(), 1); assert.equal(f.errors.length, 1);
  await f.put('replacement.md'); f.emit('add', 'replacement.md');
  await until(() => f.data.has('replacement.md'));
  assert.equal(f.data.has('first.md'), false);
});

test('unrelated and hidden file events do not reload the collection', async t => {
  const f = await fixture(t); await f.load();
  await f.put('.hidden.md'); await f.put('.hidden/nested.md'); await f.put('image.png');
  for (const path of ['.hidden.md', '.hidden/nested.md', 'image.png', '../outside.md', '../notes-sibling/other.md', 'uppercase.MD']) f.emit('add', path);
  await tick(); assert.equal(f.calls.length, 0); assert.equal(f.data.size, 0);
});

test('an invalid initial collection fails normally and a later config reload replaces listeners', async t => {
  const f = await fixture(t); await f.put('bad.md', 'Not frontmatter');
  await assert.rejects(() => f.load(), /Missing frontmatter/);
  assert.equal(f.watcher.eventNames().length, 0);
  await f.put('bad.md', note('Fixed')); await f.load(); await f.load();
  for (const event of ['add', 'change', 'unlink']) assert.equal(f.watcher.listenerCount(event), 1);
  assert.equal(f.data.get('bad.md').title, 'Fixed');
});

test('config reload waits for an in-flight scan before replacing watcher ownership', async t => {
  const f = await fixture(t); await f.load();
  const release = f.hold(); await f.put('first.md'); f.emit('add', 'first.md');
  await until(() => f.active() === 1);
  let reloaded = false; const reload = f.load().then(() => { reloaded = true; });
  await tick(); assert.equal(reloaded, false);
  release(); await reload;
  assert.equal(f.maximum(), 1);
  for (const event of ['add', 'change', 'unlink']) assert.equal(f.watcher.listenerCount(event), 1);
});

test('the main site and neutral starter use the same notes-loader implementation', async () => {
  assert.equal(await readFile(new URL('../src/lib/notes-loader.mjs', import.meta.url), 'utf8'), await readFile(new URL('../studio/starter/template/src/lib/notes-loader.mjs', import.meta.url), 'utf8'));
  for (const path of ['../src/content.config.ts', '../studio/starter/template/src/content.config.ts']) {
    assert.match(await readFile(new URL(path, import.meta.url), 'utf8'), /loader: notesLoader\(\)/);
  }
});
