# Will Studio project contract — version 1

Studio can be pointed at another compatible local checkout. This does not make it
a generic editor for arbitrary websites: `will-astro-v1` uses the current Astro
content model and fixed relative paths.

## Configuration

Create `will-studio.config.json` at the selected project root:

```json
{
  "version": 1,
  "adapter": "will-astro-v1",
  "project": {
    "name": "My Personal Website",
    "siteUrl": "https://example.com/"
  }
}
```

`project.name` is required: 1–100 characters after trimming, without control
characters. `project.siteUrl` is optional. It must be an absolute HTTPS base URL,
without credentials, query parameters, or a fragment. A subdirectory is allowed,
for example `https://example.com/my-site/`. Local preview addresses do not belong
here; omit this field for a local-only project. HTTP is not enabled by this
contract, even for localhost.

Only the keys shown above are accepted. Misspelled fields, unsupported versions,
and unknown adapters fail explicitly. The file is JSON data, limited to 32 KiB:
no commands, scripts, adapter module paths, executable configuration, or custom
content directories are supported. The metadata does not change Astro's `site`
setting, publish the website, or grant permission to run project code.

## Fixed adapter layout

These regular files are required:

- `package.json`
- `astro.config.mjs`
- `.pages.yml`
- `src/content-schema.ts`
- `src/content/home/home.json`
- `src/content/settings/site.json`
- `src/content/pages/about.json`

These directories are required: `src/content/pages`, `src/content/notes`, and
`public/images`. The additional page and note collections may contain no entries.
`src/redirects.json` and `public/uploads` are optional for legacy compatibility;
when present, they must be a regular file and directory respectively. Studio's own
runtime directory is not required inside the selected checkout by this contract.

The root and all required/checked ancestors must be real directories, not symlinks
or Windows junctions. A configuration file cannot redirect any of these paths.
These structural checks do not replace content-schema validation, the published
content gate, dependency checks, or the production build.

## Website-side preview integration

The selected website owns `src/studio-adapter/integration.mjs` and
`src/studio-adapter/preview.astro`. Import the integration in its `astro.config.mjs`
and include it alongside the site's existing integrations:

```js
import studio from './src/studio-adapter/integration.mjs';
// Within defineConfig: integrations: [yourOtherIntegrations, studio()]
```

The preview component also needs the website's own `src/layouts/Base.astro`,
`src/components/BlockRenderer.astro`, `src/components/PageHeader.astro`, content
collections, Markdown helper, and styles. The distribution's reference adapter is
not a complete theme. Install the website's dependencies in its own directory before
starting Studio; the preview uses that project's Astro installation.

The integration enables `/__studio/preview` only for Studio's development preview.
The editor serves its bridge and editor UI from its separate runtime. Production
builds must not emit the preview route, bridge, `.studio` data, or editor files.

### Neutral starter and empty note collections

Studio 0.5.0 includes one neutral will-astro-v1 starter under
`studio/starter/template`: **45 files, 17 directories, and 12 supported layouts**.
It supplies a website's schema, field definitions, components, styles, validation
scripts, and preview adapter without embedding the editor runtime or the original
homepage's personal content. The reference adapter remains integration code; the
starter is the separate complete website foundation.

Launchpad reviews this finite file list before an explicit creation request. The
destination must be a new or empty real folder, with an existing parent, separate
from Studio and its open workspaces. Creation does not overwrite files; partial
output remains for inspection if writing fails. It does not install dependencies,
execute project code, initialize Git, or publish. The user installs the generated
website's dependencies separately, creating its own lockfile, then checks and
explicitly trusts the project before opening it.

The starter's `src/lib/notes-loader.mjs` keeps watching `src/content/notes` even when
there are initially no notes. It handles addition, change, and removal with
serialized rescans while delegating parsing, validation, and rendering to Astro's
loader. The first note can load without a restart, and deleting the last note clears
the collection. No dummy published content is required. Other compatible websites
should preserve this empty-directory behaviour; this helper's exact filename is
not an additional required contract path. Studio's editing support remains `.md`,
not MDX.

The explicit `npm run check:starter` developer/CI gate creates, installs, and builds
the bundled neutral website in a temporary directory, then checks its production
output for leaked preview/editor code or private runtime state. This gate executes
only as a requested developer check or CI job, never as part of read-only project
inspection or browser source creation. It is not a sandbox for arbitrary projects.

Page-move link maintenance recognises absolute links only when `project.siteUrl`
is configured, with an exact origin and base-path boundary. Without this setting,
relative links can be maintained, but absolute URLs are left unchanged. The setting
does not configure the site's actual deployment base path.

## Loading and trust boundary

`loadProjectConfig(root, { allowLegacy: true })` asynchronously returns:

```js
{
  version: 1,
  adapter: 'will-astro-v1',
  project: { name: 'My Personal Website', siteUrl: 'https://example.com/' },
  configSource: 'file', // or 'legacy'
  warnings: []
}
```

This result contains only display-safe metadata, not absolute paths, package
scripts, credentials, or Git configuration. Values still require ordinary HTML
escaping when rendered. For a project without configuration, `allowLegacy: true`
derives a readable label from `package.json`'s name (or `Local Website`), returns a
warning, and does **not** guess a site URL. Set `allowLegacy: false` to require the
file. Malformed configuration never falls back to legacy mode.

`assertCompatibleProject(root)` performs the structural checks and returns
`{ root, schemaPath, contentRoot }` with canonical absolute paths for internal use.
`loadProjectConfig` calls it before reading project metadata. Errors are
`ProjectConfigError` with code `STUDIO_PROJECT_CONFIG`.

Neither function imports, evaluates, or executes any selected-project code. In
particular, `src/content-schema.ts` is a **trusted project code module**, not a
declarative schema. The caller may load that module or run Astro only after the
user explicitly selects a trusted local checkout with `--project`, or reviews a
successful Launchpad check and explicitly confirms trust before opening it. Opening a
configuration file, a web link, or a repository mention is not authorization to
execute it. The adapter is a fixed implementation identifier; it must never be
used as an arbitrary import path or shell command.
