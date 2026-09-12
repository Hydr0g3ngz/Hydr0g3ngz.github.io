# Will Studio

A local workspace for your website: direct page editing, reusable sections, drafts,
media, history, project health, snapshots, and content export. The public site remains
an independently built static website. Studio and its local state are not deployed.

These instructions describe **version 0.5.0**.

## Open it

On Windows, double-click **Start Studio.cmd** in this homepage folder. The bundled
editor still opens this project by default. Keep its terminal open while working;
save your work, then press Ctrl+C in that terminal to stop the local service.
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

For the browser-based project chooser, explicitly select **Launchpad** from this
bundled checkout:

```powershell
npm run studio -- --choose-project --open
```

In the independent Studio distribution, `npm start` selects Launchpad by default;
open the local address printed in the terminal, or use `npm start -- --open` to
open a browser automatically. Its **Start Studio.cmd** launcher also opens Launchpad.
An explicit `--project` skips the chooser and directly opens the trusted target:

```powershell
npm run studio -- --project "D:\another-compatible-site" --open
```

The selected website must already have its own dependencies installed and satisfy
the [will-astro-v1 project contract](studio/PROJECT_CONTRACT.md). Its
`will-studio.config.json` supplies the workspace name and optional live-site link.
This metadata does not change Astro's publication settings.

In Launchpad:

1. Enter the website's absolute local directory and choose **Check project**.
2. Review its name, path, compatibility, and installed-dependency checks. This is
   read-only: it does not execute project code or install the target's dependencies.
3. Only if you trust that code, select **I trust this project and allow its local
   code to run**, then choose **Open in Studio**. Passing checks is not proof of safety.
4. Use **Open editor** to continue in a new tab. The chooser remains open, without
   replacing another editor tab. Running entries offer **Return to editor**.

Changing the path clears the check and trust confirmation. If the project changes
after checking, or the check expires, check it again. Selecting a recent project
only fills its path and checks it again; it never starts code automatically.

Recent directories and their preferred ports are recorded privately in the editor
runtime's `.studio/projects.json`, not in the selected site's content. Do not commit
or publish this registry: local paths can reveal personal information. **Forget**
removes only the shortcut; it neither deletes project files nor stops a running editor.

One Launchpad manages at most **three running workspaces**. Closing browser tabs
does not stop them, and forgetting a shortcut does not free a workspace slot. Save
in every editor, then press **Ctrl+C in the Launchpad terminal** to stop that chooser
and the workspaces it started. It does not stop unrelated servers. Restart the
chooser to open a different set of projects.

Launchpad remembers each project's port pair and tries to reuse it when available,
which helps retain the same browser-draft origin. If a port is occupied, it can
choose another pair without stopping the other application. Different ports,
hostnames, browsers, and profiles do not automatically share or migrate drafts;
save before changing them.

Only open **trusted local projects**. Their schema, Astro configuration, and build
scripts are executable code. This is not an editor for an arbitrary website URL,
unrelated Astro template, or downloaded project that you have not reviewed. For
direct CLI sessions, give each one distinct `--port` and `--astro-port` values.
Launchpad manages its workspace ports; only its own `--port` is configurable in
chooser mode. `--choose-project` and `--project` cannot be combined.
`node studio/server.mjs --help` lists the available launch options.

### Create a new website

Launchpad also offers **Create a website**. This creates a separate, neutral
will-astro-v1 website, not a copy of Will's homepage. Its **45 source files and
17 directories** include Home and About, the content schema, `.pages.yml`, styles,
validation scripts, and the website-side preview adapter. **Twelve layouts** are
available: introduction, moving line, shelf, selected work, closing thought, text,
image with text, collection, quotation, profile, reading, and listening. Notes and
images begin empty; no biography, personal opinions, books, songs, or external
media are filled in on your behalf.

The starter watches its notes directory even when it is empty. Saving the first
real Markdown note is picked up without restarting the preview; removing the last
note clears the collection while leaving it ready for the next note. No sample
note is needed to keep the directory active.

1. Choose **Create a website**, enter a display name, and provide an absolute new
   destination such as `D:\my-website`. Its parent folder must already exist. Use
   a **new or empty real folder**, separate from Studio and its open projects—not
   a symbolic link, directory junction, or folder containing existing files.
2. Choose **Review files** and inspect the name, destination, complete file and
   directory lists, and warnings. Reviewing is read-only. Changing the name or
   destination invalidates that review; an expired review must also be repeated.
3. Choose **Create website files**. This writes the reviewed source files only.
   It does not install dependencies, execute project code, make network requests,
   initialize Git, or publish a website. Closing the window does not cancel a
   creation already requested; keep the launcher running and reopen the window
   to see its pending operation or result.
4. Copy the supplied **PowerShell** or **macOS / Linux shell** commands, review
   them, and run them in your own terminal. They enter the new folder, run
   `npm install`, then `npm run build`. The first install downloads dependencies
   and creates the website's own `package-lock.json`; retain it and use `npm ci`
   for later reproducible installs. Studio does not execute these commands.
5. Choose **Check this project** to fill the existing chooser and perform its
   read-only checks. If dependencies are missing, install them first and check
   again. Review the results, explicitly confirm trust in the local code, then
   choose **Open in Studio** and **Open editor**.

Creation never overwrites existing files. If it fails after writing some files,
the partial result is **kept for inspection**, not automatically removed. Check
the destination before retrying; use another new or empty folder when needed.
There is no automatic retry, install, preview start, Git operation, or publication.

The starter gives you one compatible website foundation. It does not turn arbitrary
existing websites into editable Studio projects. A public URL, hosting provider,
repository, and deployment workflow must be chosen separately when you are ready.

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

**Save locally is separate from publishing.** For this homepage, the public site
changes after a Git commit is pushed to `main` and its GitHub Pages workflow succeeds.
A newly created starter has no deployment workflow yet. The Project panel shows
local changes; the current release does not push or commit from the browser.

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

Choose **Add a section** to open the Section Library. It lists only the layouts
configured for the current page, using the website's existing typography and spacing.

1. Search by layout name or description, or use the available **Basics**,
   **Collections**, and **Personal** category filters. **Clear filters** restores
   the full list for this page.
2. Select a card to read its description. **Selecting a card does not insert it.**
   The small thumbnail is a layout sketch, not a complete template preview; the
   real page preview is the source of truth.
3. Choose **Insert position**: at the beginning, at the end, or after the currently
   selected section. The default is after the selected section when one is selected,
   otherwise at the end.
4. Choose **Add section** to insert it into the **browser draft**. Complete its
   fields in the inspector and check the real preview. Use **Save locally** when
   ready to write the changes to disk; insertion does not publish anything.

Arrow keys move and select layout cards; Enter or Space selects the focused card,
but still does not add it. Use the separate **Add section** button to confirm.
Closing the library before confirmation makes no change. If a filter hides your
chosen layout, clear the filter or select a visible card before adding. The page's
configured section limit is enforced; remove a section before inserting another
when that limit is reached. If the page changes while the library is open, close
and reopen it to choose a valid insertion point.

New sections use images only from the **current project's Media library**, including
image fields nested inside a section. An image-dependent layout needs an available
project image: if the library is empty, upload one in **Media**, then reopen the
Section Library. Images from the original homepage are not substituted into another
project. Review every image, its alt text, and any credits before saving.
A new **Profile** includes an editable starter paragraph rather than an invalid
empty paragraph list; replace the placeholder with your own introduction.

After insertion, drag sections to reorder them or use the up/down buttons. The
inspector also offers duplicate, remove, and visibility controls. Adding, moving,
duplicating, and removing sections can be undone with Studio's **Undo** control.

Nested collections—books, songs, quotations, links, image credits—have their own
add, duplicate, reorder, and remove controls. Optional fields can be cleared.
Required fields and list limits are checked when previewing and saving. Invalid
drafts keep the last valid preview and show the relevant field paths.

The plus button beside page search creates a page or Markdown note. A slug such as
`reading/short-stories` creates a nested page. New pages and notes start as drafts.
Use **Page details** to edit titles, descriptions, publication state, and navigation.
Drafts can be previewed without publishing them. Changing a title does not silently
change its URL.

Submitting **Create draft** requests a new unpublished **local file**, unlike adding
a section to a browser draft. While creation is pending, its inputs and submit
button are disabled to prevent duplicate submissions. **Close dialog** dismisses
the window but does not cancel an already-sent creation request. If it succeeds
after you close the dialog or move to other work, the new document is added to the
page list without switching away from your current work. Check that list before
retrying an uncertain request.

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
to their source edition. Each poem also has a short, sourced English background
under **About this poem**. This native disclosure starts collapsed; it hides only
the background, never the Chinese poem's full text.

The background and its source fields are editable in the Reading block's poem
entry. In the preview, open **About this poem** and double-click its paragraph to
edit supported plain text directly. This editorial context is separate from
**Your margin note**, which appears as **WILL'S MARGIN NOTE** only when you write one.
Leave the background empty to omit the disclosure. English renderings are optional;
no personal notes or opinions are filled in on your behalf.

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
npm run check:starter
```

The GitHub Pages deployment runs the Studio regression suite before the production
build, so a failed quality check does not replace the live site. The separate
**check:starter** CI gate exercises the neutral template itself: it creates an
isolated temporary website from the reviewed file manifest, installs that website's
dependencies, runs its production build, and checks the generated HTML and output
for leaked Studio routes, editor assets, or private runtime state. This explicit
developer command requires network access for dependency installation; it is not
part of the browser's Create a website or Check project actions. A successful run
removes its own temporary QA directory; a failed run reports and keeps that directory
for diagnosis. Run results must be checked separately from these instructions.

### Make a standalone local Studio package

From this homepage checkout, export to a **new or empty directory outside it**:

```powershell
node scripts/package-studio.mjs --out D:\will-studio
Set-Location D:\will-studio
npm install --package-lock-only
npm ci
npm test
npm run build:writer
npm run check:starter
npm start -- --open
```

The first command copies an explicit list of editor source, tests, adapter
reference files, and the neutral starter template. It excludes the homepage's
personal content and images, Git data, dependencies, and `.studio` recovery state.
It will not overwrite a nonempty output
folder. The lockfile refresh matches the standalone package's generated manifest;
install and test that package before using it. The reference adapter is integration
code, while `studio/starter/template` supplies the neutral website used by
**Create a website**. Existing and newly created target websites still need their
own dependencies installed separately.
The independent default opens Launchpad; use `--project "D:\will-homepage"` when
you deliberately want to bypass the chooser and open that trusted project directly.

Packaging does not create a repository, install dependencies, or publish anything.
The [standalone repository](https://github.com/Hydr0g3ngz/will-studio) is separate
from this homepage. These instructions describe 0.5.0 source and local extraction,
not the status of an online deployment. Studio is not a hosted service or an
npm-published package, and there is no packaged installer yet.

This is an evolving local Studio product. Complete release management,
import/restore of full project bundles, richer workspace management, support for
other adapters, and broader layout/theme tools remain development work. Launchpad
opens compatible existing projects and creates one neutral will-astro-v1 starter;
it does not create or adapt an arbitrary website for you.
The long-term goal is a complete, easy-to-use website workspace; this release does
not establish a claim of superiority over every existing tool.
