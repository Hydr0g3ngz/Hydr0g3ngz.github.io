import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://hydr0g3ngz.github.io',
  integrations: [sitemap()],
  output: 'static'
});
