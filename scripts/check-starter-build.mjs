// Explicit CI smoke check, not part of creating or opening a user's website.
// Run through npm run check:starter so npm_execpath identifies the same npm CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inspectStarterProject, createStarterProject } from '../studio/starter-project.mjs';

const PREFIX = 'will-studio-starter-build-';
const PROJECT_NAME = 'Starter Build Check';
const FORBIDDEN_ROOTS = new Set(['.git', 'host.git', '.studio', 'data', 'studio']);
const TEXT_EXTENSIONS = /\.(?:html|css|js|mjs|json|map|txt|xml|svg)$/i;
const PRIVATE_RUNTIME = /\/__studio\/preview|preview-bridge|will-studio-preview|studio-content-data|data-studio-block|(?:\/studio\/web\/|\/__studio\/|\/\.studio\/)|(?:writer(?:\.bundle)?|section-library|command-palette)\.(?:js|css)/i;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const fileIdentity = (info) => `${info.dev}:${info.ino}:${info.birthtimeMs}`;

async function absent(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Unexpected host/runtime state in generated website: ${path}`);
}

async function assertNoHostState(projectRoot) {
  for (const name of FORBIDDEN_ROOTS) await absent(join(projectRoot, name));
}

async function filesUnder(root) {
  const files = [];
  let entries = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 8192) throw new Error(`Unexpectedly large generated tree: ${root}`);
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Generated output contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
      else throw new Error(`Generated output contains a non-regular file: ${path}`);
    }
  }
  await visit(root);
  return files.sort();
}

async function npm(npmCli, projectRoot, args) {
  console.log(`[starter-build] npm ${args.join(' ')}`);
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('error', rejectCommand);
    child.once('close', (code, signal) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`npm ${args[0]} failed (${signal ? `signal ${signal}` : `exit ${code}`}).`));
    });
  });
}

async function assertPublicOutput(projectRoot) {
  const dist = join(projectRoot, 'dist');
  for (const page of ['index.html', 'about/index.html']) {
    const html = await readFile(join(dist, page), 'utf8');
    assert.ok(html.includes(PROJECT_NAME), `${page} must contain the generated neutral project name.`);
    assert.ok(/<!doctype html>/i.test(html), `${page} must be a complete HTML document.`);
  }
  const files = await filesUnder(dist);
  for (const file of files) {
    if (file.split('/').some((part) => FORBIDDEN_ROOTS.has(part.toLowerCase())) || /(?:^|\/)__studio(?:\/|$)/i.test(file) || PRIVATE_RUNTIME.test(file)) {
      throw new Error(`Private Studio route or editor asset leaked into dist: ${file}`);
    }
    if (!TEXT_EXTENSIONS.test(file)) continue;
    const path = join(dist, file);
    if ((await lstat(path)).size > 8 * 1024 * 1024) throw new Error(`Unexpectedly large starter artifact: ${file}`);
    if (PRIVATE_RUNTIME.test(await readFile(path, 'utf8'))) throw new Error(`Private Studio preview/editor code leaked into public artifact: ${file}`);
  }
  await assertNoHostState(projectRoot);
  console.log(`[starter-build] Verified two named HTML pages and ${files.length} public artifacts; no host state or Studio preview/editor assets.`);
}

async function cleanupSuccessfulRun(qaRoot, temporaryRoot, originalIdentity) {
  // The only recursive removal in this script is this exact directory created
  // by mkdtemp, never the system temp folder, runtime, or an input project path.
  const info = await lstat(qaRoot);
  const canonical = await realpath(qaRoot);
  if (!info.isDirectory() || info.isSymbolicLink() || fileIdentity(info) !== originalIdentity ||
      !samePath(canonical, qaRoot) || !samePath(dirname(canonical), temporaryRoot) ||
      !basename(canonical).startsWith(PREFIX) || basename(canonical).length <= PREFIX.length) {
    throw new Error(`Refusing to clean an unverified temporary directory: ${qaRoot}`);
  }
  await rm(canonical, { recursive: true, force: false, maxRetries: 3, retryDelay: 200 });
  console.log(`[starter-build] Removed the temporary QA directory: ${canonical}`);
}

let qaRoot;
let projectRoot;
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('This check requires Node.js 24 or newer.');
  const npmEntry = process.env.npm_execpath;
  if (!npmEntry || !isAbsolute(npmEntry)) throw new Error('Run this explicit check through npm run check:starter; npm_execpath is unavailable.');
  const npmCli = await realpath(npmEntry);
  if (!(await lstat(npmCli)).isFile()) throw new Error('npm_execpath must identify the npm CLI JavaScript file.');
  const runtimeRoot = await realpath(resolve(import.meta.dirname, '..'));
  const temporaryRoot = await realpath(tmpdir());
  qaRoot = await realpath(await mkdtemp(join(temporaryRoot, PREFIX)));
  const qaIdentity = fileIdentity(await lstat(qaRoot));
  projectRoot = join(qaRoot, 'website');
  console.log(`[starter-build] Isolated generated project: ${projectRoot}`);

  const options = { runtimeRoot, path: projectRoot, name: PROJECT_NAME };
  const plan = await inspectStarterProject(options);
  for (const file of plan.files) {
    if (FORBIDDEN_ROOTS.has(file.split('/')[0].toLowerCase())) throw new Error(`Starter plan includes host/runtime state: ${file}`);
  }
  await createStarterProject({ ...options, fingerprint: plan.fingerprint });
  await assertNoHostState(projectRoot);
  await absent(join(projectRoot, 'node_modules'));
  await absent(join(projectRoot, 'package-lock.json'));
  assert.deepEqual(await filesUnder(projectRoot), [...plan.files].sort(), 'Creation must produce only the reviewed starter source files.');
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `Starter dependency ${name} must use an exact version.`);
  }

  // The first starter intentionally has no lockfile. Install only this generated
  // project's exact direct versions; never install into the runtime repository.
  await npm(npmCli, projectRoot, ['install', '--no-audit', '--no-fund']);
  await npm(npmCli, projectRoot, ['run', 'build']);
  await assertPublicOutput(projectRoot);
  await cleanupSuccessfulRun(qaRoot, temporaryRoot, qaIdentity);
  console.log('[starter-build] PASS: generated starter installs and builds independently.');
} catch (error) {
  console.error(`[starter-build] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  if (qaRoot) {
    console.error(`[starter-build] Generated project / diagnostic path: ${projectRoot ?? qaRoot}`);
    console.error(`[starter-build] No failure cleanup was requested; any remaining files are kept in ${qaRoot}`);
  }
  process.exitCode = 1;
}
