import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultStudioProject, parseStudioArguments, studioServerArguments, STUDIO_HELP } from '../studio/cli.mjs';

const STAMP_VERSION = 1;
const execFileAsync = promisify(execFile);
const DEVELOPMENT_PORTS = [4310, 4311, 4321];
// These need executable entry points, not just a surviving node_modules folder.
export const REQUIRED_MODULES = [
  'astro', '@astrojs/sitemap', '@astrojs/check', 'marked', 'sanitize-html',
  'typescript', 'esbuild', 'js-yaml', '@tiptap/core', '@tiptap/markdown',
  '@tiptap/starter-kit', '@tiptap/extension-image', '@tiptap/extension-link',
  '@tiptap/extension-placeholder', '@tiptap/extension-code-block',
  '@tiptap/extension-paragraph', 'dompurify', 'jsdom'
];

export function supportsNode(version) {
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) && Number(version.split('.')[0]) >= 24;
}

export function dependencyFingerprint({ manifest, lockfile, nodeVersion = process.versions.node, platform = process.platform, arch = process.arch }) {
  return createHash('sha256').update(JSON.stringify({
    version: STAMP_VERSION,
    manifest,
    lockfile,
    nodeMajor: nodeVersion.split('.')[0],
    platform,
    arch
  })).digest('hex');
}

export function dependencyDecision({ fingerprint, stamp, missingModules = [] }) {
  if (missingModules.length) return { installNeeded: true, reason: `Missing or incomplete dependencies: ${missingModules.join(', ')}.` };
  if (!stamp || stamp.version !== STAMP_VERSION || typeof stamp.fingerprint !== 'string') {
    return { installNeeded: true, reason: 'This installation has not yet been verified by the Studio launcher.' };
  }
  if (stamp.fingerprint !== fingerprint) return { installNeeded: true, reason: 'Project dependencies or the Node.js environment have changed.' };
  return { installNeeded: false, reason: 'Dependencies are current; no installation or network check is needed.' };
}

export function missingRequiredModules(root, modules = REQUIRED_MODULES) {
  const require = createRequire(pathToFileURL(join(root, 'package.json')));
  const modulesDirectory = join(root, 'node_modules');
  return modules.filter(name => {
    try {
      const location = relative(modulesDirectory, require.resolve(name));
      // Never mistake a package installed in a parent folder for this project.
      return location === '..' || location.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(location);
    } catch {
      return true;
    }
  });
}

export async function freshMissingRequiredModules(root, modules = REQUIRED_MODULES) {
  // Node caches package metadata and failed resolutions. npm ci replaces files,
  // so a second createRequire in this process is NOT a fresh installation check.
  const { stdout } = await execFileAsync(process.execPath, [
    fileURLToPath(import.meta.url), '--probe-modules', resolve(root), JSON.stringify(modules)
  ], { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 });
  const missing = JSON.parse(stdout);
  if (!Array.isArray(missing) || missing.some(name => typeof name !== 'string')) throw new Error('The isolated dependency check returned an invalid result.');
  return missing;
}

export function isProjectPreviewProcess(root, processInfo, platform = process.platform) {
  if (Number(processInfo.pid) === process.pid || !processInfo.commandLine) return false;
  const normalize = text => platform === 'win32' ? text.replaceAll('\\', '/').toLowerCase() : text;
  const commandLine = normalize(processInfo.commandLine);
  const prefix = `${normalize(resolve(root)).replace(/\/$/, '')}/`;
  // Match the complete checkout path, not unrelated Node processes or another
  // project with a similar name. Relative commands are covered by port checks.
  return commandLine.includes(prefix) && /(?:studio\/(?:server|astro-preview)\.mjs|node_modules\/(?:astro|@astrojs)\/)/.test(commandLine);
}

async function listNodeProcesses() {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}}) | ConvertTo-Json -Compress"
    ], { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    const entries = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(entries) ? entries : [entries];
  }
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    return match && /(?:^|\/)node(?:\s|$)/.test(match[2]) ? [{ pid: Number(match[1]), commandLine: match[2] }] : [];
  });
}

export function isPortActive(port, host = '127.0.0.1') {
  return new Promise(resolvePort => {
    const socket = createConnection({ host, port });
    const finish = active => { socket.destroy(); resolvePort(active); };
    socket.setTimeout(600);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

export async function assertNoRunningPreview(root, { listProcesses = listNodeProcesses, portActive = isPortActive, ports = DEVELOPMENT_PORTS } = {}) {
  let processes;
  try {
    processes = await listProcesses();
  } catch (error) {
    // If process inspection is unavailable, fail safely instead of replacing a
    // potentially loaded native compiler DLL and leaving a partial install.
    throw new Error('Cannot verify whether Studio or Astro is still running. Close its terminals, ensure process inspection is available, and retry. No dependencies were changed.', { cause: error });
  }
  const projectProcesses = processes.filter(entry => isProjectPreviewProcess(root, entry));
  const occupiedPorts = (await Promise.all(ports.map(async port => {
    const active = await Promise.all([portActive(port, '127.0.0.1'), portActive(port, '::1')]);
    return active.some(Boolean) ? port : null;
  }))).filter(port => port !== null);
  if (!projectProcesses.length && !occupiedPorts.length) return;
  const details = [
    projectProcesses.length ? `project Studio/Astro process IDs ${projectProcesses.map(entry => entry.pid).join(', ')}` : '',
    occupiedPorts.length ? `local development ports ${occupiedPorts.join(', ')} in use` : ''
  ].filter(Boolean).join('; ');
  throw new Error(`Studio cannot start safely while ${details}. Close the existing Studio/Astro terminals with Ctrl+C and retry. If a listed port belongs to another app, close that app yourself first. No processes were stopped and no dependencies were changed.`);
}

async function readJsonFile(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${label}. Restore the complete project checkout before opening Studio.`, { cause: error });
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  } catch (error) {
    throw new Error(`${label} is not valid JSON. Restore or repair it before opening Studio.`, { cause: error });
  }
  return text;
}

export async function inspectDependencies(root, environment = {}) {
  const nodeVersion = environment.nodeVersion ?? process.versions.node;
  if (!supportsNode(nodeVersion)) throw new Error(`Studio requires Node.js 24 or newer; this terminal is using ${nodeVersion}. Update Node.js, then reopen Studio.`);
  const [manifest, lockfile] = await Promise.all([
    readJsonFile(join(root, 'package.json'), 'package.json'),
    readJsonFile(join(root, 'package-lock.json'), 'package-lock.json')
  ]);
  const fingerprint = dependencyFingerprint({ manifest, lockfile, ...environment, nodeVersion });
  const stampPath = join(root, 'node_modules', '.studio-deps.json');
  let stamp = null;
  try {
    stamp = JSON.parse(await readFile(stampPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw new Error('Cannot read the Studio dependency fingerprint. Check this project folder’s permissions.', { cause: error });
  }
  const missingModules = await freshMissingRequiredModules(root);
  return { fingerprint, stampPath, missingModules, ...dependencyDecision({ fingerprint, stamp, missingModules }) };
}

function run(command, args, root) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(signal ? `Process stopped by ${signal}.` : `Process exited with code ${code ?? 'unknown'}.`));
    });
  });
}

export async function installDependencies(root) {
  // npm.cmd needs cmd.exe on Windows. The command is fixed, never constructed
  // from user content or paths; cwd handles directories containing spaces.
  if (process.platform === 'win32') await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --include=dev'], root);
  else await run('npm', ['ci', '--include=dev'], root);
}

export async function ensureDependencies(root, { inspect = inspectDependencies, install = installDependencies, save = writeFile, log = console.log, assertIdle = assertNoRunningPreview } = {}) {
  const before = await inspect(root);
  log(before.reason);
  if (!before.installNeeded) return false;
  await assertIdle(root);
  log('Installing the exact locked dependencies (this may need an internet connection)…');
  try {
    await install(root);
  } catch (error) {
    throw new Error('Dependency installation failed. Check the npm error above and your connection, then run Start Studio again. Studio was not started.', { cause: error });
  }
  const after = await inspect(root);
  if (after.fingerprint !== before.fingerprint) throw new Error('Project dependency files changed during installation. Run Start Studio again to verify the updated files.');
  if (after.missingModules.length) throw new Error(`Installation finished but required modules are still unavailable: ${after.missingModules.join(', ')}. Studio was not started.`);
  await save(after.stampPath, `${JSON.stringify({ version: STAMP_VERSION, fingerprint: after.fingerprint }, null, 2)}\n`, 'utf8');
  log('Dependencies verified. Future launches will skip installation until dependencies change.');
  return true;
}

async function main() {
  if (process.argv[2] === '--probe-modules') {
    console.log(JSON.stringify(missingRequiredModules(resolve(process.argv[3]), JSON.parse(process.argv[4]))));
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.includes('--help')) { console.log(STUDIO_HELP); return; }
  // Useful diagnostics: this mode never installs, writes files, or starts Studio.
  if (process.argv.includes('--check')) {
    const result = await inspectDependencies(root);
    console.log(JSON.stringify({ installNeeded: result.installNeeded, reason: result.reason, missingModules: result.missingModules }, null, 2));
    return;
  }
  const defaultProject = await defaultStudioProject(root);
  const options = parseStudioArguments(process.argv.slice(2), { defaultProject, defaultOpen: true });
  const guard = candidate => assertNoRunningPreview(candidate, { ports: options.root ? [options.port, options.astroPort] : [options.port] });
  const installed = await ensureDependencies(root, { assertIdle: guard });
  if (!installed) await guard(root);
  const args = studioServerArguments(options, join(root, 'studio', 'server.mjs'));
  await run(process.execPath, args, root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`\nStudio could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
