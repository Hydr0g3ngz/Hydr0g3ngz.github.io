import { dev } from 'astro';

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
