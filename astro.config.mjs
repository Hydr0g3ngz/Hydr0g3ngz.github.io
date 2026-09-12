import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import studio from './studio/integration.mjs';
import { redirectMap } from './scripts/redirects.mjs';
import redirects from './src/redirects.json' with { type: 'json' };

export default defineConfig({
  site: 'https://hydr0g3ngz.github.io',
  integrations: [sitemap(), studio()],
  redirects: redirectMap(redirects),
  output: 'static'
});
