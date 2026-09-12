import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = ['astro-preview', 'cli', 'content-search', 'document-lifecycle', 'inline-session', 'launchpad', 'project-config', 'project-tools', 'server-core', 'server'];
const web = ['app.js', 'command-palette.js', 'command-palette.css', 'draft-reconcile.js', 'index.html', 'launchpad.html', 'launchpad.js', 'launchpad.css', 'lifecycle.js', 'lifecycle.css', 'studio.css', 'workspace-storage.js', 'writer.js', 'writer.css'];
export const STUDIO_TEST_FILES = Object.freeze([
  'studio-server.test.mjs', 'document-lifecycle.test.mjs', 'lifecycle-ui.test.mjs', 'draft-reconcile.test.mjs',
  'studio-writer.test.mjs', 'studio-inline.test.mjs', 'studio-launch.test.mjs', 'studio-cli.test.mjs',
  'markdown.test.mjs', 'content-validation.test.mjs', 'redirects.test.mjs', 'redirect-build.test.mjs',
  'project-config.test.mjs', 'command-palette.test.mjs', 'content-search.test.mjs', 'workspace-storage.test.mjs',
  'multi-project.test.mjs', 'launchpad.test.mjs', 'launchpad-ui.test.mjs'
]);
export const PACKAGE_DEPENDENCIES = Object.freeze([
  '@astrojs/sitemap', 'astro', 'marked', 'sanitize-html', '@astrojs/check',
  '@tiptap/core', '@tiptap/extension-code-block', '@tiptap/extension-image', '@tiptap/extension-link',
  '@tiptap/extension-paragraph', '@tiptap/extension-placeholder', '@tiptap/markdown', '@tiptap/starter-kit',
  '@types/sanitize-html', 'dompurify', 'esbuild', 'js-yaml', 'jsdom', 'typescript'
]);
// No recursive copy: additions to the website do not silently enter this package.
export const STUDIO_PACKAGE_FILES = Object.freeze([
  ...runtime.map(name => [`studio/${name}.mjs`, `studio/${name}.mjs`]),
  ['studio/preview-bridge.js', 'studio/preview-bridge.js'],
  ...web.map(name => [`studio/web/${name}`, `studio/web/${name}`]),
  ...['build-studio.mjs', 'studio-launch.mjs', 'redirects.mjs', 'validate-content.mjs', 'test-project-tools.mjs', ...STUDIO_TEST_FILES].map(name => [`scripts/${name}`, `scripts/${name}`]),
  ['src/content-schema.ts', 'src/content-schema.ts'], ['src/lib/markdown.ts', 'src/lib/markdown.ts'],
  ['src/content-schema.ts', 'reference/adapter/src/content-schema.ts'], ['src/lib/markdown.ts', 'reference/adapter/src/lib/markdown.ts'],
  ['src/studio-adapter/integration.mjs', 'reference/adapter/src/studio-adapter/integration.mjs'],
  ['src/studio-adapter/preview.astro', 'reference/adapter/src/studio-adapter/preview.astro'],
  ['studio/PROJECT_CONTRACT.md', 'studio/PROJECT_CONTRACT.md'], ['studio/WRITER.md', 'studio/WRITER.md'],
  ['studio/DISTRIBUTION_README.md', 'README.md'],
  ['studio/DISTRIBUTION_CHANGELOG.md', 'CHANGELOG.md'], ['studio/DISTRIBUTION_SECURITY.md', 'SECURITY.md'],
  ['Start Studio.cmd', 'Start Studio.cmd'],
  ['package-lock.json', 'package-lock.json']
].map(pair => Object.freeze(pair)));

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, target) => {
  const path = relative(root, target);
  return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

async function checkAncestors(path, { allowMissing = false } = {}) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  const parts = relative(cursor, absolute).split(sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    let info;
    try { info = await lstat(cursor); }
    catch (error) {
      // Canonicalize the existing ancestor before appending new path segments.
      // Windows 8.3 aliases must not defeat source/output overlap checks.
      if (error.code === 'ENOENT' && allowMissing) return join(await realpath(dirname(cursor)), ...parts.slice(index));
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Linked paths are not allowed: ${cursor}`);
    if (cursor !== absolute && !info.isDirectory()) throw new Error(`An ancestor is not a directory: ${cursor}`);
  }
  return realpath(absolute);
}

async function checkSourceFile(root, path) {
  const full = resolve(root, path);
  if (!inside(root, full) || samePath(root, full)) throw new Error('Invalid export allowlist path.');
  await checkAncestors(full);
  const info = await lstat(full);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`Only regular source files no larger than 8 MiB can be exported: ${path}`);
  return { full, bytes: info.size };
}

async function checkOutput(source, out) {
  if (typeof out !== 'string' || !isAbsolute(out) || out.includes('\0')) throw new Error('--out must be an absolute directory path.');
  const target = await checkAncestors(resolve(out), { allowMissing: true });
  if (inside(source, target) || inside(target, source)) throw new Error('The output must be separate from the source directory and all its ancestors or descendants.');
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The output must be a real directory.');
    if ((await readdir(target)).length) throw new Error('The output directory is not empty. Choose a new or empty directory; no files were removed.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}

function manifest(source) {
  const dependencies = {}, devDependencies = {};
  for (const name of PACKAGE_DEPENDENCIES) {
    const section = Object.hasOwn(source.dependencies ?? {}, name) ? 'dependencies' : 'devDependencies';
    const value = source[section]?.[name];
    if (typeof value !== 'string' || !/^[~^]?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value)) throw new Error(`A known, versioned dependency is required: ${name}`);
    (section === 'dependencies' ? dependencies : devDependencies)[name] = value;
  }
  return {
    name: '@willqing/will-studio', version: '0.3.0', private: true, type: 'module', license: 'UNLICENSED',
    description: 'A local visual content workspace for compatible will-astro-v1 websites.', engines: { node: '>=24' },
    repository: { type: 'git', url: 'https://github.com/Hydr0g3ngz/will-studio.git' },
    homepage: 'https://github.com/Hydr0g3ngz/will-studio#readme',
    bugs: { url: 'https://github.com/Hydr0g3ngz/will-studio/issues' },
    scripts: {
      start: 'node studio/server.mjs', 'start:guided': 'node scripts/studio-launch.mjs',
      'build:writer': 'node scripts/build-studio.mjs', 'build:studio': 'node scripts/build-studio.mjs',
      test: `node --test ${STUDIO_TEST_FILES.map(file => `scripts/${file}`).join(' ')} && node scripts/test-project-tools.mjs`
    }, dependencies, devDependencies
  };
}

const workflow = `name: Studio checks
on: [push, pull_request, workflow_dispatch]
permissions:
  contents: read
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${'${{ matrix.os }}'}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build:writer
`;
const referenceReadme = `# Reference adapter code

This folder contains the current will-astro-v1 integration and schema source, not
a complete website template. The preview component expects the compatible site's
own Base layout, BlockRenderer, PageHeader, content collections, and styles at
their contract paths. No personal pages, media, or authored content are included.

The duplicate schema and Markdown helper under the package's top-level src are
test fixtures/reference code. Studio loads the selected trusted project's schema;
it does not use these files as a substitute for that project's implementation.

Read ../../studio/PROJECT_CONTRACT.md before adapting a website. Do not load code
from an untrusted project. Production builds must not include the preview route.
`;

/** Export known source files only. Never installs, deletes, initializes Git, or pushes. */
export async function packageStudio({ sourceRoot = resolve(import.meta.dirname, '..'), out } = {}) {
  const source = await checkAncestors(resolve(sourceRoot));
  if (!(await lstat(source)).isDirectory()) throw new Error('Choose the real source directory.');
  const target = await checkOutput(source, out);
  const packageFile = await checkSourceFile(source, 'package.json');
  const packageData = manifest(JSON.parse(await readFile(packageFile.full, 'utf8')));
  const files = [];
  let bytes = 0;
  // Validate the complete allowlist before creating even an empty output folder.
  for (const [from, to] of STUDIO_PACKAGE_FILES) {
    const file = await checkSourceFile(source, from);
    bytes += file.bytes;
    if (bytes > MAX_EXPORT_BYTES) throw new Error('The selected export exceeds the 32 MiB source limit.');
    files.push({ ...file, from, to });
  }
  const launcher = await readFile(files.find(file => file.to === 'Start Studio.cmd').full, 'utf8');
  const launchCommand = /^node scripts\\studio-launch\.mjs(?: %\*)?\r?$/gm;
  if ([...launcher.matchAll(launchCommand)].length !== 1) throw new Error('The Windows launcher changed; review its export transformation before packaging.');
  const exportedLauncher = launcher.replace(launchCommand, 'node scripts\\studio-launch.mjs %*');
  // A malformed lockfile should be noticed now, before any output is written.
  JSON.parse(await readFile(files.find(file => file.to === 'package-lock.json').full, 'utf8'));
  await checkOutput(source, target);
  await mkdir(target, { recursive: true });
  const written = [];
  const emit = async (path, contents) => {
    const destination = resolve(target, path);
    if (!inside(target, destination)) throw new Error('Invalid generated output path.');
    await checkAncestors(destination, { allowMissing: true });
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, { flag: 'wx' });
    written.push(path);
  };
  try {
    for (const file of files) {
      if (file.to === 'Start Studio.cmd') { await emit(file.to, exportedLauncher); continue; }
      await checkSourceFile(source, file.from);
      const destination = resolve(target, file.to);
      await checkAncestors(destination, { allowMissing: true });
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(file.full, destination, constants.COPYFILE_EXCL);
      written.push(file.to);
    }
    await emit('package.json', `${JSON.stringify(packageData, null, 2)}\n`);
    await emit('.github/workflows/check.yml', workflow);
    await emit('.gitignore', 'node_modules/\nstudio/web/generated/\n.studio/\ndist/\noutput/\n*.log\n.env\n.env.*\n');
    await emit('reference/adapter/README.md', referenceReadme);
  } catch (error) {
    throw new Error(`Export stopped: ${error.message}. Partial files remain in the selected output directory; no files or directories were deleted.`, { cause: error });
  }
  return { out: target, packageName: packageData.name, version: packageData.version, fileCount: written.length, files: written, lockfileNeedsRefresh: true };
}

export function parsePackageArguments(args) {
  if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) throw new Error('Usage: node scripts/package-studio.mjs --out <absolute-new-or-empty-directory>');
  return { out: args[1] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await packageStudio(parsePackageArguments(process.argv.slice(2)));
    console.log(`Exported ${result.fileCount} files to ${result.out}.`);
    console.log('Next, from that directory: npm install --package-lock-only, npm ci, npm test, npm run build:writer.');
    console.log('No repository was created, no dependencies were installed, and nothing was pushed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
