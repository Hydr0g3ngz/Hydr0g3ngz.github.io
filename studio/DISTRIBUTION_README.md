# Will Studio

A local visual content workspace for compatible **will-astro-v1** websites.
**Version 0.4.0** adds a searchable Section Library with explicit insertion positions,
alongside Launchpad, the browser project chooser.
Studio is an independent editor project, not a hosted
CMS or a universal website builder. It has an explicit compatibility contract,
not drag-and-drop editing for arbitrary webpages. The website and editor live in
separate folders.

## Start

Use Node.js 24 or newer. Install this editor's locked dependencies:

```sh
npm ci
npm start -- --open
```

The independent distribution defaults to **Launchpad**, a project chooser in your
browser. Plain `npm start` starts that chooser and prints its local address; `--open`
opens the browser automatically. On Windows, `Start Studio.cmd` verifies the editor's
locked dependencies and opens Launchpad. It may install the editor's dependencies,
but Launchpad never installs dependencies in a selected website.

1. Enter an absolute local folder, such as `D:\my-website`, and choose **Check project**.
2. Review the project name, path, compatibility, and installed-dependency checks.
   Checking is read-only and does not execute the selected project's code.
3. Only if you trust that code, select **I trust this project and allow its local
   code to run**, then choose **Open in Studio**.
4. Choose **Open editor** to continue in a new tab. The chooser and existing editor
   tabs stay in place. A running recent project offers **Return to editor**.

The website must already have its own dependencies installed and its will-astro-v1
adapter. Failed or expired checks need a new check, not an automatic install or
execution attempt. The editor does not ship with personal pages or a complete
starter website.

To deliberately open a trusted project directly, bypassing the chooser:

```sh
npm start -- --project "/absolute/path/to/a-trusted-website" --open
```

The launcher also accepts `--project "D:\path\to\trusted-website"`. Studio bundled
inside a compatible website still opens that project by default. Use
`--choose-project` to force Launchpad, including in a bundled checkout; do not combine
it with `--project`. `node studio/server.mjs --help` lists launch options.

### Recent projects and stopping work

Recent directories are kept in the **editor runtime's** `.studio/projects.json`.
This is private local state, not website content; do not commit or publish it.
Choosing a recent project only fills its path and checks it again. **Forget** removes
the shortcut only: no project files are deleted and no running editor is stopped.

One Launchpad supports at most **three running workspaces**. Closing browser tabs
does not stop their servers; forgetting a shortcut does not free a workspace slot.
Save in every editor, then press **Ctrl+C in the Launchpad terminal** to stop that
chooser and the workspaces it started. Other servers are not stopped. Restart it
to choose a different set of projects.

Launchpad remembers preferred port pairs and reuses them when available. This helps
keep a project's browser-draft origin stable. If another application occupies a
port, a different pair may be used instead; the other application is not stopped.
Browser drafts do not migrate between ports, hostnames, browsers, or profiles.
Save before changing addresses. In chooser mode, `--port` sets the chooser's own
address; workspace preview ports are managed automatically.

After dependencies are installed, independent workspaces can run side by side
through the direct CLI, using different ports for each Studio and preview:

```sh
node studio/server.mjs --project "/trusted/first-site" --port 4310 --astro-port 4311
node studio/server.mjs --project "/trusted/second-site" --port 4410 --astro-port 4411
```

The guided launcher conservatively refuses a new launch while another instance uses
the editor runtime, to keep dependency installation safe. Use the direct CLI for
separate CLI workspaces after installation is complete, or use the already-running
Launchpad to open up to three workspaces without restarting the launcher.

Only open a project you trust. Its schema module, Astro configuration, and build
scripts are executable local code. A repository link or configuration file is not
permission to execute somebody else's project. See the
[project contract](studio/PROJECT_CONTRACT.md) for the required paths and metadata.

## What is available

- Select existing compatible projects through Launchpad, review checks, explicitly
  confirm trust, and keep recent local folders without automatic execution.
- Edit supported text directly in a real website preview; use structured fields
  for sections, images, links, and publication settings.
- Write Markdown notes with a visual editor or source view, including lists,
  links, images, and code blocks.
- Browse supported sections by search and category, compare layout sketches, and
  explicitly choose where to insert a section. Reorder sections and create nested
  pages or notes, keeping new documents unpublished until they are ready.
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

## Add sections and pages

Choose **Add a section** to open the Section Library for the current page. Search
layout names or descriptions, or filter the categories that are available. Select
a card to see its description: selection alone makes no content change. Thumbnails
are **layout sketches**, not complete template previews. The real website preview
shows the actual result with that project's components and styles.

Choose an **Insert position**: the beginning, the end, or after the selected section.
The default is after the selected section when available, otherwise the end.
Only **Add section** confirms insertion. The result is a browser-draft change,
supports **Undo**, and still needs its fields completed and **Save locally** before
it is written to disk. Closing the library without adding changes nothing. A hidden
selection must be made visible or replaced before insertion; configured page section
limits also prevent further additions. Reopen the library if the page or insertion
point has changed.

New section image fields, including nested ones, use only the selected project's
Media library. If an image-dependent layout has no available project image, upload
one in **Media** before adding that layout. Studio does not borrow an image from
the original homepage. Review the image, alt text, and credits in the inspector.
New Profile sections include an editable starter paragraph; it is a placeholder,
not personal information supplied on your behalf.

**Create draft** for a new page or note creates an unpublished local file. Its
submit controls are disabled while the request is pending. **Close dialog** does
not cancel a request that has already been sent. If it completes after dismissal
or after you have moved elsewhere, the document joins the page list without
replacing your current work. Check the list before retrying an uncertain creation.

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
