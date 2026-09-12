import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { startLaunchpad, workspacePortCandidates } from '../studio/launchpad.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await delay(10); }
  assert.fail('The expected asynchronous cleanup did not finish.');
}
async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return server;
}
async function stop(server) {
  if (!server?.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
}
async function fixture(t, options = {}) {
  const parent = await realpath(tmpdir());
  const base = await realpath(await mkdtemp(join(parent, 'will-launchpad-test-')));
  const runtimeRoot = join(base, 'runtime');
  const launchpads = [], workspaces = [], externalServers = [], calls = [];
  const put = async (root, suffix, data) => {
    const path = join(root, suffix);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data));
  };
  await put(runtimeRoot, 'studio/web/launchpad.html', '<!doctype html><title>Launchpad fixture</title>');
  await put(runtimeRoot, 'studio/web/launchpad.js', '/* launchpad fixture */');
  await put(runtimeRoot, 'studio/web/launchpad.css', 'body { color: black; }');
  await put(runtimeRoot, '.env', 'PRIVATE_LAUNCHPAD_FIXTURE=do-not-serve');
  t.after(async () => {
    await Promise.allSettled(launchpads.map(value => value.close()));
    await Promise.allSettled(workspaces.map(value => value.close()));
    await Promise.allSettled(externalServers.map(stop));
    assert.equal(dirname(base), parent);
    assert.match(basename(base), /^will-launchpad-test-/);
    await rm(base, { recursive: true, force: true });
  });
  const project = async (name = 'alpha') => {
    const root = join(base, name);
    for (const suffix of ['src/content/notes', 'public/images']) await mkdir(join(root, suffix), { recursive: true });
    const sentinel = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(base, 'executed.txt'))}, 'executed'); throw new Error('Inspection must not execute project code');`;
    await put(root, 'package.json', { name: `${name}-website`, type: 'module', scripts: { preinstall: sentinel } });
    await put(root, 'will-studio.config.json', { version: 1, adapter: 'will-astro-v1', project: { name: `${name} website`, siteUrl: `https://${name}.example.com/` } });
    await put(root, 'astro.config.mjs', sentinel);
    await put(root, 'src/content-schema.ts', sentinel);
    await put(root, '.pages.yml', 'components: {}\ncontent: []\n');
    await put(root, 'src/content/home/home.json', { title: name });
    await put(root, 'src/content/settings/site.json', { brand: name });
    await put(root, 'src/content/pages/about.json', { title: 'About' });
    await put(root, 'src/studio-adapter/integration.mjs', sentinel);
    await put(root, 'src/studio-adapter/preview.astro', `---\n${sentinel}\n---\n<h1>Preview</h1>`);
    await put(root, 'node_modules/astro/package.json', { name: 'astro', exports: { '.': './dist/index.js' } });
    await put(root, 'node_modules/astro/dist/index.js', sentinel);
    return root;
  };
  const makeWorkspace = async (args, extra = {}) => {
    const server = await listen(createServer((_, response) => response.end('Workspace')), args.port);
    let astro;
    try { astro = await listen(createPortServer(), args.astroPort); }
    catch (error) { await stop(server); throw error; }
    let closed = false;
    const workspace = {
      server, astro, port: args.port, url: `http://127.0.0.1:${args.port}`, ready: Promise.resolve(true),
      previewStatus: () => ({ ready: true, error: null }), closeCount: 0,
      async close() { if (closed) return; closed = true; workspace.closeCount++; await Promise.all([stop(server), stop(astro)]); },
      ...extra
    };
    workspaces.push(workspace);
    return workspace;
  };
  const start = async (overrides = {}) => {
    const launchpad = await startLaunchpad({
      runtimeRoot, port: 0,
      startWorkspace: async args => { calls.push(args); return options.startWorkspace ? options.startWorkspace(args, makeWorkspace) : makeWorkspace(args); },
      ...options.launchpad, ...overrides
    });
    launchpads.push(launchpad);
    return launchpad;
  };
  return { base, runtimeRoot, put, project, start, calls, workspaces, externalServers, makeWorkspace };
}
async function client(launchpad) {
  const initial = await (await fetch(`${launchpad.url}/api/launchpad/state`)).json();
  return {
    initial,
    async post(path, data, overrides = {}) {
      const response = await fetch(`${launchpad.url}/api/launchpad/${path}`, {
        method: 'POST', headers: { Origin: launchpad.url, 'Content-Type': 'application/json', 'x-studio-token': initial.token, ...overrides.headers },
        body: JSON.stringify(data), ...overrides
      });
      return { status: response.status, body: await response.json() };
    },
    state: async () => (await fetch(`${launchpad.url}/api/launchpad/state`)).json()
  };
}
async function inspect(api, root) {
  const result = await api.post('inspect', { path: root });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ready, true, JSON.stringify(result.body));
  assert.match(result.body.ticket, /^[a-f0-9]{24}$/);
  return result.body;
}
const open = (api, ticket) => api.post('open', { ticket, trustProject: true });
async function rawRequest(launchpad, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: launchpad.port, path, headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject); request.end();
  });
}
const registryPath = fixture => join(fixture.runtimeRoot, '.studio/projects.json');

test('Launchpad exposes only fixed local files and protected JSON endpoints', async t => {
  const f = await fixture(t), root = await f.project(), launchpad = await f.start(), api = await client(launchpad);
  assert.match(api.initial.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(api.initial.recent, []);
  assert.match(await (await fetch(launchpad.url)).text(), /Launchpad fixture/);
  for (const path of ['/.env', '/studio/server.mjs', '/src/content/home/home.json', '/unknown']) assert.equal((await fetch(launchpad.url + path)).status, 404);
  assert.equal((await rawRequest(launchpad, '/%2e%2e/.env')).status, 400);
  assert.equal((await rawRequest(launchpad, '/api/launchpad/state', { Host: `evil.example:${launchpad.port}` })).status, 403);
  assert.equal((await rawRequest(launchpad, '/api/launchpad/state', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await rawRequest(launchpad, '/', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await api.post('inspect', { path: root }, { headers: { Origin: launchpad.url, 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await api.post('inspect', { path: root }, { headers: { Origin: 'https://evil.example', 'x-studio-token': api.initial.token, 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await api.post('inspect', { path: root }, { headers: { Origin: launchpad.url, 'x-studio-token': api.initial.token, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await api.post('inspect', { path: 'relative/project' })).status, 400);
  assert.equal((await api.post('inspect', JSON.parse(`{"path":${JSON.stringify(root)},"__proto__":{}}`))).status, 400);
  assert.equal((await api.post('open', { path: root, trustProject: true })).status, 400);
  assert.equal((await api.post('inspect', { path: 'x'.repeat(20_000) })).status, 413);
  assert.equal(f.calls.length, 0);
  await assert.rejects(stat(registryPath(f)), { code: 'ENOENT' });
});

test('inspection never executes selected code or records trust, and missing prerequisites issue no ticket', async t => {
  const f = await fixture(t), root = await f.project(), api = await client(await f.start());
  const result = await inspect(api, root);
  assert.equal(result.project.path, await realpath(root));
  assert.equal(result.project.name, 'alpha website');
  assert.equal(result.project.siteUrl, 'https://alpha.example.com/');
  assert.equal(result.checks.filter(check => check.status === 'error').length, 0);
  await assert.rejects(stat(join(f.base, 'executed.txt')), { code: 'ENOENT' });
  await assert.rejects(stat(registryPath(f)), { code: 'ENOENT' });
  assert.equal(f.calls.length, 0);
  const missingAdapter = await f.project('missing-adapter');
  await rm(join(missingAdapter, 'src/studio-adapter/preview.astro'));
  const badAdapter = (await api.post('inspect', { path: missingAdapter })).body;
  assert.equal(badAdapter.ready, false); assert.equal(badAdapter.ticket, undefined);
  assert.ok(badAdapter.checks.some(check => check.label === 'Preview adapter' && check.status === 'error'));
  const missingDependencies = await f.project('missing-dependencies');
  await rm(join(missingDependencies, 'node_modules/astro/package.json'));
  const badDependencies = (await api.post('inspect', { path: missingDependencies })).body;
  assert.equal(badDependencies.ready, false); assert.equal(badDependencies.ticket, undefined);
  assert.ok(badDependencies.checks.some(check => check.label === 'Website dependencies' && check.status === 'error'));
});

test('open requires explicit trust, waits for readiness, records only public fields, and rejects replay', async t => {
  let ready;
  const readiness = new Promise(resolve => { ready = resolve; });
  const f = await fixture(t, { startWorkspace: (args, make) => make(args, { ready: readiness }) });
  const root = await f.project(), launchpad = await f.start(), api = await client(launchpad), plan = await inspect(api, root);
  assert.equal((await api.post('open', { ticket: plan.ticket, trustProject: false })).status, 400);
  const pending = open(api, plan.ticket);
  await until(() => f.workspaces.length === 1);
  assert.deepEqual((await api.state()).recent, []);
  ready(true);
  const result = await pending;
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(f.calls[0].root, await realpath(root));
  assert.equal(f.calls[0].launchpadUrl, launchpad.url);
  assert.equal(result.body.url, `http://127.0.0.1:${f.calls[0].port}`);
  assert.equal((await open(api, plan.ticket)).status, 409);
  const state = await api.state();
  assert.equal(state.recent.length, 1); assert.equal(state.recent[0].running, true);
  assert.equal(state.recent[0].port, undefined); assert.equal(state.recent[0].url, result.body.url);
  const registry = JSON.parse(await readFile(registryPath(f), 'utf8'));
  assert.deepEqual(Object.keys(registry.projects[0]).sort(), ['astroPort', 'id', 'lastOpenedAt', 'name', 'path', 'port', 'siteUrl']);
  assert.deepEqual(state.warnings, []);
});

test('expired tickets and changed metadata or trusted source need a fresh inspection', async t => {
  let time = Date.now();
  const f = await fixture(t, { launchpad: { now: () => time } }), root = await f.project(), api = await client(await f.start());
  const expired = await inspect(api, root); time += 300_001;
  assert.equal((await open(api, expired.ticket)).status, 409);
  const changed = await inspect(api, root);
  await f.put(root, 'src/content-schema.ts', '// changed after inspection');
  assert.equal((await open(api, changed.ticket)).status, 409);
  const changedConfig = await inspect(api, root);
  await f.put(root, 'will-studio.config.json', { version: 1, adapter: 'will-astro-v1', project: { name: 'Replaced metadata' } });
  assert.equal((await open(api, changedConfig.ticket)).status, 409);
  assert.equal(f.calls.length, 0);
});

test('project ancestor junctions and linked dependency directories are rejected without execution', async t => {
  const f = await fixture(t), root = await f.project(), api = await client(await f.start());
  const linked = join(f.base, 'project-link');
  try { await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('This runner cannot create directory links.'); return; } throw error; }
  const result = await api.post('inspect', { path: linked });
  assert.equal(result.status, 200); assert.equal(result.body.ready, false);
  assert.match(result.body.checks[0].detail, /junction|symbolic link/i);
  const other = await f.project('other'), linkedDeps = join(other, 'node_modules/astro');
  await rm(linkedDeps, { recursive: true });
  await symlink(join(root, 'node_modules/astro'), linkedDeps, process.platform === 'win32' ? 'junction' : 'dir');
  const dependencies = await api.post('inspect', { path: other });
  assert.equal(dependencies.body.ready, false);
  assert.equal(dependencies.body.ticket, undefined);
  assert.equal(f.calls.length, 0);
});

test('concurrent tickets for one canonical project reuse a single live workspace and keep valid registry JSON', async t => {
  const f = await fixture(t, { startWorkspace: async (args, make) => { await delay(20); return make(args); } });
  const root = await f.project(), api = await client(await f.start());
  const [a, b] = await Promise.all([inspect(api, root), inspect(api, root)]);
  const [first, second] = await Promise.all([open(api, a.ticket), open(api, b.ticket)]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body.url, second.body.url); assert.equal(f.calls.length, 1);
  const recent = (await api.state());
  assert.equal(recent.recent.length, 1); assert.deepEqual(recent.warnings, []);
  const record = JSON.parse(await readFile(registryPath(f), 'utf8')).projects[0];
  assert.equal(record.workspace, undefined); assert.equal(record.url, undefined);
});

test('busy ports are skipped, independent workspaces get pairs, and a fourth never stops existing servers', async t => {
  const f = await fixture(t), launchpad = await f.start(), api = await client(launchpad);
  const blockedPort = launchpad.port + 3;
  if (blockedPort > 65535) { t.skip('Ephemeral Launchpad port has no following pair.'); return; }
  const external = createPortServer();
  try { await listen(external, blockedPort); }
  catch (error) { if (error.code === 'EADDRINUSE') { t.skip('The candidate port is already occupied by another process.'); return; } throw error; }
  f.externalServers.push(external);
  for (const name of ['alpha', 'beta', 'gamma']) {
    const plan = await inspect(api, await f.project(name));
    assert.equal((await open(api, plan.ticket)).status, 200);
  }
  assert.equal(new Set(f.calls.flatMap(call => [call.port, call.astroPort])).size, 6);
  assert.ok(f.calls.every(call => call.port !== blockedPort && call.astroPort !== blockedPort));
  assert.ok(f.calls[0].port >= launchpad.port + 4 || f.calls[0].port < launchpad.port, 'Allocation skips the occupied pair, including a safe wrap at the port ceiling.');
  const fourth = await inspect(api, await f.project('delta'));
  assert.equal((await open(api, fourth.ticket)).status, 409);
  assert.equal(f.calls.length, 3); assert.equal(external.listening, true);
  assert.ok(f.workspaces.every(workspace => workspace.server.listening && workspace.closeCount === 0));
});

test('recent projects remember safe workspace ports across Launchpad restarts', async t => {
  const f = await fixture(t), root = await f.project(), first = await f.start(), api = await client(first);
  const plan = await inspect(api, root), opened = await open(api, plan.ticket);
  assert.equal(opened.status, 200);
  await first.close();
  assert.equal(f.workspaces[0].server.listening, false);
  const second = await f.start({ port: first.port }), again = await client(second);
  assert.equal(again.initial.recent[0].running, false); assert.equal(again.initial.recent[0].url, undefined);
  const reviewed = await inspect(again, root), reopened = await open(again, reviewed.ticket);
  assert.equal(reopened.status, 200); assert.equal(reopened.body.url, opened.body.url);
});

test('corrupt or URL-injecting registries are never overwritten and temporary opening still works', async t => {
  const f = await fixture(t), root = await f.project();
  const broken = '{"version":1,"projects":[';
  await f.put(f.runtimeRoot, '.studio/projects.json', broken);
  const api = await client(await f.start());
  assert.equal(api.initial.warnings.length, 1); assert.deepEqual(api.initial.recent, []);
  const plan = await inspect(api, root), opened = await open(api, plan.ticket);
  assert.equal(opened.status, 200); assert.equal(opened.body.warnings.length, 1);
  assert.equal(await readFile(registryPath(f), 'utf8'), broken);
  assert.equal((await api.state()).recent[0].running, true);
  const injected = JSON.stringify({ version: 1, projects: [{ ...plan.project, port: 4400, astroPort: 4401, lastOpenedAt: new Date().toISOString(), url: 'https://evil.example/' }] });
  await f.put(f.runtimeRoot, '.studio/projects.json', injected);
  const reviewed = await inspect(api, root);
  assert.equal((await open(api, reviewed.ticket)).status, 200);
  assert.equal(await readFile(registryPath(f), 'utf8'), injected);
  assert.notEqual((await api.state()).recent[0].url, 'https://evil.example/');
});

test('a linked registry ancestor is left untouched while a temporary workspace can open', async t => {
  const f = await fixture(t), root = await f.project(), elsewhere = join(f.base, 'outside-registry');
  await mkdir(elsewhere);
  await f.put(elsewhere, 'projects.json', 'original external data');
  try { await symlink(elsewhere, join(f.runtimeRoot, '.studio'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('This runner cannot create directory links.'); return; } throw error; }
  const api = await client(await f.start()), plan = await inspect(api, root);
  const opened = await open(api, plan.ticket);
  assert.equal(opened.status, 200); assert.ok(opened.body.warnings.length);
  assert.equal(await readFile(join(elsewhere, 'projects.json'), 'utf8'), 'original external data');
});

test('forget removes only the recent entry and reopening reuses its still-live workspace', async t => {
  const f = await fixture(t), root = await f.project(), api = await client(await f.start()), plan = await inspect(api, root);
  const opened = await open(api, plan.ticket);
  const forgotten = await api.post('forget', { id: plan.project.id });
  assert.equal(forgotten.status, 200); assert.deepEqual(forgotten.body.recent, []);
  assert.deepEqual(JSON.parse(await readFile(registryPath(f), 'utf8')).projects, []);
  assert.equal(f.workspaces[0].server.listening, true); assert.equal(f.workspaces[0].closeCount, 0);
  assert.equal((await stat(join(root, 'src/content/home/home.json'))).isFile(), true);
  const reviewed = await inspect(api, root), reopened = await open(api, reviewed.ticket);
  assert.equal(reopened.body.url, opened.body.url); assert.equal(f.calls.length, 1);
  assert.equal((await api.state()).recent.length, 1);
});

test('failed readiness closes owned servers and never records the project', async t => {
  const f = await fixture(t, { startWorkspace: (args, make) => make(args, { ready: Promise.resolve(false), previewStatus: () => ({ ready: false, error: 'Fixture preview failed' }) }) });
  const api = await client(await f.start()), plan = await inspect(api, await f.project());
  const result = await open(api, plan.ticket);
  assert.equal(result.status, 502); assert.match(result.body.error, /Fixture preview failed/);
  assert.equal(f.workspaces[0].server.listening, false); assert.equal(f.workspaces[0].astro.listening, false);
  assert.deepEqual((await api.state()).recent, []);
  await assert.rejects(stat(registryPath(f)), { code: 'ENOENT' });
});

test('a starter resolving after timeout is still closed and cannot register itself', async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { launchpad: { startupTimeoutMs: 35 }, startWorkspace: async (args, make) => { const handle = await make(args); await waiting; return handle; } });
  const api = await client(await f.start()), plan = await inspect(api, await f.project());
  const result = await open(api, plan.ticket);
  assert.equal(result.status, 504);
  release(); await until(() => f.workspaces[0]?.closeCount === 1);
  assert.equal(f.workspaces[0].server.listening, false); assert.equal(f.workspaces[0].astro.listening, false);
  assert.deepEqual((await api.state()).recent, []);
});

test('shutdown rejects in-flight opening and cleans a handle returned after shutdown', async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { startWorkspace: async (args, make) => { const handle = await make(args); await waiting; return handle; } });
  const launchpad = await f.start(), api = await client(launchpad), plan = await inspect(api, await f.project());
  const pending = open(api, plan.ticket).catch(error => ({ networkError: error }));
  await until(() => f.workspaces.length === 1);
  await launchpad.close();
  release(); await until(() => f.workspaces[0].closeCount === 1);
  const result = await pending;
  assert.ok(result.networkError || result.status === 503);
  assert.equal(launchpad.server.listening, false); assert.equal(f.workspaces[0].server.listening, false);
  await assert.rejects(stat(registryPath(f)), { code: 'ENOENT' });
});

test('a port taken between probing and workspace startup reports a safe retry without stopping its owner', async t => {
  let external;
  const f = await fixture(t, { startWorkspace: async (args, make) => {
    external = await listen(createPortServer(), args.port);
    f.externalServers.push(external);
    return make(args);
  } });
  const api = await client(await f.start()), plan = await inspect(api, await f.project());
  const result = await open(api, plan.ticket);
  assert.equal(result.status, 409); assert.match(result.body.error, /port.*taken|taken.*port/i);
  assert.equal(external.listening, true);
  assert.deepEqual((await api.state()).recent, []);
  await assert.rejects(stat(registryPath(f)), { code: 'ENOENT' });
});

test('oversized and over-count registries are rejected without being replaced', async t => {
  const f = await fixture(t), root = await f.project();
  const oversized = ' '.repeat(2 * 1024 * 1024 + 1);
  await f.put(f.runtimeRoot, '.studio/projects.json', oversized);
  const api = await client(await f.start()), plan = await inspect(api, root);
  assert.ok(api.initial.warnings.length);
  assert.equal((await open(api, plan.ticket)).status, 200);
  assert.equal(await readFile(registryPath(f), 'utf8'), oversized);
  const overCount = JSON.stringify({ version: 1, projects: Array.from({ length: 21 }, () => ({})) });
  await f.put(f.runtimeRoot, '.studio/projects.json', overCount);
  const reviewed = await inspect(api, root);
  assert.equal((await open(api, reviewed.ticket)).status, 200);
  assert.equal(await readFile(registryPath(f), 'utf8'), overCount);
  assert.ok((await api.state()).warnings.length);
});

test('replacing the inspected project directory with an identical copy invalidates the ticket', async t => {
  const f = await fixture(t), root = await f.project(), api = await client(await f.start());
  const plan = await inspect(api, root);
  const previous = join(f.base, 'previous-project');
  await rename(root, previous);
  await cp(previous, root, { recursive: true, errorOnExist: true, force: false });
  assert.equal((await open(api, plan.ticket)).status, 409);
  assert.equal(f.calls.length, 0);
  const fresh = await inspect(api, root);
  assert.equal((await open(api, fresh.ticket)).status, 200);
});

test('Windows short paths normalize to one project identity and one workspace', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), root = await f.project('long-project-directory'), api = await client(await f.start());
  let shortPath;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:STUDIO_LAUNCHPAD_SHORT_FIXTURE).ShortPath'], { env: { ...process.env, STUDIO_LAUNCHPAD_SHORT_FIXTURE: root }, windowsHide: true, timeout: 10_000 });
    shortPath = stdout.trim();
  } catch (error) { t.skip(`Windows short-path lookup is unavailable: ${error.code ?? error.message}`); return; }
  if (!shortPath || resolve(shortPath).toLowerCase() === root.toLowerCase()) { t.skip('8.3 aliases are not enabled for this fixture volume.'); return; }
  const canonical = await inspect(api, root), short = await inspect(api, shortPath);
  assert.deepEqual(short.project, canonical.project);
  const [first, second] = await Promise.all([open(api, canonical.ticket), open(api, short.ticket)]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body.url, second.body.url); assert.equal(f.calls.length, 1);
});

test('a stopped workspace cannot claim readiness or leave its preview running', async t => {
  const f = await fixture(t, { startWorkspace: async (args, make) => {
    const workspace = await make(args);
    await stop(workspace.server);
    return workspace;
  } });
  const api = await client(await f.start()), plan = await inspect(api, await f.project());
  const result = await open(api, plan.ticket);
  assert.equal(result.status, 502); assert.match(result.body.error, /stopped/);
  assert.equal(f.workspaces[0].astro.listening, false);
  assert.deepEqual((await api.state()).recent, []);
});

test('shutdown closes a known workspace while its preview readiness is still pending', async t => {
  const f = await fixture(t, { startWorkspace: (args, make) => make(args, { ready: new Promise(() => {}) }) });
  const launchpad = await f.start(), api = await client(launchpad), plan = await inspect(api, await f.project());
  const pending = open(api, plan.ticket).catch(error => ({ networkError: error }));
  await until(() => f.workspaces.length === 1);
  await launchpad.close();
  const result = await pending;
  assert.ok(result.networkError || result.status === 503);
  assert.equal(f.workspaces[0].closeCount, 1);
  assert.equal(f.workspaces[0].server.listening, false); assert.equal(f.workspaces[0].astro.listening, false);
  await assert.rejects(stat(registryPath(f)), { code: 'ENOENT' });
});

test('candidate allocation wraps high explicit and ephemeral ports with a bounded preferred-first list', () => {
  for (const boundPort of [65533, 65534, 65535]) {
    const pairs = workspacePortCandidates(boundPort);
    assert.deepEqual(pairs[0], { port: 1024, astroPort: 1025 });
    assert.equal(pairs.length, 100);
    assert.equal(new Set(pairs.map(pair => pair.port)).size, 100);
    assert.ok(pairs.every(pair => pair.port >= 1024 && pair.astroPort <= 65535 && pair.astroPort === pair.port + 1));
  }
  const preferred = { port: 4312, astroPort: 4313 };
  assert.deepEqual(workspacePortCandidates(65535, preferred)[0], preferred);
  const deduplicated = workspacePortCandidates(65533, { port: 1024, astroPort: 1025 });
  assert.equal(deduplicated.length, 100);
  assert.equal(new Set(deduplicated.map(pair => pair.port)).size, 100);
  assert.deepEqual(workspacePortCandidates(65532).slice(0, 2), [{ port: 65534, astroPort: 65535 }, { port: 1024, astroPort: 1025 }]);
  assert.deepEqual(workspacePortCandidates(4310)[0], { port: 4312, astroPort: 4313 });
});

test('Launchpad on 65533 opens on a probed lower pair and leaves occupied wraparound ports alone', async t => {
  const f = await fixture(t), root = await f.project();
  let launchpad;
  try { launchpad = await f.start({ port: 65533 }); }
  catch (error) { if (['EADDRINUSE', 'EACCES'].includes(error.code)) { t.skip('The high Launchpad port is unavailable on this runner.'); return; } throw error; }
  const occupied = createPortServer();
  let owned = false;
  try { await listen(occupied, 1025); owned = true; f.externalServers.push(occupied); }
  catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; }
  const api = await client(launchpad), plan = await inspect(api, root);
  const opened = await open(api, plan.ticket);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.ok(f.calls[0].port >= 1026 && f.calls[0].port < 65533);
  assert.equal(f.calls[0].astroPort, f.calls[0].port + 1);
  if (owned) assert.equal(occupied.listening, true);
  assert.equal(launchpad.server.listening, true);
  await launchpad.close();
  const restarted = await f.start({ port: 65533 }), again = await client(restarted), reviewed = await inspect(again, root);
  assert.equal((await open(again, reviewed.ticket)).body.url, opened.body.url, 'The saved lower pair still takes priority after restart.');
  if (owned) assert.equal(occupied.listening, true);
});
