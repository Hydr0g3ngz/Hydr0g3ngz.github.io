import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// The website owns its Astro version and build configuration, not the editor.
const require = createRequire(pathToFileURL(join(process.cwd(), 'package.json')));
const { dev } = await import(pathToFileURL(require.resolve('astro')).href);

const port = Number(process.env.STUDIO_ASTRO_PORT ?? 4311);
const server = await dev({
  root: process.cwd(),
  server: { host: '127.0.0.1', port },
  devToolbar: { enabled: false },
  vite: { server: { strictPort: true, ws: { host: '127.0.0.1', clientPort: port }, watch: { ignored: ['**/.studio/**', '**/output/**'] } } }
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('disconnect', shutdown);
if (process.send) process.send({ type: 'ready', port: server.address.port });
