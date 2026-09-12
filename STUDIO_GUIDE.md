# Will Studio

A local workspace for your website: direct page editing, reusable sections, drafts,
media, history, project health, snapshots, and content export. The public site remains
an independently built static website. Studio and its local state are not deployed.

## Open it

On Windows, double-click **Start Studio.cmd** in this folder. It opens Studio in your
browser. Keep its terminal open while working; close it to stop the local service.
The launcher verifies the Node version and locked dependencies. After a dependency
update it installs the exact locked packages; subsequent launches skip installation.
Before replacing dependencies, it checks for a running Studio/Astro preview and
stops with a clear explanation if one is found. It never kills another process.
Close other Studio instances before opening an updated checkout. A failed install
does not receive a success stamp; the next launch verifies the files again.

Alternatively:

```sh
npm ci
npm run studio -- --open
```

Node.js 24 or later is required. The editor uses `http://127.0.0.1:4310` and starts its
own Astro preview on port 4311. If these ports are occupied, close the other Studio
instance first or use `npm run studio -- --port 4410 --astro-port 4411`.

### Open another compatible local project

Studio can now run separately from the website it edits. From this checkout:

```powershell
npm run studio -- --project "D:\another-compatible-site" --open
```

The selected website must already have its own dependencies installed and satisfy
the [will-astro-v1 project contract](studio/PROJECT_CONTRACT.md). Its
`will-studio.config.json` supplies the workspace name and optional live-site link.
This metadata does not change Astro's publication settings.

Only open **trusted local projects**. Their schema, Astro configuration, and build
scripts are executable code. This is not an editor for an arbitrary website URL,
unrelated Astro template, or downloaded project that you have not reviewed. For
simultaneous Studio sessions, give each one distinct `--port` and `--astro-port`
values. `node studio/server.mjs --help` lists the available launch options.

## Make your first edit

1. Choose a page on the left.
2. Click a section in the middle. Its editable fields appear on the right.
3. Double-click simple text to type on the page. Press Enter or click elsewhere to
   finish. Escape cancels that text edit. For repeated or formatted text, use the
   inspector: its fields always have an exact connection to the content.
4. Changes refresh the real Astro preview without changing the public website.
5. Choose **Save locally** or press Ctrl/Cmd+S to write the content files.

Undo and Redo cover section operations, field edits, and restored versions. Standard
text editing shortcuts still work within input fields. Unsaved drafts are also kept
in your browser, so reloading Studio can recover them. A browser storage failure is
reported rather than silently treated as a saved file.

Drafts and recovered browser versions are isolated by the selected project's real
folder, so two projects with the same page filenames do not share drafts. Browser
storage is also specific to the browser/profile and local address. Save before
moving a project or changing browsers or ports: the old browser draft is not
automatically transferred. Existing unscoped drafts are migrated only for the
original homepage checkout, with their source data retained for recovery.

**Save locally is separate from publishing.** The public site changes after a Git
commit is pushed to `main` and its GitHub Pages workflow succeeds. The Project panel
shows local changes; the current release does not push or commit from the browser.

## Search and commands

Choose **Search & commands** in the sidebar, or press **Ctrl/Cmd+K**. With an empty
query, the panel shows common actions such as creating a page, adding a section,
opening saved versions, or checking the site. Typing searches page titles, saved
content, image names, and matching command descriptions.

Use Up/Down and Enter, or click a result. Page results open the relevant inspector
field, including fields inside nested collections; image results open the media
library. Escape closes search and restores focus. Ctrl/Cmd+K inside the rich writer
continues to belong to its link editor.

Content search includes **saved local files, not unsaved browser drafts**. Finish
and save an edit if you want to find its new words. Opening search first commits an
active simple-text edit to the browser draft; this is not a disk save. Search is
bounded, and the panel asks you to narrow the query when more matches may exist.

## Add and arrange content

Choose **Add a section** for one of the layouts available to that page. All layouts
use the website's existing typography and spacing. Drag sections to reorder them, or
use the up/down buttons. The inspector also offers duplicate, remove, and visibility
controls. Removing a section can be undone immediately.

Nested collections—books, songs, quotations, links, image credits—have their own
add, duplicate, reorder, and remove controls. Optional fields can be cleared.
Required fields and list limits are checked when previewing and saving. Invalid
drafts keep the last valid preview and show the relevant field paths.

The plus button beside page search creates a page or Markdown note. A slug such as
`reading/short-stories` creates a nested page. New pages and notes start as drafts.
Use **Page details** to edit titles, descriptions, publication state, and navigation.
Drafts can be previewed without publishing them. Changing a title does not silently
change its URL.

### Write without Markdown syntax

Notes now have **Visual** and **Markdown** modes. In Visual mode, select text and use
the toolbar for headings, emphasis, lists, quotations, links, images, and code.
Choose **Expand** for a roomy writing space; Escape returns to the page. The body
still saves as portable Markdown, not a proprietary editor document.

The writer has its own typing undo/redo. The top-level Studio undo also covers the
whole document. Switching modes without editing leaves the original Markdown
unchanged. Tables, embedded HTML, and other unsupported constructs stay in Markdown
mode so the visual editor does not silently remove them. Image insertion asks for
alt text and can use the local media library. The first launch builds the editor
locally; no editing service or account is required.

### Move, copy, or remove a page

**Page actions** offers address changes, duplication, and recoverable deletion.
Each operation opens a review listing saved-file changes and linked references.
Save any affected browser drafts before applying. The server checks all file
revisions again at application time and refuses stale plans.

- **Move / change address** moves one page or note, including into a nested folder.
  Related internal links are rewritten. Published old URLs get a static redirect
  after deployment. This does not implicitly move other pages in the folder.
- **Duplicate as a draft** makes an unpublished copy, excluded from navigation.
- **Move to trash** is blocked until incoming references are resolved. It keeps
  the full document locally; **Recently removed** lets you review a restore.

Home, site settings, and About have protected addresses. Restoring from trash never
overwrites another document. The operation journal under `.studio/transactions`
supports rollback if a file operation fails or Studio is interrupted; external edits
are preserved and a recovery conflict is reported instead of overwritten.

Old addresses are recorded in `src/redirects.json`, included in content exports and
snapshots. On GitHub Pages these are HTML redirect pages, not server-level HTTP 301
rules, following [Astro's static redirect behaviour](https://docs.astro.build/en/guides/routing/#configured-redirects).
Redirects are validated for loops, collisions, and published destinations.

## Try the page, manage images, and check the project

Use **Interact** to try links and other visitor controls. Return to
**Edit mode** to select content. Desktop, Tablet, and Phone controls resize the canvas;
on narrower windows the desktop canvas fits the available workspace.

The media library lists local images and accepts JPEG, PNG, WebP, and AVIF up to 2 MB.
Choose an image from any image field, then describe it in the accompanying alt-text
field. Use material you own or have permission to publish; include image credits
where needed. Merely uploading an image does not place it on a page.

The **Project** tab offers:

- Content, draft, and image counts.
- Read-only Git branch, latest commit, and changed-file information.
- Content and media health checks.
- A **Check site** command that runs the complete production build on saved files.
- Dated project snapshots and a downloadable JSON content bundle.

## Recovery

**History** lists previous file versions. Restoring a version backs up the current
file. If you have unsaved browser changes, Studio keeps them as a recovered browser
draft before replacing the displayed content. Reopen them from History.

Saves use a file revision hash. If an external editor or another Studio window has
changed a file, Studio refuses to overwrite that version silently. Reload the disk
version from History, inspect the recovered browser draft, and reconcile your edits.

Local backups live under `.studio/history`; project snapshots live under
`.studio/snapshots`. Snapshot manifests include file hashes and keep content,
configuration, and image-credit text together. Export contains the same text-based
content; **images are not embedded in the export or snapshots**. Back up `public/images`
separately. These are local recovery tools, not a replacement for a second backup copy.

## The reading and listening rooms

Reading entries distinguish short editorial book introductions from personal
reflections. The four Song ci poems are complete, preserve both stanzas, and link
to their source edition. English renderings are optional; no personal notes are
filled in on your behalf.

Listening is a compact list of Will's selected songs. Each current entry has a
verified YouTube link and a NetEase Music link; playback happens on those platforms,
subject to regional/account availability. There are no synthesized sound demos,
music sketchpads, or embedded players. Change songs and add your own reflections
through **Selected songs** in the Listening block.
The earlier-format fields at the bottom are only for entries restored from older
history. New YouTube and domestic-platform URLs take precedence over those fields.

## Development and current boundaries

The field inspector follows `.pages.yml`, so new configured content fields are picked
up without rebuilding a separate editor schema. Draft previews use the real Astro
components and isolated preview revisions. Notes share a sanitized Markdown renderer
between preview and publication.

Studio currently edits filename-routed JSON pages and Markdown (`.md`) notes.
MDX, custom `slug` overrides, and unsupported content filenames are rejected rather
than silently omitted or rewritten; handle them in an external editor before
reopening Studio. The reserved notes placeholder is not shown.

The editor runtime lives under `studio/`; website-specific preview rendering lives
under `src/studio-adapter/`. The latter uses the selected site's layouts, components,
content schema, and styles. Its integration adds `/__studio/preview` only to Studio's
development preview, never to a production build. A compatible external site needs
that website-side integration; the editor runtime need not be copied into the site.
See the [project contract](studio/PROJECT_CONTRACT.md) before adapting another project.

```sh
npm run test:studio
npm run build
```

The GitHub Pages deployment runs the Studio regression suite before the production
build, so a failed quality check does not replace the live site.

### Make a standalone local Studio package

From this homepage checkout, export to a **new or empty directory outside it**:

```powershell
node scripts/package-studio.mjs --out D:\will-studio
Set-Location D:\will-studio
npm install --package-lock-only
npm ci
npm test
npm run build:writer
npm start -- --project "D:\will-homepage" --open
```

The first command copies an explicit list of editor source, tests, and adapter
reference files. It excludes the homepage's personal content and images, Git data,
dependencies, and `.studio` recovery state. It will not overwrite a nonempty output
folder. The lockfile refresh matches the standalone package's generated manifest;
install and test that package before using it. The reference adapter is not a
complete website template, and the selected target still needs its own dependencies.

Packaging does not create a repository, install dependencies, or publish anything.
The public [standalone repository](https://github.com/Hydr0g3ngz/will-studio) has been
published with the 0.2.0 source, setup instructions, security notes, and CI.
These instructions describe local source extraction; Studio is not a hosted service
or an npm-published package.

This is an evolving local Studio product. Complete release management,
import/restore of full project bundles, guided project onboarding/switching, support
for other adapters, and broader layout/theme tools remain development work.
The long-term goal is a complete, easy-to-use website workspace; this release does
not establish a claim of superiority over every existing tool.
