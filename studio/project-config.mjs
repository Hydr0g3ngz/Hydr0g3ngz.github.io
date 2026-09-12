import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const PROJECT_CONFIG_FILE = 'will-studio.config.json';
export const PROJECT_ADAPTER = 'will-astro-v1';
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_NAME_LENGTH = 100;
const REQUIRED_FILES = [
  'package.json', 'astro.config.mjs', '.pages.yml', 'src/content-schema.ts',
  'src/content/home/home.json', 'src/content/settings/site.json', 'src/content/pages/about.json'
];
const REQUIRED_DIRECTORIES = ['src/content/pages', 'src/content/notes', 'public/images'];
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

export class ProjectConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectConfigError';
    this.code = 'STUDIO_PROJECT_CONFIG';
  }
}

async function projectRoot(root) {
  if (typeof root !== 'string' || !root.trim() || root.includes('\0')) throw new ProjectConfigError('Choose a local project directory.');
  const selected = resolve(root);
  let current = parse(selected).root;
  // Windows can legitimately expand RUNNER~1 and other 8.3 aliases in realpath.
  // Check the actual link type of every selected ancestor instead of treating
  // any spelling change as evidence that the path crossed a junction.
  for (const part of ['', ...relative(current, selected).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch { throw new ProjectConfigError('The selected project directory does not exist or cannot be read.'); }
    if (info.isSymbolicLink()) throw new ProjectConfigError('Choose the real project directory, not a symbolic link or directory junction.');
    if (!info.isDirectory()) throw new ProjectConfigError('The selected project directory and its ancestors must be directories.');
  }
  try { return await realpath(selected); }
  catch { throw new ProjectConfigError('The selected project directory does not exist or cannot be read.'); }
}

async function checkedPath(root, suffix, { kind = 'file', optional = false } = {}) {
  const target = resolve(root, suffix);
  const within = relative(root, target);
  if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new ProjectConfigError('A project path leaves the selected directory.');
  let current = root;
  const parts = within.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT' && optional) return null;
      throw new ProjectConfigError(`This adapter requires a readable ${kind}: ${suffix}.`);
    }
    if (info.isSymbolicLink()) throw new ProjectConfigError(`Linked files and directories are not supported: ${suffix}.`);
    const final = index === parts.length - 1;
    if ((!final || kind === 'directory') ? !info.isDirectory() : !info.isFile()) throw new ProjectConfigError(`Expected a regular ${kind}: ${suffix}.`);
  }
  const canonical = await realpath(target);
  if (!samePath(target, canonical)) throw new ProjectConfigError(`The project path must stay inside its real directory: ${suffix}.`);
  return target;
}

async function readJson(root, suffix, maxBytes, { optional = false } = {}) {
  const path = await checkedPath(root, suffix, { optional });
  if (!path) return undefined;
  const handle = await open(path, 'r');
  let source;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new ProjectConfigError(`${suffix} must be a regular file no larger than ${maxBytes} bytes.`);
    // Bound the actual read too, including a file that grows after stat().
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new ProjectConfigError(`${suffix} is too large.`);
    source = buffer.toString('utf8', 0, length).replace(/^\uFEFF/, '');
  } finally { await handle.close(); }
  try { return JSON.parse(source); }
  catch { throw new ProjectConfigError(`${suffix} must contain valid JSON, not executable configuration.`); }
}

function knownObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new ProjectConfigError(`${label} must be a JSON object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new ProjectConfigError(`Unknown ${label} field: ${key}.`);
}

function projectName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectConfigError(`project.name must contain 1–${MAX_NAME_LENGTH} characters without control characters.`);
  }
  return value.trim();
}

function siteUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\\\u0000-\u0020\u007f]/.test(value)) throw new ProjectConfigError('project.siteUrl must be an absolute HTTPS site URL.');
  let url;
  try { url = new URL(value); } catch { throw new ProjectConfigError('project.siteUrl must be an absolute HTTPS site URL.'); }
  if (!value.startsWith('https://') || url.protocol !== 'https:' || !url.hostname || url.username || url.password || value.includes('?') || value.includes('#')) {
    throw new ProjectConfigError('project.siteUrl must use HTTPS without credentials, a query, or a fragment. Omit it for a local-only preview.');
  }
  return url.href;
}

/** Read-only structural checks. This function never imports the project's code. */
export async function assertCompatibleProject(root) {
  const selected = await projectRoot(root);
  for (const suffix of REQUIRED_FILES) await checkedPath(selected, suffix);
  for (const suffix of REQUIRED_DIRECTORIES) await checkedPath(selected, suffix, { kind: 'directory' });
  await checkedPath(selected, 'src/redirects.json', { optional: true });
  await checkedPath(selected, 'public/uploads', { kind: 'directory', optional: true });
  return Object.freeze({ root: selected, schemaPath: join(selected, 'src/content-schema.ts'), contentRoot: join(selected, 'src/content') });
}

/** A versioned data contract; not an executable plug-in or a trust decision. */
export async function loadProjectConfig(root, { allowLegacy = true } = {}) {
  const { root: selected } = await assertCompatibleProject(root);
  const config = await readJson(selected, PROJECT_CONFIG_FILE, MAX_CONFIG_BYTES, { optional: true });
  if (config === undefined) {
    if (!allowLegacy) throw new ProjectConfigError(`Add ${PROJECT_CONFIG_FILE} to this project before opening it in Studio.`);
    const packageData = await readJson(selected, 'package.json', MAX_PACKAGE_BYTES);
    if (!packageData || typeof packageData !== 'object' || Array.isArray(packageData)) throw new ProjectConfigError('package.json must contain a JSON object.');
    let name = 'Local Website';
    if (typeof packageData.name === 'string') {
      const readable = packageData.name.replace(/^@[^/]+\//, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
      try { name = projectName(readable); } catch { /* A malformed package label is not project configuration. */ }
    }
    return Object.freeze({ version: 1, adapter: PROJECT_ADAPTER, project: Object.freeze({ name }), configSource: 'legacy', warnings: Object.freeze([`Legacy project: add ${PROJECT_CONFIG_FILE} to give this workspace an explicit name and adapter version.`]) });
  }
  knownObject(config, ['version', 'adapter', 'project'], 'configuration');
  if (config.version !== 1) throw new ProjectConfigError('Unsupported project configuration version. This Studio supports version 1.');
  if (config.adapter !== PROJECT_ADAPTER) throw new ProjectConfigError(`Unsupported adapter. This Studio supports only ${PROJECT_ADAPTER}.`);
  knownObject(config.project, ['name', 'siteUrl'], 'project');
  const project = { name: projectName(config.project.name) };
  if (Object.hasOwn(config.project, 'siteUrl')) project.siteUrl = siteUrl(config.project.siteUrl);
  return Object.freeze({ version: 1, adapter: PROJECT_ADAPTER, project: Object.freeze(project), configSource: 'file', warnings: Object.freeze([]) });
}
