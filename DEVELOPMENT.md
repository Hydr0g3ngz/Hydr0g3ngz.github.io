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

## Section Library and reading context — September 2026

Reading now includes short, sourced English background notes for all four selected
Song ci works. Native, initially collapsed disclosures keep the complete poems
visible and separate editorial context from Will's still-empty personal reflections.
The optional fields are editable in Studio and their text is included in saved-content
search. Stable poem permalinks and the mobile reading layout remain intact.

Studio 0.4.0 introduces a searchable Section Library with category filters and
code-native layout sketches. Choosing a card is separate from adding it to the
browser draft; insertion position is explicit, undoable, and never publishes or
saves by itself. New sections use the target project's schema descriptors and
media library, including custom component aliases. Profile defaults, unique anchors,
configured section bounds, and stale draft protection have regression coverage.

Pending page creation cannot double-submit, close a newer dialog, or navigate away
from newer work. Closing its dialog does not cancel a local-file request already
sent; the UI explains that distinction. Main-suite verification: 225 passing tests
plus project-tools checks; production build: five validated static pages and no
Astro diagnostics. Real-browser checks covered section insertion/undo, layout search,
the narrow library dialog, and expanded poem notes at a 390-pixel viewport.

## Current standalone foundations

### 0.5.0 neutral starter — source implementation

Launchpad now includes **Create a website** as a separate local onboarding flow.
The neutral will-astro-v1 template contains **45 files, 17 directories, and 12
supported layouts**, with editable Home/About placeholders and empty notes and
images. It owns its schema, `.pages.yml`, styles, validation scripts, and preview
adapter; no personal biography, selected books or songs, or opinions are imported
from Will's homepage.

The workflow is deliberately staged: enter a new or empty absolute folder and
display name; review the exact file list without writing; explicitly create the
source; copy and manually run `npm install` and `npm run build`; return to the
read-only project check; then explicitly trust the project's code before opening
its local editor. The first install generates that website's own lockfile. Creation
does not install packages, run project code, make network requests, initialize Git,
or publish. The destination must be a real, separate folder outside Studio and open
workspaces. Exclusive writes never overwrite existing content; partial failures
retain created files for inspection rather than deleting or automatically retrying.

The wizard invalidates stale reviews when inputs change, guards double submission,
and preserves an already-requested creation across closing and reopening. Closing
the dialog is not cancellation. Commands remain inert, copyable text, and the
success handoff only checks the folder; missing dependencies do not become implicit
permission to install or execute anything.

The main website and starter now share a notes loader that owns its watcher even
when the notes directory starts empty. It registers before scanning, serializes
rescans, notices the first added note, clears the collection after the last removal,
and disposes previous listeners on configuration reload. Parsing, validation, and
rendering still belong to Astro's loader. This fixes empty-first-note preview
loading without inserting a dummy note or expanding Studio's `.md` editing support.

`npm run check:starter` is the explicit developer/CI cold-start gate. It generates
the neutral source tree in an isolated temporary folder, verifies that only reviewed
files exist, installs the generated project's dependencies, runs its production
build, and checks the resulting HTML and public assets for private Studio leakage.
It does not install into the runtime repository or any selected user project.
Successful checks remove their own verified QA folder; failures retain it and print
its path. This section records the implementation and validation procedure, not a
new CI-pass count, completed deployment, or release announcement.

The broader requested product is still unfinished. One compatible starter is not
a general website converter, universal visual builder, packaged installer, one-click
dependency setup, or automatic publishing system. Those boundaries remain explicit.

### Search, drafts, and project identity

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

### 0.3.0 Launchpad — September 2026

The independent runtime now defaults to the browser project chooser when no
`--project` is supplied. `npm start` serves its local address; `--open` or the Windows
launcher opens the browser. The bundled homepage still defaults to its own project.
Use `--choose-project` to explicitly select Launchpad there; it cannot be combined
with `--project`. Direct `--project` remains an explicit selection of trusted code.

Launchpad first performs read-only project-structure and installed-dependency
checks. It does not import the selected schema, run Astro, or install target
dependencies at this step. Opening requires a successful check and a separate
trust checkbox. The server rechecks the ticket before executing the project;
compatibility checks are not a security sandbox or a successful production build.
The editor appears through an explicit new-tab link, leaving existing tabs intact.

Recent projects live in the **runtime's** `.studio/projects.json`, with local paths,
display metadata, timestamps, and preferred port pairs. This registry is private
local state, excluded from publishing and source packaging. Selecting a shortcut
rechecks it without execution; forgetting it removes only the registry entry and
does not delete files, stop an editor, or free an active workspace slot.

Each Launchpad owns at most three active workspaces. Closing a browser tab does
not stop a server. Save all editor tabs before Ctrl+C in the Launchpad terminal;
shutdown closes the chooser and its owned workspaces, not unrelated services.
Saved port pairs are reused when free to help retain browser-draft origins, but
conflicts may require different ports. Drafts are not automatically migrated
between origins; that includes different ports or `localhost` versus `127.0.0.1`.

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
npm start -- --open
```

The output must be separate from the source and its ancestors/descendants. It
contains the editor, regression tests, a generated package manifest and CI workflow,
plus reference adapter code and the neutral starter template. Refreshing the
copied lockfile aligns it with the generated manifest. The exporter itself does
not install dependencies, initialise Git, commit, push, or deploy.

The public [independent repository](https://github.com/Hydr0g3ngz/will-studio) now
contains the Studio source with setup instructions, security notes, and CI. This is
an early contract-limited source distribution, not a hosted service, npm release,
or universal editing product. The 0.3.0 Launchpad was published as commit d9538f7;
Windows and Ubuntu CI passed in run 34678121589. This is a source release, not a
GitHub Release artifact or an installer.

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
   maintenance. Guard media-dialog upload completion against stale dialog/field
   state before expanding that workflow. Any future audio feature or playlist addition must follow Will's
   explicit selection, not invent a listening profile or add synthetic experiments.
6. Whole-project management: portable asset-inclusive bundles, previewable import,
   snapshot comparison and full restore, a publish queue, and useful diagnostics.
7. Continue actual content curation and visual refinement with verified sources.
8. Expand real-user acceptance testing: long sessions, multi-tab conflicts, offline
   recovery, cold start, international text, accessibility and touch interaction.
9. Product direction explicitly requested by the user: a standalone Will Studio,
   usable beyond this homepage. The shell/website adapter boundary, versioned
   will-astro-v1 contract, external-project launch, workspace-scoped browser storage,
   and an independent source repository now exist. Launchpad provides a browser
   chooser for compatible projects, explicit trust, and owned-workspace lifecycle
   handling; 0.5.0 source adds neutral starter review/creation with manual dependency
   setup. Next: clearer installation diagnostics, richer workspace management,
   additional adapters, deployment providers, upgrade/migration, and recovery.
   Expand proven workflows incrementally rather than claiming universal compatibility.

Do not mark the full active goal complete based only on green checks for this first
release. Validate newly added workflows against their actual intended behaviour.
