const content = JSON.parse(document.querySelector('#studio-content-data')?.textContent || '{}');
const identity = { id: document.querySelector('#studio-content-data')?.dataset.documentId, rev: document.querySelector('#studio-content-data')?.dataset.previewRev };
let mode = 'edit';
document.body.dataset.studioMode = mode;
function send(message) {
  const payload = { source: 'will-studio-preview', ...identity, ...message };
  if (['edit', 'editing', 'save'].includes(message.type)) {
    // Local previews share Studio's origin. Commit within this event turn: a queued
    // postMessage can arrive after the user has switched to another document.
    window.parent.dispatchEvent(new window.parent.MessageEvent('message', { data: payload, origin: window.location.origin, source: window }));
  } else window.parent.postMessage(payload, window.location.origin);
}
function leaves(value, prefix = [], output = []) {
  if (typeof value === 'string' && value.trim()) output.push({ path: prefix, value: value.trim() });
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => leaves(child, [...prefix, key], output));
  return output;
}
document.querySelectorAll('[data-studio-block]').forEach(section => {
  const index = section.dataset.studioBlock;
  const records = index === 'page' ? leaves(content).filter(x => x.path[0] !== 'sections') : leaves(content.sections?.[Number(index)], ['sections', index]);
  const assigned = new Set();
  const candidates = [...section.querySelectorAll('h1,h2,h3,h4,p,li,span,a,blockquote,figcaption,strong,cite')].reverse();
  for (const element of candidates) {
    if (element.querySelector('[data-studio-path]') || element.closest('.note-body')) continue;
    const matches = records.filter(record => record.value === element.textContent.trim());
    if (matches.length === 1) {
      const path = JSON.stringify(matches[0].path);
      if (!assigned.has(path)) { element.dataset.studioPath = path; assigned.add(path); }
    }
  }
});
document.addEventListener('click', event => {
  if (mode !== 'edit') return;
  const element = event.target instanceof Element ? event.target : null;
  if (!element) return;
  if (element.closest('[contenteditable="true"]')) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const section = element.closest('[data-studio-block]');
  const field = element.closest('[data-studio-path]');
  if (section) send({ type: 'select', index: section.dataset.studioBlock, path: field?.dataset.studioPath ? JSON.parse(field.dataset.studioPath) : null });
}, true);
const inlineEditing = installInlineEditing({ window, identity, isEditMode: () => mode === 'edit', send });
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.source !== 'will-studio') return;
  const message = event.data;
  if (message.type === 'mode') { if (message.mode !== 'edit') inlineEditing.flush(); mode = message.mode; document.body.dataset.studioMode = mode; }
  if (message.type === 'select') {
    document.querySelectorAll('.studio-selected').forEach(e => e.classList.remove('studio-selected'));
    const section = [...document.querySelectorAll('[data-studio-block]')].find(e => e.dataset.studioBlock === String(message.index));
    if (section) { section.classList.add('studio-selected'); if (message.scroll) section.firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  if (message.type === 'scroll') window.scrollTo(0, Number(message.y) || 0);
});
let timer;
window.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(() => send({ type: 'scroll', y: window.scrollY }), 100); }, { passive: true });
send({ type: 'ready' });
import { installInlineEditing } from './inline-session.mjs';
