import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import * as schemas from '../src/content-schema.ts';
import { containedPath, createStudioStore, MAX_IMAGE_BYTES } from '../studio/server-core.mjs';
import { startStudioServer } from '../studio/server.mjs';

const home = { title: 'Will Qing', description: 'A quiet homepage.', sections: [{ type: 'text', id: 'reading', heading: 'Reading', body: 'A small shelf.', visible: true, width: 'narrow' }] };
const page = { title: 'About', description: 'About Will.', heading: 'About', published: true, navigation: { show: true, label: 'About', order: 10 }, sections: [{ type: 'text', heading: 'Hello', body: 'An introduction.', visible: true }] };
const settings = { brand: 'WQ', defaultTitle: 'Will Qing', description: 'A quiet homepage.', themeColor: '#f5f1e8', homeLinks: [{ label: 'Reading', href: '/#reading', order: 1, visible: true }], notesNavigation: { label: 'Notes', order: 20 }, footerText: 'Will Qing', footerLinks: [] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'will-studio-test-'));
  for (const directory of ['src/content/home', 'src/content/pages', 'src/content/settings', 'src/content/notes', 'public/images', 'studio/web']) await mkdir(join(root, directory), { recursive: true });
  for (const [file, data] of Object.entries({ 'home/home.json': home, 'pages/about.json': page, 'settings/site.json': settings })) await writeFile(join(root, 'src/content', file), JSON.stringify(data));
  await writeFile(join(root, '.pages.yml'), 'components: {}\ncontent: []\n');
  await writeFile(join(root, 'studio/web/index.html'), '<!doctype html><title>Studio</title>');
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = await createStudioStore({ root, schemas });
  return { root, store };
}

test('two editors cannot overwrite each other; exact previous contents remain recoverable', async (t) => {
  const { root, store } = await fixture(t);
  const original = await store.readDocument('pages/about.json');
  const edits = await Promise.allSettled([
    store.save({ ...original, data: { ...original.data, heading: 'First editor' } }),
    store.save({ ...original, data: { ...original.data, heading: 'Second editor' } })
  ]);
  assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(edits.find((result) => result.status === 'rejected').reason.status, 409);
  const after = await store.readDocument(original.id);
  const history = await store.history(original.id);
  assert.equal(history.versions.length, 1);
  const restored = await store.restore({ id: original.id, revision: after.revision, version: history.versions[0].version });
  assert.equal(restored.data.heading, original.data.heading);
  assert.equal((await store.history(original.id)).versions.length, 2);
  assert.deepEqual((await readdir(join(root, 'src/content/pages'))).filter((file) => file.endsWith('.tmp')), []);
});

test('schema errors, hidden navigation targets, and missing media never modify documents', async (t) => {
  const { store } = await fixture(t);
  const original = await store.readDocument('home/home.json');
  for (const sections of [
    [],
    [{ ...home.sections[0], visible: false }],
    [home.sections[0], { ...home.sections[0] }],
    [{ type: 'image_text', id: 'reading', heading: 'A picture', body: 'Caption', image: '/images/missing.png', imageAlt: 'A missing image' }]
  ]) {
    await assert.rejects(store.save({ id: original.id, revision: original.revision, data: { ...original.data, sections } }), (error) => [404, 422].includes(error.status));
    assert.equal((await store.readDocument(original.id)).revision, original.revision);
  }
  assert.equal((await store.history(original.id)).versions.length, 0);
});

test('nested pages and notes start as drafts; collisions and reserved routes are rejected', async (t) => {
  const { store } = await fixture(t);
  const draft = await store.create({ kind: 'page', parent: 'reading', slug: 'quiet-days', title: 'Quiet days' });
  assert.equal(draft.id, 'pages/reading/quiet-days.json');
  assert.equal(draft.route, '/reading/quiet-days');
  assert.equal(draft.data.published, false);
  assert.equal(draft.data.navigation.show, false);
  const note = await store.create({ kind: 'note', slug: 'music/first-listen', title: 'First listen' });
  assert.equal(note.route, '/notes/music/first-listen');
  assert.equal(note.data.published, false);
  assert.match(note.data.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const slug of ['about', 'notes/new', '__studio/preview', '../outside', 'reading/index', 'C:/outside', 'abc\\def']) {
    await assert.rejects(store.create({ kind: 'page', slug, title: 'Invalid' }), (error) => [400, 409].includes(error.status));
  }
  const updated = await store.save({ ...note, data: { ...note.data, body: '## A first impression\n\nSomething worth keeping.\n' } });
  assert.equal(updated.data.body, '## A first impression\n\nSomething worth keeping.\n');
});

test('preview preserves published content and writes only the local preview record', async (t) => {
  const { root, store } = await fixture(t);
  const original = await store.readDocument('pages/about.json');
  const result = await store.preview({ id: original.id, data: { ...original.data, heading: 'Unsaved preview' } });
  assert.match(result.url, /^\/preview\/__studio\/preview\?rev=/);
  assert.equal((await store.readDocument(original.id)).revision, original.revision);
  const record = JSON.parse(await readFile(join(root, `.studio/previews/${result.rev}.json`), 'utf8'));
  assert.equal(record.kind, 'page');
  assert.equal(record.data.heading, 'Unsaved preview');
  const next = await store.preview({ id: original.id, data: { ...original.data, heading: 'Another tab' } });
  assert.notEqual(result.rev, next.rev);
  assert.equal(JSON.parse(await readFile(join(root, `.studio/previews/${result.rev}.json`), 'utf8')).data.heading, 'Unsaved preview');
  assert.equal((await store.history(original.id)).versions.length, 0);
});

test('path escapes, prototype properties, linked directories, and fake images are rejected', async (t) => {
  const { root, store } = await fixture(t);
  for (const id of ['../package.json', 'pages/%2e%2e/secret.json', 'pages/../../secret.json', 'settings/other.json']) {
    await assert.rejects(store.readDocument(id), (error) => error.status === 400);
  }
  await assert.rejects(containedPath(root, '../outside'), (error) => error.status === 400);
  const original = await store.readDocument('home/home.json');
  const polluted = JSON.parse(JSON.stringify(original.data).replace('"title":', '"__proto__":{"polluted":true},"title":'));
  await assert.rejects(store.save({ ...original, data: polluted }), (error) => error.status === 400);
  assert.equal({}.polluted, undefined);
  await assert.rejects(store.upload(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image.png'), (error) => error.status === 415);
  await assert.rejects(store.upload(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image.png'), (error) => error.status === 413);
  const image = await store.upload(png, 'My photo.PNG');
  assert.match(image.path, /^\/images\/my-photo-[a-f0-9]+\.png$/);
  assert.deepEqual(await readFile(join(root, `public${image.path}`)), png);
  await symlink(join(root, 'public'), join(root, 'src/content/pages/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.create({ kind: 'page', slug: 'linked/escape', title: 'No escape' }), (error) => error.status === 400);
  await assert.rejects(store.readDocument('pages/linked/escape.json'), (error) => error.status === 400);
});

test('HTTP API rejects foreign origins/hosts and requires the matching session token', async (t) => {
  const { root } = await fixture(t);
  const studio = await startStudioServer({ root, port: 0, noAstro: true, schemas, editorRoot: root, launchpadUrl: 'http://127.0.0.1:4410', projectConfig: { version: 1, adapter: 'will-astro-v1', project: { name: 'Test project' } } });
  t.after(() => studio.close());
  const state = await (await fetch(`${studio.url}/api/state`)).json();
  assert.equal(state.documents.length, 3);
  assert.ok(state.config);
  assert.equal(typeof state.token, 'string');
  assert.equal(state.workspace.launchpadUrl, 'http://127.0.0.1:4410');
  assert.equal(await studio.ready, true);
  assert.deepEqual(studio.previewStatus(), { ready: true, error: '' });
  const body = JSON.stringify({ kind: 'page', slug: 'browser-created', title: 'Browser created' });
  for (const headers of [
    { origin: 'https://example.com', 'x-studio-token': state.token },
    { origin: studio.url, 'x-studio-token': 'wrong' },
    { 'x-studio-token': state.token }
  ]) {
    const response = await fetch(`${studio.url}/api/document`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal(response.status, 403);
  }
  const created = await fetch(`${studio.url}/api/document`, { method: 'POST', headers: { 'content-type': 'application/json', origin: studio.url, 'x-studio-token': state.token }, body });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.published, false);
  const foreignHost = await new Promise((resolve) => {
    const request = http.get(`${studio.url}/api/state`, { headers: { host: `example.com:${studio.port}` } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', (error) => assert.fail(error.message));
  });
  assert.equal(foreignHost, 403);
  const escape = await new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port: studio.port, path: '/%2e%2e/package.json' }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', (error) => assert.fail(error.message));
  });
  assert.equal(escape, 400);
  assert.match(await (await fetch(studio.url)).text(), /Studio/);
  const snapshot = await fetch(`${studio.url}/api/snapshot`, { method: 'POST', headers: { origin: studio.url, 'x-studio-token': state.token } });
  assert.equal(snapshot.status, 201);
  assert.equal((await snapshot.json()).fileCount, 5);
  const snapshots = await (await fetch(`${studio.url}/api/snapshots`)).json();
  assert.equal(snapshots.length, 1);
  const bundleResponse = await fetch(`${studio.url}/api/export`);
  assert.match(bundleResponse.headers.get('content-disposition'), /attachment/);
  assert.equal((await bundleResponse.json()).format, 'will-studio-content-v1');
  const project = await (await fetch(`${studio.url}/api/project`)).json();
  assert.equal(project.content.drafts, 1);
  await Promise.all([studio.close(), studio.close()]);
  assert.equal(studio.server.listening, false);
});

test('a project chooser address cannot introduce external, credentialed, or scripted navigation', async () => {
  for (const launchpadUrl of ['https://evil.example/', 'javascript:alert(1)', 'http://user:secret@127.0.0.1:4410/', 'http://127.0.0.1:4410/?path=elsewhere', 'http://127.0.0.1:4410/#x', 'http://127.0.0.1:4410/external', '//evil.example/']) {
    await assert.rejects(startStudioServer({ root: 'not-a-project', launchpadUrl }), /project chooser|Invalid URL/);
  }
});
