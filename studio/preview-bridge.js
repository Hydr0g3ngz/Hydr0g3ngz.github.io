const content = JSON.parse(document.querySelector('#studio-content-data')?.textContent || '{}');
const identity = { id: document.querySelector('#studio-content-data')?.dataset.documentId, rev: document.querySelector('#studio-content-data')?.dataset.previewRev };
let mode = 'edit';
document.body.dataset.studioMode = mode;
function send(message) { window.parent.postMessage({ source: 'will-studio-preview', ...identity, ...message }, window.location.origin); }
function leaves(value, prefix = [], output = []) {
  if (typeof value === 'string' && value.trim()) output.push({ path: prefix, value: value.trim() });
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => leaves(child, [...prefix, key], output));
  return output;
}
document.querySelectorAll('[data-studio-block]').forEach(section => {
  const index = section.dataset.studioBlock;
  const records = index === 'page' ? leaves(content).filter(x => x.path[0] !== 'sections') : leaves(content.sections?.[Number(index)], ['sections', index]);
  const candidates = [...section.querySelectorAll('h1,h2,h3,h4,p,li,span,a,blockquote,figcaption,strong,cite')].reverse();
  for (const element of candidates) {
    if (element.querySelector('[data-studio-path]') || element.closest('.note-body')) continue;
    const matches = records.filter(record => record.value === element.textContent.trim());
    if (matches.length === 1) element.dataset.studioPath = JSON.stringify(matches[0].path);
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
document.addEventListener('dblclick', event => {
  if (mode !== 'edit' || !(event.target instanceof Element)) return;
  const element = event.target.closest('[data-studio-path]');
  if (!element || element.children.length) return;
  element.setAttribute('contenteditable', 'true'); element.focus();
  const original = element.textContent;
  const range = document.createRange(); range.selectNodeContents(element);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  element.addEventListener('paste', paste => {
    paste.preventDefault(); const selection = window.getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); range.deleteContents(); const text = document.createTextNode(paste.clipboardData?.getData('text/plain') ?? ''); range.insertNode(text); range.setStartAfter(text); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  }, { once: true });
  element.addEventListener('keydown', key => {
    if (key.key === 'Escape') { element.textContent = original; element.blur(); }
    if (key.key === 'Enter' && !key.shiftKey) { key.preventDefault(); element.blur(); }
  });
  element.addEventListener('blur', () => {
    element.removeAttribute('contenteditable');
    if (element.textContent !== original) send({ type: 'edit', path: JSON.parse(element.dataset.studioPath), value: element.textContent });
  }, { once: true });
});
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.source !== 'will-studio') return;
  const message = event.data;
  if (message.type === 'mode') { mode = message.mode; document.body.dataset.studioMode = mode; }
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
