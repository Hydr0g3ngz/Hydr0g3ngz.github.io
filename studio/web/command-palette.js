let paletteCount = 0;

/**
 * Local, framework-independent search UI. Import command-palette.css separately.
 * Search returns { results, total, truncated }; document result paths are arrays,
 * media paths are strings. Opening a document may return false to cancel selection.
 * The host owns the global shortcut, so rich-text Ctrl/Cmd+K remains untouched.
 */
export function createCommandPalette({ openDocument, selectField, listCommands = () => [], search, toast = () => {}, onMedia } = {}) {
  const doc = document;
  const win = doc.defaultView;
  const events = new win.AbortController();
  const uid = `studio-command-${++paletteCount}`;
  let opened = false;
  let destroyed = false;
  let previousFocus = null;
  let revision = 0;
  let searchTimer;
  let composing = false;
  let options = [];
  let selected = -1;
  let query = '';

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  const dialog = element('dialog', 'command-dialog');
  dialog.setAttribute('aria-labelledby', `${uid}-title`);
  dialog.setAttribute('aria-describedby', `${uid}-help`);
  const heading = element('div', 'command-heading');
  const title = element('h2', '', 'Search Studio');
  title.id = `${uid}-title`;
  const dismiss = element('button', 'command-close', 'Close');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Close search');
  heading.append(title, dismiss);

  const searchbar = element('div', 'command-searchbar');
  const label = element('label', 'command-sr-only', 'Search pages, saved content and commands');
  label.htmlFor = `${uid}-input`;
  const input = element('input', 'command-input');
  input.id = `${uid}-input`;
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = 'Search pages, words, images…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', `${uid}-results`);
  input.setAttribute('aria-expanded', 'false');
  const clear = element('button', 'command-clear', 'Clear');
  clear.type = 'button';
  clear.hidden = true;
  clear.setAttribute('aria-label', 'Clear search');
  searchbar.append(label, input, clear);

  const status = element('p', 'command-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const results = element('div', 'command-results');
  results.id = `${uid}-results`;
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', 'Search results and commands');
  const help = element('div', 'command-footer');
  help.id = `${uid}-help`;
  help.append(element('span', '', 'Searches saved local content. Unsaved drafts are not included.'), element('span', 'command-keys', '↑ ↓ to move · Enter to open · Esc to close'));
  dialog.append(heading, searchbar, status, results, help);
  doc.body.append(dialog);

  function listen(target, type, callback) { target.addEventListener(type, callback, { signal: events.signal }); }

  // Only text nodes and marks are created: neither content nor query becomes HTML.
  function highlight(target, value, range) {
    const text = String(value ?? '');
    const ranges = [];
    if (range && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] >= 0 && range[1] > range[0] && range[1] <= text.length) {
      ranges.push(range);
    } else if (query) {
      const tokens = [...new Set(query.split(/\s+/u).filter(Boolean))].sort((a, b) => b.length - a.length);
      const pattern = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      if (pattern) for (const match of text.matchAll(new RegExp(pattern, 'giu'))) ranges.push([match.index, match.index + match[0].length]);
    }
    let cursor = 0;
    for (const [start, end] of ranges) {
      target.append(doc.createTextNode(text.slice(cursor, start)), element('mark', '', text.slice(start, end)));
      cursor = end;
    }
    target.append(doc.createTextNode(text.slice(cursor)));
  }

  function setSelected(index, scroll = false) {
    selected = index;
    for (let i = 0; i < options.length; i++) options[i].node.setAttribute('aria-selected', String(i === selected));
    const active = options[selected];
    if (active) {
      input.setAttribute('aria-activedescendant', active.node.id);
      if (scroll) active.node.scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function commandItems() {
    const commands = listCommands();
    if (!Array.isArray(commands)) throw new Error('Commands could not be loaded.');
    const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return commands.filter(command => command && typeof command.run === 'function' && typeof command.label === 'string' && terms.every(term => `${command.label} ${command.description || ''}`.toLocaleLowerCase().includes(term)));
  }

  function appendOption(item, command = false) {
    const row = element('div', 'command-option');
    const index = options.length;
    row.id = `${uid}-option-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    const disabled = command ? Boolean(item.disabled) : item.kind === 'media' ? typeof onMedia !== 'function' : typeof openDocument !== 'function' || typeof item.id !== 'string';
    if (disabled) row.setAttribute('aria-disabled', 'true');
    const top = element('div', 'command-option-top');
    const name = element('strong', 'command-option-title');
    highlight(name, command ? item.label : item.title || item.id || 'Untitled');
    const kinds = { home: 'Home', page: 'Page', note: 'Note', settings: 'Settings', media: 'Image' };
    top.append(name, element('span', 'command-kind', command ? 'Command' : kinds[item.kind] || 'Content'));
    row.append(top);
    if (!command && (item.route || item.published === false)) {
      row.append(element('span', 'command-option-location', [item.route, item.published === false ? 'Draft' : ''].filter(Boolean).join(' · ')));
    }
    const excerpt = command ? item.description : item.excerpt;
    if (excerpt) {
      const detail = element('span', 'command-option-excerpt');
      highlight(detail, excerpt, command ? null : [item.matchStart, item.matchEnd]);
      row.append(detail);
    }
    options.push({ node: row, item, command, disabled });
    results.append(row);
  }

  function render({ commands = [], found = [], message = '', loading = false, error = false } = {}) {
    results.replaceChildren();
    options = [];
    selected = -1;
    input.removeAttribute('aria-activedescendant');
    results.setAttribute('aria-busy', String(loading));
    dialog.dataset.state = loading ? 'loading' : error ? 'error' : commands.length || found.length ? 'ready' : 'empty';
    status.textContent = message;
    status.classList.toggle('command-error', error);
    if (commands.length) {
      const group = element('div', 'command-group-label', query ? 'Commands' : 'Common actions');
      group.setAttribute('role', 'presentation'); results.append(group);
      commands.forEach(command => appendOption(command, true));
    }
    if (found.length) {
      const group = element('div', 'command-group-label', 'Saved content');
      group.setAttribute('role', 'presentation'); results.append(group);
      found.forEach(item => appendOption(item));
    }
    setSelected(options.findIndex(option => !option.disabled));
  }

  function refresh({ immediate = false } = {}) {
    clearTimeout(searchTimer);
    const request = ++revision;
    query = input.value.trim().slice(0, 200);
    clear.hidden = input.value.length === 0;
    let commands;
    try { commands = commandItems(); }
    catch (error) { render({ error: true, message: error?.message || 'Commands could not be loaded.' }); return; }
    if (!query) {
      render({ commands, message: commands.length ? 'Choose an action, or type to find content.' : 'Type to search saved pages and images.' });
      return;
    }
    render({ commands, loading: true, message: composing ? 'Finish typing to search…' : 'Searching saved content…' });
    if (composing) return;
    const run = async () => {
      try {
        if (typeof search !== 'function') throw new Error('Content search is not available.');
        const response = await search(query);
        if (destroyed || !opened || request !== revision) return;
        if (!response || !Array.isArray(response.results)) throw new Error('Search returned an unreadable response. Try again.');
        const found = response.results.filter(item => item && typeof item === 'object');
        const total = Number.isFinite(response.total) ? Math.max(found.length, response.total) : found.length;
        let message = found.length ? `${total} content result${total === 1 ? '' : 's'}.` : 'No saved content found. Try another word.';
        if (response.truncated) message = `Showing ${found.length} content result${found.length === 1 ? '' : 's'}. More matches may be available; narrow your search.`;
        render({ commands, found, message });
      } catch (error) {
        if (destroyed || !opened || request !== revision) return;
        render({ commands, error: true, message: error?.message || 'Search failed. Try again.' });
      }
    };
    if (immediate) void run();
    else searchTimer = setTimeout(run, 140);
  }

  function restoreFocus() {
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }

  function close() {
    if (!opened) return;
    opened = false;
    revision++;
    composing = false;
    clearTimeout(searchTimer);
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    restoreFocus();
  }

  async function activate(index) {
    const option = options[index];
    if (!opened || !option || option.disabled) return;
    close();
    const action = revision;
    try {
      if (option.command) await option.item.run();
      else if (option.item.kind === 'media') await onMedia(option.item.path);
      else {
        const result = await openDocument(option.item.id);
        // A newer opening/destroy wins over a slow document-opening callback.
        if (result !== false && !destroyed && action === revision && Array.isArray(option.item.path)) await selectField?.(option.item.path.slice(), option.item.sectionIndex);
      }
    } catch (error) {
      if (!destroyed) toast(error?.message || 'This action could not be completed.', true);
    }
  }

  function open(initialQuery = '') {
    if (destroyed) return;
    if (opened) { input.focus(); input.select(); return; }
    previousFocus = doc.activeElement;
    opened = true;
    composing = false;
    input.value = typeof initialQuery === 'string' ? initialQuery.slice(0, 200) : '';
    input.setAttribute('aria-expanded', 'true');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    refresh({ immediate: true });
    input.focus();
    input.select();
  }

  function destroy() {
    if (destroyed) return;
    close();
    destroyed = true;
    revision++;
    clearTimeout(searchTimer);
    events.abort();
    dialog.remove();
    options = [];
    previousFocus = null;
  }

  listen(dismiss, 'click', close);
  listen(clear, 'click', () => { input.value = ''; composing = false; refresh(); input.focus(); });
  listen(input, 'input', refresh);
  listen(input, 'compositionstart', () => { composing = true; clearTimeout(searchTimer); revision++; });
  listen(input, 'compositionend', () => { composing = false; refresh(); });
  listen(results, 'pointerdown', event => { if (event.target.closest('[role="option"]')) event.preventDefault(); });
  listen(results, 'pointermove', event => {
    const row = event.target.closest('[role="option"]');
    const index = options.findIndex(option => option.node === row);
    if (index >= 0 && !options[index].disabled && index !== selected) setSelected(index);
  });
  listen(results, 'click', event => {
    const row = event.target.closest('[role="option"]');
    void activate(options.findIndex(option => option.node === row));
  });
  listen(dialog, 'cancel', event => { event.preventDefault(); if (!composing) close(); });
  listen(dialog, 'close', () => {
    // Native close events can arrive after another open; do not dismiss it again.
    if (opened && !dialog.open) close();
  });
  listen(dialog, 'click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  });
  listen(dialog, 'keydown', event => {
    if (event.isComposing || event.keyCode === 229 || composing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.target !== input) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
      if (!enabled.length) return;
      const at = enabled.indexOf(selected);
      const next = at === -1 ? event.key === 'ArrowDown' ? 0 : enabled.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setSelected(enabled[next], true);
    } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void activate(selected); }
  });

  return { open, close, destroy };
}
