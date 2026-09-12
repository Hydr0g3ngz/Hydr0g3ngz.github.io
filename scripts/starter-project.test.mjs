import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { inspectStarterProject, createStarterProject, starterCommands } from '../studio/starter-project.mjs';
import { STARTER_FILES, STARTER_DIRECTORIES } from '../studio/starter/template-manifest.mjs';
import { assertCompatibleProject, loadProjectConfig } from '../studio/project-config.mjs';
import { startLaunchpad } from '../studio/launchpad.mjs';

async function fixture(t) {
  const parent = await realpath(tmpdir()), base = await realpath(await mkdtemp(join(parent, 'will-starter-test-')));
  const runtimeRoot = join(base, 'runtime');
  await mkdir(join(runtimeRoot, 'studio/web'), { recursive: true });
  await cp(resolve(import.meta.dirname, '../studio/starter/template'), join(runtimeRoot, 'studio/starter/template'), { recursive: true });
  await writeFile(join(runtimeRoot, 'studio/web/launchpad.html'), '<!doctype html><title>Starter fixture</title>');
  t.after(async () => { assert.equal(dirname(base), parent); assert.match(basename(base), /^will-starter-test-/); await rm(base, { recursive: true, force: true }); });
  const options = { runtimeRoot, path: join(base, 'website'), name: 'A small website' };
  const inspect = changes => inspectStarterProject({ ...options, ...changes });
  const create = async (changes = {}) => { const plan = await inspect(changes); return createStarterProject({ ...options, ...changes, fingerprint: plan.fingerprint }); };
  return { base, runtimeRoot, options, inspect, create };
}

test('review is read-only; exclusive creation produces the full compatible neutral starter, not runtime state', async t => {
  const f = await fixture(t), before = await readdir(f.base), plan = await f.inspect();
  assert.equal(plan.ready, true); assert.deepEqual(plan.files, [...STARTER_FILES]); assert.deepEqual(plan.directories, [...STARTER_DIRECTORIES]);
  assert.deepEqual(await readdir(f.base), before);
  const result = await createStarterProject({ ...f.options, fingerprint: plan.fingerprint });
  assert.deepEqual(result.files, [...STARTER_FILES]); assert.equal(result.directories.length, STARTER_DIRECTORIES.length);
  assert.equal((await assertCompatibleProject(result.project.path)).root, result.project.path);
  assert.equal((await loadProjectConfig(result.project.path)).project.name, f.options.name);
  const rootFiles = await readdir(result.project.path);
  for (const absent of ['node_modules', '.git', '.studio', 'studio', 'package-lock.json']) assert.ok(!rootFiles.includes(absent), absent);
  assert.match(result.commands.powershell, /npm install\nnpm run build$/);
  await assert.rejects(() => f.create(), /not empty/);
});

test('project name stays JSON data and shell instructions quote paths without executing them', async t => {
  const f = await fixture(t), name = '中文 <script> & "A"';
  const result = await f.create({ name });
  const json = async path => JSON.parse(await readFile(join(result.project.path, path), 'utf8'));
  assert.equal((await json('src/content/home/home.json')).title, name);
  assert.equal((await json('src/content/settings/site.json')).brand, name);
  assert.match((await json('package.json')).name, /^[a-z0-9][a-z0-9-]*$/);
  const commands = starterCommands("/tmp/a'b $x `whoami`; echo secret");
  assert.equal(commands.powershell, "Set-Location -LiteralPath '/tmp/a''b $x `whoami`; echo secret'\nnpm install\nnpm run build");
  assert.equal(commands.posix, "cd -- '/tmp/a'\"'\"'b $x `whoami`; echo secret'\nnpm install\nnpm run build");
});

test('empty destinations work but files, nonempty folders, roots, overlap, missing parents, and invalid names fail', async t => {
  const f = await fixture(t), empty = join(f.base, 'empty'); await mkdir(empty);
  await f.create({ path: empty });
  const occupied = join(f.base, 'occupied'); await mkdir(occupied); await writeFile(join(occupied, 'keep.txt'), 'Keep me');
  await assert.rejects(() => f.inspect({ path: occupied }), /not empty/);
  await assert.rejects(() => f.inspect({ path: join(occupied, 'keep.txt') }), /not a file or link/);
  await assert.rejects(() => f.inspect({ path: f.runtimeRoot }), /separate folder/);
  await assert.rejects(() => f.inspect({ path: join(f.runtimeRoot, 'nested') }), /separate folder/);
  await assert.rejects(() => f.inspect({ path: join(f.base, 'missing', 'nested') }), /parent folder/);
  await assert.rejects(() => f.inspect({ path: 'relative' }), /absolute/);
  for (const name of ['', ' ', 'a'.repeat(101), 'a\nb']) await assert.rejects(() => f.inspect({ name }), /project name/);
  assert.equal(await readFile(join(occupied, 'keep.txt'), 'utf8'), 'Keep me');
});

test('review is invalidated by a changed destination or changed template; unrelated existing content stays intact', async t => {
  const f = await fixture(t), plan = await f.inspect();
  await mkdir(f.options.path); await writeFile(join(f.options.path, 'created-elsewhere.txt'), 'External content');
  await assert.rejects(() => createStarterProject({ ...f.options, fingerprint: plan.fingerprint }), /not empty/);
  assert.equal(await readFile(join(f.options.path, 'created-elsewhere.txt'), 'utf8'), 'External content');
  const other = { path: join(f.base, 'other') }, review = await f.inspect(other);
  await writeFile(join(f.runtimeRoot, 'studio/starter/template/README.md'), 'Changed since review.');
  await assert.rejects(() => createStarterProject({ ...f.options, ...other, fingerprint: review.fingerprint }), /changed after review/);
  assert.ok(!(await readdir(f.base)).includes('other'));
});

test('linked paths and replaced empty-folder identities cannot bypass the review', async t => {
  const f = await fixture(t), outside = join(f.base, 'outside'), alias = join(f.base, 'alias'); await mkdir(outside);
  await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => f.inspect({ path: alias }), /file or link/);
  await assert.rejects(() => f.inspect({ path: join(alias, 'nested') }), /symbolic links/);
  const empty = join(f.base, 'empty'); await mkdir(empty); const review = await f.inspect({ path: empty });
  await rename(empty, join(f.base, 'old-empty')); await mkdir(empty);
  await assert.rejects(() => createStarterProject({ ...f.options, path: empty, fingerprint: review.fingerprint }), /changed after review/);
  assert.deepEqual(await readdir(outside), []);
});

test('Launchpad starter APIs require origin/token, explicit review/confirmation, and one-use unexpired tickets', async t => {
  const f = await fixture(t); let clock = Date.now(), starts = 0;
  const launchpad = await startLaunchpad({ runtimeRoot: f.runtimeRoot, port: 0, now: () => clock, startWorkspace: () => { starts++; throw new Error('Must not execute'); } });
  t.after(() => launchpad.close());
  const state = await (await fetch(`${launchpad.url}/api/launchpad/state`)).json();
  const post = async (endpoint, body, headers = {}) => { const response = await fetch(`${launchpad.url}/api/launchpad/starter/${endpoint}`, { method: 'POST', headers: { Origin: launchpad.url, 'Content-Type': 'application/json', 'x-studio-token': state.token, ...headers }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const input = { path: f.options.path, name: f.options.name };
  assert.equal((await post('inspect', input, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await post('inspect', input, { 'x-studio-token': 'wrong' })).status, 403);
  assert.equal((await post('inspect', { ...input, command: 'execute' })).status, 400);
  const review = await post('inspect', input); assert.equal(review.status, 200); assert.ok(review.data.ticket); assert.ok(!('contents' in review.data)); assert.ok(!('fingerprint' in review.data));
  assert.equal((await post('create', { ticket: review.data.ticket })).status, 400);
  const result = await post('create', { ticket: review.data.ticket, createProject: true }); assert.equal(result.status, 201);
  assert.equal((await post('create', { ticket: review.data.ticket, createProject: true })).status, 409);
  const expiring = await post('inspect', { ...input, path: join(f.base, 'expired') }); clock += 6 * 60_000;
  assert.equal((await post('create', { ticket: expiring.data.ticket, createProject: true })).status, 409);
  assert.equal(starts, 0); assert.deepEqual((await (await fetch(`${launchpad.url}/api/launchpad/state`)).json()).recent, []);
  assert.equal((await fetch(`${launchpad.url}/studio/starter/template/package.json`)).status, 404);
});
