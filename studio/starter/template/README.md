# My website

A neutral, static Astro website compatible with the `will-astro-v1` editor contract.
The website owns its content, theme, schema and preview adapter. The local editor is
installed separately; this starter does not include the editor runtime.

## Run locally

Use Node.js 24 or newer. From this website's directory:

```sh
npm install
npm run dev
```

Dependency installation downloads the versions listed in `package.json` and creates
`package-lock.json`. Keep that lockfile with the project; use `npm ci` for subsequent
reproducible installations. No images or web fonts are downloaded by the website.
The initial pages use local system fonts and a code-native icon.

To edit visually, open your installed editor's project chooser, select this folder,
review its checks, and explicitly trust this project's local code. Compatibility
checks are not a sandbox. Neither editing nor previewing publishes a website.

## Make it yours

- `src/content/home/home.json`: the introduction and first text section.
- `src/content/pages/about.json`: a short About page. New pages can have nested paths.
- `src/content/settings/site.json`: the brand, navigation and footer.
- `src/content/notes/`: Markdown notes with YAML frontmatter. It starts empty.
- `public/images/`: your images. It starts empty; add your own files before choosing
  an image-based section. An empty `.gitkeep` only preserves the directory.
- `.pages.yml`: field definitions shared with the visual content editor.

Twelve layouts are available: introduction, moving line, shelf, selected work,
closing thought, text, image with text, collection, quotation, profile, reading,
and listening. Reading and listening collections start without any selected works
or recordings. Add your own sources and descriptions; no personal opinions are
prewritten for you. Image fields must refer to files in this project's library.

A page or note is included in the next static build only when `published` is true.
New pages and notes created in the editor start as drafts. Navigation is configured
separately. The Notes index appears after the first note is published. There are no
starter notes, imported personal content, remote images or embedded players.

## Check before publishing

```sh
npm run build
```

The build validates content, checks Astro/TypeScript, generates the static site into
`dist/`, and checks local links and image references. Only generated public website
files belong on a static host. The preview adapter enables `/__studio/preview` only
for local editor development, never for a production build.

This starter has no public site URL, hosting provider, repository or deployment
workflow. Choose those separately when ready. Configure Astro's `site` option for
your eventual public origin, and optionally add its HTTPS URL to
`will-studio.config.json` for the editor's live-site link. Do not publish `.studio`,
which contains local previews and recovery data. Keep independent backups of your
content and images.
