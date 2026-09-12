import { defineConfig } from 'astro/config';
import studio from './src/studio-adapter/integration.mjs';
import { redirectMap } from './scripts/redirects.mjs';
import redirects from './src/redirects.json' with { type: 'json' };

// This starter has no public origin until you choose a hosting destination.
export default defineConfig({
  integrations: [studio()],
  redirects: redirectMap(redirects),
  output: 'static'
});
