import { randomBytes } from 'node:crypto';
import { lstat, readFile, readdir, unlink } from 'node:fs/promises';
import { marked } from 'marked';
import { redirectMap } from '../scripts/redirects.mjs';
import { assertPlainData, atomicWrite, containedPath, MAX_DOCUMENT_BYTES, parseDocument, parseId, revisionOf, serializeDocument, StudioError } from './server-core.mjs';

const REDIRECTS = 'src/redirects.json';
const CORE = new Set(['home/home.json', 'settings/site.json', 'pages/about.json']);
const LINK_FIELDS = new Set(['href', 'url', 'sourceUrl', 'officialUrl', 'licenseUrl', 'image', 'cover']);
const PLAN_LIFETIME = 10 * 60_000;
const MAX_TRANSACTION_BYTES = 16 * 1024 * 1024;
const idPattern = /^[a-f0-9]{24}$/;

function destinationId(kind, slug) {
  if (typeof slug !== 'string' || slug.length > 180 || slug.split('/').length > 8 || !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(slug) || slug.split('/').some((part) => part === 'index')) {
    throw new StudioError(400, 'Use lowercase letters, numbers, and hyphens, with / between subpages.');
  }
  const id = `${kind === 'page' ? 'pages' : 'notes'}/${slug}.${kind === 'page' ? 'json' : 'md'}`;
  parseId(id);
  return id;
}

function siteAddress(siteUrl) {
  // The fallback is only a URL-parser base. Absolute links never match it.
  if (siteUrl === undefined) return { origin: 'https://studio.invalid', basePath: '', configured: false };
  let site;
  try { site = new URL(siteUrl); } catch { throw new StudioError(422, 'The selected project needs a valid HTTPS siteUrl.'); }
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash) throw new StudioError(422, 'The selected project needs a valid HTTPS siteUrl without credentials, query, or fragment.');
  return { origin: site.origin, basePath: site.pathname.replace(/\/+$/, ''), configured: true };
}

function rewriteHref(href, { oldRoute, newRoute, sourceRoute, movedSource = false, site }) {
  if (typeof href !== 'string' || !href || href !== href.trim() || /[\\\u0000-\u001f]/.test(href) || href.startsWith('//')) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
  if (absolute && !site.configured) return null;
  const relative = !absolute && !href.startsWith('/');
  let target;
  try { target = new URL(href, `${site.origin}${site.basePath}${sourceRoute.replace(/\/$/, '')}/`); } catch { return null; }
  if (target.origin !== site.origin || target.username || target.password) return null;
  const path = target.pathname.replace(/\/$/, '') || '/';
  const withinSite = !site.basePath || path === site.basePath || path.startsWith(`${site.basePath}/`);
  const route = withinSite ? path.slice(site.basePath.length) || '/' : null;
  const matched = route === oldRoute;
  // A local fragment remains local when its owning page is moved or copied.
  if (href.startsWith('#')) return matched ? { href, matched: true } : null;
  if (!matched && !(movedSource && relative)) return null;
  // Rebase relative destinations when their source moves, including a relative
  // link leaving the site's subpath; it is not counted as an internal reference.
  const destination = matched ? `${site.basePath}${newRoute}` : path;
  const trailing = target.pathname.endsWith('/') && destination !== '/' ? '/' : '';
  return { href: `${absolute ? site.origin : ''}${destination}${trailing}${target.search}${target.hash}`, matched };
}

function inlineDestination(raw) {
  const start = raw.lastIndexOf('](');
  if (start < 0) return null;
  let from = start + 2;
  while (/\s/.test(raw[from] ?? '')) from++;
  if (raw[from] === '<') {
    const end = raw.indexOf('>', from + 1);
    return end < 0 ? null : { from: from + 1, to: end };
  }
  let depth = 0;
  let to = from;
  while (to < raw.length) {
    if (raw[to] === '\\') { to += 2; continue; }
    if (raw[to] === '(') depth++;
    else if (raw[to] === ')') { if (!depth) break; depth--; }
    else if (/\s/.test(raw[to]) && !depth) break;
    to++;
  }
  return { from, to };
}

/** Preserve Markdown formatting and code examples while changing destinations. */
export function rewriteMarkdown(body, transform) {
  const tokens = marked.lexer(body);
  const blocked = [];
  const edits = [];
  const occupied = new Set();
  function edit(from, to, href, rawHref = href) {
    const replacement = transform(href);
    if (replacement === null || replacement === rawHref || occupied.has(`${from}:${to}`)) return;
    occupied.add(`${from}:${to}`);
    edits.push({ from, to, replacement });
  }
  function visit(token, start, end) {
    if (token.type === 'code' || token.type === 'codespan') { blocked.push({ from: start, to: end }); return; }
    if (token.type === 'link' || token.type === 'image') {
      const location = inlineDestination(token.raw);
      if (location) edit(start + location.from, start + location.to, token.href, token.raw.slice(location.from, location.to));
      else if (token.autolink || token.raw === token.href) {
        const bracketed = token.raw.startsWith('<') && token.raw.endsWith('>');
        edit(start + (bracketed ? 1 : 0), end - (bracketed ? 1 : 0), token.href);
      }
    }
    if (token.type === 'html') {
      for (const tag of token.raw.matchAll(/<(?:a|img|source|video|audio)\b[^>]*>/gi)) {
        const attributes = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
        for (const match of tag[0].matchAll(attributes)) {
          const href = match[1] ?? match[2] ?? match[3];
          const offset = tag.index + match.index + match[0].indexOf(href);
          edit(start + offset, start + offset + href.length, href);
        }
      }
    }
    let cursor = start;
    const children = token.type === 'table'
      ? [...(token.header ?? []), ...(token.rows ?? []).flat()].flatMap((cell) => cell.tokens ?? [])
      : token.items ?? token.tokens ?? [];
    for (const child of children) {
      if (typeof child.raw !== 'string') continue;
      let position = body.indexOf(child.raw, cursor);
      if (position < start || position + child.raw.length > end) position = body.indexOf(child.raw, start);
      if (position >= start && position + child.raw.length <= end) {
        visit(child, position, position + child.raw.length);
        cursor = position + child.raw.length;
      } else {
        // Blockquote/list indentation can change a block token's raw text;
        // individual inline child tokens still occur verbatim in the source.
        for (const inline of child.tokens ?? []) {
          const at = body.indexOf(inline.raw ?? '', cursor);
          if (inline.raw && at >= start && at + inline.raw.length <= end) { visit(inline, at, at + inline.raw.length); cursor = at + inline.raw.length; }
        }
      }
    }
  }
  let cursor = 0;
  for (const token of tokens) {
    const at = body.indexOf(token.raw, cursor);
    if (at >= 0) { visit(token, at, at + token.raw.length); cursor = at + token.raw.length; }
  }
  // Marked resolves definitions but stores them outside the regular token list.
  const definitions = /^[ \t]{0,3}(?:>[ \t]*)*\[[^\]\n]+\]:[ \t]*(?:<([^>\n]*)>|([^\s]+))/gm;
  for (const match of body.matchAll(definitions)) {
    if (blocked.some((range) => match.index >= range.from && match.index < range.to)) continue;
    const href = match[1] ?? match[2];
    const at = match.index + match[0].lastIndexOf(href);
    edit(at, at + href.length, href);
  }
  edits.sort((a, b) => b.from - a.from);
  let output = body;
  for (const change of edits) output = output.slice(0, change.from) + change.replacement + output.slice(change.to);
  return output;
}

function rewriteDocument(document, context) {
  const data = structuredClone(document.data);
  const references = [];
  function update(value, path, publicContent) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item, index) => update(item, `${path}.${index}`, publicContent)); return; }
    const visible = publicContent && value.visible !== false;
    for (const [key, child] of Object.entries(value)) {
      if (LINK_FIELDS.has(key) && typeof child === 'string') {
        const next = rewriteHref(child, context);
        if (next) {
          if (next.matched) references.push({ id: document.id, path: `${path}.${key}`.replace(/^\./, ''), href: child, public: visible });
          value[key] = next.href;
        }
      } else update(child, `${path}.${key}`, visible);
    }
  }
  const publicContent = document.kind === 'home' || document.kind === 'settings' || document.data.published === true;
  update(data, '', publicContent);
  if (document.kind === 'note') {
    data.body = rewriteMarkdown(data.body ?? '', (href) => {
      const next = rewriteHref(href, context);
      if (next?.matched) references.push({ id: document.id, path: 'body', href, public: publicContent });
      return next?.href ?? null;
    });
  }
  return { data, references };
}

export async function createDocumentLifecycle(store, { now = Date.now, afterWrite, siteUrl } = {}) {
  const root = store.root;
  const site = siteAddress(siteUrl);
  const plans = new Map();
  async function readMaybe(path) {
    const full = await containedPath(root, path, { allowMissing: true });
    try {
      const info = await lstat(full);
      if (!info.isFile() || info.size > MAX_TRANSACTION_BYTES) throw new StudioError(422, 'Lifecycle metadata is not a supported file.');
      return await readFile(full, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  const hash = (contents) => contents === null ? null : revisionOf(contents);
  async function redirects() {
    const raw = await readMaybe(REDIRECTS);
    let data;
    try { data = raw === null ? { version: 1, redirects: [] } : JSON.parse(raw); }
    catch { throw new StudioError(422, 'The redirects file is invalid JSON.'); }
    assertPlainData(data);
    try {
      const normalized = redirectMap(data);
      return { raw, data: { version: 1, redirects: Object.entries(normalized).map(([from, to]) => ({ from, to })) } };
    } catch (error) { throw new StudioError(422, error.message); }
  }
  async function trashEntry(trashId) {
    if (!idPattern.test(trashId ?? '')) throw new StudioError(400, 'Invalid trash item.');
    const path = `.studio/trash/${trashId}.json`;
    const raw = await readMaybe(path);
    if (raw === null) throw new StudioError(404, 'This trash item no longer exists.');
    let entry;
    try { entry = JSON.parse(raw); } catch { throw new StudioError(422, 'This trash item is damaged.'); }
    assertPlainData(entry);
    parseId(entry.id);
    if (entry.version !== 1 || entry.trashId !== trashId || typeof entry.contents !== 'string' || Buffer.byteLength(entry.contents) > MAX_DOCUMENT_BYTES || revisionOf(entry.contents) !== entry.revision) throw new StudioError(422, 'This trash item is damaged.');
    return { path, raw, entry };
  }
  async function trash() {
    const path = await containedPath(root, '.studio/trash', { allowMissing: true });
    const entries = await readdir(path, { withFileTypes: true }).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    const results = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{24}\.json$/.test(entry.name)) continue;
      const { entry: item } = await trashEntry(entry.name.slice(0, -5));
      if (!item.restoredAt) {
        const { contents, version, ...metadata } = item;
        results.push(metadata);
      }
    }
    return results.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  async function changeFile(mutation, backwards = false) {
    const before = backwards ? mutation.after : mutation.before;
    const after = backwards ? mutation.before : mutation.after;
    const current = await readMaybe(mutation.path);
    if (backwards && hash(current) === hash(after)) return; // This write never happened.
    if (hash(current) !== hash(before)) throw new StudioError(409, `The file ${mutation.path} changed during the operation. Its external edits were preserved.`);
    if (after === null) {
      const path = await containedPath(root, mutation.path);
      await unlink(path);
    } else await atomicWrite(root, mutation.path, after, { create: before === null, ...(before !== null ? { expectedRevision: hash(before) } : {}) });
  }
  async function rollback(journal, path) {
    const failures = [];
    for (const mutation of [...journal.mutations].reverse()) {
      try { await changeFile(mutation, true); } catch (error) { failures.push(error.message); }
    }
    journal.status = failures.length ? 'recovery-required' : 'rolled-back';
    journal.errors = failures;
    await atomicWrite(root, path, JSON.stringify(journal, null, 2));
    if (failures.length) throw new StudioError(503, `Recovery needs attention; original files are preserved in ${path}.`, failures);
  }
  async function recoverInterrupted() {
    const directory = await containedPath(root, '.studio/transactions', { allowMissing: true });
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{24}\.json$/.test(entry.name)) continue;
      const path = `.studio/transactions/${entry.name}`;
      let journal;
      try { journal = JSON.parse(await readMaybe(path)); } catch { throw new StudioError(503, `Recovery journal ${path} is damaged.`); }
      if (!['prepared', 'committing', 'recovery-required'].includes(journal.status)) continue;
      if (journal.version !== 1 || !Array.isArray(journal.mutations)) throw new StudioError(503, `Recovery journal ${path} is damaged.`);
      for (const item of journal.mutations) {
        if (typeof item.path !== 'string' || !(item.path.startsWith('src/content/') || item.path === REDIRECTS || /^\.studio\/trash\/[a-f0-9]{24}\.json$/.test(item.path)) || ![item.before, item.after].every((value) => value === null || typeof value === 'string')) throw new StudioError(503, `Recovery journal ${path} contains unsupported paths.`);
        if (item.path.startsWith('src/content/')) parseId(item.path.slice('src/content/'.length));
        await containedPath(root, item.path, { allowMissing: true });
      }
      await rollback(journal, path);
    }
  }
  await store.exclusive(recoverInterrupted);

  async function planUnlocked(input) {
    assertPlainData(input);
    if (!input || !['move', 'duplicate', 'delete', 'restore'].includes(input.operation)) throw new StudioError(400, 'Choose move, duplicate, delete, or restore.');
    const { operation } = input;
    const documents = await store.documents();
    const redirectState = await redirects();
    const snapshots = [];
    for (const document of documents) {
      const path = `src/content/${document.id}`;
      const contents = await readMaybe(path);
      if (hash(contents) !== document.revision) throw new StudioError(409, 'Content changed while preparing the plan. Review it again.');
      snapshots.push({ path, revision: document.revision });
    }
    snapshots.push({ path: REDIRECTS, revision: hash(redirectState.raw) });
    let original;
    let restored;
    if (operation === 'restore') {
      restored = await trashEntry(input.trashId);
      if (restored.entry.restoredAt) throw new StudioError(409, 'This item has already been restored.');
      if (input.id && input.id !== restored.entry.id) throw new StudioError(400, 'The trash item does not match this document.');
      if (input.revision && input.revision !== restored.entry.revision) throw new StudioError(409, 'The trash item changed. Review it again.');
      original = { id: restored.entry.id, ...parseId(restored.entry.id), data: parseDocument(restored.entry.id, restored.entry.contents), name: restored.entry.name, revision: restored.entry.revision };
      snapshots.push({ path: restored.path, revision: hash(restored.raw) });
    } else {
      parseId(input.id);
      original = documents.find((document) => document.id === input.id);
      if (!original) throw new StudioError(404, 'This document no longer exists.');
      if (input.revision !== original.revision) throw new StudioError(409, 'This document changed. Reload it before planning an operation.');
    }
    if (!['page', 'note'].includes(original.kind) || (CORE.has(original.id) && operation !== 'duplicate')) throw new StudioError(400, 'The homepage, site settings, and About page cannot be moved or removed.');
    if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200)) throw new StudioError(400, 'Enter a title of 1–200 characters.');
    const newId = ['move', 'duplicate'].includes(operation) ? destinationId(original.kind, input.slug) : original.id;
    const newRoute = parseId(newId).route;
    if (operation === 'move' && newId === original.id) throw new StudioError(400, 'Choose a different page address.');
    if (operation !== 'delete') {
      const collision = documents.find((document) => document.route.toLowerCase() === newRoute.toLowerCase() || document.id.toLowerCase() === newId.toLowerCase());
      if (collision) throw new StudioError(409, 'A document already uses that page address.');
      if (redirectState.data.redirects.some((item) => item.from.toLowerCase() === newRoute.toLowerCase())) throw new StudioError(409, 'An existing redirect uses that address. Choose a new address.');
      const target = await readMaybe(`src/content/${newId}`);
      if (target !== null) throw new StudioError(409, 'A content file already uses that address.');
      snapshots.push({ path: `src/content/${newId}`, revision: null });
    }
    const mutations = [];
    const changes = [];
    const references = [];
    const add = async (path, after, detail, action = 'update') => {
      const before = await readMaybe(path);
      if (before === after) return;
      mutations.push({ path, before, after });
      changes.push({ id: path.startsWith('src/content/') ? path.slice('src/content/'.length) : path, action, detail });
    };
    let resultData;
    if (operation === 'move' || operation === 'duplicate') {
      for (const document of documents) {
        if (operation === 'duplicate' && document.id !== original.id) continue;
        const isSource = document.id === original.id;
        const updated = rewriteDocument(document, { oldRoute: original.route, newRoute, sourceRoute: document.route, movedSource: isSource, site });
        references.push(...updated.references);
        if (isSource) {
          const title = input.title?.trim() ?? (operation === 'duplicate' ? `${document.name} — copy` : document.name);
          updated.data.title = title;
          if (updated.data.heading === document.data.title && title !== document.data.title) updated.data.heading = title;
          if (operation === 'duplicate') {
            updated.data.published = false;
            if (updated.data.navigation) { updated.data.navigation.show = false; updated.data.navigation.label = title; }
          }
          resultData = await store.validateDocument(newId, updated.data);
          await add(`src/content/${newId}`, serializeDocument(original.kind, resultData), `${operation === 'move' ? 'Move' : 'Copy'} ${original.route} to ${newRoute}${operation === 'duplicate' ? ' as an unpublished draft' : ''}.`, 'create');
        } else if (JSON.stringify(updated.data) !== JSON.stringify(document.data)) {
          const data = await store.validateDocument(document.id, updated.data);
          await add(`src/content/${document.id}`, serializeDocument(document.kind, data), `Update links from ${original.route} to ${newRoute}.`, 'update-links');
        }
      }
      if (operation === 'move') {
        const next = structuredClone(redirectState.data);
        for (const item of next.redirects) if (item.to === original.route) item.to = newRoute;
        if (original.data.published) next.redirects.push({ from: original.route, to: newRoute });
        if (JSON.stringify(next) !== JSON.stringify(redirectState.data)) await add(REDIRECTS, `${JSON.stringify(next, null, 2)}\n`, 'Keep previously published URLs working.', 'redirect');
        await add(`src/content/${original.id}`, null, 'Remove the previous filename after the destination and link updates are written.', 'remove');
      }
    } else if (operation === 'delete') {
      const removesNotesIndex = original.kind === 'note' && original.data.published === true && !documents.some((document) => document.id !== original.id && document.kind === 'note' && document.data.published === true);
      for (const document of documents) {
        if (document.id === original.id) continue;
        references.push(...rewriteDocument(document, { oldRoute: original.route, newRoute: original.route, sourceRoute: document.route, site }).references);
        if (removesNotesIndex) references.push(...rewriteDocument(document, { oldRoute: '/notes', newRoute: '/notes', sourceRoute: document.route, site }).references);
      }
      redirectState.data.redirects.forEach((item, index) => { if (item.to === original.route || (removesNotesIndex && item.to === '/notes')) references.push({ id: REDIRECTS, path: `redirects.${index}.to`, href: item.to, public: true }); });
      const trashId = randomBytes(12).toString('hex');
      const contents = await readMaybe(`src/content/${original.id}`);
      const entry = { version: 1, trashId, id: original.id, kind: original.kind, name: original.name, route: original.route, deletedAt: new Date(now()).toISOString(), revision: original.revision, contents };
      await add(`.studio/trash/${trashId}.json`, JSON.stringify(entry, null, 2), 'Preserve the complete original document in local Trash.', 'trash');
      await add(`src/content/${original.id}`, null, `Move ${original.route} to local Trash.`, 'remove');
    } else {
      resultData = await store.validateDocument(newId, original.data);
      await add(`src/content/${newId}`, restored.entry.contents, `Restore ${original.route} with its original publication state.`, 'restore');
      await add(restored.path, JSON.stringify({ ...restored.entry, restoredAt: new Date(now()).toISOString() }, null, 2), 'Keep an audit record of the restored item.', 'restore-trash');
    }
    const bytes = mutations.reduce((total, item) => total + Buffer.byteLength(item.before ?? '') + Buffer.byteLength(item.after ?? ''), 0);
    if (bytes > MAX_TRANSACTION_BYTES) throw new StudioError(413, 'This operation is larger than the 16 MB transaction limit.');
    const blocked = operation === 'delete' && references.length > 0;
    const planId = randomBytes(12).toString('hex');
    const expiresAt = new Date(now() + PLAN_LIFETIME).toISOString();
    const publicPlan = {
      planId, operation, summary: blocked ? `Resolve ${references.length} incoming link(s) before deleting ${original.route}.` : `${operation[0].toUpperCase() + operation.slice(1)} “${original.name}”${newRoute !== original.route ? ` to ${newRoute}` : ''}.`,
      changes, references, expiresAt, blocked,
      oldId: original.id, newId: operation === 'delete' ? null : newId, fromRoute: original.route, toRoute: operation === 'delete' ? null : newRoute
    };
    for (const [id, item] of plans) if (Date.parse(item.public.expiresAt) <= now()) plans.delete(id);
    if (plans.size >= 20) plans.delete(plans.keys().next().value);
    plans.set(planId, { public: structuredClone(publicPlan), mutations: structuredClone(mutations), snapshots, inventory: documents.map((item) => item.id).sort() });
    return publicPlan;
  }

  return {
    trash: () => store.exclusive(trash),
    plan: (input) => store.exclusive(() => planUnlocked(input)),
    apply: ({ planId }) => store.exclusive(async () => {
      if (!idPattern.test(planId ?? '')) throw new StudioError(400, 'Invalid lifecycle plan.');
      const plan = plans.get(planId);
      if (!plan || Date.parse(plan.public.expiresAt) <= now()) throw new StudioError(409, 'This plan expired or Studio restarted. Review a new plan.');
      if (plan.public.blocked) throw new StudioError(409, plan.public.summary, plan.public.references);
      const current = await store.documents();
      if (JSON.stringify(current.map((item) => item.id).sort()) !== JSON.stringify(plan.inventory)) throw new StudioError(409, 'The page list changed. Review a new plan before applying.');
      for (const source of plan.snapshots) if (hash(await readMaybe(source.path)) !== source.revision) throw new StudioError(409, `The file ${source.path} changed after this plan was prepared. Review a new plan.`);
      for (const mutation of plan.mutations) if (hash(await readMaybe(mutation.path)) !== hash(mutation.before)) throw new StudioError(409, 'A destination or reference changed. Review a new plan.');
      const journalPath = `.studio/transactions/${planId}.json`;
      const journal = { version: 1, id: planId, operation: plan.public.operation, createdAt: new Date(now()).toISOString(), status: 'prepared', mutations: plan.mutations };
      await atomicWrite(root, journalPath, JSON.stringify(journal, null, 2), { create: true });
      try {
        journal.status = 'committing';
        await atomicWrite(root, journalPath, JSON.stringify(journal, null, 2));
        for (const [index, mutation] of plan.mutations.entries()) {
          await changeFile(mutation);
          if (afterWrite) await afterWrite({ index, path: mutation.path });
        }
        journal.status = 'complete';
        journal.completedAt = new Date(now()).toISOString();
        await atomicWrite(root, journalPath, JSON.stringify(journal, null, 2));
      } catch (error) {
        await rollback(journal, journalPath);
        plans.delete(planId);
        throw new StudioError(500, `The operation could not finish and its changes were rolled back: ${error.message}`);
      }
      plans.delete(planId);
      const documents = await store.documents();
      const changedIds = plan.mutations.filter((item) => item.path.startsWith('src/content/')).map((item) => item.path.slice('src/content/'.length));
      return { documents, document: documents.find((item) => item.id === plan.public.newId), trash: await trash(), changedIds, oldId: plan.public.oldId, newId: plan.public.newId };
    })
  };
}
