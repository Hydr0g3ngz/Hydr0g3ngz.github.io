# Changelog

## 0.5.0 — 2026-09-12

- Add **Create a website** to Launchpad with a neutral will-astro-v1 starter:
  45 source files, 17 directories, and 12 supported layouts. Home and About contain
  editable placeholders; notes and images start empty. No personal biography,
  selected works, or opinions are copied from the original homepage.
- Separate read-only **Review files** from explicit **Create website files**.
  Show the destination, complete file and directory lists, and warnings before
  writing. Changed or expired reviews require a new review.
- Require a new or empty real destination with an existing parent, separate from
  the editor runtime and open projects. Reject links and junctions; create files
  exclusively instead of overwriting existing content. Partial failures retain
  created files for inspection and do not delete or automatically retry them.
- Keep creation limited to source files: no dependency installation, project-code
  execution, network requests, Git initialization, or publication. Closing the
  creation window does not cancel an already-sent request; reopening retains the
  pending operation or its result without duplicate submission.
- Show copyable PowerShell and macOS/Linux shell commands for a manual
  `npm install` and `npm run build`. The first install creates the new website's
  own lockfile; Studio does not execute the commands.
- Hand the created path back to the existing read-only project checks. Dependencies
  must be installed, and opening still requires explicit trust in the project's
  local code before starting an editor preview.
- Keep the notes watcher active when its directory starts empty, so the first real
  note does not require a preview restart. Serialize rescans, clear stale entries
  after deleting the last note, and replace old listeners on configuration reload.
  The main website and neutral starter share this notes-loader implementation.
- Add the explicit `npm run check:starter` developer/CI gate: generate the neutral
  source tree in an isolated temporary folder, install its dependencies, build it,
  and check the public output for editor or private-runtime leakage. This is
  separate from browser creation and read-only checking; it does not run implicitly
  against a selected user project. Successful QA folders are removed; failed ones
  are retained for diagnosis. Individual run results are not asserted here.

This remains a local source distribution for compatible projects, not an arbitrary
website builder, packaged installer, or npm release. Repository setup, hosting,
and publication remain separate user-controlled steps.

## 0.4.0 — 2026-09-12

- Add a Section Library with layout search, category filters, keyboard-selectable
  cards, and small layout sketches. Sketches are not full template previews; the
  selected website's real preview remains the source of truth.
- Separate choosing a layout from inserting it. **Add section** explicitly confirms
  insertion at the beginning, the end, or after the selected section. Selection and
  dismissal alone do not change content; insertion updates an undoable browser
  draft, not a saved file or public website.
- Respect each page's available layouts and configured section limit. Reject stale
  page or insertion-point state instead of inserting into a different working draft.
- Resolve new section image fields, including nested fields, only from the current
  project's Media library. Image-dependent additions require an available project
  image; an empty library needs an upload first, not an original-homepage fallback.
- Give new Profile sections a nonempty, editable starter paragraph so their initial
  paragraph structure is valid without inventing personal facts.
- Guard pending page/note creation against duplicate submits. Closing its dialog
  does not cancel an already-sent request; a late successful result joins the page
  list without interrupting the user's newer work.

Compatibility, trust requirements, local-only publishing boundaries, and license
status are unchanged. Saving still does not commit, push, or deploy a website.

## 0.3.0 — 2026-09-12

- Add Launchpad, a browser project chooser used by default in the independent
  distribution. Bundled websites keep their own-project default; `--choose-project`
  forces the chooser, and `--project` directly selects a trusted local website.
- Separate read-only compatibility/dependency checks from execution. Starting a
  checked project requires explicit trust; changed or expired checks must be repeated.
  Target dependencies are never installed automatically by Launchpad.
- Open editors through explicit new-tab links without replacing the chooser or
  existing editor tabs. Reuse a running workspace through **Return to editor**.
- Keep private recent-project metadata in the runtime's `.studio/projects.json`.
  Recent selections only recheck a folder; forgetting removes the shortcut, not
  project files or a running process.
- Manage up to three workspaces per Launchpad and remember preferred port pairs.
  Reuse ports when available, without stopping unrelated applications. Browser
  drafts remain origin-specific and are not migrated when addresses change.
- Stop the chooser and its owned workspaces with terminal Ctrl+C after saving.
  Closing a browser tab or forgetting a shortcut does not stop a workspace.

The compatibility and local-only publication boundaries below remain unchanged.

## 0.2.0 — 2026-09-12

- Run Studio separately from the website, selecting a trusted local checkout with
  `--project`. The versioned `will-astro-v1` contract defines supported project paths
  and metadata; website-specific rendering remains in its own adapter.
- Find saved pages, content, and media through Ctrl/Cmd+K search, open matching
  inspector fields, and run common commands. Unsaved browser drafts are not indexed.
- Edit simple text in the real page preview, or use the Markdown-backed visual
  writer for headings, lists, links, images, and longer writing. Unsupported source
  constructs remain editable as Markdown without silent conversion loss.
- Keep browser drafts and recovered versions scoped to the selected project.
  Revision-checked local saves, undo/redo, file history, and snapshots support recovery.
- Create pages and notes, arrange sections and collections, manage images, and
  review moves, duplication, and recoverable deletion with linked-reference checks.
- Inspect project health and Git state, export content, and check the saved site's
  production build. Source packaging separates the editor from personal site content.

This version supports compatible, trusted local `will-astro-v1` projects only.
It is not an arbitrary-webpage editor or a hosted multi-user service. Saving,
checking, and packaging remain local operations; Studio does not commit, push, or
publish the website. Content exports and project snapshots do not include media.
