# Will Studio

A local visual content workspace for compatible **will-astro-v1** websites.
**Version 0.5.0** adds a neutral website starter to Launchpad, alongside its existing
project chooser and the searchable Section Library with explicit insertion positions.
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

An existing website must already have its own dependencies installed and its
will-astro-v1 adapter. Failed or expired checks need a new check, not an automatic
install or execution attempt. To start a new compatible website, use the separate
creation flow below; the editor never imports the original homepage's personal pages.

### Create a website

Choose **Create a website** in Launchpad. The bundled starter contains **45 source
files and 17 directories**, with a neutral Home and About page and **12 supported
layouts**. It includes the website's schema, field definitions, styles, validation
scripts, and preview adapter. Notes and the image library start empty. No personal
biography, selected books, songs, opinions, or external media are supplied for you.
Its notes loader watches the initially empty directory, so the first saved Markdown
note is detected without a preview restart. Deleting the last note clears stale
entries without losing the ability to load a later note; no sample note is required.

1. Enter a project display name and an absolute destination, such as `D:\my-website`.
   Use a **new or empty real folder** with an existing parent directory, separate
   from Studio and its open projects. Symbolic links and directory junctions are
   rejected; existing files are not overwritten.
2. Choose **Review files**. This is read-only: inspect the project name, exact
   destination, complete file list, directory list, and warnings. Editing either
   field or using an expired review requires another review.
3. Choose **Create website files** to write only those source files. This does not
   install packages, run project code, make network requests, initialize Git, or
   publish anything. Closing the window does not cancel an already-sent creation;
   keep the launcher running and reopen the window to see its result.
4. Copy the supplied **PowerShell** or **macOS / Linux shell** commands. Review and
   run them yourself in your terminal: enter the new folder, run `npm install`,
   then `npm run build`. Studio does not execute these commands. The first install
   downloads dependencies and creates this website's own `package-lock.json`; keep
   it and use `npm ci` for later reproducible installations.
5. Choose **Check this project**. It fills the chooser and performs the existing
   read-only checks. Missing dependencies must be installed before proceeding.
   Review the checks, explicitly confirm that you trust the project's code, then
   choose **Open in Studio** and **Open editor**.

If creation fails partway through, already-created files are **left in place** for
inspection; they are not automatically deleted or overwritten. Check the destination
before retrying, and choose a separate new or empty folder as needed. No automatic
retry, installation, or publishing follows a failed request.

This is one compatible starter, not conversion of an arbitrary website into Studio.
Choose hosting, a public URL, a repository, and a deployment workflow separately.

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

- Create a neutral will-astro-v1 website after reviewing its source files, then copy
  setup commands to run yourself before checking and explicitly trusting the project.
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
complete theme. The separate starter under `studio/starter/template` supplies one
complete, neutral website foundation. The small files under top-level `src` support
regression fixtures; they are not a personal website or a substitute for a selected
site's schema. Full bundle restoration, cloud collaboration, and automatic release
management are not implemented. This is a source distribution: there is no packaged
installer or npm release yet.

## Development

```sh
npm test
npm run build:writer
npm run check:starter
```

GitHub Actions runs the tests, writer build, and explicit starter build gate on
Node.js 24. **check:starter** generates a neutral website in a separate temporary
directory, installs its dependencies, runs its real production build, and checks
the generated HTML and public output for Studio-preview routes, editor assets, or
private runtime state. This developer/CI command needs network access and executes
the generated starter's build; it does not install into the editor or a selected
user project. Browser creation and read-only checks never run it automatically.
Successful runs remove their temporary QA directory; failures report and retain it
for diagnosis. This describes the gate, not a claim that a particular run passed.

Writer bundles are generated locally and excluded from source control. Documentation:
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
