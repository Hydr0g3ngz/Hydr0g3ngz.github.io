import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import { blockSchema } from '../src/content-schema.ts';
import { createSectionDraft } from '../studio/web/section-draft.js';

test('following cards preserve optional detail links and reject unsafe destinations', () => {
  const item = { tag: 'SPORT', title: 'A driver', summary: 'A personal interest.', image: '/images/fixture.jpg', imageAlt: 'A race car' };
  const shelf = {
    type: 'shelf', eyebrow: 'Interests', heading: 'Shelf', intro: 'A few interests.',
    categories: [item], following: { items: [item, { ...item, href: '/lando/' }] }
  };
  const parsed = blockSchema.parse(shelf);
  assert.equal(parsed.following.items[0].href, undefined);
  assert.equal(parsed.following.items[1].href, '/lando/');
  for (const href of ['javascript:alert(1)', '//example.com', 'http://example.com']) {
    const unsafe = structuredClone(shelf);
    unsafe.following.items[0].href = href;
    assert.equal(blockSchema.safeParse(unsafe).success, false);
  }
});

test('every offered homepage layout starts with schema-valid data using the real field definitions', async () => {
  const config = load(await readFile(new URL('../.pages.yml', import.meta.url), 'utf8'));
  const media = [{ path: '/images/test-fixture.jpg' }];
  assert.equal(Object.keys(config.components).length, 14);
  for (const [type, component] of Object.entries(config.components)) {
    const created = createSectionDraft({ type, component, components: config.components, media, sections: [] });
    const result = blockSchema.safeParse(created);
    assert.equal(result.success, true, `${type}: ${JSON.stringify(result.error?.issues)}`);
  }
});
