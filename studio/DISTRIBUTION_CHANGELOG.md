# Changelog

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
