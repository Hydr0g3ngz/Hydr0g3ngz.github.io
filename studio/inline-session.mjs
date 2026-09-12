/** One plain-text edit session at a time. Every session owns and removes its listeners. */
export function installInlineEditing({ window, identity, isEditMode, send }) {
  const document = window.document;
  let active;
  const lifecycle = new window.AbortController();
  const editing = (session, current = true) => send({ type: 'editing', active: current, dirty: current && session.element.textContent !== session.original });

  function finish({ cancel = false } = {}) {
    const session = active;
    if (!session) return;
    active = undefined;
    session.listeners.abort();
    if (cancel) session.element.textContent = session.original;
    const value = session.element.textContent;
    session.element.removeAttribute('contenteditable');
    if (!cancel && value !== session.original) send({ type: 'edit', path: session.path, value });
    editing(session, false);
    session.element.blur();
  }

  function insertPlainText(session, value) {
    if (!value) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange();
    if (!session.element.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(session.element);
      range.collapse(false);
    }
    range.deleteContents();
    const text = document.createTextNode(value);
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editing(session);
  }

  function start(event) {
    if (!isEditMode() || !(event.target instanceof window.Element)) return;
    const element = event.target.closest('[data-studio-path]');
    if (!element || element.children.length || element.closest('.note-body')) return;
    if (active?.element === element) return;
    finish();
    let path;
    try { path = JSON.parse(element.dataset.studioPath); } catch { return; }
    if (!Array.isArray(path) || !path.length || !path.every(key => typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key))) return;
    const session = { element, path, original: element.textContent, composing: false, listeners: new window.AbortController() };
    active = session;
    const options = { signal: session.listeners.signal };
    element.setAttribute('contenteditable', 'true');
    element.addEventListener('input', () => editing(session), options);
    element.addEventListener('compositionstart', () => { session.composing = true; }, options);
    element.addEventListener('compositionend', () => { session.composing = false; editing(session); }, options);
    element.addEventListener('paste', event => {
      event.preventDefault();
      insertPlainText(session, event.clipboardData?.getData('text/plain') ?? '');
    }, options);
    element.addEventListener('drop', event => {
      event.preventDefault();
      insertPlainText(session, event.dataTransfer?.getData('text/plain') ?? '');
    }, options);
    element.addEventListener('keydown', event => {
      if (event.isComposing || session.composing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish({ cancel: true }); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) insertPlainText(session, '\n'); else finish();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        finish();
        send({ type: 'save' });
      } else if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) event.preventDefault();
    }, options);
    element.addEventListener('blur', () => finish(), options);
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    editing(session);
  }

  document.addEventListener('dblclick', start, { signal: lifecycle.signal });
  const api = Object.freeze({
    identity: Object.freeze({ ...identity }),
    get active() { return !!active; },
    flush() {
      // Blurring lets the browser finish its IME composition before reading final text.
      active?.element.blur();
      finish();
    },
    cancel: () => finish({ cancel: true }),
    destroy() { finish(); lifecycle.abort(); if (window.__willStudioInline === api) delete window.__willStudioInline; }
  });
  window.__willStudioInline?.destroy();
  window.__willStudioInline = api;
  window.addEventListener('beforeunload', () => api.flush(), { signal: lifecycle.signal });
  return api;
}
