import test from 'node:test';
import assert from 'node:assert/strict';
import { redirectMap } from './redirects.mjs';

const manifest = (...redirects) => ({ version: 1, redirects });
test('redirect map flattens chains and accepts only published destinations', () => {
  const result = redirectMap(manifest({ from: '/old', to: '/middle' }, { from: '/middle', to: '/new/' }), { routes: new Set(['/new']), publishedRoutes: new Set(['/new']) });
  assert.deepEqual({ ...result }, { '/old': '/new', '/middle': '/new' });
});
test('redirects reject unsafe routes, cycles, duplicates, collisions and drafts', () => {
  for (const entry of [{ from: '/old', to: 'https://elsewhere.test' }, { from: '/old', to: '//elsewhere.test' }, { from: '/a/../b', to: '/new' }, { from: '/studio/x', to: '/new' }, { from: '/old', to: '/old/' }]) assert.throws(() => redirectMap(manifest(entry)));
  assert.throws(() => redirectMap(manifest({ from: '/a', to: '/b' }, { from: '/b', to: '/a' })), /loop/);
  assert.throws(() => redirectMap(manifest({ from: '/a', to: '/b' }, { from: '/a/', to: '/c' })), /Duplicate/);
  assert.throws(() => redirectMap(manifest({ from: '/a', to: '/b' }), { routes: new Set(['/a']) }), /conflicts/);
  assert.throws(() => redirectMap(manifest({ from: '/a', to: '/b' }), { publishedRoutes: new Set() }), /unpublished/);
});
