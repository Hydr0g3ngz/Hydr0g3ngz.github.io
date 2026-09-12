import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createProjectSnapshot, exportContentBundle, getProjectOverview, listProjectSnapshots } from '../studio/project-tools.mjs';

const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'will-studio-project-test-'));
const external = await mkdtemp(join(tmpdir(), 'will-studio-external-test-'));
async function put(path, content) {
  const target = join(root, ...path.split('/'));
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
}
async function runGit(...args) {
  return execute('git', ['-C', root, ...args], { windowsHide: true, encoding: 'utf8' });
}

try {
  await put('src/content/home/home.json', { title: 'Home', sections: [] });
  await put('src/content/pages/about.json', { title: 'About', published: true });
  await put('src/content/pages/books/favorites.json', { title: 'Favorite books', published: false });
  await put('src/content/notes/music.md', '---\ntitle: Music\npublished: false\ncover: /images/cover.png\ncoverAlt: An album sleeve\n---\nA **new** note.\n');
  await put('src/content/notes/_placeholder.md', '---\npublished: false\n---\n');
  await put('public/images/cover.png', 'fixture image');
  await put('src/content/.env', 'THIS_MUST_NOT_BE_EXPORTED');
  await put('.env', 'THIS_MUST_NOT_BE_EXPORTED');
  await put('.pages.yml', 'content: []\n');
  await put('IMAGE_CREDITS.md', 'Image credit.\n');
  await put('src/redirects.json', { version: 1, redirects: [] });
  const studioConfig = JSON.stringify({ version: 1, adapter: 'will-astro-v1', project: { name: 'Fixture homepage', siteUrl: 'https://example.invalid/' } }, null, 2) + '\n';
  await put('will-studio.config.json', studioConfig);
  await put('will-studio.config.local.json', 'THIS_MUST_NOT_BE_EXPORTED');

  const noGit = await getProjectOverview(root);
  assert.equal(noGit.branch, null);
  assert.equal(noGit.lastCommit, null);
  assert.deepEqual(noGit.content, { pages: 3, notes: 1, drafts: 2, images: 1 });
  assert(noGit.checks.some((check) => check.label === 'Git' && check.status === 'warning'));
  assert(noGit.checks.some((check) => check.label === 'Image library' && check.status === 'pass'));

  const bundle = await exportContentBundle(root);
  assert.equal(bundle.format, 'will-studio-content-v1');
  assert(bundle.files.some((file) => file.path === 'src/content/pages/books/favorites.json'));
  assert(bundle.files.some((file) => file.path === '.pages.yml'));
  assert(bundle.files.some((file) => file.path === 'src/redirects.json'));
  assert.equal(bundle.files.find((file) => file.path === 'will-studio.config.json')?.content, studioConfig, 'The project adapter configuration is exported as exact backup text.');
  assert(!bundle.files.some((file) => file.path === 'will-studio.config.local.json'), 'Only the explicitly allowed configuration filename is exported.');
  assert(!bundle.files.some((file) => file.path.startsWith('public/') || file.path.endsWith('.env')));
  assert(!JSON.stringify(bundle).includes('THIS_MUST_NOT_BE_EXPORTED'));

  const snapshot = await createProjectSnapshot(root);
  const manifest = JSON.parse(await readFile(join(root, snapshot.path, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, bundle.files.length);
  assert(manifest.files.some((file) => file.path === 'will-studio.config.json'), 'Snapshots include the configuration in their integrity manifest.');
  for (const file of manifest.files) {
    const saved = await readFile(join(root, snapshot.path, file.path));
    assert.equal(saved.length, file.bytes);
    assert.equal(createHash('sha256').update(saved).digest('hex'), file.sha256);
  }
  await put('src/content/pages/about.json', { title: 'Changed title', published: true });
  await put('will-studio.config.json', { version: 1, adapter: 'will-astro-v1', project: { name: 'Changed homepage' } });
  assert.equal(JSON.parse(await readFile(join(root, snapshot.path, 'src/content/pages/about.json'), 'utf8')).title, 'About');
  assert.equal(await readFile(join(root, snapshot.path, 'will-studio.config.json'), 'utf8'), studioConfig, 'Changing the live configuration never rewrites its existing snapshot.');
  const another = await createProjectSnapshot(root);
  assert.notEqual(another.id, snapshot.id);
  assert.equal((await listProjectSnapshots(root)).length, 2);
  await put('.studio/snapshots/bad/manifest.json', { format: 'will-studio-snapshot-v1', id: 'bad', createdAt: new Date().toISOString(), files: [{ path: '../../secret', bytes: 1, sha256: 'f'.repeat(64) }] });
  assert.equal((await listProjectSnapshots(root)).length, 2, 'Malformed snapshot paths must be ignored.');

  await runGit('init', '-b', 'main');
  await runGit('config', 'user.name', 'Studio Test');
  await runGit('config', 'user.email', 'studio-test@example.invalid');
  await runGit('add', 'src/content', '.pages.yml', 'IMAGE_CREDITS.md');
  await runGit('commit', '-m', 'Initial fixture');
  await runGit('remote', 'add', 'origin', 'https://user:SECRET@example.com/will/site.git?token=ALSO_SECRET');
  await runGit('mv', 'src/content/pages/about.json', 'src/content/pages/about renamed.json');
  await put('src/content/pages/books/favorites.json', { title: 'Changed draft', published: false });
  const overview = await getProjectOverview(root);
  assert.equal(overview.branch, 'main');
  assert.equal(overview.lastCommit.subject, 'Initial fixture');
  assert.equal(overview.remoteUrl, 'https://example.com/will/site.git');
  assert(overview.changedFiles.some((file) => file.status === 'R' && file.path === 'src/content/pages/about renamed.json'));
  assert(overview.changedFiles.some((file) => file.path === 'src/content/pages/books/favorites.json' && file.status === 'M'));
  assert.equal(overview.backups, 2);
  assert(!JSON.stringify(overview).includes('SECRET'));

  const damaged = await createProjectSnapshot(root);
  await writeFile(join(root, damaged.path, 'src/content/home/home.json'), 'changed outside Studio');
  assert.equal((await listProjectSnapshots(root)).length, 2, 'A snapshot with changed content is not offered as a valid backup.');
  await runGit('remote', 'set-url', 'origin', 'ssh://git:PRIVATE_PASSWORD@example.com/will/site.git');
  assert.equal((await getProjectOverview(root)).remoteUrl, 'ssh://example.com/will/site.git');

  await put('src/content/pages/broken.json', '{');
  await put('src/content/notes/missing-cover.md', '---\ntitle: Broken cover\npublished: true\ncover: /images/missing.png\n---\nText.\n');
  const broken = await getProjectOverview(root);
  assert(broken.checks.some((check) => check.label === 'Content files' && check.status === 'error' && check.detail.includes('broken.json')));
  assert(broken.checks.some((check) => check.label === 'Image library' && check.status === 'error' && check.detail.includes('missing.png')));

  await put('src/content/oversized.md', 'x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(exportContentBundle(root), /exceeds 2 MB/);
  await rm(join(root, 'src/content/oversized.md'));

  await writeFile(join(external, 'secret.json'), '{"secret":"outside-project"}');
  const linkPath = join(root, 'src/content/linked');
  await symlink(external, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(exportContentBundle(root), /Symbolic links are not allowed/);
  await assert.rejects(createProjectSnapshot(root), /Symbolic links are not allowed/);
  await rm(linkPath);
  const backupLinkRoot = await mkdtemp(join(tmpdir(), 'will-studio-backup-link-test-'));
  try {
    await symlink(external, join(backupLinkRoot, '.studio'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(createProjectSnapshot(backupLinkRoot), /Symbolic links are not allowed/);
  } finally {
    await rm(join(backupLinkRoot, '.studio'));
    await rm(backupLinkRoot, { recursive: true, force: true });
  }
  console.log('Project tools checks passed: overview, Git, nested export, configuration backups, immutable snapshots, malformed files, credentials, and symlink boundaries.');
} finally {
  // Both roots are fresh temporary fixtures created by this script.
  await rm(root, { recursive: true, force: true });
  await rm(external, { recursive: true, force: true });
}
