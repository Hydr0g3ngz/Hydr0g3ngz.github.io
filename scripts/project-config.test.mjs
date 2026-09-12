import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertCompatibleProject, loadProjectConfig, PROJECT_ADAPTER, ProjectConfigError } from '../studio/project-config.mjs';

const config = { version: 1, adapter: PROJECT_ADAPTER, project: { name: 'Will Qing', siteUrl: 'https://example.com/a-site/' } };
const isConfigError = (error) => error instanceof ProjectConfigError && error.code === 'STUDIO_PROJECT_CONFIG';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'will-project-config-'));
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('will-project-config-'));
    await rm(target, { recursive: true, force: true });
  });
  const put = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const path of ['src/content/pages', 'src/content/notes', 'public/images']) await mkdir(join(root, path), { recursive: true });
  await put('package.json', { name: '@local/my-small-website', scripts: { postinstall: 'DO NOT EXECUTE', build: 'DO NOT EXECUTE' } });
  await put('astro.config.mjs', 'throw new Error("The config loader must not execute Astro configuration");');
  await put('.pages.yml', 'components: {}\ncontent: []\n');
  await put('src/content-schema.ts', 'throw new Error("The config loader must not import this schema");');
  for (const path of ['src/content/home/home.json', 'src/content/settings/site.json', 'src/content/pages/about.json']) await put(path, {});
  return { root, put };
}

test('explicit version 1 configuration yields only safe frozen metadata without running code', async (t) => {
  const { root, put } = await fixture(t);
  await put('will-studio.config.json', config);
  const result = await loadProjectConfig(root);
  assert.deepEqual(result, { ...config, configSource: 'file', warnings: [] });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.project), true);
  assert.ok(!JSON.stringify(result).includes(root));
  assert.ok(!JSON.stringify(result).includes('DO NOT EXECUTE'));
  const canonical = await realpath(root);
  assert.deepEqual(await assertCompatibleProject(root), { root: canonical, schemaPath: join(canonical, 'src/content-schema.ts'), contentRoot: join(canonical, 'src/content') });
});

test('legacy naming uses package name without guessing site URL or executing scripts', async (t) => {
  const { root } = await fixture(t);
  const result = await loadProjectConfig(root);
  assert.equal(result.configSource, 'legacy');
  assert.deepEqual(result.project, { name: 'My Small Website' });
  assert.equal(result.warnings.length, 1);
  await assert.rejects(loadProjectConfig(root, { allowLegacy: false }), isConfigError);
});

test('legacy projects without a valid package label use a neutral fallback', async (t) => {
  const { root, put } = await fixture(t);
  for (const value of [{}, { name: 123 }, { name: 'x'.repeat(101) }]) {
    await put('package.json', value);
    assert.equal((await loadProjectConfig(root)).project.name, 'Local Website');
  }
  await put('package.json', 'null');
  await assert.rejects(loadProjectConfig(root), isConfigError);
});

test('malformed or null configuration never silently falls back to legacy mode', async (t) => {
  const { root, put } = await fixture(t);
  for (const source of ['{', 'null', '[]', '"text"', 'export default {}', 'true']) {
    await put('will-studio.config.json', source);
    await assert.rejects(loadProjectConfig(root), isConfigError);
  }
});

test('unknown keys, prototype-shaped data, versions, and adapters fail explicitly', async (t) => {
  const { root, put } = await fixture(t);
  for (const value of [
    { ...config, version: 2 }, { ...config, version: '1' },
    { ...config, adapter: './malicious.mjs' },
    { ...config, command: 'echo unsafe' },
    { ...config, project: { name: 'Test', siteURL: 'https://example.com/' } },
    { ...config, project: { name: 'Test', contentDirectory: '../../secrets' } },
    JSON.parse('{"version":1,"adapter":"will-astro-v1","project":{"name":"Test"},"__proto__":{"polluted":true}}')
  ]) {
    await put('will-studio.config.json', value);
    await assert.rejects(loadProjectConfig(root), isConfigError);
  }
  assert.equal({}.polluted, undefined);
});

test('project names are trimmed, bounded, and cannot include control characters', async (t) => {
  const { root, put } = await fixture(t);
  for (const name of ['', '   ', 'x'.repeat(101), 'Line\nBreak', 'Tab\tHere', 'Delete\u007f', 123, null]) {
    await put('will-studio.config.json', { ...config, project: { name } });
    await assert.rejects(loadProjectConfig(root), isConfigError);
  }
  await put('will-studio.config.json', { ...config, project: { name: '  Personal Website  ' } });
  assert.deepEqual((await loadProjectConfig(root)).project, { name: 'Personal Website' });
});

test('site URLs require explicit HTTPS and reject credentials, control characters, queries, and fragments', async (t) => {
  const { root, put } = await fixture(t);
  for (const siteUrl of ['http://example.com', 'http://localhost:4310', '//example.com', 'javascript:alert(1)', 'https://name:secret@example.com', 'https://example.com?search=x', 'https://example.com/#part', 'https://example.com?', 'https://example.com#', 'https://example.com\n', 'https://example.com\\elsewhere', '', null]) {
    await put('will-studio.config.json', { ...config, project: { name: 'Test', siteUrl } });
    await assert.rejects(loadProjectConfig(root), isConfigError);
  }
  await put('will-studio.config.json', { ...config, project: { name: 'Test', siteUrl: 'https://EXAMPLE.com/my-site/' } });
  assert.equal((await loadProjectConfig(root)).project.siteUrl, 'https://example.com/my-site/');
});

test('configuration and legacy package reads have hard size limits', async (t) => {
  const { root, put } = await fixture(t);
  await put('will-studio.config.json', ' '.repeat(32 * 1024 + 1));
  await assert.rejects(loadProjectConfig(root), isConfigError);
  await unlink(join(root, 'will-studio.config.json'));
  await put('package.json', ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(loadProjectConfig(root), isConfigError);
});

test('missing required files and directory/file mismatches identify an incompatible project', async (t) => {
  const { root } = await fixture(t);
  await unlink(join(root, 'src/content-schema.ts'));
  await assert.rejects(loadProjectConfig(root), (error) => isConfigError(error) && /src\/content-schema\.ts/.test(error.message));
  await mkdir(join(root, 'src/content-schema.ts'));
  await assert.rejects(assertCompatibleProject(root), isConfigError);
  await assert.rejects(loadProjectConfig(join(root, 'missing')), isConfigError);
});

test('configuration and required-file symlinks cannot read outside the selected checkout', async (t) => {
  const { root } = await fixture(t);
  const external = await fixture(t);
  await external.put('will-studio.config.json', config);
  // File symlinks need elevation on some Windows hosts. Junctions exercise the
  // same refusal at these file paths without requiring that system privilege.
  await symlink(process.platform === 'win32' ? external.root : join(external.root, 'will-studio.config.json'), join(root, 'will-studio.config.json'), process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(loadProjectConfig(root), (error) => isConfigError(error) && /Linked/.test(error.message));
  await unlink(join(root, 'will-studio.config.json'));
  await unlink(join(root, 'src/content-schema.ts'));
  await symlink(process.platform === 'win32' ? external.root : join(external.root, 'src/content-schema.ts'), join(root, 'src/content-schema.ts'), process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(assertCompatibleProject(root), isConfigError);
});

test('a linked project root or ancestor directory is refused rather than followed', async (t) => {
  const selected = await fixture(t);
  const outside = await fixture(t);
  const link = join(selected.root, 'linked-project');
  await symlink(outside.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  const linkError = (error) => isConfigError(error) && /symbolic link or directory junction/.test(error.message);
  await assert.rejects(loadProjectConfig(link), linkError);
  await assert.rejects(loadProjectConfig(join(link, 'src')), linkError);
  // The final project directory is ordinary; only its selected ancestor is a link.
  const ancestor = join(selected.root, 'linked-parent');
  await symlink(dirname(outside.root), ancestor, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(loadProjectConfig(join(ancestor, basename(outside.root))), linkError);
});

test('Windows 8.3 project paths normalize without being mistaken for junctions', { skip: process.platform !== 'win32' }, async (t) => {
  const { root, put } = await fixture(t);
  await put('will-studio.config.json', config);
  const canonical = await realpath(root);
  let shortPath;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:STUDIO_SHORT_PATH_FIXTURE).ShortPath"], { env: { ...process.env, STUDIO_SHORT_PATH_FIXTURE: canonical }, windowsHide: true, timeout: 10_000 });
    shortPath = stdout.trim();
  } catch (error) { t.skip(`Windows short-path lookup is unavailable: ${error.code ?? error.message}`); return; }
  if (!shortPath || resolve(shortPath).toLowerCase() === canonical.toLowerCase()) { t.skip('8.3 aliases are not enabled for this fixture volume.'); return; }
  assert.equal(await realpath(shortPath), canonical);
  assert.deepEqual(await loadProjectConfig(shortPath), await loadProjectConfig(canonical));
  assert.equal((await assertCompatibleProject(shortPath)).root, canonical);
});

test('optional paths are checked when present; configuration loading never modifies files', async (t) => {
  const { root, put } = await fixture(t);
  await put('will-studio.config.json', config);
  const before = await readFile(join(root, 'will-studio.config.json'), 'utf8');
  await loadProjectConfig(root);
  assert.equal(await readFile(join(root, 'will-studio.config.json'), 'utf8'), before);
  await mkdir(join(root, 'src/redirects.json'));
  await assert.rejects(assertCompatibleProject(root), isConfigError);
});
