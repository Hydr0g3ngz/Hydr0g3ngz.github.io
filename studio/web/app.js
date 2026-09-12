import { createLifecycle } from './lifecycle.js';
const $ = selector => document.querySelector(selector);
const clone = value => structuredClone(value);
const state = { documents: [], media: [], config: {}, token: '', current: null, drafts: new Map(), selected: null, tab: 'structure', mode: 'edit', scroll: 0, previewSequence: 0, activePreview: null, activeView: 'pages', previewTimer: null };
const names = { hero: 'Introduction', marquee: 'Moving line', shelf: 'Personal shelf', work: 'Selected work', closing: 'Closing thought', text: 'Text', image_text: 'Image + text', list: 'Collection', quote: 'Quotation', profile: 'Profile', reading: 'Reading room', listening: 'Listening room' };
const descriptions = { hero: 'An opening with room to breathe.', marquee: 'A quiet line of interests.', shelf: 'Books, music and things you keep.', work: 'Projects without the résumé feeling.', closing: 'Leave a small thought behind.', text: 'A heading and a few paragraphs.', image_text: 'Let an image sit beside your words.', list: 'A flexible collection of linked cards.', quote: 'A sentence worth keeping.', profile: 'An introduction and a few facts.', reading: 'Books, complete poems and personal notes.', listening: 'Selected songs, listening links and personal notes.' };
const icons = { hero: 'Aa', marquee: '≈', shelf: '▥', work: '↗', closing: '…', text: 'Tt', image_text: '▧', list: '☷', quote: '“', profile: '◎', reading: '▤', listening: '♫' };
let writerModule;
let inlineEditing = null;
const activeWriters = new Set();
function disposeWriters() { for (const editor of activeWriters) editor.destroy(); activeWriters.clear(); }
function attachWriter(container, path, value, label) {
  const documentId = state.current;
  const fallback = node('textarea', { value: value ?? '', 'aria-label': `${label} Markdown`, on: { input: event => { if (state.current === documentId && container.isConnected) mutate(data => setAt(data, path, event.target.value), { path }); } } });
  container.append(fallback);
  (writerModule ??= import('/generated/writer.js')).then(module => {
    if (!container.isConnected || state.current !== documentId) return;
    const currentValue = getAt(draft().data, path) ?? '';
    container.replaceChildren();
    const editor = module.mountWriter({ container, value: currentValue, label,
      onChange(markdown) { if (container.isConnected && state.current === documentId) mutate(data => setAt(data, path, markdown), { path }); },
      onChooseImage: chooseWriterImage
    });
    activeWriters.add(editor);
  }).catch(() => { writerModule = undefined; if (container.isConnected) { fallback.value = getAt(draft().data, path) ?? ''; container.replaceChildren(node('p', { class: 'field-help', text: 'Visual editor unavailable. Markdown editing still works; restart Studio to rebuild the local editor.' }), fallback); } });
}
function node(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'on') Object.entries(value).forEach(([event, handler]) => element.addEventListener(event, handler));
    else if (key === 'checked') element.checked = value;
    else if (key === 'value') element.value = value;
    else if (key === 'disabled' || key === 'hidden') element[key] = value;
    else element.setAttribute(key, value);
  }
  for (const child of [children].flat(Infinity)) if (child != null) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}
function button(text, fn, attrs = {}) { return node('button', { type: 'button', text, on: { click: fn }, ...attrs }); }
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.hidden = false; el.style.background = error ? '#873d31' : ''; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.hidden = true, error ? 8000 : 4000); }
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'x-studio-token': state.token }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    const details = result.details ? (Array.isArray(result.details) ? result.details.map(issue => typeof issue === 'string' ? issue : `${Array.isArray(issue.path) ? issue.path.join('.') : issue.path || ''}: ${issue.message || JSON.stringify(issue)}`).join('\n') : JSON.stringify(result.details, null, 2)) : '';
    throw new Error((result.error || result.message || `Request failed (${response.status})`) + (details ? `\n${details}` : ''));
  }
  return result;
}
const documentById = id => state.documents.find(doc => doc.id === id);
const currentDoc = () => documentById(state.current);
const draft = () => state.drafts.get(state.current);
const getAt = (object, path) => path.reduce((value, key) => value?.[key], object);
function setAt(object, path, value) {
  let parent = object;
  path.slice(0, -1).forEach((key, i) => { if (parent[key] === undefined) parent[key] = /^\d+$/.test(path[i + 1]) ? [] : {}; parent = parent[key]; });
  if (value === undefined) delete parent[path.at(-1)]; else parent[path.at(-1)] = value;
}
function draftKey(id) { return `will-studio-v1:${id}`; }
function ensureDraft(doc) {
  if (state.drafts.has(doc.id)) return state.drafts.get(doc.id);
  let restored; try { restored = JSON.parse(localStorage.getItem(draftKey(doc.id)) || 'null'); } catch {}
  const value = { data: clone(doc.data), revision: doc.revision, saved: JSON.stringify(doc.data), undo: [], redo: [], restored: false, conflict: false };
  if (restored?.data && JSON.stringify(restored.data) !== value.saved) {
    value.data = restored.data; value.restored = true; value.conflict = restored.revision !== doc.revision; value.revision = restored.revision;
  }
  state.drafts.set(doc.id, value); return value;
}
function persist() { const d = draft(); try { if (JSON.stringify(d.data) === d.saved) localStorage.removeItem(draftKey(state.current)); else localStorage.setItem(draftKey(state.current), JSON.stringify({ data: d.data, revision: d.revision, time: Date.now() })); } catch { toast('Browser draft storage is full. Save locally to keep your changes.', true); } }
function updateStatus() {
  const d = draft(); if (!d) return;
  const dirty = JSON.stringify(d.data) !== d.saved || inlineEditing?.dirty;
  $('#save-state').textContent = d.conflict ? 'External changes detected' : dirty ? 'Unsaved · draft kept in this browser' : 'All changes saved locally';
  $('#save').disabled = !dirty || d.saving; $('#undo').disabled = !d.undo.length; $('#redo').disabled = !d.redo.length;
  $('#draft-notice').hidden = !d.restored && !d.conflict;
  $('#draft-notice').textContent = d.conflict ? 'This browser draft predates changes on disk. Save is protected against overwriting them. Review History or reload the disk version.' : 'Your unsaved browser draft has been restored. It has not changed the files on disk.';
}
let lastEdit = { path: '', at: 0 };
function mutate(fn, options = {}) {
  const d = draft(); if (!d) return;
  const key = options.path?.join('.') || '';
  if (!key || key !== lastEdit.path || Date.now() - lastEdit.at > 900) { d.undo.push(clone(d.data)); if (d.undo.length > 80) d.undo.shift(); }
  lastEdit = { path: key, at: Date.now() }; d.redo = []; fn(d.data); persist(); updateStatus();
  if (options.render) renderInspector();
  schedulePreview();
}
function historyStep(direction) {
  if (!flushInlineEdit()) return;
  const d = draft(); const source = d[direction]; if (!source.length) return;
  d[direction === 'undo' ? 'redo' : 'undo'].push(clone(d.data)); d.data = source.pop(); lastEdit = { path: '', at: 0 };
  if (state.selected !== null && !d.data.sections?.[state.selected]) state.selected = null;
  persist(); updateStatus(); renderInspector(); schedulePreview(0);
}
function flattenedContent(items = state.config.content || []) { return items.flatMap(item => item.items ? flattenedContent(item.items) : [item]); }
function docFields(doc = currentDoc()) {
  const config = flattenedContent();
  const exact = config.find(item => item.path === `src/content/${doc.id}`);
  return (exact || config.find(item => item.type === 'collection' && `src/content/${doc.id}`.startsWith(item.path + '/')))?.fields || [];
}
function descriptor(field) { return field.component ? { ...state.config.components[field.component], ...field } : field; }
function defaultValue(input, key = input.name) {
  const field = descriptor(input);
  if (field.default !== undefined) return clone(field.default);
  if (field.list) { const min = field.list?.min || (field.required ? 1 : 0); return Array.from({ length: min }, () => defaultValue({ ...field, list: undefined }, key)); }
  if (field.type === 'object') return Object.fromEntries((field.fields || []).filter(f => f.required || f.default !== undefined || f.list?.min || ['boolean', 'object'].includes(f.type)).map(f => [f.name, defaultValue(f)]));
  if (field.type === 'boolean') return true;
  if (field.type === 'number') return 1;
  if (field.type === 'select') { const choice = field.options?.values?.[0]; return typeof choice === 'object' ? choice.name : choice || ''; }
  if (field.type === 'date') return new Date().toISOString().slice(0, 10);
  if (field.type === 'image') return state.media[0]?.path || '/images/books-library.jpg';
  if (key === 'href' || /Url$/.test(key) || key === 'url') return 'https://example.com';
  if (key === 'imageAlt' || key === 'coverAlt') return 'Describe the image here';
  if (key === 'videoId') return 'eVTXPUF4Oz4';
  return key === 'heading' || key === 'title' ? 'A new thought' : key === 'body' || key === 'text' || key === 'intro' || key === 'summary' ? 'Write something worth keeping.' : key === 'eyebrow' || key === 'tag' ? 'A SMALL COLLECTION' : key === 'label' ? 'Read more' : field.required ? 'Add your words here' : '';
}
function renderPages() {
  const query = $('#page-search').value.toLowerCase(); const holder = $('#pages'); holder.replaceChildren();
  for (const [title, filter] of [['Core pages', d => d.kind === 'home' || d.kind === 'settings' || d.id === 'pages/about.json'], ['Pages', d => d.kind === 'page' && d.id !== 'pages/about.json'], ['Notes', d => d.kind === 'note']]) {
    const docs = state.documents.filter(filter).filter(d => `${d.name} ${d.id}`.toLowerCase().includes(query)); if (!docs.length) continue;
    holder.append(node('p', { class: 'page-group-title', text: title }));
    for (const doc of docs) {
      const nested = doc.id.split('/').length - 2;
      const b = button('', () => selectDocument(doc.id), { class: `page-link ${state.current === doc.id ? 'active' : ''}`, title: doc.route || doc.id });
      b.style.paddingLeft = `${10 + nested * 12}px`;
      b.append(node('span', { class: 'page-symbol', text: doc.kind === 'home' ? '⌂' : doc.kind === 'settings' ? '⚙' : doc.kind === 'note' ? '✎' : '▱' }), node('span', { class: 'page-label', text: doc.name || doc.data.title || doc.id }));
      if (doc.data.published === false) b.append(node('span', { class: 'draft-dot', title: 'Draft — not on the public website' }));
      holder.append(b);
    }
  }
}
function selectDocument(id) {
  if (!flushInlineEdit()) return;
  lastEdit = { path: '', at: 0 };
  inlineEditing = null;
  state.previewSequence++; state.activePreview = null; $('#preview-loading').hidden = false;
  state.current = id; ensureDraft(currentDoc()); state.selected = null; state.scroll = 0; state.tab = currentDoc().kind === 'note' || currentDoc().kind === 'settings' ? 'details' : 'structure'; state.activeView = 'pages';
  document.body.classList.remove('project-mode'); $('#pages-tab').classList.add('active'); $('#project-tab').classList.remove('active');
  $('#pages-tab').setAttribute('aria-selected', 'true'); $('#project-tab').setAttribute('aria-selected', 'false');
  $('#canvas-stage').querySelector('.project-view')?.remove(); $('#preview-paper').hidden = false;
  $('#page-name').textContent = currentDoc().name || currentDoc().data.title; $('#page-kind').textContent = currentDoc().kind.toUpperCase(); $('#preview-route').textContent = currentDoc().route || '/';
  renderPages(); renderInspector(); updateStatus(); schedulePreview(0);
}
function renderInspector() {
  disposeWriters();
  const holder = $('#inspector'); holder.replaceChildren(); if (!draft()) return;
  for (const [id, tab] of [['structure-tab', 'structure'], ['details-tab', 'details'], ['history-tab', 'history']]) $('#' + id).classList.toggle('active', state.tab === tab);
  if (state.tab === 'history') { renderHistory(holder); return; }
  const fields = docFields();
  if (state.tab === 'details' || !Array.isArray(draft().data.sections)) {
    if (draft().data.published !== undefined) holder.append(node('div', { class: 'notice', text: 'Published controls whether this page is included in the next site deployment. Save locally does not publish to GitHub.' }));
    fields.filter(f => f.name !== 'sections').forEach(f => holder.append(renderField(f, [f.name]))); return;
  }
  const sections = draft().data.sections; const list = node('div', { class: 'section-list' });
  sections.forEach((block, index) => {
    const row = node('div', { class: `block-row ${state.selected === index ? 'selected' : ''}`, draggable: 'true', 'data-block-index': index });
    const select = button('', () => selectBlock(index, true), { class: 'block-select' });
    select.append(node('span', { text: `${String(index + 1).padStart(2, '0')} / ${names[block.type] || block.type}${block.visible === false ? ' · hidden' : ''}` }), node('strong', { text: block.heading || block.eyebrow || block.quote || names[block.type] || block.type }));
    row.append(select, node('div', { class: 'row-actions' }, [button('↑', () => moveBlock(index, -1), { class: 'mini-button', title: 'Move section up', disabled: index === 0 }), button('↓', () => moveBlock(index, 1), { class: 'mini-button', title: 'Move section down', disabled: index === sections.length - 1 })]));
    row.addEventListener('dragstart', event => event.dataTransfer.setData('text/studio-block', String(index)));
    row.addEventListener('dragover', event => event.preventDefault());
    row.addEventListener('drop', event => { event.preventDefault(); const raw = event.dataTransfer.getData('text/studio-block'); if (!/^\d+$/.test(raw)) return; const from = Number(raw); mutate(data => { const [moved] = data.sections.splice(from, 1); data.sections.splice(index, 0, moved); state.selected = index; }, { render: true }); });
    list.append(row);
  });
  holder.append(list, button('+ Add a section', showPalette, { class: 'add-button' }));
  if (state.selected === null || !sections[state.selected]) { holder.append(node('p', { class: 'empty', text: 'Select something on the page, or choose a section above.' })); return; }
  const block = sections[state.selected]; const component = state.config.components?.[block.type];
  holder.append(node('div', { class: 'inspector-heading' }, [node('h2', { text: names[block.type] || block.type }), node('div', {}, [button('⧉', duplicateBlock, { class: 'mini-button', title: 'Duplicate section' }), button('×', removeBlock, { class: 'mini-button', title: 'Remove section — undo is available' })])]));
  for (const field of component?.fields || []) holder.append(renderField(field, ['sections', String(state.selected), field.name]));
}
function selectBlock(index, scroll = false, path) {
  state.selected = index === 'page' ? null : Number(index); state.tab = index === 'page' ? 'details' : 'structure'; renderInspector();
  bridge({ type: 'select', index, scroll });
  if (path) { const el = [...$('#inspector').querySelectorAll('[data-field-path]')].find(e => e.dataset.fieldPath === JSON.stringify(path)); if (el) { let parent = el.parentElement; while (parent && parent !== $('#inspector')) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('field-highlight'); } }
}
function moveBlock(index, delta) { mutate(data => { const [moved] = data.sections.splice(index, 1); data.sections.splice(index + delta, 0, moved); state.selected = index + delta; }, { render: true }); }
function duplicateBlock() { mutate(data => { const copy = clone(data.sections[state.selected]); if (copy.id) copy.id += `-${Date.now().toString(36)}`; data.sections.splice(state.selected + 1, 0, copy); state.selected++; }, { render: true }); }
function removeBlock() { mutate(data => { data.sections.splice(state.selected, 1); state.selected = null; }, { render: true }); toast('Section removed. Undo can bring it back.'); }
function renderField(input, path) {
  const field = descriptor(input); const value = getAt(draft().data, path); const label = field.label || input.name?.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ') || 'Item';
  const wrapper = node('div', { class: 'field', 'data-field-path': JSON.stringify(path) });
  if (field.list) {
    const values = Array.isArray(value) ? value : [];
    wrapper.append(node('div', { class: 'field-title' }, [label, node('span', { text: `${values.length}${field.list.max ? ` / ${field.list.max}` : ''}` })]));
    values.forEach((item, index) => {
      const title = typeof item === 'object' ? item.title || item.heading || item.name || item.label || item.tag || item.text || `Item ${index + 1}` : item;
      const entry = node('details', { class: 'array-item' }, node('summary', {}, [node('span', { class: 'array-summary', text: `${index + 1}. ${title || 'New item'}` }), '⌄']));
      const operation = fn => mutate(data => fn(getAt(data, path)), { render: true });
      entry.append(node('div', { class: 'array-actions' }, [button('↑', () => operation(items => { [items[index], items[index - 1]] = [items[index - 1], items[index]]; }), { title: 'Move item up', disabled: index === 0 }), button('↓', () => operation(items => { [items[index], items[index + 1]] = [items[index + 1], items[index]]; }), { title: 'Move item down', disabled: index === values.length - 1 }), button('Duplicate', () => operation(items => items.splice(index + 1, 0, clone(item))), { disabled: values.length >= (field.list.max || Infinity) }), button('Remove', () => operation(items => items.splice(index, 1)), { disabled: values.length <= (field.list.min || 0) })]));
      entry.append(renderField({ ...field, list: undefined, label: `Item ${index + 1}` }, [...path, String(index)])); wrapper.append(entry);
    });
    wrapper.append(button('+ Add item', () => mutate(data => { const array = getAt(data, path) || []; if (!getAt(data, path)) setAt(data, path, array); array.push(defaultValue({ ...field, list: undefined })); }, { render: true }), { class: 'add-button', disabled: values.length >= (field.list.max || Infinity) }));
  } else if (field.type === 'object') {
    const details = node('details', { class: 'object-field', open: field.name === 'navigation' ? '' : null }, node('summary', { text: label }));
    (field.fields || []).forEach(child => details.append(renderField(child, [...path, child.name]))); wrapper.append(details);
  } else {
    const id = 'f-' + path.join('-'); const lab = node('label', { for: id }, [label, field.required ? node('span', { class: 'required', text: '•' }) : null]); wrapper.append(lab);
    const change = newValue => mutate(data => setAt(data, path, newValue), { path });
    let control;
    if (field.type === 'boolean') {
      control = node('input', { id, type: 'checkbox', checked: Boolean(value), on: { change: e => { change(e.target.checked); if (path.at(-1) === 'visible') renderInspector(); } } }); lab.append(control);
    } else if (field.type === 'select') {
      control = node('select', { id, on: { change: e => change(e.target.value) } }, (field.options?.values || []).map(option => node('option', { value: typeof option === 'object' ? option.name : option, text: typeof option === 'object' ? option.label || option.name : option })));
      control.value = value ?? defaultValue(field); wrapper.append(control);
    } else if (field.type === 'rich-text') {
      const host = node('div', { id, class: 'writer-field', 'aria-label': label }); wrapper.append(host);
      // Fields are assembled off-DOM; attach only after the inspector owns them.
      queueMicrotask(() => { if (host.isConnected) attachWriter(host, path, value, label); });
    } else {
      const long = field.type === 'text' || field.type === 'rich-text';
      control = node(long ? 'textarea' : 'input', { id, value: value ?? '', type: long ? null : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.name === 'themeColor' ? 'color' : 'text', on: { input: e => { const raw = e.target.value; change(raw === '' && !field.required ? undefined : field.type === 'number' ? (raw === '' ? undefined : Number(raw)) : raw); } } });
      if (field.type === 'image') {
        if (value) wrapper.append(node('img', { class: 'image-field-preview', src: `/preview${value}`, alt: 'Selected image' }));
        wrapper.append(node('div', { class: 'image-field-controls' }, [control, button('Choose', () => showMedia(path), { class: 'quiet-button' })]));
      } else wrapper.append(control);
      // Zod validates patterns on preview/save. HTML's v-mode regex syntax differs from CMS patterns.
      if (field.required) control.required = true;
    }
  }
  if (field.description) wrapper.append(node('p', { class: 'field-help', text: field.description }));
  return wrapper;
}
function openModal(title, content) { if (!flushInlineEdit()) return; $('#modal-title').textContent = title; $('#modal-content').replaceChildren(content); if (!$('#modal').open) $('#modal').showModal(); }
function showPalette() {
  const allowed = docFields().find(f => f.name === 'sections'); const holder = node('div');
  holder.append(node('p', { class: 'modal-intro', text: 'A small set of considered layouts. Each one inherits your website’s typography, spacing and colours.' }));
  const palette = node('div', { class: 'palette' });
  (allowed?.blocks || []).forEach(ref => {
    const type = ref.name; palette.append(button('', () => {
      const component = state.config.components[ref.component || type]; const block = { type, ...defaultValue(component) };
      if (type === 'marquee' && !block.items?.length) block.items = ['THINGS WORTH KEEPING'];
      if (type === 'profile' && !block.paragraphs?.length) block.paragraphs = ['Write a little about yourself.'];
      if (block.id && draft().data.sections.some(section => section.id === block.id)) block.id += `-${Date.now().toString(36)}`;
      mutate(data => { data.sections.push(block); state.selected = data.sections.length - 1; }, { render: true }); $('#modal').close();
    }, { class: 'palette-card', disabled: draft().data.sections.length >= (allowed.list?.max || Infinity) }));
    palette.lastChild.append(node('span', { class: 'palette-icon', text: icons[type] || '▱' }), node('strong', { text: names[type] || type }), node('small', { text: descriptions[type] || 'A new part of your page.' }));
  }); holder.append(palette); openModal('Make a little space', holder);
}
function bridge(message) { $('#preview').contentWindow?.postMessage({ source: 'will-studio', ...message }, location.origin); }
function previewInlineSession() {
  const session = $('#preview').contentWindow?.__willStudioInline;
  return session?.identity.id === state.current && session.identity.rev === state.activePreview?.rev ? session : null;
}
function hasInlineEdit() { try { return !!previewInlineSession()?.active; } catch { return false; } }
function flushInlineEdit() {
  try { previewInlineSession()?.flush(); return true; }
  catch { if (inlineEditing) { toast('The inline text could not be committed. Return to the preview and finish editing before continuing.', true); return false; } return true; }
}
function schedulePreview(delay = 700) { state.previewSequence++; clearTimeout(state.previewTimer); state.previewTimer = setTimeout(refreshPreview, delay); }
async function refreshPreview() {
  if (!draft() || state.activeView !== 'pages') return;
  if (hasInlineEdit()) { clearTimeout(state.previewTimer); state.previewTimer = setTimeout(refreshPreview, 350); return; }
  const seq = ++state.previewSequence; const id = state.current;
  $('#preview-state').textContent = 'Rendering your changes…';
  try {
    const response = await api('/api/preview', 'POST', { id, data: draft().data });
    if (seq !== state.previewSequence || id !== state.current) return;
    if (hasInlineEdit()) { schedulePreview(350); return; }
    inlineEditing = null;
    state.activePreview = { id, rev: response.rev || new URL(response.url, location.origin).searchParams.get('rev') };
    $('#preview').src = response.url; $('#preview-state').textContent = 'Local preview · not published';
  } catch (error) { if (seq === state.previewSequence) { $('#preview-state').textContent = 'Preview kept at last valid version'; $('#preview-loading').hidden = true; showPreviewError(error.message); } }
}
function showPreviewError(message) {
  $('#inspector').querySelector('.preview-error')?.remove();
  const warning = node('div', { class: 'notice error preview-error', text: `Please complete these fields before previewing:\n${message}` }); $('#inspector').prepend(warning);
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== $('#preview').contentWindow || event.data?.source !== 'will-studio-preview') return;
  const message = event.data;
  if (message.id !== state.current || message.rev !== state.activePreview?.rev) return;
  if (message.type === 'ready') { $('#preview-loading').hidden = true; $('#inspector').querySelector('.preview-error')?.remove(); bridge({ type: 'mode', mode: state.mode }); bridge({ type: 'scroll', y: state.scroll }); if (state.selected !== null) bridge({ type: 'select', index: state.selected }); }
  if (message.type === 'select') selectBlock(message.index, false, message.path);
  if (message.type === 'editing') { inlineEditing = message.active === true ? { dirty: message.dirty === true } : null; updateStatus(); }
  if (message.type === 'edit' && typeof message.value === 'string' && Array.isArray(message.path) && message.path.length && message.path.every(key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)) && typeof getAt(draft()?.data, message.path) === 'string') {
    if (getAt(draft().data, message.path) !== message.value) mutate(data => setAt(data, message.path, message.value), { path: message.path });
    // Preserve focus when blur was caused by clicking an inspector field.
    const field = [...$('#inspector').querySelectorAll('[data-field-path]')].find(element => element.dataset.fieldPath === JSON.stringify(message.path));
    const control = field?.querySelector('input,textarea'); if (control) control.value = message.value;
  }
  if (message.type === 'save') save();
  if (message.type === 'scroll') state.scroll = message.y;
});
async function save() {
  if (!flushInlineEdit()) return;
  const id = state.current; const d = draft(); if (!d || d.saving || JSON.stringify(d.data) === d.saved) return;
  d.saving = true; updateStatus();
  const submitted = clone(d.data);
  try {
    const result = await api('/api/document', 'PUT', { id, data: submitted, revision: d.revision }); const doc = result.document || result;
    d.revision = doc.revision; d.saved = JSON.stringify(doc.data || submitted); if (JSON.stringify(d.data) === JSON.stringify(submitted)) d.data = clone(doc.data || submitted);
    d.restored = false; d.conflict = false; Object.assign(documentById(id), doc); if (id === state.current) persist(); toast('Saved locally. Your live website has not changed.'); renderPages();
  } catch (error) { toast(error.message, true); } finally { d.saving = false; updateStatus(); }
}
async function showMedia(path) {
  const mediaDocumentId = state.current;
  const holder = node('div'); const grid = node('div', { class: 'media-grid' });
  const input = node('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/avif', id: 'upload-file' });
  const status = node('small', { text: 'JPG, PNG, WebP or AVIF · up to 2 MB' });
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return; status.textContent = 'Adding image…';
    try { const response = await fetch('/api/media', { method: 'POST', headers: { 'x-studio-token': state.token, 'x-filename': encodeURIComponent(file.name), 'Content-Type': file.type }, body: file }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Upload failed'); state.media.push(result); showMedia(path); toast('Image added to your local library.'); } catch (error) { status.textContent = error.message; }
  });
  holder.append(node('div', { class: 'upload-row' }, [node('label', { for: 'upload-file', text: '+ Upload image' }), input, status]));
  state.media.forEach(media => { const card = button('', () => { if (path) { if (state.current !== mediaDocumentId) return; mutate(data => setAt(data, path, media.path), { render: true }); $('#modal').close(); } else { navigator.clipboard?.writeText(media.path).then(() => toast('Image path copied.')).catch(() => toast(media.path)); } }, { class: 'media-card' }); card.append(node('img', { src: `/preview${media.path}`, alt: media.name }), node('span', { text: media.name || media.path })); grid.append(card); });
  holder.append(grid); openModal(path ? 'Choose an image' : 'Your image library', holder);
}
function chooseWriterImage() {
  return new Promise(resolve => {
    const modal = $('#modal'); let result = null;
    const holder = node('div', {}, node('p', { class: 'modal-intro', text: 'Choose an image, then describe what it shows. Add new files through the Media library.' }));
    const alt = node('input', { placeholder: 'A short description for readers who cannot see the image', 'aria-label': 'Image description' });
    const selected = node('p', { class: 'field-help', text: 'No image selected.' }); let media;
    const insert = button('Insert image', () => { if (!media || !alt.value.trim()) { alt.focus(); return; } result = { src: media.path, alt: alt.value.trim() }; modal.close(); }, { class: 'primary-button', disabled: true });
    const grid = node('div', { class: 'media-grid' });
    for (const item of state.media) {
      const card = button('', () => { media = item; selected.textContent = item.name || item.path; insert.disabled = !alt.value.trim(); grid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === card))); alt.focus(); }, { class: 'media-card', 'aria-pressed': 'false' });
      card.append(node('img', { src: `/preview${item.path}`, alt: item.name || '' }), node('span', { text: item.name || item.path })); grid.append(card);
    }
    alt.addEventListener('input', () => insert.disabled = !media || !alt.value.trim());
    holder.append(grid, selected, node('div', { class: 'field' }, node('label', { text: 'Image description' }, alt)), node('div', { class: 'modal-actions' }, [button('Cancel', () => modal.close(), { class: 'quiet-button' }), insert]));
    modal.addEventListener('close', () => resolve(result), { once: true }); openModal('An image for your words', holder);
  });
}
function newPage() {
  const content = node('form'); const title = node('input', { required: '', placeholder: 'A place for small discoveries', name: 'title' }); const slug = node('input', { required: '', placeholder: 'reading/small-discoveries', name: 'slug' });
  const kind = node('select', { name: 'kind' }, [node('option', { value: 'page', text: 'Page — build with sections' }), node('option', { value: 'note', text: 'Note — write visually or in Markdown' })]); const route = node('p', { class: 'notice', text: 'New pages start as drafts. Their URL can include folders.' }); let slugTouched = false;
  slug.addEventListener('input', () => { slugTouched = true; }); title.addEventListener('input', () => { if (!slugTouched) slug.value = title.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); });
  content.addEventListener('input', () => route.textContent = `/${kind.value === 'note' ? 'notes/' : ''}${slug.value || 'your-page'} · starts as a draft`);
  for (const [label, control] of [['Type', kind], ['Page title', title], ['Address / slug', slug]]) content.append(node('div', { class: 'field' }, [node('label', { text: label }, control)])); content.append(route, node('div', { class: 'modal-actions' }, [button('Cancel', () => $('#modal').close(), { class: 'quiet-button' }), node('button', { type: 'submit', class: 'primary-button', text: 'Create draft' })]));
  content.addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/api/document', 'POST', { kind: kind.value, slug: slug.value, title: title.value }); const doc = result.document || result; state.documents.push(doc); $('#modal').close(); selectDocument(doc.id); toast('Your new draft is ready.'); } catch (error) { toast(error.message, true); } }); openModal('Start a new page', content);
}
async function renderHistory(holder) {
  const historyId = state.current;
  holder.append(node('p', { class: 'notice', text: 'Each local save keeps the previous file. Restoring a version also backs up the current one.' }));
  holder.append(button('Reload version from disk', async () => { try { const fresh = await api('/api/state'); const doc = fresh.documents.find(d => d.id === historyId); adoptDiskVersion(doc); toast('Reloaded from disk. Your previous browser draft is in History.'); } catch (error) { toast(error.message, true); } }, { class: 'quiet-button' }));
  let recovered = []; try { recovered = JSON.parse(localStorage.getItem(`will-studio-recovery:${historyId}`) || '[]'); } catch {}
  if (recovered.length) holder.append(node('h3', { text: 'Recovered browser drafts' }));
  for (const entry of recovered) holder.append(node('div', { class: 'history-entry' }, [node('div', {}, [new Date(entry.time).toLocaleString(), node('small', { text: 'Unsaved draft preserved before restoring' })]), button('Open draft', () => { if (state.current !== historyId) return; mutate(data => { for (const key of Object.keys(data)) delete data[key]; Object.assign(data, clone(entry.data)); }, { render: true }); toast('Recovered draft opened. Save locally when ready.'); })]));
  try { const result = await api(`/api/history?id=${encodeURIComponent(historyId)}`); const items = result.history || result.versions || result; if (!items.length) holder.append(node('p', { class: 'empty', text: 'No saved versions yet. A backup is created the next time you save.' }));
    items.forEach(item => { const version = item.version || item.id; holder.append(node('div', { class: 'history-entry' }, [node('div', {}, [new Date(item.createdAt || item.time || item.date || Date.now()).toLocaleString(), node('small', { text: version })]), button('Restore', async () => { try { const result = await api('/api/restore', 'POST', { id: historyId, version, revision: state.drafts.get(historyId).revision }); adoptDiskVersion(result.document || result); toast('Version restored. Your previous browser draft is in History.'); } catch (error) { toast(error.message, true); } })])); });
  } catch (error) { holder.append(node('p', { class: 'error notice', text: error.message })); }
}
function adoptDiskVersion(doc) {
  if (!doc?.id) throw new Error('The document is no longer available on disk.');
  const previous = state.drafts.get(doc.id);
  if (previous && JSON.stringify(previous.data) !== previous.saved) {
    const key = `will-studio-recovery:${doc.id}`; const recovered = JSON.parse(localStorage.getItem(key) || '[]'); recovered.unshift({ time: Date.now(), data: previous.data });
    localStorage.setItem(key, JSON.stringify(recovered.slice(0, 10)));
  }
  Object.assign(documentById(doc.id), doc); localStorage.removeItem(draftKey(doc.id)); state.drafts.delete(doc.id); const restored = ensureDraft(doc);
  if (previous) restored.undo = [...previous.undo, clone(previous.data)].slice(-80);
  if (state.current === doc.id) selectDocument(doc.id); else renderPages();
}
async function validate() {
  const holder = node('div', {}, [node('p', { class: 'modal-intro', text: 'Checking saved files, content structure, images and generated links. Unsaved browser drafts are not included.' }), node('div', { class: 'notice', text: 'Building the whole site…' })]); openModal('A check before publishing', holder); $('#check').disabled = true;
  try { const result = await api('/api/validate', 'POST', {}); holder.lastChild.remove(); holder.append(node('div', { class: `notice ${result.ok || result.success ? '' : 'error'}`, text: result.ok || result.success ? 'The saved site builds successfully.' : 'Some issues need attention.' }), node('pre', { text: result.output || result.stdout || JSON.stringify(result, null, 2), style: 'white-space:pre-wrap;font-size:11px;max-height:350px;overflow:auto' })); } catch (error) { holder.lastChild.textContent = error.message; holder.lastChild.classList.add('error'); } finally { $('#check').disabled = false; }
}
async function projectView() {
  disposeWriters();
  state.activeView = 'project'; document.body.classList.add('project-mode'); $('#pages-tab').classList.remove('active'); $('#project-tab').classList.add('active'); $('#pages-tab').setAttribute('aria-selected', 'false'); $('#project-tab').setAttribute('aria-selected', 'true');
  $('#preview-paper').hidden = true; $('#preview-loading').hidden = true; $('#page-kind').textContent = 'WORKSPACE'; $('#page-name').textContent = 'Project overview';
  const view = node('div', { class: 'project-view' }, node('p', { text: 'Reading your local project…' })); $('#canvas-stage').querySelector('.project-view')?.remove(); $('#canvas-stage').append(view);
  try { const info = await api('/api/project'); view.replaceChildren(node('span', { class: 'eyebrow', text: 'A LITTLE CARE, BEHIND THE SCENES' }), node('h2', { text: 'A home for your website.' }), node('p', { text: 'Keep an eye on your content, protect your work, and make sure the next update is ready.' }));
    const metrics = node('div', { class: 'project-metrics' }); for (const [key, title] of [['pages', 'Pages'], ['notes', 'Notes'], ['drafts', 'Drafts'], ['images', 'Images']]) metrics.append(node('div', { class: 'metric' }, [node('strong', { text: info.content?.[key] ?? '—' }), node('small', { text: title })])); view.append(metrics);
    view.append(node('div', { class: 'project-card' }, [node('h3', { text: 'Keep a recoverable copy' }), node('p', { text: 'Snapshots keep content and configuration together. Export gives you a portable JSON content bundle.' }), node('div', { class: 'project-buttons' }, [button('Create snapshot', async () => { try { await api('/api/snapshot', 'POST', {}); toast('Project snapshot created.'); projectView(); } catch (error) { toast(error.message, true); } }, { class: 'primary-button' }), node('a', { href: '/api/export', download: '', class: 'quiet-button', text: 'Export content' }), button('Check saved site', validate, { class: 'quiet-button' })])]));
    const checks = node('div', { class: 'project-card' }, node('h3', { text: 'Project health' })); (info.checks || []).forEach(check => checks.append(node('div', { class: 'check-row' }, [node('span', { text: check.status === 'pass' || check.status === 'ok' ? '✓' : '○' }), check.label, node('small', { text: check.detail })]))); view.append(checks);
    view.append(node('div', { class: 'project-card' }, [node('h3', { text: `Git · ${info.branch || 'No branch'}` }), node('p', { text: info.lastCommit ? `${info.lastCommit.hash?.slice(0, 7)} · ${info.lastCommit.subject}` : 'No commit information available.' }), node('pre', { text: info.changedFiles?.length ? info.changedFiles.map(file => `${file.status}  ${file.path}`).join('\n') : 'Working tree is clean.' })]));
    const snapshots = await api('/api/snapshots'); const entries = snapshots.snapshots || snapshots; const card = node('div', { class: 'project-card' }, [node('h3', { text: 'Project snapshots' }), node('p', { text: 'Stored under .studio/snapshots. These are local copies; use Export content to keep an additional copy elsewhere.' })]); for (const snapshot of entries.slice(0, 5)) card.append(node('div', { class: 'check-row', text: snapshot.id || snapshot.name || JSON.stringify(snapshot) })); if (!entries.length) card.append(node('small', { text: 'Create your first snapshot above.' })); view.append(card);
  } catch (error) { view.replaceChildren(node('div', { class: 'notice error', text: error.message })); }
}
function help() { const content = node('div', {}, [node('p', { class: 'modal-intro', text: 'Your website is the canvas. Your files remain the source of truth.' }), node('ol', {}, [node('li', { text: 'Choose a page. Click a section in the preview to open its fields.' }), node('li', { text: 'Double-click simple text to write directly on the page. Use the inspector for images, lists, links and longer passages.' }), node('li', { text: 'Add a section, drag to reorder, or use the up/down arrows. Every change can be undone.' }), node('li', { text: 'Switch to Interact to try links, music and other page controls. Switch back to keep editing.' }), node('li', { text: 'Save locally writes to your project with a backup. Check site validates the saved files. Publishing still happens through your GitHub workflow.' })]), node('div', { class: 'notice', text: 'Browser drafts are kept automatically. File history and project snapshots live in .studio. Keep external backups for long-term safekeeping.' }), node('div', { class: 'shortcut-list' }, ['Save locally', node('kbd', { text: 'Ctrl / ⌘ S' }), 'Undo', node('kbd', { text: 'Ctrl / ⌘ Z' }), 'Redo', node('kbd', { text: 'Ctrl / ⌘ Shift Z' }), 'Close dialog', node('kbd', { text: 'Escape' })])]); openModal('A quiet guide to Studio', content); }
function dirtyDocumentIds(ids) {
  flushInlineEdit();
  return inspectBrowserDrafts({ ids, documents: state.documents, drafts: state.drafts, storage: localStorage }).dirtyIds;
}
import { archiveOrphanBrowserDrafts, inspectBrowserDrafts, reconcileLifecycleDrafts } from './draft-reconcile.js';
function documentsForLifecyclePlan(plan) {
  // A reviewed create/restore destination is absent on disk even if this tab's
  // page list predates a deletion made in another Studio session.
  const absent = new Set((plan?.changes || []).filter(change => ['create', 'restore'].includes(change.action)).map(change => change.id));
  return state.documents.filter(document => !absent.has(document.id));
}
const lifecycle = createLifecycle({ api, node, button, openModal, closeModal: () => $('#modal').close(), toast, currentDoc, dirtyIds: dirtyDocumentIds,
  orphanIds(ids, { plan }) { return inspectBrowserDrafts({ ids, documents: documentsForLifecyclePlan(plan), drafts: state.drafts, storage: localStorage }).orphanIds; },
  archiveOrphans(ids, { plan }) {
    const result = archiveOrphanBrowserDrafts({ ids, documents: documentsForLifecyclePlan(plan), drafts: state.drafts, storage: localStorage });
    if (ids.includes(state.current) && currentDoc() && !draft()) ensureDraft(currentDoc());
    return result;
  },
  beforeApply({ affected }) { return inspectBrowserDrafts({ ids: affected, documents: state.documents, drafts: state.drafts, storage: localStorage }); },
  async onApplied(result, _payload, inspection) {
    const documents = result.documents || (await api('/api/state')).documents;
    const reconciliation = reconcileLifecycleDrafts({ previousDocuments: state.documents, nextDocuments: documents, drafts: state.drafts, storage: localStorage, changedIds: result.changedIds, inspection, oldId: result.oldId, newId: result.newId });
    state.documents = documents;
    const selected = result.document?.id || result.newId || (documentById(state.current) ? state.current : documents.find(doc => doc.kind === 'home')?.id) || documents[0]?.id;
    if (selected) selectDocument(selected);
    return reconciliation.recovered.length ? 'New browser edits were kept in the page’s History.' : reconciliation.conflicts.length ? 'Unrelated browser drafts were kept; review their external-change notices.' : '';
  }
});
$('#page-actions').onclick = lifecycle.showActions; $('#trash').onclick = lifecycle.showTrash;
$('#undo').onclick = () => historyStep('undo'); $('#redo').onclick = () => historyStep('redo'); $('#save').onclick = save; $('#check').onclick = validate; $('#new-page').onclick = newPage; $('#media').onclick = () => showMedia(); $('#help').onclick = help; $('#page-search').oninput = renderPages; $('#project-tab').onclick = projectView; $('#pages-tab').onclick = () => selectDocument(state.current);
for (const tab of ['structure', 'details', 'history']) $('#' + tab + '-tab').onclick = () => { state.tab = tab; renderInspector(); };
document.querySelectorAll('[data-device]').forEach(control => control.onclick = () => { document.querySelectorAll('[data-device]').forEach(e => e.classList.toggle('active', e === control)); $('#preview-paper').dataset.device = control.dataset.device; });
$('#interact').onclick = () => { if (!flushInlineEdit()) return; state.mode = state.mode === 'edit' ? 'interact' : 'edit'; $('#interact').textContent = state.mode === 'edit' ? '↖ Edit mode' : '▷ Interact'; $('#interact').setAttribute('aria-pressed', state.mode === 'interact'); if (state.mode === 'edit') schedulePreview(0); bridge({ type: 'mode', mode: state.mode }); };
document.addEventListener('keydown', event => { if (!(event.ctrlKey || event.metaKey)) return; if (event.key.toLowerCase() === 's') { event.preventDefault(); save(); } else if (event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName) && !event.target.isContentEditable && !event.defaultPrevented) { event.preventDefault(); historyStep(event.shiftKey ? 'redo' : 'undo'); } });
window.addEventListener('beforeunload', event => { flushInlineEdit(); if ([...state.drafts.values()].some(d => JSON.stringify(d.data) !== d.saved)) event.preventDefault(); });
async function start() {
  try { const result = await api('/api/state'); Object.assign(state, { documents: result.documents, media: result.media, config: result.config, token: result.token }); selectDocument(state.documents.find(d => d.kind === 'home')?.id || state.documents[0].id); }
  catch (error) { $('#preview-loading').hidden = true; $('#save-state').textContent = 'Could not open workspace'; toast(error.message, true); }
}
start();
export { selectDocument, save, openModal, flushInlineEdit };
