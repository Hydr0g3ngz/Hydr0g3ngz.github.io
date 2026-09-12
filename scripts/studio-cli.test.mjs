import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseStudioArguments } from '../studio/cli.mjs';
test('project paths, ports and browser options are passed as data, not shell commands', () => {
  const parsed = parseStudioArguments(['--project', 'a folder & name', '--port', '4410', '--astro-port', '4411', '--no-open'], { defaultOpen: true });
  assert.equal(parsed.root, resolve('a folder & name')); assert.equal(parsed.port, 4410); assert.equal(parsed.astroPort, 4411); assert.equal(parsed.open, false);
  assert.equal(parseStudioArguments(['--help']).help, true);
});
test('missing values, typo flags, ambiguous browser options and bad ports are rejected', () => {
  for (const args of [['--project'], ['--port', '0'], ['--port', '1.2'], ['--port', '1e3'], ['--port', '65536'], ['--port', '4311'], ['--open', '--no-open'], ['--project', 'a', '--project', 'b'], ['--unknown']]) assert.throws(() => parseStudioArguments(args));
});
