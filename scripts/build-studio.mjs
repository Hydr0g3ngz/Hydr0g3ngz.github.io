import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Build only the local editor; the public Astro site never imports these files. */
export async function buildStudio({ root = resolve(fileURLToPath(new URL('..', import.meta.url))) } = {}) {
  return build({
    absWorkingDir: root,
    entryPoints: [join(root, 'studio/web/writer.js'), join(root, 'studio/web/writer.css')],
    outdir: join(root, 'studio/web/generated'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120', 'firefox120', 'safari17'],
    minify: true,
    legalComments: 'eof',
    logLevel: 'warning'
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildStudio();
  console.log('Local Studio writer built.');
}
