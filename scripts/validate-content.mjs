import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { homeSchema, noteSchema, pageSchema, siteSettingsSchema } from '../src/content-schema.ts';
import { redirectMap } from './redirects.mjs';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const RESERVED_ROUTES = new Set(['index', 'notes', '404', '_astro', '__studio', 'api', 'preview', 'studio', 'images', 'uploads']);
const JSON_EXTENSIONS = new Set(['.json']);
const NOTE_EXTENSIONS = new Set(['.md', '.mdx']);

/** Read-only production gate; tests supply isolated project fixtures. */
export function validateContent({ root = resolve(import.meta.dirname, '..') } = {}) {
  const projectRoot = realpathSync(resolve(root));
  const errors = [];
  const checkedImages = new Set();
  const documents = [];
  const label = (file) => relative(projectRoot, file).replaceAll('\\', '/');
  const report = (source, message) => errors.push(`${source}: ${message}`);

  function checkedPath(suffix, { optional = false } = {}) {
    const target = resolve(projectRoot, suffix);
    const within = relative(projectRoot, target);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('path leaves the project');
    let path = projectRoot;
    for (const segment of within.split(sep).filter(Boolean)) {
      path = join(path, segment);
      let info;
      try { info = lstatSync(path); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
      if (info.isSymbolicLink()) throw new Error('symbolic links and directory junctions are not allowed');
    }
    return target;
  }

  function readText(file) {
    const target = checkedPath(relative(projectRoot, file));
    const info = lstatSync(target);
    if (!info.isFile()) throw new Error('expected a regular file');
    if (info.size > MAX_FILE_BYTES) throw new Error('content files must be no larger than 2 MB');
    return readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
  }

  function listFiles(folder, extensions) {
    let directory;
    try { directory = checkedPath(folder, { optional: true }); }
    catch (error) { report(folder, error.message); return []; }
    if (!directory) return [];
    const files = [];
    function visit(path) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isSymbolicLink()) { report(label(child), 'symbolic links and directory junctions are not allowed'); continue; }
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) visit(child);
        else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) files.push(child);
      }
    }
    try { visit(directory); } catch (error) { report(folder, error.message); }
    return files.sort();
  }

  function validateCmsConfig() {
    try {
      const config = parseYaml(readText(join(projectRoot, '.pages.yml')));
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('must contain a YAML object');
      if (!Array.isArray(config.content) || config.content.length === 0) report('.pages.yml', 'define at least one content entry');
      if (!config.components || typeof config.components !== 'object' || Array.isArray(config.components)) report('.pages.yml', 'define reusable block components');
      if (!Array.isArray(config.media) || config.media.length === 0) report('.pages.yml', 'define the image library');
    } catch (error) { report('.pages.yml', error.code === 'ENOENT' ? 'configuration file is missing' : error.message); }
  }

  function parseDocument(file, kind, schema) {
    try {
      const text = readText(file);
      let raw;
      let body = '';
      if (kind === 'note') {
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
        if (!match) throw new Error('Markdown notes require YAML frontmatter');
        raw = parseYaml(match[1]);
        body = match[2];
      } else raw = JSON.parse(text);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) report(`${label(file)}${issue.path.length ? `.${issue.path.join('.')}` : ''}`, issue.message);
        return null;
      }
      const entry = { file, kind, data: parsed.data, raw, body, published: kind === 'home' || kind === 'settings' || parsed.data.published === true };
      documents.push(entry);
      return entry;
    } catch (error) { report(label(file), error.message); return null; }
  }

  function validateImage(value, alt, source, { visible = true, allowHttps = false } = {}) {
    if (typeof value !== 'string') return;
    if (visible && (typeof alt !== 'string' || !alt.trim())) report(source, 'every displayed image needs a non-empty description');
    if (allowHttps && value.startsWith('https://')) {
      try {
        const url = new URL(value);
        if (!url.hostname || url.username || url.password || /[\\\u0000-\u001f]/.test(value)) throw new Error();
      } catch { report(source, 'use a valid HTTPS image URL'); }
      return;
    }
    if (!/^\/(images|uploads)\//.test(value) || /[\\%?#\u0000-\u001f]/.test(value) || value.slice(1).split('/').some((part) => !part || part === '.' || part === '..')) {
      report(source, `image "${value}" must point directly inside /images/ or /uploads/`);
      return;
    }
    // Drafts and hidden sections may refer to an image still being prepared.
    if (!visible) return;
    try {
      const disk = checkedPath(`public${value}`);
      const info = lstatSync(disk);
      if (!info.isFile()) throw new Error('image is not a regular file');
      if (info.size > MAX_FILE_BYTES) throw new Error('image is larger than 2 MB; optimize it before publishing');
      checkedImages.add(disk);
    } catch (error) { report(source, error.code === 'ENOENT' ? `image file does not exist at ${value}` : `${value}: ${error.message}`); }
  }

  function walkImages(value, source, visible) {
    if (!value || typeof value !== 'object' || value instanceof Date) return;
    if (Array.isArray(value)) { value.forEach((child, index) => walkImages(child, `${source}[${index}]`, visible)); return; }
    const shown = visible && value.visible !== false;
    for (const [field, alt] of [['image', 'imageAlt'], ['cover', 'coverAlt']]) {
      if (typeof value[field] === 'string') validateImage(value[field], value[alt], `${source}.${field}`, { visible: shown });
    }
    for (const [field, child] of Object.entries(value)) walkImages(child, `${source}.${field}`, shown);
  }

  function validateNoteImages(entry) {
    if (!entry.body.trim()) {
      if (entry.published) report(label(entry.file), 'published notes need some text');
      return;
    }
    // Parse before checking: reference images work, code examples are ignored,
    // and the HTML parser decodes entities in filenames and alt descriptions.
    let index = 0;
    sanitizeHtml(marked.parse(entry.body, { async: false }), {
      allowedTags: ['img'], allowedAttributes: { img: ['src', 'alt'] },
      transformTags: {
        img(tagName, attributes) {
          index++;
          if (attributes.src) validateImage(attributes.src, attributes.alt, `${label(entry.file)}.body.image[${index}]`, { visible: entry.published, allowHttps: true });
          else if (entry.published) report(`${label(entry.file)}.body.image[${index}]`, 'image source is missing');
          return { tagName, attribs: attributes };
        }
      }
    });
  }

  function routeFor(entry) {
    const folder = entry.kind === 'page' ? 'pages' : 'notes';
    const filename = relative(join(projectRoot, 'src/content', folder), entry.file).replaceAll('\\', '/').replace(/\.(json|md|mdx)$/i, '');
    // This supported filename alphabet matches Astro's GitHub slug conversion.
    // Astro first strips /index for both collections; the page route strips it
    // once more. Explicit frontmatter slug values bypass the initial conversion.
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(filename)) report(label(entry.file), 'use letters, numbers, hyphens, or underscores in content filenames');
    let slug = entry.raw.slug ? String(entry.raw.slug) : filename.toLowerCase().replace(/\/index$/, '');
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(slug)) report(label(entry.file), 'the content slug must be a safe relative page address');
    if (entry.kind === 'page') slug = slug.replace(/\/index$/, '');
    const normalized = slug.toLowerCase();
    if (entry.kind === 'page' && RESERVED_ROUTES.has(normalized.split('/')[0])) report(label(entry.file), `"${normalized.split('/')[0]}" is a reserved page route`);
    return `${entry.kind === 'note' ? '/notes' : ''}/${normalized}`;
  }

  function validatePublicBoundary() {
    let publicRoot;
    try { publicRoot = checkedPath('public', { optional: true }); }
    catch (error) { report('public', error.message); return; }
    if (!publicRoot) return;
    function visit(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const child = join(directory, entry.name);
        if (entry.isSymbolicLink()) { report(label(child), 'public files cannot be symlinks or junctions'); continue; }
        if (['.studio', '__studio', '.git', '.env', '.pages.yml'].includes(entry.name.toLowerCase()) || (directory === publicRoot && entry.name.toLowerCase() === 'studio')) {
          report(label(child), 'local editing files and private configuration must not be copied into the public website');
          continue;
        }
        if (entry.isDirectory()) visit(child);
      }
    }
    try { visit(publicRoot); } catch (error) { report('public', error.message); }
  }

  validateCmsConfig();
  const homeFiles = listFiles('src/content/home', JSON_EXTENSIONS);
  const settingsFiles = listFiles('src/content/settings', JSON_EXTENSIONS);
  const pageFiles = listFiles('src/content/pages', JSON_EXTENSIONS);
  const noteFiles = listFiles('src/content/notes', NOTE_EXTENSIONS);
  if (homeFiles.length !== 1) report('Homepage', 'exactly one homepage JSON file is required');
  if (settingsFiles.length !== 1) report('Site settings', 'exactly one site-settings JSON file is required');
  const homes = homeFiles.map((file) => parseDocument(file, 'home', homeSchema)).filter(Boolean);
  const settings = settingsFiles.map((file) => parseDocument(file, 'settings', siteSettingsSchema)).filter(Boolean);
  const pages = pageFiles.map((file) => parseDocument(file, 'page', pageSchema)).filter(Boolean);
  const notes = noteFiles.map((file) => parseDocument(file, 'note', noteSchema)).filter(Boolean);
  const routes = new Map();
  const publishedRoutes = new Set(['/']);
  for (const entry of [...pages, ...notes]) {
    const route = routeFor(entry);
    if (entry.published) publishedRoutes.add(route);
    if (routes.has(route)) report(label(entry.file), `route "${route}" is also used by ${label(routes.get(route))}`);
    else routes.set(route, entry.file);
    if (entry.kind === 'page' && entry.published && entry.data.sections.length === 0) report(label(entry.file), 'published pages need at least one section');
    if (entry.kind === 'note') validateNoteImages(entry);
  }
  // The index route is generated only while at least one note is published.
  if (notes.some((entry) => entry.published)) publishedRoutes.add('/notes');
  try {
    const manifest = checkedPath('src/redirects.json', { optional: true });
    if (manifest) redirectMap(JSON.parse(readText(manifest)), { routes, publishedRoutes });
  } catch (error) { report('src/redirects.json', error.message); }
  for (const entry of documents) {
    walkImages(entry.data, label(entry.file), entry.published);
    if (!entry.published) continue;
    const anchors = new Set();
    for (const section of entry.data.sections ?? []) {
      if (section.visible === false || !section.id) continue;
      if (anchors.has(section.id)) report(label(entry.file), `visible sections use duplicate anchor "${section.id}"`);
      anchors.add(section.id);
    }
  }
  if (homes[0] && settings[0]) {
    const visibleAnchors = new Set(homes[0].data.sections.filter((section) => section.visible !== false).map((section) => section.id));
    for (const link of settings[0].data.homeLinks) {
      if (link.visible === false) continue;
      const match = /^\/#(.+)$/.exec(link.href);
      if (match && !visibleAnchors.has(match[1])) report(label(settings[0].file), `navigation points to missing or hidden homepage anchor "#${match[1]}"`);
    }
  }
  validatePublicBoundary();
  return { ok: errors.length === 0, errors, pages: pages.length, notes: notes.filter((entry) => !entry.file.split(sep).at(-1).startsWith('_')).length, images: checkedImages.size };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const result = validateContent();
  if (!result.ok) {
    console.error(`Content validation failed:\n\n${result.errors.map((error) => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Content validation passed: ${result.pages} page(s), ${result.notes} note(s), ${result.images} referenced image(s).`);
}
