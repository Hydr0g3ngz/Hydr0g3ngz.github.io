import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { assertCompatibleProject, loadProjectConfig } from './project-config.mjs';
import { assertPlainData, atomicWrite, containedPath, revisionOf, StudioError } from './server-core.mjs';

const REGISTRY = '.studio/projects.json';
const REGISTRY_LIMIT = 2 * 1024 * 1024;
const MAX_RECENT = 20;
const MAX_ACTIVE = 3;
const MAX_PORT_PAIRS = 100;
const TICKET_LIFETIME = 5 * 60_000;
const ticketPattern = /^[a-f0-9]{24}$/;
const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path;
const projectId = path => createHash('sha256').update(normalize(path)).digest('hex').slice(0, 24);
const registryWarning = 'Recent-project storage could not be read safely. Its existing contents were left unchanged; projects can still be opened temporarily.';

async function canonicalDirectory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new StudioError(400, 'Use an absolute local directory path.');
  const selected = resolve(value);
  let cursor = parse(selected).root;
  for (const part of ['', ...relative(cursor, selected).split(sep).filter(Boolean)]) {
    if (part) cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new StudioError(422, 'Choose a real directory without symbolic links or directory junctions in its path.');
  }
  return realpath(selected);
}

async function readBounded(root, suffix, limit, { optional = false } = {}) {
  const file = await containedPath(root, suffix, { allowMissing: optional });
  let handle;
  try { handle = await open(file, 'r'); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new StudioError(422, `${suffix} must be a regular file no larger than ${limit} bytes.`);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new StudioError(422, `${suffix} is too large.`);
    return bytes.toString('utf8', 0, length);
  } finally { await handle.close(); }
}

function exactKeys(value, keys, label) {
  assertPlainData(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new StudioError(400, `Invalid ${label} fields.`);
}

function validateRecord(record) {
  exactKeys(record, ['id', 'name', 'path', 'siteUrl', 'lastOpenedAt', 'port', 'astroPort'], 'recent-project');
  if (typeof record.path !== 'string' || !isAbsolute(record.path) || record.path.length > 4096 || /[\u0000-\u001f\u007f]/.test(record.path) || resolve(record.path) !== record.path || record.id !== projectId(record.path)) throw new Error('Invalid recent-project path or identity.');
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 100 || /[\u0000-\u001f\u007f]/.test(record.name)) throw new Error('Invalid recent-project name.');
  if (typeof record.lastOpenedAt !== 'string' || record.lastOpenedAt.length > 40 || !Number.isFinite(Date.parse(record.lastOpenedAt))) throw new Error('Invalid recent-project date.');
  if (!Number.isInteger(record.port) || record.port < 1024 || record.port > 65534 || record.astroPort !== record.port + 1) throw new Error('Invalid saved workspace ports.');
  if (record.siteUrl !== undefined) {
    const site = new URL(record.siteUrl);
    if (typeof record.siteUrl !== 'string' || record.siteUrl.length > 2048 || !record.siteUrl.startsWith('https://') || site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || /[\\\u0000-\u0020]/.test(record.siteUrl)) throw new Error('Invalid recent-project site URL.');
  }
  return record;
}

async function readRegistry(root) {
  try {
    const raw = await readBounded(root, REGISTRY, REGISTRY_LIMIT, { optional: true });
    if (raw === null) return { raw, entries: [], warnings: [], writable: true };
    const value = JSON.parse(raw);
    exactKeys(value, ['version', 'projects'], 'registry');
    if (value.version !== 1 || !Array.isArray(value.projects) || value.projects.length > MAX_RECENT) throw new Error('Unsupported registry.');
    const entries = value.projects.map(validateRecord);
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate recent projects.');
    return { raw, entries, warnings: [], writable: true };
  } catch { return { raw: null, entries: [], warnings: [registryWarning], writable: false }; }
}

async function inspectCandidate(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) throw new StudioError(400, 'Use an absolute local project directory path.');
  const selected = resolve(path);
  let project = { id: projectId(selected), name: 'Unverified project', path: selected };
  const checks = [];
  let root, configuration;
  try {
    ({ root } = await assertCompatibleProject(selected));
    configuration = await loadProjectConfig(root);
    project = { id: projectId(root), name: configuration.project.name, path: root, ...(configuration.project.siteUrl ? { siteUrl: configuration.project.siteUrl } : {}) };
    checks.push({ label: 'Project contract', status: 'pass', detail: `Compatible ${configuration.adapter} project. No project code has been executed.` });
    for (const warning of configuration.warnings ?? []) checks.push({ label: 'Project metadata', status: 'warning', detail: warning });
  } catch (error) {
    checks.push({ label: 'Project contract', status: 'error', detail: error.message });
    return { project, checks, ready: false };
  }
  const fingerprints = { configuration, root: normalize(root) };
  const checked = async (suffix, label, limit = 4 * 1024 * 1024, optional = false) => {
    try {
      const raw = await readBounded(root, suffix, limit, { optional });
      fingerprints[suffix] = raw === null ? null : revisionOf(raw);
      return raw;
    } catch (error) { checks.push({ label, status: 'error', detail: `${suffix}: ${error.message}` }); return undefined; }
  };
  const requiredTrustFiles = ['package.json', 'astro.config.mjs', 'src/content-schema.ts', '.pages.yml'];
  for (const suffix of requiredTrustFiles) await checked(suffix, 'Trusted project files');
  await checked('will-studio.config.json', 'Project metadata', 32 * 1024, true);
  await checked('package-lock.json', 'Website dependencies', 8 * 1024 * 1024, true);
  const adapterResults = [];
  for (const suffix of ['src/studio-adapter/integration.mjs', 'src/studio-adapter/preview.astro']) adapterResults.push(await checked(suffix, 'Preview adapter'));
  if (adapterResults.every(value => value !== undefined)) checks.push({ label: 'Preview adapter', status: 'pass', detail: 'The website owns both required preview-adapter files.' });
  const astroPackage = await checked('node_modules/astro/package.json', 'Website dependencies', 1024 * 1024);
  if (astroPackage === undefined) checks.push({ label: 'Website dependency setup', status: 'error', detail: 'Install the website’s own dependencies separately, then inspect again. Launchpad never installs packages during inspection.' });
  if (astroPackage !== undefined) {
    try {
      const manifest = JSON.parse(astroPackage);
      // Read package metadata only. Never import Astro or a selected schema here.
      const entry = manifest.exports?.['.'] ?? manifest.main;
      if (manifest.name !== 'astro' || typeof entry !== 'string' || !entry.startsWith('./') || /[\\%?#]/.test(entry) || entry.split('/').slice(1).some(part => !part || part === '.' || part === '..')) throw new Error('Cannot verify the installed Astro entry point.');
      const source = await checked(`node_modules/astro/${entry.slice(2)}`, 'Website dependencies', 8 * 1024 * 1024);
      if (source !== undefined) checks.push({ label: 'Website dependencies', status: 'pass', detail: 'This website has its own readable Astro installation. No dependencies were installed or executed.' });
    } catch (error) { checks.push({ label: 'Website dependencies', status: 'error', detail: `${error.message} Install the website’s own dependencies separately, then inspect again.` }); }
  }
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The selected directory changed while it was being inspected.');
    fingerprints.directoryIdentity = { dev: info.dev, ino: info.ino };
  } catch { checks.push({ label: 'Project directory', status: 'error', detail: 'The selected directory changed or became unreadable. Choose the real local directory and inspect it again.' }); }
  const ready = !checks.some(check => check.status === 'error');
  return { project, checks, ready, fingerprint: revisionOf(JSON.stringify(fingerprints)) };
}

async function portIsFree(port) {
  for (const host of ['127.0.0.1', '::1']) {
    const available = await new Promise(resolveProbe => {
      const server = createPortProbe();
      server.once('error', error => resolveProbe(host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)));
      server.listen({ host, port, exclusive: true }, () => server.close(() => resolveProbe(true)));
    });
    if (!available) return false;
  }
  return true;
}

/** Bounded candidates only; allocation must still probe both ports before use. */
export function workspacePortCandidates(basePort, preferred) {
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65535) throw new RangeError('Invalid bound Launchpad port.');
  const pairs = [], seen = new Set();
  const append = port => {
    if (!Number.isInteger(port) || port < 1024 || port > 65534 || seen.has(port)) return;
    seen.add(port); pairs.push({ port, astroPort: port + 1 });
  };
  if (preferred && preferred.astroPort === preferred.port + 1) append(preferred.port);
  // An explicitly high port, or an OS-assigned ephemeral port near 65535, may
  // have no room above it. Wrap into the non-privileged range rather than making
  // that otherwise valid Launchpad incapable of opening its first workspace.
  for (let candidate = basePort + 2; pairs.length < MAX_PORT_PAIRS; candidate += 2) {
    if (candidate > 65534) candidate = 1024;
    append(candidate);
  }
  return pairs;
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new StudioError(415, 'Send the request as JSON.');
  if (Number(request.headers['content-length']) > 16 * 1024) { request.resume(); throw new StudioError(413, 'The request is too large.'); }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 16 * 1024) throw new StudioError(413, 'The request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new StudioError(400, 'Send a valid JSON object.'); }
}

/** Browser project picker. Inspection is read-only; project execution needs a ticket and explicit trust. */
export async function startLaunchpad({ runtimeRoot, port = 4310, startWorkspace, now = Date.now, startupTimeoutMs = 45_000 } = {}) {
  if (typeof startWorkspace !== 'function') throw new Error('A workspace starter must be supplied.');
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) throw new Error('Choose a Launchpad port between 1024 and 65535, or 0 for an available port.');
  const runtime = await canonicalDirectory(runtimeRoot);
  const token = randomBytes(32).toString('hex');
  const tickets = new Map(), active = new Map(), sessionRecent = new Map(), forgotten = new Set();
  const closingHandles = new WeakMap(), ownedHandles = new Set();
  let effectivePort, url, closing = false, queue = Promise.resolve(), closePromise;
  let signalClosing;
  const closingSignal = new Promise(resolveClosing => { signalClosing = resolveClosing; });
  const locked = work => {
    const next = queue.then(() => { if (closing) throw new StudioError(503, 'Launchpad is closing.'); return work(); });
    queue = next.catch(() => {});
    return next;
  };
  const closeWorkspace = async workspace => {
    if (!workspace || typeof workspace !== 'object') return;
    if (closingHandles.has(workspace)) return closingHandles.get(workspace);
    const cleanup = (async () => {
      try { await workspace.close(); }
      catch (error) {
        if (workspace.server?.listening) await new Promise(resolveClose => { workspace.server.close(resolveClose); workspace.server.closeAllConnections?.(); });
        throw error;
      }
    })();
    closingHandles.set(workspace, cleanup);
    return cleanup;
  };
  const waitStartup = async promise => {
    let timer;
    try {
      return await Promise.race([promise, closingSignal.then(() => { throw new StudioError(503, 'Launchpad is closing.'); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new StudioError(504, 'The workspace did not become ready in time. Its owned server was stopped; inspect and try again.')), startupTimeoutMs); })]);
    } finally { clearTimeout(timer); }
  };
  const prune = () => { for (const [id, ticket] of tickets) if (ticket.expiresAt <= now()) tickets.delete(id); };
  const live = id => {
    const value = active.get(id);
    if (value && value.workspace.server?.listening === false) {
      active.delete(id);
      closeWorkspace(value.workspace).catch(() => {});
      return undefined;
    }
    return value;
  };
  const mergeRecent = entries => {
    const merged = new Map(entries.map(entry => [entry.id, entry]));
    for (const entry of sessionRecent.values()) if (!merged.has(entry.id) || Date.parse(entry.lastOpenedAt) >= Date.parse(merged.get(entry.id).lastOpenedAt)) merged.set(entry.id, entry);
    return [...merged.values()].filter(entry => !forgotten.has(entry.id)).sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt)).slice(0, MAX_RECENT);
  };
  const state = async (extraWarnings = []) => {
    const registry = await readRegistry(runtime);
    const recent = mergeRecent(registry.entries).map(entry => {
      const workspace = live(entry.id);
      const project = { id: entry.id, name: entry.name, path: entry.path, lastOpenedAt: entry.lastOpenedAt, ...(entry.siteUrl ? { siteUrl: entry.siteUrl } : {}) };
      return { ...project, running: Boolean(workspace), ...(workspace ? { url: workspace.url } : {}) };
    });
    return { token, recent, warnings: [...new Set([...registry.warnings, ...extraWarnings])] };
  };
  const saveRecent = async registry => {
    if (!registry.writable) return registry.warnings;
    const contents = `${JSON.stringify({ version: 1, projects: mergeRecent(registry.entries) }, null, 2)}\n`;
    if (Buffer.byteLength(contents) > REGISTRY_LIMIT) return ['Recent-project storage is full. This project is open temporarily; existing registry contents were kept.'];
    try {
      await atomicWrite(runtime, REGISTRY, contents, registry.raw === null ? { create: true } : { expectedRevision: revisionOf(registry.raw) });
      return [];
    } catch { return ['The recent-project list could not be updated safely. Existing registry contents were kept; this session can continue temporarily.']; }
  };
  const recordOpen = async (project, pair) => {
    const registry = await readRegistry(runtime);
    forgotten.delete(project.id);
    sessionRecent.set(project.id, { ...project, lastOpenedAt: new Date(now()).toISOString(), port: pair.port, astroPort: pair.astroPort });
    return saveRecent(registry);
  };
  const allocatePorts = async preferred => {
    const pairs = workspacePortCandidates(effectivePort, preferred);
    const ownedPorts = new Set([effectivePort, ...[...active.values()].flatMap(value => [value.port, value.astroPort])]);
    for (const pair of pairs) {
      if (ownedPorts.has(pair.port) || ownedPorts.has(pair.astroPort)) continue;
      if (await portIsFree(pair.port) && await portIsFree(pair.astroPort)) return pair;
    }
    throw new StudioError(409, 'No free workspace port pair is available. Existing applications were not stopped.');
  };
  const openTicket = async data => {
    exactKeys(data, ['ticket', 'trustProject'], 'open request');
    if (data.trustProject !== true) throw new StudioError(400, 'Confirm that you trust this project before opening it.');
    if (typeof data.ticket !== 'string' || !ticketPattern.test(data.ticket)) throw new StudioError(400, 'Inspect the project first to obtain an opening ticket.');
    prune();
    const ticket = tickets.get(data.ticket);
    if (!ticket) throw new StudioError(409, 'This inspection ticket expired or was already used. Inspect the project again.');
    tickets.delete(data.ticket);
    const current = await inspectCandidate(ticket.project.path);
    if (!current.ready || current.project.id !== ticket.project.id || current.fingerprint !== ticket.fingerprint) throw new StudioError(409, 'The project changed after inspection. Review it again before running project code.');
    const existing = live(current.project.id);
    if (existing) return { url: existing.url, project: current.project, warnings: await recordOpen(current.project, existing) };
    for (const id of active.keys()) live(id);
    if (active.size >= MAX_ACTIVE) throw new StudioError(409, 'Three workspaces are already open. Save your work, stop this Launchpad with Ctrl+C, then restart to open different projects. Closing browser tabs does not stop servers.');
    const registry = await readRegistry(runtime);
    const preferred = sessionRecent.get(current.project.id) ?? registry.entries.find(entry => entry.id === current.project.id);
    const pair = await allocatePorts(preferred);
    if (closing) throw new StudioError(503, 'Launchpad is closing.');
    let workspace, cancelled = false;
    const started = Promise.resolve().then(() => startWorkspace({ root: current.project.path, ...pair, launchpadUrl: url }));
    // A starter resolving after timeout/shutdown still gives us an owned handle
    // to close; it must never become an orphaned server.
    started.then(value => {
      if (value && typeof value === 'object') ownedHandles.add(value);
      if (cancelled || closing) closeWorkspace(value).catch(() => {});
    }).catch(() => {});
    try {
      workspace = await waitStartup(started);
      if (!workspace || typeof workspace.close !== 'function' || !workspace.ready || typeof workspace.ready.then !== 'function' || workspace.port !== pair.port) throw new StudioError(502, 'The workspace starter returned an invalid server handle.');
      if (!(await waitStartup(workspace.ready))) throw new StudioError(502, workspace.previewStatus?.().error || 'The website preview could not start. Check the project and try again.');
      if (workspace.server?.listening !== true) throw new StudioError(502, 'The workspace server stopped before it was ready. Inspect the project and try again.');
      if (closing) throw new StudioError(503, 'Launchpad is closing.');
      const workspaceUrl = `http://127.0.0.1:${pair.port}`;
      active.set(current.project.id, { workspace, url: workspaceUrl, ...pair });
      return { url: workspaceUrl, project: current.project, warnings: await recordOpen(current.project, pair) };
    } catch (error) {
      cancelled = true;
      active.delete(current.project.id);
      if (workspace) await closeWorkspace(workspace).catch(() => {});
      if (error.code === 'EADDRINUSE') throw new StudioError(409, 'A workspace port was taken by another application during startup. No existing application was stopped. Inspect the project and try again.');
      throw error;
    }
  };

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (closing) throw new StudioError(503, 'Launchpad is closing.');
      const host = request.headers.host;
      if (![ `127.0.0.1:${effectivePort}`, `localhost:${effectivePort}` ].includes(host)) throw new StudioError(403, 'This Launchpad session is unavailable. Open its local address and reload.');
      const origin = `http://${host}`;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== origin)) throw new StudioError(403, 'This Launchpad session expired or came from another website. Reload Launchpad.');
      const raw = request.url ?? '/';
      let decoded;
      try { decoded = decodeURIComponent(raw.split('?')[0]); } catch { throw new StudioError(400, 'Invalid request path.'); }
      if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) throw new StudioError(400, 'Invalid request path.');
      const path = new URL(raw, origin).pathname;
      if (path.startsWith('/api/')) {
        if (request.method === 'POST') {
          const candidate = request.headers['x-studio-token'];
          if (request.headers.origin !== origin || typeof candidate !== 'string' || Buffer.byteLength(candidate) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) throw new StudioError(403, 'This Launchpad session expired or came from another website. Reload Launchpad.');
          const body = await readBody(request);
          if (path === '/api/launchpad/inspect') {
            exactKeys(body, ['path'], 'inspect request');
            const result = await inspectCandidate(body.path);
            const { fingerprint, ...visible } = result;
            if (result.ready) {
              prune();
              if (tickets.size >= 50) tickets.delete(tickets.keys().next().value);
              const ticket = randomBytes(12).toString('hex');
              tickets.set(ticket, { project: result.project, fingerprint, expiresAt: now() + TICKET_LIFETIME });
              visible.ticket = ticket;
            }
            send(response, 200, visible); return;
          }
          if (path === '/api/launchpad/open') { send(response, 200, await locked(() => openTicket(body))); return; }
          if (path === '/api/launchpad/forget') {
            exactKeys(body, ['id'], 'forget request');
            if (typeof body.id !== 'string' || !ticketPattern.test(body.id)) throw new StudioError(400, 'Choose a valid recent project.');
            const result = await locked(async () => {
              const registry = await readRegistry(runtime);
              sessionRecent.delete(body.id); forgotten.add(body.id);
              return state(await saveRecent(registry));
            });
            send(response, 200, result); return;
          }
        } else if (request.method === 'GET' && path === '/api/launchpad/state') { send(response, 200, await state()); return; }
        throw new StudioError(404, 'Unknown Launchpad API endpoint.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new StudioError(405, 'Only reading Launchpad files is allowed.');
      if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const allowed = { '/': ['launchpad.html', 'text/html'], '/launchpad.html': ['launchpad.html', 'text/html'], '/launchpad.js': ['launchpad.js', 'text/javascript'], '/launchpad.css': ['launchpad.css', 'text/css'] }[path];
      if (!allowed) throw new StudioError(404, 'Unknown Launchpad file.');
      const contents = await readBounded(runtime, `studio/web/${allowed[0]}`, 2 * 1024 * 1024);
      response.writeHead(200, { 'Content-Type': `${allowed[1]}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (!response.headersSent) send(response, error.status ?? 500, { error: error.status ? error.message : 'Launchpad could not complete this operation. Inspect the project and try again.' });
      else response.end();
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 100_000;
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); }); });
  effectivePort = server.address().port;
  url = `http://127.0.0.1:${effectivePort}`;
  const close = () => {
    if (closePromise) return closePromise;
    closing = true; tickets.clear(); signalClosing();
    closePromise = (async () => {
      const stopped = new Promise(resolveStopped => { server.close(resolveStopped); server.closeIdleConnections?.(); });
      await queue;
      await Promise.allSettled([...ownedHandles].map(closeWorkspace));
      active.clear(); server.closeAllConnections?.(); await stopped;
    })();
    return closePromise;
  };
  return { url, port: effectivePort, server, close };
}
