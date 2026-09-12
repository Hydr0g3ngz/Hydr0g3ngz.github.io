# Will Studio

A local visual content workspace for compatible **will-astro-v1** websites.
Version 0.2.0 is an independent editor project, not a hosted CMS or a universal
website builder. This is an early release with an explicit compatibility contract,
not drag-and-drop editing for arbitrary webpages. The website and editor live in
separate folders.

## Start

Use Node.js 24 or newer. Install this editor's locked dependencies:

```sh
npm ci
npm start -- --project "/absolute/path/to/a-trusted-website" --open
```

On Windows, `Start Studio.cmd` offers a guided launch and can ask for the website
folder. It also accepts `--project "D:\path\to\trusted-website"`. The website
must already have its own dependencies installed and its will-astro-v1 adapter.
The editor does not ship with personal pages or a complete starter website.

After dependencies are installed, independent workspaces can run side by side
through the direct CLI, using different ports for each Studio and preview:

```sh
node studio/server.mjs --project "/trusted/first-site" --port 4310 --astro-port 4311
node studio/server.mjs --project "/trusted/second-site" --port 4410 --astro-port 4411
```

The guided launcher conservatively refuses to run while another instance uses
the editor runtime, to keep dependency installation safe. Use the direct CLI for
simultaneous workspaces after installation is complete.

Only open a project you trust. Its schema module, Astro configuration, and build
scripts are executable local code. A repository link or configuration file is not
permission to execute somebody else's project. See the
[project contract](studio/PROJECT_CONTRACT.md) for the required paths and metadata.

## What is available

- Edit supported text directly in a real website preview; use structured fields
  for sections, images, links, and publication settings.
- Write Markdown notes with a visual editor or source view, including lists,
  links, images, and code blocks.
- Add and reorder supported sections, create nested pages or notes, and keep new
  documents unpublished until they are ready.
- Search content and navigate with a command palette.
- Review page moves, copy a page as a draft, use recoverable Trash, and maintain
  redirects for previously published addresses.
- Keep separate browser drafts per workspace, undo edits, review file history,
  create local snapshots, and export a content bundle.
- Run the selected website's quality checks without automatically deploying it.

Studio listens on loopback. Editing, drafts, snapshots, and local preview do not
require a cloud account. Installing dependencies, opening external links, or
using a site's external media can still require network access. Saving locally
does not publish to GitHub; deployment remains a separate website workflow.

## Compatibility and limits

This release supports the fixed will-astro-v1 content model and its existing block
types. It does not promise to edit arbitrary Astro projects, React applications,
or any website. MDX, custom slug overrides, and unsupported content filenames fail
safely instead of being silently rewritten. New visual block types still need
matching schema, field definitions, and website components.

The [reference adapter](reference/adapter/README.md) is integration code, not a
complete theme. The small files under top-level `src` support regression fixtures;
they are not a bundled personal website or a substitute for the selected site's
schema. Full bundle restoration, cloud collaboration, and automatic release
management are not implemented.

## Development

```sh
npm test
npm run build:writer
```

GitHub Actions runs the tests and writer build on Node.js 24. Writer bundles are
generated locally and excluded from source control. Existing documentation:
[project contract](studio/PROJECT_CONTRACT.md), [visual writer](studio/WRITER.md),
[change log](CHANGELOG.md), [security boundaries](SECURITY.md).

The distribution exporter initially copies the source lockfile. Before the first
commit of a newly exported package, its maintainer must run
`npm install --package-lock-only` to align the lockfile metadata with
`@willqing/will-studio`, then `npm ci`, tests, and the writer build. The exporter
itself never installs dependencies, deletes folders, creates a Git repository,
or pushes anything.

## License status

No open-source license is included yet; Will will decide the licensing terms.
The package is marked private to prevent accidental npm publication. Third-party
dependencies retain their own licenses. Do not infer an open-source grant from
the availability of this repository.
