import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startStudioServer } from '../studio/server.mjs';

async function project(t, tag) {
  const root = await mkdtemp(join(tmpdir(), `will-studio-independent-${tag}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['src/content/home', 'src/content/pages', 'src/content/settings', 'src/content/notes', 'public/images']) await mkdir(join(root, path), { recursive: true });
  const put = async (path, data) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), typeof data === 'string' ? data : JSON.stringify(data)); };
  await put('package.json', { name: `${tag}-project`, type: 'module' });
  await put('astro.config.mjs', 'export default {};');
  await put('.pages.yml', 'components: {}\ncontent: []\n');
  await put('will-studio.config.json', { version: 1, adapter: 'will-astro-v1', project: { name: `${tag} workspace`, siteUrl: `https://${tag}.example.com/` } });
  await put('src/content-schema.ts', `import * as base from ${JSON.stringify(new URL('../src/content-schema.ts', import.meta.url).href)};\nexport const {homeSchema, noteSchema, siteSettingsSchema} = base;\nexport const pageSchema = base.pageSchema.extend({ projectTag: base.pageSchema.shape.title.refine(value => value === ${JSON.stringify(tag)}) });\n`);
  await put('src/content/home/home.json', { title: `${tag} home`, description: 'Independent project.', sections: [{ type: 'text', heading: 'Welcome', body: `${tag} exclusive story` }] });
  await put('src/content/pages/about.json', { title: 'About', projectTag: tag, description: 'About this project.', heading: 'About', published: true, navigation: { show: true, label: 'About', order: 1 }, sections: [{ type: 'text', heading: 'About', body: 'A project introduction.' }] });
  await put('src/content/settings/site.json', { brand: tag, defaultTitle: tag, description: 'Independent project.', themeColor: '#f5f1e8', homeLinks: [], notesNavigation: { label: 'Notes', order: 10 }, footerText: tag, footerLinks: [] });
  return root;
}

test('one Studio runtime serves two independent projects with target-owned schemas and isolated writes', async t => {
  const firstRoot = await project(t, 'alpha'), secondRoot = await project(t, 'beta');
  const beforeSecond = await readFile(join(secondRoot, 'src/content/pages/about.json'), 'utf8');
  const first = await startStudioServer({ root: firstRoot, port: 0, noAstro: true });
  const second = await startStudioServer({ root: secondRoot, port: 0, noAstro: true });
  t.after(async () => { await first.close(); await second.close(); });
  const state = async server => (await fetch(server.url + '/api/state')).json();
  const [a, b] = await Promise.all([state(first), state(second)]);
  assert.notEqual(a.workspace.id, b.workspace.id); assert.equal(a.workspace.project.name, 'alpha workspace'); assert.equal(b.workspace.project.siteUrl, 'https://beta.example.com/');
  assert.equal(a.workspace.originalProject, false); assert.equal(b.workspace.originalProject, false);
  // Neither selected website has a studio/web folder. The shell is served by the runtime.
  assert.match(await (await fetch(first.url)).text(), /Search &amp; commands|Search & commands/);
  assert.match(await (await fetch(second.url + '/command-palette.js')).text(), /createCommandPalette/);
  const document = a.documents.find(doc => doc.id === 'pages/about.json');
  const save = (server, token, data) => fetch(server.url + '/api/document', { method: 'PUT', headers: { Origin: server.url, 'Content-Type': 'application/json', 'x-studio-token': token }, body: JSON.stringify(data) });
  assert.equal((await save(first, a.token, { ...document, data: { ...document.data, projectTag: 'beta' } })).status, 422, 'The selected project schema, not a bundled schema, is enforced.');
  assert.equal((await save(second, a.token, { ...document, data: document.data })).status, 403, 'Tokens cannot cross workspace servers.');
  assert.equal((await save(first, a.token, { ...document, data: { ...document.data, heading: 'Only alpha changed' } })).status, 200);
  assert.equal(await readFile(join(secondRoot, 'src/content/pages/about.json'), 'utf8'), beforeSecond);
  const resultsA = await (await fetch(first.url + '/api/search?q=alpha%20exclusive')).json();
  const resultsB = await (await fetch(second.url + '/api/search?q=alpha%20exclusive')).json();
  assert.equal(resultsA.results.length, 1); assert.equal(resultsB.results.length, 0);
  assert.deepEqual(resultsA.results[0].path, ['sections', '0', 'body']);
  assert.equal((await fetch(first.url + '/api/search?q=' + 'a'.repeat(201))).status, 400);
  assert.equal((await (await fetch(first.url + '/api/history?id=home/home.json')).json()).versions.length, 0, 'Read-only search creates no file versions.');
});
