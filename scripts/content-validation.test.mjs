import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dump } from 'js-yaml';
import { validateContent } from './validate-content.mjs';

const text = { type: 'text', id: 'reading', heading: 'Reading', body: 'A small shelf.', visible: true };
const home = { title: 'Will Qing', description: 'A quiet homepage.', sections: [text] };
const page = { title: 'About', description: 'About Will.', heading: 'About', published: true, navigation: { show: true, label: 'About', order: 10 }, sections: [text] };
const settings = { brand: 'WQ', defaultTitle: 'Will Qing', description: 'A quiet homepage.', themeColor: '#f5f1e8', homeLinks: [{ label: 'Reading', href: '/#reading', order: 1, visible: true }], notesNavigation: { label: 'Notes', order: 20 }, footerText: 'Will Qing', footerLinks: [] };
const note = { title: 'First impressions', description: 'Notes on reading.', date: '2026-09-12', category: 'Books', published: true };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'will-content-gate-'));
  async function put(path, contents) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents));
  }
  await put('src/content/home/home.json', home);
  await put('src/content/settings/site.json', settings);
  await put('src/content/pages/about.json', page);
  await put('.pages.yml', 'content: [{name: home}]\ncomponents: {}\nmedia: [{name: images}]\n');
  await put('public/images/picture.png', Buffer.from('placeholder image bytes'));
  const putNote = (path, frontmatter = note, body = 'Some thoughts.') => put(`src/content/notes/${path}`, `---\n${dump(frontmatter)}---\n\n${body}\n`);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, put, putNote, check: () => validateContent({ root }) };
}

test('valid content passes while hidden content and drafts may have unfinished assets', async (t) => {
  const { put, putNote, check } = await fixture(t);
  const draftImage = { type: 'image_text', heading: 'An image', body: 'A draft caption.', image: '/images/later.png', imageAlt: 'A forthcoming photo' };
  await put('src/content/pages/draft.json', { ...page, published: false, sections: [draftImage] });
  await put('src/content/home/home.json', { ...home, sections: [text, { ...draftImage, visible: false }] });
  await putNote('draft.md', { ...note, published: false, cover: '/images/later.png', coverAlt: 'A forthcoming photo' }, '![Later](/images/also-later.png)');
  await putNote('empty-draft.md', { ...note, published: false }, '');
  await putNote('published.md', note, '![A small image][picture]\n\n[picture]: /images/picture.png\n\n```md\n![Example only](/images/not-a-real-file.png)\n```');
  const result = check();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.images, 1);
});

test('the shared schema catches malformed JSON content and invalid note metadata', async (t) => {
  const { put, putNote, check } = await fixture(t);
  await put('src/content/pages/about.json', { ...page, sections: [{ type: 'not-a-block' }] });
  await putNote('bad.md', { ...note, date: 'not-a-date', category: 'Invalid' });
  await put('src/content/notes/no-frontmatter.md', 'No frontmatter here.');
  const result = check();
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('sections.0.type')));
  assert.ok(result.errors.some((error) => error.includes('bad.md.date')));
  assert.ok(result.errors.some((error) => error.includes('bad.md.category')));
  assert.ok(result.errors.some((error) => error.includes('require YAML frontmatter')));
});

test('route aliases, casing, note index aliases, slug overrides, and reserved subpaths are checked', async (t) => {
  const { put, putNote, check } = await fixture(t);
  await put('src/content/pages/reading.json', page);
  await put('src/content/pages/Reading/index.json', page);
  await put('src/content/pages/another.json', { ...page, slug: 'READING' });
  await put('src/content/pages/__studio/about.json', page);
  await putNote('book.md');
  await putNote('book/index.md');
  const result = check();
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => error.includes('route "/reading" is also used')).length, 2);
  assert.ok(result.errors.some((error) => error.includes('route "/notes/book" is also used')));
  assert.ok(result.errors.some((error) => error.includes('"__studio" is a reserved page route')));
});

test('visible anchors must be unique and visible navigation cannot target a hidden section', async (t) => {
  const { put, check } = await fixture(t);
  await put('src/content/home/home.json', { ...home, sections: [text, { ...text }] });
  assert.ok(check().errors.some((error) => error.includes('duplicate anchor "reading"')));
  await put('src/content/home/home.json', { ...home, sections: [{ ...text, visible: false }] });
  assert.ok(check().errors.some((error) => error.includes('missing or hidden homepage anchor')));
  await put('src/content/settings/site.json', { ...settings, homeLinks: [{ ...settings.homeLinks[0], visible: false }] });
  assert.equal(check().ok, true);
});

test('published note covers and Markdown images require existing local files and descriptions', async (t) => {
  const { putNote, check } = await fixture(t);
  await putNote('cover.md', { ...note, cover: '/images/no-cover.png', coverAlt: 'A cover' });
  await putNote('markdown.md', note, '![Missing](/images/no-inline.png)\n\n![](/images/picture.png)\n\n<img src="/images/another-missing.png" alt="Missing HTML image">');
  await putNote('empty.md', note, '');
  const result = check();
  assert.equal(result.ok, false);
  for (const filename of ['no-cover.png', 'no-inline.png', 'another-missing.png']) assert.ok(result.errors.some((error) => error.includes(filename)));
  assert.ok(result.errors.some((error) => error.includes('non-empty description')));
  assert.ok(result.errors.some((error) => error.includes('published notes need some text')));
});

test('image traversal, encoded escapes, oversized files, and symlinked assets are blocked', async (t) => {
  const { root, put, putNote, check } = await fixture(t);
  await put('public/images/large.png', Buffer.alloc(2 * 1024 * 1024 + 1));
  await putNote('paths.md', note, '![Escape](/images/../../package.json)\n\n![Encoded](/images/%2e%2e/private.png)\n\n![Large](/images/large.png)');
  await symlink(join(root, 'src'), join(root, 'public/images/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = check();
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('must point directly inside')));
  assert.ok(result.errors.some((error) => error.includes('larger than 2 MB')));
  assert.ok(result.errors.some((error) => error.includes('symlinks or junctions')));
});

test('local Studio files remain allowed locally but cannot enter the public website', async (t) => {
  const { put, check } = await fixture(t);
  await put('.studio/previews/local-only.json', { private: true });
  assert.equal(check().ok, true);
  await put('public/.studio/previews/leaked.json', { private: true });
  assert.ok(check().errors.some((error) => error.includes('must not be copied into the public website')));
});
