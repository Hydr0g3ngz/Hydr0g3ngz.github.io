# Will Studio

A local workspace for your website: direct page editing, reusable sections, drafts,
media, history, project health, snapshots, and content export. The public site remains
an independently built static website. Studio and its local state are not deployed.

## Open it

On Windows, double-click **Start Studio.cmd** in this folder. It opens Studio in your
browser. Keep its terminal open while working; close it to stop the local service.

Alternatively:

```sh
npm ci
npm run studio -- --open
```

Node.js 24 or later is required. The editor uses `http://127.0.0.1:4310` and starts its
own Astro preview on port 4311. If these ports are occupied, close the other Studio
instance first or use `npm run studio -- --port 4410 --astro-port 4411`.

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

**Save locally is separate from publishing.** The public site changes after a Git
commit is pushed to `main` and its GitHub Pages workflow succeeds. The Project panel
shows local changes; the current release does not push or commit from the browser.

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

## Try the page, manage images, and check the project

Use **Interact** to try music players, links, and other visitor controls. Return to
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

Reading entries distinguish short editorial introductions from personal reflections.
The Song ci excerpts include their source and translations prepared for this site.
The optional reflection fields are ready for your own words.

Listening includes official recordings loaded only after a click and three original
Web Audio sketches generated for this site. They are not attributed to Will or to
the listed artists. The sketches run locally; official videos need access to YouTube
and may be unavailable in some regions or browsers. An external source link remains
available. Starting another player stops the existing one.

## Development and current boundaries

The field inspector follows `.pages.yml`, so new configured content fields are picked
up without rebuilding a separate editor schema. Draft previews use the real Astro
components and isolated preview revisions. Notes share a sanitized Markdown renderer
between preview and publication.

```sh
npm run test:studio
npm run build
```

This is a working first local Studio release. Complete release management, page
renaming/deletion with link rewrites, import/restore of full project bundles, a
dedicated rich-text canvas, and broader layout/theme tools remain development work.
The long-term goal is a complete, easy-to-use website workspace; this release does
not establish a claim of superiority over every existing tool.
