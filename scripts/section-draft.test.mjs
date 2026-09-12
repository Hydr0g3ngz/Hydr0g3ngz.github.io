import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectionDraft } from '../studio/web/section-draft.js';
import { blockSchema } from '../src/content-schema.ts';

const field = (name, type = 'string', extra = {}) => ({ name, type, ...extra });
const required = (name, type = 'string', extra = {}) => field(name, type, { required: true, ...extra });
const object = (fields, extra = {}) => ({ type: 'object', fields, ...extra });
const base = [field('visible', 'boolean', { default: true }), field('id')];
const heading = required('heading'), intro = required('intro', 'text'), eyebrow = required('eyebrow'), body = required('body', 'text');
const image = required('image', 'image'), imageAlt = required('imageAlt');
const list = (name, fields, options = {}) => field(name, 'object', { fields, list: options });
// Contract-shaped, neutral fixtures: no personal .pages.yml or homepage data is
// needed by the independent source distribution's regression suite.
const components = {
  hero: object([...base, eyebrow, heading, required('lede', 'text'), intro, list('links', [required('label'), required('href'), field('style', 'select', { default: 'secondary' })], { max: 4 })]),
  marquee: object([...base, field('label', 'string', { default: 'Current interests' }), required('items', 'string', { list: true })]),
  shelf: object([...base, eyebrow, heading, intro, list('categories', [required('tag'), required('title'), required('summary', 'text'), image, imageAlt, field('listLayout', 'select', { default: 'single' }), list('items', [required('title')])], { min: 1, max: 6 }), field('following', 'object', { fields: [field('visible', 'boolean', { default: false }), list('items', [required('tag'), required('title'), required('summary'), image, imageAlt], { max: 4 })] }), list('credits', [required('label'), required('url')])]),
  work: object([...base, eyebrow, intro, list('items', [required('year'), required('kind'), required('title'), required('summary')])]),
  closing: object([...base, eyebrow, heading, body]),
  text: object([...base, heading, body, field('width', 'select', { default: 'narrow' })]),
  image_text: object([...base, heading, body, image, imageAlt, field('imagePosition', 'select', { default: 'left' })]),
  list: object([...base, heading, field('columns', 'select', { default: 'two' }), list('items', [required('title'), required('text', 'text')])]),
  quote: object([...base, required('quote', 'text')]),
  profile: object([...base, field('paragraphs', 'text', { list: { min: 1 } }), list('facts', [required('label'), required('value')])]),
  reading: object([...base, heading, intro, list('books', [required('title'), required('author'), required('blurb'), required('sourceLabel'), required('sourceUrl')], { max: 24 }), list('excerpts', [required('text'), required('author'), required('work'), required('sourceLabel'), required('sourceUrl')], { max: 24 })]),
  listening: object([...base, heading, intro, list('artists', [required('name'), required('track'), field('youtubeUrl'), field('alternateUrl'), field('alternateLabel', 'string', { default: 'Music link' })], { max: 24 })])
};
const media = [{ path: '/uploads/fixture-image.png', name: 'Project image' }];
const make = (type, extra = {}) => createSectionDraft({ type, component: components[type], components, media, sections: [], ...extra });

test('all twelve proven block types generate schema-valid drafts without changing inputs', () => {
  const before = structuredClone({ components, media });
  assert.equal(Object.keys(components).length, 12);
  for (const type of Object.keys(components)) {
    const section = make(type), parsed = blockSchema.safeParse(section);
    assert.equal(parsed.success, true, `${type}: ${JSON.stringify(parsed.error?.issues)}`);
    assert.equal(section.type, type);
  }
  assert.deepEqual({ components, media }, before);
});

test('image-required sections reject an empty library before changing existing content', () => {
  const sections = [{ type: 'text', heading: 'Keep this', body: 'Original body' }], before = structuredClone(sections);
  for (const type of ['shelf', 'image_text']) assert.throws(() => make(type, { media: [], sections }), /Upload an image.*try adding.*No section was added/i);
  for (const type of Object.keys(components).filter(type => !['shelf', 'image_text'].includes(type))) assert.doesNotThrow(() => make(type, { media: [], sections }));
  assert.deepEqual(sections, before);
});

test('Profile repairs its descriptor-generated empty paragraph and preserves written defaults', () => {
  assert.deepEqual(make('profile').paragraphs, ['Write a little about yourself.']);
  const component = structuredClone(components.profile);
  component.fields.find(item => item.name === 'paragraphs').default = ['Personal words', '', '   ', 'Last line'];
  assert.deepEqual(make('profile', { component }).paragraphs, ['Personal words', 'Write a little about yourself.', 'Write a little about yourself.', 'Last line']);
  assert.deepEqual(component.fields.find(item => item.name === 'paragraphs').default, ['Personal words', '', '   ', 'Last line']);
  component.fields.find(item => item.name === 'paragraphs').default = [];
  assert.equal(make('profile', { component }).paragraphs.length, 1);
});

test('anchors get deterministic collision-free suffixes, including hidden sections', () => {
  const component = { ...components.text, fields: [...components.text.fields.filter(item => item.name !== 'id'), field('id', 'string', { default: 'thoughts' })] };
  const sections = [{ id: 'thoughts', visible: false }, { id: 'thoughts-2' }, { id: 'thoughts-4', visible: false }];
  assert.equal(make('text', { component, sections }).id, 'thoughts-3');
  assert.equal(make('text', { component, sections }).id, 'thoughts-3');
  assert.equal(make('text', { component, sections: [...sections, { id: 'thoughts-3' }] }).id, 'thoughts-5');
  assert.equal(make('text').id, undefined);
});

test('the selected safe type wins over defaults while project component aliases remain supported', () => {
  const component = object([], { default: { type: 'shelf', heading: 'Custom heading', body: 'Body', visible: false } });
  const created = make('project-card', { component: 'project-layout', components: { 'project-layout': component } });
  assert.equal(created.type, 'project-card'); assert.equal(created.heading, 'Custom heading'); assert.equal(created.visible, false);
  assert.equal(component.default.type, 'shelf');
  const overriddenField = object([required('type', 'string', { default: 'bad-kind' }), heading, body]);
  assert.equal(make('text', { component: overriddenField }).type, 'text');
  for (const type of ['', 'bad/type', 'bad type', 'a'.repeat(101), null]) assert.throws(() => make(type, { component: components.text }), /type identifier/);
});

test('false and numeric defaults survive, optional URLs stay absent, and required links are valid HTTPS', () => {
  const component = object([field('visible', 'boolean', { default: false }), heading, body, field('enabled', 'boolean', { default: false }), field('count', 'number', { default: 0 }), field('href'), required('sourceUrl'), field('optionalTitle'), field('choices', 'string', { list: true, default: [] })]);
  const section = make('text', { component });
  assert.equal(section.visible, false); assert.equal(section.enabled, false); assert.equal(section.count, 0);
  assert.equal(section.href, undefined); assert.equal(section.optionalTitle, undefined); assert.equal(section.sourceUrl, 'https://example.com'); assert.deepEqual(section.choices, []);
});

test('image defaults are checked against the current library including nested object defaults', () => {
  const other = { path: '/images/second-project-image.jpg' };
  const component = structuredClone(components.image_text);
  component.fields.find(item => item.name === 'image').default = other.path;
  assert.equal(make('image_text', { component, media: [...media, other] }).image, other.path);
  assert.equal(make('image_text', { component }).image, media[0].path);
  assert.throws(() => make('image_text', { component, media: [] }), /Upload an image/);
  const nested = object([], { default: { heading: 'Heading', categories: [{ image: '/images/another-project.jpg', imageAlt: 'Description' }] } });
  assert.equal(make('shelf', { component: nested }).categories[0].image, media[0].path);
  assert.throws(() => make('shelf', { component: nested, media: [] }), /Upload an image/);
  assert.equal(nested.default.categories[0].image, '/images/another-project.jpg');
});

test('an image-typed field with a custom name also validates defaults inside generated objects', () => {
  const component = object([heading, body, field('detail', 'object', { default: { thumbnail: '/images/missing.jpg' }, fields: [field('thumbnail', 'image')] })]);
  assert.equal(make('text', { component }).detail.thumbnail, media[0].path);
  assert.throws(() => make('text', { component, media: [] }), /Upload an image/);
});

test('remote, traversal and malformed media never become fallback images', () => {
  for (const path of ['https://example.com/image.png', '//evil.test/image.png', '/images/../secret.png', '/images/%2e%2e/secret.png', '/images/a.png?secret', '/images/a\\b.png', '/images//a.png', '/private/a.png', '/IMAGES/a.png', '/images/script.js', '/images/a.png\n']) assert.throws(() => make('image_text', { media: [{ path }] }), /Upload an image/);
  assert.equal(make('image_text', { media: [{ path: '/bad.jpg' }, ...media] }).image, media[0].path);
});

test('references resolve with field overrides but recursive component graphs fail safely', () => {
  const shared = { text: components.text, wrapper: { component: 'text', label: 'Shared text' } };
  assert.equal(make('text', { component: 'wrapper', components: shared }).heading, 'A new thought');
  const nested = object([heading, body, { name: 'detail', component: 'entry', required: true }]);
  const entry = object([required('label'), required('href')]);
  const section = make('text', { component: nested, components: { entry } });
  assert.equal(section.detail.href, 'https://example.com');
  for (const cyclic of [{ a: { component: 'a' } }, { a: { component: 'b' }, b: { component: 'a' } }, { a: object([{ name: 'child', component: 'a', required: true }]) }]) assert.throws(() => make('text', { component: 'a', components: cyclic }), /circular component/);
  assert.throws(() => make('text', { component: 'missing', components: {} }), /missing/);
  const deep = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`entry-${index}`, { component: `entry-${index + 1}` }]));
  deep['entry-80'] = components.text;
  assert.throws(() => make('text', { component: 'entry-0', components: deep }), /too many nested component/);
});

test('referenced nested lists instantiate separate values without mistaking reuse for recursion', () => {
  const entry = object([required('label'), required('href')]);
  const component = object([heading, body, { name: 'links', component: 'entry', list: { min: 2 } }]);
  const section = make('text', { component, components: { entry } });
  assert.equal(section.links.length, 2); assert.equal(section.links[0].href, 'https://example.com');
  section.links[0].label = 'Changed once';
  assert.notEqual(section.links[1].label, section.links[0].label);
  assert.equal(entry.fields[0].default, undefined);
});

test('prototype keys, unsafe field names, accessors and cyclic input data are refused', () => {
  const badDefault = JSON.parse('{"type":"object","default":{"__proto__":{"polluted":true}}}');
  assert.throws(() => make('text', { component: badDefault }), /unsafe field/);
  assert.throws(() => make('text', { component: object([field('__proto__')]) }), /safe names/);
  assert.throws(() => make('text', { component: object([heading, heading]) }), /safe names/);
  const circular = {}; circular.self = circular;
  assert.throws(() => make('text', { component: circular }), /circular value/);
  let touched = false;
  const accessor = { get fields() { touched = true; return []; } };
  assert.throws(() => make('text', { component: accessor }), /unsafe field/); assert.equal(touched, false);
  assert.equal({}.polluted, undefined);
});
