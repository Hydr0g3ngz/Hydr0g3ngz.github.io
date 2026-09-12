import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { STARTER_FILES, STARTER_DIRECTORIES } from '../studio/starter/template-manifest.mjs';
import { createSectionDraft } from '../studio/web/section-draft.js';
import { assertCompatibleProject, loadProjectConfig } from '../studio/project-config.mjs';
import { blockSchema, homeSchema, pageSchema, noteSchema, siteSettingsSchema } from '../studio/starter/template/src/content-schema.ts';
import { validateContent } from '../studio/starter/template/scripts/validate-content.mjs';
import studioAdapter from '../studio/starter/template/src/studio-adapter/integration.mjs';

const root = await realpath(fileURLToPath(new URL('../studio/starter/template/', import.meta.url)));
const read = path => readFile(join(root, path), 'utf8');
const json = async path => JSON.parse(await read(path));
const types = ['hero', 'marquee', 'shelf', 'work', 'closing', 'text', 'image_text', 'list', 'quote', 'profile', 'reading', 'listening'];

async function files(path = root) {
  const results = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    assert.equal(entry.isSymbolicLink(), false, 'A template cannot contain links.');
    if (entry.isDirectory()) results.push(...await files(target));
    else results.push(relative(root, target).split(sep).join('/'));
  }
  return results;
}
const flatten = items => items.flatMap(item => item.items ? flatten(item.items) : [item]);

test('the finite manifest exactly describes regular template files and all required directories', async () => {
  assert.equal(Object.isFrozen(STARTER_FILES), true); assert.equal(Object.isFrozen(STARTER_DIRECTORIES), true);
  assert.equal(STARTER_FILES.length, new Set(STARTER_FILES).size);
  assert.equal(STARTER_DIRECTORIES.length, new Set(STARTER_DIRECTORIES).size);
  assert.deepEqual((await files()).sort(), [...STARTER_FILES].sort());
  for (const path of [...STARTER_FILES, ...STARTER_DIRECTORIES]) {
    assert.ok(path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => ['.', '..', ''].includes(part)));
    assert.equal((await lstat(join(root, path))).isSymbolicLink(), false);
  }
  for (const path of STARTER_FILES) {
    assert.equal((await lstat(join(root, path))).isFile(), true);
    const parent = relative(root, dirname(join(root, path))).split(sep).join('/');
    if (parent) assert.ok(STARTER_DIRECTORIES.includes(parent), `Missing parent ${parent}`);
  }
  for (const path of STARTER_DIRECTORIES) assert.equal((await lstat(join(root, path))).isDirectory(), true);
  assert.ok(STARTER_FILES.includes('src/content/notes/.gitkeep'));
  assert.ok(STARTER_FILES.includes('public/images/.gitkeep'));
});

test('the starter satisfies the fixed project contract with neutral editable JSON metadata', async () => {
  assert.equal((await assertCompatibleProject(root)).root, root);
  const config = await loadProjectConfig(root, { allowLegacy: false });
  assert.equal(config.adapter, 'will-astro-v1'); assert.deepEqual(config.project, { name: 'My website' });
  const home = homeSchema.parse(await json('src/content/home/home.json'));
  const about = pageSchema.parse(await json('src/content/pages/about.json'));
  const settings = siteSettingsSchema.parse(await json('src/content/settings/site.json'));
  assert.equal(home.title, 'My website'); assert.equal(settings.defaultTitle, 'My website'); assert.equal(settings.brand, 'My site');
  assert.deepEqual(home.sections.map(section => section.type), ['hero', 'text']);
  assert.deepEqual(about.sections.map(section => section.type), ['text']);
  assert.equal(about.published, true); assert.equal(about.navigation.show, true);
  const actual = await files();
  assert.deepEqual(actual.filter(path => path.startsWith('src/content/')).sort(), ['src/content/home/home.json', 'src/content/notes/.gitkeep', 'src/content/pages/about.json', 'src/content/settings/site.json']);
  assert.equal(settings.homeLinks[0].href, '/#getting-started');
  assert.ok(home.sections.some(section => section.id === 'getting-started'));
  assert.deepEqual(await json('src/redirects.json'), { version: 1, redirects: [] });
});

test('initial content passes the actual production gate and draft/page/note schema behavior remains intact', async () => {
  const checked = validateContent({ root });
  assert.deepEqual(checked.errors, []);
  const about = await json('src/content/pages/about.json');
  assert.equal(pageSchema.parse({ ...about, published: false, sections: [] }).published, false);
  const note = noteSchema.parse({ title: 'A note', description: 'An observation.', date: '2026-01-01', category: 'Other' });
  assert.equal(note.published, false);
  assert.equal(noteSchema.parse({ ...note, published: true }).published, true);
  assert.match(await read('src/pages/[...slug].astro'), /getCollection\('pages', \(\{ data \}\) => data\.published\)/);
  assert.match(await read('src/pages/notes/[...slug].astro'), /getCollection\('notes', \(\{ data \}\) => data\.published\)/);
});

test('all twelve offered layouts use neutral CMS descriptors and create schema-valid sections', async () => {
  const config = load(await read('.pages.yml'));
  assert.deepEqual(Object.keys(config.components).sort(), [...types].sort());
  const contents = flatten(config.content);
  for (const document of contents.filter(item => item.fields.some(field => field.name === 'sections'))) {
    const blocks = document.fields.find(field => field.name === 'sections').blocks;
    assert.deepEqual(blocks.map(block => block.name).sort(), [...types].sort());
    for (const ref of blocks) {
      const section = createSectionDraft({ type: ref.name, component: ref.component, components: config.components, media: [{ path: '/images/own-upload.png' }], sections: [] });
      const parsed = blockSchema.safeParse(section);
      assert.equal(parsed.success, true, `${document.name}/${ref.name}: ${JSON.stringify(parsed.error?.issues)}`);
      if (['image_text', 'shelf'].includes(ref.name)) assert.throws(() => createSectionDraft({ type: ref.name, component: ref.component, components: config.components, media: [], sections: [] }), /Upload an image/);
    }
  }
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image') assert.equal(value.default, undefined, 'No field may borrow an image from another website.');
    Object.values(value).forEach(visit);
  };
  visit(config);
});

test('the package contains only exact proven website dependencies and no editor runtime or hosting setup', async () => {
  const pkg = await json('package.json');
  assert.equal(pkg.name, 'my-website'); assert.equal(pkg.private, true); assert.equal(pkg.engines.node, '>=24');
  assert.deepEqual(pkg.dependencies, { astro: '7.2.10', marked: '18.0.12', 'sanitize-html': '2.17.7', 'js-yaml': '5.4.1' });
  assert.deepEqual(pkg.devDependencies, { '@astrojs/check': '0.9.10', '@types/node': '24.13.3', '@types/sanitize-html': '2.16.1', typescript: '6.0.3' });
  assert.match(pkg.devDependencies['@types/node'], /^24\.\d+\.\d+$/, 'Node 24 typings must be an exact direct dependency, not an inherited or transitive one.');
  assert.deepEqual((await json('tsconfig.json')).compilerOptions.types, ['node'], 'The generated website must explicitly load Node typings on every platform.');
  assert.ok(pkg.scripts.build.includes('validate:content') && pkg.scripts.build.includes('astro build') && pkg.scripts.build.includes('validate:output'));
  assert.equal(Object.keys(pkg.scripts).some(name => /install|prepare|post|publish/.test(name)), false);
  assert.equal(STARTER_FILES.some(path => /(^|\/)(?:node_modules|\.git|\.github|\.studio|dist|\.astro|uploads)(\/|$)|(?:server|launchpad|writer)\.(?:m?js|css)$/.test(path)), false);
  assert.equal(STARTER_FILES.some(path => path.startsWith('studio/')), false);
  assert.equal(STARTER_FILES.some(path => path === 'package-lock.json'), false, 'The selected installation generates its own matching lockfile.');
  assert.doesNotMatch(await read('astro.config.mjs'), /\bsite\s*:|@astrojs\/sitemap/);
  const ignored = await read('.gitignore');
  for (const path of ['.studio/', '.astro/', 'node_modules/', 'dist/', '.env']) assert.ok(ignored.split('\n').includes(path));
});

test('template code and field descriptions contain no copied personal identity or selected works', async () => {
  const personal = /Will Qing|Yunshu Qing|Will[’']s|WILL’S|\bSJTU\b|Jiao Tong|hydr0g3ngz|Linkin Park|Billie Eilish|Olivia Dean|孙燕姿|苏轼|一个人的朝圣|Man(?:chester)? United/i;
  for (const path of STARTER_FILES) assert.doesNotMatch(await read(path), personal, path);
  for (const path of ['src/content/home/home.json', 'src/content/pages/about.json', 'src/content/settings/site.json', '.pages.yml']) {
    assert.doesNotMatch(await read(path), /Song ci|宋词|网易云|Bilibili|NetEase|books-library\.jpg/i, path);
  }
  for (const path of ['src/styles/global.css', 'src/styles/culture.css']) assert.doesNotMatch(await read(path), /@import|url\(\s*["']?https?:/i, path);
  assert.doesNotMatch(await read('src/layouts/Base.astro'), /(?:href|src)=["']https?:/);
  assert.match(await read('public/favicon.svg'), /^<svg/);
  assert.equal((await files()).filter(path => path.startsWith('public/') && path !== 'public/images/.gitkeep').length, 1);
});

test('the website-owned preview adapter cannot inject Studio into production builds', () => {
  const before = process.env.STUDIO_PREVIEW;
  const injected = [];
  try {
    process.env.STUDIO_PREVIEW = '1';
    const hook = studioAdapter().hooks['astro:config:setup'];
    hook({ command: 'build', injectRoute: route => injected.push(route) });
    assert.equal(injected.length, 0);
    hook({ command: 'dev', injectRoute: route => injected.push(route) });
    assert.equal(injected.length, 1); assert.equal(injected[0].pattern, '/__studio/preview');
    delete process.env.STUDIO_PREVIEW;
    hook({ command: 'dev', injectRoute: route => injected.push(route) });
    assert.equal(injected.length, 1);
  } finally { if (before === undefined) delete process.env.STUDIO_PREVIEW; else process.env.STUDIO_PREVIEW = before; }
});
