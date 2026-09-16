import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform as compileAstro } from '@astrojs/compiler-rs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';
import { profileBlockSchema, siteSettingsSchema, listeningBlockSchema, liveBlockSchema } from '../src/content-schema.ts';
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
const [Navigation, Listening, Live, SocialMeta] = await Promise.all([
  component('MusicNavigation'), component('blocks/ListeningBlock'), component('blocks/LiveBlock'), component('SocialMeta'),
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
