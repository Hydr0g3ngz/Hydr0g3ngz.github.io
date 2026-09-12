import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dependencyFingerprint, dependencyDecision, supportsNode, missingRequiredModules, freshMissingRequiredModules, inspectDependencies, ensureDependencies, REQUIRED_MODULES, isProjectPreviewProcess, isPortActive, assertNoRunningPreview } from './studio-launch.mjs';

const environment = { manifest: '{"name":"fixture"}', lockfile: '{"lockfileVersion":3}', nodeVersion: '24.2.0', platform: 'win32', arch: 'x64' };

test('Node.js 24 or newer is required, including on direct launcher invocation', () => {
  for (const version of ['24.0.0', '24.10.3', '25.0.0']) assert.equal(supportsNode(version), true);
  for (const version of ['22.20.0', '23.11.1', '18.0.0', '', 'newest', '24']) assert.equal(supportsNode(version), false);
});

test('lockfile, manifest, Node major, platform and architecture changes invalidate the fingerprint', () => {
  const original = dependencyFingerprint(environment);
  assert.equal(dependencyFingerprint({ ...environment }), original);
  assert.equal(dependencyFingerprint({ ...environment, nodeVersion: '24.20.0' }), original, 'Same-major Node updates do not needlessly reinstall.');
  for (const change of [{ lockfile: '{"lockfileVersion":3,"changed":true}' }, { manifest: '{"name":"changed"}' }, { nodeVersion: '25.0.0' }, { platform: 'linux' }, { arch: 'arm64' }]) {
    assert.notEqual(dependencyFingerprint({ ...environment, ...change }), original);
  }
});

test('only a matching fingerprint AND complete modules can skip installation', () => {
  const fingerprint = dependencyFingerprint(environment);
  const stamp = { version: 1, fingerprint };
  assert.equal(dependencyDecision({ fingerprint, stamp }).installNeeded, false);
  for (const invalidStamp of [null, {}, { version: 0, fingerprint }, { version: 1, fingerprint: 'old' }, { version: 1, fingerprint: null }]) {
    assert.equal(dependencyDecision({ fingerprint, stamp: invalidStamp }).installNeeded, true);
  }
  assert.equal(dependencyDecision({ fingerprint, stamp, missingModules: ['astro'] }).installNeeded, true);
});

test('module resolution rejects missing packages and dependencies inherited from a parent folder', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'studio-launch-resolution-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const root = join(fixture, 'project');
  await mkdir(join(root, 'node_modules', 'local-fixture'), { recursive: true });
  await mkdir(join(fixture, 'node_modules', 'parent-fixture'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{}');
  for (const [base, name] of [[root, 'local-fixture'], [fixture, 'parent-fixture']]) {
    await writeFile(join(base, 'node_modules', name, 'package.json'), '{"main":"index.js"}');
    await writeFile(join(base, 'node_modules', name, 'index.js'), 'module.exports = true;');
  }
  assert.deepEqual(missingRequiredModules(root, ['local-fixture', 'parent-fixture', 'missing-fixture']), ['parent-fixture', 'missing-fixture']);
});

test('missing or malformed project inputs fail without attempting an install', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-launch-inputs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(inspectDependencies(root, { nodeVersion: '22.0.0' }), /requires Node.js 24/);
  await writeFile(join(root, 'package.json'), '{}');
  await assert.rejects(inspectDependencies(root), /Cannot read package-lock.json/);
  await writeFile(join(root, 'package-lock.json'), 'not-json');
  await assert.rejects(inspectDependencies(root), /package-lock.json is not valid JSON/);
});

test('warm launches never call installation or write the stamp', async () => {
  let installs = 0;
  let writes = 0;
  const installed = await ensureDependencies('fixture', {
    inspect: async () => ({ installNeeded: false, reason: 'Current.' }),
    install: async () => { installs++; },
    save: async () => { writes++; },
    log: () => {}
  });
  assert.equal(installed, false);
  assert.equal(installs, 0);
  assert.equal(writes, 0);
});

test('successful installation writes a stamp only after module verification', async () => {
  const events = [];
  const installed = await ensureDependencies('fixture', {
    inspect: async () => { events.push('inspect'); return { installNeeded: true, reason: 'Changed.', fingerprint: 'new', missingModules: [], stampPath: 'fixture-stamp' }; },
    assertIdle: async () => { events.push('idle'); },
    install: async () => { events.push('install'); },
    save: async (path, content) => { events.push('save'); assert.equal(path, 'fixture-stamp'); assert.deepEqual(JSON.parse(content), { version: 1, fingerprint: 'new' }); },
    log: () => {}
  });
  assert.equal(installed, true);
  assert.deepEqual(events, ['inspect', 'idle', 'install', 'inspect', 'save']);
});

test('failed, incomplete, or concurrently changed installations never write a success stamp', async () => {
  for (const failure of ['npm', 'missing', 'changed']) {
    let inspections = 0;
    let writes = 0;
    const operation = ensureDependencies('fixture', {
      assertIdle: async () => {},
      inspect: async () => {
        inspections++;
        return { installNeeded: true, reason: 'Changed.', fingerprint: failure === 'changed' && inspections > 1 ? 'changed' : 'new', missingModules: failure === 'missing' && inspections > 1 ? ['astro'] : [], stampPath: 'fixture-stamp' };
      },
      install: async () => { if (failure === 'npm') throw new Error('mock install failure'); },
      save: async () => { writes++; },
      log: () => {}
    });
    await assert.rejects(operation, failure === 'npm' ? /installation failed/ : failure === 'missing' ? /still unavailable/ : /changed during installation/);
    assert.equal(writes, 0);
  }
});

test('a real absent or partially installed fixture resolves freshly after installation and then skips a warm install', async t => {
  for (const partial of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'studio-launch-fresh-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, 'package.json'), '{"name":"studio-test-fixture"}');
    await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}');
    if (partial) {
      // Prime both package metadata and missing-entry lookups before replacing
      // the package, matching a interrupted npm ci's partially populated tree.
      await mkdir(join(root, 'node_modules', 'astro'), { recursive: true });
      await writeFile(join(root, 'node_modules', 'astro', 'package.json'), '{"main":"old-missing.js"}');
    }
    assert.ok((await inspectDependencies(root)).missingModules.includes('astro'));
    assert.ok(missingRequiredModules(root).includes('astro'), 'Also prime the parent Node process cache.');
    let installs = 0;
    const install = async () => {
      installs++;
      for (const name of REQUIRED_MODULES) {
        const path = join(root, 'node_modules', name);
        await mkdir(path, { recursive: true });
        await writeFile(join(path, 'package.json'), '{"main":"installed.js"}');
        await writeFile(join(path, 'installed.js'), 'module.exports = true;');
      }
    };
    assert.equal(await ensureDependencies(root, { install, assertIdle: async () => {}, log: () => {} }), true);
    assert.deepEqual(await freshMissingRequiredModules(root), []);
    const after = await inspectDependencies(root);
    assert.equal(after.installNeeded, false);
    assert.equal(JSON.parse(await readFile(after.stampPath, 'utf8')).fingerprint, after.fingerprint);
    assert.equal(await ensureDependencies(root, { install, assertIdle: async () => {}, log: () => {} }), false);
    assert.equal(installs, 1, 'No actual npm command is used, and a warm launch skips the fixture installer.');
  }
});

test('project process matching detects old Studio/Astro without matching unrelated Node or similarly named checkouts', () => {
  const root = resolveFixtureRoot();
  for (const path of ['studio/server.mjs', 'studio/astro-preview.mjs', 'node_modules/astro/astro.js', 'node_modules/@astrojs/compiler/dist/index.js']) {
    assert.equal(isProjectPreviewProcess(root, { pid: 987654, commandLine: `node "${join(root, path)}"` }), true);
  }
  assert.equal(isProjectPreviewProcess(root, { pid: process.pid, commandLine: `node "${join(root, 'studio/server.mjs')}"` }), false);
  assert.equal(isProjectPreviewProcess(root, { pid: 987654, commandLine: `node "${join(root + '-other', 'studio/server.mjs')}"` }), false);
  assert.equal(isProjectPreviewProcess(root, { pid: 987654, commandLine: `node "${join(root, 'scripts/static-qa.mjs')}"` }), false);
});

function resolveFixtureRoot() { return join(tmpdir(), 'studio-owned-process-fixture'); }

test('running project processes, occupied IPv4/IPv6 ports, and failed inspections block before any install', async () => {
  const root = resolveFixtureRoot();
  const cases = [
    { listProcesses: async () => [{ pid: 987654, commandLine: `node "${join(root, 'studio/astro-preview.mjs')}"` }], portActive: async () => false },
    { listProcesses: async () => [], portActive: async (port, host) => port === 4311 && host === '127.0.0.1' },
    { listProcesses: async () => [], portActive: async (port, host) => port === 4310 && host === '::1' },
    { listProcesses: async () => { throw new Error('inspection denied'); }, portActive: async () => false }
  ];
  for (const options of cases) {
    let installs = 0;
    let saves = 0;
    await assert.rejects(ensureDependencies(root, {
      inspect: async () => ({ installNeeded: true, reason: 'Changed.' }),
      assertIdle: candidate => assertNoRunningPreview(candidate, options),
      install: async () => { installs++; },
      save: async () => { saves++; },
      log: () => {}
    }), /(?:Close|close).*No (?:processes|dependencies)/s);
    assert.equal(installs, 0);
    assert.equal(saves, 0);
  }
  await assert.doesNotReject(assertNoRunningPreview(root, { listProcesses: async () => [], portActive: async () => false }));
});

test('the real loopback probe notices a listening service and becomes clear after it closes', async t => {
  // Native TCP fixture only: never launches Astro, Studio, or any music player.
  const server = createServer(socket => socket.end());
  t.after(() => { if (server.listening) server.close(); });
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolveListen); });
  const port = server.address().port;
  assert.equal(await isPortActive(port), true);
  await assert.rejects(assertNoRunningPreview(resolveFixtureRoot(), { listProcesses: async () => [], ports: [port] }), /local development ports/);
  await new Promise(resolveClose => server.close(resolveClose));
  assert.equal(await isPortActive(port), false);
});
