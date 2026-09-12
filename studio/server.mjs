import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertPlainData, containedPath, createStudioStore, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, StudioError } from './server-core.mjs';
import { createProjectSnapshot, exportContentBundle, getProjectOverview, listProjectSnapshots } from './project-tools.mjs';
import { createDocumentLifecycle } from './document-lifecycle.mjs';
import { loadProjectConfig } from './project-config.mjs';
import { searchContent } from './content-search.mjs';
import { defaultStudioProject, parseStudioArguments, STUDIO_HELP } from './cli.mjs';

const runtimeRoot = resolve(import.meta.dirname, '..');

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2' };

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readBody(request, limit) {
  const declared = Number(request.headers['content-length']);
  if (declared > limit) throw new StudioError(413, 'The uploaded content is too large.');
  const parts = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > limit) throw new StudioError(413, 'The uploaded content is too large.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function safeToken(candidate, token) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function validateBuild(root) {
  // Calling npm's JS entrypoint avoids cmd.exe quoting and shell injection on Windows.
  let npmEntry = process.env.npm_execpath;
  if (!npmEntry) {
    const bundledNpm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    try { await access(bundledNpm); npmEntry = bundledNpm; } catch { /* Use the installed npm command below. */ }
  }
  const command = npmEntry ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmEntry ? [npmEntry, 'run', 'build'] : ['run', 'build'];
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, shell: !npmEntry && process.platform === 'win32', env: { ...process.env, STUDIO_PREVIEW: '', NO_COLOR: '1' } });
    let output = '';
    let finished = false;
    let timedOut = false;
    const append = (chunk) => { output = (output + chunk.toString()).slice(-100_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveResult({ ok: code === 0 && !error && !timedOut, code, output: output + (error ? `\n${error.message}` : ''), timedOut });
    };
    child.once('error', (error) => finish(null, error));
    child.once('exit', (code) => finish(code));
  });
}

export async function startStudioServer({ root = runtimeRoot, port = 4310, astroPort = 4311, noAstro = false, schemas, projectConfig, editorRoot = runtimeRoot, launchpadUrl } = {}) {
  if (launchpadUrl !== undefined) {
    const destination = new URL(launchpadUrl);
    if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1' || destination.username || destination.password || destination.search || destination.hash || destination.pathname !== '/') throw new Error('The project chooser must be a loopback Studio address.');
    launchpadUrl = destination.origin;
  }
  const configuration = projectConfig ?? await loadProjectConfig(root);
  const store = await createStudioStore({ root, schemas });
  const normalizedRoot = process.platform === 'win32' ? store.root.toLowerCase() : store.root;
  const workspace = { ...configuration, id: createHash('sha256').update(normalizedRoot).digest('hex').slice(0, 24), originalProject: normalizedRoot === (process.platform === 'win32' ? runtimeRoot.toLowerCase() : runtimeRoot), ...(launchpadUrl ? { launchpadUrl } : {}) };
  const lifecycle = await createDocumentLifecycle(store, { siteUrl: configuration.project?.siteUrl });
  try {
    await access(join(editorRoot, 'studio/web/writer.js'));
    const { buildStudio } = await import('../scripts/build-studio.mjs');
    await buildStudio({ root: editorRoot });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const token = randomBytes(32).toString('hex');
  let previewReady = false;
  let previewError = '';
  let astroChild;
  let buildPromise;
  let stopping = false;
  let closingPromise;
  let effectivePort = port;
  let resolvePreview;
  const previewStarted = new Promise((resolveStarted) => { resolvePreview = resolveStarted; });

  function proxy(request, response, pathname) {
    if (noAstro || !previewReady) {
      json(response, 503, { error: previewError || 'The website preview is starting. Try again in a moment.' });
      return;
    }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: astroPort, path: pathname, method: request.method, headers: { accept: request.headers.accept ?? '*/*', 'accept-encoding': 'identity', host: `127.0.0.1:${astroPort}` } }, (source) => {
      const headers = { ...source.headers, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      delete headers['set-cookie'];
      // Keep regular navigation in the preview surface rather than replacing Studio.
      if (headers.location?.startsWith('/') && !headers.location.startsWith('/preview/')) headers.location = `/preview${headers.location}`;
      response.writeHead(source.statusCode ?? 502, headers);
      source.pipe(response);
    });
    upstream.setTimeout(30_000, () => upstream.destroy(new Error('Preview response timed out.')));
    upstream.on('error', () => { if (!response.headersSent) json(response, 502, { error: 'The website preview is unavailable. Restart Studio and try again.' }); else response.end(); });
    request.on('aborted', () => upstream.destroy());
    upstream.end();
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const hosts = new Set([`127.0.0.1:${effectivePort}`, `localhost:${effectivePort}`]);
      if (!hosts.has(request.headers.host)) throw new StudioError(403, 'Studio only accepts local browser requests.');
      const rawPath = request.url ?? '/';
      if (!rawPath.startsWith('/') || rawPath.startsWith('//') || /[\\\u0000-\u001f]/.test(rawPath)) throw new StudioError(400, 'Invalid request path.');
      let decoded;
      try { decoded = decodeURIComponent(rawPath.split('?')[0]); } catch { throw new StudioError(400, 'Invalid request path.'); }
      if (decoded.split('/').some((segment) => segment === '..' || segment === '.') || decoded.includes('\\') || decoded.includes('\0')) throw new StudioError(400, 'Invalid request path.');
      const url = new URL(rawPath, `http://${request.headers.host}`);
      const origin = `http://${request.headers.host}`;
      if (url.pathname.startsWith('/api/')) {
        if (request.headers['sec-fetch-site'] === 'cross-site') throw new StudioError(403, 'Open Studio directly in a local browser tab.');
        if (!['GET', 'HEAD'].includes(request.method)) {
          if (request.headers.origin !== origin || !safeToken(request.headers['x-studio-token'], token)) throw new StudioError(403, 'Your Studio session expired or this request came from another website. Reload Studio.');
        }
        if (request.method === 'GET' && url.pathname === '/api/state') {
          json(response, 200, { ...await store.exclusive(() => store.state()), workspace, token, preview: { ready: previewReady, error: previewError }, build: { running: Boolean(buildPromise) } });
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/search') {
          const query = url.searchParams.get('q') ?? '';
          if (query.length > 200) throw new StudioError(400, 'Search supports up to 200 characters.');
          json(response, 200, await store.exclusive(async () => searchContent({ ...await store.state(), query })));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/history') {
          json(response, 200, await store.history(url.searchParams.get('id')));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/project') {
          json(response, 200, await store.exclusive(() => getProjectOverview(store.root)));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/snapshots') {
          json(response, 200, await listProjectSnapshots(store.root));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/snapshot') {
          json(response, 201, await store.exclusive(() => createProjectSnapshot(store.root)));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/export') {
          const bundle = await store.exclusive(() => exportContentBundle(store.root));
          response.setHeader('Content-Disposition', `attachment; filename="will-studio-content-${new Date().toISOString().slice(0, 10)}.json"`);
          json(response, 200, bundle);
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/trash') {
          json(response, 200, await lifecycle.trash());
          return;
        }
        if (request.method === 'POST' && ['/api/lifecycle/plan', '/api/lifecycle/apply'].includes(url.pathname)) {
          if (buildPromise) throw new StudioError(409, 'Wait for the website check to finish before changing the page list.');
          if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw new StudioError(415, 'Send content as JSON.');
          let data;
          try { data = JSON.parse((await readBody(request, MAX_DOCUMENT_BYTES)).toString('utf8')); }
          catch (error) { if (error instanceof StudioError) throw error; throw new StudioError(400, 'Invalid JSON.'); }
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StudioError(400, 'Send a JSON object.');
          assertPlainData(data);
          json(response, 200, await lifecycle[url.pathname.endsWith('/plan') ? 'plan' : 'apply'](data));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/media') {
          if (buildPromise) throw new StudioError(409, 'Wait for the website check to finish before uploading an image.');
          let filename;
          try { filename = decodeURIComponent(request.headers['x-filename'] ?? 'image'); } catch { throw new StudioError(400, 'Invalid image filename.'); }
          const data = await readBody(request, MAX_IMAGE_BYTES);
          json(response, 201, await store.upload(data, filename));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/validate') {
          if (buildPromise) throw new StudioError(409, 'A website check is already running.');
          buildPromise = store.exclusive(() => validateBuild(store.root));
          try { json(response, 200, await buildPromise); } finally { buildPromise = undefined; }
          return;
        }
        if ((request.method === 'PUT' && url.pathname === '/api/document') || (request.method === 'POST' && ['/api/document', '/api/preview', '/api/restore'].includes(url.pathname))) {
          if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw new StudioError(415, 'Send content as JSON.');
          let data;
          try { data = JSON.parse((await readBody(request, MAX_DOCUMENT_BYTES)).toString('utf8')); } catch (error) { if (error instanceof StudioError) throw error; throw new StudioError(400, 'Invalid JSON.'); }
          const action = request.method === 'PUT' ? 'save' : { '/api/document': 'create', '/api/preview': 'preview', '/api/restore': 'restore' }[url.pathname];
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StudioError(400, 'Send a JSON object.');
          assertPlainData(data);
          if (buildPromise && action !== 'preview') throw new StudioError(409, 'Wait for the website check to finish before saving content.');
          const result = await store[action](data);
          if (action === 'preview' && !noAstro && !previewReady) {
            let timer;
            const ready = await Promise.race([previewStarted, new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 45_000); })]);
            clearTimeout(timer);
            if (!ready) throw new StudioError(503, previewError || 'The website preview is still starting. Try Preview again in a moment.');
          }
          json(response, action === 'create' ? 201 : 200, result);
          return;
        }
        throw new StudioError(404, 'Unknown Studio API endpoint.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new StudioError(405, 'Only reading website files is allowed.');
      const bridgeFiles = { '/__studio/bridge.js': 'preview-bridge.js', '/__studio/inline-session.mjs': 'inline-session.mjs' };
      if (Object.hasOwn(bridgeFiles, url.pathname)) {
        const contents = await readFile(await containedPath(editorRoot, `studio/${bridgeFiles[url.pathname]}`));
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : contents);
        return;
      }
      if (url.pathname === '/preview' || url.pathname.startsWith('/preview/')) {
        proxy(request, response, `${url.pathname.replace(/^\/preview/, '') || '/'}${url.search}`);
        return;
      }
      const file = url.pathname === '/' ? 'index.html' : decoded.replace(/^\//, '');
      // Only public Studio files are served directly. Astro handles website assets.
      if (file === 'index.html' || ['generated/writer.js', 'generated/writer.css'].includes(file) || (!file.includes('/') && ['.css', '.js', '.mjs', '.svg', '.woff2'].includes(extname(file)))) {
        let path;
        try { path = await containedPath(editorRoot, `studio/web/${file}`); }
        catch (error) { if (error.status === 404 && file !== 'index.html') { proxy(request, response, `${url.pathname}${url.search}`); return; } throw error; }
        const contents = await readFile(path);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : contents);
        return;
      }
      proxy(request, response, `${url.pathname}${url.search}`);
    } catch (error) {
      if (!response.headersSent) json(response, error.status ?? 500, { error: error.status ? error.message : 'Studio could not complete this operation.', details: error.details });
      else response.end();
      if (!error.status) console.error(error);
    }
  });
  server.requestTimeout = 190_000;
  server.headersTimeout = 15_000;
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveReady(); });
  });
  effectivePort = server.address().port;
  if (!noAstro) {
    astroChild = fork(join(import.meta.dirname, 'astro-preview.mjs'), [], {
      cwd: store.root, windowsHide: true,
      env: { ...process.env, STUDIO_PREVIEW: '1', STUDIO_ASTRO_PORT: String(astroPort), ASTRO_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let logs = '';
    for (const stream of [astroChild.stdout, astroChild.stderr]) stream.on('data', (chunk) => { logs = (logs + chunk.toString()).slice(-5_000); process.stdout.write(chunk); });
    astroChild.on('message', (message) => { if (message.type === 'ready') { previewReady = true; previewError = ''; resolvePreview(true); } });
    astroChild.once('error', (error) => { previewError = `Preview could not start: ${error.message}`; resolvePreview(false); });
    astroChild.once('exit', (code) => {
      previewReady = false;
      if (!stopping) previewError = `Preview stopped (code ${code}). ${logs.slice(-700)}`;
      resolvePreview(false);
    });
  }

  return {
    server, store, token, port: effectivePort,
    url: `http://127.0.0.1:${effectivePort}`,
    ready: noAstro ? Promise.resolve(true) : previewStarted,
    previewStatus: () => ({ ready: noAstro || previewReady, error: previewError }),
    close() {
      return closingPromise ??= (async () => {
        stopping = true;
        resolvePreview(false);
        if (astroChild && astroChild.exitCode === null) {
          if (astroChild.connected) astroChild.disconnect();
          const child = astroChild;
          await new Promise((resolveExit) => {
            const timer = setTimeout(() => { child.kill(); resolveExit(); }, 5_000);
            child.once('exit', () => { clearTimeout(timer); resolveExit(); });
          });
        }
        server.closeAllConnections();
        await new Promise((resolveClosed) => server.close(resolveClosed));
      })();
    }
  };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const args = process.argv.slice(2);
  try {
    const options = parseStudioArguments(args, { defaultProject: await defaultStudioProject(runtimeRoot) });
    if (options.help) { console.log(STUDIO_HELP); process.exit(0); }
    const studio = options.root ? await startStudioServer(options)
      : await (await import('./launchpad.mjs')).startLaunchpad({ runtimeRoot, port: options.port, startWorkspace: startStudioServer });
    console.log(`\nWill Studio is ready at ${studio.url}\nKeep this terminal open while editing. Press Ctrl+C to stop.\n`);
    if (options.open) {
      const browser = process.platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${studio.url}' -WindowStyle Hidden`], { windowsHide: true, stdio: 'ignore' })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [studio.url], { stdio: 'ignore' });
      browser.once('error', () => console.log(`Open ${studio.url} in your browser.`));
      browser.unref();
    }
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await studio.close(); process.exit(0); };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? 'The selected port is already in use. Keep the existing service running and choose another port with --port.' : error.message);
    process.exitCode = 1;
  }
}
