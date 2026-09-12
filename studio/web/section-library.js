const definitions = new Map([
  ['hero', ['Basics', 'hero']], ['text', ['Basics', 'text']], ['image_text', ['Basics', 'image']],
  ['quote', ['Basics', 'quote']], ['marquee', ['Basics', 'marquee']], ['closing', ['Basics', 'closing']],
  ['list', ['Collections', 'collection']], ['reading', ['Collections', 'reading']], ['listening', ['Collections', 'listening']],
  ['shelf', ['Personal', 'shelf']], ['profile', ['Personal', 'profile']], ['work', ['Personal', 'work']]
]);
let libraryCount = 0;

/**
 * Mount a read-only layout browser. The host owns defaults, draft changes and closing.
 * onInsert receives the original type and position value; false keeps the choice.
 * Import section-library.css separately and call focus() after the host modal opens.
 */
export function mountSectionLibrary({ container, entries = [], positions = [], defaultPosition, disabledReason, onInsert } = {}) {
  if (!container?.ownerDocument) throw new Error('A section-library container is required.');
  const doc = container.ownerDocument, win = doc.defaultView, controller = new win.AbortController();
  const uid = `section-library-${++libraryCount}`;
  const seen = new Set();
  const layouts = (Array.isArray(entries) ? entries : []).filter(entry => {
    if (!entry || typeof entry.type !== 'string' || !entry.type.trim() || seen.has(entry.type)) return false;
    seen.add(entry.type); return true;
  }).map(entry => ({ type: entry.type, label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : entry.type, description: typeof entry.description === 'string' ? entry.description : 'A layout provided by this project.', category: definitions.get(entry.type)?.[0] || 'Other', sketch: definitions.get(entry.type)?.[1] || 'custom' }));
  const places = (Array.isArray(positions) ? positions : []).filter(place => place && (typeof place.value === 'string' || (typeof place.value === 'number' && Number.isFinite(place.value))) && typeof place.label === 'string').map(place => ({ value: place.value, label: place.label }));
  const blocked = typeof disabledReason === 'string' && disabledReason.trim() ? disabledReason : !places.length ? 'No insertion positions are available for this page.' : typeof onInsert !== 'function' ? 'Section insertion is unavailable in this view.' : '';
  let alive = true, busy = false, composing = false, complete = false;
  let selected = null, category = 'All', visible = layouts, cards = [], focusIndex = 0;
  let positionIndex = Math.max(0, places.findIndex(place => Object.is(place.value, defaultPosition)));
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const button = (className, text) => { const node = el('button', className, text); node.type = 'button'; return node; };
  const listen = (node, type, handler) => node.addEventListener(type, handler, { signal: controller.signal });
  const root = el('section', 'sl-root'); root.setAttribute('aria-label', 'Section library');
  const introduction = el('p', 'sl-introduction', 'Find a layout, then choose where it belongs. Every section uses your website’s own type, colour and spacing.');
  const searchRow = el('div', 'sl-search-row');
  const searchLabel = el('label', 'sl-sr-only', 'Search section layouts'); searchLabel.htmlFor = `${uid}-search`;
  const search = el('input', 'sl-search'); search.id = `${uid}-search`; search.type = 'search'; search.placeholder = 'Search layouts…'; search.autocomplete = 'off'; search.spellcheck = false; search.maxLength = 200;
  search.setAttribute('aria-label', 'Search section layouts');
  const clear = button('sl-clear', 'Clear filters'); clear.hidden = true;
  searchRow.append(searchLabel, search, clear);
  const filters = el('div', 'sl-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filter layouts by category');
  const categoryButtons = [];
  for (const name of ['All', 'Basics', 'Collections', 'Personal', 'Other'].filter(name => name === 'All' || layouts.some(layout => layout.category === name))) {
    const filter = button('sl-filter', name); filter.dataset.category = name; filter.setAttribute('aria-pressed', String(name === category)); filters.append(filter); categoryButtons.push(filter);
    listen(filter, 'click', () => { if (busy) return; category = name; refresh(); });
  }
  const resultCount = el('p', 'sl-result-count'); resultCount.id = `${uid}-count`; resultCount.setAttribute('role', 'status'); resultCount.setAttribute('aria-live', 'polite');
  const gallery = el('div', 'sl-gallery'); gallery.setAttribute('role', 'radiogroup'); gallery.setAttribute('aria-label', 'Section layouts'); gallery.setAttribute('aria-describedby', `${uid}-sketch-note`);
  const empty = el('p', 'sl-empty'); empty.hidden = true;
  const sketchNote = el('p', 'sl-sketch-note', 'Layout sketches only. The real page preview is the source of truth.'); sketchNote.id = `${uid}-sketch-note`;
  const limit = el('p', 'sl-limit', blocked); limit.hidden = !blocked; limit.setAttribute('role', 'status');
  const detail = el('section', 'sl-detail'); detail.setAttribute('aria-labelledby', `${uid}-chosen`);
  const description = el('div', 'sl-description');
  const chosen = el('h3', '', 'Choose a layout'); chosen.id = `${uid}-chosen`;
  const explanation = el('p', '', 'Selecting a card only previews your choice. Nothing is added until you choose Add section.');
  const hiddenChoice = el('p', 'sl-hidden-choice', 'Your selected layout is outside this filter. Clear filters or choose another layout to continue.'); hiddenChoice.hidden = true;
  description.append(chosen, explanation, hiddenChoice);
  const actions = el('div', 'sl-actions');
  const positionLabel = el('label', '', 'Insert position'); positionLabel.htmlFor = `${uid}-position`;
  const position = el('select', 'sl-position'); position.id = `${uid}-position`;
  position.setAttribute('aria-label', 'Insert position');
  places.forEach((place, index) => { const option = el('option', '', place.label); option.value = String(index); position.append(option); });
  position.value = String(positionIndex);
  const add = button('sl-add', 'Add section');
  add.setAttribute('aria-label', 'Add section');
  actions.append(positionLabel, position, add);
  const status = el('p', 'sl-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  detail.append(description, actions, status);
  root.append(introduction, searchRow, filters, resultCount, gallery, empty, sketchNote, limit, detail);
  container.append(root);

  function line(size = 'medium') { return el('span', `sl-line sl-line-${size}`); }
  function textLines() { const group = el('div', 'sl-sketch-text'); group.append(line('heading'), line('wide'), line('medium'), line('short')); return group; }
  function sketch(kind) {
    const picture = el('div', `sl-sketch sl-sketch-${kind}`); picture.setAttribute('aria-hidden', 'true');
    if (kind === 'hero') picture.append(textLines(), el('span', 'sl-small-button'));
    else if (kind === 'image') picture.append(el('span', 'sl-picture'), textLines());
    else if (kind === 'profile') {
      const paragraphs = el('div', 'sl-profile-copy');
      paragraphs.append(line('wide'), line('medium'), line('short'), line('wide'), line('medium'));
      const facts = el('div', 'sl-profile-facts');
      for (let i = 0; i < 3; i++) { const fact = el('div', 'sl-profile-fact'); fact.append(line('short'), line('wide')); facts.append(fact); }
      picture.append(paragraphs, facts);
    }
    else if (kind === 'quote') picture.append(el('span', 'sl-quote-mark', '“'), line('wide'), line('medium'), line('short'));
    else if (kind === 'closing') picture.append(line('short'), line('heading'), line('wide'), line('medium'));
    else if (kind === 'marquee') { for (let i = 0; i < 4; i++) picture.append(el('span', 'sl-marquee-item')); }
    else if (['collection', 'shelf', 'reading'].includes(kind)) {
      picture.append(line('heading'));
      const items = el('div', 'sl-sketch-columns');
      for (let i = 0; i < 3; i++) { const item = el('div', 'sl-sketch-item'); item.append(el('span', kind === 'reading' ? 'sl-book' : 'sl-tile'), line('medium'), line('short')); items.append(item); }
      picture.append(items);
    } else if (kind === 'work' || kind === 'listening') {
      picture.append(line('heading'));
      for (let i = 0; i < 3; i++) { const row = el('div', 'sl-sketch-row'); const words = el('div'); words.append(line('wide'), line('medium')); row.append(el('span', kind === 'work' ? 'sl-row-tag' : 'sl-track'), words); picture.append(row); }
    } else if (kind === 'custom') picture.append(el('span', 'sl-custom-frame'), line('heading'), line('medium'));
    else picture.append(textLines());
    return picture;
  }
  function updateControls() {
    const shown = selected && visible.some(layout => layout.type === selected.type);
    root.setAttribute('aria-busy', String(busy));
    search.disabled = busy || !layouts.length; clear.disabled = busy;
    categoryButtons.forEach(filter => { filter.disabled = busy || !layouts.length; filter.setAttribute('aria-pressed', String(filter.dataset.category === category)); });
    cards.forEach((card, index) => { card.disabled = busy; card.tabIndex = index === focusIndex ? 0 : -1; card.setAttribute('aria-checked', String(card.dataset.type === selected?.type)); });
    position.disabled = busy || !places.length || Boolean(blocked);
    add.disabled = busy || composing || complete || !selected || !shown || !places[positionIndex] || Boolean(blocked);
    add.textContent = busy ? 'Adding…' : complete ? 'Section added' : 'Add section';
    hiddenChoice.hidden = !selected || Boolean(shown);
    chosen.textContent = selected?.label || 'Choose a layout';
    explanation.textContent = selected?.description || 'Selecting a card only previews your choice. Nothing is added until you choose Add section.';
  }
  function choose(index, focus = false) {
    if (!alive || busy || !visible[index]) return;
    selected = visible[index]; focusIndex = index; complete = false; status.textContent = ''; status.classList.remove('sl-error');
    updateControls();
    if (focus) { cards[index]?.focus(); cards[index]?.scrollIntoView?.({ block: 'nearest' }); }
  }
  function refresh() {
    if (!alive || busy) return;
    const terms = normalize(search.value.trim()).split(/\s+/u).filter(Boolean);
    visible = layouts.filter(layout => (category === 'All' || category === layout.category) && terms.every(term => normalize(`${layout.label} ${layout.description} ${layout.type} ${layout.category}`).includes(term)));
    clear.hidden = !search.value && category === 'All';
    gallery.replaceChildren(); cards = [];
    visible.forEach(layout => {
      const card = button('sl-card'); card.dataset.type = layout.type; card.dataset.sectionType = layout.type; card.setAttribute('role', 'radio');
      const label = el('span', 'sl-card-label', layout.label); label.id = `${uid}-layout-${layouts.indexOf(layout)}`;
      card.setAttribute('aria-labelledby', label.id); card.append(sketch(layout.sketch), label); gallery.append(card); cards.push(card);
    });
    focusIndex = Math.max(0, visible.findIndex(layout => layout.type === selected?.type));
    gallery.hidden = !visible.length; empty.hidden = Boolean(visible.length);
    empty.textContent = layouts.length ? 'No layouts match these filters. Try another word or clear the filters.' : 'No section layouts are configured for this page.';
    resultCount.textContent = `${visible.length} layout${visible.length === 1 ? '' : 's'}${layouts.length && visible.length !== layouts.length ? ` of ${layouts.length}` : ''}`;
    updateControls();
  }
  async function insert() {
    if (!alive || add.disabled || busy || composing || !container.isConnected) return;
    const payload = { type: selected.type, position: places[positionIndex].value };
    busy = true; status.textContent = `Adding ${selected.label}…`; status.classList.remove('sl-error'); updateControls();
    try {
      const result = await Promise.resolve(onInsert(payload));
      if (!alive) return;
      if (result === false) status.textContent = 'No section was added. Your layout and position are still selected; review the page and try again.';
      else { complete = true; status.textContent = 'Section added. The page preview will show its actual appearance.'; }
    } catch (error) {
      if (!alive) return;
      status.textContent = typeof error?.message === 'string' ? error.message : 'The section could not be added. Your selection is unchanged; try again.';
      status.classList.add('sl-error');
    } finally { if (alive) { busy = false; updateControls(); } }
  }
  listen(search, 'input', () => { if (!composing) refresh(); });
  listen(search, 'compositionstart', () => { composing = true; updateControls(); });
  listen(search, 'compositionend', () => { composing = false; refresh(); });
  listen(clear, 'click', () => { if (busy) return; search.value = ''; category = 'All'; composing = false; refresh(); search.focus(); });
  listen(gallery, 'click', event => { const card = event.target.closest('.sl-card'); choose(cards.indexOf(card)); });
  listen(gallery, 'keydown', event => {
    if (busy || composing || event.isComposing || event.keyCode === 229) return;
    const index = cards.indexOf(event.target.closest('.sl-card')); if (index < 0) return;
    let next;
    if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % cards.length;
    else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index - 1 + cards.length) % cards.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = cards.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') next = index;
    else return;
    event.preventDefault(); event.stopPropagation(); choose(next, true);
  });
  listen(search, 'keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'ArrowDown' && !composing && !event.isComposing && event.keyCode !== 229 && !busy && cards.length) { event.preventDefault(); cards[focusIndex].focus(); }
  });
  listen(position, 'change', () => { if (busy) return; const next = Number(position.value); if (Number.isInteger(next) && places[next]) { positionIndex = next; complete = false; status.textContent = ''; updateControls(); } });
  listen(add, 'click', () => void insert());
  refresh();
  return {
    focus() { if (!alive || !root.isConnected) return; if (!search.disabled) search.focus(); else { empty.tabIndex = -1; empty.focus(); } },
    destroy() { if (!alive) return; alive = false; controller.abort(); root.remove(); cards = []; selected = null; }
  };
}
