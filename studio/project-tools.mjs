import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { load as parseYaml } from 'js-yaml';

const execute = promisify(execFile);
const CONTENT_EXTENSIONS = new Set(['.json', '.md', '.mdx']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']);
const SNAPSHOT_FORMAT = 'will-studio-snapshot-v1';
const MAX_CONTENT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_CONTENT_FILES = 2000;

function safeRelative(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\\0:]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe project path: ${String(path)}`);
  }
  return path;
}

function isBundlePath(path) {
  safeRelative(path);
  return path === '.pages.yml' || path === 'IMAGE_CREDITS.md' || (
    path.startsWith('src/content/') &&
    CONTENT_EXTENSIONS.has(extname(path).toLowerCase()) &&
    path.split('/').every((part) => !part.startsWith('.') && part !== 'node_modules')
  );
}

async function rootPath(projectRoot) {
  return realpath(resolve(projectRoot));
}

async function checkedPath(root, path, { missing = false } = {}) {
  const parts = safeRelative(path).split('/');
  let target = root;
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (missing && error.code === 'ENOENT') return null;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${path}`);
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error(`Expected a directory: ${path}`);
  }
  const actual = await realpath(target);
  const within = relative(root, actual);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`Path leaves the project: ${path}`);
  return target;
}

async function collectFiles(root, folder, extensions, { rejectLinks = true } = {}) {
  const start = await checkedPath(root, folder, { missing: true });
  if (!start) return [];
  const found = [];
  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = safeRelative(`${prefix}/${entry.name}`);
      if (entry.isSymbolicLink()) {
        if (rejectLinks) throw new Error(`Symbolic links are not allowed: ${path}`);
        continue;
      }
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) found.push(path);
    }
  }
  await visit(start, folder);
  return found;
}

async function contentFiles(root) {
  const paths = await collectFiles(root, 'src/content', CONTENT_EXTENSIONS);
  for (const path of ['.pages.yml', 'IMAGE_CREDITS.md']) {
    const target = await checkedPath(root, path, { missing: true });
    if (target && (await lstat(target)).isFile()) paths.push(path);
  }
  if (paths.length > MAX_CONTENT_FILES) throw new Error(`Content export supports up to ${MAX_CONTENT_FILES} documents.`);
  return paths.sort();
}

async function readContentFile(root, path) {
  const target = await checkedPath(root, path);
  const info = await lstat(target);
  if (!info.isFile()) throw new Error(`Content is not a regular file: ${path}`);
  if (info.size > MAX_CONTENT_FILE_BYTES) throw new Error(`Content file exceeds 2 MB: ${path}`);
  const content = await readFile(target, 'utf8');
  if (Buffer.byteLength(content) > MAX_CONTENT_FILE_BYTES) throw new Error(`Content file exceeds 2 MB: ${path}`);
  return content;
}

export async function exportContentBundle(projectRoot) {
  const root = await rootPath(projectRoot);
  const paths = await contentFiles(root);
  const files = [];
  let totalBytes = 0;
  for (const path of paths) {
    const content = await readContentFile(root, path);
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > MAX_BUNDLE_BYTES) throw new Error('Content export exceeds 16 MB. Media binaries should stay in the image library.');
    files.push({ path, content });
  }
  return { format: 'will-studio-content-v1', createdAt: new Date().toISOString(), files };
}

async function snapshotDirectory(root, create = false) {
  for (const folder of ['.studio', '.studio/snapshots']) {
    let target = await checkedPath(root, folder, { missing: true });
    if (!target && !create) return null;
    if (!target) {
      await mkdir(join(root, ...folder.split('/')), { recursive: false });
      target = await checkedPath(root, folder);
    }
    if (!(await lstat(target)).isDirectory()) throw new Error(`Expected a directory: ${folder}`);
  }
  return join(root, '.studio', 'snapshots');
}

async function finalizeSnapshot(root, id) {
  // Windows file watchers can briefly deny a directory rename after its files
  // were written. Retry only these lock errors; never replace another snapshot.
  const delays = [50, 100, 200, 400, 800, 1200];
  for (let attempt = 0; ; attempt++) {
    const source = await checkedPath(root, `.studio/snapshots/.pending-${id}`);
    const existing = await checkedPath(root, `.studio/snapshots/${id}`, { missing: true });
    if (existing) throw new Error('A snapshot already exists at this destination. It was not overwritten.');
    try {
      await rename(source, join(root, '.studio', 'snapshots', id));
      return;
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}

export async function createProjectSnapshot(projectRoot) {
  const root = await rootPath(projectRoot);
  const bundle = await exportContentBundle(root);
  const directory = await snapshotDirectory(root, true);
  const id = `${bundle.createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const pending = join(directory, `.pending-${id}`);
  await mkdir(pending);
  try {
    const files = [];
    for (const file of bundle.files) {
      const target = join(pending, ...safeRelative(file.path).split('/'));
      const parent = resolve(target, '..');
      await mkdir(parent, { recursive: true });
      await writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' });
      files.push({ path: file.path, bytes: Buffer.byteLength(file.content), sha256: createHash('sha256').update(file.content).digest('hex') });
    }
    const manifest = { format: SNAPSHOT_FORMAT, id, createdAt: bundle.createdAt, files, totalBytes: files.reduce((total, file) => total + file.bytes, 0) };
    await writeFile(join(pending, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await finalizeSnapshot(root, id);
    return { id, createdAt: manifest.createdAt, fileCount: files.length, bytes: manifest.totalBytes, path: `.studio/snapshots/${id}` };
  } catch (error) {
    // This directory was created exclusively by this operation; existing snapshots are never touched.
    await rm(pending, { recursive: true, force: true });
    throw error;
  }
}

export async function listProjectSnapshots(projectRoot) {
  const root = await rootPath(projectRoot);
  const directory = await snapshotDirectory(root);
  if (!directory) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    try {
      const path = `.studio/snapshots/${safeRelative(entry.name)}`;
      const manifestPath = await checkedPath(root, `${path}/manifest.json`);
      if ((await lstat(manifestPath)).size > MAX_CONTENT_FILE_BYTES) continue;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.format !== SNAPSHOT_FORMAT || manifest.id !== entry.name || !Array.isArray(manifest.files) || !Number.isFinite(Date.parse(manifest.createdAt))) continue;
      if (manifest.files.length > MAX_CONTENT_FILES || manifest.files.some((file) => !file || typeof file.path !== 'string' || !Number.isFinite(file.bytes) || file.bytes < 0 || file.bytes > MAX_CONTENT_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256))) continue;
      if (manifest.files.reduce((total, file) => total + file.bytes, 0) > MAX_BUNDLE_BYTES) continue;
      let intact = true;
      for (const file of manifest.files) {
        if (!isBundlePath(file.path)) { intact = false; break; }
        const target = await checkedPath(root, `${path}/${file.path}`);
        const info = await lstat(target);
        if (!info.isFile() || info.size !== file.bytes) { intact = false; break; }
        const digest = createHash('sha256').update(await readFile(target)).digest('hex');
        if (digest !== file.sha256) { intact = false; break; }
      }
      if (!intact) continue;
      snapshots.push({ id: entry.name, createdAt: manifest.createdAt, fileCount: manifest.files.length, bytes: manifest.files.reduce((total, file) => total + file.bytes, 0), path });
    } catch {
      // Incomplete or externally modified snapshots do not become selectable backups.
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function git(root, args) {
  try {
    const { stdout } = await execute('git', ['-C', root, ...args], { timeout: 4000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    return stdout;
  } catch {
    return null;
  }
}

function sanitizedRemote(value) {
  if (!value) return null;
  const remote = value.trim();
  if (/^(?:https?|ssh):\/\//i.test(remote)) {
    try {
      const url = new URL(remote);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  return /^(?:ssh:\/\/|git@)[^\s]+$/.test(remote) ? remote : null;
}

function changedFiles(status) {
  const records = (status || '').split('\0');
  const files = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.length < 4) continue;
    const state = record.slice(0, 2);
    files.push({ status: state.trim(), path: record.slice(3) });
    if (/[RC]/.test(state)) index++; // With -z, the destination comes first, then the previous path.
  }
  return files;
}

function parseDocument(path, content) {
  if (path.endsWith('.json')) return JSON.parse(content);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Markdown frontmatter is missing.');
  const data = parseYaml(match[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be an object.');
  return data;
}

export async function getProjectOverview(projectRoot) {
  const root = await rootPath(projectRoot);
  const [branch, status, commit, remote] = await Promise.all([
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']),
    git(root, ['log', '-1', '--format=%H%x00%s%x00%cI']),
    git(root, ['remote', 'get-url', 'origin'])
  ]);
  const checks = [];
  const content = { pages: 0, notes: 0, drafts: 0, images: 0 };
  const problems = [];
  const documents = [];
  let paths = [];
  try { paths = await collectFiles(root, 'src/content', CONTENT_EXTENSIONS); }
  catch (error) { problems.push(error.message); }
  for (const path of paths) {
    if (path.split('/').at(-1).startsWith('_')) continue;
    const isPage = path.startsWith('src/content/pages/') || path.startsWith('src/content/home/');
    const isNote = path.startsWith('src/content/notes/');
    if (isPage) content.pages++;
    if (isNote) content.notes++;
    try {
      const data = parseDocument(path, await readContentFile(root, path));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Content must be an object.');
      documents.push({ path, data });
      if ((isNote || path.startsWith('src/content/pages/')) && data.published !== true) content.drafts++;
    } catch (error) { problems.push(`${path}: ${error.message}`); }
  }
  checks.push({ label: 'Content files', status: problems.length ? 'error' : paths.length ? 'pass' : 'warning', detail: problems.length ? problems.join('\n') : paths.length ? `${content.pages} pages and ${content.notes} notes are readable. This is a basic integrity check; publishing also runs the full site build.` : 'No content files found.' });
  const imageProblems = [];
  for (const folder of ['public/images', 'public/uploads']) {
    try { content.images += (await collectFiles(root, folder, IMAGE_EXTENSIONS)).length; }
    catch (error) { imageProblems.push(error.message); }
  }
  async function inspectImages(value, source) {
    if (Array.isArray(value)) { for (const item of value) await inspectImages(item, source); return; }
    if (!value || typeof value !== 'object') return;
    for (const [field, alt] of [['image', 'imageAlt'], ['cover', 'coverAlt']]) {
      const image = value[field];
      if (image === undefined || image === '') continue;
      try {
        if (typeof image !== 'string' || !/^\/(images|uploads)\//.test(image)) throw new Error('Images must use /images/ or /uploads/.');
        const disk = await checkedPath(root, `public${image}`);
        if (!(await lstat(disk)).isFile()) throw new Error('Image is not a file.');
        if (typeof value[alt] !== 'string' || !value[alt].trim()) throw new Error('Image description is missing.');
      } catch (error) { imageProblems.push(`${source}: ${String(image)} — ${error.message}`); }
    }
    for (const child of Object.values(value)) await inspectImages(child, source);
  }
  for (const document of documents) await inspectImages(document.data, document.path);
  checks.push({ label: 'Image library', status: imageProblems.length ? 'error' : 'pass', detail: imageProblems.length ? imageProblems.join('\n') : `${content.images} images available; referenced covers and images have descriptions.` });
  let snapshots = [];
  try { snapshots = await listProjectSnapshots(root); }
  catch (error) { checks.push({ label: 'Snapshots', status: 'error', detail: error.message }); }
  if (!checks.some((check) => check.label === 'Snapshots')) checks.push({ label: 'Snapshots', status: snapshots.length ? 'pass' : 'warning', detail: snapshots.length ? `${snapshots.length} content snapshots. Latest: ${snapshots[0].createdAt}.` : 'No content snapshots yet. Create one before a larger edit.' });
  const changed = changedFiles(status);
  checks.push({ label: 'Git', status: status === null ? 'warning' : 'pass', detail: status === null ? 'Git information is unavailable. Local editing and snapshots still work.' : changed.length ? `${changed.length} changed paths in the working tree.` : 'Working tree is clean.' });
  const [hash, subject, date] = (commit?.trim() || '').split('\0');
  return { branch: branch?.trim() || null, changedFiles: changed, lastCommit: hash ? { hash, subject, date } : null, remoteUrl: sanitizedRemote(remote), content, backups: snapshots.length, checks };
}
