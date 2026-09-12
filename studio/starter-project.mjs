import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { STARTER_FILES, STARTER_DIRECTORIES } from './starter/template-manifest.mjs';
import { revisionOf, StudioError } from './server-core.mjs';

const FILE_LIMIT = 8 * 1024 * 1024, TOTAL_LIMIT = 32 * 1024 * 1024;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, target) => { const path = relative(root, target); return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)); };
const identity = info => ({ dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs });

async function directory(path) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of ['', ...relative(cursor, absolute).split(sep).filter(Boolean)]) {
    if (part) cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new StudioError(422, 'Choose a real folder without symbolic links or directory junctions.');
  }
  return realpath(absolute);
}

function input(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudioError(400, 'Choose a project name and absolute folder path.');
  const { path, name } = value;
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) throw new StudioError(400, 'Use an absolute local folder path of at most 4096 characters.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new StudioError(400, 'Use a project name of 1–100 characters without control characters.');
  return { path: resolve(path), name: name.trim() };
}

async function targetState(path, protectedRoots) {
  if (same(path, parse(path).root)) throw new StudioError(400, 'Choose a new project folder, not a drive or filesystem root.');
  let parent;
  try { parent = await directory(dirname(path)); }
  catch (error) { if (error.code === 'ENOENT') throw new StudioError(422, 'The parent folder does not exist. Choose an existing parent folder first.'); throw error; }
  const target = join(parent, basename(path));
  for (const protectedRoot of protectedRoots) {
    const root = await directory(protectedRoot);
    if (inside(root, target) || inside(target, root)) throw new StudioError(409, 'Choose a separate folder outside Studio and its open website projects.');
  }
  let info = null;
  try {
    info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new StudioError(422, 'The destination must be a new or empty real folder, not a file or link.');
    if ((await readdir(target)).length) throw new StudioError(409, 'This folder is not empty. Nothing was changed; choose a new or empty folder.');
    if (!same(await directory(target), target)) throw new StudioError(409, 'The destination changed. Review the folder again.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { path: target, parent, parentIdentity: identity(await lstat(parent)), destinationIdentity: info ? identity(info) : null };
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || /[\\:\u0000-\u001f\u007f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new StudioError(500, 'The bundled starter manifest contains an invalid path.');
  return value;
}

async function readTemplate(root, suffix) {
  const file = join(root, relativePath(suffix));
  await directory(dirname(file));
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > FILE_LIMIT) throw new StudioError(422, 'The bundled starter contains a linked, oversized, or non-regular file.');
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new StudioError(409, 'The bundled starter changed while it was being read. Review it again.');
    const bytes = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = await handle.read(bytes, count, bytes.length - count, null);
      if (!next.bytesRead) break;
      count += next.bytesRead;
    }
    if (count > info.size || (await lstat(file)).isSymbolicLink()) throw new StudioError(409, 'The bundled starter changed while it was being read. Review it again.');
    return bytes.subarray(0, count).toString('utf8');
  } finally { await handle.close(); }
}

function personalize(path, raw, name) {
  if (!['package.json', 'will-studio.config.json', 'src/content/home/home.json', 'src/content/settings/site.json'].includes(path)) return raw;
  const data = JSON.parse(raw);
  if (path === 'package.json') data.name = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'my-website';
  if (path === 'will-studio.config.json') data.project.name = name;
  if (path === 'src/content/home/home.json') data.title = name;
  if (path === 'src/content/settings/site.json') { data.defaultTitle = name; data.brand = name; }
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Read-only plan. Never runs selected code, npm, Git, or a network request. */
export async function inspectStarterProject({ runtimeRoot, path, name, protectedRoots = [] }) {
  const selected = input({ path, name }), runtime = await directory(runtimeRoot);
  const destination = await targetState(selected.path, [runtime, ...protectedRoots]);
  const templateRoot = await directory(join(runtime, 'studio/starter/template'));
  if (STARTER_FILES.length > 200 || STARTER_DIRECTORIES.length > 100) throw new StudioError(500, 'The starter manifest is too large.');
  const files = STARTER_FILES.map(relativePath), directories = STARTER_DIRECTORIES.map(relativePath);
  if (new Set(files.map(path => path.toLowerCase())).size !== files.length || new Set(directories.map(path => path.toLowerCase())).size !== directories.length || files.some(file => directories.includes(file))) throw new StudioError(500, 'The starter manifest contains conflicting paths.');
  const contents = new Map(); let bytes = 0;
  for (const file of files) {
    const text = personalize(file, await readTemplate(templateRoot, file), selected.name);
    bytes += Buffer.byteLength(text);
    if (bytes > TOTAL_LIMIT) throw new StudioError(422, 'The bundled starter is too large.');
    contents.set(file, text);
  }
  const fingerprint = revisionOf(JSON.stringify({ destination, name: selected.name, directories, files: [...contents].map(([path, text]) => [path, revisionOf(text)]) }));
  return { ready: true, project: { name: selected.name, path: destination.path }, files, directories, warnings: ['Creates local source files only. Dependencies, Git, and publishing are separate steps.'], fingerprint, contents, destination };
}

export function starterCommands(path) {
  const ps = `'${path.replaceAll("'", "''")}'`;
  const sh = `'${path.replaceAll("'", "'\"'\"'")}'`;
  return { powershell: `Set-Location -LiteralPath ${ps}\nnpm install\nnpm run build`, posix: `cd -- ${sh}\nnpm install\nnpm run build` };
}

/** Exclusive file creation only. Failures leave recoverable partial output, never delete it. */
export async function createStarterProject({ runtimeRoot, path, name, fingerprint, protectedRoots = [] }) {
  const current = await inspectStarterProject({ runtimeRoot, path, name, protectedRoots });
  if (typeof fingerprint !== 'string' || current.fingerprint !== fingerprint) throw new StudioError(409, 'The destination or starter changed after review. Review the file list again; nothing was created.');
  const { destination } = current;
  let began = false;
  const createdFiles = [], createdDirectories = [];
  try {
    if (!destination.destinationIdentity) { await mkdir(destination.path); began = true; }
    const rootIdentity = identity(await lstat(destination.path));
    const assertRoot = async () => {
      const canonical = await directory(destination.path);
      if (!same(canonical, destination.path) || JSON.stringify(identity(await lstat(canonical))) !== JSON.stringify(rootIdentity)) throw new StudioError(409, 'The output folder changed during creation.');
    };
    for (const suffix of [...current.directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
      await assertRoot();
      const target = join(destination.path, suffix);
      await directory(dirname(target));
      await mkdir(target); began = true; createdDirectories.push(suffix);
    }
    for (const [suffix, contents] of current.contents) {
      await assertRoot();
      const target = join(destination.path, suffix);
      await directory(dirname(target));
      const handle = await open(target, 'wx'); began = true;
      try { await handle.writeFile(contents, 'utf8'); await handle.sync(); createdFiles.push(suffix); }
      finally { await handle.close(); }
    }
    await assertRoot();
    return { project: current.project, files: createdFiles, directories: createdDirectories, commands: starterCommands(destination.path), warnings: current.warnings };
  } catch (error) {
    if (!began) throw new StudioError(409, 'The destination became unavailable. Nothing was overwritten; review the folder again.');
    throw new StudioError(409, `Creation stopped. Files already created remain in ${destination.path}; no files were removed or overwritten. Inspect that folder before choosing a new destination.`, { createdFiles, createdDirectories, cause: error.message });
  }
}
