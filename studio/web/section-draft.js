const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const own = (value, key) => Object.hasOwn(value, key);
const fail = message => { throw new Error(message); };

function assertData(value, ancestors = new Set(), depth = 0, budget = { remaining: 100_000 }) {
  if (--budget.remaining < 0 || depth > 60) fail('This section configuration is too large or deeply nested.');
  if (value === null || value === undefined || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) fail('Section configuration must contain plain data only.');
  if (ancestors.has(value)) fail('This section configuration contains a circular value.');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (unsafeKeys.has(key) || descriptor.get || descriptor.set) fail('This section configuration contains an unsafe field.');
    assertData(descriptor.value, ancestors, depth + 1, budget);
  }
  ancestors.delete(value);
}

function usableImage(path) {
  return typeof path === 'string' && /^\/(images|uploads)\/.+/.test(path) && /\.(?:jpe?g|png|webp|avif|gif)$/i.test(path)
    && !/[\\%?#\u0000-\u001f\u007f]/.test(path)
    && path.split('/').slice(1).every(part => part && part !== '.' && part !== '..');
}

/**
 * Build one new section from its selected project's descriptor, without changing
 * that descriptor or any existing draft. This is not a replacement for the
 * selected project's schema: the host controls allowed refs and preview/save
 * remain the authority. The twelve current will-astro-v1 blocks are regression
 * tested, while project-defined aliases keep their supplied discriminator.
 */
export function createSectionDraft({ type, component, components = {}, media = [], sections = [] } = {}) {
  assertData({ type, component, components, media, sections });
  if (typeof type !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(type)) fail('Choose a section with a valid type identifier.');
  if (!components || typeof components !== 'object' || Array.isArray(components) || !Array.isArray(media) || !Array.isArray(sections)) fail('The section library needs project components, media and existing sections.');
  const images = [...new Set(media.map(item => item?.path).filter(usableImage))];
  const chooseImage = value => {
    if (images.includes(value)) return value;
    if (images.length) return images[0];
    fail('This section needs an image from this project. Upload an image to the Media library, then try adding the section again. No section was added.');
  };

  function resolveDescriptor(input, references) {
    const local = typeof input === 'string' ? { component: input } : input;
    if (!local || typeof local !== 'object' || Array.isArray(local)) fail('The selected section has no usable component descriptor.');
    if (local.component === undefined) return { field: local, references };
    const name = local.component;
    if (typeof name !== 'string' || unsafeKeys.has(name) || !own(components, name)) fail('A section component is missing from this project’s configuration.');
    if (references.has(name)) fail('This section configuration has a circular component reference. Correct the project configuration before adding it.');
    if (references.size >= 60) fail('This section configuration has too many nested component references.');
    const next = new Set(references); next.add(name);
    const base = resolveDescriptor(components[name], next);
    return { field: { ...base.field, ...local }, references: base.references };
  }

  function childFields(field) {
    if (field.fields !== undefined && !Array.isArray(field.fields)) fail('Section object fields must be a list.');
    const fields = field.fields ?? [], names = new Set();
    for (const child of fields) {
      if (!child || typeof child.name !== 'string' || !child.name || unsafeKeys.has(child.name) || names.has(child.name)) fail('Section fields need unique, safe names.');
      names.add(child.name);
    }
    return fields;
  }

  function listMinimum(field) {
    const minimum = field.list?.min;
    if (minimum !== undefined && (!Number.isInteger(minimum) || minimum < 0 || minimum > 1000)) fail('The section has an unsupported minimum list size.');
    return minimum || (field.required ? 1 : 0);
  }

  // Defaults may supply an entire nested object/list. Check every image that
  // actually appears in it, without filling optional objects the default omitted.
  function normalizeDefault(field, value, key, references, depth) {
    if (depth > 60) fail('This section configuration is too deeply nested.');
    if (field.list && Array.isArray(value)) return value.map(item => normalizeDefault({ ...field, list: undefined }, item, key, references, depth + 1));
    if (field.type === 'image') return chooseImage(value);
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const result = structuredClone(value);
      for (const child of childFields(field)) if (own(result, child.name)) {
        const resolved = resolveDescriptor(child, references);
        result[child.name] = normalizeDefault(resolved.field, result[child.name], child.name, resolved.references, depth + 1);
      }
      return result;
    }
    return structuredClone(value);
  }

  function build(field, key, references, depth = 0) {
    if (depth > 60) fail('This section configuration is too deeply nested.');
    if (field.default !== undefined) return normalizeDefault(field, field.default, key, references, depth);
    if (field.list) return Array.from({ length: listMinimum(field) }, () => build({ ...field, list: undefined }, key, references, depth + 1));
    if (field.type === 'object') {
      const result = {};
      for (const child of childFields(field)) {
        const resolved = resolveDescriptor(child, references), value = resolved.field;
        if (value.required || value.default !== undefined || value.list?.min || ['boolean', 'object'].includes(value.type)) result[child.name] = build(value, child.name, resolved.references, depth + 1);
      }
      return result;
    }
    if (field.type === 'image') return chooseImage();
    if (field.type === 'boolean') return true;
    if (field.type === 'number') return 1;
    if (field.type === 'select') { const first = field.options?.values?.[0]; return typeof first === 'object' ? first?.name ?? '' : first ?? ''; }
    if (field.type === 'date') return new Date().toISOString().slice(0, 10);
    if (key === 'href' || key === 'url' || /Url$/.test(key ?? '')) return 'https://example.com';
    if (key === 'imageAlt' || key === 'coverAlt') return 'Describe the image here';
    if (key === 'videoId') return '';
    return key === 'heading' || key === 'title' ? 'A new thought'
      : ['body', 'text', 'intro', 'summary'].includes(key) ? 'Write something worth keeping.'
      : key === 'eyebrow' || key === 'tag' ? 'A SMALL COLLECTION'
      : key === 'label' ? 'Read more' : field.required ? 'Add your words here' : '';
  }

  const resolved = resolveDescriptor(component ?? type, new Set());
  const value = build(resolved.field, undefined, resolved.references);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('A section component must create an object.');
  const section = { ...value, type };
  // These known nonempty string lists have schema requirements which the CMS
  // descriptor's item-level required flag does not express.
  for (const [kind, key, fallback] of [['profile', 'paragraphs', 'Write a little about yourself.'], ['marquee', 'items', 'THINGS WORTH KEEPING']]) {
    if (type !== kind) continue;
    if (section[key] === undefined || (Array.isArray(section[key]) && !section[key].length)) section[key] = [fallback];
    else if (Array.isArray(section[key])) section[key] = section[key].map(item => typeof item === 'string' && !item.trim() ? fallback : item);
  }
  function checkNestedImages(data) {
    if (!data || typeof data !== 'object') return;
    for (const [key, child] of Object.entries(data)) {
      if ((key === 'image' || key === 'cover') && child !== undefined) data[key] = chooseImage(child);
      else checkNestedImages(child);
    }
  }
  checkNestedImages(section);
  if (section.id === '') delete section.id;
  if (section.id !== undefined) {
    if (typeof section.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(section.id)) fail('The section’s default anchor is invalid. Use lowercase letters, numbers and hyphens in the project configuration.');
    const existing = new Set(sections.map(item => item?.id));
    const base = section.id;
    for (let suffix = 2; existing.has(section.id); suffix++) section.id = `${base}-${suffix}`;
  }
  return section;
}
