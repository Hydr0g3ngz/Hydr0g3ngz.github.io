import { lexer } from 'marked';

export const SEARCH_LIMITS = Object.freeze({ query: 200, results: 100, excerpt: 240, field: 50_000, document: 100_000, totalText: 1_000_000, documents: 2_000, media: 5_000, nodes: 4_000, depth: 12 });
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const kinds = new Set(['home', 'page', 'note', 'settings']);
const textFields = new Set(['title', 'defaultTitle', 'brand', 'description', 'heading', 'eyebrow', 'lede', 'intro', 'label', 'tag', 'summary', 'imageAlt', 'coverAlt', 'originalTitle', 'future', 'linkLabel', 'creditsLabel', 'licenseLabel', 'year', 'kind', 'body', 'imageCredit', 'text', 'meta', 'quote', 'attribution', 'value', 'author', 'artist', 'blurb', 'sourceLabel', 'reflection', 'translation', 'work', 'name', 'track', 'note', 'lyricExcerpt', 'alternateLabel', 'category', 'footerText', 'updated', 'date', 'venue', 'emptyNote']);
const containers = new Set(['sections', 'links', 'categories', 'items', 'following', 'credits', 'books', 'readingPaths', 'excerpts', 'artists', 'albums', 'facts', 'paragraphs', 'themes', 'navigation', 'groups', 'entries', 'records']);
const stringArrays = new Set(['paragraphs', 'themes', 'items']);
const settingsFields = new Set(['brand', 'defaultTitle', 'footerText']);
const titleFields = new Set(['title', 'defaultTitle', 'brand', 'heading', 'originalTitle', 'track', 'work']);
const markdownFields = new Set(['body']);
textFields.add('context');
textFields.add('contextSourceLabel');
const isPlain = value => value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (object, key) => object && Object.getOwnPropertyDescriptor(object, key)?.value;
const fold = text => text.normalize('NFC').toLowerCase().normalize('NFC');

function clip(text, length) {
  if (text.length <= length) return text;
  let end = length;
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}

function markdownText(source) {
  const tokensText = (tokens, depth = 0) => {
    if (!Array.isArray(tokens) || depth > SEARCH_LIMITS.depth) return '';
    return tokens.map(token => {
      if (token.type === 'html' || token.type === 'def') return '';
      if (['space', 'br', 'hr'].includes(token.type)) return ' ';
      if (token.type === 'list') return token.items.map(item => tokensText(item.tokens, depth + 1)).join(' ');
      if (token.type === 'table') return [...token.header, ...token.rows.flat()].map(cell => tokensText(cell.tokens, depth + 1)).join(' ');
      if (token.type === 'image') return token.text || '';
      const value = token.tokens ? tokensText(token.tokens, depth + 1) : token.text || '';
      return ['paragraph', 'heading', 'blockquote', 'code', 'table'].includes(token.type) ? `${value} ` : value;
    }).join('');
  };
  try { return tokensText(lexer(source, { gfm: true })); } catch { return ''; }
}

function plainText(value, markdown = false) {
  const text = markdown ? markdownText(value) : value;
  return text
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|textarea)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/(?:https?:\/\/|mailto:)[^\s<>]+/gi, ' ')
    .replace(/\b[A-Za-z]:[\\/][^\s]+/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Map normalized matches back to original plaintext UTF-16 grapheme boundaries. */
function matchText(text, query) {
  let normalized = '';
  const starts = [], ends = [];
  for (const { segment, index } of segmenter.segment(text)) {
    // A pathological single grapheme (hundreds of combining marks) cannot be
    // represented by a bounded, intact excerpt; do not make it a match target.
    const value = segment.length > SEARCH_LIMITS.excerpt - 2 ? ' ' : fold(segment);
    normalized += value;
    for (let i = 0; i < value.length; i++) { starts.push(index); ends.push(index + segment.length); }
  }
  const start = normalized.indexOf(query);
  if (start === -1) return null;
  return { start: starts[start], end: ends[start + query.length - 1], exact: normalized === query, prefix: start === 0 };
}

function excerptFor(text, match) {
  const boundaries = [0];
  for (const { segment, index } of segmenter.segment(text)) boundaries.push(index + segment.length);
  const context = Math.max(0, SEARCH_LIMITS.excerpt - (match.end - match.start) - 2);
  const desiredStart = Math.max(0, match.start - Math.min(48, Math.floor(context / 2)));
  let start = boundaries.find(boundary => boundary >= desiredStart) ?? 0;
  if (start > match.start) start = match.start;
  const maxEnd = start + SEARCH_LIMITS.excerpt - (start > 0 ? 1 : 0) - 1;
  let end = start;
  for (const boundary of boundaries) {
    if (boundary > maxEnd) break;
    if (boundary >= end) end = boundary;
  }
  const prefix = start > 0 ? '…' : '';
  return { excerpt: `${prefix}${text.slice(start, end)}${end < text.length ? '…' : ''}`, matchStart: prefix.length + match.start - start, matchEnd: prefix.length + Math.min(match.end, end) - start };
}

function contentLeaves(data, settings, budget) {
  const leaves = [];
  const seen = new WeakSet();
  let nodes = 0, consumed = 0;
  const visit = (value, path, depth, arrayField) => {
    if (++nodes > SEARCH_LIMITS.nodes || depth > SEARCH_LIMITS.depth) { budget.truncated = true; return; }
    if (typeof value === 'string') {
      const key = path.at(-1);
      if (!(textFields.has(key) || (/^\d+$/.test(key) && stringArrays.has(arrayField)))) return;
      const available = Math.min(SEARCH_LIMITS.field, SEARCH_LIMITS.document - consumed, budget.remaining);
      if (value.length > available) budget.truncated = true;
      if (available <= 0) return;
      const clipped = clip(value, available);
      consumed += clipped.length;
      budget.remaining -= clipped.length;
      leaves.push({ path, text: plainText(clipped, markdownFields.has(key)), title: titleFields.has(key) });
      return;
    }
    if ((!isPlain(value) && !Array.isArray(value)) || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, SEARCH_LIMITS.nodes); i++) {
        if (nodes >= SEARCH_LIMITS.nodes || consumed >= SEARCH_LIMITS.document || budget.remaining <= 0) { budget.truncated = true; break; }
        visit(own(value, String(i)), [...path, String(i)], depth + 1, arrayField);
      }
      if (value.length > SEARCH_LIMITS.nodes) budget.truncated = true;
    } else {
      for (const key of Object.keys(value)) {
        if (settings && (!settingsFields.has(key) || path.length > 0)) continue;
        if (!textFields.has(key) && !containers.has(key)) continue;
        if (nodes >= SEARCH_LIMITS.nodes || consumed >= SEARCH_LIMITS.document || budget.remaining <= 0) { budget.truncated = true; break; }
        const child = own(value, key);
        if (typeof child === 'string' ? textFields.has(key) : containers.has(key)) visit(child, [...path, key], depth + 1, key);
      }
    }
  };
  visit(data, [], 0);
  return leaves;
}

function safeRoute(route) {
  return typeof route === 'string' && route.length <= 500 && /^\/(?!\/)/.test(route) && !/[\\\u0000-\u0020\u007f]/.test(route) ? route : '/';
}

function safeMediaPath(path) {
  return typeof path === 'string' && path.length <= 500 && /^\/(?:images|uploads)\//.test(path) && !/[\\%?#\u0000-\u001f\u007f]/.test(path) && path.split('/').every(part => part !== '.' && part !== '..');
}

/**
 * Search a saved store snapshot only. No filesystem/network access, mutations,
 * schema/config traversal, or HTML output. Document paths are data leaf arrays;
 * media paths remain public asset strings. `total` counts unique matches inside
 * the bounded scan; `truncated` also flags any scan/input cap (not only paging).
 */
export function searchContent({ documents = [], media = [], query, limit = 30 } = {}) {
  if (typeof query !== 'string' || query.length > SEARCH_LIMITS.query) return { results: [], total: 0, truncated: false };
  const normalizedQuery = fold(query.replace(/\s+/gu, ' ').trim());
  if (!normalizedQuery) return { results: [], total: 0, truncated: false };
  const resultLimit = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), SEARCH_LIMITS.results) : 30;
  const budget = { remaining: SEARCH_LIMITS.totalText, truncated: false };
  const matches = [], identities = new Set();
  const sourceDocuments = Array.isArray(documents) ? documents : [];
  if (sourceDocuments.length > SEARCH_LIMITS.documents) budget.truncated = true;
  for (const document of sourceDocuments.slice(0, SEARCH_LIMITS.documents)) {
    if (!isPlain(document)) continue;
    const id = own(document, 'id'), kind = own(document, 'kind'), data = own(document, 'data');
    if (typeof id !== 'string' || id.length > 220 || !kinds.has(kind) || !isPlain(data) || identities.has(id)) continue;
    identities.add(id);
    if (budget.remaining <= 0) { budget.truncated = true; break; }
    const leaves = contentLeaves(data, kind === 'settings', budget);
    let best;
    for (const leaf of leaves) {
      if (!leaf.text) continue;
      const hit = matchText(leaf.text, normalizedQuery);
      if (!hit) continue;
      const rank = (leaf.title ? leaf.path.length === 1 ? 0 : 10 : 20) + (hit.exact ? 0 : hit.prefix ? 1 : 2);
      if (!best || rank < best.rank) best = { ...leaf, hit, rank };
    }
    if (!best) continue;
    const titleValue = [own(data, 'title'), own(data, 'brand'), own(data, 'defaultTitle'), own(document, 'name'), kind].find(value => typeof value === 'string' && value.trim());
    const title = clip(plainText(clip(titleValue, 2_000)), 200);
    const result = {
      id, kind, title, route: safeRoute(own(document, 'route')), path: best.path,
      ...excerptFor(best.text, best.hit),
      published: kind === 'home' || kind === 'settings' || own(data, 'published') === true
    };
    if (best.path[0] === 'sections' && /^\d+$/.test(best.path[1] ?? '')) result.sectionIndex = Number(best.path[1]);
    matches.push({ result, rank: best.rank });
  }
  const sourceMedia = Array.isArray(media) ? media : [];
  if (sourceMedia.length > SEARCH_LIMITS.media) budget.truncated = true;
  for (const item of sourceMedia.slice(0, SEARCH_LIMITS.media)) {
    if (!isPlain(item)) continue;
    const path = own(item, 'path');
    if (!safeMediaPath(path) || identities.has(`media:${path}`)) continue;
    identities.add(`media:${path}`);
    const rawName = own(item, 'name');
    const title = clip(plainText(clip(typeof rawName === 'string' ? rawName : path.split('/').at(-1), 2_000)), 200);
    const hit = matchText(title, normalizedQuery);
    if (hit) matches.push({ rank: 30 + (hit.exact ? 0 : hit.prefix ? 1 : 2), result: { id: `media:${path}`, kind: 'media', title, route: path, path, ...excerptFor(title, hit) } });
  }
  matches.sort((a, b) => a.rank - b.rank);
  return { results: matches.slice(0, resultLimit).map(match => match.result), total: matches.length, truncated: budget.truncated || matches.length > resultLimit };
}
