import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform as compileAstro } from '@astrojs/compiler-rs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';
import { load } from 'js-yaml';
import { profileBlockSchema, siteSettingsSchema, listeningBlockSchema, liveBlockSchema, listBlockSchema } from '../src/content-schema.ts';
import { mountLiveGallery } from '../src/lib/live-gallery.mjs';

async function component(path) {
  const url = new URL(`../src/components/${path}.astro`, import.meta.url);
  const compiled = compileAstro(await readFile(url, 'utf8'), {
    filename: url.pathname, internalURL: import.meta.resolve('astro/compiler-runtime'), resolvePath: (specifier) => specifier,
  });
  // Node renders markup only; scoped CSS is exercised by the real-browser check.
  const code = compiled.code.replace(/^import\s+["'][^"']+\?astro&type=style[^"']+["'];?\s*$/gm, '');
  const js = await transform(code, { loader: 'ts', format: 'esm', target: 'es2022' });
  return (await import(`data:text/javascript;base64,${Buffer.from(js.code).toString('base64')}`)).default;
}
const [Navigation, Listening, Live, SocialMeta, List] = await Promise.all([
  component('MusicNavigation'), component('blocks/ListeningBlock'), component('blocks/LiveBlock'), component('SocialMeta'),
  component('blocks/ListBlock'),
]);
const music = listeningBlockSchema.parse({
  type: 'listening', id: 'songs', heading: 'Songs', intro: 'Selected music.',
  artists: [{ name: 'Artist', track: 'Song', lyricExcerpt: 'An authored excerpt.', youtubeUrl: 'https://youtube.com/' }],
  albums: [{ artist: 'Artist', title: 'Album', favoriteTrack: 'Song' }],
});
const live = liveBlockSchema.parse({
  type: 'live', id: 'live', heading: 'Live', intro: 'Concert recordings.',
  records: [
    { title: 'Portrait', video: '/uploads/live/portrait.mp4', image: '/images/portrait.jpg', imageAlt: 'A stage', imageWidth: 404, imageHeight: 720 },
    { title: 'Landscape', video: '/uploads/live/landscape.mp4', image: '/images/landscape.jpg', imageAlt: 'A stage', imageWidth: 1280, imageHeight: 720 },
    { title: 'No dimensions', video: '/uploads/live/other.mp4', image: '/images/other.jpg', imageAlt: 'A stage' },
  ],
});
const listeningPage = JSON.parse(await readFile(new URL('../src/content/pages/listening.json', import.meta.url), 'utf8'));
const musicals = listBlockSchema.parse(listeningPage.sections.find((block) => block.id === 'musicals'));

async function render(fragments) {
  const container = await AstroContainer.create();
  const html = [];
  for (const [Component, props] of fragments) html.push(await container.renderToString(Component, { props }));
  return new JSDOM(html.join(''), { url: 'https://example.test/listening/' });
}

test('music navigation reaches real, keyboard-focusable song, album and live targets without scripts', async (t) => {
  const dom = await render([[Navigation, { sections: [music, live] }], [Listening, { block: music }], [Live, { block: live }]]);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const nav = document.querySelector('.music-nav');
  assert.ok(nav.hasAttribute('data-studio-ignore'));
  assert.deepEqual([...nav.querySelectorAll('a')].map((a) => a.textContent), ['Songs', 'Albums', 'Live']);
  for (const a of nav.querySelectorAll('a')) {
    const target = document.getElementById(a.hash.slice(1));
    assert.ok(target, a.hash);
    assert.equal(target.getAttribute('tabindex'), '-1');
  }
  assert.equal(nav.querySelectorAll('script').length, 0);
  assert.equal(document.querySelector('.lyric-excerpt').textContent, music.artists[0].lyricExcerpt);
  assert.equal(document.querySelector('.album-card h4').textContent, music.albums[0].title);
});

test('music navigation omits hidden, empty or unanchored sections and single-destination menus', async (t) => {
  for (const sections of [[], [{ ...music, visible: false }, live], [{ ...music, id: undefined }, live], [{ ...music, artists: [], albums: [] }, live], [music, { ...live, records: [] }]]) {
    const dom = await render([[Navigation, { sections }]]);
    t.after(() => dom.window.close());
    const links = [...dom.window.document.querySelectorAll('.music-nav a')];
    if (sections[0] === music) assert.deepEqual(links.map((a) => a.textContent), ['Songs', 'Albums']);
    else assert.equal(links.length, 0);
  }
});

test('musicals use the film poster layout with a working jump between albums and live', async (t) => {
  assert.deepEqual(listeningPage.sections.map((block) => block.type), ['listening', 'list', 'live']);
  assert.equal(musicals.presentation, 'posters');
  assert.deepEqual(musicals.items.map((item) => item.title), ['The Phantom of the Opera', 'Matilda The Musical', 'Molière, le spectacle musical']);
  assert.deepEqual(musicals.items.map((item) => item.favoriteTrack), ['The Phantom of the Opera', 'When I Grow Up', 'Regardez-moi']);
  const dom = await render([[Navigation, { sections: [music, musicals, live] }], [Listening, { block: music }], [List, { block: musicals }], [Live, { block: live }]]);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.deepEqual([...document.querySelectorAll('.music-nav a')].map((a) => a.textContent), ['Songs', 'Albums', 'Musicals', 'Live']);
  for (const link of document.querySelectorAll('.music-nav a')) assert.equal(document.getElementById(link.hash.slice(1)).tabIndex, -1);
  const section = document.getElementById('musicals');
  assert.equal(section.querySelectorAll('.screen-entry').length, 3);
  assert.equal(section.querySelectorAll('.screen-poster img').length, 3);
  assert.equal(section.querySelectorAll('video, audio, iframe, time, .personal-reflection').length, 0);
  for (const [index, item] of [...section.querySelectorAll('.screen-entry')].entries()) {
    const link = item.querySelector('h3 a');
    assert.equal(link.href, musicals.items[index].href);
    assert.equal(link.target, '_blank');
    assert.equal(item.querySelector('img').alt, musicals.items[index].imageAlt);
    assert.equal(item.querySelector('.list-favorite-label').textContent, 'Favorite song');
    assert.ok(item.querySelector('.list-favorite-label').hasAttribute('data-studio-ignore'));
    assert.equal(item.querySelector('.list-favorite > span:last-child').textContent, musicals.items[index].favoriteTrack);
  }
});

test('music navigation omits hidden or empty musicals and follows section order', async (t) => {
  for (const block of [{ ...musicals, visible: false }, { ...musicals, items: [] }, { ...musicals, id: undefined }]) {
    const dom = await render([[Navigation, { sections: [music, block, live] }]]);
    t.after(() => dom.window.close());
    assert.equal(dom.window.document.querySelector('.music-nav a[href="#musicals"]'), null);
  }
  const dom = await render([[Navigation, { sections: [live, musicals, music] }]]);
  t.after(() => dom.window.close());
  assert.deepEqual([...dom.window.document.querySelectorAll('.music-nav a')].map((a) => a.textContent), ['Live', 'Musicals', 'Songs', 'Albums']);
});

test('concert gallery uses uniform image links and keeps natural-ratio players in closed dialogs', async (t) => {
  const dom = await render([[Live, { block: live }]]);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const records = [...document.querySelectorAll('.live-record')];
  for (const [index, record] of records.entries()) {
    assert.equal(record.querySelector('.live-image').hasAttribute('style'), false);
    assert.equal(record.querySelector('.live-image video'), null);
    assert.equal(record.querySelector('[data-live-open]').getAttribute('href'), live.records[index].video);
    assert.ok(record.querySelector('.live-image img'));
    assert.equal(record.querySelector('dialog').hasAttribute('open'), false);
    assert.ok(record.querySelector('dialog').hasAttribute('data-studio-ignore'));
  }
  for (const [index, video] of [...document.querySelectorAll('video')].entries()) {
    assert.ok(video.hasAttribute('controls'));
    assert.ok(video.hasAttribute('playsinline'));
    assert.equal(video.hasAttribute('autoplay'), false);
    assert.equal(video.getAttribute('preload'), 'none');
    assert.equal(video.getAttribute('poster'), live.records[index].image);
    assert.ok(video.closest('dialog'));
  }
});

test('gallery enhancement opens on demand, stops on close, restores focus and preserves fallback links', async (t) => {
  const dom = await render([[Live, { block: live }]]);
  t.after(() => dom.window.close());
  const { document, MouseEvent, Event } = dom.window;
  const gallery = document.querySelector('[data-live-gallery]');
  const trigger = gallery.querySelector('[data-live-open]');
  const dialog = gallery.querySelector('dialog');
  let starts = 0;
  let pauses = 0;
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); };
  dialog.querySelector('video').play = () => { starts++; return Promise.resolve(); };
  dialog.querySelector('video').pause = () => pauses++;
  mountLiveGallery(gallery);
  mountLiveGallery(gallery);
  assert.equal(starts, 0, 'mounting does not start playback');
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  trigger.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(dialog.open, true);
  assert.equal(starts, 1, 'initialization is idempotent');
  dialog.close();
  assert.equal(pauses, 1);
  assert.equal(document.activeElement, trigger);
  dialog.dispatchEvent(new Event('cancel'));
  assert.equal(pauses, 2, 'Escape pauses synchronously, before the native close event');
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true }));
  assert.equal(pauses, 3, 'the Close button pauses synchronously');
  const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  trigger.dispatchEvent(modified);
  assert.equal(modified.defaultPrevented, false, 'modified clicks preserve the MP4 link');
  assert.equal(starts, 1);
  dialog.showModal = () => { throw new Error('Dialog unavailable'); };
  const fallback = new MouseEvent('click', { bubbles: true, cancelable: true });
  trigger.dispatchEvent(fallback);
  assert.equal(fallback.defaultPrevented, false);
});

const settings = JSON.parse(await readFile(new URL('../src/content/settings/site.json', import.meta.url), 'utf8'));
test('contact fields accept a single email address but reject header injection and unsafe schemes', () => {
  const profile = (href) => profileBlockSchema.safeParse({ type: 'profile', paragraphs: ['About.'], facts: [{ label: 'Email', value: 'Address', href }] }).success;
  for (const href of ['mailto:yunshuqing@gmail.com', '/about', 'https://example.com/']) {
    assert.equal(profile(href), true, href);
    assert.equal(siteSettingsSchema.safeParse({ ...settings, footerLinks: [{ label: 'Email', href }] }).success, true, href);
  }
  for (const href of ['javascript:alert(1)', 'mailto:not-an-email', 'mailto:a@example.com?bcc=b@example.com', 'mailto:a@example.com%0d%0aBCC:b@example.com', 'mailto:a@example.com\n', 'mailto:a@example.com,b@example.com']) {
    assert.equal(profile(href), false, href);
    assert.equal(siteSettingsSchema.safeParse({ ...settings, footerLinks: [{ label: 'Email', href }] }).success, false, href);
  }
});

test('sharing configuration remains optional and requires alt text when present', () => {
  const { shareImage, shareImageAlt, ...legacy } = settings;
  assert.equal(siteSettingsSchema.safeParse(legacy).success, true);
  assert.equal(siteSettingsSchema.safeParse({ ...legacy, shareImage }).success, false);
  assert.equal(siteSettingsSchema.safeParse(settings).success, true);
  assert.equal(siteSettingsSchema.safeParse({ ...settings, shareImage: 'https://example.test/image.png' }).success, false);
});

test('sharing metadata uses production canonical URLs, escaped page text and an absolute image URL', async (t) => {
  for (const pathname of ['/', '/listening?preview=1#live', '/lando/']) {
    const title = 'Will & music <test>';
    const dom = await render([[SocialMeta, { site: new URL('https://example.test/'), pathname, title, description: 'A "personal" page.', image: '/images/share-card.png', imageAlt: 'Will Qing' }]]);
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const canonical = document.querySelector('link[rel=canonical]').href;
    assert.equal(canonical, `https://example.test${pathname.split(/[?#]/)[0].replace(/\/?$/, '/')}`);
    assert.equal(document.querySelector('meta[property="og:url"]').content, canonical);
    assert.equal(document.querySelector('meta[property="og:title"]').content, title);
    assert.equal(document.querySelector('meta[property="og:image"]').content, 'https://example.test/images/share-card.png');
    assert.equal(document.querySelector('meta[name="twitter:card"]').content, 'summary_large_image');
    assert.equal(document.querySelector('meta[name="twitter:image:alt"]').content, 'Will Qing');
    assert.equal(document.querySelectorAll('test').length, 0);
  }
});

test('sharing metadata has a text-only fallback when no image is configured', async (t) => {
  const dom = await render([[SocialMeta, { site: new URL('https://example.test'), pathname: '/', title: 'Will', description: 'Homepage' }]]);
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector('meta[name="twitter:card"]').content, 'summary');
  assert.equal(dom.window.document.querySelector('meta[property="og:image"]'), null);
});

test('poster lists keep images, descriptions and accessible official links together', async (t) => {
  const block = listBlockSchema.parse({
    type: 'list', id: 'films', heading: 'Films', presentation: 'posters', columns: 'one',
    items: [{ title: 'Film title', text: 'An introduction.', meta: 'Directed by a director', href: 'https://example.test/film', image: '/images/poster.webp', imageAlt: 'A film poster', imageWidth: 312, imageHeight: 468, imageSourceUrl: 'https://example.test/source' }],
  });
  const dom = await render([[List, { block }]]);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(document.querySelector('h2').textContent, 'Films');
  assert.equal(document.querySelectorAll('h3').length, 1);
  assert.equal(document.querySelector('.screen-summary').textContent, block.items[0].text);
  const img = document.querySelector('img');
  assert.equal(img.getAttribute('src'), block.items[0].image);
  assert.equal(img.alt, block.items[0].imageAlt);
  assert.equal(img.width, 312);
  assert.equal(img.height, 468);
  assert.equal(img.getAttribute('loading'), 'lazy');
  const [link] = document.querySelectorAll('a');
  assert.equal(document.querySelectorAll('a').length, 1);
  assert.equal(link.href, block.items[0].href);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.match(link.getAttribute('aria-label'), /opens in a new tab/);
  assert.equal(document.querySelector('article').dataset.imageSource, block.items[0].imageSourceUrl);
  assert.equal(document.body.textContent.includes(block.items[0].imageSourceUrl), false);
});

test('poster list presentation is optional, and entries without a poster still render', async (t) => {
  const input = { type: 'list', heading: 'List', items: [{ title: 'Title', text: 'Description.', href: '/about/' }] };
  const legacy = listBlockSchema.parse(input);
  assert.equal(legacy.presentation, 'text');
  assert.equal(listBlockSchema.safeParse({ ...input, presentation: 'unknown' }).success, false);
  for (const presentation of ['text', 'posters']) {
    const dom = await render([[List, { block: { ...legacy, presentation } }]]);
    t.after(() => dom.window.close());
    const { document } = dom.window;
    assert.equal(document.querySelectorAll('img').length, 0);
    assert.equal(document.querySelector('a').getAttribute('target'), null);
    assert.equal(document.querySelector('h3').textContent.trim().replace(/\s*↗$/, ''), 'Title');
    assert.ok(document.querySelector(presentation === 'text' ? '.content-list-item' : '.screen-entry--text'));
    assert.equal(document.querySelector('.list-favorite'), null);
  }
});

test('optional favorite songs survive schema parsing in both list layouts and remain plain text', async (t) => {
  for (const presentation of ['text', 'posters']) {
    const favoriteTrack = 'Song <em>title</em> & refrain';
    const block = listBlockSchema.parse({ type: 'list', heading: 'Musicals', presentation, items: [{ title: 'Musical', text: 'Description.', favoriteTrack }] });
    assert.equal(block.items[0].favoriteTrack, favoriteTrack);
    const dom = await render([[List, { block }]]);
    t.after(() => dom.window.close());
    const favorite = dom.window.document.querySelector('.list-favorite');
    assert.equal(favorite.querySelector('span:last-child').textContent, favoriteTrack);
    assert.equal(favorite.querySelector('em, a'), null);
  }
});

test('film page groups the existing five titles and keeps poster metadata through schema parsing', async () => {
  const page = JSON.parse(await readFile(new URL('../src/content/pages/film.json', import.meta.url), 'utf8'));
  assert.deepEqual(page.sections.map((section) => section.heading), ['Films', 'Series']);
  assert.deepEqual(page.sections.map((section) => section.items.length), [3, 2]);
  for (const section of page.sections) {
    const parsed = listBlockSchema.parse(section);
    assert.equal(parsed.presentation, 'posters');
    for (const [index, item] of parsed.items.entries()) {
      assert.deepEqual(item, section.items[index]);
      assert.ok(item.image && item.imageAlt && item.imageWidth && item.imageHeight && item.imageSourceUrl);
      assert.ok(item.href.startsWith('https://'));
    }
  }
});

test('Studio exposes the poster presentation and every poster field in its list editor', async () => {
  const config = load(await readFile(new URL('../.pages.yml', import.meta.url), 'utf8'));
  const fields = config.components.list.fields;
  const presentation = fields.find((field) => field.name === 'presentation');
  assert.equal(presentation.default, 'text');
  assert.deepEqual(presentation.options.values.map((option) => option.name), ['text', 'posters']);
  const itemFields = fields.find((field) => field.name === 'items').fields;
  for (const name of ['image', 'imageAlt', 'imageWidth', 'imageHeight', 'imageSourceUrl', 'favoriteTrack']) {
    assert.ok(itemFields.some((field) => field.name === name), name);
  }
});
