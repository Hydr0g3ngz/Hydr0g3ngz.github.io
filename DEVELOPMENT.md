# Continuing the website and Studio

The active goal is the user's full request: keep improving the personal website with
engaging music, reading, quotations, and richer presentation; build a comprehensive,
extremely convenient local visual website tool whose scope extends beyond editing.
This is an ongoing goal, not satisfied by delivering a compatible CMS or one release.

## Product principles

- English public copy; Will Qing / Yunshu Qing; SJTU Information Engineering.
- Reading, music, and film come first. Sports remain secondary; research stays modest.
- Personal reflections are authored by Will. Editorial suggestions are not presented
  as invented experiences or opinions. Attribute excerpts and recordings accurately.
- Preserve the high-quality static publication while improving the local workflow.
- Judge improvements by real browser use, working persistence/recovery, and deploys.

## First Studio release, September 2026 (historical baseline)

Implemented: local server and one-click Windows launcher; real-page draft previews;
inline simple-text editing; recursive schema-based inspector; blocks and nested
collections; ordering/duplication/removal; page/note creation; media uploads; undo/redo;
browser draft recovery; atomic revision-checked saves; per-file history/restore;
project health, Git status, snapshots, content export, and full build checks.

Public content: dedicated Reading and Listening pages, four book introductions,
three sourced Song ci excerpts, official artist recordings, and three functioning
locally synthesized sound studies. Reflection fields remain available for Will.

## Current content direction (latest user revision)

The initial audio direction above was superseded by Will's explicit choices.
Remove synthetic demos and the unreleased sequencer, do not reintroduce them.
The reading room now has four complete chosen Song ci works, not fragments.
The listening room has five chosen songs with YouTube/NetEase links, not embedded
players. Homepage card links replace duplicate room entrances. Films and artists
follow Will's supplied list; personal reasons remain unwritten until supplied.

## Current standalone foundations

The local editor now has a separate search/command panel, opened from the sidebar
or with Ctrl/Cmd+K. It searches saved content and media, filters common commands,
and opens matching inspector fields through nested collections. Unsaved browser
drafts are deliberately excluded from the search index. The panel uses safe DOM
text highlighting, accessible keyboard navigation, IME-safe handling, and stale
response protection. Host navigation has its own intent counter so a slow lookup
cannot override a newer page choice. Rich-writer Ctrl/Cmd+K remains its link shortcut.

Browser drafts and recovered versions use a workspace identity derived from the
canonical selected project path, not just a document filename. Storage remains
browser-origin-specific; copying/moving a project or changing the local port does
not migrate browser drafts automatically. Legacy unscoped drafts are claimed only
by the original homepage checkout, and their original bytes are retained.

The runtime can target an external compatible checkout:

```powershell
npm run studio -- --project "D:\another-compatible-site" --open
```

This is **will-astro-v1 compatibility, not arbitrary-website compatibility**. The
selected trusted local project supplies its own installed dependencies, Astro
configuration, `.pages.yml`, schema, content, components, and styles. Its
`will-studio.config.json` declares version 1, the fixed adapter name, display name,
and optional HTTPS site link. It cannot specify commands or alternate module paths.
The full fixed-path contract is in [studio/PROJECT_CONTRACT.md](studio/PROJECT_CONTRACT.md).
Configuration validation is not a sandbox: loading the selected schema, running
Astro, or checking the site's build executes that project's code.

Keep the implementation boundary explicit:

- `studio/` owns the reusable local server, editing UI, search, persistence, and
  project operations. Its generated writer assets stay local.
- `src/studio-adapter/` belongs to the website. The integration and preview renderer
  reuse its real layouts and components, with the preview route enabled only for
  Studio development. Production builds must exclude that route and editor assets.
- The selected project owns its content, media, schema, and `.studio` history,
  snapshots, and transaction state. An external target does not need an embedded
  copy of the editor runtime.

### Local source distribution

The allowlisted exporter is now available. It does not copy the personal website,
media, Git history, `.studio` state, or `node_modules`, and never overwrites a
nonempty destination:

```powershell
node scripts/package-studio.mjs --out D:\will-studio
Set-Location D:\will-studio
npm install --package-lock-only
npm ci
npm test
npm run build:writer
npm start -- --project "D:\will-homepage" --open
```

The output must be separate from the source and its ancestors/descendants. It
contains the editor, regression tests, a generated package manifest and CI workflow,
plus reference adapter code—not a ready-made website template. Refreshing the
copied lockfile aligns it with the generated manifest. The exporter itself does
not install dependencies, initialise Git, commit, push, or deploy.

The public [independent repository](https://github.com/Hydr0g3ngz/will-studio) now
contains the 0.2.0 source with setup instructions, security notes, and CI. This is
an early contract-limited source distribution, not a hosted service, npm release,
or universal editing product.

## Remaining work toward the full goal

1. Complete publishing workflow: reviewed changes, validation jobs, commit/push,
   deployment progress, and rollback. Preserve explicit draft vs publication state.
2. Page operations: reusable templates, bulk operations, and file-history continuity
   after moves. Saved-content/media search and the command palette are implemented;
   move/duplicate/trash with reviewed link maintenance use a local transaction API.
3. Rich writing: side-by-side source, document-level find/replace, table editing and
   richer embeds. The Markdown-backed visual writer now has an independent mount
   API, expanded writing space, clean paste, and source-preservation safeguards.
4. Design tools: controlled typography/colour/spacing variants, accessible themes,
   preview comparison, and reusable component templates without breaking layouts.
5. Media: metadata, alt-text coverage, image optimisation, and convenient source/link
   maintenance. Any future audio feature or playlist addition must follow Will's
   explicit selection, not invent a listening profile or add synthetic experiments.
6. Whole-project management: portable asset-inclusive bundles, previewable import,
   snapshot comparison and full restore, a publish queue, and useful diagnostics.
7. Continue actual content curation and visual refinement with verified sources.
8. Expand real-user acceptance testing: long sessions, multi-tab conflicts, offline
   recovery, cold start, international text, accessibility and touch interaction.
9. Product direction explicitly requested by the user: a standalone Will Studio,
   usable beyond this homepage. The shell/website adapter boundary, versioned
   will-astro-v1 contract, external-project launch, workspace-scoped browser storage,
   and an independent source repository now exist. Next: guided
   onboarding and project switching, additional adapters, deployment providers,
   upgrade/migration, and diagnostics. Expand proven workflows incrementally rather
   than claiming universal compatibility.

Do not mark the full active goal complete based only on green checks for this first
release. Validate newly added workflows against their actual intended behaviour.
