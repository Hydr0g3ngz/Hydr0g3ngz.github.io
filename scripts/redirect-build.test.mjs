import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'astro';
import { redirectMap } from './redirects.mjs';

test('static build emits navigable old-address HTML without a server adapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'will-redirect-build-'));
  let linked = false;
  try {
    await symlink(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
    await mkdir(join(root, 'src/pages'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(root, 'src/pages/new.astro'), '<html lang="en"><head><title>New page</title></head><body><h1>New page</h1></body></html>');
    const redirects = redirectMap({ version: 1, redirects: [{ from: '/old', to: '/intermediate' }, { from: '/intermediate', to: '/new' }] });
    await build({ root, configFile: false, site: 'https://example.invalid', output: 'static', redirects, logLevel: 'silent', devToolbar: { enabled: false } });
    for (const route of ['old', 'intermediate']) {
      const html = await readFile(join(root, 'dist', route, 'index.html'), 'utf8');
      assert.match(html, /http-equiv="refresh"/);
      assert.match(html, /url=\/new/);
      assert.match(html, /href="\/new"/);
    }
  } finally {
    if (linked) await unlink(join(root, 'node_modules'));
    // Remove only the fresh, uniquely named fixture, never a project directory.
    if (resolve(root).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')) && root.includes('will-redirect-build-')) await rm(root, { recursive: true, force: true });
  }
});
