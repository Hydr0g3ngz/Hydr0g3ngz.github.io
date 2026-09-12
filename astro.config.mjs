import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import studio from './studio/integration.mjs';

export default defineConfig({
  site: 'https://hydr0g3ngz.github.io',
  integrations: [sitemap(), studio()],
  output: 'static'
});
