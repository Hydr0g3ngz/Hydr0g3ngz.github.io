import { createHash, randomBytes } from 'node:crypto';
import { link, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dump, load } from 'js-yaml';
import { redirectMap } from '../scripts/redirects.mjs';

export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const reserved = new Set(['index', 'notes', '404', '_astro', '__studio', 'api', 'preview', 'images', 'uploads', 'studio']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

export class StudioError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function revisionOf(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertPlainData(value, depth = 0) {
  if (depth > 60) throw new StudioError(400, 'Content is nested too deeply.');
  if (value === null || typeof value !== 'object') return;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new StudioError(400, 'Content must contain only plain JSON values.');
  }
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new StudioError(400, 'Unsupported content property.');
    }
    assertPlainData(child, depth + 1);
  }
}

// Check every ancestor, not just the final filename: a linked directory must not
// turn a content or media operation into a write outside this checkout.
export async function containedPath(root, suffix, { allowMissing = false } = {}) {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, suffix);
  const within = relative(absoluteRoot, target);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new StudioError(400, 'Path is outside the project.');
  }
  const segments = within ? within.split(sep) : [];
  let current = absoluteRoot;
  for (const segment of ['', ...segments]) {
    if (segment) current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new StudioError(400, 'Linked files and directories are not supported.');
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) continue;
      if (error.code === 'ENOENT') throw new StudioError(404, 'File does not exist.');
      throw error;
    }
  }
  return target;
}

export function parseId(id) {
  if (typeof id !== 'string' || id.length > 220 || id.includes('\\') || id.includes('%')) {
    throw new StudioError(400, 'Invalid document path.');
  }
  if (id === 'home/home.json') return { kind: 'home', route: '/' };
  if (id === 'settings/site.json') return { kind: 'settings', route: '/' };
  if (id.toLowerCase().endsWith('.mdx')) {
    throw new StudioError(422, `Studio does not edit MDX files (${id}). Handle this unsupported file in an external editor, then reopen Studio. No content was changed.`);
  }
  const match = /^(pages|notes)\/([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)\.(json|md)$/.exec(id);
  if (!match || (match[1] === 'pages' ? match[3] !== 'json' : match[3] !== 'md')) {
    throw new StudioError(400, 'Choose a supported content document. If this file was created outside Studio, handle its unsupported filename in an external editor, then reopen Studio. No content was changed.');
  }
  const slug = match[2].replace(/\/index$/, '');
  if (match[1] === 'pages' && reserved.has(slug.split('/')[0])) {
    throw new StudioError(400, 'This page address is reserved by the website.');
  }
  return { kind: match[1] === 'pages' ? 'page' : 'note', route: `${match[1] === 'notes' ? '/notes' : ''}/${slug}` };
}

function assertEditableAddress(id, data) {
  if (data && Object.hasOwn(data, 'slug')) {
    throw new StudioError(422, `Studio does not edit custom slug fields (${id}). Handle this routing override in an external editor, then reopen Studio. No content was changed.`);
  }
}

export function parseDocument(id, contents) {
  const { kind } = parseId(id);
  try {
    if (kind !== 'note') return JSON.parse(contents);
    const normalized = contents.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized);
    if (!match) throw new Error('Markdown notes require YAML frontmatter.');
    const metadata = load(match[1], { json: true });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid note frontmatter.');
    // YAML dates are normalized for the browser date inputs.
    for (const field of ['date', 'updated']) {
      if (metadata[field] instanceof Date) metadata[field] = metadata[field].toISOString().slice(0, 10);
    }
    return { ...metadata, body: match[2].replace(/^\n/, '') };
  } catch (error) {
    throw new StudioError(422, `${id}: ${error.message}`);
  }
}

export function serializeDocument(kind, data) {
  if (kind !== 'note') return `${JSON.stringify(data, null, 2)}\n`;
  const { body, ...metadata } = data;
  return `---\n${dump(metadata, { noRefs: true, lineWidth: -1, quotingType: '"' })}---\n\n${body.trimEnd()}\n`;
}

export async function atomicWrite(root, suffix, contents, { create = false, expectedRevision } = {}) {
  const target = await containedPath(root, suffix, { allowMissing: true });
  await mkdir(dirname(target), { recursive: true });
  await containedPath(root, relative(root, dirname(target)));
  const temporary = join(dirname(target), `.studio-${randomBytes(12).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    await containedPath(root, suffix, { allowMissing: create || expectedRevision === undefined });
    if (expectedRevision !== undefined && revisionOf(await readFile(target)) !== expectedRevision) {
      throw new StudioError(409, 'This document changed outside Studio. Reload it before saving.');
    }
    if (create) {
      // Linking the completed temporary file gives exclusive, atomic creation.
      // Unlike rename(), this cannot silently replace an existing document.
      await link(temporary, target);
    } else {
      await rename(temporary, target);
    }
  } catch (error) {
    if (error.code === 'EEXIST') throw new StudioError(409, 'A document already uses this address.');
    throw error;
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function createStudioStore({ root, schemas } = {}) {
  const projectRoot = await realpath(resolve(root ?? join(import.meta.dirname, '..')));
  const contentRoot = await containedPath(projectRoot, 'src/content');
  const schema = schemas ?? await import(pathToFileURL(join(projectRoot, 'src/content-schema.ts')).href);
  let operation = Promise.resolve();
  function locked(work) {
    const next = operation.then(work);
    operation = next.catch(() => {});
    return next;
  }

  async function files(directory, extensions) {
    const path = await containedPath(projectRoot, directory, { allowMissing: true });
    const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const results = [];
    for (const entry of entries) {
      const child = `${directory}/${entry.name}`;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      if (child === 'src/content/notes/_placeholder.md' || (entry.name.startsWith('_') && !directory.startsWith('src/content/'))) continue;
      if (entry.isDirectory()) results.push(...await files(child, extensions));
      else if (extensions.has(extname(entry.name).toLowerCase())) results.push(child);
    }
    return results;
  }

  async function readDocument(id) {
    const identity = parseId(id);
    const path = await containedPath(contentRoot, id);
    const contents = await readFile(path, 'utf8');
    if (Buffer.byteLength(contents) > MAX_DOCUMENT_BYTES) throw new StudioError(413, 'Document is larger than 1 MB.');
    const data = parseDocument(id, contents);
    assertPlainData(data);
    assertEditableAddress(id, data);
    return { id, ...identity, name: data.title ?? data.brand ?? id, data, revision: revisionOf(contents) };
  }

  async function documents() {
    const paths = [
      ...await files('src/content/home', new Set(['.json'])),
      ...await files('src/content/pages', new Set(['.json'])),
      ...await files('src/content/settings', new Set(['.json'])),
      ...await files('src/content/notes', new Set(['.md', '.mdx']))
    ];
    return Promise.all(paths.map((path) => readDocument(path.replace('src/content/', ''))));
  }

  async function validate(id, input, { preview = false } = {}) {
    const { kind } = parseId(id);
    assertPlainData(input);
    assertEditableAddress(id, input);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StudioError(400, 'Document data must be an object.');
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_DOCUMENT_BYTES) throw new StudioError(413, 'Document is larger than 1 MB.');
    const validator = { home: schema.homeSchema, page: schema.pageSchema, settings: schema.siteSettingsSchema, note: schema.noteSchema }[kind];
    const result = validator.safeParse(input);
    if (!result.success) {
      throw new StudioError(422, 'Please fix the highlighted content before saving.', result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
    }
    const data = JSON.parse(JSON.stringify(result.data));
    if (kind === 'note') {
      if (typeof input.body !== 'string' || !input.body.trim()) throw new StudioError(422, 'A note needs some text.', [{ path: 'body', message: 'Write the note text.' }]);
      data.body = input.body;
      for (const field of ['date', 'updated']) if (data[field]) data[field] = data[field].slice(0, 10);
    }
    if (kind === 'page' && data.published && data.sections.length === 0) {
      throw new StudioError(422, 'A published page needs at least one section.', [{ path: 'sections', message: 'Add a section before publishing.' }]);
    }
    if (!preview && ['page', 'note'].includes(kind)) {
      const manifestPath = await containedPath(projectRoot, 'src/redirects.json', { allowMissing: true });
      let manifest;
      try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new StudioError(422, 'The redirects file needs to be corrected before changing publication status.'); }
      if (manifest) {
        let map;
        try { map = redirectMap(manifest); } catch (error) { throw new StudioError(422, error.message); }
        const route = parseId(id).route;
        if (Object.hasOwn(map, route)) throw new StudioError(409, 'An existing redirect uses this page address. Choose a new address or update that redirect first.');
        if (data.published === false) {
          const targets = Object.values(map);
          if (targets.includes(route)) throw new StudioError(422, 'This page has redirects from previous published addresses. Keep it published until those redirects are updated.');
          if (kind === 'note' && targets.includes('/notes') && !(await documents()).some((document) => document.kind === 'note' && document.id !== id && document.data.published === true)) {
            throw new StudioError(422, 'The notes index has published redirects. Keep at least one note published until those redirects are updated.');
          }
        }
      }
    }
    if (kind === 'page') {
      const route = parseId(id).route;
      const collision = (await documents()).find((document) => document.id !== id && document.kind === 'page' && document.route === route);
      if (collision) throw new StudioError(409, `This page address is also used by ${collision.id}. Rename the duplicate content file before editing.`);
    }
    const anchors = new Set();
    for (const [index, section] of (data.sections ?? []).entries()) {
      if (!section.id) continue;
      if (anchors.has(section.id)) throw new StudioError(422, `The anchor “${section.id}” appears more than once.`, [{ path: `sections.${index}.id`, message: 'Use a unique anchor.' }]);
      anchors.add(section.id);
    }
    async function checkAssets(value) {
      if (!value || typeof value !== 'object') return;
      for (const field of ['image', 'cover']) {
        if (typeof value[field] !== 'string') continue;
        const path = value[field];
        if (!/^\/(images|uploads)\//.test(path) || /[\\%?#\u0000-\u001f]/.test(path) || path.split('/').some((segment) => segment === '..' || segment === '.')) {
          throw new StudioError(422, 'Images must use a file inside the local image library.');
        }
        const full = await containedPath(projectRoot, `public${path}`);
        const stat = await lstat(full);
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new StudioError(422, `Image ${path} must be a file no larger than 2 MB.`);
      }
      for (const child of Object.values(value)) await checkAssets(child);
    }
    await checkAssets(data);
    if (!preview && (kind === 'home' || kind === 'settings')) {
      const other = await readDocument(kind === 'home' ? 'settings/site.json' : 'home/home.json');
      const home = kind === 'home' ? data : other.data;
      const settings = kind === 'settings' ? data : other.data;
      const visibleAnchors = new Set(home.sections.filter((section) => section.visible !== false).map((section) => section.id));
      for (const nav of settings.homeLinks ?? []) {
        const anchor = /^\/#(.+)$/.exec(nav.href);
        if (nav.visible !== false && anchor && !visibleAnchors.has(anchor[1])) {
          throw new StudioError(422, `Navigation points to the missing or hidden section “${anchor[1]}”. Update navigation or keep that section visible.`);
        }
      }
    }
    return data;
  }

  function historyDirectory(id) {
    parseId(id);
    return `.studio/history/${revisionOf(id).slice(0, 24)}`;
  }

  async function backup(id, contents) {
    const version = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}.json`;
    const entry = { id, version, createdAt: new Date().toISOString(), revision: revisionOf(contents), contents };
    await atomicWrite(projectRoot, `${historyDirectory(id)}/${version}`, JSON.stringify(entry), { create: true });
    return version;
  }

  async function saveUnlocked({ id, data: input, revision }) {
    const current = await readDocument(id);
    if (typeof revision !== 'string' || current.revision !== revision) throw new StudioError(409, 'This document has changed. Reload it before saving; your edits have not overwritten it.');
    const data = await validate(id, input);
    const contents = serializeDocument(current.kind, data);
    if (revisionOf(contents) === current.revision) return current;
    const path = await containedPath(contentRoot, id);
    const previous = await readFile(path, 'utf8');
    if (revisionOf(previous) !== revision) throw new StudioError(409, 'This document changed outside Studio. Reload it before saving.');
    await backup(id, previous);
    await atomicWrite(contentRoot, id, contents, { expectedRevision: revision });
    return readDocument(id);
  }

  return {
    root: projectRoot,
    exclusive: locked,
    documents,
    validateDocument: validate,
    readDocument,
    async state() {
      const configPath = await containedPath(projectRoot, '.pages.yml');
      const config = load(await readFile(configPath, 'utf8'));
      const mediaPaths = [
        ...await files('public/images', imageExtensions),
        ...await files('public/uploads', imageExtensions)
      ];
      return {
        documents: await documents(),
        media: mediaPaths.map((path) => ({ path: `/${path.replace('public/', '')}`, name: path.split('/').at(-1) })),
        config
      };
    },
    save(args) { return locked(() => saveUnlocked(args)); },
    create({ kind, slug, title, parent = '' }) {
      return locked(async () => {
        if (!['page', 'note'].includes(kind)) throw new StudioError(400, 'Only pages and notes can be created.');
        if (typeof slug !== 'string' || typeof parent !== 'string') throw new StudioError(400, 'Choose a page address.');
        const address = parent ? `${parent}/${slug}` : slug;
        if (address.length > 180 || address.split('/').length > 8 || !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(address) || address.split('/').some((part) => part === 'index')) {
          throw new StudioError(400, 'Use lowercase letters, numbers, and hyphens, with / between subpages.');
        }
        if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new StudioError(400, 'Enter a title of 1–200 characters.');
        const id = `${kind === 'page' ? 'pages' : 'notes'}/${address}.${kind === 'page' ? 'json' : 'md'}`;
        const identity = parseId(id);
        const existing = await documents();
        if (existing.some((doc) => doc.route === identity.route)) throw new StudioError(409, 'A document already uses this page address.');
        const input = kind === 'page' ? {
          title: title.trim(), description: `A page about ${title.trim()}.`, heading: title.trim(), published: false,
          navigation: { show: false, label: title.trim(), order: 100 },
          sections: [{ type: 'text', visible: true, heading: title.trim(), body: 'Write something here.', width: 'narrow' }]
        } : {
          title: title.trim(), description: `Notes on ${title.trim()}.`, date: new Date().toISOString().slice(0, 10),
          category: 'Other', published: false, body: 'Write something here.\n'
        };
        const data = await validate(id, input);
        await atomicWrite(contentRoot, id, serializeDocument(kind, data), { create: true });
        return readDocument(id);
      });
    },
    preview({ id, data: input }) {
      return locked(async () => {
        const document = await readDocument(id);
        const data = await validate(id, input, { preview: true });
        const revision = randomBytes(12).toString('hex');
        await atomicWrite(projectRoot, `.studio/previews/${revision}.json`, JSON.stringify({ id, kind: document.kind, data, route: document.route, rev: revision, revision, updatedAt: new Date().toISOString() }), { create: true });
        return { url: `/preview/__studio/preview?rev=${revision}`, revision, rev: revision };
      });
    },
    async history(id) {
      await readDocument(id);
      const paths = await files(historyDirectory(id), new Set(['.json']));
      const entries = await Promise.all(paths.map(async (path) => {
        const full = await containedPath(projectRoot, path);
        const entry = JSON.parse(await readFile(full, 'utf8'));
        return { version: path.split('/').at(-1), createdAt: entry.createdAt, revision: entry.revision };
      }));
      return { versions: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    },
    restore({ id, version, revision }) {
      return locked(async () => {
        if (typeof version !== 'string' || !/^[0-9T.Z-]+-[a-f0-9]{8}\.json$/.test(version)) throw new StudioError(400, 'Invalid history version.');
        const path = await containedPath(projectRoot, `${historyDirectory(id)}/${version}`);
        const entry = JSON.parse(await readFile(path, 'utf8'));
        if (entry.id !== id || revisionOf(entry.contents) !== entry.revision) throw new StudioError(422, 'This backup is damaged.');
        return saveUnlocked({ id, data: parseDocument(id, entry.contents), revision });
      });
    },
    upload(contents, filename) {
      return locked(async () => {
        if (!Buffer.isBuffer(contents) || contents.length > MAX_IMAGE_BYTES) throw new StudioError(413, 'Images must be no larger than 2 MB.');
        const extension = detectImage(contents);
        if (!extension) throw new StudioError(415, 'Choose a JPEG, PNG, WebP, AVIF, or GIF image. SVG and executable files are not accepted.');
        if (typeof filename !== 'string' || filename.length > 240 || /[\\/\u0000-\u001f]/.test(filename)) throw new StudioError(400, 'Invalid image filename.');
        const base = filename.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).toLowerCase() || 'image';
        const name = `${base}-${randomBytes(6).toString('hex')}.${extension}`;
        await atomicWrite(projectRoot, `public/images/${name}`, contents, { create: true });
        return { path: `/images/${name}`, name };
      });
    }
  };
}

export function detectImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(12, 16).toString() === 'IHDR') return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) return 'jpg';
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()) && buffer.at(-1) === 0x3b) return 'gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length) return 'webp';
  if (buffer.subarray(4, 8).toString() === 'ftyp' && buffer.subarray(8, Math.min(buffer.length, 40)).toString().match(/avif|avis/)) return 'avif';
  return null;
}
