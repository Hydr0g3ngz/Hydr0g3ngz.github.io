import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { packageStudio, parsePackageArguments, PACKAGE_DEPENDENCIES, STUDIO_PACKAGE_FILES } from './package-studio.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'studio-package-test-'));
  const sourceRoot = join(base, 'source');
  const out = join(base, 'independent-studio');
  const put = async (path, contents) => {
    await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
    await writeFile(join(sourceRoot, path), contents);
  };
  for (const [from] of STUDIO_PACKAGE_FILES) await put(from, `// Generic export fixture: ${from}\n`);
  await put('package.json', JSON.stringify({ name: 'private-personal-site', scripts: { postinstall: 'UNAUTHORIZED_COMMAND' }, dependencies: Object.fromEntries(PACKAGE_DEPENDENCIES.map(name => [name, '^1.2.3'])), devDependencies: { 'unlisted-package': 'file:../secret' } }));
  await put('package-lock.json', JSON.stringify({ name: 'private-personal-site', lockfileVersion: 3, packages: {} }));
  await put('Start Studio.cmd', '@echo off\r\nnode scripts\\studio-launch.mjs\r\n');
  await put('studio/DISTRIBUTION_README.md', '# A generic local editor\n');
  t.after(async () => {
    const path = await realpath(base);
    assert.equal(dirname(path), await realpath(tmpdir()));
    assert.ok(basename(path).startsWith('studio-package-test-'));
    await rm(path, { recursive: true, force: true });
  });
  return { base, sourceRoot, out, put };
}

test('explicit allowlist exports only generic runtime, reference code, tests and generated package metadata', async (t) => {
  const { sourceRoot, out, put } = await fixture(t);
  const forbidden = ['src/content/home/home.json', 'public/images/private.jpg', '.env', '.git/config', '.studio/history/private.json', 'studio/web/generated/writer.js', 'studio/web/unlisted-secret.js', 'studio/integration.mjs', 'will-studio.config.json'];
  for (const path of forbidden) await put(path, 'PRIVATE_CONTENT_MUST_NOT_BE_EXPORTED');
  const lockfile = await readFile(join(sourceRoot, 'package-lock.json'), 'utf8');
  const result = await packageStudio({ sourceRoot, out });
  assert.equal(result.out, await realpath(out));
  assert.equal(result.lockfileNeedsRefresh, true);
  assert.ok(result.files.includes('reference/adapter/src/studio-adapter/preview.astro'));
  assert.ok(result.files.includes('studio/cli.mjs'));
  assert.ok(result.files.includes('studio/web/workspace-storage.js'));
  for (const path of forbidden) await assert.rejects(access(join(out, path)));
  const data = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
  assert.equal(data.name, '@willqing/will-studio');
  assert.equal(data.version, '0.4.0');
  assert.ok(result.files.includes('studio/launchpad.mjs'));
  assert.ok(result.files.includes('studio/web/launchpad.html'));
  assert.ok(result.files.includes('studio/web/section-library.js'));
  assert.ok(result.files.includes('studio/web/section-draft.js'));
  assert.equal(data.private, true);
  assert.equal(data.license, 'UNLICENSED');
  assert.equal(data.engines.node, '>=24');
  assert.equal(data.scripts.start, 'node studio/server.mjs');
  assert.equal(data.scripts.postinstall, undefined);
  assert.equal(data.devDependencies['unlisted-package'], undefined);
  assert.match(data.scripts.test, /scripts\/studio-cli.test.mjs/);
  assert.equal(await readFile(join(out, 'package-lock.json'), 'utf8'), lockfile);
  assert.equal(await readFile(join(out, 'README.md'), 'utf8'), '# A generic local editor\n');
  assert.match(await readFile(join(out, 'Start Studio.cmd'), 'utf8'), /node scripts\\studio-launch\.mjs %\*/);
  const workflow = await readFile(join(out, '.github/workflows/check.yml'), 'utf8');
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build:writer/);
  assert.doesNotMatch(workflow, /pages: write|id-token: write/);
  for (const path of result.files) assert.ok(!(await readFile(join(out, path), 'utf8')).includes('PRIVATE_CONTENT_MUST_NOT_BE_EXPORTED'));
  await assert.rejects(access(join(out, 'node_modules')));
  await assert.rejects(access(join(out, '.git')));
});

test('nonempty destinations are preserved, while an explicitly empty directory is accepted', async (t) => {
  const { sourceRoot, out } = await fixture(t);
  await mkdir(out);
  await writeFile(join(out, 'keep.txt'), 'keep these bytes');
  await assert.rejects(packageStudio({ sourceRoot, out }), /not empty/);
  assert.deepEqual(await readdir(out), ['keep.txt']);
  assert.equal(await readFile(join(out, 'keep.txt'), 'utf8'), 'keep these bytes');
  const empty = join(dirname(out), 'separate-empty-directory');
  await mkdir(empty);
  const result = await packageStudio({ sourceRoot, out: empty });
  assert.ok(result.fileCount > 0);
});

test('relative output, source, source ancestor, and source descendants are rejected without writes', async (t) => {
  const { base, sourceRoot } = await fixture(t);
  for (const out of ['relative-path', sourceRoot, base, join(sourceRoot, 'dist-studio')]) await assert.rejects(packageStudio({ sourceRoot, out }), /absolute|separate/);
  await assert.rejects(access(join(sourceRoot, 'dist-studio')));
  assert.equal(JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')).name, 'private-personal-site');
});

test('linked output and linked output ancestors cannot redirect export writes', async (t) => {
  const { base, sourceRoot, out } = await fixture(t);
  const external = join(base, 'outside');
  await mkdir(external);
  await symlink(external, out, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packageStudio({ sourceRoot, out }), /Linked/);
  await assert.rejects(packageStudio({ sourceRoot, out: join(out, 'nested') }), /Linked/);
  assert.deepEqual(await readdir(external), []);
});

test('linked allowlisted files and missing sources fail preflight before creating an output directory', async (t) => {
  const { base, sourceRoot, out } = await fixture(t);
  const path = join(sourceRoot, 'studio/server.mjs');
  await unlink(path);
  await assert.rejects(packageStudio({ sourceRoot, out }));
  await assert.rejects(access(out));
  const external = join(base, 'external-source');
  await mkdir(external);
  await symlink(external, path, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packageStudio({ sourceRoot, out }), /Linked/);
  await assert.rejects(access(out));
});

test('unversioned package dependency sources and changed launcher syntax need explicit review', async (t) => {
  const { sourceRoot, out, put } = await fixture(t);
  const data = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  data.dependencies.astro = 'file:../other-project';
  await put('package.json', JSON.stringify(data));
  await assert.rejects(packageStudio({ sourceRoot, out }), /versioned dependency/);
  await assert.rejects(access(out));
  data.dependencies.astro = '^1.2.3';
  await put('package.json', JSON.stringify(data));
  await put('Start Studio.cmd', 'node some-unreviewed-launcher.mjs\n');
  await assert.rejects(packageStudio({ sourceRoot, out }), /launcher changed/);
  await assert.rejects(access(out));
});

test('CLI accepts only one explicit absolute output argument', () => {
  const out = join(tmpdir(), 'chosen-export');
  assert.deepEqual(parsePackageArguments(['--out', out]), { out });
  for (const args of [[], ['--out'], ['--out', 'relative'], ['--out', out, '--force'], ['--source', out]]) assert.throws(() => parsePackageArguments(args), /Usage/);
});

test('Windows short source paths export normally and short output aliases cannot bypass overlap guards', { skip: process.platform !== 'win32' }, async (t) => {
  const { base, sourceRoot } = await fixture(t);
  const canonicalBase = await realpath(base);
  let shortBase;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:STUDIO_SHORT_PATH_FIXTURE).ShortPath"], { env: { ...process.env, STUDIO_SHORT_PATH_FIXTURE: canonicalBase }, windowsHide: true, timeout: 10_000 });
    shortBase = stdout.trim();
  } catch (error) { t.skip(`Windows short-path lookup is unavailable: ${error.code ?? error.message}`); return; }
  if (!shortBase || resolve(shortBase).toLowerCase() === canonicalBase.toLowerCase()) { t.skip('8.3 aliases are not enabled for this fixture volume.'); return; }
  const shortSource = join(shortBase, 'source');
  assert.equal(await realpath(shortSource), await realpath(sourceRoot));
  for (const out of [shortSource, shortBase, join(shortSource, 'nested-export')]) await assert.rejects(packageStudio({ sourceRoot: await realpath(sourceRoot), out }), /separate/);
  const result = await packageStudio({ sourceRoot: shortSource, out: join(shortBase, 'new-export') });
  assert.equal(result.out, join(canonicalBase, 'new-export'));
  assert.ok(result.fileCount > 0);
});
