import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  homeSchema,
  noteSchema,
  pageSchema,
  siteSettingsSchema
} from './content-schema';

const home = defineCollection({
  loader: glob({ base: './src/content/home', pattern: '**/*.json' }),
  schema: homeSchema
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.json' }),
  schema: pageSchema
});

const notes = defineCollection({
  loader: glob({ base: './src/content/notes', pattern: '**/*.{md,mdx}' }),
  schema: noteSchema
});

const settings = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: '**/*.json' }),
  schema: siteSettingsSchema
});

export const collections = { home, pages, notes, settings };
