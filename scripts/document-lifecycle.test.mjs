import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { dump } from 'js-yaml';
import * as schemas from '../src/content-schema.ts';
import { createStudioStore } from '../studio/server-core.mjs';
import { createDocumentLifecycle, rewriteMarkdown } from '../studio/document-lifecycle.mjs';
import { startStudioServer } from '../studio/server.mjs';

const section = { type: 'text', id: 'passage', heading: 'Reading', body: 'A small shelf.', visible: true };
const home = { title: 'Will Qing', description: 'A quiet homepage.', sections: [section] };
const page = { title: 'Reading', description: 'Reading notes.', heading: 'Reading', published: true, navigation: { show: true, label: 'Reading', order: 10 }, sections: [section] };
const settings = { brand: 'WQ', defaultTitle: 'Will Qing', description: 'A quiet homepage.', themeColor: '#f5f1e8', homeLinks: [], notesNavigation: { label: 'Notes', order: 20 }, footerText: 'Will Qing', footerLinks: [] };
const note = { title: 'Listening', description: 'Some music.', date: '2026-09-12', category: 'Music', published: true };

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'will-lifecycle-'));
  async function put(path, contents) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  await put('src/content/home/home.json', home);
  await put('src/content/settings/site.json', settings);
  await put('src/content/pages/about.json', { ...page, title: 'About', heading: 'About' });
  await put('src/content/pages/reading.json', page);
  await put('src/redirects.json', { version: 1, redirects: [] });
  await put('.pages.yml', 'components: {}\ncontent: []\n');
  await put('studio/web/index.html', '<title>Studio</title>');
  const putNote = (slug, body, data = note) => put(`src/content/notes/${slug}.md`, `---\n${dump(data)}---\n\n${body}\n`);
  const store = await createStudioStore({ root, schemas });
  const lifecycle = await createDocumentLifecycle(store, options);
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = async (operation, id = 'pages/reading.json', extra = {}) => lifecycle.plan({ operation, id, revision: (await store.readDocument(id)).revision, ...extra });
  return { root, put, putNote, store, lifecycle, plan };
}

test('published move updates exact links across files, preserves fragments, and leaves redirects and child pages', async (t) => {
  const { root, put, putNote, store, lifecycle, plan } = await fixture(t);
  await put('src/content/settings/site.json', { ...settings, footerLinks: [{ label: 'Reading', href: '/reading#passage' }] });
  await put('src/content/pages/reading/child.json', { ...page, published: false });
  await put('src/redirects.json', { version: 1, redirects: [{ from: '/books', to: '/reading' }] });
  const body = '[Read](/reading#passage) and [unchanged](/reading-room).\n\n[Reference][book]\n\n[book]: /reading?view=all#passage "Book"\n\n`[Example](/reading)`\n\n```md\n[Code](/reading)\n```\n\n<a href="/reading">HTML link</a>';
  await putNote('connections', body);
  const preview = await plan('move', undefined, { slug: 'library/reading' });
  assert.equal(preview.blocked, false);
  assert.ok(preview.references.some((item) => item.id === 'settings/site.json'));
  assert.equal((await store.readDocument('pages/reading.json')).route, '/reading');
  const result = await lifecycle.apply({ planId: preview.planId });
  assert.equal(result.newId, 'pages/library/reading.json');
  assert.equal(result.document.data.published, true);
  assert.ok(result.changedIds.includes('notes/connections.md'));
  assert.equal((await store.readDocument('settings/site.json')).data.footerLinks[0].href, '/library/reading#passage');
  const updated = (await store.readDocument('notes/connections.md')).data.body;
  assert.match(updated, /\[Read\]\(\/library\/reading#passage\)/);
  assert.match(updated, /\[book\]: \/library\/reading\?view=all#passage "Book"/);
  assert.ok(updated.includes('[unchanged](/reading-room)'));
  assert.ok(updated.includes('`[Example](/reading)`'));
  assert.ok(updated.includes('[Code](/reading)'));
  assert.ok(updated.includes('<a href="/library/reading">'));
  assert.equal((await store.readDocument('pages/reading/child.json')).data.published, false);
  const redirects = JSON.parse(await readFile(join(root, 'src/redirects.json'), 'utf8'));
  assert.deepEqual(redirects.redirects, [{ from: '/books', to: '/library/reading' }, { from: '/reading', to: '/library/reading' }]);
  await assert.rejects(store.readDocument('pages/reading.json'), (error) => error.status === 404);
});

test('moving a nested note rebases relative links and image destinations without changing prose', async (t) => {
  const { putNote, store, lifecycle, plan } = await fixture(t);
  await putNote('listening', '[Library](../../reading)\n\n![Cover](../../images/cover.png)\n\n[This section](#mood)\n\nOrdinary text.');
  const preview = await plan('move', 'notes/listening.md', { slug: 'archive/listening' });
  const result = await lifecycle.apply({ planId: preview.planId });
  assert.equal(result.document.id, 'notes/archive/listening.md');
  assert.ok(result.document.data.body.includes('[Library](/reading)'));
  assert.ok(result.document.data.body.includes('![Cover](/images/cover.png)'));
  assert.ok(result.document.data.body.includes('[This section](#mood)'));
  assert.ok(result.document.data.body.includes('Ordinary text.'));
  assert.equal((await store.documents()).filter((item) => item.kind === 'note').length, 1);
});

test('duplicate creates a private draft, preserves source, and redirects only its own self links', async (t) => {
  const { put, store, lifecycle, plan } = await fixture(t);
  await put('src/content/pages/reading.json', { ...page, sections: [section, { type: 'list', heading: 'Links', items: [{ title: 'Here', text: 'A passage', href: '/reading#passage' }] }] });
  const before = await store.readDocument('pages/reading.json');
  const preview = await plan('duplicate', undefined, { slug: 'reading-copy', title: 'Reading later' });
  const result = await lifecycle.apply({ planId: preview.planId });
  assert.equal(result.document.data.published, false);
  assert.equal(result.document.data.navigation.show, false);
  assert.equal(result.document.data.title, 'Reading later');
  assert.equal(result.document.data.sections[1].items[0].href, '/reading-copy#passage');
  assert.equal((await store.readDocument(before.id)).revision, before.revision);
});

test('delete with incoming references is blocked with a reviewable explanation', async (t) => {
  const { putNote, store, lifecycle, plan } = await fixture(t);
  await putNote('references', '[Reading](/reading#passage)', { ...note, published: false });
  const before = await store.readDocument('pages/reading.json');
  const preview = await plan('delete');
  assert.equal(preview.blocked, true);
  assert.equal(preview.references[0].id, 'notes/references.md');
  assert.equal(preview.references[0].public, false);
  await assert.rejects(lifecycle.apply({ planId: preview.planId }), (error) => error.status === 409);
  assert.equal((await store.readDocument(before.id)).revision, before.revision);
  assert.deepEqual(await lifecycle.trash(), []);
});

test('delete is recoverable and restore preserves exact bytes while guarding collisions', async (t) => {
  const { root, put, store, lifecycle, plan } = await fixture(t);
  const before = await readFile(join(root, 'src/content/pages/reading.json'), 'utf8');
  const preview = await plan('delete');
  const removed = await lifecycle.apply({ planId: preview.planId });
  assert.equal(removed.trash.length, 1);
  assert.equal(removed.newId, null);
  const item = removed.trash[0];
  await put('src/content/pages/reading.json', page);
  await assert.rejects(lifecycle.plan({ operation: 'restore', trashId: item.trashId }), (error) => error.status === 409);
  await rm(join(root, 'src/content/pages/reading.json'));
  const restore = await lifecycle.plan({ operation: 'restore', trashId: item.trashId, id: item.id, revision: item.revision });
  const result = await lifecycle.apply({ planId: restore.planId });
  assert.equal(result.document.id, item.id);
  assert.equal(result.document.data.published, true);
  assert.equal(await readFile(join(root, 'src/content/pages/reading.json'), 'utf8'), before);
  assert.deepEqual(await lifecycle.trash(), []);
  assert.equal((await store.readDocument(item.id)).revision, item.revision);
});

test('all reviewed sources and new-file collisions are rechecked before writing', async (t) => {
  const { root, put, store, lifecycle, plan } = await fixture(t);
  const original = await store.readDocument('pages/reading.json');
  const preview = await plan('move', undefined, { slug: 'library' });
  await put('src/content/pages/about.json', { ...page, title: 'An external edit' });
  await assert.rejects(lifecycle.apply({ planId: preview.planId }), (error) => error.status === 409);
  assert.equal((await store.readDocument(original.id)).revision, original.revision);
  await assert.rejects(readFile(join(root, 'src/content/pages/library.json')));
  const next = await plan('move', undefined, { slug: 'library' });
  await put('src/content/pages/library.json', { ...page, title: 'External destination' });
  await assert.rejects(lifecycle.apply({ planId: next.planId }), (error) => error.status === 409);
  assert.equal((await store.readDocument('pages/library.json')).data.title, 'External destination');
});

test('write failures roll back every touched file and keep a recovery journal', async (t) => {
  const { root, store, lifecycle, plan } = await fixture(t, { afterWrite: ({ index }) => { if (index === 1) throw new Error('Simulated disk failure'); } });
  const before = await store.readDocument('pages/reading.json');
  const preview = await plan('move', undefined, { slug: 'library' });
  await assert.rejects(lifecycle.apply({ planId: preview.planId }), /rolled back/);
  assert.equal((await store.readDocument(before.id)).revision, before.revision);
  await assert.rejects(store.readDocument('pages/library.json'), (error) => error.status === 404);
  const journal = JSON.parse(await readFile(join(root, `.studio/transactions/${preview.planId}.json`), 'utf8'));
  assert.equal(journal.status, 'rolled-back');
  assert.equal(journal.mutations[0].after.includes('Reading'), true);
});

test('interrupted transactions recover on startup without overwriting external changes', async (t) => {
  const { root, put, store } = await fixture(t);
  const path = 'src/content/pages/reading.json';
  const before = await readFile(join(root, path), 'utf8');
  const after = JSON.stringify({ ...page, title: 'Interrupted edit' });
  const journal = { version: 1, status: 'committing', mutations: [{ path, before, after }] };
  await put('.studio/transactions/111111111111111111111111.json', journal);
  await put(path, after);
  await createDocumentLifecycle(store);
  assert.equal(await readFile(join(root, path), 'utf8'), before);
  await put('.studio/transactions/222222222222222222222222.json', journal);
  await put(path, JSON.stringify({ ...page, title: 'New external work' }));
  await assert.rejects(createDocumentLifecycle(store), (error) => error.status === 503);
  assert.equal((await store.readDocument('pages/reading.json')).data.title, 'New external work');
});

test('core documents, reserved routes, traversal, casing and symlink destinations are rejected', async (t) => {
  const { root, store, lifecycle, plan } = await fixture(t);
  for (const id of ['home/home.json', 'settings/site.json', 'pages/about.json']) {
    const original = await store.readDocument(id);
    await assert.rejects(lifecycle.plan({ operation: 'delete', id, revision: original.revision }), (error) => error.status === 400);
  }
  for (const slug of ['about', 'notes/new', '../escape', 'Library', 'reading/index', 'C:/escape']) {
    await assert.rejects(plan('move', undefined, { slug }), (error) => [400, 409].includes(error.status));
  }
  await mkdir(join(root, 'public'), { recursive: true });
  await symlink(join(root, 'public'), join(root, 'src/content/pages/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(plan('move', undefined, { slug: 'linked/escape' }), (error) => error.status === 400);
  assert.deepEqual(await readdir(join(root, 'public')), []);
});

test('HTTP lifecycle endpoints enforce session authorization and return full document state', async (t) => {
  const { root } = await fixture(t);
  const server = await startStudioServer({ root, port: 0, noAstro: true, schemas });
  t.after(() => server.close());
  const state = await (await fetch(`${server.url}/api/state`)).json();
  const doc = state.documents.find((item) => item.id === 'pages/reading.json');
  const body = JSON.stringify({ operation: 'duplicate', id: doc.id, revision: doc.revision, slug: 'copy' });
  const headers = { 'content-type': 'application/json', origin: server.url, 'x-studio-token': state.token };
  assert.equal((await fetch(`${server.url}/api/lifecycle/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 403);
  const preview = await (await fetch(`${server.url}/api/lifecycle/plan`, { method: 'POST', headers, body })).json();
  const result = await (await fetch(`${server.url}/api/lifecycle/apply`, { method: 'POST', headers, body: JSON.stringify({ planId: preview.planId }) })).json();
  assert.equal(result.document.id, 'pages/copy.json');
  assert.equal(result.documents.length, 5);
  assert.deepEqual(await (await fetch(`${server.url}/api/trash`)).json(), []);
});

test('Markdown rewriting preserves nested labels, reference titles, and inline code', () => {
  const source = '> [Nested **label**](/reading "Title")\n\n- [List](/reading#part)\n\n`[Inline code](/reading)`\n\n![Image][pic]\n\n[pic]: </reading> "Cover"';
  const result = rewriteMarkdown(source, (href) => href.startsWith('/reading') ? href.replace('/reading', '/library') : null);
  assert.ok(result.includes('[Nested **label**](/library "Title")'));
  assert.ok(result.includes('[List](/library#part)'));
  assert.ok(result.includes('`[Inline code](/reading)`'));
  assert.ok(result.includes('[pic]: </library> "Cover"'));
});

test('table links and autolinks are detected before deleting and rewritten on move', async (t) => {
  const { putNote, store, lifecycle, plan } = await fixture(t);
  await putNote('table', '| Item | Link |\n| --- | --- |\n| Book | [Read](/reading#passage) |\n\n<https://hydr0g3ngz.github.io/reading>\n\nhttps://hydr0g3ngz.github.io/reading');
  const deletion = await plan('delete');
  assert.equal(deletion.blocked, true);
  assert.equal(deletion.references.length, 3);
  const move = await plan('move', undefined, { slug: 'library' });
  await lifecycle.apply({ planId: move.planId });
  const body = (await store.readDocument('notes/table.md')).data.body;
  assert.ok(body.includes('[Read](/library#passage)'));
  assert.ok(body.includes('<https://hydr0g3ngz.github.io/library>'));
  assert.equal(body.split('https://hydr0g3ngz.github.io/library').length - 1, 2);
});

test('existing redirect aliases use the shared rules and prevent deleted or unpublished targets', async (t) => {
  const { put, store, lifecycle, plan } = await fixture(t);
  await put('src/redirects.json', { version: 1, redirects: [{ from: '/old_reading/', to: '/reading/' }] });
  const deletion = await plan('delete');
  assert.equal(deletion.blocked, true);
  assert.ok(deletion.references.some((item) => item.id === 'src/redirects.json'));
  const current = await store.readDocument('pages/reading.json');
  await assert.rejects(store.save({ ...current, data: { ...current.data, published: false } }), (error) => error.status === 422);
  const move = await plan('move', undefined, { slug: 'library' });
  await lifecycle.apply({ planId: move.planId });
  assert.equal((await store.readDocument('pages/library.json')).data.published, true);
});

test('ordinary document creation cannot reuse a published redirect source', async (t) => {
  const { store, lifecycle, plan } = await fixture(t);
  const move = await plan('move', undefined, { slug: 'library' });
  await lifecycle.apply({ planId: move.planId });
  await assert.rejects(store.create({ kind: 'page', slug: 'reading', title: 'A new reading page' }), (error) => error.status === 409 && /redirect/i.test(error.message));
  await assert.rejects(store.readDocument('pages/reading.json'), (error) => error.status === 404);
});

test('the final published note cannot be hidden while a redirect needs the notes index', async (t) => {
  const { put, putNote, store } = await fixture(t);
  await putNote('first', 'The first note.');
  await put('src/redirects.json', { version: 1, redirects: [{ from: '/journal', to: '/notes' }] });
  const first = await store.readDocument('notes/first.md');
  await assert.rejects(store.save({ ...first, data: { ...first.data, published: false } }), (error) => error.status === 422 && /notes index/i.test(error.message));
  assert.equal((await store.readDocument(first.id)).revision, first.revision);
  await putNote('second', 'A second note.');
  const result = await store.save({ ...first, data: { ...first.data, published: false } });
  assert.equal(result.data.published, false);
});

test('unsupported MDX and non-template underscore content cannot be silently omitted from lifecycle references', async (t) => {
  const { root, put, store, plan } = await fixture(t);
  const before = await store.readDocument('pages/reading.json');
  await put('src/content/notes/links.mdx', `---\n${dump(note)}---\n\n[Read](/reading)\n`);
  await assert.rejects(plan('delete'), (error) => error.status === 422 && /MDX/i.test(error.message));
  assert.equal((await store.readDocument(before.id)).revision, before.revision);
  await rm(join(root, 'src/content/notes/links.mdx'));
  await put('src/content/notes/_other.md', `---\n${dump(note)}---\n\n[Read](/reading)\n`);
  await assert.rejects(plan('delete'), (error) => error.status === 400);
  assert.equal((await store.readDocument(before.id)).revision, before.revision);
});

test('custom slug content is rejected before saving or planning can silently change its public address', async (t) => {
  const { put, store, plan } = await fixture(t);
  const before = await store.readDocument('pages/reading.json');
  await assert.rejects(store.save({ ...before, data: { ...before.data, slug: 'elsewhere' } }), (error) => error.status === 422 && /custom slug/i.test(error.message));
  assert.equal((await store.readDocument(before.id)).revision, before.revision);
  await put('src/content/pages/reading.json', { ...page, slug: 'elsewhere' });
  await assert.rejects(store.documents(), (error) => error.status === 422 && /custom slug/i.test(error.message));
  await assert.rejects(plan('delete'), (error) => error.status === 422 && /custom slug/i.test(error.message));
});
