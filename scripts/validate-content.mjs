import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { load as parseYaml } from 'js-yaml';

const projectRoot = resolve(import.meta.dirname, '..');
const publicRoot = join(projectRoot, 'public');
const contentRoot = join(projectRoot, 'src', 'content');
const errors = [];
const checkedImages = new Set();

function validateCmsConfig() {
  const configPath = join(projectRoot, '.pages.yml');
  if (!existsSync(configPath)) {
    errors.push('The Pages CMS configuration file .pages.yml is missing.');
    return;
  }

  try {
    const config = parseYaml(readFileSync(configPath, 'utf8'));
    if (!config || typeof config !== 'object') {
      errors.push('.pages.yml must contain a YAML object.');
      return;
    }
    if (!Array.isArray(config.content) || config.content.length === 0) {
      errors.push('.pages.yml must define at least one content entry.');
    }
    if (!config.components || typeof config.components !== 'object') {
      errors.push('.pages.yml must define reusable block components.');
    }
    if (!Array.isArray(config.media) || config.media.length === 0) {
      errors.push('.pages.yml must define the image library.');
    }
  } catch (error) {
    errors.push(`.pages.yml: invalid YAML (${error.message})`);
  }
}

function listFiles(directory, extensions) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, extensions);
    return extensions.has(extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

function parseJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${relative(projectRoot, file)}: invalid JSON (${error.message})`);
    return null;
  }
}

function validateImage(value, alt, source) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    errors.push(`${source}: image paths must begin with "/".`);
    return;
  }

  if (!alt || typeof alt !== 'string' || !alt.trim()) {
    errors.push(`${source}: every image needs a non-empty description.`);
  }

  const diskPath = join(publicRoot, value.replace(/^\//, '').split('/').join(sep));
  if (!existsSync(diskPath)) {
    errors.push(`${source}: image file does not exist at ${value}.`);
    return;
  }

  if (!checkedImages.has(diskPath)) {
    checkedImages.add(diskPath);
    const size = statSync(diskPath).size;
    if (size > 2 * 1024 * 1024) {
      errors.push(`${source}: ${value} is larger than 2 MB; optimize it before publishing.`);
    }
  }
}

function walk(value, source) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${source}[${index}]`));
    return;
  }

  if (!value || typeof value !== 'object') return;

  if (typeof value.image === 'string') {
    validateImage(value.image, value.imageAlt, source);
  }

  if (typeof value.cover === 'string') {
    validateImage(value.cover, value.coverAlt, source);
  }

  Object.entries(value).forEach(([key, child]) => walk(child, `${source}.${key}`));
}

const homeFiles = listFiles(join(contentRoot, 'home'), new Set(['.json']));
const settingsFiles = listFiles(join(contentRoot, 'settings'), new Set(['.json']));
const pageFiles = listFiles(join(contentRoot, 'pages'), new Set(['.json']));

validateCmsConfig();

if (homeFiles.length !== 1) errors.push('Exactly one homepage JSON file is required.');
if (settingsFiles.length !== 1) errors.push('Exactly one site-settings JSON file is required.');

const parsedHome = homeFiles.map(parseJson).filter(Boolean);
const parsedSettings = settingsFiles.map(parseJson).filter(Boolean);
const parsedPages = pageFiles.map((file) => ({ file, data: parseJson(file) })).filter((entry) => entry.data);

[...parsedHome, ...parsedSettings, ...parsedPages.map((entry) => entry.data)].forEach((data, index) =>
  walk(data, `content[${index}]`)
);

const reservedRoutes = new Set(['index', 'notes', '404', '_astro']);
for (const { file, data } of parsedPages) {
  const route = relative(join(contentRoot, 'pages'), file)
    .replaceAll('\\', '/')
    .replace(/\.json$/i, '')
    .replace(/\/index$/, '');
  const firstSegment = route.split('/')[0];

  if (file.endsWith(`${sep}about.json`)) continue;
  if (reservedRoutes.has(firstSegment)) {
    errors.push(`${relative(projectRoot, file)}: "${firstSegment}" is a reserved page route.`);
  }
  if (data.published && (!Array.isArray(data.sections) || data.sections.length === 0)) {
    errors.push(`${relative(projectRoot, file)}: published pages need at least one section.`);
  }
}

if (parsedHome[0] && parsedSettings[0]) {
  const anchors = new Set(
    (parsedHome[0].sections ?? []).map((section) => section.id).filter(Boolean)
  );

  for (const link of parsedSettings[0].homeLinks ?? []) {
    const match = typeof link.href === 'string' && link.href.match(/^\/#([a-z][a-z0-9-]*)$/);
    if (match && !anchors.has(match[1])) {
      errors.push(`Site navigation points to missing homepage anchor "#${match[1]}".`);
    }
  }
}

if (errors.length > 0) {
  console.error('Content validation failed:\n');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  `Content validation passed: ${parsedPages.length} page(s), ${checkedImages.size} referenced image(s).`
);
