import test from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { defaultStudioProject, parseStudioArguments, studioServerArguments } from '../studio/cli.mjs';
test('project paths, ports and browser options are passed as data, not shell commands', () => {
  const parsed = parseStudioArguments(['--project', 'a folder & name', '--port', '4410', '--astro-port', '4411', '--no-open'], { defaultOpen: true });
  assert.equal(parsed.root, resolve('a folder & name')); assert.equal(parsed.port, 4410); assert.equal(parsed.astroPort, 4411); assert.equal(parsed.open, false);
  assert.equal(parseStudioArguments(['--help']).help, true);
});
test('missing values, typo flags, ambiguous browser options and bad ports are rejected', () => {
  for (const args of [['--project'], ['--port', '0'], ['--port', '1.2'], ['--port', '1e3'], ['--port', '65536'], ['--project', 'a', '--port', '4311'], ['--open', '--no-open'], ['--project', 'a', '--project', 'b'], ['--unknown'], ['--project', 'a', '--choose-project'], ['--choose-project', '--astro-port', '4511'], ['--no-astro']]) assert.throws(() => parseStudioArguments(args));
});

test('standalone startup and explicit chooser never pass an unselected project to the workspace server', () => {
  const entry = resolve('studio/server.mjs');
  const standalone = parseStudioArguments([], { defaultOpen: true });
  assert.equal(standalone.root, undefined);
  assert.deepEqual(studioServerArguments(standalone, entry), [entry, '--port', '4310', '--choose-project', '--open']);
  const chosen = parseStudioArguments(['--choose-project', '--port', '4410'], { defaultProject: resolve('website') });
  assert.equal(chosen.root, undefined);
  assert.deepEqual(studioServerArguments(chosen, entry), [entry, '--port', '4410', '--choose-project']);
  const direct = parseStudioArguments(['--project', 'a folder & name', '--no-astro']);
  assert.deepEqual(studioServerArguments(direct, entry), [entry, '--port', '4310', '--project', resolve('a folder & name'), '--astro-port', '4311', '--no-astro']);
});

test('only a bundled website retains its implicit project; discovery reads no executable config', async t => {
  const created = await mkdtemp(join(tmpdir(), 'studio-startup-mode-'));
  const root = await realpath(created);
  t.after(async () => { assert.equal(dirname(root), await realpath(tmpdir())); assert.ok(basename(root).startsWith('studio-startup-mode-')); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, 'package.json'), '{"scripts":{"postinstall":"DO NOT EXECUTE"}}');
  assert.equal(await defaultStudioProject(root), undefined);
  await writeFile(join(root, '.pages.yml'), 'components: {}');
  assert.equal(await defaultStudioProject(root), root);
  assert.equal(parseStudioArguments([], { defaultProject: root }).root, root);
});
