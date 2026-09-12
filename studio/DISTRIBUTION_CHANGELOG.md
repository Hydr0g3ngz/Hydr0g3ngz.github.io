# Changelog

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
